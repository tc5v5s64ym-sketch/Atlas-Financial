'use strict';
/* Talk Slice 6B / A-vs-B — Forecast adapter for explicit hypothetical extras.
 *
 * Gemini may extract only { intent, amount, debtLabel } for one extra,
 * or { intent, scenarios: [{ amount, debtLabel }, ...] } for a
 * comparison of two or more extras. This module validates each caller
 * amount, recovers every amount and exact catalog debt named in the
 * original question, requires the extract to agree with those recovered
 * pairings, and then calls Forecast. A single-extra extract still
 * requires exactly one amount and one target. A comparison extract
 * requires two or more complete amount↔target pairs and fails closed
 * on omit, add, or swap. It does not choose an amount or target, does
 * not rank, recommend, or infer affordability, does not read
 * decisionPosture or targetBuffer as policy, does not substitute
 * plan.nextDollar, and does not write.
 */

const Forecast = require('../public/forecast.js');

const HYPOTHETICAL_INTENT = 'hypothetical-extra-payment';
const COMPARISON_INTENT = 'hypothetical-extra-payment-comparison';
const HYPOTHETICAL_EXTRA_MAX = 1000000;
const HYPOTHETICAL_EXTRACT_KEYS = Object.freeze({
  intent: true,
  amount: true,
  debtLabel: true,
});
const COMPARISON_EXTRACT_KEYS = Object.freeze({
  intent: true,
  scenarios: true,
});
const COMPARISON_SCENARIO_KEYS = Object.freeze({
  amount: true,
  debtLabel: true,
});
const GENERIC_DEBT_QUERIES = Object.freeze({
  card: true,
  cards: true,
  credit: true,
  'credit card': true,
  'credit cards': true,
  visa: true,
  mastercard: true,
  td: true,
  'td card': true,
  'td credit': true,
  'td visa': true,
  'the card': true,
  'my card': true,
  'a card': true,
  'the credit card': true,
  'my credit card': true,
  'the visa': true,
  'my visa': true,
  'the td card': true,
});
const DOLLAR_AMOUNT_RE = /\$\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?/g;
const BARE_AMOUNT_RE = /\b(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\b/g;
const COMPARISON_CLAUSE_SPLIT_RE = /\b(?:versus|vs\.?|compared to|against|or|and)\b/i;
const COMPARISON_PLANNER_ACT_RES = Object.freeze([
  /\bbest\b/i,
  /\bbetter\b/i,
  /\bwhere(?:ver)?\b/i,
  /\bsaves? most\b/i,
  /\bafford/i,
  /\bextra cash\b/i,
  /\bspare cash\b/i,
  /\ball extra\b/i,
  /\bdecisionposture\b/i,
  /\bposture\b/i,
  /\bfund(?:s|ed|ing)?\b/i,
  /\bborrow/i,
  /\bdraw\b/i,
  /\bwinner\b/i,
  /\brecommend/i,
  /\brank(?:ing)?\b/i,
  /\bshould i\b/i,
  /\bwhat should\b/i,
]);

function questionIsPlannerActComparison(question) {
  const text = String(question || '');
  return COMPARISON_PLANNER_ACT_RES.some(re => re.test(text));
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function isGenericDebtQuery(query) {
  return GENERIC_DEBT_QUERIES[query] === true;
}

function containsNormalizedPhrase(haystack, needle) {
  const phrase = normalizeName(needle);
  if (!phrase) return false;
  return ` ${normalizeName(haystack)} `.includes(` ${phrase} `);
}

function parseCallerAmount(raw) {
  if (typeof raw === 'number') return validateAmount(raw);
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'invalid-amount' };
  }
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'invalid-amount' };
  if (!/^\$?\s*(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d{1,2})?\s*$/.test(trimmed)) {
    return { ok: false, reason: 'invalid-amount' };
  }
  return validateAmount(Number(trimmed.replace(/[$,\s]/g, '')));
}

function validateAmount(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return { ok: false, reason: 'invalid-amount' };
  }
  if (amount <= 0 || amount > HYPOTHETICAL_EXTRA_MAX) {
    return { ok: false, reason: 'invalid-amount' };
  }
  const cents = Math.round(amount * 100) / 100;
  if (Math.abs(amount - cents) > 1e-9) {
    return { ok: false, reason: 'invalid-amount' };
  }
  return { ok: true, amount: cents };
}

function packetFacilityLabelsById(packet) {
  const facilities = packet
    && packet.current
    && packet.current.debts
    && packet.current.debts.facilities;
  const byId = new Map();
  if (!Array.isArray(facilities)) return byId;
  for (const row of facilities) {
    if (!row || typeof row.id !== 'string' || !row.id) continue;
    if (typeof row.label !== 'string' || !row.label) continue;
    const list = byId.get(row.id) || [];
    list.push(row.label);
    byId.set(row.id, list);
  }
  return byId;
}

function catalogFromDebts(debts, packet) {
  const extras = packetFacilityLabelsById(packet);
  const catalog = [];
  const seen = new Map();
  for (const debt of Array.isArray(debts) ? debts : []) {
    if (!debt || typeof debt.id !== 'string' || !debt.id) continue;
    if (seen.has(debt.id)) {
      seen.set(debt.id, seen.get(debt.id) + 1);
      continue;
    }
    seen.set(debt.id, 1);
    const labels = [typeof debt.label === 'string' ? debt.label : ''];
    const packetLabels = extras.get(debt.id) || [];
    for (const label of packetLabels) {
      if (!labels.includes(label)) labels.push(label);
    }
    catalog.push({
      id: debt.id,
      labels,
      names: [debt.id].concat(labels).map(normalizeName).filter(Boolean),
    });
  }
  return catalog.filter(row => seen.get(row.id) === 1);
}

function findAmountMatches(text, regex) {
  const re = new RegExp(regex.source, 'g');
  const matches = [];
  let match;
  while ((match = re.exec(text)) !== null) {
    matches.push({
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return matches;
}

function recoverCallerAmountOccurrences(question) {
  const text = String(question || '');
  const dollar = findAmountMatches(text, DOLLAR_AMOUNT_RE);
  const bare = findAmountMatches(text, BARE_AMOUNT_RE).filter(row => (
    !dollar.some(hit => row.start < hit.end && row.end > hit.start)
  ));
  const amounts = [];
  for (const row of dollar.concat(bare)) {
    const parsed = parseCallerAmount(String(row.raw).replace(/\s+/g, ''));
    if (!parsed.ok) continue;
    amounts.push({
      amount: parsed.amount,
      start: row.start,
      end: row.end,
      raw: row.raw,
    });
  }
  amounts.sort((left, right) => left.start - right.start);
  return amounts;
}

function recoverCallerAmounts(question) {
  const amounts = [];
  for (const row of recoverCallerAmountOccurrences(question)) {
    if (!amounts.includes(row.amount)) amounts.push(row.amount);
  }
  return amounts;
}

function normalizeWithIndexMap(text) {
  const raw = String(text || '');
  let normalized = '';
  const indexMap = [];
  let pendingSpace = false;
  let started = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i].toLowerCase();
    if (/[a-z0-9]/.test(ch)) {
      if (pendingSpace && started) {
        normalized += ' ';
        indexMap.push(i);
      }
      normalized += ch;
      indexMap.push(i);
      pendingSpace = false;
      started = true;
    } else if (started) {
      pendingSpace = true;
    }
  }
  return { normalized, indexMap };
}

function findNormalizedPhraseOccurrences(text, phrase) {
  const needle = normalizeName(phrase);
  if (!needle) return [];
  const mapped = normalizeWithIndexMap(text);
  const haystack = ` ${mapped.normalized} `;
  const seek = ` ${needle} `;
  const hits = [];
  let from = 0;
  while (from <= haystack.length) {
    const at = haystack.indexOf(seek, from);
    if (at < 0) break;
    const normStart = at;
    const normEnd = at + needle.length;
    if (normStart >= mapped.indexMap.length || normEnd - 1 >= mapped.indexMap.length) {
      from = at + 1;
      continue;
    }
    hits.push({
      start: mapped.indexMap[normStart],
      end: mapped.indexMap[normEnd - 1] + 1,
    });
    from = at + seek.length - 1;
  }
  return hits;
}

function spansOverlap(left, right) {
  return left.start < right.end && right.start < left.end;
}

function recoverCallerDebtTargets(question, debts, packet) {
  if (typeof question !== 'string' || !question.trim()) return [];
  const catalog = catalogFromDebts(debts, packet);
  const targets = [];
  for (const row of catalog) {
    const named = row.names.some(name => (
      name && !isGenericDebtQuery(name) && containsNormalizedPhrase(question, name)
    ));
    if (named) targets.push(row.id);
  }
  return targets;
}

function recoverCallerDebtTargetOccurrences(question, debts, packet) {
  if (typeof question !== 'string' || !question.trim()) return [];
  const catalog = catalogFromDebts(debts, packet);
  const candidates = [];
  for (const row of catalog) {
    const seen = new Set();
    for (const name of row.names) {
      if (!name || isGenericDebtQuery(name) || seen.has(name)) continue;
      seen.add(name);
      for (const hit of findNormalizedPhraseOccurrences(question, name)) {
        candidates.push({
          debtId: row.id,
          start: hit.start,
          end: hit.end,
          nameLength: name.length,
        });
      }
    }
  }
  candidates.sort((left, right) => {
    if (right.nameLength !== left.nameLength) return right.nameLength - left.nameLength;
    return left.start - right.start;
  });
  const accepted = [];
  for (const row of candidates) {
    if (accepted.some(other => spansOverlap(other, row))) continue;
    accepted.push(row);
  }
  accepted.sort((left, right) => left.start - right.start);
  return accepted;
}

function recoverCallerScenarioPairs(question, debts, packet) {
  if (typeof question !== 'string' || !question.trim()) {
    return { ok: false, reason: 'extract-mismatch' };
  }
  const clauses = String(question).split(COMPARISON_CLAUSE_SPLIT_RE)
    .map(part => part.trim())
    .filter(Boolean);
  if (clauses.length < 2) {
    return { ok: false, reason: 'unclear-scenario-structure' };
  }
  const pairs = [];
  for (const clause of clauses) {
    const amounts = recoverCallerAmountOccurrences(clause);
    const targets = recoverCallerDebtTargetOccurrences(clause, debts, packet);
    if (amounts.length !== 1 || targets.length !== 1) {
      return { ok: false, reason: 'unclear-scenario-structure' };
    }
    pairs.push({
      amount: amounts[0].amount,
      debtId: targets[0].debtId,
    });
  }
  if (pairs.length < 2) return { ok: false, reason: 'unclear-scenario-structure' };
  return { ok: true, pairs };
}

function pairKey(amount, debtId) {
  return `${amount}::${debtId}`;
}

function samePairMultiset(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  const counts = new Map();
  for (const row of left) {
    const key = pairKey(row.amount, row.debtId);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const row of right) {
    const key = pairKey(row.amount, row.debtId);
    const next = (counts.get(key) || 0) - 1;
    if (next < 0) return false;
    counts.set(key, next);
  }
  return Array.from(counts.values()).every(value => value === 0);
}

function extractAgreesWithQuestion(question, amount, debtLabel, debts, packet) {
  if (typeof question !== 'string' || !question.trim()) {
    return { ok: false, reason: 'extract-mismatch' };
  }
  if (typeof debtLabel !== 'string' || !debtLabel.trim()) {
    return { ok: false, reason: 'extract-mismatch' };
  }
  const parsedAmount = parseCallerAmount(amount);
  if (!parsedAmount.ok) return { ok: false, reason: parsedAmount.reason };
  const recoveredAmounts = recoverCallerAmounts(question);
  if (recoveredAmounts.length !== 1 || recoveredAmounts[0] !== parsedAmount.amount) {
    return { ok: false, reason: 'extract-mismatch' };
  }
  const recoveredTargets = recoverCallerDebtTargets(question, debts, packet);
  if (recoveredTargets.length !== 1) {
    return { ok: false, reason: 'ambiguous-target' };
  }
  const resolved = resolveDebtLabel(debtLabel, debts, packet);
  if (!resolved.ok || resolved.debtId !== recoveredTargets[0]) {
    return { ok: false, reason: 'extract-mismatch' };
  }
  return {
    ok: true,
    amount: parsedAmount.amount,
    debtLabel: debtLabel.trim(),
    debtId: resolved.debtId,
  };
}

function extractComparisonAgreesWithQuestion(question, scenarios, debts, packet) {
  if (typeof question !== 'string' || !question.trim()) {
    return { ok: false, reason: 'extract-mismatch' };
  }
  if (questionIsPlannerActComparison(question)) {
    return { ok: false, reason: 'planner-act' };
  }
  if (!Array.isArray(scenarios) || scenarios.length < 2) {
    return { ok: false, reason: 'extract-mismatch' };
  }
  const extractPairs = [];
  for (const row of scenarios) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return { ok: false, reason: 'extract-mismatch' };
    }
    if (typeof row.debtLabel !== 'string' || !row.debtLabel.trim()) {
      return { ok: false, reason: 'extract-mismatch' };
    }
    if (!containsNormalizedPhrase(question, row.debtLabel)) {
      return { ok: false, reason: 'extract-mismatch' };
    }
    const parsedAmount = parseCallerAmount(row.amount);
    if (!parsedAmount.ok) return { ok: false, reason: parsedAmount.reason };
    const recoveredAmounts = recoverCallerAmounts(question);
    if (!recoveredAmounts.includes(parsedAmount.amount)) {
      return { ok: false, reason: 'extract-mismatch' };
    }
    const resolved = resolveDebtLabel(row.debtLabel, debts, packet);
    if (!resolved.ok) return { ok: false, reason: resolved.reason };
    extractPairs.push({
      amount: parsedAmount.amount,
      debtId: resolved.debtId,
      debtLabel: row.debtLabel.trim(),
    });
  }
  const recovered = recoverCallerScenarioPairs(question, debts, packet);
  if (!recovered.ok) return { ok: false, reason: recovered.reason };
  if (!samePairMultiset(extractPairs, recovered.pairs)) {
    return { ok: false, reason: 'extract-mismatch' };
  }
  return {
    ok: true,
    scenarios: recovered.pairs.map(pair => {
      const match = extractPairs.find(row => (
        row.amount === pair.amount && row.debtId === pair.debtId
      ));
      return {
        amount: pair.amount,
        debtId: pair.debtId,
        debtLabel: match ? match.debtLabel : pair.debtId,
      };
    }),
  };
}

function resolveDebtLabel(debtLabel, debts, packet) {
  if (typeof debtLabel !== 'string' || !debtLabel.trim()) {
    return { ok: false, reason: 'unresolved-debt' };
  }
  const query = normalizeName(debtLabel);
  if (!query || isGenericDebtQuery(query)) {
    return { ok: false, reason: 'unresolved-debt' };
  }
  const catalog = catalogFromDebts(debts, packet);
  if (!catalog.length) return { ok: false, reason: 'unresolved-debt' };
  const matches = catalog.filter(row => row.names.some(name => name === query));
  if (matches.length !== 1) return { ok: false, reason: 'unresolved-debt' };
  return { ok: true, debtId: matches[0].id };
}

function parseExtract(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'not structured' };
  }
  const keys = Object.keys(parsed);
  if (!keys.includes('intent')) return { ok: false, reason: 'not-hypothetical' };
  if (keys.length !== 3 || keys.some(key => !HYPOTHETICAL_EXTRACT_KEYS[key])) {
    return { ok: false, reason: 'unexpected fields' };
  }
  if (parsed.intent !== HYPOTHETICAL_INTENT) {
    return { ok: false, reason: 'invalid intent' };
  }
  if (typeof parsed.debtLabel !== 'string') {
    return { ok: false, reason: 'invalid debtLabel' };
  }
  if (typeof parsed.amount !== 'number' && typeof parsed.amount !== 'string') {
    return { ok: false, reason: 'invalid amount' };
  }
  return {
    ok: true,
    intent: HYPOTHETICAL_INTENT,
    amount: parsed.amount,
    debtLabel: parsed.debtLabel,
  };
}

function parseComparisonExtract(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'not-comparison' };
  }
  const keys = Object.keys(parsed);
  if (!keys.includes('intent')) return { ok: false, reason: 'not-comparison' };
  if (parsed.intent !== COMPARISON_INTENT) {
    return { ok: false, reason: 'not-comparison' };
  }
  if (keys.length !== 2 || keys.some(key => !COMPARISON_EXTRACT_KEYS[key])) {
    return { ok: false, reason: 'unexpected fields' };
  }
  if (!Array.isArray(parsed.scenarios) || parsed.scenarios.length < 2) {
    return { ok: false, reason: 'invalid scenarios' };
  }
  const scenarios = [];
  for (const row of parsed.scenarios) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return { ok: false, reason: 'invalid scenario' };
    }
    const rowKeys = Object.keys(row);
    if (rowKeys.length !== 2 || rowKeys.some(key => !COMPARISON_SCENARIO_KEYS[key])) {
      return { ok: false, reason: 'unexpected fields' };
    }
    if (typeof row.debtLabel !== 'string') {
      return { ok: false, reason: 'invalid debtLabel' };
    }
    if (typeof row.amount !== 'number' && typeof row.amount !== 'string') {
      return { ok: false, reason: 'invalid amount' };
    }
    scenarios.push({
      amount: row.amount,
      debtLabel: row.debtLabel,
    });
  }
  return {
    ok: true,
    intent: COMPARISON_INTENT,
    scenarios,
  };
}

function unavailable(reason) {
  return {
    status: 'unavailable',
    reason: reason || 'unavailable',
    nature: 'hypothetical',
    calculator: 'Forecast',
    writesCanonicalState: false,
    productionWrite: false,
    actionPermission: 'not-granted',
    recommendation: null,
  };
}

function evaluate({ amount, debtLabel, question, plan, debts, packet }) {
  const agreed = extractAgreesWithQuestion(question, amount, debtLabel, debts, packet);
  if (!agreed.ok) return unavailable(agreed.reason);
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return unavailable('missing-plan');
  }
  const asOf = plan.opening && plan.opening.asOf;
  return Forecast.hypotheticalExtraPayment(plan, debts, asOf, {
    amount: agreed.amount,
    debtId: agreed.debtId,
    nature: 'hypothetical',
  });
}

function comparisonUnavailable(reason) {
  return {
    status: 'unavailable',
    reason: reason || 'unavailable',
    nature: 'hypothetical-comparison',
    calculator: 'Forecast',
    writesCanonicalState: false,
    productionWrite: false,
    actionPermission: 'not-granted',
    recommendation: null,
    ranking: null,
    affordability: null,
  };
}

function evaluateComparison({ scenarios, question, plan, debts, packet }) {
  const agreed = extractComparisonAgreesWithQuestion(
    question, scenarios, debts, packet
  );
  if (!agreed.ok) return comparisonUnavailable(agreed.reason);
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return comparisonUnavailable('missing-plan');
  }
  const asOf = plan.opening && plan.opening.asOf;
  return Forecast.hypotheticalExtraPaymentComparison(plan, debts, asOf, {
    nature: 'hypothetical-comparison',
    scenarios: agreed.scenarios.map(row => ({
      amount: row.amount,
      debtId: row.debtId,
    })),
  });
}

module.exports = {
  HYPOTHETICAL_INTENT,
  COMPARISON_INTENT,
  HYPOTHETICAL_EXTRA_MAX,
  parseCallerAmount,
  recoverCallerAmounts,
  recoverCallerAmountOccurrences,
  recoverCallerDebtTargets,
  recoverCallerDebtTargetOccurrences,
  recoverCallerScenarioPairs,
  extractAgreesWithQuestion,
  extractComparisonAgreesWithQuestion,
  resolveDebtLabel,
  parseExtract,
  parseComparisonExtract,
  evaluate,
  evaluateComparison,
};
