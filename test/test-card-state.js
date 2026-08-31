'use strict';
/* B91 D8 — credit-card posted vs pending vs limit vs available vs payment.
 *
 * Acceptance corpus: docs/source_intake/PAYDAY_ACCEPTANCE_2026-08-14.md
 * Quantitative institution figures: 2026-08-09 ACCOUNT_FACTS / positions.csv.
 * Live card canonical state is unchanged. Synthetic fixture values are proofs,
 * not household evidence.
 *
 * Independent proof: hand arithmetic on named posted/pending/payment amounts.
 * That is not a second call to Forecast.openingBalance or utilisation.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const F = require('../public/forecast.js');
const R = require('../scripts/reconcile.js');
const live = require('../data.json');
const cards = require('../docs/reconciliation/card-state-observations.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const money = n => (n == null ? 'null' : '$' + Number(n).toFixed(2));
const hashFile = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const POSTED = 4800;
const PENDING = 300;
const COLLAPSED = 5100;
const LIMIT = 5000;
const AVAILABLE = 200;
const PAYMENT = 500;
const START = '2026-08-14';

function emptySide() {
  return { observations: [] };
}

function debtFixture(extra) {
  return Object.assign({
    id: 'synth-card',
    label: 'Synthetic card',
    balance: POSTED,
    pending: PENDING,
    limit: LIMIT,
  }, extra || {});
}

function runCards(data, observations) {
  return R.reconcile({
    data,
    map: { mappings: [] },
    observations: [],
    settlements: emptySide(),
    utility: emptySide(),
    amanda: emptySide(),
    cards: { observations },
  });
}

function independentExposure(posted, pending) {
  return Math.round((Number(posted) + Number(pending)) * 100) / 100;
}

console.log('=== 1. posted $4,800 + pending $300 is not silently posted $5,100 ===');
{
  const independent = independentExposure(POSTED, PENDING);
  ok(near(independent, COLLAPSED), 'independent posted+pending is $5,100');
  ok(POSTED !== COLLAPSED && PENDING !== COLLAPSED,
    'neither posted nor pending equals the collapsed $5,100');

  const result = runCards(
    { meta: { asOf: START }, debts: [debtFixture()] },
    [
      {
        observationId: 'synth-posted',
        fact: 'posted-balance',
        cardId: 'synth-card',
        amount: POSTED,
        observedAsOf: START,
        canonical: { collection: 'debts', id: 'synth-card', field: 'balance' },
      },
      {
        observationId: 'synth-pending',
        fact: 'pending',
        cardId: 'synth-card',
        amount: PENDING,
        observedAsOf: START,
        canonical: { collection: 'debts', id: 'synth-card', field: 'pending' },
      },
    ]
  );
  const posted = result.rows.find(r => r.observationId === 'synth-posted');
  const pending = result.rows.find(r => r.observationId === 'synth-pending');
  ok(posted && posted.status === 'MATCH' && near(posted.evidenceValue, POSTED)
    && near(posted.canonicalValue, POSTED) && !near(posted.evidenceValue, COLLAPSED),
    'posted fact stays $4,800, not $5,100');
  ok(pending && pending.status === 'MATCH' && near(pending.evidenceValue, PENDING)
    && !near(pending.evidenceValue, COLLAPSED),
    'pending fact stays $300, not folded into posted');
  const exposure = R.cardExposure({ posted: POSTED, pending: PENDING, payments: [] });
  ok(exposure.unknown !== true && near(exposure.amount, independent),
    'exposure is independently $5,100 while posted remains $4,800', money(exposure.amount));
  const alreadyIncludes = R.cardExposure({
    posted: COLLAPSED, pending: PENDING, balanceIncludesPending: true, payments: [],
  });
  ok(alreadyIncludes.unknown !== true && near(alreadyIncludes.amount, COLLAPSED),
    'posted that already includes pending is not posted+pending again', money(alreadyIncludes.amount));

  const included = runCards(
    { meta: { asOf: START }, debts: [debtFixture({ balance: COLLAPSED })] },
    [
      {
        observationId: 'synth-posted-includes',
        fact: 'posted-balance',
        cardId: 'synth-card',
        amount: COLLAPSED,
        balanceIncludesPending: true,
        observedAsOf: START,
        canonical: { collection: 'debts', id: 'synth-card', field: 'balance' },
      },
      {
        observationId: 'synth-pending-includes',
        fact: 'pending',
        cardId: 'synth-card',
        amount: PENDING,
        observedAsOf: START,
        canonical: { collection: 'debts', id: 'synth-card', field: 'pending' },
      },
    ]
  );
  const includedSummary = (included.cardSummaries || []).find(c => c.cardId === 'synth-card');
  ok(includedSummary && includedSummary.balanceIncludesPending === true
    && includedSummary.exposureUnknown !== true
    && near(includedSummary.exposure, COLLAPSED)
    && !near(includedSummary.exposure, independentExposure(COLLAPSED, PENDING)),
    'summary carries balanceIncludesPending and does not add pending again',
    money(includedSummary && includedSummary.exposure));
}

console.log('\n=== 2. pending unknown remains unknown — never $0 ===');
{
  const result = runCards(
    { meta: { asOf: START }, debts: [debtFixture({ pending: 0 })] },
    [{
      observationId: 'synth-pending-unknown',
      fact: 'pending',
      cardId: 'synth-card',
      amount: null,
      unknown: true,
      observedAsOf: START,
      canonical: { collection: 'debts', id: 'synth-card', field: 'pending' },
    }]
  );
  const row = result.rows.find(r => r.observationId === 'synth-pending-unknown');
  ok(row && row.unknown === true && row.evidenceValue == null,
    'unknown pending has no invented evidence value');
  ok(row.status === 'MISSING' && row.status !== 'MATCH',
    'unknown pending does not MATCH canonical $0');
  ok(!near(row.evidenceValue || 0, 0) || row.evidenceValue == null,
    'unknown pending is not represented as $0');
  const exposure = R.cardExposure({
    posted: POSTED, pendingUnknown: true, payments: [],
  });
  ok(exposure.unknown === true && exposure.amount == null
    && exposure.reason === 'unknown-pending',
    'unknown pending makes exposure unknown, not posted+$0');
}

console.log('\n=== 3. $5,000 limit creates $0 household cash ===');
{
  ok(near(R.householdCashFromCardCapacity({ limit: LIMIT }), 0),
    'independent capacity helper: $5,000 limit → $0 cash');
  const result = runCards(
    { meta: { asOf: START }, debts: [debtFixture()] },
    [{
      observationId: 'synth-limit',
      fact: 'limit',
      cardId: 'synth-card',
      amount: LIMIT,
      observedAsOf: START,
      canonical: { collection: 'debts', id: 'synth-card', field: 'limit' },
    }]
  );
  const row = result.rows.find(r => r.observationId === 'synth-limit');
  ok(row && row.status === 'MATCH' && near(row.evidenceValue, LIMIT)
    && near(row.householdCash, 0),
    'limit MATCH is still $0 household cash', money(row && row.householdCash));
}

console.log('\n=== 4. $200 available credit creates $0 household cash ===');
{
  ok(near(R.householdCashFromCardCapacity({ availableCredit: AVAILABLE }), 0),
    'independent capacity helper: $200 available → $0 cash');
  const result = runCards(
    { meta: { asOf: START }, debts: [debtFixture()] },
    [{
      observationId: 'synth-available',
      fact: 'available-credit',
      cardId: 'synth-card',
      amount: AVAILABLE,
      observedAsOf: START,
    }]
  );
  const row = result.rows.find(r => r.observationId === 'synth-available');
  ok(row && near(row.evidenceValue, AVAILABLE) && near(row.householdCash, 0)
    && /not household cash/.test(row.canonicalTarget)
    && row.status === 'MISSING' && row.status !== 'MATCH'
    && row.canonicalValue == null,
    'available credit is informational MISSING, not a canonical MATCH, and $0 household cash');
}

console.log('\n=== 5. scheduled $500 does not reduce current card balance ===');
{
  const before = R.cardExposure({ posted: POSTED, pending: 0, payments: [] });
  const after = R.cardExposure({
    posted: POSTED,
    pending: 0,
    payments: [{
      paymentId: 'sched-500', amount: PAYMENT, confirmed: false, posted: false,
    }],
  });
  ok(near(before.amount, POSTED) && near(after.amount, POSTED),
    'independent exposure stays $4,800 with an unconfirmed $500 reminder');
  const result = runCards(
    {
      meta: { asOf: START },
      debts: [debtFixture({ pending: 0 })],
      plan: { obligations: [{ id: 'synth-min', debtId: 'synth-card', amount: PAYMENT }] },
    },
    [{
      observationId: 'synth-scheduled',
      fact: 'scheduled-payment',
      cardId: 'synth-card',
      amount: PAYMENT,
      obligationId: 'synth-min',
      observedAsOf: START,
      canonical: { collection: 'obligations', id: 'synth-min' },
    }]
  );
  const row = result.rows.find(r => r.observationId === 'synth-scheduled');
  ok(row && row.status === 'MATCH' && near(row.canonicalValue, PAYMENT)
    && row.reducesExposure === false && near(row.evidenceValue, PAYMENT),
    'scheduled-payment MATCHes the canonical obligation and does not reduce exposure');
  const posted = runCards(
    { meta: { asOf: START }, debts: [debtFixture({ pending: 0 })] },
    [{
      observationId: 'synth-posted-after-schedule',
      fact: 'posted-balance',
      cardId: 'synth-card',
      amount: POSTED,
      observedAsOf: START,
      canonical: { collection: 'debts', id: 'synth-card', field: 'balance' },
    }]
  ).rows[0];
  ok(posted && near(posted.canonicalValue, POSTED),
    'canonical posted is still $4,800 after the scheduled reminder');
}

console.log('\n=== 6. confirmed $500 posted payment reduces exposure once ===');
{
  const independent = Math.round((POSTED - PAYMENT) * 100) / 100;
  const exposure = R.cardExposure({
    posted: POSTED,
    pending: 0,
    payments: [{
      paymentId: 'pay-500', amount: PAYMENT, confirmed: true, posted: true,
    }],
  });
  ok(near(independent, 4300), 'independent posted − payment is $4,300');
  ok(exposure.unknown !== true && near(exposure.amount, independent),
    'confirmed posted payment reduces exposure to $4,300', money(exposure.amount));
}

console.log('\n=== 7. the same payment cannot reduce exposure twice ===');
{
  const once = R.cardExposure({
    posted: POSTED,
    pending: 0,
    payments: [{
      paymentId: 'pay-500', amount: PAYMENT, confirmed: true, posted: true,
    }],
  });
  const twice = R.cardExposure({
    posted: POSTED,
    pending: 0,
    payments: [
      { paymentId: 'pay-500', amount: PAYMENT, confirmed: true, posted: true },
      { paymentId: 'pay-500', amount: PAYMENT, confirmed: true, posted: true },
    ],
  });
  ok(near(once.amount, twice.amount) && near(twice.amount, 4300),
    'duplicate payment id reduces once, not twice', money(twice.amount));
  const alreadyIn = R.cardExposure({
    posted: POSTED - PAYMENT,
    pending: 0,
    payments: [{
      paymentId: 'pay-500', amount: PAYMENT, confirmed: true, posted: true,
      appliedToPosted: true,
    }],
  });
  ok(near(alreadyIn.amount, POSTED - PAYMENT),
    'a payment already inside posted is not subtracted again', money(alreadyIn.amount));
}

console.log('\n=== 8. same-time contradictions are CONFLICT, not a guessed identity ===');
{
  const conflicted = runCards(
    { meta: { asOf: START }, debts: [debtFixture({ pending: 0 })] },
    [
      {
        observationId: 'synth-posted-a',
        fact: 'posted-balance',
        cardId: 'synth-card',
        amount: POSTED,
        observedAsOf: START,
        canonical: { collection: 'debts', id: 'synth-card', field: 'balance' },
      },
      {
        observationId: 'synth-posted-b',
        fact: 'posted-balance',
        cardId: 'synth-card',
        amount: COLLAPSED,
        observedAsOf: START,
        canonical: { collection: 'debts', id: 'synth-card', field: 'balance' },
      },
    ]
  );
  ok(conflicted.rows.every(r => r.fact === 'posted-balance' && r.status === 'CONFLICT'),
    'same-time posted $4,800 vs $5,100 is CONFLICT, not a silent choice');
  const conflictedSummary = (conflicted.cardSummaries || []).find(c => c.cardId === 'synth-card');
  ok(conflictedSummary && conflictedSummary.postedConflict === true
    && conflictedSummary.posted == null
    && conflictedSummary.exposureUnknown === true
    && conflictedSummary.exposure == null
    && conflictedSummary.exposureReason === 'conflicted-posted'
    && !near(conflictedSummary.exposure || 0, POSTED)
    && !near(conflictedSummary.exposure || 0, COLLAPSED),
    'conflicted posted fails exposure closed instead of publishing the last value');
  const conflictedHelper = R.cardExposure({
    posted: COLLAPSED, pending: 0, postedConflict: true, payments: [],
  });
  ok(conflictedHelper.unknown === true && conflictedHelper.amount == null
    && conflictedHelper.reason === 'conflicted-posted',
    'independent exposure helper fail-closes a conflicted posted group');

  const avail = runCards(
    { meta: { asOf: START }, debts: [debtFixture()] },
    [
      {
        observationId: 'synth-avail-0',
        fact: 'available-credit',
        cardId: 'synth-card',
        amount: 0,
        observedAsOf: START,
      },
      {
        observationId: 'synth-avail-70',
        fact: 'available-credit',
        cardId: 'synth-card',
        amount: 70,
        observedAsOf: START,
      },
    ]
  );
  ok(avail.rows.every(r => r.status === 'CONFLICT') && avail.rows.length === 2,
    'same-time available $0 vs $70 is CONFLICT');

  const limits = runCards(
    { meta: { asOf: START }, debts: [debtFixture()] },
    [
      {
        observationId: 'synth-limit-a',
        fact: 'limit',
        cardId: 'synth-card',
        amount: LIMIT,
        observedAsOf: START,
        canonical: { collection: 'debts', id: 'synth-card', field: 'limit' },
      },
      {
        observationId: 'synth-limit-b',
        fact: 'limit',
        cardId: 'synth-card',
        amount: 6000,
        observedAsOf: START,
        canonical: { collection: 'debts', id: 'synth-card', field: 'limit' },
      },
    ]
  );
  ok(limits.rows.every(r => r.status === 'CONFLICT'),
    'same-time limit $5,000 vs $6,000 is CONFLICT');

  const invented = R.derivePendingFromIdentity({
    posted: POSTED, limit: LIMIT, available: AVAILABLE, identityProven: false,
  });
  ok(invented.derived === false && invented.pending == null
    && invented.reason === 'identity-not-proven',
    'pending is not manufactured as limit − posted − available');
  const proven = R.derivePendingFromIdentity({
    posted: 7855.12, limit: 8000, available: 62.83, identityProven: true,
  });
  ok(proven.derived === true && near(proven.pending, 82.05),
    'MBNA-shaped identity may derive pending only when proven', money(proven.pending));
}

console.log('\n=== 9. live Forecast still keeps posted and pending distinct ===');
{
  const forecastHash = hashFile(path.join(__dirname, '..', 'public', 'forecast.js'));
  const dataHash = hashFile(R.DEFAULT_DATA);
  const travel = live.debts.find(d => d.id === 'travelvisa');
  const cashback = live.debts.find(d => d.id === 'cashback');
  const independentTravel = independentExposure(travel.balance, travel.pending);
  const util = F.utilisation(live.debts, live.revolvingExtra, live.plan);
  const travelRow = util.rows.find(r => r.id === 'travelvisa');
  const cashRow = util.rows.find(r => r.id === 'cashback');
  ok(Number.isFinite(travel.balance) && (travel.pendingUnknown === true || Number.isFinite(Number(travel.pending))),
    'live Travel Visa keeps posted and pending as distinct fields');
  ok(near(independentTravel, travel.balance + (travel.pendingUnknown ? 0 : Number(travel.pending || 0))),
    'independent Travel Visa exposure is posted plus known pending, not a collapsed posted figure');
  ok(travelRow && near(travelRow.posted, travel.balance)
    && near(travelRow.used, independentTravel),
    'Forecast.utilisation still reports posted and pending separately');
  if (cashback.pendingUnknown === true) {
    ok(cashRow && cashRow.available == null && cashRow.overLimit == null,
      'unknown Cash Back pending does not publish posted room as available');
  } else {
    ok(cashRow && cashRow.pendingUnknown !== true
      && near(cashRow.available, Math.max(0, cashRow.limit - cashRow.used)),
      'known Cash Back pending publishes utilisation available from posted+pending');
  }
  ok(hashFile(path.join(__dirname, '..', 'public', 'forecast.js')) === forecastHash,
    'this suite does not rewrite forecast.js');
  ok(hashFile(R.DEFAULT_DATA) === dataHash, 'this suite does not rewrite data.json');
}

console.log('\n=== 10. reconciler performs no writes ===');
{
  const before = hashFile(R.DEFAULT_DATA);
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'reconcile.js'), 'utf8');
  ok(!/writeFileSync?\s*\(\s*DEFAULT_DATA/.test(src),
    'reconcile.js source does not write DEFAULT_DATA');
  ok(!/writeFileSync?\s*\([^)]*data\.json/.test(src),
    'reconcile.js source does not write data.json by path');
  ok(/are not a second financial authority/.test(src),
    'the no-write card-state contract is stated in the command');

  const result = R.reconcile({
    data: live,
    map: { mappings: [] },
    observations: [],
    settlements: emptySide(),
    utility: emptySide(),
    amanda: emptySide(),
    cards,
  });
  ok(result.writesCanonicalState === false, 'reconcile result declares no write');

  const trianglePending = result.rows.find(r => r.observationId === 'card-triangle-pending-2026-08-09');
  const cashPending14 = result.rows.find(r => r.observationId === 'card-cashback-pending-2026-08-14');
  const cashAvailCsv = result.rows.find(r => r.observationId === 'card-cashback-available-csv-2026-08-09');
  const cashAvailPage = result.rows.find(r => r.observationId === 'card-cashback-available-page-2026-08-09');
  const travelPosted = result.rows.find(r => r.observationId === 'card-travelvisa-posted-2026-08-09');
  const travelPending = result.rows.find(r => r.observationId === 'card-travelvisa-pending-2026-08-09');
  const mbnaPending = result.rows.find(r => r.observationId === 'card-mbna-pending-2026-08-09');
  const cashPosted = result.rows.find(r => r.observationId === 'card-cashback-posted-2026-08-09');
  const cashPay = result.rows.find(r => r.observationId === 'card-cashback-confirmed-payment-2026-08-09');
  const cashSched = result.rows.find(r => r.observationId === 'card-cashback-scheduled-sep-minimum');

  ok(trianglePending && trianglePending.unknown && trianglePending.status === 'MISSING'
    && trianglePending.evidenceValue == null,
    'Aug. 9 Triangle pending observation remains unknown MISSING, not $0');
  ok(cashPending14 && cashPending14.unknown && cashPending14.status === 'MISSING',
    'Aug. 14 Cash Back pending is unknown, not canonical $0');
  ok(cashAvailCsv && cashAvailPage
    && cashAvailCsv.status === 'CONFLICT' && cashAvailPage.status === 'CONFLICT'
    && near(cashAvailCsv.householdCash, 0) && near(cashAvailPage.householdCash, 0),
    'live Cash Back available $0 vs $70 is CONFLICT and $0 household cash');
  ok(travelPosted && travelPosted.status === 'CHANGE' && near(travelPosted.evidenceValue, 1078.31),
    '9 August Travel Visa posted $1,078.31 is CHANGE against the 16 August opening');
  ok(travelPending && travelPending.status === 'CHANGE' && near(travelPending.evidenceValue, 165.13)
    && !near(travelPending.evidenceValue, 1112.68),
    '9 August Travel Visa pending $165.13 is CHANGE, not collapsed into posted+pending');
  ok(mbnaPending && mbnaPending.status === 'CHANGE' && near(mbnaPending.evidenceValue, 82.05)
    && mbnaPending.identityProven === true,
    '9 August MBNA pending $82.05 is CHANGE against the known-zero 16 August pending');
  const mbnaPosted16 = result.rows.find(r => r.observationId === 'card-mbna-posted-2026-08-16');
  const triPosted16 = result.rows.find(r => r.observationId === 'card-triangle-posted-2026-08-16');
  const mbnaLive = live.debts.find(d => d.id === 'mbna');
  const triLive = live.debts.find(d => d.id === 'triangle');
  ok(mbnaPosted16 && near(mbnaPosted16.evidenceValue, 8003.61)
    && near(mbnaPosted16.canonicalValue, mbnaLive.balance),
    'Aug. 16 MBNA $8,003.61 evidence is compared to the live opening');
  ok(triPosted16 && near(triPosted16.evidenceValue, 13197)
    && near(triPosted16.canonicalValue, triLive.balance),
    'Aug. 16 Triangle $13,197 evidence is compared to the live opening');
  ok(cashPosted && cashPosted.status === 'CHANGE' && near(cashPosted.evidenceValue, 5612.43),
    '9 August Cash Back posted $5,612.43 is CHANGE against the 16 August opening');
  ok(cashPay && cashPay.appliedToPosted && cashPay.status === 'MISSING'
    && cashPay.status !== 'MATCH' && cashPay.canonicalValue == null,
    'live $70 Cash Back payment is observed, not a canonical MATCH');
  ok(cashSched && cashSched.status === 'MISSING' && cashSched.reducesExposure === false
    && near(cashSched.evidenceValue, 762.36),
    'the paid $762.36 September spike is no longer a canonical obligation');

  const travel14 = result.rows.find(r => r.observationId === 'card-travelvisa-pending-2026-08-14');
  ok(travel14 && travel14.unknown && travel14.status === 'MISSING',
    'Aug. 14 Travel Visa pending stays unknown');

  ok(hashFile(R.DEFAULT_DATA) === before, 'calling reconcile() does not change data.json');

  const cliBefore = hashFile(R.DEFAULT_DATA);
  const out = execFileSync(process.execPath, ['scripts/reconcile.js'], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
  });
  ok(/does not write data\.json/.test(out), 'CLI report repeats the no-write contract');
  ok(/unknown pending is not \$0/.test(out), 'CLI states unknown pending is not $0');
  ok(/available credit is not household cash/.test(out)
    || /CONFLICT — same-time available-credit/.test(out),
    'CLI states available credit is not household cash');
  ok(/limit is not household cash/.test(out), 'CLI states limit is not household cash');
  ok(/schedule is not a confirmed posted payment/.test(out),
    'CLI states a schedule is not a confirmed payment');
  ok(hashFile(R.DEFAULT_DATA) === cliBefore, 'CLI reconcile does not write data.json');
}

console.log('\n=== live payday card-state is not artificially green ===');
{
  const result = R.reconcile({
    data: live,
    map: { mappings: [] },
    observations: [],
    settlements: emptySide(),
    utility: emptySide(),
    amanda: emptySide(),
    cards,
  });
  ok((result.counts.MISSING || 0) > 0, 'live card report includes MISSING rows');
  ok((result.counts.CONFLICT || 0) > 0, 'live card report includes CONFLICT rows');
  const cashback = (result.cardSummaries || []).find(c => c.cardId === 'cashback');
  const triangle = (result.cardSummaries || []).find(c => c.cardId === 'triangle');
  ok(cashback && cashback.availableConflict === true,
    'Cash Back available-credit summary is CONFLICT');
  ok(triangle && triangle.pendingUnknown !== true && near(triangle.pending, 15.62),
    'later known Triangle pending $15.62 clears the older unknown');
  ok(near(R.householdCashFromCardCapacity({ limit: 13500, availableCredit: 287.38 }), 0),
    'Triangle $13,500 limit and $287.38 available are still $0 cash');
}

console.log('\n=== 11. later known pending clears an older unknown ===');
{
  const laterKnown = runCards(
    { meta: { asOf: START }, debts: [debtFixture()] },
    [
      {
        observationId: 'synth-pending-later-known',
        fact: 'pending',
        cardId: 'synth-card',
        amount: PENDING,
        unknown: false,
        observedAsOf: START,
        canonical: { collection: 'debts', id: 'synth-card', field: 'pending' },
      },
      {
        observationId: 'synth-pending-older-unknown',
        fact: 'pending',
        cardId: 'synth-card',
        amount: null,
        unknown: true,
        observedAsOf: '2026-08-01',
        canonical: { collection: 'debts', id: 'synth-card', field: 'pending' },
      },
      {
        observationId: 'synth-posted-for-pending-time',
        fact: 'posted-balance',
        cardId: 'synth-card',
        amount: POSTED,
        observedAsOf: START,
        canonical: { collection: 'debts', id: 'synth-card', field: 'balance' },
      },
    ]
  );
  const knownSummary = (laterKnown.cardSummaries || []).find(c => c.cardId === 'synth-card');
  ok(knownSummary && knownSummary.pendingUnknown !== true && near(knownSummary.pending, PENDING),
    'later known pending is selected over an older unknown, even when the unknown is last in the file');
  ok(knownSummary && knownSummary.exposureUnknown !== true
    && near(knownSummary.exposure, independentExposure(POSTED, PENDING)),
    'exposure uses the later known pending, not unknown', money(knownSummary && knownSummary.exposure));

  const laterUnknown = runCards(
    { meta: { asOf: START }, debts: [debtFixture()] },
    [
      {
        observationId: 'synth-pending-older-known',
        fact: 'pending',
        cardId: 'synth-card',
        amount: PENDING,
        unknown: false,
        observedAsOf: '2026-08-01',
        canonical: { collection: 'debts', id: 'synth-card', field: 'pending' },
      },
      {
        observationId: 'synth-pending-later-unknown',
        fact: 'pending',
        cardId: 'synth-card',
        amount: null,
        unknown: true,
        observedAsOf: START,
        canonical: { collection: 'debts', id: 'synth-card', field: 'pending' },
      },
      {
        observationId: 'synth-posted-for-later-unknown',
        fact: 'posted-balance',
        cardId: 'synth-card',
        amount: POSTED,
        observedAsOf: START,
        canonical: { collection: 'debts', id: 'synth-card', field: 'balance' },
      },
    ]
  );
  const unknownSummary = (laterUnknown.cardSummaries || []).find(c => c.cardId === 'synth-card');
  ok(unknownSummary && unknownSummary.pendingUnknown === true
    && unknownSummary.exposureUnknown === true
    && unknownSummary.exposureReason === 'unknown-pending',
    'a later unknown pending still fail-closes exposure');
}

console.log('\n=== 12. missing or conflicted pending fails exposure closed ===');
{
  const helper = R.cardExposure({ posted: POSTED, payments: [] });
  ok(helper.unknown === true && helper.amount == null
    && helper.reason === 'missing-pending'
    && !near(helper.amount || 0, POSTED),
    'helper: posted with no pending value is unknown exposure, not posted+$0');

  const postedOnly = runCards(
    { meta: { asOf: START }, debts: [debtFixture()] },
    [{
      observationId: 'synth-posted-no-pending',
      fact: 'posted-balance',
      cardId: 'synth-card',
      amount: POSTED,
      observedAsOf: START,
      canonical: { collection: 'debts', id: 'synth-card', field: 'balance' },
    }]
  );
  const postedOnlySummary = (postedOnly.cardSummaries || []).find(c => c.cardId === 'synth-card');
  ok(postedOnlySummary && postedOnlySummary.pendingUnknown === true
    && postedOnlySummary.pending == null
    && postedOnlySummary.exposureUnknown === true
    && postedOnlySummary.exposure == null
    && !near(postedOnlySummary.exposure || 0, POSTED),
    'posted with no pending observation publishes unknown exposure, not posted+$0');

  const conflictedPending = runCards(
    { meta: { asOf: START }, debts: [debtFixture()] },
    [
      {
        observationId: 'synth-posted-for-pending-conflict',
        fact: 'posted-balance',
        cardId: 'synth-card',
        amount: POSTED,
        observedAsOf: START,
        canonical: { collection: 'debts', id: 'synth-card', field: 'balance' },
      },
      {
        observationId: 'synth-pending-100',
        fact: 'pending',
        cardId: 'synth-card',
        amount: 100,
        observedAsOf: START,
        canonical: { collection: 'debts', id: 'synth-card', field: 'pending' },
      },
      {
        observationId: 'synth-pending-300',
        fact: 'pending',
        cardId: 'synth-card',
        amount: 300,
        observedAsOf: START,
        canonical: { collection: 'debts', id: 'synth-card', field: 'pending' },
      },
    ]
  );
  const pendingRows = conflictedPending.rows.filter(r => r.fact === 'pending');
  ok(pendingRows.length === 2 && pendingRows.every(r => r.status === 'CONFLICT'),
    'same-time pending $100 vs $300 is CONFLICT, not a silent choice');
  const conflictedPendingSummary = (conflictedPending.cardSummaries || []).find(c => c.cardId === 'synth-card');
  ok(conflictedPendingSummary && conflictedPendingSummary.pendingConflict === true
    && conflictedPendingSummary.pending == null
    && conflictedPendingSummary.exposureUnknown === true
    && conflictedPendingSummary.exposure == null
    && conflictedPendingSummary.exposureReason === 'conflicted-pending'
    && !near(conflictedPendingSummary.exposure || 0, independentExposure(POSTED, 100))
    && !near(conflictedPendingSummary.exposure || 0, independentExposure(POSTED, 300)),
    'conflicted pending fails exposure closed instead of keeping one value');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
