'use strict';
/* Read-only Lunch Money observation spike. Independent of Forecast.recommend.
 * Does not write data.json. Does not treat available credit or HELOC as cash.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const O = require('./scripts/provider-observe.js');
const R = require('./scripts/reconcile.js');

const ROOT = __dirname;
const FIXTURE = path.join(ROOT, 'docs', 'connectivity', 'fixtures', 'lunchmoney-sample.json');
const MAP = path.join(ROOT, 'docs', 'connectivity', 'fixtures', 'provider-account-map.json');
const LIVE_MAP = path.join(ROOT, 'docs', 'connectivity', 'provider-account-map.json');
const DATA = path.join(ROOT, 'data.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const hashFile = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const clone = x => JSON.parse(JSON.stringify(x));

const payload = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const accountMap = JSON.parse(fs.readFileSync(MAP, 'utf8'));
const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));

console.log('=== A. fixture import is read-only ===');
{
  const before = hashFile(DATA);
  const report = O.observe({ provider: 'lunchmoney', payload, accountMap, data });
  ok(report.writesCanonicalState === false, 'observe report declares no canonical write');
  ok(report.reconciliation && report.reconciliation.writesCanonicalState === false,
    'B91 reconcile also declares no canonical write');
  ok(hashFile(DATA) === before, 'data.json bytes are unchanged after observe()');
}

console.log('=== B. CLI fixture run does not modify data.json ===');
{
  const before = hashFile(DATA);
  const out = execFileSync(process.execPath, [
    path.join(ROOT, 'scripts', 'provider-observe.js'),
    '--provider', 'lunchmoney',
    '--fixture', FIXTURE,
  ], { cwd: ROOT, encoding: 'utf8' });
  const parsed = JSON.parse(out);
  ok(parsed.writesCanonicalState === false, 'CLI JSON says writesCanonicalState false');
  ok(hashFile(DATA) === before, 'CLI run leaves data.json untouched');
}

console.log('=== C. stable provider account ID maps to one Atlas ID ===');
{
  const report = O.observe({ provider: 'lunchmoney', payload, accountMap, data });
  const cheq = report.mapped.filter(m => m.providerAccountId === '1001');
  ok(cheq.length === 1 && cheq[0].atlasId === 'chequing-a',
    'provider 1001 maps only to chequing-a', JSON.stringify(cheq));
}

console.log('=== D. unknown provider account stays unmapped ===');
{
  const report = O.observe({ provider: 'lunchmoney', payload, accountMap, data });
  const mystery = report.unmapped.find(u => u.providerAccountId === '9999');
  ok(!!mystery && mystery.reason === 'unmapped-provider-account',
    'Mystery Account is unmapped, not auto-created');
  ok(!report.mapped.some(m => m.providerAccountId === '9999'),
    'unmapped id is absent from mapped list');
  ok(!report.observations.some(o => o.providerAccountId === '9999'),
    'unmapped account produces no reconciliation observation');
}

console.log('=== E. display-name change does not create a second Atlas account ===');
{
  const renamed = clone(payload);
  renamed.accounts = renamed.accounts.map(a => (
    a.id === 1001 ? Object.assign({}, a, { name: 'Household Chequing Renamed' }) : a
  ));
  const report = O.observe({ provider: 'lunchmoney', payload: renamed, accountMap, data });
  const hits = report.mapped.filter(m => m.atlasId === 'chequing-a');
  ok(hits.length === 1 && hits[0].providerAccountId === '1001',
    'renamed 1001 still maps to one chequing-a');
  ok(hits[0].displayName === 'Household Chequing Renamed',
    'new display name is preserved as a label');
}

console.log('=== F. balance observation keeps the provider timestamp ===');
{
  const report = O.observe({ provider: 'lunchmoney', payload, accountMap, data });
  const cash = report.observations.find(o => o.observationId === 'lm-1001-cash');
  ok(cash && cash.observedAsOf === '2026-08-16',
    'cash observation date is the provider updated_at day', cash && cash.observedAsOf);
  ok(report.fetchedAt === payload.fetchedAt, 'payload fetchedAt is preserved');
}

console.log('=== F2. posted-balance evidence prefers balance_as_of over updated_at ===');
{
  const acc = O.normalizeLunchMoneyAccount({
    id: 4110,
    name: 'Triangle Fixture',
    type: 'credit',
    subtype: 'credit_card',
    balance: 13495.32,
    credit_limit: 13500,
    updated_at: '2026-08-16T20:44:19.898Z',
    balance_as_of: '2026-08-19T03:25:33.904Z',
  });
  ok(acc.updatedAt === '2026-08-16T20:44:19.898Z'
    && acc.balanceAsOf === '2026-08-19T03:25:33.904Z'
    && acc.dateLastFetched == null,
    'distinct provider timestamps are preserved, not collapsed');
  ok(!Object.prototype.hasOwnProperty.call(acc, 'providerUpdatedAt'),
    'normalized account does not expose a collapsed providerUpdatedAt');
  ok(O.postedBalanceEvidenceInstant(acc) === '2026-08-19T03:25:33.904Z',
    'posted-balance instant is balance_as_of, not updated_at');
  const mapping = {
    atlasRole: 'revolving-credit',
    canonical: { collection: 'debts', id: 'triangle' },
    providerAccountId: '4110',
  };
  const obs = O.observationsFromMappedAccount(acc, mapping, '2026-08-19T04:00:00.000Z');
  const posted = obs.find(o => o.fact === 'posted-balance');
  ok(posted && posted.evidenceDate === '2026-08-18' && posted.observedAsOf === '2026-08-18',
    'posted observation is dated 2026-08-18 from balance_as_of, not 2026-08-16',
    posted && posted.evidenceDate);
  const cashAcc = O.normalizeLunchMoneyAccount({
    id: 4101,
    name: 'Chequing Fixture',
    type: 'cash',
    balance: 997.71,
    updated_at: '2026-08-16T20:00:00.000Z',
    balance_as_of: '2026-08-19T03:25:33.904Z',
  });
  ok(O.genericAccountEvidenceInstant(cashAcc) === '2026-08-16T20:00:00.000Z',
    'live cash still dates from updated_at when both timestamps exist');
}

console.log('=== G. pending stays distinct from posted ===');
{
  const report = O.observe({ provider: 'lunchmoney', payload, accountMap, data });
  const pending = report.transactions.filter(t => t.providerTransactionId === '88002' && t.pending);
  const posted = report.transactions.filter(t => t.providerTransactionId === '88002' && !t.pending);
  ok(pending.length === 1 && posted.length === 1,
    'same provider tx id can appear pending and posted without inventing a second id');
  ok(pending[0].payee !== posted[0].payee,
    'description change does not mint a new provider transaction id');
}

console.log('=== H. available credit is never household cash ===');
{
  const report = O.observe({ provider: 'lunchmoney', payload, accountMap, data });
  ok(report.cardCapacityIsCash === 0, 'householdCashFromCardCapacity is 0');
  ok(R.householdCashFromCardCapacity() === 0, 'reconciler helper independently returns 0');
  const avail = report.observations.find(o => o.fact === 'available-credit');
  ok(avail && avail.evidenceValue === 3200.5, 'available credit is observed as its own fact');
  ok(report.spendableCash === 79.84,
    'spendable cash is only mapped cash balances, not 79.84+3200.50',
    String(report.spendableCash));
}

console.log('=== I. HELOC / mortgage balances are not spendable cash ===');
{
  const report = O.observe({ provider: 'lunchmoney', payload, accountMap, data });
  const heloc = report.mapped.find(m => m.providerAccountId === '2002');
  const mort = report.mapped.find(m => m.providerAccountId === '2003');
  ok(heloc && heloc.collection === 'debts' && heloc.atlasRole === 'heloc',
    'HELOC maps to debts/heloc');
  ok(mort && mort.collection === 'debts' && mort.atlasRole === 'mortgage',
    'mortgage maps to debts/mortgage');
  ok(report.spendableCash === 79.84,
    'HELOC 201586.16 and mortgage 412000 are excluded from spendable cash');
}

console.log('=== J. observations feed existing reconcile, not a second engine ===');
{
  const report = O.observe({ provider: 'lunchmoney', payload, accountMap, data });
  const cashRow = report.reconciliation.rows.find(r => r.observationId === 'lm-1001-cash');
  const cardRow = report.reconciliation.rows.find(r => r.observationId === 'lm-2001-debt');
  const helocRow = report.reconciliation.rows.find(r => r.observationId === 'lm-2002-debt');
  ok(cashRow && cashRow.canonicalTarget === 'cash:chequing-a',
    'cash uses B91 cash locator, not the card posted-balance path',
    cashRow && cashRow.canonicalTarget);
  ok(cashRow && cashRow.status === 'CHANGE',
    'fixture 79.84 vs live Chequing A is CHANGE, not a silent rewrite',
    cashRow && cashRow.status);
  ok(cardRow && cardRow.fact === 'posted-balance' && cardRow.cardId === 'tdcc',
    'revolving card posted balance stays on the existing card compare');
  ok(helocRow && helocRow.canonicalTarget === 'debts:heloc' && !helocRow.cardId,
    'HELOC balance compares as a debt, not as spendable cash');
  ok(typeof R.reconcile === 'function', 'the only compare authority is scripts/reconcile.js');
}

console.log('=== K. missing API secret fails closed and is not printed ===');
{
  let threw = false;
  let message = '';
  try {
    execFileSync(process.execPath, [
      path.join(ROOT, 'scripts', 'provider-observe.js'),
      '--provider', 'lunchmoney',
      '--live',
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      env: Object.assign({}, process.env, {
        LUNCHMONEY_ACCESS_TOKEN: '',
        ATLAS_LUNCHMONEY_CREDENTIAL_FILE: path.join(os.tmpdir(), 'atlas-missing-lunchmoney.dat'),
      }),
    });
  } catch (e) {
    threw = true;
    message = String(e.stderr || e.stdout || e.message || '');
  }
  ok(threw, '--live without a token exits non-zero');
  ok(/LUNCHMONEY_ACCESS_TOKEN is not set/.test(message),
    'error names the env var without inventing a token');
  if (process.platform === 'win32') {
    ok(/local credential bootstrap has not been completed/.test(message),
      'Windows missing store fails closed on bootstrap');
  } else {
    ok(/Windows local credential fallback is not available/.test(message),
      'non-Windows does not emulate DPAPI');
  }
  ok(!/Bearer\s+\S+/.test(message), 'failure text does not contain a bearer token');
}

console.log('=== L. live transaction request includes pending ===');
{
  const url = O.lunchMoneyTransactionsUrl('2026-08-16T18:00:00.000Z');
  ok(url.pathname === '/v2/transactions', 'live request targets GET /v2/transactions');
  ok(url.searchParams.get('include_pending') === 'true',
    'live transactions URL sets include_pending=true', url.search);
  const boundary = O.lunchMoneyTransactionsUrl('2026-08-19T01:06:40.929Z');
  ok(boundary.searchParams.get('end_date') === '2026-08-18',
    'history window end is the household date, not the UTC date prefix',
    boundary.searchParams.get('end_date'));

  const harness = [
    "'use strict';",
    "const https = require('https');",
    "const { EventEmitter } = require('events');",
    'const seen = [];',
    'https.request = (url, options, cb) => {',
    "  seen.push(url && url.href ? url.href : String(url));",
    '  const req = new EventEmitter();',
    '  req.end = () => {',
    '    process.nextTick(() => {',
    '      const res = new EventEmitter();',
    '      res.statusCode = 200;',
    '      cb(res);',
    "      res.emit('data', Buffer.from('{}'));",
    "      res.emit('end');",
    '    });',
    '  };',
    '  return req;',
    '};',
    `const O = require(${JSON.stringify(path.join(ROOT, 'scripts', 'provider-observe.js'))});`,
    "O.fetchLunchMoneyLive('test-token', '2026-08-16T18:00:00.000Z').then(() => {",
    '  process.stdout.write(JSON.stringify(seen));',
    '}).catch((err) => {',
    '  process.stderr.write(String(err && err.message || err));',
    '  process.exit(1);',
    '});',
  ].join('\n');
  const captured = JSON.parse(execFileSync(process.execPath, ['-e', harness], {
    cwd: ROOT,
    encoding: 'utf8',
  }));
  const tx = captured.find(u => /\/v2\/transactions(?:\?|$)/.test(u) && /include_pending=true/.test(u));
  ok(!!tx, 'live fetch actually GET /v2/transactions', JSON.stringify(captured));
  ok(tx && new URL(tx).searchParams.get('include_pending') === 'true',
    'live request URL contains include_pending=true', tx);
  const pendingUniverse = captured.find(u => /\/v2\/transactions(?:\?|$)/.test(u) && /is_pending=true/.test(u));
  ok(!!pendingUniverse, 'live fetch also GET /v2/transactions?is_pending=true', JSON.stringify(captured));
  const pendingUrl = new URL(pendingUniverse);
  ok(pendingUrl.searchParams.get('is_pending') === 'true',
    'pending-universe live request sets is_pending=true');
  ok(!pendingUrl.searchParams.has('start_date') && !pendingUrl.searchParams.has('end_date'),
    'pending-universe live request is not date-bounded');
}

console.log('=== L2. bounded transaction window is paged and truncated pages fail closed ===');
{
  const harness = [
    "'use strict';",
    "const https = require('https');",
    "const { EventEmitter } = require('events');",
    'const pages = {};',
    'https.request = (url, options, cb) => {',
    '  const href = url && url.href ? url.href : String(url);',
    '  const parsed = new URL(href);',
    '  const req = new EventEmitter();',
    '  req.end = () => {',
    '    process.nextTick(() => {',
    '      const res = new EventEmitter();',
    '      res.statusCode = 200;',
    '      cb(res);',
    "      let body = { has_more: false, transactions: [] };",
    "      if (parsed.pathname === '/v2/me' || parsed.pathname === '/v2/plaid_accounts'",
    "        || parsed.pathname === '/v2/manual_accounts' || parsed.pathname === '/v2/assets'",
    "        || parsed.pathname === '/v2/categories') {",
    '        body = {};',
    "      } else if (parsed.searchParams.get('include_pending') === 'true') {",
    "        const offset = Number(parsed.searchParams.get('offset') || 0);",
    '        if (offset === 0) {',
    "          body = { has_more: true, transactions: [{ id: 1, date: '2026-08-15', amount: 10 }] };",
    '        } else {',
    "          body = { has_more: false, transactions: [{ id: 2, date: '2026-08-16', amount: 11 }] };",
    '        }',
    "      } else if (parsed.searchParams.get('is_pending') === 'true') {",
    "        body = { has_more: false, transactions: [] };",
    '      }',
    "      res.emit('data', Buffer.from(JSON.stringify(body)));",
    "      res.emit('end');",
    '    });',
    '  };',
    '  return req;',
    '};',
    `const O = require(${JSON.stringify(path.join(ROOT, 'scripts', 'provider-observe.js'))});`,
    "O.fetchLunchMoneyLive('test-token', '2026-08-16T18:00:00.000Z').then((payload) => {",
    '  process.stdout.write(JSON.stringify({',
    '    ids: (payload.transactions || []).map(t => t.id),',
    '    complete: payload.transactionWindow && payload.transactionWindow.complete,',
    '    truncated: payload.transactionWindow && payload.transactionWindow.truncated,',
    '  }));',
    '}).catch((err) => {',
    '  process.stderr.write(String(err && err.message || err));',
    '  process.exit(1);',
    '});',
  ].join('\n');
  const paged = JSON.parse(execFileSync(process.execPath, ['-e', harness], {
    cwd: ROOT,
    encoding: 'utf8',
  }));
  ok(paged.ids[0] === 1 && paged.ids[1] === 2,
    'bounded window keeps paging until has_more=false', JSON.stringify(paged.ids));
  ok(paged.complete === true && paged.truncated === false,
    'complete posted window is published only after has_more=false');

  const truncatedHarness = [
    "'use strict';",
    "const https = require('https');",
    "const { EventEmitter } = require('events');",
    'https.request = (url, options, cb) => {',
    '  const href = url && url.href ? url.href : String(url);',
    '  const parsed = new URL(href);',
    '  const req = new EventEmitter();',
    '  req.end = () => {',
    '    process.nextTick(() => {',
    '      const res = new EventEmitter();',
    '      res.statusCode = 200;',
    '      cb(res);',
    "      let body = { has_more: false, transactions: [] };",
    "      if (parsed.pathname === '/v2/me' || parsed.pathname === '/v2/plaid_accounts'",
    "        || parsed.pathname === '/v2/manual_accounts' || parsed.pathname === '/v2/assets'",
    "        || parsed.pathname === '/v2/categories') body = {};",
    "      else if (parsed.searchParams.get('include_pending') === 'true') {",
    "        body = { has_more: true, transactions: [{ id: 9, date: '2026-08-15', amount: 40 }] };",
    '      }',
    "      res.emit('data', Buffer.from(JSON.stringify(body)));",
    "      res.emit('end');",
    '    });',
    '  };',
    '  return req;',
    '};',
    `const O = require(${JSON.stringify(path.join(ROOT, 'scripts', 'provider-observe.js'))});`,
    `const F = require(${JSON.stringify(path.join(ROOT, 'public', 'forecast.js'))});`,
    "O.fetchLunchMoneyLive('test-token', '2026-08-16T18:00:00.000Z').then((payload) => {",
    "  const actuals = O.sanitizedCurrentPeriodActuals({",
    '    fetchedAt: payload.fetchedAt,',
    '    transactionWindow: payload.transactionWindow,',
    '    pendingCoverage: payload.pendingCoverage,',
    '    collapsedTransactions: payload.transactions,',
    '    representedEventCandidates: [],',
    '  }, { asOf: "2026-08-16" });',
    "  const action = F.currentPeriodAction({",
    "    windowDays: 40, defaults: { targetBuffer: 0 }, startingCash: { amount: 4000 },",
    "    opening: { asOf: '2026-08-16', representedEvents: [] },",
    "    income: [{ id: 'pay', label: 'Pay', frequency: 'once', date: '2026-08-28', amount: 2500 }],",
    "    obligations: [], bills: [], commitments: [],",
    "    budget: { categories: [{ id: 'groceries', label: 'Groceries', class: 'essential', from: ['Groceries'], plannedMonthly: 1800 }] },",
    "  }, '2026-08-16', { paydayFloor: 1000, currentPeriodActuals: actuals });",
    '  process.stdout.write(JSON.stringify({',
    '    truncated: payload.transactionWindow && payload.transactionWindow.truncated,',
    '    complete: payload.transactionWindow && payload.transactionWindow.complete,',
    '    packet: actuals.transactionCoverage,',
    '    remainingClaim: action.remainingClaim,',
    '  }));',
    '}).catch((err) => {',
    '  process.stderr.write(String(err && err.message || err));',
    '  process.exit(1);',
    '});',
  ].join('\n');
  const truncated = JSON.parse(execFileSync(process.execPath, ['-e', truncatedHarness], {
    cwd: ROOT,
    encoding: 'utf8',
  }));
  ok(truncated.truncated === true && truncated.complete === false,
    'a posted window that never reaches has_more=false is truncated');
  ok(truncated.packet === 'truncated' && truncated.remainingClaim === 'unavailable',
    'Atlas cannot claim precise remaining from an incomplete posted page');
}

console.log('=== M. unobserved live account IDs cannot match fixture mappings ===');
{
  const liveMap = JSON.parse(fs.readFileSync(LIVE_MAP, 'utf8'));
  const fixtureIds = ['1001', '1002', '2001', '2002', '2003'];
  ok(liveMap.scope === 'live', 'default map is the live/owner-observed scope');
  ok(Array.isArray(liveMap.mappings) && liveMap.mappings.length === 0,
    'default live map has no synthetic fixture IDs');
  ok(!liveMap.mappings.some(m => fixtureIds.includes(String(m.providerAccountId))),
    'fixture IDs 1001–2003 are absent from the live map');
  const report = O.observe({ provider: 'lunchmoney', payload, accountMap: liveMap, data });
  ok(report.mapped.length === 0, 'fixture accounts stay unmapped under the live map');
  ok(fixtureIds.every(id => report.unmapped.some(u => u.providerAccountId === id)),
    'unobserved live IDs do not inherit fixture canonical mappings');
  ok(!report.observations.some(o => fixtureIds.includes(String(o.providerAccountId))),
    'fixture IDs produce no live canonical observations');

  let threw = false;
  let message = '';
  try {
    execFileSync(process.execPath, [
      path.join(ROOT, 'scripts', 'provider-observe.js'),
      '--provider', 'lunchmoney',
      '--live',
      '--map', MAP,
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      env: Object.assign({}, process.env, { LUNCHMONEY_ACCESS_TOKEN: 'test-token-not-used' }),
    });
  } catch (e) {
    threw = true;
    message = String(e.stderr || e.stdout || e.message || '');
  }
  ok(threw, 'live CLI refuses a fixture-scoped account map');
  ok(/Fixture account map cannot authorize a live canonical mapping/.test(message),
    'refusal names the fixture-map live boundary');
  ok(!/Bearer\s+\S+/.test(message), 'fixture-map refusal does not print a bearer token');
}

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll provider-observe checks passed.');
