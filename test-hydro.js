'use strict';
/* B91 D4+D5 — dated household obligation vs account balance / paying account.
 *
 * Acceptance corpus: docs/source_intake/PAYDAY_ACCEPTANCE_2026-08-14.md
 * Live Hydro canonical state is unchanged. This suite proves the mechanism
 * on synthetic fixtures plus the preserved Aug. 14 observations.
 *
 * Independent proof: hand arithmetic on the named dated amounts and the
 * paying-account / breakdown membership rule. That is not a second call
 * to expandEvents or simulate.
 */
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const F = require('./public/forecast.js');
const R = require('./scripts/reconcile.js');
const live = require('./data.json');
const utility = require('./docs/reconciliation/utility-observations.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const money = n => '$' + Number(n).toFixed(2);
const clone = x => JSON.parse(JSON.stringify(x));
const hashFile = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const START = '2026-08-14';
const END = F.addDays(START, 27);
const OPENING = 2000;
const BALANCE = 451.24;
const DUE_NOW = 213.79;
const DUE_SEP = 237.45;
const DUE_NOW_DATE = '2026-08-14';
const DUE_SEP_DATE = '2026-09-01';
const AMANDA = 'amanda-debt-payments';
const JOINT = 'chequing-a';

function hydroBills(extra) {
  return [
    {
      id: 'hydro-due-now',
      label: 'BC Hydro current due',
      frequency: 'once',
      date: DUE_NOW_DATE,
      amount: DUE_NOW,
      confidence: 'confirmed',
      budgetCategory: null,
      householdObligation: true,
      payingAccount: AMANDA,
    },
    {
      id: 'hydro-due-sep1',
      label: 'BC Hydro due 1 September',
      frequency: 'once',
      date: DUE_SEP_DATE,
      amount: DUE_SEP,
      confidence: 'confirmed',
      budgetCategory: null,
      householdObligation: true,
      payingAccount: AMANDA,
    },
  ].map(b => Object.assign({}, b, extra || {}));
}

function fixture(billExtra) {
  return {
    windowDays: 28,
    defaults: { targetBuffer: 0 },
    startingCash: {
      breakdown: [{ id: JOINT, value: OPENING }],
      heldElsewhere: [{ id: AMANDA, value: 798.37 }],
    },
    income: [],
    obligations: [],
    bills: hydroBills(billExtra),
    commitments: [],
  };
}

function independentlyJoint(bill, plan) {
  if (!bill || bill.householdObligation === false) return false;
  if (!bill.payingAccount) return true;
  return ((plan.startingCash || {}).breakdown || [])
    .some(r => r.id === bill.payingAccount);
}

function independentJointCash(plan, start, end) {
  return (plan.bills || [])
    .filter(b => independentlyJoint(b, plan))
    .filter(b => b.frequency === 'once' && b.date >= start && b.date <= end)
    .reduce((s, b) => s + Number(b.amount || 0), 0);
}

function independentObligations(plan, start, end) {
  return (plan.bills || [])
    .filter(b => b.householdObligation !== false)
    .filter(b => b.frequency === 'once' && b.date >= start && b.date <= end)
    .map(b => ({ id: b.id, amount: Number(b.amount), date: b.date }));
}

console.log('=== independent dated-due identity ===');
ok(near(DUE_NOW + DUE_SEP, BALANCE),
  'independent: $213.79 + $237.45 = $451.24',
  money(DUE_NOW + DUE_SEP));
ok(DUE_NOW_DATE === START, 'current due is dated as-of the Aug. 14 observation');
ok(DUE_SEP_DATE > START && DUE_SEP_DATE <= END,
  'Sep. 1 due falls later in the 28-day window');

console.log('\n=== A. $451.24 account balance does not create a cash event ===');
{
  const plan = fixture();
  ok(!plan.bills.some(b => near(b.amount, BALANCE)),
    'fixture has no $451.24 bill row');
  const events = F.expandEvents(plan, START, END, {});
  ok(!events.some(e => near(Math.abs(e.amount), BALANCE)),
    'expandEvents emits no $451.24 cash event');
  const sim = F.simulate(plan, START, { weeklyVariable: 0 });
  ok(!sim.events.some(e => near(Math.abs(e.amount), BALANCE)),
    'simulate stream has no $451.24 event');
}

console.log('\n=== B. $213.79 current due creates exactly one $213.79 obligation ===');
{
  const plan = fixture();
  const independent = independentObligations(plan, START, END)
    .filter(o => o.id === 'hydro-due-now');
  ok(independent.length === 1 && near(independent[0].amount, DUE_NOW)
    && independent[0].date === DUE_NOW_DATE,
    'independent walk: exactly one $213.79 due 2026-08-14');
  const events = F.expandEvents(plan, START, END, {});
  const due = events.filter(e => e.id === 'hydro-due-now');
  ok(due.length === 1 && near(due[0].amount, -DUE_NOW) && due[0].date === DUE_NOW_DATE,
    'expandEvents emits exactly one −$213.79 current-due event');
  ok(due[0].householdObligation === true && due[0].kind === 'bill',
    'current due is a household-obligation bill event');
}

console.log('\n=== C. $237.45 due 2026-09-01 creates exactly one later obligation ===');
{
  const plan = fixture();
  const independent = independentObligations(plan, START, END)
    .filter(o => o.id === 'hydro-due-sep1');
  ok(independent.length === 1 && near(independent[0].amount, DUE_SEP)
    && independent[0].date === DUE_SEP_DATE,
    'independent walk: exactly one $237.45 due 2026-09-01');
  const events = F.expandEvents(plan, START, END, {});
  const due = events.filter(e => e.id === 'hydro-due-sep1');
  ok(due.length === 1 && near(due[0].amount, -DUE_SEP) && due[0].date === DUE_SEP_DATE,
    'expandEvents emits exactly one −$237.45 Sep. 1 event');
}

console.log('\n=== D. dated obligations total $451.24 without scheduling the balance ===');
{
  const plan = fixture();
  const independent = independentObligations(plan, START, END);
  const independentSum = independent.reduce((s, o) => s + o.amount, 0);
  ok(independent.length === 2 && near(independentSum, BALANCE),
    'independent: two dated obligations sum to $451.24');
  const events = F.expandEvents(plan, START, END, {});
  const hydro = events.filter(e => /^hydro-/.test(e.id));
  const hydroSum = hydro.reduce((s, e) => s + -e.amount, 0);
  ok(hydro.length === 2 && near(hydroSum, BALANCE),
    'expandEvents: two Hydro events sum to $451.24', money(hydroSum));
  ok(!plan.bills.some(b => near(b.amount, BALANCE)),
    'the account balance is not a third scheduled row');
}

console.log('\n=== E. paying-account metadata does not erase household obligation ===');
{
  const plan = fixture();
  ok(plan.bills.every(b => F.billIsHouseholdObligation(b)),
    'Forecast helper: both Hydro bills are household obligations');
  ok(plan.bills.every(b => b.payingAccount === AMANDA),
    'both bills name Amanda / DEBT&PAYMENTS as paying account');
  const events = F.expandEvents(plan, START, END, {});
  ok(events.filter(e => /^hydro-/.test(e.id)).length === 2,
    'externally paid Hydro still appears on the expandEvents schedule');
  ok(events.filter(e => /^hydro-/.test(e.id)).every(e => e.householdObligation === true),
    'paying-account metadata left householdObligation true');

  const erased = fixture({ householdObligation: false });
  ok(erased.bills.every(b => b.payingAccount === AMANDA),
    'counterfactual still names the same paying account');
  ok(erased.bills.every(b => !F.billIsHouseholdObligation(b)),
    'only an explicit householdObligation: false drops the obligation');
  ok(F.expandEvents(erased, START, END, {}).filter(e => /^hydro-/.test(e.id)).length === 0,
    'the obligation disappears only when that separate field is false');
}

console.log('\n=== F. no duplicate Hydro amount when account-state and dues are both present ===');
{
  const plan = fixture();
  const events = F.expandEvents(plan, START, END, {});
  ok(events.filter(e => /^hydro-/.test(e.id)).length === 2,
    'account-state evidence does not add a third Hydro event');
  const result = R.reconcile({
    data: { meta: { asOf: START }, plan },
    map: { mappings: [] },
    observations: [],
    settlements: { observations: [] },
    utility,
  });
  const balanceRow = result.rows.find(r => r.observationId === 'payday-hydro-account-balance');
  const nowRow = result.rows.find(r => r.observationId === 'payday-hydro-due-now');
  const sepRow = result.rows.find(r => r.observationId === 'payday-hydro-due-sep1');
  ok(balanceRow && balanceRow.fact === 'account-balance'
    && balanceRow.status === 'MATCH' && balanceRow.scheduled === false,
    'account balance is informational / not scheduled');
  ok(nowRow && nowRow.fact === 'dated-due' && nowRow.status === 'MATCH'
    && near(nowRow.evidenceValue, DUE_NOW),
    'current due matches the modelled $213.79 bill');
  ok(sepRow && sepRow.fact === 'dated-due' && sepRow.status === 'MATCH'
    && near(sepRow.evidenceValue, DUE_SEP),
    'Sep. 1 due matches the modelled $237.45 bill');

  const conflicted = fixture();
  conflicted.bills.push({
    id: 'hydro-account-balance',
    label: 'BC Hydro account balance (wrong)',
    frequency: 'once',
    date: START,
    amount: BALANCE,
    confidence: 'confirmed',
    householdObligation: true,
    payingAccount: AMANDA,
  });
  const bad = R.reconcile({
    data: { meta: { asOf: START }, plan: conflicted },
    map: { mappings: [] },
    observations: [],
    settlements: { observations: [] },
    utility,
  });
  const badBalance = bad.rows.find(r => r.observationId === 'payday-hydro-account-balance');
  ok(badBalance && badBalance.status === 'CONFLICT' && badBalance.scheduled === true,
    'scheduling the $451.24 account balance is CONFLICT');
}

console.log('\n=== joint-cash treatment: externally paid Hydro is not deducted ===');
{
  const plan = fixture();
  ok(F.startingCashAmount(plan) === OPENING,
    'held-elsewhere $798.37 is not joint spendable cash',
    money(F.startingCashAmount(plan)));
  ok(plan.bills.every(b => F.billAffectsJointCash(b, plan) === false),
    'independent Forecast helper: Amanda-paid Hydro is not joint cash');
  ok(near(independentJointCash(plan, START, END), 0),
    'independent walk: joint-cash Hydro total is $0');

  const events = F.expandEvents(plan, START, END, {});
  ok(events.filter(e => /^hydro-/.test(e.id)).every(e => e.jointCash === false),
    'expandEvents tags both Hydro events jointCash: false');
  const sim = F.simulate(plan, START, { weeklyVariable: 0 });
  ok(near(sim.ending, OPENING),
    'simulate ending is still the $2,000 opening — Hydro is not deducted',
    money(sim.ending));
  ok(near(sim.totals.bills, 0),
    'week.bills cash total does not include the external Hydro');
  ok(sim.events.filter(e => /^hydro-/.test(e.id)).length === 2,
    'Hydro remains visible on the simulate event list');

  const nextPay = F.nextPaymentOut(sim.events, START);
  ok(!nextPay,
    'nextPaymentOut ignores externally paid Hydro — no joint-cash outflow');
  const nextDue = F.nextDue(sim.events, START);
  ok(nextDue && nextDue.what === 'BC Hydro current due' && near(nextDue.amount, DUE_NOW),
    'nextDue still names the household obligation', nextDue && nextDue.what);

  const asJoint = fixture({ payingAccount: JOINT });
  ok(asJoint.bills.every(b => F.billAffectsJointCash(b, asJoint) === true),
    'same bills paid from Chequing A would affect joint cash');
  const jointSim = F.simulate(asJoint, START, { weeklyVariable: 0 });
  ok(near(jointSim.ending, OPENING - BALANCE),
    'counterfactual: joint-paid Hydro would deduct $451.24',
    money(jointSim.ending));
  ok(near(independentJointCash(asJoint, START, END), BALANCE),
    'independent walk agrees the joint-paid total is $451.24');
}

console.log('\n=== G. reconciliation remains non-writing ===');
{
  const before = hashFile(R.DEFAULT_DATA);
  const liveHydro = (live.plan.bills || []).filter(b => /hydro/i.test(b.id + b.label));
  ok(liveHydro.length === 0, 'live plan.bills still has no Hydro row');

  const result = R.reconcile({
    data: live,
    map: { mappings: [] },
    observations: [],
    settlements: { observations: [] },
    utility,
  });
  ok(result.writesCanonicalState === false, 'reconcile result declares no write');
  const balanceRow = result.rows.find(r => r.observationId === 'payday-hydro-account-balance');
  const nowRow = result.rows.find(r => r.observationId === 'payday-hydro-due-now');
  const sepRow = result.rows.find(r => r.observationId === 'payday-hydro-due-sep1');
  const payRow = result.rows.find(r => r.observationId === 'payday-hydro-paying-account');
  ok(balanceRow && balanceRow.status === 'MATCH'
    && /informational/.test(balanceRow.note || ''),
    'live account balance is informational / not scheduled');
  ok(nowRow && nowRow.status === 'MISSING',
    'live current due is canonical missing/change');
  ok(sepRow && sepRow.status === 'MISSING',
    'live Sep. 1 due is canonical missing/change');
  ok(payRow && payRow.status === 'MISSING'
    && payRow.jointCashPool === false
    && payRow.payingAccountLabel === 'Amanda / DEBT&PAYMENTS',
    'live paying account is Amanda / external-to-joint-pool and canonical-missing');

  const after = hashFile(R.DEFAULT_DATA);
  ok(before === after, 'calling reconcile() does not change data.json');

  const cliBefore = hashFile(R.DEFAULT_DATA);
  const out = execFileSync(process.execPath, ['scripts/reconcile.js'], {
    cwd: __dirname,
    encoding: 'utf8',
  });
  ok(/does not write data\.json/.test(out),
    'CLI report repeats the no-write contract');
  ok(/informational \/ not scheduled amount/.test(out),
    'CLI distinguishes the account balance as informational');
  ok(/canonical missing\/change/.test(out),
    'CLI distinguishes dated dues as canonical missing/change');
  ok(/Amanda \/ external-to-joint-pool/.test(out),
    'CLI distinguishes the paying account as external-to-joint-pool');
  ok(hashFile(R.DEFAULT_DATA) === cliBefore,
    'CLI reconcile does not write data.json');
}

console.log('\n=== H. Forecast.expandEvents remains the schedule authority ===');
{
  const src = fs.readFileSync(require('path').join(__dirname, 'public', 'forecast.js'), 'utf8');
  ok(/function expandEvents\(plan, start, end, opts\)/.test(src),
    'expandEvents is still the Plan schedule expander');
  ok(/billAffectsJointCash\(b, plan\)/.test(src)
    && /if \(!billIsHouseholdObligation\(b\)\) continue;/.test(src),
    'Hydro semantics are applied inside expandEvents, not a second calendar');
  ok(!/function expandHydro|hydroCalendar|utilityLedger/.test(src),
    'no second Hydro expander, calendar, or ledger was added');
  const ics = fs.readFileSync(require('path').join(__dirname, 'scripts', 'calendar-ics.js'), 'utf8');
  ok(/Forecast\.expandEvents/.test(ics),
    'the household calendar still derives from Forecast.expandEvents');
}

console.log('\n=== live Fusion / Amanda / HELOC / card surfaces untouched ===');
{
  const camp = live.plan.commitments.find(c => c.id === 'fusioncamp');
  const tryouts = live.plan.commitments.find(c => c.id === 'tryouts');
  const instalments = (live.plan.commitments || [])
    .filter(c => /fusion/i.test(c.id + c.label) && near(c.amount, 500));
  ok(camp && near(camp.amount, 786) && !camp.settledOn,
    'live Fusion camp is still the unsettled $786 row');
  ok(tryouts && near(tryouts.amount, 140) && !tryouts.settledOn,
    'live Fusion tryouts are still the unsettled $140 row');
  ok(instalments.length === 3,
    'the three $500 Fusion season instalments are untouched',
    String(instalments.length));
  const amanda = live.plan.income.find(s => s.id === 'amandaTransfer');
  ok(amanda && amanda.scenarioMonthly && amanda.scenarioMonthly.expected === 2182,
    'Amanda income authority is untouched');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
