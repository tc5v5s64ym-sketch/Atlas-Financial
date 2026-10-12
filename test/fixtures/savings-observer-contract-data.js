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
