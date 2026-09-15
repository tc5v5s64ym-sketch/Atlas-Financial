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
 * contract below. History may fill a missing amount or named debt only
 * when the question is authorized follow-up grammar — a positive
 * deixis/extra skeleton with no leftover wording. An explainer
 * blacklist is not the gate. Ambiguity returns unavailable. Gemini
 * never fills a missing amount or target from chat text. Current Atlas
 * state and Forecast remain the only financial authorities. A
 * hypothetical or comparison turn may keep the already-published
 * Forecast as-of / freshness so a later Why? can label that same
 * calculation. Those fields are provenance of a published result, not
 * household-financial evidence and not a later packet substitute.
 *
 * Campaign-style verified follow-ups ("what about next payday?",
 * "what about that card?", "how much interest was that again?") resolve
 * only against ephemeral structured refs from a prior verified
 * presentation — allowlisted packet paths and published result keys,
 * never conversation prose. The server re-reads this request's packet
 * or recomputes Forecast on the stored hyp inputs. Ambiguous deixis
 * is unavailable. No durable household fact store.
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
const ASOF_MAX = 40;
const FRESHNESS_TAGS = Object.freeze({
  unavailable: true,
  unknown: true,
  'dated-opening': true,
  planned: true,
  estimated: true,
  'posted-only': true,
  calculated: true,
  'owner-stated': true,
  'canonical-opening': true,
  precise: true,
  confirmed: true,
  live: true,
});
const FOLLOWUP_DEIXIS_RE = /\b(?:what about|how about|and(?:\s+what)?|instead|also|same(?:\s+amount)?|that)\b/i;
const EXTRA_LANGUAGE_RE = /\b(?:extra|put(?:ting)?|toward|towards|instead)\b/i;
const COMPARISON_FOLLOWUP_RE = /\b(?:compare(?:d)?|versus|vs\.?|against)\b/i;
/* Authorized inheritance grammar is a positive skeleton: deixis / extra-
 * application words plus structural glue. After masking recovered amounts
 * and named debts, any leftover word fails closed. Payment, minimum,
 * utilization, and other debt-explainer nouns are not in this set.
 */
const FOLLOWUP_INTENT_RE = /\b(?:what about|how about|and(?:\s+what)?|instead|also|same(?:\s+amount)?|that|extra|put(?:ting)?|toward|towards)\b/i;
const AUTHORIZED_FOLLOWUP_WORDS = new Set([
  'what', 'about', 'how', 'and', 'instead', 'also', 'same', 'amount',
  'that', 'extra', 'put', 'putting', 'toward', 'towards',
  'the', 'a', 'an', 'on', 'to', 'of', 'for', 'with', 'my', 'our',
]);
const FOLLOWUP_REFERENT_KEYS = Object.freeze({
  'next-payday': true,
  'pay-period': true,
  'interest': true,
  'card': true,
  'last-presented': true,
});
const FOLLOWUP_KEY_PATHS = Object.freeze({
  'next-payday': Object.freeze([
    'forecast.currentPeriodAction.nextPayday',
  ]),
  'pay-period': Object.freeze([
    'forecast.currentPeriodAction.essentialRemaining',
    'forecast.currentPeriodAction.weeklyCap',
    'forecast.currentPeriodAction.periodStart',
    'forecast.currentPeriodAction.periodEnd',
    'forecast.currentPeriodAction.nextPayday',
    'forecast.currentPeriodAction.remainingClaim',
  ]),
  'interest': Object.freeze([
    'current.debts.monthlyInterest',
  ]),
});
const FACILITY_REF_RE = /^current\.debts\.facilities\[(\d{1,3})\]\.(?:available|label)$/;
const NEXT_PAYDAY_FOLLOWUP_RE = /^(?:ok[,.]?\s+|and\s+|so\s+|then\s+)?(?:what about|how about)(?:\s+the)?\s+next\s+payday\??$/i;
const THAT_CARD_FOLLOWUP_RE = /^(?:ok[,.]?\s+|and\s+|so\s+|then\s+)?(?:what about|how about)\s+(?:that|this|the)\s+card\??$/i;
const INTEREST_AGAIN_RE = /^(?:ok[,.]?\s+|and\s+|so\s+|then\s+)?(?:how much interest (?:was|is) that(?: again)?|(?:what(?:'s| is)|whats) (?:the )?interest (?:again|on that)|interest again)\??$/i;
const BARE_THAT_FOLLOWUP_RE = /^(?:ok[,.]?\s+|and\s+|so\s+|then\s+)?(?:what about|how about)\s+that\??$/i;

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

const REFERENT_PATH_RE = /^(?:[A-Za-z][A-Za-z0-9_]*)(?:\.[A-Za-z][A-Za-z0-9_]*|\[\d{1,3}\]){0,7}$/;
const FORBIDDEN_REFERENT_PATH_RE = /(?:^|[.\[]|])(?:__proto__|constructor|prototype)(?:$|[.\]])/;

function sanitizeReferentPaths(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = Object.create(null);
  for (const path of raw) {
    if (typeof path !== 'string' || path.length === 0 || path.length > 120) continue;
    if (!REFERENT_PATH_RE.test(path) || FORBIDDEN_REFERENT_PATH_RE.test(path)) continue;
    if (seen[path]) continue;
    seen[path] = true;
    out.push(path);
    if (out.length >= 8) break;
  }
  return out;
}

function sanitizeReferentKeys(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = Object.create(null);
  for (const key of raw) {
    if (typeof key !== 'string' || !FOLLOWUP_REFERENT_KEYS[key] || seen[key]) continue;
    seen[key] = true;
    out.push(key);
    if (out.length >= 8) break;
  }
  return out;
}

function bindReferentKeysFromPaths(paths) {
  const keys = [];
  const seen = Object.create(null);
  const facilityIndexes = [];
  if (!Array.isArray(paths)) return { keys, facilityIndexes };
  for (const path of paths) {
    if (typeof path !== 'string') continue;
    for (const key of Object.keys(FOLLOWUP_KEY_PATHS)) {
      if (!seen[key] && FOLLOWUP_KEY_PATHS[key].includes(path)) {
        seen[key] = true;
        keys.push(key);
      }
    }
    const facility = FACILITY_REF_RE.exec(path);
    if (facility) {
      const index = Number(facility[1]);
      if (!facilityIndexes.includes(index)) facilityIndexes.push(index);
    }
  }
  if (facilityIndexes.length === 1 && !seen.card) {
    seen.card = true;
    keys.push('card');
  }
  return { keys, facilityIndexes };
}

function referentKeysOn(prior) {
  const stored = sanitizeReferentKeys(prior && prior.referentKeys);
  const derived = bindReferentKeysFromPaths(prior && prior.referentPaths);
  const out = stored.slice();
  const seen = Object.create(null);
  for (const key of stored) seen[key] = true;
  for (const key of derived.keys) {
    if (seen[key]) continue;
    seen[key] = true;
    out.push(key);
  }
  return out;
}

function priorHasReferentKey(prior, key) {
  return referentKeysOn(prior).includes(key);
}

function facilityIndexForDebt(packet, debtId, debtLabel) {
  const facilities = packet
    && packet.current
    && packet.current.debts
    && packet.current.debts.facilities;
  if (!Array.isArray(facilities)) return null;
  const matches = [];
  for (let i = 0; i < facilities.length; i += 1) {
    const row = facilities[i];
    if (!row || typeof row !== 'object') continue;
    if ((debtId && row.id === debtId) || (debtLabel && row.label === debtLabel)) {
      matches.push(i);
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function uniqueFacilityFollowup(prior, packet) {
  const bound = bindReferentKeysFromPaths(prior && prior.referentPaths);
  if (bound.facilityIndexes.length === 1) {
    const index = bound.facilityIndexes[0];
    return {
      ok: true,
      paths: [
        `current.debts.facilities[${index}].label`,
        `current.debts.facilities[${index}].available`,
      ],
    };
  }
  if (bound.facilityIndexes.length > 1) {
    return { ok: false, ambiguous: true };
  }
  const debtId = prior && typeof prior.debtId === 'string' ? prior.debtId : '';
  const debtLabel = prior && typeof prior.debtLabel === 'string' ? prior.debtLabel : '';
  const hypLike = prior && (
    prior.kind === 'hypothetical'
    || prior.priorKind === 'hypothetical'
  );
  if (hypLike && (debtId || debtLabel)) {
    const index = facilityIndexForDebt(packet, debtId, debtLabel);
    if (index != null) {
      return {
        ok: true,
        paths: [
          `current.debts.facilities[${index}].label`,
          `current.debts.facilities[${index}].available`,
        ],
      };
    }
  }
  return { ok: false, ambiguous: false };
}

function classifyVerifiedFollowup(question) {
  if (typeof question !== 'string' || !question.trim()) return null;
  const parsed = question.trim().replace(/\s+/g, ' ');
  if (NEXT_PAYDAY_FOLLOWUP_RE.test(parsed)) return 'next-payday';
  if (THAT_CARD_FOLLOWUP_RE.test(parsed)) return 'card';
  if (INTEREST_AGAIN_RE.test(parsed)) return 'interest';
  if (BARE_THAT_FOLLOWUP_RE.test(parsed)) return 'last-presented';
  return null;
}

function resolveVerifiedReference({ question, priorTurn, packet }) {
  const kind = classifyVerifiedFollowup(question);
  if (!kind) return { status: 'none' };
  const prior = priorTurn && typeof priorTurn === 'object' ? priorTurn : null;

  if (kind === 'next-payday') {
    if (priorHasReferentKey(prior, 'next-payday') || priorHasReferentKey(prior, 'pay-period')) {
      return {
        status: 'resolved-reference',
        paths: FOLLOWUP_KEY_PATHS['next-payday'].slice(),
        referentKey: 'next-payday',
      };
    }
    return { status: 'ambiguous', nature: 'reference' };
  }

  if (kind === 'card') {
    const facility = uniqueFacilityFollowup(prior, packet);
    if (facility.ok) {
      return {
        status: 'resolved-reference',
        paths: facility.paths,
        referentKey: 'card',
      };
    }
    return { status: 'ambiguous', nature: 'reference' };
  }

  if (kind === 'interest') {
    if (prior && (prior.kind === 'comparison' || prior.priorKind === 'comparison')) {
      return { status: 'ambiguous', nature: 'reference' };
    }
    if (prior && finiteAmount(prior.amount)
        && typeof prior.debtId === 'string' && prior.debtId
        && typeof prior.debtLabel === 'string' && prior.debtLabel
        && (prior.kind === 'hypothetical' || prior.priorKind === 'hypothetical')) {
      return {
        status: 'resolved-hypothetical',
        amount: prior.amount,
        debtId: prior.debtId,
        debtLabel: prior.debtLabel,
      };
    }
    if (priorHasReferentKey(prior, 'interest')) {
      return {
        status: 'resolved-reference',
        paths: FOLLOWUP_KEY_PATHS.interest.slice(),
        referentKey: 'interest',
      };
    }
    return { status: 'ambiguous', nature: 'reference' };
  }

  const paths = sanitizeReferentPaths(prior && prior.referentPaths);
  if (paths.length) {
    return {
      status: 'resolved-reference',
      paths,
      referentKey: 'last-presented',
    };
  }
  return { status: 'ambiguous', nature: 'reference' };
}

function sanitizeAsOf(value) {
  if (typeof value !== 'string' || !value || value.length > ASOF_MAX) return '';
  if (/[\\/]/.test(value) || /\.env\b|raw|derived|secret/i.test(value)) return '';
  return value;
}

function sanitizeFreshness(value) {
  if (typeof value !== 'string' || !value) return '';
  if (value === 'verified' || value === 'current') return '';
  return FRESHNESS_TAGS[value] ? value : '';
}

function attachTurnProvenance(turn, raw) {
  const asOf = sanitizeAsOf(raw && raw.asOf);
  if (asOf) turn.asOf = asOf;
  const freshness = sanitizeFreshness(raw && raw.freshness);
  if (freshness) turn.freshness = freshness;
  return turn;
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
      && kind !== 'unavailable' && kind !== 'why') {
    return null;
  }
  const question = clipText(raw.question, QUESTION_MAX);
  if (!question) return null;
  const turn = {
    kind,
    question,
    presented: clipText(raw.presented, PRESENTED_MAX),
  };
  const referentPaths = sanitizeReferentPaths(raw.referentPaths);
  if (referentPaths.length) turn.referentPaths = referentPaths;
  const referentKeys = sanitizeReferentKeys(
    (Array.isArray(raw.referentKeys) ? raw.referentKeys : [])
      .concat(bindReferentKeysFromPaths(referentPaths).keys)
  );
  if (referentKeys.length) turn.referentKeys = referentKeys;
  if (kind === 'why' && (raw.priorKind === 'hypothetical' || raw.priorKind === 'comparison')) {
    turn.priorKind = raw.priorKind;
  }
  if (kind === 'hypothetical' || (kind === 'why' && raw.priorKind === 'hypothetical')) {
    if (!finiteAmount(raw.amount)) return null;
    const debtId = clipText(raw.debtId, LABEL_MAX);
    const debtLabel = clipText(raw.debtLabel, LABEL_MAX);
    if (!debtId || !debtLabel) return null;
    turn.amount = raw.amount;
    turn.debtId = debtId;
    turn.debtLabel = debtLabel;
  }
  if (kind === 'comparison' || (kind === 'why' && raw.priorKind === 'comparison')) {
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
  return attachTurnProvenance(turn, raw);
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

function maskSpans(text, spans) {
  if (!Array.isArray(spans) || !spans.length) return text;
  const chars = String(text).split('');
  for (const span of spans) {
    const start = span && Number.isFinite(span.start) ? span.start : -1;
    const end = span && Number.isFinite(span.end) ? span.end : -1;
    if (start < 0 || end <= start) continue;
    for (let i = start; i < end && i < chars.length; i += 1) {
      chars[i] = ' ';
    }
  }
  return chars.join('');
}

function authorizedFollowupGrammar(question, debts, packet) {
  if (typeof question !== 'string' || !question.trim()) return false;
  if (!FOLLOWUP_INTENT_RE.test(question)) return false;
  const spans = TalkHypothetical.recoverCallerAmountOccurrences(question)
    .concat(TalkHypothetical.recoverCallerDebtTargetOccurrences(question, debts, packet));
  const words = maskSpans(question, spans).toLowerCase().match(/[a-z0-9]+/g) || [];
  return words.every(word => AUTHORIZED_FOLLOWUP_WORDS.has(word));
}

function looksLikeIncompleteExtra(question, amountCount, targetCount, debts, packet) {
  if (!incompleteExtraShape(amountCount, targetCount)) return false;
  if (!authorizedFollowupGrammar(question, debts, packet)) return false;
  if (amountCount === 1 && targetCount === 0) {
    return FOLLOWUP_DEIXIS_RE.test(question) || EXTRA_LANGUAGE_RE.test(question);
  }
  return EXTRA_LANGUAGE_RE.test(question);
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
  const authorizedFollowup = authorizedFollowupGrammar(parsed, debts, packet);

  if (recoveredPairs.ok) {
    return { status: 'none' };
  }
  if (completeSingle && !compareAsk) {
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

  if (compareAsk) {
    return { status: 'ambiguous', nature: 'comparison' };
  }

  if (amounts.length === 1 && targets.length === 0
      && authorizedFollowup
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
      && authorizedFollowup && !compareAsk
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

  if (looksLikeIncompleteExtra(parsed, amounts.length, targets.length, debts, packet)) {
    return { status: 'ambiguous', nature: 'hypothetical' };
  }

  if (wantsPreference && (!prior || prior.kind !== 'comparison')) {
    return { status: 'ambiguous', nature: 'comparison' };
  }

  const verified = resolveVerifiedReference({
    question: parsed,
    priorTurn: prior,
    packet,
  });
  if (verified.status !== 'none') return verified;

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

function sessionTurnFromHypothetical(result, provenance) {
  if (!result || result.status !== 'ready' || !result.input) {
    return { kind: 'unavailable' };
  }
  const amount = result.input.amount;
  const debtId = clipText(result.input.debtId, LABEL_MAX);
  const debtLabel = clipText(result.input.debtLabel, LABEL_MAX);
  if (!finiteAmount(amount) || !debtId || !debtLabel) return { kind: 'unavailable' };
  const fromResult = result.input && result.input.asOf;
  return attachTurnProvenance({
    kind: 'hypothetical',
    amount,
    debtId,
    debtLabel,
    referentKeys: ['interest'],
  }, {
    asOf: (provenance && provenance.asOf) || fromResult,
    freshness: provenance && provenance.freshness,
  });
}

function sessionTurnFromComparison(result, provenance) {
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
  const fromResult = result.baseline && result.baseline.asOf;
  return attachTurnProvenance({ kind: 'comparison', scenarios }, {
    asOf: (provenance && provenance.asOf) || fromResult,
    freshness: provenance && provenance.freshness,
  });
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
  resolveVerifiedReference,
  bindReferentKeysFromPaths,
  classifyVerifiedFollowup,
  FOLLOWUP_REFERENT_KEYS,
  FOLLOWUP_KEY_PATHS,
  publicConversation,
  lastTurn,
  sessionTurnFromHypothetical,
  sessionTurnFromComparison,
  hmacKey,
};
