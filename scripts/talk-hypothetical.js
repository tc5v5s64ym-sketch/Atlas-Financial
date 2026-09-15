'use strict';
/* Talk Slice 6B — Forecast adapter for one explicit hypothetical extra.
 *
 * Gemini may extract only { intent, amount, debtLabel }. This module
 * validates the caller amount, recovers every amount and exact catalog
 * debt named in the original question, requires exactly one of each,
 * and requires the extract to agree with that unique pair. It then
 * calls Forecast.hypotheticalExtraPayment. Multi-target or mixed-amount
 * questions fail closed. It does not choose an amount or target, does
 * not read decisionPosture or targetBuffer as policy, does not
 * substitute plan.nextDollar, and does not write.
 */

const Forecast = require('../public/forecast.js');

const HYPOTHETICAL_INTENT = 'hypothetical-extra-payment';
const HYPOTHETICAL_EXTRA_MAX = 1000000;
const HYPOTHETICAL_EXTRACT_KEYS = Object.freeze({
  intent: true,
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

function recoverCallerAmounts(question) {
  const text = String(question || '');
  const dollar = findAmountMatches(text, DOLLAR_AMOUNT_RE);
  const bare = findAmountMatches(text, BARE_AMOUNT_RE).filter(row => (
    !dollar.some(hit => row.start < hit.end && row.end > hit.start)
  ));
  const amounts = [];
  for (const row of dollar.concat(bare)) {
    const parsed = parseCallerAmount(String(row.raw).replace(/\s+/g, ''));
    if (parsed.ok && !amounts.includes(parsed.amount)) amounts.push(parsed.amount);
  }
  return amounts;
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

module.exports = {
  HYPOTHETICAL_INTENT,
  HYPOTHETICAL_EXTRA_MAX,
  parseCallerAmount,
  recoverCallerAmounts,
  recoverCallerDebtTargets,
  extractAgreesWithQuestion,
  resolveDebtLabel,
  parseExtract,
  evaluate,
};
