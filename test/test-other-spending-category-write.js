'use strict';
/*
 * Owner-authorized Other Spending category correction.
 *
 * Proves the write seam is one exact current Other transaction, one existing
 * provider category, category_id only, with opaque browser handles and no
 * optimistic/canonical mutation. Network I/O is injected; no real provider is
 * contacted by this suite.
 */

const fs = require('fs');
const path = require('path');
const W = require('../scripts/lunchmoney-category-write.js');

const ROOT = path.join(__dirname, '..');
let failures = 0;
function ok(condition, label, detail = '') {
  if (!condition) failures += 1;
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }

const SECRET = 'test-session-secret-for-category-write';
const TOKEN = 'test-lunchmoney-token';
const NOW = '2026-09-04T18:00:00.000Z';
const ENV = {
  ATLAS_LIVE_OVERLAY: 'live',
  ATLAS_LUNCHMONEY_API_BASE: 'http://127.0.0.1:39999/v2',
};
const IDENTITY = { rules: [], billPaymentPayees: [] };
const ACCOUNT_MAP = {
  schema: 'atlas-provider-account-map/v1',
  provider: 'lunchmoney',
  mappings: [
    { providerAccountId: '1001', atlasRole: 'household-cash', canonical: { collection: 'cash', id: 'chequing-a' } },
  ],
};
const DATA = {
  debts: [],
  plan: {
    defaults: { targetBuffer: 500 },
    startingCash: {
      breakdown: [{ id: 'chequing-a', label: 'BILLS ACCOUNT', value: 8000 }],
      heldElsewhere: [],
    },
    opening: { asOf: '2026-08-28', representedEvents: [] },
    income: [{
      id: 'payroll', label: 'Payroll — Seaspan', frequency: 'biweekly',
      anchor: '2026-08-14', amount: 4264, confidence: 'confirmed',
    }],
    bills: [],
    obligations: [],
    commitments: [],
    budget: {
      categories: [
        { id: 'groceries', label: 'Groceries', class: 'essential', plannedWeekly: 450, ownerLine: 'Groceries' },
        { id: 'fuel', label: 'Fuel', class: 'essential', from: ['Fuel'], plannedPayday: 325, ownerLine: 'Fuel' },
        { id: 'household', label: 'Household', class: 'essential', plannedPayday: 37.5, ownerLine: 'Household' },
        { id: 'pets', label: 'Pets', class: 'essential', plannedPayday: 100, ownerLine: 'Dog food' },
        { id: 'restaurants', label: 'Dining', class: 'discretionary', from: ['Restaurants', 'Dining', 'Fast Food', 'Food Delivery'], plannedPayday: 200, ownerLine: 'Eating out' },
        { id: 'dale-guilt-free', label: 'Dale guilt-free spending', class: 'discretionary', plannedPayday: 150, ownerLine: 'Dale guilt-free spending' },
        { id: 'amanda-guilt-free', label: 'Amanda guilt-free spending', class: 'discretionary', plannedPayday: 150, ownerLine: 'Amanda guilt-free spending' },
        // Incumbent non-target informational categories must not be offered as
        // destinations merely because they exist in plan.budget.categories.
        { id: 'shopping', label: 'Shopping', class: 'discretionary', from: ['Shopping', 'Personal'] },
      ],
    },
  },
};

function payload(categoryId = 901) {
  return {
    fetchedAt: NOW,
    accounts: [],
    categories: [
      { id: 901, name: 'Shopping', is_group: false },
      { id: 902, name: 'Groceries', is_group: false },
      { id: 903, name: 'Restaurants', is_group: false },
      { id: 904, name: 'Fuel', is_group: false },
      { id: 999, name: 'Archived', is_group: false, archived_at: '2026-01-01T00:00:00Z' },
    ],
    tags: [],
    transactions: [
      {
        id: 501, account_id: 1001, date: '2026-09-04', amount: 75,
        payee: 'LOCAL SHOP', original_name: 'LOCAL SHOP', category_id: categoryId,
        is_pending: false, status: 'reviewed', notes: 'private provider note',
      },
      {
        id: 502, account_id: 1001, date: '2026-09-04', amount: 25,
        payee: 'CAFE', original_name: 'CAFE', category_id: 903,
        is_pending: false, status: 'reviewed',
      },
      {
        id: 503, account_id: 1001, date: '2026-09-04', amount: 35,
        payee: 'PENDING SHOP', original_name: 'PENDING SHOP', category_id: 901,
        is_pending: true, status: 'unreviewed',
      },
      {
        id: 504, account_id: 1001, date: '2026-08-27', amount: 40,
        payee: 'OLD SHOP', original_name: 'OLD SHOP', category_id: 901,
        is_pending: false, status: 'reviewed',
      },
    ],
    pendingCoverage: {
      complete: true,
      hasMore: false,
      truncated: false,
      basis: 'is_pending-unbounded',
      requiredEvidence: 'GET /v2/transactions?is_pending=true with no start_date/end_date, paginated through has_more=false',
    },
    transactionWindow: {
      startDate: '2026-08-21', endDate: '2026-09-04',
      complete: true, hasMore: false, truncated: false,
    },
  };
}

function opts(p) {
  return {
    env: ENV,
    data: DATA,
    secret: SECRET,
    now: NOW,
    token: TOKEN,
    accountMap: ACCOUNT_MAP,
    identity: IDENTITY,
    payload: p,
  };
}

(async function main() {
  console.log('\n=== 1. only current posted Other Spending is editable ===');
  const startingData = JSON.stringify(DATA);
  const startingDataFile = fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8');
  const firstPayload = payload();
  const list = await W.listEditable(opts(firstPayload));
  ok(list.schema === W.SCHEMA && list.asOf === '2026-09-04', 'editor publishes its bounded schema and live date');
  ok(Array.isArray(list.transactions) && list.transactions.length === 1,
    'only the current posted Other Spending transaction is editable', JSON.stringify(list.transactions));
  const row = list.transactions[0];
  ok(row && row.merchant === 'LOCAL SHOP' && row.amount === 75 && row.currentCategory === 'Shopping',
    'safe transaction identity is enough for the household to recognize the row');
  ok(/^h1\.[A-Za-z0-9_-]+$/.test(row.transactionHandle), 'browser receives an opaque transaction handle');
  const blob = JSON.stringify(list);
  ok(!blob.includes('providerTransactionId') && !blob.includes('providerAccountId')
      && !blob.includes('private provider note') && !blob.includes(TOKEN)
      && !blob.includes('"501"') && !blob.includes('"1001"'),
    'public editor packet contains no raw provider ids, notes, or token');
  ok(!list.transactions.some(tx => tx.merchant === 'PENDING SHOP' || tx.merchant === 'OLD SHOP' || tx.merchant === 'CAFE'),
    'pending, outside-cycle, and already-classified transactions are absent');

  console.log('\n=== 2. destinations are existing targeted Household Budget lines ===');
  const dining = row.options.find(option => option.householdBudgetId === 'restaurants');
  ok(!!dining && dining.lunchMoneyLabel === 'Restaurants' && dining.householdBudgetLabel === 'Dining',
    'existing Restaurants provider category maps through Forecast to the incumbent Dining line');
  ok(!row.options.some(option => option.householdBudgetId === 'shopping'),
    'non-target informational Shopping is not offered as a Household Budget destination');
  ok(!row.options.some(option => option.lunchMoneyLabel === 'Archived'),
    'archived provider categories are not offered');

  console.log('\n=== 3. stale or forged handles cannot write ===');
  let puts = 0;
  try {
    await W.applyCategory(Object.assign(opts(payload()), {
      transactionHandle: W.opaqueHandle(SECRET, 'transaction', '999999'),
      categoryHandle: dining.categoryHandle,
      putJson: async () => { puts += 1; return {}; },
    }));
    ok(false, 'stale transaction handle rejects');
  } catch (err) {
    ok(err.code === 'stale-transaction' && puts === 0, 'stale transaction handle rejects before provider write');
  }
  try {
    await W.applyCategory(Object.assign(opts(payload()), {
      transactionHandle: row.transactionHandle,
      categoryHandle: W.opaqueHandle(SECRET, 'category', '888888'),
      putJson: async () => { puts += 1; return {}; },
    }));
    ok(false, 'forged category handle rejects');
  } catch (err) {
    ok(err.code === 'invalid-category' && puts === 0, 'category not in the current allowed set cannot write');
  }

  console.log('\n=== 4. valid confirmation writes category_id only to the exact provider transaction ===');
  let observedUrl = null;
  let observedToken = null;
  let observedBody = null;
  const writablePayload = payload();
  const result = await W.applyCategory(Object.assign(opts(writablePayload), {
    transactionHandle: row.transactionHandle,
    categoryHandle: dining.categoryHandle,
    putJson: async (url, token, body) => {
      puts += 1;
      observedUrl = String(url);
      observedToken = token;
      observedBody = clone(body);
      writablePayload.transactions.find(tx => tx.id === 501).category_id = 903;
      return { id: 501, category_id: 903 };
    },
  }));
  ok(puts === 1, 'one confirmation issues exactly one provider write');
  ok(/\/v2\/transactions\/501$/.test(observedUrl), 'provider write targets the exact server-resolved transaction id');
  ok(observedToken === TOKEN, 'configured provider token is used only server-side');
  ok(JSON.stringify(Object.keys(observedBody).sort()) === JSON.stringify(['category_id'])
      && observedBody.category_id === 903,
    'provider PUT body contains category_id and no other mutable field', JSON.stringify(observedBody));
  ok(result.updated === true && result.householdBudgetId === 'restaurants',
    'successful provider confirmation returns the incumbent Household Budget destination');
  ok(JSON.stringify(DATA) === startingData && fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8') === startingDataFile,
    'successful write does not mutate canonical Atlas data or data.json');

  console.log('\n=== 5. read-after-write naturally leaves Other after provider confirmation ===');
  const after = await W.listEditable(opts(writablePayload));
  ok(!after.transactions.some(tx => tx.merchant === 'LOCAL SHOP'),
    'after Lunch Money reports Restaurants, Forecast no longer returns that transaction as Other');

  console.log('\n=== 6. provider failure is fail-closed with no local mutation ===');
  const rejectedPayload = payload();
  const beforeReject = JSON.stringify(rejectedPayload);
  let rejectedWrites = 0;
  try {
    await W.applyCategory(Object.assign(opts(rejectedPayload), {
      transactionHandle: row.transactionHandle,
      categoryHandle: dining.categoryHandle,
      putJson: async () => {
        rejectedWrites += 1;
        const err = new Error('provider refused');
        err.code = 'provider-write-failed';
        throw err;
      },
    }));
    ok(false, 'provider rejection must throw');
  } catch (err) {
    ok(err.code === 'provider-write-failed' && rejectedWrites === 1,
      'provider rejection is surfaced without a second write attempt');
  }
  ok(JSON.stringify(rejectedPayload) === beforeReject && JSON.stringify(DATA) === startingData,
    'rejected provider write leaves provider fixture and Atlas canonical data unchanged');

  console.log('\n=== 7. application boundary is authenticated, explicit, and non-optimistic ===');
  const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const clientSrc = fs.readFileSync(path.join(ROOT, 'public', 'other-spending-category.js'), 'utf8');
  const indexSrc = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const gateAt = serverSrc.indexOf('// ---------------------------------------------------------------- gate');
  const routeAt = serverSrc.indexOf("app.post('/api/other-spending/category'");
  ok(gateAt >= 0 && routeAt > gateAt,
    'production category POST exists only after the incumbent browser-session gate');
  ok(/req\.path\.startsWith\('\/api\/'\)/.test(serverSrc),
    'unauthenticated API requests fail as JSON rather than redirecting into the login page');
  ok(/window\.confirm\(/.test(clientSrc)
      && /This will update this transaction’s category in Lunch Money\./.test(clientSrc),
    'browser requires explicit per-transaction confirmation naming the provider write');
  ok(/window\.location\.reload\(\)/.test(clientSrc)
      && !/innerHTML\s*=/.test(clientSrc),
    'UI waits for success then reloads; it neither mutates totals optimistically nor injects provider HTML');
  ok(/other-spending-category\.js/.test(indexSrc) && /other-spending-category\.css/.test(indexSrc),
    'Plan page loads the bounded editor assets');
  ok(!/underlying review was read-only throughout/.test(indexSrc)
      && /updates only that transaction’s category in\s*\n?\s*Lunch Money/.test(indexSrc),
    'footer no longer falsely claims every provider interaction is read-only');

  if (failures) {
    console.error(`\n${failures} assertion(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll Other Spending category-write assertions passed.');
})().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
