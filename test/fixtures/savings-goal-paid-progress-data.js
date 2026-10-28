'use strict';
// ATLAS-024 Savings goal Paid / Still to fund browser fixture.
// Independently invented goals, dates, cents and evidence identities only.
// No canonical, provider or household inputs. The settlement evidence rides
// the served-data seam the page already validates (settlementEvidenceStatus
// + settlementEvidence), so Forecast receives it through simOpts unchanged.
const roster = require('./savings-selected-roster-data');
const shell = require('./savings-daily-consumer-data');

// Independent oracle: chronological funding order and the paid / unpaid
// facts each goal must show, written by hand from the invented inputs below.
const GOALS = Object.freeze([
  Object.freeze({ key: 'commitment:goal-a', id: 'goal-a', label: 'Invented goal A', date: '2026-10-30', amount: 40, linkedCents: 4000 }),
  Object.freeze({ key: 'commitment:goal-b', id: 'goal-b', label: 'Invented goal B', date: '2026-11-13', amount: 80, linkedCents: 2000 }),
  Object.freeze({ key: 'commitment:goal-c', id: 'goal-c', label: 'Invented goal C', date: '2026-11-20', amount: 60, linkedCents: 0 }),
]);
const hex = (digit, n) => String(digit).repeat(n);
function link(n, cents, reversals = []) {
  return { operationId: 'operation-' + hex(n, 32), txRef: 'tx-' + hex(n, 32), assignedCents: cents,
    effectiveDate: '2026-10-05', asOf: '2026-10-05', evidenceDigest: hex('e', 64), reversals };
}
// mode: 'evidence' (qualified evidence: A fully paid, B partly paid, C no links),
//       'absent' (no settlement evidence served, as in production today),
//       'uncertain' (qualified evidence, but B's link carries a reversal).
function data(mode = 'evidence') {
  const x = roster('ready'), d = shell('ready');
  x.plan.groups = [];
  x.plan.commitments = GOALS.map(g => ({ id: g.id, label: g.label, date: g.date, amount: g.amount,
    confidence: 'confirmed', sinkingFund: true }));
  d.plan = x.plan; d.meta.asOf = x.asOf;
  d.meta.title = 'Invented Savings goal paid progress review';
  d.liveOverlay = { applied: true, operatingPlan: 'live', ...x.opts,
    observedCash: { asOf: x.asOf, complete: true, accounts: d.plan.startingCash.breakdown
      .filter(r => r.id.startsWith('chequing')).map(r => ({ ...r, evidenceDate: x.asOf })) } };
  if (mode === 'evidence' || mode === 'uncertain') {
    d.settlementEvidenceStatus = { status: 'qualified' };
    d.settlementEvidence = { commitments: [
      { goalId: 'commitment:goal-a', links: [link(1, 4000)] },
      { goalId: 'commitment:goal-b', links: [link(2, 2000, mode === 'uncertain'
        ? [{ operationId: 'operation-' + hex(3, 32), counterTxRef: 'tx-' + hex(3, 32), cents: 500, date: '2026-10-06' }] : [])] },
    ] };
  } else if (mode !== 'absent') throw new Error('Unknown fixture mode ' + mode);
  return d;
}
module.exports = { data, GOALS };
