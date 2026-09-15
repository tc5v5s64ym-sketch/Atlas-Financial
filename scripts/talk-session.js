'use strict';
/* Talk ephemeral multi-turn session context.
 *
 * Conversation memory is conversational context only. It is not a
 * canonical household fact store, financial evidence, Forecast state,
 * owner policy, a write, permission, a substitute for this request's
 * assistant packet, or a substitute for explicit verification of
 * amounts and targets.
 *
 * The buffer is in-process RAM, keyed to the authenticated session
 * cookie (HMAC of the cookie, never the raw token). Bounded depth,
 * size, session count, and inactivity TTL. No durable database.
 * Logout and a new login start empty. Session A cannot read session B.
 *
 * Follow-up amounts and named debts are resolved only by the explicit
 * contract below. Ambiguity returns unavailable. Gemini never fills a
 * missing amount or target from chat text. Current Atlas state and
 * Forecast remain the only financial authorities.
 */

const crypto = require('crypto');
const TalkHypothetical = require('./talk-hypothetical');

const MAX_TURNS = 8;
const MAX_SESSIONS = 32;
const TTL_MS = 60 * 60 * 1000;
const QUESTION_MAX = 2000;
const PRESENTED_MAX = 400;
const LABEL_MAX = 80;
const SCENARIO_MAX = 6;
const FOLLOWUP_DEIXIS_RE = /\b(?:what about|how about|and(?:\s+what)?|instead|also|same(?:\s+amount)?|that)\b/i;
const EXTRA_LANGUAGE_RE = /\b(?:extra|pay(?:ment)?|put|toward|towards|instead)\b/i;
const COMPARISON_FOLLOWUP_RE = /\b(?:compare(?:d)?|versus|vs\.?|against)\b/i;
const EXPLAINER_FACT_RE = /\b(?:balance|rate|limit|due|owing|as of|available credit|interest|trust|verified|estimated)\b/i;

function hmacKey(secret, token) {
  if (typeof secret !== 'string' || secret.length < 16) return '';
  if (typeof token !== 'string' || !token) return '';
  return crypto.createHmac('sha256', secret).update(token).digest('hex');
}

function finiteAmount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function clipText(value, max) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function sanitizeScenario(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  if (!finiteAmount(row.amount)) return null;
  const debtId = clipText(row.debtId, LABEL_MAX);
  const debtLabel = clipText(row.debtLabel, LABEL_MAX);
  if (!debtId || !debtLabel) return null;
  return { amount: row.amount, debtId, debtLabel };
}

function sanitizeTurn(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const kind = raw.kind;
  if (kind !== 'explained' && kind !== 'hypothetical' && kind !== 'comparison'
      && kind !== 'unavailable') {
    return null;
  }
  const question = clipText(raw.question, QUESTION_MAX);
  if (!question) return null;
  const turn = {
    kind,
    question,
    presented: clipText(raw.presented, PRESENTED_MAX),
  };
  if (kind === 'hypothetical') {
    if (!finiteAmount(raw.amount)) return null;
    const debtId = clipText(raw.debtId, LABEL_MAX);
    const debtLabel = clipText(raw.debtLabel, LABEL_MAX);
    if (!debtId || !debtLabel) return null;
    turn.amount = raw.amount;
    turn.debtId = debtId;
    turn.debtLabel = debtLabel;
  }
  if (kind === 'comparison') {
    if (!Array.isArray(raw.scenarios) || raw.scenarios.length < 2
        || raw.scenarios.length > SCENARIO_MAX) {
      return null;
    }
    const scenarios = [];
    for (const row of raw.scenarios) {
      const clean = sanitizeScenario(row);
      if (!clean) return null;
      scenarios.push(clean);
    }
    turn.scenarios = scenarios;
  }
  return turn;
}

function publicConversation(turns) {
  if (!Array.isArray(turns)) return [];
  const out = [];
  for (const turn of turns) {
    const question = clipText(turn && turn.question, QUESTION_MAX);
    if (!question) continue;
    out.push({
      question,
      presented: clipText(turn && turn.presented, PRESENTED_MAX),
    });
  }
  return out;
}

function lastTurn(turns) {
  if (!Array.isArray(turns) || !turns.length) return null;
  return turns[turns.length - 1] || null;
}

function currentDebtStillLive(debts, packet, debtId, debtLabel) {
  const resolved = TalkHypothetical.resolveDebtLabel(debtLabel, debts, packet);
  if (resolved.ok && resolved.debtId === debtId) return true;
  const targets = TalkHypothetical.recoverCallerDebtTargets(debtLabel, debts, packet);
  return targets.length === 1 && targets[0] === debtId;
}

function incompleteExtraShape(amountCount, targetCount) {
  return (amountCount === 1 && targetCount === 0)
    || (amountCount === 0 && targetCount === 1);
}

function looksLikeIncompleteExtra(question, amountCount, targetCount) {
  if (amountCount === 1 && targetCount === 0) {
    return FOLLOWUP_DEIXIS_RE.test(question) || EXTRA_LANGUAGE_RE.test(question);
  }
  if (amountCount === 0 && targetCount === 1) {
    return EXTRA_LANGUAGE_RE.test(question);
  }
  return false;
}

function resolveFollowup({ question, priorTurn, debts, packet }) {
  const parsed = typeof question === 'string' ? question.trim() : '';
  if (!parsed) return { status: 'none' };

  const amounts = TalkHypothetical.recoverCallerAmounts(parsed);
  const targets = TalkHypothetical.recoverCallerDebtTargets(parsed, debts, packet);
  const completeSingle = amounts.length === 1 && targets.length === 1;
  const recoveredPairs = TalkHypothetical.recoverCallerScenarioPairs(parsed, debts, packet);
  const plannerAct = TalkHypothetical.questionIsPlannerActComparison(parsed);
  const wantsPreference = TalkHypothetical.questionAsksAuthorizedPreference(parsed);
  const compareAsk = COMPARISON_FOLLOWUP_RE.test(parsed);
  const deixis = FOLLOWUP_DEIXIS_RE.test(parsed);
  const explainerFact = EXPLAINER_FACT_RE.test(parsed);

  if (completeSingle || recoveredPairs.ok) {
    return { status: 'none' };
  }

  if (plannerAct && !wantsPreference && incompleteExtraShape(amounts.length, targets.length)) {
    return { status: 'ambiguous', nature: 'hypothetical' };
  }

  const prior = priorTurn && typeof priorTurn === 'object' ? priorTurn : null;

  if (wantsPreference
      && prior && prior.kind === 'comparison'
      && Array.isArray(prior.scenarios) && prior.scenarios.length >= 2
      && amounts.length === 0
      && (targets.length === 0
        || prior.scenarios.every(row => targets.includes(row.debtId)
          || TalkHypothetical.recoverCallerDebtTargets(row.debtLabel, debts, packet)
            .some(id => targets.includes(id))))) {
    const live = [];
    for (const row of prior.scenarios) {
      if (!currentDebtStillLive(debts, packet, row.debtId, row.debtLabel)) {
        return { status: 'ambiguous', nature: 'comparison' };
      }
      live.push({
        amount: row.amount,
        debtId: row.debtId,
        debtLabel: row.debtLabel,
      });
    }
    return { status: 'resolved-preference', scenarios: live };
  }

  if (compareAsk && prior && prior.kind === 'hypothetical'
      && amounts.length === 1 && targets.length === 1
      && currentDebtStillLive(debts, packet, prior.debtId, prior.debtLabel)) {
    const newId = targets[0];
    const newLabel = findLabelForDebt(newId, debts, packet);
    if (!currentDebtStillLive(debts, packet, newId, newLabel)) {
      return { status: 'ambiguous', nature: 'comparison' };
    }
    if (prior.debtId === newId && prior.amount === amounts[0]) {
      return { status: 'ambiguous', nature: 'comparison' };
    }
    return {
      status: 'resolved-comparison',
      scenarios: [
        {
          amount: prior.amount,
          debtId: prior.debtId,
          debtLabel: prior.debtLabel,
        },
        {
          amount: amounts[0],
          debtId: newId,
          debtLabel: newLabel,
        },
      ],
    };
  }

  if (compareAsk && incompleteExtraShape(amounts.length, targets.length)) {
    return { status: 'ambiguous', nature: 'comparison' };
  }

  if (amounts.length === 1 && targets.length === 0
      && (deixis || EXTRA_LANGUAGE_RE.test(parsed))
      && prior && prior.kind === 'hypothetical'
      && currentDebtStillLive(debts, packet, prior.debtId, prior.debtLabel)) {
    return {
      status: 'resolved-hypothetical',
      amount: amounts[0],
      debtId: prior.debtId,
      debtLabel: prior.debtLabel,
    };
  }

  if (amounts.length === 0 && targets.length === 1
      && deixis && !explainerFact && !compareAsk
      && prior && prior.kind === 'hypothetical'
      && finiteAmount(prior.amount)) {
    const newId = targets[0];
    const newLabel = findLabelForDebt(newId, debts, packet);
    if (!currentDebtStillLive(debts, packet, newId, newLabel)) {
      return { status: 'ambiguous', nature: 'hypothetical' };
    }
    return {
      status: 'resolved-hypothetical',
      amount: prior.amount,
      debtId: newId,
      debtLabel: newLabel,
    };
  }

  if (looksLikeIncompleteExtra(parsed, amounts.length, targets.length)) {
    return { status: 'ambiguous', nature: 'hypothetical' };
  }

  if (wantsPreference && (!prior || prior.kind !== 'comparison')) {
    return { status: 'ambiguous', nature: 'comparison' };
  }

  return { status: 'none' };
}

function findLabelForDebt(debtId, debts, packet) {
  const list = Array.isArray(debts) ? debts : [];
  for (const debt of list) {
    if (debt && debt.id === debtId && typeof debt.label === 'string' && debt.label) {
      return debt.label;
    }
  }
  const facilities = packet
    && packet.current
    && packet.current.debts
    && packet.current.debts.facilities;
  if (Array.isArray(facilities)) {
    for (const row of facilities) {
      if (row && row.id === debtId && typeof row.label === 'string' && row.label) {
        return row.label;
      }
    }
  }
  return debtId;
}

function sessionTurnFromHypothetical(result) {
  if (!result || result.status !== 'ready' || !result.input) {
    return { kind: 'unavailable' };
  }
  const amount = result.input.amount;
  const debtId = clipText(result.input.debtId, LABEL_MAX);
  const debtLabel = clipText(result.input.debtLabel, LABEL_MAX);
  if (!finiteAmount(amount) || !debtId || !debtLabel) return { kind: 'unavailable' };
  return { kind: 'hypothetical', amount, debtId, debtLabel };
}

function sessionTurnFromComparison(result) {
  if (!result || result.status !== 'ready' || !Array.isArray(result.scenarios)) {
    return { kind: 'unavailable' };
  }
  const scenarios = [];
  for (const row of result.scenarios) {
    const clean = sanitizeScenario(row && row.input);
    if (!clean) return { kind: 'unavailable' };
    scenarios.push(clean);
  }
  if (scenarios.length < 2) return { kind: 'unavailable' };
  return { kind: 'comparison', scenarios };
}

function createSessionContext(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const secret = opts.secret;
  const nowFn = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const ttlMs = Number.isFinite(opts.ttlMs) ? opts.ttlMs : TTL_MS;
  const maxTurns = Number.isFinite(opts.maxTurns) ? opts.maxTurns : MAX_TURNS;
  const maxSessions = Number.isFinite(opts.maxSessions) ? opts.maxSessions : MAX_SESSIONS;
  const map = new Map();

  function prune(now) {
    for (const [key, rec] of map.entries()) {
      if (!rec || now - rec.updatedAt > ttlMs) map.delete(key);
    }
    while (map.size > maxSessions) {
      let oldestKey = null;
      let oldestAt = Infinity;
      for (const [key, rec] of map.entries()) {
        if (rec.updatedAt < oldestAt) {
          oldestAt = rec.updatedAt;
          oldestKey = key;
        }
      }
      if (oldestKey == null) break;
      map.delete(oldestKey);
    }
  }

  function keyFromToken(token) {
    return hmacKey(secret, token);
  }

  function turns(key) {
    if (typeof key !== 'string' || !key) return [];
    const now = nowFn();
    prune(now);
    const rec = map.get(key);
    if (!rec) return [];
    if (now - rec.updatedAt > ttlMs) {
      map.delete(key);
      return [];
    }
    return rec.turns.slice();
  }

  function append(key, raw) {
    if (typeof key !== 'string' || !key) return false;
    const turn = sanitizeTurn(raw);
    if (!turn) return false;
    const now = nowFn();
    prune(now);
    const rec = map.get(key) || { turns: [], updatedAt: now };
    rec.turns = rec.turns.concat([turn]).slice(-maxTurns);
    rec.updatedAt = now;
    map.set(key, rec);
    prune(now);
    return true;
  }

  function clear(key) {
    if (typeof key !== 'string' || !key) return;
    map.delete(key);
  }

  return {
    keyFromToken,
    turns,
    append,
    clear,
    publicConversation,
    sessionCount() {
      prune(nowFn());
      return map.size;
    },
  };
}

module.exports = {
  MAX_TURNS,
  MAX_SESSIONS,
  TTL_MS,
  QUESTION_MAX,
  PRESENTED_MAX,
  createSessionContext,
  resolveFollowup,
  publicConversation,
  lastTurn,
  sessionTurnFromHypothetical,
  sessionTurnFromComparison,
  hmacKey,
};
