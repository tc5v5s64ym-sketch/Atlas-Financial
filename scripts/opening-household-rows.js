'use strict';
/* Same-date Household position rows for an owner-approved B81 opening.
 *
 * Not a reconciler and not a second balance authority. Lunch Money observation
 * remains evidence; reconcile remains comparison; the approved opening proposal
 * is the permissioned posted/pending state; data.json remains canonical.
 *
 * This constructs dated captured Household rows from that already-approved
 * opening evidence plus incumbent structural metadata. It does not invent
 * mappings, copy live data.json into fake evidence, or write provider IDs.
 */

const POS = require('./positions-summary.js');

const EPSILON = 0.005;
const COL = {
  entity: 0,
  institution: 1,
  accountLabel: 2,
  accountType: 3,
  side: 4,
  currency: 5,
  balance: 6,
  creditLimit: 7,
  available: 8,
  interestRate: 9,
  rateBasis: 10,
  fixedOrVariable: 11,
  structure: 12,
  paymentAmount: 13,
  paymentFrequency: 14,
  nextDue: 15,
  maturity: 16,
  annualInterest: 17,
  confidence: 18,
  asOf: 19,
  notes: 20,
};

function fail(message) {
  const err = new Error(message);
  err.code = 'opening-positions-failed';
  throw err;
}

function near(a, b) {
  return Math.abs(Number(a) - Number(b)) <= EPSILON;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function n2(value) {
  return round2(value).toFixed(2);
}

function cashRow(data, id) {
  const cash = data && data.plan && data.plan.startingCash;
  if (!cash) return null;
  return ((cash.breakdown || []).find(r => r && r.id === id))
    || ((cash.heldElsewhere || []).find(r => r && r.id === id))
    || null;
}

function debtRow(data, id) {
  return ((data && data.debts) || []).find(r => r && r.id === id) || null;
}

function canonicalPostedValue(data, collection, id) {
  if (collection === 'cash') {
    const row = cashRow(data, id);
    return row && row.value != null && isFinite(Number(row.value)) ? Number(row.value) : null;
  }
  if (collection === 'debts') {
    const row = debtRow(data, id);
    return row && row.balance != null && isFinite(Number(row.balance)) ? Number(row.balance) : null;
  }
  return null;
}

function excludedLabels(balanceMap) {
  const out = new Set();
  for (const row of (balanceMap && balanceMap.excluded) || []) {
    if (row && row.accountLabel) out.add(String(row.accountLabel));
  }
  return out;
}

function mappingForLocator(balanceMap, locator) {
  return ((balanceMap && balanceMap.mappings) || []).find((row) => {
    if (!row || !row.canonical) return false;
    return `${row.canonical.collection}:${row.canonical.id}` === locator;
  }) || null;
}

function pendingForId(proposedOpening, id) {
  return ((proposedOpening && proposedOpening.pending) || []).find((row) => {
    if (!row) return false;
    if (row.id === id) return true;
    return row.locator === `debts:${id}#pending`;
  }) || null;
}

function numericCell(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return isFinite(n) ? n : null;
}

function secretLeak(text) {
  const blob = String(text || '');
  return /LUNCHMONEY_ACCESS_TOKEN/i.test(blob)
    || /Bearer\s+\S+/.test(blob)
    || /SITE_PASSWORD/i.test(blob)
    || /SESSION_SECRET/i.test(blob)
    || /"providerAccountId"\s*:/.test(blob)
    || /"providerTransactionId"\s*:/.test(blob);
}

function openingNote(posted, pending) {
  const parts = [
    `Owner-approved opening observation ${posted.evidenceDate || posted.requestedAsOf}`,
    `posted ${n2(posted.proposedValue)}`,
    `freshness ${posted.freshnessBasis}`,
    `reconcile ${posted.reconcileStatus || 'n/a'}`,
  ];
  if (pending) {
    if (pending.proposedUnknown === true) {
      fail(`Approved pending for ${pending.locator} is UNKNOWN and cannot become Household evidence.`);
    }
    if (pending.proposedValue == null || !isFinite(Number(pending.proposedValue))) {
      fail(`Approved pending for ${pending.locator} is missing a numeric proposed value.`);
    }
    parts.push(`pending ${n2(pending.proposedValue)} (${pending.proof || 'approved'})`);
  }
  const note = parts.join('; ') + '. Not a hand-edited capture and not a copied data.json balance.';
  if (secretLeak(note)) fail('Opening Household note would leak a secret or provider id.');
  return note;
}

function availableFromApproved(incumbent, collection, postedValue, pending, nextCanonical) {
  const limitCell = numericCell(incumbent[COL.creditLimit]);
  if (collection === 'cash') {
    if (limitCell != null) {
      return incumbent[COL.available] == null ? '' : incumbent[COL.available];
    }
    return n2(postedValue);
  }
  if (limitCell == null) {
    return incumbent[COL.available] == null ? '' : incumbent[COL.available];
  }
  const debt = nextCanonical;
  if (pending) {
    return n2(Math.max(0, limitCell - postedValue - Number(pending.proposedValue)));
  }
  if (debt && debt.secured === false && Object.prototype.hasOwnProperty.call(debt, 'pending')) {
    fail(`Unsecured ${debt.id} is in the approved opening without approved pending evidence; available cannot be inferred.`);
  }
  return n2(Math.max(0, limitCell - postedValue));
}

function applyApprovedHouseholdRows(opts) {
  const csvText = opts && opts.csvText;
  const balanceMap = opts && opts.balanceMap;
  const proposedOpening = opts && opts.proposedOpening;
  const requestedAsOf = opts && opts.requestedAsOf;
  const nextData = opts && opts.nextData;
  if (typeof csvText !== 'string' || !csvText.trim()) {
    fail('Opening positions construction needs incumbent positions.csv text.');
  }
  if (!proposedOpening || !Array.isArray(proposedOpening.posted) || !proposedOpening.posted.length) {
    fail('Opening positions construction needs the approved posted opening evidence.');
  }
  if (!requestedAsOf) fail('Opening positions construction needs the approved opening date.');
  if (!nextData) fail('Opening positions construction needs the proposed canonical document.');

  const excluded = excludedLabels(balanceMap);
  const lines = csvText.split(/\r?\n/);
  if (!lines.length) fail('Incumbent positions.csv has no rows.');
  const byLabel = new Map();
  lines.forEach((raw, idx) => {
    if (!raw.trim() || idx === 0) return;
    const cols = POS.parse(raw);
    if (cols[COL.entity] !== 'Household') return;
    const label = cols[COL.accountLabel];
    if (!label) return;
    if (!byLabel.has(label)) byLabel.set(label, { idx, cols });
  });

  const updated = [];
  for (const posted of proposedOpening.posted) {
    if (!posted || !posted.locator) fail('Approved posted opening evidence is missing a locator.');
    if (!posted.freshnessBasis) {
      fail(`Approved posted ${posted.locator} is missing freshness basis. Canonical state was not written.`);
    }
    if (posted.proposedValue == null || !isFinite(Number(posted.proposedValue))) {
      fail(`Approved posted ${posted.locator} is missing a numeric proposed value. Canonical state was not written.`);
    }
    const mapping = mappingForLocator(balanceMap, posted.locator);
    if (!mapping) {
      fail(`Approved posted ${posted.locator} has no incumbent balance-map mapping. Canonical state was not written.`);
    }
    const label = mapping.accountLabel;
    if (!label) fail(`Balance-map mapping for ${posted.locator} is missing accountLabel.`);
    if (excluded.has(label)) {
      fail(`Approved posted ${posted.locator} maps to excluded account ${label}. Canonical state was not written.`);
    }
    const incumbent = byLabel.get(label);
    if (!incumbent) {
      fail(`No incumbent Household row for ${label}. Canonical state was not written.`);
    }
    const collection = mapping.canonical.collection;
    const id = mapping.canonical.id;
    const canonicalValue = canonicalPostedValue(nextData, collection, id);
    const postedValue = round2(posted.proposedValue);
    if (canonicalValue == null || !near(canonicalValue, postedValue)) {
      fail(`Approved posted ${posted.locator} ${postedValue} does not match proposed canonical ${canonicalValue}.`);
    }
    const pending = collection === 'debts' ? pendingForId(proposedOpening, id) : null;
    if (pending && pending.proposedUnknown === true) {
      fail(`Approved pending for ${id} is UNKNOWN. Canonical state was not written.`);
    }
    const nextCols = incumbent.cols.slice();
    while (nextCols.length < 21) nextCols.push('');
    nextCols[COL.balance] = n2(postedValue);
    nextCols[COL.asOf] = requestedAsOf;
    nextCols[COL.notes] = openingNote(Object.assign({ requestedAsOf }, posted), pending);
    nextCols[COL.available] = availableFromApproved(
      nextCols,
      collection,
      postedValue,
      pending,
      collection === 'debts' ? debtRow(nextData, id) : null
    );
    if (secretLeak(POS.line(nextCols))) {
      fail(`Constructed Household row for ${label} would leak a secret or provider id.`);
    }
    lines[incumbent.idx] = POS.line(nextCols);
    updated.push({ label, locator: posted.locator, balance: postedValue });
  }

  const text = lines.join('\n');
  if (secretLeak(text)) fail('Constructed positions.csv would leak a secret or provider id.');
  return { text, updated };
}

module.exports = {
  applyApprovedHouseholdRows,
  mappingForLocator,
  pendingForId,
  excludedLabels,
};
