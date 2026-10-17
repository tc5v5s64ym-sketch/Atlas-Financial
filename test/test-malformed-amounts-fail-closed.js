'use strict';
/* ATLAS-077 — a present-but-unparseable scheduled amount (null, NaN, a
 * comma-grouped string like "1,900", or a missing amount on a dated
 * protected point requirement) must fail closed through the EXISTING
 * issue/unavailable publication pattern. It must never vanish silently
 * (today: a malformed bill is dropped and the walk publishes a clean $0
 * load under a 'calculated' label) and never be emitted as a NaN cash
 * event (today: commitments/obligations poison simulate totals and
 * every daily balance from the event date onward).
 *
 * Atlas contract ruling 2026-10-16 (Slack thread 1791980813.524529,
 * ts 1792181415.429459) governs this suite:
 *   A — the loud surface is the existing issue/unavailable pattern, not
 *       a new uncaught throw. Unknown scheduled amounts withhold the
 *       affected totals AND dependent spending/funding claims, while
 *       independently known stocks are retained. Existing malformed
 *       statement-contract throws stay unchanged.
 *   B — a dated active protected point requirement with a missing or
 *       malformed amount and no valid range is unknown. Preserved:
 *       valid null-plus-range commitments, undated informational rows,
 *       optional/disabled/settled cases, and genuine zero. Not all dated
 *       nulls are defects and not all amount-less rows are controls:
 *       the split is requirement-based (dated + non-optional +
 *       unsettled + no valid range), read through the incumbent
 *       commitment helpers, not date/key presence alone. This refines
 *       the Oct-14 probe suite, whose dated amount-less commitment row
 *       was pinned as a control; under the ruling that row is a dated
 *       protected point requirement with a missing amount.
 *   C — detection is at effective-source selection: after statement
 *       replacement, before coercion/caps. A valid statement minimum
 *       supersedes a bad fallback for that occurrence; a later bad
 *       fallback still blocks. Supported finite numeric inputs and
 *       numeric strings are preserved; comma strings are never parsed
 *       partially; no cent restrictions.
 *
 * The named state is Forecast.scheduledAmountState(plan, start, end,
 * opts) -> { status: 'ready' | 'unavailable', unknowns, reason } and is
 * carried through simulate, recommendWeekly, recommend, majorPlans,
 * paydayAllocation (and with it currentPeriodAction), projectDebts and
 * baselineTrajectory. The calendar period waterfalls gate their bill
 * load on the same detector (§J): bills were already covered by the
 * incumbent S1 arm; obligations were not. Pins include mixed valid/invalid inputs and a
 * distant dated requirement that knowledgeHorizon does not extend for
 * (a malformed row carries no need and no range, so the horizon omits
 * it — the requirement is still unknown).
 *
 * Synthetic fixtures only.
 * `node test/test-malformed-amounts-fail-closed.js`
 */
const F = require('../public/forecast.js');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

const AS_OF = '2026-01-01';
const WIN_START = '2026-01-01';
const WIN_END = '2026-02-28';

function planWith(carrier, amount, include) {
  const row = { id: 'probe', label: 'Probe', confidence: 'confirmed' };
  if (carrier === 'bill') Object.assign(row, { frequency: 'once', date: '2026-01-10' });
  if (carrier === 'commitment') Object.assign(row, { date: '2026-01-10' });
  if (carrier === 'obligation') Object.assign(row, { frequency: 'once', date: '2026-01-10' });
  if (include) row.amount = amount;
  const plan = {
    windowDays: 60,
    defaults: { targetBuffer: 0, extraDebtMonthly: 0, scenario: 'expected' },
    startingCash: { breakdown: [
      { id: 'chequing-a', value: 5000 }, { id: 'chequing-b', value: 0 }, { id: 'savings', value: 0 },
    ] },
    opening: { asOf: AS_OF },
    budget: { basis: 'ytd', categories: [] },
    income: [], bills: [], obligations: [], commitments: [],
  };
  if (carrier === 'bill') plan.bills = [row];
  if (carrier === 'commitment') plan.commitments = [row];
  if (carrier === 'obligation') plan.obligations = [row];
  return plan;
}

const stateOf = (plan, start, end, opts) => typeof F.scheduledAmountState === 'function'
  ? F.scheduledAmountState(plan, start || WIN_START, end || WIN_END, opts || {})
  : null;
const isUnavailable = plan => {
  const s = stateOf(plan);
  return !!(s && s.status === 'unavailable');
};
const isReady = plan => {
  const s = stateOf(plan);
  return !!(s && s.status === 'ready');
};
const totalsField = carrier =>
  carrier === 'bill' ? 'bills' : carrier === 'commitment' ? 'commitments' : 'obligations';
const allFiniteOrNull = value => {
  if (value == null) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(allFiniteOrNull);
  if (typeof value === 'object') return Object.values(value).every(allFiniteOrNull);
  return true;
};

/* --- A. The named state detects every defect shape ------------------ */
ok(typeof F.scheduledAmountState === 'function',
  'Forecast.scheduledAmountState is exported');

const MALFORMED = [['null', null, true], ['NaN', NaN, true], ['"1,900"', '1,900', true]];
for (const carrier of ['bill', 'commitment', 'obligation']) {
  for (const [name, amount, include] of MALFORMED) {
    const plan = planWith(carrier, amount, include);
    const s = stateOf(plan);
    ok(s && s.status === 'unavailable'
      && s.unknowns.some(u => u.carrier === carrier && u.id === 'probe'),
      `${carrier} amount ${name}: scheduledAmountState is unavailable naming the row`,
      s ? `status=${s.status}` : 'no state');
  }
}
ok(isUnavailable(planWith('bill', undefined, false)),
  'bill amount missing: scheduledAmountState is unavailable');
ok(isUnavailable(planWith('obligation', undefined, false)),
  'obligation amount missing: scheduledAmountState is unavailable');
/* A dated protected point requirement with NO amount key is a missing
 * amount under Ruling B (requirement-based split), not a control. */
ok(isUnavailable(planWith('commitment', undefined, false)),
  'commitment amount missing on a dated protected point requirement: unavailable');

/* --- B. simulate withholds affected totals and dependent claims ----- */
for (const carrier of ['bill', 'commitment', 'obligation']) {
  const plan = planWith(carrier, null, true);
  const sim = F.simulate(plan, AS_OF, { weeklyVariable: 0 });
  ok(sim.status === 'unavailable' && sim.scheduledAmounts
    && sim.scheduledAmounts.status === 'unavailable',
    `${carrier} null: simulate publishes status unavailable with the named state`,
    `status=${sim.status}`);
  ok(sim.totals[totalsField(carrier)] === null && sim.ending === null
    && sim.min && sim.min.balance === null,
    `${carrier} null: affected total and dependent walk claims are withheld (null)`,
    `totals.${totalsField(carrier)}=${sim.totals[totalsField(carrier)]}`);
  const events = F.expandEvents(plan, WIN_START, WIN_END, {});
  ok(!events.some(e => !Number.isFinite(e.amount))
    && !events.some(e => e.id === 'probe')
    && sim.daily.every(d => d.balance == null || Number.isFinite(d.balance)),
    `${carrier} null: no NaN event is emitted and no daily balance is NaN`);
}

/* --- C. ACR / baseline trajectory ----------------------------------- */
{
  const stub = () => ({ periods: { ytd: { label: 'stub', months: 1, spending: [] } } });
  const mk = amount => {
    const plan = planWith('bill', amount, true);
    plan.startingCash = { breakdown: [
      { id: 'chequing-a', value: 1000 }, { id: 'chequing-b', value: 0 }, { id: 'savings', value: 0 }] };
    return plan;
  };
  for (const [name, amount] of [['null', null], ['"1,900"', '1,900']]) {
    const traj = F.baselineTrajectory(mk(amount), [], AS_OF, { periods: stub() });
    const packet = traj && traj.additionalCashRequired;
    ok(traj && traj.status === 'unavailable'
      && packet && packet.amount === null && packet.status === 'unavailable',
      `bill ${name}: baseline trajectory is unavailable; no trusted calculated $0 ACR`,
      packet ? `{amount:${packet.amount}, status:${packet.status}}` : 'no packet');
  }
  const validTraj = F.baselineTrajectory(mk(1900), [], AS_OF, { periods: stub() });
  const vp = validTraj && validTraj.additionalCashRequired;
  ok(vp && vp.amount === 900 && vp.status === 'calculated',
    'control: valid $1,900 bill still yields ACR {900, calculated}',
    vp ? `{amount:${vp.amount}, status:${vp.status}}` : 'none');
}

/* --- D. Valid controls keep firing ----------------------------------- */
for (const carrier of ['bill', 'commitment', 'obligation']) {
  for (const [name, amount] of [['1900', 1900], ['"1900"', '1900']]) {
    const plan = planWith(carrier, amount, true);
    const events = F.expandEvents(plan, WIN_START, WIN_END, {})
      .filter(e => e.id === 'probe');
    const sim = F.simulate(plan, AS_OF, { weeklyVariable: 0 });
    ok(isReady(plan) && events.length === 1 && events[0].amount === -1900
      && sim.status !== 'unavailable'
      && sim.totals[totalsField(carrier)] === 1900 && sim.min.balance === 3100,
      `${carrier} valid ${name}: state ready, event -1900, totals 1900, min 3100`,
      `events=${events.length} totals=${sim.totals[totalsField(carrier)]} min=${sim.min && sim.min.balance}`);
  }
}

/* --- E. Ruling B preserves ------------------------------------------- */
{
  // Valid null-plus-range commitment: preserved, and the funding
  // sequence still reads the range (no point amount is invented).
  const plan = planWith('commitment', null, true);
  Object.assign(plan.commitments[0], { amountMin: 100, amountMax: 200 });
  const seq = F.fundingSequence(plan, AS_OF, {});
  const row = seq.find(r => r.id === 'probe');
  ok(isReady(plan) && row && row.need === null
    && row.amountMin === 100 && row.amountMax === 200,
    'commitment null amount with a valid range: preserved as a range row');
}
{
  // Undated informational row: no cash date, no amount — not a defect.
  const plan = planWith('commitment', null, true);
  delete plan.commitments[0].date;
  plan.commitments[0].when = 'TBD';
  const events = F.expandEvents(plan, WIN_START, WIN_END, {});
  ok(isReady(plan) && !events.some(e => e.id === 'probe'),
    'undated informational commitment with null amount: preserved, no event');
}
{
  const plan = planWith('commitment', null, true);
  plan.commitments[0].flexibility = 'optional';
  ok(isReady(plan), 'optional dated commitment with null amount: preserved');
}
{
  const plan = planWith('commitment', null, true);
  const s = stateOf(plan, WIN_START, WIN_END, { disabled: ['probe'] });
  ok(s && s.status === 'ready',
    'disabled dated commitment with null amount: preserved');
}
{
  const plan = planWith('commitment', null, true);
  plan.commitments[0].settledOn = '2025-12-01';
  ok(isReady(plan), 'settled dated commitment with null amount: preserved');
}
for (const carrier of ['bill', 'commitment', 'obligation']) {
  const plan = planWith(carrier, 0, true);
  ok(isReady(plan), `${carrier} genuine zero amount: preserved as known`);
}

/* --- F. Ruling C: statement replacement at effective-source selection  */
function statementPlan(windowEnd) {
  const plan = planWith('obligation', '1,900', true);
  Object.assign(plan.obligations[0], {
    frequency: 'monthly', day: 10, firstDue: '2026-01-10',
    effect: 'payment', debtId: 'card', payingAccount: 'chequing-a',
    confidence: 'estimated',
    statementOccurrences: [{ scheduledDate: '2026-01-10', dueDate: '2026-01-10',
      minimum: 123.45, currency: 'cad', confidence: 'confirmed' }],
  });
  delete plan.obligations[0].date;
  return { plan, windowEnd };
}
{
  const { plan } = statementPlan();
  const s = stateOf(plan, '2026-01-01', '2026-01-31');
  const events = F.expandEvents(plan, '2026-01-01', '2026-01-31', {})
    .filter(e => e.id === 'probe');
  ok(s && s.status === 'ready' && events.length === 1 && events[0].amount === -123.45,
    'valid statement minimum supersedes a bad fallback for that occurrence',
    `events=${events.length} amount=${events[0] && events[0].amount}`);
}
{
  const { plan } = statementPlan();
  const s = stateOf(plan, '2026-01-01', '2026-02-28');
  const events = F.expandEvents(plan, '2026-01-01', '2026-02-28', {})
    .filter(e => e.id === 'probe');
  ok(s && s.status === 'unavailable'
    && events.some(e => e.date === '2026-01-10' && e.amount === -123.45),
    'a later occurrence falling back to the bad amount still blocks');
}
{
  // Existing malformed statement-contract throws stay unchanged.
  const { plan } = statementPlan();
  plan.obligations[0].statementOccurrences[0].minimum = 'abc';
  let threw = false;
  try { F.expandEvents(plan, '2026-01-01', '2026-01-31', {}); } catch (e) { threw = true; }
  ok(threw, 'malformed statement contract still throws (incumbent contract)');
}

/* --- G. Mixed valid + invalid inputs ---------------------------------- */
{
  const plan = planWith('bill', 500, true);
  plan.commitments = [{ id: 'bad-commitment', label: 'Bad', date: '2026-01-12',
    amount: null, confidence: 'confirmed' }];
  const s = stateOf(plan);
  const sim = F.simulate(plan, AS_OF, { weeklyVariable: 0 });
  const events = F.expandEvents(plan, WIN_START, WIN_END, {});
  ok(s && s.status === 'unavailable'
    && s.unknowns.length === 1 && s.unknowns[0].carrier === 'commitment',
    'mixed plan: only the malformed carrier is named unknown');
  ok(sim.totals.bills === 500 && sim.totals.commitments === null
    && events.some(e => e.id === 'probe' && e.amount === -500),
    'mixed plan: independently known bill total retained, commitment total withheld',
    `bills=${sim.totals.bills} commitments=${sim.totals.commitments}`);
}

/* --- H. Distant dated requirement knowledgeHorizon would omit --------- */
{
  const plan = planWith('commitment', null, true);
  plan.commitments[0].date = '2027-06-15';
  const horizon = F.knowledgeHorizon(plan, AS_OF, {});
  ok(horizon.end < '2027-06-15',
    'distant malformed requirement does not extend the knowledge horizon (omission documented)',
    `horizon.end=${horizon.end}`);
  const s = stateOf(plan, horizon.start, horizon.end);
  ok(s && s.status === 'unavailable',
    'distant dated protected requirement is still unknown inside the horizon window');
  ok(F.recommendWeekly(plan, AS_OF, {}) === null,
    'distant malformed requirement withholds the weekly spending claim');
}

/* --- I. Consumer propagation ------------------------------------------ */
{
  const bad = planWith('bill', null, true);
  ok(F.recommendWeekly(bad, AS_OF, {}) === null,
    'recommendWeekly withholds (null) when a scheduled amount is unknown');
  const good = F.recommendWeekly(planWith('bill', 1900, true), AS_OF, {});
  ok(typeof good === 'number' && Number.isFinite(good),
    'recommendWeekly still publishes a number for a valid plan', `value=${good}`);
}
{
  const rec = F.recommend(planWith('bill', null, true), AS_OF, {});
  ok(rec.weekly === null
    && rec.scheduledAmounts && rec.scheduledAmounts.status === 'unavailable',
    'recommend withholds its weekly claim and carries the named state',
    `weekly=${rec.weekly}`);
}
{
  const plans = (() => {
    const p = planWith('commitment', 500, true);
    p.commitments.push({ id: 'bad', label: 'Bad', date: '2026-03-01',
      amount: null, confidence: 'confirmed' });
    return F.majorPlans(p, AS_OF, {});
  })();
  ok(plans.length > 0 && plans.every(r => r.verdict === null && r.funded === null),
    'majorPlans withholds verdicts when a scheduled amount is unknown');
}
{
  const alloc = F.paydayAllocation(planWith('bill', null, true), AS_OF, {});
  ok(alloc.status === 'unavailable' && alloc.spendPermission === null
    && alloc.weeklyCap === null,
    'paydayAllocation withholds spending claims when a scheduled amount is unknown',
    `status=${alloc.status}`);
  ok(alloc.currentBalancePublication
    && alloc.currentBalancePublication.amount === 5000,
    'paydayAllocation retains the independently known current-balance stock',
    `amount=${alloc.currentBalancePublication && alloc.currentBalancePublication.amount}`);
  const action = F.currentPeriodAction(planWith('bill', null, true), AS_OF, {});
  ok(action.spendPermission === null,
    'currentPeriodAction (calendar/period surface) withholds spend permission',
    `spendPermission=${action.spendPermission}`);
}
{
  const plan = planWith('obligation', null, true);
  plan.obligations[0].debtId = 'card';
  plan.obligations[0].effect = 'payment';
  const walked = F.projectDebts(plan,
    [{ id: 'card', label: 'Card', balance: 2000, limit: 5000, rate: 0.2 }], AS_OF, {});
  ok(walked.scheduledAmounts && walked.scheduledAmounts.status === 'unavailable',
    'projectDebts carries the named scheduled-amount state');
  ok(allFiniteOrNull(walked.marks),
    'projectDebts marks contain no NaN figure');
}

/* --- J. Calendar totals: the period waterfall bill load ---------------
 * calendarBillSections emits no row for an unknown amount, so a total
 * built from its rows is a row sum (disclosure), not a claim. The claim
 * is the waterfall's periodBillLoad and everything derived from it
 * (Balance After Deductions, predicted ending balance, the leftover and
 * sweep chain). For bills the incumbent S1 arm already nulls the load
 * when the amount is unavailable; obligations had no equivalent arm —
 * a null/"1,900"/NaN obligation published periodBillLoad 0 under a
 * 'calculated' trust label, indistinguishable from an empty plan. The
 * shared detector now gates the load for both carriers, per window. */
const WF_AS_OF = '2026-08-30';
function waterfallPlan(obligations, bills, commitments) {
  return {
    defaults: { targetBuffer: 500 },
    startingCash: { breakdown: [{ id: 'chequing-a', label: 'BILLS ACCOUNT', value: 8000 }] },
    opening: { asOf: WF_AS_OF },
    nextDollar: { policy: 'true-surplus-highest-interest', provenance: 'owner-stated' },
    income: [{ id: 'payroll', label: 'Payroll', frequency: 'biweekly',
      anchor: '2026-08-14', amount: 2000, confidence: 'confirmed' }],
    obligations: obligations || [], bills: bills || [], commitments: commitments || [],
    budget: { categories: [] },
  };
}
const wfObligation = amount => [{ id: 'wf-ob', label: 'WfOb', frequency: 'monthly', day: 7,
  firstDue: '2026-09-07', amount, confidence: 'confirmed', payingAccount: 'chequing-a' }];
const activePeriodOf = rec => (rec.defaultView.calendarPeriods || [])
  .find(p => p && p.id === 'this-pay-period') || {};
{
  const rec = F.recommend(waterfallPlan(wfObligation(400)), WF_AS_OF, {});
  const p = activePeriodOf(rec);
  ok(p.periodBillLoad === 400 && p.periodBillLoadTrust === 'calculated'
    && p.balanceAfterDeductions === 1600 && p.predictedEndingBalance === 1600,
    'calendar waterfall control: valid obligation publishes its load and derived totals',
    `load=${p.periodBillLoad} balAfterDed=${p.balanceAfterDeductions}`);
}
for (const [name, amount] of [['null', null], ['"1,900"', '1,900'], ['NaN', NaN]]) {
  const rec = F.recommend(waterfallPlan(wfObligation(amount)), WF_AS_OF, {});
  const p = activePeriodOf(rec);
  const next = (rec.defaultView.calendarPeriods || [])
    .find(q => q && q.id === 'next-pay-period') || {};
  ok(p.periodBillLoad === null && p.periodBillLoadTrust === 'unavailable'
    && p.balanceAfterDeductions === null && p.predictedEndingBalance === null,
    `calendar waterfall: obligation amount ${name} makes the window's bill load unknown`,
    `load=${p.periodBillLoad} trust=${p.periodBillLoadTrust}`);
  ok(next.periodBillLoad === 0 && next.periodBillLoadTrust === 'calculated',
    `calendar waterfall: obligation amount ${name} leaves a window with no occurrence ready`,
    `next load=${next.periodBillLoad}`);
}
{
  const rec = F.recommend(waterfallPlan([], [{ id: 'wf-bill', label: 'WfBill',
    frequency: 'monthly', day: 7, amount: null, confidence: 'confirmed',
    payingAccount: 'chequing-a' }]), WF_AS_OF, {});
  const p = activePeriodOf(rec);
  ok(p.periodBillLoad === null && p.periodBillLoadTrust === 'unavailable',
    'calendar waterfall: bill amount null still nulls the load (incumbent S1 arm)',
    `load=${p.periodBillLoad}`);
}
{
  // Boundary: commitments never enter the bill load, so a commitment
  // unknown withholds the plan's spending claims (pinned in §I) but
  // does not null a load it was never part of.
  const rec = F.recommend(waterfallPlan(wfObligation(400), [],
    [{ id: 'wf-c', label: 'WfC', date: '2026-09-05', amount: null,
      confidence: 'confirmed' }]), WF_AS_OF, {});
  const p = activePeriodOf(rec);
  ok(p.periodBillLoad === 400 && p.periodBillLoadTrust === 'calculated',
    'calendar waterfall boundary: commitment unknown does not null the bill load',
    `load=${p.periodBillLoad}`);
}
{
  // Ruling C at the waterfall: the September occurrence is superseded
  // by a valid statement minimum, so the active window's load is the
  // statement figure even though the row fallback is unparseable (the
  // wider state stays unavailable on later fallback occurrences).
  const ob = wfObligation('1,900');
  Object.assign(ob[0], { effect: 'payment', debtId: 'card', confidence: 'estimated',
    statementOccurrences: [{ scheduledDate: '2026-09-07', dueDate: '2026-09-07',
      minimum: 123.45, currency: 'cad', confidence: 'confirmed' }] });
  const rec = F.recommend(waterfallPlan(ob), WF_AS_OF, {});
  const p = activePeriodOf(rec);
  ok(p.periodBillLoad === 123.45 && p.periodBillLoadTrust === 'calculated',
    'calendar waterfall: valid statement minimum supersedes the bad fallback in the load',
    `load=${p.periodBillLoad}`);
}
{
  const rec = F.recommend(waterfallPlan(wfObligation(null)), WF_AS_OF,
    { disabled: ['wf-ob'] });
  const p = activePeriodOf(rec);
  ok(p.periodBillLoad === 0 && p.periodBillLoadTrust === 'calculated',
    'calendar waterfall: a disabled obligation does not null the load (incumbent exclusion)',
    `load=${p.periodBillLoad}`);
}

/* --- K. Repair round (Systems Review BLOCKING on head 70cf0557, B1):
 * the unavailable state must withhold the affected claims at the
 * actual publication boundaries — recommend's sim/zero aliases are
 * raw simulateModel walks that never passed through simulate()'s
 * publication wrapper, the full-horizon knowledge walk nests behind
 * a sliced simulate, and projectDebts' marks reprint future debt
 * values beside the marker. Asserted as withheld VALUES (null), not
 * marker presence. Fixtures are the review's own: as-of 2027-02-01,
 * known opening cash 7200, no income, one once-only row due
 * 2027-02-06 with amount null. */
const K_AS_OF = '2027-02-01';
function plan2027(carrier, amount) {
  const plan = {
    windowDays: 60,
    defaults: { targetBuffer: 0, extraDebtMonthly: 0, scenario: 'expected' },
    startingCash: { breakdown: [
      { id: 'chequing-a', value: 7200 }, { id: 'chequing-b', value: 0 }, { id: 'savings', value: 0 }] },
    opening: { asOf: K_AS_OF },
    budget: { basis: 'ytd', categories: [] },
    income: [], bills: [], obligations: [], commitments: [],
  };
  const row = { id: 'probe', label: 'Probe', confidence: 'confirmed', amount };
  if (carrier === 'bill') { Object.assign(row, { frequency: 'once', date: '2027-02-06' }); plan.bills = [row]; }
  if (carrier === 'commitment') { row.date = '2027-02-06'; plan.commitments = [row]; }
  if (carrier === 'obligation') { Object.assign(row, { frequency: 'once', date: '2027-02-06' }); plan.obligations = [row]; }
  return plan;
}
for (const carrier of ['bill', 'commitment', 'obligation']) {
  const rec = F.recommend(plan2027(carrier, null), K_AS_OF, {});
  ok(rec.scheduledAmounts && rec.scheduledAmounts.status === 'unavailable' && rec.weekly === null,
    `B1 recommend ${carrier} null: named state unavailable, weekly withheld (precondition)`);
  ok(rec.sim.totals[totalsField(carrier)] === null && rec.sim.ending === null
    && rec.zero.ending === null,
    `B1 recommend ${carrier} null: sim/zero walk claims withheld (affected total + endings null)`,
    `totals.${totalsField(carrier)}=${rec.sim.totals[totalsField(carrier)]} sim.ending=${rec.sim.ending} zero.ending=${rec.zero.ending}`);
  ok(rec.knowledge.ending === null && rec.knowledge.freeCash === null
    && rec.knowledge.min && rec.knowledge.min.balance === null && rec.holds === null,
    `B1 recommend ${carrier} null: knowledge ending/freeCash/min and holds withheld`,
    `ending=${rec.knowledge.ending} freeCash=${rec.knowledge.freeCash} holds=${rec.holds}`);
}
{
  // The leak reaches the real assistant projection: the packet's
  // horizon is reprinted from recommend's knowledge, so withholding
  // there must starve the packet's figures (not just its marker).
  const Assistant = require('../scripts/assistant-packet.js');
  const packet = Assistant.buildPacket({
    data: { plan: plan2027('obligation', null), debts: [], meta: { asOf: K_AS_OF } },
    periods: null, questionsMarkdown: '', now: '2027-02-01T12:00:00.000Z', env: {},
  });
  ok(packet.forecast.horizon && packet.forecast.horizon.minBalance === null
    && packet.forecast.horizon.minDate === null,
    'B1 buildPacket: unknown obligation withholds the packet horizon min balance/date',
    `minBalance=${packet.forecast.horizon && packet.forecast.horizon.minBalance}`);
  ok(!(packet.forecast.recommendation && packet.forecast.recommendation.holds === true),
    'B1 buildPacket: recommendation holds is not published as true');
}
{
  // Sliced simulate: the visible 3 days contain no unknown and stay
  // known; the nested 100-day knowledge walk contains the due date
  // and must withhold its own totals/ending/min.
  const sim = F.simulate(plan2027('bill', null), K_AS_OF,
    { weeklyVariable: 0, horizonDays: 100, viewDays: 3 });
  ok(sim.ending === 7200 && sim.totals.bills === 0,
    'B1 sliced simulate: the genuinely independent 3-day slice stays known',
    `ending=${sim.ending} bills=${sim.totals.bills}`);
  ok(sim.knowledge && sim.knowledge.totals.bills === null && sim.knowledge.ending === null
    && sim.knowledge.min && sim.knowledge.min.balance === null,
    'B1 sliced simulate: full-horizon knowledge behind the slice is withheld',
    `knowledge totals.bills=${sim.knowledge && sim.knowledge.totals.bills} ending=${sim.knowledge && sim.knowledge.ending}`);
  const simC = F.simulate(plan2027('commitment', null), K_AS_OF,
    { weeklyVariable: 0, horizonDays: 100, viewDays: 3 });
  ok(simC.knowledge && simC.knowledge.totals.commitments === null
    && simC.knowledge.ending === null,
    'B1 sliced simulate: a commitment unknown withholds the nested knowledge too',
    `knowledge totals.commitments=${simC.knowledge && simC.knowledge.totals.commitments}`);
}
{
  // projectDebts: day-zero stock is known; post-due future metrics
  // (balance 1200 / paid 0 / headroom 2800 when the payment is simply
  // deleted) are the affected claims and must be withheld.
  const mkDebtPlan = amount => {
    const plan = plan2027('obligation', amount);
    Object.assign(plan.obligations[0], { id: 'cardpay', debtId: 'card',
      effect: 'payment', payingAccount: 'chequing-a' });
    return plan;
  };
  const debts = () => [{ id: 'card', label: 'Card', balance: 1200, limit: 4000, rate: 0 }];
  const walked = F.projectDebts(mkDebtPlan(null), debts(), K_AS_OF, {});
  const day0 = walked.marks[0].debts.find(d => d.id === 'card');
  const finalMark = walked.marks[walked.marks.length - 1];
  const final = finalMark.debts.find(d => d.id === 'card');
  ok(walked.scheduledAmounts && walked.scheduledAmounts.status === 'unavailable',
    'B1 projectDebts: named state unavailable (precondition)');
  ok(day0.balance === 1200 && day0.paid === 0 && walked.byId.card.opening === 1200,
    'B1 projectDebts: day-zero stock stays known (opening balance 1200, paid 0 at day 0)');
  ok(final.balance === null && final.paid === null && final.available === null
    && finalMark.headroom === null,
    'B1 projectDebts: post-due balance/paid/headroom withheld (not reprinted 1200/0/2800)',
    `balance=${final.balance} paid=${final.paid} headroom=${finalMark.headroom}`);
  ok(walked.byId.card.balance === null && walked.byId.card.paid === null,
    'B1 projectDebts: byId future balance/paid withheld',
    `byId balance=${walked.byId.card.balance} paid=${walked.byId.card.paid}`);
  const control = F.projectDebts(mkDebtPlan(300), debts(), K_AS_OF, {});
  const cFinalMark = control.marks[control.marks.length - 1];
  const cFinal = cFinalMark.debts.find(d => d.id === 'card');
  ok(cFinal.balance === 900 && cFinal.paid === 300 && cFinalMark.headroom === 3100
    && control.byId.card.balance === 900,
    'B1 projectDebts control: valid payment still publishes balance 900 / paid 300 / headroom 3100',
    `balance=${cFinal.balance} paid=${cFinal.paid} headroom=${cFinalMark.headroom}`);
}
{
  // The affected-total map: a noncash/capitalising obligation feeds
  // totals.noncash, not totals.obligations — withholding must null
  // the field the missing event would actually have fed, and retain
  // the genuinely known cash-obligation total beside it.
  const noncashRow = { id: 'heloc-int', label: 'HELOC interest', confidence: 'confirmed',
    nonCash: true, effect: 'capitalise', frequency: 'monthly', day: 10,
    firstDue: '2026-01-10', amount: null, debtId: 'heloc' };
  const only = planWith('obligation', 200, true);
  only.obligations = [noncashRow];
  const simOnly = F.simulate(only, AS_OF, { weeklyVariable: 0 });
  ok(simOnly.totals.noncash === null && simOnly.totals.obligations === 0,
    'B1 totals map: unknown noncash obligation withholds totals.noncash (obligations stays a complete 0)',
    `noncash=${simOnly.totals.noncash} obligations=${simOnly.totals.obligations}`);
  const mixed = planWith('obligation', 200, true);
  mixed.obligations = [
    { id: 'cash-ob', label: 'Cash ob', confidence: 'confirmed', frequency: 'once',
      date: '2026-01-10', amount: 200 },
    noncashRow,
  ];
  const simMixed = F.simulate(mixed, AS_OF, { weeklyVariable: 0 });
  ok(simMixed.totals.noncash === null && simMixed.totals.obligations === 200,
    'B1 totals map: known cash-obligation total retained while noncash is withheld',
    `noncash=${simMixed.totals.noncash} obligations=${simMixed.totals.obligations}`);
}

/* --- L. Repair round B2: bill event construction classifies the
 * effective source before coercion — booleans, arrays and nonfinite
 * numbers fabricate no monetary event, even though the classifier
 * already names them unknown. */
for (const [name, amount] of [['true', true], ['[475]', [475]], ['Infinity', Infinity]]) {
  const plan = planWith('bill', amount, true);
  const events = F.expandEvents(plan, WIN_START, WIN_END, {});
  ok(isUnavailable(plan) && !events.some(e => e.id === 'probe')
    && events.every(e => Number.isFinite(e.amount)),
    `B2 bill amount ${name}: named unknown and NO bill event is emitted (no fabricated -1/-475/-Infinity)`,
    `probe events=${events.filter(e => e.id === 'probe').length}`);
  const sim = F.simulate(plan, AS_OF, { weeklyVariable: 0 });
  ok(sim.totals.bills === null && allFiniteOrNull(sim.totals)
    && sim.daily.every(d => d.balance == null || Number.isFinite(d.balance)),
    `B2 bill amount ${name}: simulate withholds the bills total and publishes no nonfinite figure`);
}
{
  const plan = planWith('bill', 10.005, true);
  const events = F.expandEvents(plan, WIN_START, WIN_END, {}).filter(e => e.id === 'probe');
  ok(events.length === 1 && events[0].amount === -10.005,
    'B2 control: valid subcent bill amount still emits its exact event',
    `events=${events.length} amount=${events[0] && events[0].amount}`);
}
{
  // A waived occurrence is a legitimate zero: classification must not
  // turn the no-payment control into an unknown or an event.
  const plan = planWith('bill', true, true);
  plan.bills[0].noPaymentRequiredOn = ['2026-01-10'];
  const events = F.expandEvents(plan, WIN_START, WIN_END, {});
  ok(isReady(plan) && !events.some(e => e.id === 'probe'),
    'B2 control: waived (no-payment) occurrence of a malformed bill stays ready, no event');
}

/* --- M. Repair round 3 (Systems Review BLOCKING on head 163959fa,
 * B1a): the packet is a public consumer too — an unknown dated BEFORE
 * a known bill makes the "next due" claim an ordering/completeness
 * claim the packet cannot certify, withheld crossings cannot be
 * republished as a complete empty set, and a null holds must stay
 * null (unknown), not collapse to boolean false. The qualification
 * is claim-scoped: the packet envelope is NOT rerouted through
 * operatingPlan, known stocks stay published, and claims dated
 * before the first unknown are unaffected. Talk verifies claims
 * path/equals against the packet, so a withheld claim must fail
 * verification there too (materializeExplainerAnswer is pure — no
 * provider call; @google/genai is only a lazy import inside ask()). */
const M_AS_OF = '2027-02-01';
function packetPlan(bills, obligations) {
  const plan = plan2027('bill', 0);
  plan.bills = bills || [];
  plan.obligations = obligations || [];
  return plan;
}
const buildPacketFor = (plan, debts) => require('../scripts/assistant-packet.js')
  .buildPacket({
    data: { plan, debts: debts || [], meta: { asOf: M_AS_OF } },
    periods: null, questionsMarkdown: '', now: '2027-02-01T12:00:00.000Z', env: {},
  });
const billRow = (id, label, date, amount) => ({ id, label, confidence: 'confirmed',
  frequency: 'once', date, amount });
{
  const packet = buildPacketFor(packetPlan([
    billRow('unknown-bill', 'Invented unknown bill', '2027-02-06', null),
    billRow('later-bill', 'Invented later bill', '2027-02-10', 125),
  ]));
  const nso = packet.current.nextSignificantObligations;
  ok(nso.nextDue === null && nso.nextPaymentOut === null,
    'B1a packet: unknown dated Feb 6 withholds the Feb 10 nextDue/nextPaymentOut claims (not published as confirmed)',
    `nextDue=${JSON.stringify(nso.nextDue)}`);
  ok(nso.scheduledAmounts && nso.scheduledAmounts.status === 'unavailable'
    && nso.scheduledAmounts.unknowns.some(u => u.carrier === 'bill' && u.date === '2027-02-06'),
    'B1a packet: the withheld next-obligation claim carries the named scheduled-amount state');
  ok(packet.uncertainty.scheduledAmounts
    && packet.uncertainty.scheduledAmounts.status === 'unavailable'
    && packet.uncertainty.scheduledAmounts.unknowns.some(u => u.date === '2027-02-06')
    && typeof packet.uncertainty.scheduledAmounts.reason === 'string'
    && packet.uncertainty.scheduledAmounts.reason.length > 0,
    'B1a packet: the unknown and its reason are present in packet uncertainty');
  ok(packet.forecast.recommendation.holds === null,
    'B1a packet: recommendation holds stays null (unknown), not boolean false',
    `holds=${packet.forecast.recommendation.holds}`);
  ok(packet.forecast.status === 'ok'
    && packet.current.spendableHouseholdCash.value === 7200,
    'B1a packet: no blanket reroute — envelope stays ok and the known cash stock 7200 is retained',
    `status=${packet.forecast.status} cash=${packet.current.spendableHouseholdCash.value}`);
  const Talk = require('../scripts/talk-gemini.js');
  const claimsText = JSON.stringify({ status: 'explained', claims: [
    { path: 'current.nextSignificantObligations.nextDue.label', equals: 'Invented later bill' },
    { path: 'current.nextSignificantObligations.nextDue.date', equals: '2027-02-10' },
    { path: 'current.nextSignificantObligations.nextDue.amount', equals: 125 }] });
  const materialized = Talk.materializeExplainerAnswer(claimsText, packet);
  ok(materialized.ok === false,
    'B1a Talk: the Feb 10 next-due claims no longer verify against the packet (no confirmed Talk statement)',
    `ok=${materialized.ok} answer=${materialized.answer || ''}`);
}
{
  // Controls: the same claims stay publishable when nothing earlier
  // is unknown, and an unknown dated AFTER the next claim leaves it
  // genuinely unaffected.
  const Talk = require('../scripts/talk-gemini.js');
  const claimsText = JSON.stringify({ status: 'explained', claims: [
    { path: 'current.nextSignificantObligations.nextDue.label', equals: 'Invented later bill' },
    { path: 'current.nextSignificantObligations.nextDue.date', equals: '2027-02-10' },
    { path: 'current.nextSignificantObligations.nextDue.amount', equals: 125 }] });
  const knownOnly = buildPacketFor(packetPlan([
    billRow('later-bill', 'Invented later bill', '2027-02-10', 125)]));
  const nsoK = knownOnly.current.nextSignificantObligations;
  ok(nsoK.nextDue && nsoK.nextDue.date === '2027-02-10' && nsoK.nextDue.amount === 125
    && nsoK.nextDue.confidence === 'confirmed'
    && !knownOnly.uncertainty.scheduledAmounts,
    'B1a control: known-only plan still publishes nextDue Feb 10 / 125 / confirmed, no uncertainty entry');
  ok(Talk.materializeExplainerAnswer(claimsText, knownOnly).ok === true,
    'B1a control: Talk still verifies the next-due claims for a known-only plan');
  const earlier = buildPacketFor(packetPlan([
    billRow('early-bill', 'Invented early bill', '2027-02-06', 50),
    billRow('later-bill', 'Invented later bill', '2027-02-10', 125)]));
  ok(earlier.current.nextSignificantObligations.nextDue
    && earlier.current.nextSignificantObligations.nextDue.date === '2027-02-06'
    && earlier.current.nextSignificantObligations.nextDue.amount === 50,
    'B1a control: known-earlier 50 is the published next due');
  const unknownLater = buildPacketFor(packetPlan([
    billRow('early-bill', 'Invented early bill', '2027-02-06', 125),
    billRow('unknown-bill', 'Invented unknown bill', '2027-02-10', null)]));
  const nsoU = unknownLater.current.nextSignificantObligations;
  ok(nsoU.nextDue && nsoU.nextDue.date === '2027-02-06' && nsoU.nextDue.amount === 125
    && unknownLater.uncertainty.scheduledAmounts
    && unknownLater.uncertainty.scheduledAmounts.status === 'unavailable',
    'B1a control: unknown dated AFTER the next claim leaves it published; the unknown is still named in uncertainty');
}
{
  // The packet qualification is carrier-agnostic: a commitment
  // unknown dated before the known bill withholds the claim too.
  const plan = packetPlan([billRow('later-bill', 'Invented later bill', '2027-02-10', 125)]);
  plan.commitments = [{ id: 'bad-commitment', label: 'Bad', date: '2027-02-06',
    amount: null, confidence: 'confirmed' }];
  const packet = buildPacketFor(plan);
  ok(packet.current.nextSignificantObligations.nextDue === null
    && packet.uncertainty.scheduledAmounts
    && packet.uncertainty.scheduledAmounts.unknowns.some(u => u.carrier === 'commitment'),
    'B1a packet: a commitment unknown dated Feb 6 also withholds the Feb 10 next-due claim');
}
{
  // Crossings: the debt projection withholds uncertain crossings
  // (empty list + named state); the packet must not promote that to
  // a complete {ok, []}. Replacing the unknown with 200 produces the
  // Feb 6 crossing and stays published.
  const capPlan = amount => {
    const plan = packetPlan([]);
    plan.obligations = [{ id: 'cap', label: 'Capitalised interest', confidence: 'confirmed',
      nonCash: true, effect: 'capitalise', frequency: 'once', date: '2027-02-06',
      amount, debtId: 'card' }];
    return plan;
  };
  const capDebts = () => [{ id: 'card', label: 'Card', balance: 1200, limit: 1300, rate: 0 }];
  const walked = F.projectDebts(capPlan(null), capDebts(), M_AS_OF, {});
  ok(walked.crossings.length === 0 && walked.scheduledAmounts.status === 'unavailable',
    'B1a crossings precondition: projection withholds the crossing and names the state');
  const packet = buildPacketFor(capPlan(null), capDebts());
  ok(packet.forecast.facilityCrossings.status === 'unavailable'
    && !(packet.forecast.facilityCrossings.status === 'ok'
      && Array.isArray(packet.forecast.facilityCrossings.items)
      && packet.forecast.facilityCrossings.items.length === 0),
    'B1a packet: facilityCrossings is unavailable, not a complete empty ok set',
    `facilityCrossings=${JSON.stringify(packet.forecast.facilityCrossings)}`);
  const control = buildPacketFor(capPlan(200), capDebts());
  ok(control.forecast.facilityCrossings.status === 'ok'
    && control.forecast.facilityCrossings.items.length === 1
    && control.forecast.facilityCrossings.items[0].date === '2027-02-06',
    'B1a control: known capitalisation 200 still publishes its Feb 6 crossing');
}

/* --- N. Repair round 3 (B1b): the debt wrapper's taint must follow
 * the routing dependency — an unknown payment on card A decides how
 * much of a later extra payment reaches card B, so the allocation
 * record and B's downstream metrics are dependent unknowns too —
 * and the day-zero mark is a PRE-EVENT snapshot: an unknown due on
 * the as-of date must not null the known opening stock. Fixtures are
 * the review's: A/B open 1000 each, rates 12/6, limits 4000,
 * interestByEvent, owner next-dollar policy ready, extra 1500 on
 * Feb 15; unknown case is byte-identical to the zero-payment control
 * for B and the allocation on the unrepaired tree. */
const N_AS_OF = '2027-02-01';
function cascadePlan(aAmount) {
  const plan = plan2027('bill', 0);
  plan.windowDays = 20;
  plan.nextDollar = { policy: 'true-surplus-highest-interest',
    eligibleDebts: 'revolving-cards-and-heloc', provenance: 'owner-stated' };
  plan.obligations = [{ id: 'a-pay', label: 'Card A payment', confidence: 'confirmed',
    frequency: 'once', date: '2027-02-06', amount: aAmount, debtId: 'card-a',
    effect: 'payment', payingAccount: 'chequing-a' }];
  return plan;
}
const cascadeDebts = () => ([
  { id: 'card-a', label: 'Card A', structure: 'Revolving card', balance: 1000,
    pending: 0, rate: 12, limit: 4000, interestByEvent: true, confidence: 'verified' },
  { id: 'card-b', label: 'Card B', structure: 'Revolving card', balance: 1000,
    pending: 0, rate: 6, limit: 4000, interestByEvent: true, confidence: 'verified' },
  { id: 'loan', label: 'Secured loan', structure: 'Secured loan', secured: true,
    balance: 5000, pending: 0, rate: 0, confidence: 'verified' },
]);
const cascadeWalk = aAmount => F.projectDebts(cascadePlan(aAmount), cascadeDebts(),
  N_AS_OF, { extraDebtMonthly: 1500, debtHorizonDays: 20 });
{
  const w = cascadeWalk(null);
  const final = w.marks[w.marks.length - 1];
  const rowA0 = w.marks[0].debts.find(d => d.id === 'card-a');
  const rowB0 = w.marks[0].debts.find(d => d.id === 'card-b');
  const rowA = final.debts.find(d => d.id === 'card-a');
  const rowB = final.debts.find(d => d.id === 'card-b');
  const rowLoan = final.debts.find(d => d.id === 'loan');
  ok(w.scheduledAmounts && w.scheduledAmounts.status === 'unavailable',
    'B1b cascade: named state unavailable (precondition)');
  ok(w.extraDebtAllocation['2027-02-15'] === undefined,
    'B1b cascade: the Feb 15 extra allocation is withheld (its split depends on A\u2019s unknown payment)',
    `allocation=${JSON.stringify(w.extraDebtAllocation['2027-02-15'] || null)}`);
  ok(rowB.balance === null && rowB.paid === null && rowB.available === null,
    'B1b cascade: downstream card B future balance/paid/credit-left are withheld (not 500/500/3500)',
    `B balance=${rowB.balance} paid=${rowB.paid} available=${rowB.available}`);
  ok(rowA.balance === null && rowA0.balance === 1000 && rowB0.balance === 1000,
    'B1b cascade: A post-due balance stays withheld; day-zero stocks for A and B stay known (1000)');
  ok(rowLoan.balance === 5000,
    'B1b cascade: a genuinely unaffected debt (secured loan, outside the chain) still publishes 5000',
    `loan balance=${rowLoan.balance}`);
}
{
  const w = cascadeWalk(500);
  const alloc = w.extraDebtAllocation['2027-02-15'];
  const line = id => alloc && alloc.allocations.find(l => l.debtId === id);
  ok(alloc && line('card-a') && line('card-a').amount === 500
    && line('card-a').status === 'calculated'
    && line('card-b') && line('card-b').amount === 1000
    && line('card-b').status === 'calculated',
    'B1b control: known A payment 500 publishes the allocation A 500 / B 1000, calculated',
    `allocation=${JSON.stringify(alloc || null)}`);
  const final = w.marks[w.marks.length - 1];
  const rowA = final.debts.find(d => d.id === 'card-a');
  const rowB = final.debts.find(d => d.id === 'card-b');
  ok(rowB.balance === 0 && rowB.paid === 1000 && rowB.available === 4000
    && rowA.balance === 0 && rowA.paid === 1000,
    'B1b control: B future metrics publish 0 / 1000 / 4000 and A publishes 0 / paid 1000',
    `B=${rowB.balance}/${rowB.paid}/${rowB.available} A=${rowA.balance}/${rowA.paid}`);
}
{
  // A genuine zero is a KNOWN amount: the zero-payment plan publishes
  // the very figures the unknown plan must withhold.
  const w = cascadeWalk(0);
  const alloc = w.extraDebtAllocation['2027-02-15'];
  const line = id => alloc && alloc.allocations.find(l => l.debtId === id);
  ok(w.scheduledAmounts.status === 'ready' && alloc
    && line('card-a') && line('card-a').amount === 1000
    && line('card-b') && line('card-b').amount === 500,
    'B1b control: genuine zero A payment is known — allocation A 1000 / B 500 stays published (unknown is not zero)');
}
{
  // Due-today regression: the opening snapshot is taken before any
  // event applies, so an unknown due ON the as-of date leaves the
  // day-zero stock known; only post-due claims withhold.
  const mkPlan = amount => {
    const plan = plan2027('obligation', amount);
    Object.assign(plan.obligations[0], { id: 'today-pay', debtId: 'card',
      effect: 'payment', payingAccount: 'chequing-a' });
    plan.obligations[0].date = '2027-02-01';
    return plan;
  };
  const debts = () => [{ id: 'card', label: 'Card', balance: 1200, limit: 4000, rate: 0 }];
  const w = F.projectDebts(mkPlan(null), debts(), N_AS_OF, {});
  const day0 = w.marks[0].debts.find(d => d.id === 'card');
  const final = w.marks[w.marks.length - 1].debts.find(d => d.id === 'card');
  ok(day0.balance === 1200 && day0.paid === 0 && day0.available === 2800
    && w.marks[0].headroom === 2800 && w.marks[0].consumer === 1200,
    'B1b due-today: day-zero pre-event stock stays known (balance 1200, available/headroom 2800)',
    `day0 balance=${day0.balance} available=${day0.available} headroom=${w.marks[0].headroom}`);
  ok(final.balance === null && w.byId.card.opening === 1200,
    'B1b due-today: post-due balance still withheld and byId opening stays 1200',
    `final balance=${final.balance} opening=${w.byId.card.opening}`);
  const control = F.projectDebts(mkPlan(300), debts(), N_AS_OF, {});
  const cDay0 = control.marks[0].debts.find(d => d.id === 'card');
  const cFinal = control.marks[control.marks.length - 1].debts.find(d => d.id === 'card');
  ok(cDay0.balance === 1200 && cFinal.balance === 900,
    'B1b due-today control: valid payment due today — day-zero 1200 known, final balance 900',
    `day0=${cDay0.balance} final=${cFinal.balance}`);
}

/* --- O. Repair round 4 (B1a, probe-confirmed on head 9b9e616c): a
 * once outflow dated BEFORE the as-of is still owed — Forecast
 * carries it at the opening (onceOutflowDates) and the named state
 * names it unresolved — so it qualifies the packet's next-obligation
 * claims exactly like an in-range unknown. The round-3 predicate
 * required unknown.date >= asOf, so the overdue row never qualified:
 * the packet published the later known bill as the confirmed next
 * due / next payment out and Talk verified it, while recommend.holds
 * was already null on the same state. Controls: a known overdue
 * amount and a waived (noPaymentRequiredOn) overdue occurrence are
 * resolved by construction — the state is ready and the claims MUST
 * keep publishing. */
{
  const claimsText = JSON.stringify({ status: 'explained', claims: [
    { path: 'current.nextSignificantObligations.nextDue.label', equals: 'Invented later bill' },
    { path: 'current.nextSignificantObligations.nextDue.date', equals: '2027-02-10' },
    { path: 'current.nextSignificantObligations.nextDue.amount', equals: 125 }] });
  const Talk = require('../scripts/talk-gemini.js');
  const overduePlan = bill => packetPlan([
    bill, billRow('later-bill', 'Invented later bill', '2027-02-10', 125)]);
  const unknown = buildPacketFor(overduePlan(
    billRow('overdue-bill', 'Invented overdue bill', '2027-01-31', null)));
  const nsoO = unknown.current.nextSignificantObligations;
  ok(unknown.uncertainty.scheduledAmounts
    && unknown.uncertainty.scheduledAmounts.unknowns.some(u => u.date === '2027-01-31')
    && unknown.forecast.recommendation.holds === null,
    'B1a overdue precondition: the named state names the Jan 31 unknown and holds is already null',
    `holds=${unknown.forecast.recommendation.holds}`);
  ok(nsoO.nextDue === null && nsoO.nextPaymentOut === null,
    'B1a overdue: pre-asOf unknown withholds the Feb 10 nextDue/nextPaymentOut claims (not published as confirmed)',
    `nextDue=${JSON.stringify(nsoO.nextDue)}`);
  ok(nsoO.scheduledAmounts && nsoO.scheduledAmounts.status === 'unavailable'
    && nsoO.scheduledAmounts.unknowns.some(u => u.carrier === 'bill' && u.date === '2027-01-31'),
    'B1a overdue: the withheld claim carries the named scheduled-amount state');
  ok(unknown.forecast.status === 'ok'
    && unknown.current.spendableHouseholdCash.value === 7200,
    'B1a overdue: no blanket reroute — envelope stays ok and the known cash stock 7200 is retained',
    `status=${unknown.forecast.status} cash=${unknown.current.spendableHouseholdCash.value}`);
  ok(Talk.materializeExplainerAnswer(claimsText, unknown).ok === false,
    'B1a overdue Talk: the Feb 10 next-due claims no longer verify against the packet');
  const known = buildPacketFor(overduePlan(
    billRow('overdue-bill', 'Invented overdue bill', '2027-01-31', 300)));
  ok(known.current.nextSignificantObligations.nextDue
    && known.current.nextSignificantObligations.nextDue.date === '2027-02-10'
    && known.current.nextSignificantObligations.nextDue.amount === 125
    && known.current.nextSignificantObligations.nextDue.confidence === 'confirmed'
    && !known.uncertainty.scheduledAmounts
    && Talk.materializeExplainerAnswer(claimsText, known).ok === true,
    'B1a overdue control: known overdue amount 300 — state ready, Feb 10 claim publishes and Talk verifies');
  const waivedRow = billRow('overdue-bill', 'Invented overdue bill', '2027-01-31', null);
  waivedRow.noPaymentRequiredOn = ['2027-01-31'];
  const waived = buildPacketFor(overduePlan(waivedRow));
  ok(waived.current.nextSignificantObligations.nextDue
    && waived.current.nextSignificantObligations.nextDue.date === '2027-02-10'
    && !waived.uncertainty.scheduledAmounts
    && Talk.materializeExplainerAnswer(claimsText, waived).ok === true,
    'B1a overdue control: waived overdue occurrence (noPaymentRequiredOn) — state ready, Feb 10 claim publishes');
}

/* --- P. Repair round 4 (B1b, probe-confirmed on head 9b9e616c):
 * the round-3 fixpoint tainted EVERY member of an extra payment's
 * chain once any member was tainted, but a payDown cascade moves in
 * chain order: a member's take depends on the balances at-or-before
 * its own position, never on members after it. §N mirrored with the
 * unknown on card B (the downstream member) and extra 500: upstream
 * card A's receipt, balance, paid and credit-left are provably
 * invariant (the known-500 and genuine-zero controls agree byte for
 * byte) and must publish; B stays withheld, and the allocation
 * entry — whose only take is A's determined one — publishes with
 * its nextTarget conclusion withheld (it turns on B's unknown
 * balance). §N's direction (unknown upstream) is pinned above and
 * must not regress. */
function cascadePlanB(bAmount) {
  const plan = plan2027('bill', 0);
  plan.windowDays = 20;
  plan.nextDollar = { policy: 'true-surplus-highest-interest',
    eligibleDebts: 'revolving-cards-and-heloc', provenance: 'owner-stated' };
  plan.obligations = [{ id: 'b-pay', label: 'Card B payment', confidence: 'confirmed',
    frequency: 'once', date: '2027-02-06', amount: bAmount, debtId: 'card-b',
    effect: 'payment', payingAccount: 'chequing-a' }];
  return plan;
}
const cascadeWalkB = bAmount => F.projectDebts(cascadePlanB(bAmount), cascadeDebts(),
  N_AS_OF, { extraDebtMonthly: 500, debtHorizonDays: 20 });
{
  const w = cascadeWalkB(null);
  const alloc = w.extraDebtAllocation['2027-02-15'];
  ok(w.scheduledAmounts && w.scheduledAmounts.status === 'unavailable',
    'B1b reversed precondition: named state unavailable (unknown on card B)');
  ok(alloc && Array.isArray(alloc.allocations) && alloc.allocations.length === 1
    && alloc.allocations[0].debtId === 'card-a' && alloc.allocations[0].amount === 500
    && alloc.allocations[0].status === 'calculated' && alloc.nextTarget === null,
    'B1b reversed: the Feb 15 allocation publishes its determined take (A 500, calculated); nextTarget withheld',
    `allocation=${JSON.stringify(alloc || null)}`);
  const final = w.marks[w.marks.length - 1];
  const rowA = final.debts.find(d => d.id === 'card-a');
  const rowB = final.debts.find(d => d.id === 'card-b');
  ok(rowA.balance === 500 && rowA.paid === 500 && rowA.available === 3500,
    'B1b reversed: upstream card A retains balance 500 / paid 500 / credit-left 3500',
    `A balance=${rowA.balance} paid=${rowA.paid} available=${rowA.available}`);
  ok(rowB.balance === null && rowB.paid === null && rowB.available === null,
    'B1b reversed: downstream card B future metrics stay withheld',
    `B balance=${rowB.balance} paid=${rowB.paid} available=${rowB.available}`);
  ok(w.byId['card-a'].balance === 500 && w.byId['card-a'].paid === 500
    && w.byId['card-a'].interest === 0 && w.byId['card-b'].balance === null,
    'B1b reversed: byId A publishes 500 / paid 500 / interest 0; byId B stays withheld',
    `byId A=${w.byId['card-a'].balance}/${w.byId['card-a'].paid}/${w.byId['card-a'].interest}`);
  const day0A = w.marks[0].debts.find(d => d.id === 'card-a');
  const day0B = w.marks[0].debts.find(d => d.id === 'card-b');
  ok(day0A.balance === 1000 && day0B.balance === 1000,
    'B1b reversed: day-zero stocks for A and B stay known (1000)');
}
{
  const w = cascadeWalkB(500);
  const alloc = w.extraDebtAllocation['2027-02-15'];
  const final = w.marks[w.marks.length - 1];
  const rowA = final.debts.find(d => d.id === 'card-a');
  const rowB = final.debts.find(d => d.id === 'card-b');
  ok(alloc && alloc.allocations.length === 1 && alloc.allocations[0].amount === 500
    && alloc.nextTarget && alloc.nextTarget.debtId === 'card-b'
    && rowA.balance === 500 && rowA.paid === 500 && rowA.available === 3500
    && rowB.balance === 500 && rowB.paid === 500 && rowB.available === 3500,
    'B1b reversed control: B payment known 500 — allocation A 500 with nextTarget B; A and B publish 500/500/3500',
    `A=${rowA.balance}/${rowA.paid}/${rowA.available} B=${rowB.balance}/${rowB.paid}/${rowB.available}`);
}
{
  const w = cascadeWalkB(0);
  const alloc = w.extraDebtAllocation['2027-02-15'];
  const final = w.marks[w.marks.length - 1];
  const rowA = final.debts.find(d => d.id === 'card-a');
  const rowB = final.debts.find(d => d.id === 'card-b');
  ok(w.scheduledAmounts.status === 'ready' && alloc
    && alloc.allocations.length === 1 && alloc.allocations[0].amount === 500
    && rowA.balance === 500 && rowA.paid === 500 && rowA.available === 3500
    && rowB.balance === 1000 && rowB.paid === 0 && rowB.available === 3000,
    'B1b reversed control: B payment genuine zero is known — A 500/500/3500 and B 1000/0/3000 publish (unknown is not zero)');
}

/* --- Q. Probe-3 controls (nearBoundary does NOT reproduce a
 * defect; pinned so the round-4 predicate split cannot drift it):
 * an in-range unknown on or before a dated boundary withholds the
 * boundary claim, and the no-payday shell keeps publishing as a
 * null boundary with confidence 'unknown' — it asserts no dated
 * completeness and is not qualified by the overdue rule either:
 * the shell's window is empty by construction. */
{
  const paydayIncome = () => [{ id: 'pay-1', label: 'Invented payday',
    frequency: 'once', date: '2027-02-12', amount: 2000, confidence: 'confirmed' }];
  const dated = packetPlan([billRow('payday-bill', 'Invented payday bill', '2027-02-12', 300)]);
  dated.income = paydayIncome();
  const datedPacket = buildPacketFor(dated);
  ok(datedPacket.current.nextSignificantObligations.nearBoundary
    && datedPacket.current.nextSignificantObligations.nearBoundary.until === '2027-02-13'
    && datedPacket.current.nextSignificantObligations.nearBoundary.total === 300,
    'Probe-3 control: dated payday boundary publishes total 300 until 2027-02-13 when nothing is unknown');
  const datedUnknown = packetPlan([
    billRow('unknown-bill', 'Invented unknown bill', '2027-02-06', null),
    billRow('payday-bill', 'Invented payday bill', '2027-02-12', 300)]);
  datedUnknown.income = paydayIncome();
  ok(buildPacketFor(datedUnknown).current.nextSignificantObligations.nearBoundary === null,
    'Probe-3 control: in-range unknown on/before the boundary withholds the dated nearBoundary claim');
  const shell = buildPacketFor(packetPlan([
    billRow('unknown-bill', 'Invented unknown bill', '2027-02-06', null),
    billRow('later-bill', 'Invented later bill', '2027-02-10', 125)]));
  const shellBoundary = shell.current.nextSignificantObligations.nearBoundary;
  ok(shellBoundary && shellBoundary.payday === null && shellBoundary.until === null
    && shellBoundary.total === 0 && shellBoundary.confidence === 'unknown',
    'Probe-3 control: no-payday shell stays a published null boundary with confidence unknown (no completeness claim)');
}

/* --- R. Repair round 5 (B1b, Atlas ruling ts 1792241495.391439 on
 * the round-4 head cbfd1d1f; probe R4-1 reproduced the hypothesis
 * PARTIAL there): splitDetermined published an allocation record
 * whenever every RECORDED take preceded the first tainted chain
 * position, without checking whether those takes exhausted the
 * fixed extra. Fixture (the probe's, exactly): asOf 2027-02-01,
 * cards A/B open 1000, APR 12/6, limits 4000, interestByEvent,
 * owner highest-interest policy; known B payment 1000 on Feb 5;
 * B noncash capitalisation on Feb 6 (null vs genuine 0 vs 200);
 * extra 1500 on Feb 15. Null variant on the unrepaired tree: the
 * record {A 1000, calculated}, extraAbsorbed {Feb 15: 1000} and
 * unabsorbed 500 are byte-identical to the GENUINELY COMPLETE
 * genuine-zero control, while the 200 control proves B could have
 * taken a further 200 of the same extra — the split is incomplete,
 * its remainder is unknown, and nothing marks it. The repair
 * qualifies the remainder-dependent claims while preserving every
 * determined figure: A's take line keeps publishing and the record
 * is stamped status 'partial'; extraAbsorbed keeps its numeric
 * value — the caps consumers (expandEvents via capsFor/applyCaps)
 * spend exactly that value, so nulling or deleting the entry
 * would erase A's known 1000 outflow from the cash walk behind a
 * defaulted zero — and the dates whose absorbed total is not
 * exactly known are named in extraAbsorbedUnknown; the aggregate
 * unabsorbed, a single total carrying an unknown component, is
 * withheld (null). A split whose determined takes EXHAUST the
 * extra is complete in every resolution (§P: remainder 0) and is
 * NOT qualified. */
const R_AS_OF = '2027-02-01';
function remainderPlan(capAmount) {
  const plan = plan2027('bill', 0);
  plan.bills = [];
  plan.windowDays = 20;
  plan.nextDollar = { policy: 'true-surplus-highest-interest',
    eligibleDebts: 'revolving-cards-and-heloc', provenance: 'owner-stated' };
  plan.obligations = [
    { id: 'b-pay', label: 'Card B payment', confidence: 'confirmed',
      frequency: 'once', date: '2027-02-05', amount: 1000, debtId: 'card-b',
      effect: 'payment', payingAccount: 'chequing-a' },
    { id: 'b-cap', label: 'Card B capitalised interest', confidence: 'confirmed',
      nonCash: true, effect: 'capitalise', frequency: 'once', date: '2027-02-06',
      amount: capAmount, debtId: 'card-b' },
  ];
  return plan;
}
const remainderWalk = capAmount => F.projectDebts(remainderPlan(capAmount),
  cascadeDebts(), R_AS_OF, { extraDebtMonthly: 1500, debtHorizonDays: 20 });
{
  const w = remainderWalk(null);
  const rec = w.extraDebtAllocation['2027-02-15'];
  const final = w.marks[w.marks.length - 1];
  const rowA = final.debts.find(d => d.id === 'card-a');
  const rowB = final.debts.find(d => d.id === 'card-b');
  ok(w.scheduledAmounts && w.scheduledAmounts.status === 'unavailable'
    && w.scheduledAmounts.unknowns.some(u => u.id === 'b-cap'),
    'B1b remainder precondition: named state unavailable naming the Feb 6 capitalisation');
  ok(rec && rec.allocations.length === 1 && rec.allocations[0].debtId === 'card-a'
    && rec.allocations[0].amount === 1000 && rec.allocations[0].status === 'calculated'
    && rec.nextTarget === null && rec.status === 'partial',
    'B1b remainder: A\u2019s determined take (1000, calculated) still publishes, and the record is stamped partial \u2014 not a complete split',
    `record=${JSON.stringify(rec || null)}`);
  ok(w.extraAbsorbed['2027-02-15'] === 1000,
    'B1b remainder: extraAbsorbed keeps the determined 1000 (the caps value \u2014 not erased, not a defaulted zero)',
    `extraAbsorbed=${JSON.stringify(w.extraAbsorbed)}`);
  ok(w.extraAbsorbedUnknown && w.extraAbsorbedUnknown['2027-02-15'] === true,
    'B1b remainder: the Feb 15 absorbed total is named not-exactly-known in extraAbsorbedUnknown',
    `extraAbsorbedUnknown=${JSON.stringify(w.extraAbsorbedUnknown || null)}`);
  ok(w.unabsorbed === null,
    'B1b remainder: aggregate unabsorbed is withheld (its 500 remainder is unknown, not a published exact 500)',
    `unabsorbed=${w.unabsorbed}`);
  ok(rowA.balance === 0 && rowA.paid === 1000 && rowA.available === 4000
    && w.byId['card-a'].balance === 0 && w.byId['card-a'].paid === 1000,
    'B1b remainder: upstream card A metrics retained (0 / paid 1000 / credit-left 4000)',
    `A=${rowA.balance}/${rowA.paid}/${rowA.available}`);
  ok(rowB.balance === null && rowB.paid === null && rowB.available === null
    && w.byId['card-b'].balance === null && w.byId['card-b'].capitalised === null,
    'B1b remainder: card B future metrics stay withheld');
  // Consumer preservation, caps path: capsFor hands this walk's
  // extraAbsorbed to expandEvents, which spends exactly the capped
  // value \u2014 the cash walk must still spend A's known 1000 outflow
  // on Feb 15 (not 0 by default, not the full 1500 asked for).
  const capsEvents = F.expandEvents(remainderPlan(null), R_AS_OF, '2027-02-28',
    { extraDebtMonthly: 1500, extraAbsorbed: w.extraAbsorbed });
  const extraEv = capsEvents.find(e => e.kind === 'extra' && e.date === '2027-02-15');
  ok(extraEv && extraEv.amount === -1000,
    'B1b remainder consumer: the caps-fed cash walk still spends exactly the known 1000 outflow on Feb 15',
    `extra event=${extraEv ? extraEv.amount : 'missing'}`);
}
{
  // Genuine zero: the split IS complete (B's balance is known to be
  // 0 after its payment, so the 500 remainder is genuinely
  // unabsorbed) \u2014 every allocation-facing figure stays
  // byte-identical to the round-4 shape. Unknown is not zero, and
  // known zero is not qualified.
  const w = remainderWalk(0);
  const rec = w.extraDebtAllocation['2027-02-15'];
  const final = w.marks[w.marks.length - 1];
  const rowB = final.debts.find(d => d.id === 'card-b');
  ok(w.scheduledAmounts.status === 'ready' && rec
    && rec.allocations.length === 1 && rec.allocations[0].amount === 1000
    && rec.allocations[0].status === 'calculated' && rec.nextTarget === null
    && !('status' in rec) && w.extraAbsorbed['2027-02-15'] === 1000
    && w.unabsorbed === 500
    && !(w.extraAbsorbedUnknown && w.extraAbsorbedUnknown['2027-02-15']),
    'B1b remainder control: genuine zero capitalisation \u2014 complete split publishes unmarked (record/A 1000/absorbed 1000/unabsorbed 500, as round 4)',
    `record=${JSON.stringify(rec || null)} unabsorbed=${w.unabsorbed}`);
  ok(rowB.balance === 0 && rowB.paid === 1000 && rowB.available === 4000,
    'B1b remainder control: genuine zero \u2014 B metrics publish 0 / 1000 / 4000',
    `B=${rowB.balance}/${rowB.paid}/${rowB.available}`);
}
{
  // 200 control: the downstream take the null variant could not
  // rule out is real \u2014 with the capitalisation known, B takes a
  // further 200 and the split completes. Nothing is qualified.
  const w = remainderWalk(200);
  const rec = w.extraDebtAllocation['2027-02-15'];
  const line = id => rec && rec.allocations.find(l => l.debtId === id);
  ok(rec && line('card-a') && line('card-a').amount === 1000
    && line('card-b') && line('card-b').amount === 200
    && !('status' in rec) && w.extraAbsorbed['2027-02-15'] === 1200
    && w.unabsorbed === 300
    && !(w.extraAbsorbedUnknown && w.extraAbsorbedUnknown['2027-02-15']),
    'B1b remainder control: capitalisation 200 \u2014 complete split A 1000 / B 200, absorbed 1200, unabsorbed 300, unmarked',
    `record=${JSON.stringify(rec || null)}`);
}
{
  // \u00a7N direction under the same rule: the record is already
  // withheld (a take sits at the tainted position), and the
  // remainder-dependent claims are qualified identically \u2014 the
  // absorbed total is named unknown and the aggregate unabsorbed
  // withheld, while the caps value itself stays numeric.
  const w = cascadeWalk(null);
  ok(w.extraAbsorbedUnknown && w.extraAbsorbedUnknown['2027-02-15'] === true
    && w.unabsorbed === null
    && typeof w.extraAbsorbed['2027-02-15'] === 'number',
    'B1b remainder (\u00a7N direction): absorbed total named unknown and unabsorbed withheld; caps value stays numeric',
    `extraAbsorbedUnknown=${JSON.stringify(w.extraAbsorbedUnknown || null)} unabsorbed=${w.unabsorbed}`);
}
{
  // \u00a7P direction under the same rule: determined takes EXHAUST
  // the 500 extra (remainder 0 in every resolution), so the split
  // is complete \u2014 no partial stamp, no unknown mark, unabsorbed
  // stays a published 0.
  const w = cascadeWalkB(null);
  const rec = w.extraDebtAllocation['2027-02-15'];
  ok(rec && !('status' in rec) && w.extraAbsorbed['2027-02-15'] === 500
    && w.unabsorbed === 0
    && !(w.extraAbsorbedUnknown && w.extraAbsorbedUnknown['2027-02-15']),
    'B1b remainder (\u00a7P direction): exhaustive determined split stays complete \u2014 no qualification',
    `record=${JSON.stringify(rec || null)} unabsorbed=${w.unabsorbed}`);
}
{
  // Consumer preservation, trajectory: the prepared trajectory
  // walk gates on the same named state, so the null variant stays
  // wholly unavailable and the controls stay ready \u2014 the partial
  // record never reaches stage-3 attribution.
  const trajStub = () => ({ periods: { ytd: { label: 'stub', months: 1, spending: [] } } });
  const trajPlan = capAmount => {
    const plan = remainderPlan(capAmount);
    plan.windowDays = 60;
    plan.defaults.extraDebtMonthly = 1500;
    return plan;
  };
  const trajNull = F.baselineTrajectory(trajPlan(null), cascadeDebts(), R_AS_OF,
    { periods: trajStub() });
  const trajZero = F.baselineTrajectory(trajPlan(0), cascadeDebts(), R_AS_OF,
    { periods: trajStub() });
  const traj200 = F.baselineTrajectory(trajPlan(200), cascadeDebts(), R_AS_OF,
    { periods: trajStub() });
  ok(trajNull.status === 'unavailable' && trajZero.status === 'ready'
    && traj200.status === 'ready',
    'B1b remainder consumer: baselineTrajectory stays unavailable on the null variant and ready on both controls',
    `null=${trajNull.status} zero=${trajZero.status} 200=${traj200.status}`);
}

/* --- S. Repair round 6 (B1b, Systems Review BLOCKING on head
 * 168dd151, issuecomment 6235731569): round 5 qualified the
 * published unabsorbed aggregate only for REAL extras. The same
 * aggregate is a sum of leftovers from three walk arms, and the
 * obligation and planned-debt arms feed it too: a leftover there
 * is computed from the named debt's balance on the day it applied,
 * so when that balance depends on a named scheduled unknown, the
 * aggregate carries an unknown component exactly as the extra
 * remainder did. Fixture (the review's, exactly): asOf 2027-02-01,
 * cash 7200, no income, A/B open 1000, APR 12/6, limits 4000,
 * interestByEvent, owner highest-interest policy, no monthly extra
 * (extraDebtMonthly 0, debtHorizonDays 31); B noncash capitalisation
 * Feb 6 (null vs genuine 0 vs 200); B known payment 1200 on Feb 10.
 * On the blocked head the null variant publishes unabsorbed 200 —
 * byte-identical to the genuine-zero control — while the 200
 * control proves a valid resolution makes it 0: the published 200
 * silently assumes the unknown capitalisation is 0. The repair
 * withholds the aggregate (null — the same representation round 5
 * gave this scalar) whenever an obligation/planned-debt remainder
 * component was computed from a balance tainted at-or-before its
 * application day, and leaves it published when every component is
 * determined: a remainder on an untainted debt, or dated before
 * its debt's first unknown, is exact in every resolution. The
 * obligation cap map keeps its numeric values in all variants —
 * the cash walk spends those caps, and a missing/null cap defaults
 * to zero and would erase the known outflow. */
const S_AS_OF = '2027-02-01';
function remainderSourcePlan(capAmount) {
  const plan = plan2027('bill', 0);
  plan.bills = [];
  plan.windowDays = 31;
  plan.nextDollar = { policy: 'true-surplus-highest-interest',
    eligibleDebts: 'revolving-cards-and-heloc', provenance: 'owner-stated' };
  plan.obligations = [
    { id: 'b-cap', label: 'Card B capitalised interest', confidence: 'confirmed',
      nonCash: true, effect: 'capitalise', frequency: 'once', date: '2027-02-06',
      amount: capAmount, debtId: 'card-b' },
    { id: 'b-pay', label: 'Card B payment', confidence: 'confirmed',
      frequency: 'once', date: '2027-02-10', amount: 1200, debtId: 'card-b',
      effect: 'payment', payingAccount: 'chequing-a' },
  ];
  return plan;
}
const obligationRemainderWalk = capAmount => F.projectDebts(
  remainderSourcePlan(capAmount), cascadeDebts(), S_AS_OF,
  { extraDebtMonthly: 0, debtHorizonDays: 31 });
const plannedRemainderWalk = capAmount => {
  const plan = remainderSourcePlan(capAmount);
  plan.obligations = plan.obligations.filter(o => o.id === 'b-cap');
  return F.projectDebts(plan, cascadeDebts(), S_AS_OF,
    { extraDebtMonthly: 0, debtHorizonDays: 31,
      plannedFlows: [{ id: 'repay', date: '2027-02-10', amount: -1200, debtId: 'card-b' }] });
};
{
  const w = obligationRemainderWalk(null);
  const final = w.marks[w.marks.length - 1];
  const rowA = final.debts.find(d => d.id === 'card-a');
  const rowB = final.debts.find(d => d.id === 'card-b');
  ok(w.scheduledAmounts && w.scheduledAmounts.status === 'unavailable'
    && w.scheduledAmounts.unknowns.some(u => u.id === 'b-cap'),
    'B1b obligation remainder precondition: named state unavailable naming the Feb 6 capitalisation');
  ok(w.unabsorbed === null,
    'B1b obligation remainder: aggregate unabsorbed is withheld (its 200 remainder depends on the unknown capitalisation, not a published exact 200)',
    `unabsorbed=${w.unabsorbed}`);
  ok(w.obligationAbsorbed['2027-02-10:b-pay'] === 1000,
    'B1b obligation remainder: the internal obligation cap keeps its numeric 1000 (cash-walk cap intact, not erased to a defaulted zero)',
    `obligationAbsorbed=${JSON.stringify(w.obligationAbsorbed)}`);
  ok(rowA.balance === 1000 && rowA.paid === 0 && rowA.available === 3000
    && rowB.balance === null && rowB.paid === null && w.byId['card-b'].balance === null
    && w.marks[0].debts.find(d => d.id === 'card-b').balance === 1000,
    'B1b obligation remainder: card A metrics and day-zero stocks retained (1000/0/3000); card B future metrics stay withheld',
    `A=${rowA.balance}/${rowA.paid}/${rowA.available} B=${rowB.balance}`);
  ok(w.extraAbsorbedUnknown && Object.keys(w.extraAbsorbedUnknown).length === 0
    && Object.keys(w.extraAbsorbed).length === 0,
    'B1b obligation remainder: no extra dates exist to name — the qualification is on the aggregate scalar itself',
    `extraAbsorbedUnknown=${JSON.stringify(w.extraAbsorbedUnknown || null)}`);
}
{
  const w = obligationRemainderWalk(0);
  const final = w.marks[w.marks.length - 1];
  const rowB = final.debts.find(d => d.id === 'card-b');
  ok(w.scheduledAmounts.status === 'ready' && w.unabsorbed === 200
    && w.obligationAbsorbed['2027-02-10:b-pay'] === 1000
    && rowB.balance === 0 && rowB.paid === 1000 && rowB.available === 4000,
    'B1b obligation remainder control: genuine zero capitalisation — unabsorbed 200, cap 1000 and B 0/1000/4000 publish exactly (unknown is not zero)',
    `unabsorbed=${w.unabsorbed} B=${rowB.balance}/${rowB.paid}/${rowB.available}`);
}
{
  const w = obligationRemainderWalk(200);
  const final = w.marks[w.marks.length - 1];
  const rowB = final.debts.find(d => d.id === 'card-b');
  ok(w.scheduledAmounts.status === 'ready' && w.unabsorbed === 0
    && w.obligationAbsorbed['2027-02-10:b-pay'] === 1200
    && rowB.balance === 0 && rowB.paid === 1200 && rowB.available === 4000,
    'B1b obligation remainder control: capitalisation 200 — the payment is fully absorbed (unabsorbed 0, cap 1200, B 0/1200/4000)',
    `unabsorbed=${w.unabsorbed} B=${rowB.balance}/${rowB.paid}/${rowB.available}`);
}
{
  const w = plannedRemainderWalk(null);
  const final = w.marks[w.marks.length - 1];
  const rowA = final.debts.find(d => d.id === 'card-a');
  const rowB = final.debts.find(d => d.id === 'card-b');
  ok(w.scheduledAmounts && w.scheduledAmounts.status === 'unavailable'
    && w.scheduledAmounts.unknowns.some(u => u.id === 'b-cap'),
    'B1b planned remainder precondition: named state unavailable naming the Feb 6 capitalisation');
  ok(w.unabsorbed === null,
    'B1b planned remainder: aggregate unabsorbed is withheld (the planned repayment\u2019s 200 leftover depends on the unknown capitalisation)',
    `unabsorbed=${w.unabsorbed}`);
  ok(rowA.balance === 1000 && rowA.paid === 0 && rowA.available === 3000
    && rowB.balance === null && w.byId['card-b'].balance === null,
    'B1b planned remainder: card A metrics retained (1000/0/3000); card B future metrics stay withheld',
    `A=${rowA.balance}/${rowA.paid}/${rowA.available} B=${rowB.balance}`);
}
{
  const w = plannedRemainderWalk(0);
  const final = w.marks[w.marks.length - 1];
  const rowB = final.debts.find(d => d.id === 'card-b');
  ok(w.scheduledAmounts.status === 'ready' && w.unabsorbed === 200
    && rowB.balance === 0 && rowB.paid === 1000 && rowB.available === 4000,
    'B1b planned remainder control: genuine zero capitalisation — unabsorbed 200 and B 0/1000/4000 publish exactly',
    `unabsorbed=${w.unabsorbed} B=${rowB.balance}/${rowB.paid}/${rowB.available}`);
}
{
  const w = plannedRemainderWalk(200);
  const final = w.marks[w.marks.length - 1];
  const rowB = final.debts.find(d => d.id === 'card-b');
  ok(w.scheduledAmounts.status === 'ready' && w.unabsorbed === 0
    && rowB.balance === 0 && rowB.paid === 1200 && rowB.available === 4000,
    'B1b planned remainder control: capitalisation 200 — the planned repayment is fully absorbed (unabsorbed 0, B 0/1200/4000)',
    `unabsorbed=${w.unabsorbed} B=${rowB.balance}/${rowB.paid}/${rowB.available}`);
}
{
  // Direction control (the §P mirror): dependence follows the
  // balance the remainder was computed from. The unknown sits on
  // card B; the only remainder comes from a payment obligation on
  // upstream card A, whose balance path no event ties to B's
  // unknown — the aggregate is exact in every resolution and
  // stays published, while B's own metrics stay withheld.
  const plan = remainderSourcePlan(null);
  plan.obligations = plan.obligations.filter(o => o.id === 'b-cap');
  plan.obligations.push({ id: 'a-pay', label: 'Card A payment', confidence: 'confirmed',
    frequency: 'once', date: '2027-02-10', amount: 1200, debtId: 'card-a',
    effect: 'payment', payingAccount: 'chequing-a' });
  const w = F.projectDebts(plan, cascadeDebts(), S_AS_OF,
    { extraDebtMonthly: 0, debtHorizonDays: 31 });
  const final = w.marks[w.marks.length - 1];
  const rowA = final.debts.find(d => d.id === 'card-a');
  const rowB = final.debts.find(d => d.id === 'card-b');
  ok(w.scheduledAmounts.status === 'unavailable' && w.unabsorbed === 200
    && w.obligationAbsorbed['2027-02-10:a-pay'] === 1000
    && rowA.balance === 0 && rowA.paid === 1000 && rowA.available === 4000
    && rowB.balance === null,
    'B1b obligation remainder (direction): an unaffected upstream debt\u2019s remainder stays published exactly (unabsorbed 200, A 0/1000/4000); B stays withheld',
    `unabsorbed=${w.unabsorbed} A=${rowA.balance}/${rowA.paid}/${rowA.available} B=${rowB.balance}`);
}
{
  // Direction control, dated: a remainder computed BEFORE its own
  // debt's first unknown is determined by data upstream of the
  // unknown — the same at-or-before rule the marks use. B's
  // payment lands Feb 3, the unknown capitalisation is Feb 6, so
  // the 200 leftover is exact and stays published; B's post-Feb 6
  // metrics still withhold.
  const plan = remainderSourcePlan(null);
  plan.obligations = plan.obligations.map(o => o.id === 'b-pay'
    ? { ...o, date: '2027-02-03' } : o);
  const w = F.projectDebts(plan, cascadeDebts(), S_AS_OF,
    { extraDebtMonthly: 0, debtHorizonDays: 31 });
  const final = w.marks[w.marks.length - 1];
  const rowB = final.debts.find(d => d.id === 'card-b');
  ok(w.scheduledAmounts.status === 'unavailable' && w.unabsorbed === 200
    && w.obligationAbsorbed['2027-02-03:b-pay'] === 1000
    && rowB.balance === null && w.byId['card-b'].balance === null,
    'B1b obligation remainder (direction, dated): a remainder computed before its debt\u2019s first unknown stays published exactly (unabsorbed 200); later B metrics withhold',
    `unabsorbed=${w.unabsorbed} B=${rowB.balance}`);
}

console.log('\n' + (failures ? `${failures} failure(s)` : 'All ATLAS-077 malformed-amount checks passed'));
process.exit(failures === 0 ? 0 : 1);
