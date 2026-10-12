'use strict';
// Real files/child processes on supported POSIX runtimes; no Windows ACL bypass.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const S = require('../scripts/card-payment-decision-store');
const actor = 'session-' + 'a'.repeat(64);
const operation = char => 'operation-' + char.repeat(32);
function decision(char) {
  return { actor, recordedAt: '2026-09-20T18:00:00.000Z', evidenceDigest: 'd'.repeat(64), referenceDates: ['2026-09-20'],
    record: { id: 'decision-' + char.repeat(32), confirmed: true, debitRef: 'pc-' + 'a'.repeat(24),
      creditRef: 'pc-' + 'b'.repeat(24), allocations: [{ purchaseRef: 'pc-' + 'c'.repeat(24), amount: 80 }],
      otherAmount: 0, otherPurpose: null } };
}
async function child() {
  const [mode, root, char] = process.argv.slice(2), store = S.createStore(S.fileStorage(root));
  if (mode.startsWith('controller-')) {
    const fixture = require('./fixtures/card-purchase-coverage-data'), x = fixture('backfill');
    delete x.data.plan.cardPurchaseCoverage.opening;
    const source = () => {
      const data = require('../scripts/live-plan').fromObservation(x).data;
      return { plan: data.plan, debts: data.debts, asOf: x.asOf, packet: data.liveOverlay.currentPeriodActuals };
    };
    const controller = require('../scripts/card-payment-decisions').createController({ store,
      evidence: { read: source, resolve: choice => choice }, sessions: { actor: () => actor } });
    if (mode === 'controller-repeat') console.log(JSON.stringify(await controller.confirm({ session: 'invented', operationId: char })));
    else {
      const proposal = { ...decision('a').record, debitRef: fixture.ref(x, 80002), creditRef: fixture.ref(x, 80003),
        allocations: [{ purchaseRef: fixture.ref(x, 80001), amount: 80 }] };
      const preview = await controller.prepare({ session: 'invented', selection: proposal });
      assert.equal(preview.status, 'prepared');
      console.log(JSON.stringify(await controller.confirm({ session: 'invented', operationId: preview.operationId })));
    }
    return;
  }
  if (mode === 'crash') {
    const unlink = fs.unlinkSync;
    fs.unlinkSync = file => { if (path.basename(file) === 'decisions.lock') process.exit(73); return unlink(file); };
  }
  if (mode === 'read') console.log(JSON.stringify(await store.outcome({ actor, operationId: operation(char) })));
  else {
    try { console.log(JSON.stringify(await store.commit({ actor, operationId: operation(char), expectedRevision: 0, decision: decision(char) }))); }
    catch { console.log(JSON.stringify({ status: 'unavailable' })); }
  }
}
let checks = 0;
const eq = (a, b, why) => { assert.deepEqual(a, b, why); checks++; };
function run(mode, root, char = 'a') {
  const result = spawnSync(process.execPath, [__filename, mode, root, char], { encoding: 'utf8' });
  if (mode !== 'crash') eq(result.status, 0, 'child completes without exposing private errors');
  return result;
}
function parallel(root, char) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [__filename, 'commit', root, char], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; proc.stdout.on('data', chunk => { output += chunk; });
    proc.on('error', reject); proc.on('exit', code => code === 0 ? resolve(JSON.parse(output)) : reject(new Error('synthetic child failed')));
  });
}
async function main() {
  // Stored document/choice types reject unexpected data even with a recomputed digest.
  for (const mutate of [
    value => { value.state.secret = 'invented-privacy-canary'; },
    value => { value.state.revision = 1; },
    value => { value.schema = 'unsupported'; },
    value => { value.digest = 'f'.repeat(64); },
  ]) {
    const value = JSON.parse(S.initialDocument()); mutate(value);
    if (value.digest !== 'f'.repeat(64)) value.digest = S.digest(value.state);
    const store = S.createStore({ read: () => JSON.stringify(value), update: () => {} });
    await assert.rejects(store.snapshot()); checks++;
  }
  const extra = decision('a'); extra.record.rawProviderId = 'invented-private-identity';
  const inertStorage = { read: () => S.initialDocument(), update: () => { throw new Error('must not write'); } };
  await assert.rejects(S.createStore(inertStorage).commit({ actor, operationId: operation('a'), expectedRevision: 0, decision: extra })); checks++;
  assert.throws(() => S.recordValid({ ...decision('a').record, otherAmount: 0.001 })); checks++;
  assert.throws(() => S.recordValid({ ...decision('a').record, debitRef: 'tx-1' })); checks++;
  assert.throws(() => S.recordValid({ ...decision('a').record, otherPurpose: 'invented-policy' })); checks++;
  // Requiring either foundation cannot activate filesystem/provider access in production.
  const production = ['server.js', 'scripts/live-plan.js', 'scripts/server-live-refresh.js', 'scripts/assistant-packet.js'];
  eq(production.every(file => !fs.readFileSync(path.join(__dirname, '..', file), 'utf8').includes('card-payment-decision')), true,
    'foundation has no production importer');
  const initProbe = spawnSync(process.execPath, ['-e', `
    const fs=require('node:fs'),cp=require('node:child_process');
    const S=require(${JSON.stringify(require.resolve('../scripts/card-payment-decision-store'))});
    const C=require(${JSON.stringify(require.resolve('../scripts/card-payment-decisions'))});
    let reads=0; const read=fs.readFileSync;
    fs.readFileSync=(...a)=>{reads++;return read(...a)};
    C.createController({store:{},evidence:{},sessions:{}}); console.log(reads);
  `], { encoding: 'utf8' });
  eq(initProbe.status, 0, 'explicit construction can remain inert'); eq(initProbe.stdout.trim(), '0', 'construction performs zero private reads');
  if (process.platform === 'win32') {
    assert.throws(() => S.fileStorage(path.join(os.tmpdir(), 'atlas-card-unqualified-windows')), /card-decision-unavailable/); checks++;
    console.log('PASS card decision store: ' + checks + ' type/privacy/inertness checks; POSIX file durability not exercised on Windows');
    return;
  }
  const roots = [];
  const fresh = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-card-store-synthetic-')); roots.push(root); return root; };
  try {
    const integrated = fresh(); S.initializeFileStorage(integrated);
    const confirmed = JSON.parse(run('controller-confirm', integrated).stdout);
    eq(confirmed.status, 'confirmed', 'real provider, Forecast, controller and file adapter commit together');
    eq(JSON.parse(run('controller-repeat', integrated, confirmed.operationId).stdout), confirmed,
      'fresh controller/process retrieves the exact committed receipt without reconstructing the preview');
    const root = fresh(); S.initializeFileStorage(root);
    eq(JSON.parse(run('commit', root).stdout).status, 'confirmed', 'real atomic file commit');
    eq(JSON.parse(run('read', root).stdout).revision, 1, 'separate process reads the durable receipt');
    eq(JSON.parse(run('commit', root).stdout).revision, 1, 'restart repeat is idempotent');
    const store = S.createStore(S.fileStorage(root));
    eq((await store.snapshot()).decisions.length, 1, 'one decision after restarts');
    eq((fs.statSync(path.join(root, 'decisions.json')).mode & 0o077), 0, 'new file is private without permission changes');
    const rejected = await store.commit({ actor, operationId: operation('b'), expectedRevision: 0, decision: decision('b') });
    eq(rejected.reason, 'revision-changed', 'stale revision never silently rebases');
    eq(JSON.parse(run('read', root, 'b').stdout).status, 'rejected', 'rejected operation outcome is durable');
    const foreign = await store.outcome({ actor: 'session-' + 'b'.repeat(64), operationId: operation('a') });
    eq(foreign.status, 'unknown', 'durable receipts remain session-bound');
    const race = fresh(); S.initializeFileStorage(race);
    const results = await Promise.all([parallel(race, 'a'), parallel(race, 'b')]);
    eq(results.filter(r => r.status === 'confirmed').length, 1, 'cross-process lock and CAS permit one concurrent confirmation');
    eq((await S.createStore(S.fileStorage(race)).snapshot()).decisions.length, 1, 'race conserves one choice');
    const crash = fresh(); S.initializeFileStorage(crash);
    eq(run('crash', crash).status, 73, 'child terminates after file and directory sync before reply/lock release');
    eq(JSON.parse(run('read', crash).stdout).status, 'confirmed', 'reply-loss/crash recovers committed outcome');
    eq(JSON.parse(run('commit', crash, 'b').stdout).status, 'unavailable', 'orphan lock blocks writes without age-based recovery');
    const file = path.join(root, 'decisions.json');
    fs.linkSync(file, path.join(root, 'invented-hardlink'));
    await assert.rejects(store.snapshot()); checks++;
    fs.unlinkSync(path.join(root, 'invented-hardlink'));
    fs.renameSync(file, path.join(root, 'invented-retained-file'));
    fs.symlinkSync(path.join(root, 'invented-retained-file'), file);
    await assert.rejects(store.snapshot()); checks++;
    fs.unlinkSync(file);
    await assert.rejects(store.snapshot()); checks++;
    const forbidden = fresh(); fs.mkdirSync(path.join(forbidden, '.git'));
    assert.throws(() => S.fileStorage(forbidden)); checks++;
    const staticParent = fresh(), publicRoot = path.join(staticParent, 'public'); fs.mkdirSync(publicRoot, { mode: 0o700 });
    assert.throws(() => S.fileStorage(publicRoot)); checks++;
    assert.throws(() => S.fileStorage('.')); checks++;
    assert.throws(() => S.initializeFileStorage(crash)); checks++;
    const corrupt = fresh(); S.initializeFileStorage(corrupt);
    fs.writeFileSync(path.join(corrupt, 'decisions.json'), 'invented truncated write');
    await assert.rejects(S.createStore(S.fileStorage(corrupt)).snapshot()); checks++;
    eq(fs.readdirSync(root).some(file => file.startsWith('.decision-')), false, 'successful commits leave no temporary payload');
  } finally {
    for (const root of roots) {
      const absolute = path.resolve(root), base = path.resolve(os.tmpdir());
      assert.equal(path.dirname(absolute), base); assert.ok(path.basename(absolute).startsWith('atlas-card-store-synthetic-'));
      fs.rmSync(absolute, { recursive: true, force: true });
    }
  }
  console.log('PASS card decision store: ' + checks + ' synthetic POSIX durability/concurrency/privacy checks');
}
(process.argv[2] ? child() : main()).catch(e => { console.error(e); process.exitCode = 1; });
