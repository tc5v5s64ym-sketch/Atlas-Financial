'use strict';
/* Read-only provider observation → B91 reconciliation.
 *
 *   node scripts/provider-observe.js --provider lunchmoney --fixture <file>
 *   node scripts/provider-observe.js --provider lunchmoney --live
 *
 * Live mode requires LUNCHMONEY_ACCESS_TOKEN in the environment. It never
 * writes data.json. Unknown provider account IDs stay unmapped.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const R = require('./reconcile.js');

const ROOT = path.join(__dirname, '..');
const DEFAULT_MAP = path.join(ROOT, 'docs', 'connectivity', 'provider-account-map.json');
const DEFAULT_DATA = path.join(ROOT, 'data.json');
const LIVE_BASE = 'https://api.lunchmoney.dev/v2';
const TOKEN_ENV = 'LUNCHMONEY_ACCESS_TOKEN';
const CASH_ROLES = new Set(['household-cash']);
const CREDIT_ROLES = new Set(['revolving-credit']);

function fail(message) {
  const err = new Error(message);
  err.code = 'observe-failed';
  throw err;
}

function parseArgs(argv) {
  const out = { provider: null, fixture: null, live: false, map: DEFAULT_MAP, data: DEFAULT_DATA };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--provider') out.provider = argv[++i];
    else if (a === '--fixture') out.fixture = argv[++i];
    else if (a === '--live') out.live = true;
    else if (a === '--map') out.map = argv[++i];
    else if (a === '--data') out.data = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function mappingFor(mapDoc, providerAccountId) {
  const id = String(providerAccountId);
  return (mapDoc.mappings || []).find(m => String(m.providerAccountId) === id) || null;
}

function dateOnly(value) {
  if (!value) return null;
  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : s;
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

async function fetchLunchMoneyLive(token, now) {
  if (!token) fail(`${TOKEN_ENV} is not set. Live observation refuses to run.`);
  const txUrl = new URL(`${LIVE_BASE}/transactions`);
  const end = dateOnly(now);
  const start = dateOnly(new Date(Date.parse(now) - 14 * 86400000).toISOString());
  txUrl.searchParams.set('start_date', start);
  txUrl.searchParams.set('end_date', end);
  await httpsGetJson(new URL(`${LIVE_BASE}/me`), token);
  const plaid = await tryGetJson(new URL(`${LIVE_BASE}/plaid_accounts`), token);
  let manuals = await tryGetJson(new URL(`${LIVE_BASE}/manual_accounts`), token);
  if (!manuals) manuals = await tryGetJson(new URL(`${LIVE_BASE}/assets`), token);
  const txPayload = await httpsGetJson(txUrl, token);
  return {
    provider: 'lunchmoney',
    fetchedAt: now,
    accounts: accountsFromLivePayloads(plaid, manuals),
    transactions: (txPayload && txPayload.transactions) || [],
  };
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
    observations.push(...observationsFromMappedAccount(account, mapping, normalized.fetchedAt));
  }
  const compareObs = observations.filter(o => !R.CARD_FACTS.has(o.fact));
  const cardObs = observations.filter(o => R.CARD_FACTS.has(o.fact));
  const result = R.reconcile({
    data: input.data,
    map: input.balanceMap || { mappings: [] },
    observations: compareObs,
    cardObservations: cardObs,
  });
  return {
    writesCanonicalState: false,
    provider: 'lunchmoney',
    fetchedAt: normalized.fetchedAt,
    mapped,
    unmapped,
    transactions: normalized.transactions,
    observations,
    spendableCash: spendableCashFromObservations(observations),
    cardCapacityIsCash: R.householdCashFromCardCapacity(),
    reconciliation: result,
  };
}

async function run(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write('Usage: node scripts/provider-observe.js --provider lunchmoney --fixture <file>\n');
    return 0;
  }
  if (args.provider !== 'lunchmoney') fail('Only --provider lunchmoney is implemented in this spike.');
  if (args.live && args.fixture) fail('Use either --fixture or --live, not both.');
  if (!args.live && !args.fixture) fail('Pass --fixture <file> or --live.');
  const accountMap = loadJson(args.map);
  const data = loadJson(args.data);
  let payload;
  if (args.live) {
    payload = await fetchLunchMoneyLive(process.env[TOKEN_ENV], new Date().toISOString());
  } else {
    payload = loadJson(args.fixture);
  }
  const report = observe({
    provider: 'lunchmoney',
    payload,
    accountMap,
    data,
    fetchedAt: payload.fetchedAt,
  });
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  return 0;
}

const api = {
  TOKEN_ENV,
  LIVE_BASE,
  parseArgs,
  mappingFor,
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
