'use strict';
// Inert private intent storage. No default path, env, grants or provider access.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const LEGACY_SCHEMA = 'atlas-card-payment-decisions/v1';
const SCHEMA = 'atlas-card-payment-decisions/v2';
const ROOT = path.resolve(__dirname, '..');
const reasons = ['revision-changed', 'evidence-changed', 'preview-expired', 'validation-unavailable', 'decision-exists', 'target-changed'];
const fail = () => { throw new Error('card-decision-unavailable'); };
const check = value => { if (!value) fail(); };
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const digest = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const opaque = prefix => prefix + crypto.randomBytes(16).toString('hex');
const actorValid = value => typeof value === 'string' && /^session-[a-f0-9]{64}$/.test(value);
const operationValid = value => typeof value === 'string' && /^operation-[a-f0-9]{32}$/.test(value);
const ref = value => typeof value === 'string' && /^pc-[a-f0-9]{24}$/.test(value);
const cents = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
  && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
function keys(value, allowed) {
  check(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === allowed.length && allowed.every(key => Object.hasOwn(value, key)));
}
function date(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
    && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}
function recordValid(record) {
  keys(record, ['id', 'confirmed', 'debitRef', 'creditRef', 'allocations', 'otherAmount', 'otherPurpose']);
  check(/^decision-[a-f0-9]{32}$/.test(record.id) && record.confirmed === true
    && ref(record.debitRef) && ref(record.creditRef) && record.debitRef !== record.creditRef
    && cents(record.otherAmount) && [null, 'prior-debt', 'required-payment', 'other'].includes(record.otherPurpose)
    && Array.isArray(record.allocations) && record.allocations.length <= 200);
  const seen = new Set();
  for (const part of record.allocations) {
    keys(part, ['purchaseRef', 'amount']);
    check(ref(part.purchaseRef) && cents(part.amount) && part.amount > 0 && !seen.has(part.purchaseRef));
    seen.add(part.purchaseRef);
  }
  return record;
}
function decisionValid(decision) {
  keys(decision, ['record', 'actor', 'recordedAt', 'evidenceDigest', 'referenceDates']);
  recordValid(decision.record);
  check(actorValid(decision.actor) && typeof decision.recordedAt === 'string'
    && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(decision.recordedAt) && Number.isFinite(Date.parse(decision.recordedAt))
    && /^[a-f0-9]{64}$/.test(decision.evidenceDigest) && Array.isArray(decision.referenceDates)
    && decision.referenceDates.length > 0 && decision.referenceDates.length <= 202 && decision.referenceDates.every(date));
}
function envelope(body) {
  check(typeof body === 'string' && Buffer.byteLength(body) <= 2 * 1024 * 1024);
  const envelope = JSON.parse(body); keys(envelope, ['schema', 'state', 'digest']);
  check([LEGACY_SCHEMA, SCHEMA].includes(envelope.schema) && envelope.digest === digest(envelope.state));
  return envelope;
}
function legacyState(body) {
  const doc = envelope(body);
  check(doc.schema === LEGACY_SCHEMA);
  const state = doc.state; keys(state, ['revision', 'decisions', 'outcomes']);
  check(Number.isSafeInteger(state.revision) && state.revision >= 0 && Array.isArray(state.decisions)
    && Array.isArray(state.outcomes) && state.decisions.length <= 1000 && state.outcomes.length <= 2000
    && state.outcomes.length === state.revision);
  state.decisions.forEach(decisionValid);
  check(new Set(state.decisions.map(d => d.record.creditRef)).size === state.decisions.length
    && new Set(state.decisions.map(d => d.record.id)).size === state.decisions.length);
  state.outcomes.forEach((o, index) => {
    keys(o, ['operationId', 'actor', 'status', 'revision', 'reason', 'decisionId']);
    check(operationValid(o.operationId) && actorValid(o.actor) && o.revision === index + 1
      && (o.status === 'confirmed' ? o.reason === null && state.decisions.some(d => d.record.id === o.decisionId && d.actor === o.actor)
        : o.status === 'rejected' && reasons.slice(0, 5).includes(o.reason) && o.decisionId === null));
  });
  check(new Set(state.outcomes.map(o => o.operationId)).size === state.outcomes.length
    && state.decisions.every(d => state.outcomes.filter(o => o.decisionId === d.record.id).length === 1));
  return state;
}
// Keep the v1 validator intact: migration never repairs or guesses existing data.
function commandValid(command) {
  keys(command, ['version', 'kind', 'targetId']);
  check(command.version === 1 && ['append', 'replace', 'retract'].includes(command.kind)
    && (command.kind === 'append' ? command.targetId === null
      : typeof command.targetId === 'string' && /^decision-[a-f0-9]{32}$/.test(command.targetId)));
  return command;
}
const append = () => ({ version: 1, kind: 'append', targetId: null });
function heads(state) {
  const result = new Map(), decisions = new Map(state.decisions.map(d => [d.record.id, d]));
  for (const o of state.outcomes) if (o.status === 'confirmed') {
    const command = o.command || append();
    const target = decisions.get(command.targetId), next = decisions.get(o.decisionId);
    const credit = (next || target).record.creditRef;
    result.set(credit, { decision: next || target, active: command.kind !== 'retract' });
  }
  return result;
}
function effectiveDecisions(state) {
  return [...heads(state).values()].filter(h => h.active).map(h => h.decision);
}
function operationTarget(state, command) {
  commandValid(command);
  return [...heads(state).values()].find(h => h.decision.record.id === command.targetId
    && (command.kind === 'replace' || h.active))?.decision || null;
}
function decode(body) {
  const doc = envelope(body);
  if (doc.schema === LEGACY_SCHEMA) return { schema: doc.schema, state: legacyState(body) };
  const state = doc.state; keys(state, ['revision', 'decisions', 'outcomes', 'legacyDocument']);
  check(Number.isSafeInteger(state.revision) && state.revision >= 0 && Array.isArray(state.decisions)
    && Array.isArray(state.outcomes) && state.decisions.length <= 1000 && state.outcomes.length <= 2000
    && state.outcomes.length === state.revision);
  const legacy = state.legacyDocument === null ? { decisions: [], outcomes: [] } : legacyState(state.legacyDocument);
  check(canonical(state.decisions.slice(0, legacy.decisions.length)) === canonical(legacy.decisions)
    && canonical(state.outcomes.slice(0, legacy.outcomes.length)) === canonical(legacy.outcomes));
  state.decisions.forEach(decisionValid);
  const seen = new Set(), operations = new Set(), current = new Map();
  let index = 0;
  for (const o of state.outcomes) {
    const inherited = index < legacy.outcomes.length;
    keys(o, ['operationId', 'actor', 'status', 'revision', 'reason', 'decisionId', ...(inherited ? [] : ['command', 'requestDigest'])]);
    const command = inherited ? append() : commandValid(o.command);
    check(operationValid(o.operationId) && !operations.has(o.operationId) && actorValid(o.actor)
      && o.revision === ++index && (inherited || /^[a-f0-9]{64}$/.test(o.requestDigest)));
    operations.add(o.operationId);
    if (o.status === 'rejected') { check(reasons.includes(o.reason) && o.decisionId === null); continue; }
    check(o.status === 'confirmed' && o.reason === null);
    const target = state.decisions.find(d => d.record.id === command.targetId);
    if (command.kind !== 'append') {
      const head = target && current.get(target.record.creditRef);
      check(head && head.decision.record.id === command.targetId && (command.kind === 'replace' || head.active));
    }
    if (command.kind === 'retract') {
      check(o.decisionId === null); current.set(target.record.creditRef, { decision: target, active: false }); continue;
    }
    const decision = state.decisions[seen.size];
    check(decision && decision.record.id === o.decisionId && decision.actor === o.actor && !seen.has(o.decisionId));
    const record = decision.record;
    check(command.kind === 'append' ? !current.has(record.creditRef)
      : record.creditRef === target.record.creditRef && record.debitRef === target.record.debitRef);
    seen.add(o.decisionId); current.set(record.creditRef, { decision, active: true });
  }
  check(seen.size === state.decisions.length);
  return { schema: doc.schema, state };
}
const encode = state => JSON.stringify({ schema: SCHEMA, state, digest: digest(state) });
const initialDocument = () => encode({ revision: 0, decisions: [], outcomes: [], legacyDocument: null });
function receipt(row, operationId) {
  return row ? { status: row.status, operationId, revision: row.revision, ...(row.reason ? { reason: row.reason } : {}) }
    : { status: 'unknown', operationId };
}
function createStore(storage) {
  check(storage && typeof storage.read === 'function' && typeof storage.update === 'function');
  const snapshot = async () => {
    const body = await storage.read(), { schema, state } = decode(body);
    return { ...state, schema, documentDigest: digest(body) };
  };
  return { snapshot, async outcome({ actor, operationId }) {
    check(actorValid(actor) && operationValid(operationId));
    return receipt((await snapshot()).outcomes.find(o => o.operationId === operationId && o.actor === actor), operationId);
  }, async migrate({ expectedRevision, expectedDigest }) {
    check(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0 && /^[a-f0-9]{64}$/.test(expectedDigest));
    const migrated = ({ schema, state }) => {
      if (schema !== SCHEMA) return false;
      check(state.legacyDocument !== null && digest(state.legacyDocument) === expectedDigest
        && legacyState(state.legacyDocument).revision === expectedRevision); return true;
    };
    const result = { status: 'migrated', revision: expectedRevision };
    if (migrated(decode(await storage.read()))) return result; // Read-only recovery even with an orphan lock.
    await storage.update(body => {
      const decoded = decode(body); if (migrated(decoded)) return body;
      const { state } = decoded;
      check(state.revision === expectedRevision && digest(body) === expectedDigest);
      const after = encode({ ...state, legacyDocument: body }); decode(after); return after;
    });
    return result;
  }, async commit({ actor, operationId, expectedRevision, decision = null, reason = null, command = append() }) {
    check(actorValid(actor) && operationValid(operationId) && Number.isSafeInteger(expectedRevision) && expectedRevision >= 0);
    command = JSON.parse(JSON.stringify(command)); commandValid(command);
    if (decision) { decision = JSON.parse(JSON.stringify(decision)); decisionValid(decision); check(decision.actor === actor && reason === null); }
    else check(reasons.includes(reason) || (command.kind === 'retract' && reason === null));
    check(command.kind !== 'retract' || decision === null);
    const requestDigest = digest({ actor, expectedRevision, decision, reason, command });
    const retry = existing => existing.actor !== actor ? receipt(null, operationId) : existing.requestDigest !== requestDigest
      ? { status: 'conflict', operationId } : receipt(existing, operationId);
    const before = await snapshot(); check(before.schema === SCHEMA);
    const previous = before.outcomes.find(o => o.operationId === operationId);
    if (previous) return retry(previous); // Immutable outcome lookup needs no writer lock.
    let result;
    await storage.update(body => {
      const { schema, state } = decode(body); check(schema === SCHEMA);
      const existing = state.outcomes.find(o => o.operationId === operationId);
      if (existing) {
        result = retry(existing); return body;
      }
      if (state.revision !== expectedRevision) reason = 'revision-changed';
      else if (command.kind !== 'append' && !operationTarget(state, command)) reason = 'target-changed';
      else if (command.kind === 'append' && decision && state.decisions.some(d => d.record.creditRef === decision.record.creditRef)) reason = 'decision-exists';
      if (!reason && command.kind === 'replace') {
        const target = operationTarget(state, command).record;
        check(decision.record.creditRef === target.creditRef && decision.record.debitRef === target.debitRef);
      }
      check(state.revision < 2000 && (!decision || reason || state.decisions.length < 1000));
      const saved = !reason;
      const outcome = { operationId, actor, revision: ++state.revision, status: saved ? 'confirmed' : 'rejected',
        reason: saved ? null : reason, decisionId: saved && decision ? decision.record.id : null, command, requestDigest };
      if (saved && decision) state.decisions.push(decision);
      state.outcomes.push(outcome); result = receipt(outcome, operationId);
      const encoded = encode(state); decode(encoded); return encoded;
    });
    return result;
  } };
}
function within(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
function privateRoot(root) {
  // The incumbent POSIX private-store convention; Windows ACL/directory durability is unqualified.
  check(process.platform !== 'win32' && typeof root === 'string' && path.isAbsolute(root));
  root = path.resolve(root);
  let cursor = path.parse(root).root;
  for (const part of root.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    check(!['public', 'static', 'www', 'wwwroot', 'htdocs'].includes(part.toLowerCase()) && !fs.lstatSync(cursor).isSymbolicLink());
  }
  for (let dir = root; ; dir = path.dirname(dir)) {
    check(!fs.existsSync(path.join(dir, '.git')) && !(fs.existsSync(path.join(dir, 'HEAD')) && fs.existsSync(path.join(dir, 'objects'))));
    if (dir === path.dirname(dir)) break;
  }
  const worktrees = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n').filter(line => line.startsWith('worktree ')).map(line => line.slice(9));
  check(![ROOT, ...worktrees].some(repo => within(repo, root) || within(root, repo)));
  const stat = fs.lstatSync(root);
  check(stat.isDirectory() && (stat.mode & 0o077) === 0 && stat.uid === process.getuid());
  return { root, dev: stat.dev, ino: stat.ino };
}
function fileStorage(destination) {
  const checked = privateRoot(destination), root = checked.root, file = path.join(root, 'decisions.json');
  function directory() {
    const current = privateRoot(root); check(current.dev === checked.dev && current.ino === checked.ino);
    const fd = fs.openSync(root, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try { const stat = fs.fstatSync(fd); check(stat.dev === checked.dev && stat.ino === checked.ino); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
  }
  function read() {
    directory(); const stat = fs.lstatSync(file);
    check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.uid === process.getuid()
      && (stat.mode & 0o077) === 0 && stat.size <= 2 * 1024 * 1024);
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try { const opened = fs.fstatSync(fd); check(opened.dev === stat.dev && opened.ino === stat.ino && opened.nlink === 1);
      return fs.readFileSync(fd, 'utf8'); } finally { fs.closeSync(fd); }
  }
  directory(); // Unsupported fsync fails before any decision can be written.
  return { read, update(transform) {
    directory(); const lock = path.join(root, 'decisions.lock');
    const gate = fs.openSync(lock, 'wx', 0o600); // Never steal a stale lock by age.
    const temp = path.join(root, opaque('.decision-'));
    try {
      const before = read(), after = transform(before); if (before === after) return;
      decode(after);
      const fd = fs.openSync(temp, 'wx', 0o600);
      try { fs.writeFileSync(fd, after); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      directory(); fs.renameSync(temp, file); directory();
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
      fs.closeSync(gate); fs.unlinkSync(lock);
    }
  } };
}
function initializeFileStorage(destination) {
  const { root } = privateRoot(destination); check(fs.readdirSync(root).length === 0);
  const storage = fileStorage(root), fd = fs.openSync(path.join(root, 'decisions.json'), 'wx', 0o600);
  try { fs.writeFileSync(fd, initialDocument()); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  storage.read(); return storage;
}
module.exports = { createStore, fileStorage, initializeFileStorage, initialDocument,
  digest, opaque, actorValid, operationValid, recordValid, commandValid, effectiveDecisions, operationTarget, SCHEMA };
