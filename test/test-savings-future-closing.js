'use strict';
// All ledgers and literal expected cents are independently invented.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const F = require(path.join(process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..'), 'public/forecast'));
const input = require('./fixtures/savings-future-closing-data');
const ownerModel = require('./fixtures/savings-owner-closing-data');
const deficitModel = require('./fixtures/savings-deficit-coverage-data');
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
// Owner direction 2026-10-14 supersedes the PR #610 carry-first semantics
// pinned here before: the prior period's surplus now sweeps in full on the
// NEXT payday (it is still Bills cash at its own period's close), and a
// routine Bills deficit is published, never covered from projected Savings.
test('payday sweep: prior surplus400 is still Bills at its own close, then sweeps in full', () => {
  const a = advice(deficitModel(400)), first = closing(a, '2026-10-16'), second = closing(a, '2026-10-30');
  assert.equal(first.stock, 500); assert.equal(first.contribution, 0); assert.equal(first.operatingCash, 420);
  assert.equal(second.stock, 900); assert.equal(second.contribution, 400); assert.equal(second.operatingCash, -180);
  assert.equal(second.projectedDeficitCoverage ?? 0, 0);
  assert.equal(50000 + 40000, 90000, 'opening Savings plus the full swept surplus; the deficit is not charged to Savings');
});
test('payday sweep: surplus100 sweeps in full and the routine deficit200 stays visible, uncovered', () => {
  const a = advice(deficitModel()), first = closing(a, '2026-10-16'), second = closing(a, '2026-10-30');
  assert.equal(first.stock, 500); assert.equal(first.contribution, 0); assert.equal(first.operatingCash, 120);
  assert.equal(second.status, 'ready', second.reason); assert.equal(second.stock, 600); assert.equal(second.operatingCash, -180);
  assert.equal(second.projectedDeficitCoverage, 0); assert.equal(second.projectedDraws, 0);
  assert.equal(second.gap.date, '2026-11-03'); assert.equal(second.gap.signedOperatingCash, -180);
  assert.equal(second.gap.shortBy, 200); assert.equal(second.gap.cashFloor, 20);
  assert.equal(second.items.reduce((sum,i) => sum + i.forecastSaved, 0) + second.unallocated, 600);
  assert.equal(second.actualSaved, null); assert.equal(second.moneyMovementPermission, 'not-granted');
  assert.equal(50000 + 10000, 60000, 'Savings keeps the swept surplus; Bills shows the deficit');
});
test('ample Bills carry covers a deficit without charging Savings', () => {
  const p = closing(advice(deficitModel(100, 200, 500, 1000)), '2026-10-30');
  assert.equal(p.stock, 600); assert.equal(p.operatingCash, 800); assert.equal(p.projectedDeficitCoverage ?? 0, 0);
  assert.equal(p.cashBasis, 'opening-savings-plus-eligible-surplus-minus-goal-costs',
    'the closing basis no longer subtracts uncovered deficits: Savings never pays them');
});
test('a thin Savings stock is not charged for a Bills deficit: the close stays ready and signed', () => {
  // Supersedes the carry-first pin (stock 50 withheld at -50 after coverage):
  // Savings never pays the routine deficit, so the pot is 50 + swept 100.
  const p = closing(advice(deficitModel(100, 200, 50)), '2026-10-30');
  assert.equal(p.status, 'ready', p.reason); assert.equal(p.stock, 150);
  assert.equal(p.operatingCash, -180); assert.equal(p.projectedDeficitCoverage, 0);
  assert.equal(p.gap.date, '2026-11-03'); assert.equal(p.gap.shortBy, 200);
  assert.equal(5000 + 10000, 15000);
});
test('a later receipt never retrospectively covers an earlier deficit; the shortfall stays on the close', () => {
  const x = deficitModel(100, 200, 50); x.plan.income[2].amount = 300; x.plan.income[2].date = '2026-11-10';
  const p = closing(advice(x), '2026-10-30');
  assert.equal(p.status, 'ready', p.reason); assert.equal(p.stock, 150); assert.equal(p.operatingCash, 120);
  assert.equal(p.gap.date, '2026-11-03'); assert.equal(p.gap.signedOperatingCash, -180);
  assert.equal(p.gap.shortBy, 200); assert.equal(p.projectedDeficitCoverage, 0);
  assert.equal(p.projectedContributions, 100, 'the later receipt is not swept early; only the prior surplus landed');
});
test('a full400 goal cost and a routine deficit consume separate dollars once, from separate ledgers', () => {
  const x = deficitModel(); x.plan.commitments[0].date = '2026-11-04'; x.plan.commitments[0].amount = 400;
  const p = closing(advice(x), '2026-10-30');
  assert.equal(p.status, 'ready', p.reason); assert.equal(p.stock, 200); assert.equal(p.operatingCash, -180);
  assert.equal(p.projectedDraws, 400); assert.equal(p.projectedDeficitCoverage, 0);
  assert.ok(p.items.every(i => i.id !== 'a')); assert.equal(50000 + 10000 - 40000, 20000);
});
test('a full-goal cost is debited once from the pot even while Bills runs a visible deficit', () => {
  const x = deficitModel(); x.plan.commitments[0].date = '2026-11-04'; x.plan.commitments[0].amount = 500;
  x.plan.income[2].amount = 300; x.plan.income[2].date = '2026-11-10';
  const p = closing(advice(x), '2026-10-30');
  assert.equal(p.status, 'ready', p.reason); assert.equal(p.stock, 100);
  assert.equal(p.projectedDraws, 500); assert.equal(p.operatingCash, 120);
  assert.equal(p.gap.date, '2026-11-03'); assert.equal(p.gap.signedOperatingCash, -180);
  assert.equal(50000 + 10000 - 50000, 10000, 'the goal cost is paid from the pot exactly once; no coverage reuses the stock');
});
test('a later non-surplus receipt stays in Bills and grants no sweep of its own', () => {
  const x = deficitModel(); x.plan.income[2].amount = 100; x.plan.income[2].date = '2026-11-10';
  const p = closing(advice(x), '2026-10-30');
  assert.equal(p.status, 'ready', p.reason); assert.equal(p.stock, 600);
  assert.equal(p.operatingCash, -80); assert.equal(p.projectedDeficitCoverage, 0);
  assert.equal(p.contribution, 100, 'the contribution is the prior period surplus that landed on this payday');
  assert.equal(p.gap.date, '2026-11-03'); assert.equal(p.gap.shortBy, 200);
});
for (const operating of [80, 1000]) test('owner closing: goals due before the payday sweep leave a signed pot deficit until the sweep lands ' + operating, () => {
  // Supersedes the matrix owner-closing case (300 + 400 - 500 = 200 at the
  // first close), which was derived under sweep-at-close timing. Under the
  // 2026-10-14 payday sweep, goal a (500, due 2026-10-21) is debited before
  // the first period's 400 surplus lands on 2026-10-30, so both early closes
  // withhold at a signed -200; the position the matrix described (200, no
  // remaining requirements) is reached at the third close, independent of
  // the operating opening.
  const x = ownerModel(operating), a = advice(x);
  const first = closing(a, '2026-10-16'), second = closing(a, '2026-10-30'), third = closing(a, '2026-11-13');
  for (const p of [first, second]) {
    assert.equal(p.status, 'unavailable'); assert.equal(p.stock, null);
    assert.equal(p.diagnostics.signedSavings, -200); assert.deepEqual(p.items, []);
  }
  assert.equal(third.status, 'ready', third.reason); assert.equal(third.stock, 200);
  assert.equal(third.operatingCash, operating); assert.deepEqual(third.items, []);
  assert.equal(third.projectedDraws, 900); assert.equal(third.projectedContributions, 800);
  assert.equal(30000 - 50000, -20000); assert.equal(-20000 + 40000 - 40000, -20000);
  assert.equal(-20000 + 40000, 20000, 'the second sweep restores the pot once both goal costs are paid');
  assert.equal(a.savingsFunding.stock.amount, 300); assert.ok(x.plan.commitments.every(c => c.settledOn === undefined));
});
for (const operating of [80, 1000]) test('full signed Savings -200/-500 is not replaced by operating support ' + operating, () => {
  // Supersession: under sweep-at-close these closes signed -100/-400; the
  // payday sweep lands after goal a's date, so the signed pot carries the
  // full unpaid cost until the following payday.
  const a = advice(ownerModel(operating, 100));
  const first = closing(a, '2026-10-16'), second = closing(a, '2026-10-30');
  for (const [p, expected] of [[first, -200], [second, -500]]) {
    assert.equal(p.status, 'unavailable'); assert.equal(p.stock, null);
    assert.equal(p.diagnostics.signedSavings, expected);
    assert.deepEqual(p.items, []); assert.deepEqual(p.rows, []);
  }
  assert.equal(30000 - 50000, -20000); assert.equal(-20000 + 10000 - 40000, -50000);
});
test('positive signed closing arithmetic does not authorize a cost before its income arrives', () => {
  const x = ownerModel(); x.plan.income[1].date = '2026-10-24'; x.plan.commitments[0].date = '2026-10-16';
  const a = advice(x), p = closing(a, '2026-10-16');
  assert.equal(30000 - 50000, -20000, 'at the close the pot itself is signed negative: the funding income sweeps only on the next payday');
  assert.equal(p.diagnostics.signedSavings, -200);
  assert.equal(p.status, 'unavailable'); assert.equal(p.stock, null);
  assert.equal(p.gap.date, '2026-10-29'); assert.equal(p.gap.shortBy, 200);
  assert.equal(p.gap.cashFloor, 20);
  assert.equal(a.savingsFunding.period.status, 'ready', 'incumbent zero-tail condition is preserved');
});
test('two future periods of 1000 add exactly 2000 by the third close, spilling into the next requirement', () => {
  // Each period's surplus lands on the FOLLOWING payday, so the two 1000
  // surpluses complete at the third close, not the second (supersedes the
  // sweep-at-close pin, which completed at the second close).
  const a = advice(input()), first = closing(a, '2026-10-16'), second = closing(a, '2026-10-30'), third = closing(a, '2026-11-13');
  assert.equal(first.end, '2026-10-29'); assert.equal(first.stock, 119);
  assert.deepEqual(values(first), [11900, 0]);
  assert.deepEqual(first.rows.map(r => r.forecastContribution), [0, 0]);
  assert.equal(second.end, '2026-11-12'); assert.equal(second.stock, 1119);
  assert.deepEqual(values(second), [111900, 0]);
  assert.deepEqual(second.rows.map(r => r.forecastContribution), [1000, 0]);
  assert.equal(third.end, '2026-11-26'); assert.equal(third.stock, 2119);
  assert.deepEqual(values(third), [150000, 61900]);
  assert.deepEqual(third.rows.map(r => r.forecastContribution), [381, 619]);
  assert.equal(11900 + 100000 + 100000, 150000 + 61900);
  assert.equal(third.actualSaved, null); assert.equal(third.trust, 'estimated');
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
  assert.equal(p.stock, 1039); assert.deepEqual(values(p), [100000]);
  assert.equal(p.unallocated, 39); assert.equal(p.projectedDraws, 80);
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
  // Only the first period's surplus (1000 - 100 bill - 100 household hold
  // = 800) has landed by this close; the second period's surplus sweeps on
  // 2026-11-13. Supersedes the sweep-at-close pin of 1819 / [150000, 31900].
  assert.equal(p.stock, 919); assert.deepEqual(values(p), [91900, 0]);
  assert.equal(11900 + 80000, 91900);
});
test('deficit is covered only by native operating carry, preserving the floor and Savings', () => {
  const x = input(); x.plan.income[2].amount = 0;
  x.plan.commitments[0].date = '2027-01-03';
  x.plan.bills = [{ id: 'deficit', label: 'Invented deficit bill', frequency: 'once', date: '2026-11-03', amount: 20, confidence: 'confirmed' }];
  const p = closing(advice(x), '2026-10-30');
  assert.equal(p.stock, 1119); assert.equal(p.operatingCash, 60); assert.deepEqual(values(p), [111900, 0]);
});
test('later deficit no longer limits the payday sweep; the deficit is published instead', () => {
  // Supersedes the retention-search pin (Savings 1079 / Bills 20): the full
  // surplus sweeps and Bills closes at -20 with the shortfall on the packet.
  const x = input(); x.plan.income[2].amount = 0;
  x.plan.commitments[0].date = '2027-01-03';
  x.plan.bills = [{ id: 'deficit', label: 'Invented deficit bill', frequency: 'once', date: '2026-11-03', amount: 100, confidence: 'confirmed' }];
  const p = closing(advice(x), '2026-10-30');
  assert.equal(p.status, 'ready', p.reason);
  assert.equal(p.stock, 1119); assert.equal(p.operatingCash, -20); assert.equal(p.projectedDraws, 0);
  assert.equal(p.projectedDeficitCoverage, 0);
  assert.equal(p.gap.date, '2026-11-03'); assert.equal(p.gap.signedOperatingCash, -20); assert.equal(p.gap.shortBy, 40);
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
  assert.equal(p.stock, 1319); assert.deepEqual(values(p), [131900, 0]);
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
  const p = closing(advice(x), '2026-10-30'); assert.equal(p.stock, 1319);
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
  assert.equal(closing(a, '2026-10-30').stock, 1319);
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
  // Under the payday sweep the first close holds only the opening stock
  // less goal a: its own 200 surplus lands on 2026-10-30. That sweep, less
  // goal b, leaves the second close signed -100 and withheld; the third
  // carries -300. Affordable closes still publish (supersedes the
  // sweep-at-close pins 500 / 100 / gap 100).
  assert.equal(first.status, 'ready', first.reason); assert.equal(first.stock, 300);
  assert.deepEqual(first.items.map(i => [i.id, i.forecastSaved]), [['b', 300], ['c', 0]]);
  assert.equal(second.status, 'unavailable'); assert.equal(second.stock, null);
  assert.equal(second.diagnostics.signedSavings, -100);
  assert.equal(second.gap.date, '2026-11-12'); assert.equal(second.gap.shortBy, 100);
  const third = closing(a, '2026-11-13');
  assert.equal(third.status, 'unavailable'); assert.equal(third.stock, null);
  assert.equal(third.gap.date, '2026-11-26'); assert.equal(third.gap.shortBy, 300);
  assert.equal(third.gap.signedOperatingCash, -100); assert.equal(third.gap.cashFloor, 0);
  assert.deepEqual(third.items, []); assert.deepEqual(third.rows, []);
  assert.equal(80000 + 20000 + 20000 - 50000 - 60000 - 40000, -30000,
    'opening + the two landed sweeps - all three costs, no invented funding');
  assert.deepEqual(copy(closing(a, '2026-10-16')), copy(first));
});
test('operating support cannot zero-clamp a -300 signed Savings close', () => {
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
  assert.equal(p.diagnostics.signedSavings, -300); assert.equal(p.diagnostics.nativeOperatingCash, 0);
  assert.equal(10000 + 80000 + 60000 - 50000 - 60000 - 40000, 0, 'full 1500 expenses consume household cash once');
  assert.ok(x.plan.commitments.every(c => c.settledOn === undefined));
});
test('a ledger that only balances after the next payday sweep is withheld signed, not published as zero', () => {
  // Supersedes the sweep-at-close exact-zero pin: both goal costs land
  // before the second period's own surplus sweeps, so this close is a
  // signed -300 and withholds. The basis-string pin moved to the ample
  // carry control above.
  const x = ownerModel(1000, 300);
  x.plan.commitments[1].amount = 400;
  const a = advice(x), p = closing(a, '2026-10-30');
  assert.equal(30000 + 30000 - 50000 - 40000, -30000);
  assert.equal(p.status, 'unavailable'); assert.equal(p.stock, null);
  assert.equal(p.diagnostics.signedSavings, -300);
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
  assert.equal(p.status, 'ready', p.reason); assert.equal(p.stock, 600);
  assert.equal(p.projectedDraws, 1100, 'the annual bill and both goal costs are each debited exactly once');
  assert.equal(30000 + 100000 - 20000 + 40000 - 50000 - 40000, 60000,
    'the second period surplus (400) has not swept yet; it lands 2026-11-13');
  assert.equal(a.savingsFunding.period.alreadySavedIncome, destination === 'savings' ? 1000 : 0);
});
test('a future annual goal already deducted by Budget is not subtracted a second time', () => {
  const x = ownerModel(); x.plan.commitments.shift();
  x.plan.bills = [{ id: 'a', label: 'Invented annual goal', frequency: 'yearly', month: 10, day: 21,
    firstDue: '2026-10-21', amount: 500, confidence: 'confirmed', jointCash: false }];
  const a = advice(x);
  // The annual goal (500, 2026-10-21) and commitment b (400, 2026-11-04)
  // both land before the surpluses that fund them sweep, so the first two
  // closes withhold at a signed -200; by the third close each cost has been
  // debited exactly once and the pot is the same 200 the old pin published.
  for (const start of ['2026-10-16', '2026-10-30']) { const p = closing(a, start);
    assert.equal(p.status, 'unavailable'); assert.equal(p.stock, null);
    assert.equal(p.diagnostics.signedSavings, -200); }
  const third = closing(a, '2026-11-13');
  assert.equal(third.status, 'ready', third.reason); assert.equal(third.stock, 200);
  assert.equal(third.projectedDraws, 900);
  assert.equal(30000 + 40000 + 40000 - 50000 - 40000, 20000);
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
  for (const [start, signedOp] of [['2026-10-16', -100], ['2026-10-30', -200]]) {
    const p = closing(a, start); assert.equal(p.stock, null); assert.equal(p.status, 'unavailable');
    assert.equal(p.gap.signedOperatingCash, signedOp,
      'the closing-day native cash is a diagnostic, not published Savings (the second close now reports its own day, not the earliest breach)');
  }
});
test('installment groups retain only future members, then disappear at the final payment close', () => {
  const x = installments(), a = advice(x), current = a.savingsFunding;
  assert.deepEqual(current.backing.items.map(i => [i.id, i.saved]), [['one', 80], ['two', 39], ['later', 0]]);
  const first = closing(a, '2026-10-16'), second = closing(a, '2026-10-30');
  assert.equal(first.stock, 39); assert.equal(first.projectedDraws, 80);
  assert.deepEqual(first.items.map(i => [i.id, i.forecastSaved]), [['two', 39], ['later', 0]]);
  assert.deepEqual(first.rows.find(r => r.key === 'group:installments').members, ['two@2026-11-12']);
  assert.equal(second.stock, 979); assert.equal(second.projectedDraws, 140);
  assert.deepEqual(second.items.map(i => [i.id, i.forecastSaved]), [['later', 979]]);
  assert.ok(!second.rows.some(r => r.key === 'group:installments'));
  assert.equal(11900 + 100000 - 8000 - 6000, 97900, 'both costs consumed once, exact cents; only the first surplus has landed');
  assert.deepEqual(current.backing.items.map(i => [i.id, i.saved]), [['one', 80], ['two', 39], ['later', 0]]);
  assert.ok(x.plan.commitments.every(c => c.settledOn === undefined), 'date passage never creates actual settlement');
});
for (const [date, present, stock] of [['2026-10-28', false, 39], ['2026-10-29', false, 39], ['2026-10-30', true, 119]])
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
    assert.equal(second.stock, 1039); assert.equal(second.projectedDraws, 80);
    assert.deepEqual(copy(a.savingsFunding), before);
  });
