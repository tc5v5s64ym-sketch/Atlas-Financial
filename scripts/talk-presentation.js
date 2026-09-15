'use strict';
/* Talk answer presentation — Atlas-owned wording for verified packet claims.
 *
 * Slice 4 sits after Slice 3 verification. Gemini still returns only
 * extractive path/equals claims. The server still rejects any claim that
 * does not match this request's packet. This module then maps those
 * already-verified claims through deterministic templates. Slice 6B
 * also maps an already-computed Forecast hypothetical result into
 * wording; this file still does not call Forecast, does not compute
 * leftover or remaining, and does not invent a second financial schema.
 * Optional presentation.cards reprint those same trusted strings for
 * the Talk card surface. Cards do not add numbers. Household-facing
 * citations are assembled here from the same source / trust / as-of /
 * action fields. Gemini does not invent them.
 *
 * Unknown paths stay conservative: path-is-value wording, no human
 * meaning, no Forecast/Bills/Credit/Planning provenance, no nav action.
 * Null on a known money path is unavailable, never $0.
 * Trust tags are copied from the packet; estimated is never confirmed,
 * stale is never current, dated-opening spendable cash is never current
 * spendable cash, unavailable is never a number.
 */

const UNAVAILABLE_ANSWER = 'That is not available in this request\'s packet.';
const HYPOTHETICAL_UNAVAILABLE_ANSWER = 'That hypothetical extra payment is not available from Forecast';
const HYPOTHETICAL_COMPARISON_UNAVAILABLE_ANSWER = 'That hypothetical comparison is not available from Forecast';

const ALLOWED_ACTIONS = Object.freeze({
  budget: Object.freeze({ href: '/', label: 'View Budget' }),
  bills: Object.freeze({ href: '/bills.html', label: 'View Bills' }),
  credit: Object.freeze({ href: '/credit.html', label: 'View Credit' }),
  planning: Object.freeze({ href: '/planning.html', label: 'View Planning' }),
});

const ALLOWED_ACTION_HREFS = Object.freeze(['/', '/bills.html', '/credit.html', '/planning.html']);
const ALLOWED_SOURCES = Object.freeze(['Forecast', 'Bills', 'Credit', 'Planning']);
const SURFACE_LABELS = Object.freeze({
  '/': 'Budget',
  '/bills.html': 'Bills',
  '/credit.html': 'Credit',
  '/planning.html': 'Planning',
});
const CITATION_KINDS = Object.freeze({
  surface: true,
  provenance: true,
});
const CITATION_TRUST = Object.freeze({
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
const CARD_VERSION = 1;
const CARD_KINDS = Object.freeze({
  answer: true,
  option: true,
  result: true,
  judgment: true,
  provenance: true,
  action: true,
  note: true,
});

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

function facilityFromAvailablePath(path, packet) {
  const match = /^current\.debts\.facilities\[(\d{1,3})\]\.available$/.exec(path);
  if (!match) return null;
  const facilities = packetGet(packet, 'current.debts.facilities');
  if (!Array.isArray(facilities)) return null;
  const facility = facilities[Number(match[1])];
  if (!facility || typeof facility !== 'object' || Array.isArray(facility)) return null;
  return facility;
}

function facilityAvailableUnpublished(facility) {
  return !!(facility && (facility.pendingUnknown === true || facility.trust === 'unknown'));
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

function closedPolicySentence(value, allowed, sentence) {
  if (value !== allowed) {
    return { text: 'That owner policy label is unavailable.', trust: 'unavailable' };
  }
  return { text: sentence, trust: 'owner-stated' };
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
    path: 'current.debts.overLimitCount',
    source: 'Credit',
    action: 'credit',
    present(value) {
      if (!Number.isFinite(Number(value))) {
        return { text: 'Over-limit credit facilities are unavailable.', trust: 'unavailable' };
      }
      const count = Number(value);
      if (count === 0) return { text: 'No credit facilities are over the limit.' };
      if (count === 1) return { text: '1 credit facility is over the limit.' };
      return { text: `${count} credit facilities are over the limit.` };
    },
  },
  {
    path: 'current.debts.securedDebt',
    source: 'Credit',
    action: 'credit',
    present(value) {
      return moneySentence({
        available: money => `Secured debt totals ${money}.`,
        unavailable: 'Secured debt is unavailable.',
      }, value);
    },
  },
  {
    path: 'current.debts.monthlyInterest',
    source: 'Credit',
    action: 'credit',
    present(value) {
      return moneySentence({
        available: money => `Monthly interest is ${money}.`,
        unavailable: 'Monthly interest is unavailable.',
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
    path: 'current.nextSignificantObligations.nextDue.daysUntil',
    source: 'Bills',
    action: 'bills',
    trust: packet => obligationConfidence(packet, 'nextDue'),
    present(value) {
      if (!Number.isFinite(Number(value))) {
        return { text: 'The next due timing is unavailable.', trust: 'unavailable' };
      }
      const days = Number(value);
      if (days === 0) return { text: 'The next due item is due today.' };
      if (days === 1) return { text: 'The next due item is in 1 day.' };
      return { text: `The next due item is in ${days} days.` };
    },
  },
  {
    path: 'current.nextSignificantObligations.nextPaymentOut.amount',
    source: 'Bills',
    action: 'bills',
    trust: packet => obligationConfidence(packet, 'nextPaymentOut'),
    present(value) {
      return moneySentence({
        available: money => `The next payment out is ${money}.`,
        unavailable: 'The next payment out is unavailable.',
      }, value);
    },
  },
  {
    path: 'current.nextSignificantObligations.nextPaymentOut.label',
    source: 'Bills',
    action: 'bills',
    trust: packet => obligationConfidence(packet, 'nextPaymentOut'),
    present(value) {
      if (typeof value !== 'string' || !value) {
        return { text: 'The next payment-out label is unavailable.', trust: 'unavailable' };
      }
      return { text: `The next payment out is ${value}.` };
    },
  },
  {
    path: 'current.nextSignificantObligations.nextPaymentOut.date',
    source: 'Bills',
    action: 'bills',
    trust: packet => obligationConfidence(packet, 'nextPaymentOut'),
    present(value) {
      if (typeof value !== 'string' || !value) {
        return { text: 'The next payment-out date is unavailable.', trust: 'unavailable' };
      }
      return { text: `The next payment out is on ${value}.` };
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
    path: 'forecast.currentPeriodAction.nextPayday',
    source: 'Forecast',
    action: 'budget',
    present(value) {
      if (typeof value !== 'string' || !value) {
        return { text: 'The next payday is unavailable.', trust: 'unavailable' };
      }
      return { text: `The next payday is ${value}.` };
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
  {
    path: 'policy.decisionPosture.posture',
    source: null,
    action: null,
    present(value) {
      return closedPolicySentence(value, 'aggressive-not-brittle',
        'The household decision posture is aggressive, but not brittle.');
    },
  },
  {
    path: 'policy.decisionPosture.velocity',
    source: null,
    action: null,
    present(value) {
      return closedPolicySentence(value, 'fastest-to-goal',
        'Velocity means getting to the financial goal as fast as possible.');
    },
  },
  {
    path: 'policy.decisionPosture.resilience',
    source: null,
    action: null,
    present(value) {
      return closedPolicySentence(value, 'enough-cash-flexibility-for-real-life-and-known-commitments',
        'Resilience means enough cash and flexibility for real life and known commitments.');
    },
  },
  {
    path: 'policy.decisionPosture.breathingRoom',
    source: null,
    action: null,
    present(value) {
      return closedPolicySentence(value, 'sustainable-slack-not-waste-permission',
        'Breathing room is enough slack to stay sustainable and reduce immediate re-borrow risk. It is not waste permission, comfort-max, avoiding hard choices, or slowing without a demonstrated resilience reason.');
    },
  },
  {
    path: 'policy.decisionPosture.knownCommitments',
    source: null,
    action: null,
    present(value) {
      return closedPolicySentence(value, 'exert-gravity',
        'Known authorized future commitments exert gravity on household decisions.');
    },
  },
  {
    path: 'policy.decisionPosture.cheapestWhenBrittle',
    source: null,
    action: null,
    present(value) {
      return closedPolicySentence(value, 'not-best-household-decision',
        'Mathematically cheapest is not the best household decision when that cheapest path is unacceptably brittle.');
    },
  },
  {
    path: 'policy.decisionPosture.numericThreshold',
    source: null,
    action: null,
    present(value) {
      return closedPolicySentence(value, 'none',
        'There is no universal numeric breathing-room threshold.');
    },
  },
  {
    path: 'policy.decisionPosture.forecastApplication',
    source: null,
    action: null,
    present(value) {
      return closedPolicySentence(value, 'not-applied-this-slice',
        'Forecast does not apply this decision-posture row in this slice.');
    },
  },
  {
    path: 'policy.decisionPosture.provenance',
    source: null,
    action: null,
    present(value) {
      return closedPolicySentence(value, 'owner-stated',
        'This decision posture is owner-stated.');
    },
  },
  {
    path: 'policy.decisionPosture.provenanceDate',
    source: null,
    action: null,
    present(value) {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return { text: 'The decision-posture authorization date is unavailable.', trust: 'unavailable' };
      }
      return {
        text: `The owner authorized this decision posture on ${value}.`,
        trust: 'owner-stated',
      };
    },
  },
];

const PATH_RULE_INDEX = new Map(PATH_RULES.map(rule => [rule.path, rule]));

const CATEGORY_REMAINING_RE = /^actuals\.currentPeriodCategories\[\d{1,3}\]\.remaining$/;
const COMMITMENT_REMAINING_RE = /^forecast\.upcomingModeledCommitments\.items\[\d{1,3}\]\.remaining$/;
const FACILITY_AVAILABLE_RE = /^current\.debts\.facilities\[\d{1,3}\]\.available$/;
const FACILITY_LABEL_RE = /^current\.debts\.facilities\[\d{1,3}\]\.label$/;

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
  if (FACILITY_AVAILABLE_RE.test(path)) {
    return {
      source: 'Credit',
      action: 'credit',
      present(value, packet) {
        if (facilityAvailableUnpublished(facilityFromAvailablePath(path, packet))) {
          return {
            text: 'A credit facility available amount is unavailable.',
            trust: 'unknown',
          };
        }
        return moneySentence({
          available: money => `A credit facility has ${money} available.`,
          unavailable: 'A credit facility available amount is unavailable.',
        }, value);
      },
    };
  }
  if (FACILITY_LABEL_RE.test(path)) {
    return {
      source: 'Credit',
      action: 'credit',
      present(value) {
        if (typeof value !== 'string' || !value) {
          return { text: 'A credit facility label is unavailable.', trust: 'unavailable' };
        }
        return { text: `A credit facility is ${value}.` };
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
    'owner-stated': 4,
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

function provenanceText(fields) {
  const parts = [];
  if (ALLOWED_SOURCES.includes(fields.source)) parts.push(fields.source);
  if (typeof fields.asOf === 'string' && fields.asOf) {
    parts.push('as of ' + fields.asOf);
  }
  if (typeof fields.trust === 'string' && fields.trust) {
    parts.push(fields.trust);
  }
  if (typeof fields.freshness === 'string' && fields.freshness
      && fields.freshness !== fields.trust) {
    parts.push(fields.freshness);
  }
  return parts.length ? parts.join(' · ') : null;
}

function publicCitationTrust(trust) {
  if (typeof trust !== 'string' || !trust) return null;
  if (trust === 'verified' || trust === 'current') return null;
  return CITATION_TRUST[trust] ? trust : null;
}

function publicAsOf(value) {
  if (typeof value !== 'string' || !value || value.length > 40) return null;
  if (/[\\/]/.test(value) || /\.env\b|raw|derived|secret/i.test(value)) return null;
  return value;
}

function looksLikePrivateCitation(raw) {
  if (!raw || typeof raw !== 'object') return true;
  const blob = [raw.href, raw.label, raw.source, raw.asOf, raw.file, raw.url, raw.path]
    .filter(value => typeof value === 'string')
    .join('\n');
  return /(?:^|[\\/])(?:raw|derived)[\\/]|\.env\b|scripts[\\/]|public[\\/]forecast\.js|account[_\s-]?number|ATLAS_TALK|SESSION_SECRET|SITE_PASSWORD/i.test(blob);
}

function sanitizeCitations(citations) {
  if (!Array.isArray(citations) || !citations.length) return null;
  const items = [];
  for (const raw of citations) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (!CITATION_KINDS[raw.kind]) return null;
    if (raw.trust === 'verified' || raw.source === 'verified') return null;
    if (looksLikePrivateCitation(raw)) return null;
    if (raw.kind === 'surface') {
      const action = publicAction({ href: raw.href, label: raw.label });
      const source = ALLOWED_SOURCES.includes(raw.source) ? raw.source : null;
      const label = action ? SURFACE_LABELS[action.href] : null;
      if (!action || !source || !label || raw.label !== label) return null;
      items.push({
        kind: 'surface',
        source,
        href: action.href,
        label,
      });
      continue;
    }
    const source = ALLOWED_SOURCES.includes(raw.source) ? raw.source : null;
    const trust = publicCitationTrust(raw.trust);
    const asOf = publicAsOf(raw.asOf);
    const freshnessRaw = publicCitationTrust(raw.freshness);
    const freshness = freshnessRaw && freshnessRaw !== trust ? freshnessRaw : null;
    if (raw.trust != null && raw.trust !== '' && !trust) return null;
    if (raw.source != null && raw.source !== '' && !source) return null;
    if (raw.asOf != null && raw.asOf !== '' && !asOf) return null;
    const label = provenanceText({ source, asOf, trust, freshness });
    if (!label || (typeof raw.label === 'string' && raw.label && raw.label !== label)) {
      return null;
    }
    items.push({
      kind: 'provenance',
      source,
      asOf,
      trust,
      freshness,
      label,
    });
  }
  return items.length ? items : null;
}

function assembleCitations(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
  const source = ALLOWED_SOURCES.includes(fields.source) ? fields.source : null;
  const action = publicAction(fields.action);
  const trust = publicCitationTrust(fields.trust);
  const asOf = publicAsOf(fields.asOf);
  const freshnessRaw = publicCitationTrust(fields.freshness);
  const freshness = freshnessRaw && freshnessRaw !== trust ? freshnessRaw : null;
  const items = [];
  if (source && action) {
    const label = SURFACE_LABELS[action.href];
    if (label) {
      items.push({
        kind: 'surface',
        source,
        href: action.href,
        label,
      });
    }
  }
  if (!source && trust === 'unavailable') {
    return sanitizeCitations(items);
  }
  const label = provenanceText({ source, asOf, trust, freshness });
  if (label) {
    items.push({
      kind: 'provenance',
      source,
      asOf,
      trust,
      freshness,
      label,
    });
  }
  return sanitizeCitations(items);
}

function assembleClaimCitations(rows, fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
  if (!Array.isArray(rows) || !rows.length) return assembleCitations(fields);
  if (rows.some(row => !row || !row.mapped)) return assembleCitations(fields);

  const items = [];
  const seenSurface = Object.create(null);
  const groups = [];
  const groupIndex = Object.create(null);
  for (const row of rows) {
    const source = ALLOWED_SOURCES.includes(row.source) ? row.source : null;
    if (!source) continue;
    const action = publicAction(row.action);
    if (action) {
      const surfaceKey = source + '\0' + action.href;
      if (!seenSurface[surfaceKey]) {
        const label = SURFACE_LABELS[action.href];
        if (label) {
          seenSurface[surfaceKey] = true;
          items.push({
            kind: 'surface',
            source,
            href: action.href,
            label,
          });
        }
      }
    }
    if (groupIndex[source] == null) {
      groupIndex[source] = groups.length;
      groups.push({ source, rows: [row] });
    } else {
      groups[groupIndex[source]].rows.push(row);
    }
  }

  const asOf = publicAsOf(fields.asOf);
  const freshnessRaw = publicCitationTrust(fields.freshness);
  for (const group of groups) {
    const trust = publicCitationTrust(weakestTrust(group.rows.map(row => row.trust)));
    const freshness = freshnessRaw && freshnessRaw !== trust ? freshnessRaw : null;
    const label = provenanceText({
      source: group.source,
      asOf,
      trust,
      freshness,
    });
    if (label) {
      items.push({
        kind: 'provenance',
        source: group.source,
        asOf,
        trust,
        freshness,
        label,
      });
    }
  }
  return sanitizeCitations(items) || assembleCitations(fields);
}

function sanitizePresentationCards(cards) {
  if (!cards || typeof cards !== 'object' || Array.isArray(cards)) return null;
  if (cards.version !== CARD_VERSION) return null;
  if (!Array.isArray(cards.items) || !cards.items.length) return null;
  const items = [];
  for (const raw of cards.items) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (!CARD_KINDS[raw.kind]) return null;
    if (typeof raw.title !== 'string' || !raw.title) return null;
    if (typeof raw.body !== 'string' || !raw.body) return null;
    if (raw.kind === 'action') {
      const action = publicAction({ href: raw.href, label: raw.label || raw.body });
      if (!action) return null;
      items.push({
        kind: 'action',
        title: raw.title,
        body: action.label,
        href: action.href,
        label: action.label,
      });
      continue;
    }
    items.push({
      kind: raw.kind,
      title: raw.title,
      body: raw.body,
    });
  }
  return items.length ? { version: CARD_VERSION, items } : null;
}

function trailingMetaCards(presentation) {
  const items = [];
  const provenance = provenanceText(presentation);
  if (provenance) {
    items.push({ kind: 'provenance', title: 'Source', body: provenance });
  }
  const action = publicAction(presentation.action);
  if (action) {
    items.push({
      kind: 'action',
      title: 'Open',
      body: action.label,
      href: action.href,
      label: action.label,
    });
  }
  return items;
}

function finishPresentation(presentation, extras) {
  const leading = extras && Array.isArray(extras.items) ? extras.items : [];
  presentation.cards = sanitizePresentationCards({
    version: CARD_VERSION,
    items: leading.concat(trailingMetaCards(presentation)),
  });
  const claimRows = extras && extras.claimRows;
  presentation.citations = Array.isArray(claimRows)
    ? assembleClaimCitations(claimRows, presentation)
    : assembleCitations(presentation);
  return presentation;
}

function emptyPresentation(answer, extras) {
  extras = extras || {};
  return finishPresentation({
    answer,
    source: extras.source || null,
    trust: extras.trust || null,
    asOf: extras.asOf || null,
    freshness: extras.freshness || null,
    action: extras.action || null,
  }, {
    items: [{ kind: 'answer', title: 'Answer', body: answer }],
  });
}

function hypotheticalConsequenceSentences(result) {
  const sentences = [];
  const absorbed = result && result.absorbed;
  if (absorbed && Number.isFinite(Number(absorbed.amount))) {
    const applied = formatCurrency(absorbed.amount);
    if (applied) {
      let line = `Forecast absorbs ${applied} on that date.`;
      if (Number.isFinite(Number(absorbed.unabsorbed)) && Number(absorbed.unabsorbed) > 0) {
        const leftover = formatCurrency(absorbed.unabsorbed);
        if (leftover) line += ` ${leftover} is not absorbed.`;
      }
      sentences.push(line);
    }
  }
  const dDebt = result && result.delta && result.delta.debt;
  const sDebt = result && result.scenario && result.scenario.debt;
  const bDebt = result && result.baseline && result.baseline.debt;
  if (dDebt && Number.isFinite(Number(dDebt.ending))
      && sDebt && Number.isFinite(Number(sDebt.ending))
      && bDebt && Number.isFinite(Number(bDebt.ending))) {
    const delta = formatCurrency(dDebt.ending);
    const ending = formatCurrency(sDebt.ending);
    const prior = formatCurrency(bDebt.ending);
    if (delta && ending && prior) {
      sentences.push(
        `Named-debt ending balance changes by ${delta} over the Forecast window, to ${ending} from ${prior}.`
      );
    }
  }
  if (dDebt && Number.isFinite(Number(dDebt.interest))) {
    const interest = formatCurrency(dDebt.interest);
    if (interest) {
      sentences.push(`Interest over the Forecast window changes by ${interest}.`);
    }
  }
  if (dDebt && Number.isFinite(Number(dDebt.paid))) {
    const paid = formatCurrency(dDebt.paid);
    if (paid) {
      sentences.push(`Named-debt paid over the Forecast window changes by ${paid}.`);
    }
  }
  if (dDebt && Number.isFinite(Number(dDebt.availableCredit))) {
    const credit = formatCurrency(dDebt.availableCredit);
    if (credit) {
      sentences.push(
        `Available credit changes by ${credit}. Available credit is not cash.`
      );
    }
  }
  const dCash = result && result.delta && result.delta.cash;
  if (dCash && Number.isFinite(Number(dCash.ending))) {
    const cash = formatCurrency(dCash.ending);
    if (cash) {
      sentences.push(
        `Household cash ending changes by ${cash}. This extra amount is not available cash or safe-to-spend.`
      );
    }
  }
  if (dCash && Number.isFinite(Number(dCash.min))) {
    const min = formatCurrency(dCash.min);
    if (min) {
      sentences.push(`The Forecast-window cash minimum changes by ${min}.`);
    }
  }
  if (dCash && Number.isFinite(Number(dCash.extra))) {
    const extra = formatCurrency(dCash.extra);
    if (extra) {
      sentences.push(`Forecast extra-cash totals change by ${extra}.`);
    }
  }
  if (result && result.delta && result.delta.payoff
      && result.delta.payoff.clearedWithinWindow === true) {
    sentences.push('Forecast says the named debt would clear within the current window.');
  }
  return sentences;
}

function presentHypotheticalExtra(result, packet) {
  const asOf = (result && result.input && result.input.asOf) || readAsOf(packet);
  const freshness = readFreshness(packet);
  if (!result || result.status !== 'ready') {
    return emptyPresentation(HYPOTHETICAL_UNAVAILABLE_ANSWER, {
      source: 'Forecast',
      trust: 'unavailable',
      asOf,
      freshness,
    });
  }
  const amountText = formatCurrency(result.input && result.input.amount);
  const label = result.input && typeof result.input.debtLabel === 'string'
    ? result.input.debtLabel
    : '';
  const day = result.input && result.input.asOf;
  if (!amountText || !label || typeof day !== 'string' || !day) {
    return emptyPresentation(HYPOTHETICAL_UNAVAILABLE_ANSWER, {
      source: 'Forecast',
      trust: 'unavailable',
      asOf,
      freshness,
    });
  }
  const lead = `If you put ${amountText} on ${label} as a hypothetical extra on ${day}:`;
  const consequences = hypotheticalConsequenceSentences(result);
  const note = 'This is a hypothetical scenario from Forecast and is not a recommendation.';
  const sentences = [lead].concat(consequences);
  sentences.push(note);
  return finishPresentation({
    answer: sentences.join(' '),
    source: 'Forecast',
    trust: 'calculated',
    asOf: day,
    freshness,
    action: null,
  }, {
    items: [{ kind: 'answer', title: 'Answer', body: lead }]
      .concat(consequences.map(body => ({
        kind: 'result',
        title: 'Forecast result',
        body,
      })))
      .concat([{ kind: 'note', title: 'Note', body: note }]),
  });
}

function comparisonOptionLabel(index, count) {
  if (count === 2) return `Option ${index === 0 ? 'A' : 'B'}`;
  return `Option ${index + 1}`;
}

function preferenceReasonSentence(reason) {
  if (reason === 'cash-endings-differ') {
    return 'Household cash-ending consequences differ, so Atlas has no owner authority to prefer one option.';
  }
  if (reason === 'not-fully-absorbed') {
    return 'An explicit payment is not fully absorbed by its named debt.';
  }
  if (reason === 'interest-reductions-equal') {
    return 'Forecast-calculated named-debt interest reductions are not strictly different.';
  }
  if (reason === 'not-exactly-two-options') {
    return 'The owner preference rule applies only to exactly two explicit options.';
  }
  return 'Required Forecast comparison fields are unavailable. Unavailable is not zero.';
}

function presentPreferenceSentence(preference) {
  if (!preference || typeof preference !== 'object') return null;
  if (preference.verdict === 'PREFER' && preference.preferred) {
    const amountText = formatCurrency(preference.preferred.amount);
    const label = typeof preference.preferred.debtLabel === 'string'
      ? preference.preferred.debtLabel
      : '';
    if (!amountText || !label) {
      return [
        'NOT YET / INDETERMINATE.',
        preferenceReasonSentence('unavailable'),
        'This is not a payment authority and not a recommendation to execute.',
      ].join(' ');
    }
    return [
      `PREFER ${amountText} on ${label}.`,
      'That option produces a strictly greater Forecast-calculated reduction in named-debt interest over the same household cash-ending and Forecast window.',
      'This is a conversational preference from the owner rule, not a payment authority and not a recommendation to execute.',
    ].join(' ');
  }
  return [
    'NOT YET / INDETERMINATE.',
    preferenceReasonSentence(preference.reason),
    'This is not a payment authority and not a recommendation to execute.',
  ].join(' ');
}

function presentHypotheticalComparison(result, packet, preference) {
  const asOf = (result && result.baseline && result.baseline.asOf) || readAsOf(packet);
  const freshness = readFreshness(packet);
  if (!result || result.status !== 'ready'
      || !Array.isArray(result.scenarios) || result.scenarios.length < 2) {
    return emptyPresentation(HYPOTHETICAL_COMPARISON_UNAVAILABLE_ANSWER, {
      source: 'Forecast',
      trust: 'unavailable',
      asOf,
      freshness,
    });
  }
  const day = result.baseline && result.baseline.asOf;
  const horizon = result.baseline && result.baseline.horizonDays;
  if (typeof day !== 'string' || !day || !Number.isFinite(Number(horizon))) {
    return emptyPresentation(HYPOTHETICAL_COMPARISON_UNAVAILABLE_ANSWER, {
      source: 'Forecast',
      trust: 'unavailable',
      asOf,
      freshness,
    });
  }
  const optionLines = [];
  const optionItems = [];
  for (let i = 0; i < result.scenarios.length; i += 1) {
    const row = result.scenarios[i];
    const input = row && row.input;
    const inner = row && row.result;
    const amountText = formatCurrency(input && input.amount);
    const label = input && typeof input.debtLabel === 'string' ? input.debtLabel : '';
    if (!amountText || !label || !inner || inner.status !== 'ready') {
      return emptyPresentation(HYPOTHETICAL_COMPARISON_UNAVAILABLE_ANSWER, {
        source: 'Forecast',
        trust: 'unavailable',
        asOf: day,
        freshness,
      });
    }
    const body = hypotheticalConsequenceSentences(inner);
    const optionTitle = comparisonOptionLabel(i, result.scenarios.length);
    const optionBody = `If you put ${amountText} on ${label} as a hypothetical extra on ${day}: ${body.join(' ')}`;
    optionLines.push(`${optionTitle} — ${optionBody}`);
    optionItems.push({ kind: 'option', title: optionTitle, body: optionBody });
  }
  const header = `Hypothetical comparison · Forecast as of ${day}. The Forecast window is ${Number(horizon)} days.`;
  const sentences = [header].concat(optionLines);
  const preferenceSentence = presentPreferenceSentence(preference);
  const note = 'This is a hypothetical comparison from Forecast and is not a recommendation. Forecast does not rank these options.';
  const items = [{ kind: 'answer', title: 'Answer', body: header }].concat(optionItems);
  if (preferenceSentence) {
    sentences.push(preferenceSentence);
    items.push({ kind: 'judgment', title: 'Preference', body: preferenceSentence });
  } else {
    sentences.push(note);
    items.push({ kind: 'note', title: 'Note', body: note });
  }
  return finishPresentation({
    answer: sentences.join(' '),
    source: 'Forecast',
    trust: 'calculated',
    asOf: day,
    freshness,
    action: null,
  }, { items });
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
  return finishPresentation({
    answer,
    source,
    trust: weakestTrust(presented.map(row => row.trust)),
    asOf: readAsOf(packet),
    freshness: readFreshness(packet),
    action,
  }, {
    items: presented.map((row, index) => ({
      kind: 'answer',
      title: 'Answer',
      body: row.mapped ? row.text : genericSentence(claims[index]),
    })),
    claimRows: presented,
  });
}

function isAllowedActionHref(href) {
  return ALLOWED_ACTION_HREFS.includes(href);
}

module.exports = {
  UNAVAILABLE_ANSWER,
  HYPOTHETICAL_UNAVAILABLE_ANSWER,
  HYPOTHETICAL_COMPARISON_UNAVAILABLE_ANSWER,
  ALLOWED_ACTIONS,
  ALLOWED_ACTION_HREFS,
  ALLOWED_SOURCES,
  SURFACE_LABELS,
  CITATION_KINDS,
  CITATION_TRUST,
  CARD_VERSION,
  CARD_KINDS,
  sanitizePresentationCards,
  sanitizeCitations,
  assembleCitations,
  assembleClaimCitations,
  publicCitationTrust,
  formatCurrency,
  formatClaimValue,
  isPrimitive,
  ruleFor,
  presentVerifiedClaims,
  presentHypotheticalExtra,
  presentHypotheticalComparison,
  isAllowedActionHref,
};
