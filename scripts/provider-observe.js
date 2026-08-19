'use strict';
/* Read-only provider observation → B91 reconciliation.
 *
 *   node scripts/provider-observe.js --provider lunchmoney --fixture <file>
 *   node scripts/provider-observe.js --provider lunchmoney --live
 *   node scripts/provider-observe.js --provider lunchmoney --live --identity-proof
 *
 * Live mode requires LUNCHMONEY_ACCESS_TOKEN in the environment. It never
 * writes data.json. Unknown provider account IDs stay unmapped. Synthetic
 * fixture mappings cannot authorize a live canonical mapping. Historical
 * represented-event candidates are not current-opening corrections.
 *
 * Pending proof is three-valued. A complete Lunch Money v2 pending census
 * (`GET /transactions?is_pending=true` with no start_date/end_date, paginated
 * until has_more=false) may prove numeric pending, including proven zero.
 * Absence inside a bounded include_pending window is not zero.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const R = require('./reconcile.js');

const ROOT = path.join(__dirname, '..');
const DEFAULT_MAP = path.join(ROOT, 'docs', 'connectivity', 'provider-account-map.json');
const LOCAL_MAP = path.join(ROOT, 'docs', 'connectivity', 'provider-account-map.local.json');
const FIXTURE_MAP = path.join(ROOT, 'docs', 'connectivity', 'fixtures', 'provider-account-map.json');
const DEFAULT_IDENTITY = path.join(ROOT, 'docs', 'connectivity', 'transaction-identity.json');
const DEFAULT_DATA = path.join(ROOT, 'data.json');
const LIVE_BASE = 'https://api.lunchmoney.dev/v2';
const TOKEN_ENV = 'LUNCHMONEY_ACCESS_TOKEN';
const CASH_ROLES = new Set(['household-cash']);
const CREDIT_ROLES = new Set(['revolving-credit']);
const CURRENT_STATE_HISTORY_DAYS = 14;
const RECONCILE_HISTORY_DAYS = 120;
const BILL_PAYMENT_PENDING_DAYS = 90;
const PENDING_CENSUS_METHOD = 'is_pending-unbounded-paginated';
const PENDING_CENSUS_LIMIT = 2000;
const PENDING_CENSUS_MAX_PAGES = 20;
const PENDING_CENSUS_REQUIRED_EVIDENCE = 'GET /transactions?is_pending=true with no start_date/end_date, paginated until has_more=false. A bounded include_pending window, a missing has_more, or account-level limit/available arithmetic is not this proof.';
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

function assertLiveMap(mapDoc) {
  if (!mapDoc || mapDoc.provider !== 'lunchmoney') fail('Account map is missing or is not a lunchmoney map.');
  if (mapDoc.scope === 'fixture') {
    fail('Fixture account map cannot authorize a live canonical mapping.');
  }
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
    providerUpdatedAt: raw.updated_at || raw.balance_as_of || raw.date_last_fetched || null,
  };
}

function normalizeLunchMoneyTransaction(raw) {
  if (!raw || raw.id == null) fail('Lunch Money transaction is missing a stable id.');
  const accountId = raw.account_id != null ? raw.account_id
    : raw.plaid_account_id != null ? raw.plaid_account_id
    : raw.manual_account_id;
  return {
    provider: 'lunchmoney',
    providerTransactionId: String(raw.id),
    providerAccountId: accountId != null ? String(accountId) : null,
    date: raw.date || null,
    amount: raw.amount != null ? Number(raw.amount) : null,
    payee: raw.payee || raw.original_name || null,
    pending: raw.is_pending === true,
    status: raw.status || null,
    kind: raw.kind || null,
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
  return {
    provider: 'lunchmoney',
    fetchedAt: payload.fetchedAt || fetchedAt,
    accounts: collectLunchMoneyAccounts(payload).map(normalizeLunchMoneyAccount),
    transactions: (payload.transactions || []).map(normalizeLunchMoneyTransaction),
    has_more: payload.has_more,
    pendingCensus: normalizePendingCensus(payload.pendingCensus),
  };
}

function httpsGetJson(url, token) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
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
          reject(new Error('Lunch Money rejected the access token. Token value is not logged.'));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Lunch Money GET ${url.pathname} failed with HTTP ${res.statusCode}.`));
          return;
        }
        try { resolve(JSON.parse(body || '{}')); }
        catch (e) { reject(new Error('Lunch Money response was not JSON.')); }
      });
    });
    req.on('error', reject);
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

function lunchMoneyTransactionsUrl(now, historyDays) {
  const days = historyDays == null ? CURRENT_STATE_HISTORY_DAYS : Number(historyDays);
  const span = isFinite(days) && days > 0 ? Math.floor(days) : CURRENT_STATE_HISTORY_DAYS;
  const txUrl = new URL(`${LIVE_BASE}/transactions`);
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
  return txUrl;
}

function lunchMoneyPendingCensusUrl(offset, limit) {
  const txUrl = new URL(`${LIVE_BASE}/transactions`);
  const pageLimit = limit == null ? PENDING_CENSUS_LIMIT : Number(limit);
  const span = isFinite(pageLimit) && pageLimit > 0
    ? Math.min(PENDING_CENSUS_LIMIT, Math.floor(pageLimit))
    : PENDING_CENSUS_LIMIT;
  txUrl.searchParams.set('is_pending', 'true');
  txUrl.searchParams.set('limit', String(span));
  const off = offset == null ? 0 : Number(offset);
  if (isFinite(off) && off > 0) txUrl.searchParams.set('offset', String(Math.floor(off)));
  return txUrl;
}

function censusDateBound(census) {
  if (!census || typeof census !== 'object') return false;
  const start = census.startDate != null && census.startDate !== ''
    ? census.startDate : census.start_date;
  const end = census.endDate != null && census.endDate !== ''
    ? census.endDate : census.end_date;
  return (start != null && start !== '') || (end != null && end !== '');
}

function incompletePendingCensus(reason, extra) {
  const out = Object.assign({
    complete: false,
    method: PENDING_CENSUS_METHOD,
    hasMore: null,
    startDate: null,
    endDate: null,
    transactions: [],
    pageCount: 0,
    reason,
    requiredEvidence: PENDING_CENSUS_REQUIRED_EVIDENCE,
  }, extra || {});
  out.complete = false;
  return out;
}

function pageHasMore(page) {
  if (!page || typeof page !== 'object') return null;
  if (page.has_more === true || page.hasMore === true) return true;
  if (page.has_more === false || page.hasMore === false) return false;
  return null;
}

function assemblePendingCensus(pages, opts) {
  const maxPages = opts && opts.maxPages != null
    ? Number(opts.maxPages) : PENDING_CENSUS_MAX_PAGES;
  const startDate = opts && (opts.startDate != null ? opts.startDate : opts.start_date);
  const endDate = opts && (opts.endDate != null ? opts.endDate : opts.end_date);
  const list = Array.isArray(pages) ? pages : [];
  const transactions = [];
  let lastHasMore = null;
  let pagesRead = 0;
  for (let i = 0; i < list.length; i++) {
    const page = list[i] || {};
    const txs = Array.isArray(page.transactions) ? page.transactions : [];
    transactions.push(...txs);
    pagesRead += 1;
    lastHasMore = pageHasMore(page);
    if (lastHasMore === true && txs.length === 0) {
      return incompletePendingCensus('empty-page-with-has-more', {
        hasMore: true,
        startDate: startDate || null,
        endDate: endDate || null,
        transactions,
        pageCount: pagesRead,
      });
    }
    if (lastHasMore !== true) break;
  }
  if (startDate || endDate) {
    return incompletePendingCensus('census-date-bounded', {
      hasMore: lastHasMore,
      startDate: startDate || null,
      endDate: endDate || null,
      transactions,
      pageCount: pagesRead,
    });
  }
  if (pagesRead >= maxPages && lastHasMore === true) {
    return incompletePendingCensus('pagination-unexhausted', {
      hasMore: true,
      transactions,
      pageCount: pagesRead,
    });
  }
  if (lastHasMore !== false) {
    return incompletePendingCensus('has-more-unknown', {
      hasMore: lastHasMore,
      transactions,
      pageCount: pagesRead,
    });
  }
  return {
    complete: true,
    method: PENDING_CENSUS_METHOD,
    hasMore: false,
    startDate: null,
    endDate: null,
    transactions,
    pageCount: pagesRead,
    reason: null,
    requiredEvidence: null,
  };
}

function normalizePendingCensus(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const hasMore = pageHasMore(raw);
  return {
    complete: raw.complete === true,
    method: raw.method || null,
    hasMore,
    startDate: raw.startDate || raw.start_date || null,
    endDate: raw.endDate || raw.end_date || null,
    reason: raw.reason || null,
    requiredEvidence: raw.requiredEvidence || null,
    pageCount: raw.pageCount != null ? Number(raw.pageCount) : null,
    transactions: Array.isArray(raw.transactions)
      ? raw.transactions.map(normalizeLunchMoneyTransaction)
      : [],
  };
}

function assessPendingCoverage(census) {
  if (!census || typeof census !== 'object') {
    return incompletePendingCensus('no-pending-census');
  }
  if (census.method !== PENDING_CENSUS_METHOD) {
    return incompletePendingCensus('unrecognized-census-method', {
      method: census.method || null,
      hasMore: pageHasMore(census),
      startDate: census.startDate || census.start_date || null,
      endDate: census.endDate || census.end_date || null,
      transactions: census.transactions || [],
      pageCount: census.pageCount || 0,
    });
  }
  if (censusDateBound(census)) {
    return incompletePendingCensus('census-date-bounded', {
      hasMore: pageHasMore(census),
      startDate: census.startDate || census.start_date || null,
      endDate: census.endDate || census.end_date || null,
      transactions: census.transactions || [],
      pageCount: census.pageCount || 0,
    });
  }
  if (pageHasMore(census) !== false) {
    return incompletePendingCensus(
      pageHasMore(census) === true ? 'pagination-unexhausted' : 'has-more-unknown',
      {
        hasMore: pageHasMore(census),
        transactions: census.transactions || [],
        pageCount: census.pageCount || 0,
      }
    );
  }
  if (census.complete !== true) {
    return incompletePendingCensus(census.reason || 'census-not-marked-complete', {
      hasMore: false,
      transactions: census.transactions || [],
      pageCount: census.pageCount || 0,
    });
  }
  return {
    complete: true,
    method: PENDING_CENSUS_METHOD,
    hasMore: false,
    startDate: null,
    endDate: null,
    transactions: census.transactions || [],
    pageCount: census.pageCount || 0,
    reason: null,
    requiredEvidence: null,
  };
}

function unionTransactions(primary, extra) {
  const out = [];
  const seen = new Set();
  for (const tx of [].concat(primary || [], extra || [])) {
    if (!tx || tx.providerTransactionId == null) {
      out.push(tx);
      continue;
    }
    const key = `${tx.providerTransactionId}|${tx.pending === true ? 'p' : 'n'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tx);
  }
  return out;
}

async function fetchLunchMoneyPendingCensus(token) {
  const pages = [];
  let offset = 0;
  for (let page = 0; page < PENDING_CENSUS_MAX_PAGES; page++) {
    const payload = await httpsGetJson(lunchMoneyPendingCensusUrl(offset, PENDING_CENSUS_LIMIT), token);
    const txs = (payload && payload.transactions) || [];
    pages.push({
      transactions: txs,
      has_more: payload && payload.has_more,
    });
    if (!payload || payload.has_more !== true) break;
    offset += PENDING_CENSUS_LIMIT;
  }
  return assemblePendingCensus(pages, { maxPages: PENDING_CENSUS_MAX_PAGES });
}

async function fetchLunchMoneyLive(token, now, historyDays) {
  if (!token) fail(`${TOKEN_ENV} is not set. Live observation refuses to run.`);
  const txUrl = lunchMoneyTransactionsUrl(now, historyDays);
  await httpsGetJson(new URL(`${LIVE_BASE}/me`), token);
  const plaid = await tryGetJson(new URL(`${LIVE_BASE}/plaid_accounts`), token);
  let manuals = await tryGetJson(new URL(`${LIVE_BASE}/manual_accounts`), token);
  if (!manuals) manuals = await tryGetJson(new URL(`${LIVE_BASE}/assets`), token);
  const txPayload = await httpsGetJson(txUrl, token);
  let pendingCensus;
  try {
    pendingCensus = await fetchLunchMoneyPendingCensus(token);
  } catch (err) {
    pendingCensus = incompletePendingCensus('census-fetch-failed');
  }
  return {
    provider: 'lunchmoney',
    fetchedAt: now,
    accounts: accountsFromLivePayloads(plaid, manuals),
    transactions: (txPayload && txPayload.transactions) || [],
    has_more: txPayload && txPayload.has_more,
    pendingCensus,
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
  const coverage = input.pendingCoverage || assessPendingCoverage(input.pendingCensus);
  const out = [];
  for (const mapping of (mapDoc && mapDoc.mappings) || []) {
    if (!CREDIT_ROLES.has(mapping.atlasRole) || !mapping.canonical || !mapping.canonical.id) {
      continue;
    }
    const components = pendingComponentsForCard(
      input.transactions, mapping, asOf, opts
    );
    if (!components.length) {
      if (coverage.complete === true) {
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
          pendingProof: 'proven-zero',
          pendingCoverage: 'complete',
          balanceIncludesPending: false,
          canonical: { collection: 'debts', id: mapping.canonical.id, field: 'pending' },
          source: 'provider-observe:lunchmoney-transactions',
          note: 'Proven zero pending from a complete is_pending census. Absence inside a bounded include_pending window is not this proof.',
          components: [],
        });
      }
      continue;
    }
    const net = netCurrentPending(components);
    const allSettledForForecast = net.unresolved === 0 && components.every(c =>
      c.settlementTreatment === 'presumed-settled-for-current-forecast'
      || c.settlementTreatment === 'confirmed-settled');
    const unknown = !allSettledForForecast && components.length > 0
      && components.every(c => c.conflict);
    const provenZero = coverage.complete === true && !unknown && net.unresolved === 0;
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
      pendingProof: unknown ? 'unknown' : (provenZero ? 'proven-zero' : 'numeric'),
      pendingCoverage: coverage.complete === true ? 'complete' : 'incomplete',
      balanceIncludesPending: false,
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

function scheduledEventsOn(plan, date) {
  if (!plan || !date) return [];
  const slim = {
    income: plan.income || [],
    obligations: plan.obligations || [],
    bills: plan.bills || [],
    commitments: plan.commitments || [],
    startingCash: plan.startingCash,
  };
  return Forecast.expandEvents(slim, date, date, {}).filter(e => e && e.kind !== 'noncash');
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
    note: 'Identity is payee + mapped account + scheduled date. Amount similarity was not used. Historical candidates are not current-opening corrections.',
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

function representedEventCandidates(input) {
  const rules = (input.identityRules || []).filter(r => r && r.eventId && r.payeePattern);
  if (!rules.length) return [];
  const mapDoc = input.accountMap;
  const candidates = [];
  const seenEvent = new Set();
  const eventHits = new Map();
  for (const tx of input.transactions || []) {
    if (tx.pending === true) continue;
    const mapping = mappingFor(mapDoc, tx.providerAccountId);
    if (!mapping || !mapping.canonical || !mapping.canonical.id) continue;
    const amount = lunchMoneyDebitAmount(tx.amount);
    for (const rule of rules) {
      if (rule.atlasAccountId && mapping.canonical.id !== rule.atlasAccountId) continue;
      if (!payeeMatches(tx.payee, rule.payeePattern)) continue;
      if (rule.direction === 'credit' && !(amount < 0)) continue;
      if (rule.direction === 'debit' && !(amount > 0)) continue;
      const scheduled = scheduledEventsOn(input.plan, tx.date)
        .filter(e => e.id === rule.eventId && e.date === tx.date);
      if (scheduled.length !== 1) continue;
      const key = rule.eventId + '@' + tx.date;
      const list = eventHits.get(key) || [];
      list.push({
        id: rule.eventId,
        date: tx.date,
        providerTransactionId: tx.providerTransactionId,
        providerAccountId: tx.providerAccountId,
        payee: tx.payee,
        identity: 'payee+account+date',
        amountNotUsed: true,
      });
      eventHits.set(key, list);
    }
  }
  for (const [key, hits] of eventHits) {
    if (hits.length !== 1) continue;
    if (seenEvent.has(key)) continue;
    seenEvent.add(key);
    candidates.push(hits[0]);
  }
  return candidates;
}

function observationsFromMappedAccount(account, mapping, fetchedAt) {
  const observedAt = account.providerUpdatedAt || fetchedAt;
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
  const census = normalized.pendingCensus;
  const coverage = assessPendingCoverage(census);
  const collapsed = collapseByProviderTransactionId(
    coverage.complete === true
      ? unionTransactions(normalized.transactions, census && census.transactions)
      : normalized.transactions
  );
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
    pendingCoverage: coverage,
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
  const represented = representedEventCandidates({
    transactions: collapsed.transactions,
    accountMap: mapDoc,
    plan: input.data && input.data.plan,
    identityRules,
  }).map(c => classifyRepresentedCandidate(c, openingAsOf));
  // Historical payee+account+date hits are evidence, not current-opening
  // representedEvents corrections. They must not enter the current compare.
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
    sameDayDiscrepancies: sameDay,
    pendingCoverage: {
      complete: coverage.complete === true,
      method: coverage.method || null,
      reason: coverage.reason || null,
      requiredEvidence: coverage.complete === true ? null : (coverage.requiredEvidence || PENDING_CENSUS_REQUIRED_EVIDENCE),
    },
    reconciliation: result,
  };
  assembled.identityProof = identityFingerprint(assembled);
  return assembled;
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
      + '       [--identity-proof]\n'
    );
    return 0;
  }
  if (args.provider !== 'lunchmoney') fail('Only --provider lunchmoney is implemented in this spike.');
  if (args.live && args.fixture) fail('Use either --fixture or --live, not both.');
  if (!args.live && !args.fixture) fail('Pass --fixture <file> or --live.');
  if (args.mode && args.mode !== 'current-state' && args.mode !== 'reconcile') {
    fail('Mode must be current-state or reconcile.');
  }
  const accountMap = loadJson(resolveMapPath(args));
  if (args.live) assertLiveMap(accountMap);
  const data = loadJson(args.data);
  const identity = loadIdentity(DEFAULT_IDENTITY);
  const historyDays = historyDaysFromArgs(args);
  let payload;
  if (args.live) {
    payload = await fetchLunchMoneyLive(
      process.env[TOKEN_ENV],
      new Date().toISOString(),
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
  const printed = args.identityProof ? report.identityProof : report;
  process.stdout.write(JSON.stringify(printed, null, 2) + '\n');
  return 0;
}

const api = {
  TOKEN_ENV,
  LIVE_BASE,
  DEFAULT_MAP,
  LOCAL_MAP,
  FIXTURE_MAP,
  DEFAULT_IDENTITY,
  CURRENT_STATE_HISTORY_DAYS,
  RECONCILE_HISTORY_DAYS,
  BILL_PAYMENT_PENDING_DAYS,
  PENDING_CENSUS_METHOD,
  PENDING_CENSUS_LIMIT,
  PENDING_CENSUS_MAX_PAGES,
  PENDING_CENSUS_REQUIRED_EVIDENCE,
  parseArgs,
  historyDaysFromArgs,
  resolveMapPath,
  assertLiveMap,
  mappingFor,
  lunchMoneyTransactionsUrl,
  lunchMoneyPendingCensusUrl,
  lunchMoneyDebitAmount,
  calendarDaysBetween,
  isBillOrPaymentTransaction,
  pendingForecastTreatment,
  collapseByProviderTransactionId,
  pendingObservationsFromTransactions,
  assemblePendingCensus,
  assessPendingCoverage,
  normalizePendingCensus,
  inferredCardState,
  representedEventCandidates,
  openingAsOfFromData,
  classifyRepresentedCandidate,
  postingObservationFromCandidate,
  sameDayDiscrepancies,
  observationIdentityKey,
  identityFingerprint,
  identityProofLooksSanitized,
  compareIdentityFingerprints,
  normalizeLunchMoneyAccount,
  normalizeLunchMoneyTransaction,
  normalizeLunchMoneyPayload,
  observationsFromMappedAccount,
  spendableCashFromObservations,
  observe,
  fetchLunchMoneyLive,
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
