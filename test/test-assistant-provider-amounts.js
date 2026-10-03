'use strict';
const assert = require('node:assert/strict');
const { createService, READ_SCOPE, WRITE_SCOPE, cents } = require('../scripts/assistant-lunchmoney');

// Independent provider contract: https://lunchmoney.dev/amounts-and-balances
// Read strings retain up to four decimal places; split input remains cents.
const auth = { principal: 'synthetic-owner', scopes: [READ_SCOPE, WRITE_SCOPE] };
const args = { startDate: '2026-10-02', endDate: '2026-10-03' };
function fixture(amount) {
  const tx = { id: 71, date: '2026-10-02', amount, currency: 'cad',
    payee: 'Synthetic Merchant', notes: null, category_id: 8, plaid_account_id: 10 };
  const calls = [];
  const state = { failure: null, malformedCoverage: false, tx };
  const service = createService({ env: {}, resolveToken: async () => 'synthetic-fixture',
    fetch: async (url, options) => {
      const endpoint = new URL(url).pathname.replace('/v2', '');
      calls.push({ endpoint, method: options.method });
      if (endpoint === '/transactions' && state.failure) {
        if (state.failure instanceof Error) throw state.failure;
        return state.failure;
      }
      let data;
      if (endpoint === '/categories') data = { categories: [{ id: 8, name: 'Synthetic Category' }] };
      else if (endpoint === '/categories/8') data = { id: 8, name: 'Synthetic Category' };
      else if (endpoint === '/plaid_accounts') data = { plaid_accounts: [{ id: 10, name: 'Synthetic Account' }] };
      else if (endpoint === '/manual_accounts') data = { manual_accounts: [] };
      else if (endpoint === '/transactions') data = { transactions: [tx], has_more: state.malformedCoverage ? null : false };
      else if (endpoint === '/transactions/71') {
        if (options.method === 'PUT') Object.assign(tx, JSON.parse(options.body));
        data = tx;
      } else throw new Error('unexpected-fixture-endpoint');
      return { ok: true, status: 200, json: async () => structuredClone(data) };
    } });
  return { service, calls, state };
}

(async () => {
  for (const amount of ['19.99', '12.5000', '-1200.0000', '0.0000', '-0.0000', '1.2345', '-1.2345', '1.001', '12345678901.0000']) {
    const { service, calls } = fixture(amount);
    const result = await service.invoke('query', args, auth);
    assert.equal(result.status, 'ok', 'provider amount must remain readable: ' + amount);
    assert.equal(result.rows[0].amount, amount);
    assert.equal(result.rows[0].currency, 'cad');
    assert.equal(result.rows[0].pending, false);
    assert.equal(calls.every(c => c.method === 'GET'), true);
  }
  for (const amount of ['1.23456', '1e2', 'NaN', ' 1.0000', '+1.0000', '', '1.', 1.25, null, '9'.repeat(65)]) {
    const { service, calls } = fixture(amount);
    const result = await service.invoke('query', args, auth);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'lunchmoney-operation-unavailable');
    assert.equal(calls.every(c => c.method === 'GET'), true);
  }
  // Reading a fractional-cent parent does not authorize rounding or splitting it.
  for (const amount of ['12.5000', '1.2345', '-1.2345']) {
    const { service, calls } = fixture(amount);
    const result = await service.invoke('query', args, auth);
    const transactionRef = result.rows[0].transactionRef;
    const split = await service.invoke('prepare', { transactionRef,
      splits: [{ amount: '1.00', categoryRef: null }, { amount: '0.23', categoryRef: null }] }, auth);
    assert.equal(split.status, 'unavailable');
    assert.equal(calls.every(c => c.method === 'GET'), true);
  }
  const f = fixture('-12.5000');
  const lookup = await f.service.invoke('query', args, auth);
  const transactionRef = lookup.rows[0].transactionRef;
  const preview = await f.service.invoke('prepare', { transactionRef, changes: { notes: 'Synthetic confirmed note' } }, auth);
  assert.equal(preview.status, 'preview');
  assert.equal(preview.before.amount, '-12.5000');
  assert.equal(f.calls.every(c => c.method === 'GET'), true);
  assert.equal((await f.service.invoke('apply', { previewId: preview.previewId, confirmed: false }, auth)).status, 'unavailable');
  assert.equal(f.calls.every(c => c.method === 'GET'), true);
  const applied = await f.service.invoke('apply', { previewId: preview.previewId, confirmed: true }, auth);
  assert.equal(applied.status, 'applied');
  assert.equal(applied.transaction.amount, '-12.5000');
  assert.equal(f.state.tx.amount, '-12.5000');
  assert.equal(f.calls.filter(c => c.method !== 'GET').length, 1);
  for (const amount of ['1.001', '1.0000', '1.2345', '-1.2345']) assert.throws(() => cents(amount));
  assert.equal(cents('-10.25'), -1025);
  const rejected = await f.service.invoke('prepare', { transactionRef,
    splits: [{ amount: '1.0000', categoryRef: null }, { amount: '11.50', categoryRef: null }] }, auth);
  assert.equal(rejected.reason, 'invalid-arguments');

  // Diagnostics expose only fixed codes/stages and a numeric HTTP status.
  const sentinel = 'synthetic-private-ledger-and-token';
  const errors = [
    [{ ok: false, status: 429, json: async () => ({ secret: sentinel }) },
      { stage: 'transactions-request', code: 'provider-request-failed', upstreamStatus: 429 }],
    [Object.assign(new Error(sentinel), { name: 'TimeoutError' }),
      { stage: 'transactions-request', code: 'provider-request-timeout' }],
    [new Error(sentinel), { stage: 'transactions-request', code: 'provider-network-error' }],
    [{ ok: true, status: 200, json: async () => { throw new Error(sentinel); } },
      { stage: 'transactions-request', code: 'provider-response-invalid-json', upstreamStatus: 200 }],
  ];
  for (const [failure, expected] of errors) {
    const g = fixture('1.0000'); g.state.failure = failure;
    const result = await g.service.invoke('query', args, auth);
    assert.equal(result.reason, 'lunchmoney-operation-unavailable');
    assert.deepEqual(result.diagnostic, expected);
    assert.equal(JSON.stringify(result).includes(sentinel), false);
    assert.equal(JSON.stringify(result).includes('Authorization'), false);
    assert.equal(g.calls.every(c => c.method === 'GET'), true);
  }
  const invalid = await fixture('1.23456').service.invoke('query', args, auth);
  assert.deepEqual(invalid.diagnostic, { stage: 'transaction-validation', code: 'invalid-provider-amount' });
  const incomplete = fixture('1.0000'); incomplete.state.malformedCoverage = true;
  assert.deepEqual((await incomplete.service.invoke('query', args, auth)).diagnostic,
    { stage: 'query', code: 'coverage-unavailable' });
  console.log('Lunch Money provider amount precision, exact read strings, strict writes and sanitized read failures PASS');
})().catch(e => { console.error(e); process.exitCode = 1; });
