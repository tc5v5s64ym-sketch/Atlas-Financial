'use strict';
const assert = require('node:assert/strict');
const { createService, WRITE_SCOPE, TTL, cents } = require('../scripts/assistant-lunchmoney');
(async () => {
  let clock = Date.parse('2026-10-02T00:00:00Z');
  let writes = []; let ambiguous = false; let ignoreWrite = false; let ledger = null; let more = false;
  let tx = { id: 71, date: '2026-10-01', amount: '19.99', currency: 'cad', payee: 'Synthetic Shop', notes: null,
    category_id: 3, plaid_account_id: 4, manual_account_id: null, is_pending: false, status: 'reviewed' };
  const categories = [{ id: 3, name: 'Groceries' }, { id: 8, name: 'Household' }];
  const service = createService({ now: () => clock, resolveToken: async () => 'synthetic-test-token',
    fetch: async (url, options) => {
      const u = new URL(url); const p = u.pathname.replace('/v2', ''); let data;
      if (options.method !== 'GET') {
        writes.push({ path: p, query: u.search, body: JSON.parse(options.body) });
        if (ambiguous) throw new Error('synthetic transport failure');
        const body = JSON.parse(options.body);
        if (options.method === 'PUT') { if (!ignoreWrite) Object.assign(tx, body); }
        else { tx.is_split_parent = true; tx.children = body.child_transactions.map((c, i) => ({ ...tx, children: undefined,
          is_split_parent: false, id: 100 + i, split_parent_id: tx.id, ...c, notes: c.notes ?? tx.notes })); }
        data = tx;
      } else if (p === '/categories') data = { categories };
      else if (p.startsWith('/categories/')) data = categories.find(c => c.id === Number(p.split('/').pop()));
      else if (p === '/plaid_accounts') data = { plaid_accounts: [{ id: 4, name: 'Bank' }] };
      else if (p === '/manual_accounts') data = { manual_accounts: [{ id: 4, name: 'Cash' }] };
      else if (p === '/transactions') data = { transactions: ledger || [tx], has_more: more };
      else data = tx;
      return { ok: true, json: async () => structuredClone(data) };
    } });
  const auth = { principal: 'owner', scopes: [WRITE_SCOPE] };
  const catalog = await service.invoke('catalog', {}, auth);
  assert.equal(catalog.status, 'ok'); assert.notEqual(catalog.accounts[0].accountRef, catalog.accounts[1].accountRef);
  const args = { startDate: '2026-10-01', endDate: '2026-10-02' };
  const lookup = await service.invoke('query', args, auth); assert.equal(lookup.matchedCount, 1);
  assert.equal(JSON.stringify(lookup).includes('plaid_account_id'), false);
  const transactionRef = lookup.rows[0].transactionRef;
  const input = { transactionRef, changes: { categoryRef: catalog.categories[1].categoryRef, notes: 'Owner confirmed correction' } };
  assert.equal((await service.invoke('prepare', input, { principal: 'owner', scopes: [] })).status, 'unavailable');
  assert.equal((await service.invoke('prepare', input, { ...auth, principal: 'other' })).status, 'unavailable');
  const preview = await service.invoke('prepare', input, auth); assert.equal(preview.status, 'preview'); assert.equal(writes.length, 0);
  assert.equal((await service.invoke('apply', { previewId: preview.previewId, confirmed: false }, auth)).status, 'unavailable');
  assert.equal((await service.invoke('apply', { previewId: preview.previewId, confirmed: true }, { ...auth, principal: 'other' })).status, 'unavailable');
  const applied = await service.invoke('apply', { previewId: preview.previewId, confirmed: true }, auth);
  assert.equal(applied.status, 'applied'); assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { path: '/transactions/71', query: '?update_balance=false', body: { category_id: 8, notes: 'Owner confirmed correction' } });
  assert.equal(tx.amount, '19.99');
  await service.invoke('apply', { previewId: preview.previewId, confirmed: true }, auth); assert.equal(writes.length, 1);
  const stale = await service.invoke('prepare', input, auth); tx.notes = 'Changed elsewhere';
  assert.equal((await service.invoke('apply', { previewId: stale.previewId, confirmed: true }, auth)).status, 'unavailable'); assert.equal(writes.length, 1);
  const badSplit = { transactionRef, splits: [{ amount: '10.00', categoryRef: null }, { amount: '9.98', categoryRef: null }] };
  assert.equal((await service.invoke('prepare', badSplit, auth)).status, 'unavailable');
  const split = await service.invoke('prepare', { ...badSplit, splits: [{ amount: '10.00', categoryRef: null }, { amount: '9.99', categoryRef: catalog.categories[0].categoryRef }] }, auth);
  assert.equal(split.status, 'preview'); assert.equal(writes.length, 1);
  assert.equal((await service.invoke('apply', { previewId: split.previewId, confirmed: true }, auth)).status, 'applied');
  // Independent conservation: 1000 + 999 = 1999 cents, without service arithmetic.
  assert.equal(Number(tx.children[0].amount) * 100 + Number(tx.children[1].amount) * 100, 1999);
  assert.equal((await service.invoke('prepare', input, auth)).status, 'unavailable');
  delete tx.children; tx.is_split_parent = false;
  const uncertain = await service.invoke('prepare', input, auth); ambiguous = true;
  assert.equal((await service.invoke('apply', { previewId: uncertain.previewId, confirmed: true }, auth)).status, 'write-unverified');
  const count = writes.length; await service.invoke('apply', { previewId: uncertain.previewId, confirmed: true }, auth); assert.equal(writes.length, count);
  ambiguous = false; const expired = await service.invoke('prepare', input, auth); clock += TTL + 1;
  assert.equal((await service.invoke('apply', { previewId: expired.previewId, confirmed: true }, auth)).status, 'unavailable');
  assert.equal((await service.invoke('query', { ...args, startDate: '2026-02-30' }, auth)).status, 'unavailable');
  // Renew references after expiry, then prove duplicate/pagination and unknown account failures.
  let fresh = await service.invoke('query', args, auth);
  const freshRef = fresh.rows[0].transactionRef;
  ledger = [tx, { ...tx }];
  assert.equal((await service.invoke('query', args, auth)).status, 'unavailable');
  ledger = [{ ...tx, date: '2026-09-30' }];
  assert.equal((await service.invoke('query', args, auth)).matchedCount, 0);
  ledger = [{ ...tx, plaid_account_id: null }];
  const freshCatalog = await service.invoke('catalog', {}, auth);
  assert.equal((await service.invoke('query', { ...args, excludeAccountRef: freshCatalog.accounts[0].accountRef }, auth)).status, 'unavailable');
  ledger = null; more = true;
  assert.equal((await service.invoke('query', args, auth)).status, 'unavailable');
  more = false;
  assert.equal((await service.invoke('query', args, {})).status, 'unavailable');
  tx.is_pending = true;
  assert.equal((await service.invoke('prepare', { transactionRef: freshRef, changes: { notes: 'pending edit' } }, auth)).status, 'unavailable');
  tx.is_pending = false;
  const mismatch = await service.invoke('prepare', { transactionRef: freshRef, changes: { notes: 'verify mismatch' } }, auth);
  ignoreWrite = true;
  assert.equal((await service.invoke('apply', { previewId: mismatch.previewId, confirmed: true }, auth)).status, 'write-unverified');
  ignoreWrite = false;
  categories[1].archived = true;
  assert.equal((await service.invoke('prepare', { transactionRef: freshRef, changes: { categoryRef: freshCatalog.categories[1].categoryRef } }, auth)).status, 'unavailable');
  delete categories[1].archived;
  const negativeBefore = tx.amount; tx.amount = '-19.99';
  const negative = await service.invoke('prepare', { transactionRef: freshRef,
    splits: [{ amount: '-10.00', categoryRef: null }, { amount: '-9.99', categoryRef: null }] }, auth);
  assert.equal(negative.status, 'preview');
  assert.equal((await service.invoke('prepare', { transactionRef: freshRef,
    splits: [{ amount: '-20.99', categoryRef: null }, { amount: '1.00', categoryRef: null }] }, auth)).status, 'unavailable');
  tx.amount = negativeBefore;
  const concurrent = await service.invoke('prepare', { transactionRef: freshRef, changes: { notes: 'concurrent edit' } }, auth);
  const beforeConcurrent = writes.length;
  const outcomes = await Promise.all([1, 2].map(() => service.invoke('apply', { previewId: concurrent.previewId, confirmed: true }, auth)));
  assert.equal(outcomes.filter(x => x.status === 'applied').length, 1); assert.equal(writes.length, beforeConcurrent + 1);
  assert.equal(cents('-10.25'), -1025); assert.throws(() => cents('1.001'));
  console.log('Lunch Money: lookup, namespaces, scope, subject, confirmation, stale/expired/replay guards, exact edits, split conservation, ambiguous writes PASS');
})().catch(e => { console.error(e); process.exitCode = 1; });
