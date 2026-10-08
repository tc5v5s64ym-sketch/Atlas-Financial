'use strict';
// Prospective RED acceptance specification; no production implementation.
// Run: node chronological-savings-acceptance.cjs <coordinated-checkout-root>
// Literal expected cents below were invented independently of Forecast.
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const repo = path.resolve(process.argv[2] || '.');
const F = require(path.join(repo, 'public', 'forecast.js'));
const fx = require(path.join(repo, 'test', 'fixtures', 'savings-daily-allocation-contract.js'));
const cents = n => {
  assert.equal(typeof n, 'number', 'unknown is not zero');
  assert.ok(Number.isFinite(n));
  return Math.round(n * 100);
};

function fixture() {
  const input = fx.advance(fx.fixture(), '2026-10-07');
  input.plan.savingsPoolObservation.accounts[0].value = 30;
  input.plan.savingsPoolObservation.accounts[1].value = 89;
  input.plan.startingCash.breakdown.find(r => r.id === 'savings').value = 30;
  input.plan.startingCash.heldElsewhere.find(r => r.id === 'savings-dont-touch').value = 89;
  // Proposed narrow owner-policy representation in the existing plan block.
  // If the reviewed implementation chooses different public keys, adjust this
  // adapter only; the allocation oracle and safety assertions stay unchanged.
  input.plan.savingsEarmarks.allocationPolicy = {
    order: 'due-date-first-combined-pool',
    effectiveFrom: '2026-10-07',
    source: 'Independent synthetic owner instruction',
  };
  delete input.opts.savingsAllocationPolicy; // no page-side policy authority
  return input;
}

function publish(input) {
  const before = JSON.stringify(input);
  const advice = F.recommend(input.plan, input.asOf, { ...input.opts, debts: input.debts || [] });
  assert.equal(JSON.stringify(input), before, 'calculation must not mutate balances, history or settlement');
  assert.ok(advice.savingsFunding, 'one sealed Forecast.recommend.savingsFunding publication is required');
  const packet = advice.savingsFunding;
  assert.equal(packet.source, 'Forecast.savingsDailyFunding');
  assert.equal(packet.asOf, input.asOf);
  assert.equal(packet.currency, 'CAD');
  assert.equal(packet.actionPermission, 'not-granted');
  assert.equal(packet.moneyMovementPermission, 'not-granted');
  return packet;
}
const items = p => p.backing.items;
function allocated(p) {
  assert.equal(p.backing.status, 'ready');
  return items(p).map(r => [r.id, cents(r.saved)]);
}
function oracle(p, values, stock, residual = 0) {
  assert.deepEqual(allocated(p), values, 'global chronological exact-cent allocation');
  assert.equal(cents(p.stock.amount), stock);
  const assigned = items(p).reduce((sum, r) => sum + cents(r.saved), 0);
  assert.equal(assigned + residual, stock, 'stock is allocated once');
  let partial = false;
  for (const row of items(p)) {
    const saved = cents(row.saved), need = cents(row.needed);
    assert.ok(saved >= 0 && saved <= need);
    if (partial) assert.equal(saved, 0, 'later costs cannot pass an unfunded earlier cost');
    if (saved < need) partial = true;
  }
}

test('one jar crosses sports/home locations: 119 = 60 + 24 + 35', () => {
  oracle(publish(fixture()), [['near', 6000], ['home-cost', 2400], ['far', 3500]], 11900);
});

test('ten deposited into either account fills the same next gap', () => {
  const outcomes = ['savings', 'savings-dont-touch'].map(destination => {
    const p = publish(fx.transfer(fixture(), 10, 'DEPOSIT10', destination));
    oracle(p, [['near', 6000], ['home-cost', 2400], ['far', 4500]], 12900);
    return allocated(p);
  });
  assert.deepEqual(outcomes[0], outcomes[1]);
});

test('account/pool/reference array order is not allocation authority', () => {
  const input = fixture();
  input.plan.savingsEarmarks.pools.reverse();
  input.plan.savingsPoolObservation.accounts.reverse();
  input.plan.savingsEarmarks.pools.forEach(p => p.goalRefs.reverse());
  oracle(publish(input), [['near', 6000], ['home-cost', 2400], ['far', 3500]], 11900);
});

test('all 119 in home still funds the earlier sports occurrence', () => {
  const input = fixture();
  input.plan.savingsPoolObservation.accounts[0].value = 0;
  input.plan.savingsPoolObservation.accounts[1].value = 119;
  input.plan.startingCash.breakdown.find(r => r.id === 'savings').value = 0;
  input.plan.startingCash.heldElsewhere.find(r => r.id === 'savings-dont-touch').value = 119;
  oracle(publish(input), [['near', 6000], ['home-cost', 2400], ['far', 3500]], 11900);
});

test('partial cents and replacement redraw do not accrue another allocation', () => {
  const input = fixture();
  input.plan.savingsPoolObservation.accounts[0].value = 24.37;
  input.plan.startingCash.breakdown.find(r => r.id === 'savings').value = 24.37;
  const first = publish(input), second = publish(input);
  oracle(first, [['near', 6000], ['home-cost', 2400], ['far', 2937]], 11337);
  assert.deepEqual(first, second);
  assert.equal(input.plan.savingsEarmarks.history.length, 0);
});

test('new earlier cost moves the frontier without a new balance or duplicate pledge', () => {
  const input = fixture();
  input.plan.commitments.push({ id: 'earlier', label: 'Invented earlier cost',
    date: '2026-10-20', amount: 5, confidence: 'confirmed', sinkingFund: true });
  oracle(publish(input), [['earlier', 500], ['near', 6000], ['home-cost', 2400], ['far', 3000]], 11900);
});

test('unlinked trip enters once; pool goalRefs cannot hide an eligible cost', () => {
  const input = fixture();
  input.plan.commitments.push({ id: 'trip', label: 'Invented future trip',
    date: '2026-11-10', amount: 37, confidence: 'confirmed', sinkingFund: true });
  const p = publish(input);
  oracle(p, [['near', 6000], ['home-cost', 2400], ['far', 3500], ['trip', 0]], 11900);
  assert.equal(items(p).filter(r => r.id === 'trip').length, 1);
  assert.equal(items(p).reduce((sum, r) => sum + cents(r.needed) - cents(r.saved), 0), 17200);
});

test('property-tax reserve joins the same pot, without duplicate commitment', () => {
  const input = fixture();
  input.plan.budget.categories.push({ id: 'tax-cost', label: 'Invented tax cost',
    class: 'reserve', plannedAmount: 50, planningDate: '2026-10-24', confidence: 'estimated' });
  const p = publish(input);
  oracle(p, [['near', 6000], ['tax-cost', 5000], ['home-cost', 900], ['far', 0]], 11900);
  assert.equal(items(p).filter(r => r.id === 'tax-cost').length, 1);
  assert.ok(!input.plan.commitments.some(r => r.id === 'tax-cost'));
});

test('group/direct aliases do not double-fund member; group aggregates engine cents', () => {
  const input = fixture();
  input.plan.savingsEarmarks.pools[0].goalRefs.push({ kind: 'commitment', id: 'near' });
  const p = publish(input);
  oracle(p, [['near', 6000], ['home-cost', 2400], ['far', 3500]], 11900);
  const club = p.rows.find(r => r.key === 'group:club');
  assert.ok(club);
  assert.equal(cents(club.saved), 9500);
  assert.equal(cents(club.needed), 23000);
});

test('settled commitment is absent from unpaid queue; original history persists', () => {
  const input = fixture();
  input.plan.commitments[0].settledOn = '2026-10-04';
  const p = publish(input);
  oracle(p, [['home-cost', 2400], ['far', 9500]], 11900);
  assert.ok(!items(p).some(r => r.id === 'near'));
  assert.ok(!F.expandEvents(input.plan, input.asOf, '2026-11-10', input.opts)
    .some(r => r.id === 'near'), 'paid cost cannot create a duplicate future payment');
  assert.equal(input.plan.commitments[0].settledOn, '2026-10-04');
  assert.equal(input.plan.commitments[0].amount, 60);
});

test('business/Bills/credit capacity are not savings stock', () => {
  const input = fixture();
  input.plan.startingCash.heldElsewhere.push({ id: 'amanda-debt-payments',
    label: 'Invented business account', class: 'operational', value: 5000 });
  input.plan.startingCash.breakdown[0].value += 500;
  input.plan.opening.paydaySnapshot.opening += 500;
  oracle(publish(input), [['near', 6000], ['home-cost', 2400], ['far', 3500]], 11900);
});

test('missing one savings account does not publish a partial pool or zero backing', () => {
  const input = fixture(); input.plan.savingsPoolObservation.accounts.pop();
  const p = publish(input);
  assert.equal(p.backing.status, 'unavailable');
  assert.equal(items(p).length, 3, 'missing stock does not hide known requirements');
  assert.ok(items(p).every(r => r.saved === null));
});

test('stale or pending observation cannot become current backed allocation', () => {
  for (const mode of ['stale', 'pending', 'currency', 'duplicate', 'fractional']) {
    const input = fixture(), rows = input.plan.savingsPoolObservation.accounts;
    if (mode === 'stale') rows[1].evidenceDate = '2026-10-06';
    if (mode === 'pending') rows[1].pendingState = 'unresolved';
    if (mode === 'currency') rows[1].currency = 'USD';
    if (mode === 'duplicate') rows.push({ ...rows[0] });
    if (mode === 'fractional') rows[0].value = 30.001;
    const p = publish(input);
    assert.equal(p.backing.status, 'unavailable', mode);
    assert.equal(items(p).length, 3, mode + ': known requirement roster survives');
    assert.ok(items(p).every(r => r.saved === null), mode);
  }
});

test('undated requirement stays explicit protected unknown, never dated by allocator', () => {
  const input = fixture();
  input.plan.commitments.push({ id: 'undated', label: 'Invented undated hold',
    amount: 17, when: 'TBD', confidence: 'estimated', sinkingFund: true });
  const p = publish(input);
  const held = p.unresolved.find(r => r.id === 'undated');
  assert.ok(held); assert.equal(held.date, null);
  assert.equal(held.saved, null);
  assert.equal(held.contribution, null);
  assert.ok(!items(p).some(r => r.id === 'undated' && r.date));
});

test('savings current stock never fabricates confirmed transfers or actual period fulfillment', () => {
  const p = publish(fixture());
  assert.equal(p.backing.actualTransferred, null);
  assert.equal(p.period.actualSaved, null);
  assert.ok(p.rows.every(r => r.actualContribution == null));
});

test('future modelled income is not observed savings before its arrival', () => {
  const input = fixture();
  input.plan.income.push({ id: 'future-gift', label: 'Invented future receipt',
    frequency: 'once', date: '2026-11-02', amount: 77, confidence: 'estimated' });
  oracle(publish(input), [['near', 6000], ['home-cost', 2400], ['far', 3500]], 11900);
});

