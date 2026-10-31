'use strict';
// Invented occurrence ledger: one 139.73 bill and three card requirements
// 40.05 + 70.07 + 20.09. Posted minimum-intent sends are 67.43 + 81.29 +
// 29.17 = 177.89, independently confirmed; money sent is not a minimum amount.
const source = require('./budget-surface-data');
const AS_OF = '2026-08-20';
function fixture() {
  const data = source.canonical(), plan = data.plan;
  plan.bills = [{ id: 'invented-bill', label: 'Invented bill', frequency: 'once',
    date: '2026-08-16', amount: 139.73, confidence: 'confirmed', payingAccount: 'chequing-a' }];
  plan.obligations = ['travelvisa', 'mbna', 'triangle'].map((debtId, i) => ({
    id: 'invented-minimum-' + i, label: 'Invented minimum ' + (i + 1), debtId,
    effect: 'payment', frequency: 'monthly', day: 24 + i, amount: [40.05, 70.07, 20.09][i],
    confidence: 'confirmed', payingAccount: 'chequing-a', sentPayments: [{
      scheduledDate: '2026-08-' + (24 + i), postedOn: '2026-08-19', amount: [67.43, 81.29, 29.17][i],
      confirmed: true, intent: 'minimum', pending: false, currency: 'cad',
      debitId: 'invented-minimum-debit-' + i, fundingAccountId: 'chequing-a', cashIncludedAsOf: AS_OF,
    }],
  }));
  plan.opening = { asOf: AS_OF, priorAsOf: '2026-08-13', representedEvents: [
    { id: 'invented-bill', date: '2026-08-16', effectiveAsOf: '2026-08-19' },
    ...plan.obligations.map(row => ({ id: row.id, date: row.sentPayments[0].scheduledDate, effectiveAsOf: '2026-08-19' })),
  ] };
  const packet = { observationAsOf: AS_OF, coverageStart: '2026-08-14', coverageThrough: AS_OF,
    pendingCoverage: 'complete', transactionCoverage: 'complete', transactions: [],
    representedActuals: [{ id: 'invented-bill', date: '2026-08-16', actual: 139.73 }] };
  const period = { start: '2026-08-14', end: '2026-08-27', timelineRole: 'current',
    spendingCycle: { start: '2026-08-14', end: '2026-08-27' }, income: [], householdBudget: [],
    bills: [{ id: 'invented-bill', date: '2026-08-16', planned: 139.73, amount: 139.73,
      actual: 139.73, status: 'PAID', settlement: 'represented', confidence: 'confirmed' },
    ...plan.obligations.map(row => ({ id: row.id, date: row.sentPayments[0].scheduledDate,
      scheduledDate: row.sentPayments[0].scheduledDate, occurrenceKey: row.id + '@' + row.sentPayments[0].scheduledDate,
      kind: 'obligation', planned: row.amount, amount: row.amount, actual: null,
      status: 'PAID', settlement: 'represented', confidence: 'confirmed' }))] };
  return { data, plan, packet, period, asOf: AS_OF };
}
function served() {
  const x = fixture(), data = source.served();
  data.meta.title = 'Invented Bills header payments';
  data.plan.bills = x.plan.bills;
  data.plan.obligations = x.plan.obligations;
  data.plan.opening = x.plan.opening;
  data.plan.opening.representedEvents.push({ id: 'payroll', date: '2026-08-14', effectiveAsOf: AS_OF });
  x.packet.representedActuals.push({ id: 'payroll', date: '2026-08-14', actual: -2600 });
  data.liveOverlay.currentPeriodActuals = x.packet;
  for (const id of ['mbna', 'triangle']) data.debts.push({ ...data.debts[0], id, label: 'Invented ' + id });
  return data;
}
module.exports = { fixture, served, AS_OF };
