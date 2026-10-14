'use strict';
// Independent revision comparison, invented ledgers only. No provider/data.json.
// node test/proof-savings-future-closing-before-after.js <exact-main-checkout>
const assert = require('node:assert/strict'), path = require('node:path');
const F = require('../public/forecast'), fixture = require('./fixtures/savings-future-closing-data');
const ownerModel = require('./fixtures/savings-owner-closing-data');
const base = require(path.join(path.resolve(process.argv[2]), 'public/forecast'));
const clone = x => JSON.parse(JSON.stringify(x));
function withoutNewPublication(advice) {
  const value = clone(advice);
  delete value.savingsFunding.period.projectedRemainingCapacity;
  for (const period of value.savingsFunding.periodViews) if (period.packet) delete period.packet.forecastClosing;
  return value;
}
let cases = 0;
for (const mode of ['ready', 'expense', 'deficit', 'missing-receipts', 'group', 'gap', 'owner80', 'owner1000', 'owner-deficit', 'timing']) {
  const x = mode.startsWith('owner') || mode === 'timing'
    ? ownerModel(mode === 'owner80' || mode === 'timing' ? 80 : 1000, mode === 'owner-deficit' ? 100 : 400) : fixture();
  if (mode === 'timing') { x.plan.income[1].date = '2026-10-24'; x.plan.commitments[0].date = '2026-10-16'; }
  if (mode === 'expense') { x.plan.commitments[0].date = '2026-11-03'; x.plan.commitments[0].amount = 80; }
  if (mode === 'deficit') { x.plan.commitments[0].date = '2027-01-03'; x.plan.income[2].amount = 0;
    x.plan.bills = [{ id: 'deficit', label: 'Invented bill', frequency: 'once', date: '2026-11-03', amount: 20, confidence: 'confirmed' }]; }
  if (mode === 'missing-receipts') delete x.opts.currentPeriodActuals;
  if (mode === 'group') { x.plan.groups = [{ id: 'group', label: 'Invented group', planSpendSummary: true }];
    x.plan.commitments.forEach(c => { c.group = 'group'; }); }
  if (mode === 'gap') {
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
  }
  const before = JSON.stringify(x), opts = { ...x.opts, weeklyVariable: 0, debts: [] };
  const old = base.recommend(x.plan, x.asOf, opts), current = F.recommend(x.plan, x.asOf, opts);
  assert.deepEqual(withoutNewPublication(current), clone(old),
    mode + ': entire native recommendation unchanged after removing exactly the two new publication fields');
  assert.equal(JSON.stringify(x), before);
  cases++;
}
console.log(JSON.stringify({ synthetic: true, completeNativeRecommendationsUnchanged: cases,
  excludedNewFields: ['savingsFunding.period.projectedRemainingCapacity', 'savingsFunding.periodViews[].packet.forecastClosing'] }));
