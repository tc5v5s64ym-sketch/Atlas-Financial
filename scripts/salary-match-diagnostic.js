'use strict';
// Reports guard evaluations from the incumbent matcher, never matches data.
// A slot is evaluated only when its covered observation has one native
// scheduled occurrence. No latest/current salary selection policy lives here.
// Flags aggregate evaluated attempts for that sole occurrence: passed/rejected
// may both be true. An unevaluated gate has all flags false. Only normal final
// representation resolution determines the outcome; reasons are observed
// rejections, not a claim that one gate was the sole blocker.
const SCHEMA = 'atlas-salary-matcher-diagnostic/v1';
const SCOPE = 'single-covered-occurrence';
const SLOTS = Object.freeze(['midmonth', 'month-end']);
const IDS = Object.freeze({ amandaSalary15: 'midmonth', amandaSalaryMonthEnd: 'month-end' });
const GATES = Object.freeze(['window', 'rule', 'externalIdentity', 'householdCredit',
  'transferIdentity', 'counterpart', 'externalRole', 'nativePostedCad', 'sourceIncome',
  'sourceTiming', 'sourceAccount', 'amountGuard', 'payrollAlias', 'payrollReceipt',
  'occurrence', 'representation']);
const REASONS = Object.freeze(['WINDOW_MISSING', 'WINDOW_INCOMPLETE', 'RULE_MISSING',
  'RULE_INELIGIBLE', 'HOUSEHOLD_CREDIT_MISSING', 'CREDIT_UNQUALIFIED',
  'COUNTERPART_MISSING', 'COUNTERPART_AMBIGUOUS', 'SOURCE_ACCOUNT_MISMATCH',
  'SOURCE_ROLE_MISMATCH', 'EXTERNAL_ID_MISSING', 'EXTERNAL_ID_MISMATCH',
  'PAYROLL_ALIAS_MISMATCH', 'RECEIPT_MISSING', 'RECEIPT_AMBIGUOUS',
  'AMOUNT_GUARD_MISMATCH', 'OCCURRENCE_MISSING', 'OCCURRENCE_AMBIGUOUS',
  'REPRESENTED', 'REPRESENTATION_AMBIGUOUS']);
const OUTCOMES = new Set(['matched', 'unmatched', 'ambiguous', 'not-evaluated']);
const TARGETS = new Set(['selected', 'none', 'ambiguous', 'unavailable']);
const plain = x => x && typeof x === 'object' && !Array.isArray(x)
  && [Object.prototype, null].includes(Object.getPrototypeOf(x));
const exact = (x, keys) => plain(x) && Reflect.ownKeys(x).length === keys.length
  && keys.every(k => Object.hasOwn(Object.getOwnPropertyDescriptor(x, k) || {}, 'value'));
const dense = x => Reflect.ownKeys(x).length === x.length + 1
  && Array.from({ length: x.length }, (_, i) =>
    Object.hasOwn(Object.getOwnPropertyDescriptor(x, i) || {}, 'value')).every(Boolean);

// Rebuild from a closed whitelist. Reject the entire malformed diagnostic,
// including unknown keys, coercion, duplicates, extra slots and raw values.
function project(value) {
  try {
    if (!exact(value, ['schema', 'scope', 'slots']) || value.schema !== SCHEMA || value.scope !== SCOPE
        || !Array.isArray(value.slots) || value.slots.length !== SLOTS.length
        || !dense(value.slots)) return undefined;
    const slots = [];
    for (const [index, slot] of SLOTS.entries()) {
      const row = value.slots[index];
      if (!exact(row, ['slot', 'target', 'outcome', 'gates', 'reasons']) || row.slot !== slot
          || !TARGETS.has(row.target)
          || !OUTCOMES.has(row.outcome) || !exact(row.gates, GATES)
          || !Array.isArray(row.reasons) || row.reasons.length > REASONS.length
          || !dense(row.reasons)
          || new Set(row.reasons).size !== row.reasons.length
          || row.reasons.some(reason => !REASONS.includes(reason))) return undefined;
      const gates = {};
      for (const gate of GATES) {
        const flags = row.gates[gate];
        if (!exact(flags, ['evaluated', 'passed', 'rejected'])
            || Object.values(flags).some(flag => typeof flag !== 'boolean')
            || !flags.evaluated && (flags.passed || flags.rejected)
            || flags.evaluated && !(flags.passed || flags.rejected)) return undefined;
        gates[gate] = { evaluated: flags.evaluated, passed: flags.passed, rejected: flags.rejected };
      }
      const final = gates.representation;
      if (row.target !== 'selected' && (row.outcome !== 'not-evaluated'
          || row.reasons.length || Object.values(gates).some(flags => flags.evaluated))) return undefined;
      if (row.outcome === 'not-evaluated' ? final.evaluated
        : !final.evaluated || row.outcome === 'matched' && (!final.passed || final.rejected)
          || row.outcome === 'unmatched' && (final.passed || !final.rejected)
          || row.outcome === 'ambiguous' && (!final.rejected || !row.reasons.includes('REPRESENTATION_AMBIGUOUS'))) return undefined;
      slots.push({ slot, target: row.target, outcome: row.outcome, gates, reasons: REASONS.filter(r => row.reasons.includes(r)) });
    }
    return { schema: SCHEMA, scope: SCOPE, slots };
  } catch { return undefined; }
}

function create(context) {
  const dates = new Map();
  const targetFor = id => {
    if (!context || !Array.isArray(context.occurrences)) return 'unavailable';
    const occurrences = context.occurrences.filter(event => event && event.kind === 'income' && event.id === id);
    // Duplicate native scheduled rows are ambiguous too; do not deduplicate
    // away a conflicting schedule or choose a date by receipt amount/timing.
    if (occurrences.length !== 1) return occurrences.length ? 'ambiguous' : 'none';
    if (typeof occurrences[0].date !== 'string') return 'unavailable';
    dates.set(id, occurrences[0].date);
    return 'selected';
  };
  const rows = Object.entries(IDS).map(([id, slot]) => ({ slot, target: targetFor(id), outcome: 'not-evaluated',
    gates: Object.fromEntries(GATES.map(gate => [gate, { evaluated: false, passed: false, rejected: false }])), reasons: [] }));
  const rowFor = id => typeof id === 'string' && Object.hasOwn(IDS, id)
    ? rows.find(row => row.slot === IDS[id]) : undefined;
  const seenRules = new Set();
  let scanned = false, resolved = false;
  function record(id, gate, passed, reason) {
    const row = rowFor(id);
    if (!row || row.target !== 'selected' || !GATES.includes(gate) || typeof passed !== 'boolean') return passed;
    const flags = row.gates[gate];
    flags.evaluated = true;
    flags[passed ? 'passed' : 'rejected'] = true;
    if (reason && REASONS.includes(reason) && !row.reasons.includes(reason)) row.reasons.push(reason);
    return passed;
  }
  function window(passed, reason) { for (const id of Object.keys(IDS)) record(id, 'window', passed, reason); }
  function rule(id) { if (rowFor(id)) seenRules.add(id); }
  function finish(groups) {
    if (!groups || !Array.isArray(groups.unique) || !Array.isArray(groups.ambiguous)) return undefined;
    for (const id of Object.keys(IDS)) {
      const row = rowFor(id);
      if (scanned && !seenRules.has(id)) record(id, 'rule', false, 'RULE_MISSING');
      if (row.target !== 'selected' || !resolved || !row.gates.rule.passed) continue;
      const date = dates.get(id);
      const accepted = (groups.unique || []).some(hit => hit && hit.id === id && hit.date === date);
      const ambiguous = (groups.ambiguous || []).some(group => group &&
        (group.id === id && group.date === date
          || (group.hits || []).some(hit => hit && hit.id === id && hit.date === date)));
      record(id, 'representation', accepted, accepted ? 'REPRESENTED' : undefined);
      if (ambiguous) record(id, 'representation', false, 'REPRESENTATION_AMBIGUOUS');
      row.outcome = ambiguous ? 'ambiguous' : accepted ? 'matched' : 'unmatched';
    }
    return project({ schema: SCHEMA, scope: SCOPE, slots: rows });
  }
  const api = { record, window, rule, finish,
    forDate(date) { return typeof date === 'string' && context && date >= context.startDate
      && date <= context.endDate ? api : undefined; },
    forOccurrence(id, date) { return dates.get(id) === date ? { record } : undefined; },
    rulesScanned() { scanned = true; }, resolve() { resolved = true; } };
  return api;
}

module.exports = { SCHEMA, SCOPE, SLOTS, GATES, REASONS, create, project };
