'use strict';
/* Inert Lunch Money recurring-items read (GET /recurring_items).
 *
 * This module is NOT wired to any routine, server, assistant/MCP surface, or
 * scheduler. It exposes no tool and performs no call unless a future,
 * separately reviewed consumer invokes it with a credential. It exists so a
 * future consumer can read the provider's own recurring-item evidence
 * without re-deriving cadence from transactions.
 *
 * Provider recurring items are provider-detected / provider-declared
 * EVIDENCE — never Forecast bills or obligations, and never proof of
 * payment. An expected occurrence with no found transaction is not evidence
 * of an unpaid bill, and `missing_transaction_dates` is never read as
 * "unpaid" or "overdue" here. No settlement is inferred, nothing is
 * reclassified, and no bills or totals are produced.
 *
 * Official contract pinned from the Lunch Money v2.11.1 OpenAPI
 * `recurringObject`, the same specification the capability audit in PR #562
 * cites:
 *   GET /recurring_items — UNPAGINATED. Parameters are only start_date /
 *   end_date (they set the range that populates each item's `matches`; they
 *   do NOT filter which items return; provider default is the current month
 *   when omitted) and include_suggested. The whole list arrives in one
 *   response, in a top-level `recurring_items` array.
 *   recurringObject: id (int32), description (nullable), status enum
 *   suggested|reviewed (only reviewed items are applied to matching
 *   transactions), transaction_criteria {start/end dates (nullable),
 *   granularity day|week|month|year, quantity, anchor_date, payee
 *   (nullable), amount as an exact decimal STRING ^-?\d+(\.\d{1,4})?$,
 *   to_base (provider-computed currency conversion, JSON number), currency
 *   (lowercase, non-null), plaid_account_id / manual_account_id (nullable)},
 *   overrides {payee, notes, category_id}, matches (null for suggested
 *   items; otherwise expected_occurrence_dates / found_transactions /
 *   missing_transaction_dates for the requested range), created_by,
 *   created_at / updated_at, source manual|transaction|system (older items
 *   may carry null).
 *
 * Deliberate omission: `to_base` is dropped entirely. It is the provider's
 * own currency conversion; carrying it risks it being read as an Atlas
 * figure. The native amount string and currency are preserved exactly.
 *
 * Identity and failure semantics (agreed scope):
 *   - A missing, duplicate, or non-integer item id fails the whole read.
 *     Ids are opaque within one read only: the spec calls id unique but
 *     documents no stability guarantee across criteria edits or
 *     delete/recreate, so no cross-read lifecycle identity is promised.
 *     (The spec types id as int32; this module checks integer identity
 *     only and does not invent a sign or range rule the spec omits.)
 *   - Malformed semantic fields are marked explicitly unavailable per
 *     field and make the envelope incomplete — never coerced, never
 *     defaulted (an out-of-enum status is unavailable, never "reviewed"),
 *     and never a fabricated zero.
 *   - Documented nullable/optional fields are preserved as null WITHOUT
 *     being marked unavailable: a valid null is not a provider failure.
 *     An absent `source` is unavailable provenance, not an invented
 *     identity; a present null `source` (documented on older items) is
 *     preserved as null.
 *   - Evidence of unexpected pagination (a has_more / cursor / next /
 *     total_pages style member) fails the read: this endpoint's documented
 *     contract has no pagination, so such evidence means the response is
 *     not the complete documented list. Harmless unknown additive fields —
 *     on items or on the envelope — are ignored, not rejected.
 *   - `complete` means ONLY that the single documented response was
 *     retrieved whole and every returned item validated. It never proves
 *     the household ledger or all bill obligations complete.
 *
 * Raw provider IDs stay inside this trust boundary. They are preserved
 * here because a recurring-evidence reader must key on them, but they must
 * never cross an assistant/MCP response, a public log, or a fixture
 * (ARCHITECTURE.md OAuth boundary). Tests use synthetic IDs only.
 *
 * Transport is a module-local minimal GET mirroring the incumbent
 * scripts/provider-observe.js behavior: Bearer credential held in memory
 * only, sanitized errors (status codes only, never bodies or the token),
 * an 8s timeout, and a bounded response body. Redirects are never followed
 * (a 3xx is an error), so the Authorization header can never be forwarded
 * to another destination. The only permitted destinations are the
 * documented production base and — with an explicit test-only opt-in — a
 * loopback base; the production base itself is never overridable except
 * through the incumbent loopback-only ATLAS_LUNCHMONEY_API_BASE guard.
 */

const http = require('http');
const https = require('https');

const ProviderObserve = require('./provider-observe.js');

const SCHEMA = 'atlas-lunchmoney-recurring-items/v1';
const TOKEN_ENV = 'LUNCHMONEY_ACCESS_TOKEN';
const LIVE_BASE = ProviderObserve.LIVE_BASE;
const RECURRING_ITEMS_PATH = '/recurring_items';
const REQUEST_TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

const CAVEAT = 'Provider recurring items are provider-detected or '
  + 'provider-declared evidence — not Forecast bills or obligations, and '
  + 'not proof of payment. An expected occurrence with no found '
  + 'transaction is not evidence of an unpaid bill. complete=true means '
  + 'only that the single documented GET /recurring_items response was '
  + 'retrieved whole and every returned item validated; it never proves '
  + 'the household ledger or all bill obligations complete.';
const ID_STABILITY = 'UNKNOWN — the provider documents id as unique but '
  + 'gives no stability guarantee across criteria edits or '
  + 'delete/recreate; ids are treated as opaque within one read only and '
  + 'no cross-read lifecycle identity is promised.';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const STATUS_VALUES = new Set(['suggested', 'reviewed']);
const GRANULARITY_VALUES = new Set(['day', 'week', 'month', 'year']);
const SOURCE_VALUES = new Set(['manual', 'transaction', 'system']);
const AMOUNT_PATTERN = /^-?\d+(\.\d{1,4})?$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CURRENCY_PATTERN = /^[a-z]{3}$/;
// Members that would be evidence the response is paginated — a contract
// this endpoint does not have. Their presence fails the read rather than
// letting a partial list pose as complete.
const PAGINATION_KEYS = new Set([
  'has_more', 'next_cursor', 'cursor', 'next', 'next_page',
  'total_pages', 'page_count',
]);

function unavailable(reason) {
  return { unavailable: true, reason };
}

function isUnavailable(value) {
  return Boolean(value) && typeof value === 'object' && value.unavailable === true;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidCalendarDate(value) {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function isTimestampString(value) {
  return typeof value === 'string'
    && value.includes('T')
    && Number.isFinite(Date.parse(value));
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function resolveBase(base, fetchOptions) {
  const resolved = base === undefined ? ProviderObserve.lunchMoneyApiBase() : base;
  if (typeof resolved !== 'string' || resolved.trim() === '') {
    throw new Error('Recurring items base must be a non-empty URL string.');
  }
  const trimmed = resolved.trim().replace(/\/$/, '');
  if (trimmed === LIVE_BASE) return trimmed;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    throw new Error('Recurring items base is not a URL.');
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error('Recurring items base may only be the documented production base or a loopback host.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Recurring items base must be http or https.');
  }
  // Loopback injection is explicit and test-only: a loopback base is
  // refused unless the caller opted in through fetchOptions.
  if (!fetchOptions || fetchOptions.allowLoopback !== true) {
    throw new Error('Recurring items loopback base requires the explicit test-only allowLoopback option.');
  }
  return trimmed;
}

function validateWindow(startDate, endDate) {
  const hasStart = startDate !== undefined && startDate !== null;
  const hasEnd = endDate !== undefined && endDate !== null;
  if (hasStart !== hasEnd) {
    throw new Error('Recurring items startDate and endDate must be supplied together or not at all.');
  }
  if (!hasStart) return { requested: false, startDate: null, endDate: null };
  if (!isValidCalendarDate(startDate) || !isValidCalendarDate(endDate)) {
    throw new Error('Recurring items startDate and endDate must be valid YYYY-MM-DD calendar dates.');
  }
  // Both are validated YYYY-MM-DD, so lexicographic order is date order.
  if (endDate < startDate) {
    throw new Error('Recurring items endDate must not be before startDate.');
  }
  return { requested: true, startDate, endDate };
}

function buildRecurringItemsUrl({ startDate, endDate, includeSuggested, base } = {}) {
  const window = validateWindow(startDate, endDate);
  const suggested = includeSuggested === undefined ? false : includeSuggested;
  if (typeof suggested !== 'boolean') {
    throw new Error('Recurring items includeSuggested must be a boolean.');
  }
  const url = new URL(`${base || LIVE_BASE}${RECURRING_ITEMS_PATH}`);
  // include_suggested is always sent explicitly: the spec does not state
  // the omitted-value default, so the reader never relies on it.
  url.searchParams.set('include_suggested', suggested ? 'true' : 'false');
  if (window.requested) {
    url.searchParams.set('start_date', window.startDate);
    url.searchParams.set('end_date', window.endDate);
  }
  return url;
}

// Module-local minimal GET. Mirrors the incumbent's sanitized-error and
// timeout behavior. http(s).request never follows redirects, and any 3xx
// is treated as an error below, so credentials are never forwarded.
function httpsGetJson(url, token, options) {
  const timeoutMs = options && Number.isFinite(options.timeoutMs)
    ? options.timeoutMs
    : REQUEST_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(value);
    };
    const lib = url.protocol === 'http:' ? http : https;
    const req = lib.request(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    }, (res) => {
      const chunks = [];
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          if (typeof res.destroy === 'function') res.destroy();
          done(new Error('Lunch Money recurring items response exceeded the size bound.'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('aborted', () => done(new Error('Lunch Money request failed.')));
      res.on('error', () => done(new Error('Lunch Money request failed.')));
      res.on('end', () => {
        if (res.statusCode === 401 || res.statusCode === 403) {
          done(new Error('Lunch Money rejected the access token. Token value is not logged.'));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          done(new Error(`Lunch Money GET ${url.pathname} failed with HTTP ${res.statusCode}.`));
          return;
        }
        const declared = Number(res.headers && res.headers['content-length']);
        if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
          done(new Error('Lunch Money recurring items response exceeded the size bound.'));
          return;
        }
        try {
          done(null, JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
        } catch (err) {
          done(new Error('Lunch Money response was not JSON.'));
        }
      });
    });
    if (typeof req.setTimeout === 'function') {
      req.setTimeout(timeoutMs, () => {
        if (typeof req.destroy === 'function') req.destroy();
        done(new Error('Lunch Money request timeout.'));
      });
    }
    req.on('error', () => done(new Error('Lunch Money request failed.')));
    req.end();
  });
}

// ---- Field mapping -------------------------------------------------------
// Every mapper returns the verbatim value, a documented null, or an
// `unavailable` marker, and records the field path in `missing` when it
// marks one. Nothing is coerced and nothing is defaulted.

function mapNullableDate(value, path, missing) {
  if (value === null) return null;
  if (isValidCalendarDate(value)) return value;
  missing.push(path);
  return unavailable(`${path} is missing or is not a valid YYYY-MM-DD date.`);
}

function mapNullableString(value, path, missing) {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  missing.push(path);
  return unavailable(`${path} is missing or is not a string.`);
}

function mapNullableAccountId(value, path, missing) {
  if (value === null) return null;
  if (isPositiveInteger(value)) return value;
  missing.push(path);
  return unavailable(`${path} is present but is not a positive integer or null.`);
}

function mapCriteria(raw, missing) {
  if (!isPlainObject(raw)) {
    const fields = [
      'transactionCriteria.startDate', 'transactionCriteria.endDate',
      'transactionCriteria.granularity', 'transactionCriteria.quantity',
      'transactionCriteria.anchorDate', 'transactionCriteria.payee',
      'transactionCriteria.amount', 'transactionCriteria.currency',
      'transactionCriteria.plaidAccountId', 'transactionCriteria.manualAccountId',
    ];
    for (const field of fields) missing.push(field);
    return unavailable('transaction_criteria is missing or is not an object.');
  }
  const criteria = {};
  criteria.startDate = mapNullableDate(raw.start_date, 'transactionCriteria.startDate', missing);
  criteria.endDate = mapNullableDate(raw.end_date, 'transactionCriteria.endDate', missing);
  if (typeof raw.granularity === 'string' && GRANULARITY_VALUES.has(raw.granularity)) {
    criteria.granularity = raw.granularity;
  } else {
    missing.push('transactionCriteria.granularity');
    criteria.granularity = unavailable('transactionCriteria.granularity is missing or is outside the documented enum.');
  }
  if (Number.isInteger(raw.quantity) && raw.quantity >= 1) {
    criteria.quantity = raw.quantity;
  } else {
    missing.push('transactionCriteria.quantity');
    criteria.quantity = unavailable('transactionCriteria.quantity is missing or is not a positive integer.');
  }
  if (isValidCalendarDate(raw.anchor_date)) {
    criteria.anchorDate = raw.anchor_date;
  } else {
    missing.push('transactionCriteria.anchorDate');
    criteria.anchorDate = unavailable('transactionCriteria.anchorDate is missing or is not a valid YYYY-MM-DD date.');
  }
  criteria.payee = mapNullableString(raw.payee, 'transactionCriteria.payee', missing);
  // Amount is the provider's exact decimal STRING, preserved verbatim.
  // A JSON number, >4 decimal places, a non-numeric string, null, or a
  // missing value is unavailable — never 0, never re-typed.
  // `to_base` is deliberately not read (see header).
  if (typeof raw.amount === 'string' && AMOUNT_PATTERN.test(raw.amount)) {
    criteria.amount = raw.amount;
  } else {
    missing.push('transactionCriteria.amount');
    criteria.amount = unavailable('transactionCriteria.amount is missing or is not an exact decimal string.');
  }
  if (typeof raw.currency === 'string' && CURRENCY_PATTERN.test(raw.currency)) {
    criteria.currency = raw.currency;
  } else {
    missing.push('transactionCriteria.currency');
    criteria.currency = unavailable('transactionCriteria.currency is missing or is not a lowercase currency code.');
  }
  criteria.plaidAccountId = mapNullableAccountId(raw.plaid_account_id, 'transactionCriteria.plaidAccountId', missing);
  criteria.manualAccountId = mapNullableAccountId(raw.manual_account_id, 'transactionCriteria.manualAccountId', missing);
  return criteria;
}

function mapOverrides(raw, missing) {
  if (raw === undefined) return null; // documented optional object, absent
  if (!isPlainObject(raw)) {
    missing.push('overrides');
    return unavailable('overrides is present but is not an object.');
  }
  const overrides = {};
  overrides.payee = mapNullableString(raw.payee, 'overrides.payee', missing);
  overrides.notes = mapNullableString(raw.notes, 'overrides.notes', missing);
  if (raw.category_id === null) overrides.categoryId = null;
  else if (isPositiveInteger(raw.category_id)) overrides.categoryId = raw.category_id;
  else {
    missing.push('overrides.categoryId');
    overrides.categoryId = unavailable('overrides.categoryId is present but is not a positive integer or null.');
  }
  return overrides;
}

function isDateArray(value) {
  return Array.isArray(value) && value.every(isValidCalendarDate);
}

function mapMatches(raw, status, missing) {
  // The documented shape of matches depends on status; when status itself
  // is unavailable the expected shape is unknown, so matches cannot be
  // validated either.
  if (isUnavailable(status)) {
    missing.push('matches');
    return unavailable('matches cannot be validated because status is unavailable.');
  }
  if (status === 'suggested') {
    if (raw === null) return null; // documented: null for suggested items
    missing.push('matches');
    return unavailable('matches is present for a suggested item; the documented shape is null.');
  }
  // status === 'reviewed'
  if (!isPlainObject(raw)
    || !isDateArray(raw.expected_occurrence_dates)
    || !Array.isArray(raw.found_transactions)
    || !raw.found_transactions.every(isPositiveInteger)
    || !isDateArray(raw.missing_transaction_dates)) {
    missing.push('matches');
    return unavailable('matches is missing or does not match the documented reviewed shape.');
  }
  // Found transaction ids stay inside this trust boundary (see header).
  // missing_transaction_dates is preserved verbatim; it is expected
  // occurrences with no found transaction — never "unpaid" or "overdue".
  return {
    expectedOccurrenceDates: raw.expected_occurrence_dates.slice(),
    foundTransactionIds: raw.found_transactions.slice(),
    missingTransactionDates: raw.missing_transaction_dates.slice(),
  };
}

function mapRecurringItem(raw) {
  const missing = [];
  const item = {};
  item.providerRecurringItemId = raw.id;
  if (raw.description === null) item.description = null;
  else if (typeof raw.description === 'string') item.description = raw.description;
  else {
    missing.push('description');
    item.description = unavailable('description is missing or is not a string.');
  }
  if (typeof raw.status === 'string' && STATUS_VALUES.has(raw.status)) {
    item.status = raw.status;
  } else {
    missing.push('status');
    item.status = unavailable('status is missing or is outside the documented enum; it is never defaulted.');
  }
  item.transactionCriteria = mapCriteria(raw.transaction_criteria, missing);
  item.overrides = mapOverrides(raw.overrides, missing);
  item.matches = mapMatches(raw.matches, item.status, missing);
  // created_by is an opaque provider-side label, preserved verbatim; it is
  // not a provider id and never a household identity.
  if (typeof raw.created_by === 'string' && raw.created_by !== '') {
    item.createdBy = raw.created_by;
  } else {
    missing.push('createdBy');
    item.createdBy = unavailable('created_by is missing or is not a non-empty string.');
  }
  if (isTimestampString(raw.created_at)) item.createdAt = raw.created_at;
  else {
    missing.push('createdAt');
    item.createdAt = unavailable('created_at is missing or is not a timestamp string.');
  }
  if (isTimestampString(raw.updated_at)) item.updatedAt = raw.updated_at;
  else {
    missing.push('updatedAt');
    item.updatedAt = unavailable('updated_at is missing or is not a timestamp string.');
  }
  if (raw.source === undefined) {
    missing.push('source');
    item.source = unavailable('source is absent; provenance is unavailable, never invented.');
  } else if (raw.source === null) {
    item.source = null; // documented on older items — a valid null
  } else if (typeof raw.source === 'string' && SOURCE_VALUES.has(raw.source)) {
    item.source = raw.source;
  } else {
    missing.push('source');
    item.source = unavailable('source is present but is outside the documented enum.');
  }
  item.unavailableFields = missing;
  return item;
}

function mapRecurringItemsPayload(payload, context) {
  if (!isPlainObject(payload)) {
    throw new Error('Lunch Money recurring items response was not an object envelope.');
  }
  for (const key of Object.keys(payload)) {
    if (PAGINATION_KEYS.has(key)) {
      throw new Error('Lunch Money recurring items response carried unexpected pagination evidence; the documented endpoint is unpaginated, so the read fails rather than presenting a partial list as complete.');
    }
  }
  if (!Array.isArray(payload.recurring_items)) {
    throw new Error('Lunch Money recurring items response did not carry a recurring_items array.');
  }
  const seen = new Set();
  const items = payload.recurring_items.map((raw) => {
    if (!isPlainObject(raw)) {
      throw new Error('Lunch Money recurring item was not an object; the read fails with no partial items.');
    }
    // Identity errors fail the whole read (agreed Q5 split).
    if (!Number.isInteger(raw.id)) {
      throw new Error('Lunch Money recurring item is missing a valid integer id; the read fails with no partial items.');
    }
    if (seen.has(raw.id)) {
      throw new Error('Lunch Money recurring items carried a duplicate id; the read fails with no partial items.');
    }
    seen.add(raw.id);
    return mapRecurringItem(raw);
  });
  const incompleteItems = items.filter((item) => item.unavailableFields.length > 0).length;
  return {
    schema: SCHEMA,
    startDate: context.startDate,
    endDate: context.endDate,
    matchWindow: context.requested ? 'requested' : 'provider-default',
    includeSuggested: context.includeSuggested,
    // complete = the single documented response was retrieved whole and
    // every item validated. Nothing more (see CAVEAT).
    complete: incompleteItems === 0,
    itemCount: items.length,
    validationCounts: {
      total: items.length,
      complete: items.length - incompleteItems,
      incomplete: incompleteItems,
    },
    caveat: CAVEAT,
    idStability: ID_STABILITY,
    items,
  };
}

async function fetchRecurringItems({ token, base, startDate, endDate, includeSuggested, fetchOptions } = {}) {
  if (typeof token !== 'string' || token.trim() === '') {
    throw new Error('Recurring items read requires a Lunch Money access token; no request was made.');
  }
  const window = validateWindow(startDate, endDate);
  const suggested = includeSuggested === undefined ? false : includeSuggested;
  if (typeof suggested !== 'boolean') {
    throw new Error('Recurring items includeSuggested must be a boolean.');
  }
  const resolvedBase = resolveBase(base, fetchOptions);
  const url = buildRecurringItemsUrl({
    startDate: window.startDate,
    endDate: window.endDate,
    includeSuggested: suggested,
    base: resolvedBase,
  });
  const payload = await httpsGetJson(url, token, fetchOptions);
  return mapRecurringItemsPayload(payload, {
    requested: window.requested,
    startDate: window.startDate,
    endDate: window.endDate,
    includeSuggested: suggested,
  });
}

// Live entry: token from the environment only (never logged, never
// persisted), base through the incumbent loopback-only env guard. A
// loopback base arriving through that guard is an explicit local
// configuration, so it satisfies the test-only opt-in here; an explicit
// loopback `base` argument to fetchRecurringItems still requires the
// caller's own opt-in.
async function fetchRecurringItemsLive({ env, startDate, endDate, includeSuggested } = {}) {
  const source = env || process.env;
  const token = source && source[TOKEN_ENV];
  if (typeof token !== 'string' || token.trim() === '') {
    throw new Error(`Recurring items live read requires ${TOKEN_ENV}; no request was made.`);
  }
  const base = ProviderObserve.lunchMoneyApiBase(source);
  return fetchRecurringItems({
    token,
    base,
    startDate,
    endDate,
    includeSuggested,
    fetchOptions: { allowLoopback: base !== LIVE_BASE },
  });
}

const api = {
  SCHEMA,
  TOKEN_ENV,
  LIVE_BASE,
  RECURRING_ITEMS_PATH,
  REQUEST_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  CAVEAT,
  ID_STABILITY,
  buildRecurringItemsUrl,
  fetchRecurringItems,
  fetchRecurringItemsLive,
  mapRecurringItemsPayload,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
