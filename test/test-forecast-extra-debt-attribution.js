// AMANDA SLICE 13 — EXTRA-DEBT TARGET ATTRIBUTION (ENGINE).
//
// Independent proof that the coupled debt walk records where each monthly
// extra payment actually goes, from the existing payDown cascade — never
// by replaying priority logic afterward. The walk publishes
// extraDebtAllocation[date] = { allocations, nextTarget }; the trajectory
// joins it onto stage3.extras per pay-period span.
//
// Independence: the tests cross-check the allocation record against two
// other walk outputs (extraAbsorbed totals and byId[debt].paid) instead of
// calling the recording code twice, and assert cascade-only facts a
// replay could not know (interest-accrued takes above the opening
// balance, residual flow into the next debt).
//
// Run: node test/test-forecast-extra-debt-attribution.js

'use strict';

const assert = require('node:assert/strict');
const F = require('../public/forecast.js');

let failures = 0;
const ok = (condition, label) => {
  if (!condition) failures++;
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}`);
};
const eq = (actual, expected, label) => ok(
  actual === expected, `${label}: ${JSON.stringify(actual)} / expected ${JSON.stringify(expected)}`);
const near = (actual, expected, label) => ok(
  Number.isFinite(actual) && Math.abs(actual - expected) < 0.005,
  `${label}: ${actual} / expected ${expected}`);

const START = '2026-01-01';

function plan(extra) {
  return Object.assign({
    windowDays: 91,
    startingCash: { amount: 5000 },
    defaults: { targetBuffer: 0 },
    income: [], obligations: [], bills: [], commitments: [],
    opening: { asOf: START },
    nextDollar: {
      policy: 'true-surplus-highest-interest',
      eligibleDebts: 'revolving-cards-and-heloc',
      provenance: 'owner-stated',
    },
  }, extra || {});
}

function card(id, label, balance, rate, confidence) {
  return {
    id, label, structure: 'Revolving card',
    balance, pending: 0, rate, minimumPayment: 25, paymentDay: 15,
    confidence: confidence || 'verified',
  };
}

function walk(debts, extraDebtMonthly, opts) {
  return F.projectDebts(plan(), debts, START, Object.assign({
    extraDebtMonthly, debtHorizonDays: 120,
  }, opts || {}));
}

// The allocation record must be an exact reprint of what the cascade
// applied: per debt, the rounded allocation lines across all event dates
// equal that debt's independently recorded paid total (no obligations in
// these fixtures, so paid comes only from extras), and per date the
// lines sum to the independently recorded absorbed total.
function assertReprint(w, label) {
  const byDebt = {};
  for (const date of Object.keys(w.extraDebtAllocation)) {
    const rec = w.extraDebtAllocation[date];
    const lineSum = rec.allocations.reduce((s, l) => s + l.amount, 0);
    near(lineSum, w.extraAbsorbed[date],
      `${label} ${date}: allocation lines sum to absorbed total`);
    for (const line of rec.allocations) {
      byDebt[line.debtId] = (byDebt[line.debtId] || 0) + line.amount;
    }
  }
  for (const id of Object.keys(byDebt)) {
    near(byDebt[id], Math.round(w.byId[id].paid * 100) / 100,
      `${label}: ${id} allocation lines reprint walk paid total`);
  }
}

console.log('multi-target split comes from the cascade, in priority order');
{
  const debts = [
    card('tri', 'Triangle Mastercard', 200, 19.99),
    card('mbna', 'MBNA Mastercard', 5000, 12.99),
  ];
  const w = walk(debts, 1000);
  eq(w.extraDebtPriority.status, 'ready', 'priority ready');
  eq(w.extraDebtPriority.target.id, 'tri', 'policy head is tri');
  const dates = Object.keys(w.extraDebtAllocation).sort();
  eq(dates[0], '2026-01-15', 'first extra event recorded');
  const first = w.extraDebtAllocation['2026-01-15'];
  eq(first.allocations.length, 2, 'one payment spans two debts');
  eq(first.allocations[0].debtId, 'tri', 'first line is the priority head');
  eq(first.allocations[1].debtId, 'mbna', 'residual flows to the next debt');
  eq(first.allocations[0].label, 'Triangle Mastercard', 'Forecast-owned label reprinted');
  eq(first.allocations[0].status, 'calculated', 'verified balances calculate');
  // Cascade-only fact: tri's take exceeds its opening balance because the
  // walk applied the payment against the interest-accrued balance. A
  // min(extra, opening) replay would have recorded exactly 200.00.
  ok(first.allocations[0].amount > 200,
    `tri take reflects accrued interest (${first.allocations[0].amount} > 200 opening)`);
  near(first.allocations[0].amount + first.allocations[1].amount, 1000,
    'lines sum to the full monthly extra');
  assertReprint(w, 'multi-target');
}

console.log('target shifts across periods as debts clear');
{
  const debts = [
    card('tri', 'Triangle Mastercard', 200, 19.99),
    card('mbna', 'MBNA Mastercard', 5000, 12.99),
  ];
  const w = walk(debts, 1000);
  const second = w.extraDebtAllocation['2026-02-15'];
  ok(!!second, 'second payment recorded');
  eq(second.allocations.length, 1, 'second payment has one target');
  eq(second.allocations[0].debtId, 'mbna', 'later period targets the next still-owing debt');
  assertReprint(w, 'shift');
}

console.log('nextTarget is the walk-owned continuity conclusion');
{
  const debts = [
    card('tri', 'Triangle Mastercard', 200, 19.99),
    card('mbna', 'MBNA Mastercard', 5000, 12.99),
    card('visa', 'Travel Visa', 3000, 9.99),
  ];
  const w = walk(debts, 1000);
  const first = w.extraDebtAllocation['2026-01-15'];
  eq(first.allocations.map(l => l.debtId).join(','), 'tri,mbna',
    'payment spans tri then mbna');
  ok(!!first.nextTarget, 'continuity published');
  eq(first.nextTarget.debtId, 'visa', 'after mbna clears the chain continues to visa');
  eq(first.nextTarget.label, 'Travel Visa', 'nextTarget carries the Forecast label');
  eq(first.nextTarget.status, 'calculated', 'nextTarget carries trust');
  const two = walk([
    card('tri', 'Triangle Mastercard', 200, 19.99),
    card('mbna', 'MBNA Mastercard', 5000, 12.99),
  ], 1000).extraDebtAllocation['2026-01-15'];
  eq(two.nextTarget, null, 'no continuity when the chain ends');
  assertReprint(w, 'nextTarget');
}

console.log('estimated balances stay estimated, and propagate downstream');
{
  const debts = [
    card('tri', 'Triangle Mastercard', 200, 19.99, 'estimated'),
    card('mbna', 'MBNA Mastercard', 5000, 12.99, 'verified'),
  ];
  const w = walk(debts, 1000);
  const first = w.extraDebtAllocation['2026-01-15'];
  eq(first.allocations[0].status, 'estimated', 'estimated balance is not promoted');
  // Adversarial case: MBNA is verified, but its amount is the residual
  // after the estimated Triangle take — an estimated upstream dependency
  // the cascade alone knows — so it must stay estimated.
  eq(first.allocations[1].status, 'estimated',
    'verified downstream of an estimated take stays estimated');
  assertReprint(w, 'trust-propagation');
}

console.log('continuity conclusion inherits upstream estimation');
{
  const debts = [
    card('tri', 'Triangle Mastercard', 200, 19.99, 'estimated'),
    card('mbna', 'MBNA Mastercard', 5000, 12.99, 'verified'),
    card('visa', 'Travel Visa', 3000, 9.99, 'verified'),
  ];
  const w = walk(debts, 1000);
  const first = w.extraDebtAllocation['2026-01-15'];
  eq(first.allocations.map(l => l.status).join(','), 'estimated,estimated',
    'every amount after an estimated upstream take is estimated');
  ok(!!first.nextTarget, 'continuity published');
  eq(first.nextTarget.debtId, 'visa', 'after mbna the chain continues to visa');
  // The continuity conclusion rests on the cascade's modeled balances; the
  // walk's own residual shaped them, so an estimated upstream take makes
  // the conclusion estimated even though visa itself is verified.
  eq(first.nextTarget.status, 'estimated',
    'nextTarget is estimated when any allocation behind it was estimated');
  assertReprint(w, 'nextTarget-trust');
}

console.log('a skipped previously-cleared estimated debt keeps later lines estimated');
{
  const debts = [
    card('tri', 'Triangle Mastercard', 100, 19.99, 'estimated'),
    card('mbna', 'MBNA Mastercard', 5000, 12.99, 'verified'),
  ];
  const w = walk(debts, 1000);
  const first = w.extraDebtAllocation['2026-01-15'];
  eq(first.allocations[0].debtId, 'tri', 'first payment touches the estimated head');
  ok(w.byId.tri.balance <= 0.005, 'the estimated head is modeled cleared');
  const second = w.extraDebtAllocation['2026-02-15'];
  ok(!!second, 'second payment recorded');
  eq(second.allocations.length, 1, 'second payment lands on one debt');
  eq(second.allocations[0].debtId, 'mbna', 'the cleared estimated head is skipped');
  // Adversarial case: payDown records only debts that absorb money, so the
  // skipped head never appears in the takes — but the payment reaches MBNA
  // only because the walk modeled Triangle as cleared, and Triangle's
  // modeled state is estimated. Publishing MBNA calculated would claim a
  // routing certainty the inputs do not support.
  eq(second.allocations[0].status, 'estimated',
    'routing through a skipped estimated cleared debt stays estimated');
  assertReprint(w, 'skipped-estimated');
}

console.log('nextTarget inherits estimation from a skipped cleared debt');
{
  const debts = [
    card('tri', 'Triangle Mastercard', 100, 19.99, 'estimated'),
    card('mbna', 'MBNA Mastercard', 5000, 12.99, 'verified'),
    card('visa', 'Travel Visa', 3000, 9.99, 'verified'),
  ];
  const w = walk(debts, 1000);
  const second = w.extraDebtAllocation['2026-02-15'];
  ok(!!second, 'second payment recorded');
  eq(second.allocations.map(l => l.debtId).join(','), 'mbna',
    'second payment skips the cleared estimated head');
  ok(!!second.nextTarget, 'continuity published');
  eq(second.nextTarget.debtId, 'visa', 'after mbna the chain continues to visa');
  // Adversarial case: every take in this payment is verified-grade and visa
  // itself is verified — yet the conclusion "visa follows mbna" rests on
  // the payment having reached MBNA, which rests on the estimated modeled
  // state that Triangle really is cleared. Calculated would overstate it.
  eq(second.nextTarget.status, 'estimated',
    'nextTarget is estimated when routing skipped an estimated cleared debt');
  assertReprint(w, 'nextTarget-skipped');
}

console.log('verified cascade stays calculated end to end');
{
  const debts = [
    card('tri', 'Triangle Mastercard', 200, 19.99, 'verified'),
    card('mbna', 'MBNA Mastercard', 5000, 12.99, 'confirmed'),
    card('visa', 'Travel Visa', 3000, 9.99, 'verified'),
  ];
  const w = walk(debts, 1000);
  const first = w.extraDebtAllocation['2026-01-15'];
  eq(first.allocations.map(l => l.status).join(','), 'calculated,calculated',
    'verified/confirmed cascade calculates at every line');
  eq(first.nextTarget.status, 'calculated',
    'continuity calculates when every dependency is calculated');
  assertReprint(w, 'all-calculated');
}

console.log('zero and unavailable record nothing');
{
  const debts = [
    card('tri', 'Triangle Mastercard', 200, 19.99),
    card('mbna', 'MBNA Mastercard', 5000, 12.99),
  ];
  const zero = walk(debts, 0);
  eq(Object.keys(zero.extraDebtAllocation).length, 0, 'no extra planned: no attribution');
  eq(Object.keys(zero.extraAbsorbed).length, 0, 'no extra planned: no absorption');
  const noPolicy = F.projectDebts(
    plan({ nextDollar: null }), debts, START, { extraDebtMonthly: 1000, debtHorizonDays: 120 });
  eq(noPolicy.extraDebtPriority.status, 'unavailable', 'priority unavailable without policy');
  eq(Object.keys(noPolicy.extraDebtAllocation).length, 0, 'unavailable priority records nothing');
  eq(Object.keys(noPolicy.extraAbsorbed).length, 0, 'unavailable priority absorbs nothing');
}

console.log('all debts clear: later payments record nothing');
{
  const debts = [card('tri', 'Triangle Mastercard', 50, 19.99)];
  const w = walk(debts, 1000);
  const dates = Object.keys(w.extraDebtAllocation).sort();
  eq(dates.length, 1, 'only the clearing payment is recorded');
  eq(w.extraDebtAllocation[dates[0]].allocations[0].debtId, 'tri', 'clearing payment attributed');
  ok(w.unabsorbed > 0, 'uncleared remainder reported, not silently kept');
}

console.log('hypothetical extras never enter the attribution');
{
  const debts = [
    card('tri', 'Triangle Mastercard', 200, 19.99),
    card('mbna', 'MBNA Mastercard', 5000, 12.99),
  ];
  const w = walk(debts, 1000, {
    hypotheticalExtra: { amount: 500, date: '2026-01-20', debtId: 'mbna' },
  });
  ok(!w.extraDebtAllocation['2026-01-20'], 'hypothetical date has no attribution record');
  ok(!!w.extraDebtAllocation['2026-01-15'], 'monthly payment still recorded');
}

console.log('single target: one line, head of chain');
{
  const debts = [
    card('tri', 'Triangle Mastercard', 5000, 19.99),
    card('mbna', 'MBNA Mastercard', 5000, 12.99),
  ];
  const w = walk(debts, 600);
  const first = w.extraDebtAllocation['2026-01-15'];
  eq(first.allocations.length, 1, 'one target, one line');
  eq(first.allocations[0].debtId, 'tri', 'the line names the policy head');
  near(first.allocations[0].amount, 600, 'full payment on the head');
  eq(first.nextTarget.debtId, 'mbna', 'continuity names the next chain debt');
  assertReprint(w, 'single');
}

if (failures) {
  console.log(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('\nAll extra-debt attribution engine checks passed.');
