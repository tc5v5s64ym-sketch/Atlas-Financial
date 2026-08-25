'use strict';
/* Refresh-loop operating answer projector.
 *
 * After a trusted live overlay or an approved canonical refresh, this
 * module asks Forecast.recommend for the household operating answer and
 * copies those fields. It does not recalculate their financial meaning,
 * does not invent remaining-claim precision, and is not a second planner.
 *
 *   money available            ← Forecast.paydayAllocation.available
 *   protected obligations      ← Forecast.paydayAllocation.obligations
 *   current spending permission← Forecast.recommend.weekly /
 *                                Forecast.currentPeriodAction
 *   future-cost protection     ← Forecast.paydayAllocation.futureCosts /
 *                                protectedPath
 *   extra-debt allocation      ← Forecast.paydayAllocation.extraDebt
 *   freshness / trust limits   ← Forecast.currentPeriodAction.remainingClaim,
 *                                coverage, paydayAllocation.risks
 *
 * Live-overlay mode may pass sanitized overlay currentPeriodActuals into
 * Forecast only when the overlay applied. Canonical mode never does.
 * A fail-closed overlay keeps the dated opening. Zero/no-change is valid.
 */

const fs = require('fs');
const path = require('path');
const Forecast = require('../public/forecast.js');

const ROOT = path.join(__dirname, '..');
const SCHEMA = 'atlas-refresh-operating-answer/v1';
const PERIODS = path.join(ROOT, 'public', 'periods.json');

const COMPARE_FIELDS = Object.freeze([
  ['asOf', 'asOf'],
  ['moneyAvailable', 'moneyAvailable.value'],
  ['protectedObligations.wanted', 'protectedObligations.wanted'],
  ['protectedObligations.allocated', 'protectedObligations.allocated'],
  ['protectedObligations.shortfall', 'protectedObligations.shortfall'],
  ['currentSpendingPermission.weekly', 'currentSpendingPermission.weekly'],
  ['currentSpendingPermission.weeklyCap', 'currentSpendingPermission.weeklyCap'],
  ['currentSpendingPermission.spendPermission', 'currentSpendingPermission.spendPermission'],
  ['currentSpendingPermission.remainingClaim', 'currentSpendingPermission.remainingClaim'],
  ['currentSpendingPermission.mode', 'currentSpendingPermission.mode'],
  ['futureCostProtection.protectedPath.wanted', 'futureCostProtection.protectedPath.wanted'],
  ['futureCostProtection.protectedPath.allocated', 'futureCostProtection.protectedPath.allocated'],
  ['extraDebtAllocation.allocated', 'extraDebtAllocation.allocated'],
  ['extraDebtAllocation.status', 'extraDebtAllocation.status'],
  ['limitations.remainingClaim', 'limitations.remainingClaim'],
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadPeriods() {
  if (!fs.existsSync(PERIODS)) return null;
  return JSON.parse(fs.readFileSync(PERIODS, 'utf8'));
}

function overlayOf(data) {
  return data && data.liveOverlay ? data.liveOverlay : null;
}

function overlayApplied(data, opts) {
  if (opts && opts.mode === 'canonical') return false;
  const overlay = overlayOf(data);
  return !!(overlay && overlay.applied === true);
}

function asOfFrom(data, opts) {
  const plan = data && data.plan;
  const overlay = overlayOf(data);
  if (overlayApplied(data, opts) && overlay.effectiveAsOf) return overlay.effectiveAsOf;
  return (plan && plan.opening && plan.opening.asOf)
    || (data && data.meta && data.meta.asOf)
    || null;
}

function actualsFrom(data, opts) {
  if (!overlayApplied(data, opts)) return null;
  const overlay = overlayOf(data);
  return overlay.currentPeriodActuals || null;
}

function recommendOpts(data, opts) {
  const plan = data && data.plan;
  return {
    fundingSources: plan && plan.funding && plan.funding.options,
    debts: data && data.debts,
    revolvingExtra: data && data.revolvingExtra,
    periods: loadPeriods(),
    currentPeriodActuals: actualsFrom(data, opts),
  };
}

function recommendFrom(data, opts) {
  const plan = data && data.plan;
  const asOf = asOfFrom(data, opts);
  if (!plan || !asOf) {
    const err = new Error('Refreshed data is missing a Forecast opening.');
    err.code = 'operating-answer-failed';
    throw err;
  }
  return {
    asOf,
    advice: Forecast.recommend(plan, asOf, recommendOpts(data, opts)),
  };
}

function trustedStateFrom(data, opts) {
  if (opts && opts.trustedState) return opts.trustedState;
  if (opts && opts.mode === 'canonical') {
    return opts.writesCanonicalState === true
      ? 'canonical-approved-write'
      : 'canonical-dated-opening';
  }
  if (overlayApplied(data, opts)) return 'live-overlay-applied';
  const overlay = overlayOf(data);
  if (overlay && overlay.applied === false) return 'live-overlay-failed-closed';
  return 'dated-opening';
}

function lookup(packet, dotted) {
  const parts = String(dotted).split('.');
  let cur = packet;
  for (const part of parts) {
    if (cur == null) return null;
    cur = cur[part];
  }
  return cur;
}

function valuesEqual(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    return a === b || (Number.isNaN(a) && Number.isNaN(b));
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

function changeFrom(before, after) {
  if (!before) {
    return {
      changed: null,
      fields: [],
      note: 'No baseline Forecast result was supplied; zero/no-change is not claimed.',
    };
  }
  const fields = COMPARE_FIELDS.map(([name, path]) => {
    const previous = lookup(before, path);
    const next = lookup(after, path);
    return {
      field: name,
      source: 'Forecast.recommend',
      before: previous == null ? null : previous,
      after: next == null ? null : next,
      changed: !valuesEqual(previous, next),
    };
  });
  const futureBefore = ((before.futureCostProtection && before.futureCostProtection.futureCosts) || [])
    .map(row => ({ id: row && row.id, allocated: row && row.allocated }));
  const futureAfter = ((after.futureCostProtection && after.futureCostProtection.futureCosts) || [])
    .map(row => ({ id: row && row.id, allocated: row && row.allocated }));
  fields.push({
    field: 'futureCostProtection.futureCosts',
    source: 'Forecast.paydayAllocation.futureCosts',
    before: futureBefore,
    after: futureAfter,
    changed: !valuesEqual(futureBefore, futureAfter),
  });
  return {
    changed: fields.some(row => row.changed === true),
    fields,
    note: 'Change is equality of Forecast outputs. The projector does not compute a financial delta.',
  };
}

function projectFromAdvice(advice, data, opts, asOf) {
  const overlay = overlayOf(data);
  const alloc = (advice && advice.paydayAllocation) || {};
  const action = (advice && advice.currentPeriodAction) || {};
  const remainingClaim = action.remainingClaim || 'unavailable';
  const mode = (opts && opts.mode) || 'live-overlay';
  const applied = overlayApplied(data, opts);
  return {
    schema: SCHEMA,
    source: 'Forecast.recommend',
    provenance: {
      mode,
      trustedState: trustedStateFrom(data, opts),
      asOf,
      overlayApplied: applied,
      writesCanonicalState: opts && opts.writesCanonicalState === true,
      remainingClaim,
      categoryRemainingClaim: action.categoryRemainingClaim || null,
      overlayFailedReason: (!applied && overlay && overlay.reason) || null,
    },
    asOf,
    recommendMode: advice && advice.mode || null,
    moneyAvailable: {
      source: 'Forecast.paydayAllocation.available',
      value: Object.prototype.hasOwnProperty.call(alloc, 'available') ? alloc.available : null,
    },
    protectedObligations: {
      source: 'Forecast.paydayAllocation.obligations',
      wanted: alloc.obligations ? alloc.obligations.wanted : null,
      allocated: alloc.obligations ? alloc.obligations.allocated : null,
      shortfall: alloc.obligations ? alloc.obligations.shortfall : null,
      items: clone(alloc.obligations && alloc.obligations.items ? alloc.obligations.items : []),
    },
    currentSpendingPermission: {
      source: 'Forecast.recommend.weekly / Forecast.currentPeriodAction',
      weekly: advice && Object.prototype.hasOwnProperty.call(advice, 'weekly') ? advice.weekly : null,
      weeklyCap: action.weeklyCap != null ? action.weeklyCap : (alloc.weeklyCap != null ? alloc.weeklyCap : null),
      spendPermission: action.spendPermission != null
        ? action.spendPermission
        : (alloc.spendPermission != null ? alloc.spendPermission : null),
      remainingClaim,
      mode: action.mode || (advice && advice.mode) || null,
      nextPayday: action.nextPayday || null,
      noMovementToday: action.noMovementToday === true,
    },
    futureCostProtection: {
      source: 'Forecast.paydayAllocation.futureCosts / protectedPath',
      protectedPath: clone(alloc.protectedPath || null),
      liquidity: clone(alloc.liquidity || null),
      futureCosts: clone(alloc.futureCosts || []),
    },
    extraDebtAllocation: {
      source: 'Forecast.paydayAllocation.extraDebt',
      allocated: alloc.extraDebt ? alloc.extraDebt.allocated : null,
      absorbable: alloc.extraDebt ? alloc.extraDebt.absorbable : null,
      status: alloc.extraDebt ? alloc.extraDebt.status : null,
      reason: alloc.extraDebt ? alloc.extraDebt.reason : null,
      target: clone(alloc.extraDebt && alloc.extraDebt.target ? alloc.extraDebt.target : null),
      consequence: clone(alloc.extraDebt && alloc.extraDebt.consequence ? alloc.extraDebt.consequence : null),
    },
    limitations: {
      source: 'Forecast.currentPeriodAction / Forecast.paydayAllocation.risks',
      remainingClaim,
      categoryRemainingClaim: action.categoryRemainingClaim || null,
      coverage: clone(action.coverage || alloc.actualsCoverage || null),
      risks: clone(alloc.risks || []),
      unresolved: clone(alloc.unresolved || []),
    },
  };
}

function fromRefreshedState(data, opts) {
  opts = opts || {};
  const { asOf, advice } = recommendFrom(data, opts);
  const packet = projectFromAdvice(advice, data, opts, asOf);
  if (opts.baseline) {
    const baselineOpts = Object.assign({}, opts, { baseline: null });
    if (opts.baselineMode) baselineOpts.mode = opts.baselineMode;
    const before = fromRefreshedState(opts.baseline, baselineOpts);
    packet.change = changeFrom(before, packet);
    packet.baselineProvenance = before.provenance;
  } else {
    packet.change = changeFrom(null, packet);
  }
  return packet;
}

const api = {
  SCHEMA,
  COMPARE_FIELDS,
  overlayApplied,
  asOfFrom,
  actualsFrom,
  recommendOpts,
  recommendFrom,
  fromRefreshedState,
  changeFrom,
};

if (require.main === module) {
  process.stderr.write(
    'scripts/operating-answer.js is a Forecast projector used by live-plan and canonical-refresh. It is not a CLI.\n'
  );
  process.exit(1);
} else {
  module.exports = api;
}
