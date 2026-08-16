'use strict';
/* B91 current-state cutover — approved evidence drives canonical state.
 *
 * Acceptance corpus: docs/source_intake/PAYDAY_ACCEPTANCE_2026-08-14.md
 * Forecast remains the only financial engine. Observation files remain
 * evidence. The reconciler still does not write data.json.
 *
 * Independent proof: plan-row arithmetic and 01_OPEN_QUESTIONS status
 * text, not a second call to recommendWeekly.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const F = require('./public/forecast.js');
const R = require('./scripts/reconcile.js');
const live = require('./data.json');
const settlements = require('./docs/reconciliation/commitment-settlements.json');
const posting = require('./docs/reconciliation/posting-observations.json');
const cards = require('./docs/reconciliation/card-state-observations.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const money = n => '$' + Number(n).toFixed(2);
const hashFile = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const PAYDAY = '2026-08-14';
const AUG9 = '2026-08-09';
const NEXT_PAY = '2026-08-28';
const CAMP = 786;
const TRYOUTS = 140;
const HYDRO_SEP = 237.45;
const BUFFER = live.plan.defaults.targetBuffer;
const AMANDA = 'amanda-debt-payments';

function independentSpendable(plan) {
  return (plan.startingCash.breakdown || []).reduce((s, b) => s + Number(b.value || 0), 0);
}
function liveOpts() {
  return {
    scenario: 'expected', incomeOverrides: {}, disabled: [], extraDebtMonthly: 0,
    targetBuffer: BUFFER,
    fundingSources: live.plan.funding && live.plan.funding.options,
    debts: live.debts,
    extraFacilities: live.revolvingExtra,
    extraDebtTarget: live.plan.nextDollar && live.plan.nextDollar.target,
  };
}
function windowEnd(start) {
  return F.addDays(start, (live.plan.windowDays || 91) - 1);
}
function questionsMarkdown() {
  return fs.readFileSync(path.join(__dirname, 'docs', '01_OPEN_QUESTIONS.md'), 'utf8');
}
function questionStatus(md, id) {
  const re = new RegExp('### ' + id + '\\.[\\s\\S]*?\\*\\*Status:\\*\\*\\s*([^\\n]+)');
  const m = re.exec(md);
  return m ? m[1].trim() : null;
}

const camp = live.plan.commitments.find(c => c.id === 'fusioncamp');
const tryouts = live.plan.commitments.find(c => c.id === 'tryouts');
const hydroSep = (live.plan.bills || []).find(b => b.id === 'hydro-due-sep1');
const hydroNow = (live.plan.bills || []).find(b => b.id === 'hydro-due-now');
const opening = independentSpendable(live.plan);
const events9 = F.expandEvents(live.plan, AUG9, windowEnd(AUG9), {});
const events14 = F.expandEvents(live.plan, PAYDAY, windowEnd(PAYDAY), {});

console.log('=== A. settled Fusion commitments stop reserving future cash ===');
ok(camp && near(camp.amount, CAMP) && camp.settledOn === PAYDAY,
  'live fusioncamp row is retained with settledOn 2026-08-14');
ok(tryouts && near(tryouts.amount, TRYOUTS) && tryouts.settledOn === PAYDAY,
  'live tryouts row is retained with settledOn 2026-08-14');
ok(F.commitmentStatus(camp) === 'settled' && F.commitmentStatus(tryouts) === 'settled',
  'derived status is settled; the commitments were not deleted');
ok(events9.some(e => e.id === 'fusioncamp' && near(e.amount, -CAMP)),
  'independent: an Aug. 9 opening still reserves $786');
ok(events9.some(e => e.id === 'tryouts' && near(e.amount, -TRYOUTS)),
  'independent: an Aug. 9 opening still reserves $140');
ok(!events14.some(e => e.id === 'fusioncamp' || e.id === 'tryouts'),
  'an Aug. 14 Forecast emits no Fusion camp or tryouts cash event');
ok(['fusion-sep', 'fusion-oct', 'fusion-nov'].every(id => {
  const row = live.plan.commitments.find(c => c.id === id);
  return row && row.amount === 500 && !row.settledOn;
}), 'the three $500 Fusion instalments remain unsettled (Q23)');
ok((live.plan.actions || []).some(a => /Fusion camp/i.test(a.what) && a.status === 'done'),
  'the Fund the Fusion camp action is marked done, not deleted');

console.log('\n=== B. payroll represented in a post-pay opening does not replay ===');
{
  const payroll = live.plan.income.find(s => s.id === 'payroll');
  const dates = F.occurrences(payroll, PAYDAY, windowEnd(PAYDAY));
  ok(dates[0] === PAYDAY, 'independent occurrences: payroll is scheduled on Aug. 14');
  ok(!live.plan.opening, 'live plan has no opening.representedEvents — no post-pay cash observation exists');
  const livePay = events14.filter(e => e.id === 'payroll' && e.date === PAYDAY);
  ok(livePay.length === 1 && near(livePay[0].amount, payroll.amount),
    'without a matching post-pay opening, Aug. 14 payroll still fires once — not guessed represented');

  const cutover = {
    asOf: PAYDAY,
    representedEvents: [{ id: 'payroll', date: PAYDAY }],
  };
  const withCutover = Object.assign({}, live.plan, { opening: cutover });
  const cutEvents = F.expandEvents(withCutover, PAYDAY, windowEnd(PAYDAY), {});
  ok(!cutEvents.some(e => e.id === 'payroll' && e.date === PAYDAY),
    'the existing representedEvents mechanism still omits same-day payroll when named');
  ok(cutEvents.some(e => e.id === 'payroll' && e.date === NEXT_PAY),
    'the next payroll is not skipped by an opening-date cutover');
}

console.log('\n=== C. unposted mortgage still fires ===');
{
  const mortgage = live.plan.obligations.find(o => o.id === 'mortgage');
  const dates = F.occurrences(mortgage, PAYDAY, windowEnd(PAYDAY));
  ok(dates[0] === PAYDAY, 'independent occurrences: mortgage is scheduled on Aug. 14');
  const liveMort = events14.filter(e => e.id === 'mortgage' && e.date === PAYDAY);
  ok(liveMort.length === 1 && near(liveMort[0].amount, -mortgage.amount),
    'Aug. 14 mortgage still deducts — it was not on representedEvents');
}

console.log('\n=== D. unknown posting state is not guessed ===');
{
  const unknownIds = ['fit4less', 'bcaa', 'icbc', 'resp'];
  ok(unknownIds.every(id => posting.observations.some(o => o.eventId === id && o.unknown === true)),
    'Fit4Less / BCAA / ICBC / RESP remain unknown in posting observations');
  ok(unknownIds.every(id => events14.some(e => e.id === id)),
    'unknown items still appear on the Forecast schedule — not marked posted');
  ok(!live.plan.opening || !(live.plan.opening.representedEvents || []).some(e => unknownIds.includes(e.id)),
    'unknown posting was not written onto representedEvents');
}

console.log('\n=== E. unknown card pending is not converted to zero ===');
{
  const cash14 = cards.observations.find(o => o.observationId === 'card-cashback-pending-2026-08-14');
  const travel14 = cards.observations.find(o => o.observationId === 'card-travelvisa-pending-2026-08-14');
  ok(cash14 && cash14.unknown === true && cash14.amount == null,
    'Aug. 14 Cash Back pending observation is unknown, not $0');
  ok(travel14 && travel14.unknown === true && travel14.amount == null,
    'Aug. 14 Travel Visa pending observation is unknown, not $0');
  const cashback = live.debts.find(d => d.id === 'cashback');
  const travel = live.debts.find(d => d.id === 'travelvisa');
  ok(cashback && cashback.pending === 0,
    'live Cash Back pending remains the 9 Aug known-zero, not overwritten by later unknown');
  ok(travel && near(travel.pending, 165.13),
    'live Travel Visa pending remains the 9 Aug $165.13, not coerced to $0');
  const recon = R.reconcile({
    data: live,
    map: { mappings: [] },
    observations: [],
    settlements: { observations: [] },
    utility: { observations: [] },
    amanda: { observations: [] },
    cards,
    posting: { observations: [] },
  });
  const cashRow = recon.rows.find(r => r.observationId === 'card-cashback-pending-2026-08-14');
  const travelRow = recon.rows.find(r => r.observationId === 'card-travelvisa-pending-2026-08-14');
  ok(cashRow && cashRow.unknown === true && cashRow.status !== 'MATCH',
    'reconciler does not treat Aug. 14 unknown pending as matching a $0 canonical pending');
  ok(travelRow && travelRow.unknown === true,
    'Travel Visa Aug. 14 unknown pending stays unknown');
}

console.log('\n=== F. held-elsewhere money is not automatically spendable joint cash ===');
{
  const held = (live.plan.startingCash.heldElsewhere || []).find(r => r.id === AMANDA);
  ok(held && held.value > 0, 'Amanda / DEBT&PAYMENTS remains on heldElsewhere');
  ok(!near(F.startingCashAmount(live.plan), independentSpendable(live.plan) + held.value),
    'held-elsewhere is not inside Forecast opening cash');
  ok(near(F.startingCashAmount(live.plan), opening),
    'opening cash is the spendable breakdown only', money(opening));
  ok(hydroSep && hydroSep.payingAccount === AMANDA && hydroSep.householdObligation === true,
    'Hydro Sept. 1 is a household obligation paid from Amanda');
  const hydroEv = events14.find(e => e.id === 'hydro-due-sep1');
  ok(hydroEv && hydroEv.jointCash === false && near(hydroEv.amount, -HYDRO_SEP),
    'Hydro Sept. 1 is on the schedule and does not reduce joint cash');
  const zero = F.simulate(live.plan, PAYDAY, { weeklyVariable: 0, targetBuffer: BUFFER });
  const withoutHydro = Object.assign({}, live.plan, {
    bills: (live.plan.bills || []).filter(b => b.id !== 'hydro-due-sep1'),
  });
  const zeroNoHydro = F.simulate(withoutHydro, PAYDAY, { weeklyVariable: 0, targetBuffer: BUFFER });
  ok(near(zero.ending, zeroNoHydro.ending),
    'removing Hydro Sept. 1 does not change joint-cash ending — independent of recommend');
}

console.log('\n=== G. Q19 remains unresolved and is not silent zero cash impact ===');
{
  const heloc = live.plan.obligations.find(o => o.id === 'heloc');
  ok(heloc && heloc.nonCash === true && near(heloc.amount, 814.18),
    'live HELOC remains month-end non-cash capitalisation');
  const helocCash = events14.filter(e => e.id === 'heloc' && e.kind !== 'noncash');
  ok(helocCash.length === 0, 'no HELOC chequing outflow was invented');
  const helocNoncash = events14.filter(e => e.id === 'heloc' && e.kind === 'noncash');
  ok(helocNoncash.length >= 1 && helocNoncash.every(e => e.kind === 'noncash'),
    'HELOC events that exist are noncash, not a claimed $0 payment');
  const md = questionsMarkdown();
  ok(/^OPEN\b/.test(questionStatus(md, 'Q19')),
    'Q19 remains OPEN in docs/01_OPEN_QUESTIONS.md', questionStatus(md, 'Q19'));
  ok(/must not claim confident zero household\s+cash impact/i.test(md),
    'the open question still forbids claiming confident zero cash impact');
}

console.log('\n=== H. existing Forecast produces payday outputs after cutover ===');
{
  const rec9 = F.recommend(live.plan, AUG9, liveOpts());
  const rec14 = F.recommend(live.plan, PAYDAY, liveOpts());
  ok(rec9.weekly === 1085 && rec9.mode === 'openingGap' && near(rec9.gap.amount, 1043.16),
    'published Aug. 9 as-of still yields weekly $1,085 and the 12 Aug gap — Fusion settledOn is later');
  ok(near(opening, 79.84),
    'independent spendable opening is still the 9 Aug $79.84 snapshot', money(opening));
  ok(opening + 0.005 < BUFFER,
    'that opening is below the $500 floor, so an Aug. 14 start is an opening gap');
  const independentGap = Math.round((BUFFER - opening) * 100) / 100;
  ok(rec14.mode === 'openingGap' && near(rec14.gap.amount, independentGap) && rec14.weekly === 0,
    'Aug. 14 Forecast weekly is $0 because stale opening is below the floor, not because $0 is policy',
    `${rec14.mode} gap ${rec14.gap && rec14.gap.amount} weekly ${rec14.weekly}`);
  ok(near(rec14.sim.min.balance, opening) && rec14.sim.min.date === PAYDAY,
    'lowest projected cash at Aug. 14 as-of is the stale opening itself');
  ok(rec14.sim.buffer === BUFFER, 'protected cash floor remains $500');

  const onPay = events14.filter(e => e.date === PAYDAY && e.amount < 0
    && e.kind !== 'noncash' && e.jointCash !== false);
  const onPaySum = onPay.reduce((s, e) => s + (-e.amount), 0);
  ok(onPay.some(e => e.id === 'mortgage') && onPay.some(e => e.id === 'shaw'),
    'payday joint-cash outflows still include unposted mortgage and Shaw');
  const beforeNext = events14.filter(e => e.date > PAYDAY && e.date < NEXT_PAY
    && e.amount < 0 && e.kind !== 'noncash' && e.jointCash !== false);
  const beforeIds = beforeNext.map(e => e.id).sort().join(',');
  ok(beforeIds === 'bcaa,icbc,resp,tdcc,travel,uniondues',
    'joint-cash obligations after payday and before 28 Aug are the plan-row set', beforeIds);
  ok(!beforeNext.some(e => e.id === 'fusioncamp' || e.id === 'tryouts'),
    'settled Fusion is not in the before-next-payday list');

  ok(rec14.nearBoundary.payday === PAYDAY && rec14.nearBoundary.until === '2026-08-15',
    'near-boundary window is 14–15 Aug from an Aug. 14 start');
  ok(near(rec14.nearBoundary.total, 1997.81),
    'near-boundary total remains the independent $1,997.81 payday cluster');
  ok(!/\$600\s*\/\s*week/.test(JSON.stringify(rec14)) && rec14.weekly !== 600,
    '$600/week is not encoded as the payday output');
  ok(typeof rec14.sim.ending === 'number' && rec14.sim.ending > opening,
    'ending cash is produced by existing Forecast', money(rec14.sim.ending));
  ok(onPaySum > 0, 'payday joint-cash outflows were independently summed', money(onPaySum));
}

console.log('\n=== I. no second forecast/budget engine was introduced ===');
{
  const forecastSrc = fs.readFileSync(path.join(__dirname, 'public', 'forecast.js'), 'utf8');
  const reconSrc = fs.readFileSync(path.join(__dirname, 'scripts', 'reconcile.js'), 'utf8');
  ok(/function expandEvents\(plan, start, end, opts\)/.test(forecastSrc),
    'expandEvents remains the Plan schedule expander');
  ok(/function recommend\(plan, asOf, opts\)/.test(forecastSrc),
    'recommend remains the weekly-cap authority');
  ok(!/function paydayEngine|function budgetEngine|function secondForecast/.test(forecastSrc + reconSrc),
    'no second payday or budget engine was added');
  ok(!fs.existsSync(path.join(__dirname, 'public', 'payday.js')),
    'no public/payday.js engine file exists');
  ok(reconSrc.indexOf('NEVER writes data.json') >= 0,
    'reconciler still states it never writes data.json');
}

console.log('\n=== J. observation files remain evidence, not competing canonical state ===');
{
  const before = hashFile(path.join(__dirname, 'data.json'));
  const result = R.reconcile({
    data: live,
    map: require('./docs/reconciliation/balance-map.json'),
    observations: [],
    settlements,
    utility: require('./docs/reconciliation/utility-observations.json'),
    amanda: require('./docs/reconciliation/amanda-income-observations.json'),
    cards,
    posting,
  });
  ok(result.writesCanonicalState === false, 'reconcile result declares no write');
  const campRow = result.rows.find(r => r.observationId === 'payday-fusioncamp-settled');
  const tryRow = result.rows.find(r => r.observationId === 'payday-tryouts-settled');
  const sepRow = result.rows.find(r => r.observationId === 'payday-hydro-due-sep1');
  const nowRow = result.rows.find(r => r.observationId === 'payday-hydro-due-now');
  const payRow = result.rows.find(r => r.observationId === 'payday-payroll-posted');
  const mortRow = result.rows.find(r => r.observationId === 'payday-mortgage-unposted');
  ok(campRow && campRow.status === 'MATCH', 'Fusion camp observation is MATCH against canonical settledOn');
  ok(tryRow && tryRow.status === 'MATCH', 'Fusion tryouts observation is MATCH against canonical settledOn');
  ok(sepRow && sepRow.status === 'MATCH', 'Hydro 1 September observation is MATCH against the live bill');
  ok(sepRow.dueDate === '2026-09-01' && sepRow.observedAsOf === PAYDAY
    && sepRow.evidenceDate === PAYDAY,
    'Sept. 1 remains the due date; observation time is 14 Aug');
  ok(sepRow.dateRelation === 'incomparable',
    'Hydro MATCH is not canonical-older merely because the due date is after 9 Aug');
  ok(nowRow && nowRow.status === 'MISSING', 'Hydro 14 August due remains MISSING — not guessed');
  ok(payRow && payRow.status === 'CHANGE',
    'posted payroll vs missing representedEvents is still CHANGE — opening cash was not invented');
  ok(mortRow && mortRow.status === 'MATCH', 'unposted mortgage remains correctly unrepresented');
  ok(result.staleAssigned === false && result.counts.STALE === 0,
    'STALE is still not assigned');
  const cardPending14 = result.rows.find(r => r.observationId === 'card-cashback-pending-2026-08-14');
  const cardPosted9 = result.rows.find(r => r.observationId === 'card-cashback-posted-2026-08-09'
    || (r.fact === 'posted-balance' && r.cardId === 'cashback' && r.evidenceDate === AUG9));
  ok(cardPending14 && cardPending14.dateRelation === 'canonical-older',
    'Aug. 14 card pending still reports canonical-older than as-of 9 Aug');
  ok(cardPosted9 && cardPosted9.dateRelation === 'same-day',
    '9 Aug card posted-balance still reports same-day');
  ok(result.dateRelationCounts && result.dateRelationCounts['canonical-older'] > 0,
    'comparable Aug. 14 snapshot evidence is still reported as canonical-older than as-of 9 Aug');
  const out = execFileSync(process.execPath, ['scripts/reconcile.js'], {
    cwd: __dirname, encoding: 'utf8',
  });
  ok(hashFile(path.join(__dirname, 'data.json')) === before,
    'running the CLI leaves data.json bytes unchanged');
  ok(/Owner-approved canonical edits remain a separate explicit action/.test(out),
    'the report still says observation files do not write canonical state');
  ok(!hydroNow, 'no hydro-due-now canonical row was manufactured');
}

console.log('\n=== remaining owner questions stay open ===');
{
  const md = questionsMarkdown();
  ok(/^ANSWERED\b/.test(questionStatus(md, 'Q0')), 'Q0 HOME BUDGET is ANSWERED — workbooks classified, policy unchanged');
  ok(/^OPEN\b/.test(questionStatus(md, 'Q17')), 'Q17 Hydro 14 August due remains OPEN');
  ok(/^OPEN\b/.test(questionStatus(md, 'Q19')), 'Q19 HELOC remains OPEN');
  ok(/^OPEN\b/.test(questionStatus(md, 'Q23')), 'Q23 Fusion instalments remain OPEN');
  ok(/^OPEN\b/.test(questionStatus(md, 'Q25')), 'Q25 Amanda available remainder remains OPEN');
  ok(/^OPEN\b/.test(questionStatus(md, 'Q26')), 'Q26 card pending remains OPEN');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
