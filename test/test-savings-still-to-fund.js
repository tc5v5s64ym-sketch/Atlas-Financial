'use strict';
// PA-2 (Decision 2, owner 2026-10-29): each goal row publishes
// Still to fund = max(0, Needed - Saved), tagged estimated, in current and
// future periods, only when both inputs are known; never presented as
// verified and never an unpaid balance. Paid is unchanged.
// All ledgers and literal expected cents are independently invented.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const F = require(path.join(process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..'), 'public/forecast'));
const input = require('./fixtures/savings-future-closing-data');

function scenario() {
  const x = input();
  x.plan.income.push({ id: 'p0', label: 'Invented current receipt', frequency: 'once',
    date: '2026-10-09', amount: 400, confidence: 'confirmed' });
  return x;
}
function advice(x) {
  const before = JSON.stringify(x);
  const result = F.recommend(x.plan, x.asOf, { ...x.opts, weeklyVariable: 0, debts: [] });
  assert.equal(JSON.stringify(x), before, 'no input mutation');
  return result;
}
const cents = n => Math.round(n * 100);
function assertGap(row, label) {
  assert.ok('stillToFund' in row, `${label}: Still to fund is published`);
  assert.equal(row.stillToFundTrust, 'estimated', `${label}: tagged estimated, never verified`);
  assert.equal(cents(row.stillToFund), Math.max(0, cents(row.needed) - cents(row.savedForGap)),
    `${label}: max(0, Needed - Saved)`);
}

test('current period: each goal row publishes Still to fund = max(0, Needed - Saved), estimated', () => {
  const a = advice(scenario());
  const rows = a.savingsFunding.rows;
  assert.ok(rows.length >= 2);
  const byKey = Object.fromEntries(rows.map(r => [r.key, r]));
  // Hand-derived from the invented ledger: reported 119 is allocated to the
  // earlier goal first.
  assert.equal(cents(byKey['commitment:a'].stillToFund), 150000 - 11900); // 1381.00
  assert.equal(cents(byKey['commitment:b'].stillToFund), 100000);         // nothing saved yet
  for (const r of rows) assertGap({ ...r, savedForGap: r.saved }, r.key);
});

test('future periods: Still to fund follows the period close, estimated, never negative', () => {
  const a = advice(scenario());
  let readyCloses = 0;
  for (const view of a.savingsFunding.periodViews.filter(p => p.start > a.savingsFunding.asOf)) {
    const p = F.savingsFundingPublication(a.savingsFunding, { asOf: a.savingsFunding.asOf, advice: a, periodId: view.id });
    const c = p?.forecastClosing;
    if (c?.status !== 'ready') continue;
    readyCloses++;
    for (const r of [...c.rows, ...c.items]) {
      assertGap({ ...r, savedForGap: r.forecastSaved }, `${view.start} ${r.key}`);
      assert.ok(r.stillToFund >= 0);
    }
  }
  assert.ok(readyCloses >= 2, 'fixture: at least two ready future closes are actually checked');
});

// Pre-review finding: rows copied from today's packet must never carry
// today's numeric gap beside a historical or projected period's null Saved.
test('non-current packets never carry today\'s gap: rows, items and planned requirements are unknown', () => {
  for (const x of [scenario(), (() => { const y = input(); y.opts.currentPeriodActuals.coverageStart = '2026-10-20'; return y; })()]) {
    const a = advice(x);
    let checked = 0;
    for (const view of a.savingsFunding.periodViews.filter(v => v.packet)) {
      const p = view.packet;
      const lists = [p.rows, p.backing.items, p.unresolved, p.plannedRequirements?.items, p.plannedRequirements?.rows]
        .filter(Array.isArray);
      for (const r of lists.flat()) {
        if (r.saved !== null && r.saved !== undefined) continue;
        checked++;
        assert.equal(r.stillToFund, null, `${view.start} ${r.key}: no gap beside an unknown Saved`);
        assert.equal(r.stillToFundTrust, 'unknown', `${view.start} ${r.key}: trust unknown`);
      }
    }
    assert.ok(checked > 0, 'fixture: non-current packet rows were actually checked');
  }
});

test('current per-goal items and lens items carry Still to fund beside their Saved', () => {
  const a = advice(scenario());
  const item = a.savingsFunding.backing.items.find(i => i.id === 'a');
  // Hand-derived: 1,500 needed, 119 reported Saved on the earlier goal.
  assert.equal(item.saved, 119);
  assert.equal(cents(item.stillToFund), 150000 - 11900);
  assert.equal(item.stillToFundTrust, 'estimated');
  const lens = a.savingsFunding.lenses.find(l => l.key === 'today').items.find(i => i.requirementId === 'a');
  assert.equal(cents(lens.stillToFund), 150000 - 11900);
  assert.equal(lens.stillToFundTrust, 'estimated');
});

test('a goal fully saved shows zero Still to fund, not Unknown', () => {
  const a = advice(scenario());
  const view = a.savingsFunding.periodViews.find(p => p.start === '2026-10-30');
  const c = F.savingsFundingPublication(a.savingsFunding, { asOf: a.savingsFunding.asOf, advice: a, periodId: view.id }).forecastClosing;
  const goal = c.rows.find(r => r.key === 'commitment:a');
  assert.equal(cents(goal.forecastSaved), cents(goal.needed), 'fixture: goal a fully saved by this close');
  assert.equal(goal.stillToFund, 0);
  assert.equal(goal.stillToFundTrust, 'estimated');
});

test('unknown inputs publish no figure: ranged need or unavailable Saved stays null', () => {
  const x = scenario();
  const c = x.plan.commitments.find(row => row.id === 'b');
  delete c.amount; c.amountMin = 800; c.amountMax = 1200;
  const a = advice(x);
  const byKey = Object.fromEntries(a.savingsFunding.rows.map(r => [r.key, r]));
  // Ranged need: no point gap is invented, and the reason names the input.
  const ranged = byKey['commitment:b'];
  assert.ok(ranged && Object.hasOwn(ranged, 'stillToFund'), 'the ranged goal row carries the field');
  assert.equal(ranged.needed, null);
  assert.equal(ranged.stillToFund, null, 'ranged need: no point gap invented');
  assert.equal(ranged.stillToFundTrust, 'unknown');
  assert.match(ranged.stillToFundReason, /needed is not a known point value/);
  // The same packet withholds Saved for the other goal: missing Saved is not 0.
  const noSaved = byKey['commitment:a'];
  assert.equal(noSaved.saved, null);
  assert.equal(noSaved.stillToFund, null, 'missing Saved never becomes a full-need gap');
  assert.equal(noSaved.stillToFundTrust, 'unknown');
  assert.match(noSaved.stillToFundReason, /amount saved for this goal is not known/);
});

test('a withheld packet that still publishes Saved publishes Still to fund beside it, estimated', () => {
  const x = input();
  x.opts.currentPeriodActuals.coverageStart = '2026-10-20';
  const a = advice(x);
  assert.equal(a.savingsFunding.status, 'unavailable', 'fixture: current funding packet withheld');
  const byKey = Object.fromEntries(a.savingsFunding.rows.map(r => [r.key, r]));
  // Hand-derived: reported 119 sits on the earlier goal; nothing on the later one.
  assert.equal(byKey['commitment:a'].saved, 119);
  assert.equal(cents(byKey['commitment:a'].stillToFund), 150000 - 11900);
  assert.equal(cents(byKey['commitment:b'].stillToFund), 100000);
  for (const r of a.savingsFunding.rows) {
    assert.equal(r.stillToFundTrust, 'estimated', `${r.key}: estimated, never verified or calculated`);
    assert.equal(r.stillToFundReason, null);
  }
});

test('Paid is unchanged by Decision 2', () => {
  const a = advice(scenario());
  for (const r of a.savingsFunding.rows) {
    if (!r.commitmentCost) continue;
    assert.notEqual(r.commitmentCost.confirmedLinkedPaid?.status, 'estimated', 'Paid is never estimated by this change');
  }
});
