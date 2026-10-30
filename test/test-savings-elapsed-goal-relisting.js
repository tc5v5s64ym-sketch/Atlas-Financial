'use strict';
// PA-3 (Decision 1 retirement; Muse ruling on #787): a goal whose date has
// passed stops being re-listed in LATER projected periods' planned
// requirements, and stays visible in the current period as unpaid until
// settlement evidence exists. Relisting only: the closing-basis gate is
// unchanged, so this is not evidence that an unpaid past requirement cleared.
// Synthetic roster fixture; expectations are literal ids.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const F = require(path.join(process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..'), 'public/forecast'));
const make = require('./fixtures/savings-selected-roster-data');

// asOf 2026-10-07. 'early' moved to 2026-10-06 (elapsed, unpaid); 'boundary'
// 2026-10-29, 'next' 2026-10-30 and 'later' 2026-11-13 remain future-dated.
function run(mutate) {
  const x = make('card');
  x.plan.commitments[0].date = '2026-10-06';
  if (mutate) mutate(x);
  const before = JSON.stringify(x);
  const advice = F.recommend(x.plan, x.asOf, { ...x.opts, weeklyVariable: 0, debts: [] });
  assert.equal(JSON.stringify(x), before, 'no input mutation');
  return { x, advice };
}
function packet(r, start) {
  const period = r.advice.payPeriodViews.find(p => p.start === start);
  return F.savingsFundingPublication(r.advice.savingsFunding, { asOf: r.x.asOf, advice: r.advice, periodId: period.id });
}
const plannedIds = p => p.plannedRequirements.items.map(i => i.id);
const LATER = ['2026-10-16', '2026-10-30', '2026-11-13'];

test('an elapsed unpaid goal is not re-listed in any later projected period', () => {
  const r = run();
  for (const start of LATER) {
    const p = packet(r, start);
    assert.ok(p && p.plannedRequirements, `${start}: planned requirements published`);
    assert.ok(!plannedIds(p).includes('early'), `${start}: elapsed 'early' retired from this later period`);
    for (const row of p.plannedRequirements.rows) {
      assert.ok(!row.members.some(key => key.startsWith('early@')), `${start}: no row keeps the elapsed member`);
    }
  }
});

test('only future-dated goals are listed in later periods', () => {
  const r = run();
  assert.deepEqual(plannedIds(packet(r, '2026-10-16')).sort(), ['later', 'next']);
  assert.deepEqual(plannedIds(packet(r, '2026-10-30')), ['later']);
});

test('the elapsed goal stays visible in the current period as unpaid, never marked paid', () => {
  const r = run();
  const item = r.advice.savingsFunding.backing.items.find(i => i.id === 'early');
  assert.ok(item, 'current backing still carries the elapsed goal');
  assert.notEqual(item.paymentStatus, 'paid', 'relisting never claims settlement');
  assert.ok(r.advice.savingsFunding.rows.some(row => row.members.includes('early@2026-10-06')),
    'current goal rows still show it');
});

// Not a test of the unpaid-past-requirement gate itself: in this fixture an
// earlier hold withholds the close first. It only pins that relisting does
// not release a withheld close. The gate is covered by the daily-allocation
// contract and external-alias suites.
test('relisting does not release a withheld future close', () => {
  const r = run();
  for (const start of LATER) {
    const c = packet(r, start).forecastClosing;
    assert.equal(c && c.status, 'unavailable', `${start}: still withheld after relisting`);
  }
});

test('a future goal matched by its planned payment still drops out of later periods (incumbent rule)', () => {
  const r = run(x => { x.plan.commitments[0].date = '2026-10-21'; });
  assert.deepEqual(plannedIds(packet(r, '2026-10-30')), ['later'], 'native-expense retirement unchanged');
});

// Boundaries: retirement is measured against asOf, not the viewed period.
// A ranged item never matches one planned payment, so only the new guard
// can retire it. Dated exactly asOf it has not elapsed; dated after asOf
// but before a later period it is not retired by this change either.
function ranged(date) {
  return x => { const cm = x.plan.commitments[0]; cm.date = date; delete cm.amount; cm.amountMin = 40; cm.amountMax = 60; };
}
test('boundary: a requirement dated exactly asOf is not retired', () => {
  const r = run(ranged('2026-10-07'));
  for (const start of LATER) assert.ok(plannedIds(packet(r, start)).includes('early'), `${start}: dated asOf stays listed`);
});
test('boundary: a requirement dated after asOf is measured against asOf, not the viewed period start', () => {
  const r = run(ranged('2026-10-10'));
  assert.ok(plannedIds(packet(r, '2026-10-16')).includes('early'), 'dated before this period but after asOf: still listed');
});
test('boundary: the same ranged requirement dated one day before asOf is retired', () => {
  const r = run(ranged('2026-10-06'));
  for (const start of LATER) assert.ok(!plannedIds(packet(r, start)).includes('early'), `${start}: elapsed ranged item retired`);
});
