'use strict';
// Independent cents oracle, entirely invented: 61,739 - 7,319 - 7,319 = 47,101.
// Settlement intent and observed balances are fixture facts, not inferred matches.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const F = require('../public/forecast');
const Live = require('../scripts/live-plan');
const source = require('./fixtures/card-backfill-data');
const clone = value => JSON.parse(JSON.stringify(value));
const cents = value => Math.round(value * 100);
const canonicalBefore = fs.readFileSync(require.resolve('../data.json'), 'utf8');
const ORIGIN = '2030-08-19';
const END = '2030-10-08';
const FIRST = { id: 'invented-minimum', date: '2030-09-07', effectiveAsOf: '2030-09-02' };
const SECOND = { id: FIRST.id, date: '2030-10-07', effectiveAsOf: '2030-10-05' };
const names = [FIRST, SECOND];
const options = start => ({ weeklyVariable: 0, horizonDays: F.diffDays(start, END) + 1,
  viewDays: F.diffDays(start, END) + 1, extraDebtMonthly: 0 });
function plan(start = ORIGIN, cash = 617.39, represented = names) {
  return { opening: { asOf: start, priorAsOf: start === ORIGIN ? undefined : ORIGIN,
    representedEvents: clone(represented) }, windowDays: 60,
    startingCash: { breakdown: [{ id: 'chequing-a', value: cash },
      { id: 'chequing-b', value: 0 }, { id: 'savings', value: 0 }] },
    defaults: { targetBuffer: 0, extraDebtMonthly: 0 },
    income: [{ id: 'payroll', label: 'Seaspan - invented scheduling anchor',
      frequency: 'biweekly', anchor: ORIGIN, amount: 0, confidence: 'confirmed' }],
    obligations: [{ id: FIRST.id, debtId: 'invented-card', label: 'Invented minimum',
      effect: 'payment', frequency: 'monthly', day: 7, firstDue: FIRST.date,
      amount: 73.19, confidence: 'confirmed', payingAccount: 'chequing-a' }],
    bills: [], commitments: [], budget: { categories: [] } };
}
const payments = (p, start, opts = {}) => F.expandEvents(p, start, END, opts)
  .filter(row => row.id === FIRST.id && row.kind === 'obligation');

for (const [start, openingCents, expectedDates] of [
  [ORIGIN, 61739, [FIRST.date, SECOND.date]],
  ['2030-09-02', 54420, [SECOND.date]],
  ['2030-09-20', 54420, [SECOND.date]],
  ['2030-10-04', 54420, [SECOND.date]],
  ['2030-10-05', 47101, []],
  [END, 47101, []],
]) {
  const p = plan(start, openingCents / 100);
  const before = JSON.stringify(p);
  assert.deepEqual(payments(p, start).map(row => row.date), expectedDates, start);
  assert.equal(cents(F.simulate(p, start, options(start)).ending), 47101,
    `cash conservation before/between/after actual debits: ${start}`);
  assert.equal(JSON.stringify(p), before, 'Forecast does not mutate input evidence or cash');
}

// A later live packet must not erase payments from a historical projection.
const old = plan(ORIGIN, 617.39, []);
const explicit = { representedEvents: clone(names) };
assert.deepEqual(payments(old, ORIGIN, explicit).map(row => row.date), names.map(row => row.date));
assert.equal(cents(F.simulate(old, ORIGIN, { ...options(ORIGIN), ...explicit }).ending), 47101);
assert.equal(F.expandEvents(plan(), ORIGIN, END, { keepRepresented: true })
  .filter(row => row.id === FIRST.id).length, 2, 'schedule inspection still retains both occurrences');

// Invalid explicit dates fail closed, including impossible calendar days and null.
for (const effectiveAsOf of [null, '', 20300902, 'yesterday', '2030-02-30', '2030-13-01',
  '2030-09-02T18:00:00Z']) {
  const bad = [{ ...FIRST, effectiveAsOf }, SECOND];
  assert.equal(cents(F.simulate(plan(ORIGIN, 617.39, bad), ORIGIN, options(ORIGIN)).ending), 47101);
  assert.equal(payments(plan('2030-09-02', 617.39, bad), '2030-09-02').length, 2,
    'an invalid explicit date does not become a legacy opening-date assertion');
}

// No-date legacy rows remain assertions that the debit was inside their opening.
const legacy = names.map(({ id, date }) => ({ id, date }));
assert.equal(cents(F.simulate(plan(ORIGIN, 471.01, legacy), ORIGIN, options(ORIGIN)).ending), 47101);
assert.equal(payments(plan(ORIGIN, 471.01, legacy), ORIGIN).length, 0);
assert.equal(payments(plan(), ORIGIN, { representedEvents: [{ ...FIRST, id: 'wrong-id' }] }).length, 2);

// Actual debt stocks are independent inputs. Earlier projections still apply
// the scheduled principal; later observed debt is not reduced a second time.
for (const [start, cash, debtCents] of [[ORIGIN, 617.39, 100000],
  ['2030-09-20', 544.20, 92681], [END, 471.01, 85362]]) {
  const debts = [{ id: 'invented-card', label: 'Invented card', balance: debtCents / 100,
    pending: 0, limit: 2000, rate: 0 }];
  const projection = F.projectDebts(plan(start, cash), debts, start,
    { debtHorizonDays: F.diffDays(start, END) + 1 });
  const last = projection.marks[projection.marks.length - 1].debts[0];
  assert.equal(cents(last.balance), 85362, 'cash omission never invents principal or issuer receipt');
}

// Budget and credit consumers must share the same effective-date boundary.
const active = '2030-10-04';
const beforeSecond = plan(active, 544.20);
const states = F.currentPeriodObligationStates(beforeSecond, active, {});
const secondState = states.bills.find(row => row.id === FIRST.id && row.date === SECOND.date);
assert.equal(secondState.settlement, 'upcoming');
assert.equal(cents(secondState.remaining), 7319);
const action = F.currentPeriodAction(beforeSecond, active, {});
const bill = action.bills.find(row => row.id === FIRST.id && row.date === SECOND.date);
assert.notEqual(bill.status, 'PAID');
assert.equal(cents(bill.remaining), 7319);
const card = [{ id: 'invented-card', label: 'Invented card', structure: 'Revolving',
  balance: 926.81, pending: 0, rate: 0, limit: 2000 }];
assert.equal(F.creditAccounts(beforeSecond, card, active, {}).cards[0].nextPayment.date, SECOND.date);
const afterSecond = plan('2030-10-05', 471.01);
assert.equal(F.creditAccounts(afterSecond, card, '2030-10-05', {}).cards[0].nextPayment.date, '2030-11-07');
const history = F.baselineTrajectory(old, card, ORIGIN, { weeklyVariable: 0, ...explicit });
const historyWithoutNames = F.baselineTrajectory(old, card, ORIGIN, { weeklyVariable: 0 });
assert.equal(history.status, 'ready');
assert.ok(history.months.length > 0 && history.months.every(row => Number.isFinite(row.cash.amount)));
assert.deepEqual(history.months.map(row => row.cash), historyWithoutNames.months.map(row => row.cash),
  'historical trajectory cannot release cash from later effective evidence');
const gap = { paydayGapCash: { complete: true, coverageStart: '2030-08-20',
  coverageThrough: '2030-09-15', movements: [{ date: FIRST.effectiveAsOf,
    accountId: 'chequing-a', amount: -73.19 }] } };
const payday = F.establishPaydaySnapshot(old, '2030-09-16', { ...explicit, ...gap });
const paydayWithoutNames = F.establishPaydaySnapshot(old, '2030-09-16', gap);
assert.ok(payday && Number.isFinite(payday.opening));
assert.equal(cents(payday.opening), 54420, 'complete bank movements establish historical payday cash');
assert.deepEqual(payday, paydayWithoutNames,
  'historical payday opening cannot inherit later settlement through options');

// The guard qualifies all incumbent occurrence paths without extending them.
const guarded = { id: 'invented-outflow', date: '2030-09-07', effectiveAsOf: '2030-09-02' };
for (const kind of ['bill', 'once', 'cash-minimum']) {
  const p = plan(ORIGIN, 617.39, [guarded]);
  p.obligations = [];
  if (kind === 'bill') p.bills = [{ id: guarded.id, label: 'Invented bill', frequency: 'once',
    date: guarded.date, amount: 73.19, confidence: 'confirmed' }];
  else if (kind === 'once') p.obligations = [{ id: guarded.id, label: 'Invented once payment',
    frequency: 'once', date: '2030-08-10', amount: 73.19, effect: 'payment' }];
  else p.obligations = [{ id: guarded.id, label: 'Invented capitalising line', nonCash: true,
    frequency: 'monthly', day: 31, amount: 0, effect: 'capitalise',
    cashPayment: 73.19, cashDay: 7, cashFirstDue: guarded.date }];
  if (kind === 'once') p.opening.representedEvents[0].date = '2030-08-10';
  const events = F.expandEvents(p, ORIGIN, '2030-09-08', {}).filter(row => row.kind !== 'noncash');
  assert.equal(events.length, 1, `future-effective ${kind} does not omit cash`);
  assert.equal(cents(F.simulate(p, ORIGIN, { weeklyVariable: 0, horizonDays: 21, viewDays: 21 }).ending),
    54420, `independent one-debit cash oracle for ${kind}`);
}
const sameDayIncome = plan(ORIGIN, 617.39, [{ id: 'invented-receipt', date: ORIGIN,
  effectiveAsOf: '2030-08-20' }]);
sameDayIncome.obligations = [];
sameDayIncome.income = [{ id: 'invented-receipt', label: 'Invented receipt', frequency: 'once',
  date: ORIGIN, amount: 14.63, confidence: 'confirmed' }];
assert.equal(cents(F.simulate(sameDayIncome, ORIGIN, { weeklyVariable: 0, horizonDays: 1, viewDays: 1 }).ending),
  63202, 'a later receipt does not silently erase income from an earlier opening');
const futureIncome = plan(ORIGIN, 617.39, [{ ...FIRST, id: 'invented-receipt', effectiveAsOf: ORIGIN }]);
futureIncome.obligations = [];
futureIncome.income = [{ ...sameDayIncome.income[0], date: FIRST.date }];
assert.equal(F.expandEvents(futureIncome, ORIGIN, END, {}).length, 1,
  'effective evidence does not extend legacy future-income eligibility');

// The existing observer fixture has an invented posted payment and purchase.
// Explicit future evidence must survive a refresh without becoming active or
// losing its date. Category, amount and timing do not mint minimum intent.
function observed(existing) {
  const x = source('triangle', 'triangle');
  x.data.plan.opening.representedEvents = clone(existing);
  x.payload.transactions.forEach(tx => { tx.currency = 'cad'; });
  return { x, result: Live.fromObservation(x) };
}
const deferred = { id: 'triangle', date: '2026-09-20', effectiveAsOf: '2026-09-21' };
const { x, result } = observed([deferred]);
assert.equal(result.data.liveOverlay.applied, true);
assert.deepEqual(result.data.plan.opening.representedEvents.find(row => row.id === 'triangle'), deferred);
assert.equal(F.expandEvents(result.data.plan, x.asOf, x.asOf, {})
  .filter(row => row.id === 'triangle').length, 1, 'live refresh cannot activate tomorrow\'s evidence');
assert.equal(result.data.plan.startingCash.breakdown[0].value, 420, 'posted transfer reduces cash once');
assert.equal(result.data.debts[0].balance, 400, 'separate purchase and backfill do not duplicate debt');
const unconfirmed = observed([]).result;
assert.equal(unconfirmed.data.plan.opening.representedEvents.filter(row => row.id === 'triangle').length, 0);

// A retained but deferred income name cannot remove the live unproven-income
// hold; otherwise the receipt would be added on top of observed cash.
const inbound = source('triangle', 'triangle');
inbound.data.plan.income = [{ id: 'invented-receipt', label: 'Invented receipt', frequency: 'once',
  date: inbound.asOf, amount: 14.63, confidence: 'confirmed' }];
inbound.data.plan.opening.representedEvents = [{ id: 'invented-receipt', date: inbound.asOf,
  effectiveAsOf: '2026-09-21' }];
const held = Live.fromObservation(inbound).data.plan;
assert.equal(held.opening.notReliedUponEvents.filter(row => row.id === 'invented-receipt').length, 1);
assert.equal(F.expandEvents(held, inbound.asOf, inbound.asOf, {})
  .filter(row => row.id === 'invented-receipt').length, 0);

// A fresh observer-created name is qualified by the live cash date, not just
// the occurrence date. Its effective date survives both same-day and later merges.
const automatic = source('triangle', 'triangle');
automatic.data.plan.obligations = [];
automatic.data.plan.bills = [{ id: 'invented-bill', label: 'Invented bill', frequency: 'once',
  date: automatic.asOf, amount: 73.19, confidence: 'confirmed' }];
automatic.identity = { schema: 'atlas-provider-transaction-identity/v1', rules: [{
  eventId: 'invented-bill', atlasAccountId: 'chequing-a', direction: 'debit',
  payeePatterns: ['INVENTED BILL'] }] };
automatic.payload.transactions = [{ id: 94001, account_id: 3001, date: automatic.asOf,
  amount: 73.19, currency: 'cad', payee: 'INVENTED BILL', is_pending: false,
  status: 'reviewed', category_name: 'Invented bill' }];
automatic.payload.accounts[0].balance = 426.81; // 500.00 opening less 73.19 bank debit.
const generated = Live.fromObservation(automatic);
const generatedName = generated.data.plan.opening.representedEvents.find(row => row.id === 'invented-bill');
assert.deepEqual(generatedName, { id: 'invented-bill', date: automatic.asOf, effectiveAsOf: automatic.asOf });
assert.equal(cents(generated.data.plan.startingCash.breakdown[0].value), 42681);
const refreshed = Live.fromObservation({ ...automatic, data: generated.data });
assert.deepEqual(refreshed.data.plan.opening.representedEvents.find(row => row.id === 'invented-bill'), generatedName);
const nextDay = clone(automatic);
nextDay.data = generated.data;
nextDay.payload.fetchedAt = '2026-09-21T18:00:00Z';
nextDay.payload.accounts.forEach(row => { row.updated_at = '2026-09-21T17:00:00Z'; });
nextDay.payload.transactionWindow.endDate = '2026-09-21';
const advanced = Live.fromObservation(nextDay);
assert.deepEqual(advanced.data.plan.opening.representedEvents.find(row => row.id === 'invented-bill'), generatedName);
assert.equal(cents(F.simulate(advanced.data.plan, '2026-09-21', { weeklyVariable: 0,
  horizonDays: 1, viewDays: 1 }).ending), 42681, 'later cash does not replay the paid bank debit');
assert.equal(F.expandEvents(automatic.data.plan, '2026-09-18', automatic.asOf,
  { representedEvents: [generatedName] }).filter(row => row.id === 'invented-bill').length, 1,
  'live-generated settlement cannot erase the debit in the older opening');

// Independent invented collision oracle: 50,000 ± 3,847.
// Observed receipt 53,847 must not become 57,694; observed debit 46,153
// must not become 42,306. Inactive id/date rows cannot shadow fresh proof.
const MOVE = 38.47;
const BASE_CENTS = 50000;
const MOVE_CENTS = 3847;
const RECEIPT_OBS = BASE_CENTS + MOVE_CENTS;
const DEBIT_OBS = BASE_CENTS - MOVE_CENTS;
const HISTORICAL = '2026-09-18';
const SHADOWS = [
  { label: 'future', effectiveAsOf: '2026-09-21' },
  { label: 'invalid-calendar', effectiveAsOf: '2026-02-30' },
  { label: 'invalid-null', effectiveAsOf: null },
];
function collisionPacket(kind, existing) {
  const x = source('triangle', 'triangle');
  const id = kind === 'income' ? 'invented-receipt' : 'invented-bill';
  x.data.plan.obligations = [];
  x.data.plan.income = [];
  x.data.plan.bills = [];
  if (kind === 'income') {
    x.data.plan.income = [{ id, label: 'Invented receipt', frequency: 'once',
      date: x.asOf, amount: MOVE, confidence: 'confirmed' }];
    x.identity = { schema: 'atlas-provider-transaction-identity/v1', rules: [{
      eventId: id, atlasAccountId: 'chequing-a', direction: 'credit',
      payeePatterns: ['INVENTED RECEIPT'] }] };
    x.payload.transactions = [{ id: 95001, account_id: 3001, date: x.asOf,
      amount: -MOVE, currency: 'cad', payee: 'INVENTED RECEIPT', is_pending: false,
      status: 'reviewed', category_name: 'Income' }];
    x.payload.accounts[0].balance = RECEIPT_OBS / 100;
  } else {
    x.data.plan.bills = [{ id, label: 'Invented bill', frequency: 'once',
      date: x.asOf, amount: MOVE, confidence: 'confirmed' }];
    x.identity = { schema: 'atlas-provider-transaction-identity/v1', rules: [{
      eventId: id, atlasAccountId: 'chequing-a', direction: 'debit',
      payeePatterns: ['INVENTED BILL'] }] };
    x.payload.transactions = [{ id: 95002, account_id: 3001, date: x.asOf,
      amount: MOVE, currency: 'cad', payee: 'INVENTED BILL', is_pending: false,
      status: 'reviewed', category_name: 'Invented bill' }];
    x.payload.accounts[0].balance = DEBIT_OBS / 100;
  }
  x.data.plan.opening.representedEvents = clone(existing);
  return { x, id, observed: kind === 'income' ? RECEIPT_OBS : DEBIT_OBS,
    historical: kind === 'income' ? RECEIPT_OBS : DEBIT_OBS };
}
function liveEnding(data, asOf) {
  return cents(F.simulate(data.plan, asOf, { weeklyVariable: 0, horizonDays: 1, viewDays: 1 }).ending);
}
function historicalEnding(original, name) {
  return cents(F.simulate(original.data.plan, HISTORICAL, {
    weeklyVariable: 0, horizonDays: F.diffDays(HISTORICAL, original.asOf) + 1,
    viewDays: F.diffDays(HISTORICAL, original.asOf) + 1, representedEvents: [name],
  }).ending);
}
let collisionCases = 0;
for (const kind of ['income', 'debit']) {
  const control = collisionPacket(kind, []);
  const controlLive = Live.fromObservation(control.x);
  const controlName = controlLive.data.plan.opening.representedEvents.find(row => row.id === control.id);
  assert.deepEqual(controlName, { id: control.id, date: control.x.asOf, effectiveAsOf: control.x.asOf });
  assert.equal(liveEnding(controlLive.data, control.x.asOf), control.observed,
    `${kind} control conserves observed cash`);
  for (const shadow of SHADOWS) {
    const id = kind === 'income' ? 'invented-receipt' : 'invented-bill';
    const { x, observed, historical } = collisionPacket(kind, [{
      id, date: '2026-09-20', effectiveAsOf: shadow.effectiveAsOf }]);
    const original = clone(x);
    const first = Live.fromObservation(x);
    const name = first.data.plan.opening.representedEvents.find(row => row.id === id);
    assert.equal(first.data.liveOverlay.applied, true, `${kind} ${shadow.label} overlay applies`);
    assert.deepEqual(name, { id, date: x.asOf, effectiveAsOf: x.asOf },
      `${kind} ${shadow.label} inactive entry cannot keep the live name inactive`);
    assert.equal((first.data.plan.opening.notReliedUponEvents || [])
      .filter(row => row.id === id).length, 0,
      `${kind} ${shadow.label} represented proof does not also hold the occurrence`);
    assert.equal(cents(first.data.plan.startingCash.breakdown[0].value), observed);
    assert.equal(liveEnding(first.data, x.asOf), observed,
      `${kind} ${shadow.label} first refresh conserves observed cash`);
    collisionCases += 1;
    const second = Live.fromObservation({ ...x, data: first.data });
    const secondName = second.data.plan.opening.representedEvents.find(row => row.id === id);
    assert.deepEqual(secondName, name, `${kind} ${shadow.label} repeated refresh keeps the live name`);
    assert.equal(liveEnding(second.data, x.asOf), observed,
      `${kind} ${shadow.label} repeated refresh conserves observed cash`);
    collisionCases += 1;
    assert.equal(F.expandEvents(original.data.plan, HISTORICAL, x.asOf, { representedEvents: [name] })
      .filter(row => row.id === id).length, 1,
      `${kind} ${shadow.label} historical snapshot still includes the movement`);
    assert.equal(historicalEnding(original, name), historical,
      `${kind} ${shadow.label} older opening still applies the invented 3,847 cents`);
    collisionCases += 1;
  }
}
assert.equal(collisionCases, 18, 'income and debit collision proof covers 18 cases');

const earlier = collisionPacket('debit', [{ id: 'invented-bill', date: '2026-09-20',
  effectiveAsOf: '2026-09-19' }]);
const earlierLive = Live.fromObservation(earlier.x);
const keptEarlier = earlierLive.data.plan.opening.representedEvents
  .find(row => row.id === 'invented-bill');
assert.deepEqual(keptEarlier, { id: 'invented-bill', date: earlier.x.asOf, effectiveAsOf: '2026-09-19' },
  'a later live packet cannot overwrite an earlier truthful qualification');
assert.equal(liveEnding(earlierLive.data, earlier.x.asOf), DEBIT_OBS);

assert.equal(fs.readFileSync(require.resolve('../data.json'), 'utf8'), canonicalBefore);
console.log('All represented effective-date synthetic checks passed.');
