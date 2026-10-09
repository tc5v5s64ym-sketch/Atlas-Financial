'use strict';
// Owner-authorized direct Lunch Money evidence and bounded edits (2026-10-02).
// No Atlas calculations/canonical writes. References and previews are RAM-only.
const crypto = require('crypto');
const z = require('zod/v4');
const Provider = require('./provider-observe.js');
const Credentials = require('./local-credentials.js');
const Standing = require('./assistant-standing-corrections.js');
const READ_SCOPE = 'atlas.transactions.read';
const WRITE_SCOPE = 'atlas.transactions.write';
const TTL = 10 * 60 * 1000;
const MAX_REFS = 10000;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v =>
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
const ref = z.string().regex(/^(tx|cat|acct)-[a-f0-9]{24}$/);
const money = z.string().regex(/^-?\d{1,10}(\.\d{1,2})?$/);
// Provider evidence is a decimal string with up to four places. Read it
// verbatim; the separate `money`/cents contract governs caller/write input.
const providerMoney = z.string().max(64).regex(/^-?\d+(\.\d{1,4})?$/);
const child = z.object({ amount: money, categoryRef: ref.nullable(), notes: z.string().max(1000).optional() }).strict();
const changes = z.object({ categoryRef: ref.nullable().optional(), notes: z.string().max(1000).optional() })
  .strict().refine(v => Object.keys(v).length > 0);
const standingChanges = z.object({ categoryRef: ref.optional(), notesAppend: z.string().min(1).max(500).optional() })
  .strict().refine(v => Object.keys(v).length > 0);
const delegatedReview = z.object({
  schema: z.literal(Standing.DELEGATED_POLICY), status: z.enum(['resolved', 'uncertain']),
  sources: z.array(z.object({ system: z.enum(['gmail', 'library', 'user-provided', 'other-authorized']),
    reference: z.string().min(1).max(300), excerptDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(5),
  facts: z.object({ date, payee: z.string().min(1).max(200), amount: money, currency: z.string().regex(/^[a-z]{3}$/),
    completeReceipt: z.boolean(), items: z.array(z.object({ description: z.string().min(1).max(200),
      amount: money, categoryRef: ref }).strict()).min(1).max(40) }).strict(),
  rationale: z.string().min(1).max(1000), issues: z.array(z.string().max(200)).max(10),
}).strict();
const grantRef = z.string().regex(/^grant-[a-f0-9]{24}$/);
const evidenceRef = z.string().regex(/^evidence-[a-f0-9]{24}$/);
const schemas = {
  submitStandingEvidence: z.object({ transactionRef: ref, grantRef, categoryRef: ref, review: delegatedReview }).strict(),
  standingAudit: z.object({ grantRef }).strict(),
  prepareStanding: z.object({ transactionRef: ref, grantRef, evidenceRef, changes: standingChanges }).strict(),
  applyStanding: z.object({ previewId: z.string().regex(/^edit-[a-f0-9]{48}$/) }).strict(),
  catalog: z.object({}).strict(),
  query: z.object({ startDate: date, endDate: date, categoryRef: ref.optional(),
    accountRef: ref.optional(), excludeAccountRef: ref.optional(), merchant: z.string().trim().min(1).max(120).optional(),
    offset: z.number().int().min(0).max(10000).optional(), limit: z.number().int().min(1).max(200).optional() }).strict()
    .refine(v => v.startDate <= v.endDate && (Date.parse(v.endDate) - Date.parse(v.startDate)) <= 366 * 86400000
      && !(v.accountRef && v.excludeAccountRef)),
  prepare: z.object({ transactionRef: ref, changes: changes.optional(), splits: z.array(child).min(2).max(20).optional() })
    .strict().refine(v => !!v.changes !== !!v.splits),
  apply: z.object({ previewId: z.string().regex(/^edit-[a-f0-9]{48}$/), confirmed: z.literal(true) }).strict(),
};
function cents(value) {
  if (typeof value !== 'string' || !money.safeParse(value).success) throw new Error('invalid-amount');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  return (negative ? -1 : 1) * (Number(whole) * 100 + Number(fraction.padEnd(2, '0')));
}
function providerCents(value) {
  if (!providerMoney.safeParse(value).success) throw new Error('invalid-provider-amount');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  // Extra provider places may represent whole cents, never rounded fractions.
  if (/[1-9]/.test(fraction.slice(2))) throw new Error('invalid-provider-amount');
  const magnitude = BigInt(whole) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, '0'));
  if (magnitude > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('invalid-provider-amount');
  return Number(negative ? -magnitude : magnitude);
}
function fingerprint(tx) { return crypto.createHash('sha256').update(JSON.stringify(tx)).digest('hex'); }
function fail(reason) { return { status: 'unavailable', reason, writesAtlasState: false }; }
class ProviderRequestError extends Error {
  constructor(code, stage, upstreamStatus) {
    super(code);
    this.stage = stage;
    if (Number.isInteger(upstreamStatus) && upstreamStatus >= 100 && upstreamStatus <= 599) {
      this.upstreamStatus = upstreamStatus;
    }
  }
}
const READ_ERROR_CODES = new Set([
  'invalid-provider-amount', 'malformed-transaction', 'malformed-date',
  'invalid-provider-identity', 'invalid-category-identity', 'reference-capacity',
  'reference-expired-or-unavailable', 'category-evidence-unavailable',
  'account-evidence-unavailable', 'catalog-unavailable', 'coverage-unavailable',
  'duplicate-provider-identity',
]);
function readFailure(operation, error) {
  // Never expose error text, request URLs/headers, provider bodies or IDs.
  const requestError = error instanceof ProviderRequestError;
  const code = requestError || READ_ERROR_CODES.has(error && error.message)
    ? error.message : 'unexpected-failure';
  const stage = requestError ? error.stage
    : code === 'invalid-provider-amount' || code === 'malformed-transaction'
      ? 'transaction-validation' : operation;
  return { ...fail('lunchmoney-operation-unavailable'), diagnostic: { stage, code,
    ...(requestError && error.upstreamStatus !== undefined ? { upstreamStatus: error.upstreamStatus } : {}) } };
}
function requiredScope(operation) {
  if (['prepareStanding', 'applyStanding', 'submitStandingEvidence', 'standingAudit'].includes(operation)) return Standing.SCOPE;
  if (operation === 'prepare' || operation === 'apply') return WRITE_SCOPE;
  if (operation === 'catalog' || operation === 'query') return READ_SCOPE;
  return null;
}
function scopeDenial(operation, auth = {}) {
  const required = requiredScope(operation);
  if (!required) return fail('invalid-arguments');
  if (required === Standing.SCOPE) {
    return [READ_SCOPE, WRITE_SCOPE, Standing.SCOPE].every(scope => (auth.scopes || []).includes(scope))
      ? null : fail('standing-correction-scopes-required');
  }
  if (!(auth.scopes || []).includes(required)) {
    return fail(required === WRITE_SCOPE
      ? 'transaction-write-scope-required'
      : 'transaction-read-scope-required');
  }
  return null;
}
function safeText(value) { return typeof value === 'string' ? value.slice(0, 2000) : null; }

// Keep provider decimal precision/sign and semantic balance dates. A catalog
// GET, object edit, or successful sync is not proof of today's bank balance.
function providerDate(value) {
  if (typeof value !== 'string') return null;
  return date.safeParse(value).success || z.iso.datetime({ offset: true }).safeParse(value).success
    ? value : null;
}
function accountEvidence(row, kind, observedAt) {
  const amount = typeof row.balance === 'string' && row.balance.length <= 64
    && /^-?\d+(\.\d{1,4})?$/.test(row.balance) ? row.balance : null;
  const currency = typeof row.currency === 'string' && /^[a-z]{3}$/.test(row.currency)
    ? row.currency : null;
  const dateField = kind === 'plaid' ? 'balance_last_update' : 'balance_as_of';
  const asOf = providerDate(row[dateField]);
  const status = amount !== null && currency !== null ? 'reported' : 'unavailable';
  return {
    accountType: safeText(row.type), subtype: safeText(row.subtype),
    institution: safeText(row.institution_name), accountStatus: safeText(row.status),
    closedOn: date.safeParse(row.closed_on).success ? row.closed_on : null,
    balance: {
      status, amount: status === 'reported' ? amount : null, currency,
      asOf, asOfField: asOf ? dateField : null,
      freshness: !asOf ? 'unknown' : Date.parse(asOf) > observedAt ? 'future-date' : 'provider-dated',
      trust: 'unknown', source: 'Lunch Money v2',
      ...(status === 'unavailable' ? { reason: amount === null
        ? 'balance-missing-or-invalid' : 'currency-missing-or-invalid' } : {}),
    },
    // These are useful diagnostics, never substitutes for balance.asOf.
    timestamps: {
      updatedAt: providerDate(row.updated_at), lastFetchedAt: providerDate(row.last_fetch),
      lastImportedAt: providerDate(row.last_import),
      lastSuccessfulSyncAt: providerDate(row.plaid_last_successful_update),
    },
  };
}

function createService(options = {}) {
  const env = options.env || process.env;
  // No environment flag or grant store is wired in production. Activation is
  // a separate owner-approved installation of this trusted dependency.
  const standing = options.standingCorrections || {};
  const blockedStandingGrants = new Set();
  const now = options.now || Date.now;
  const refs = new Map();
  const previews = new Map();
  const locks = new Set();
  const salt = crypto.randomBytes(32);
  const fetcher = options.fetch || fetch;
  const resolveToken = options.resolveToken || (async () => (await Credentials.resolveLunchMoneyAccessToken({ env })).token);
  function sweep() {
    for (const map of [refs, previews]) for (const [key, value] of map) if (value.expires <= now()) map.delete(key);
  }
  function alias(kind, id, principal, extra = {}) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('invalid-provider-identity');
    sweep();
    const key = kind + '-' + crypto.createHmac('sha256', salt).update(`${principal}:${kind}:${id}`).digest('hex').slice(0, 24);
    if (!refs.has(key) && refs.size >= MAX_REFS) throw new Error('reference-capacity');
    refs.set(key, { kind, id, principal, ...extra, expires: now() + TTL });
    return key;
  }
  function resolve(key, kind, principal) {
    sweep(); const value = refs.get(key);
    if (!value || value.kind !== kind || value.principal !== principal) throw new Error('reference-expired-or-unavailable');
    return value;
  }
  async function request(method, path, body, beforeSend) {
    const stage = path.startsWith('/transactions') ? 'transactions-request'
      : path.startsWith('/categories') ? 'categories-request'
        : path.startsWith('/plaid_accounts') ? 'synced-accounts-request' : 'manual-accounts-request';
    let token;
    try { token = await resolveToken(); }
    catch (_) { throw new ProviderRequestError('credential-unavailable', stage); }
    if (!token) throw new ProviderRequestError('credential-unavailable', stage);
    let base;
    try { base = Provider.lunchMoneyApiBase(env); }
    catch (_) { throw new ProviderRequestError('provider-configuration-invalid', stage); }
    // Run the standing final authorization/reservation after credentials resolve,
    // immediately before the single provider request. It may reject the write.
    if (beforeSend) await beforeSend({ credentialDigest: fingerprint(token) });
    let response;
    try {
      response = await fetcher(base + path, { method, redirect: 'error',
        signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch (error) {
      throw new ProviderRequestError(error && (error.name === 'TimeoutError' || error.name === 'AbortError')
        ? 'provider-request-timeout' : 'provider-network-error', stage);
    }
    if (!response.ok) throw new ProviderRequestError('provider-request-failed', stage, response.status);
    try { return await response.json(); }
    catch (_) { throw new ProviderRequestError('provider-response-invalid-json', stage, response.status); }
  }
  function accountKey(tx) {
    if (tx.plaid_account_id != null) return ['plaid', tx.plaid_account_id];
    if (tx.manual_account_id != null) return ['manual', tx.manual_account_id];
    return null;
  }
  // Account ID namespaces may overlap; keep their reference namespace distinct.
  function accountAlias(kind, id, principal, label) {
    const accountPrincipal = principal + ':' + kind;
    const key = alias('acct', id, accountPrincipal, { accountType: kind, label });
    refs.get(key).principal = principal;
    return key;
  }
  function project(tx, principal, categories, accounts) {
    if (!tx || !date.safeParse(tx.date).success || typeof tx.currency !== 'string' || !/^[a-z]{3}$/.test(tx.currency) || typeof tx.amount !== 'string') throw new Error('malformed-transaction');
    if (!providerMoney.safeParse(tx.amount).success) throw new Error('invalid-provider-amount');
    const account = accountKey(tx);
    const accountRow = account && accounts.find(a => a.type === account[0] && a.providerId === account[1]);
    return { transactionRef: alias('tx', tx.id, principal), date: tx.date, amount: tx.amount,
      currency: tx.currency, payee: safeText(tx.payee), notes: safeText(tx.notes),
      categoryRef: tx.category_id == null ? null : alias('cat', tx.category_id, principal),
      category: categories.find(c => c.id === tx.category_id)?.name || null,
      accountRef: accountRow?.ref || null, account: accountRow?.label || null,
      accountType: account?.[0] || 'unknown', pending: tx.is_pending === true,
      splitParent: tx.is_split_parent === true, splitChild: tx.split_parent_id != null,
      groupParent: tx.is_group_parent === true, groupChild: tx.group_parent_id != null,
      updatedAt: tx.updated_at || null };
  }
  async function catalogData(principal, includeBalances = false, credentialGate) {
    const [c, p, m] = await Promise.all([request('GET', '/categories', undefined, credentialGate), request('GET', '/plaid_accounts', undefined, credentialGate), request('GET', '/manual_accounts', undefined, credentialGate)]);
    if (!Array.isArray(c.categories) || !Array.isArray(p.plaid_accounts) || !Array.isArray(m.manual_accounts)) throw new Error('catalog-unavailable');
    const categories = c.categories.flatMap(row => [row, ...(row.children || [])]);
    const observedAt = now();
    const accounts = [
      ...p.plaid_accounts.map(a => ({ type: 'plaid', providerId: a.id, label: safeText(a.display_name || a.name),
        ...(includeBalances ? { evidence: accountEvidence(a, 'plaid', observedAt) } : {}) })),
      ...m.manual_accounts.map(a => ({ type: 'manual', providerId: a.id, label: safeText(a.name),
        ...(includeBalances ? { evidence: accountEvidence(a, 'manual', observedAt) } : {}) })),
    ].map(a => ({ ...a, ref: accountAlias(a.type, a.providerId, principal, a.label) }));
    return { categories, accounts, observedAt };
  }
  async function categoryId(value, principal, credentialGate) {
    if (value === null) return null;
    const id = resolve(value, 'cat', principal).id;
    const category = await request('GET', '/categories/' + id, undefined, credentialGate);
    if (category.id !== id || category.is_group || category.archived) throw new Error('category-not-editable');
    return id;
  }
  function editable(tx) {
    if (tx.is_pending || tx.is_split_parent || tx.split_parent_id != null
      || tx.is_group_parent || tx.group_parent_id != null || tx.status === 'delete_pending') throw new Error('transaction-not-editable');
  }
  async function catalog(_, auth) {
    const { categories, accounts, observedAt } = await catalogData(auth.principal, true);
    return { status: 'ok', source: 'Lunch Money v2', observedAt: new Date(observedAt).toISOString(),
      coverage: 'complete-provider-account-response', writesAtlasState: false, providerWrite: false,
      note: 'All synced and manual accounts returned by Lunch Money, including savings and closed/inactive accounts. This is not proof that every household account is linked or every bank has synced. Balances are provider-reported, not independently verified; trust remains unknown. Show each balance date and flag old, missing, or future dates. observedAt and sync/object timestamps are not balance dates. Positive asset balances are held funds; positive liability balances are amounts owed. Preserve signs and currencies; never combine assets with debt or different currencies. Savings, restricted or business funds, and available credit are not automatically spendable household cash. Forecast remains the planner.',
      referenceExpiresInSeconds: TTL / 1000,
      categories: categories.map(c => ({ categoryRef: alias('cat', c.id, auth.principal), name: safeText(c.name),
        archived: c.archived === true, group: c.is_group === true, income: c.is_income === true,
        excludedFromBudget: c.exclude_from_budget === true, excludedFromTotals: c.exclude_from_totals === true })),
      accounts: accounts.map(a => ({ accountRef: a.ref, name: a.label, type: a.type, ...a.evidence })) };
  }
  async function query(input, auth) {
    const { categories, accounts } = await catalogData(auth.principal);
    const category = input.categoryRef ? resolve(input.categoryRef, 'cat', auth.principal).id : null;
    const categoryRow = category && categories.find(c => c.id === category);
    if (category && !categoryRow) throw new Error('category-evidence-unavailable');
    // Lunch Money category-group filters include their children. Keep the
    // local evidence check consistent with that provider contract.
    const categoryIds = new Set(category ? [category] : []);
    function includeChildren(row) {
      for (const child of row.children || []) {
        if (!Number.isSafeInteger(child.id) || child.id <= 0) throw new Error('invalid-category-identity');
        categoryIds.add(child.id); includeChildren(child);
      }
    }
    if (categoryRow?.is_group) includeChildren(categoryRow);
    const account = input.accountRef ? resolve(input.accountRef, 'acct', auth.principal) : null;
    const exclude = input.excludeAccountRef ? resolve(input.excludeAccountRef, 'acct', auth.principal) : null;
    const selected = [];
    const seen = new Set();
    let offset = 0; let complete = false;
    for (let page = 0; page < 20; page++) {
      const params = new URLSearchParams({ start_date: input.startDate, end_date: input.endDate,
        include_pending: 'true', include_group_children: 'true', limit: '250', offset: String(offset) });
      if (category) params.set('category_id', String(category));
      if (account) params.set(account.accountType === 'plaid' ? 'plaid_account_id' : 'manual_account_id', String(account.id));
      const data = await request('GET', '/transactions?' + params);
      if (!Array.isArray(data.transactions) || typeof data.has_more !== 'boolean') throw new Error('coverage-unavailable');
      for (const tx of data.transactions) {
        if (seen.has(tx.id)) throw new Error('duplicate-provider-identity');
        seen.add(tx.id);
        const acc = accountKey(tx);
        if (!date.safeParse(tx.date).success) throw new Error('malformed-date');
        if (tx.date < input.startDate || tx.date > input.endDate) continue;
        if (tx.is_group_parent === true) continue;
        if (category && !categoryIds.has(tx.category_id)) continue;
        if ((account || exclude) && !acc) throw new Error('account-evidence-unavailable');
        if (account && (acc[0] !== account.accountType || acc[1] !== account.id)) continue;
        if (exclude && acc && acc[0] === exclude.accountType && acc[1] === exclude.id) continue;
        if (input.merchant && !String(tx.payee || '').toLowerCase().includes(input.merchant.toLowerCase())) continue;
        selected.push(project(tx, auth.principal, categories, accounts));
      }
      if (!data.has_more) { complete = true; break; }
      if (!data.transactions.length) break;
      offset += 250;
    }
    if (!complete) return fail('query-too-large-narrow-date-window');
    const start = input.offset || 0; const limit = input.limit || 100;
    return { status: 'ok', source: 'Lunch Money v2', observedAt: new Date(now()).toISOString(),
      window: { startDate: input.startDate, endDate: input.endDate }, coverage: 'complete-provider-response',
      note: 'Provider ledger evidence, not Atlas budget membership or a claim that every bank has synced. Amounts use Lunch Money signed debit convention; currencies remain separate. Pending and posted rows are explicit. Group children are included and group parents excluded; split parents are excluded by the provider default. Never add parents to their children.',
      rows: selected.slice(start, start + limit), matchedCount: selected.length, hasMore: start + limit < selected.length,
      nextOffset: start + limit < selected.length ? start + limit : null, referenceExpiresInSeconds: TTL / 1000 };
  }
  async function categoryContextFor(tx, destination, credentialGate) {
    const from = tx.category_id == null ? null : await request('GET', '/categories/' + tx.category_id, undefined, credentialGate);
    const to = await request('GET', '/categories/' + destination, undefined, credentialGate);
    if (from && from.id !== tx.category_id || to.id !== destination || to.is_group || to.archived) throw new Error('category-not-editable');
    return { from: Standing.categorySignature(from), to: Standing.categorySignature(to) };
  }
  async function submitStandingEvidence(input, auth) {
    if (!Standing.available(standing) || typeof standing.adapter.admit !== 'function') return fail('standing-evidence-admission-disabled');
    const context = await standing.adapter.context();
    const credentialGate = async candidate => { if (candidate.credentialDigest !== context.credentialDigest) throw new Error('provider-credential-changed'); };
    const target = resolve(input.transactionRef, 'tx', auth.principal);
    const tx = await request('GET', '/transactions/' + target.id, undefined, credentialGate); editable(tx);
    if (tx.id !== target.id) throw new Error('identity-mismatch');
    const category = await categoryId(input.categoryRef, auth.principal, credentialGate);
    const body = { category_id: category };
    const review = { ...input.review, facts: { ...input.review.facts, items: [] } };
    for (const item of input.review.facts.items) review.facts.items.push({
      description: item.description, amount: item.amount, category_id: await categoryId(item.categoryRef, auth.principal, credentialGate) });
    const categoryContext = await categoryContextFor(tx, category, credentialGate);
    const admitted = await standing.adapter.admit({ grantRef: input.grantRef, auth, tx, body, review, categoryContext });
    return { status: 'evidence-recorded', providerWrite: false, ...admitted,
      instruction: 'Delegated client assertions passed server consistency and grant checks. Atlas did not fetch or independently verify the source. Prepare the exact category correction using this evidenceRef.' };
  }
  async function standingAudit(input, auth) {
    if (!Standing.available(standing) || typeof standing.adapter.audit !== 'function') return fail('standing-audit-disabled');
    return { status: 'audit', providerWrite: false, receipts: await standing.adapter.audit({ ...input, auth }) };
  }
  async function prepare(input, auth, standingInput = null) {
    const target = resolve(input.transactionRef, 'tx', auth.principal);
    const tx = await request('GET', '/transactions/' + target.id); editable(tx);
    if (tx.id !== target.id) throw new Error('identity-mismatch');
    let body;
    if (input.changes) {
      body = {};
      if (input.changes.categoryRef !== undefined) body.category_id = await categoryId(input.changes.categoryRef, auth.principal);
      if (input.changes.notes !== undefined) body.notes = input.changes.notes;
      if (standingInput && input.changes.notesAppend !== undefined) body.notes = Standing.appendNotes(tx.notes, input.changes.notesAppend);
    } else {
      const sum = input.splits.reduce((total, row) => total + cents(row.amount), 0);
      const parentAmount = providerCents(tx.amount);
      if (sum !== parentAmount || input.splits.some(row => cents(row.amount) === 0
        || Math.sign(cents(row.amount)) !== Math.sign(parentAmount))) throw new Error('split-must-conserve-parent-amount');
      body = { child_transactions: [] };
      for (const row of input.splits) body.child_transactions.push({ amount: row.amount,
        category_id: await categoryId(row.categoryRef, auth.principal), ...(row.notes === undefined ? {} : { notes: row.notes }) });
    }
    const cat = await catalogData(auth.principal);
    const authorization = standingInput ? await Standing.authorize(standing, {
      ...standingInput, auth, tx, body, fingerprint: fingerprint(tx), now: now(),
      ...(body.category_id == null ? {} : { categoryContext: await categoryContextFor(tx, body.category_id) }),
    }) : null;
    sweep(); if (previews.size >= 100) throw new Error('preview-capacity');
    const id = 'edit-' + crypto.randomBytes(24).toString('hex');
    previews.set(id, { principal: auth.principal, targetId: target.id, before: tx,
      fingerprint: fingerprint(tx), body, splits: !!input.splits, expires: now() + TTL, used: false, authorization });
    return { status: 'preview', previewId: id, expiresAt: new Date(now() + TTL).toISOString(),
      before: project(tx, auth.principal, cat.categories, cat.accounts),
      proposed: input.changes ? { ...(standingInput ? {
        ...(input.changes.categoryRef === undefined ? {} : { categoryRef: input.changes.categoryRef }),
        ...(body.notes === undefined ? {} : { notes: body.notes }),
      } : input.changes),
        ...(body.category_id === undefined ? {} : { category: cat.categories.find(c => c.id === body.category_id)?.name || null }) }
        : { splits: input.splits.map((row, i) => ({ ...row,
          category: cat.categories.find(c => c.id === body.child_transactions[i].category_id)?.name || null })) },
      ...(authorization ? { authorization: { mode: 'standing-grant', grantRef: authorization.grantRef,
        grantRevision: authorization.grantRevision, evidenceRef: authorization.evidenceRef } } : {}),
      instruction: authorization
        ? 'No write has occurred. This exact preview is eligible only for apply_standing_lunchmoney_correction under its bounded owner grant. Report the audit receipt afterward; uncertain writes must not be retried.'
        : 'Show the exact before/proposed change to the user. Apply only after explicit confirmation for this preview. No write has occurred.', providerWrite: false };
  }
  async function apply(input, auth, standingMode = false) {
    sweep(); const preview = previews.get(input.previewId);
    if (!preview || preview.principal !== auth.principal || preview.used) return fail('preview-expired-or-already-used');
    if (!!preview.authorization !== standingMode) return fail('preview-authorization-mode-mismatch');
    if (standingMode && !Standing.available(standing)) return fail('standing-corrections-disabled');
    if (standingMode && blockedStandingGrants.has(preview.authorization.grantRef)) return fail('standing-grant-needs-read-only-reconciliation');
    if (locks.has(preview.targetId)) return fail('transaction-edit-in-progress');
    // Consume before the first await: concurrent calls and ambiguous write failures cannot retry.
    preview.used = true;
    locks.add(preview.targetId);
    let writeAttempted = false;
    let executionCredentialDigest = null;
    const executionGate = async candidate => { if (candidate.credentialDigest !== executionCredentialDigest) throw new Error('provider-credential-changed'); };
    let reservation = null;
    let afterRead = null;
    let auditAttempt = null;
    let auditCatalog = null;
    const startedAt = now();
    async function audit(result) {
      if (!standingMode || !reservation) return result;
      if (result.status === 'write-unverified') blockedStandingGrants.add(preview.authorization.grantRef);
      try {
        if (result.status === 'write-unverified') await standing.adapter.suspend({
          ...preview.authorization, attemptRef: reservation.attemptRef, reason: result.reason });
        const record = { reservation,
          outcome: result.status, reason: result.reason || null, verifiedByReadback: result.verifiedByReadback === true,
          finishedAt: now(), after: afterRead };
        const recordFingerprint = fingerprint(record);
        // finish persists the outcome but MUST retain durable quarantine. A
        // committed outcome with a lost/malformed reply is still quarantined.
        const receipt = await standing.adapter.finish(record);
        if (!receipt || !/^receipt-[a-f0-9]{24}$/.test(receipt.receiptRef)
            || !/^actor-[a-f0-9]{24}$/.test(receipt.actorRef) || receipt.durable !== true
            || receipt.attemptRef !== reservation.attemptRef
            || receipt.recordFingerprint !== recordFingerprint) throw new Error('audit-unavailable');
        let continuation = 'read-only-reconciliation-required';
        if (result.status === 'applied') {
          try {
            const ack = await standing.adapter.acknowledgeVerified({ reservation,
              receiptRef: receipt.receiptRef, recordFingerprint });
            if (!ack || ack.acknowledged !== true) throw new Error('acknowledgment-unavailable');
            continuation = 'acknowledged';
          } catch (_) {
            // Provider readback and the durable attributed receipt are already
            // known. An uncertain ACK affects continuation, not this edit's
            // verified outcome. It cannot cause another provider attempt.
            blockedStandingGrants.add(preview.authorization.grantRef);
            continuation = 'acknowledgment-unconfirmed-check-before-next-correction';
          }
        }
        return { ...result, standingGrantContinuation: continuation,
          auditReceipt: { receiptRef: receipt.receiptRef, authorization: 'standing-grant',
          grantRef: preview.authorization.grantRef, grantRevision: preview.authorization.grantRevision,
          evidenceRef: preview.authorization.evidenceRef, startedAt: new Date(startedAt).toISOString(),
          finishedAt: new Date(now()).toISOString(), outcome: result.status,
          before: auditAttempt.before, proposed: auditAttempt.proposed, after: afterRead,
          actorRef: receipt.actorRef, evidenceProvenance: preview.authorization.evidenceProvenance || null } };
      } catch (_) {
        blockedStandingGrants.add(preview.authorization.grantRef);
        try { await standing.adapter.suspend({ ...preview.authorization, attemptRef: reservation.attemptRef,
          reason: 'audit-outcome-unavailable' }); } catch (_) {}
        return { status: 'write-unverified', reason: 'audit-outcome-unavailable-do-not-retry',
          providerWriteMayHaveOccurred: writeAttempted };
      }
    }
    try {
      const current = await request('GET', '/transactions/' + preview.targetId);
      if (fingerprint(current) !== preview.fingerprint) return fail('transaction-changed-prepare-new-preview');
      editable(current);
      for (const id of preview.splits ? preview.body.child_transactions.map(c => c.category_id) : [preview.body.category_id]) {
        if (id != null) { const c = await request('GET', '/categories/' + id); if (c.id !== id || c.archived || c.is_group) throw new Error('category-not-editable'); }
      }
      const beforeSend = async ({ credentialDigest }) => {
        if (standingMode) {
          executionCredentialDigest = credentialDigest;
          if (preview.expires <= now()) throw new Error('preview-expired');
          const boundary = await Standing.authorize(standing, {
            ...preview.authorization, auth, credentialDigest, tx: current, body: preview.body,
            ...(preview.body.category_id == null ? {} : { categoryContext: await categoryContextFor(current, preview.body.category_id, executionGate) }),
            fingerprint: fingerprint(current), now: now(),
          });
          if (JSON.stringify(boundary) !== JSON.stringify(preview.authorization)) throw new Error('standing-grant-changed');
          const cat = await catalogData(auth.principal, false, executionGate);
          auditCatalog = cat;
          const attempt = { ...boundary, previewId: input.previewId, principal: auth.principal, clientId: auth.clientId,
            transactionId: preview.targetId, beforeProvider: current, expectedCategory: preview.body.category_id,
            untargetedFingerprint: require('./assistant-standing-store').protectedFingerprint(current),
            categoryContext: preview.body.category_id == null ? null : await categoryContextFor(current, preview.body.category_id),
            beforeFingerprint: preview.fingerprint, proposedFingerprint: fingerprint(preview.body),
            expiresAt: preview.expires, requestedAt: now(),
            before: project(current, auth.principal, cat.categories, cat.accounts),
            proposed: { ...(preview.body.category_id === undefined ? {} : { categoryRef: alias('cat', preview.body.category_id, auth.principal) }),
              ...(preview.body.notes === undefined ? {} : { notes: preview.body.notes }) } };
          // Atomic durable reserve rechecks live revocation, expiry, revision,
          // budget and attempt limits; a pending/unverified attempt suspends the
          // grant until read-only reconciliation. No reservation is refunded.
          auditAttempt = attempt;
          reservation = await standing.adapter.reserve(attempt);
          if (!reservation || reservation.authorized !== true
              || !/^attempt-[a-f0-9]{24}$/.test(reservation.attemptRef)
              || reservation.grantRef !== boundary.grantRef
              || reservation.grantRevision !== boundary.grantRevision
              || reservation.durable !== true || preview.expires <= now()) throw new Error('standing-reservation-denied');
          // The shared authority now owns the target lease across grants and
          // instances. Re-read AFTER reservation so stale pre-lock reads cannot
          // overwrite another Atlas instance's completed correction.
          const credentialGate = async candidate => {
            if (candidate.credentialDigest !== credentialDigest) throw new Error('provider-credential-changed');
          };
          const lockedCurrent = await request('GET', '/transactions/' + preview.targetId, undefined, credentialGate);
          if (fingerprint(lockedCurrent) !== preview.fingerprint) throw new Error('transaction-changed-after-reservation');
          editable(lockedCurrent);
          if (preview.body.category_id != null) {
            const category = await request('GET', '/categories/' + preview.body.category_id, undefined, credentialGate);
            if (category.id !== preview.body.category_id || category.archived || category.is_group) throw new Error('category-not-editable');
          }
          const lease = await standing.adapter.verifyReservation({ ...attempt, reservation, checkedAt: now(),
            categoryContext: preview.body.category_id == null ? null : await categoryContextFor(lockedCurrent, preview.body.category_id, credentialGate) });
          if (!lease || lease.valid !== true || lease.attemptRef !== reservation.attemptRef
              || preview.expires <= now()) throw new Error('standing-reservation-no-longer-valid');
        }
        writeAttempted = true;
      };
      if (!standingMode) writeAttempted = true;
      await request(preview.splits ? 'POST' : 'PUT', preview.splits
        ? '/transactions/split/' + preview.targetId : '/transactions/' + preview.targetId + '?update_balance=false', preview.body, beforeSend);
      const after = await request('GET', '/transactions/' + preview.targetId, undefined, standingMode ? executionGate : undefined);
      if (standingMode) afterRead = project(after, auth.principal, auditCatalog.categories, auditCatalog.accounts);
      let verified = after.id === preview.targetId;
      if (preview.splits) {
        const expected = preview.body.child_transactions.map(c => [cents(c.amount), c.category_id, c.notes ?? current.notes ?? '', current.date, current.currency]);
        const actual = (after.children || []).map(c => [providerCents(c.amount), c.category_id, c.notes ?? '', c.date, c.currency]);
        verified = verified && ['amount', 'currency', 'date', 'payee', 'plaid_account_id', 'manual_account_id'].every(key => after[key] === current[key]) && after.is_split_parent === true && expected.length === actual.length
          && JSON.stringify(expected.map(JSON.stringify).sort()) === JSON.stringify(actual.map(JSON.stringify).sort())
          && after.children.every(c => c.split_parent_id === preview.targetId
            && c.plaid_account_id === current.plaid_account_id && c.manual_account_id === current.manual_account_id
            && c.payee === current.payee);
      } else {
        verified = verified && Object.entries(preview.body).every(([key, value]) => key === 'notes'
          ? (after[key] || '') === value : after[key] === value)
          && ['amount', 'currency', 'date', 'payee', 'plaid_account_id', 'manual_account_id'].every(key => after[key] === current[key])
          && (preview.body.category_id !== undefined || after.category_id === current.category_id)
          && (preview.body.notes !== undefined || (after.notes ?? '') === (current.notes ?? ''));
      }
      if (standingMode) {
        verified = verified && Standing.unchangedOtherFields(current, after, preview.body);
        if (preview.authorization.evidenceProvenance) {
          const afterContext = await categoryContextFor(current, preview.body.category_id);
          verified = verified && JSON.stringify(afterContext) === JSON.stringify(auditAttempt.categoryContext);
        }
      }
      if (!verified) return await audit({ status: 'write-unverified', reason: 'readback-did-not-match-do-not-retry', providerWriteMayHaveOccurred: true });
      const cat = await catalogData(auth.principal, false, standingMode ? executionGate : undefined);
      afterRead = project(after, auth.principal, cat.categories, cat.accounts);
      return await audit({ status: 'applied', verifiedByReadback: true, writesAtlasState: false,
        transaction: project(after, auth.principal, cat.categories, cat.accounts),
        ...(preview.splits ? { children: after.children.map(c => project(c, auth.principal, cat.categories, cat.accounts)) } : {}),
        instruction: standingMode
          ? 'Readback verified the bounded correction. Report before/after, evidence and audit receipt to the owner. Re-query for refreshed state.'
          : 'Lunch Money saved the edit. Re-query Lunch Money and get_atlas_current for refreshed evidence; no canonical Atlas policy was edited.' });
    } catch (_) {
      return await audit(writeAttempted ? { status: 'write-unverified', reason: 'provider-result-unknown-do-not-retry', providerWriteMayHaveOccurred: true }
        : fail('apply-rejected-before-write'));
    } finally { locks.delete(preview.targetId); }
  }
  async function prepareStanding(input, auth) {
    if (!Standing.available(standing)) return fail('standing-corrections-disabled');
    if (blockedStandingGrants.has(input.grantRef)) return fail('standing-grant-needs-read-only-reconciliation');
    return prepare({ transactionRef: input.transactionRef, changes: input.changes }, auth,
      { grantRef: input.grantRef, evidenceRef: input.evidenceRef });
  }
  async function applyStanding(input, auth) { return apply(input, auth, true); }
  async function invoke(operation, args, auth = {}) {
    if (!auth.principal) return fail('authenticated-subject-required');
    const denied = scopeDenial(operation, auth);
    if (denied) return denied;
    const parsed = schemas[operation]?.safeParse(args);
    if (!parsed?.success) return fail('invalid-arguments');
    try { return await ({ catalog, query, prepare, apply, prepareStanding, applyStanding, submitStandingEvidence, standingAudit })[operation](parsed.data, auth); }
    catch (error) {
      return operation === 'catalog' || operation === 'query'
        ? readFailure(operation, error) : fail('lunchmoney-operation-unavailable');
    }
  }
  return { invoke, standingEnabled: Standing.available(standing),
    standingAdmissionEnabled: Standing.available(standing) && typeof standing.adapter.admit === 'function' && typeof standing.adapter.audit === 'function' };
}
module.exports = { READ_SCOPE, WRITE_SCOPE, STANDING_SCOPE: Standing.SCOPE, TTL, schemas, cents, requiredScope, scopeDenial, createService };
