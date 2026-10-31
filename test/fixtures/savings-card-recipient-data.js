'use strict';
// All identities, amounts, dates and descriptions below are invented.
const path = require('node:path'), assert = require('node:assert/strict');
const root = process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '../..');
const O = require(path.join(root, 'scripts/provider-observe'));
const L = require(path.join(root, 'scripts/live-plan'));
const F = require(path.join(root, 'public/forecast'));
const fx = require('./savings-v2-observation-data');
function source(mode = 'recognized', account = '9003') {
  const x = fx.input('valid-v2'); delete x.data.liveOverlay;
  const tx = { id: 'invented-card-out', account_id: account, date: '2026-10-03',
    amount: '7.25', currency: 'cad', is_pending: false, kind: 'transfer',
    original_name: 'ZX777 TFR-TO C/C', payee: 'Invented provider transfer label' };
  if (mode === 'ordinary-transfer') tx.original_name = 'ZX777 TFR-TO Invented reserve';
  if (mode === 'unknown-destination') tx.original_name = 'ZX777 TFR-TO';
  if (mode === 'payee-lookalike') { delete tx.original_name; tx.payee = 'ZX777 TFR-TO C/C'; }
  if (mode === 'note-lookalike') { tx.original_name = 'ZX777 TFR-TO'; tx.notes = 'ZX777 TFR-TO C/C'; }
  if (mode === 'suffix-unknown') tx.original_name = 'ZX777 TFR-TO C/C Invented ambiguous suffix';
  if (mode === 'prefix-unknown') tx.original_name = 'Invented text ZX777 TFR-TO C/C';
  if (mode === 'hint-only') { tx.original_name = 'ZX777 TFR-TO'; tx.kind = 'card-payment'; }
  if (mode === 'wrong-direction') { tx.original_name = 'ZX777 TFR-FR C/C'; tx.amount = '-7.25'; }
  if (mode === 'wrong-sign') tx.amount = '-7.25';
  if (mode === 'plain-debit') { tx.original_name = 'Invented fee'; tx.kind = null; }
  if (mode === 'pending') tx.is_pending = true;
  if (mode === 'posting-unknown') delete tx.is_pending;
  if (mode === 'foreign') tx.currency = 'usd';
  if (mode === 'missing-currency') delete tx.currency;
  if (mode === 'same-day-cutoff') tx.date = x.data.meta.asOf;
  if (mode === 'before-cutoff') x.payload.accounts[Number(account) - 9001].balance_last_update = '2026-10-02T19:00:00Z';
  if (mode === 'window-incomplete') x.payload.transactionWindow.complete = false;
  if (mode === 'pending-incomplete') x.payload.pendingCoverage.complete = false;
  x.payload.transactions.push(tx);
  if (mode === 'pending-twin') x.payload.transactions.push({ ...tx, id: 'invented-pending-twin', is_pending: true });
  if (mode === 'reference-replay') x.payload.transactions.push({ ...tx, id: 'invented-second-card-out' });
  if (mode === 'cash-contradiction' || mode === 'cash-pair') {
    if (mode === 'cash-pair') tx.original_name = 'ZX777 TFR-TO Invented operating';
    x.payload.transactions.push({ ...tx, id: 'invented-cash-in', account_id: '9001', amount: '-7.25',
      original_name: 'ZX777 TFR-FR Invented reserve' });
  }
  if (mode === 'unrelated-card-credit' || mode === 'reference-card-credit') {
    x.data.debts = [{ id: 'invented-card', label: 'Invented card', balance: 10, pending: 0, limit: 100,
      rate: 0, confidence: 'verified', structure: 'Revolving credit' }];
    x.accountMap.mappings.push({ providerAccountId: '9005', atlasRole: 'revolving-credit',
      canonical: { collection: 'debts', id: 'invented-card' } });
    x.payload.accounts.push({ id: '9005', type: 'credit', balance: '10', currency: 'cad',
      balance_last_update: x.data.meta.asOf + 'T19:00:00Z', limit: '100' });
    x.payload.transactions.push({ ...tx, id: 'invented-card-in', account_id: '9005', amount: '-7.25',
      original_name: mode === 'reference-card-credit' ? 'ZX777 TFR-FR Invented payment' : 'PAYMENT THANK YOU',
      payee: 'Invented card credit' });
  }
  const before = JSON.stringify(x), report = O.observe({ provider: 'lunchmoney', ...x });
  assert.equal(JSON.stringify(x), before, 'producer cannot modify invented evidence');
  const reportBefore = JSON.stringify(report), data = L.overlayLiveState({ data: x.data, report }).data;
  assert.equal(JSON.stringify(report), reportBefore);
  const dataBefore = JSON.stringify(data), advice = F.recommend(data.plan, data.meta.asOf,
    { ...data.liveOverlay, debts: data.debts, weeklyVariable: 40 });
  assert.equal(JSON.stringify(data), dataBefore);
  assert.equal(JSON.stringify(report), reportBefore);
  return { input: x, report, data, advice };
}
module.exports = { source, root };
