'use strict';
/* Non-writing reconciliation: observation → canonical compare.
 *
 *   node scripts/reconcile.js
 *
 * First B91 closed set: Household cash and debt rows in docs/positions.csv
 * that have a stable id locator in docs/reconciliation/balance-map.json.
 *
 * D3 settlement slice: commitment settlement observations in
 * docs/reconciliation/commitment-settlements.json compare a paid/settled
 * date against plan.commitments[].settledOn. They do not go through
 * positions.csv or the balance map.
 *
 * This command NEVER writes data.json. An owner-approved canonical edit
 * remains a separate explicit action. Evidence that a commitment was
 * paid does not mutate the commitment.
 *
 * Statuses actually assigned here: MATCH / CHANGE / CONFLICT / MISSING.
 * STALE is not assigned — no owner-defined age threshold exists. Evidence
 * dates are reported so that decision stays explicit.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_DATA = path.join(ROOT, 'data.json');
const DEFAULT_CSV = path.join(ROOT, 'docs', 'positions.csv');
const DEFAULT_MAP = path.join(ROOT, 'docs', 'reconciliation', 'balance-map.json');
const DEFAULT_SETTLEMENTS = path.join(ROOT, 'docs', 'reconciliation', 'commitment-settlements.json');
const SETTLED_ON = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const EPSILON = 0.005;
const near = (a, b) => Math.abs(Number(a) - Number(b)) <= EPSILON;
const n2 = v => (Math.round(Number(v) * 100) / 100).toFixed(2);
const STATUSES = ['MATCH', 'STALE', 'CHANGE', 'CONFLICT', 'MISSING'];

function parseCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; continue; }
    if (c === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function cashRows(data) {
  const cash = (data.plan && data.plan.startingCash) || {};
  return (cash.breakdown || []).concat(cash.heldElsewhere || []);
}

function readCanonical(data, target) {
  const locator = target && target.collection && target.id
    ? `${target.collection}:${target.id}`
    : '(unspecified)';
  if (!target || !target.collection || !target.id) {
    return { found: false, value: null, locator };
  }
  if (target.collection === 'cash') {
    const row = cashRows(data).find(r => r.id === target.id);
    return row
      ? { found: true, value: Number(row.value), locator }
      : { found: false, value: null, locator };
  }
  if (target.collection === 'debts') {
    const row = (data.debts || []).find(r => r.id === target.id);
    return row
      ? { found: true, value: Number(row.balance), locator }
      : { found: false, value: null, locator };
  }
  if (target.collection === 'commitments') {
    const row = (((data.plan || {}).commitments) || []).find(r => r.id === target.id);
    if (!row) return { found: false, value: null, settledOn: null, locator };
    const settledOn = typeof row.settledOn === 'string' && SETTLED_ON.test(row.settledOn)
      ? row.settledOn : null;
    return { found: true, value: Number(row.amount), settledOn, locator };
  }
  return { found: false, value: null, locator };
}

function householdPositionRows(csvText) {
  const lines = String(csvText).replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  const rows = [];
  for (const line of lines.slice(1)) {
    const c = parseCsvLine(line);
    if (c[0] !== 'Household') continue;
    const label = c[2];
    const raw = c[6];
    if (raw === '' || raw == null) continue;
    const value = Number(raw);
    if (!isFinite(value)) continue;
    rows.push({
      accountLabel: label,
      evidenceValue: value,
      evidenceDate: c[19] || null,
    });
  }
  return rows;
}

function observationsFromPositions(positionRows, map) {
  const byLabel = new Map();
  for (const row of positionRows) {
    const list = byLabel.get(row.accountLabel) || [];
    list.push(row);
    byLabel.set(row.accountLabel, list);
  }
  const observations = [];
  for (const mapping of map.mappings || []) {
    const hits = byLabel.get(mapping.accountLabel) || [];
    if (!hits.length) {
      observations.push({
        observationId: mapping.observationId,
        accountLabel: mapping.accountLabel,
        evidenceValue: null,
        evidenceDate: null,
        canonical: mapping.canonical,
        sourceMissing: true,
      });
      continue;
    }
    for (const hit of hits) {
      observations.push({
        observationId: mapping.observationId,
        accountLabel: mapping.accountLabel,
        evidenceValue: hit.evidenceValue,
        evidenceDate: hit.evidenceDate,
        canonical: mapping.canonical,
      });
    }
  }
  return observations;
}

function validSettledOn(value) {
  return typeof value === 'string' && SETTLED_ON.test(value) ? value : null;
}

function observationsFromSettlements(doc) {
  return ((doc && doc.observations) || []).map(item => ({
    observationId: item.observationId,
    fact: 'settlement',
    accountLabel: item.label || item.commitmentId,
    commitmentId: item.commitmentId,
    settledOn: item.settledOn,
    evidenceValue: item.amount != null ? Number(item.amount) : null,
    evidenceDate: item.settledOn || item.observedAsOf || null,
    canonical: item.canonical || { collection: 'commitments', id: item.commitmentId },
    source: item.source || null,
    note: item.note || null,
  }));
}

function compareSettlementGroup(rows, data) {
  const first = rows[0];
  const target = first.canonical || { collection: 'commitments', id: first.commitmentId };
  const canonical = readCanonical(data, target);
  const evidenceDates = [];
  for (const row of rows) {
    const d = validSettledOn(row.settledOn);
    if (d && !evidenceDates.some(x => x === d)) evidenceDates.push(d);
  }
  const evidenceAmounts = rows
    .filter(r => r.evidenceValue != null && isFinite(r.evidenceValue))
    .map(r => r.evidenceValue);
  const distinctAmounts = [];
  for (const v of evidenceAmounts) {
    if (!distinctAmounts.some(x => near(x, v))) distinctAmounts.push(v);
  }

  let status;
  if (!canonical.found) status = 'MISSING';
  else if (evidenceDates.length > 1 || distinctAmounts.length > 1) status = 'CONFLICT';
  else if (!evidenceDates.length) status = 'MISSING';
  else if (distinctAmounts.length === 1 && !near(distinctAmounts[0], canonical.value)) status = 'CONFLICT';
  else if (canonical.settledOn === evidenceDates[0]) status = 'MATCH';
  else status = 'CHANGE';

  return rows.map(row => ({
    observationId: row.observationId,
    fact: 'settlement',
    accountLabel: row.accountLabel,
    commitmentId: row.commitmentId || target.id,
    evidenceValue: row.evidenceValue,
    evidenceDate: row.evidenceDate,
    evidenceSettledOn: validSettledOn(row.settledOn),
    canonicalValue: canonical.found ? canonical.value : null,
    canonicalSettledOn: canonical.found ? canonical.settledOn : null,
    canonicalTarget: canonical.locator,
    difference: null,
    status,
    sourceMissing: !validSettledOn(row.settledOn),
    note: row.note || null,
  }));
}

function compareGroup(rows, data) {
  const first = rows[0];
  const target = first.canonical;
  const canonical = readCanonical(data, target);
  const values = rows
    .filter(r => r.evidenceValue != null && isFinite(r.evidenceValue))
    .map(r => r.evidenceValue);
  const distinct = [];
  for (const v of values) {
    if (!distinct.some(x => near(x, v))) distinct.push(v);
  }

  let status;
  if (!canonical.found) status = 'MISSING';
  else if (distinct.length > 1) status = 'CONFLICT';
  else if (!values.length) status = 'MISSING';
  else if (near(values[0], canonical.value)) status = 'MATCH';
  else status = 'CHANGE';

  const evidenceValue = values.length === 1 ? values[0]
    : values.length ? values[0] : null;
  const difference = canonical.found && evidenceValue != null
    ? Math.round((evidenceValue - canonical.value) * 100) / 100
    : null;

  return rows.map(row => ({
    observationId: row.observationId,
    accountLabel: row.accountLabel,
    evidenceValue: row.evidenceValue,
    evidenceDate: row.evidenceDate,
    canonicalValue: canonical.found ? canonical.value : null,
    canonicalTarget: canonical.locator,
    difference: canonical.found && row.evidenceValue != null
      ? Math.round((row.evidenceValue - canonical.value) * 100) / 100
      : difference,
    status,
    sourceMissing: !!row.sourceMissing,
  }));
}

function reconcile(input) {
  const data = input.data;
  const map = input.map;
  const raw = input.observations
    || observationsFromPositions(input.positionRows || [], map);
  const extraSettlements = input.settlementObservations
    || observationsFromSettlements(input.settlements);
  const observations = raw.filter(o => o.fact !== 'settlement');
  const settlementObservations = raw.filter(o => o.fact === 'settlement')
    .concat(extraSettlements || []);
  const groups = new Map();
  for (const obs of observations) {
    const key = obs.canonical
      ? `${obs.canonical.collection}:${obs.canonical.id}`
      : obs.observationId;
    const list = groups.get(key) || [];
    list.push(obs);
    groups.set(key, list);
  }
  const settlementGroups = new Map();
  for (const obs of settlementObservations) {
    const id = (obs.canonical && obs.canonical.id) || obs.commitmentId || obs.observationId;
    const key = `commitments:${id}`;
    const list = settlementGroups.get(key) || [];
    list.push(obs);
    settlementGroups.set(key, list);
  }
  const rows = [];
  for (const group of groups.values()) {
    rows.push(...compareGroup(group, data));
  }
  for (const group of settlementGroups.values()) {
    rows.push(...compareSettlementGroup(group, data));
  }
  const counts = { MATCH: 0, STALE: 0, CHANGE: 0, CONFLICT: 0, MISSING: 0 };
  for (const row of rows) counts[row.status] = (counts[row.status] || 0) + 1;
  return {
    writesCanonicalState: false,
    canonicalAsOf: data.meta && data.meta.asOf ? data.meta.asOf : null,
    staleAssigned: false,
    staleReason: (map && map.stale)
      || 'No owner-defined age threshold exists. Evidence dates are reported; STALE is not inferred.',
    rows,
    counts,
  };
}

function formatReport(result) {
  const lines = [];
  lines.push('Atlas reconciliation — non-writing compare');
  lines.push('Source: docs/positions.csv (Household cash/debt rows with a map entry)');
  lines.push('Settlement source: docs/reconciliation/commitment-settlements.json');
  lines.push('Canonical: data.json via id locator (not array-index JSON Pointer)');
  lines.push(`Canonical as-of: ${result.canonicalAsOf || '(none)'}`);
  lines.push(`STALE: not assigned — ${result.staleReason}`);
  lines.push('This command does not write data.json.');
  lines.push('');
  const cols = [
    ['observation', 28],
    ['evidence', 12],
    ['date', 12],
    ['canonical', 12],
    ['diff', 10],
    ['status', 10],
    ['target', 28],
  ];
  const pad = (s, n) => String(s == null ? '' : s).padEnd(n).slice(0, n);
  lines.push(cols.map(([h, n]) => pad(h, n)).join(' '));
  for (const row of result.rows) {
    const evidence = row.fact === 'settlement'
      ? (row.evidenceSettledOn || '—')
      : (row.evidenceValue == null ? '—' : n2(row.evidenceValue));
    const canonical = row.fact === 'settlement'
      ? (row.canonicalSettledOn || 'unsettled')
      : (row.canonicalValue == null ? '—' : n2(row.canonicalValue));
    lines.push([
      pad(row.observationId, 28),
      pad(evidence, 12),
      pad(row.evidenceDate || '—', 12),
      pad(canonical, 12),
      pad(row.difference == null ? '—' : n2(row.difference), 10),
      pad(row.status, 10),
      pad(row.canonicalTarget, 28),
    ].join(' '));
  }
  lines.push('');
  lines.push('Summary: '
    + STATUSES.map(s => `${result.counts[s] || 0} ${s}`).join(', '));
  lines.push('Owner-approved canonical edits remain a separate explicit action.');
  return lines.join('\n');
}

function loadDefaults() {
  return {
    data: JSON.parse(fs.readFileSync(DEFAULT_DATA, 'utf8')),
    map: JSON.parse(fs.readFileSync(DEFAULT_MAP, 'utf8')),
    positionRows: householdPositionRows(fs.readFileSync(DEFAULT_CSV, 'utf8')),
    settlements: JSON.parse(fs.readFileSync(DEFAULT_SETTLEMENTS, 'utf8')),
  };
}

function runCli() {
  const loaded = loadDefaults();
  const result = reconcile(loaded);
  console.log(formatReport(result));
}

const api = {
  EPSILON,
  STATUSES,
  parseCsvLine,
  householdPositionRows,
  observationsFromPositions,
  observationsFromSettlements,
  readCanonical,
  reconcile,
  formatReport,
  DEFAULT_DATA,
  DEFAULT_CSV,
  DEFAULT_MAP,
  DEFAULT_SETTLEMENTS,
};

if (require.main === module) runCli();
else module.exports = api;
