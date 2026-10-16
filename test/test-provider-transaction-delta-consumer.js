'use strict';
/* ATLAS-038 consumer-contract tests for
 * scripts/provider-transaction-delta-consumer.js.
 *
 * Synthetic fixtures and a loopback stub provider only — no live provider
 * calls, no credentials, no household data. The stub routes by query
 * shape: created_since -> created delta pages, updated_since -> updated
 * delta pages, start_date -> full-window pages, and records every emitted
 * URL so the tests can pin the exact requests both legs make.
 *
 * The acceptance rows referenced are the ATLAS-038 revised matrix
 * (A1–A14) as amended by Atlas's rulings (Slack ts 1792138178.535059):
 * Q1 whole-cycle conflict failure; Q2 raw IDs internal only; Q3 validated
 * caller-supplied window, no invented floor; Q4 caller-supplied state;
 * Q5 pass-membership differences are not conflicts, same-ID payload
 * differences are; Q7 mandatory same-cycle complete reconciliation;
 * PIN 1 consumer-owned window URL carrying both topology flags, emitted
 * requests pinned; PIN 2 partial/failed/divergent cycles return cursor
 * null and no applicable output, conflicts withhold merged candidates;
 * PIN 3 no completeness claim from idempotence, unseen backdated-row
 * negative case included.
 *
 * Round 2 (Systems Review BLOCK 5545500868 on head edc7976e): the Q3
 * scope qualification. Known state is a SCOPED input — { rows, scope } —
 * whose declared effective date bounds and four query flags must equal
 * the reconciliation scope before any diffing; missing or mismatched
 * scope returns an unqualified cycle (section 18). On the round-1 code
 * these pins fail: the old API accepted only a bare array, so
 * known-state scope was inexpressible and payload equality certified
 * incomparable scopes. Sections 1–17 are unchanged in their assertions;
 * only the known-state harness shape changed to carry the scope.
 *
 * Sections 3 and 6 are the naive-merge guards: if the consumer's merge
 * degenerated to a silent first-wins (or last-wins) merge, section 3's
 * conflict case would return rows and a 'complete' status instead of a
 * whole-cycle conflict, and section 6's absent-window case would still
 * pass only because there is nothing to win — so section 3 is the
 * primary guard, with section 4 (membership vs payload) guarding the
 * opposite overreach of treating pass membership as conflict.
 */
const assert = require('node:assert/strict');
const http = require('node:http');
const Delta = require('../scripts/provider-transaction-delta');
const Consumer = require('../scripts/provider-transaction-delta-consumer');

let checks = 0;
function eq(actual, expected, message) { checks += 1; assert.equal(actual, expected, message); }
function deepEq(actual, expected, message) { checks += 1; assert.deepEqual(actual, expected, message); }
function ok(value, message) { checks += 1; assert.ok(value, message); }
function match(value, pattern, message) { checks += 1; assert.match(value, pattern, message); }

const SINCE = '2026-10-01T00:00:00Z';
const CYCLE_START = '2026-10-16T00:00:00Z';

// Raw provider row (the shape the provider returns; the delta module and
// the consumer's window alignment map it via Delta.mapDeltaTransaction).
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

// Known state is caller-supplied in the mapped shape, as a SCOPED input:
// { rows, scope }, where scope declares the effective date bounds and
// the four query flags the state was captured under (Q3, round 2). The
// default scope matches the default test window (now 2026-10-16,
// historyDays 45 -> 2026-09-01..2026-10-16, all four flags true).
const MATCHING_SCOPE = {
  startDate: '2026-09-01',
  endDate: '2026-10-16',
  include_pending: true,
  include_metadata: true,
  include_group_children: true,
  include_split_parents: true,
};

function knownRows(rawOverridesList) {
  return rawOverridesList.map((overrides) => Delta.mapDeltaTransaction(tx(overrides)));
}

function scopedKnown(rows, scopeOverrides) {
  return { rows, scope: Object.assign({}, MATCHING_SCOPE, scopeOverrides || {}) };
}

function known(rawOverridesList) {
  return scopedKnown(knownRows(rawOverridesList));
}

function payload(transactions, hasMore) {
  return { transactions, has_more: hasMore === true };
}

// Loopback stub provider. routes: { created, updated, window } — each a
// function (page, url) returning a payload object, or { status, payload }
// to simulate a provider error on that page.
async function withProvider(routes, run) {
  const seenUrls = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    seenUrls.push(url);
    const limit = Number(url.searchParams.get('limit')) || 1000;
    const offset = Number(url.searchParams.get('offset')) || 0;
    const page = Math.floor(offset / limit) + 1;
    let route = null;
    if (url.searchParams.get('created_since')) route = routes.created;
    else if (url.searchParams.get('updated_since')) route = routes.updated;
    else if (url.searchParams.get('start_date')) route = routes.window;
    const out = route ? route(page, url) : payload([]);
    const status = out && out.status ? out.status : 200;
    const body = out && out.status ? out.payload : out;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/v2`;
  try {
    await run(base, seenUrls);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function cycleOpts(base, extra) {
  return Object.assign({
    since: SINCE,
    token: 'synthetic-test-token',
    base,
    window: { now: '2026-10-16T12:00:00Z', historyDays: 45 },
    knownState: known([]),
    cycleStart: CYCLE_START,
  }, extra || {});
}

function assertHonestEnvelope(result) {
  eq(result.ledgerComplete, false, 'ledgerComplete stays false on every result shape');
  eq(result.caveat, Delta.CAVEAT, 'caveat propagates verbatim');
  eq(result.updatedAtBehavior, Delta.UPDATED_AT_BEHAVIOR, 'updatedAtBehavior propagates verbatim');
}

(async () => {
  // 1. A1 — clean cycle: the same ID with an identical payload in both
  // passes merges to one row with no conflict; pass-exclusive IDs are
  // included; the window agrees with the candidate exactly. The cursor
  // is offered, valued at the cycle-start instant.
  await withProvider({
    created: () => payload([tx({ id: 3 })]),
    updated: () => payload([tx({ id: 3 }), tx({ id: 2 })]),
    window: () => payload([tx({ id: 1 }), tx({ id: 2 }), tx({ id: 3 })]),
  }, async (base) => {
    const result = await Consumer.consumeDeltaCycle(cycleOpts(base, {
      knownState: known([{ id: 1 }, { id: 2 }]),
    }));
    eq(result.status, 'complete');
    eq(result.pairComplete, true);
    eq(result.reconciliationOutcome, 'complete');
    eq(result.reconciliationComplete, true);
    eq(result.reconciliationCertified, true);
    eq(result.advanceableCursor, CYCLE_START, 'advanceable value is the cycle-start instant');
    deepEq(result.rows.map((r) => r.providerId), ['3', '2'], 'merged delta rows: created order, then updated-only IDs');
    eq(result.rows.filter((r) => r.providerId === '3').length, 1, 'identical cross-pass payload collapses to one row');
    deepEq(result.conflicts, []);
    deepEq(result.divergences, []);
    eq(result.diagnosticCandidates, null, 'no diagnostic candidates on a clean cycle');
    assertHonestEnvelope(result);
  });

  // 2. PIN 1 / A12 — emitted requests: both legs are flag-identical. The
  // consumer-owned window URL carries both topology flags (the incumbent
  // window builder alone cannot express them); the delta URLs carry
  // exactly one since-mode each and the identical `since`.
  await withProvider({
    created: () => payload([]),
    updated: () => payload([]),
    window: () => payload([]),
  }, async (base, seenUrls) => {
    const result = await Consumer.consumeDeltaCycle(cycleOpts(base));
    eq(result.status, 'complete');
    const deltaUrls = seenUrls.filter((u) => u.searchParams.get('created_since') || u.searchParams.get('updated_since'));
    const windowUrls = seenUrls.filter((u) => u.searchParams.get('start_date'));
    eq(deltaUrls.length, 2, 'exactly two delta requests');
    eq(windowUrls.length, 1, 'exactly one window request');
    const createdUrl = deltaUrls.find((u) => u.searchParams.get('created_since'));
    const updatedUrl = deltaUrls.find((u) => u.searchParams.get('updated_since'));
    eq(createdUrl.searchParams.get('created_since'), SINCE);
    eq(createdUrl.searchParams.get('updated_since'), null);
    eq(updatedUrl.searchParams.get('updated_since'), SINCE);
    eq(updatedUrl.searchParams.get('created_since'), null);
    const flagSet = (u) => ['include_pending', 'include_metadata', 'include_group_children', 'include_split_parents']
      .map((f) => `${f}=${u.searchParams.get(f)}`).join('&');
    for (const url of seenUrls) {
      eq(flagSet(url), 'include_pending=true&include_metadata=true&include_group_children=true&include_split_parents=true',
        'every emitted request carries the identical four-flag set');
    }
    eq(windowUrls[0].searchParams.get('start_date'), '2026-09-01', 'window start derives from the caller descriptor');
    eq(windowUrls[0].searchParams.get('end_date'), '2026-10-16', 'window end derives from the caller descriptor');
    deepEq(result.windowScope, { startDate: '2026-09-01', endDate: '2026-10-16', historyDays: 45 });
  });

  // 3. A6 / Q1 / PIN 2 — cross-pass conflict (the naive-merge guard): the
  // same stable ID with a divergent amount in the two passes, both
  // page-complete. The whole cycle fails as a unit: conflict recorded
  // with the divergent field names, merged candidates withheld entirely
  // (a first-wins merge would have published 42.0000 and advanced), the
  // reconciliation leg is not even run.
  await withProvider({
    created: () => payload([tx({ id: 7, amount: '42.0000' })]),
    updated: () => payload([tx({ id: 7, amount: '99.0000' })]),
    window: () => payload([tx({ id: 7 })]),
  }, async (base, seenUrls) => {
    const result = await Consumer.consumeDeltaCycle(cycleOpts(base));
    eq(result.status, 'conflict');
    deepEq(result.conflicts, [{ providerId: '7', fields: ['amount'] }]);
    eq(result.rows, null, 'conflict withholds applicable output');
    eq(result.diagnosticCandidates, null, 'conflict withholds merged candidates entirely');
    eq(result.advanceableCursor, null);
    eq(result.pairComplete, true, 'both passes were page-complete; the failure is the conflict, not the reads');
    eq(result.reconciliationOutcome, 'not-run');
    eq(seenUrls.filter((u) => u.searchParams.get('start_date')).length, 0, 'reconciliation leg not run on a conflict cycle');
    assertHonestEnvelope(result);
  });

  // 4. Q5 — pass membership is not conflict: an ID in only the created
  // pass and another in only the updated pass (including a group child
  // whose parent arrives in the other pass) merge without any conflict
  // record; only same-ID payload differences conflict (section 3).
  await withProvider({
    created: () => payload([tx({ id: 20 }), tx({ id: 22, is_group: true, is_group_parent: true, children: [tx({ id: 23, group_parent_id: 22 })] })]),
    updated: () => payload([tx({ id: 21 }), tx({ id: 23, group_parent_id: 22 })]),
    window: () => payload([
      tx({ id: 20 }),
      tx({ id: 21 }),
      tx({ id: 22, is_group: true, is_group_parent: true, children: [tx({ id: 23, group_parent_id: 22 })] }),
      tx({ id: 23, group_parent_id: 22 }),
    ]),
  }, async (base) => {
    const result = await Consumer.consumeDeltaCycle(cycleOpts(base));
    eq(result.status, 'complete');
    deepEq(result.conflicts, [], 'membership differences between the passes are not conflicts');
    deepEq(result.rows.map((r) => r.providerId), ['20', '22', '21', '23']);
    eq(result.advanceableCursor, CYCLE_START);
    assertHonestEnvelope(result);
  });

  // 5. A3 — a truncated pass: rows are returned by the delta but are
  // partial/untrusted. Cursor null, no applicable output; the computed
  // merge survives only as explicitly labelled diagnostic candidates.
  let truncPage = 0;
  await withProvider({
    created: () => payload([]),
    updated: () => { truncPage += 1; return payload([tx({ id: 100 + truncPage })], true); },
    window: () => payload([]),
  }, async (base) => {
    const result = await Consumer.consumeDeltaCycle(cycleOpts(base, {
      fetchOptions: { limit: 1, maxPages: 3 },
    }));
    eq(result.status, 'incomplete');
    eq(result.pairComplete, false);
    eq(result.advanceableCursor, null);
    eq(result.rows, null, 'no applicable output on a partial cycle');
    ok(result.diagnosticCandidates, 'diagnostic candidates present');
    eq(result.diagnosticCandidates.applicable, false, 'diagnostic candidates are explicitly non-applicable');
    match(result.diagnosticCandidates.label, /not authoritative/);
    eq(result.diagnosticCandidates.rows.length, 3, 'partial merged rows are held as untrusted diagnostics');
    assertHonestEnvelope(result);
  });

  // 6. A4 — a pass throws mid-pagination (HTTP 500 on page 2): the cycle
  // fails closed with the failure recorded; there is no partial success,
  // no candidates, and neither the second pass's merge nor the window
  // leg produces anything.
  await withProvider({
    created: () => payload([]),
    updated: (page) => (page === 1
      ? payload([tx({ id: 30 })], true)
      : { status: 500, payload: { error: 'synthetic provider failure' } }),
    window: () => payload([]),
  }, async (base, seenUrls) => {
    const result = await Consumer.consumeDeltaCycle(cycleOpts(base, {
      fetchOptions: { limit: 1 },
    }));
    eq(result.status, 'failed');
    eq(result.failures.length, 1);
    eq(result.failures[0].leg, 'updated');
    match(result.failures[0].error, /HTTP 500/);
    eq(result.rows, null);
    eq(result.diagnosticCandidates, null);
    eq(result.advanceableCursor, null);
    eq(result.pairComplete, false);
    eq(seenUrls.filter((u) => u.searchParams.get('start_date')).length, 0, 'window leg not run after a thrown pass');
    assertHonestEnvelope(result);
  });

  // 7. A8 — status flip with no updated_at advance: invisible to the
  // delta (both passes empty); the window leg records the truth as a
  // field-mismatch divergence. The delta-empty cycle certifies nothing.
  await withProvider({
    created: () => payload([]),
    updated: () => payload([]),
    window: () => payload([tx({ id: 3, status: 'cleared', is_pending: false })]),
  }, async (base) => {
    const result = await Consumer.consumeDeltaCycle(cycleOpts(base, {
      knownState: known([{ id: 3, status: 'pending', is_pending: true }]),
    }));
    eq(result.status, 'divergent');
    eq(result.divergences.length, 1);
    eq(result.divergences[0].providerId, '3');
    eq(result.divergences[0].type, 'field-mismatch');
    deepEq(result.divergences[0].fields, ['isPending', 'status']);
    eq(result.advanceableCursor, null);
    eq(result.rows, null, 'divergent cycle returns no applicable output (PIN 2)');
    ok(result.diagnosticCandidates, 'merged output survives only as diagnostic candidates');
    eq(result.diagnosticCandidates.applicable, false);
    eq(result.reconciliationComplete, true);
    eq(result.reconciliationCertified, false);
    assertHonestEnvelope(result);
  });

  // 8. A7 / A13 — a known-state row absent from a complete window read:
  // an absent-from-window record only. Never a deletion finding, and
  // the record itself states deletion is unproven.
  await withProvider({
    created: () => payload([]),
    updated: () => payload([]),
    window: () => payload([]),
  }, async (base) => {
    const result = await Consumer.consumeDeltaCycle(cycleOpts(base, {
      knownState: known([{ id: 2 }]),
    }));
    eq(result.status, 'divergent');
    deepEq(result.divergences, [{ providerId: '2', type: 'absent-from-window', fields: [], deletionProven: false }]);
    ok(result.divergences.every((d) => d.type !== 'deleted'), 'no deletion finding is ever emitted');
    eq(result.advanceableCursor, null, 'absent-from-window withholds the cursor');
    assertHonestEnvelope(result);
  });

  // 9. PIN 3 — unseen backdated row: absent from known state, delivered
  // by neither delta pass, timestamped behind the cursor, present in the
  // window. It surfaces as a newly-visible divergence and the cycle does
  // NOT certify completeness — an empty delta plus idempotence proves
  // nothing about rows never delivered.
  await withProvider({
    created: () => payload([]),
    updated: () => payload([]),
    window: () => payload([tx({
      id: 99,
      created_at: '2026-08-01T09:00:00Z',
      updated_at: '2026-08-01T10:00:00Z',
      date: '2026-08-01',
    })]),
  }, async (base) => {
    const result = await Consumer.consumeDeltaCycle(cycleOpts(base, {
      window: { now: '2026-10-16T12:00:00Z', historyDays: 90 },
      knownState: scopedKnown([], { startDate: '2026-07-18' }),
    }));
    eq(result.status, 'divergent');
    deepEq(result.divergences, [{ providerId: '99', type: 'newly-visible', fields: [] }]);
    eq(result.advanceableCursor, null);
    eq(result.reconciliationCertified, false, 'an empty delta cycle never certifies completeness');
    assertHonestEnvelope(result);
  });

  // 10. A9 — group re-parenting with no updated_at advance: invisible to
  // the delta; the window leg records topology divergences for both the
  // re-parented child and the parent's children list; cursor withheld.
  await withProvider({
    created: () => payload([]),
    updated: () => payload([]),
    window: () => payload([
      tx({ id: 5, group_parent_id: 6 }),
      tx({ id: 6, is_group: true, is_group_parent: true, children: [tx({ id: 5, group_parent_id: 6 })] }),
    ]),
  }, async (base) => {
    const result = await Consumer.consumeDeltaCycle(cycleOpts(base, {
      knownState: known([{ id: 5 }, { id: 6, is_group: true, is_group_parent: true }]),
    }));
    eq(result.status, 'divergent');
    const child = result.divergences.find((d) => d.providerId === '5');
    ok(child, 'divergence recorded for the re-parented child');
    eq(child.type, 'topology-mismatch');
    deepEq(child.fields, ['groupParentId']);
    const parent = result.divergences.find((d) => d.providerId === '6');
    ok(parent, 'divergence recorded for the parent');
    eq(parent.type, 'topology-mismatch');
    deepEq(parent.fields, ['children']);
    eq(result.advanceableCursor, null);
    assertHonestEnvelope(result);
  });

  // 11. A11 — the reconciliation leg truncates: the cursor is null, the
  // merged rows survive only as diagnostic candidates, reconciliation is
  // reported incomplete, and NO divergence records are manufactured from
  // a partial window read.
  let windowPage = 0;
  await withProvider({
    created: () => payload([tx({ id: 40 })]),
    updated: () => payload([]),
    window: () => { windowPage += 1; return payload([tx({ id: 200 + windowPage })], true); },
  }, async (base) => {
    const result = await Consumer.consumeDeltaCycle(cycleOpts(base, {
      fetchOptions: { limit: 1, maxPages: 2 },
    }));
    eq(result.status, 'incomplete');
    eq(result.reconciliationOutcome, 'incomplete');
    eq(result.reconciliationComplete, false);
    ok(result.reconciliationError, 'reconciliation failure is reported, not skipped silently');
    deepEq(result.divergences, [], 'no divergence records from a partial window read');
    eq(result.advanceableCursor, null);
    eq(result.rows, null);
    ok(result.diagnosticCandidates, 'merged rows returned as diagnostic candidates');
    deepEq(result.diagnosticCandidates.rows.map((r) => r.providerId), ['40']);
    assertHonestEnvelope(result);
  });

  // 12. A11 (failure variant) — the window leg throws (HTTP 500):
  // reconciliation incomplete, cursor null, diagnostic candidates only.
  await withProvider({
    created: () => payload([tx({ id: 41 })]),
    updated: () => payload([]),
    window: () => ({ status: 500, payload: { error: 'synthetic provider failure' } }),
  }, async (base) => {
    const result = await Consumer.consumeDeltaCycle(cycleOpts(base));
    eq(result.status, 'incomplete');
    eq(result.reconciliationOutcome, 'incomplete');
    eq(result.reconciliationComplete, false);
    match(result.reconciliationError, /HTTP 500/);
    eq(result.advanceableCursor, null);
    eq(result.rows, null);
    ok(result.diagnosticCandidates);
    assertHonestEnvelope(result);
  });

  // 13. A14 — late arrival behind the cursor: the updated pass delivers a
  // row whose created/updated timestamps precede the caller's advanced
  // `since`. Merging is never gated on the cursor: the row merges by ID
  // like any other, the window agrees, and the cycle is clean.
  await withProvider({
    created: () => payload([]),
    updated: () => payload([tx({
      id: 8,
      created_at: '2026-09-01T09:00:00Z',
      updated_at: '2026-09-02T09:00:00Z',
      date: '2026-09-01',
    })]),
    window: () => payload([tx({
      id: 8,
      created_at: '2026-09-01T09:00:00Z',
      updated_at: '2026-09-02T09:00:00Z',
      date: '2026-09-01',
    })]),
  }, async (base) => {
    const result = await Consumer.consumeDeltaCycle(cycleOpts(base, {
      since: '2026-10-10T00:00:00Z',
      window: { now: '2026-10-16T12:00:00Z', historyDays: 60 },
      knownState: scopedKnown([], { startDate: '2026-08-17' }),
    }));
    eq(result.status, 'complete');
    deepEq(result.rows.map((r) => r.providerId), ['8'], 'backdated row merges by ID, never dropped as before-cursor');
    eq(result.advanceableCursor, CYCLE_START);
    assertHonestEnvelope(result);
  });

  // 14. A5 / A14 — cycle-start valuation and convergence: a row created
  // DURING the cycle (created_at after the cycle-start instant) does not
  // move the advanceable value — it stays exactly the cycle-start
  // instant. A second cycle over unchanged provider state, with the
  // caller carrying the candidate forward as known state, produces no
  // conflicts, no divergences, and advances again.
  const duringCycleRow = {
    id: 50,
    amount: '5.0000',
    created_at: '2026-10-16T06:00:00Z',
    updated_at: '2026-10-16T06:00:00Z',
    date: '2026-10-16',
  };
  await withProvider({
    created: () => payload([tx(duringCycleRow)]),
    updated: () => payload([tx(duringCycleRow)]),
    window: () => payload([tx(duringCycleRow)]),
  }, async (base) => {
    const first = await Consumer.consumeDeltaCycle(cycleOpts(base));
    eq(first.status, 'complete');
    eq(first.advanceableCursor, CYCLE_START, 'advanceable value is the cycle-start instant, not the row timestamp');
    ok(first.advanceableCursor !== '2026-10-16T06:00:00Z', 'a row created during the cycle never becomes the cursor');
    assertHonestEnvelope(first);

    const second = await Consumer.consumeDeltaCycle(cycleOpts(base, {
      since: CYCLE_START,
      cycleStart: '2026-10-17T00:00:00Z',
      knownState: known([duringCycleRow]),
    }));
    eq(second.status, 'complete');
    deepEq(second.conflicts, [], 'repeated cycles converge: no conflicts');
    deepEq(second.divergences, [], 'repeated cycles converge: no divergences');
    eq(second.advanceableCursor, '2026-10-17T00:00:00Z');
    assertHonestEnvelope(second);
  });

  // 15. A2 — three-condition gating, named directly: with both passes
  // complete and conflict-free, a divergent reconciliation alone holds
  // the cursor (condition iii); sections 5/11 hold it via condition (i)
  // and reconciliation completeness; section 1 is the only shape that
  // advances.
  await withProvider({
    created: () => payload([tx({ id: 60 })]),
    updated: () => payload([]),
    window: () => payload([tx({ id: 60, amount: '999.0000' })]),
  }, async (base) => {
    const result = await Consumer.consumeDeltaCycle(cycleOpts(base));
    eq(result.pairComplete, true);
    deepEq(result.conflicts, []);
    eq(result.reconciliationComplete, true);
    eq(result.reconciliationCertified, false);
    eq(result.divergences[0].type, 'field-mismatch', 'candidate (delta truth) vs window disagreement is a divergence, no silent winner');
    eq(result.advanceableCursor, null, 'divergent reconciliation alone withholds the cursor');
    eq(result.rows, null);
    assertHonestEnvelope(result);
  });

  // 16. Q3 — the window is the caller's, exactly: a different descriptor
  // emits a different span, derived from the descriptor alone. No floor
  // is invented anywhere in the consumer.
  await withProvider({
    created: () => payload([]),
    updated: () => payload([]),
    window: () => payload([]),
  }, async (base, seenUrls) => {
    await Consumer.consumeDeltaCycle(cycleOpts(base, {
      window: { now: '2026-10-16T12:00:00Z', historyDays: 10 },
      knownState: scopedKnown([], { startDate: '2026-10-06' }),
    }));
    const windowUrl = seenUrls.find((u) => u.searchParams.get('start_date'));
    eq(windowUrl.searchParams.get('start_date'), '2026-10-06');
    eq(windowUrl.searchParams.get('end_date'), '2026-10-16');
  });

  // 17. Input validation fails closed before any fetch: mandatory window
  // descriptor (Q3/Q7), credential, `since` shape, and known-state
  // integrity (Q4). A dead base proves no request was attempted — every
  // rejection is the validation error, not a network error.
  const deadBase = 'http://127.0.0.1:1/v2';
  await assert.rejects(
    () => Consumer.consumeDeltaCycle(cycleOpts(deadBase, { window: undefined })),
    /window descriptor/,
  );
  checks += 1;
  await assert.rejects(
    () => Consumer.consumeDeltaCycle(cycleOpts(deadBase, { window: { now: '2026-10-16T12:00:00Z', historyDays: 0 } })),
    /historyDays/,
  );
  checks += 1;
  await assert.rejects(
    () => Consumer.consumeDeltaCycle(cycleOpts(deadBase, { window: { now: 'not-a-date', historyDays: 10 } })),
    /"now"/,
  );
  checks += 1;
  await assert.rejects(
    () => Consumer.consumeDeltaCycle(cycleOpts(deadBase, { token: '' })),
    /credential/,
  );
  checks += 1;
  await assert.rejects(
    () => Consumer.consumeDeltaCycle(cycleOpts(deadBase, { since: '2026-10-01' })),
    /ISO 8601/,
  );
  checks += 1;
  await assert.rejects(
    () => Consumer.consumeDeltaCycle(cycleOpts(deadBase, {
      knownState: scopedKnown([...knownRows([{ id: 1 }]), ...knownRows([{ id: 1 }])]),
    })),
    /duplicate providerId 1/,
  );
  checks += 1;
  await assert.rejects(
    () => Consumer.consumeDeltaCycle(cycleOpts(deadBase, {
      knownState: scopedKnown([{ amount: '1.0000' }]),
    })),
    /missing its providerId/,
  );
  checks += 1;

  // 18. Round 2 / Q3 — the known-state SCOPE GATE (Systems Review BLOCK
  // 5545500868 on head edc7976e). Known state must declare the scope it
  // was captured under — effective date bounds plus the four query
  // flags — even when it is empty, and that scope must equal the
  // reconciliation scope before any diffing. Missing or mismatched
  // scope returns an UNQUALIFIED cycle: no certification, no applicable
  // rows, no cursor, no absence findings. On the round-1 code every pin
  // below fails (the bare-array API made scope inexpressible, and
  // payload equality certified incomparable scopes); the matched-scope
  // preservation controls at the end pin that correctly-scoped states
  // behave exactly as the round-1 contract did (sections 1–17 carry the
  // same preservation property across the full matrix).
  function assertUnqualified(result) {
    eq(result.status, 'unqualified');
    eq(result.scopeQualified, false, 'scope gate reports the state as unqualified');
    eq(result.reconciliationOutcome, 'unqualified');
    eq(result.reconciliationComplete, false);
    eq(result.reconciliationCertified, false, 'an unqualified scope never certifies');
    eq(result.rows, null, 'an unqualified scope publishes no applicable rows');
    eq(result.diagnosticCandidates, null);
    eq(result.advanceableCursor, null, 'an unqualified scope never advances the cursor');
    deepEq(result.divergences, [], 'an unqualified scope emits no absence findings');
    deepEq(result.conflicts, []);
    assertHonestEnvelope(result);
  }
  const emptyRoutes = {
    created: () => payload([]),
    updated: () => payload([]),
    window: () => payload([]),
  };

  // (a) EMPTY state, date-window mismatch (declared start one day
  // before the reconciliation window's start): on round 1 this shape
  // certified and advanced; now unqualified.
  await withProvider(emptyRoutes, async (base) => {
    const result = await Consumer.consumeDeltaCycle(cycleOpts(base, {
      knownState: scopedKnown([], { startDate: '2026-08-31' }),
    }));
    assertUnqualified(result);
    deepEq(result.knownStateScope.startDate, '2026-08-31', 'the declared scope is echoed for diagnosis');
  });

  // (b) EMPTY state, pending-filter mismatch.
  await withProvider(emptyRoutes, async (base) => {
    const result = await Consumer.consumeDeltaCycle(cycleOpts(base, {
      knownState: scopedKnown([], { include_pending: false }),
    }));
    assertUnqualified(result);
  });

  // (c) EMPTY state, topology-flag mismatch (both topology flags off).
  await withProvider(emptyRoutes, async (base) => {
    const result = await Consumer.consumeDeltaCycle(cycleOpts(base, {
      knownState: scopedKnown([], { include_group_children: false, include_split_parents: false }),
    }));
    assertUnqualified(result);
  });

  // (d) NONEMPTY state whose payloads match the window read exactly,
  // under a mismatched query scope (metadata flag off): on round 1 this
  // published applicable rows and advanced; now it publishes nothing.
  await withProvider({
    created: () => payload([]),
    updated: () => payload([]),
    window: () => payload([tx({ id: 1 })]),
  }, async (base) => {
    const result = await Consumer.consumeDeltaCycle(cycleOpts(base, {
      knownState: scopedKnown(knownRows([{ id: 1 }]), { include_metadata: false }),
    }));
    assertUnqualified(result);
  });

  // (e) Known-state DATE scope differing from the window, with a known
  // row absent from the window read: the evidence is unqualified — NOT
  // an absent-from-window finding (divergences stay empty).
  await withProvider(emptyRoutes, async (base) => {
    const result = await Consumer.consumeDeltaCycle(cycleOpts(base, {
      knownState: scopedKnown(knownRows([{ id: 2 }]), { endDate: '2026-10-15' }),
    }));
    assertUnqualified(result);
    ok(result.divergences.every((d) => d.type !== 'absent-from-window'),
      'a scope mismatch never degrades into absence evidence');
  });

  // (f) MISSING scope — the round-1 bare-array shape itself: rows that
  // would otherwise form a clean cycle are unqualified, not certified.
  await withProvider({
    created: () => payload([]),
    updated: () => payload([]),
    window: () => payload([tx({ id: 1 })]),
  }, async (base) => {
    const result = await Consumer.consumeDeltaCycle(cycleOpts(base, {
      knownState: knownRows([{ id: 1 }]),
    }));
    assertUnqualified(result);
    eq(result.knownStateScope, null, 'a bare array declares no scope');
  });

  // (g) MISSING scope — rows object without a scope, and knownState
  // omitted entirely: both unqualified (an omitted state can no longer
  // silently certify an empty cycle).
  await withProvider(emptyRoutes, async (base) => {
    const noScope = await Consumer.consumeDeltaCycle(cycleOpts(base, {
      knownState: { rows: [] },
    }));
    assertUnqualified(noScope);
    const omittedOpts = cycleOpts(base);
    delete omittedOpts.knownState;
    const omitted = await Consumer.consumeDeltaCycle(omittedOpts);
    assertUnqualified(omitted);
  });

  // (h) MALFORMED scope — an unparseable date bound is not a scope.
  await withProvider(emptyRoutes, async (base) => {
    const result = await Consumer.consumeDeltaCycle(cycleOpts(base, {
      knownState: scopedKnown([], { startDate: '16/10/2026' }),
    }));
    assertUnqualified(result);
  });

  // Preservation controls — matched scope, EMPTY state: the cycle is
  // the same clean, certified, cursor-offering cycle the round-1
  // contract produced for an empty state under this window.
  await withProvider(emptyRoutes, async (base) => {
    const result = await Consumer.consumeDeltaCycle(cycleOpts(base, {
      knownState: scopedKnown([]),
    }));
    eq(result.status, 'complete');
    eq(result.scopeQualified, true);
    eq(result.reconciliationCertified, true);
    eq(result.advanceableCursor, CYCLE_START);
    deepEq(result.rows, []);
    assertHonestEnvelope(result);
  });

  // Preservation control — matched scope, NONEMPTY state agreeing with
  // the window: applicable output and cursor exactly as before.
  await withProvider({
    created: () => payload([]),
    updated: () => payload([]),
    window: () => payload([tx({ id: 1 })]),
  }, async (base) => {
    const result = await Consumer.consumeDeltaCycle(cycleOpts(base, {
      knownState: known([{ id: 1 }]),
    }));
    eq(result.status, 'complete');
    eq(result.scopeQualified, true);
    eq(result.reconciliationCertified, true);
    eq(result.advanceableCursor, CYCLE_START);
    assertHonestEnvelope(result);
  });

  console.log(`All provider-transaction-delta-consumer checks passed (${checks} checks).`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
