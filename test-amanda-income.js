'use strict';
/* B91 D2 — Amanda salary vs coaching/business vs household transfers.
 *
 * Acceptance corpus: docs/source_intake/PAYDAY_ACCEPTANCE_2026-08-14.md
 * Live amandaTransfer / DEBT&PAYMENTS / Hydro / Fusion / HELOC / cards stay
 * unchanged. This suite proves the semantic split on classified movements
 * plus existing Forecast.expandEvents. It is not a second income engine.
 *
 * Independent proof: hand addition of named classified amounts. That is
 * not a second call to expandEvents or simulate.
 */
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const F = require('./public/forecast.js');
const R = require('./scripts/reconcile.js');
const live = require('./data.json');
const amanda = require('./docs/reconciliation/amanda-income-observations.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const money = n => '$' + Number(n).toFixed(2);
const hashFile = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const START = '2026-08-14';
const END = F.addDays(START, 27);
const OPENING = 2000;
const SALARY = 2168.85;
const MONTH_END = 2387.99;
const TRANSFER = 2168.85;
const WRONG = 4337.70;
const COACHING = 4000;
const KNOWN_OBLIGATION = 300;
const KNOWN_COACHING = 400;
const SESSION_BALANCE = 798.37;
const AMANDA = 'amanda-debt-payments';
const JOINT = 'chequing-b';

function emptySide() {
  return { observations: [] };
}

function cashFixture(income, extraCash) {
  return Object.assign({
    windowDays: 28,
    defaults: { targetBuffer: 0 },
    startingCash: {
      breakdown: [{ id: JOINT, value: OPENING, class: 'spendable' }],
      heldElsewhere: [{ id: AMANDA, value: SESSION_BALANCE, class: 'operational' }],
    },
    income: income || [],
    obligations: [],
    bills: [],
    commitments: [],
  }, extraCash || {});
}

function transferStream(amount) {
  return {
    id: 'amandaTransfer',
    label: "Amanda's transfers to the household",
    frequency: 'once',
    date: START,
    amount: amount,
    confidence: 'estimated',
  };
}

function salaryStream(amount) {
  return {
    id: 'amandaSalary',
    label: 'Tennis BC salary',
    frequency: 'once',
    date: START,
    amount: amount,
    confidence: 'estimated',
  };
}

function incomeSum(plan) {
  return F.expandEvents(plan, START, END, {})
    .filter(e => e.kind === 'income')
    .reduce((s, e) => s + Number(e.amount), 0);
}

function runAmanda(plan, extraObs) {
  return R.reconcile({
    data: { meta: { asOf: START }, plan },
    map: { mappings: [] },
    observations: [],
    settlements: emptySide(),
    utility: emptySide(),
    amandaObservations: extraObs || R.observationsFromAmanda(amanda),
  });
}

console.log('=== independent classified-movement identity ===');
ok(near(SALARY + TRANSFER, WRONG),
  'independent: $2,168.85 + $2,168.85 = $4,337.70',
  money(SALARY + TRANSFER));
ok(near(SALARY + KNOWN_COACHING - KNOWN_OBLIGATION, 2268.85),
  'independent: known remainder is $2,168.85 + $400 − $300 = $2,268.85');

console.log('\n=== 1. salary + transfer is not $4,337.70 household income ===');
{
  const movements = [
    { fact: 'employment-deposit', amount: SALARY },
    { fact: 'household-transfer', amount: TRANSFER },
  ];
  const classified = R.householdCashFromAmandaMovements(movements);
  ok(near(classified, TRANSFER),
    'classified household-cash inflow is the transfer only',
    money(classified));
  ok(!near(classified, WRONG),
    'classified household-cash inflow is not the naive $4,337.70 sum');
  ok(near(R.classifyAmandaMovement(movements[0]).amandaOperatingIncome, SALARY)
    && near(R.classifyAmandaMovement(movements[0]).householdCashInflow, 0),
    'salary is Amanda operating income, not household cash');

  const plan = cashFixture([transferStream(TRANSFER)]);
  ok(near(incomeSum(plan), TRANSFER),
    'Forecast.expandEvents on transfer-only plan emits $2,168.85',
    money(incomeSum(plan)));

  const both = cashFixture([transferStream(TRANSFER), salaryStream(SALARY)]);
  ok(near(incomeSum(both), WRONG),
    'Forecast WOULD emit $4,337.70 if both streams were live — that is the defect',
    money(incomeSum(both)));
  ok(R.forecastHasAmandaDoubleCount({ plan: both }),
    'double-count detector fires when salary sits beside amandaTransfer');
  ok(!R.forecastHasAmandaDoubleCount({ plan }),
    'transfer-only plan is not a double-count');

  const liveLike = cashFixture([
    {
      id: 'amandaTransfer',
      label: "Amanda's transfers to the household",
      frequency: 'monthly',
      day: 20,
      scenarioMonthly: { conservative: 930, expected: 2182, optimistic: 2400 },
      confidence: 'estimated',
    },
  ]);
  const okRows = runAmanda(liveLike);
  const salaryRows = okRows.rows.filter(r => r.fact === 'employment-deposit');
  ok(salaryRows.length === 2 && salaryRows.every(r => r.status === 'MATCH')
    && salaryRows.every(r => r.intentionallyNotCanonical)
    && salaryRows.every(r => r.representation === 'indirect-via-amandaTransfer'),
    'observed salary is represented indirectly via amandaTransfer, not as Forecast income');
  const badRows = runAmanda(both);
  ok(badRows.rows.filter(r => r.fact === 'employment-deposit').every(r => r.status === 'CONFLICT')
    && badRows.rows.filter(r => r.fact === 'employment-deposit').every(r => r.doubleCount),
    'adding Tennis BC salary beside amandaTransfer is CONFLICT');
}

console.log('\n=== 2. internal Amanda transfer creates $0 new income ===');
{
  const movements = [{
    fact: 'internal-transfer',
    amount: 500,
    from: AMANDA,
    to: 'amanda-other',
  }];
  ok(near(R.householdCashFromAmandaMovements(movements), 0),
    'classified household-cash inflow is $0');
  ok(near(R.classifyAmandaMovement(movements[0]).newIncome, 0)
    && near(R.classifyAmandaMovement(movements[0]).amandaOperatingIncome, 0),
    'internal movement creates $0 new income of any kind');
  const plan = cashFixture([]);
  ok(near(incomeSum(plan), 0),
    'Forecast.expandEvents with no income stream emits $0');
  const row = runAmanda(plan, [{
    observationId: 'synthetic-internal',
    fact: 'internal-transfer',
    evidenceValue: 500,
    evidenceDate: START,
  }]).rows.find(r => r.fact === 'internal-transfer');
  ok(row && row.status === 'MATCH' && near(row.canonicalValue, 0),
    'reconciler reports internal transfer as $0 new income');

  const labelled = cashFixture([{
    id: 'amanda-to-amanda',
    label: 'Internal Amanda transfer',
    frequency: 'once',
    date: START,
    amount: 500,
    confidence: 'estimated',
  }]);
  ok(near(incomeSum(labelled), 500),
    'Forecast WOULD count a labelled internal-transfer stream — that is the defect');
  const bad = runAmanda(labelled, [{
    observationId: 'synthetic-internal',
    fact: 'internal-transfer',
    evidenceValue: 500,
    evidenceDate: START,
  }]).rows.find(r => r.fact === 'internal-transfer');
  ok(bad && bad.status === 'CONFLICT',
    'an internal transfer modelled as Forecast income is CONFLICT');
}

console.log('\n=== 3. Amanda→joint transfer creates joint-cash inflow once ===');
{
  const movements = [{ fact: 'household-transfer', amount: TRANSFER }];
  ok(near(R.householdCashFromAmandaMovements(movements), TRANSFER),
    'classified household-cash inflow is $2,168.85 once');
  const plan = cashFixture([transferStream(TRANSFER)]);
  const events = F.expandEvents(plan, START, END, {})
    .filter(e => e.id === 'amandaTransfer');
  ok(events.length === 1 && near(events[0].amount, TRANSFER),
    'Forecast.expandEvents emits exactly one amandaTransfer inflow');
  const sim = F.simulate(plan, START, { weeklyVariable: 0 });
  ok(near(sim.ending, OPENING + TRANSFER),
    'simulate ending rises by the transfer once',
    money(sim.ending));
  ok(near(sim.totals.income, TRANSFER),
    'simulate income total is the transfer once');
}

console.log('\n=== 4. coaching/business revenue alone is $0 household cash ===');
{
  const movements = [{ fact: 'coaching-receipt', amount: COACHING }];
  ok(near(R.householdCashFromAmandaMovements(movements), 0),
    'classified household-cash inflow from coaching is $0');
  ok(near(R.classifyAmandaMovement(movements[0]).coachingInflow, COACHING)
    && near(R.classifyAmandaMovement(movements[0]).householdCashInflow, 0),
    'coaching is a business inflow, not household income');
  const plan = cashFixture([]);
  ok(near(incomeSum(plan), 0),
    'Forecast.expandEvents does not invent a coaching income event');
  const liveLike = cashFixture([{
    id: 'amandaTransfer',
    label: "Amanda's transfers to the household",
    frequency: 'monthly',
    day: 20,
    scenarioMonthly: { conservative: 930, expected: 2182, optimistic: 2400 },
    confidence: 'estimated',
  }]);
  const row = runAmanda(liveLike).rows.find(r => r.fact === 'coaching-receipt');
  ok(row && row.status === 'MATCH' && row.unknown && row.representation === 'business-inflow',
    'unresolved coaching receipt is correctly not Forecast household income');

  const asIncome = cashFixture([{
    id: 'coaching',
    label: 'Coaching revenue',
    frequency: 'once',
    date: START,
    amount: COACHING,
    confidence: 'estimated',
  }]);
  ok(near(incomeSum(asIncome), COACHING),
    'Forecast WOULD treat coaching as household income if it were a plan.income stream');
  const bad = runAmanda(asIncome).rows.find(r => r.fact === 'coaching-receipt');
  ok(bad && bad.status === 'CONFLICT',
    'a coaching Forecast income stream is CONFLICT');
}

console.log('\n=== 5. known business obligation reduces available remainder ===');
{
  const remainder = R.amandaHouseholdAvailable({
    employment: SALARY,
    coaching: KNOWN_COACHING,
    obligations: KNOWN_OBLIGATION,
    obligationsKnown: true,
  });
  const independent = SALARY + KNOWN_COACHING - KNOWN_OBLIGATION;
  ok(remainder.established === true && near(remainder.amount, independent),
    'known obligations yield remainder $2,268.85',
    money(remainder.amount));
  ok(remainder.amount < SALARY + KNOWN_COACHING,
    'the obligation reduced the remainder before household use');
  const movements = [
    { fact: 'employment-deposit', amount: SALARY },
    { fact: 'coaching-receipt', amount: KNOWN_COACHING },
    { fact: 'business-obligation', amount: KNOWN_OBLIGATION },
    { fact: 'household-transfer', amount: independent },
  ];
  ok(near(R.householdCashFromAmandaMovements(movements), independent),
    'household cash is the post-obligation remainder, not gross inflows');
  ok(!near(R.householdCashFromAmandaMovements(movements), SALARY + KNOWN_COACHING),
    'gross salary plus coaching is not household cash');
}

console.log('\n=== 6. unknown business obligations fail closed ===');
{
  const remainder = R.amandaHouseholdAvailable({
    employment: SALARY,
    coaching: 0,
    obligationsKnown: false,
  });
  ok(remainder.established === false && remainder.amount == null,
    'unknown obligations do not invent a remainder amount');
  ok(remainder.reason === 'unknown-business-obligations',
    'the unresolved reason is unknown-business-obligations');
  const guessed = SALARY - 0;
  ok(remainder.amount !== guessed,
    'fail-closed does not treat salary minus guessed $0 costs as available');
  ok(remainder.amount !== SESSION_BALANCE && remainder.amount == null,
    'the $798.37 session balance is not reported as household-available');

  const liveLike = cashFixture([{
    id: 'amandaTransfer',
    label: "Amanda's transfers to the household",
    frequency: 'monthly',
    day: 20,
    scenarioMonthly: { conservative: 930, expected: 2182, optimistic: 2400 },
    confidence: 'estimated',
  }]);
  ok(near(F.startingCashAmount(liveLike), OPENING),
    'held-elsewhere DEBT&PAYMENTS is not joint spendable cash');
  const avail = runAmanda(liveLike).rows.find(r => r.fact === 'household-available');
  ok(avail && avail.status === 'MATCH' && avail.remainderEstablished === false,
    'reconciler leaves household-available unresolved');
  ok(avail.observedBalance != null && near(avail.observedBalance, SESSION_BALANCE),
    'the session balance is reported as evidence, not as spendable cash');

  const spendable = cashFixture([{
    id: 'amandaTransfer',
    label: "Amanda's transfers to the household",
    frequency: 'monthly',
    day: 20,
    scenarioMonthly: { conservative: 930, expected: 2182, optimistic: 2400 },
    confidence: 'estimated',
  }]);
  spendable.startingCash.breakdown.push({
    id: AMANDA, value: SESSION_BALANCE, class: 'spendable',
  });
  spendable.startingCash.heldElsewhere = [];
  const bad = runAmanda(spendable).rows.find(r => r.fact === 'household-available');
  ok(bad && bad.status === 'CONFLICT',
    'treating DEBT&PAYMENTS as spendable household cash is CONFLICT');
}

console.log('\n=== 7. live amandaTransfer Forecast behaviour is unchanged ===');
{
  const stream = live.plan.income.find(s => s.id === 'amandaTransfer');
  ok(stream && stream.scenarioMonthly
    && stream.scenarioMonthly.conservative === 930
    && stream.scenarioMonthly.expected === 2182
    && stream.scenarioMonthly.optimistic === 2400,
    'live amandaTransfer scenarioMonthly is still 930 / 2,182 / 2,400');
  ok(live.plan.income.filter(s => s.id === 'amandaTransfer').length === 1,
    'exactly one amandaTransfer income stream');
  ok(!live.plan.income.some(s => R.isAmandaSalaryStream(s)),
    'live plan.income has no Tennis BC salary stream');
  ok(!R.forecastHasAmandaDoubleCount(live),
    'live data does not double-count salary plus transfer');

  const asOf = live.meta.asOf;
  const windowEnd = F.addDays(asOf, live.plan.windowDays - 1);
  const dates = F.occurrences(stream, asOf, windowEnd);
  const independent = dates.length * stream.scenarioMonthly.expected;
  const events = F.expandEvents(live.plan, asOf, windowEnd, { scenario: 'expected' })
    .filter(e => e.id === 'amandaTransfer');
  ok(events.length === dates.length,
    'live expandEvents emits one amandaTransfer event per occurrence',
    String(events.length));
  ok(near(events.reduce((s, e) => s + e.amount, 0), independent),
    'live amandaTransfer total equals occurrences × $2,182',
    money(independent));

  const held = (live.plan.startingCash.heldElsewhere || [])
    .find(r => r.id === AMANDA);
  ok(held && held.class === 'operational' && near(held.value, 2691.85),
    'live DEBT&PAYMENTS is still operational $2,691.85, not spendable');
}

console.log('\n=== 8. reconciliation performs no writes ===');
{
  const before = hashFile(R.DEFAULT_DATA);
  const src = fs.readFileSync(require('path').join(__dirname, 'scripts', 'reconcile.js'), 'utf8');
  ok(!/writeFileSync?\s*\(\s*DEFAULT_DATA/.test(src),
    'reconcile.js source does not write DEFAULT_DATA');
  ok(!/writeFileSync?\s*\([^)]*data\.json/.test(src),
    'reconcile.js source does not write data.json by path');

  const result = R.reconcile({
    data: live,
    map: { mappings: [] },
    observations: [],
    settlements: emptySide(),
    utility: emptySide(),
    amanda,
  });
  ok(result.writesCanonicalState === false, 'reconcile result declares no write');
  const salaryMid = result.rows.find(r => r.observationId === 'payday-amanda-salary-midmonth');
  const salaryEnd = result.rows.find(r => r.observationId === 'payday-amanda-salary-monthend');
  const transfer = result.rows.find(r => r.observationId === 'payday-amanda-household-transfer-model');
  const coaching = result.rows.find(r => r.observationId === 'payday-amanda-coaching-receipt');
  const obligation = result.rows.find(r => r.observationId === 'payday-amanda-business-obligation');
  const available = result.rows.find(r => r.observationId === 'payday-amanda-household-available');
  ok(salaryMid && salaryMid.status === 'MATCH' && near(salaryMid.evidenceValue, SALARY)
    && salaryMid.intentionallyNotCanonical,
    'live mid-month $2,168.85 is intentionally not Forecast income');
  ok(salaryEnd && salaryEnd.status === 'MATCH' && near(salaryEnd.evidenceValue, MONTH_END)
    && salaryEnd.intentionallyNotCanonical,
    'live month-end $2,387.99 is intentionally not Forecast income');
  ok(transfer && transfer.status === 'MATCH' && near(transfer.canonicalValue, 2182),
    'live amandaTransfer expected $2,182 still matches the canonical model');
  ok(coaching && coaching.status === 'MATCH' && coaching.unknown,
    'live coaching receipt is unresolved and not household income');
  ok(obligation && obligation.status === 'MATCH' && obligation.unknown
    && obligation.remainderEstablished === false,
    'live business obligation is unknown and fail-closed');
  ok(available && available.status === 'MATCH' && available.remainderEstablished === false
    && near(available.observedBalance, SESSION_BALANCE),
    'live household-available remainder is unresolved');

  ok(hashFile(R.DEFAULT_DATA) === before, 'calling reconcile() does not change data.json');

  const cliBefore = hashFile(R.DEFAULT_DATA);
  const out = execFileSync(process.execPath, ['scripts/reconcile.js'], {
    cwd: __dirname,
    encoding: 'utf8',
  });
  ok(/does not write data\.json/.test(out),
    'CLI report repeats the no-write contract');
  ok(/Amanda income \/ coaching \/ transfer distinctions/.test(out),
    'CLI names the Amanda income split');
  ok(/not Forecast household income/.test(out),
    'CLI reports salary as not Forecast household income');
  ok(/canonical household-cash Forecast authority/.test(out),
    'CLI reports amandaTransfer as the household-cash authority');
  ok(/remainder unresolved/.test(out),
    'CLI reports household-available remainder as unresolved');
  ok(hashFile(R.DEFAULT_DATA) === cliBefore,
    'CLI reconcile does not write data.json');
}

console.log('\n=== Forecast.expandEvents remains the household-cash authority ===');
{
  const src = fs.readFileSync(require('path').join(__dirname, 'public', 'forecast.js'), 'utf8');
  ok(/function expandEvents\(plan, start, end, opts\)/.test(src),
    'expandEvents is still the Plan schedule expander');
  ok(!/function expandAmanda|amandaLedger|amandaPayrollEngine/.test(src),
    'no second Amanda expander, ledger, or payroll engine was added');
  ok(!/function classifyAmandaMovement/.test(src),
    'Amanda movement classification lives on the reconciler path, not Forecast');
}

console.log('\n=== live Fusion / Hydro / HELOC / card surfaces untouched ===');
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
    'the three $500 Fusion season instalments are untouched');
  const liveHydro = (live.plan.bills || []).filter(b => /hydro/i.test(b.id + b.label));
  ok(liveHydro.length === 0, 'live plan.bills still has no Hydro row');
  const heloc = live.plan.obligations.find(o => o.id === 'heloc');
  ok(heloc && heloc.nonCash === true && near(heloc.amount, 814.18),
    'live HELOC capitalisation is untouched');
  const cards = ['cashback', 'travel', 'mbna', 'triangle']
    .map(id => live.debts.find(d => d.id === id))
    .filter(Boolean);
  ok(cards.length >= 3, 'live card debt rows remain present');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
