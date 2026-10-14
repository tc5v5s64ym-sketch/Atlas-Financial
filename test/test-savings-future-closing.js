'use strict';
// All ledgers and literal expected cents are independently invented.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const F = require(path.join(process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..'), 'public/forecast'));
const input = require('./fixtures/savings-future-closing-data');
const ownerModel = require('./fixtures/savings-owner-closing-data');
const copy = x => JSON.parse(JSON.stringify(x));
function advice(x) {
  const before = JSON.stringify(x), result = F.recommend(x.plan, x.asOf, { ...x.opts, weeklyVariable: 0, debts: [] });
  assert.equal(JSON.stringify(x), before, 'no input, settlement or source mutation');
  return result;
}
function closing(a, start) {
  const view = a.savingsFunding.periodViews.find(p => p.start === start);
  assert.ok(view, 'selected native period exists');
  const p = F.savingsFundingPublication(a.savingsFunding, { asOf: a.savingsFunding.asOf, advice: a, periodId: view.id });
  assert.ok(p.forecastClosing, 'Forecast owns the selected-period closing projection');
  return p.forecastClosing;
}
function values(p) { assert.equal(p.status, 'ready', p.reason); return p.items.map(i => Math.round(i.forecastSaved * 100)); }
for (const operating of [80, 1000]) test('owner closing 300 + 400 - 500 = 200 is independent of operating opening ' + operating, () => {
  const x = ownerModel(operating), a = advice(x);
  const first = closing(a, '2026-10-16'), second = closing(a, '2026-10-30');
  assert.equal(first.status, 'ready', first.reason); assert.equal(second.status, 'ready', second.reason);
  assert.equal(first.stock, 200); assert.equal(second.stock, 200);
  assert.equal(first.operatingCash, operating); assert.equal(second.operatingCash, operating);
  assert.deepEqual(first.items.map(i => [i.id, i.forecastSaved]), [['b', 200]]);
  assert.deepEqual(second.items, []);
  assert.equal(30000 + 40000 - 50000, 20000); assert.equal(20000 + 40000 - 40000, 20000);
  assert.equal(a.savingsFunding.stock.amount, 300); assert.ok(x.plan.commitments.every(c => c.settledOn === undefined));
});
for (const operating of [80, 1000]) test('full signed Savings -100/-400 is not replaced by operating support ' + operating, () => {
  const a = advice(ownerModel(operating, 100));
  const first = closing(a, '2026-10-16'), second = closing(a, '2026-10-30');
  for (const [p, expected] of [[first, -100], [second, -400]]) {
    assert.equal(p.status, 'unavailable'); assert.equal(p.stock, null);
    assert.equal(p.diagnostics.signedSavings, expected);
    assert.deepEqual(p.items, []); assert.deepEqual(p.rows, []);
  }
  assert.equal(30000 + 10000 - 50000, -10000); assert.equal(-10000 + 10000 - 40000, -40000);
});
test('positive signed closing arithmetic does not authorize a cost before its income arrives', () => {
  const x = ownerModel(); x.plan.income[1].date = '2026-10-24'; x.plan.commitments[0].date = '2026-10-16';
  const a = advice(x), p = closing(a, '2026-10-16');
  assert.equal(30000 + 40000 - 50000, 20000);
  assert.equal(p.diagnostics.signedSavings, 200);
  assert.equal(p.status, 'unavailable'); assert.equal(p.stock, null);
  assert.equal(p.gap.date, '2026-10-16'); assert.equal(p.gap.signedOperatingCash, -120);
  assert.equal(p.gap.cashFloor, 20); assert.equal(p.gap.shortBy, 140);
  assert.equal(a.savingsFunding.period.status, 'ready', 'incumbent zero-tail condition is preserved');
});
test('two future periods of 1000 add exactly 2000 at the second close, spilling into the next requirement', () => {
  const a = advice(input()), first = closing(a, '2026-10-16'), second = closing(a, '2026-10-30');
  assert.equal(first.end, '2026-10-29'); assert.equal(first.stock, 1119);
  assert.deepEqual(values(first), [111900, 0]);
  assert.deepEqual(first.rows.map(r => r.forecastContribution), [1000, 0]);
  assert.equal(second.end, '2026-11-12'); assert.equal(second.stock, 2119);
  assert.deepEqual(values(second), [150000, 61900]);
  assert.deepEqual(second.rows.map(r => r.forecastContribution), [381, 619]);
  assert.equal(11900 + 100000 + 100000, 150000 + 61900);
  assert.equal(second.actualSaved, null); assert.equal(second.trust, 'estimated');
});
test('actual current allocation, generic deadline schedule and input remain unchanged by navigation/replay', () => {
  const x = input(), a = advice(x), before = copy(a.savingsFunding);
  assert.deepEqual(a.savingsFunding.backing.items.map(i => i.saved), [119, 0]);
  for (const date of ['2026-10-30', '2026-10-16', '2026-10-30']) closing(a, date);
  assert.deepEqual(copy(a.savingsFunding), before); assert.deepEqual(copy(advice(x)), copy(a));
  assert.equal(a.savingsFunding.stock.amount, 119);
});
test('native goal expense between closes is paid once and removed only from the projection', () => {
  const x = input(); x.plan.commitments[0].date = '2026-11-03'; x.plan.commitments[0].amount = 80;
  const a = advice(x), p = closing(a, '2026-10-30');
  assert.equal(p.stock, 2039); assert.deepEqual(values(p), [100000]);
  assert.equal(p.unallocated, 1039); assert.equal(p.projectedDraws, 80);
  assert.ok(a.savingsFunding.backing.items.some(i => i.id === 'a'));
  assert.equal(x.plan.commitments[0].settledOn, undefined);
  assert.equal(Math.round(p.operatingCash * 100) + Math.round(p.stock * 100), 8000 + 11900 + 200000 - 8000);
});
test('bills and household deductions consume each dollar once before surplus is poured', () => {
  const x = input(); x.plan.bills = [{ id: 'bill', label: 'Invented bill', frequency: 'once', date: '2026-10-20', amount: 100, confidence: 'confirmed' }];
  x.opts.daleIncomeAuthorityEnd = '2026-11-12';
  x.plan.commitments[0].date = '2027-01-03';
  x.plan.budget.categories = [{ id: 'groceries', label: 'Invented food', class: 'essential', plannedPayday: 100, plannedWeekly: 50, confidence: 'confirmed' }];
  x.plan.opening.paydaySnapshot.opening = 180;
  x.opts.currentPeriodActuals.transactions.push({ id: 'food-receipt', date: '2026-10-03', amount: 100,
    pending: false, currency: 'CAD', atlasAccountId: 'chequing-a', accountRole: 'household-cash',
    savingsPostingEvidence: 'posted', categoryId: 'groceries', categoryLabel: 'Groceries', displayedPayee: 'Invented Superstore' });
  const p = closing(advice(x), '2026-10-30');
  assert.equal(p.status, 'ready', p.reason);
  assert.equal(p.stock, 1819); assert.deepEqual(values(p), [150000, 31900]);
});
test('deficit is covered only by native operating carry, preserving the floor and Savings', () => {
  const x = input(); x.plan.income[2].amount = 0;
  x.plan.commitments[0].date = '2027-01-03';
  x.plan.bills = [{ id: 'deficit', label: 'Invented deficit bill', frequency: 'once', date: '2026-11-03', amount: 20, confidence: 'confirmed' }];
  const p = closing(advice(x), '2026-10-30');
  assert.equal(p.stock, 1119); assert.equal(p.operatingCash, 60); assert.deepEqual(values(p), [111900, 0]);
});
test('later deficit limits earlier transfer without inventing a reserve withdrawal or loan', () => {
  const x = input(); x.plan.income[2].amount = 0;
  x.plan.commitments[0].date = '2027-01-03';
  x.plan.bills = [{ id: 'deficit', label: 'Invented deficit bill', frequency: 'once', date: '2026-11-03', amount: 100, confidence: 'confirmed' }];
  const p = closing(advice(x), '2026-10-30');
  assert.equal(p.stock, 1079); assert.equal(p.operatingCash, 20); assert.equal(p.projectedDraws, 0);
});
test('proved current income already in Savings is never poured into the pot again', () => {
  const x = input();
  x.plan.income.push({ id: 'current-gift', label: 'Invented received gift', frequency: 'once',
    date: '2026-10-04', amount: 200, confidence: 'confirmed' });
  x.plan.savingsPoolObservation.accounts[0].value += 200;
  x.plan.startingCash.breakdown.find(r => r.id === 'savings').value += 200;
  x.opts.currentPeriodActuals.representedActuals.push({ id: 'current-gift', date: '2026-10-04', actual: 200, transactionId: 'gift-receipt' });
  x.opts.currentPeriodActuals.transactions.push({ id: 'gift-receipt', date: '2026-10-04', amount: -200,
    currency: 'CAD', pending: false, isIncome: true, incomeId: 'current-gift', savingsPostingEvidence: 'posted',
    atlasAccountId: 'savings', accountRole: 'household-reserve', displayedPayee: 'Invented received gift' });
  const a = advice(x), p = closing(a, '2026-10-30');
  assert.equal(a.savingsFunding.period.alreadySavedIncome, 200);
  assert.equal(a.savingsFunding.period.projectedRemainingCapacity, 0);
  assert.equal(p.stock, 2319); assert.deepEqual(values(p), [150000, 81900]);
});
test('only a reconciled untransferred current tail can join future surplus', () => {
  const x = input();
  x.plan.income.push({ id: 'current-gift', label: 'Invented operating receipt', frequency: 'once',
    date: '2026-10-04', amount: 200, confidence: 'confirmed' });
  x.plan.startingCash.breakdown[0].value += 200;
  x.opts.currentPeriodActuals.representedActuals.push({ id: 'current-gift', date: '2026-10-04', actual: 200, transactionId: 'gift-receipt' });
  x.opts.currentPeriodActuals.transactions.push({ id: 'gift-receipt', date: '2026-10-04', amount: -200,
    currency: 'CAD', pending: false, isIncome: true, incomeId: 'current-gift', savingsPostingEvidence: 'posted',
    atlasAccountId: 'chequing-a', accountRole: 'household-cash', displayedPayee: 'Invented operating receipt' });
  const p = closing(advice(x), '2026-10-30'); assert.equal(p.stock, 2319);
  const uncertain = copy(x); uncertain.opts.currentPeriodActuals.representedActuals = [];
  uncertain.opts.currentPeriodActuals.transactions = [];
  const unknown = closing(advice(uncertain), '2026-10-30');
  assert.equal(unknown.status, 'unavailable'); assert.equal(unknown.stock, null);
});
test('an unexplained reported increase changes current stock only, never income entitlement', () => {
  const x = input(); x.plan.savingsPoolObservation.accounts[0].value += 200;
  x.plan.startingCash.breakdown.find(r => r.id === 'savings').value += 200;
  const a = advice(x); assert.equal(a.savingsFunding.period.alreadySavedIncome, 0);
  assert.equal(a.savingsFunding.period.projectedRemainingCapacity, 0);
  assert.equal(closing(a, '2026-10-30').stock, 2319);
});
test('outside native income authority remains unknown', () => {
  const x = input(); x.opts.daleIncomeAuthorityEnd = '2026-10-29';
  const a = advice(x);
  assert.ok(!a.savingsFunding.periodViews.some(p => p.start === '2026-10-30'));
  assert.equal(F.savingsFundingPublication(a.savingsFunding, { asOf: x.asOf, advice: a, periodId: 'outside-income-authority' }), null);
});
for (const gap of ['receipt', 'stock', 'bill', 'date', 'pending', 'card-coverage']) test('unknown ' + gap + ' stays unknown, never a zero or guessed surplus', () => {
  const x = input();
  if (gap === 'receipt') delete x.opts.currentPeriodActuals;
  if (gap === 'stock') x.plan.savingsPoolObservation.accounts.pop();
  if (gap === 'bill') x.plan.bills = [{ id: 'unknown', frequency: 'once', date: '2026-10-20', amount: null }];
  if (gap === 'date') delete x.plan.commitments[1].date;
  if (gap === 'pending') x.plan.savingsPoolObservation.accounts[0].pendingState = 'unresolved';
  if (gap === 'card-coverage') x.opts.currentPeriodActuals.cardCoverageRequired = true;
  const p = closing(advice(x), '2026-10-30'); assert.equal(p.status, 'unavailable'); assert.equal(p.stock, null);
});
for (const fault of ['date', 'source', 'permission', 'currency', 'items', 'stock', 'saved']) test('closing publication rejects malformed ' + fault, () => {
  const x = input(), a = advice(x), publication = copy(a.savingsFunding);
  const view = publication.periodViews.find(p => p.start === '2026-10-30'), c = view.packet.forecastClosing;
  if (fault === 'date') c.end = '2026-11-13';
  if (fault === 'source') c.source = 'Page.alternative';
  if (fault === 'permission') c.actionPermission = 'granted';
  if (fault === 'currency') c.currency = 'USD';
  if (fault === 'items') c.items = {};
  if (fault === 'stock') c.stock = null;
  if (fault === 'saved') c.items[0].saved = 1500;
  assert.equal(F.savingsFundingPublication(publication, { asOf: x.asOf, advice: a, periodId: view.id }), null);
});

function installments() {
  const x = input();
  x.plan.commitments = [
    { id: 'one', label: 'Invented installment one', group: 'installments', date: '2026-10-29', amount: 80, confidence: 'confirmed', sinkingFund: true },
    { id: 'two', label: 'Invented installment two', group: 'installments', date: '2026-11-12', amount: 60, confidence: 'confirmed', sinkingFund: true },
    { id: 'later', label: 'Invented later requirement', date: '2027-01-04', amount: 3000, confidence: 'confirmed', sinkingFund: true }];
  x.plan.groups = [{ id: 'installments', label: 'Invented installment group', planSpendSummary: true }];
  return x;
}
test('native unavoidable later gap preserves affordable earlier closes and withholds the failing close', () => {
  const x = input();
  x.plan.defaults.targetBuffer = 0;
  x.plan.startingCash.breakdown[0].value = x.plan.opening.paydaySnapshot.opening = 0;
  x.plan.savingsPoolObservation.accounts[0].value = x.plan.startingCash.breakdown[2].value = 800;
  x.plan.savingsPoolObservation.accounts[1].value = x.plan.startingCash.heldElsewhere[0].value = 0;
  x.plan.income[1].amount = x.plan.income[2].amount = 200;
  x.plan.income.push({ id: 'p3', label: 'Invented third receipt', frequency: 'once', date: '2026-11-13', amount: 200, confidence: 'confirmed' });
  x.plan.commitments = [
    { id: 'a', label: 'Invented first cost', date: '2026-10-29', amount: 500, confidence: 'confirmed', sinkingFund: true },
    { id: 'b', label: 'Invented second cost', date: '2026-11-12', amount: 600, confidence: 'confirmed', sinkingFund: true },
    { id: 'c', label: 'Invented third cost', date: '2026-11-26', amount: 400, confidence: 'confirmed', sinkingFund: true }];
  const a = advice(x), first = closing(a, '2026-10-16'), second = closing(a, '2026-10-30');
  assert.equal(first.status, 'ready', first.reason); assert.equal(first.stock, 500);
  assert.deepEqual(first.items.map(i => [i.id, i.forecastSaved]), [['b', 500], ['c', 0]]);
  assert.equal(second.status, 'ready', second.reason); assert.equal(second.stock, 100);
  assert.deepEqual(second.items.map(i => [i.id, i.forecastSaved]), [['c', 100]]);
  const third = closing(a, '2026-11-13');
  assert.equal(third.status, 'unavailable'); assert.equal(third.stock, null);
  assert.equal(third.gap.date, '2026-11-26'); assert.equal(third.gap.shortBy, 100);
  assert.equal(third.gap.signedOperatingCash, -100); assert.equal(third.gap.cashFloor, 0);
  assert.deepEqual(third.items, []); assert.deepEqual(third.rows, []);
  assert.equal(80000 + 60000 - 50000 - 60000 - 40000, -10000, 'independent economic shortage, no invented funding');
  assert.deepEqual(copy(closing(a, '2026-10-16')), copy(first));
});
test('operating support cannot zero-clamp a -100 signed Savings close', () => {
  const x = input(); x.plan.defaults.targetBuffer = 0;
  x.plan.startingCash.breakdown[0].value = x.plan.opening.paydaySnapshot.opening = 100;
  x.plan.savingsPoolObservation.accounts[0].value = x.plan.startingCash.breakdown[2].value = 800;
  x.plan.savingsPoolObservation.accounts[1].value = x.plan.startingCash.heldElsewhere[0].value = 0;
  x.plan.income[1].amount = x.plan.income[2].amount = 200;
  x.plan.income.push({ id: 'p3', label: 'Invented third receipt', frequency: 'once', date: '2026-11-13', amount: 200, confidence: 'confirmed' });
  x.plan.commitments = [
    { id: 'a', label: 'Invented first cost', date: '2026-10-29', amount: 500, confidence: 'confirmed', sinkingFund: true },
    { id: 'b', label: 'Invented second cost', date: '2026-11-12', amount: 600, confidence: 'confirmed', sinkingFund: true },
    { id: 'c', label: 'Invented third cost', date: '2026-11-26', amount: 400, confidence: 'confirmed', sinkingFund: true }];
  const a = advice(x), p = closing(a, '2026-11-13');
  assert.equal(p.status, 'unavailable'); assert.equal(p.stock, null); assert.deepEqual(p.rows, []);
  assert.equal(p.diagnostics.signedSavings, -100); assert.equal(p.diagnostics.nativeOperatingCash, 0);
  assert.equal(10000 + 80000 + 60000 - 50000 - 60000 - 40000, 0, 'full 1500 expenses consume household cash once');
  assert.ok(x.plan.commitments.every(c => c.settledOn === undefined));
});
test('an exact zero Savings ledger is published without spending operating carry', () => {
  const x = ownerModel(1000, 300);
  x.plan.commitments[1].amount = 400;
  const a = advice(x), p = closing(a, '2026-10-30');
  assert.equal(30000 + 30000 - 50000 + 30000 - 40000, 0);
  assert.equal(p.status, 'ready', p.reason); assert.equal(p.stock, 0); assert.equal(p.operatingCash, 1000);
  assert.equal(p.cashBasis, 'opening-savings-plus-eligible-surplus-minus-goal-costs');
  assert.deepEqual(p.items, []);
});
for (const destination of ['chequing-a', 'savings']) test('current-tail annual goal bill is debited once with proved income destination ' + destination, () => {
  const x = ownerModel(1000);
  x.plan.bills = [{ id: 'current-annual', label: 'Invented current annual bill', frequency: 'yearly', month: 10, day: 10,
    firstDue: '2026-10-10', amount: 200, confidence: 'confirmed', jointCash: false }];
  x.plan.income.push({ id: 'current-gift', label: 'Invented current income', frequency: 'once', date: '2026-10-04', amount: 1000, confidence: 'confirmed' });
  x.opts.currentPeriodActuals.representedActuals.push({ id: 'current-gift', date: '2026-10-04', actual: 1000, transactionId: 'current-income' });
  x.opts.currentPeriodActuals.transactions.push({ id: 'current-income', date: '2026-10-04', amount: -1000,
    currency: 'CAD', pending: false, isIncome: true, incomeId: 'current-gift', savingsPostingEvidence: 'posted',
    atlasAccountId: destination, accountRole: destination === 'savings' ? 'household-reserve' : 'household-cash', displayedPayee: 'Invented current income' });
  if (destination === 'savings') {
    x.plan.savingsPoolObservation.accounts[0].value += 1000;
    x.plan.startingCash.breakdown[2].value += 1000;
  } else x.plan.startingCash.breakdown[0].value += 1000;
  const a = advice(x), p = closing(a, '2026-10-30');
  assert.equal(p.status, 'ready', p.reason); assert.equal(p.stock, 1000);
  assert.equal(30000 + 100000 - 20000 + 40000 - 50000 + 40000 - 40000, 100000);
  assert.equal(a.savingsFunding.period.alreadySavedIncome, destination === 'savings' ? 1000 : 0);
});
test('a future annual goal already deducted by Budget is not subtracted a second time', () => {
  const x = ownerModel(); x.plan.commitments.shift();
  x.plan.bills = [{ id: 'a', label: 'Invented annual goal', frequency: 'yearly', month: 10, day: 21,
    firstDue: '2026-10-21', amount: 500, confidence: 'confirmed', jointCash: false }];
  const a = advice(x);
  for (const start of ['2026-10-16', '2026-10-30']) { const p = closing(a, start);
    assert.equal(p.status, 'ready', p.reason); assert.equal(p.stock, 200); assert.equal(p.operatingCash, 80); }
});
test('an unavailable native current-tail path is never overridden by schedule funding-gap acceptance', () => {
  const x = input(); x.plan.commitments[0].amount = 4000;
  x.plan.income.push({ id: 'current-gift', label: 'Invented operating receipt', frequency: 'once', date: '2026-10-04', amount: 200, confidence: 'confirmed' });
  x.plan.startingCash.breakdown[0].value += 200;
  x.opts.currentPeriodActuals.representedActuals.push({ id: 'current-gift', date: '2026-10-04', actual: 200, transactionId: 'gift-receipt' });
  x.opts.currentPeriodActuals.transactions.push({ id: 'gift-receipt', date: '2026-10-04', amount: -200, currency: 'CAD',
    pending: false, isIncome: true, incomeId: 'current-gift', savingsPostingEvidence: 'posted',
    atlasAccountId: 'chequing-a', accountRole: 'household-cash', displayedPayee: 'Invented operating receipt' });
  const a = advice(x);
  assert.equal(a.savingsFunding.backing.status, 'ready');
  assert.equal(a.savingsFunding.period.status, 'unavailable');
  assert.match(a.savingsFunding.period.reason, /cannot preserve the existing cash\/card floor/);
  const p = closing(a, '2026-10-16'); assert.equal(p.status, 'unavailable'); assert.equal(p.stock, null);
});
test('signed native diagnostics carry -100 forward to -200 without resetting deficits or publishing zero Savings', () => {
  const x = input(); x.plan.defaults.targetBuffer = 0;
  x.plan.startingCash.breakdown[0].value = x.plan.opening.paydaySnapshot.opening = 0;
  x.plan.savingsPoolObservation.accounts[0].value = x.plan.startingCash.breakdown[2].value = 300;
  x.plan.savingsPoolObservation.accounts[1].value = x.plan.startingCash.heldElsewhere[0].value = 0;
  x.plan.income[1].amount = 0; x.plan.income[2].amount = 100;
  x.plan.commitments = [
    { id: 'a', label: 'Invented first cost', date: '2026-10-29', amount: 400, confidence: 'confirmed', sinkingFund: true },
    { id: 'b', label: 'Invented second cost', date: '2026-11-12', amount: 200, confidence: 'confirmed', sinkingFund: true }];
  const a = advice(x), sim = F.simulate(x.plan, x.asOf, { ...x.opts, weeklyVariable: 0, horizonDays: 50, viewDays: 50, targetBuffer: 0 });
  assert.equal(sim.daily.find(r => r.date === '2026-10-29').balance, -100);
  assert.equal(sim.daily.find(r => r.date === '2026-11-12').balance, -200);
  assert.equal(30000 - 40000, -10000); assert.equal(-10000 + 10000 - 20000, -20000);
  assert.equal(a.savingsFunding.period.status, 'ready', 'a zero-capacity path does not broaden the existing unavailable gate');
  for (const start of ['2026-10-16', '2026-10-30']) {
    const p = closing(a, start); assert.equal(p.stock, null); assert.equal(p.status, 'unavailable');
    assert.equal(p.gap.signedOperatingCash, -100, 'earliest native failure is a diagnostic, not published Savings');
  }
});
test('installment groups retain only future members, then disappear at the final payment close', () => {
  const x = installments(), a = advice(x), current = a.savingsFunding;
  assert.deepEqual(current.backing.items.map(i => [i.id, i.saved]), [['one', 80], ['two', 39], ['later', 0]]);
  const first = closing(a, '2026-10-16'), second = closing(a, '2026-10-30');
  assert.equal(first.stock, 1039); assert.equal(first.projectedDraws, 80);
  assert.deepEqual(first.items.map(i => [i.id, i.forecastSaved]), [['two', 60], ['later', 979]]);
  assert.deepEqual(first.rows.find(r => r.key === 'group:installments').members, ['two@2026-11-12']);
  assert.equal(second.stock, 1979); assert.equal(second.projectedDraws, 140);
  assert.deepEqual(second.items.map(i => [i.id, i.forecastSaved]), [['later', 1979]]);
  assert.ok(!second.rows.some(r => r.key === 'group:installments'));
  assert.equal(11900 + 200000 - 8000 - 6000, 197900, 'both costs consumed once, exact cents');
  assert.deepEqual(current.backing.items.map(i => [i.id, i.saved]), [['one', 80], ['two', 39], ['later', 0]]);
  assert.ok(x.plan.commitments.every(c => c.settledOn === undefined), 'date passage never creates actual settlement');
});
for (const [date, present, stock] of [['2026-10-28', false, 1039], ['2026-10-29', false, 1039], ['2026-10-30', true, 1119]])
  test('selected closing boundary includes planned payment dated ' + date, () => {
    const x = input(); x.plan.commitments[0].date = date; x.plan.commitments[0].amount = 80;
    const a = advice(x), before = copy(a.savingsFunding), first = closing(a, '2026-10-16');
    assert.equal(first.stock, stock); assert.equal(first.items.some(i => i.id === 'a'), present);
    assert.equal(first.projectedDraws, present ? 0 : 80);
    const second = copy(closing(a, '2026-10-30'));
    for (let n = 0; n < 3; n++) {
      assert.deepEqual(copy(closing(a, '2026-10-16')), copy(first));
      assert.deepEqual(copy(closing(a, '2026-10-30')), second);
    }
    assert.equal(second.stock, 2039); assert.equal(second.projectedDraws, 80);
    assert.deepEqual(copy(a.savingsFunding), before);
  });
