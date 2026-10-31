'use strict';
/* #727 (ATLAS-076) slice (b): Forecast publishes no funding when funding
 * sources are absent, null or empty, even though debts with headroom and an
 * extra facility (overdraft) with headroom exist.
 *
 * A caller that has not declared a funding source has not authorized any
 * money. Debt room and overdraft headroom are capacity, not cash, so the
 * opening gap must stay an unfunded shortfall: no parts, no injections, no
 * borrowing, no weekly spend, and the full gap reported as the shortfall.
 *
 * Synthetic fixture only, with independent arithmetic. No household data.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../public/forecast.js');

const AS_OF = '2026-01-05';
const BUFFER = 500;
const CHEQ_A = 300;
const CHEQ_B = 100;
const OPENING = CHEQ_A + CHEQ_B;          // 400 spendable chequing
const PRE_PAYDAY = 250;                   // due before payday
const FLOOR = OPENING - PRE_PAYDAY;       // 150 zero-spend floor
const GAP = BUFFER - FLOOR;               // 350 opening gap
const HELOC_LIMIT = 10000;
const HELOC_BAL = 4000;                   // 6000 HELOC room
const CARD_LIMIT = 2000;
const CARD_BAL = 500;                     // 1500 card room
const OD_LIMIT = 800;                     // overdraft headroom on chequing-b
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;

function data() {
  const plan = {
    windowDays: 21,
    defaults: { targetBuffer: BUFFER },
    startingCash: {
      breakdown: [
        { id: 'chequing-a', value: CHEQ_A },
        { id: 'chequing-b', value: CHEQ_B },
      ],
      heldElsewhere: [{ id: 'held-elsewhere', value: 5000 }],
    },
    opening: { asOf: AS_OF },
    income: [{ id: 'pay', label: 'Payday', frequency: 'once', date: '2026-01-12',
      amount: 3000, confidence: 'confirmed' }],
    bills: [{ id: 'pre', label: 'Pre-payday bill', frequency: 'once',
      date: '2026-01-09', amount: PRE_PAYDAY, confidence: 'confirmed' }],
    obligations: [],
    commitments: [],
  };
  const debts = [
    { id: 'heloc', balance: HELOC_BAL, pending: 0, limit: HELOC_LIMIT, secured: true, rate: 5 },
    { id: 'card', balance: CARD_BAL, pending: 0, pendingUnknown: false, secured: false, limit: CARD_LIMIT },
  ];
  const extraFacilities = [{ id: 'overdraft', cash: 'chequing-b', limit: OD_LIMIT, pending: 0 }];
  return { plan, debts, extraFacilities };
}

function rec(fundingSources, omitKey) {
  const d = data();
  const opts = { debts: d.debts, extraFacilities: d.extraFacilities, targetBuffer: BUFFER };
  if (!omitKey) opts.fundingSources = fundingSources;
  return { d, r: F.recommend(d.plan, AS_OF, opts) };
}

test('fixture: independent opening gap and real capacity exist', () => {
  const d = data();
  const zero = F.simulate(d.plan, AS_OF, { weeklyVariable: 0, targetBuffer: BUFFER });
  assert.ok(near(zero.min.balance, FLOOR), `floor ${zero.min.balance}`);
  assert.ok(near(BUFFER - zero.min.balance, GAP));
  const util = F.resolveFundingSources(
    [{ id: 'heloc', debtId: 'heloc', rank: 1 }, { id: 'card', debtId: 'card', rank: 2 },
      { id: 'od', cash: 'chequing-b', rank: 3 }], d.extraFacilities, d.plan, d.debts);
  assert.ok(util.find(s => s.id === 'heloc').available > GAP, 'HELOC room exceeds the gap');
  assert.ok(util.find(s => s.id === 'card').available > GAP, 'card room exceeds the gap');
  assert.ok(util.find(s => s.id === 'od').available > GAP, 'overdraft headroom exceeds the gap');
});

const CASES = [
  ['absent (key omitted)', undefined, true],
  ['undefined', undefined, false],
  ['null', null, false],
  ['empty array', [], false],
];

for (const [name, sources, omit] of CASES) {
  test(`fundingSources ${name}: no funding is invented despite debts and an overdraft`, () => {
    const { r } = rec(sources, omit);
    assert.equal(r.mode, 'openingGap');
    assert.ok(near(r.gap.amount, GAP), `gap ${r.gap.amount}`);
    assert.ok(r.funding, 'funding block is published');
    assert.deepEqual(r.funding.parts, [], 'no funding part');
    assert.equal(r.funding.feasible, false, 'the gap is not funded');
    assert.ok(near(r.funding.shortfall, GAP), `shortfall ${r.funding.shortfall}`);
    assert.ok(near(r.funding.allocated, 0), `allocated ${r.funding.allocated}`);
    assert.ok(near(r.funding.borrowed, 0) && near(r.funding.free, 0));
    assert.deepEqual(r.funding.sources, [], 'no source verdicts are invented');
    assert.deepEqual(r.simOptions.injections || [], [], 'no gap-funding injection');
    assert.equal(r.weekly, 0, 'no weekly spend published');
    assert.ok(!r.plannedDebt || (r.plannedDebt.permitted === false && r.plannedDebt.borrowed === 0),
      'no planned borrowing invented');
  });
}

test('resolveFundingSources with debts and facilities returns [] for absent, null and empty', () => {
  const d = data();
  for (const s of [undefined, null, []]) {
    assert.deepEqual(F.resolveFundingSources(s, d.extraFacilities, d.plan, d.debts), []);
  }
});

test('control: a declared usable cash source does fund the gap', () => {
  const { r } = rec([{ id: 'topup', label: 'Top-up', rank: 1, unusable: false, available: 1000 }]);
  assert.equal(r.mode, 'openingGap');
  assert.equal(r.funding.feasible, true);
  assert.ok(near(r.funding.allocated, GAP), `allocated ${r.funding.allocated}`);
  assert.equal(r.funding.parts.length, 1);
});

test('control: declaring only debt and the overdraft still funds nothing', () => {
  const { r } = rec([
    { id: 'heloc', debtId: 'heloc', rank: 1, unusable: false },
    { id: 'od', cash: 'chequing-b', rank: 2, unusable: true },
  ]);
  assert.equal(r.funding.feasible, false);
  assert.deepEqual(r.funding.parts, []);
  assert.ok(near(r.funding.shortfall, GAP));
});
