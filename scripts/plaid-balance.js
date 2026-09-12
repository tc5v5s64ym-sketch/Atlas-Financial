'use strict';
/* Read-only Plaid real-time Balance adapter for the incumbent
 * provider-observation boundary (scripts/provider-observe.js).
 *
 * Official contract: POST /accounts/balance/get. Authentication is the Plaid
 * application credential pair (client_id + secret) plus the Item's
 * access_token, sent in the JSON request body. None of the three is an
 * institution login credential; Atlas never holds a bank username, password,
 * PIN, security answer or one-time code.
 *
 * Resolution is environment-only and server-side: PLAID_CLIENT_ID,
 * PLAID_SECRET, PLAID_ACCESS_TOKEN and PLAID_ENV (sandbox | production).
 * Missing or unsupported configuration fails closed before any request.
 * Credential values never appear in a URL, a log line, an error message, a
 * report, a fixture or the browser.
 *
 * This module fetches and normalizes. It does not map accounts, does not
 * reconcile, does not write data.json and is not a planner. Mapping and
 * reconciliation stay in provider-observe.js and reconcile.js.
 */

const http = require('http');
const https = require('https');

const CLIENT_ID_ENV = 'PLAID_CLIENT_ID';
const SECRET_ENV = 'PLAID_SECRET';
const ACCESS_TOKEN_ENV = 'PLAID_ACCESS_TOKEN';
const ENVIRONMENT_ENV = 'PLAID_ENV';
const API_BASE_ENV = 'ATLAS_PLAID_API_BASE';
const BALANCE_PATH = '/accounts/balance/get';
const PLAID_VERSION = '2020-09-14';
const REQUEST_TIMEOUT_MS = 8000;
const HOSTS = Object.freeze({
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
});
const SUPPORTED_ENVIRONMENTS = Object.freeze(Object.keys(HOSTS));
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const CREDENTIAL_ENVS = Object.freeze([CLIENT_ID_ENV, SECRET_ENV, ACCESS_TOKEN_ENV, ENVIRONMENT_ENV]);
const ISO_CURRENCY_RE = /^[A-Z]{3}$/;

function fail(message) {
  const err = new Error(message);
  err.code = 'plaid-observe-failed';
  throw err;
}

function envValue(env, key) {
  const raw = env && env[key];
  if (raw == null) return null;
  const value = String(raw).trim();
  return value === '' ? null : value;
}

// True when the owner has explicitly placed any Plaid configuration in the
// environment. Nothing in production consumes this yet; it exists so a
// caller can state honestly whether Plaid is configured at all.
function plaidConfigPresent(env) {
  const source = env || process.env;
  return CREDENTIAL_ENVS.some(key => envValue(source, key) != null);
}

function resolvePlaidCredential(options) {
  const env = (options && options.env) || process.env;
  const missing = [CLIENT_ID_ENV, SECRET_ENV, ACCESS_TOKEN_ENV].filter(key => envValue(env, key) == null);
  if (missing.length) {
    fail(`${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. Plaid read-only balance observation has no credential. Values are never logged.`);
  }
  const environment = envValue(env, ENVIRONMENT_ENV);
  if (!environment) {
    fail(`${ENVIRONMENT_ENV} is not set. Use one of: ${SUPPORTED_ENVIRONMENTS.join(', ')}.`);
  }
  if (!HOSTS[environment]) {
    fail(`${ENVIRONMENT_ENV} is not supported. Use one of: ${SUPPORTED_ENVIRONMENTS.join(', ')}.`);
  }
  return {
    clientId: envValue(env, CLIENT_ID_ENV),
    secret: envValue(env, SECRET_ENV),
    accessToken: envValue(env, ACCESS_TOKEN_ENV),
    environment,
    source: 'env',
  };
}

function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(String(hostname || ''));
}

function plaidApiBase(env, environment) {
  const source = env || process.env;
  const override = envValue(source, API_BASE_ENV);
  if (override) {
    let parsed;
    try {
      parsed = new URL(override);
    } catch (e) {
      fail(`${API_BASE_ENV} is not a URL.`);
    }
    if (!isLoopbackHost(parsed.hostname)) {
      fail(`${API_BASE_ENV} may only point at a loopback host.`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      fail(`${API_BASE_ENV} must be http or https.`);
    }
    return override.replace(/\/$/, '');
  }
  const host = HOSTS[environment];
  if (!host) fail(`Plaid environment is not supported. Use one of: ${SUPPORTED_ENVIRONMENTS.join(', ')}.`);
  return host;
}

function assertCredential(credential) {
  if (!credential || typeof credential !== 'object') fail('Plaid credential is missing.');
  for (const key of ['clientId', 'secret', 'accessToken']) {
    if (credential[key] == null || String(credential[key]).trim() === '') {
      fail('Plaid credential is incomplete. Values are never logged.');
    }
  }
}

// The exact wire shape. Credentials travel only in the JSON body, never in
// the URL, never in a header that a proxy log would keep.
function balanceRequest(credential, options) {
  assertCredential(credential);
  const env = (options && options.env) || process.env;
  const base = plaidApiBase(env, credential.environment);
  const url = new URL(base + BALANCE_PATH);
  if (url.search) fail('Plaid balance request URL must not carry query parameters.');
  const body = {
    client_id: credential.clientId,
    secret: credential.secret,
    access_token: credential.accessToken,
  };
  const accountIds = options && options.accountIds;
  if (Array.isArray(accountIds) && accountIds.length) {
    body.options = { account_ids: accountIds.map(String) };
  }
  return {
    url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Plaid-Version': PLAID_VERSION,
    },
    body: JSON.stringify(body),
  };
}

function requestLibFor(url) {
  return url.protocol === 'http:' ? http : https;
}

function plaidErrorSummary(body) {
  if (!body || typeof body !== 'object') return null;
  const type = body.error_type ? String(body.error_type) : null;
  const code = body.error_code ? String(body.error_code) : null;
  if (!type && !code) return null;
  return [type, code].filter(Boolean).join('/');
}

function postJson(request) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(value);
    };
    const lib = requestLibFor(request.url);
    const req = lib.request(request.url, {
      method: request.method,
      headers: Object.assign({}, request.headers, {
        'Content-Length': Buffer.byteLength(request.body, 'utf8'),
      }),
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = JSON.parse(text || '{}'); }
        catch (e) { parsed = undefined; }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const summary = parsed === undefined ? null : plaidErrorSummary(parsed);
          done(new Error(
            `Plaid POST ${BALANCE_PATH} failed with HTTP ${res.statusCode}`
            + (summary ? ` (${summary})` : '')
            + '. Credentials are not logged.'
          ));
          return;
        }
        if (parsed === undefined) {
          done(new Error('Plaid response was not JSON.'));
          return;
        }
        done(null, parsed);
      });
    });
    if (typeof req.setTimeout === 'function') {
      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        if (typeof req.destroy === 'function') req.destroy();
        done(new Error('Plaid request timeout.'));
      });
    }
    req.on('error', () => {
      done(new Error('Plaid request failed.'));
    });
    req.end(request.body);
  });
}

async function fetchPlaidBalancesLive(credential, now, options) {
  assertCredential(credential);
  if (!HOSTS[credential.environment]) {
    fail(`Plaid environment is not supported. Use one of: ${SUPPORTED_ENVIRONMENTS.join(', ')}.`);
  }
  const request = balanceRequest(credential, options);
  const payload = await postJson(request);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('Plaid balance response is not an object.');
  }
  return {
    provider: 'plaid',
    fetchedAt: now,
    environment: credential.environment,
    endpoint: `POST ${BALANCE_PATH}`,
    accounts: payload.accounts,
    request_id: payload.request_id == null ? null : String(payload.request_id),
  };
}

function finiteOrNull(value, label) {
  if (value == null) return null;
  const n = Number(value);
  if (typeof value === 'boolean' || typeof value === 'object' || !isFinite(n)) {
    fail(`Plaid account balances.${label} is malformed.`);
  }
  return n;
}

function isoCurrency(value) {
  if (value == null) return null;
  const code = String(value).trim().toUpperCase();
  if (!ISO_CURRENCY_RE.test(code)) fail('Plaid account iso_currency_code is malformed.');
  return code;
}

// Same normalized-account shape provider-observe.js uses for Lunch Money so
// observationsFromMappedAccount needs no second contract. Plaid `current`
// is the posted balance (positive owed for credit accounts); `available`
// and `limit` keep their own fields. mask, official_name and
// persistent_account_id are dropped: they are not needed for identity and
// a partial account number is not published.
function normalizePlaidAccount(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Plaid account is malformed.');
  if (raw.account_id == null || String(raw.account_id).trim() === '') {
    fail('Plaid account is missing a stable account_id.');
  }
  const balances = raw.balances;
  if (!balances || typeof balances !== 'object' || Array.isArray(balances)) {
    fail('Plaid account balances are malformed.');
  }
  return {
    provider: 'plaid',
    providerAccountId: String(raw.account_id),
    displayName: raw.name == null ? null : String(raw.name),
    institutionName: null,
    type: raw.type == null ? null : String(raw.type),
    subtype: raw.subtype == null ? null : String(raw.subtype),
    currency: isoCurrency(balances.iso_currency_code),
    unofficialCurrency: balances.unofficial_currency_code == null
      ? null
      : String(balances.unofficial_currency_code),
    balance: finiteOrNull(balances.current, 'current'),
    available: finiteOrNull(balances.available, 'available'),
    limit: finiteOrNull(balances.limit, 'limit'),
    updatedAt: null,
    balanceAsOf: balances.last_updated_datetime == null ? null : String(balances.last_updated_datetime),
    dateLastFetched: null,
  };
}

function normalizePlaidBalancePayload(payload, fetchedAt) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('Plaid balance payload is not an object.');
  }
  if (!Array.isArray(payload.accounts)) fail('Plaid balance payload has no accounts array.');
  if (!payload.accounts.length) fail('Plaid balance payload returned zero accounts.');
  const accounts = payload.accounts.map(normalizePlaidAccount);
  const seen = new Set();
  for (const account of accounts) {
    if (seen.has(account.providerAccountId)) fail('Plaid balance payload repeats an account_id.');
    seen.add(account.providerAccountId);
  }
  return {
    provider: 'plaid',
    fetchedAt: payload.fetchedAt || fetchedAt,
    environment: payload.environment == null ? null : String(payload.environment),
    endpoint: `POST ${BALANCE_PATH}`,
    accounts,
    transactions: [],
    transactionWindow: {
      startDate: null,
      endDate: null,
      complete: null,
      hasMore: null,
      truncated: false,
    },
  };
}

module.exports = {
  CLIENT_ID_ENV,
  SECRET_ENV,
  ACCESS_TOKEN_ENV,
  ENVIRONMENT_ENV,
  API_BASE_ENV,
  CREDENTIAL_ENVS,
  BALANCE_PATH,
  PLAID_VERSION,
  HOSTS,
  SUPPORTED_ENVIRONMENTS,
  REQUEST_TIMEOUT_MS,
  plaidConfigPresent,
  resolvePlaidCredential,
  plaidApiBase,
  balanceRequest,
  postJson,
  fetchPlaidBalancesLive,
  normalizePlaidAccount,
  normalizePlaidBalancePayload,
};
