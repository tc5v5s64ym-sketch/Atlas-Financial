'use strict';

// Construction only. No environment, provider, storage default, maintenance
// route or caller-selected authority. Production deliberately supplies nothing.
const { types: utilTypes } = require('node:util');
const express = require('express');
// Captured at load: the refusal handler attaches rejection containment
// through this intrinsic, never through a verdict's own properties.
const promiseThen = Promise.prototype.then;
const { createSettlementEvidenceConfirmation } = require('./settlement-evidence-confirmation');
const { createSettlementEvidenceResolver } = require('./settlement-evidence-resolver');
const { createSettlementEvidenceServing, receiptBoundView } = require('./settlement-evidence-serving');
const { createWithdrawalTargetReader } = require('./settlement-evidence-loader');
const OP = /^operation-[a-f0-9]{32}$/;
const HANDLE = /^selection-[a-f0-9]{32}$/;
const CHOICE = /^choice-[a-f0-9]{32}$/;
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x)
  && Object.getPrototypeOf(x) === Object.prototype;
const shape = (x, keys) => record(x) && Object.keys(x).length === keys.length
  && keys.every(k => Object.hasOwn(x, k));
const fail = res => res.status(503).json({ status: 'unavailable' });

function mountSettlementHttp(app, sessionActor, dependency, preactivationOnly = false) {
  if (typeof preactivationOnly !== 'boolean' || preactivationOnly && dependency !== undefined)
    throw new TypeError('sealed preactivation rejects settlement dependencies');
  const router = express.Router({ caseSensitive: true, strict: true });
  let active = false, controller, resolver, serving, authorize, readBase, origin, now, publicationOutcome = null,
    householdId = null, finalDisclosureAuthorize = null;
  const catalogues = new Map();
  if (dependency !== undefined) {
    const d = dependency;
    if (!record(d) || !/^household-[a-f0-9]{32}$/.test(d.householdId)
      || ['authorize', 'acquire', 'contextReader', 'readBase', 'now', 'commitAdmitted', 'readDocument', 'readPin']
        .some(k => typeof d[k] !== 'function')
      || (d.authorizeRecovery !== undefined && typeof d.authorizeRecovery !== 'function')
      || (d.finalDisclosureAuthorize !== undefined && typeof d.finalDisclosureAuthorize !== 'function'))
      throw new TypeError('incomplete settlement composition');
    const url = new URL(d.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== d.origin
      || url.username || url.password) throw new TypeError('invalid configured settlement origin');
    origin = d.origin; now = d.now; readBase = d.readBase;
    householdId = d.householdId;
    finalDisclosureAuthorize = typeof d.finalDisclosureAuthorize === 'function'
      ? d.finalDisclosureAuthorize : null;
    const policy = d.authorize;
    const acquire = d.acquire, contextReader = d.contextReader;
    authorize = async context => {
      const authority = await policy(Object.freeze({ ...context }));
      if (!shape(authority, ['householdId', 'actorId']) || authority.householdId !== householdId
        || authority.actorId !== context.actorId) throw new Error('unauthorized');
      return Object.freeze({ ...authority });
    };
    resolver = createSettlementEvidenceResolver({ householdId,
      acquire: () => acquire(contextReader) });
    const withdrawalReader = createWithdrawalTargetReader({ householdId,
      readDocument: d.readDocument, readPin: d.readPin, contextReader });
    // Private publication-evaluation capability, captured through the
    // controller's construction-time registration (the registerRecovery
    // pattern): it never appears on the controller's public object, and
    // only this mount's /outcome and /publication routes consume it.
    // Exactly one controller for this application lifetime, including all routes.
    controller = createSettlementEvidenceConfirmation({ householdId: d.householdId, authorize,
      authorizeRecovery: d.authorizeRecovery,
      registerPublicationOutcome: fn => { publicationOutcome = fn; },
      resolveSelection: resolver.resolveSelection, resolvePairedSelection: resolver.resolvePairedSelection,
      store: d.store, commitAdmitted: d.commitAdmitted, now,
      registerRecovery: d.registerRecovery,
      withdrawalReader: withdrawalReader.acquire,
      // Names are presentation only. Missing/failed current base labels use
      // the controller's bounded fallback; they never qualify ledger targets.
      withdrawalLabels: async () => {
        const base = await readBase();
        return Array.isArray(base?.plan?.commitments) ? base.plan.commitments.map(row =>
          ({ goalId: 'commitment:' + row.id, label: typeof row.label === 'string' ? row.label : '' })) : [];
      } });
    serving = createSettlementEvidenceServing({ householdId: d.householdId,
      readDocument: d.readDocument, readPin: d.readPin });
    active = true;
  }
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    // Operation IDs and all other caller input belong only in bounded JSON.
    if (req.originalUrl.includes('?')) return res.status(400).json({ status: 'invalid-request' });
    const actorId = sessionActor(req);
    if (!actorId) return res.status(401).json({ status: 'unauthorized' });
    req.settlementContext = Object.freeze({ actorId });
    next();
  });
  router.get('/capability', async (req, res) => {
    // Fetch Metadata is browser-controlled. The custom header also requires a
    // CORS preflight across origins; this router never grants CORS. No Host
    // header supplies authority or a configured Origin here.
    const sameOrigin = req.get('Sec-Fetch-Site') === 'same-origin'
      && req.get('X-Atlas-Settlement') === 'same-origin';
    const bootClassification = preactivationOnly && sameOrigin ? 'preactivation-only' : 'recovery-required';
    if (!active) return res.json({ status: 'inactive', bootClassification });
    try {
      await authorize(req.settlementContext);
      if (sessionActor(req) !== req.settlementContext.actorId) throw new Error('expired');
      return res.json({ status: 'active', bootClassification: 'recovery-required' });
    }
    catch { return res.status(403).json({ status: 'unauthorized' }); }
  });
  router.use((req, res, next) => {
    if (!active) return fail(res);
    if (req.method !== 'POST') return res.status(405).json({ status: 'method-not-allowed' });
    if (req.get('Origin') !== origin || req.get('X-Atlas-Settlement') !== 'same-origin'
      || req.get('Sec-Fetch-Site') && req.get('Sec-Fetch-Site') !== 'same-origin') {
      return res.status(403).json({ status: 'unauthorized' });
    }
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.get('Content-Type') || '')
      || req.get('Content-Encoding')) return res.status(415).json({ status: 'invalid-request' });
    next();
  });
  router.use(express.json({ limit: 4096, strict: true, inflate: false }));
  const post = (route, valid, run, finalCheck) => router.post(route, async (req, res) => {
    if (!valid(req.body)) return res.status(400).json({ status: 'invalid-request' });
    const context = req.settlementContext;
    try {
      const authority = await authorize(context);
      const gate = {};
      const result = await run(context, authority, req.body, gate);
      // Cookies remain identity only, and authorization must still hold after
      // asynchronous publication. Never return a view after revocation.
      await authorize(context);
      if (sessionActor(req) !== context.actorId) throw new Error('expired');
      // A route's final disclosure check runs after EVERY other await in
      // this helper — including the final authorization above — so a
      // revocation landing in any earlier await (the B4 recovery-policy
      // BLOCK, Atlas ts 1792947464) cannot serialize past it. `gate` is a
      // per-request holder the handler fills during run(); it is never
      // shared across requests. The check is awaited ONLY when this
      // request's evaluation armed one (a recovery proof in play): on
      // incumbent paths the gate is empty, and an await here — after the
      // session check above, with no re-read after it — would reopen a
      // post-check expiry window the shipped incumbent boundary never
      // had (Atlas provisional BLOCK on c6626dfa, ts 1792954819).
      // Incumbent paths serialize in this same continuation, as shipped.
      if (finalCheck && gate.recheckRecovery) await finalCheck(gate);
      // Addendum A final-disclosure boundary. When this request's
      // evaluation put a recovery proof in play, `gate.finalDisclosure`
      // holds its retained frozen selectors, and disclosure requires —
      // in THIS synchronous continuation, after the last await above,
      // with no acquisition or async callback afterward — the injected
      // synchronous final predicate FIRST (exact boolean true only; it
      // judges current ordinary household authority AND the named
      // recovery grant), then the session-actor re-read, then
      // serialization. A missing capability, a throw, or any non-true
      // verdict (false, malformed, Promise/thenable) refuses through
      // the catch: 503, zero disclosure. Incumbent paths never set the
      // gate, never call the predicate, and are unchanged.
      if (gate.finalDisclosure) {
        if (typeof finalDisclosureAuthorize !== 'function')
          throw new Error('final-disclosure capability missing');
        let verdict;
        try { verdict = finalDisclosureAuthorize(gate.finalDisclosure); }
        catch { throw new Error('final-disclosure refused'); }
        if (verdict !== true) {
          // The verdict refuses — synchronously, whatever it is. A
          // genuine native Promise verdict (recognized across realms by
          // util.types.isPromise, which reads no property of the value)
          // is never awaited or assimilated and its eventual value is
          // never accepted, but its rejection must not escape as an
          // unhandled rejection: attach nonthrowing handlers through
          // the CAPTURED Promise.prototype.then via Reflect.apply, so
          // a shadowed `.then`/`.catch` property on the value is never
          // read or invoked. Arbitrary thenables are left entirely
          // untouched — no property access at all. A failure attaching
          // the handlers is itself contained; the refusal stands.
          if (utilTypes.isPromise(verdict)) {
            try { Reflect.apply(promiseThen, verdict, [() => {}, () => {}]); }
            catch { /* containment failed; the refusal below stands */ }
          }
          throw new Error('final-disclosure refused');
        }
        if (sessionActor(req) !== context.actorId) throw new Error('expired');
      }
      return res.json(result);
    } catch { return fail(res); } // No raw exception, body, token or receipt log.
  });
  post('/selections', body => shape(body, []), async (_context, authority) => {
    const catalogue = await resolver.catalogue(authority);
    if (!catalogue) return { status: 'unavailable' };
    for (const [key, value] of catalogues) if (value.expiresAt <= now()) catalogues.delete(key);
    if (!catalogues.has(authority.actorId) && catalogues.size >= 200) return { status: 'unavailable' };
    catalogues.set(authority.actorId, { ...catalogue, expiresAt: now() + 600000 });
    return { status: 'available', provisional: true, ...catalogue };
  });
  post('/prepare', body => shape(body, ['operationId', 'selection', 'assignedCents'])
    && OP.test(body.operationId) && Number.isSafeInteger(body.assignedCents) && body.assignedCents > 0
    && shape(body.selection, ['transaction', 'commitment'])
    && HANDLE.test(body.selection.transaction) && CHOICE.test(body.selection.commitment),
  async (context, authority, body) => {
    const c = catalogues.get(authority.actorId);
    const payment = c?.transactions.find(x => x.handle === body.selection.transaction);
    const goal = c?.commitments.find(x => x.handle === body.selection.commitment);
    if (!c || c.expiresAt <= now() || !payment || !goal) return { status: 'unavailable' };
    const result = await controller.prepare(context, body);
    return result.status === 'prepared' ? { ...result, labels: { payment: payment.label, goal: goal.label } } : result;
  });
  const operation = body => shape(body, ['operationId']) && OP.test(body.operationId);
  post('/assignments', body => shape(body, []), context => controller.assignments(context, {}));
  post('/prepare-withdrawal', body => shape(body, ['operationId', 'assignmentHandle'])
    && OP.test(body.operationId) && /^assignment-[a-f0-9]{32}$/.test(body.assignmentHandle),
  (context, _authority, body) => controller.prepareWithdrawal(context, body));
  post('/confirm', body => (shape(body, ['operationId', 'previewToken', 'confirmed'])
    || shape(body, ['operationId', 'previewToken', 'generation', 'confirmed'])
      && /^generation-[a-f0-9]{32}$/.test(body.generation))
    && OP.test(body.operationId) && /^[a-f0-9]{64}$/.test(body.previewToken) && body.confirmed === true,
  (context, _authority, body) => controller.confirm(context, body));
  const outcomeRequest = body => operation(body)
    || shape(body, ['operationId', 'generation']) && OP.test(body.operationId)
      && /^generation-[a-f0-9]{32}$/.test(body.generation);
  // The B4 final disclosure check, shared by both disclosing routes: it
  // re-runs the recovery decision captured by THIS request's evaluation,
  // inside the helper AFTER its final authorization await (see post()).
  const recoveryGate = async gate => { if (gate.recheckRecovery) await gate.recheckRecovery(); };
  // The retained frozen selectors for the Addendum A final predicate:
  // the configured household, this request's session authority actor
  // (the authorize wrapper forces the evaluation's authority actor to
  // equal it), and the validated operation/generation selectors the
  // evaluation itself retained — generation present exactly when the
  // caller supplied it, never fabricated.
  const finalSelectors = (context, body) => Object.freeze(Object.hasOwn(body, 'generation')
    ? { householdId, actorId: context.actorId, operationId: body.operationId,
      generation: body.generation }
    : { householdId, actorId: context.actorId, operationId: body.operationId });
  post('/outcome', outcomeRequest, async (context, _authority, body, gate) => {
    if (typeof publicationOutcome !== 'function') throw new Error('publication evaluation unavailable');
    const r = await publicationOutcome(context, body);
    // A recovery decision refusal anywhere in the evaluation suppresses
    // disclosure with the seam's incumbent 503 (the helper's catch), never
    // a locally invented shape. When a recovery proof is in play, its
    // final recheck is deferred to the helper's gate — after the final
    // authorization await, immediately before serialization.
    if (r.recoveryRefused) throw new Error('recovery-refused');
    gate.recheckRecovery = r.recheckRecovery;
    if (r.recheckRecovery) gate.finalDisclosure = finalSelectors(context, body);
    return r.result;
  }, recoveryGate);
  post('/publication', operation, async (context, _authority, body, gate) => {
    if (typeof publicationOutcome !== 'function') throw new Error('publication evaluation unavailable');
    const r = await publicationOutcome(context, body);
    if (r.recoveryRefused) throw new Error('recovery-refused');
    // A recovery negative proof is a disclosure too: its recheck is gated
    // exactly like the committed path's.
    gate.recheckRecovery = r.recheckRecovery;
    if (r.recheckRecovery) gate.finalDisclosure = finalSelectors(context, body);
    if (r.result.status !== 'committed') return r.result;
    // readBase must supply a complete served object; no ordinary attach or
    // provider fallback is allowed on this receipt-bound path. The binding
    // is the evaluation's own receipt + actor: the same-actor receipt and
    // authority on the incumbent path (byte-identical behaviour), or the
    // store's private qualified bundle when the recovery branch proved the
    // commit — publication never depends on the current session being the
    // recorded actor. No acquisition follows the helper's final gate.
    const base = await readBase();
    const publication = await receiptBoundView(serving, base, r.binding.receipt, r.binding.actorId);
    return { status: 'committed', publication: publication.status, data: publication.data };
  }, recoveryGate);
  router.use((_req, res) => res.status(404).json({ status: 'unavailable' }));
  router.use((_err, _req, res, _next) => res.status(400).json({ status: 'invalid-request' }));
  app.use('/settlement', router);
  // Private application-local capability, used only by the browser data route.
  // It reuses this composition's policy/readers without opting the shared
  // assistant/MCP/Talk acquisition path into household settlement publication.
  return Object.freeze({
    active,
    async browserData(req, readBrowserBase, publish) {
      if (!active) return publish(await readBrowserBase());
      const actorId = sessionActor(req), context = Object.freeze({ actorId });
      const refuse = (status = 503) => {
        const error = new Error('settlement browser unavailable');
        error.code = 'settlement-browser-unavailable'; error.status = status; throw error;
      };
      const reauthorize = async (after = () => {}) => {
        if (!actorId || sessionActor(req) !== actorId) refuse(401);
        try { await authorize(context); } catch { refuse(); }
        if (sessionActor(req) !== actorId) refuse(401);
        return after();
      };
      await reauthorize(); // Before raw-base or settlement acquisition.
      const base = await readBrowserBase();
      await reauthorize(); // Base acquisition may have suspended/revoked access.
      // Own the complete base before reader awaits. The existing serving seam
      // strips old settlement fields and withholds failed reads, never falls
      // back to stale/unconfigured evidence, and never reads private receipts.
      const data = await serving.attach(structuredClone(base));
      // Publish synchronously in the final authority continuation: no extra
      // await/microtask boundary may separate the identity check and response.
      return reauthorize(() => publish(data));
    },
  });
}

module.exports = { mountSettlementHttp };
