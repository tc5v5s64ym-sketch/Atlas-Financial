'use strict';
// INT-3 C2 (#751): OFFLINE trusted restore-input binding. FOUNDATION ONLY.
// Future consumer: the separately reviewed RQ4/RQ6 maintenance caller of
// restore-settlement-evidence.js. No current production importer or executor.
//
// TRUST BOUNDARY: createRestoreRequestBinder receives a SEPARATELY trusted,
// owner-attested custody snapshot, including a pinned latest record digest.
// It must NEVER be constructed from the restored candidate or a restored DB.
// Provenance references/independence flags are required assertions, not proof
// of authenticity, durable custody, or latestness. Replaying the entire trusted
// snapshot is outside this binder's detection ability. The caller must obtain
// fresh independent custody evidence for every authorized attempt; this object
// is an immutable binding of ONE snapshot, not a custody store or freshness
// service. No signature, provider, secret, decryption or setup is invented here.
//
// Only latest-control produces the existing command's exact JSON schema.
// A genuine known-stale pair may be bound for attack staging, but gets NO owner
// command request: its anchorsCurrent precondition would be false. Orchestration
// of that attack remains a separate assignment. REQUEST_BOUND is neither an
// installation, target-readiness, INT-3/INT-5 qualification nor reopen authority.
// Files are relative leaf names only, for a future owner-private root. This
// module writes nothing; the command still enforces path/ACL/file identity,
// current-session checks and private credential input at execution time.
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const P = require('./settlement-evidence-int3-maintenance-profile');
const V = require('./settlement-evidence-restore-input');
const C = require('./planned-obligation-settlement-contract');

const SCHEMA = 'settlement-int3-restore-binding-1';
const HASH = /^[a-f0-9]{64}$/, ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
const HH = /^household-[a-f0-9]{32}$/, NS = /^ledger-[a-f0-9]{32}$/;
const LEDGER_MAX = 2 * 1024 * 1024, HISTORY_MAX = 4 * 1024 * 1024;
const TA = Object.getPrototypeOf(Uint8Array.prototype);
const intrinsic = k => Object.getOwnPropertyDescriptor(TA, k).get;
const TAG = intrinsic(Symbol.toStringTag), BUFFER = intrinsic('buffer');
const OFFSET = intrinsic('byteOffset'), LENGTH = intrinsic('byteLength'), SET = TA.set;
const failures = new WeakMap();
function need(ok, reason) { if (!ok) { const e = {}; failures.set(e,reason); throw e; } }
function exact(v, keys, reason) {
  need(v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype, reason);
  const d = Object.getOwnPropertyDescriptors(v);
  need(Reflect.ownKeys(d).length === keys.length && keys.every(k => Object.hasOwn(d,k) && Object.hasOwn(d[k],'value') && d[k].enumerable), reason);
  return Object.fromEntries(keys.map(k => [k,d[k].value]));
}
// Bounded, descriptor-only copy of trusted declarative data; no toJSON/getters.
function own(v, budget = { nodes: 0 }, depth = 0) {
  need(++budget.nodes <= 8192 && depth <= 20,'custody-invalid');
  if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isSafeInteger(v))) return v;
  if (typeof v === 'string') { need(v.length <= 4096,'custody-invalid'); return v; }
  need(v !== null && typeof v === 'object','custody-invalid');
  const array = Array.isArray(v);
  need(array || Object.getPrototypeOf(v) === Object.prototype,'custody-invalid');
  const keys = Reflect.ownKeys(v); need(keys.length <= 256,'custody-invalid');
  const out = array ? [] : {};
  if (array) need(keys.length === v.length + 1,'custody-invalid');
  for (const k of keys) {
    if (array && k === 'length') continue;
    const d = Object.getOwnPropertyDescriptor(v,k);
    need(typeof k === 'string' && k !== '__proto__' && d && Object.hasOwn(d,'value') && d.enumerable,'custody-invalid');
    if (array) need(/^(0|[1-9][0-9]*)$/.test(k) && Number(k) < v.length,'custody-invalid');
    out[k] = own(d.value,budget,depth+1);
  }
  return out;
}
function freeze(v) { if (v && typeof v === 'object') { for (const x of Object.values(v)) freeze(x); Object.freeze(v); } return v; }
const id = v => typeof v === 'string' && ID.test(v);
const hash = v => typeof v === 'string' && HASH.test(v);
const revision = v => Number.isSafeInteger(v) && v >= 0;
function domain(v, reason) {
  const d = exact(v,['householdId','ledgerNamespace'],reason);
  need(typeof d.householdId === 'string' && HH.test(d.householdId) && typeof d.ledgerNamespace === 'string' && NS.test(d.ledgerNamespace),reason);
  return d;
}
function target(v) {
  const t = exact(v,['host','port','database','user','schema','scope'],'profile-invalid');
  need(typeof t.host === 'string' && t.host.length <= 253 && t.host.includes('.') && !t.host.includes('-pooler') && !/^[0-9.]+$/.test(t.host) &&
    t.host.split('.').every(s => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s)),'profile-invalid');
  need(Number.isInteger(t.port) && t.port > 0 && t.port <= 65535 && ['database','user','schema'].every(k => typeof t[k] === 'string' && IDENT.test(t[k])) && id(t.scope),'profile-invalid');
  return t;
}
function anchors(v, d) {
  const a = exact(v,['ledger','history'],'custody-invalid');
  const l = exact(a.ledger,['revision','documentDigest'],'custody-invalid');
  const h = exact(a.history,['schema','householdId','ledgerNamespace','revision','digest'],'custody-invalid');
  need(revision(l.revision) && hash(l.documentDigest) && h.schema === 'terminal-history-checkpoint-1' && revision(h.revision) && hash(h.digest) &&
    h.householdId === d.householdId && h.ledgerNamespace === d.ledgerNamespace,'custody-invalid');
  return { ledger: l, history: h };
}
function captureTrusted(value) {
  const t = exact(own(value),['profile','target','domain','custody'],'custody-invalid');
  // Never accept a caller-constructed 'compatible' verdict as a capability.
  need(P.validateMaintenanceProfile(t.profile).status === 'compatible','profile-invalid');
  const dest = target(t.target), d = domain(t.domain,'custody-invalid');
  need(dest.database === t.profile.maintenanceIdentity.database && dest.user === t.profile.maintenanceIdentity.user &&
    dest.schema === t.profile.namespace.schema && dest.scope === t.profile.namespace.scope,'profile-invalid');
  const c = exact(t.custody,['sourceId','provenanceId','independentOfCandidate','independentOfTarget','latest','records'],'custody-invalid');
  need(id(c.sourceId) && id(c.provenanceId) && c.independentOfCandidate === true && c.independentOfTarget === true,'custody-invalid');
  const latest = exact(c.latest,['recordId','recordDigest'],'custody-invalid');
  need(id(latest.recordId) && hash(latest.recordDigest) && Array.isArray(c.records) && c.records.length > 0 && c.records.length <= 16,'custody-invalid');
  const records = new Map();
  for (const raw of c.records) {
    const r = exact(raw,['id','provenanceId','target','domain','anchors','pin','candidateHashes'],'custody-invalid');
    need(id(r.id) && id(r.provenanceId) && !records.has(r.id) && isDeepStrictEqual(r.target,dest) && isDeepStrictEqual(r.domain,d),'custody-invalid');
    r.anchors = anchors(r.anchors,d);
    r.candidateHashes = exact(r.candidateHashes,['ledgerSha256','historySha256'],'custody-invalid');
    need(hash(r.pin) && hash(r.candidateHashes.ledgerSha256) && hash(r.candidateHashes.historySha256),'custody-invalid');
    records.set(r.id,freeze(r));
  }
  need(records.has(latest.recordId) && C.digest(records.get(latest.recordId)) === latest.recordDigest,'custody-invalid');
  // An attack must actually precede latest (either ledger or history), never
  // be a conflicting equal-revision record or a future record labelled stale.
  const current = records.get(latest.recordId);
  for (const r of records.values()) if (r.id !== latest.recordId) {
    const l = r.anchors.ledger, h = r.anchors.history, cl = current.anchors.ledger, ch = current.anchors.history;
    need(l.revision <= cl.revision && h.revision <= ch.revision && (l.revision < cl.revision || h.revision < ch.revision) &&
      (l.revision !== cl.revision || l.documentDigest === cl.documentDigest) && (h.revision !== ch.revision || h.digest === ch.digest),'custody-invalid');
  }
  return { target: freeze(dest), domain: freeze(d), profileDigest: C.digest(t.profile), sourceId: c.sourceId, custodyProvenanceId: c.provenanceId, latest: freeze(latest), records };
}
function bytes(v,max) {
  need(v !== null && typeof v === 'object' && Reflect.apply(TAG,v,[]) === 'Uint8Array','input-invalid');
  const n = Reflect.apply(LENGTH,v,[]), backing = Reflect.apply(BUFFER,v,[]);
  need(n > 0 && n <= max && backing instanceof ArrayBuffer,'input-invalid');
  const out = Buffer.alloc(n);
  Reflect.apply(SET,out,[new Uint8Array(backing,Reflect.apply(OFFSET,v,[]),n)]);
  return out;
}
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const unavailable = reason => freeze({ schema: SCHEMA, status: 'NOT_READY', reason, request: null, qualified: false, reopen: false });

function createRestoreRequestBinder(trusted) {
  let t, error;
  try { t = captureTrusted(trusted); } catch (e) { error = failures.get(e) || 'custody-invalid'; }
  return Object.freeze({ bind(input) {
    if (error) return unavailable(error);
    try {
      const i = exact(input,['purpose','custodyRecordId','candidate','files','preconditions'],'input-invalid');
      need(['latest-control','stale-attack'].includes(i.purpose) && id(i.custodyRecordId),'input-invalid');
      const candidate = exact(i.candidate,['ledgerBytes','historyBytes'],'input-invalid');
      const captured = { ledgerBytes: bytes(candidate.ledgerBytes,LEDGER_MAX), historyBytes: bytes(candidate.historyBytes,HISTORY_MAX) };
      const files = exact(i.files,['ledgerFile','historyFile'],'input-invalid');
      need(Object.values(files).every(f => typeof f === 'string' && /^[a-z][a-z0-9-]{0,63}\.json$/.test(f)) && files.ledgerFile !== files.historyFile,'input-invalid');
      const pre = exact(i.preconditions,['quiescent','restartInhibited','ownerDecrypted'],'input-invalid');
      need(Object.values(pre).every(x => x === true),'input-invalid');
      const r = t.records.get(i.custodyRecordId); need(r,'custody-record-missing');
      const latest = r.id === t.latest.recordId;
      need(i.purpose !== 'latest-control' || latest,'stale-as-latest');
      need(i.purpose !== 'stale-attack' || !latest,'attack-not-stale');
      const hashes = { ledgerSha256: sha(captured.ledgerBytes), historySha256: sha(captured.historyBytes) };
      need(isDeepStrictEqual(hashes,r.candidateHashes),'candidate-mismatch');
      const v = V.validateRestoreInput({ domain: t.domain, anchors: r.anchors, candidate: captured });
      need(v.status === 'valid' && v.ledger.pin === r.pin,'candidate-mismatch');
      const request = latest ? { schema: 'settlement-owner-restore-request-1', target: t.target, domain: t.domain, anchors: r.anchors,
        candidate: files, pin: r.pin, preconditions: { ...pre, anchorsCurrent: true } } : null;
      return freeze({ schema: SCHEMA, status: latest ? 'REQUEST_BOUND' : 'ATTACK_INPUT_BOUND', request, qualified: false, reopen: false,
        binding: { purpose: i.purpose, profileDigest: t.profileDigest, requestDigest: request ? C.digest(request) : null,
          sourceId: t.sourceId, custodyProvenanceId: t.custodyProvenanceId, provenanceId: r.provenanceId,
          recordId: r.id, recordDigest: C.digest(r), latestRecordDigest: t.latest.recordDigest, latestness: latest ? 'caller-attested-not-proved' : 'known-stale',
          target: t.target, domain: t.domain, anchors: r.anchors, pin: r.pin, candidateHashes: hashes } });
    } catch (e) { return unavailable(failures.get(e) || 'input-invalid'); }
  } });
}

module.exports = Object.freeze({ createRestoreRequestBinder });
