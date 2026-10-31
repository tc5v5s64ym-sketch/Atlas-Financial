'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createService, READ_SCOPE, WRITE_SCOPE, cents } = require('../scripts/assistant-lunchmoney');

// Independent provider contract: https://lunchmoney.dev/amounts-and-balances
// Read strings retain up to four decimal places; split input remains cents.
const auth = { principal: 'synthetic-owner', scopes: [READ_SCOPE, WRITE_SCOPE] };
const args = { startDate: '2026-10-02', endDate: '2026-10-03' };
function fixture(amount) {
  const tx = { id: 71, date: '2026-10-02', amount, currency: 'cad',
    payee: 'Synthetic Merchant', notes: null, category_id: 8, plaid_account_id: 10 };
  const calls = [];
  const state = { failure: null, malformedCoverage: false, tx, readback: null, ambiguousWrite: false,
    category: { id: 8, name: 'Synthetic Category' } };
  const service = createService({ env: {}, resolveToken: async () => 'synthetic-fixture',
    fetch: async (url, options) => {
      const endpoint = new URL(url).pathname.replace('/v2', '');
      calls.push({ endpoint, method: options.method });
      if (options.method !== 'GET' && !(options.method === 'PUT' && endpoint === '/transactions/71')
        && !(options.method === 'POST' && endpoint === '/transactions/split/71')) throw new Error('unexpected-fixture-write');
      if (endpoint === '/transactions' && state.failure) {
        if (state.failure instanceof Error) throw state.failure;
        return state.failure;
      }
      let data;
      if (endpoint === '/categories') data = { categories: [state.category] };
      else if (endpoint === '/categories/8') data = state.category;
      else if (endpoint === '/plaid_accounts') data = { plaid_accounts: [{ id: 10, name: 'Synthetic Account' }] };
      else if (endpoint === '/manual_accounts') data = { manual_accounts: [] };
      else if (endpoint === '/transactions') data = { transactions: [tx], has_more: state.malformedCoverage ? null : false };
      else if (endpoint === '/transactions/71') {
        if (options.method === 'PUT') Object.assign(tx, JSON.parse(options.body));
        data = tx;
      } else if (endpoint === '/transactions/split/71') {
        if (state.ambiguousWrite) throw new Error('synthetic-private-ambiguous-write');
        const body = JSON.parse(options.body);
        tx.is_split_parent = true;
        tx.children = body.child_transactions.map((row, i) => ({ ...tx, children: undefined,
          is_split_parent: false, id: 101 + i, split_parent_id: tx.id, ...row,
          // Provider wire formatting, independently constructed from strict input.
          amount: row.amount.includes('.') ? row.amount + '0'.repeat(4 - row.amount.split('.')[1].length)
            : row.amount + '.0000', notes: row.notes ?? tx.notes }));
        state.readback?.(tx);
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
  // Fractional-cent parents stay unsplittable; non-conserving children also
  // remain rejected for a whole-cent parent such as 12.5000.
  for (const amount of ['12.5000', '1.2345', '-1.2345']) {
    const { service, calls } = fixture(amount);
    const result = await service.invoke('query', args, auth);
    const transactionRef = result.rows[0].transactionRef;
    const split = await service.invoke('prepare', { transactionRef,
      splits: [{ amount: '1.00', categoryRef: null }, { amount: '0.23', categoryRef: null }] }, auth);
    assert.equal(split.status, 'unavailable');
    assert.equal(calls.every(c => c.method === 'GET'), true);
  }
  // Independent hand cents: a documented whole-cent provider parent must
  // conserve strict caller splits, and returned children may have four places.
  for (const [amount, pieces, handCents] of [
    ['12.50', ['6.25', '6.25'], 1250],
    ['12.5000', ['6.25', '6.25'], 1250],
    ['12.500', ['2.31', '10.19'], 1250],
    ['0012.5000', ['6.25', '6.25'], 1250],
    ['-12.5000', ['-6.25', '-6.25'], -1250],
    ['12.0000', ['6.00', '6.00'], 1200],
    ['12.0000', ['6', '6'], 1200],
    ['0.0100', ['0.00', '0.01'], 1],
  ]) {
    const g = fixture(amount), lookup = await g.service.invoke('query', args, auth);
    const split = await g.service.invoke('prepare', { transactionRef: lookup.rows[0].transactionRef,
      splits: pieces.map(piece => ({ amount: piece, categoryRef: null })) }, auth);
    if (handCents === 1) { // Zero child remains forbidden even with exact conservation.
      assert.equal(split.status, 'unavailable');
      assert.equal(g.calls.every(c => c.method === 'GET'), true);
      continue;
    }
    assert.equal(split.status, 'preview', 'whole-cent provider parent: ' + amount);
    assert.equal(split.before.amount, amount);
    assert.deepEqual(split.proposed.splits.map(row => row.amount), pieces);
    assert.equal(g.calls.every(c => c.method === 'GET'), true);
    const applied = await g.service.invoke('apply', { previewId: split.previewId, confirmed: true }, auth);
    assert.equal(applied.status, 'applied', 'four-place child readback must verify');
    assert.equal(applied.verifiedByReadback, true);
    assert.equal(applied.transaction.amount, amount);
    assert.deepEqual(applied.children.map(row => row.amount), pieces.map(piece => piece.includes('.')
      ? piece + '0'.repeat(4 - piece.split('.')[1].length) : piece + '.0000'));
    assert.equal(g.calls.filter(c => c.method !== 'GET').length, 1);
    assert.equal(g.calls.find(c => c.method === 'POST').endpoint, '/transactions/split/71');
    // Safe two-place fixture input can be compared to a hand total independently.
    assert.equal(pieces.reduce((sum, piece) => sum + Number(piece) * 100, 0), handCents);
  }
  // Provider fractional cents stay readable, but cannot be rounded into a split.
  for (const amount of ['12.5001', '12.5010', '12.5099', '-12.5001', '0.0000', '-0.0000',
    '90071992547409.9200', '-90071992547409.9200']) {
    const g = fixture(amount), lookup = await g.service.invoke('query', args, auth);
    assert.equal(lookup.rows[0].amount, amount);
    const sign = amount.startsWith('-') ? '-' : '';
    const split = await g.service.invoke('prepare', { transactionRef: lookup.rows[0].transactionRef,
      splits: ['6.25', '6.25'].map(piece => ({ amount: sign + piece, categoryRef: null })) }, auth);
    assert.equal(split.status, 'unavailable', 'no fractional rounding or unsafe conversion: ' + amount);
    assert.equal(g.calls.every(c => c.method === 'GET'), true);
  }
  // Four-decimal provider support never broadens caller/write syntax.
  for (const piece of ['6.2500', '6.250', '6.251', '+6.25', '6.25e0', ' 6.25',
    '10000000000.00', 6.25, null]) {
    const g = fixture('12.5000'), lookup = await g.service.invoke('query', args, auth);
    const before = g.calls.length;
    const result = await g.service.invoke('prepare', { transactionRef: lookup.rows[0].transactionRef,
      splits: [{ amount: piece, categoryRef: null }, { amount: '6.25', categoryRef: null }] }, auth);
    assert.equal(result.reason, 'invalid-arguments');
    assert.equal(g.calls.length, before, 'invalid caller input must not reach provider');
  }
  for (const pieces of [['6.25', '6.24'], ['13.50', '-1.00'], ['0.00', '12.50']]) {
    const g = fixture('12.5000'), lookup = await g.service.invoke('query', args, auth);
    const result = await g.service.invoke('prepare', { transactionRef: lookup.rows[0].transactionRef,
      splits: pieces.map(amount => ({ amount, categoryRef: null })) }, auth);
    assert.equal(result.status, 'unavailable', 'sum/sign/nonzero guards');
    assert.equal(g.calls.every(c => c.method === 'GET'), true);
  }
  const readbackMutations = [
    ['fractional cent', tx => { tx.children[0].amount = '6.2501'; }],
    ['third-place fraction', tx => { tx.children[0].amount = '6.251'; }],
    ['wrong cents', tx => { tx.children[0].amount = '6.2600'; }],
    ['wrong sign', tx => { tx.children[0].amount = '-6.2500'; }],
    ['unsafe cents', tx => { tx.children[0].amount = '90071992547409.9200'; }],
    ['numeric amount', tx => { tx.children[0].amount = 6.25; }],
    ['exponent amount', tx => { tx.children[0].amount = '6.25e0'; }],
    ['oversized precision', tx => { tx.children[0].amount = '6.25000'; }],
    ['child currency', tx => { tx.children[0].currency = 'usd'; }],
    ['child date', tx => { tx.children[0].date = '2026-10-03'; }],
    ['child category', tx => { tx.children[0].category_id = 8; }],
    ['child notes', tx => { tx.children[0].notes = 'synthetic unexpected note'; }],
    ['child parent', tx => { tx.children[0].split_parent_id = 72; }],
    ['child synced account', tx => { tx.children[0].plaid_account_id = 11; }],
    ['child manual account', tx => { tx.children[0].manual_account_id = 11; }],
    ['child payee', tx => { tx.children[0].payee = 'Synthetic Different Merchant'; }],
    ['parent amount', tx => { tx.amount = '12.5100'; }],
    ['parent wire identity', tx => { tx.amount = '12.50'; }],
    ['parent currency', tx => { tx.currency = 'usd'; }],
    ['parent identity', tx => { tx.id = 72; }],
    ['parent split state', tx => { tx.is_split_parent = false; }],
    ['missing child', tx => { tx.children.pop(); }],
    ['extra child', tx => { tx.children.push({ ...tx.children[0], id: 103 }); }],
  ];
  for (const [label, mutation] of readbackMutations) {
    const g = fixture('12.5000'), lookup = await g.service.invoke('query', args, auth);
    const preview = await g.service.invoke('prepare', { transactionRef: lookup.rows[0].transactionRef,
      splits: [{ amount: '6.25', categoryRef: null }, { amount: '6.25', categoryRef: null }] }, auth);
    assert.equal(preview.status, 'preview');
    g.state.readback = mutation;
    const result = await g.service.invoke('apply', { previewId: preview.previewId, confirmed: true }, auth);
    assert.equal(result.status, 'write-unverified', label);
    assert.equal(result.providerWriteMayHaveOccurred, true);
    assert.equal(result.verifiedByReadback, undefined);
    assert.equal(result.transaction, undefined);
    const writes = g.calls.filter(c => c.method !== 'GET').length;
    assert.equal(writes, 1);
    assert.equal((await g.service.invoke('apply', { previewId: preview.previewId, confirmed: true }, auth)).reason,
      'preview-expired-or-already-used');
    assert.equal(g.calls.filter(c => c.method !== 'GET').length, writes, 'no retry after unverified ' + label);
  }
  // Confirmation, subject/scope, stale evidence and category gates still run
  // before the synthetic write for four-place provider parents.
  const guarded = fixture('12.5000'), guardedLookup = await guarded.service.invoke('query', args, auth);
  const guardedPreview = await guarded.service.invoke('prepare', {
    transactionRef: guardedLookup.rows[0].transactionRef,
    splits: [{ amount: '6.25', categoryRef: null }, { amount: '6.25', categoryRef: null }] }, auth);
  for (const [input, caller, reason] of [
    [{ previewId: guardedPreview.previewId, confirmed: false }, auth, 'invalid-arguments'],
    [{ previewId: guardedPreview.previewId, confirmed: true }, { ...auth, scopes: [READ_SCOPE] }, 'transaction-write-scope-required'],
    [{ previewId: guardedPreview.previewId, confirmed: true }, { ...auth, principal: 'synthetic-other' }, 'preview-expired-or-already-used'],
  ]) assert.equal((await guarded.service.invoke('apply', input, caller)).reason, reason);
  assert.equal(guarded.calls.every(c => c.method === 'GET'), true);
  guarded.state.tx.amount = '12.50';
  assert.equal((await guarded.service.invoke('apply', { previewId: guardedPreview.previewId, confirmed: true }, auth)).reason,
    'transaction-changed-prepare-new-preview');
  assert.equal(guarded.calls.every(c => c.method === 'GET'), true);
  const categoryGuard = fixture('12.5000'), cat = await categoryGuard.service.invoke('catalog', {}, auth);
  const catLookup = await categoryGuard.service.invoke('query', args, auth);
  const catPreview = await categoryGuard.service.invoke('prepare', { transactionRef: catLookup.rows[0].transactionRef,
    splits: [{ amount: '6.25', categoryRef: cat.categories[0].categoryRef }, { amount: '6.25', categoryRef: null }] }, auth);
  categoryGuard.state.category.archived = true;
  assert.equal((await categoryGuard.service.invoke('apply', { previewId: catPreview.previewId, confirmed: true }, auth)).reason,
    'apply-rejected-before-write');
  assert.equal(categoryGuard.calls.every(c => c.method === 'GET'), true);
  const ambiguous = fixture('12.5000'), ambiguousLookup = await ambiguous.service.invoke('query', args, auth);
  const ambiguousPreview = await ambiguous.service.invoke('prepare', { transactionRef: ambiguousLookup.rows[0].transactionRef,
    splits: [{ amount: '6.25', categoryRef: null }, { amount: '6.25', categoryRef: null }] }, auth);
  ambiguous.state.ambiguousWrite = true;
  const unknown = await ambiguous.service.invoke('apply', { previewId: ambiguousPreview.previewId, confirmed: true }, auth);
  assert.equal(unknown.status, 'write-unverified');
  assert.equal(unknown.reason, 'provider-result-unknown-do-not-retry');
  assert.equal(JSON.stringify(unknown).includes('synthetic-private-ambiguous-write'), false);
  await ambiguous.service.invoke('apply', { previewId: ambiguousPreview.previewId, confirmed: true }, auth);
  assert.equal(ambiguous.calls.filter(c => c.method !== 'GET').length, 1);

  // Exercise the private conversion boundary without expanding production
  // exports. Hand integer expectations cover the safe-cent limit exactly.
  const sourcePath = require.resolve('../scripts/assistant-lunchmoney');
  const sandbox = { require: createRequire(sourcePath), module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8') + '\nmodule.exports.testProviderCents = providerCents;', sandbox);
  const providerCents = sandbox.module.exports.testProviderCents;
  for (const [value, expected] of [['12.5000', 1250], ['-12.5000', -1250], ['12.500', 1250],
    ['00012.5000', 1250], ['0.0100', 1], ['-0.0100', -1],
    ['90071992547409.9100', Number.MAX_SAFE_INTEGER], ['-90071992547409.9100', -Number.MAX_SAFE_INTEGER]]) {
    assert.equal(providerCents(value), expected);
    assert.equal(Number.isSafeInteger(providerCents(value)), true);
  }
  for (const value of ['90071992547409.9200', '-90071992547409.9200', '1.2345', '1.001',
    '9'.repeat(65), '1.00000', '+1.0000', ' 1.0000', '1e2', '', 1.25, null, {}]) {
    assert.throws(() => providerCents(value));
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
