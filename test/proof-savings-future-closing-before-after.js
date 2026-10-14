'use strict';
// Independent revision comparison, invented ledgers only. No provider/data.json.
// node test/proof-savings-future-closing-before-after.js <exact-main-checkout>
const assert = require('node:assert/strict'), path = require('node:path');
const F = require('../public/forecast'), fixture = require('./fixtures/savings-future-closing-data');
const base = require(path.join(path.resolve(process.argv[2]), 'public/forecast'));
const clone = x => JSON.parse(JSON.stringify(x));
function withoutNewPublication(advice) {
  const value = clone(advice);
  delete value.savingsFunding.period.projectedRemainingCapacity;
  for (const period of value.savingsFunding.periodViews) if (period.packet) delete period.packet.forecastClosing;
  return value;
}
let cases = 0;
for (const mode of ['ready', 'expense', 'deficit', 'missing-receipts', 'group']) {
  const x = fixture();
  if (mode === 'expense') { x.plan.commitments[0].date = '2026-11-03'; x.plan.commitments[0].amount = 80; }
  if (mode === 'deficit') { x.plan.commitments[0].date = '2027-01-03'; x.plan.income[2].amount = 0;
    x.plan.bills = [{ id: 'deficit', label: 'Invented bill', frequency: 'once', date: '2026-11-03', amount: 20, confidence: 'confirmed' }]; }
  if (mode === 'missing-receipts') delete x.opts.currentPeriodActuals;
  if (mode === 'group') { x.plan.groups = [{ id: 'group', label: 'Invented group', planSpendSummary: true }];
    x.plan.commitments.forEach(c => { c.group = 'group'; }); }
  const before = JSON.stringify(x), opts = { ...x.opts, weeklyVariable: 0, debts: [] };
  const old = base.recommend(x.plan, x.asOf, opts), current = F.recommend(x.plan, x.asOf, opts);
  assert.deepEqual(withoutNewPublication(current), clone(old),
    mode + ': entire native recommendation unchanged after removing exactly the two new publication fields');
  assert.equal(JSON.stringify(x), before);
  cases++;
}
console.log(JSON.stringify({ synthetic: true, completeNativeRecommendationsUnchanged: cases,
  excludedNewFields: ['savingsFunding.period.projectedRemainingCapacity', 'savingsFunding.periodViews[].packet.forecastClosing'] }));
