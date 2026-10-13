'use strict';
// Real observer and overlay, wholly invented inputs. No household data.
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const O = require(path.join(root, 'scripts/provider-observe'));
const L = require(path.join(root, 'scripts/live-plan'));
const F = require(path.join(root, 'public/forecast'));
const fx = require(path.join(root, 'test/fixtures/savings-v2-observation-data'));
function observed(mode) {
  const x = fx.input('valid-v2'), day = '2026-10-08';
  delete x.data.liveOverlay; // No handwritten actuals survive this boundary.
  x.data.meta.asOf = x.data.plan.opening.asOf = day;
  x.payload.fetchedAt = day + 'T20:00:00Z';
  x.payload.transactionWindow.endDate = day;
  for (const a of x.payload.accounts) {
    a.updated_at = day + 'T19:00:00Z';
    if (Object.hasOwn(a, 'balance_last_update')) a.balance_last_update = day + 'T19:00:00Z';
  }
  const raw = { id: 'invented-savings-fee', account_id: '9003', date: '2026-10-07',
    amount: '1.25', currency: 'cad', is_pending: false, payee: 'Invented Savings fee' };
  if (mode === 'undated' || mode === 'undated-pending') delete raw.date;
  if (mode === 'undated-pending' || mode === 'pending') raw.is_pending = true;
  if (mode === 'null-amount') raw.amount = null;
  if (mode === 'malformed-amount') raw.amount = '$1.25';
  if (mode === 'foreign-currency') raw.currency = 'usd';
  if (mode === 'missing-currency') delete raw.currency;
  if (mode === 'malformed-date') raw.date = 'not-a-date';
  if (mode === 'incomplete') x.payload.transactionWindow.complete = false;
  if (mode === 'pending-incomplete') x.payload.pendingCoverage.complete = false;
  if (mode === 'sanitization-fallback') raw.category_name = 'Bearer SYNTHETIC_SANITIZER_CONTROL';
  if (mode === 'unrelated-undated') { raw.account_id = '9001'; delete raw.date; }
  if (mode === 'collapsed-valid' || mode === 'collapsed-foreign' || mode === 'collapsed-missing-currency') {
    raw.plaid_metadata = { transaction_id: 'invented-posted', pending_transaction_id: 'invented-pending' };
    const pending = { ...raw, id: 'invented-pending', is_pending: true,
      plaid_metadata: { transaction_id: 'invented-pending' } };
    if (mode === 'collapsed-foreign') pending.currency = 'usd';
    if (mode === 'collapsed-missing-currency') delete pending.currency;
    x.payload.transactions.push(pending);
  }
  if (mode === 'valid-transfer') {
    x.payload.accounts[0].balance = '190'; x.payload.accounts[2].balance = '105';
    x.payload.transactions.push(
      { id: 'invented-source', account_id: '9001', date: '2026-10-07', amount: '10', currency: 'cad',
        is_pending: false, kind: 'transfer', original_name: 'DD404 TFR-TO Invented reserve' },
      { id: 'invented-destination', account_id: '9003', date: '2026-10-07', amount: '-10', currency: 'cad',
        is_pending: false, kind: 'transfer', original_name: 'DD404 TFR-FR Invented operating' });
  } else x.payload.transactions.push(raw);
  const original = JSON.stringify(x);
  const report = O.observe({ provider: 'lunchmoney', ...x });
  assert.equal(JSON.stringify(x), original, 'observer input is immutable');
  const packetBytes = JSON.stringify(report.currentPeriodActuals), poolsBytes = JSON.stringify(report.savingsPools);
  const { data } = L.overlayLiveState({ data: x.data, report });
  assert.deepEqual(data.plan.savingsPoolObservation, report.savingsPools);
  assert.deepEqual(data.liveOverlay.currentPeriodActuals, report.currentPeriodActuals);
  assert.equal(JSON.stringify(report.currentPeriodActuals), packetBytes, 'produced actuals stay unchanged');
  assert.equal(JSON.stringify(report.savingsPools), poolsBytes, 'produced observations stay unchanged');
  const advice = F.recommend(data.plan, data.meta.asOf, { weeklyVariable: 40, debts: data.debts, ...data.liveOverlay });
  assert.equal(JSON.stringify(report.currentPeriodActuals), packetBytes, 'Forecast cannot patch a produced packet');
  assert.equal(JSON.stringify(report.savingsPools), poolsBytes);
  return { input: x, report, data, advice };
}
module.exports = observed;

// Independent metadata controls. No bank-date-to-window coverage requirement:
// the default balances are from the prior year, but this fetch is complete.
const windowMutations = {
  complete: () => {},
  wrongSchema: p => { p.schema = 'unrecognized'; },
  missingCoverage: p => { delete p.transactionCoverage; },
  unknownCoverage: p => { p.transactionCoverage = 'unknown'; },
  truncated: p => { p.transactionCoverage = 'truncated'; },
  incompleteUnexplained: p => { p.transactionCoverage = 'incomplete'; },
  contradictoryCoverage: p => { p.transactionCoverage = { complete: true, truncated: true }; },
  unconfirmedCoverageStatus: p => { p.transactionCoverage = { complete: true, status: 'unknown' }; },
  unconfirmedPendingStatus: p => { p.pendingCoverage = { complete: true, status: 'bounded-window' }; },
  missingObservation: p => { delete p.observationAsOf; },
  impossibleObservation: p => { p.observationAsOf = '2026-02-30'; },
  futureObservation: p => { p.observationAsOf = '2026-10-06'; },
  mismatchedCheck: p => { p.observationAsOf = '2026-10-04'; },
  missingStart: p => { delete p.coverageStart; },
  impossibleStart: p => { p.coverageStart = '2026-02-30'; },
  missingThrough: p => { delete p.coverageThrough; },
  impossibleThrough: p => { p.coverageThrough = '2026-02-30'; },
  futureThrough: p => { p.coverageThrough = '2026-10-06'; },
  reversed: p => { p.coverageStart = '2026-10-05'; p.coverageThrough = '2026-10-02'; },
  incompleteCheckTail: p => { p.coverageThrough = '2026-10-04'; },
  pendingUnknown: p => { p.pendingCoverage = 'unknown'; },
  pendingMissing: p => { delete p.pendingCoverage; },
  unrelatedFlag: p => { p.savingsMovementUnconfirmed = [
    { accountId: 'chequing-b', reason: 'transaction-amount-or-date-unconfirmed' }]; },
};
const rawWindowModes = ['raw-truncated', 'raw-missing-window', 'raw-impossible-start', 'raw-future-end', 'raw-incomplete-end'];
const sourceWindowModes = ['source-missing-completion', 'source-null-completion', 'source-string-completion',
  'source-missing-dates', 'source-missing-window', 'source-timestamp-dates', 'source-conflicting-dates',
  'source-has-more', 'source-truncated', 'source-malformed-flag'];
function windowObservation(mode = 'complete', list = 'empty', bank = 'prior-year') {
  const x = fx.input(bank); delete x.data.liveOverlay;
  if (list !== 'empty') x.payload.transactions.push({ id: 'invented-window-control',
    account_id: list === 'zero' ? '9003' : '9001', date: mode.startsWith('source-') ? x.data.meta.asOf : '2026-10-03',
    amount: list === 'zero' ? '0' : '1', currency: 'cad', is_pending: false });
  if (mode === 'raw-truncated') x.payload.transactionWindow.truncated = true;
  if (mode === 'raw-missing-window') delete x.payload.transactionWindow;
  if (mode === 'raw-impossible-start') x.payload.transactionWindow.startDate = '2026-02-30';
  if (mode === 'raw-future-end') x.payload.transactionWindow.endDate = '2026-10-06';
  if (mode === 'raw-incomplete-end') x.payload.transactionWindow.endDate = '2026-10-04';
  if (mode === 'source-missing-completion') for (const key of ['complete', 'hasMore', 'truncated']) delete x.payload.transactionWindow[key];
  if (mode === 'source-null-completion') for (const key of ['complete', 'hasMore', 'truncated']) x.payload.transactionWindow[key] = null;
  if (mode === 'source-string-completion') x.payload.transactionWindow.complete = 'true';
  if (mode === 'source-missing-dates') { delete x.payload.transactionWindow.startDate; delete x.payload.transactionWindow.endDate; }
  if (mode === 'source-missing-window') delete x.payload.transactionWindow;
  if (mode === 'source-timestamp-dates') { x.payload.transactionWindow.startDate += 'T00:00:00Z'; x.payload.transactionWindow.endDate += 'T00:00:00Z'; }
  if (mode === 'source-conflicting-dates') x.payload.transactionWindow.start_date = '2026-10-01';
  if (mode === 'source-has-more') x.payload.transactionWindow.hasMore = true;
  if (mode === 'source-truncated') x.payload.transactionWindow.truncated = true;
  if (mode === 'source-malformed-flag') x.payload.transactionWindow.hasMore = 'false';
  if (mode === 'unrelated-card' || mode === 'card-with-savings-fee') {
    x.data.debts = [{ id: 'invented-card', label: 'Invented card', balance: 10, pending: 0, limit: 100,
      rate: 0, confidence: 'verified', structure: 'Revolving credit' }];
    x.accountMap.mappings.push({ providerAccountId: '9005', atlasRole: 'revolving-credit',
      canonical: { collection: 'debts', id: 'invented-card' } });
    x.payload.accounts.push({ id: '9005', type: 'credit', balance: '10', currency: 'cad',
      balance_last_update: x.data.meta.asOf + 'T19:00:00Z', limit: '100' });
    x.payload.transactions.push({ id: 'invented-unknown-card', account_id: '9005',
      date: '2026-10-03', amount: null, currency: 'cad', is_pending: false });
    if (mode === 'card-with-savings-fee') x.payload.transactions.push({ id: 'invented-qualified-fee',
      account_id: '9003', date: '2026-10-03', amount: '1.25', currency: 'cad', is_pending: false });
  }
  if (mode === 'unrelated-unmapped') x.payload.transactions.push({ id: 'invented-unmapped-row',
    account_id: 'unrelated-unknown-account', date: '2026-10-03', amount: '1', currency: 'cad', is_pending: false });
  const inputBytes = JSON.stringify(x), report = O.observe({ provider: 'lunchmoney', ...x });
  assert.equal(JSON.stringify(x), inputBytes);
  const original = JSON.stringify(report);
  const data = L.overlayLiveState({ data: x.data, report }).data;
  assert.deepEqual(data.plan.savingsPoolObservation, report.savingsPools);
  assert.deepEqual(data.liveOverlay.currentPeriodActuals, report.currentPeriodActuals);
  let packet = report.currentPeriodActuals;
  if (Object.hasOwn(windowMutations, mode) && !['complete', 'unrelatedFlag'].includes(mode)) {
    packet = JSON.parse(JSON.stringify(packet)); windowMutations[mode](packet);
  } else if (mode === 'unrelatedFlag') {
    packet = JSON.parse(JSON.stringify(packet)); windowMutations[mode](packet);
  }
  assert.equal(JSON.stringify(report), original);
  return { input: x, data, report, packet, originalReport: original };
}
module.exports.windowObservation = windowObservation;
module.exports.windowModes = Object.keys(windowMutations);
module.exports.rawWindowModes = rawWindowModes;
module.exports.sourceWindowModes = sourceWindowModes;
const postingModes = ['absent', 'null', 'string-false', 'string-true', 'zero', 'one', 'object', 'posted', 'pending'];
function postingObservation(shape = 'direct', mode = 'posted') {
  const x = fx.input('valid-v2'); delete x.data.liveOverlay;
  const debit = { id: 'invented-posting-debit', account_id: '9001', date: '2026-10-03', amount: '10',
    currency: 'cad', is_pending: false, kind: 'transfer', original_name: 'DD404 TFR-TO Invented reserve' };
  const credit = { id: 'invented-posting-credit', account_id: '9003', date: '2026-10-03', amount: '-10',
    currency: 'cad', is_pending: false, kind: 'transfer', original_name: 'DD404 TFR-FR Invented cash' };
  const fee = { id: 'invented-posting-fee', account_id: shape === 'unrelated' ? '9001' : '9003',
    date: '2026-10-03', amount: '1.25', currency: 'cad', is_pending: false };
  const paired = ['counterparty', 'savings-leg'].includes(shape);
  const prior = { ...fee, id: 'invented-posting-pending', is_pending: true,
    plaid_metadata: { transaction_id: 'invented-posting-pending' } };
  if (shape === 'collapsed') fee.plaid_metadata = { transaction_id: fee.id, pending_transaction_id: prior.id };
  const target = shape === 'collapsed' ? prior : paired
    ? shape === 'counterparty' ? debit : credit : fee;
  x.payload.transactions = shape === 'collapsed' ? [prior, fee] : paired ? [debit, credit] : [fee];
  const values = { null: null, 'string-false': 'false', 'string-true': 'true', zero: 0, one: 1, object: {}, posted: false, pending: true };
  if (mode === 'absent') delete target.is_pending; else target.is_pending = values[mode];
  if (shape === 'dropped') delete target.date;
  const inputBytes = JSON.stringify(x), report = O.observe({ provider: 'lunchmoney', ...x });
  assert.equal(JSON.stringify(x), inputBytes);
  const originalReport = JSON.stringify(report), data = L.overlayLiveState({ data: x.data, report }).data;
  assert.deepEqual(data.liveOverlay.currentPeriodActuals, report.currentPeriodActuals);
  assert.deepEqual(data.plan.savingsPoolObservation, report.savingsPools);
  return { input: x, data, report, packet: report.currentPeriodActuals, originalReport, rawId: target.id };
}
module.exports.postingModes = postingModes;
module.exports.postingObservation = postingObservation;
