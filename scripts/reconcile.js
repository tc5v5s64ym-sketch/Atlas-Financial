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
 * D4/D5 Hydro slice: utility observations in
 * docs/reconciliation/utility-observations.json compare an account
 * balance (informational, not a scheduled amount), dated dues against
 * plan.bills, and paying-account attribution. They do not go through
 * positions.csv. They do not write data.json.
 *
 * This command NEVER writes data.json. An owner-approved canonical edit
 * remains a separate explicit action. Evidence that a commitment was
 * paid does not mutate the commitment. Hydro observations do not
 * promote Aug. 14 amounts into live canonical state.
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
const DEFAULT_UTILITY = path.join(ROOT, 'docs', 'reconciliation', 'utility-observations.json');
const SETTLED_ON = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const UTILITY_FACTS = new Set(['account-balance', 'dated-due', 'paying-account']);

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
  if (target.collection === 'bills') {
    const row = (((data.plan || {}).bills) || []).find(r => r.id === target.id);
    if (!row) {
      return {
        found: false, value: null, date: null, payingAccount: null,
        householdObligation: null, locator,
      };
    }
    return {
      found: true,
      value: Number(row.amount),
      date: row.date || null,
      payingAccount: row.payingAccount || null,
      householdObligation: row.householdObligation !== false,
      locator,
    };
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

function observationsFromUtility(doc) {
  return ((doc && doc.observations) || []).map(item => ({
    observationId: item.observationId,
    fact: item.fact,
    utility: item.utility || null,
    accountLabel: item.label || item.utility,
    evidenceValue: item.amount != null ? Number(item.amount) : null,
    evidenceDate: item.dueDate || item.observedAsOf || null,
    dueDate: item.dueDate || null,
    payingAccount: item.payingAccount || null,
    payingAccountLabel: item.payingAccountLabel || null,
    jointCashPool: item.jointCashPool,
    billIds: item.billIds || null,
    canonical: item.canonical || null,
    source: item.source || null,
    note: item.note || null,
    role: item.role || null,
  }));
}

function scheduledBills(data) {
  return (((data || {}).plan || {}).bills) || [];
}

function compareAccountBalance(row, data) {
  const amount = row.evidenceValue;
  const scheduled = scheduledBills(data)
    .filter(b => amount != null && isFinite(amount) && near(Number(b.amount), amount));
  const scheduledWrongly = scheduled.length > 0;
  return {
    observationId: row.observationId,
    fact: 'account-balance',
    role: 'informational',
    accountLabel: row.accountLabel,
    evidenceValue: amount,
    evidenceDate: row.evidenceDate,
    canonicalValue: null,
    canonicalTarget: '(informational — not a scheduled amount)',
    difference: null,
    status: scheduledWrongly ? 'CONFLICT' : 'MATCH',
    scheduled: scheduledWrongly,
    scheduledIds: scheduled.map(b => b.id),
    note: scheduledWrongly
      ? 'account balance must not be scheduled as a cash event'
      : 'informational / not scheduled amount',
  };
}

function compareDatedDueGroup(rows, data) {
  const first = rows[0];
  const target = first.canonical || { collection: 'bills', id: first.observationId };
  const canonical = readCanonical(data, target);
  const amounts = rows
    .filter(r => r.evidenceValue != null && isFinite(r.evidenceValue))
    .map(r => r.evidenceValue);
  const dates = [];
  for (const row of rows) {
    const d = row.dueDate || null;
    if (d && !dates.some(x => x === d)) dates.push(d);
  }
  const distinctAmounts = [];
  for (const v of amounts) {
    if (!distinctAmounts.some(x => near(x, v))) distinctAmounts.push(v);
  }

  let status;
  if (!canonical.found) status = 'MISSING';
  else if (distinctAmounts.length > 1 || dates.length > 1) status = 'CONFLICT';
  else if (!distinctAmounts.length || !dates.length) status = 'MISSING';
  else if (near(distinctAmounts[0], canonical.value) && dates[0] === canonical.date) {
    status = 'MATCH';
  } else status = 'CHANGE';

  return rows.map(row => ({
    observationId: row.observationId,
    fact: 'dated-due',
    accountLabel: row.accountLabel,
    evidenceValue: row.evidenceValue,
    evidenceDate: row.evidenceDate,
    dueDate: row.dueDate || null,
    canonicalValue: canonical.found ? canonical.value : null,
    canonicalDate: canonical.found ? canonical.date : null,
    canonicalTarget: canonical.locator,
    difference: canonical.found && row.evidenceValue != null
      ? Math.round((row.evidenceValue - canonical.value) * 100) / 100
      : null,
    status,
    householdObligation: canonical.found ? canonical.householdObligation : null,
    payingAccount: canonical.found ? canonical.payingAccount : null,
    note: row.note || (status === 'MISSING'
      ? 'canonical missing/change — dated household cash requirement'
      : null),
  }));
}

function comparePayingAccount(row, data) {
  const ids = row.billIds
    || (row.canonical && row.canonical.id ? [row.canonical.id] : []);
  const bills = scheduledBills(data).filter(b => ids.includes(b.id));
  const payers = [];
  for (const b of bills) {
    const p = b.payingAccount || null;
    if (!payers.some(x => x === p)) payers.push(p);
  }
  let status;
  if (!bills.length) status = 'MISSING';
  else if (payers.length > 1) status = 'CONFLICT';
  else if (payers[0] === row.payingAccount) status = 'MATCH';
  else status = 'CHANGE';

  const householdObligation = bills.length
    ? bills.every(b => b.householdObligation !== false)
    : null;

  return {
    observationId: row.observationId,
    fact: 'paying-account',
    accountLabel: row.accountLabel,
    evidenceValue: null,
    evidenceDate: row.evidenceDate,
    payingAccount: row.payingAccount || null,
    payingAccountLabel: row.payingAccountLabel || null,
    jointCashPool: row.jointCashPool === false ? false : !!row.jointCashPool,
    canonicalPayingAccount: bills.length === 1 ? (bills[0].payingAccount || null) : null,
    canonicalValue: null,
    canonicalTarget: ids.length ? `bills:${ids.join(',')}` : '(unspecified)',
    difference: null,
    status,
    householdObligation,
    note: row.note
      || (row.jointCashPool === false
        ? 'Amanda / external-to-joint-pool'
        : null),
  };
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
  const extraUtility = input.utilityObservations
    || observationsFromUtility(input.utility);
  const observations = raw.filter(o => o.fact !== 'settlement' && !UTILITY_FACTS.has(o.fact));
  const settlementObservations = raw.filter(o => o.fact === 'settlement')
    .concat(extraSettlements || []);
  const utilityObservations = raw.filter(o => UTILITY_FACTS.has(o.fact))
    .concat(extraUtility || []);
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
  const datedDueGroups = new Map();
  for (const obs of utilityObservations) {
    if (obs.fact === 'account-balance') {
      rows.push(compareAccountBalance(obs, data));
      continue;
    }
    if (obs.fact === 'paying-account') {
      rows.push(comparePayingAccount(obs, data));
      continue;
    }
    if (obs.fact === 'dated-due') {
      const id = (obs.canonical && obs.canonical.id) || obs.observationId;
      const key = `bills:${id}`;
      const list = datedDueGroups.get(key) || [];
      list.push(obs);
      datedDueGroups.set(key, list);
    }
  }
  for (const group of datedDueGroups.values()) {
    rows.push(...compareDatedDueGroup(group, data));
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
  lines.push('Hydro source: docs/reconciliation/utility-observations.json');
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
      : row.fact === 'paying-account'
        ? (row.payingAccountLabel || row.payingAccount || '—')
        : (row.evidenceValue == null ? '—' : n2(row.evidenceValue));
    const canonical = row.fact === 'settlement'
      ? (row.canonicalSettledOn || 'unsettled')
      : row.fact === 'account-balance'
        ? 'not scheduled'
        : row.fact === 'paying-account'
          ? (row.canonicalPayingAccount || (row.status === 'MISSING' ? 'missing' : '—'))
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
  const hydro = result.rows.filter(r => UTILITY_FACTS.has(r.fact));
  if (hydro.length) {
    lines.push('');
    lines.push('Hydro / household-obligation distinctions:');
    for (const row of hydro) {
      const bits = [`  ${row.observationId}: ${row.fact}`];
      if (row.fact === 'account-balance') bits.push(row.note || 'informational / not scheduled amount');
      if (row.fact === 'dated-due') {
        bits.push(row.status === 'MISSING'
          ? 'canonical missing/change'
          : `canonical ${row.status.toLowerCase()}`);
      }
      if (row.fact === 'paying-account') {
        bits.push(row.payingAccountLabel || row.payingAccount || 'paying account');
        bits.push(row.jointCashPool === false
          ? 'Amanda / external-to-joint-pool'
          : 'joint-cash pool');
      }
      lines.push(bits.join(' — '));
    }
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
    utility: JSON.parse(fs.readFileSync(DEFAULT_UTILITY, 'utf8')),
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
  observationsFromUtility,
  readCanonical,
  reconcile,
  formatReport,
  DEFAULT_DATA,
  DEFAULT_CSV,
  DEFAULT_MAP,
  DEFAULT_SETTLEMENTS,
  DEFAULT_UTILITY,
};

if (require.main === module) runCli();
else module.exports = api;
