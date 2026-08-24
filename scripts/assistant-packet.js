'use strict';
/* Sanitized read-only Atlas packet for an assistant consumer.
 *
 * This module DERIVES a machine-readable snapshot from incumbent authorities:
 *   - Forecast (sole planning / calculation authority)
 *   - scripts/live-plan.js (already-served overlay or fail-closed opening)
 *   - generated public/periods.json (historical actuals)
 *   - docs/01_OPEN_QUESTIONS.md (OPEN / ASKED / BLOCKED status)
 *
 * It is not a planner, not a second Forecast, not a transaction store, and
 * not a copy of household facts. If an incumbent has no answer, the packet
 * records unavailable/unknown. It never writes.
 *
 * HTTP consumer: GET /assistant/current (Bearer ATLAS_ASSISTANT_TOKEN).
 * Next PR may wrap that route as one read-only MCP tool without changing
 * financial authority. ChatGPT Apps SDK OAuth is that later adapter, not
 * this outcome. Do not import an Apps SDK scaffold here.
 */

const fs = require('fs');
const path = require('path');
const Forecast = require('../public/forecast.js');

const ROOT = path.join(__dirname, '..');
const SCHEMA = 'atlas-assistant-packet/v1';
const DEFAULT_PERIODS = path.join(ROOT, 'public', 'periods.json');
const DEFAULT_QUESTIONS = path.join(ROOT, 'docs', '01_OPEN_QUESTIONS.md');
const CANONICAL_STATUSES = ['OPEN', 'ASKED', 'ANSWERED', 'BLOCKED'];
const UNRESOLVED = new Set(['OPEN', 'ASKED', 'BLOCKED']);
const TOKEN_MIN_LENGTH = 32;

function round2(value) {
  if (value == null || !isFinite(Number(value))) return value;
  return Math.round(Number(value) * 100) / 100;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function unavailable(reason) {
  return { status: 'unavailable', reason: reason || 'unknown' };
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadPeriods(file) {
  const target = file || DEFAULT_PERIODS;
  if (!fs.existsSync(target)) return null;
  return loadJson(target);
}

function parseOpenQuestions(markdown) {
  const text = String(markdown || '');
  const questions = [];
  const seen = new Set();
  const headingRe = /^###\s+(Q\d+[a-zA-Z]?)\.\s+(.+?)\s*$/gm;
  let match;
  while ((match = headingRe.exec(text))) {
    const id = match[1].toUpperCase();
    if (seen.has(id)) continue;
    seen.add(id);
    const title = match[2].replace(/\s*[—–-]\s*ANSWERED\b.*$/i, '').trim();
    const rest = text.slice(match.index + match[0].length);
    const nextHeading = rest.search(/\n###\s+/);
    const body = nextHeading >= 0 ? rest.slice(0, nextHeading) : rest;
    const statusLine = /\*\*Status:\*\*\s*([^\n]+)/.exec(body);
    let status = null;
    if (statusLine) {
      const raw = statusLine[1].trim();
      if (!/^PARTIALLY\b/i.test(raw)) {
        const tok = new RegExp(`^(${CANONICAL_STATUSES.join('|')})\\b`, 'i').exec(raw);
        status = tok ? tok[1].toUpperCase() : null;
      }
    } else if (/\bANSWERED\b/i.test(match[2])) {
      status = 'ANSWERED';
    }
    const ownerLine = /\*\*Owner:\*\*\s*([^\n]+)/.exec(body);
    const owner = ownerLine ? ownerLine[1].replace(/\s*·.*$/, '').trim() : null;
    questions.push({ id, title, status, owner });
  }
  return questions;
}

function unresolvedQuestions(markdown) {
  return parseOpenQuestions(markdown)
    .filter(q => UNRESOLVED.has(q.status))
    .map(q => ({
      id: q.id,
      title: q.title,
      status: q.status,
      owner: q.owner || null,
    }));
}

function versionIdentifier(env) {
  const sourceEnv = env || {};
  const render = sourceEnv.RENDER_GIT_COMMIT;
  const override = sourceEnv.ATLAS_GIT_SHA;
  const sha = render || override || null;
  if (sha && /^[0-9a-f]{7,40}$/i.test(String(sha))) {
    return {
      gitSha: String(sha),
      source: render ? 'RENDER_GIT_COMMIT' : 'ATLAS_GIT_SHA',
    };
  }
  return { gitSha: null, source: 'unknown' };
}

function effectiveAsOf(data) {
  const overlay = data && data.liveOverlay;
  if (overlay && overlay.applied === true && overlay.effectiveAsOf) {
    return overlay.effectiveAsOf;
  }
  return (data && data.plan && data.plan.opening && data.plan.opening.asOf)
    || (data && data.meta && data.meta.asOf)
    || null;
}

function canonicalAsOf(data) {
  const overlay = data && data.liveOverlay;
  if (overlay && overlay.historicalOpeningAsOf) return overlay.historicalOpeningAsOf;
  return (data && data.plan && data.plan.opening && data.plan.opening.asOf)
    || (data && data.meta && data.meta.asOf)
    || null;
}

function money(value) {
  if (value == null || !isFinite(Number(value))) return null;
  return round2(value);
}

function trustFor(value) {
  if (value == null) return 'unknown';
  return 'calculated';
}

function forecastAdvice(data, periods) {
  const plan = data && data.plan;
  const asOf = effectiveAsOf(data);
  if (!plan || !asOf) return null;
  const overlay = data.liveOverlay;
  const actuals = overlay && overlay.applied === true
    ? overlay.currentPeriodActuals
    : null;
  return Forecast.recommend(plan, asOf, {
    fundingSources: plan.funding && plan.funding.options,
    debts: data.debts,
    revolvingExtra: data.revolvingExtra,
    periods: periods || null,
    currentPeriodActuals: actuals,
  });
}

function projectDebtsFromAdvice(data, asOf, advice) {
  if (!advice || !data || !asOf) return null;
  return Forecast.projectDebts(data.plan, data.debts, asOf, Object.assign({},
    advice.simOptions || {}, {
      weeklyVariable: advice.weekly,
      extraFacilities: data.revolvingExtra,
      extraDebtTarget: data.plan && data.plan.nextDollar && data.plan.nextDollar.target,
    }));
}

function metadataBlock(data, opts, advice) {
  const overlay = data && data.liveOverlay;
  const applied = !!(overlay && overlay.applied === true);
  const liveAsOf = applied
    ? (overlay.observedAsOf || overlay.effectiveAsOf || null)
    : null;
  let confidence = 'canonical-opening';
  if (applied) confidence = 'live';
  else if (overlay && overlay.applied === false) confidence = 'canonical-opening';
  const coverage = Array.isArray(data && data.coverage)
    ? data.coverage.map(row => ({
      source: row.source || null,
      what: row.what || null,
      status: row.status || null,
    }))
    : unavailable('no-coverage-rows');
  return {
    generatedAt: opts.now,
    canonicalAsOf: canonicalAsOf(data),
    liveObservationAsOf: liveAsOf,
    effectiveAsOf: effectiveAsOf(data),
    version: versionIdentifier(opts.env),
    freshness: {
      liveOverlayApplied: applied,
      liveOverlayReason: overlay && overlay.reason ? overlay.reason : null,
      confidence,
      writesCanonicalState: false,
    },
    coverage: {
      summary: (data && data.meta && data.meta.coverage) || null,
      sources: coverage,
      knowledgeHorizonDays: advice && advice.knowledge ? advice.knowledge.days : null,
    },
  };
}

function currentBlock(data, asOf, advice, used) {
  const plan = data && data.plan;
  if (!plan || !asOf) {
    return {
      spendableHouseholdCash: unavailable('missing-opening'),
      pending: unavailable('missing-opening'),
      debts: unavailable('missing-opening'),
      nextSignificantObligations: unavailable('missing-opening'),
    };
  }
  const spendable = Forecast.startingCashAmount(plan);
  const events = advice && advice.sim && advice.sim.events
    ? advice.sim.events
    : null;
  const nextDue = events ? Forecast.nextDue(events, asOf) : null;
  const nextOut = events ? Forecast.nextPaymentOut(events, asOf) : null;
  const rows = used && Array.isArray(used.rows)
    ? used.rows.map(row => ({
      id: row.id,
      label: row.label,
      posted: money(row.posted),
      pending: row.pendingUnknown ? null : money(row.pending),
      pendingUnknown: row.pendingUnknown === true,
      used: money(row.used),
      limit: money(row.limit),
      available: money(row.available),
      overLimit: row.overLimit === true,
      utilizationPct: row.pct == null ? null : round2(row.pct),
      trust: row.pendingUnknown ? 'unknown' : 'calculated',
    }))
    : null;
  const snapshot = data.debts
    ? Forecast.compactSnapshot(data.debts, data.helocHistory)
    : null;
  const pendingUnknownCount = rows
    ? rows.filter(row => row.pendingUnknown).length
    : 0;
  return {
    spendableHouseholdCash: Number.isFinite(spendable)
      ? {
        status: 'ok',
        value: money(spendable),
        trust: trustFor(spendable),
        source: 'Forecast.startingCashAmount',
      }
      : unavailable('starting-cash-not-finite'),
    pending: used
      ? {
        status: 'ok',
        totalKnownPending: money(used.totalPending),
        unknownFacilityCount: pendingUnknownCount,
        freshness: pendingUnknownCount > 0 ? 'incomplete' : 'known',
        source: 'Forecast.utilisation',
      }
      : unavailable('utilisation-unavailable'),
    debts: rows
      ? {
        status: 'ok',
        source: 'Forecast.utilisation',
        totalAvailableCredit: money(used.totalAvailable),
        overLimitCount: used.overLimitCount,
        securedDebt: snapshot ? money(snapshot.secured) : null,
        monthlyInterest: snapshot ? money(snapshot.monthlyInterest) : null,
        helocDirection: snapshot && snapshot.heloc ? snapshot.heloc : null,
        facilities: rows,
      }
      : unavailable('utilisation-unavailable'),
    nextSignificantObligations: events
      ? {
        status: 'ok',
        source: 'Forecast.nextDue / Forecast.nextPaymentOut / Forecast.recommend.nearBoundary',
        nextDue: nextDue ? {
          date: nextDue.due,
          label: nextDue.what,
          amount: money(nextDue.amount),
          daysUntil: nextDue.daysUntil,
        } : null,
        nextPaymentOut: nextOut ? {
          date: nextOut.date,
          label: nextOut.label,
          amount: money(nextOut.amount),
          count: nextOut.count,
          daysUntil: nextOut.daysUntil,
        } : null,
        nearBoundary: advice && advice.nearBoundary && Array.isArray(advice.nearBoundary.items)
          ? {
            payday: advice.nearBoundary.payday || null,
            until: advice.nearBoundary.until || null,
            total: money(advice.nearBoundary.total),
            items: advice.nearBoundary.items.map(item => ({
              date: item.date || null,
              id: item.id || null,
              label: item.label || null,
              amount: money(item.amount),
            })),
          }
          : null,
      }
      : unavailable('forecast-events-unavailable'),
  };
}

function forecastBlock(data, asOf, advice, debtProj, periods) {
  if (!advice) return unavailable('forecast-unavailable');
  const horizon = advice.knowledge || Forecast.knowledgeHorizon(data.plan, asOf);
  const capMonthly = advice.weekly == null
    ? null
    : money(Forecast.monthlyFromWeekly(advice.weekly));
  const budget = periods
    ? Forecast.budgetBreakdown(data.plan, periods, {
      asOf,
      weeklyCap: advice.weekly,
    })
    : null;
  const infeasible = advice.infeasible
    ? {
      date: advice.infeasible.date || null,
      label: advice.infeasible.label || advice.infeasible.what || null,
      shortfall: money(advice.infeasible.shortfall || advice.infeasible.amount),
    }
    : null;
  const major = Array.isArray(advice.majorPlans)
    ? advice.majorPlans.map(item => ({
      id: item.id,
      label: item.label,
      date: item.date || null,
      verdict: item.verdict || null,
      flexibility: item.flexibility || null,
      confidence: item.confidence || null,
      need: money(item.need),
      amountMin: money(item.amountMin),
      amountMax: money(item.amountMax),
      margin: money(item.margin),
      remaining: money(item.remaining),
    }))
    : [];
  const crossings = debtProj && Array.isArray(debtProj.crossings)
    ? debtProj.crossings.map(row => ({
      id: row.id,
      label: row.label,
      date: row.date,
      day: row.day,
      limit: money(row.limit),
      alreadyOver: row.alreadyOver === true,
    }))
    : [];
  const action = advice.currentPeriodAction || null;
  return {
    status: 'ok',
    source: 'Forecast.recommend',
    recommendation: {
      weekly: money(advice.weekly),
      monthlyEquivalent: capMonthly,
      mode: advice.mode || null,
      holds: advice.holds === true,
      infeasible,
      trust: advice.mode === 'infeasible' ? 'calculated' : trustFor(advice.weekly),
    },
    horizon: horizon
      ? {
        start: horizon.start || null,
        end: horizon.end || null,
        days: horizon.days || null,
        visibleWindowDays: (data.plan && data.plan.windowDays) || null,
        minBalance: advice.knowledge && advice.knowledge.min
          ? money(advice.knowledge.min.balance)
          : null,
        minDate: advice.knowledge && advice.knowledge.min
          ? advice.knowledge.min.date
          : null,
      }
      : unavailable('knowledge-horizon-unavailable'),
    upcomingModeledCommitments: major.length
      ? { status: 'ok', source: 'Forecast.majorPlans', items: major }
      : unavailable('no-major-plans'),
    facilityCrossings: crossings.length || (debtProj && Array.isArray(debtProj.crossings))
      ? { status: 'ok', source: 'Forecast.projectDebts', items: crossings }
      : unavailable('debt-projection-unavailable'),
    majorPlanFunding: major.length
      ? { status: 'ok', source: 'Forecast.majorPlans', items: major }
      : unavailable('no-major-plans'),
    currentPeriodAction: action
      ? {
        status: 'ok',
        source: 'Forecast.currentPeriodAction',
        mode: action.mode || null,
        periodStart: action.periodStart || null,
        periodEnd: action.periodEnd || null,
        nextPayday: action.nextPayday || null,
        remainingClaim: action.remainingClaim || null,
        categoryRemainingClaim: action.categoryRemainingClaim || null,
        essentialRemaining: money(action.essentialRemaining),
        weeklyCap: money(action.weeklyCap),
        noMovementToday: action.noMovementToday === true,
        currentShortfall: action.currentShortfall === true,
      }
      : unavailable('current-period-action-unavailable'),
    budgetCap: budget && budget.cap
      ? {
        status: 'ok',
        source: 'Forecast.budgetBreakdown.cap',
        weekly: money(budget.cap.weekly),
        monthlyEquivalent: money(budget.cap.monthly),
        hasDiscretionaryRoom: budget.cap.hasDiscretionaryRoom === true,
        discretionaryRoomWeekly: money(budget.cap.discretionaryRoomWeekly),
        essentialShortfallWeekly: money(budget.cap.essentialShortfallWeekly),
        inCapMonthly: money(budget.cap.inCapMonthly),
      }
      : unavailable('budget-cap-unavailable'),
  };
}

function actualsBlock(data, periods, advice) {
  if (!periods || !periods.periods) {
    return unavailable('periods-unavailable');
  }
  const budget = data.plan && periods
    ? Forecast.budgetBreakdown(data.plan, periods, {
      asOf: effectiveAsOf(data),
      weeklyCap: advice && advice.weekly,
    })
    : null;
  const basis = (budget && budget.basis)
    || (data.plan && data.plan.budget && data.plan.budget.basis)
    || 'ytd';
  const window = periods.periods[basis] || periods.periods.all || null;
  if (!window) return unavailable('actuals-window-unavailable');
  const uncategorised = (window.spending || []).find(row =>
    row && /uncategor/i.test(row.label));
  const action = advice && advice.currentPeriodAction;
  return {
    status: 'ok',
    source: 'public/periods.json / Forecast.budgetBreakdown / Forecast.currentPeriodAction',
    window: {
      periodsAsOf: periods.asOf || null,
      thisMonth: periods.thisMonth || null,
      lastMonth: periods.lastMonth || null,
      basis,
      basisLabel: window.label || (budget && budget.basisLabel) || null,
      months: window.months || (budget && budget.months) || null,
    },
    totalsByCategory: (window.spending || []).map(row => ({
      label: row.label,
      total: money(row.total),
      type: row.type || null,
      types: row.types || null,
    })),
    spendingTotal: money(window.spendingTotal),
    feesTotal: money(window.feesTotal),
    interestTotal: money(window.interestTotal),
    budgetCategories: budget && Array.isArray(budget.categories)
      ? budget.categories.map(row => ({
        id: row.id,
        label: row.label,
        class: row.class || null,
        historicalMonthly: money(row.historical),
        plannedMonthly: money(row.planned),
        source: row.source || null,
      }))
      : unavailable('budget-breakdown-unavailable'),
    currentPeriodCategories: action && Array.isArray(action.categories)
      ? action.categories.map(row => ({
        id: row.id,
        label: row.label,
        class: row.class || null,
        planned: money(row.planned),
        posted: money(row.posted),
        pending: money(row.pending),
        remaining: money(row.remaining),
      }))
      : unavailable('current-period-categories-unavailable'),
    exclusionsCoverageConfidence: {
      uncategorisedTotal: uncategorised ? money(uncategorised.total) : 0,
      remainingClaim: action ? action.remainingClaim : null,
      categoryRemainingClaim: action ? action.categoryRemainingClaim : null,
      unclassifiedCount: action && action.unclassified ? action.unclassified.count : null,
    },
  };
}

function uncertaintyBlock(data, periods, questionsMarkdown, advice) {
  const overlay = data && data.liveOverlay;
  const refused = Array.isArray(overlay && overlay.refused)
    ? overlay.refused.map(row => ({
      locator: row.locator || null,
      fact: row.fact || null,
      reason: row.reason || null,
      evidenceDate: row.evidenceDate || null,
    }))
    : [];
  const used = data && data.debts
    ? Forecast.utilisation(data.debts, data.revolvingExtra, data.plan)
    : null;
  const staleOrManual = [];
  if (used && Array.isArray(used.rows)) {
    for (const row of used.rows) {
      if (row.pendingUnknown) {
        staleOrManual.push({
          id: row.id,
          label: row.label,
          kind: 'unknown-pending',
        });
      }
    }
  }
  const window = periods && periods.periods
    ? (periods.periods[(data.plan && data.plan.budget && data.plan.budget.basis) || 'ytd']
      || periods.periods.all)
    : null;
  const uncategorised = window && Array.isArray(window.spending)
    ? window.spending.find(row => row && /uncategor/i.test(row.label))
    : null;
  const action = advice && advice.currentPeriodAction;
  const providerGaps = refused.filter(row => row.reason);
  const ownerQuestions = unresolvedQuestions(questionsMarkdown);
  return {
    staleOrManualAccounts: staleOrManual,
    incompleteCategoryCoverage: {
      uncategorisedTotal: uncategorised ? money(uncategorised.total) : null,
      unclassifiedCurrentPeriod: action && action.unclassified
        ? {
          posted: money(action.unclassified.posted),
          pending: money(action.unclassified.pending),
          count: action.unclassified.count,
        }
        : null,
      categoryRemainingClaim: action ? action.categoryRemainingClaim : null,
    },
    providerGaps,
    liveOverlayFailed: overlay && overlay.applied === false
      ? { reason: overlay.reason || 'overlay-failed' }
      : null,
    ownerQuestions,
  };
}

function looksSanitized(packet) {
  const blob = JSON.stringify(packet == null ? {} : packet);
  if (/"providerAccountId"\s*:/.test(blob)) return false;
  if (/"providerTransactionId"\s*:/.test(blob)) return false;
  if (/"accountId"\s*:/.test(blob)) return false;
  if (/"payee"\s*:/.test(blob)) return false;
  if (/"original_name"\s*:/.test(blob)) return false;
  if (/"account_id"\s*:/.test(blob)) return false;
  if (/"plaid_account_id"\s*:/.test(blob)) return false;
  if (/"transactions"\s*:\s*\[/.test(blob)) return false;
  if (/Bearer\s+\S+/.test(blob)) return false;
  if (/LUNCHMONEY_ACCESS_TOKEN/.test(blob)) return false;
  if (/SITE_PASSWORD/.test(blob)) return false;
  if (/SESSION_SECRET/.test(blob)) return false;
  if (/ATLAS_ASSISTANT_TOKEN/.test(blob)) return false;
  if (/ATLAS_PROVIDER_ACCOUNT_MAP_JSON/.test(blob)) return false;
  if (/\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/.test(blob)) return false;
  return true;
}

function buildPacket(opts) {
  opts = opts || {};
  const data = opts.data;
  if (!data || !data.plan) {
    throw new Error('Assistant packet requires served Atlas data.');
  }
  const periods = opts.periods !== undefined ? opts.periods : loadPeriods(opts.periodsPath);
  const questionsMarkdown = opts.questionsMarkdown !== undefined
    ? opts.questionsMarkdown
    : (fs.existsSync(opts.questionsPath || DEFAULT_QUESTIONS)
      ? fs.readFileSync(opts.questionsPath || DEFAULT_QUESTIONS, 'utf8')
      : '');
  const asOf = effectiveAsOf(data);
  const advice = forecastAdvice(data, periods);
  const used = Forecast.utilisation(data.debts, data.revolvingExtra, data.plan);
  const debtProj = projectDebtsFromAdvice(data, asOf, advice);
  const packet = {
    schema: SCHEMA,
    writesCanonicalState: false,
    productionWrite: false,
    unattended: false,
    authority: {
      planner: 'Forecast',
      observation: 'scripts/live-plan.js',
      actuals: 'public/periods.json',
      questions: 'docs/01_OPEN_QUESTIONS.md',
      note: 'This packet exposes Atlas/Forecast results. It is not a second planner.',
    },
    metadata: metadataBlock(data, {
      now: opts.now || new Date().toISOString(),
      env: opts.env || process.env,
    }, advice),
    current: currentBlock(data, asOf, advice, used),
    forecast: forecastBlock(data, asOf, advice, debtProj, periods),
    actuals: actualsBlock(data, periods, advice),
    uncertainty: uncertaintyBlock(data, periods, questionsMarkdown, advice),
  };
  if (!looksSanitized(packet)) {
    throw new Error('Assistant packet is not sanitized.');
  }
  return packet;
}

function tokenConfigured(env) {
  const token = env && env.ATLAS_ASSISTANT_TOKEN;
  return typeof token === 'string' && token.length >= TOKEN_MIN_LENGTH;
}

module.exports = {
  SCHEMA,
  TOKEN_MIN_LENGTH,
  DEFAULT_PERIODS,
  DEFAULT_QUESTIONS,
  buildPacket,
  parseOpenQuestions,
  unresolvedQuestions,
  versionIdentifier,
  looksSanitized,
  loadPeriods,
  tokenConfigured,
  clone,
};
