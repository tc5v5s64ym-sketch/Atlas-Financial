'use strict';
const F = require('../public/forecast');
const Live = require('../scripts/live-plan');
const make = require('./fixtures/pending-card-bill-data');
let checks = 0, failures = 0;
function ok(condition, label) {
  checks++;
  if (!condition) failures++;
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}`);
}
const cents = amount => Math.round(amount * 100);
function run(mode, early, configure) {
  const input = make(mode, early);
  if (configure) configure(input);
  const before = JSON.stringify(input);
  const data = Live.fromObservation({ provider: 'lunchmoney', ...input }).data;
  const packet = data.liveOverlay.currentPeriodActuals;
  const opts = { debts: data.debts, currentPeriodActuals: packet };
  const simulate = days => F.simulate(data.plan, input.asOf, { ...opts,
    weeklyVariable: 0, viewDays: days, horizonDays: days, targetBuffer: 0 });
  const advice = F.recommend(data.plan, input.asOf, opts);
  ok(JSON.stringify(input) === before, mode + ': observation remains immutable');
  return { input, data, packet, advice, simulate };
}
for (const early of [true, 'next-period']) {
  for (const mode of ['pending', 'posted']) {
    const r = run(mode, early), sim = r.simulate(5);
    ok(cents(sim.ending - sim.requiredCashFloor) === 42679,
      mode + '/' + early + ': 500 minus one 73.21 purchase leaves 426.79');
    ok(r.data.plan.cardPurchaseCoverage.payments.length === 0,
      mode + '/' + early + ': no payment allocation is invented');
    const bill = r.advice.defaultView.bills.find(row => row.id === 'invented-card-service'
      && row.date === (early === true ? '2034-11-03' : '2034-10-14'));
    ok(bill && cents(bill.planned) === 7321 && (mode === 'posted' || bill.status !== 'PAID'),
      mode + '/' + early + ': scheduled amount remains; pending never appears paid');
    const target = early === true ? r.advice.defaultView
      : r.advice.payPeriodViews.find(p => p.start === '2034-10-13');
    ok(target && cents(target.balanceAfterDeductions) === -7321,
      mode + '/' + early + ': owning Budget period deducts the scheduled amount once');
    if (mode === 'posted') {
      ok(cents(r.simulate(1).ending - r.simulate(1).requiredCashFloor) === 42679,
        'posted/' + early + ': full coverage protects the purchase before its due date');
      ok(cents(sim.cardPurchaseCoverage.reservedCash) === 7321,
        'posted/' + early + ': posted purchase exposure remains fully published');
      ok(cents(sim.totals.reserved) === 0,
        'posted/' + early + ': the duplicate scheduled cash reservation is credited');
    } else {
      ok(!(r.data.plan.opening.representedEvents || []).some(row => row.id === 'invented-card-service'),
        'pending/' + early + ': no settlement receipt');
      ok(cents(F.utilisation(r.data.debts).rows[0].pending) === 7321,
        'pending/' + early + ': pending debt exposure is retained');
    }
  }
}
for (const mode of ['pending', 'posted']) {
  const r = run(mode, false), bill = r.advice.defaultView.bills.find(row =>
    row.id === 'invented-card-service' && row.date === '2034-10-03');
  ok(cents(r.simulate(1).ending - r.simulate(1).requiredCashFloor) === 42679,
    mode + ': incumbent overdue behavior protects once');
  ok(bill && (mode === 'posted' ? bill.status === 'PAID'
    : bill.status !== 'PAID' && bill.actual === null && bill.settlement === 'unverified'),
    mode + ': active Budget retains the honest settlement status');
}
for (const mode of ['wrong-merchant', 'wrong-amount', 'wrong-account', 'authorization',
  'duplicate', 'foreign-currency', 'insufficient-backing']) {
  const r = run(mode, true, input => {
    input.payload.transactions.forEach(tx => { tx.is_pending = false; });
    input.payload.accounts[3].balance = 473.21;
  });
  const sim = r.simulate(5);
  ok(!sim.events.some(event => event.cardPurchaseProtection),
    mode + ': nonqualifying posted evidence cannot credit scheduled cash');
  if (['foreign-currency', 'insufficient-backing'].includes(mode)) {
    ok(sim.cardPurchaseCoverage.status === 'unavailable', mode + ': trust remains unavailable');
  }
}
const unknown = run('posted', true);
unknown.packet.pendingCoverage = 'unknown';
const unknownSim = unknown.simulate(5);
ok(unknownSim.cardPurchaseCoverage.status === 'unavailable'
    && !unknownSim.events.some(event => event.cardPurchaseProtection),
  'unknown pending coverage withholds both precise protection and the credit');
const incomplete = make('incomplete', true);
incomplete.payload.transactions.forEach(tx => { tx.is_pending = false; });
let rejected = false;
try { Live.fromObservation({ provider: 'lunchmoney', ...incomplete }); }
catch (error) { rejected = error.code === 'live-plan-failed'
  && error.message.includes('pending-freshness-unproven'); }
ok(rejected, 'the live boundary rejects unproven pending freshness before publishing');
const unrelated = run('posted', true, input => {
  input.payload.transactions.push({ ...input.payload.transactions[0], id: 81002,
    amount: 19.37, payee: 'Invented unrelated purchase', original_name: 'Invented unrelated purchase' });
  input.payload.accounts[3].balance = 492.58;
});
ok(cents(unrelated.simulate(5).ending - unrelated.simulate(5).requiredCashFloor) === 40742,
  'unrelated posted purchase retains protection alongside the once-counted bill');
ok(cents(unrelated.advice.defaultView.balanceAfterDeductions) === -9258,
  'the Budget deducts the bill and unrelated posted Other expense once each');
console.log(`${checks - failures}/${checks} checks passed.`);
process.exitCode = failures ? 1 : 0;
