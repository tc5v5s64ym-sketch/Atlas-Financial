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
const command = (kind, targetId) => ({ version: 1, kind, targetId });
function legacyDocument() {
  const state = { revision: 1, decisions: [decision('a')], outcomes: [{ operationId: operation('a'), actor,
    status: 'confirmed', revision: 1, reason: null, decisionId: decision('a').record.id }] };
  return JSON.stringify({ schema: 'atlas-card-payment-decisions/v1', state, digest: S.digest(state) });
}
function memory(body = S.initialDocument()) {
  let tail = Promise.resolve();
  return { read: () => body, replace: next => { body = next; }, update(transform) {
    const run = tail.then(() => { body = transform(body); }); tail = run.catch(() => {}); return run;
  } };
}
function decision(char) {
  return { actor, recordedAt: '2026-09-20T18:00:00.000Z', evidenceDigest: 'd'.repeat(64), referenceDates: ['2026-09-20'],
    record: { id: 'decision-' + char.repeat(32), confirmed: true, debitRef: 'pc-' + 'a'.repeat(24),
      creditRef: 'pc-' + 'b'.repeat(24), allocations: [{ purchaseRef: 'pc-' + 'c'.repeat(24), amount: 80 }],
      otherAmount: 0, otherPurpose: null } };
}
async function child() {
  const [mode, root, char] = process.argv.slice(2), store = S.createStore(S.fileStorage(root));
  if (mode.startsWith('transition-')) {
    // Terminate the process on either side of the one atomic rename.
    if (mode.includes('before')) fs.renameSync = () => process.exit(72);
    if (mode.includes('after')) {
      const unlink = fs.unlinkSync;
      fs.unlinkSync = file => { if (path.basename(file) === 'decisions.lock') process.exit(73); return unlink(file); };
    }
    const state = await store.snapshot();
    if (mode.includes('migrate')) console.log(JSON.stringify(await store.migrate({ expectedRevision: state.revision, expectedDigest: state.documentDigest })));
    else console.log(JSON.stringify(await store.commit({ actor, operationId: operation('b'), expectedRevision: 1,
      command: command(mode.includes('retract') ? 'retract' : 'replace', decision('a').record.id),
      decision: mode.includes('retract') ? null : decision('b') })));
    return;
  }
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
  if (mode !== 'crash' && !mode.startsWith('transition-')) eq(result.status, 0, 'child completes without exposing private errors');
  return result;
}
function parallel(root, char) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [__filename, 'commit', root, char], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; proc.stdout.on('data', chunk => { output += chunk; });
    proc.on('error', reject); proc.on('exit', code => code === 0 ? resolve(JSON.parse(output)) : reject(new Error('synthetic child failed')));
  });
}
async function transitions() {
  const storage = memory(), store = S.createStore(storage);
  const first = { actor, operationId: operation('a'), expectedRevision: 0, decision: decision('a') };
  const original = await store.commit(first), originalState = await store.snapshot();
  eq(await store.commit(first), original, 'identical operation retry is the original outcome');
  eq(await store.commit({ ...first, decision: decision('b') }), { status: 'conflict', operationId: operation('a') }, 'conflicting retry cannot claim the original succeeded');
  eq((await store.snapshot()).revision, 1, 'conflict cannot change revision or claims');
  const replace = { actor, operationId: operation('b'), expectedRevision: 1,
    command: command('replace', decision('a').record.id), decision: decision('b') };
  const successor = await store.commit(replace);
  eq(successor.status, 'confirmed', 'versioned replacement commits');
  const replaced = await store.snapshot();
  eq(replaced.decisions[0], originalState.decisions[0], 'original immutable intent survives replacement');
  eq(replaced.outcomes[0], originalState.outcomes[0], 'original immutable receipt survives replacement');
  eq(S.effectiveDecisions(replaced).map(d => d.record.id), [decision('b').record.id], 'exactly one successor is effective');
  eq(await store.commit(replace), successor, 'identical successor retry is idempotent');
  const stale = await store.commit({ ...replace, operationId: operation('c'), decision: decision('c') });
  eq(stale.reason, 'revision-changed', 'stale tab cannot replace a newer head');
  const wrong = await store.commit({ ...replace, operationId: operation('d'), expectedRevision: 3, decision: decision('d') });
  eq(wrong.reason, 'target-changed', 'current revision alone cannot resurrect a superseded target');
  const retract = { actor, operationId: operation('e'), expectedRevision: 4, command: command('retract', decision('b').record.id) };
  const withdrawn = await store.commit(retract);
  eq(S.effectiveDecisions(await store.snapshot()), [], 'explicit retraction removes only the effective interpretation');
  eq((await store.snapshot()).decisions, replaced.decisions, 'retraction preserves original and successor intents');
  eq(await store.commit(retract), withdrawn, 'retract retry is identical');
  eq((await store.commit({ ...retract, command: command('replace', decision('b').record.id), decision: decision('c') })).status,
    'conflict', 'same operation cannot mean both replace and retract');
  const restored = await store.commit({ ...replace, operationId: operation('f'), expectedRevision: 5,
    command: command('replace', decision('b').record.id), decision: decision('f') });
  eq(restored.status, 'confirmed', 'explicit replacement may restore the withdrawn head');
  eq(S.effectiveDecisions(await store.snapshot()).map(d => d.record.id), [decision('f').record.id], 'restoration still has one effective head');
  await assert.rejects(store.commit({ ...replace, operationId: operation('1'), expectedRevision: 6,
    command: command('replace', decision('f').record.id), decision: { ...decision('1'), record: { ...decision('1').record, debitRef: 'pc-' + 'e'.repeat(24) } } })); checks++;
  await assert.rejects(store.commit({ ...replace, command: { ...replace.command, version: 9 } })); checks++;
  const latest = JSON.parse(storage.read());
  for (const mutate of [
    value => { value.state.outcomes[1].command.targetId = decision('f').record.id; },
    value => { value.state.outcomes[1].decisionId = decision('a').record.id; },
    value => { value.state.decisions[1].record.creditRef = 'pc-' + 'e'.repeat(24); },
    value => { value.state.outcomes[1].command.version = 2; },
    value => { value.state.outcomes[4].decisionId = decision('a').record.id; },
    value => { value.state.decisions.pop(); },
  ]) {
    const bad = structuredClone(latest); mutate(bad); bad.digest = S.digest(bad.state);
    await assert.rejects(S.createStore(memory(JSON.stringify(bad))).snapshot()); checks++;
  }
  const legacy = legacyDocument(), old = memory(legacy), upgraded = S.createStore(old), before = await upgraded.snapshot();
  eq(S.effectiveDecisions(before), before.decisions, 'v1 remains safely readable before migration');
  await assert.rejects(upgraded.commit(replace)); checks++;
  eq(old.read(), legacy, 'v1 cannot be implicitly rewritten by a choice');
  await assert.rejects(upgraded.migrate({ expectedRevision: 0, expectedDigest: before.documentDigest })); checks++;
  await assert.rejects(upgraded.migrate({ expectedRevision: 1, expectedDigest: '0'.repeat(64) })); checks++;
  const migration = { expectedRevision: 1, expectedDigest: before.documentDigest };
  eq(await upgraded.migrate(migration), { status: 'migrated', revision: 1 }, 'explicit exact v1 transition');
  const after = await upgraded.snapshot();
  eq(after.legacyDocument, legacy, 'exact original v1 bytes travel inside the atomic document');
  eq([after.decisions, after.outcomes, after.revision], [before.decisions, before.outcomes, before.revision], 'migration preserves every original intent and receipt');
  eq(await upgraded.outcome({ actor, operationId: operation('a') }), { status: 'confirmed', operationId: operation('a'), revision: 1 }, 'original public receipt remains identical');
  await upgraded.commit(replace);
  eq(await upgraded.migrate(migration), { status: 'migrated', revision: 1 }, 'lost migration reply can be retried even after later operations');
  const migrated = JSON.parse(old.read()); migrated.state.legacyDocument = '{'; migrated.digest = S.digest(migrated.state);
  await assert.rejects(S.createStore(memory(JSON.stringify(migrated))).snapshot()); checks++;
  for (const body of ['{', legacy.replace('/v1', '/v99'), legacy.replace('"revision":1', '"revision":2')]) {
    const broken = memory(body), blocked = S.createStore(broken);
    await assert.rejects(blocked.migrate(migration)); checks++;
    eq(broken.read(), body, 'bad existing bytes are never initialized over');
  }
  for (const committed of [false, true]) {
    const uncertain = memory(legacy), update = uncertain.update.bind(uncertain), retry = S.createStore(uncertain);
    uncertain.update = async transform => { if (committed) await update(transform); throw new Error('synthetic crash'); };
    await assert.rejects(retry.migrate(migration)); checks++;
    eq((await retry.snapshot()).schema, committed ? S.SCHEMA : 'atlas-card-payment-decisions/v1', 'migration failure leaves an entire old or new document');
    uncertain.update = update; await retry.migrate(migration);
    eq((await retry.snapshot()).legacyDocument, legacy, 'migration retry preserves original bytes');
  }
}
async function main() {
  await transitions();
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
    for (const kind of ['migrate', 'replace', 'retract']) for (const point of ['before', 'after']) {
      const root = fresh(); S.initializeFileStorage(root);
      const file = path.join(root, 'decisions.json'), old = legacyDocument();
      fs.writeFileSync(file, old);
      const store = S.createStore(S.fileStorage(root));
      if (kind !== 'migrate') {
        const state = await store.snapshot(); await store.migrate({ expectedRevision: 1, expectedDigest: state.documentDigest });
      }
      const before = fs.readFileSync(file, 'utf8');
      eq(run('transition-' + kind + '-' + point, root).status, point === 'before' ? 72 : 73, 'real child crash ' + point + ' atomic ' + kind);
      const state = await store.snapshot();
      if (point === 'before') eq(fs.readFileSync(file, 'utf8'), before, 'pre-rename crash preserves exact original file');
      else if (kind === 'migrate') {
        eq(state.legacyDocument, old, 'post-rename migration retains exact v1 recovery source');
        eq(await store.migrate({ expectedRevision: 1, expectedDigest: S.digest(old) }), { status: 'migrated', revision: 1 }, 'post-commit migration retry reads its result despite orphan lock');
      }
      else {
        eq((await store.outcome({ actor, operationId: operation('b') })).status, 'confirmed', 'post-rename choice receipt survives process loss');
        eq(S.effectiveDecisions(state).map(d => d.record.id), kind === 'replace' ? [decision('b').record.id] : [], 'atomic effective head after crash');
        eq((await store.commit({ actor, operationId: operation('b'), expectedRevision: 1,
          command: command(kind, decision('a').record.id), decision: kind === 'replace' ? decision('b') : null })).status,
        'confirmed', 'identical committed correction retry needs no orphan-lock recovery');
      }
      eq(fs.existsSync(path.join(root, 'decisions.lock')), true, 'crash retains orphan lock');
      await assert.rejects(store.commit({ actor, operationId: operation('c'), expectedRevision: state.revision, decision: decision('c') })); checks++;
      assert.throws(() => S.initializeFileStorage(root)); checks++;
      eq((await store.snapshot()).decisions[0], decision('a'), 'orphan lock never hides original intent from a supported reader');
    }
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
    assert.throws(() => S.initializeFileStorage(corrupt)); checks++;
    eq(fs.readFileSync(path.join(corrupt, 'decisions.json'), 'utf8'), 'invented truncated write', 'corrupt file is never replaced with empty state');
    fs.writeFileSync(path.join(corrupt, 'decisions.json'), legacyDocument().replace('/v1', '/v99'));
    await assert.rejects(S.createStore(S.fileStorage(corrupt)).snapshot()); checks++;
    assert.throws(() => S.initializeFileStorage(corrupt)); checks++;
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
