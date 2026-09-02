'use strict';
/* Read-only provider observation → B91 reconciliation.
 *
 *   node scripts/provider-observe.js --provider lunchmoney --fixture <file>
 *   node scripts/provider-observe.js --provider lunchmoney --live
 *   node scripts/provider-observe.js --provider lunchmoney --live --identity-proof
 *   node scripts/provider-observe.js --provider lunchmoney --fixture <file> --receipt
 *   node scripts/provider-observe.js --provider lunchmoney --fixture <file> --reconciliation-receipt
 *
 * Live mode resolves a Lunch Money token from LUNCHMONEY_ACCESS_TOKEN, or
 * on Windows from the local CurrentUser DPAPI store. It never
 * writes data.json. Unknown provider account IDs stay unmapped and cannot
 * authorize a precise current-period remaining figure. Deliberate
 * non-household accounts use atlasRole household-external. Synthetic
 * fixture mappings cannot authorize a live canonical mapping. Historical
 * represented-event candidates are not current-opening corrections.
 * A live current-state posted window stays 14 days unless Forecast still
 * carries an unresolved once joint-cash occurrence whose permitted posting
 * date is older; then the same GET extends back to that date, capped at
 * 120 days, as settlement lookup only. Pending coverage is unchanged.
 * Account timestamps stay distinct: balance_as_of, updated_at,
 * date_last_fetched. Posted-balance evidence prefers balance_as_of.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const R = require('./reconcile.js');
const Credentials = require('./local-credentials.js');

const ROOT = path.join(__dirname, '..');
const DEFAULT_MAP = path.join(ROOT, 'docs', 'connectivity', 'provider-account-map.json');
const LOCAL_MAP = path.join(ROOT, 'docs', 'connectivity', 'provider-account-map.local.json');
const FIXTURE_MAP = path.join(ROOT, 'docs', 'connectivity', 'fixtures', 'provider-account-map.json');
const DEFAULT_IDENTITY = path.join(ROOT, 'docs', 'connectivity', 'transaction-identity.json');
const DEFAULT_DATA = path.join(ROOT, 'data.json');
const LIVE_BASE = 'https://api.lunchmoney.dev/v2';
const TOKEN_ENV = 'LUNCHMONEY_ACCESS_TOKEN';
const MAP_JSON_ENV = 'ATLAS_PROVIDER_ACCOUNT_MAP_JSON';
const MAP_PATH_ENV = 'ATLAS_LIVE_OVERLAY_MAP';
const API_BASE_ENV = 'ATLAS_LUNCHMONEY_API_BASE';
const LIVE_MAP_SCHEMA = 'atlas-provider-account-map/v1';
const RECEIPT_SCHEMA = 'atlas-observation-receipt/v1';
const RECONCILIATION_RECEIPT_SCHEMA = 'atlas-obligation-reconciliation-receipt/v1';
const REQUEST_TIMEOUT_MS = 8000;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const CASH_ROLES = new Set(['household-cash']);
const CREDIT_ROLES = new Set(['revolving-credit']);
const EXTERNAL_LIVE_ROLE = 'household-external';
const SUPPORTED_LIVE_ROLES = {
  'household-cash': 'cash',
  'revolving-credit': 'debts',
  heloc: 'debts',
  mortgage: 'debts',
};
const REQUIRED_LIVE_CASH_IDS = Object.freeze(['chequing-a', 'chequing-b', 'savings']);
const CURRENT_STATE_HISTORY_DAYS = 14;
const RECONCILE_HISTORY_DAYS = 120;
const BILL_PAYMENT_PENDING_DAYS = 90;
const PENDING_COVERAGE_BASIS = 'is_pending-unbounded';
const PENDING_QUERY_PAGE_LIMIT = 1000;
const PENDING_QUERY_MAX_PAGES = 20;
const PENDING_COVERAGE_REQUIRED_EVIDENCE =
  'GET /v2/transactions?is_pending=true with no start_date/end_date, paginated until has_more=false.';
const Forecast = require('../public/forecast.js');

function fail(message) {
  const err = new Error(message);
  err.code = 'observe-failed';
  throw err;
}

function parseArgs(argv) {
  const out = {
    provider: null, fixture: null, live: false, map: null,
    data: DEFAULT_DATA, mode: 'current-state', historyDays: null,
    identityProof: false,
    receipt: false,
    reconciliationReceipt: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--provider') out.provider = argv[++i];
    else if (a === '--fixture') out.fixture = argv[++i];
    else if (a === '--live') out.live = true;
    else if (a === '--map') out.map = argv[++i];
    else if (a === '--data') out.data = argv[++i];
    else if (a === '--mode') out.mode = argv[++i];
    else if (a === '--history-days') out.historyDays = Number(argv[++i]);
    else if (a === '--identity-proof') out.identityProof = true;
    else if (a === '--receipt') out.receipt = true;
    else if (a === '--reconciliation-receipt') out.reconciliationReceipt = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function historyDaysFromArgs(args) {
  if (args && args.historyDays != null && isFinite(args.historyDays)) {
    return Math.max(1, Math.floor(args.historyDays));
  }
  if (args && args.mode === 'reconcile') return RECONCILE_HISTORY_DAYS;
  return CURRENT_STATE_HISTORY_DAYS;
}

function resolveMapPath(args) {
  if (args.map) return args.map;
  if (args.live) {
    if (fs.existsSync(LOCAL_MAP)) return LOCAL_MAP;
    return DEFAULT_MAP;
  }
  return FIXTURE_MAP;
}

function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(String(hostname || ''));
}

function lunchMoneyApiBase(env) {
  const source = env || process.env;
  const raw = source && source[API_BASE_ENV];
  if (raw == null || String(raw).trim() === '') return LIVE_BASE;
  let parsed;
  try {
    parsed = new URL(String(raw).trim());
  } catch (e) {
    fail('ATLAS_LUNCHMONEY_API_BASE is not a URL.');
  }
  if (!isLoopbackHost(parsed.hostname)) {
    fail('ATLAS_LUNCHMONEY_API_BASE may only point at a loopback host.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    fail('ATLAS_LUNCHMONEY_API_BASE must be http or https.');
  }
  return String(raw).trim().replace(/\/$/, '');
}

function requestLibFor(url) {
  return url.protocol === 'http:' ? http : https;
}

function knownCanonicalIdsByCollection(data) {
  const byCollection = {
    cash: new Set(),
    debts: new Set(),
  };
  const cash = (data && data.plan && data.plan.startingCash) || {};
  for (const row of [].concat(cash.breakdown || [], cash.heldElsewhere || [])) {
    if (row && row.id) byCollection.cash.add(String(row.id));
  }
  for (const row of (data && data.debts) || []) {
    if (row && row.id) byCollection.debts.add(String(row.id));
  }
  return byCollection;
}

function assertLiveMap(mapDoc, opts) {
  if (!mapDoc || typeof mapDoc !== 'object' || Array.isArray(mapDoc)) {
    fail('live-account-map-invalid');
  }
  if (mapDoc.provider !== 'lunchmoney') fail('Account map is missing or is not a lunchmoney map.');
  if (mapDoc.scope === 'fixture') {
    fail('Fixture account map cannot authorize a live canonical mapping.');
  }
  if (mapDoc.schema !== LIVE_MAP_SCHEMA) fail('live-account-map-invalid');
  const mappings = mapDoc.mappings;
  if (!Array.isArray(mappings)) fail('live-account-map-invalid');
  const providerIds = new Set();
  const atlasKeys = new Set();
  const cashIds = new Set();
  const known = opts && opts.data ? knownCanonicalIdsByCollection(opts.data) : null;
  for (const mapping of mappings) {
    if (!mapping || mapping.providerAccountId == null || mapping.providerAccountId === '') {
      fail('live-account-map-invalid');
    }
    const providerId = String(mapping.providerAccountId);
    if (providerIds.has(providerId)) fail('duplicate-provider-account-id');
    providerIds.add(providerId);
    const role = mapping.atlasRole;
    const collection = mapping.canonical && mapping.canonical.collection;
    const atlasId = mapping.canonical && mapping.canonical.id;
    if (role === EXTERNAL_LIVE_ROLE) {
      if (collection || atlasId) fail('live-account-map-invalid');
      continue;
    }
    if (!role || !SUPPORTED_LIVE_ROLES[role]) fail('unsupported-atlas-role');
    if (!collection || !atlasId) fail('live-account-map-invalid');
    if (SUPPORTED_LIVE_ROLES[role] !== collection) fail('live-account-map-invalid');
    const atlasKey = collection + ':' + String(atlasId);
    if (atlasKeys.has(atlasKey)) fail('live-account-map-invalid');
    atlasKeys.add(atlasKey);
    if (known) {
      const ids = known[collection];
      if (!ids || !ids.has(String(atlasId))) fail('invalid-atlas-account-id');
    }
    if (role === 'household-cash' && collection === 'cash') cashIds.add(String(atlasId));
  }
  for (const id of REQUIRED_LIVE_CASH_IDS) {
    if (!cashIds.has(id)) fail('missing-required-cash-mapping');
  }
}

function parseAccountMapJson(raw) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw));
  } catch (e) {
    fail('live-account-map-invalid');
  }
  return parsed;
}

function loadLiveAccountMap(env, data) {
  const source = env || process.env;
  const json = source && source[MAP_JSON_ENV];
  if (json != null && String(json).trim() !== '') {
    const mapDoc = parseAccountMapJson(json);
    assertLiveMap(mapDoc, { data });
    return mapDoc;
  }
  const mapPath = (source && source[MAP_PATH_ENV])
    || (fs.existsSync(LOCAL_MAP) ? LOCAL_MAP : null);
  if (!mapPath) fail('live-account-map-missing');
  let mapDoc;
  try {
    mapDoc = loadJson(mapPath);
  } catch (e) {
    fail('live-account-map-invalid');
  }
  assertLiveMap(mapDoc, { data });
  return mapDoc;
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function mappingFor(mapDoc, providerAccountId) {
  const id = String(providerAccountId);
  return (mapDoc.mappings || []).find(m => String(m.providerAccountId) === id) || null;
}

function dateOnly(value) {
  return Forecast.financialDate(value);
}

function firstNumber(...values) {
  for (const value of values) {
    if (value != null && value !== '') return Number(value);
  }
  return null;
}

function normalizeLunchMoneyAccount(raw) {
  if (!raw || raw.id == null) fail('Lunch Money account is missing a stable id.');
  return {
    provider: 'lunchmoney',
    providerAccountId: String(raw.id),
    displayName: raw.name || raw.display_name || null,
    institutionName: raw.institution_name || raw.institution || null,
    type: raw.type || null,
    subtype: raw.subtype || raw.type_name || null,
    currency: raw.currency || null,
    balance: firstNumber(raw.balance),
    available: firstNumber(raw.available_balance, raw.available),
    limit: firstNumber(raw.credit_limit, raw.limit),
    updatedAt: raw.updated_at || null,
    balanceAsOf: raw.balance_as_of || null,
    dateLastFetched: raw.date_last_fetched || null,
  };
}

// Posted-balance evidence uses the semantic balance date. Generic object
// updated_at is not the balance date and must not override an explicit
// trustworthy balance_as_of. Distinct timestamps stay distinct.
function postedBalanceEvidenceInstant(account) {
  if (!account || typeof account !== 'object') return null;
  return account.balanceAsOf || account.updatedAt || account.dateLastFetched || null;
}

// Live cash / mortgage / HELOC keep the prior object-update dating so
// daily-refreshed accounts are not silently retimed by a leftover
// balance_as_of. This is not statement-cadence freshness.
function genericAccountEvidenceInstant(account) {
  if (!account || typeof account !== 'object') return null;
  return account.updatedAt || account.balanceAsOf || account.dateLastFetched || null;
}

function normalizeLunchMoneyCategory(raw) {
  if (!raw || raw.id == null) return null;
  return {
    id: String(raw.id),
    name: raw.name || raw.display_name || null,
    isIncome: raw.is_income === true,
    excludeFromTotals: raw.exclude_from_totals === true,
    excludeFromBudget: raw.exclude_from_budget === true,
    isGroup: raw.is_group === true || raw.is_group_parent === true,
  };
}

function categoryIndexFromPayload(payload) {
  const byId = new Map();
  const add = raw => {
    const cat = normalizeLunchMoneyCategory(raw);
    if (!cat) return;
    byId.set(cat.id, cat);
    for (const child of raw.children || []) add(child);
  };
  for (const raw of payload && payload.categories || []) add(raw);
  return byId;
}

function tagIndexFromPayload(payload) {
  const byId = new Map();
  const add = raw => {
    if (!raw || raw.id == null) return;
    byId.set(String(raw.id), {
      id: String(raw.id),
      name: raw.name || raw.label || null,
    });
  };
  for (const raw of (payload && payload.tags) || []) add(raw);
  return byId;
}

function resolveRawTags(raw, tagsById) {
  const index = tagsById || new Map();
  const fromObjects = [];
  if (Array.isArray(raw && raw.tags)) {
    for (const item of raw.tags) {
      if (item == null) continue;
      if (typeof item === 'object') {
        const id = item.id != null ? String(item.id) : null;
        const named = id && index.get(id);
        fromObjects.push({
          id,
          name: item.name || item.label || (named && named.name) || null,
        });
        continue;
      }
      if (typeof item === 'number' || (typeof item === 'string' && /^\d+$/.test(item))) {
        const id = String(item);
        const named = index.get(id);
        fromObjects.push({ id, name: (named && named.name) || null });
        continue;
      }
      if (typeof item === 'string') fromObjects.push({ id: null, name: item });
    }
  }
  if (fromObjects.length) return fromObjects;
  const ids = (raw && (raw.tag_ids || raw.tagIds)) || [];
  if (!Array.isArray(ids) || !ids.length) return raw && raw.tags ? raw.tags : null;
  return ids.map(id => {
    const key = String(id);
    const named = index.get(key);
    return { id: key, name: (named && named.name) || null };
  });
}

function normalizeLunchMoneyTransaction(raw, categoriesById, tagsById) {
  if (!raw || raw.id == null) fail('Lunch Money transaction is missing a stable id.');
  const accountId = raw.account_id != null ? raw.account_id
    : raw.plaid_account_id != null ? raw.plaid_account_id
    : raw.manual_account_id;
  const categoryId = raw.category_id != null ? String(raw.category_id) : null;
  const fromIndex = categoryId && categoriesById ? categoriesById.get(categoryId) : null;
  const categoryName = raw.category_name || raw.categoryName
    || (fromIndex && fromIndex.name) || null;
  const isIncome = raw.is_income === true
    || (fromIndex && fromIndex.isIncome === true);
  const excludeFromTotals = raw.exclude_from_totals === true
    || (fromIndex && fromIndex.excludeFromTotals === true);
  const excludeFromBudget = raw.exclude_from_budget === true
    || (fromIndex && fromIndex.excludeFromBudget === true);
  return {
    provider: 'lunchmoney',
    providerTransactionId: String(raw.id),
    providerAccountId: accountId != null ? String(accountId) : null,
    date: raw.date || null,
    amount: raw.amount != null ? Number(raw.amount) : null,
    payee: raw.payee || null,
    originalName: raw.original_name || raw.originalName || null,
    notes: raw.notes || raw.note || null,
    tags: resolveRawTags(raw, tagsById),
    externalId: raw.external_id || raw.externalId || null,
    pendingTransactionId: raw.pending_transaction_id || raw.pendingTransactionId || null,
    plaidId: raw.plaid_id || raw.plaidId || null,
    plaidMetadata: raw.plaid_metadata || raw.plaidMetadata || null,
    isGroup: raw.is_group === true || raw.is_group_parent === true
      || raw.has_children === true,
    parentId: raw.parent_id != null ? String(raw.parent_id) : null,
    pending: raw.is_pending === true,
    status: raw.status || null,
    kind: raw.kind || null,
    mcc: raw.mcc || raw.plaid_mcc || null,
    categoryId,
    categoryLabel: categoryName,
    isIncome,
    excludeFromTotals,
    excludeFromBudget,
    contradictoryEvidence: raw.contradictoryEvidence === true,
    confirmedSettlement: raw.confirmedSettlement === true,
  };
}

function collectLunchMoneyAccounts(payload) {
  if (Array.isArray(payload.accounts) && payload.accounts.length) return payload.accounts;
  return [].concat(
    payload.plaid_accounts || [],
    payload.manual_accounts || [],
    payload.assets || []
  );
}

function normalizeLunchMoneyPayload(payload, fetchedAt) {
  if (!payload || typeof payload !== 'object') fail('Lunch Money payload is not an object.');
  const categoriesById = categoryIndexFromPayload(payload);
  const tagsById = tagIndexFromPayload(payload);
  const txWindow = payload.transactionWindow || payload.transaction_window || null;
  return {
    provider: 'lunchmoney',
    fetchedAt: payload.fetchedAt || fetchedAt,
    accounts: collectLunchMoneyAccounts(payload).map(normalizeLunchMoneyAccount),
    transactions: (payload.transactions || []).map(tx =>
      normalizeLunchMoneyTransaction(tx, categoriesById, tagsById)),
    pendingCoverage: classifyPendingCoverage(payload),
    transactionWindow: {
      startDate: (txWindow && (txWindow.startDate || txWindow.start_date)) || null,
      endDate: (txWindow && (txWindow.endDate || txWindow.end_date)) || null,
      complete: txWindow && txWindow.complete === true
        ? true
        : txWindow && (txWindow.complete === false
          || txWindow.truncated === true
          || txWindow.hasMore === true
          || txWindow.has_more === true)
          ? false
          : null,
      hasMore: txWindow && (txWindow.hasMore === true || txWindow.has_more === true)
        ? true
        : txWindow && (txWindow.hasMore === false || txWindow.has_more === false)
          ? false
          : null,
      truncated: !!(txWindow && txWindow.truncated === true),
    },
  };
}

function httpsGetJson(url, token) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(value);
    };
    const lib = requestLibFor(url);
    const req = lib.request(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode === 401 || res.statusCode === 403) {
          done(new Error('Lunch Money rejected the access token. Token value is not logged.'));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          done(new Error(`Lunch Money GET ${url.pathname} failed with HTTP ${res.statusCode}.`));
          return;
        }
        try { done(null, JSON.parse(body || '{}')); }
        catch (e) { done(new Error('Lunch Money response was not JSON.')); }
      });
    });
    if (typeof req.setTimeout === 'function') {
      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        if (typeof req.destroy === 'function') req.destroy();
        done(new Error('Lunch Money request timeout.'));
      });
    }
    req.on('error', () => {
      done(new Error('Lunch Money request failed.'));
    });
    req.end();
  });
}

async function tryGetJson(url, token) {
  try {
    return await httpsGetJson(url, token);
  } catch (err) {
    if (/HTTP 404/.test(err.message)) return null;
    throw err;
  }
}

function accountsFromLivePayloads(plaid, manuals) {
  return [].concat(
    (plaid && (plaid.plaid_accounts || plaid.accounts)) || [],
    (manuals && (manuals.manual_accounts || manuals.assets || manuals.accounts)) || []
  );
}

function lunchMoneyTransactionsUrl(now, historyDays, base) {
  const days = historyDays == null ? CURRENT_STATE_HISTORY_DAYS : Number(historyDays);
  const span = isFinite(days) && days > 0 ? Math.floor(days) : CURRENT_STATE_HISTORY_DAYS;
  const txUrl = new URL(`${base || LIVE_BASE}/transactions`);
  const end = dateOnly(now);
  if (!end) fail('Transaction history range needs a parseable fetch instant.');
  const startMs = Date.parse(now);
  const start = Number.isFinite(startMs)
    ? dateOnly(new Date(startMs - span * 86400000).toISOString())
    : Forecast.addDays(end, -span);
  if (!start) fail('Transaction history start date could not be derived.');
  txUrl.searchParams.set('start_date', start);
  txUrl.searchParams.set('end_date', end);
  txUrl.searchParams.set('include_pending', 'true');
  txUrl.startDate = start;
  txUrl.endDate = end;
  return txUrl;
}

function lunchMoneyPendingUniverseUrl(base) {
  const txUrl = new URL(`${base || LIVE_BASE}/transactions`);
  txUrl.searchParams.set('is_pending', 'true');
  return txUrl;
}

function withPage(url, offset, limit) {
  const pageUrl = new URL(url.href);
  pageUrl.searchParams.set('limit', String(limit));
  pageUrl.searchParams.set('offset', String(offset));
  return pageUrl;
}

function coverageDate(value) {
  if (value == null || value === '') return null;
  return String(value);
}

function classifyPendingCoverage(raw) {
  const declared = raw && raw.pendingCoverage;
  if (!declared || typeof declared !== 'object') {
    return {
      complete: false,
      status: 'insufficient',
      basis: null,
      hasMore: null,
      startDate: null,
      endDate: null,
      reason: 'No pending-coverage metadata. A bounded include_pending window is not proof of zero pending.',
      requiredEvidence: PENDING_COVERAGE_REQUIRED_EVIDENCE,
    };
  }
  const startDate = coverageDate(declared.startDate || declared.start_date);
  const endDate = coverageDate(declared.endDate || declared.end_date);
  const basis = declared.basis == null ? null : String(declared.basis);
  const hasMore = declared.hasMore === true || declared.has_more === true
    ? true
    : declared.hasMore === false || declared.has_more === false
      ? false
      : null;
  const truncated = declared.truncated === true;
  const dated = !!(startDate || endDate);
  if (basis !== PENDING_COVERAGE_BASIS || dated) {
    return {
      complete: false,
      status: dated ? 'bounded-window' : 'insufficient',
      basis,
      hasMore,
      startDate,
      endDate,
      reason: dated
        ? 'Pending query is date-bounded. Absence inside that window is not proof of zero pending.'
        : 'Pending coverage basis is not the unbounded is_pending query.',
      requiredEvidence: PENDING_COVERAGE_REQUIRED_EVIDENCE,
    };
  }
  if (truncated || hasMore !== false || declared.complete !== true) {
    return {
      complete: false,
      status: 'insufficient',
      basis,
      hasMore,
      startDate,
      endDate,
      reason: truncated
        ? 'Pending query was truncated before has_more=false.'
        : 'Pending query did not complete with has_more=false.',
      requiredEvidence: PENDING_COVERAGE_REQUIRED_EVIDENCE,
    };
  }
  return {
    complete: true,
    status: 'complete',
    basis,
    hasMore: false,
    startDate: null,
    endDate: null,
    reason: 'Completed is_pending=true query with no date bound.',
    requiredEvidence: null,
  };
}

function mergeTransactionsById(primary, extra) {
  const out = [];
  const seen = new Set();
  for (const tx of [].concat(primary || [], extra || [])) {
    if (!tx || tx.id == null) {
      out.push(tx);
      continue;
    }
    const id = String(tx.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(tx);
  }
  return out;
}

async function fetchLunchMoneyTransactionsPaged(url, token, opts) {
  const limit = (opts && opts.limit) || PENDING_QUERY_PAGE_LIMIT;
  const maxPages = (opts && opts.maxPages) || PENDING_QUERY_MAX_PAGES;
  const all = [];
  let offset = 0;
  let hasMore = null;
  let pages = 0;
  let truncated = false;
  while (pages < maxPages) {
    const payload = await httpsGetJson(withPage(url, offset, limit), token);
    const txs = (payload && payload.transactions) || [];
    all.push(...txs);
    pages += 1;
    if (payload && payload.has_more === true) {
      hasMore = true;
      if (txs.length === 0) {
        truncated = true;
        break;
      }
      offset += limit;
      continue;
    }
    if (payload && payload.has_more === false) {
      hasMore = false;
      break;
    }
    hasMore = null;
    truncated = true;
    break;
  }
  if (hasMore === true && pages >= maxPages) truncated = true;
  return {
    transactions: all,
    hasMore,
    complete: hasMore === false && truncated !== true,
    truncated,
    pages,
  };
}

async function resolveLiveToken(options) {
  const resolved = await Credentials.resolveLunchMoneyAccessToken(options);
  return resolved.token;
}

async function resolveLiveCredential(options) {
  return Credentials.resolveLunchMoneyAccessToken(options);
}

async function fetchLunchMoneyLive(token, now, historyDays, options) {
  if (!token) fail('Live observation has no Lunch Money credential.');
  const env = options && options.env ? options.env : process.env;
  const base = lunchMoneyApiBase(env);
  const txUrl = lunchMoneyTransactionsUrl(now, historyDays, base);
  await httpsGetJson(new URL(`${base}/me`), token);
  const plaid = await tryGetJson(new URL(`${base}/plaid_accounts`), token);
  let manuals = await tryGetJson(new URL(`${base}/manual_accounts`), token);
  if (!manuals) manuals = await tryGetJson(new URL(`${base}/assets`), token);
  const categoriesPayload = await tryGetJson(new URL(`${base}/categories`), token);
  const tagsPayload = await tryGetJson(new URL(`${base}/tags`), token);
  const txPage = await fetchLunchMoneyTransactionsPaged(txUrl, token);
  const pendingPage = await fetchLunchMoneyTransactionsPaged(
    lunchMoneyPendingUniverseUrl(base),
    token
  );
  return {
    provider: 'lunchmoney',
    fetchedAt: now,
    accounts: accountsFromLivePayloads(plaid, manuals),
    categories: (categoriesPayload && (categoriesPayload.categories || categoriesPayload)) || [],
    tags: (tagsPayload && (tagsPayload.tags || tagsPayload)) || [],
    transactions: mergeTransactionsById(
      txPage.transactions,
      pendingPage.transactions
    ),
    transactionWindow: {
      startDate: txUrl.startDate,
      endDate: txUrl.endDate,
      complete: txPage.complete === true,
      hasMore: txPage.hasMore,
      truncated: txPage.truncated === true,
    },
    pendingCoverage: {
      complete: pendingPage.complete === true,
      basis: PENDING_COVERAGE_BASIS,
      hasMore: pendingPage.hasMore,
      startDate: null,
      endDate: null,
      truncated: pendingPage.truncated === true,
    },
  };
}

function round2(v) {
  return Math.round(Number(v) * 100) / 100;
}

function parseIsoDate(value) {
  const d = dateOnly(value);
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return d;
}

function calendarDaysBetween(from, to) {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (!a || !b) return null;
  const ms = Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z');
  if (!isFinite(ms)) return null;
  return Math.round(ms / 86400000);
}

// Lunch Money v2: positive amount = debit, negative amount = credit.
// That sign is fixed and does not follow the user's display preference.
function lunchMoneyDebitAmount(amount) {
  if (amount == null || amount === '' || !isFinite(Number(amount))) return null;
  return Number(amount);
}

function billPaymentPayees(plan, extra) {
  const labels = [];
  const push = value => {
    if (value == null || value === '') return;
    const s = String(value);
    if (!labels.some(x => x.toLowerCase() === s.toLowerCase())) labels.push(s);
  };
  for (const row of [].concat(
    extra || [],
    (plan && plan.bills) || [],
    (plan && plan.obligations) || [],
    (plan && plan.commitments) || []
  )) {
    if (typeof row === 'string') push(row);
    else if (row && row.label) push(row.label);
  }
  return labels;
}

function isBillOrPaymentTransaction(tx, plan, extraPayees) {
  if (!tx) return false;
  if (tx.kind === 'bill-payment' || tx.kind === 'payment') return true;
  const payee = tx.payee ? String(tx.payee).toLowerCase() : '';
  if (!payee) return false;
  if (/\b(bill payment|bill pay)\b/.test(payee)) return true;
  return billPaymentPayees(plan, extraPayees).some((label) => {
    const l = String(label).toLowerCase();
    return payee.includes(l) || l.includes(payee);
  });
}

function pendingForecastTreatment(tx, asOf, opts) {
  const historicalStatus = tx && tx.pending ? 'pending' : 'posted';
  if (!tx || !tx.pending) {
    return {
      treatment: 'confirmed-settled',
      historicalStatus,
      confidence: 'confirmed',
      conflict: false,
    };
  }
  if (tx.contradictoryEvidence === true || (opts && opts.contradictoryEvidence === true)) {
    return {
      treatment: 'unresolved',
      historicalStatus: 'pending',
      confidence: 'unresolved',
      conflict: true,
    };
  }
  if (tx.confirmedSettlement === true || (opts && opts.confirmedSettlement === true)) {
    return {
      treatment: 'confirmed-settled',
      historicalStatus: 'pending',
      confidence: 'confirmed',
      conflict: false,
    };
  }
  const age = calendarDaysBetween(tx.date, asOf);
  const billOrPayment = isBillOrPaymentTransaction(
    tx,
    opts && opts.plan,
    opts && opts.billPaymentPayees
  );
  if (billOrPayment && age != null && age > BILL_PAYMENT_PENDING_DAYS) {
    return {
      treatment: 'presumed-settled-for-current-forecast',
      historicalStatus: 'pending',
      confidence: 'inferred',
      conflict: false,
      ageDays: age,
    };
  }
  return {
    treatment: 'unresolved',
    historicalStatus: 'pending',
    confidence: 'unresolved',
    conflict: false,
    ageDays: age,
  };
}

function collapseByProviderTransactionId(transactions) {
  const byId = new Map();
  for (const tx of transactions || []) {
    const id = tx && tx.providerTransactionId;
    if (!id) continue;
    const list = byId.get(id) || [];
    list.push(tx);
    byId.set(id, list);
  }
  const collapsed = [];
  const identityEvidence = [];
  for (const [id, list] of byId) {
    const posted = list.filter(t => t.pending !== true);
    const pending = list.filter(t => t.pending === true);
    if (posted.length && pending.length) {
      const winner = posted[0];
      collapsed.push(Object.assign({}, winner, {
        pending: false,
        priorPending: true,
        identity: id,
      }));
      identityEvidence.push({
        providerTransactionId: id,
        transition: 'pending-to-posted',
        pendingCount: pending.length,
        postedCount: posted.length,
        ghostPending: false,
        doubleCounted: false,
      });
    } else {
      collapsed.push(...list);
    }
  }
  return { transactions: collapsed, identityEvidence };
}

function pendingComponentsForCard(transactions, mapping, asOf, opts) {
  const accountId = mapping && mapping.providerAccountId != null
    ? String(mapping.providerAccountId) : null;
  if (!accountId || !CREDIT_ROLES.has(mapping.atlasRole)) return [];
  const components = [];
  for (const tx of transactions || []) {
    if (String(tx.providerAccountId) !== accountId) continue;
    if (tx.pending !== true) continue;
    const amount = lunchMoneyDebitAmount(tx.amount);
    if (amount == null) continue;
    const treatment = pendingForecastTreatment(tx, asOf, opts);
    components.push({
      providerTransactionId: tx.providerTransactionId,
      date: tx.date,
      payee: tx.payee,
      amount,
      sign: amount >= 0 ? 'debit' : 'credit',
      pending: true,
      settlementTreatment: treatment.treatment,
      historicalStatus: treatment.historicalStatus,
      confidence: treatment.confidence,
      conflict: treatment.conflict === true,
      contributesToCurrentPending: treatment.treatment === 'unresolved' && treatment.conflict !== true,
    });
  }
  return components;
}

function netCurrentPending(components) {
  let sum = 0;
  let unresolved = 0;
  for (const c of components || []) {
    if (!c.contributesToCurrentPending) continue;
    unresolved += 1;
    sum += Number(c.amount);
  }
  return { amount: round2(sum), unresolved };
}

function inferredCardState(posted, pending, limit) {
  const postedN = posted == null || !isFinite(Number(posted)) ? null : Number(posted);
  const pendingN = pending == null || !isFinite(Number(pending)) ? null : Number(pending);
  const limitN = limit == null || !isFinite(Number(limit)) ? null : Number(limit);
  if (postedN == null || pendingN == null) {
    return {
      posted: postedN,
      pending: pendingN,
      exposure: null,
      limit: limitN,
      overLimit: null,
      kind: 'inference-from-posted-plus-pending',
      householdCash: 0,
      unknown: true,
    };
  }
  const exposure = round2(postedN + pendingN);
  const overLimit = limitN == null ? null : round2(Math.max(0, exposure - limitN));
  return {
    posted: postedN,
    pending: pendingN,
    exposure,
    limit: limitN,
    overLimit,
    kind: 'inference-from-posted-plus-pending',
    householdCash: 0,
    unknown: false,
  };
}

function pendingObservationsFromTransactions(input) {
  const mapDoc = input.accountMap;
  const asOf = dateOnly(input.asOf || input.fetchedAt);
  const opts = {
    plan: input.plan,
    billPaymentPayees: input.billPaymentPayees,
  };
  const coverage = input.pendingCoverage
    || classifyPendingCoverage(input.payload || input);
  const out = [];
  for (const mapping of (mapDoc && mapDoc.mappings) || []) {
    if (!CREDIT_ROLES.has(mapping.atlasRole) || !mapping.canonical || !mapping.canonical.id) {
      continue;
    }
    const components = pendingComponentsForCard(
      input.transactions, mapping, asOf, opts
    );
    if (!components.length) {
      if (!coverage.complete) continue;
      out.push({
        observationId: `lm-${mapping.providerAccountId}-pending`,
        fact: 'pending',
        cardId: mapping.canonical.id,
        provider: 'lunchmoney',
        providerAccountId: String(mapping.providerAccountId),
        accountLabel: mapping.canonical.id,
        evidenceValue: 0,
        observedAsOf: asOf,
        evidenceDate: asOf,
        unknown: false,
        balanceIncludesPending: false,
        pendingCoverage: coverage.status,
        pendingProof: coverage.basis,
        canonical: { collection: 'debts', id: mapping.canonical.id, field: 'pending' },
        source: 'provider-observe:lunchmoney-transactions',
        note: 'Proven zero pending from a completed is_pending=true query with no date bound. Absence inside a bounded include_pending window is not this proof. Posted balance is a separate fact. Not household cash.',
        components: [],
      });
      continue;
    }
    const net = netCurrentPending(components);
    const allSettledForForecast = net.unresolved === 0 && components.every(c =>
      c.settlementTreatment === 'presumed-settled-for-current-forecast'
      || c.settlementTreatment === 'confirmed-settled');
    const unknown = !allSettledForForecast && components.length > 0
      && components.every(c => c.conflict);
    out.push({
      observationId: `lm-${mapping.providerAccountId}-pending`,
      fact: 'pending',
      cardId: mapping.canonical.id,
      provider: 'lunchmoney',
      providerAccountId: String(mapping.providerAccountId),
      accountLabel: mapping.canonical.id,
      evidenceValue: unknown ? null : net.amount,
      observedAsOf: asOf,
      evidenceDate: asOf,
      unknown: !!unknown,
      balanceIncludesPending: false,
      pendingCoverage: coverage.status,
      pendingProof: coverage.complete ? coverage.basis : null,
      canonical: { collection: 'debts', id: mapping.canonical.id, field: 'pending' },
      source: 'provider-observe:lunchmoney-transactions',
      note: allSettledForForecast
        ? 'Aged pending bill/payment excluded from current pending; historical status remains pending.'
        : 'Pending exposure from mapped provider transactions. Posted balance is a separate fact. Not household cash.',
      components,
    });
  }
  return out;
}

function payeeMatches(payee, pattern) {
  if (!payee || !pattern) return false;
  return String(payee).toLowerCase().includes(String(pattern).toLowerCase());
}

const WEEKEND_NEXT_BUSINESS_DAY = 'same-day-or-weekend-next-business-day';
const COVER_DUE_ON_OR_BEFORE_POSTING = 'covers-due-on-or-before-posting';
const SETTLES_WHEN_AMOUNT_AT_LEAST = 'amount-at-least';
const SETTLES_WHEN_EXACT_SCHEDULED_AMOUNT = 'exact-scheduled-amount';
const COVER_DUE_LOOKBACK_DAYS = 62;
const IDENTITY_AMOUNT_EPSILON = 0.005;

function rulePayeePatterns(rule) {
  const values = [].concat((rule && rule.payeePatterns) || [],
    rule && rule.payeePattern ? [rule.payeePattern] : []);
  return Array.from(new Set(values.map(value => String(value).trim()).filter(Boolean)));
}

function rulePayeeExcludePatterns(rule) {
  const values = [].concat((rule && rule.payeeExcludePatterns) || [],
    rule && rule.payeeExcludePattern ? [rule.payeeExcludePattern] : []);
  return Array.from(new Set(values.map(value => String(value).trim()).filter(Boolean)));
}

function payeeMatchesRule(tx, rule) {
  if (!tx || !rule) return false;
  if (!rulePayeePatterns(rule).some(pattern => payeeMatches(tx.payee, pattern))) return false;
  if (rulePayeeExcludePatterns(rule).some(pattern => payeeMatches(tx.payee, pattern))) {
    return false;
  }
  return true;
}

function transactionIsTransfer(tx) {
  if (!tx || tx.isIncome === true) return false;
  const kind = String(tx.kind || '').toLowerCase();
  if (kind === 'transfer' || kind === 'internal-transfer') return true;
  if (tx.excludeFromTotals === true) return true;
  return /transfer/i.test(String(tx.categoryLabel || ''));
}

function ruleCounterpartExternalId(rule) {
  const value = rule && rule.counterpartExternalId;
  return value != null && String(value).trim() !== '' ? String(value).trim() : '';
}

function mappingExternalId(mapping) {
  const value = mapping && mapping.externalId;
  return value != null && String(value).trim() !== '' ? String(value).trim() : '';
}

function amountsMatchExactly(left, right) {
  return isFinite(left) && isFinite(right)
    && Math.abs(Math.abs(Number(left)) - Math.abs(Number(right))) <= IDENTITY_AMOUNT_EPSILON;
}

function transferCounterpartMatches(tx, rule, input, amount) {
  const counterpartId = ruleCounterpartExternalId(rule);
  if (!tx || !counterpartId) return [];
  const mapDoc = input && input.accountMap;
  const matches = [];
  for (const other of (input && input.transactions) || []) {
    if (!other || other === tx) continue;
    if (other.pending === true || other.contradictoryEvidence === true) continue;
    if (String(other.date || '') !== String(tx.date || '')) continue;
    if (!transactionIsTransfer(other)) continue;
    const mapping = mappingFor(mapDoc, other.providerAccountId);
    if (!mapping || mapping.atlasRole !== EXTERNAL_LIVE_ROLE) continue;
    if (mappingExternalId(mapping) !== counterpartId) continue;
    const otherAmount = lunchMoneyDebitAmount(other.amount);
    if (!(otherAmount > 0) || !amountsMatchExactly(otherAmount, amount)) continue;
    matches.push(other);
  }
  return matches;
}

function uniqueTransferCounterpart(tx, rule, input, amount) {
  const matches = transferCounterpartMatches(tx, rule, input, amount);
  return matches.length === 1 ? matches[0] : null;
}

function countTransferCounterparts(tx, rule, input, amount) {
  return transferCounterpartMatches(tx, rule, input, amount).length;
}

function ruleHasIdentity(rule) {
  if (!rule || !rule.eventId) return false;
  if (rule.transactionKind === 'transfer') return !!ruleCounterpartExternalId(rule);
  return rulePayeePatterns(rule).length > 0;
}

function ruleMatchesTransactionIdentity(tx, rule) {
  if (!tx || !rule) return false;
  if (rulePayeeExcludePatterns(rule).some(pattern => payeeMatches(tx.payee, pattern))) {
    return false;
  }
  if (rule.transactionKind === 'transfer') {
    if (!transactionIsTransfer(tx)) return false;
    if (!ruleCounterpartExternalId(rule)) return false;
    if (!rulePayeePatterns(rule).length) return true;
  }
  return payeeMatchesRule(tx, rule);
}

function ruleIdentityLabel(rule) {
  if (rule && rule.transactionKind === 'transfer') {
    return ruleCounterpartExternalId(rule)
      ? 'transfer+counterpart+account+date'
      : 'transfer+account+date';
  }
  return 'payee+account+date';
}

function postingDateRelation(scheduledDate, postingDate, rule) {
  const scheduled = parseIsoDate(scheduledDate);
  const posted = parseIsoDate(postingDate);
  if (!scheduled || !posted) return null;
  if (scheduled === posted) return 'same-day';
  if (rule && rule.postingDateRule === COVER_DUE_ON_OR_BEFORE_POSTING
    && scheduled < posted) {
    return COVER_DUE_ON_OR_BEFORE_POSTING;
  }
  if (!rule || rule.postingDateRule !== WEEKEND_NEXT_BUSINESS_DAY) return null;
  const weekday = new Date(`${scheduled}T00:00:00Z`).getUTCDay();
  const nextBusinessDay = weekday === 6
    ? Forecast.addDays(scheduled, 2)
    : weekday === 0 ? Forecast.addDays(scheduled, 1) : null;
  return nextBusinessDay === posted ? 'weekend-next-business-day' : null;
}

function coveringScheduledDates(plan, rule, postingDate) {
  const posted = parseIsoDate(postingDate);
  if (!plan || !rule || !rule.eventId || !posted) return [];
  if (rule.postingDateRule !== COVER_DUE_ON_OR_BEFORE_POSTING) {
    return scheduledDatesForPosting(posted, rule);
  }
  const from = Forecast.addDays(posted, -COVER_DUE_LOOKBACK_DAYS);
  if (!from) return [];
  const events = scheduledEventsOnRange(plan, from, posted)
    .filter(e => e && e.id === rule.eventId && e.date <= posted);
  if (!events.length) return [];
  events.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const latest = events[0].date;
  if (events.filter(e => e.date === latest).length !== 1) return [];
  return [latest];
}

function scheduledDatesForPosting(postingDate, rule) {
  const posted = parseIsoDate(postingDate);
  if (!posted) return [];
  const dates = [posted];
  if (rule && rule.postingDateRule === WEEKEND_NEXT_BUSINESS_DAY) {
    dates.push(Forecast.addDays(posted, -1), Forecast.addDays(posted, -2));
  }
  return dates.filter((date, index) => date && dates.indexOf(date) === index
    && postingDateRelation(date, posted, rule));
}

function schedulePlan(plan) {
  return {
    income: (plan && plan.income) || [],
    obligations: (plan && plan.obligations) || [],
    bills: (plan && plan.bills) || [],
    commitments: (plan && plan.commitments) || [],
    startingCash: plan && plan.startingCash,
  };
}

function scheduledEventsOn(plan, date) {
  if (!plan || !date) return [];
  return Forecast.expandEvents(schedulePlan(plan), date, date, {})
    .filter(e => e && e.kind !== 'noncash');
}

function scheduledEventsOnRange(plan, from, to) {
  if (!plan || !from || !to || to < from) return [];
  return Forecast.expandEvents(schedulePlan(plan), from, to, {})
    .filter(e => e && e.kind !== 'noncash' && e.date >= from && e.date <= to);
}

function openingAsOfFromData(data) {
  const opening = data && data.plan && data.plan.opening;
  return opening && opening.asOf ? String(opening.asOf) : null;
}

function classifyRepresentedCandidate(candidate, asOf) {
  const date = candidate && candidate.date ? String(candidate.date) : null;
  const current = !!(asOf && date && date === asOf);
  let openingRelevance = 'incomparable';
  if (asOf && date) {
    if (date === asOf) openingRelevance = 'current-opening';
    else if (date < asOf) openingRelevance = 'historical-before-opening';
    else openingRelevance = 'after-opening';
  }
  return Object.assign({}, candidate, {
    currentOpeningImpact: current,
    mustNotBackfillOpening: !current,
    openingRelevance,
  });
}

function postingObservationFromCandidate(candidate, fetchedAt) {
  return {
    observationId: `lm-${candidate.providerTransactionId}-posting`,
    fact: 'posting',
    eventId: candidate.id,
    accountLabel: candidate.payee,
    scheduledDate: candidate.date,
    posted: true,
    unknown: false,
    observedAsOf: dateOnly(fetchedAt),
    evidenceDate: dateOnly(fetchedAt),
    canonical: { collection: 'representedEvents', id: candidate.id, date: candidate.date },
    source: 'provider-observe:lunchmoney-transactions',
    note: candidate && candidate.identity === 'transfer+counterpart+account+date'
      ? 'Identity is a uniquely proven transfer credit into the mapped BILLS account paired to the TENNIS INCOME salary-flow counterpart + direction + allowed scheduled/posting-date relation. Amount is a necessary guard, not identity. Historical candidates are not current-opening posting comparisons.'
      : candidate && candidate.identity === 'transfer+account+date'
      ? 'Identity is a uniquely proven transfer credit into the mapped BILLS account + direction + allowed scheduled/posting-date relation. Amount is a necessary guard, not identity. Historical candidates are not current-opening posting comparisons.'
      : 'Identity is explicit payee alias + mapped account + direction + allowed scheduled/posting-date relation. Amount similarity was not used. Historical candidates are not current-opening posting comparisons.',
    currentOpeningImpact: candidate.currentOpeningImpact === true,
    mustNotBackfillOpening: candidate.mustNotBackfillOpening !== false,
    openingRelevance: candidate.openingRelevance || 'incomparable',
  };
}

function sameDayDiscrepancies(recon) {
  return ((recon && recon.rows) || [])
    .filter(r => r && r.status === 'CHANGE' && r.dateRelation === 'same-day')
    .map(r => ({
      canonicalTarget: r.canonicalTarget || null,
      fact: r.fact || null,
      evidenceValue: r.evidenceValue,
      canonicalValue: r.canonicalValue,
      evidenceDate: r.evidenceDate || r.observedAsOf || null,
      dateRelation: 'same-day',
      winnerChosen: false,
      reason: 'same-day without adequate time evidence — no canonical winner',
    }))
    .sort((a, b) => String(a.canonicalTarget).localeCompare(String(b.canonicalTarget)));
}

function observationIdentityKey(obs) {
  if (obs && obs.canonical && obs.canonical.collection) {
    const c = obs.canonical;
    return [c.collection, c.id, obs.fact || c.field || '', c.date || '']
      .filter(part => part !== '')
      .join(':');
  }
  return obs && obs.fact ? String(obs.fact) : 'unknown';
}

function identityFingerprint(report) {
  const mapped = (report.mapped || [])
    .map(m => ({
      atlasId: m.atlasId,
      collection: m.collection,
      atlasRole: m.atlasRole,
    }))
    .sort((a, b) => String(a.atlasId).localeCompare(String(b.atlasId)));
  const observations = (report.observations || [])
    .map(o => ({
      key: observationIdentityKey(o),
      fact: o.fact || null,
      evidenceValue: o.evidenceValue,
      unknown: o.unknown === true,
      evidenceDate: o.evidenceDate || o.observedAsOf || null,
    }))
    .sort((a, b) => String(a.key).localeCompare(String(b.key))
      || String(a.fact).localeCompare(String(b.fact)));
  const reconciliation = ((report.reconciliation && report.reconciliation.rows) || [])
    .map(r => ({
      target: r.canonicalTarget || null,
      fact: r.fact || null,
      status: r.status,
      dateRelation: r.dateRelation || null,
      evidenceValue: r.evidenceValue,
      canonicalValue: r.canonicalValue,
    }))
    .sort((a, b) => String(a.target).localeCompare(String(b.target))
      || String(a.fact).localeCompare(String(b.fact)));
  const classified = report.representedEventCandidates || [];
  const historical = classified
    .filter(c => !c.currentOpeningImpact)
    .map(c => ({
      eventId: c.id,
      date: c.date,
      openingRelevance: c.openingRelevance,
      mustNotBackfillOpening: c.mustNotBackfillOpening !== false,
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date))
      || String(a.eventId).localeCompare(String(b.eventId)));
  const currentOpening = classified
    .filter(c => c.currentOpeningImpact)
    .map(c => ({
      eventId: c.id,
      date: c.date,
      openingRelevance: c.openingRelevance,
      mustNotBackfillOpening: false,
    }))
    .sort((a, b) => String(a.eventId).localeCompare(String(b.eventId)));
  return {
    writesCanonicalState: report.writesCanonicalState === true,
    canonicalWriteAuthorized: false,
    mappingBy: 'provider-account-id',
    displayNameIsLabelOnly: true,
    endpointOriginPreserved: false,
    cardCapacityIsCash: report.cardCapacityIsCash,
    spendableCash: report.spendableCash,
    fetchedAt: report.fetchedAt || null,
    mapped,
    unmappedCount: (report.unmapped || []).length,
    observations,
    reconciliation,
    historicalRepresentedEventCandidates: historical,
    currentOpeningRepresentedEventCandidates: currentOpening,
    pendingToPostedTransitions: (report.identityEvidence || [])
      .filter(e => e && e.transition === 'pending-to-posted').length,
    sameDayDiscrepancies: report.sameDayDiscrepancies
      || sameDayDiscrepancies(report.reconciliation),
  };
}

function identityProofLooksSanitized(proof) {
  const blob = JSON.stringify(proof == null ? {} : proof);
  return !/"providerAccountId"\s*:/.test(blob)
    && !/"providerTransactionId"\s*:/.test(blob)
    && !/Bearer\s+\S+/.test(blob)
    && !/LUNCHMONEY_ACCESS_TOKEN/.test(blob);
}

function compareIdentityFingerprints(a, b) {
  const left = JSON.stringify(a);
  const right = JSON.stringify(b);
  const keyShape = proof => ({
    mapped: proof && proof.mapped,
    unmappedCount: proof && proof.unmappedCount,
    observationKeys: ((proof && proof.observations) || []).map(o => o.key),
    historical: proof && proof.historicalRepresentedEventCandidates,
    currentOpening: proof && proof.currentOpeningRepresentedEventCandidates,
  });
  return {
    equal: left === right,
    keysEqual: JSON.stringify(keyShape(a)) === JSON.stringify(keyShape(b)),
  };
}

function postedWindowIsComplete(window) {
  if (!window || typeof window !== 'object') return false;
  return window.complete === true
    && window.truncated !== true
    && window.hasMore !== true;
}

function pendingCoverageIsComplete(coverage) {
  return !!(coverage
    && coverage.complete === true
    && coverage.status === 'complete'
    && coverage.basis === PENDING_COVERAGE_BASIS);
}

function expectedHouseholdIdentities(mapDoc) {
  const ids = [];
  const seen = new Set();
  for (const mapping of (mapDoc && mapDoc.mappings) || []) {
    if (!mapping || mapping.atlasRole === EXTERNAL_LIVE_ROLE) continue;
    const id = mapping.canonical && mapping.canonical.id;
    if (!id) continue;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(key);
  }
  ids.sort();
  return ids;
}

function mappedHouseholdIdentities(mapped) {
  const ids = [];
  const seen = new Set();
  for (const row of mapped || []) {
    if (!row || !row.atlasId || row.atlasRole === EXTERNAL_LIVE_ROLE) continue;
    const key = String(row.atlasId);
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(key);
  }
  ids.sort();
  return ids;
}

function requiredCashObserved(identities) {
  const have = new Set(identities || []);
  return REQUIRED_LIVE_CASH_IDS.filter(id => have.has(id));
}

function requiredCashMissingFrom(identities) {
  const have = new Set(identities || []);
  return REQUIRED_LIVE_CASH_IDS.filter(id => !have.has(id));
}

function datedRequiredCash(observations) {
  const dated = [];
  for (const id of REQUIRED_LIVE_CASH_IDS) {
    const obs = (observations || []).find(o =>
      o
      && o.canonical
      && o.canonical.collection === 'cash'
      && String(o.canonical.id) === id
      && (o.evidenceDate || o.observedAsOf)
      && o.evidenceValue != null
      && isFinite(Number(o.evidenceValue)));
    if (obs) dated.push(id);
  }
  return dated;
}

function observationReceiptLooksSanitized(receipt) {
  const blob = JSON.stringify(receipt == null ? {} : receipt);
  return identityProofLooksSanitized(receipt)
    && !/"payee"\s*:/.test(blob)
    && !/"original_name"\s*:/.test(blob)
    && !/"observationId"\s*:/.test(blob)
    && !/"status"\s*:\s*"(MATCH|CHANGE|CONFLICT|MISSING|STALE)"/.test(blob)
    && !/"evidenceValue"\s*:/.test(blob)
    && !/"reconciliation"\s*:/.test(blob)
    && !/"recommend"\s*:/.test(blob)
    && !/"safeToSpend"\s*:/.test(blob);
}

function observationFingerprintFromParts(parts) {
  return {
    schema: RECEIPT_SCHEMA,
    provider: 'lunchmoney',
    observedAt: parts.observedAt || null,
    householdDate: parts.householdDate || null,
    writesCanonicalState: parts.writesCanonicalState === true,
    canonicalStateChanged: false,
    mappedHouseholdIdentities: parts.mappedHouseholdIdentities || [],
    unmappedCount: Number(parts.unmappedCount) || 0,
    missingExpectedIdentities: parts.missingExpectedIdentities || [],
    requiredCashMissing: parts.requiredCashMissing || [],
    requiredCashBalanceMissing: parts.requiredCashBalanceMissing || [],
    postedComplete: parts.postedComplete === true,
    pendingComplete: parts.pendingComplete === true,
    pendingToPostedTransitions: Number(parts.pendingToPostedTransitions) || 0,
    readyForReconciliation: parts.readyForReconciliation === true,
  };
}

function observationFingerprintDigest(fingerprint) {
  return crypto.createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex');
}

function observationReceipt(report, opts) {
  opts = opts || {};
  const fetchedAt = (report && report.fetchedAt) || null;
  const householdDate = dateOnly(fetchedAt);
  const pending = (report && report.pendingCoverage) || classifyPendingCoverage({});
  const window = (report && report.transactionWindow) || {};
  const mappedIds = mappedHouseholdIdentities(report && report.mapped);
  const expected = expectedHouseholdIdentities(opts.accountMap);
  const missingExpected = expected.filter(id => mappedIds.indexOf(id) === -1);
  const unmappedCount = ((report && report.unmapped) || []).length;
  const cashMissing = requiredCashMissingFrom(mappedIds);
  const cashDated = datedRequiredCash(report && report.observations);
  const cashDatedMissing = REQUIRED_LIVE_CASH_IDS.filter(id => cashDated.indexOf(id) === -1);
  const cashBalanceMissing = cashDatedMissing.filter(id => cashMissing.indexOf(id) === -1);
  const postedComplete = postedWindowIsComplete(window);
  const pendingComplete = pendingCoverageIsComplete(pending);
  const pendingToPosted = ((report && report.identityEvidence) || [])
    .filter(e => e && e.transition === 'pending-to-posted').length;
  const writeClaimed = !!(report && report.writesCanonicalState === true);
  const failClosedReasons = [];
  if (!postedComplete) {
    failClosedReasons.push(window.truncated === true
      ? 'posted-window-truncated'
      : 'posted-window-unproven');
  }
  if (!pendingComplete) {
    failClosedReasons.push(pending.status === 'bounded-window'
      ? 'pending-coverage-bounded-window'
      : 'pending-coverage-unproven');
  }
  if (cashMissing.length) failClosedReasons.push('required-cash-unobserved');
  if (cashBalanceMissing.length) failClosedReasons.push('required-cash-balance-unproven');
  if (missingExpected.length) failClosedReasons.push('expected-mapped-identity-missing');
  if (writeClaimed) failClosedReasons.push('canonical-write-claimed');
  const ready = failClosedReasons.length === 0;
  const fingerprint = observationFingerprintFromParts({
    observedAt: fetchedAt,
    householdDate,
    writesCanonicalState: writeClaimed,
    mappedHouseholdIdentities: mappedIds,
    unmappedCount,
    missingExpectedIdentities: missingExpected,
    requiredCashMissing: cashMissing,
    requiredCashBalanceMissing: cashBalanceMissing,
    postedComplete,
    pendingComplete,
    pendingToPostedTransitions: pendingToPosted,
    readyForReconciliation: ready,
  });
  return {
    schema: RECEIPT_SCHEMA,
    provider: 'lunchmoney',
    observedAt: fetchedAt,
    householdDate,
    writesCanonicalState: writeClaimed,
    canonicalStateChanged: false,
    accountCoverage: {
      status: (cashMissing.length || missingExpected.length) ? 'incomplete' : 'required-cash-observed',
      mappedHouseholdIdentities: mappedIds,
      unmappedCount,
      expectedMappedCount: expected.length,
      missingExpectedIdentities: missingExpected,
      requiredCashObserved: requiredCashObserved(mappedIds),
      requiredCashMissing: cashMissing,
    },
    balanceCoverage: {
      status: cashDatedMissing.length ? 'incomplete' : 'required-cash-dated',
      requiredCashWithDatedBalance: cashDated,
      requiredCashMissingDatedBalance: cashDatedMissing,
      freshnessVerdict: 'not-claimed',
      freshnessNote: 'Dated balance evidence is not a current/freshness verdict. MATCH is not freshness.',
    },
    postedTransactionCoverage: {
      complete: postedComplete,
      truncated: window.truncated === true,
      hasMore: window.hasMore === true,
      status: postedComplete ? 'complete' : (window.truncated === true ? 'truncated' : 'unproven'),
    },
    pendingTransactionCoverage: {
      complete: pendingComplete,
      status: pending.status || 'insufficient',
      reason: pendingComplete
        ? null
        : (pending.reason || 'Pending coverage is not the completed unbounded is_pending query.'),
    },
    identity: {
      mappingBy: 'provider-account-id',
      displayNameIsLabelOnly: true,
      pendingToPostedTransitions: pendingToPosted,
      vsPriorObservation: 'not-claimed',
      vsPriorObservationNote: 'No authorized previous-observation store. Intra-payload pending-to-posted and account-map coverage are the incumbent identity evidence.',
    },
    readyForReconciliation: ready,
    failClosedReasons,
    fingerprint,
    fingerprintDigest: observationFingerprintDigest(fingerprint),
  };
}

function representedEventHitGroups(input) {
  const empty = { unique: [], ambiguous: [] };
  if (input.transactionWindow && input.transactionWindow.complete === false) return empty;
  const rules = (input.identityRules || []).filter(ruleHasIdentity);
  if (!rules.length) return empty;
  const mapDoc = input.accountMap;
  const eventHits = new Map();
  const counterpartAmbiguous = new Map();
  for (const tx of input.transactions || []) {
    if (tx.pending === true || tx.contradictoryEvidence === true) continue;
    const mapping = mappingFor(mapDoc, tx.providerAccountId);
    if (!mapping || !mapping.canonical || !mapping.canonical.id) continue;
    const amount = lunchMoneyDebitAmount(tx.amount);
    for (const rule of rules) {
      if (rule.atlasAccountId && mapping.canonical.id !== rule.atlasAccountId) continue;
      if (!ruleMatchesTransactionIdentity(tx, rule)) continue;
      if (rule.direction === 'credit' && !(amount < 0)) continue;
      if (rule.direction === 'debit' && !(amount > 0)) continue;
      for (const scheduledDate of coveringScheduledDates(input.plan, rule, tx.date)) {
        const scheduled = scheduledEventsOn(input.plan, scheduledDate)
          .filter(e => e.id === rule.eventId && e.date === scheduledDate);
        if (scheduled.length !== 1) continue;
        const relation = postingDateRelation(scheduledDate, tx.date, rule);
        if (!relation) continue;
        if (rule.settlesWhen === SETTLES_WHEN_AMOUNT_AT_LEAST) {
          const need = Math.abs(Number(scheduled[0].amount));
          if (!(Math.abs(amount) + IDENTITY_AMOUNT_EPSILON >= need)) continue;
        }
        if (rule.settlesWhen === SETTLES_WHEN_EXACT_SCHEDULED_AMOUNT) {
          const need = Math.abs(Number(scheduled[0].amount));
          if (!(isFinite(need) && isFinite(amount)
            && Math.abs(Math.abs(amount) - need) <= IDENTITY_AMOUNT_EPSILON)) {
            continue;
          }
        }
        if (rule.transactionKind === 'transfer') {
          const counterpartCount = countTransferCounterparts(tx, rule, input, amount);
          if (counterpartCount !== 1) {
            if (counterpartCount > 1) {
              const ambKey = rule.eventId + '@' + scheduledDate;
              const prior = counterpartAmbiguous.get(ambKey);
              counterpartAmbiguous.set(ambKey, {
                id: rule.eventId,
                date: scheduledDate,
                candidateCount: Math.max(counterpartCount, prior && prior.candidateCount || 0),
              });
            }
            continue;
          }
        }
        const key = rule.eventId + '@' + scheduledDate;
        const list = eventHits.get(key) || [];
        list.push({
          id: rule.eventId,
          date: scheduledDate,
          postingDate: tx.date,
          postingDateRelation: relation,
          direction: rule.direction || null,
          providerTransactionId: tx.providerTransactionId,
          providerAccountId: tx.providerAccountId,
          payee: tx.payee,
          identity: ruleIdentityLabel(rule),
          amountNotUsed: true,
          observedAmount: amount,
          atlasAccountId: mapping.canonical.id,
        });
        eventHits.set(key, list);
      }
    }
  }
  const unique = [];
  const ambiguous = [];
  for (const [key, hits] of eventHits) {
    if (hits.length !== 1) {
      ambiguous.push({
        key,
        id: hits[0] && hits[0].id,
        date: hits[0] && hits[0].date,
        hits,
        reason: 'multiple-compatible-candidates',
        candidateCount: hits.length,
      });
      continue;
    }
    unique.push(hits[0]);
  }
  const byTx = new Map();
  for (const hit of unique) {
    const txId = hit && hit.providerTransactionId;
    if (txId == null) continue;
    const list = byTx.get(String(txId)) || [];
    list.push(hit);
    byTx.set(String(txId), list);
  }
  const uniqueOnce = [];
  const consumedTwice = new Set();
  for (const hit of unique) {
    const txId = hit && hit.providerTransactionId != null
      ? String(hit.providerTransactionId) : null;
    const siblings = txId ? byTx.get(txId) : null;
    if (txId && siblings && siblings.length > 1) {
      if (!consumedTwice.has(txId)) {
        consumedTwice.add(txId);
        ambiguous.push({
          key: siblings.map(s => s.id + '@' + s.date).sort().join(','),
          id: null,
          date: null,
          hits: siblings,
          reason: 'transaction-consumed-twice',
        });
      }
      continue;
    }
    uniqueOnce.push(hit);
  }
  for (const [key, row] of counterpartAmbiguous) {
    if (uniqueOnce.some(hit => hit && hit.id + '@' + hit.date === key)) continue;
    if (ambiguous.some(group => group && (group.key === key
      || (group.id === row.id && group.date === row.date)))) continue;
    ambiguous.push({
      key,
      id: row.id,
      date: row.date,
      hits: [],
      reason: 'multiple-compatible-candidates',
      candidateCount: row.candidateCount,
    });
  }
  return { unique: uniqueOnce, ambiguous };
}

function sanitizedSameDayInboundAmbiguity(groups) {
  return (groups || [])
    .filter(group => group && group.id && group.date)
    .map(group => ({
      id: group.id,
      date: group.date,
      reason: group.reason || 'multiple-compatible-candidates',
      candidateCount: Number(group.candidateCount) > 0
        ? Number(group.candidateCount)
        : ((group.hits || []).length || 0),
    }));
}

function representedEventCandidates(input) {
  return representedEventHitGroups(input).unique;
}

function sanitizedEvidenceFingerprint(providerTransactionId) {
  if (providerTransactionId == null || providerTransactionId === '') return null;
  return crypto.createHash('sha256')
    .update('atlas-evidence:lunchmoney:tx:' + String(providerTransactionId))
    .digest('hex');
}

function emptyReconciliationCounts() {
  return {
    coveredModeledOccurrences: 0,
    represented: 0,
    upcoming: 0,
    unverified: 0,
    ambiguous: 0,
    outsideCoverage: 0,
    unmatchedCashEvidence: 0,
  };
}

function allowedPostingDatesFor(scheduledDate, rule) {
  const scheduled = parseIsoDate(scheduledDate);
  if (!scheduled) return [];
  const dates = [scheduled];
  if (rule && rule.postingDateRule === WEEKEND_NEXT_BUSINESS_DAY) {
    const weekday = new Date(`${scheduled}T00:00:00Z`).getUTCDay();
    if (weekday === 6) dates.push(Forecast.addDays(scheduled, 2));
    if (weekday === 0) dates.push(Forecast.addDays(scheduled, 1));
  }
  return dates.filter((date, index) => date && dates.indexOf(date) === index);
}

function identityRulesForEvent(identity, eventId) {
  return ((identity && identity.rules) || []).filter(rule =>
    rule && rule.eventId === eventId);
}

function earliestEligiblePostingDate(occurrence, identity) {
  if (!occurrence || !occurrence.date) return null;
  const dates = [occurrence.date];
  for (const rule of identityRulesForEvent(identity, occurrence.id)) {
    for (const postingDate of allowedPostingDatesFor(occurrence.date, rule)) {
      if (postingDate) dates.push(postingDate);
    }
  }
  dates.sort();
  return dates[0] || null;
}

function carriedOnceJointCashOccurrences(plan, asOf) {
  const out = [];
  if (!plan || !asOf) return out;
  const seen = new Set();
  for (const item of [].concat(plan.obligations || [], plan.bills || [])) {
    if (!item || !item.id || !item.date) continue;
    if (!Forecast.carriedOnceJointCashOutflow(plan, item.id, item.date, asOf)) continue;
    const key = String(item.id) + '@' + String(item.date);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: item.id, date: item.date });
  }
  return out;
}

// Ordinary current-state posted history stays 14 days. When Forecast still
// carries an unresolved once joint-cash occurrence whose permitted posting
// date is older than that window, extend the same GET /transactions start
// just far enough to cover that date, capped at the incumbent 120-day
// reconcile horizon. This is settlement lookup for currently carried
// occurrences, not a second observer and not generic historical backfill.
function postedHistoryDaysForCarriedSettlement(opts) {
  const now = opts && opts.now;
  const ordinary = CURRENT_STATE_HISTORY_DAYS;
  const asOf = dateOnly(now);
  if (!asOf) return ordinary;
  const ordinaryStart = lunchMoneyTransactionsUrl(now, ordinary).startDate;
  if (!ordinaryStart) return ordinary;
  let earliest = null;
  for (const occurrence of carriedOnceJointCashOccurrences(opts && opts.plan, asOf)) {
    const postingDate = earliestEligiblePostingDate(occurrence, opts && opts.identity);
    if (!postingDate || postingDate >= ordinaryStart) continue;
    if (!earliest || postingDate < earliest) earliest = postingDate;
  }
  if (!earliest) return ordinary;
  let span = calendarDaysBetween(earliest, asOf);
  if (span == null || span < ordinary) span = ordinary;
  let start = lunchMoneyTransactionsUrl(now, span).startDate;
  while (start && start > earliest && span < RECONCILE_HISTORY_DAYS) {
    span += 1;
    start = lunchMoneyTransactionsUrl(now, span).startDate;
  }
  if (span < ordinary) return ordinary;
  if (span > RECONCILE_HISTORY_DAYS) return RECONCILE_HISTORY_DAYS;
  return span;
}

function occurrenceInsideObservationWindow(scheduledDate, window, rules) {
  const start = window && window.startDate;
  const end = window && window.endDate;
  if (!start || !end || !scheduledDate) return false;
  const applicable = (rules && rules.length) ? rules : [{}];
  for (const rule of applicable) {
    for (const postingDate of allowedPostingDatesFor(scheduledDate, rule)) {
      if (postingDate >= start && postingDate <= end) return true;
    }
  }
  return false;
}

function ambiguousGroupFor(id, date, groups) {
  for (const group of groups || []) {
    if (group.reason === 'multiple-compatible-candidates'
      && group.id === id && group.date === date) return group;
    if (group.reason === 'transaction-consumed-twice'
      && (group.hits || []).some(hit => hit && hit.id === id && hit.date === date)) {
      return group;
    }
  }
  return null;
}

function unmatchedHouseholdCash(report, opts, consumedTxIds) {
  const collapsed = (report && report.collapsedTransactions)
    || (report && report.transactions)
    || [];
  const mapDoc = opts.accountMap;
  const plan = opts.data && opts.data.plan;
  const window = (report && report.transactionWindow) || {};
  const start = window.startDate || null;
  const end = window.endDate || null;
  const unmatched = [];
  for (const tx of collapsed) {
    if (!tx || !tx.date || tx.pending === true || tx.contradictoryEvidence === true) continue;
    if (consumedTxIds.has(String(tx.providerTransactionId))) continue;
    if (start && tx.date < start) continue;
    if (end && tx.date > end) continue;
    const mapping = mapDoc ? mappingFor(mapDoc, tx.providerAccountId) : null;
    if (atlasAccountRole(mapping) !== 'household-cash') continue;
    const amount = lunchMoneyDebitAmount(tx.amount);
    if (amount == null || amount === 0) continue;
    const cls = Forecast.classifyCurrentPeriodTransaction({
      date: tx.date,
      amount,
      pending: false,
      categoryLabel: tx.categoryLabel || null,
      isIncome: tx.isIncome === true,
      excludeFromTotals: tx.excludeFromTotals === true,
      excludeFromBudget: tx.excludeFromBudget === true,
      accountRole: 'household-cash',
      kindHint: kindHintFromTransaction(tx),
    }, plan);
    if (cls.kind === 'transfer' || cls.kind === 'card-payment'
      || cls.kind === 'business' || cls.kind === 'external') continue;
    if (cls.kind === 'income') continue;
    unmatched.push({
      date: tx.date,
      amount: Math.round(amount * 100) / 100,
      accountRole: 'household-cash',
      kind: cls.kind || 'unclassified',
      evidenceFingerprint: sanitizedEvidenceFingerprint(tx.providerTransactionId),
    });
  }
  unmatched.sort((a, b) => String(a.date).localeCompare(String(b.date))
    || String(a.evidenceFingerprint).localeCompare(String(b.evidenceFingerprint)));
  return unmatched;
}

function reconciliationReceiptLooksSanitized(receipt) {
  const blob = JSON.stringify(receipt == null ? {} : receipt);
  return identityProofLooksSanitized(receipt)
    && !/"payee"\s*:/.test(blob)
    && !/"original_name"\s*:/.test(blob)
    && !/"observationId"\s*:/.test(blob)
    && !/"status"\s*:\s*"(MATCH|CHANGE|CONFLICT|MISSING|STALE)"/.test(blob)
    && !/"recommend"\s*:/.test(blob)
    && !/"safeToSpend"\s*:/.test(blob)
    && !/"paydayAllocation"\s*:/.test(blob)
    && !/"weeklyCap"\s*:/.test(blob)
    && !/"spendPermission"\s*:/.test(blob);
}

function emptyObligationReconciliationReceipt(parts) {
  return {
    schema: RECONCILIATION_RECEIPT_SCHEMA,
    observationSchema: RECEIPT_SCHEMA,
    observationFingerprintDigest: parts.observationFingerprintDigest || null,
    observedAt: parts.observedAt || null,
    householdDate: parts.householdDate || null,
    asOf: parts.asOf || parts.householdDate || null,
    writesCanonicalState: false,
    canonicalStateChanged: false,
    forecastPlannerInvoked: false,
    trusted: false,
    observationReadyForReconciliation: parts.observationReadyForReconciliation === true,
    failClosedKind: parts.failClosedKind || null,
    failClosedReasons: parts.failClosedReasons || [],
    counts: emptyReconciliationCounts(),
    oneOccurrenceOneTransaction: true,
    noTransactionConsumedTwice: true,
    occurrences: [],
    unmatchedCashEvidence: [],
  };
}

function reconciliationReceipt(report, opts) {
  opts = opts || {};
  const observation = report && report.observationReceipt;
  const householdDate = (observation && observation.householdDate)
    || dateOnly(report && report.fetchedAt);
  const baseParts = {
    observationFingerprintDigest: observation && observation.fingerprintDigest || null,
    observedAt: (observation && observation.observedAt) || (report && report.fetchedAt) || null,
    householdDate,
    asOf: householdDate,
    observationReadyForReconciliation: !!(observation && observation.readyForReconciliation === true),
  };
  if (!observation || observation.readyForReconciliation !== true) {
    return emptyObligationReconciliationReceipt(Object.assign({}, baseParts, {
      failClosedKind: 'observation-not-ready',
      failClosedReasons: (observation && observation.failClosedReasons && observation.failClosedReasons.length)
        ? observation.failClosedReasons.slice()
        : ['observation-receipt-missing'],
    }));
  }

  const data = opts.data;
  const plan = data && data.plan;
  const identityRules = opts.identityRules
    || ((opts.identity && opts.identity.rules) || []);
  const mapDoc = opts.accountMap;
  const collapsed = (report && report.collapsedTransactions)
    || (report && report.transactions)
    || [];
  const groups = representedEventHitGroups({
    transactions: collapsed,
    accountMap: mapDoc,
    plan,
    identityRules,
    transactionWindow: report && report.transactionWindow,
  });
  const uniqueByKey = new Map();
  for (const candidate of groups.unique) {
    if (!candidate || !candidate.id || !candidate.date) continue;
    uniqueByKey.set(candidate.id + '@' + candidate.date, candidate);
  }
  const representedActuals = [];
  for (const candidate of groups.unique) {
    const amt = Number(candidate.observedAmount);
    if (!candidate.id || !candidate.date || !isFinite(amt)) continue;
    representedActuals.push({
      id: candidate.id,
      date: candidate.date,
      actual: Math.round(amt * 100) / 100,
      postedOn: candidate.postingDate || candidate.date,
    });
  }
  const paydayOrigin = Forecast.paydayPeriodOrigin(plan, householdDate);
  const states = Forecast.currentPeriodObligationStates(plan, householdDate, {
    periodOrigin: paydayOrigin,
    preservePaydayPeriodOrigin: true,
    representedEvents: groups.unique.map(c => ({ id: c.id, date: c.date })),
    currentPeriodActuals: {
      schema: 'atlas-current-period-actuals/v1',
      representedActuals,
      transactions: [],
    },
  });
  const rulesByEvent = new Map();
  for (const rule of identityRules) {
    if (!rule || !rule.eventId) continue;
    const list = rulesByEvent.get(rule.eventId) || [];
    list.push(rule);
    rulesByEvent.set(rule.eventId, list);
  }
  const window = (report && report.transactionWindow) || {};
  const occurrences = [];
  const usedEvidence = new Set();
  let oneOccurrenceOneTransaction = true;
  let noTransactionConsumedTwice = groups.ambiguous
    .every(group => group.reason !== 'transaction-consumed-twice');
  for (const bill of states.bills || []) {
    if (!bill || !bill.id || !bill.date) continue;
    const key = bill.id + '@' + bill.date;
    const ambiguous = ambiguousGroupFor(bill.id, bill.date, groups.ambiguous);
    const candidate = uniqueByKey.get(key);
    let settlement = bill.settlement;
    let evidenceFingerprint = null;
    let evidenceFingerprints = null;
    let postingDateRelationValue = null;
    let atlasAccountId = null;
    let observedAmount = bill.actual;
    let candidateCount = 0;
    if (ambiguous) {
      settlement = 'ambiguous';
      candidateCount = (ambiguous.hits || []).length;
      evidenceFingerprints = (ambiguous.hits || [])
        .map(hit => sanitizedEvidenceFingerprint(hit && hit.providerTransactionId))
        .filter(Boolean)
        .sort();
      observedAmount = null;
    } else if (candidate) {
      settlement = 'represented';
      evidenceFingerprint = sanitizedEvidenceFingerprint(candidate.providerTransactionId);
      postingDateRelationValue = candidate.postingDateRelation || null;
      atlasAccountId = candidate.atlasAccountId || null;
      const amt = Number(candidate.observedAmount);
      observedAmount = isFinite(amt) ? Math.round(amt * 100) / 100 : null;
      if (evidenceFingerprint) {
        if (usedEvidence.has(evidenceFingerprint)) {
          oneOccurrenceOneTransaction = false;
          noTransactionConsumedTwice = false;
        }
        usedEvidence.add(evidenceFingerprint);
      }
    } else if (bill.settlement === 'upcoming') {
      settlement = 'upcoming';
      observedAmount = 0;
    } else if (!occurrenceInsideObservationWindow(bill.date, window, rulesByEvent.get(bill.id))) {
      settlement = 'outside-coverage';
      observedAmount = null;
    } else {
      settlement = 'unverified';
      observedAmount = null;
    }
    const row = {
      id: bill.id,
      date: bill.date,
      kind: bill.kind || null,
      settlement,
      plannedAmount: bill.planned,
      observedAmount,
    };
    if (evidenceFingerprint) row.evidenceFingerprint = evidenceFingerprint;
    if (evidenceFingerprints && evidenceFingerprints.length) {
      row.evidenceFingerprints = evidenceFingerprints;
    }
    if (candidateCount) row.candidateCount = candidateCount;
    if (postingDateRelationValue) row.postingDateRelation = postingDateRelationValue;
    if (atlasAccountId) row.atlasAccountId = atlasAccountId;
    occurrences.push(row);
  }
  const listedKeys = new Set(occurrences.map(row => row.id + '@' + row.date));
  const periodStart = states.periodStart;
  const periodEnd = states.periodEnd;
  const inPaydayPeriod = (date) => date && periodStart && periodEnd
    && date >= periodStart && date <= periodEnd;
  for (const candidate of groups.unique) {
    if (!candidate || !candidate.id || !candidate.date) continue;
    if (!inPaydayPeriod(candidate.date)) continue;
    const key = candidate.id + '@' + candidate.date;
    if (listedKeys.has(key)) continue;
    const scheduled = scheduledEventsOn(plan, candidate.date)
      .filter(e => e && e.id === candidate.id);
    if (scheduled.length !== 1) continue;
    const kind = scheduled[0].kind;
    if (kind !== 'obligation' && kind !== 'bill' && kind !== 'commitment') continue;
    const planned = isFinite(-scheduled[0].amount)
      ? Math.round((-scheduled[0].amount) * 100) / 100 : null;
    const evidenceFingerprint = sanitizedEvidenceFingerprint(candidate.providerTransactionId);
    const amt = Number(candidate.observedAmount);
    const row = {
      id: candidate.id,
      date: candidate.date,
      kind: (scheduled[0] && scheduled[0].kind) || null,
      settlement: 'represented',
      plannedAmount: planned,
      observedAmount: isFinite(amt) ? Math.round(amt * 100) / 100 : null,
    };
    if (evidenceFingerprint) {
      row.evidenceFingerprint = evidenceFingerprint;
      if (usedEvidence.has(evidenceFingerprint)) {
        oneOccurrenceOneTransaction = false;
        noTransactionConsumedTwice = false;
      }
      usedEvidence.add(evidenceFingerprint);
    }
    if (candidate.postingDateRelation) row.postingDateRelation = candidate.postingDateRelation;
    if (candidate.atlasAccountId) row.atlasAccountId = candidate.atlasAccountId;
    occurrences.push(row);
    listedKeys.add(key);
  }
  for (const group of groups.ambiguous || []) {
    const hits = group && group.hits || [];
    const targets = group && group.reason === 'transaction-consumed-twice'
      ? hits
      : (group && group.id && group.date ? [{ id: group.id, date: group.date, hits }] : []);
    for (const target of targets) {
      if (!target || !target.id || !target.date || !inPaydayPeriod(target.date)) continue;
      const key = target.id + '@' + target.date;
      if (listedKeys.has(key)) continue;
      const scheduled = scheduledEventsOn(plan, target.date)
        .filter(e => e && e.id === target.id);
      if (scheduled.length !== 1) continue;
      const kind = scheduled[0].kind;
      if (kind !== 'obligation' && kind !== 'bill' && kind !== 'commitment') continue;
      const planned = isFinite(-scheduled[0].amount)
        ? Math.round((-scheduled[0].amount) * 100) / 100 : null;
      const groupHits = target.hits || hits;
      occurrences.push({
        id: target.id,
        date: target.date,
        kind: (scheduled[0] && scheduled[0].kind) || null,
        settlement: 'ambiguous',
        plannedAmount: planned,
        observedAmount: null,
        candidateCount: groupHits.length,
        evidenceFingerprints: groupHits
          .map(hit => sanitizedEvidenceFingerprint(hit && hit.providerTransactionId))
          .filter(Boolean)
          .sort(),
      });
      listedKeys.add(key);
    }
  }
  occurrences.sort((a, b) => String(a.date).localeCompare(String(b.date))
    || String(a.id).localeCompare(String(b.id)));
  const consumedTxIds = new Set();
  for (const candidate of groups.unique) {
    if (!candidate || candidate.providerTransactionId == null) continue;
    const key = candidate.id + '@' + candidate.date;
    const listed = listedKeys.has(key);
    if (inPaydayPeriod(candidate.date) && !listed) {
      const scheduled = scheduledEventsOn(plan, candidate.date)
        .filter(e => e && e.id === candidate.id);
      const kind = scheduled[0] && scheduled[0].kind;
      if (kind === 'obligation' || kind === 'bill' || kind === 'commitment') continue;
    }
    consumedTxIds.add(String(candidate.providerTransactionId));
  }
  const unmatched = unmatchedHouseholdCash(report, opts, consumedTxIds);
  const counts = emptyReconciliationCounts();
  counts.coveredModeledOccurrences = occurrences.length;
  for (const row of occurrences) {
    if (row.settlement === 'represented') counts.represented += 1;
    else if (row.settlement === 'upcoming') counts.upcoming += 1;
    else if (row.settlement === 'unverified') counts.unverified += 1;
    else if (row.settlement === 'ambiguous') counts.ambiguous += 1;
    else if (row.settlement === 'outside-coverage') counts.outsideCoverage += 1;
  }
  counts.unmatchedCashEvidence = unmatched.length;
  return {
    schema: RECONCILIATION_RECEIPT_SCHEMA,
    observationSchema: RECEIPT_SCHEMA,
    observationFingerprintDigest: baseParts.observationFingerprintDigest,
    observedAt: baseParts.observedAt,
    householdDate,
    asOf: householdDate,
    writesCanonicalState: false,
    canonicalStateChanged: false,
    forecastPlannerInvoked: false,
    trusted: true,
    observationReadyForReconciliation: true,
    failClosedKind: null,
    failClosedReasons: [],
    counts,
    oneOccurrenceOneTransaction,
    noTransactionConsumedTwice,
    occurrences,
    unmatchedCashEvidence: unmatched,
  };
}

function observationsFromMappedAccount(account, mapping, fetchedAt) {
  const dated = CREDIT_ROLES.has(mapping.atlasRole)
    ? postedBalanceEvidenceInstant(account)
    : genericAccountEvidenceInstant(account);
  const observedAt = dated || fetchedAt;
  const base = {
    provider: account.provider,
    providerAccountId: account.providerAccountId,
    accountLabel: account.displayName,
    observedAsOf: dateOnly(observedAt),
    evidenceDate: dateOnly(observedAt),
    canonical: mapping.canonical,
    source: 'provider-observe:lunchmoney',
  };
  const out = [];
  if (CASH_ROLES.has(mapping.atlasRole) && account.balance != null) {
    out.push({
      ...base,
      observationId: `lm-${account.providerAccountId}-cash`,
      evidenceValue: account.balance,
    });
  }
  if ((mapping.atlasRole === 'heloc' || mapping.atlasRole === 'mortgage')
    && account.balance != null) {
    out.push({
      ...base,
      observationId: `lm-${account.providerAccountId}-debt`,
      evidenceValue: account.balance,
      note: mapping.atlasRole === 'heloc'
        ? 'HELOC balance is not spendable household cash.'
        : 'Mortgage balance is not spendable household cash.',
    });
  }
  if (CREDIT_ROLES.has(mapping.atlasRole) && account.balance != null) {
    out.push({
      ...base,
      observationId: `lm-${account.providerAccountId}-debt`,
      fact: 'posted-balance',
      cardId: mapping.canonical && mapping.canonical.id,
      evidenceValue: account.balance,
    });
  }
  if (CREDIT_ROLES.has(mapping.atlasRole) && account.available != null) {
    out.push({
      ...base,
      observationId: `lm-${account.providerAccountId}-available`,
      fact: 'available-credit',
      cardId: mapping.canonical && mapping.canonical.id,
      evidenceValue: account.available,
      note: 'Available credit is never household cash.',
    });
  }
  if (CREDIT_ROLES.has(mapping.atlasRole) && account.limit != null) {
    out.push({
      ...base,
      observationId: `lm-${account.providerAccountId}-limit`,
      fact: 'limit',
      cardId: mapping.canonical && mapping.canonical.id,
      evidenceValue: account.limit,
      note: 'Credit limit is never household cash.',
    });
  }
  return out;
}

function spendableCashFromObservations(observations) {
  let cash = 0;
  for (const obs of observations) {
    if (obs.fact === 'available-credit' || obs.fact === 'limit') continue;
    if (obs.canonical && obs.canonical.collection === 'cash' && obs.evidenceValue != null) {
      cash += Number(obs.evidenceValue);
    }
  }
  return Math.round(cash * 100) / 100;
}

function observe(input) {
  const provider = input.provider;
  if (provider !== 'lunchmoney') fail(`Unsupported provider: ${provider || '(missing)'}.`);
  const fetchedAt = input.fetchedAt || new Date().toISOString();
  const normalized = normalizeLunchMoneyPayload(input.payload, fetchedAt);
  const mapDoc = input.accountMap;
  if (!mapDoc || mapDoc.provider !== 'lunchmoney') fail('Account map is missing or is not a lunchmoney map.');
  const mapped = [];
  const unmapped = [];
  const observations = [];
  const postedByCard = new Map();
  const limitByCard = new Map();
  for (const account of normalized.accounts) {
    const mapping = mappingFor(mapDoc, account.providerAccountId);
    if (mapping && mapping.atlasRole === EXTERNAL_LIVE_ROLE) {
      mapped.push({
        providerAccountId: account.providerAccountId,
        displayName: account.displayName,
        atlasId: null,
        collection: null,
        atlasRole: EXTERNAL_LIVE_ROLE,
      });
      continue;
    }
    if (!mapping || !mapping.canonical || !mapping.canonical.id) {
      unmapped.push({
        providerAccountId: account.providerAccountId,
        displayName: account.displayName,
        reason: 'unmapped-provider-account',
      });
      continue;
    }
    mapped.push({
      providerAccountId: account.providerAccountId,
      displayName: account.displayName,
      atlasId: mapping.canonical.id,
      collection: mapping.canonical.collection,
      atlasRole: mapping.atlasRole,
    });
    const accountObs = observationsFromMappedAccount(account, mapping, normalized.fetchedAt);
    observations.push(...accountObs);
    if (CREDIT_ROLES.has(mapping.atlasRole)) {
      if (account.balance != null) postedByCard.set(mapping.canonical.id, account.balance);
      if (account.limit != null) limitByCard.set(mapping.canonical.id, account.limit);
    }
  }
  const collapsed = collapseByProviderTransactionId(normalized.transactions);
  const identityRules = input.identityRules
    || ((input.identity && input.identity.rules) || []);
  const billPaymentPayees = input.billPaymentPayees
    || ((input.identity && input.identity.billPaymentPayees) || []);
  const pendingObs = pendingObservationsFromTransactions({
    transactions: collapsed.transactions,
    accountMap: mapDoc,
    asOf: dateOnly(normalized.fetchedAt),
    fetchedAt: normalized.fetchedAt,
    plan: input.data && input.data.plan,
    billPaymentPayees,
    pendingCoverage: normalized.pendingCoverage,
  });
  observations.push(...pendingObs);
  const cardInferences = [];
  for (const obs of pendingObs) {
    const inference = inferredCardState(
      postedByCard.has(obs.cardId) ? postedByCard.get(obs.cardId) : null,
      obs.unknown ? null : obs.evidenceValue,
      limitByCard.has(obs.cardId) ? limitByCard.get(obs.cardId) : null
    );
    cardInferences.push(Object.assign({ cardId: obs.cardId }, inference));
  }
  for (const [cardId, posted] of postedByCard) {
    if (cardInferences.some(c => c.cardId === cardId)) continue;
    if (!limitByCard.has(cardId)) continue;
    cardInferences.push(Object.assign({ cardId }, inferredCardState(posted, null, limitByCard.get(cardId))));
  }
  const openingAsOf = openingAsOfFromData(input.data);
  const hitGroups = representedEventHitGroups({
    transactions: collapsed.transactions,
    accountMap: mapDoc,
    plan: input.data && input.data.plan,
    identityRules,
    transactionWindow: normalized.transactionWindow,
  });
  const represented = hitGroups.unique.map(c => classifyRepresentedCandidate(c, openingAsOf));
  // Historical transaction-identity hits are evidence, not current-opening
  // posting comparisons. The live overlay may consume one only for an exact
  // once joint-cash outflow that Forecast is still carrying.
  const postingObservations = represented
    .filter(c => c.currentOpeningImpact)
    .map(c => postingObservationFromCandidate(c, normalized.fetchedAt));
  const compareObs = observations.filter(o => !R.CARD_FACTS.has(o.fact));
  const cardObs = observations.filter(o => R.CARD_FACTS.has(o.fact));
  const result = R.reconcile({
    data: input.data,
    map: input.balanceMap || { mappings: [] },
    observations: compareObs,
    cardObservations: cardObs,
    postingObservations,
  });
  const sameDay = sameDayDiscrepancies(result);
  const assembled = {
    writesCanonicalState: false,
    provider: 'lunchmoney',
    fetchedAt: normalized.fetchedAt,
    pendingCoverage: normalized.pendingCoverage,
    transactionWindow: normalized.transactionWindow,
    mapped,
    unmapped,
    transactions: normalized.transactions,
    collapsedTransactions: collapsed.transactions,
    identityEvidence: collapsed.identityEvidence,
    observations,
    spendableCash: spendableCashFromObservations(observations),
    cardCapacityIsCash: R.householdCashFromCardCapacity(),
    cardInferences,
    representedEventCandidates: represented,
    sameDayInboundAmbiguity: sanitizedSameDayInboundAmbiguity(hitGroups.ambiguous),
    sameDayDiscrepancies: sameDay,
    reconciliation: result,
  };
  assembled.identityProof = identityFingerprint(assembled);
  assembled.observationReceipt = observationReceipt(assembled, { accountMap: mapDoc });
  assembled.obligationReconciliationReceipt = reconciliationReceipt(assembled, {
    data: input.data,
    accountMap: mapDoc,
    identityRules,
  });
  assembled.currentPeriodActuals = sanitizedCurrentPeriodActuals(assembled, {
    accountMap: mapDoc,
    plan: input.data && input.data.plan,
    billPaymentPayees,
    asOf: dateOnly(normalized.fetchedAt),
  });
  return assembled;
}

const RAW_TX_METADATA_KEYS = [
  'payee',
  'original_name',
  'originalName',
  'original_merchant',
  'displayed_payee',
  'notes',
  'note',
  'tags',
  'tag',
  'tag_ids',
  'tagIds',
  'providerTransactionId',
  'providerAccountId',
  'provider_transaction_id',
  'provider_account_id',
  'merchant',
  'merchantName',
  'merchant_name',
  'external_id',
  'externalId',
  'pending_transaction_id',
  'pendingTransactionId',
  'plaid_id',
  'plaidId',
  'plaid_metadata',
  'plaidMetadata',
  'identity',
];
const RAW_TX_METADATA_KEY_RE = new RegExp(
  '"(' + RAW_TX_METADATA_KEYS.join('|') + ')"\\s*:'
);

function sanitizedMerchantIdentity(value) {
  if (value == null) return null;
  if (typeof value === 'number' && isFinite(value)) value = String(value);
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
}

function stripRawTransactionMetadata(tx) {
  if (!tx || typeof tx !== 'object') return tx;
  for (const key of RAW_TX_METADATA_KEYS) {
    if (Object.prototype.hasOwnProperty.call(tx, key)) delete tx[key];
  }
  return tx;
}

function transactionLooksSanitized(tx) {
  if (!tx || typeof tx !== 'object') return false;
  for (const key of RAW_TX_METADATA_KEYS) {
    if (Object.prototype.hasOwnProperty.call(tx, key)) return false;
  }
  return !RAW_TX_METADATA_KEY_RE.test(JSON.stringify(tx));
}

function currentPeriodActualsLooksSanitized(packet) {
  if (packet == null) return true;
  const blob = JSON.stringify(packet);
  if (RAW_TX_METADATA_KEY_RE.test(blob)) return false;
  if (/Bearer\s+\S+/.test(blob)) return false;
  const txs = packet.transactions;
  if (Array.isArray(txs) && txs.some(tx => tx && !transactionLooksSanitized(tx))) {
    return false;
  }
  return true;
}

function atlasAccountRole(mapping) {
  if (!mapping || !mapping.atlasRole) return 'unmapped';
  if (mapping.atlasRole === 'household-cash') return 'household-cash';
  if (CREDIT_ROLES.has(mapping.atlasRole)) return 'revolving-credit';
  if (mapping.atlasRole === 'heloc' || mapping.atlasRole === 'mortgage') return mapping.atlasRole;
  if (mapping.atlasRole === EXTERNAL_LIVE_ROLE) return EXTERNAL_LIVE_ROLE;
  return 'unmapped';
}

function kindHintFromTransaction(tx) {
  const raw = tx && tx.kind ? String(tx.kind).toLowerCase() : '';
  if (raw === 'payment' || raw === 'bill-payment' || raw === 'card-payment') return 'payment';
  if (raw === 'transfer' || raw === 'internal-transfer') return 'transfer';
  if (raw === 'gas' || raw === 'fuel' || raw === 'petrol') return 'gas';
  return null;
}

function explicitPersonalOwnerFromTagsNotes(tx) {
  if (!tx) return null;
  const parts = [];
  const push = value => {
    if (value == null || value === '') return;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item == null) continue;
        if (typeof item === 'object') parts.push(item.name || item.label || '');
        else parts.push(item);
      }
      return;
    }
    if (typeof value === 'object') {
      parts.push(value.name || value.label || '');
      return;
    }
    parts.push(value);
  };
  push(tx.notes);
  push(tx.note);
  push(tx.tags);
  push(tx.tag);
  const blob = parts.filter(Boolean).join(' ');
  const dale = /\bdale\b/i.test(blob);
  const amanda = /\bamanda\b/i.test(blob);
  if (dale && amanda) return null;
  if (dale) return 'dale';
  if (amanda) return 'amanda';
  return null;
}

function isMbnaCardPayment(tx) {
  if (!tx) return false;
  const payee = [tx.payee, tx.originalName, tx.displayedPayee]
    .filter(Boolean).map(v => String(v)).join(' ');
  if (!/\bmbna\b/i.test(payee)) return false;
  if (/\bamazon\b|\bamzn\b/i.test(payee) && !/payment|pay\b|autopay|\bpmt\b/i.test(payee)) {
    return false;
  }
  const label = String(tx.categoryLabel || tx.category_name || '').toLowerCase();
  if (tx.excludeFromTotals === true) return true;
  if (/payment|transfer/.test(label)) return true;
  if (/payment|pay\b|autopay|\bpmt\b/i.test(payee)) return true;
  return /^\s*mbna\s*$/i.test(payee);
}

function plaidPendingIdFromMetadata(meta) {
  if (meta == null || meta === '') return null;
  let obj = meta;
  if (typeof meta === 'string') {
    try { obj = JSON.parse(meta); }
    catch (e) { return null; }
  }
  if (!obj || typeof obj !== 'object') return null;
  const id = obj.pending_transaction_id || obj.pendingTransactionId
    || (obj.transaction && (obj.transaction.pending_transaction_id
      || obj.transaction.pendingTransactionId));
  return id == null || id === '' ? null : String(id);
}

function directedPendingId(posted) {
  if (!posted) return null;
  const direct = posted.pendingTransactionId || posted.pending_transaction_id;
  if (direct != null && direct !== '') return String(direct);
  return plaidPendingIdFromMetadata(posted.plaidMetadata || posted.plaid_metadata);
}

function directedSettlementMate(posted, pending) {
  const want = directedPendingId(posted);
  if (!want) return false;
  const ids = [
    pending && pending.providerTransactionId,
    pending && pending.id,
    pending && pending.externalId,
    pending && pending.external_id,
    pending && pending.plaidId,
    pending && pending.plaid_id,
  ].filter(v => v != null && v !== '').map(String);
  return ids.includes(want);
}

function collapsePendingPostedBySettlementIdentity(transactions, asOf, opts) {
  const list = (transactions || []).filter(tx => tx && tx.date);
  if (list.length < 2) return list;
  const treat = tx => pendingForecastTreatment(tx, asOf, opts);
  const pending = [];
  const posted = [];
  for (const tx of list) {
    const treatment = treat(tx);
    if (tx.pending === true && treatment.treatment === 'unresolved') pending.push(tx);
    else if (tx.pending !== true && treatment.treatment === 'confirmed-settled') posted.push(tx);
  }
  if (!pending.length || !posted.length) return list;
  const drop = new Set();
  for (const pend of pending) {
    const mapping = opts && opts.accountMap
      ? mappingFor(opts.accountMap, pend.providerAccountId) : null;
    const accountId = mapping && mapping.canonical && mapping.canonical.id
      ? mapping.canonical.id
      : (pend.atlasAccountId || pend.account || pend.providerAccountId);
    const amount = lunchMoneyDebitAmount(pend.amount);
    const mate = posted.some(post => {
      if (drop.has(post)) return false;
      const postMap = opts && opts.accountMap
        ? mappingFor(opts.accountMap, post.providerAccountId) : null;
      const postAccount = postMap && postMap.canonical && postMap.canonical.id
        ? postMap.canonical.id
        : (post.atlasAccountId || post.account || post.providerAccountId);
      if (accountId != null && postAccount != null && String(accountId) !== String(postAccount)) {
        return false;
      }
      const postAmt = lunchMoneyDebitAmount(post.amount);
      if (amount != null && postAmt != null && Number(amount).toFixed(2) !== Number(postAmt).toFixed(2)) {
        return false;
      }
      return directedSettlementMate(post, pend);
    });
    if (mate) drop.add(pend);
  }
  if (!drop.size) return list;
  return list.filter(tx => !drop.has(tx));
}

function sanitizedCurrentPeriodActuals(report, opts) {
  opts = opts || {};
  const asOf = dateOnly(opts.asOf || (report && report.fetchedAt));
  const window = (report && report.transactionWindow) || {};
  const collapsed = collapsePendingPostedBySettlementIdentity(
    (report && report.collapsedTransactions)
      || (report && report.transactions)
      || [],
    asOf,
    {
      plan: opts.plan,
      billPaymentPayees: opts.billPaymentPayees,
      accountMap: opts.accountMap,
    }
  );
  const tagsById = tagIndexFromPayload(report);
  const mapDoc = opts.accountMap;
  const localByProvider = new Map();
  let localSeq = 0;
  const localIdFor = providerId => {
    if (providerId == null || providerId === '') return null;
    const key = String(providerId);
    if (localByProvider.has(key)) return localByProvider.get(key);
    localSeq += 1;
    const local = 'tx-' + localSeq;
    localByProvider.set(key, local);
    return local;
  };
  const existingLocalId = providerId => {
    if (providerId == null || providerId === '') return null;
    return localByProvider.get(String(providerId)) || null;
  };
  const txs = [];
  for (const tx of collapsed) {
    if (!tx || !tx.date) continue;
    const amount = lunchMoneyDebitAmount(tx.amount);
    if (amount == null) continue;
    const mapping = mapDoc ? mappingFor(mapDoc, tx.providerAccountId) : null;
    const treatment = pendingForecastTreatment(tx, asOf, {
      plan: opts.plan,
      billPaymentPayees: opts.billPaymentPayees,
    });
    const atlasAccountId = mapping && mapping.canonical && mapping.canonical.id
      ? mapping.canonical.id : null;
    const resolvedTags = resolveRawTags(tx, tagsById);
    let kindHint = kindHintFromTransaction(tx);
    if (!kindHint && isMbnaCardPayment(tx)) kindHint = 'card-payment';
    const derivedInput = {
      payee: tx.payee,
      original_name: tx.originalName,
      originalName: tx.originalName,
      displayedPayee: tx.payee,
      originalMerchant: tx.originalName || tx.payee,
      notes: tx.notes,
      note: tx.notes || tx.note,
      tags: resolvedTags,
      tag: resolvedTags,
      kindHint,
      kind: tx.kind,
      mcc: tx.mcc,
      categoryLabel: tx.categoryLabel,
      atlasAccountId,
      account: atlasAccountId,
      accountId: atlasAccountId,
    };
    const explicitOwner = explicitPersonalOwnerFromTagsNotes(derivedInput);
    const flags = Forecast.classifyCurrentPeriodTransaction.derivedFlags(derivedInput);
    const personalOwner = explicitOwner || flags.personalOwner;
    const localId = localIdFor(tx.providerTransactionId);
    txs.push({
      id: localId,
      date: tx.date,
      amount,
      pending: tx.pending === true,
      pendingTreatment: treatment.treatment,
      categoryLabel: tx.categoryLabel || null,
      displayedPayee: sanitizedMerchantIdentity(tx.payee),
      originalMerchant: sanitizedMerchantIdentity(tx.originalName || tx.payee),
      isIncome: tx.isIncome === true,
      excludeFromTotals: tx.excludeFromTotals === true,
      excludeFromBudget: tx.excludeFromBudget === true,
      accountRole: atlasAccountRole(mapping),
      atlasAccountId,
      account: atlasAccountId,
      kindHint,
      dogFood: flags.dogFood,
      convenienceStore: flags.convenienceStore,
      canadianTire: flags.canadianTire,
      groceryUncertain: flags.groceryUncertain,
      groceryMixed: flags.groceryMixed,
      merchantKnown: flags.merchantKnown,
      fuelEvidence: flags.fuelEvidence,
      personalOwner,
      isGroup: tx.isGroup === true,
      parentId: localIdFor(tx.parentId),
    });
  }
  const representedActuals = [];
  const linkedLocalIds = new Set();
  for (const candidate of (report && report.representedEventCandidates) || []) {
    if (!candidate || !candidate.id || !candidate.date) continue;
    const amt = Number(candidate.observedAmount);
    if (!isFinite(amt)) continue;
    const row = {
      id: candidate.id,
      date: candidate.date,
      actual: Math.round(amt * 100) / 100,
      postedOn: candidate.postingDate || candidate.date,
    };
    const localId = existingLocalId(candidate.providerTransactionId);
    if (localId) {
      row.transactionId = localId;
      linkedLocalIds.add(localId);
    }
    representedActuals.push(row);
  }
  for (const tx of txs) {
    if (tx && linkedLocalIds.has(tx.id)) tx.representedBill = true;
    else if (tx) tx.representedBill = false;
    stripRawTransactionMetadata(tx);
  }
  const classifyPacket = { transactions: txs, representedActuals };
  for (const row of txs) {
    if (!row) continue;
    const cls = Forecast.classifyCurrentPeriodTransaction(row, opts.plan, {
      packet: classifyPacket,
      currentPeriodActuals: classifyPacket,
    });
    if (!Forecast.classifyCurrentPeriodTransaction.householdBudgetSupportingSpendEligible(cls)) {
      delete row.displayedPayee;
      delete row.originalMerchant;
    }
  }
  const pending = report && report.pendingCoverage;
  let pendingCoverage = 'unknown';
  if (pending && pending.complete === true) pendingCoverage = 'complete';
  else if (pending && pending.status === 'bounded-window') pendingCoverage = 'partial';
  let transactionCoverage = 'complete';
  if (window.truncated === true || window.complete === false || window.hasMore === true) {
    transactionCoverage = 'truncated';
  } else if (txs.some(tx => tx && tx.accountRole === 'unmapped')) {
    transactionCoverage = 'incomplete';
  }
  let coverageStart = window.startDate || null;
  let coverageThrough = window.endDate || null;
  if (!coverageStart || !coverageThrough) {
    for (const tx of txs) {
      if (!tx || !tx.date) continue;
      if (!coverageStart || tx.date < coverageStart) coverageStart = tx.date;
      if (!coverageThrough || tx.date > coverageThrough) coverageThrough = tx.date;
    }
  }
  const packet = {
    schema: 'atlas-current-period-actuals/v1',
    observationAsOf: asOf,
    coverageStart,
    coverageThrough,
    pendingCoverage,
    transactionCoverage,
    representedActuals,
    transactions: txs,
  };
  if (!currentPeriodActualsLooksSanitized(packet)) {
    packet.transactions = [];
    packet.representedActuals = representedActuals.map(row => ({
      id: row.id,
      date: row.date,
      actual: row.actual,
      postedOn: row.postedOn,
      transactionId: row.transactionId || undefined,
    }));
    packet.transactionCoverage = 'incomplete';
  }
  return packet;
}

function loadIdentity(file) {
  if (!file || !fs.existsSync(file)) return { rules: [], billPaymentPayees: [] };
  return loadJson(file);
}

async function run(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(
      'Usage: node scripts/provider-observe.js --provider lunchmoney --fixture <file>\n'
      + '       node scripts/provider-observe.js --provider lunchmoney --live [--mode current-state|reconcile] [--history-days N]\n'
      + '       [--identity-proof | --receipt | --reconciliation-receipt]\n'
    );
    return 0;
  }
  if (args.provider !== 'lunchmoney') fail('Only --provider lunchmoney is implemented in this spike.');
  if (args.live && args.fixture) fail('Use either --fixture or --live, not both.');
  if (!args.live && !args.fixture) fail('Pass --fixture <file> or --live.');
  if ([args.identityProof, args.receipt, args.reconciliationReceipt].filter(Boolean).length > 1) {
    fail('Use only one of --identity-proof, --receipt, or --reconciliation-receipt.');
  }
  if (args.mode && args.mode !== 'current-state' && args.mode !== 'reconcile') {
    fail('Mode must be current-state or reconcile.');
  }
  const data = loadJson(args.data);
  const accountMap = loadJson(resolveMapPath(args));
  if (args.live) {
    await resolveLiveToken();
    assertLiveMap(accountMap, { data });
  }
  const identity = loadIdentity(DEFAULT_IDENTITY);
  const now = new Date().toISOString();
  let historyDays = historyDaysFromArgs(args);
  if (args.live && args.historyDays == null && args.mode !== 'reconcile') {
    historyDays = postedHistoryDaysForCarriedSettlement({
      now,
      plan: data.plan,
      identity,
    });
  }
  let payload;
  if (args.live) {
    payload = await fetchLunchMoneyLive(
      await resolveLiveToken(),
      now,
      historyDays
    );
  } else {
    payload = loadJson(args.fixture);
  }
  const report = observe({
    provider: 'lunchmoney',
    payload,
    accountMap,
    data,
    identity,
    fetchedAt: payload.fetchedAt,
  });
  const printed = args.reconciliationReceipt
    ? report.obligationReconciliationReceipt
    : (args.receipt
      ? report.observationReceipt
      : (args.identityProof ? report.identityProof : report));
  process.stdout.write(JSON.stringify(printed, null, 2) + '\n');
  return 0;
}

const api = {
  TOKEN_ENV,
  MAP_JSON_ENV,
  MAP_PATH_ENV,
  API_BASE_ENV,
  LIVE_MAP_SCHEMA,
  RECEIPT_SCHEMA,
  RECONCILIATION_RECEIPT_SCHEMA,
  REQUEST_TIMEOUT_MS,
  LIVE_BASE,
  DEFAULT_MAP,
  LOCAL_MAP,
  FIXTURE_MAP,
  DEFAULT_IDENTITY,
  CURRENT_STATE_HISTORY_DAYS,
  RECONCILE_HISTORY_DAYS,
  BILL_PAYMENT_PENDING_DAYS,
  PENDING_COVERAGE_BASIS,
  PENDING_COVERAGE_REQUIRED_EVIDENCE,
  REQUIRED_LIVE_CASH_IDS,
  EXTERNAL_LIVE_ROLE,
  parseArgs,
  historyDaysFromArgs,
  postedHistoryDaysForCarriedSettlement,
  resolveMapPath,
  lunchMoneyApiBase,
  loadLiveAccountMap,
  assertLiveMap,
  mappingFor,
  lunchMoneyTransactionsUrl,
  lunchMoneyPendingUniverseUrl,
  fetchLunchMoneyTransactionsPaged,
  classifyPendingCoverage,
  lunchMoneyDebitAmount,
  calendarDaysBetween,
  isBillOrPaymentTransaction,
  pendingForecastTreatment,
  collapseByProviderTransactionId,
  pendingObservationsFromTransactions,
  inferredCardState,
  representedEventHitGroups,
  representedEventCandidates,
  transactionIsTransfer,
  uniqueTransferCounterpart,
  countTransferCounterparts,
  ruleHasIdentity,
  ruleMatchesTransactionIdentity,
  openingAsOfFromData,
  classifyRepresentedCandidate,
  postingObservationFromCandidate,
  sameDayDiscrepancies,
  observationIdentityKey,
  identityFingerprint,
  identityProofLooksSanitized,
  compareIdentityFingerprints,
  postedWindowIsComplete,
  pendingCoverageIsComplete,
  observationReceiptLooksSanitized,
  observationFingerprintFromParts,
  observationFingerprintDigest,
  observationReceipt,
  sanitizedEvidenceFingerprint,
  reconciliationReceiptLooksSanitized,
  reconciliationReceipt,
  normalizeLunchMoneyAccount,
  postedBalanceEvidenceInstant,
  genericAccountEvidenceInstant,
  normalizeLunchMoneyTransaction,
  normalizeLunchMoneyPayload,
  observationsFromMappedAccount,
  spendableCashFromObservations,
  sanitizedCurrentPeriodActuals,
  currentPeriodActualsLooksSanitized,
  transactionLooksSanitized,
  observe,
  fetchLunchMoneyLive,
  resolveLiveToken,
  resolveLiveCredential,
  run,
};

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => {
    process.exit(code);
  }).catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
} else {
  module.exports = api;
}
