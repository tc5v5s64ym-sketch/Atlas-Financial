'use strict';
// Compare entire native advice, removing only the additive planned roster.
// Synthetic fixture only; base source loaded from the exact release Git blob.
const fs = require('node:fs'), vm = require('node:vm'), cp = require('node:child_process');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const F = require('../public/forecast'), make = require('./fixtures/savings-selected-roster-data');
const base = '227108f54f62329d72621e8d129c2223cd953caa';
const source = cp.execFileSync('git', ['show', base + ':public/forecast.js'], { encoding: 'utf8', maxBuffer: 3 * 1024 * 1024 });
const context = vm.createContext({ module: { exports: {} } });
vm.runInContext(source, context); const B = context.module.exports;
const proofs = [];
for (const mode of ['ready', 'card', 'missing', 'stale', 'undated']) {
  const x = make(mode), before = JSON.stringify(x), opts = { ...x.opts, weeklyVariable: 0, debts: [] };
  const prior = JSON.parse(JSON.stringify(B.recommend(x.plan, x.asOf, opts)));
  const next = JSON.parse(JSON.stringify(F.recommend(x.plan, x.asOf, opts)));
  const currentEqual = JSON.stringify(prior.savingsFunding) === JSON.stringify({ ...next.savingsFunding,
    periodViews: next.savingsFunding.periodViews.map(v => { const z = JSON.parse(JSON.stringify(v));
      if (z.packet) delete z.packet.plannedRequirements; return z; }) });
  for (const view of next.savingsFunding.periodViews) if (view.packet) delete view.packet.plannedRequirements;
  assert.deepEqual(next, prior, mode + ': every incumbent native result unchanged');
  assert.equal(JSON.stringify(x), before);
  assert.equal(currentEqual, true);
  proofs.push({ mode, completeAdviceEqualAfterRemovingOnlyPlannedRequirements: true,
    originalCurrentSavingsEqual: true, immutable: true });
}
const result = { synthetic: true, base, baseRuntimeSha256: crypto.createHash('sha256').update(source).digest('hex'),
  additiveField: 'savingsFunding.periodViews[].packet.plannedRequirements', proofs };
if (process.env.ATLAS_ROSTER_NATIVE_PROOF) fs.writeFileSync(process.env.ATLAS_ROSTER_NATIVE_PROOF, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
