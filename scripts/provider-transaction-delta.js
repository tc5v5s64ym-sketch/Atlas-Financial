'use strict';
/* Inert Lunch Money transaction delta read (created_since / updated_since).
 *
 * This module is NOT wired to any routine, server, assistant/MCP surface, or
 * scheduler. It adds no persisted watermark, no automatic run, and no exposed
 * tool. It exists so a future, separately reviewed consumer can enumerate
 * rows created or modified since a timestamp without re-reading a full
 * date window.
 *
 * A created_since/updated_since delta is a CHANGE FEED — never a complete
 * ledger or audit stream. It cannot prove deletions (absence is
 * indistinguishable from unchanged), and it never advances any watermark:
 * a partial or errored read simply returns pageComplete=false or throws,
 * and the caller keeps its previous position.
 *
 * Raw provider IDs stay inside this trust boundary. They are preserved here
 * because a delta reader must key on the stable provider ID, but they must
 * never cross an assistant/MCP response (ARCHITECTURE.md OAuth boundary).
 *
 * UNKNOWN: whether the provider's updated_at advances for every mutation
 * class — status-only transitions and split/group restructuring in
 * particular — is provider behavior that cannot be verified from this
 * repository. Full-window reconciliation remains the completeness
 * authority regardless of what a delta returns.
 */

const ProviderObserve = require('./provider-observe.js');

const SCHEMA = 'atlas-lunchmoney-transaction-delta/v1';
const CAVEAT = 'Change feed only — not a complete ledger or audit stream. '
  + 'Deletions are invisible: absence does not prove a row is unchanged, '
  + 'and this delta proves nothing about ledger completeness.';
const UPDATED_AT_BEHAVIOR = 'UNKNOWN — whether updated_at advances on '
  + 'status-only transitions or split/group restructuring is provider '
  + 'behavior unverifiable from this repository; full-window '
  + 'reconciliation remains the completeness authority.';

const SINCE_PARAM_BY_KIND = {
  created: 'created_since',
  updated: 'updated_since',
};

// Provider-documented since format: an ISO 8601 date-time with an explicit
// timezone designator (Z or a numeric offset). Date-only or timezone-naive
// values are ambiguous about the boundary instant and are rejected.
const SINCE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

function validateSinceTimestamp(value) {
  if (typeof value !== 'string' || !SINCE_PATTERN.test(value)) {
    throw new Error('Transaction delta "since" must be an ISO 8601 date-time with a timezone (e.g. 2026-10-01T00:00:00Z).');
  }
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error('Transaction delta "since" is not a parseable timestamp.');
  }
  return value;
}

function buildDeltaUrl({ kind, since, base } = {}) {
  const param = SINCE_PARAM_BY_KIND[kind];
  if (!param) {
    throw new Error('Transaction delta kind must be exactly one of "created" or "updated" (exactly one since mode).');
  }
  validateSinceTimestamp(since);
  const url = new URL(`${base || ProviderObserve.LIVE_BASE}/transactions`);
  url.searchParams.set(param, since);
  url.searchParams.set('include_pending', 'true');
  url.searchParams.set('include_metadata', 'true');
  url.searchParams.set('include_group_children', 'true');
  url.searchParams.set('include_split_parents', 'true');
  return url;
}

function stringOrNull(value) {
  return value != null && value !== '' ? String(value) : null;
}

// Internal row mapping: provider fields are preserved verbatim (amount and
// currency are never re-typed, rounded, or totalled). Split/group linkage
// is preserved as delivered — never counted or interpreted here.
function mapDeltaTransaction(raw) {
  if (!raw || raw.id == null || raw.id === '') {
    throw new Error('Lunch Money delta transaction is missing its provider id; failing closed.');
  }
  const accountId = raw.account_id != null ? raw.account_id
    : raw.plaid_account_id != null ? raw.plaid_account_id
      : raw.manual_account_id;
  return {
    providerId: String(raw.id),
    createdAt: raw.created_at != null ? String(raw.created_at) : null,
    updatedAt: raw.updated_at != null ? String(raw.updated_at) : null,
    date: raw.date != null ? String(raw.date) : null,
    amount: raw.amount != null ? raw.amount : null,
    currency: raw.currency != null ? raw.currency : null,
    accountId: stringOrNull(accountId),
    plaidAccountId: stringOrNull(raw.plaid_account_id),
    manualAccountId: stringOrNull(raw.manual_account_id),
    categoryId: stringOrNull(raw.category_id),
    tagIds: Array.isArray(raw.tag_ids) ? raw.tag_ids.map((t) => String(t)) : [],
    isPending: raw.is_pending === true,
    status: raw.status != null ? String(raw.status) : null,
    isGroupParent: raw.is_group_parent === true || raw.is_group === true,
    groupParentId: stringOrNull(raw.group_parent_id),
    isSplitParent: raw.is_split_parent === true,
    splitParentId: stringOrNull(raw.split_parent_id),
    parentId: stringOrNull(raw.parent_id),
    children: Array.isArray(raw.children)
      ? raw.children.map((child) => mapDeltaTransaction(child))
      : [],
  };
}

async function fetchTransactionDelta({ kind, since, token, base, fetchOptions } = {}) {
  if (!token) throw new Error('Transaction delta read has no Lunch Money credential.');
  const url = buildDeltaUrl({ kind, since, base });
  // Reuse the incumbent paged fetcher (1000/page, 20-page cap, fail-closed
  // truncation semantics) — no second pager, live observer untouched.
  const page = await ProviderObserve.fetchLunchMoneyTransactionsPaged(url, token, fetchOptions);
  const seen = new Set();
  const transactions = [];
  for (const raw of page.transactions || []) {
    const mapped = mapDeltaTransaction(raw);
    if (seen.has(mapped.providerId)) {
      throw new Error(`Lunch Money delta returned duplicate provider id ${mapped.providerId}; failing closed.`);
    }
    seen.add(mapped.providerId);
    transactions.push(mapped);
  }
  const pageComplete = page.complete === true && page.truncated !== true;
  return {
    schema: SCHEMA,
    kind,
    since,
    // Page-complete means only "every page of this delta was retrieved".
    // It is explicitly distinct from ledger-complete, which a delta can
    // never establish.
    pageComplete,
    ledgerComplete: false,
    complete: pageComplete,
    truncated: page.truncated === true,
    pages: page.pages,
    caveat: CAVEAT,
    updatedAtBehavior: UPDATED_AT_BEHAVIOR,
    transactions,
  };
}

module.exports = {
  SCHEMA,
  CAVEAT,
  UPDATED_AT_BEHAVIOR,
  validateSinceTimestamp,
  buildDeltaUrl,
  mapDeltaTransaction,
  fetchTransactionDelta,
};
