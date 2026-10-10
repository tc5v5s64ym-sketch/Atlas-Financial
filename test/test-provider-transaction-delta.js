'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const Delta = require('../scripts/provider-transaction-delta');

const SINCE = '2026-10-01T00:00:00Z';

function tx(overrides) {
  return Object.assign({
    id: 1,
    created_at: '2026-10-02T10:00:00Z',
    updated_at: '2026-10-02T11:00:00Z',
    date: '2026-10-02',
    amount: '123.4500',
    currency: 'CAD',
    account_id: 77,
    category_id: 55,
    tag_ids: [3, 4],
    is_pending: false,
    status: 'cleared',
  }, overrides || {});
}

// Loopback stub provider: handler receives the parsed URL and the 1-based
// page number (derived from offset/limit) and returns {transactions, has_more}.
async function withStub(handler, run) {
  const seenUrls = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    seenUrls.push(url);
    const limit = Number(url.searchParams.get('limit')) || 1000;
    const offset = Number(url.searchParams.get('offset')) || 0;
    const payload = handler(url, Math.floor(offset / limit) + 1);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/v2`;
  try {
    await run(base, seenUrls);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

(async () => {
  // 1. URL contract: exactly one since mode per call (both kinds proven),
  // include flags set, no date window and no is_pending universe filter.
  await withStub(() => ({ transactions: [], has_more: false }), async (base, seenUrls) => {
    const created = await Delta.fetchTransactionDelta({ kind: 'created', since: SINCE, token: 'synthetic-test-token', base });
    assert.equal(created.kind, 'created');
    const updated = await Delta.fetchTransactionDelta({ kind: 'updated', since: SINCE, token: 'synthetic-test-token', base });
    assert.equal(updated.kind, 'updated');
    assert.equal(seenUrls.length, 2);
    assert.equal(seenUrls[0].searchParams.get('created_since'), SINCE);
    assert.equal(seenUrls[0].searchParams.get('updated_since'), null);
    assert.equal(seenUrls[1].searchParams.get('updated_since'), SINCE);
    assert.equal(seenUrls[1].searchParams.get('created_since'), null);
    for (const url of seenUrls) {
      assert.equal(url.searchParams.get('include_pending'), 'true');
      assert.equal(url.searchParams.get('include_metadata'), 'true');
      assert.equal(url.searchParams.get('include_group_children'), 'true');
      assert.equal(url.searchParams.get('include_split_parents'), 'true');
      assert.equal(url.searchParams.get('start_date'), null);
      assert.equal(url.searchParams.get('end_date'), null);
      assert.equal(url.searchParams.get('is_pending'), null);
    }
  });

  // 2. Multi-page success: 3 pages, all rows, page-complete.
  await withStub((url, pageNum) => ({
    transactions: [tx({ id: pageNum })],
    has_more: pageNum < 3,
  }), async (base) => {
    const result = await Delta.fetchTransactionDelta({ kind: 'created', since: SINCE, token: 'synthetic-test-token', base });
    assert.deepEqual(result.transactions.map((t) => t.providerId), ['1', '2', '3']);
    assert.equal(result.pageComplete, true);
    assert.equal(result.complete, true);
    assert.equal(result.truncated, false);
    assert.equal(result.pages, 3);
  });

  // 3. Truncation: a never-ending stub hits the incumbent page cap and is
  // labelled incomplete — page-complete false, truncated true.
  await withStub(() => ({ transactions: [tx({ id: 9 })], has_more: true }), async (base) => {
    // The pager stops at its 20-page cap; duplicate ids across those pages
    // would fail closed first, so use unique ids per page instead.
    const result = await Delta.fetchTransactionDelta({ kind: 'updated', since: SINCE, token: 'synthetic-test-token', base }).catch((e) => e);
    assert(result instanceof Error, 'duplicate ids across capped pages must fail closed');
  });
  let pageCounter = 0;
  await withStub(() => {
    pageCounter += 1;
    return { transactions: [tx({ id: 1000 + pageCounter })], has_more: true };
  }, async (base) => {
    const result = await Delta.fetchTransactionDelta({ kind: 'updated', since: SINCE, token: 'synthetic-test-token', base });
    assert.equal(result.pageComplete, false);
    assert.equal(result.complete, false);
    assert.equal(result.truncated, true);
    assert.equal(result.pages, 20);
  });

  // 4. Fail closed: duplicate provider ID, missing provider ID, no token,
  // bad kinds and bad timestamps.
  await withStub(() => ({ transactions: [tx({ id: 5 }), tx({ id: 5 })], has_more: false }), async (base) => {
    await assert.rejects(() => Delta.fetchTransactionDelta({ kind: 'created', since: SINCE, token: 'synthetic-test-token', base }), /duplicate provider id 5/);
  });
  await withStub(() => ({ transactions: [tx({ id: undefined })], has_more: false }), async (base) => {
    await assert.rejects(() => Delta.fetchTransactionDelta({ kind: 'created', since: SINCE, token: 'synthetic-test-token', base }), /missing its provider id/);
  });
  await assert.rejects(() => Delta.fetchTransactionDelta({ kind: 'created', since: SINCE, base: 'http://127.0.0.1:1/v2' }), /no Lunch Money credential/);
  assert.throws(() => Delta.buildDeltaUrl({ kind: 'both', since: SINCE }), /exactly one of "created" or "updated"/);
  assert.throws(() => Delta.buildDeltaUrl({ since: SINCE }), /exactly one of "created" or "updated"/);
  assert.equal(Delta.validateSinceTimestamp('2026-10-01T00:00:00.500Z'), '2026-10-01T00:00:00.500Z');
  assert.equal(Delta.validateSinceTimestamp('2026-10-01T00:00:00-07:00'), '2026-10-01T00:00:00-07:00');
  for (const bad of ['2026-10-01', '2026-10-01T00:00:00', 'not-a-date', '', null, 42]) {
    assert.throws(() => Delta.validateSinceTimestamp(bad), /ISO 8601/);
  }

  // 5 + 6. Topology, pending/posted state and exact decimal/currency
  // preservation, all verbatim and uninterpreted.
  const groupParent = tx({ id: 10, is_group: true, is_group_parent: true, amount: '10.0000' });
  const groupChild = tx({ id: 11, group_parent_id: 10 });
  const splitParent = tx({ id: 12, is_split_parent: true });
  const splitChild = tx({ id: 13, split_parent_id: 12 });
  const pendingRow = tx({ id: 14, is_pending: true, status: 'pending', amount: '-0.0100', currency: 'usd' });
  await withStub(() => ({ transactions: [groupParent, groupChild, splitParent, splitChild, pendingRow], has_more: false }), async (base) => {
    const result = await Delta.fetchTransactionDelta({ kind: 'created', since: SINCE, token: 'synthetic-test-token', base });
    const byId = Object.fromEntries(result.transactions.map((t) => [t.providerId, t]));
    assert.equal(byId['10'].isGroupParent, true);
    assert.equal(byId['11'].groupParentId, '10');
    assert.equal(byId['12'].isSplitParent, true);
    assert.equal(byId['13'].splitParentId, '12');
    assert.equal(byId['14'].isPending, true);
    assert.equal(byId['14'].status, 'pending');
    assert.equal(byId['14'].amount, '-0.0100');
    assert.equal(byId['14'].currency, 'usd');
    assert.equal(byId['1'] === undefined, true);
    assert.equal(result.transactions[0].amount, '10.0000');
    assert.equal(result.transactions[0].currency, 'CAD');
    assert.equal(result.transactions[0].createdAt, '2026-10-02T10:00:00Z');
    assert.equal(result.transactions[0].updatedAt, '2026-10-02T11:00:00Z');
    assert.deepEqual(result.transactions[0].tagIds, ['3', '4']);

    // 7. Envelope honesty: fixed caveat verbatim, ledger never complete,
    // no observer-style completeness attestations, UNKNOWN recorded.
    assert.equal(result.schema, 'atlas-lunchmoney-transaction-delta/v1');
    assert.equal(result.caveat, Delta.CAVEAT);
    assert.match(result.caveat, /not a complete ledger or audit stream/);
    assert.equal(result.ledgerComplete, false);
    assert.equal('transactionWindow' in result, false);
    assert.equal('pendingCoverage' in result, false);
    assert.match(result.updatedAtBehavior, /UNKNOWN/);
  });

  console.log('All provider-transaction-delta checks passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
