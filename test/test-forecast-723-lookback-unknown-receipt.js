'use strict';
// #723 gap (5), failing-before reproduction (test-only; Atlas: STILL BROKEN).
// Finding of record: #723 comment 6523977278.
//
// A scheduled receipt with an unknown amount must stay unknown in every
// published period view. In the ACTIVE period it does (incomeTotal null,
// trust unavailable, reason published). Once the same period becomes a
// sealed LOOKBACK, it publishes as a calculated zero, indistinguishable from
// a genuine zero, and the receipt row is dropped. Suspected cause: the
// `!lookback` short-circuit on incomeLoadUnknown (public/forecast.js ~11784).
//
// The lookback assertions below FAIL on main 860328fc by design; the
// controls (active-period unknown, genuine zero, known amount) pass. This file
// is deliberately not registered in test/test.js until a repair lands.
// All amounts are invented. Expected values are literal arithmetic.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const F = require(path.join(process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..'), 'public/forecast'));

// Seaspan biweekly anchor 2026-10-02 → periods Oct 2–15, Oct 16–29, Oct 30–Nov 12.
// One synthetic receipt dated Oct 16 (inside Oct 16–29); one bill of 120 on Oct 20.
function plan(asOf, snapshotStart, receiptAmount) {
  return {
    windowDays: 120,
    defaults: { targetBuffer: 0, extraDebtMonthly: 0, scenario: 'expected' },
    opening: {
      asOf,
      paydaySnapshot: { periodStart: snapshotStart, asOf: snapshotStart, opening: 50 },
      representedEvents: [{ id: 'payroll', date: snapshotStart }],
    },
    startingCash: { breakdown: [{ id: 'chequing-a', value: 50 }] },
    income: [
      { id: 'payroll', frequency: 'biweekly', anchor: '2026-10-02', amount: 0, confidence: 'confirmed' },
      { id: 'r1', label: 'Synthetic receipt', frequency: 'once', date: '2026-10-16', amount: receiptAmount, confidence: 'confirmed' },
    ],
    bills: [{ id: 'b1', label: 'Synthetic bill', frequency: 'once', date: '2026-10-20', amount: 120, confidence: 'confirmed' }],
    obligations: [], commitments: [], budget: { categories: [] },
  };
}
function period(asOf, snapshotStart, receiptAmount, viewsKey = 'payPeriodViews') {
  const p = plan(asOf, snapshotStart, receiptAmount), before = JSON.stringify(p);
  const advice = F.recommend(p, asOf, { weeklyVariable: 0, debts: [] });
  assert.equal(JSON.stringify(p), before, 'no input mutation');
  return (advice[viewsKey] || []).find(v => v && v.start === '2026-10-16') || null;
}
const ACTIVE = ['2026-10-20', '2026-10-16'];   // Oct 16–29 is the active period
const LOOKBACK = ['2026-11-05', '2026-10-30']; // Oct 16–29 is now a sealed lookback

test('control: in the ACTIVE period an unknown receipt amount is published as unknown', () => {
  const v = period(...ACTIVE, null);
  assert.ok(v, 'period exists');
  assert.equal(v.incomeTotal, null);
  assert.equal(v.incomeTrust, 'unavailable');
  assert.equal(v.balanceAfterDeductions, null);
  assert.match(String(v.incomeUnavailableReason || ''), /income-unavailable/);
});

for (const viewsKey of ['payPeriodViews', 'pastPeriodViews']) {
  test(`#723 gap 5 (${viewsKey}): a sealed LOOKBACK must not publish an unknown receipt as a calculated zero`, () => {
    const v = period(...LOOKBACK, null, viewsKey);
    assert.ok(v, 'lookback period exists');
    assert.notEqual(v.incomeTrust, 'calculated', 'unknown income must not be tagged calculated');
    assert.equal(v.incomeTotal, null, 'incomeTotal stays unknown, not 0');
    assert.equal(v.balanceAfterDeductions, null, 'balance after deductions stays unknown, not 0 - 120');
    assert.equal(v.predictedEndingBalance ?? null, null, 'predicted ending withheld');
    assert.match(String(v.incomeUnavailableReason || ''), /income-unavailable/, 'the reason is published');
  });
}

test('control: a genuine zero receipt in the LOOKBACK stays a trusted zero', () => {
  const v = period(...LOOKBACK, 0);
  assert.equal(v.incomeTotal, 0);
  assert.equal(v.incomeTrust, 'calculated');
  assert.equal(Math.round(v.balanceAfterDeductions * 100), -12000); // 0 - 120
  assert.ok(!v.incomeUnavailableReason);
});

test('control: a known receipt in the LOOKBACK is published with its amount', () => {
  const v = period(...LOOKBACK, 500);
  assert.equal(v.incomeTotal, 500);
  assert.equal(v.incomeTrust, 'calculated');
  assert.equal(Math.round(v.balanceAfterDeductions * 100), 38000); // 500 - 120
});
