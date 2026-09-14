'use strict';
/* Talk Slice 6B — Forecast adapter for one explicit hypothetical extra.
 *
 * Gemini may extract only { intent, amount, debtLabel }. This module
 * validates the caller amount, resolves the label to one stable debt id
 * against sanitized id/label metadata already on the ask path, then
 * calls Forecast.hypotheticalExtraPayment. It does not choose an amount
 * or target, does not read decisionPosture or targetBuffer as policy,
 * does not substitute plan.nextDollar, and does not write.
 */

const Forecast = require('../public/forecast.js');

const HYPOTHETICAL_INTENT = 'hypothetical-extra-payment';
const HYPOTHETICAL_EXTRA_MAX = 1000000;
const HYPOTHETICAL_EXTRACT_KEYS = Object.freeze({
  intent: true,
  amount: true,
  debtLabel: true,
});

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
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

function resolveDebtLabel(debtLabel, debts, packet) {
  if (typeof debtLabel !== 'string' || !debtLabel.trim()) {
    return { ok: false, reason: 'unresolved-debt' };
  }
  const query = normalizeName(debtLabel);
  if (!query) return { ok: false, reason: 'unresolved-debt' };
  const queryTokens = query.split(' ');
  const catalog = catalogFromDebts(debts, packet);
  if (!catalog.length) return { ok: false, reason: 'unresolved-debt' };
  const matches = catalog.filter(row => row.names.some((name) => {
    if (name === query) return true;
    const hay = name.split(' ');
    return queryTokens.every(token => hay.includes(token));
  }));
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

function evaluate({ amount, debtLabel, plan, debts, packet }) {
  const parsedAmount = parseCallerAmount(amount);
  if (!parsedAmount.ok) return unavailable(parsedAmount.reason);
  const resolved = resolveDebtLabel(debtLabel, debts, packet);
  if (!resolved.ok) return unavailable(resolved.reason);
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return unavailable('missing-plan');
  }
  const asOf = plan.opening && plan.opening.asOf;
  return Forecast.hypotheticalExtraPayment(plan, debts, asOf, {
    amount: parsedAmount.amount,
    debtId: resolved.debtId,
    nature: 'hypothetical',
  });
}

module.exports = {
  HYPOTHETICAL_INTENT,
  HYPOTHETICAL_EXTRA_MAX,
  parseCallerAmount,
  resolveDebtLabel,
  parseExtract,
  evaluate,
};
