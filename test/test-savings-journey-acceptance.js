'use strict';
// Household Savings journey acceptance harness. TEST ONLY.
// Drives the production server composition (the same factories and synthetic
// in-memory custody as test-settlement-production-composition.js): real
// startServer, real settlement HTTP, real prepare → confirm, and a restarted
// process that re-reads the durable document. No production source is touched
// and nothing is written straight into the settlement store to force a step.
//
// Based on main 04f7a9f60882499afb5d92bb09de61d7b2cb5c2c.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const Forecast = require('../public/forecast');
const Refresh = require('../scripts/server-live-refresh');
const { makeExclusionWorld, householdId, op } = require('./test-settlement-evidence-terminal-certificate');
const { startServer } = require('../server');

const GOAL_A = { id: 'goal-a', label: 'Goal A invented camp fee', cents: 4000, due: '2026-10-12' };
const GOAL_B = { id: 'goal-b', label: 'Goal B invented kit', cents: 9000, due: '2026-10-20' };
const PURCHASE_B = { id: 'goal-b-spent', payee: 'Already spent outside Goal B',
  providerTransactionId: 'SYNTHETIC-GOAL-B', cents: 2500, date: '2026-10-04' };
const PURCHASE_A = { id: 'goal-a-spent', payee: 'Already spent outside Goal A',
  providerTransactionId: 'SYNTHETIC-GOAL-A', cents: 4000, date: '2026-10-05' };
const POOL_CENTS = 2500;

const syntheticPassword = 'synthetic-composition-password';
const syntheticSessionSecret = 'synthetic-composition-session-secret';
const env = { SITE_PASSWORD: syntheticPassword, SESSION_SECRET: syntheticSessionSecret,
  ATLAS_LIVE_OVERLAY: 'live' };
const host = 'db.example.test';
const canary = 'SYNTHETIC-CONFIG-SECRET-CANARY';
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const clone = x => structuredClone(x);

function centsOf(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(amount * 100 - cents) >= 1e-6) return null;
  return cents;
}
function money(cents) {
  return cents / 100;
}

function world() {
  const w = makeExclusionWorld();
  w.time = Date.now(); w.clients = []; w.sql = []; w.events = []; w.hooks = {};
  w.eligibility = new Map(); w.revoked = new Set(); w.sessions = new Set();
  w.base = require('./fixtures/savings-daily-consumer-data')();
  // The production composition has no goal-create command. These two
  // commitments are the household's canonical plan — the only goal source
  // startServer reads — not a settlement-store write.
  w.base.plan.commitments = [
    { id: GOAL_A.id, label: GOAL_A.label, date: GOAL_A.due, amount: money(GOAL_A.cents),
      confidence: 'confirmed', adjustable: false, sinkingFund: true },
    { id: GOAL_B.id, label: GOAL_B.label, date: GOAL_B.due, amount: money(GOAL_B.cents),
      confidence: 'confirmed', adjustable: false, sinkingFund: true },
  ];
  w.base.plan.savingsEarmarks.pools[0].goalRefs = [
    { kind: 'commitment', id: GOAL_A.id },
    { kind: 'commitment', id: GOAL_B.id },
  ];
  // Limited combined reported stock: less than Goal A's cost, so due-order
  // allocation can give it all to the earlier goal and nothing to the later.
  w.base.plan.savingsPoolObservation.accounts[0].value = money(POOL_CENTS);
  w.base.plan.startingCash.breakdown[2].value = money(POOL_CENTS);
  w.base.plan.savingsPoolObservation.accounts[1].value = 0;
  w.base.plan.startingCash.heldElsewhere[0].value = 0;
  const packet = clone(w.base.liveOverlay.currentPeriodActuals);
  // Already-posted debits: money spent outside the app, dated on or before
  // the acquisition as-of. This is the composition suite's acquire double,
  // not a direct document write.
  packet.transactions = [PURCHASE_B, PURCHASE_A].map(purchase => ({
    id: purchase.id, date: purchase.date, amount: money(purchase.cents), currency: 'cad',
    pending: false, categoryLabel: 'Groceries', merchantKnown: true,
    atlasAccountId: 'chequing-a', accountRole: 'household-cash', displayedPayee: purchase.payee,
  }));
  w.acquisition = { packet, plan: clone(w.base.plan), join: [PURCHASE_B, PURCHASE_A].map(purchase => ({
    localId: purchase.id, providerAccountId: 'SYNTHETIC-ACCOUNT',
    transactionId: purchase.providerTransactionId,
  })), map: { mappings: [{ providerAccountId: 'SYNTHETIC-ACCOUNT',
    canonical: { id: 'chequing-a', collection: 'cash' } }] } };
  w.context = { canonical: w.base, env: { ...env }, domain: 'synthetic-household-authority',
    contextRevision: 1 };
  w.allowed = true; w.acquireCalls = 0; w.witnessCalls = 0; w.serveCalls = 0;
  const metadata = kind => [
    [{ database: 'synthetic', user: kind + '_app', pid: kind === 'financial' ? 301 : 302, searchPath: 'pg_catalog' }],
    [{ canLogin: true, superuser: false, createDb: false, createRole: false, inherit: false,
      replication: false, bypassRls: false, connectionLimit: 1, memberships: 0, ownedObjects: 0 }],
    [{ connect: true, schemaUsage: true, databaseCreate: false, schemaCreate: false, tables: true, functions: true }],
    kind === 'financial' ? ['doc_head', 'doc_staged', 'journal', 'quarantine'].map(name => ({ name, kind: 'r', persistence: 'p',
      rls: false, forceRls: false, unsafe: false, primaryKeyCount: 1,
      columns: (name === 'quarantine' ? ['scope', 'name', 'label', 'bytes'] : ['scope', 'bytes']).map(column =>
        ({ name: column, type: column === 'bytes' ? 'bytea' : 'text', notNull: column !== 'label', generated: '' })),
      primaryKey: name === 'quarantine' ? ['scope', 'name'] : ['scope'] }))
      : Object.entries({ auth_eligibility: [['scope', 'text'], ['household_id', 'text'], ['operation_id', 'text'],
          ['generation', 'text'], ['confirmation_digest', 'text'], ['secret_digest', 'text'], ['issued_at', 'bigint']],
        auth_revocation: [['scope', 'text'], ['operation_id', 'text'], ['generation', 'text'], ['revoked_at', 'bigint']],
        auth_session_revocation: [['scope', 'text'], ['sid_digest', 'text'], ['revoked_at', 'bigint']] })
        .map(([name, columns]) => ({ name, kind: 'r', persistence: 'p', rls: false, forceRls: false, unsafe: false, primaryKeyCount: 1,
          columns: columns.map(([name, type]) => ({ name, type, notNull: true, generated: '' })),
          primaryKey: name === 'auth_session_revocation' ? ['scope', 'sid_digest'] : ['scope', 'operation_id', 'generation'] })),
  ];
  function client(kind) {
    return class SyntheticClient extends EventEmitter {
      constructor(config) {
        super(); this.kind = kind; this.config = config; this.ends = 0; this.count = 0;
        this.connection = { stream: { encrypted: true, authorized: true, servername: host,
          getPeerCertificate: () => ({ subjectaltname: 'DNS:' + host }) } };
        w.clients.push(this); w.events.push('construct:' + kind);
      }
      async connect() { w.events.push('connect:' + kind); if (w.hooks.connect) await w.hooks.connect(kind); }
      async end() {
        this.ends++; w.events.push('end:' + kind);
        if (w.hooks.end) await w.hooks.end(kind); this.emit('end');
      }
      async query(text, values = []) {
        w.sql.push({ kind, text, values });
        if (w.hooks.query) { const v = await w.hooks.query(kind, text, values); if (v !== undefined) return v; }
        if (this.count++ < 4) return { command: 'SELECT', rows: metadata(kind)[this.count - 1] };
        const result = (rows = [], rowCount = 0) => ({ command: text.split(' ')[0], rows, rowCount });
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return result();
        if (kind === 'authorization') {
          const key = values[1] + '|' + values[2];
          if (text.startsWith('SELECT e.household_id')) {
            const e = w.eligibility.get(key);
            const rows = [e ? { household_id: e.householdId, operation_id: e.operationId, generation: e.generation,
              confirmation_digest: e.confirmationDigest, secret_digest: e.secretDigest, issued_at: String(e.issuedAt),
              operation_revoked: w.revoked.has(key), session_revoked: w.sessions.has(values[3]) }
              : { household_id: null, operation_id: null, generation: null, confirmation_digest: null, secret_digest: null, issued_at: null,
                operation_revoked: w.revoked.has(key), session_revoked: w.sessions.has(values[3]) }];
            if (w.hooks.snapshot) await w.hooks.snapshot(rows[0], values);
            return result(rows);
          }
          if (text.startsWith('SELECT scope, household_id')) {
            const e = w.eligibility.get(key); return result(e ? [{ scope: values[0], household_id: e.householdId,
              operation_id: e.operationId, generation: e.generation, confirmation_digest: e.confirmationDigest,
              secret_digest: e.secretDigest, issued_at: String(e.issuedAt) }] : []);
          }
          if (text.startsWith('SELECT revoked_at')) return result((text.includes('auth_session_revocation')
            ? w.sessions.has(values[1]) : w.revoked.has(key)) ? [{ revoked_at: '1' }] : []);
          if (text.startsWith('INSERT INTO')) {
            if (text.includes('auth_eligibility')) w.eligibility.set(values[2] + '|' + values[3], {
              householdId: values[1], operationId: values[2], generation: values[3], confirmationDigest: values[4],
              secretDigest: values[5], issuedAt: values[6] });
            else if (text.includes('auth_session_revocation')) w.sessions.add(values[1]);
            else w.revoked.add(key);
            return result([], 1);
          }
        } else {
          if (text.includes('pg_try_advisory_lock')) return result([{ locked: true }]);
          if (text.includes('pg_advisory_unlock')) return result([{ unlocked: true }]);
          if (text.includes('pg_backend_pid')) return result([{ pid: 301 }]);
          if (text.startsWith('SELECT bytes FROM')) {
            const field = text.includes('.doc_head') ? 'doc' : text.includes('.journal') ? 'journal' : 'temp';
            return result(w[field] ? [{ bytes: Buffer.from(w[field]) }] : []);
          }
          if (text.startsWith('WITH s AS')) { w.doc = w.temp; w.temp = null; return result([], 1); }
          if (text.startsWith('INSERT INTO')) {
            if (text.includes('.quarantine')) throw Error('synthetic maintenance forbidden');
            w[text.includes('.doc_staged') ? 'temp' : 'journal'] = Buffer.from(values[1]); return result([], 1);
          }
          if (text.startsWith('DELETE FROM')) { w[text.includes('.journal') ? 'journal' : 'temp'] = null; return result([], 1); }
        }
        throw Error('unmodelled synthetic SQL');
      }
    };
  }
  const connection = kind => ({ Client: client(kind), config: { host, port: 5432, database: 'synthetic', user: kind + '_app',
    password: canary, ssl: { rejectUnauthorized: true, servername: host } }, schema: 'synthetic_' + kind, scope: 'synthetic-scope',
    timeouts: { connect: 100, preflight: 1000, query: 1000, close: 40 } });
  w.config = { connection: connection('financial'), authorization: connection('authorization'),
    custody: { pinStore: w.adapters.pinStore, backupStore: w.adapters.backupStore, terminalHistory: w.terminalHistory,
      exclusionDomain: w.domain }, application: { householdId, origin: 'https://atlas.example.test',
      authorize: c => { if (!w.allowed) throw Error('synthetic household denied'); return { householdId, actorId: c.actorId }; },
      authorizeRecovery: async c => ({ householdId, actorId: c.actorId, operationId: c.operationId }),
      contextReader: () => w.context, now: () => w.time } };
  w.start = () => startServer({ env: { ...env }, host: '127.0.0.1', port: 0, settlement: w.config });
  return w;
}

async function started(t, w = world()) {
  const serve = Refresh.serve, acquire = Refresh.acquireSettlementWithWitness;
  Refresh.serve = async () => { w.serveCalls++; return clone(w.context.canonical); };
  Refresh.acquireSettlementWithWitness = async (c, e, o) => {
    w.acquireCalls++; assert.equal(typeof o.contextReader, 'function');
    const captured = clone(o.contextReader());
    assert.deepEqual(c, captured.canonical); assert.deepEqual(e, captured.env);
    return { acquisition: clone(w.acquisition), witness: () => { w.witnessCalls++;
      const cur = o.contextReader();
      return cur.contextRevision === captured.contextRevision && cur.domain === captured.domain; } };
  };
  t.after(async () => {
    if (w.owner) await w.owner.close();
    Refresh.serve = serve; Refresh.acquireSettlementWithWitness = acquire;
  });
  w.owner = await w.start();
  w.url = 'http://127.0.0.1:' + w.owner.server.address().port;
  w.cookie = await login(w);
  return w;
}
function request(w, path, body, cookie = w.cookie) {
  return new Promise((resolve, reject) => {
    const bytes = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request(w.url + path, { method: bytes ? 'POST' : 'GET', agent: false, headers: {
      ...(cookie ? { Cookie: cookie } : {}), ...(bytes ? { 'Content-Type': typeof body === 'string'
        ? 'application/x-www-form-urlencoded' : 'application/json',
        'Content-Length': bytes.length, Origin: 'https://atlas.example.test',
        'X-Atlas-Settlement': 'same-origin', 'Sec-Fetch-Site': 'same-origin' } : {}) } }, res => {
      let raw = ''; res.setEncoding('utf8'); res.on('data', x => { raw += x; }); res.on('end', () => {
        let value; try { value = JSON.parse(raw); } catch { value = raw; }
        resolve({ status: res.statusCode, headers: res.headers, value });
      });
    });
    req.setTimeout(15000, () => req.destroy(Error('synthetic request deadline')));
    req.on('error', reject); req.end(bytes);
  });
}
async function login(w) {
  const r = await request(w, '/login', 'password=' + env.SITE_PASSWORD, null);
  assert.equal(r.status, 302, 'login');
  return r.headers['set-cookie'][0].split(';')[0];
}
async function restart(w) {
  const before = w.sql.length;
  await w.owner.close();
  w.owner = await w.start();
  w.url = 'http://127.0.0.1:' + w.owner.server.address().port;
  w.cookie = await login(w);
  w.storeReadsAtRestart = () => w.sql.slice(before).filter(row =>
    row.kind === 'financial' && row.text.startsWith('SELECT bytes FROM') && row.text.includes('.doc_head')).length;
}
function advanceAsOf(w, day) {
  w.base.meta.asOf = day;
  w.context = { canonical: w.base, env: { ...env }, domain: w.context.domain,
    contextRevision: w.context.contextRevision + 1 };
}
async function served(w) {
  const response = await request(w, '/data.json');
  assert.equal(response.status, 200, JSON.stringify(response.value).slice(0, 300));
  return response.value;
}
function surfaces(data) {
  const asOf = data && data.meta && data.meta.asOf;
  const qualified = !!(data && data.settlementEvidenceStatus && data.settlementEvidenceStatus.status === 'qualified'
    && data.settlementEvidence && typeof data.settlementEvidence === 'object' && !Array.isArray(data.settlementEvidence));
  const opts = { currentPeriodActuals: data.liveOverlay && data.liveOverlay.currentPeriodActuals,
    ...(qualified ? { settlementEvidence: data.settlementEvidence } : {}) };
  return {
    asOf, qualified, evidence: qualified ? data.settlementEvidence : null,
    status: data.settlementEvidenceStatus || null,
    seq: Forecast.fundingSequence(data.plan, asOf, opts),
    daily: Forecast.savingsDailyFunding(data.plan, [], asOf, opts),
    inventory: Forecast.savingsInventory(data.plan, asOf, opts),
    cycle: Forecast.spendingCycle(data.plan, asOf),
  };
}
function plannedGoals(pub, id) {
  return (pub.inventory.pools || []).flatMap(pool => pool.plannedGoals || [])
    .filter(goal => goal && goal.key === 'commitment:' + id);
}
function sequenceRows(pub, id) {
  return (pub.seq || []).filter(row => row && row.id === id);
}
function savedItem(pub, id) {
  const items = pub.daily && pub.daily.backing && pub.daily.backing.items || [];
  return items.find(item => item && item.id === id) || null;
}
function figures(pub, id) {
  const goals = plannedGoals(pub, id);
  const rows = sequenceRows(pub, id);
  const goal = goals[0] || null;
  const row = rows[0] || null;
  const item = savedItem(pub, id);
  const field = amount => amount === undefined ? undefined : amount === null ? null : centsOf(amount);
  return {
    copies: { goals: goals.length, rows: rows.length },
    target: goal ? field(goal.target) : undefined,
    remaining: goal ? field(goal.remaining) : undefined,
    linkedPaid: goal ? field(goal.linkedPaid) : undefined,
    paymentStatus: goal ? goal.paymentStatus : undefined,
    paidOn: goal ? goal.paidOn : undefined,
    paymentRetired: goal ? goal.paymentRetired : undefined,
    need: row ? field(row.need) : undefined,
    seqLinkedPaid: row ? field(row.linkedPaid) : undefined,
    seqPaymentStatus: row ? row.paymentStatus : undefined,
    seqPaidOn: row ? row.paidOn : undefined,
    seqPaymentRetired: row ? row.paymentRetired : undefined,
    saved: item ? field(item.saved) : undefined,
    originalCost: row && row.commitmentCost ? row.commitmentCost.originalCost : undefined,
    confirmedLinkedPaid: row && row.commitmentCost ? row.commitmentCost.confirmedLinkedPaid : undefined,
    unpaidCost: row && row.commitmentCost ? row.commitmentCost.unpaidCost : undefined,
  };
}
function linksOf(evidence) {
  return (evidence && evidence.commitments || []).flatMap(entry =>
    (entry.links || []).map(link => ({ goalId: entry.goalId, ...link })));
}
function knownAmountCents(fact) {
  if (!fact || fact.status !== 'known' || fact.amount == null) return fact && fact.amount === null ? null : undefined;
  return centsOf(fact.amount);
}

test('household Savings journey acceptance against the production composition', async t => {
  const report = [];
  const record = (step, status, detail) => {
    report.push({ step, status, ...detail });
    console.log('STEP ' + step + ' ' + status + ' ' + (detail.name || '')
      + (detail.reason ? ' — ' + detail.reason : ''));
  };
  try {
    const w = await started(t);
    assert.equal(w.owner.status().state, 'ready');

    const createProbe = await request(w, '/settlement/goals', {});
    const selectionsProbe = await request(w, '/settlement/capability');
    assert.equal(selectionsProbe.value.status, 'active', 'settlement composition did not become active');
    assert.ok(createProbe.status === 404 || createProbe.value && createProbe.value.status === 'unavailable');
    record(1, 'SKIP', { name: 'create-two-savings-goals',
      reason: 'missing capability savings-goal-create: the production composition has no goal-creation route or controller operation (POST /settlement/goals is not mounted; HTTP ' + createProbe.status + '). Commitments are read from the trusted canonical context and are not created here. The journey continues with the two canonical goals that context already serves: Goal A ' + GOAL_A.cents + ' cents due ' + GOAL_A.due + ', Goal B ' + GOAL_B.cents + ' cents due ' + GOAL_B.due + '.' });

    const opened = surfaces(await served(w));
    const beforeA = figures(opened, GOAL_A.id);
    const beforeB = figures(opened, GOAL_B.id);
    assert.equal(beforeA.copies.goals, 1, 'Goal A was not published exactly once');
    assert.equal(beforeB.copies.goals, 1, 'Goal B was not published exactly once');
    assert.equal(beforeA.target, GOAL_A.cents);
    assert.equal(beforeB.target, GOAL_B.cents);
    assert.equal(beforeA.remaining, GOAL_A.cents);
    assert.equal(beforeB.remaining, GOAL_B.cents);
    assert.ok(sequenceRows(opened, GOAL_A.id)[0]
      && sequenceRows(opened, GOAL_A.id)[0].rank < sequenceRows(opened, GOAL_B.id)[0].rank,
      'Goal A is not due before Goal B');
    assert.equal(opened.qualified, true, 'genesis settlement document did not publish qualified empty evidence: ' + JSON.stringify(opened.status));
    const goalABefore = clone(beforeA);
    const goalBRemainingBefore = beforeB.remaining;

    const catalogue = (await request(w, '/settlement/selections', {})).value;
    assert.equal(catalogue.status, 'available', JSON.stringify(catalogue));
    const purchaseB = catalogue.transactions.find(row => row.label === PURCHASE_B.payee);
    const purchaseA = catalogue.transactions.find(row => row.label === PURCHASE_A.payee);
    const commitmentB = catalogue.commitments.find(row => row.label === GOAL_B.label);
    const commitmentA = catalogue.commitments.find(row => row.label === GOAL_A.label);
    assert.ok(purchaseB && purchaseA && commitmentA && commitmentB, 'catalogue missing a recorded purchase or goal');
    assert.equal(purchaseB.cents, PURCHASE_B.cents);
    assert.equal(purchaseA.cents, PURCHASE_A.cents);
    assert.ok(purchaseB.date <= opened.asOf && purchaseA.date <= opened.asOf, 'purchase is not already spent');
    const preparedB = (await request(w, '/settlement/prepare', { operationId: op(1), selection: {
      transaction: purchaseB.handle, commitment: commitmentB.handle }, assignedCents: PURCHASE_B.cents })).value;
    assert.equal(preparedB.status, 'prepared', JSON.stringify(preparedB));
    assert.equal(preparedB.assignedCents, PURCHASE_B.cents);
    assert.equal(preparedB.labels.goal, GOAL_B.label);
    record(2, 'PASS', { name: 'record-and-assign-purchase-to-goal-b',
      detail: { purchaseCents: PURCHASE_B.cents, date: PURCHASE_B.date, goal: GOAL_B.id,
        intake: 'synthetic acquire double (posted debit already spent); assignment via POST /settlement/prepare' } });

    const confirmedB = (await request(w, '/settlement/confirm', { operationId: preparedB.operationId,
      previewToken: preparedB.previewToken, generation: preparedB.generation, confirmed: true })).value;
    assert.equal(confirmedB.status, 'committed', JSON.stringify(confirmedB));
    record(3, 'PASS', { name: 'confirm-goal-b-assignment', detail: { operationId: op(1), status: 'committed' } });

    const readsBefore = w.sql.filter(row => row.kind === 'financial' && row.text.includes('.doc_head')).length;
    await restart(w);
    const reloaded = surfaces(await served(w));
    const storeReads = w.storeReadsAtRestart();
    assert.ok(storeReads > 0, 'restart did not fresh-read doc_head');
    assert.ok(w.sql.filter(row => row.kind === 'financial' && row.text.includes('.doc_head')).length > readsBefore);
    assert.equal(reloaded.qualified, true);
    const afterA = figures(reloaded, GOAL_A.id);
    const afterB = figures(reloaded, GOAL_B.id);
    assert.deepEqual(afterA, goalABefore, 'Goal A changed across the Goal B assignment: ' + JSON.stringify({ afterA, goalABefore }));
    assert.equal(afterB.linkedPaid, PURCHASE_B.cents, 'Goal B linked paid');
    assert.equal(afterB.seqLinkedPaid, PURCHASE_B.cents, 'funding-sequence linked paid');
    assert.equal(knownAmountCents(afterB.confirmedLinkedPaid), PURCHASE_B.cents);
    assert.equal(afterB.remaining, goalBRemainingBefore - PURCHASE_B.cents);
    assert.equal(afterB.need, goalBRemainingBefore - PURCHASE_B.cents);
    assert.equal(knownAmountCents(afterB.unpaidCost), goalBRemainingBefore - PURCHASE_B.cents);
    const links = linksOf(reloaded.evidence);
    assert.equal(links.length, 1, 'assignment link count ' + links.length);
    assert.equal(links[0].goalId, 'commitment:' + GOAL_B.id);
    assert.equal(links[0].assignedCents, PURCHASE_B.cents);
    const linkedPaidTotal = [afterA, afterB].reduce((sum, row) => sum + (row.linkedPaid || 0), 0);
    const costPaidTotal = [afterA, afterB].reduce((sum, row) => sum + (knownAmountCents(row.confirmedLinkedPaid) || 0), 0);
    assert.equal(linkedPaidTotal, PURCHASE_B.cents, 'linked-paid total counted the assignment more or less than once');
    assert.equal(costPaidTotal, PURCHASE_B.cents, 'confirmed-linked-paid total counted the assignment more or less than once');
    assert.equal(links.reduce((sum, link) => sum + link.assignedCents, 0), PURCHASE_B.cents);
    assert.equal(afterB.saved, 0, 'the already-spent assignment was also booked as saved');
    const savedTotal = (reloaded.daily.backing.items || []).reduce((sum, item) => {
      const cents = centsOf(item.saved);
      assert.equal(typeof cents, 'number', 'saved figure absent for ' + item.id);
      return sum + cents;
    }, 0);
    assert.equal(savedTotal, POOL_CENTS, 'savings-stock allocation changed by the external purchase');
    assert.notEqual(savedTotal + linkedPaidTotal, PURCHASE_B.cents, 'distinct stock and assignment totals');
    assert.equal(savedTotal + linkedPaidTotal, POOL_CENTS + PURCHASE_B.cents);
    record(4, 'PASS', { name: 'reload-and-assert-exact-cents', detail: {
      goalBLinkedPaidCents: afterB.linkedPaid, goalBRemainingCents: afterB.remaining,
      goalAUnchanged: true, assignmentLinks: links.length, savedTotalCents: savedTotal,
      storeReads: w.storeReadsAtRestart() } });

    const orderA = sequenceRows(reloaded, GOAL_A.id)[0];
    const orderB = sequenceRows(reloaded, GOAL_B.id)[0];
    assert.ok(orderA && orderB && orderA.rank < orderB.rank && orderA.date < orderB.date);
    assert.equal(centsOf(reloaded.daily.stock.amount), POOL_CENTS);
    assert.ok(POOL_CENTS < GOAL_A.cents, 'pool is not limited relative to Goal A');
    assert.equal(centsOf(savedItem(reloaded, GOAL_A.id).saved), POOL_CENTS);
    assert.equal(centsOf(savedItem(reloaded, GOAL_B.id).saved), 0);
    const orderedSaved = [...reloaded.daily.backing.items].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    let poolLeft = POOL_CENTS;
    for (const item of orderedSaved) {
      const need = centsOf(item.needed);
      const saved = centsOf(item.saved);
      const take = Math.min(poolLeft, need);
      assert.equal(saved, take, item.id + ' was not filled in due order');
      poolLeft -= take;
    }
    assert.equal(poolLeft, 0);
    record(6, 'PASS', { name: 'funding-order-limited-pool', detail: {
      assertedWhile: 'both goals active, after the Goal B assignment and before Goal A is fully paid (retirement would remove Goal A from the sequence)',
      goalASavedCents: POOL_CENTS, goalBSavedCents: 0, order: [orderA.id, orderB.id] } });

    const catalogueA = (await request(w, '/settlement/selections', {})).value;
    assert.equal(catalogueA.status, 'available', JSON.stringify(catalogueA));
    const againA = catalogueA.transactions.find(row => row.label === PURCHASE_A.payee);
    const goalAChoice = catalogueA.commitments.find(row => row.label === GOAL_A.label);
    assert.ok(againA && goalAChoice);
    const preparedA = (await request(w, '/settlement/prepare', { operationId: op(2), selection: {
      transaction: againA.handle, commitment: goalAChoice.handle }, assignedCents: PURCHASE_A.cents })).value;
    assert.equal(preparedA.status, 'prepared', JSON.stringify(preparedA));
    const confirmedA = (await request(w, '/settlement/confirm', { operationId: preparedA.operationId,
      previewToken: preparedA.previewToken, generation: preparedA.generation, confirmed: true })).value;
    assert.equal(confirmedA.status, 'committed', JSON.stringify(confirmedA));
    const paidNow = surfaces(await served(w));
    const paidA = figures(paidNow, GOAL_A.id);
    assert.equal(paidNow.cycle && paidNow.cycle.start <= PURCHASE_A.date && PURCHASE_A.date <= paidNow.cycle.end, true,
      'completion as-of is not inside the purchase pay period');
    assert.equal(paidA.seqPaymentStatus, 'paid');
    assert.equal(paidA.paymentStatus, 'paid');
    assert.equal(paidA.seqPaidOn, PURCHASE_A.date);
    assert.equal(paidA.paidOn, PURCHASE_A.date);
    assert.equal(paidA.need, 0);
    assert.equal(paidA.seqPaymentRetired, false, 'Goal A retired inside its completion period');
    assert.equal(paidA.copies.rows, 1, 'Goal A disappeared during the period it was paid');
    const boundary = paidNow.cycle.nextPayday;
    assert.equal(typeof boundary, 'string');
    advanceAsOf(w, boundary);
    const retired = surfaces(await served(w));
    assert.equal(retired.asOf, boundary);
    assert.equal(sequenceRows(retired, GOAL_A.id).length, 0, 'Goal A still active after the next period boundary');
    assert.equal(plannedGoals(retired, GOAL_A.id).length, 0, 'Goal A still in the savings inventory after retirement');
    assert.equal(sequenceRows(retired, GOAL_B.id).length, 1, 'Goal B dropped with Goal A');
    assert.equal(plannedGoals(retired, GOAL_B.id).length, 1);
    assert.notEqual(figures(retired, GOAL_B.id).seqPaymentStatus, 'paid');
    record(5, 'PASS', { name: 'pay-goal-a-then-retire-after-period-boundary', detail: {
      paidOn: PURCHASE_A.date, completionPeriod: [paidNow.cycle.start, paidNow.cycle.end],
      nextBoundary: boundary, goalBStillActive: true } });

    const openAssignments = (await request(w, '/settlement/assignments', {})).value;
    assert.equal(openAssignments.status, 'available', JSON.stringify(openAssignments));
    const goalBAssignment = openAssignments.assignments.filter(row =>
      row.assignedCents === PURCHASE_B.cents && row.date === PURCHASE_B.date);
    assert.equal(goalBAssignment.length, 1, JSON.stringify(openAssignments.assignments));
    const preparedWithdrawal = (await request(w, '/settlement/prepare-withdrawal', { operationId: op(3),
      assignmentHandle: goalBAssignment[0].handle })).value;
    assert.equal(preparedWithdrawal.status, 'prepared', JSON.stringify(preparedWithdrawal));
    assert.equal(preparedWithdrawal.assignedCents, PURCHASE_B.cents);
    const withdrawn = (await request(w, '/settlement/confirm', { operationId: preparedWithdrawal.operationId,
      previewToken: preparedWithdrawal.previewToken, generation: preparedWithdrawal.generation, confirmed: true })).value;
    assert.equal(withdrawn.status, 'committed', JSON.stringify(withdrawn));
    await restart(w);
    const restored = surfaces(await served(w));
    assert.ok(w.storeReadsAtRestart() > 0, 'withdrawal reload did not fresh-read the store');
    const restoredB = figures(restored, GOAL_B.id);
    assert.equal(restoredB.remaining, goalBRemainingBefore, 'Goal B remaining did not return to its pre-assignment value');
    assert.equal(restoredB.need, goalBRemainingBefore);
    assert.equal(restoredB.linkedPaid, 0);
    assert.equal(restoredB.seqLinkedPaid, undefined, 'withdrawn Goal B still publishes a funding-sequence linked paid');
    assert.equal(knownAmountCents(restoredB.confirmedLinkedPaid), 0);
    assert.equal(linksOf(restored.evidence).some(link => link.goalId === 'commitment:' + GOAL_B.id), false);
    assert.equal(sequenceRows(restored, GOAL_A.id).length, 0);
    const spendable = (await request(w, '/settlement/selections', {})).value;
    assert.equal(spendable.status, 'available', JSON.stringify(spendable));
    const freed = spendable.transactions.find(row => row.label === PURCHASE_B.payee);
    const goalBAgain = spendable.commitments.find(row => row.label === GOAL_B.label);
    assert.ok(freed && goalBAgain, 'withdrawn purchase left the recorded-payment catalogue');
    assert.equal(freed.cents, PURCHASE_B.cents);
    const stillAssigned = (await request(w, '/settlement/assignments', {})).value;
    assert.equal(stillAssigned.status, 'available');
    assert.equal(stillAssigned.assignments.some(row => row.assignedCents === PURCHASE_B.cents && row.date === PURCHASE_B.date), false,
      'withdrawn assignment is still active');
    const reusable = (await request(w, '/settlement/prepare', { operationId: op(4), selection: {
      transaction: freed.handle, commitment: goalBAgain.handle }, assignedCents: PURCHASE_B.cents })).value;
    assert.equal(reusable.status, 'prepared', 'purchase was not spendable again: ' + JSON.stringify(reusable));
    assert.equal(reusable.assignedCents, PURCHASE_B.cents);
    record(7, 'PASS', { name: 'withdraw-goal-b-assignment', detail: {
      remainingCents: restoredB.remaining, preAssignmentRemainingCents: goalBRemainingBefore,
      purchaseUnassigned: true, reprepare: 'prepared' } });

    report.sort((a, b) => a.step - b.step);
    const counts = report.reduce((sum, row) => { sum[row.status] = (sum[row.status] || 0) + 1; return sum; }, {});
    console.log('JOURNEY COUNTS ' + JSON.stringify(counts));
    console.log('JOURNEY REPORT ' + JSON.stringify(report));
    assert.deepEqual(report.map(row => row.step), [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(counts.PASS, 6);
    assert.equal(counts.SKIP, 1);
    assert.equal(counts.FAIL || 0, 0);
  } catch (error) {
    report.sort((a, b) => a.step - b.step);
    console.log('JOURNEY REPORT ' + JSON.stringify(report));
    throw error;
  }
});
