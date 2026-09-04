'use strict';

/*
 * Owner-authorized 2026-09-04 Lunch Money write seam.
 *
 * Scope is deliberately narrow:
 *   - authenticated Atlas Household Budget -> Other Spending only
 *   - one currently-Other posted transaction at a time
 *   - one existing Lunch Money category that Forecast maps to an incumbent
 *     Household Budget line
 *   - category_id only
 *
 * Raw Lunch Money transaction ids never leave the server. The browser receives
 * HMAC handles; every write refetches Lunch Money and resolves the handle
 * against the current provider payload before issuing one PUT.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const O = require('./provider-observe.js');
const Forecast = require('../public/forecast.js');

const ROOT = path.join(__dirname, '..');
const DEFAULT_IDENTITY = path.join(ROOT, 'docs', 'connectivity', 'transaction-identity.json');
const SCHEMA = 'atlas-other-spending-category-editor/v1';
const HANDLE_VERSION = 'h1';
const REQUEST_TIMEOUT_MS = 8000;

function fail(code, status, message) {
  const err = new Error(message || code);
  err.code = code;
  err.httpStatus = status || 500;
  throw err;
}

function requireLiveMode(env) {
  const mode = String((env && env.ATLAS_LIVE_OVERLAY) || '').trim().toLowerCase();
  if (mode !== 'live') fail('category-write-unavailable', 503, 'Category editing requires live Lunch Money mode.');
}

function requireSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 16) {
    fail('category-write-unavailable', 503, 'Category editing is unavailable.');
  }
}

function opaqueHandle(secret, kind, id) {
  requireSecret(secret);
  if (id == null || id === '') fail('invalid-provider-identity', 500, 'Provider identity is missing.');
  const mac = crypto.createHmac('sha256', secret)
    .update(`atlas-other-spending:${HANDLE_VERSION}:${kind}:${String(id)}`)
    .digest('base64url');
  return `${HANDLE_VERSION}.${mac}`;
}

function safeIntegerId(value, label) {
  const text = String(value == null ? '' : value);
  if (!/^\d+$/.test(text)) fail('invalid-provider-identity', 409, `${label} is no longer valid.`);
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n <= 0) fail('invalid-provider-identity', 409, `${label} is no longer valid.`);
  return n;
}

function loadIdentity(file) {
  const target = file || DEFAULT_IDENTITY;
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}

function flattenCategories(raw) {
  const out = [];
  const visit = category => {
    if (!category || category.id == null) return;
    const isGroup = category.is_group === true || category.is_group_parent === true;
    if (!isGroup && !category.archived_at) {
      const name = String(category.name || category.display_name || '').trim();
      if (name) out.push({
        providerCategoryId: String(category.id),
        name,
      });
    }
    for (const child of category.children || []) visit(child);
  };
  for (const category of raw || []) visit(category);
  const seen = new Set();
  return out.filter(category => {
    const key = category.providerCategoryId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mappedBudgetRows(plan) {
  const map = new Map();
  const rows = plan && plan.budget && Array.isArray(plan.budget.categories)
    ? plan.budget.categories : [];
  for (const row of rows) {
    if (row && row.id) map.set(String(row.id), row);
  }
  return map;
}

function miniActuals(report, rawTx, data, accountMap, identity) {
  const providerId = String(rawTx.providerTransactionId);
  const miniReport = {
    fetchedAt: report.fetchedAt,
    transactionWindow: report.transactionWindow,
    pendingCoverage: report.pendingCoverage,
    transactions: [rawTx],
    collapsedTransactions: [rawTx],
    representedEventCandidates: (report.representedEventCandidates || [])
      .filter(candidate => String(candidate.providerTransactionId) === providerId),
  };
  return O.sanitizedCurrentPeriodActuals(miniReport, {
    accountMap,
    plan: data.plan,
    billPaymentPayees: identity.billPaymentPayees || [],
    asOf: Forecast.financialDate(report.fetchedAt),
  });
}

function classifyRow(row, plan, packet) {
  return Forecast.classifyCurrentPeriodTransaction(row, plan, {
    packet,
    currentPeriodActuals: packet,
  });
}

function isCurrentOther(row, classification, plan, asOf) {
  if (!row || row.pending === true || row.isGroup === true) return false;
  const amount = Number(row.amount);
  if (!Number.isFinite(amount) || amount <= 0) return false;
  const origin = Forecast.paydayPeriodOrigin(plan, asOf);
  if (!origin || !row.date || row.date < origin || row.date > asOf) return false;
  return classification
    && classification.kind === 'spend'
    && classification.needsConfirmation === true
    && classification.categoryId === 'other-spending';
}

function allowedOptions(row, packet, categories, data, secret) {
  const budgetRows = mappedBudgetRows(data.plan);
  const options = [];
  const seenBudget = new Set();
  for (const category of categories) {
    if (String(category.name) === String(row.categoryLabel || '')) continue;
    const candidate = Object.assign({}, row, { categoryLabel: category.name });
    const candidatePacket = Object.assign({}, packet, { transactions: [candidate] });
    const classification = classifyRow(candidate, data.plan, candidatePacket);
    if (!classification || classification.kind !== 'spend') continue;
    if (classification.needsConfirmation === true || classification.categoryId === 'other-spending') continue;
    const budget = budgetRows.get(String(classification.categoryId));
    if (!budget) continue;
    const budgetKey = String(classification.categoryId) + '|' + category.providerCategoryId;
    if (seenBudget.has(budgetKey)) continue;
    seenBudget.add(budgetKey);
    options.push({
      categoryHandle: opaqueHandle(secret, 'category', category.providerCategoryId),
      lunchMoneyLabel: category.name,
      householdBudgetId: String(classification.categoryId),
      householdBudgetLabel: budget.label || budget.ownerLine || String(classification.categoryId),
      _providerCategoryId: category.providerCategoryId,
    });
  }
  options.sort((a, b) => String(a.householdBudgetLabel).localeCompare(String(b.householdBudgetLabel))
    || String(a.lunchMoneyLabel).localeCompare(String(b.lunchMoneyLabel)));
  return options;
}

async function liveSnapshot(opts) {
  const options = opts || {};
  const env = options.env || process.env;
  const data = options.data;
  const secret = options.secret;
  const now = options.now || new Date().toISOString();
  requireLiveMode(env);
  requireSecret(secret);
  if (!data || !data.plan) fail('category-write-unavailable', 503, 'Atlas plan data is unavailable.');

  const identity = options.identity || loadIdentity(options.identityFile);
  const accountMap = options.accountMap || O.loadLiveAccountMap(env, data);
  const token = options.token || await O.resolveLiveToken({ env });
  const historyDays = O.postedHistoryDaysForCarriedSettlement({
    now,
    plan: data.plan,
    debts: data.debts,
    identity,
  });
  const payload = options.payload || await O.fetchLunchMoneyLive(token, now, historyDays, { env });
  const report = O.observe({
    provider: 'lunchmoney',
    payload,
    accountMap,
    data,
    identity,
    fetchedAt: payload.fetchedAt,
  });
  const asOf = Forecast.financialDate(report.fetchedAt);
  if (!asOf) fail('category-write-unavailable', 503, 'Live provider date is unavailable.');
  const categories = flattenCategories(payload.categories || []);
  const entries = [];

  for (const rawTx of report.collapsedTransactions || []) {
    if (!rawTx || rawTx.providerTransactionId == null) continue;
    if (rawTx.pending === true) continue;
    const packet = miniActuals(report, rawTx, data, accountMap, identity);
    if (!packet || !Array.isArray(packet.transactions) || packet.transactions.length !== 1) continue;
    const row = packet.transactions[0];
    const classification = classifyRow(row, data.plan, packet);
    if (!isCurrentOther(row, classification, data.plan, asOf)) continue;
    const optionsForRow = allowedOptions(row, packet, categories, data, secret);
    if (!optionsForRow.length) continue;
    entries.push({
      transactionHandle: opaqueHandle(secret, 'transaction', rawTx.providerTransactionId),
      date: row.date,
      amount: Math.round(Number(row.amount) * 100) / 100,
      merchant: row.originalMerchant || row.displayedPayee || 'Transaction',
      currentCategory: row.categoryLabel || 'Unassigned',
      options: optionsForRow,
      _providerTransactionId: String(rawTx.providerTransactionId),
    });
  }

  entries.sort((a, b) => String(b.date).localeCompare(String(a.date))
    || String(a.merchant).localeCompare(String(b.merchant))
    || Number(b.amount) - Number(a.amount));

  return { schema: SCHEMA, asOf, token, env, entries };
}

function publicSnapshot(snapshot) {
  return {
    schema: SCHEMA,
    asOf: snapshot.asOf,
    transactions: (snapshot.entries || []).map(entry => ({
      transactionHandle: entry.transactionHandle,
      date: entry.date,
      amount: entry.amount,
      merchant: entry.merchant,
      currentCategory: entry.currentCategory,
      options: (entry.options || []).map(option => ({
        categoryHandle: option.categoryHandle,
        lunchMoneyLabel: option.lunchMoneyLabel,
        householdBudgetId: option.householdBudgetId,
        householdBudgetLabel: option.householdBudgetLabel,
      })),
    })),
  };
}

function requestJson(url, token, method, body) {
  return new Promise((resolve, reject) => {
    const parsed = url instanceof URL ? url : new URL(url);
    const lib = parsed.protocol === 'http:' ? http : https;
    const encoded = body == null ? null : Buffer.from(JSON.stringify(body));
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };
    if (encoded) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(encoded.length);
    }
    let settled = false;
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      if (err) reject(err); else resolve(value);
    };
    const req = lib.request(parsed, { method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode === 401 || res.statusCode === 403) {
          done(Object.assign(new Error('Lunch Money rejected the configured credential.'), { code: 'provider-auth-failed' }));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          done(Object.assign(new Error('Lunch Money rejected the category update.'), { code: 'provider-write-failed' }));
          return;
        }
        if (!text) { done(null, {}); return; }
        try { done(null, JSON.parse(text)); }
        catch (e) { done(Object.assign(new Error('Lunch Money response was not JSON.'), { code: 'provider-write-failed' })); }
      });
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      done(Object.assign(new Error('Lunch Money category update timed out.'), { code: 'provider-write-timeout' }));
    });
    req.on('error', () => done(Object.assign(new Error('Lunch Money category update failed.'), { code: 'provider-write-failed' })));
    if (encoded) req.write(encoded);
    req.end();
  });
}

async function putCategory(snapshot, entry, option, opts) {
  const txId = safeIntegerId(entry._providerTransactionId, 'Transaction');
  const categoryId = safeIntegerId(option._providerCategoryId, 'Category');
  const base = O.lunchMoneyApiBase(snapshot.env);
  const body = { category_id: categoryId };
  const response = opts && opts.putJson
    ? await opts.putJson(new URL(`${base}/transactions/${txId}`), snapshot.token, body)
    : await requestJson(new URL(`${base}/transactions/${txId}`), snapshot.token, 'PUT', body);
  const updated = response && response.transaction ? response.transaction : response;
  if (!updated || Number(updated.id) !== txId || Number(updated.category_id) !== categoryId) {
    fail('provider-confirmation-mismatch', 502, 'Lunch Money did not confirm the exact category update.');
  }
}

async function listEditable(opts) {
  return publicSnapshot(await liveSnapshot(opts));
}

async function applyCategory(opts) {
  const options = opts || {};
  const transactionHandle = String(options.transactionHandle || '');
  const categoryHandle = String(options.categoryHandle || '');
  if (!/^h1\.[A-Za-z0-9_-]+$/.test(transactionHandle)
    || !/^h1\.[A-Za-z0-9_-]+$/.test(categoryHandle)) {
    fail('invalid-category-request', 400, 'Choose a current Other Spending transaction and category.');
  }
  const snapshot = await liveSnapshot(options);
  const matches = snapshot.entries.filter(entry => entry.transactionHandle === transactionHandle);
  if (matches.length !== 1) {
    fail('stale-transaction', 409, 'That transaction is no longer an editable Other Spending item. Refresh and try again.');
  }
  const entry = matches[0];
  const categoryMatches = entry.options.filter(option => option.categoryHandle === categoryHandle);
  if (categoryMatches.length !== 1) {
    fail('invalid-category', 409, 'That category is no longer valid for this Household Budget item. Refresh and try again.');
  }
  const option = categoryMatches[0];
  await putCategory(snapshot, entry, option, options);
  return {
    schema: SCHEMA,
    updated: true,
    householdBudgetId: option.householdBudgetId,
    householdBudgetLabel: option.householdBudgetLabel,
  };
}

function publicError(err) {
  const code = err && err.code ? String(err.code) : 'category-write-failed';
  const allowed = new Set([
    'category-write-unavailable', 'invalid-category-request', 'stale-transaction',
    'invalid-category', 'provider-auth-failed', 'provider-write-failed',
    'provider-write-timeout', 'provider-confirmation-mismatch',
  ]);
  return {
    status: err && Number.isInteger(err.httpStatus) ? err.httpStatus
      : (/^provider-/.test(code) ? 502 : 500),
    body: {
      error: allowed.has(code) ? code : 'category-write-failed',
      message: allowed.has(code) && err && err.message
        ? String(err.message).replace(/\b\d{4,}\b/g, '[id]').slice(0, 180)
        : 'Category update failed. Refresh and try again.',
    },
  };
}

module.exports = {
  SCHEMA,
  HANDLE_VERSION,
  REQUEST_TIMEOUT_MS,
  opaqueHandle,
  flattenCategories,
  miniActuals,
  allowedOptions,
  liveSnapshot,
  publicSnapshot,
  requestJson,
  listEditable,
  applyCategory,
  publicError,
};
