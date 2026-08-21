'use strict';
/* Opening-gap recovery must not convert debt capacity into cash.
 *
 * The 2026-08-21 live acceptance run had spendable $747.81, a $104.89
 * buffer gap, Amanda $0, and HELOC headroom $2,167.84. Forecast auto-drew
 * the HELOC and published a borrowing-enabled weekly cap. B70 already
 * says remaining headroom must never increase safe-to-spend.
 *
 * Synthetic fixture, independent arithmetic (L-006). Live cents are the
 * owner-stated acceptance amounts, not a copy of data.json as spec.
 */
const F = require('./public/forecast.js');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;

const AS_OF = '2026-08-21';
const CASH = 747.81;
const BUFFER = 500;
const GAP = 104.89;
const FLOOR = BUFFER - GAP;
const PRE_PAYDAY = CASH - FLOOR;
const HELOC_LIMIT = 202654;
const HELOC_POSTED = 200486.16;
const HELOC_ROOM = HELOC_LIMIT - HELOC_POSTED;

function fixture(extra = {}) {
  const plan = {
    windowDays: 21,
    defaults: { targetBuffer: BUFFER },
    startingCash: {
      breakdown: [
        { id: 'chequing-a', value: 629.27 },
        { id: 'chequing-b', value: 117.96 },
        { id: 'savings', value: 0.58 },
      ],
      heldElsewhere: [{ id: 'amanda-debt-payments', value: 2691.85 }],
    },
    opening: { asOf: AS_OF },
    income: [{
      id: 'pay', label: 'Payday', frequency: 'once', date: '2026-08-28',
      amount: 4000, confidence: 'confirmed',
    }],
    bills: [{
      id: 'pre', label: 'Pre-payday bills', frequency: 'once',
      date: '2026-08-27', amount: PRE_PAYDAY, confidence: 'confirmed',
    }],
    obligations: [],
    commitments: extra.commitments || [],
    funding: {
      options: extra.fundingOptions || [
        { id: 'amanda', cash: 'amanda-debt-payments', rank: 1, unusable: false },
        {
          id: 'heloc', debtId: 'heloc', rank: 2, unusable: false,
          label: 'Draw on the HELOC', short: 'a HELOC draw',
        },
        { id: 'overdraft', cash: 'chequing-b', rank: 3, unusable: true },
        { id: 'cards', rank: 4, unusable: true },
      ],
    },
  };
  const debts = extra.debts || [
    { id: 'heloc', balance: HELOC_POSTED, pending: 0, limit: HELOC_LIMIT, secured: true, rate: 4.9 },
    { id: 'card', balance: 100, pending: 0, pendingUnknown: false, secured: false, limit: 200 },
  ];
  const extraFacilities = extra.extraFacilities || [
    { id: 'overdraft', cash: 'chequing-b', limit: 600, pending: 0 },
  ];
  return { plan, debts, extraFacilities };
}

function recommend(data, extraOpts) {
  return F.recommend(data.plan, AS_OF, Object.assign({
    fundingSources: data.plan.funding.options,
    debts: data.debts,
    extraFacilities: data.extraFacilities,
    targetBuffer: BUFFER,
  }, extraOpts || {}));
}

console.log('=== independent fixture matches the live-equivalent gap ===');
{
  const data = fixture();
  const spend = data.plan.startingCash.breakdown.reduce((s, b) => s + b.value, 0);
  ok(near(spend, CASH), 'opening cash is independently $747.81', String(spend));
  ok(near(HELOC_ROOM, 2167.84), 'HELOC headroom is independently $2,167.84', String(HELOC_ROOM));
  const zero = F.simulate(data.plan, AS_OF, { weeklyVariable: 0, targetBuffer: BUFFER });
  ok(near(zero.min.balance, FLOOR) && zero.min.date === '2026-08-27',
    'zero-spend floor is independently $395.11 on 27 August',
    `${zero.min.balance} on ${zero.min.date}`);
  ok(near(BUFFER - zero.min.balance, GAP),
    'buffer gap is independently $104.89', String(BUFFER - zero.min.balance));
  const sources = F.resolveFundingSources(
    data.plan.funding.options, data.extraFacilities, data.plan, data.debts);
  ok(near(sources.find(s => s.id === 'amanda').available, 0),
    'Amanda funding is $0');
  ok(near(sources.find(s => s.id === 'heloc').available, HELOC_ROOM),
    'HELOC capacity remains visible on resolveFundingSources');
  ok(sources.find(s => s.id === 'overdraft').unusable === true
    && sources.find(s => s.id === 'cards').unusable === true,
    'overdraft and cards stay unusable household cash');
}

console.log('\n=== HELOC headroom does not auto-fund the opening gap ===');
{
  const data = fixture();
  const rec = recommend(data);
  ok(rec.mode === 'openingGap', 'mode stays openingGap', rec.mode);
  ok(near(rec.gap.amount, GAP), 'the $104.89 shortfall is preserved', String(rec.gap.amount));
  ok(rec.funding && rec.funding.feasible === false,
    'HELOC capacity alone does not make the gap feasible');
  ok(near(rec.funding.shortfall, GAP),
    'the unfunded recovery shortfall is the independent $104.89',
    String(rec.funding.shortfall));
  ok(near(rec.funding.borrowed, 0) && rec.funding.parts.every(p => !p.debtId),
    'no debtId source is injected', JSON.stringify(rec.funding.parts));
  ok(!(rec.simOptions.injections || []).some(i => i.debtId),
    'recovery injections carry no HELOC draw');
  ok(rec.weekly === 0,
    'no borrowing-enabled weekly cap is published as safe-to-spend',
    `$${rec.weekly}/week`);
  const heloc = rec.funding.sources.find(s => s.id === 'heloc');
  ok(heloc && near(heloc.available, HELOC_ROOM) && heloc.verdict === 'insufficient'
    && near(heloc.contributes, 0),
    'HELOC room stays visible as capacity and is not a cover',
    `${heloc && heloc.verdict} contributes ${heloc && heloc.contributes}`);
  ok(rec.plannedDebt && rec.plannedDebt.permitted === false
    && rec.plannedDebt.borrowed === 0,
    'plannedDebt stays opt-in and is not invented for the gap');
  const mission = F.mission(rec, F.projectDebts(data.plan, data.debts, AS_OF,
    Object.assign({}, rec.simOptions, { weeklyVariable: rec.weekly })));
  ok(mission.parts.some(p => p.id === 'fundingShortfall'),
    'the mission names the funding shortfall');
  ok(!mission.parts.some(p => p.id === 'holdSpending'),
    'the mission does not instruct a weekly spend while the gap is unfunded');
}

console.log('\n=== legacy fundingDebtId cannot authorize an opening-gap draw ===');
{
  const data = fixture();
  const rec = F.recommend(data.plan, AS_OF, {
    debts: data.debts,
    extraFacilities: data.extraFacilities,
    targetBuffer: BUFFER,
    fundingDebtId: 'heloc',
  });
  ok(rec.mode === 'openingGap', 'mode stays openingGap', rec.mode);
  ok(near(rec.gap.amount, GAP), 'the independent $104.89 gap is preserved',
    String(rec.gap && rec.gap.amount));
  ok(rec.plannedDebt && rec.plannedDebt.permitted === false
    && rec.plannedDebt.borrowed === 0,
    'plannedDebt stays unpermitted when only fundingDebtId is supplied');
  ok(rec.funding && rec.funding.feasible === false,
    'the hint does not make the gap feasible');
  ok(near(rec.funding.shortfall, GAP),
    'the unfunded shortfall remains the independent $104.89',
    String(rec.funding && rec.funding.shortfall));
  ok(near(rec.funding.borrowed, 0) && (rec.funding.parts || []).every(p => !p.debtId),
    'no debt injection is created', JSON.stringify(rec.funding && rec.funding.parts));
  ok(!(rec.simOptions.injections || []).some(i => i.debtId),
    'recovery injections carry no HELOC draw');
  ok(rec.weekly === 0,
    'no borrowing-enabled weekly cap is published as safe-to-spend',
    `$${rec.weekly}/week`);
}

console.log('\n=== a usable non-debt cash source may still cover the gap ===');
{
  const data = fixture({
    fundingOptions: [
      {
        id: 'cash-pot', label: 'Owner-authorized cash', short: 'cash',
        available: 200, rank: 1, debtId: null,
      },
      {
        id: 'heloc', debtId: 'heloc', rank: 2, unusable: false,
        label: 'Draw on the HELOC', short: 'a HELOC draw',
      },
    ],
  });
  const rec = recommend(data);
  ok(rec.funding && rec.funding.feasible === true,
    'an explicit cash source that reaches the gap still funds it');
  ok(rec.funding.parts.length === 1 && rec.funding.parts[0].id === 'cash-pot',
    'from the cash source, not the HELOC');
  ok(near(rec.funding.borrowed, 0), 'and nothing is borrowed');
  ok(rec.weekly > 0, 'a cash-funded recovery may still publish a weekly cap',
    `$${rec.weekly}/week`);
  ok(!(rec.simOptions.injections || []).some(i => i.debtId),
    'the cash recovery does not attach a debtId');
}

console.log('\n=== explicitly authorized planned debt still works ===');
{
  const plan = {
    windowDays: 40,
    defaults: { targetBuffer: 500 },
    startingCash: { amount: 600 },
    income: [{
      id: 'later-cover', label: 'Later cover', frequency: 'once',
      date: '2026-09-10', amount: 2500, confidence: 'confirmed',
    }],
    obligations: [],
    bills: [],
    commitments: [{
      id: 'named-gap', label: 'Named purpose', date: '2026-09-05',
      amount: 2000, confidence: 'confirmed',
    }],
  };
  const debts = [{
    id: 'heloc', balance: HELOC_POSTED, pending: 0, limit: HELOC_LIMIT,
    secured: true, rate: 4.9,
  }];
  const permitted = F.plannedDebt(plan, AS_OF, {
    allowPlannedDebt: true,
    plannedDebtFacility: 'heloc',
    plannedDebtPurposes: ['named-gap'],
    plannedDebtPayment: 200,
    debts,
    weeklyVariable: 0,
    targetBuffer: 500,
  });
  ok(permitted.permitted === true && permitted.borrowed > 0,
    'named planned-debt still draws when explicitly permitted',
    String(permitted.borrowed));
  ok(permitted.draws && permitted.draws[0] && permitted.draws[0].id === 'named-gap',
    'the draw stays purpose-specific');
  const denied = F.plannedDebt(plan, AS_OF, { debts, weeklyVariable: 0, targetBuffer: 500 });
  ok(denied.permitted === false && denied.borrowed === 0,
    'default plannedDebt still invents no permission');
}

console.log('\n' + (failures ? `${failures} failure(s)` : 'All opening-gap no-auto-borrow checks passed'));
process.exit(failures === 0 ? 0 : 1);
