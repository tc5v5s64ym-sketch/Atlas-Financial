'use strict';
// Exact released source comparison; wholly invented evidence. No live access.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const vm = require('node:vm'), Module = require('node:module'), assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..'), base = '76aacf6f57824ab253a018e3e3012951b4315533';
const git = file => cp.execFileSync('git', ['show', base + ':' + file], { cwd: root, encoding: 'utf8', maxBuffer: 4e6 });
const context = vm.createContext({ module: { exports: {} } });
const oldSource = git('public/forecast.js'); vm.runInContext(oldSource, context);
const B = context.module.exports, F = require('../public/forecast');
const filename = path.join(root, 'scripts/provider-observe.js'), old = new Module(filename, module);
old.filename = filename; old.paths = Module._nodeModulePaths(path.dirname(filename));
const ordinaryRequire = old.require.bind(old);
old.require = name => name === '../public/forecast.js' ? B : ordinaryRequire(name);
old._compile(git('scripts/provider-observe.js'), filename);
const L = require('../scripts/live-plan'), { source } = require('./fixtures/savings-card-recipient-data');
const proofs = [];
for (const mode of ['recognized', 'ordinary-transfer', 'unknown-destination', 'payee-lookalike',
  'note-lookalike', 'plain-debit', 'cash-pair', 'pending', 'same-day-cutoff', 'window-incomplete',
  'unrelated-card-credit', 'reference-replay', 'cash-contradiction']) {
  const x = source(mode), original = JSON.stringify(x.input);
  const report = old.exports.observe({ provider: 'lunchmoney', ...x.input });
  const data = L.overlayLiveState({ data: x.input.data, report }).data;
  const prior = JSON.parse(JSON.stringify(B.recommend(data.plan, data.meta.asOf,
    { ...data.liveOverlay, debts: data.debts, weeklyVariable: 40 })));
  const next = JSON.parse(JSON.stringify(x.advice));
  const changed = ['recognized', 'unrelated-card-credit'].includes(mode);
  const recipientTyped = !['ordinary-transfer', 'unknown-destination', 'payee-lookalike',
    'note-lookalike', 'plain-debit', 'cash-pair'].includes(mode);
  if (changed) {
    assert.equal(prior.savingsFunding.backing.status, 'unavailable');
    assert.equal(next.savingsFunding.backing.status, 'ready');
    assert.equal(next.savingsInventory.reportedStock.amount, 119);
    assert.equal(F.householdInternalMovements(null, x.data.liveOverlay).length, 0);
    assert.equal(next.savingsFunding.moneyMovementPermission, 'not-granted');
  }
  if (recipientTyped && !changed) {
    assert.equal(next.savingsFunding.backing.status, 'unavailable');
    assert.equal(next.savingsFunding.period.proposal, null);
    assert.equal(next.savingsFunding.moneyMovementPermission, 'not-granted');
    if (mode === 'cash-contradiction') assert.equal(prior.savingsFunding.backing.status, 'ready',
      'incumbent generic pair accepted a contradictory cash destination; typed recipient now holds');
    else assert.equal(prior.savingsFunding.backing.status, 'unavailable');
  }
  // Qualification changes propagate through existing Savings and cash-plan
  // consumers. Do not claim their figures are unchanged after a formerly held
  // backing gate becomes ready. Source balances and settlement evidence do stay.
  for (const key of ['observations', 'spendableCash', 'savingsPools', 'representedEventCandidates',
    'transactionWindow', 'pendingCoverage', 'reconciliation'])
    assert.deepEqual(JSON.parse(JSON.stringify(x.report[key] ?? null)),
      JSON.parse(JSON.stringify(report[key] ?? null)), mode + ': source/settlement ' + key);
  if (!recipientTyped) assert.deepEqual(next, prior,
    mode + ': entire native advice unchanged, including original transaction packet bytes');
  assert.equal(JSON.stringify(x.input), original);
  proofs.push({ mode, intendedSavingsQualificationChanged: changed,
    entireAdviceAndUntypedPacketEqual: !recipientTyped,
    knownRecipientClassificationDelta: recipientTyped,
    contradictoryCashPairNowWithheld: mode === 'cash-contradiction',
    originalBalanceAndSettlementEvidenceEqual: true, inputImmutable: true });
}
const result = { synthetic: true, base, baseRuntimeSha256: crypto.createHash('sha256').update(oldSource).digest('hex'), proofs };
if (process.env.ATLAS_CARD_NATIVE_PROOF) fs.writeFileSync(process.env.ATLAS_CARD_NATIVE_PROOF, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
