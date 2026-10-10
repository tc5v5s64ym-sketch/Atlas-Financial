'use strict';
const assert = require('node:assert/strict');
const { createService, READ_SCOPE, WRITE_SCOPE } = require('../scripts/assistant-lunchmoney');

(async () => {
  const now = Date.parse('2026-10-03T02:00:00Z');
  // Independently supplied synthetic provider facts. Plaid and manual accounts
  // deliberately share provider id 4; their history must map to different refs.
  const plaid = [{ id: 4, name: 'Bank', display_name: 'Synthetic Chequing', type: 'depository' },
    { id: 9, name: 'Card', display_name: 'Synthetic Card', type: 'credit' }];
  const manual = [{ id: 4, name: 'Synthetic Cash', type: 'cash' }];
  let history = [
    { source: { type: 'plaid', plaid_account_id: 4 }, balances: [
      { type: 'historical', id: 102, month: '2026-02', balance: '41211.8000', currency: 'cad', to_base: 41211.8, crypto_balance: null },
      { type: 'historical', id: 101, month: '2026-01', balance: '41000.0000', currency: 'cad', to_base: 41000, crypto_balance: null },
      { type: 'current', month: '2026-03', balance: '42000.5000', currency: 'cad', to_base: 42000.5, crypto_balance: null } ] },
    { source: { type: 'manual', manual_account_id: 4 }, balances: [
      { type: 'historical', id: 201, month: '2026-01', balance: '-20.1200', currency: 'cad', to_base: -20.12, crypto_balance: null } ] },
    { source: { type: 'plaid', plaid_account_id: 9 }, balances: [
      { type: 'historical', id: 301, month: '2026-01', balance: null, currency: 'usd', to_base: null, crypto_balance: null },
      { type: 'historical', id: 302, month: '2026-02', balance: '800.0000', currency: 'USD', to_base: 800, crypto_balance: null } ] },
    { source: { type: 'deleted', deleted_account_id: 77 }, balances: [
      { type: 'historical', id: 401, month: '2026-01', balance: '5.0000', currency: 'cad', to_base: 5, crypto_balance: null } ] },
  ];
  const calls = [];
  let failHistory = false;
  const service = createService({ now: () => now, resolveToken: async () => 'synthetic-test-token',
    fetch: async (url, opts) => {
      const u = new URL(url); const p = u.pathname;
      calls.push({ path: p, method: opts.method, body: opts.body, query: u.searchParams });
      assert.equal(opts.method, 'GET');
      const data = p.endsWith('/categories') ? { categories: [] }
        : p.endsWith('/plaid_accounts') ? { plaid_accounts: plaid }
        : p.endsWith('/manual_accounts') ? { manual_accounts: manual }
        : { balance_history: history };
      return { ok: !(failHistory && p.endsWith('/balance_history')), status: failHistory && p.endsWith('/balance_history') ? 429 : 200,
        json: async () => structuredClone(data) };
    } });
  const auth = { principal: 'owner', scopes: [READ_SCOPE] };
  const input = { startMonth: '2026-01', endMonth: '2026-03' };
  const before = JSON.stringify(history);
  const result = await service.invoke('balanceHistory', input, auth);
  assert.equal(result.status, 'ok');
  assert.equal(result.granularity, 'monthly');
  assert.equal(result.isPayPeriodSnapshot, false);
  assert.equal(result.coverage, 'complete-provider-response');
  assert.equal(result.writesAtlasState, false);
  assert.equal(result.providerWrite, false);
  assert.deepEqual(result.window, input);
  assert.equal(JSON.stringify(history), before);

  // GET-only wire proof: catalog GETs plus exactly one history GET carrying
  // both months; no request ever carries a body.
  assert(calls.every(c => c.body === undefined));
  const historyCalls = calls.filter(c => c.path.endsWith('/balance_history'));
  assert.equal(historyCalls.length, 1);
  assert.equal(historyCalls[0].query.get('start_month'), '2026-01');
  assert.equal(historyCalls[0].query.get('end_month'), '2026-03');

  assert.equal(result.accountCount, 4);
  assert.equal(result.entryCount, 7);
  assert.equal('totalBalance' in result, false);
  assert(!JSON.stringify(result).includes('to_base'));
  assert(!JSON.stringify(result).includes('plaid_account_id'));
  assert(!JSON.stringify(result).includes('manual_account_id'));
  assert(!JSON.stringify(result).includes('deleted_account_id'));

  const byLabel = Object.fromEntries(result.accounts.map(a => [a.account || a.sourceType, a]));
  const chequing = byLabel['Synthetic Chequing'];
  assert.equal(chequing.accountMapping, 'catalog');
  assert.deepEqual(chequing.entries.map(e => e.month), ['2026-01', '2026-02', '2026-03']);
  // Independent arithmetic on the returned strings, not service math:
  // 41000.0000 + 1211.8000 = 42211.8000 across Jan->Feb is NOT claimed anywhere;
  // exact strings and signs are simply preserved verbatim.
  assert.equal(chequing.entries[0].balance.amount, '41000.0000');
  assert.equal(chequing.entries[1].balance.amount, '41211.8000');
  assert.equal(chequing.entries[0].entryType, 'historical');
  assert.equal(chequing.entries[0].entryId, 101);
  assert.equal(chequing.entries[2].entryType, 'current');
  assert.equal(chequing.entries[2].entryId, null);
  assert(chequing.entries.every(e => e.balance.trust === 'unknown' && e.balance.currency === 'cad'));

  const cash = byLabel['Synthetic Cash'];
  assert.equal(cash.accountMapping, 'catalog');
  assert.notEqual(cash.accountRef, chequing.accountRef);
  assert.equal(cash.entries[0].balance.amount, '-20.1200');

  // Missing balance and invalid currency stay unavailable — never zero — while
  // the account's other months remain visible.
  const card = byLabel['Synthetic Card'];
  assert.equal(card.entries[0].balance.status, 'unavailable');
  assert.equal(card.entries[0].balance.amount, null);
  assert.equal(card.entries[0].balance.reason, 'balance-missing-or-invalid');
  assert.equal(card.entries[1].balance.status, 'unavailable');
  assert.equal(card.entries[1].balance.amount, null);
  assert.equal(card.entries[1].balance.reason, 'currency-missing-or-invalid');

  // A deleted-account source is reported, never dropped and never given an
  // invented catalog reference.
  const deleted = byLabel.deleted;
  assert.equal(deleted.accountRef, null);
  assert.equal(deleted.account, null);
  assert.equal(deleted.accountMapping, 'unavailable');
  assert.equal(deleted.accountMappingReason, 'account-source-not-in-atlas-catalog');
  assert.equal(deleted.entries[0].balance.amount, '5.0000');

  // Out-of-window entries are not returned for the requested window.
  history = [{ source: { type: 'plaid', plaid_account_id: 4 }, balances: [
    { type: 'historical', id: 99, month: '2025-12', balance: '1.0000', currency: 'cad', to_base: 1, crypto_balance: null },
    { type: 'historical', id: 101, month: '2026-01', balance: '41000.0000', currency: 'cad', to_base: 41000, crypto_balance: null } ] }];
  const narrowed = await service.invoke('balanceHistory', input, auth);
  assert.equal(narrowed.entryCount, 1);
  assert.equal(narrowed.accounts[0].entries[0].month, '2026-01');

  // Duplicate month for one account and duplicate account blocks fail closed.
  history = [{ source: { type: 'plaid', plaid_account_id: 4 }, balances: [
    { type: 'historical', id: 101, month: '2026-01', balance: '1.0000', currency: 'cad', to_base: 1, crypto_balance: null },
    { type: 'current', month: '2026-01', balance: '2.0000', currency: 'cad', to_base: 2, crypto_balance: null } ] }];
  const duplicateMonth = await service.invoke('balanceHistory', input, auth);
  assert.equal(duplicateMonth.status, 'unavailable');
  assert.equal(duplicateMonth.diagnostic.code, 'duplicate-provider-identity');
  history = [
    { source: { type: 'plaid', plaid_account_id: 4 }, balances: [] },
    { source: { type: 'plaid', plaid_account_id: 4 }, balances: [] }];
  assert.equal((await service.invoke('balanceHistory', input, auth)).status, 'unavailable');

  // Malformed payloads and malformed entries fail closed with a safe stage.
  history = { not: 'an array' };
  const malformed = await service.invoke('balanceHistory', input, auth);
  assert.equal(malformed.status, 'unavailable');
  assert.equal(malformed.diagnostic.stage, 'balanceHistory');
  assert.equal(malformed.diagnostic.code, 'balance-history-unavailable');
  history = [{ source: { type: 'plaid', plaid_account_id: 4 }, balances: [
    { type: 'historical', month: '2026-01', balance: '1.0000', currency: 'cad' } ] }];
  assert.equal((await service.invoke('balanceHistory', input, auth)).status, 'unavailable');
  history = [{ source: { type: 'mystery', mystery_account_id: 1 }, balances: [] }];
  assert.equal((await service.invoke('balanceHistory', input, auth)).status, 'unavailable');

  // Provider failure is a sanitized read failure, never partial data.
  history = [];
  failHistory = true;
  const failed = await service.invoke('balanceHistory', input, auth);
  assert.equal(failed.status, 'unavailable');
  assert.equal(failed.diagnostic.stage, 'balance-history-request');
  assert.equal(failed.diagnostic.code, 'provider-request-failed');
  assert.equal(failed.diagnostic.upstreamStatus, 429);
  assert.equal('accounts' in failed, false);
  failHistory = false;

  // Invalid windows are rejected before any provider call.
  const hits = calls.length;
  for (const bad of [{ startMonth: '2026-13', endMonth: '2026-13' },
    { startMonth: '2026-03', endMonth: '2026-01' },
    { startMonth: '2020-01', endMonth: '2030-01' },
    { startMonth: '2026-01' }, { endMonth: '2026-03' },
    { startMonth: '2026-1', endMonth: '2026-03' }]) {
    assert.equal((await service.invoke('balanceHistory', bad, auth)).reason, 'invalid-arguments');
  }
  assert.equal(calls.length, hits);

  // Read scope only: write scope alone, no scope, and no principal all fail
  // before any provider call.
  assert.equal((await service.invoke('balanceHistory', input, { principal: 'owner', scopes: [WRITE_SCOPE] })).reason,
    'transaction-read-scope-required');
  assert.equal((await service.invoke('balanceHistory', input, { principal: 'owner', scopes: [] })).reason,
    'transaction-read-scope-required');
  assert.equal((await service.invoke('balanceHistory', input, {})).reason, 'authenticated-subject-required');
  assert.equal(calls.length, hits);

  // MCP surface: the tool is registered read-only under the ledger-read scope
  // only, alongside the incumbent tools, and dispatches to this read.
  const MCP = require('../scripts/assistant-mcp');
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
  const server = MCP.createServer(async () => null, { lunchMoney: service, auth });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'synthetic-balance-history', version: '1' });
  await server.connect(serverSide); await client.connect(clientSide);
  try {
    const listed = await client.listTools();
    const tool = listed.tools.find(t => t.name === 'get_lunchmoney_balance_history');
    assert(tool, 'balance history tool is registered');
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.deepEqual(tool._meta.securitySchemes[0].scopes, [MCP.REQUIRED_SCOPE, READ_SCOPE]);
    history = [{ source: { type: 'manual', manual_account_id: 4 }, balances: [
      { type: 'historical', id: 201, month: '2026-02', balance: '7.2500', currency: 'cad', to_base: 7.25, crypto_balance: null } ] }];
    const viaMcp = await client.callTool({ name: 'get_lunchmoney_balance_history', arguments: input });
    assert.equal(viaMcp.isError, false);
    assert.equal(viaMcp.structuredContent.status, 'ok');
    assert.equal(viaMcp.structuredContent.accounts[0].entries[0].balance.amount, '7.2500');
  } finally { await client.close().catch(() => {}); await server.close().catch(() => {}); }

  console.log('Lunch Money balance history: monthly-only, exact decimals/currencies, catalog mapping, unavailable-not-zero, duplicate/malformed fail-closed, GET-only and read-scope guards PASS');
})().catch(e => { console.error(e); process.exitCode = 1; });
