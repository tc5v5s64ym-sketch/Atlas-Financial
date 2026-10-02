'use strict';
// Owner-authorized direct Lunch Money evidence and bounded edits (2026-10-02).
// No Atlas calculations/canonical writes. References and previews are RAM-only.
const crypto = require('crypto');
const z = require('zod/v4');
const Provider = require('./provider-observe.js');
const Credentials = require('./local-credentials.js');
const READ_SCOPE = 'atlas.transactions.read';
const WRITE_SCOPE = 'atlas.transactions.write';
const TTL = 10 * 60 * 1000;
const MAX_REFS = 10000;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v =>
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
const ref = z.string().regex(/^(tx|cat|acct)-[a-f0-9]{24}$/);
const money = z.string().regex(/^-?\d{1,10}(\.\d{1,2})?$/);
const child = z.object({ amount: money, categoryRef: ref.nullable(), notes: z.string().max(1000).optional() }).strict();
const changes = z.object({ categoryRef: ref.nullable().optional(), notes: z.string().max(1000).optional() })
  .strict().refine(v => Object.keys(v).length > 0);
const schemas = {
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
function fingerprint(tx) { return crypto.createHash('sha256').update(JSON.stringify(tx)).digest('hex'); }
function fail(reason) { return { status: 'unavailable', reason, writesAtlasState: false }; }
function requiredScope(operation) {
  if (operation === 'prepare' || operation === 'apply') return WRITE_SCOPE;
  if (operation === 'catalog' || operation === 'query') return READ_SCOPE;
  return null;
}
function scopeDenial(operation, auth = {}) {
  const required = requiredScope(operation);
  if (!required) return fail('invalid-arguments');
  if (!(auth.scopes || []).includes(required)) {
    return fail(required === WRITE_SCOPE
      ? 'transaction-write-scope-required'
      : 'transaction-read-scope-required');
  }
  return null;
}
function safeText(value) { return typeof value === 'string' ? value.slice(0, 2000) : null; }

function createService(options = {}) {
  const env = options.env || process.env;
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
  async function request(method, path, body) {
    const token = await resolveToken();
    if (!token) throw new Error('credential-unavailable');
    const base = Provider.lunchMoneyApiBase(env);
    const response = await fetcher(base + path, { method, redirect: 'error',
      signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) throw new Error('provider-request-failed');
    return response.json();
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
    cents(tx.amount);
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
  async function catalogData(principal) {
    const [c, p, m] = await Promise.all([request('GET', '/categories'), request('GET', '/plaid_accounts'), request('GET', '/manual_accounts')]);
    if (!Array.isArray(c.categories) || !Array.isArray(p.plaid_accounts) || !Array.isArray(m.manual_accounts)) throw new Error('catalog-unavailable');
    const categories = c.categories.flatMap(row => [row, ...(row.children || [])]);
    const accounts = [
      ...p.plaid_accounts.map(a => ({ type: 'plaid', providerId: a.id, label: safeText(a.display_name || a.name) })),
      ...m.manual_accounts.map(a => ({ type: 'manual', providerId: a.id, label: safeText(a.name) })),
    ].map(a => ({ ...a, ref: accountAlias(a.type, a.providerId, principal, a.label) }));
    return { categories, accounts };
  }
  async function categoryId(value, principal) {
    if (value === null) return null;
    const id = resolve(value, 'cat', principal).id;
    const category = await request('GET', '/categories/' + id);
    if (category.id !== id || category.is_group || category.archived) throw new Error('category-not-editable');
    return id;
  }
  function editable(tx) {
    if (tx.is_pending || tx.is_split_parent || tx.split_parent_id != null
      || tx.is_group_parent || tx.group_parent_id != null || tx.status === 'delete_pending') throw new Error('transaction-not-editable');
  }
  async function catalog(_, auth) {
    const { categories, accounts } = await catalogData(auth.principal);
    return { status: 'ok', source: 'Lunch Money v2', referenceExpiresInSeconds: TTL / 1000,
      categories: categories.map(c => ({ categoryRef: alias('cat', c.id, auth.principal), name: safeText(c.name),
        archived: c.archived === true, group: c.is_group === true, income: c.is_income === true,
        excludedFromBudget: c.exclude_from_budget === true, excludedFromTotals: c.exclude_from_totals === true })),
      accounts: accounts.map(a => ({ accountRef: a.ref, name: a.label, type: a.type })) };
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
  async function prepare(input, auth) {
    const target = resolve(input.transactionRef, 'tx', auth.principal);
    const tx = await request('GET', '/transactions/' + target.id); editable(tx);
    if (tx.id !== target.id) throw new Error('identity-mismatch');
    let body;
    if (input.changes) {
      body = {};
      if (input.changes.categoryRef !== undefined) body.category_id = await categoryId(input.changes.categoryRef, auth.principal);
      if (input.changes.notes !== undefined) body.notes = input.changes.notes;
    } else {
      const sum = input.splits.reduce((total, row) => total + cents(row.amount), 0);
      const parentAmount = cents(tx.amount);
      if (sum !== parentAmount || input.splits.some(row => cents(row.amount) === 0
        || Math.sign(cents(row.amount)) !== Math.sign(parentAmount))) throw new Error('split-must-conserve-parent-amount');
      body = { child_transactions: [] };
      for (const row of input.splits) body.child_transactions.push({ amount: row.amount,
        category_id: await categoryId(row.categoryRef, auth.principal), ...(row.notes === undefined ? {} : { notes: row.notes }) });
    }
    const cat = await catalogData(auth.principal);
    sweep(); if (previews.size >= 100) throw new Error('preview-capacity');
    const id = 'edit-' + crypto.randomBytes(24).toString('hex');
    previews.set(id, { principal: auth.principal, targetId: target.id, before: tx,
      fingerprint: fingerprint(tx), body, splits: !!input.splits, expires: now() + TTL, used: false });
    return { status: 'preview', previewId: id, expiresAt: new Date(now() + TTL).toISOString(),
      before: project(tx, auth.principal, cat.categories, cat.accounts),
      proposed: input.changes ? { ...input.changes,
        ...(body.category_id === undefined ? {} : { category: cat.categories.find(c => c.id === body.category_id)?.name || null }) }
        : { splits: input.splits.map((row, i) => ({ ...row,
          category: cat.categories.find(c => c.id === body.child_transactions[i].category_id)?.name || null })) },
      instruction: 'Show the exact before/proposed change to the user. Apply only after explicit confirmation for this preview. No write has occurred.', providerWrite: false };
  }
  async function apply(input, auth) {
    sweep(); const preview = previews.get(input.previewId);
    if (!preview || preview.principal !== auth.principal || preview.used) return fail('preview-expired-or-already-used');
    if (locks.has(preview.targetId)) return fail('transaction-edit-in-progress');
    // Consume before the first await: concurrent calls and ambiguous write failures cannot retry.
    preview.used = true;
    locks.add(preview.targetId);
    let writeAttempted = false;
    try {
      const current = await request('GET', '/transactions/' + preview.targetId);
      if (fingerprint(current) !== preview.fingerprint) return fail('transaction-changed-prepare-new-preview');
      editable(current);
      for (const id of preview.splits ? preview.body.child_transactions.map(c => c.category_id) : [preview.body.category_id]) {
        if (id != null) { const c = await request('GET', '/categories/' + id); if (c.id !== id || c.archived || c.is_group) throw new Error('category-not-editable'); }
      }
      writeAttempted = true;
      await request(preview.splits ? 'POST' : 'PUT', preview.splits
        ? '/transactions/split/' + preview.targetId : '/transactions/' + preview.targetId + '?update_balance=false', preview.body);
      const after = await request('GET', '/transactions/' + preview.targetId);
      let verified = after.id === preview.targetId;
      if (preview.splits) {
        const expected = preview.body.child_transactions.map(c => [cents(c.amount), c.category_id, c.notes ?? current.notes ?? '', current.date, current.currency]);
        const actual = (after.children || []).map(c => [cents(c.amount), c.category_id, c.notes ?? '', c.date, c.currency]);
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
      if (!verified) return { status: 'write-unverified', reason: 'readback-did-not-match-do-not-retry', providerWriteMayHaveOccurred: true };
      const cat = await catalogData(auth.principal);
      return { status: 'applied', verifiedByReadback: true, writesAtlasState: false,
        transaction: project(after, auth.principal, cat.categories, cat.accounts),
        ...(preview.splits ? { children: after.children.map(c => project(c, auth.principal, cat.categories, cat.accounts)) } : {}),
        instruction: 'Lunch Money saved the edit. Re-query Lunch Money and get_atlas_current for refreshed evidence; no canonical Atlas policy was edited.' };
    } catch (_) {
      return writeAttempted ? { status: 'write-unverified', reason: 'provider-result-unknown-do-not-retry', providerWriteMayHaveOccurred: true }
        : fail('apply-rejected-before-write');
    } finally { locks.delete(preview.targetId); }
  }
  async function invoke(operation, args, auth = {}) {
    if (!auth.principal) return fail('authenticated-subject-required');
    const denied = scopeDenial(operation, auth);
    if (denied) return denied;
    const parsed = schemas[operation]?.safeParse(args);
    if (!parsed?.success) return fail('invalid-arguments');
    try { return await ({ catalog, query, prepare, apply })[operation](parsed.data, auth); }
    catch (_) { return fail('lunchmoney-operation-unavailable'); }
  }
  return { invoke };
}
module.exports = { READ_SCOPE, WRITE_SCOPE, TTL, schemas, cents, requiredScope, scopeDenial, createService };
