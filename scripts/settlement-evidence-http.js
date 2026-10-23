'use strict';

// Construction only. No environment, provider, storage default, maintenance
// route or caller-selected authority. Production deliberately supplies nothing.
const express = require('express');
const { createSettlementEvidenceConfirmation } = require('./settlement-evidence-confirmation');
const { createSettlementEvidenceResolver } = require('./settlement-evidence-resolver');
const { createSettlementEvidenceServing, receiptBoundView } = require('./settlement-evidence-serving');
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
  let active = false, controller, resolver, serving, authorize, readBase, origin, now;
  const catalogues = new Map();
  if (dependency !== undefined) {
    const d = dependency;
    if (!record(d) || !/^household-[a-f0-9]{32}$/.test(d.householdId)
      || ['authorize', 'acquire', 'contextReader', 'readBase', 'now', 'commitAdmitted', 'readDocument', 'readPin']
        .some(k => typeof d[k] !== 'function')) throw new TypeError('incomplete settlement composition');
    const url = new URL(d.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== d.origin
      || url.username || url.password) throw new TypeError('invalid configured settlement origin');
    origin = d.origin; now = d.now; readBase = d.readBase;
    const householdId = d.householdId, policy = d.authorize;
    const acquire = d.acquire, contextReader = d.contextReader;
    authorize = async context => {
      const authority = await policy(Object.freeze({ ...context }));
      if (!shape(authority, ['householdId', 'actorId']) || authority.householdId !== householdId
        || authority.actorId !== context.actorId) throw new Error('unauthorized');
      return Object.freeze({ ...authority });
    };
    resolver = createSettlementEvidenceResolver({ householdId,
      acquire: () => acquire(contextReader) });
    // Exactly one controller for this application lifetime, including all routes.
    controller = createSettlementEvidenceConfirmation({ householdId: d.householdId, authorize,
      resolveSelection: resolver.resolveSelection, resolvePairedSelection: resolver.resolvePairedSelection,
      store: d.store, commitAdmitted: d.commitAdmitted, now });
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
  const post = (route, valid, run) => router.post(route, async (req, res) => {
    if (!valid(req.body)) return res.status(400).json({ status: 'invalid-request' });
    const context = req.settlementContext;
    try {
      const authority = await authorize(context);
      const result = await run(context, authority, req.body);
      // Cookies remain identity only, and authorization must still hold after
      // asynchronous publication. Never return a view after revocation.
      await authorize(context);
      if (sessionActor(req) !== context.actorId) throw new Error('expired');
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
  post('/confirm', body => (shape(body, ['operationId', 'previewToken', 'confirmed'])
    || shape(body, ['operationId', 'previewToken', 'generation', 'confirmed'])
      && /^generation-[a-f0-9]{32}$/.test(body.generation))
    && OP.test(body.operationId) && /^[a-f0-9]{64}$/.test(body.previewToken) && body.confirmed === true,
  (context, _authority, body) => controller.confirm(context, body));
  post('/outcome', operation, (context, _authority, body) => controller.outcome(context, body));
  post('/publication', operation, async (context, authority, body) => {
    const receipt = await controller.outcome(context, body);
    if (receipt.status !== 'committed') return receipt;
    // readBase must supply a complete served object; no ordinary attach or
    // provider fallback is allowed on this receipt-bound path.
    const base = await readBase();
    const publication = await receiptBoundView(serving, base, receipt, authority.actorId);
    return { status: 'committed', publication: publication.status, data: publication.data };
  });
  router.use((_req, res) => res.status(404).json({ status: 'unavailable' }));
  router.use((_err, _req, res, _next) => res.status(400).json({ status: 'invalid-request' }));
  app.use('/settlement', router);
}

module.exports = { mountSettlementHttp };
