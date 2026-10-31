'use strict';
const assert = require('node:assert/strict');
const { createService, READ_SCOPE } = require('../scripts/assistant-lunchmoney');

(async () => {
  const now = Date.parse('2026-10-03T02:00:00Z');
  // Independently supplied provider facts, including overlapping ID namespaces.
  const plaid = [
    { id: 4, name: 'Savings', display_name: 'EMERGENCY SAVING', type: 'depository',
      subtype: 'savings', institution_name: 'Synthetic Bank', status: 'active',
      balance: '1234.5678', currency: 'cad', balance_last_update: '2026-10-02T18:00:00Z',
      updated_at: '2026-10-03T01:00:00Z', last_fetch: '2026-10-03T01:30:00Z',
      last_import: '2026-10-03T01:20:00Z', plaid_last_successful_update: '2026-10-03T01:25:00Z',
      mask: '9999', plaid_item_id: 'private-connection', custom_metadata: { private: 'never-return' } },
    { id: 5, name: 'SAVINGS-DONT TOUCH', type: 'depository', subtype: 'savings',
      balance: '0.0000', currency: 'cad', balance_last_update: '2026-10-02' },
    { id: 6, name: 'Overdrawn chequing', type: 'depository', subtype: 'checking',
      balance: '-50.2500', currency: 'cad', balance_last_update: null,
      last_fetch: '2026-10-03T01:30:00Z' },
    { id: 7, name: 'Dollar account', type: 'depository', balance: '100.0100',
      currency: 'usd', balance_last_update: '2026-10-02' },
    { id: 8, name: 'Credit card', type: 'credit', balance: '800.0000', currency: 'cad',
      status: 'relink', balance_last_update: '2026-08-18T20:00:00Z' },
  ];
  const manual = [
    { id: 4, name: 'Manual card', type: 'credit', subtype: 'credit card',
      balance: '-20.1200', currency: 'cad', balance_as_of: '2026-08-18',
      updated_at: '2026-10-03T01:00:00Z', status: 'closed', closed_on: '2026-09-01',
      external_id: 'private-external', custom_metadata: { private: 'never-return' } },
  ];
  const calls = []; let failManual = false;
  const service = createService({ now: () => now, resolveToken: async () => 'synthetic-test-token',
    fetch: async (url, opts) => {
      calls.push({ path: new URL(url).pathname, method: opts.method, body: opts.body });
      assert.equal(opts.method, 'GET');
      const p = new URL(url).pathname;
      const data = p.endsWith('/categories') ? { categories: [] }
        : p.endsWith('/plaid_accounts') ? { plaid_accounts: plaid }
        : { manual_accounts: manual };
      return { ok: !(p.endsWith('/manual_accounts') && failManual), json: async () => structuredClone(data) };
    } });
  const auth = { principal: 'owner', scopes: [READ_SCOPE] };
  const before = JSON.stringify({ plaid, manual });
  const result = await service.invoke('catalog', {}, auth);
  assert.equal(result.status, 'ok');
  assert.equal(result.accounts.length, 6);
  assert.equal(result.observedAt, '2026-10-03T02:00:00.000Z');
  assert.equal(result.coverage, 'complete-provider-account-response');
  assert.equal(result.writesAtlasState, false);
  assert.equal(result.providerWrite, false);
  assert.deepEqual(calls.map(c => c.path).sort(), ['/v2/categories', '/v2/manual_accounts', '/v2/plaid_accounts']);
  assert(calls.every(c => c.body === undefined));
  assert.equal(JSON.stringify({ plaid, manual }), before);
  const [emergency, savings, chequing, dollars, credit, oldManual] = result.accounts;
  assert.equal(emergency.name, 'EMERGENCY SAVING');
  assert.equal(emergency.accountType, 'depository');
  assert.equal(emergency.subtype, 'savings');
  assert.deepEqual(emergency.balance, { status: 'reported', amount: '1234.5678', currency: 'cad',
    asOf: '2026-10-02T18:00:00Z', asOfField: 'balance_last_update',
    freshness: 'provider-dated', trust: 'unknown', source: 'Lunch Money v2' });
  assert.equal(emergency.timestamps.lastFetchedAt, '2026-10-03T01:30:00Z');
  assert.equal(savings.balance.amount, '0.0000');
  assert.equal(chequing.balance.amount, '-50.2500');
  assert.equal(chequing.balance.asOf, null);
  assert.equal(chequing.balance.freshness, 'unknown');
  assert.equal(dollars.balance.currency, 'usd');
  assert.equal(credit.balance.amount, '800.0000');
  assert.equal(credit.accountStatus, 'relink');
  assert.equal(oldManual.balance.amount, '-20.1200');
  assert.equal(oldManual.balance.asOf, '2026-08-18');
  assert.equal(oldManual.balance.asOfField, 'balance_as_of');
  assert.equal(oldManual.closedOn, '2026-09-01');
  assert.equal(oldManual.accountStatus, 'closed');
  assert.notEqual(emergency.accountRef, oldManual.accountRef);
  for (const row of result.accounts) {
    assert.equal(row.balance.trust, 'unknown'); // no provider-to-bank verification promotion
    assert.equal('id' in row, false); assert.equal('providerId' in row, false);
    assert.equal('mask' in row, false); assert.equal('custom_metadata' in row, false);
  }
  assert(!JSON.stringify(result).includes('private-'));
  assert.equal('totalBalance' in result, false);
  assert.equal('spendableHouseholdCash' in result, false);

  // Missing/invalid values stay unavailable, while other accounts remain visible.
  for (const balance of [null, undefined, '', 'NaN', 'Infinity', '1e3', '1.00001', 12, true]) {
    plaid[0].balance = balance;
    const response = await service.invoke('catalog', {}, auth);
    assert.equal(response.status, 'ok'); assert.equal(response.accounts.length, 6);
    assert.equal(response.accounts[0].balance.status, 'unavailable');
    assert.equal(response.accounts[0].balance.amount, null);
    assert.equal(response.accounts[0].balance.reason, 'balance-missing-or-invalid');
    assert.equal(response.accounts[1].balance.amount, '0.0000');
  }
  plaid[0].balance = '1234.5678';
  for (const currency of [null, '', 'CAD', 'not-a-currency']) {
    plaid[0].currency = currency;
    const response = await service.invoke('catalog', {}, auth);
    assert.equal(response.accounts[0].balance.status, 'unavailable');
    assert.equal(response.accounts[0].balance.amount, null);
    assert.equal(response.accounts[0].balance.reason, 'currency-missing-or-invalid');
  }
  plaid[0].currency = 'cad';
  for (const stamp of [null, '', '2026-02-30', '2026-02-30T12:00:00Z', 'not-a-date']) {
    plaid[0].balance_last_update = stamp;
    const response = await service.invoke('catalog', {}, auth);
    assert.equal(response.accounts[0].balance.asOf, null);
    assert.equal(response.accounts[0].balance.freshness, 'unknown');
  }
  plaid[0].balance_last_update = '2026-10-04T00:00:00Z';
  assert.equal((await service.invoke('catalog', {}, auth)).accounts[0].balance.freshness, 'future-date');
  const hits = calls.length;
  assert.equal((await service.invoke('catalog', {}, { principal: 'owner', scopes: [] })).reason,
    'transaction-read-scope-required');
  assert.equal((await service.invoke('catalog', {}, {})).reason, 'authenticated-subject-required');
  assert.equal(calls.length, hits);
  failManual = true;
  const failed = await service.invoke('catalog', {}, auth);
  assert.equal(failed.status, 'unavailable'); assert.equal('accounts' in failed, false);
  console.log('MCP account balances: savings, exact decimals/signs/currencies, dates, unknowns, privacy, GET-only and scope guards PASS');
})().catch(e => { console.error(e); process.exitCode = 1; });
