'use strict';
/* Independent proof that Forecast.projectDebts is the sole HELOC
 * limit-crossing date. `node test-heloc-crossing-authority.js`
 *
 * The monthly ledger is last-day-of-month calendar arithmetic plus the
 * posted opening and the capitalising charge. It does not call
 * projectDebts, expandEvents, or occurrences — those are the code under
 * test. Live cents here are a deliberately live reconciliation of the
 * 2026-08-19 opening (L-006), not a behaviour specification for other
 * households.
 */
const fs = require('fs');
const { sourceText } = require('./test-source-text');
const F = require('./public/forecast.js');
const data = require('./data.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const clone = x => JSON.parse(JSON.stringify(x));
const read = p => sourceText(fs.readFileSync(p, 'utf8'));
const cents = n => Math.round(Number(n) * 100);
const sameCents = (a, b) => cents(a) === cents(b);
const money2 = n => '$' + Number(n).toFixed(2);

function lastDayOfMonth(year, month /* 1-indexed */) {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function monthEndsFrom(asOf, count) {
  const [y, m] = asOf.split('-').map(Number);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const abs = m + i;
    const year = y + Math.floor((abs - 1) / 12);
    const month = ((abs - 1) % 12) + 1;
    rows.push(lastDayOfMonth(year, month));
  }
  return rows;
}

function capitaliseLedger(opening, charge, asOf, months) {
  let balance = opening;
  return monthEndsFrom(asOf, months).map(date => {
    balance = Math.round((balance + charge) * 100) / 100;
    return { date, balance };
  });
}

function firstOver(ledger, limit) {
  return ledger.find(row => row.balance > limit) || null;
}

function projectHeloc(plan, debts, asOf) {
  return F.projectDebts(plan, debts, asOf, {
    scenario: 'expected',
    extraDebtMonthly: 0,
    weeklyVariable: 0,
    targetBuffer: 0,
    incomeOverrides: {},
    disabled: [],
  });
}

function helocCrossing(proj) {
  return ((proj && proj.crossings) || [])
    .find(c => c.id === 'heloc' && !c.alreadyOver) || null;
}

function storedCrossingClaims(plan) {
  const blobs = [
    ...(plan.assumptions || []),
    JSON.stringify(plan.nextDollar || {}),
    ...(plan.actions || []).map(a => `${a.why || ''} ${a.note || ''}`),
    plan.actionsNote || '',
  ].join('\n');
  return blobs.match(
    /\b(?:crosses|passes its own limit)\b[\s\S]{0,160}\b(?:30 September|31 October|2026-09-30|2026-10-31)\b/gi
  ) || [];
}

const plan = data.plan;
const asOf = data.meta.asOf;
const helocDebt = data.debts.find(d => d.id === 'heloc');
const helocObl = plan.obligations.find(o => o.id === 'heloc');

console.log('=== live opening still matches the 2026-08-19 HELOC facts ===');
ok(asOf === '2026-08-19', 'canonical opening is 2026-08-19', asOf);
ok(helocDebt && sameCents(helocDebt.balance, 200486.16),
  'HELOC opening is $200,486.16', money2(helocDebt && helocDebt.balance));
ok(helocDebt && sameCents(helocDebt.limit, 202654),
  'HELOC limit is $202,654', money2(helocDebt && helocDebt.limit));
ok(helocObl && sameCents(helocObl.amount, 814.18) && helocObl.nonCash === true
  && helocObl.effect === 'capitalise',
  'monthly capitalisation is still the $814.18 non-cash charge',
  money2(helocObl && helocObl.amount));
ok(helocDebt.cashPayment === 0 && helocDebt.interestTreatment === 'capitalised',
  'payment semantics are unchanged: capitalised, $0 household cash');

console.log('\n=== independent month-end ledger, without projectDebts ===');
const ledger = capitaliseLedger(helocDebt.balance, helocObl.amount, asOf, 3);
ok(ledger[0].date === '2026-08-31' && sameCents(ledger[0].balance, 201300.34),
  '31 August → $201,300.34', `${ledger[0].date} ${money2(ledger[0].balance)}`);
ok(ledger[1].date === '2026-09-30' && sameCents(ledger[1].balance, 202114.52),
  '30 September → $202,114.52, still under the limit',
  `${ledger[1].date} ${money2(ledger[1].balance)}`);
ok(ledger[2].date === '2026-10-31' && sameCents(ledger[2].balance, 202928.70),
  '31 October → $202,928.70', `${ledger[2].date} ${money2(ledger[2].balance)}`);
ok(ledger[1].balance < helocDebt.limit,
  '30 September is $539.48 under the limit',
  money2(helocDebt.limit - ledger[1].balance));
ok(ledger[2].balance > helocDebt.limit,
  '31 October is $274.70 over the limit',
  money2(ledger[2].balance - helocDebt.limit));
const independent = firstOver(ledger, helocDebt.limit);
ok(independent && independent.date === '2026-10-31',
  'independent ledger first exceeds the limit on 2026-10-31',
  independent && independent.date);

console.log('\n=== Forecast first crossing equals that ledger ===');
const proj = projectHeloc(plan, data.debts, asOf);
const cross = helocCrossing(proj);
ok(cross && cross.date === '2026-10-31',
  "Forecast's first HELOC crossing is 2026-10-31",
  cross && cross.date);
ok(cross && independent && cross.date === independent.date,
  'engine date equals the independent first-over day',
  cross && cross.date);

const advice = F.recommend(plan, asOf, {
  scenario: plan.defaults.scenario,
  targetBuffer: plan.defaults.targetBuffer,
  extraDebtMonthly: 0, incomeOverrides: {}, disabled: [],
  debts: data.debts, extraDebtTarget: plan.nextDollar && plan.nextDollar.target,
  fundingSources: plan.funding.options,
});
const liveDebt = F.projectDebts(plan, data.debts, asOf, Object.assign({},
  advice.simOptions, { weeklyVariable: advice.weekly,
    extraFacilities: data.revolvingExtra,
    extraDebtTarget: plan.nextDollar && plan.nextDollar.target }));
const liveMission = F.mission(advice, liveDebt, { sim: advice.sim });
const liveHelocPart = (liveMission.parts || []).find(p => p.id === 'helocLimit');
ok(liveHelocPart && liveHelocPart.date === '2026-10-31',
  'the household-facing mission date is the Forecast crossing, not a stored day',
  liveHelocPart && liveHelocPart.date);
ok(near((advice.funding && advice.funding.borrowed) || 0, 0),
  'available HELOC credit is not borrowed cash on this opening');
ok(advice.plannedDebt && advice.plannedDebt.permitted === false,
  'no borrowing permission is added');

console.log('\n=== stored narrative has no exact crossing day to update ===');
const stored = storedCrossingClaims(plan);
ok(stored.length === 0,
  'assumptions, nextDollar and actions do not store an exact HELOC crossing day',
  stored.join(' | ') || 'none');
ok(!/30 September/.test(read('public/plan.js')),
  'Plan page copy does not hardcode 30 September');
ok(!/the HELOC crosses on\s+30 September/i.test(read('public/forecast.js')),
  'Forecast comments no longer treat 30 September as the current crossing');

console.log('\n=== mutating opening or capitalisation moves the derived crossing ===');
{
  const mutated = clone(data);
  const mDebt = mutated.debts.find(d => d.id === 'heloc');
  mDebt.balance = helocDebt.balance + 600;
  const mLedger = capitaliseLedger(mDebt.balance, helocObl.amount, asOf, 3);
  const mIndependent = firstOver(mLedger, mDebt.limit);
  const mProj = projectHeloc(mutated.plan, mutated.debts, asOf);
  const mCross = helocCrossing(mProj);
  ok(mIndependent && mIndependent.date === '2026-09-30',
    'independent ledger moves to 30 September when the opening rises $600',
    mIndependent && `${mIndependent.date} ${money2(mIndependent.balance)}`);
  ok(mCross && mCross.date === mIndependent.date,
    'Forecast follows that mutated ledger without a prose update',
    mCross && mCross.date);
  ok(mCross.date !== cross.date,
    'the derived crossing moved off 2026-10-31');
  ok(storedCrossingClaims(data.plan).length === 0,
    'live stored narrative still has no exact date that needed editing');
}
{
  const mutated = clone(data);
  const mObl = mutated.plan.obligations.find(o => o.id === 'heloc');
  mObl.amount = 1200;
  const mLedger = capitaliseLedger(helocDebt.balance, mObl.amount, asOf, 3);
  const mIndependent = firstOver(mLedger, helocDebt.limit);
  const mProj = projectHeloc(mutated.plan, mutated.debts, asOf);
  const mCross = helocCrossing(mProj);
  ok(mIndependent && mIndependent.date === '2026-09-30',
    'independent ledger moves to 30 September when capitalisation is $1,200',
    mIndependent && `${mIndependent.date} ${money2(mIndependent.balance)}`);
  ok(mCross && mCross.date === mIndependent.date,
    'Forecast follows the mutated charge without a stored-date update',
    mCross && mCross.date);
  ok(mCross.date !== cross.date,
    'raising the monthly charge also moves the derived crossing');
  ok(near(data.plan.obligations.find(o => o.id === 'heloc').amount, 814.18),
    'the live $814.18 capitalisation is unchanged by the fixture');
}

console.log('\n=== next-dollar ordering is unchanged ===');
ok(plan.nextDollar && plan.nextDollar.policy === 'protect-then-highest-cost',
  'next-dollar policy is still protect-then-highest-cost');
ok(plan.nextDollar.target === 'cashback',
  'target is still the Cash Back Visa');
ok(plan.nextDollar.order[5] && /Stop new HELOC/.test(plan.nextDollar.order[5].rule),
  'rank 6 is still stop new HELOC and revolving growth');
ok(plan.nextDollar.order[6] && /highest effective-cost/.test(plan.nextDollar.order[6].rule),
  'rank 7 is still surplus to highest effective-cost consumer debt');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
