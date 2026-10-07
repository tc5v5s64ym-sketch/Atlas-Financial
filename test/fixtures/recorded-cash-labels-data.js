'use strict';
// Independent invented cash observations. No household ledger or scaled data.
function history(longLabels = false) {
  const names = longLabels
    ? ['Invented Bills account for recurring household payments with a deliberately long descriptive name',
      'Invented Weekly account with a deliberately long descriptive name', 'Invented designated reserve ' + 'LongLabel'.repeat(24)]
    : ['Invented Bills', 'Invented Weekly', 'Invented Reserve'];
  const ids = ['chequing-a', 'chequing-b', 'savings'];
  const snap = (asOf, values) => ({ schema: 'atlas-balance-snapshot/v1', asOf,
    role: 'historical-observation', currentStateAuthority: 'data.json',
    spendableCoverage: { expectedIds: ids.slice(), complete: true },
    accounts: ids.map((id, i) => ({ id, label: names[i], collection: 'cash', side: 'asset',
      currency: 'CAD', pot: 'spendable', balance: values[i],
      provenance: { canonicalLocator: 'cash:' + id, observationId: 'invented-' + id, sourceAsOf: asOf } })) });
  return { snapshots: [snap('2026-08-11', [1247.31, 286.42, 973.58]),
    snap('2026-08-12', [1047.31, 286.42, 1173.58])] };
}
function data() {
  const fx = require('./budget-surface-data'), O = require('../../scripts/provider-observe'), L = require('../../scripts/live-plan');
  const canonical = fx.canonical(), payload = fx.payload();
  // Give this independently invented fixture a material reserve. Observe it
  // through the same native boundary as the other synthetic Budget accounts.
  canonical.plan.startingCash.breakdown.find(r => r.id === 'savings').value = 973.58;
  payload.accounts.find(r => String(r.id) === '1003').balance = 973.58;
  const report = O.observe({ provider: 'lunchmoney', data: canonical, payload,
    accountMap: fx.map, identityRules: fx.identity.rules || fx.identity, asOf: fx.AS_OF });
  const out = L.overlayLiveState({ data: canonical, report }).data;
  out.meta = { ...out.meta, title: 'Invented cash scope proof', coverage: 'Invented accounts only',
    transactions: 0, statements: 0, disclaimer: 'Independent invented fixtures' };
  out.plan.startingCash.note = 'Chequing A, Chequing B and Savings — as observed 2026-08-20. Invented business funds remain excluded.';
  out.plan.assumptions = ['Chequing A, Chequing B and Savings as of 2026-08-20. This fixture grants no spending permission.'];
  out.questions = []; out.paypal = { categories: [], perMonth: 0, crossCheck: 0, note: 'Invented empty evidence' };
  out.unexplained = []; out.spending = []; out.fees = []; out.settled = [];
  out.assets = []; out.helocHistory = []; out.income = []; out.incomeCaptureMonths = 1;
  return out;
}
module.exports = { data, history };
