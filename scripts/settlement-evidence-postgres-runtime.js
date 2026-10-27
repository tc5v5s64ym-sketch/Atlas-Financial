'use strict';
// FOUNDATION - NOT ACTIVATION. Explicit composition for createApplication's
// existing settlement dependency. Default construction performs no I/O.
// No driver, environment secrets, bootstrap, reconciliation or reconnect.
// Independent pin/archive and rollback checkpoint custody remain prerequisites.
// Explicit native history is local persistence, never independent rollback proof.
const { createSettlementEvidencePostgresConnection } = require('./settlement-evidence-postgres-connection');
const { createSettlementEvidenceStore } = require('./settlement-evidence-store');
const TC = require('./settlement-evidence-terminal-certificate');
const { types: utilTypes } = require('node:util');
const promiseThen = Promise.prototype.then;

const invalid = () => new TypeError('settlement-postgres-runtime: incomplete configuration');
function record(value, allowed, required = allowed) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (!Reflect.ownKeys(descriptors).every(k => typeof k === 'string' && allowed.includes(k)
    && Object.hasOwn(descriptors[k], 'value')) || !required.every(k => Object.hasOwn(descriptors,k))) throw invalid();
  return Object.freeze(Object.fromEntries(Object.entries(descriptors).map(([k,d]) => [k,d.value])));
}
function methods(value, names) {
  const snapshot = record(value, names);
  if (names.some(k => typeof snapshot[k] !== 'function')) throw invalid();
  return snapshot;
}
function isNativeHistory(value) {
  if(value&&Object.getPrototypeOf(value)===Object.prototype&&Object.hasOwn(value,'mode')){
    const selected=record(value,['mode']);if(selected.mode!=='postgres')throw invalid();return true;
  }
  return false;
}
function unavailable() {
  // Never forward injected policy/custody/driver errors, input or connection config.
  const error = new Error('settlement-postgres-runtime: unavailable; an interrupted write may be unknown');
  error.code = 'SETTLEMENT_RUNTIME_UNAVAILABLE'; return error;
}

function createSettlementEvidencePostgresRuntime(options) {
  let phase = 'disconnected', owner = null, opening = null, retiring = null, primary = null;
  let lastFailureRetirement = null;
  let settlement;
  const ready = () => phase === 'ready' && owner?.status().state === 'ready';
  function check() { if (!ready()) throw unavailable(); }
  function status() {
    const current = owner?.status();
    return Object.freeze({ state: phase === 'ready' ? current.state : phase,
      primary: current?.primary || primary, retirement: current?.retirement || lastFailureRetirement });
  }
  function fence(fn) {
    return (...args) => {
      try {
        check(); const value = fn(...args);
        if (value && typeof value.then === 'function') return Promise.resolve(value).then(result => {
          check(); return result;
        }, () => { throw unavailable(); });
        check(); return value;
      } catch { throw unavailable(); }
    };
  }
  function disclosureFence(fn) {
    // The HTTP seam requires a synchronous exact-true predicate. Never read or
    // assimilate supplied thenables through the generic asynchronous fence.
    return (...args) => {
      try {
        check(); const value = fn(...args);
        if (value !== true && utilTypes.isPromise(value)) {
          // Match #700's bounded ordinary native-Promise refusal containment.
          // Do this BEFORE the post-call check: reentrant retirement must not
          // hide a rejected Promise from the HTTP seam and leave it unhandled.
          try { Reflect.apply(promiseThen,value,[() => {},() => {}]); }
          catch { /* refusal stands; hostile constructor/species is out of scope */ }
        }
        check(); return value === true;
      } catch { throw unavailable(); }
    };
  }
  const surface = (source,names) => Object.freeze(Object.fromEntries(names.map(name =>
    [name,fence((...args) => source()[name](...args))])));
  let connection;
  if (options !== undefined) {
    const o = record(options,['connection','custody','application','recovery'],['connection','custody','application']);
    const recovery = o.recovery === undefined ? null
      : record(o.recovery,['recoveryRead','authorizeRecovery','finalDisclosureAuthorize','authorizeRecoveryFinal','issueRecoveryEligibility'],['recoveryRead','authorizeRecovery']);
    if (recovery && (recovery.recoveryRead !== true || typeof recovery.authorizeRecovery !== 'function'
      || (recovery.finalDisclosureAuthorize !== undefined && typeof recovery.finalDisclosureAuthorize !== 'function')
      || (recovery.authorizeRecoveryFinal !== undefined && typeof recovery.authorizeRecoveryFinal !== 'function')
      || (recovery.issueRecoveryEligibility !== undefined && typeof recovery.issueRecoveryEligibility !== 'function')
      // Exactly one final authority: the synchronous disclosure predicate
      // or the awaited recovery-final authority, never both, never neither.
      || (typeof recovery.finalDisclosureAuthorize === 'function')
        === (typeof recovery.authorizeRecoveryFinal === 'function'))) throw invalid();
    const supplied = record(o.connection,['Client','config','schema','scope','timeouts'],['Client','config','schema','scope']);
    const config = record(supplied.config,['host','port','database','user','password','ssl']);
    connection = Object.freeze({...supplied,config:{...config,ssl:record(config.ssl,['rejectUnauthorized','servername'])},
      ...(supplied.timeouts === undefined ? {} : {timeouts:record(supplied.timeouts,['connect','preflight','query','close'],[])})});
    const a = record(o.application,['householdId','origin','authorize','acquire','contextReader','readBase','now']);
    if (!/^household-[a-f0-9]{32}$/.test(a.householdId)
      || ['authorize','acquire','contextReader','readBase','now'].some(k => typeof a[k] !== 'function')) throw invalid();
    let origin;
    try { origin = new URL(a.origin); } catch { throw invalid(); }
    if (!['http:','https:'].includes(origin.protocol) || origin.origin !== a.origin || origin.username || origin.password) throw invalid();
    const c = record(o.custody,['pinStore','backupStore','terminalHistory','exclusionDomain']);
    const pin = methods(c.pinStore,['read','advance']), backup = methods(c.backupStore,['put','get','list']);
    // Explicit native selection only; existing injected surfaces remain unchanged.
    // No constructor, provisioning, snapshot read or implicit empty genesis here.
    const nativeHistory=isNativeHistory(c.terminalHistory);
    const history = nativeHistory?null:methods(c.terminalHistory,['readSnapshot','compareAndAppend']);
    if(nativeHistory){
      const domain=record(c.exclusionDomain,['ledgerNamespace','serializationAuthority','historyAuthority']);
      connection=Object.freeze({...connection,terminalHistory:Object.freeze({householdId:a.householdId,ledgerNamespace:domain.ledgerNamespace})});
    }
    // Construct the REAL store before connecting. Its existing constructor owns
    // domain/mode/alias validation. Stable local proxies bind to the sole verified
    // owner only after connect; constructing them never calls a dependency.
    let store;
    try {
      // Preserve the incumbent registry's visibility of the actual injected pin
      // surface as well as the stable fenced proxies; wrappers are not aliases.
      TC.registerDomain(a.householdId,c.exclusionDomain,true,[c.pinStore]);
      store = createSettlementEvidenceStore({householdId:a.householdId,
        documentStore:surface(() => owner.documentStore,['read','readStaged','writeTemp','commitTemp','discardTemp']),
        journalStore:surface(() => owner.journalStore,['read','write','clear']),
        quarantine:surface(() => owner.quarantine,['put']),lock:surface(() => owner.lock,['withLock']),
        pinStore:surface(() => pin,['read','advance']),backupStore:surface(() => backup,['put','get','list']),
        terminalHistory:surface(() => nativeHistory?owner.terminalHistory:history,['readSnapshot','compareAndAppend']),
        exclusionDomain:c.exclusionDomain,now:fence(a.now),...(recovery ? {recoveryRead:true} : {})});
    } catch { throw invalid(); }
    const exposedStore = {...surface(() => store,['prepare','commitWithoutRecovery','outcome','inspectAttempt']),
      ...(recovery ? surface(() => store,['recoveryRead']) : {}),
      terminalExclusion:Object.freeze({householdId:a.householdId,
        ledgerNamespace:store.terminalExclusion.ledgerNamespace,
        ...surface(() => store.terminalExclusion,['sealNegative','lookupCertificate'])})};
    settlement = Object.freeze({householdId:a.householdId,origin:a.origin,
      authorize:fence(a.authorize),acquire:fence(a.acquire),contextReader:fence(a.contextReader),
      readBase:fence(a.readBase),now:fence(a.now),store:Object.freeze(exposedStore),
      ...(recovery ? {authorizeRecovery:fence(recovery.authorizeRecovery),
        // The opted-in awaited authority rides the generic async fence (it
        // is awaited at the seam's final slot, so thenables are expected);
        // the incumbent predicate keeps its non-assimilating fence. The
        // eligibility issuer, when supplied, is fenced the same way.
        ...(typeof recovery.authorizeRecoveryFinal === 'function'
          ? {authorizeRecoveryFinal:fence(recovery.authorizeRecoveryFinal)}
          : {finalDisclosureAuthorize:disclosureFence(recovery.finalDisclosureAuthorize)}),
        ...(typeof recovery.issueRecoveryEligibility === 'function'
          ? {issueRecoveryEligibility:fence(recovery.issueRecoveryEligibility)} : {})} : {}),
      commitAdmitted:fence(store.commitAdmitted),
      readDocument:fence(() => owner.documentStore.read()),readPin:fence(() => pin.read())});
  }
  function connect() {
    if (phase === 'retiring' || phase === 'retired' || phase === 'lost' || !connection
      || owner && owner.status().state !== 'ready') return Promise.reject(unavailable());
    if (opening) return opening;
    phase = 'connecting';
    // Publish lifetime ownership before the factory can invoke an injected
    // constructor (which may synchronously request retirement).
    opening = Promise.resolve().then(async () => {
      try {
        if (phase !== 'connecting') throw unavailable();
        owner = await createSettlementEvidencePostgresConnection(connection);
        if (phase !== 'connecting') { await owner.retire(); throw unavailable(); }
        phase = 'ready'; return status();
      } catch (error) {
        // Only the factory's own sanitized diagnostics can escape connect.
        if (error.code === 'SETTLEMENT_CONNECTION') {
          primary = error.diagnostic; lastFailureRetirement = error.retirement || null;
        }
        if (phase === 'connecting') phase = 'lost';
        throw error;
      }
    });
    return opening;
  }
  function retire() {
    if (retiring) return retiring;
    phase = 'retiring'; // Synchronous fence, including pending custody callbacks.
    // Publish this promise before calling any potentially reentrant owner.
    retiring = Promise.resolve().then(async () => {
      // The factory bounds connect/preflight/close. Never race it with a second
      // session owner or a second close. No timer here claims an unproven close.
      if (opening) { try { await opening; } catch { /* preserve factory report below */ } }
      // Config/environment refusal precedes construction. A setup exception
      // may instead have escaped a constructor after allocating a Client; the
      // factory returned neither owner nor close proof. Never invent absence.
      const uncertain = primary && !['config','environment'].includes(primary.stage);
      const report = owner ? await owner.retire() : lastFailureRetirement || Object.freeze({
        state:uncertain?'lost':'retired',close:uncertain?'unconfirmed':'not-opened',primary,
        closeDiagnostic:uncertain?Object.freeze({stage:'end',category:'unconfirmed',code:null}):null});
      phase = report.state; return report;
    });
    return retiring;
  }
  return Object.freeze({settlement,connect,retire,status});
}
module.exports = { createSettlementEvidencePostgresRuntime };
