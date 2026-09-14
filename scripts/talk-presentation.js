'use strict';
/* Talk answer presentation — Atlas-owned wording for verified packet claims.
 *
 * Slice 4 sits after Slice 3 verification. Gemini still returns only
 * extractive path/equals claims. The server still rejects any claim that
 * does not match this request's packet. This module then maps those
 * already-verified claims through deterministic templates. It does not
 * call Forecast, does not compute leftover or remaining, and does not
 * invent a second financial schema.
 *
 * Unknown paths stay conservative: path-is-value wording, no human
 * meaning, no Forecast/Bills/Credit/Planning provenance, no nav action.
 * Null on a known money path is unavailable, never $0.
 * Trust tags are copied from the packet; estimated is never confirmed,
 * stale is never current, dated-opening spendable cash is never current
 * spendable cash, unavailable is never a number.
 */

const UNAVAILABLE_ANSWER = 'That is not available in this request\'s packet.';

const ALLOWED_ACTIONS = Object.freeze({
  budget: Object.freeze({ href: '/', label: 'View Budget' }),
  bills: Object.freeze({ href: '/bills.html', label: 'View Bills' }),
  credit: Object.freeze({ href: '/credit.html', label: 'View Credit' }),
  planning: Object.freeze({ href: '/planning.html', label: 'View Planning' }),
});

const ALLOWED_ACTION_HREFS = Object.freeze(['/', '/bills.html', '/credit.html', '/planning.html']);
const ALLOWED_SOURCES = Object.freeze(['Forecast', 'Bills', 'Credit', 'Planning']);

function isPrimitive(value) {
  if (value === null) return true;
  if (typeof value === 'string') return true;
  if (typeof value === 'boolean') return true;
  return typeof value === 'number' && Number.isFinite(value);
}

function formatClaimValue(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function formatCurrency(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const n = Number(value);
  const abs = Math.abs(n).toLocaleString('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (n < 0 ? '−$' : '$') + abs;
}

function packetGet(packet, path) {
  if (!packet || typeof packet !== 'object' || typeof path !== 'string') return undefined;
  const parts = path.split('.');
  let current = packet;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

function remainingClaimTrust(packet) {
  const claim = packetGet(packet, 'forecast.currentPeriodAction.remainingClaim');
  if (claim === 'precise' || claim === 'posted-only' || claim === 'unavailable') return claim;
  return null;
}

function spendableOpeningState(packet) {
  return {
    status: packetGet(packet, 'current.spendableHouseholdCash.status'),
    current: packetGet(packet, 'current.spendableHouseholdCash.current'),
  };
}

function spendableIsNonCurrentOpening(packet) {
  const opening = spendableOpeningState(packet);
  return opening.status === 'dated-opening' || opening.current === false;
}

function spendableTrust(packet) {
  if (spendableIsNonCurrentOpening(packet)) {
    const status = spendableOpeningState(packet).status;
    return status === 'dated-opening' ? 'dated-opening' : 'unavailable';
  }
  const trust = packetGet(packet, 'current.spendableHouseholdCash.trust');
  return typeof trust === 'string' && trust ? trust : null;
}

function presentSpendableHouseholdCash(value, packet) {
  if (spendableIsNonCurrentOpening(packet)) {
    const formatted = formatCurrency(value);
    if (!formatted) {
      return {
        text: 'Spendable household cash is unavailable. This is a dated, non-current opening.',
        trust: 'unavailable',
      };
    }
    return {
      text: `Dated opening cash is ${formatted}. This is not current spendable household cash.`,
      trust: 'dated-opening',
    };
  }
  return moneySentence({
    available: money => `Spendable household cash is ${money}.`,
    unavailable: 'Spendable household cash is unavailable.',
  }, value);
}

function obligationConfidence(packet, field) {
  const tag = packetGet(packet, `current.nextSignificantObligations.${field}.confidence`);
  if (tag === 'confirmed' || tag === 'estimated' || tag === 'planned' || tag === 'unknown') {
    return tag;
  }
  return null;
}

function moneySentence(template, value) {
  const formatted = formatCurrency(value);
  if (!formatted) {
    return { text: template.unavailable, trust: 'unavailable' };
  }
  return { text: template.available(formatted) };
}

const PATH_RULES = [
  {
    path: 'forecast.currentPeriodAction.essentialRemaining',
    source: 'Forecast',
    action: 'budget',
    trust: remainingClaimTrust,
    present(value) {
      return moneySentence({
        available: money => `You have ${money} remaining in the current pay period.`,
        unavailable: 'Current pay-period remaining is unavailable.',
      }, value);
    },
  },
  {
    path: 'forecast.currentPeriodAction.weeklyCap',
    source: 'Forecast',
    action: 'budget',
    present(value) {
      return moneySentence({
        available: money => `The current weekly spending cap is ${money}.`,
        unavailable: 'The current weekly spending cap is unavailable.',
      }, value);
    },
  },
  {
    path: 'forecast.recommendation.weekly',
    source: 'Forecast',
    action: 'budget',
    present(value) {
      return moneySentence({
        available: money => `The Forecast weekly amount is ${money}.`,
        unavailable: 'The Forecast weekly amount is unavailable.',
      }, value);
    },
  },
  {
    path: 'forecast.budgetCap.weekly',
    source: 'Forecast',
    action: 'budget',
    present(value) {
      return moneySentence({
        available: money => `The budget weekly cap is ${money}.`,
        unavailable: 'The budget weekly cap is unavailable.',
      }, value);
    },
  },
  {
    path: 'current.spendableHouseholdCash.value',
    source: 'Forecast',
    action: 'budget',
    trust: spendableTrust,
    present: presentSpendableHouseholdCash,
  },
  {
    path: 'current.pending.totalKnownPending',
    source: 'Credit',
    action: 'credit',
    present(value) {
      return moneySentence({
        available: money => `Known pending charges total ${money}.`,
        unavailable: 'Known pending charges are unavailable.',
      }, value);
    },
  },
  {
    path: 'current.debts.totalAvailableCredit',
    source: 'Credit',
    action: 'credit',
    present(value) {
      return moneySentence({
        available: money => `Total available credit is ${money}.`,
        unavailable: 'Total available credit is unavailable.',
      }, value);
    },
  },
  {
    path: 'current.nextSignificantObligations.nextDue.amount',
    source: 'Bills',
    action: 'bills',
    trust: packet => obligationConfidence(packet, 'nextDue'),
    present(value) {
      return moneySentence({
        available: money => `The next due amount is ${money}.`,
        unavailable: 'The next due amount is unavailable.',
      }, value);
    },
  },
  {
    path: 'current.nextSignificantObligations.nextDue.label',
    source: 'Bills',
    action: 'bills',
    trust: packet => obligationConfidence(packet, 'nextDue'),
    present(value) {
      if (typeof value !== 'string' || !value) {
        return { text: 'The next due label is unavailable.', trust: 'unavailable' };
      }
      return { text: `The next due item is ${value}.` };
    },
  },
  {
    path: 'current.nextSignificantObligations.nextDue.date',
    source: 'Bills',
    action: 'bills',
    trust: packet => obligationConfidence(packet, 'nextDue'),
    present(value) {
      if (typeof value !== 'string' || !value) {
        return { text: 'The next due date is unavailable.', trust: 'unavailable' };
      }
      return { text: `The next due date is ${value}.` };
    },
  },
  {
    path: 'forecast.currentPeriodAction.remainingClaim',
    source: 'Forecast',
    action: 'budget',
    present(value) {
      if (value === 'precise' || value === 'posted-only' || value === 'unavailable') {
        return { text: `Current-period remaining is marked ${value}.`, trust: value };
      }
      return { text: 'Current-period remaining status is unavailable.', trust: 'unavailable' };
    },
  },
  {
    path: 'forecast.currentPeriodAction.periodStart',
    source: 'Forecast',
    action: 'budget',
    present(value) {
      if (typeof value !== 'string' || !value) {
        return { text: 'The current pay-period start is unavailable.', trust: 'unavailable' };
      }
      return { text: `The current pay period starts on ${value}.` };
    },
  },
  {
    path: 'forecast.currentPeriodAction.periodEnd',
    source: 'Forecast',
    action: 'budget',
    present(value) {
      if (typeof value !== 'string' || !value) {
        return { text: 'The current pay-period end is unavailable.', trust: 'unavailable' };
      }
      return { text: `The current pay period ends on ${value}.` };
    },
  },
  {
    path: 'metadata.effectiveAsOf',
    source: null,
    action: null,
    present(value) {
      if (typeof value !== 'string' || !value) {
        return { text: 'The packet as-of date is unavailable.', trust: 'unavailable' };
      }
      return { text: `This picture is as of ${value}.` };
    },
  },
  {
    path: 'metadata.freshness.confidence',
    source: null,
    action: null,
    present(value) {
      if (typeof value !== 'string' || !value) {
        return { text: 'Packet freshness is unavailable.', trust: 'unavailable' };
      }
      return { text: `Packet freshness is ${value}.`, trust: value };
    },
  },
];

const PATH_RULE_INDEX = new Map(PATH_RULES.map(rule => [rule.path, rule]));

const CATEGORY_REMAINING_RE = /^actuals\.currentPeriodCategories\[\d{1,3}\]\.remaining$/;
const COMMITMENT_REMAINING_RE = /^forecast\.upcomingModeledCommitments\.items\[\d{1,3}\]\.remaining$/;

function genericRuleFor(path) {
  if (CATEGORY_REMAINING_RE.test(path)) {
    return {
      source: 'Forecast',
      action: 'budget',
      trust: remainingClaimTrust,
      present(value) {
        return moneySentence({
          available: money => `A current-period category remaining is ${money}.`,
          unavailable: 'A current-period category remaining is unavailable.',
        }, value);
      },
    };
  }
  if (COMMITMENT_REMAINING_RE.test(path)) {
    return {
      source: 'Planning',
      action: 'planning',
      present(value) {
        return moneySentence({
          available: money => `A modeled commitment remaining is ${money}.`,
          unavailable: 'A modeled commitment remaining is unavailable.',
        }, value);
      },
    };
  }
  return null;
}

function ruleFor(path) {
  return PATH_RULE_INDEX.get(path) || genericRuleFor(path);
}

function genericSentence(claim) {
  return `This request's packet shows ${claim.path} is ${formatClaimValue(claim.value)}.`;
}

function assembleGenericAnswer(claims) {
  const parts = claims.map(claim => `${claim.path} is ${formatClaimValue(claim.value)}`);
  if (parts.length === 1) return `This request's packet shows ${parts[0]}.`;
  const last = parts.pop();
  return `This request's packet shows ${parts.join(', ')} and ${last}.`;
}

function presentClaim(claim, packet) {
  const rule = ruleFor(claim.path);
  if (!rule) {
    return {
      text: genericSentence(claim),
      source: null,
      trust: null,
      action: null,
      mapped: false,
    };
  }
  const presented = rule.present(claim.value, packet) || {};
  const trustFromRule = typeof rule.trust === 'function' ? rule.trust(packet) : null;
  const trust = presented.trust || trustFromRule || null;
  const action = rule.action && ALLOWED_ACTIONS[rule.action] ? ALLOWED_ACTIONS[rule.action] : null;
  const source = ALLOWED_SOURCES.includes(rule.source) ? rule.source : null;
  return {
    text: presented.text || genericSentence(claim),
    source,
    trust,
    action,
    mapped: true,
  };
}

function sharedValue(values) {
  const list = values.filter(value => value != null);
  if (!list.length) return null;
  const first = list[0];
  return list.every(value => {
    if (first && typeof first === 'object') {
      return value && value.href === first.href && value.label === first.label;
    }
    return value === first;
  }) ? first : null;
}

function weakestTrust(tags) {
  const rank = {
    unavailable: 0,
    unknown: 1,
    'dated-opening': 1,
    planned: 2,
    estimated: 3,
    'posted-only': 3,
    calculated: 4,
    'canonical-opening': 4,
    precise: 5,
    confirmed: 5,
    live: 5,
  };
  let weakest = null;
  let weakestRank = Infinity;
  for (const tag of tags) {
    if (typeof tag !== 'string' || !tag) continue;
    const score = Object.prototype.hasOwnProperty.call(rank, tag) ? rank[tag] : 1;
    if (score < weakestRank) {
      weakest = tag;
      weakestRank = score;
    }
  }
  return weakest;
}

function readAsOf(packet) {
  const effective = packetGet(packet, 'metadata.effectiveAsOf');
  if (typeof effective === 'string' && effective) return effective;
  const canonical = packetGet(packet, 'metadata.canonicalAsOf');
  return typeof canonical === 'string' && canonical ? canonical : null;
}

function readFreshness(packet) {
  const confidence = packetGet(packet, 'metadata.freshness.confidence');
  return typeof confidence === 'string' && confidence ? confidence : null;
}

function publicAction(action) {
  if (!action || typeof action !== 'object') return null;
  if (!ALLOWED_ACTION_HREFS.includes(action.href)) return null;
  if (typeof action.label !== 'string' || !action.label) return null;
  return { href: action.href, label: action.label };
}

function emptyPresentation(answer, extras) {
  extras = extras || {};
  return {
    answer,
    source: extras.source || null,
    trust: extras.trust || null,
    asOf: extras.asOf || null,
    freshness: extras.freshness || null,
    action: extras.action || null,
  };
}

function presentVerifiedClaims(published, packet) {
  if (!published || published.status === 'unavailable') {
    return emptyPresentation(UNAVAILABLE_ANSWER, {
      trust: 'unavailable',
      asOf: readAsOf(packet),
      freshness: readFreshness(packet),
    });
  }
  const claims = Array.isArray(published.claims) ? published.claims : [];
  if (!claims.length) {
    return emptyPresentation(UNAVAILABLE_ANSWER, {
      trust: 'unavailable',
      asOf: readAsOf(packet),
      freshness: readFreshness(packet),
    });
  }
  const presented = claims.map(claim => presentClaim(claim, packet));
  const mapped = presented.filter(row => row.mapped);
  const unmapped = presented.filter(row => !row.mapped);
  const answer = !mapped.length
    ? assembleGenericAnswer(claims)
    : presented.map((row, index) => (
      row.mapped ? row.text : genericSentence(claims[index])
    )).join(' ');
  const source = unmapped.length ? null : sharedValue(mapped.map(row => row.source));
  const action = unmapped.length ? null : publicAction(sharedValue(mapped.map(row => row.action)));
  return {
    answer,
    source,
    trust: weakestTrust(presented.map(row => row.trust)),
    asOf: readAsOf(packet),
    freshness: readFreshness(packet),
    action,
  };
}

function isAllowedActionHref(href) {
  return ALLOWED_ACTION_HREFS.includes(href);
}

module.exports = {
  UNAVAILABLE_ANSWER,
  ALLOWED_ACTIONS,
  ALLOWED_ACTION_HREFS,
  ALLOWED_SOURCES,
  formatCurrency,
  formatClaimValue,
  isPrimitive,
  ruleFor,
  presentVerifiedClaims,
  isAllowedActionHref,
};
