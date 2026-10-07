'use strict';
// Bounded independent comparison against a named git baseline. Not a CI
// dependency on an external ref; the reviewer can supply the integrated base.
const assert = require('node:assert/strict'), cp = require('node:child_process');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), crypto = require('node:crypto');
const F = require('../public/forecast');
const fx = require('./fixtures/bills-period-end-balance-data');
const root = path.join(__dirname, '..');
const baseline = process.env.ATLAS_BILLS_BALANCE_BASE || 'HEAD^';
const source = cp.execFileSync('git', ['show', baseline + ':public/forecast.js'], { cwd: root, encoding: 'utf8', maxBuffer: 3 * 1024 * 1024 });
const old = new Module(path.join(root, 'public', 'baseline-forecast.js'));
old.filename = path.join(root, 'public', 'baseline-forecast.js');
old.paths = Module._nodeModulePaths(path.join(root, 'public'));
old._compile(source, old.filename);
const strip = value => {
  if (Array.isArray(value)) return value.map(strip);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'billsAccountPeriodBalance')
    .map(([key, value]) => [key, strip(value)]));
};
const variants = [
  ['base', () => {}],
  ['Weekly overdraft', x => { x.plan.startingCash.breakdown[1].value = -6789.12; }],
  ['extra funded cash', x => { x.opts.currentPeriodActuals.transactions[0].amount = 700; x.opts.currentPeriodActuals.transactions[1].amount = -700; }],
  ['unknown card opening', x => { x.plan.cardPurchaseCoverage.opening.confirmed = false; }],
  ['truncated ledger', x => { x.opts.currentPeriodActuals.transactionCoverage = 'truncated'; }],
  ['earlier carry', x => { x.plan.cardPurchaseCoverage.opening.purchases.push({ ref: 'earlier', accountId: 'travelvisa', date: '2026-08-13', amount: 48.19, covered: 0 }); }],
  ['household overspend', x => { x.opts.currentPeriodActuals.transactions.push(fx.tx('overspend', 'chequing-b', fx.AS_OF, 223.33, 'Restaurants')); }],
];
const report = { baseline, executionHead: cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), variants: [] };
for (const [name, change] of variants) {
  const x = fx.fixture(); change(x);
  const before = JSON.stringify(x);
  const opts = { ...x.opts, horizonDays: 28, viewDays: 28 };
  const actual = F.recommend(x.plan, x.asOf, opts), previous = old.exports.recommend(x.plan, x.asOf, opts);
  assert.deepEqual(strip(actual), strip(previous), name + ': every existing advice field unchanged');
  assert.equal(JSON.stringify(x), before, name + ': input unchanged');
  report.variants.push({ name, allExistingAdviceEqual: true, sha256: crypto.createHash('sha256').update(JSON.stringify(strip(actual))).digest('hex') });
}
if (process.env.ATLAS_BILLS_PRESERVATION_PATH) fs.writeFileSync(process.env.ATLAS_BILLS_PRESERVATION_PATH, JSON.stringify(report, null, 2) + '\n');
console.log(`PASS every existing advice publication identical across ${variants.length} independent variants against ${baseline}`);
