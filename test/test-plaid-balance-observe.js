'use strict';
/* Read-only Plaid real-time Balance into the incumbent provider-observation
 * boundary. Independent of Forecast. Does not write data.json. Does not treat
 * available credit as cash. Uses synthetic credentials and a loopback mock of
 * POST /accounts/balance/get; a mocked Plaid success is not live TD proof.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFileSync, spawnSync, spawn } = require('child_process');
const O = require('../scripts/provider-observe.js');
const P = require('../scripts/plaid-balance.js');
const R = require('../scripts/reconcile.js');

const ROOT = path.join(__dirname, '..');
const OBSERVE_JS = path.join(ROOT, 'scripts', 'provider-observe.js');
const FIXTURE = path.join(ROOT, 'docs', 'connectivity', 'fixtures', 'plaid-balance-sample.json');
const MAP = path.join(ROOT, 'docs', 'connectivity', 'fixtures', 'plaid-account-map.json');
const LM_MAP = path.join(ROOT, 'docs', 'connectivity', 'fixtures', 'provider-account-map.json');
const LM_FIXTURE = path.join(ROOT, 'docs', 'connectivity', 'fixtures', 'lunchmoney-sample.json');
const DATA = path.join(ROOT, 'data.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const hashFile = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const clone = x => JSON.parse(JSON.stringify(x));
const throwsWith = (fn, re) => {
  try { fn(); return { threw: false, message: '' }; }
  catch (e) { return { threw: re.test(String(e && e.message)), message: String(e && e.message) }; }
};

const payload = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const accountMap = JSON.parse(fs.readFileSync(MAP, 'utf8'));
const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));

// Synthetic values. They are shaped like nothing real and exist only so the
// tests can prove they never appear in a URL, header, report or error.
const SYNTH = {
  clientId: 'synthetic-client-id-' + crypto.randomBytes(6).toString('hex'),
  secret: 'synthetic-secret-' + crypto.randomBytes(8).toString('hex'),
  accessToken: 'synthetic-access-token-' + crypto.randomBytes(8).toString('hex'),
};
const leaks = text => [SYNTH.clientId, SYNTH.secret, SYNTH.accessToken].filter(v => String(text).includes(v));
const plaidEnv = (extra) => Object.assign({}, process.env, {
  PLAID_CLIENT_ID: SYNTH.clientId,
  PLAID_SECRET: SYNTH.secret,
  PLAID_ACCESS_TOKEN: SYNTH.accessToken,
  PLAID_ENV: 'sandbox',
}, extra || {});
const noPlaidEnv = (extra) => Object.assign({}, process.env, {
  PLAID_CLIENT_ID: '', PLAID_SECRET: '', PLAID_ACCESS_TOKEN: '', PLAID_ENV: '',
  ATLAS_PLAID_ACCOUNT_MAP_JSON: '', ATLAS_PLAID_ACCOUNT_MAP: '',
}, extra || {});

function liveShapedMap() {
  const doc = clone(accountMap);
  doc.scope = 'live';
  doc.owns = 'test-only live-shaped plaid map with synthetic ids';
  return doc;
}

function tmpFile(name, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-plaid-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  return file;
}

function runCli(args, env) {
  const res = spawnSync(process.execPath, [OBSERVE_JS].concat(args), {
    cwd: ROOT, encoding: 'utf8', env,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

// The mock Plaid host lives in this process, so CLI runs that may reach it
// must not block the event loop.
function runCliAsync(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [OBSERVE_JS].concat(args), { cwd: ROOT, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', c => { stdout += c; });
    child.stderr.on('data', c => { stderr += c; });
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

console.log('=== A. request shape is the official POST /accounts/balance/get ===');
{
  const cred = Object.assign({ environment: 'sandbox' }, SYNTH);
  const req = P.balanceRequest(cred, { env: {} });
  ok(req.method === 'POST', 'method is POST');
  ok(req.url.href === 'https://sandbox.plaid.com/accounts/balance/get',
    'sandbox URL is https://sandbox.plaid.com/accounts/balance/get', req.url.href);
  ok(req.url.search === '', 'URL carries no query parameters');
  ok(req.headers['Content-Type'] === 'application/json', 'Content-Type is application/json');
  ok(req.headers['Plaid-Version'] === '2020-09-14', 'Plaid-Version header is pinned');
  const body = JSON.parse(req.body);
  ok(body.client_id === SYNTH.clientId && body.secret === SYNTH.secret
      && body.access_token === SYNTH.accessToken,
    'client_id, secret and access_token travel only in the JSON body');
  ok(leaks(req.url.href).length === 0, 'no credential value in the URL');
  ok(leaks(JSON.stringify(req.headers)).length === 0, 'no credential value in any header');
  ok(!('Authorization' in req.headers), 'no Authorization header is used');
  const prod = P.balanceRequest(Object.assign({ environment: 'production' }, SYNTH), { env: {} });
  ok(prod.url.href === 'https://production.plaid.com/accounts/balance/get',
    'production URL is https://production.plaid.com/accounts/balance/get');
  const dev = throwsWith(() => P.balanceRequest(Object.assign({ environment: 'development' }, SYNTH), { env: {} }),
    /not supported/);
  ok(dev.threw, 'retired development environment is unsupported and fails closed', dev.message);
  const scoped = P.balanceRequest(cred, { env: {}, accountIds: ['a-1', 'a-2'] });
  ok(JSON.stringify(JSON.parse(scoped.body).options.account_ids) === '["a-1","a-2"]',
    'optional account_ids is passed under options');
  const nonLoop = throwsWith(() => P.plaidApiBase({ ATLAS_PLAID_API_BASE: 'https://evil.example.com' }, 'sandbox'),
    /loopback/);
  ok(nonLoop.threw, 'ATLAS_PLAID_API_BASE override is loopback-only');
  ok(P.plaidApiBase({ ATLAS_PLAID_API_BASE: 'http://127.0.0.1:9/' }, 'sandbox') === 'http://127.0.0.1:9',
    'loopback override is accepted for tests');
}

console.log('=== B. credential resolution fails closed and never prints values ===');
{
  const missingAll = throwsWith(() => P.resolvePlaidCredential({ env: {} }),
    /PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ACCESS_TOKEN are not set/);
  ok(missingAll.threw, 'missing credentials name the env vars', missingAll.message);
  const missingOne = throwsWith(() => P.resolvePlaidCredential({
    env: { PLAID_CLIENT_ID: SYNTH.clientId, PLAID_SECRET: SYNTH.secret, PLAID_ENV: 'sandbox' },
  }), /^PLAID_ACCESS_TOKEN is not set/);
  ok(missingOne.threw, 'a single missing variable is named exactly', missingOne.message);
  ok(leaks(missingOne.message).length === 0, 'error text carries no credential value');
  const noEnv = throwsWith(() => P.resolvePlaidCredential({
    env: { PLAID_CLIENT_ID: SYNTH.clientId, PLAID_SECRET: SYNTH.secret, PLAID_ACCESS_TOKEN: SYNTH.accessToken },
  }), /PLAID_ENV is not set/);
  ok(noEnv.threw, 'PLAID_ENV must be explicit', noEnv.message);
  const badEnv = throwsWith(() => P.resolvePlaidCredential({ env: plaidEnv({ PLAID_ENV: 'development' }) }),
    /PLAID_ENV is not supported/);
  ok(badEnv.threw, 'unsupported PLAID_ENV fails closed', badEnv.message);
  const cred = P.resolvePlaidCredential({ env: plaidEnv() });
  ok(cred.environment === 'sandbox' && cred.source === 'env'
      && cred.clientId === SYNTH.clientId && cred.accessToken === SYNTH.accessToken,
    'complete env resolves a sandbox credential from the environment only');
  ok(P.plaidConfigPresent({}) === false && P.plaidConfigPresent({ PLAID_ENV: 'sandbox' }) === true,
    'plaidConfigPresent reports only explicit configuration');
}

console.log('=== C. normalization keeps stable identity, current vs available, currency ===');
{
  const raw = payload.accounts.find(a => a.account_id === 'plaid-fx-acct-visa');
  const acc = P.normalizePlaidAccount(raw);
  ok(acc.provider === 'plaid' && acc.providerAccountId === 'plaid-fx-acct-visa',
    'providerAccountId is the stable Plaid account_id');
  ok(acc.balance === 4500.11 && acc.available === 3200.5 && acc.limit === 8000,
    'current → balance, available → available, limit → limit, none collapsed');
  ok(acc.currency === 'CAD', 'iso_currency_code is preserved as ISO uppercase', acc.currency);
  ok(acc.balanceAsOf === '2026-09-11T17:30:00.000Z' && acc.updatedAt == null,
    'last_updated_datetime is the balance instant; no invented updated_at');
  ok(!('mask' in acc) && !('officialName' in acc) && !('official_name' in acc)
      && !('persistentAccountId' in acc),
    'mask, official_name and persistent_account_id are dropped');
  const cash = P.normalizePlaidAccount(payload.accounts.find(a => a.account_id === 'plaid-fx-acct-chequing-a'));
  ok(cash.balance === 1234.56 && cash.available === 1180.25,
    'depository current and available stay distinct');
  ok(cash.balanceAsOf == null, 'null last_updated_datetime stays null so fetchedAt dates the observation');
  const lower = P.normalizePlaidAccount(Object.assign(clone(raw), { balances: Object.assign({}, raw.balances, { iso_currency_code: 'cad' }) }));
  ok(lower.currency === 'CAD', 'lower-case currency is normalized to ISO uppercase');

  const noId = throwsWith(() => P.normalizePlaidAccount({ balances: { current: 1 } }), /stable account_id/);
  ok(noId.threw, 'account without account_id fails closed');
  const noBal = throwsWith(() => P.normalizePlaidAccount({ account_id: 'x' }), /balances are malformed/);
  ok(noBal.threw, 'account without balances object fails closed');
  const badCur = throwsWith(() => P.normalizePlaidAccount({ account_id: 'x', balances: { current: 'abc' } }),
    /balances\.current is malformed/);
  ok(badCur.threw, 'non-numeric current fails closed');
  const badIso = throwsWith(() => P.normalizePlaidAccount({ account_id: 'x', balances: { current: 1, iso_currency_code: 'C$' } }),
    /iso_currency_code is malformed/);
  ok(badIso.threw, 'malformed currency code fails closed');
  ok(throwsWith(() => P.normalizePlaidBalancePayload(null), /not an object/).threw,
    'null payload fails closed');
  ok(throwsWith(() => P.normalizePlaidBalancePayload({ accounts: {} }), /no accounts array/).threw,
    'non-array accounts fails closed');
  ok(throwsWith(() => P.normalizePlaidBalancePayload({ accounts: [] }), /zero accounts/).threw,
    'empty accounts fails closed');
  const dup = clone(payload);
  dup.accounts.push(clone(dup.accounts[0]));
  ok(throwsWith(() => P.normalizePlaidBalancePayload(dup), /repeats an account_id/).threw,
    'duplicate account_id fails closed');
  const norm = P.normalizePlaidBalancePayload(payload, '2026-09-11T18:00:00.000Z');
  ok(norm.provider === 'plaid' && Array.isArray(norm.transactions) && norm.transactions.length === 0,
    'balance payload normalizes with no transactions');
  ok(norm.transactionWindow.complete === null && norm.transactionWindow.truncated === false,
    'transaction window is unproven, not complete');
}

console.log('=== D. observe() feeds the incumbent boundary and stays read-only ===');
{
  const before = hashFile(DATA);
  const report = O.observe({ provider: 'plaid', payload, accountMap, data });
  ok(report.writesCanonicalState === false, 'report declares no canonical write');
  ok(report.reconciliation && report.reconciliation.writesCanonicalState === false,
    'B91 reconcile also declares no canonical write');
  ok(hashFile(DATA) === before, 'data.json bytes are unchanged after observe()');
  ok(report.provider === 'plaid' && report.readOnly === true
      && report.endpoint === 'POST /accounts/balance/get',
    'report names the provider and the read-only endpoint');
  ok(report.liveOverlayEligible === false, 'report says it is not live-overlay evidence');

  const cheq = report.mapped.filter(m => m.providerAccountId === 'plaid-fx-acct-chequing-a');
  ok(cheq.length === 1 && cheq[0].atlasId === 'chequing-a',
    'stable account_id maps to exactly one Atlas id');
  const ext = report.mapped.find(m => m.providerAccountId === 'plaid-fx-acct-external');
  ok(ext && ext.atlasRole === 'household-external' && ext.atlasId === null,
    'household-external account is dispositioned, not canonical');
  ok(!report.observations.some(o => o.providerAccountId === 'plaid-fx-acct-external'),
    'household-external account produces no observation');
  const mystery = report.unmapped.find(u => u.providerAccountId === 'plaid-fx-acct-mystery');
  ok(!!mystery && mystery.reason === 'unmapped-provider-account',
    'unknown account_id stays unmapped, not auto-created');
  ok(!report.observations.some(o => o.providerAccountId === 'plaid-fx-acct-mystery'),
    'unmapped account produces no observation');

  const renamed = clone(payload);
  renamed.accounts = renamed.accounts.map(a => (
    a.account_id === 'plaid-fx-acct-chequing-a' ? Object.assign({}, a, { name: 'Renamed Chequing' }) : a
  ));
  const renamedReport = O.observe({ provider: 'plaid', payload: renamed, accountMap, data });
  const hits = renamedReport.mapped.filter(m => m.atlasId === 'chequing-a');
  ok(hits.length === 1 && hits[0].providerAccountId === 'plaid-fx-acct-chequing-a'
      && hits[0].displayName === 'Renamed Chequing',
    'display-name change does not remap; the name is a label only');
  const swapped = clone(payload);
  swapped.accounts = swapped.accounts.map(a => {
    if (a.account_id === 'plaid-fx-acct-chequing-a') return Object.assign({}, a, { name: 'Synthetic Spending Chequing' });
    if (a.account_id === 'plaid-fx-acct-chequing-b') return Object.assign({}, a, { name: 'Synthetic Everyday Chequing' });
    return a;
  });
  const swappedReport = O.observe({ provider: 'plaid', payload: swapped, accountMap, data });
  const swappedA = swappedReport.observations.find(o => o.canonical && o.canonical.id === 'chequing-a');
  ok(swappedA && swappedA.evidenceValue === 1234.56,
    'swapping display names between accounts does not move a balance between Atlas ids');

  const cashA = report.observations.find(o => o.observationId === 'plaid-plaid-fx-acct-chequing-a-cash');
  ok(cashA && cashA.evidenceValue === 1234.56,
    'household cash observation is Plaid current, not available (1180.25)', cashA && String(cashA.evidenceValue));
  ok(cashA && cashA.observedAsOf === '2026-09-11' && cashA.evidenceDate === '2026-09-11',
    'real-time balance without last_updated_datetime is dated by the fetch instant (household date)');
  ok(cashA && cashA.source === 'provider-observe:plaid' && cashA.provider === 'plaid',
    'observation source and provider are plaid');
  ok(report.observations.every(o => /^plaid-/.test(o.observationId)),
    'every Plaid observation id is plaid-prefixed so it cannot collide with lm- ids');
  const posted = report.observations.find(o => o.fact === 'posted-balance');
  const avail = report.observations.find(o => o.fact === 'available-credit');
  const limit = report.observations.find(o => o.fact === 'limit');
  ok(posted && posted.cardId === 'tdcc' && posted.evidenceValue === 4500.11,
    'credit current is the card posted balance');
  ok(avail && avail.evidenceValue === 3200.5 && limit && limit.evidenceValue === 8000,
    'available credit and limit are their own facts');
  ok(posted && posted.observedAsOf === '2026-09-11',
    'card posted balance is dated from last_updated_datetime');

  // Independent arithmetic straight from the fixture file, not from the module.
  const expectedCash = ['plaid-fx-acct-chequing-a', 'plaid-fx-acct-chequing-b', 'plaid-fx-acct-savings']
    .map(id => payload.accounts.find(a => a.account_id === id).balances.current)
    .reduce((a, b) => a + b, 0);
  ok(Math.abs(expectedCash - 6444.96) < 1e-9, 'fixture cash currents sum to 6444.96 independently');
  ok(report.spendableCash === 6444.96,
    'spendableCash is only mapped household-cash current balances', String(report.spendableCash));
  ok(report.cardCapacityIsCash === 0 && R.householdCashFromCardCapacity() === 0,
    'available credit is never household cash');

  const rowA = report.reconciliation.rows.find(r => r.observationId === 'plaid-plaid-fx-acct-chequing-a-cash');
  const rowCard = report.reconciliation.rows.find(r => r.observationId === 'plaid-plaid-fx-acct-visa-debt');
  ok(rowA && rowA.canonicalTarget === 'cash:chequing-a',
    'cash observation reaches the B91 cash locator', rowA && rowA.canonicalTarget);
  ok(rowCard && rowCard.fact === 'posted-balance' && rowCard.cardId === 'tdcc',
    'card observation reaches the existing card compare');
  ok(typeof R.reconcile === 'function', 'the only compare authority is scripts/reconcile.js');

  const receipt = report.observationReceipt;
  ok(receipt && receipt.provider === 'plaid' && receipt.fingerprint.provider === 'plaid',
    'observation receipt and fingerprint name plaid');
  ok(receipt && receipt.readyForReconciliation === false,
    'a balance-only packet is never readyForReconciliation');
  ok(receipt && receipt.failClosedReasons.includes('posted-window-unproven')
      && receipt.failClosedReasons.includes('pending-coverage-unproven'),
    'receipt names unproven posted and pending coverage', JSON.stringify(receipt && receipt.failClosedReasons));
  ok(receipt && receipt.accountCoverage.status === 'required-cash-observed'
      && receipt.accountCoverage.requiredCashMissing.length === 0,
    'receipt confirms required cash observed');
  ok(report.pendingCoverage.complete === false && report.pendingCoverage.status === 'insufficient',
    'pending is unknown, not zero');
  ok(O.observationReceiptLooksSanitized(receipt), 'receipt passes the incumbent sanitization check');

  const blob = JSON.stringify(report);
  ok(!/"mask"|official_name|officialName|persistent_account_id/.test(blob),
    'report carries no mask, official_name or persistent_account_id');
  ok(!/client_id|"secret"|access_token/.test(blob),
    'report carries no credential field');
  ok(Array.isArray(report.accounts) && report.accounts.length === 6
      && report.accounts.every(a => a.currency === 'CAD'),
    'sanitized accounts list preserves currency per account');
}

console.log('=== E. mapping and coverage failures fail closed ===');
{
  const lmMap = JSON.parse(fs.readFileSync(LM_MAP, 'utf8'));
  const wrongMap = throwsWith(() => O.observe({ provider: 'plaid', payload, accountMap: lmMap, data }),
    /not a plaid map/);
  ok(wrongMap.threw, 'a lunchmoney map cannot map Plaid account_ids', wrongMap.message);
  const lmPayload = JSON.parse(fs.readFileSync(LM_FIXTURE, 'utf8'));
  const lmWithPlaidMap = throwsWith(() => O.observe({ provider: 'lunchmoney', payload: lmPayload, accountMap, data }),
    /not a lunchmoney map/);
  ok(lmWithPlaidMap.threw, 'a plaid map cannot map Lunch Money ids', lmWithPlaidMap.message);

  const noSavings = clone(payload);
  noSavings.accounts = noSavings.accounts.filter(a => a.account_id !== 'plaid-fx-acct-savings');
  const missingCash = throwsWith(() => O.observe({ provider: 'plaid', payload: noSavings, accountMap, data }),
    /plaid-required-cash-unobserved: savings/);
  ok(missingCash.threw, 'a required cash identity absent from the response fails closed', missingCash.message);

  const nullCurrent = clone(payload);
  nullCurrent.accounts.find(a => a.account_id === 'plaid-fx-acct-chequing-b').balances.current = null;
  const noBalance = throwsWith(() => O.observe({ provider: 'plaid', payload: nullCurrent, accountMap, data }),
    /plaid-balance-missing: chequing-b/);
  ok(noBalance.threw, 'mapped household cash without a numeric current fails closed', noBalance.message);

  const noCurrency = clone(payload);
  noCurrency.accounts.find(a => a.account_id === 'plaid-fx-acct-chequing-a').balances.iso_currency_code = null;
  const noIso = throwsWith(() => O.observe({ provider: 'plaid', payload: noCurrency, accountMap, data }),
    /plaid-currency-missing: chequing-a/);
  ok(noIso.threw, 'mapped household cash without an ISO currency fails closed', noIso.message);

  const malformed = throwsWith(() => O.observe({ provider: 'plaid', payload: { accounts: 'nope' }, accountMap, data }),
    /no accounts array/);
  ok(malformed.threw, 'malformed response fails closed before mapping');

  const fixtureLive = throwsWith(() => O.assertLiveMap(accountMap, { data, provider: 'plaid' }),
    /Fixture account map cannot authorize a live canonical mapping/);
  ok(fixtureLive.threw, 'fixture-scoped plaid map cannot authorize live mapping');
  const lmAsPlaid = throwsWith(() => O.assertLiveMap(lmMap, { data, provider: 'plaid' }),
    /not a plaid map/);
  ok(lmAsPlaid.threw, 'assertLiveMap for plaid rejects a lunchmoney document');
  const partial = liveShapedMap();
  partial.mappings = partial.mappings.filter(m => !(m.canonical && m.canonical.id === 'savings'));
  const partialLive = throwsWith(() => O.assertLiveMap(partial, { data, provider: 'plaid' }),
    /missing-required-cash-mapping/);
  ok(partialLive.threw, 'live plaid map missing a required cash identity fails closed');
  const badCanonical = liveShapedMap();
  badCanonical.mappings.find(m => m.canonical && m.canonical.id === 'tdcc').canonical.id = 'not-a-debt';
  ok(throwsWith(() => O.assertLiveMap(badCanonical, { data, provider: 'plaid' }), /invalid-atlas-account-id/).threw,
    'live plaid map with an unknown canonical id fails closed');
  const good = liveShapedMap();
  let accepted = true;
  try { O.assertLiveMap(good, { data, provider: 'plaid' }); } catch (e) { accepted = false; }
  ok(accepted, 'a complete live-shaped plaid map is accepted');
  const lmDefaultStillWorks = throwsWith(() => O.assertLiveMap(accountMap), /not a lunchmoney map/);
  ok(lmDefaultStillWorks.threw, 'assertLiveMap default provider remains lunchmoney');
  ok(O.SUPPORTED_PROVIDERS.length === 2 && O.SUPPORTED_PROVIDERS.includes('plaid'),
    'plaid is a registered provider alongside lunchmoney');

  const missingEnvMap = throwsWith(() => O.loadLivePlaidAccountMap(noPlaidEnv({ ATLAS_PLAID_ACCOUNT_MAP: '' }), data),
    /plaid-account-map-missing/);
  ok(missingEnvMap.threw || fs.existsSync(O.PLAID_LOCAL_MAP),
    'no plaid map in env and no local file fails closed');
  const viaJson = O.loadLivePlaidAccountMap({ ATLAS_PLAID_ACCOUNT_MAP_JSON: JSON.stringify(liveShapedMap()) }, data);
  ok(viaJson && viaJson.provider === 'plaid', 'ATLAS_PLAID_ACCOUNT_MAP_JSON loads the same schema');
  ok(throwsWith(() => O.loadLivePlaidAccountMap({ ATLAS_PLAID_ACCOUNT_MAP_JSON: '{not json' }, data),
    /live-account-map-invalid/).threw, 'malformed ATLAS_PLAID_ACCOUNT_MAP_JSON fails closed');
}

console.log('=== F. CLI fixture run is read-only ===');
{
  const before = hashFile(DATA);
  const out = execFileSync(process.execPath, [OBSERVE_JS, '--provider', 'plaid', '--fixture', FIXTURE], {
    cwd: ROOT, encoding: 'utf8',
  });
  const parsed = JSON.parse(out);
  ok(parsed.writesCanonicalState === false && parsed.provider === 'plaid',
    'CLI JSON says writesCanonicalState false for plaid');
  ok(hashFile(DATA) === before, 'CLI run leaves data.json untouched');
  const receiptOut = execFileSync(process.execPath, [OBSERVE_JS, '--provider', 'plaid', '--fixture', FIXTURE, '--receipt'], {
    cwd: ROOT, encoding: 'utf8',
  });
  const receipt = JSON.parse(receiptOut);
  ok(receipt.schema === O.RECEIPT_SCHEMA && receipt.provider === 'plaid' && receipt.readyForReconciliation === false,
    '--receipt prints a plaid observation receipt that is not ready for reconciliation');
  const badFlag = runCli(['--provider', 'plaid', '--fixture', FIXTURE, '--reconciliation-receipt'], process.env);
  ok(badFlag.status !== 0 && /not available for --provider plaid/.test(badFlag.stderr),
    '--reconciliation-receipt is refused for plaid');
  const badMode = runCli(['--provider', 'plaid', '--fixture', FIXTURE, '--mode', 'reconcile'], process.env);
  ok(badMode.status !== 0 && /do not apply to --provider plaid/.test(badMode.stderr),
    '--mode reconcile is refused for plaid');
  const unknown = runCli(['--provider', 'wealthica', '--fixture', FIXTURE], process.env);
  ok(unknown.status !== 0 && /Only --provider lunchmoney and --provider plaid/.test(unknown.stderr),
    'an unknown provider is refused');
}

async function sectionG() {
  console.log('=== G. CLI --live fails closed before any network request ===');
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    res.statusCode = 500;
    res.end('{}');
  });
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;

  const noCred = await runCliAsync(['--provider', 'plaid', '--live'], noPlaidEnv({ ATLAS_PLAID_API_BASE: base }));
  ok(noCred.status !== 0, '--live without credentials exits non-zero');
  ok(/PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ACCESS_TOKEN are not set/.test(noCred.stderr),
    'error names the env vars without inventing a credential', noCred.stderr.trim());

  const noMap = await runCliAsync(['--provider', 'plaid', '--live'], plaidEnv({
    ATLAS_PLAID_API_BASE: base, ATLAS_PLAID_ACCOUNT_MAP_JSON: '', ATLAS_PLAID_ACCOUNT_MAP: '',
  }));
  const localMapPresent = fs.existsSync(O.PLAID_LOCAL_MAP);
  ok(localMapPresent || (noMap.status !== 0 && /plaid-account-map-missing/.test(noMap.stderr)),
    '--live with credentials but no owner map fails closed', noMap.stderr.trim());

  const fixtureMap = await runCliAsync(['--provider', 'plaid', '--live', '--map', MAP], plaidEnv({ ATLAS_PLAID_API_BASE: base }));
  ok(fixtureMap.status !== 0 && /Fixture account map cannot authorize a live canonical mapping/.test(fixtureMap.stderr),
    'live CLI refuses a fixture-scoped plaid map');

  const badEnv = await runCliAsync(['--provider', 'plaid', '--live', '--map', tmpFile('live-map.json', liveShapedMap())],
    plaidEnv({ ATLAS_PLAID_API_BASE: base, PLAID_ENV: 'development' }));
  ok(badEnv.status !== 0 && /PLAID_ENV is not supported/.test(badEnv.stderr),
    'unsupported PLAID_ENV fails closed');

  const lmMapForPlaid = await runCliAsync(['--provider', 'plaid', '--live', '--map', tmpFile('lm-map.json', Object.assign(JSON.parse(fs.readFileSync(LM_MAP, 'utf8')), { scope: 'live' }))],
    plaidEnv({ ATLAS_PLAID_API_BASE: base }));
  ok(lmMapForPlaid.status !== 0 && /not a plaid map/.test(lmMapForPlaid.stderr),
    'live CLI refuses a lunchmoney map for plaid');

  for (const r of [noCred, noMap, fixtureMap, badEnv, lmMapForPlaid]) {
    const leaked = leaks(r.stdout + r.stderr);
    ok(leaked.length === 0, 'fail-closed output carries no credential value');
  }
  ok(hits === 0, 'no request reached the mock Plaid host during fail-closed runs', String(hits));
  await new Promise(resolve => server.close(resolve));
}

async function sectionH() {
  console.log('=== H. mocked live POST through the observer seam ===');
  const seen = [];
  let mode = 'ok';
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const bodyText = Buffer.concat(chunks).toString('utf8');
      let body = null;
      try { body = JSON.parse(bodyText); } catch (e) { body = null; }
      seen.push({
        method: req.method,
        url: req.url,
        contentType: req.headers['content-type'],
        plaidVersion: req.headers['plaid-version'],
        authorization: req.headers.authorization || null,
        bodyHasClientId: !!(body && body.client_id === SYNTH.clientId),
        bodyHasSecret: !!(body && body.secret === SYNTH.secret),
        bodyHasAccessToken: !!(body && body.access_token === SYNTH.accessToken),
      });
      if (req.method !== 'POST' || req.url !== '/accounts/balance/get') {
        res.statusCode = 404;
        res.end(JSON.stringify({ error_type: 'INVALID_REQUEST', error_code: 'NOT_FOUND' }));
        return;
      }
      if (mode === 'item-error') {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          error_type: 'ITEM_ERROR',
          error_code: 'ITEM_LOGIN_REQUIRED',
          error_message: 'the login details of this item have changed',
          display_message: null,
          request_id: 'mock-req',
        }));
        return;
      }
      if (mode === 'not-json') {
        res.statusCode = 200;
        res.end('<html>not json</html>');
        return;
      }
      if (mode === 'malformed') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ accounts: [{ name: 'no id', balances: { current: 1 } }], request_id: 'mock-req' }));
        return;
      }
      if (mode === 'missing-savings') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          accounts: payload.accounts.filter(a => a.account_id !== 'plaid-fx-acct-savings'),
          item: payload.item,
          request_id: 'mock-req',
        }));
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ accounts: payload.accounts, item: payload.item, request_id: 'mock-req' }));
    });
  });
  const port = await listen(server);
  const env = plaidEnv({
    ATLAS_PLAID_API_BASE: `http://127.0.0.1:${port}`,
    ATLAS_PLAID_ACCOUNT_MAP_JSON: JSON.stringify(liveShapedMap()),
  });

  const before = hashFile(DATA);
  const live = await runCliAsync(['--provider', 'plaid', '--live'], env);
  ok(live.status === 0, 'mocked live run exits 0', live.stderr.trim());
  ok(hashFile(DATA) === before, 'mocked live run leaves data.json untouched');
  ok(seen.length === 1, 'exactly one request reached the mock', String(seen.length));
  const first = seen[0] || {};
  ok(first.method === 'POST' && first.url === '/accounts/balance/get',
    'the request is POST /accounts/balance/get with no query string', `${first.method} ${first.url}`);
  ok(/application\/json/.test(first.contentType || '') && first.plaidVersion === '2020-09-14',
    'JSON content type and Plaid-Version header are sent');
  ok(first.authorization === null, 'no Authorization header is sent');
  ok(first.bodyHasClientId && first.bodyHasSecret && first.bodyHasAccessToken,
    'client_id, secret and access_token arrive in the body exactly as configured');
  let report = null;
  try { report = JSON.parse(live.stdout); } catch (e) { report = null; }
  ok(!!report && report.provider === 'plaid' && report.writesCanonicalState === false,
    'live report is a plaid observation that writes nothing');
  ok(!!report && report.environment === 'sandbox', 'live report records the Plaid environment');
  ok(!!report && report.spendableCash === 6444.96,
    'mocked live spendable cash equals the fixture cash currents', report && String(report.spendableCash));
  ok(!!report && report.mapped.some(m => m.atlasId === 'savings') && report.unmapped.length === 1,
    'mocked live mapping matches the fixture map by stable account_id');
  ok(!!report && report.observationReceipt.readyForReconciliation === false,
    'mocked live packet still cannot claim readiness for reconciliation');
  ok(leaks(live.stdout + live.stderr).length === 0, 'live stdout/stderr carry no credential value');
  ok(!/"mask"|official_name/.test(live.stdout), 'live stdout carries no mask or official_name');

  const receiptRun = await runCliAsync(['--provider', 'plaid', '--live', '--receipt'], env);
  let receipt = null;
  try { receipt = JSON.parse(receiptRun.stdout); } catch (e) { receipt = null; }
  ok(receiptRun.status === 0 && receipt && receipt.provider === 'plaid' && receipt.readyForReconciliation === false,
    '--live --receipt prints the plaid receipt');

  mode = 'item-error';
  const itemError = await runCliAsync(['--provider', 'plaid', '--live'], env);
  ok(itemError.status !== 0 && /HTTP 400 \(ITEM_ERROR\/ITEM_LOGIN_REQUIRED\)/.test(itemError.stderr),
    'Plaid error response fails closed naming error_type/error_code', itemError.stderr.trim());
  ok(leaks(itemError.stdout + itemError.stderr).length === 0, 'Plaid error output carries no credential value');
  ok(!/login details/.test(itemError.stderr), 'Plaid error_message prose is not echoed');

  mode = 'not-json';
  const notJson = await runCliAsync(['--provider', 'plaid', '--live'], env);
  ok(notJson.status !== 0 && /Plaid response was not JSON/.test(notJson.stderr),
    'non-JSON success body fails closed', notJson.stderr.trim());

  mode = 'malformed';
  const malformed = await runCliAsync(['--provider', 'plaid', '--live'], env);
  ok(malformed.status !== 0 && /stable account_id/.test(malformed.stderr),
    'malformed account in a live response fails closed', malformed.stderr.trim());

  mode = 'missing-savings';
  const missing = await runCliAsync(['--provider', 'plaid', '--live'], env);
  ok(missing.status !== 0 && /plaid-required-cash-unobserved: savings/.test(missing.stderr),
    'live response missing a required cash account fails closed', missing.stderr.trim());
  await new Promise(resolve => server.close(resolve));
}

function sectionI() {
  console.log('=== I. Lunch Money path is unchanged by the Plaid addition ===');
  const lmPayload = JSON.parse(fs.readFileSync(LM_FIXTURE, 'utf8'));
  const lmMap = JSON.parse(fs.readFileSync(LM_MAP, 'utf8'));
  const lm = O.observe({ provider: 'lunchmoney', payload: lmPayload, accountMap: lmMap, data });
  ok(lm.provider === 'lunchmoney' && lm.observationReceipt.provider === 'lunchmoney'
      && lm.observationReceipt.fingerprint.provider === 'lunchmoney',
    'Lunch Money report and receipt still name lunchmoney');
  ok(lm.observations.every(o => /^lm-/.test(o.observationId) && o.source === 'provider-observe:lunchmoney'),
    'Lunch Money observation ids and source are unchanged');
  ok(lm.spendableCash === 79.84, 'Lunch Money fixture spendable cash is still 79.84');
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'live-plan.js'), 'utf8');
  ok(!/plaid-balance|observePlaidBalances|fetchPlaidBalancesLive/.test(src),
    'live-plan.js does not consume the Plaid balance path');
  for (const f of ['public/forecast.js', 'public/plan.js']) {
    ok(!/plaid-balance|observePlaidBalances/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')),
      `${f} is not wired to Plaid`);
  }
}

(async () => {
  await sectionG();
  await sectionH();
  sectionI();
  if (failures) {
    console.log(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll Plaid balance observation checks passed.');
})().catch((err) => {
  console.log(`  FAIL  suite error — ${err && err.stack || err}`);
  process.exit(1);
});
