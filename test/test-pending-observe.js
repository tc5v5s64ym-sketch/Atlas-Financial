'use strict';
/* Mapped pending provider transactions → current-state reconciliation.
 *
 * Independent proof is hand arithmetic on named posted/pending/limit
 * amounts, not a second call to the helper that produced the figure.
 * Does not write data.json. Does not treat limit or available credit
 * as household cash.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const O = require('../scripts/provider-observe.js');
const R = require('../scripts/reconcile.js');
const F = require('../public/forecast.js');

const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(ROOT, 'docs', 'connectivity', 'fixtures', 'lunchmoney-pending-acceptance.json');
const MAP = path.join(ROOT, 'docs', 'connectivity', 'fixtures', 'pending-account-map.json');
const LIVE_MAP = path.join(ROOT, 'docs', 'connectivity', 'provider-account-map.json');
const IDENTITY = path.join(ROOT, 'docs', 'connectivity', 'transaction-identity.json');
const DATA = path.join(ROOT, 'data.json');
const AS_OF = '2026-08-16';
const PAYDAY = '2026-08-14';
const BELL_ID = '2461295531';
const POSTED = 862.68;
const PENDING = 250;
const LIMIT = 1100;
const CASH_A = 1320.13;
const CASH_B = 932.05;
const CASH_S = 0.58;

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const money = n => '$' + Number(n).toFixed(2);
const hashFile = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const clone = x => JSON.parse(JSON.stringify(x));

const payload = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const accountMap = JSON.parse(fs.readFileSync(MAP, 'utf8'));
const identity = JSON.parse(fs.readFileSync(IDENTITY, 'utf8'));
const data = JSON.parse(execFileSync('git', ['show', '28d08a12:data.json'], { encoding: 'utf8' }));

function observeWith(extraPayload, extraInput) {
  return O.observe(Object.assign({
    provider: 'lunchmoney',
    payload: extraPayload || payload,
    accountMap,
    data,
    identity,
    fetchedAt: payload.fetchedAt,
  }, extraInput || {}));
}

function independentExposure(posted, pending) {
  return Math.round((Number(posted) + Number(pending)) * 100) / 100;
}
function independentOverLimit(posted, pending, limit) {
  return Math.round(Math.max(0, independentExposure(posted, pending) - Number(limit)) * 100) / 100;
}
function independentCash() {
  return Math.round((CASH_A + CASH_B + CASH_S) * 100) / 100;
}

console.log('=== 1. mapped pending card debit becomes pending exposure ===');
{
  const report = observeWith();
  const pending = report.observations.find(o => o.observationId === 'lm-3006-pending');
  ok(pending && pending.fact === 'pending' && pending.cardId === 'travelvisa',
    'Travel Visa pending observation is emitted from mapped transactions');
  ok(pending && near(pending.evidenceValue, PENDING) && pending.unknown !== true,
    'pending evidence is $250, not unknown', pending && String(pending.evidenceValue));
  ok(pending && pending.balanceIncludesPending === false,
    'posted balance is not assumed to include pending');
  const bell = pending && pending.components.find(c => c.providerTransactionId === BELL_ID);
  ok(bell && bell.sign === 'debit' && near(bell.amount, PENDING) && bell.pending === true,
    'Bell Mobility component keeps providerTransactionId 2461295531');
}

console.log('\n=== 2. multiple pending card debits aggregate ===');
{
  const extra = clone(payload);
  extra.transactions.push({
    id: 88020,
    account_id: 3006,
    date: '2026-08-15',
    amount: 40.00,
    payee: 'AMZN Mktp CA',
    is_pending: true,
  });
  const report = observeWith(extra);
  const pending = report.observations.find(o => o.observationId === 'lm-3006-pending');
  const independent = independentExposure(PENDING, 40);
  ok(near(independent, 290), 'independent 250+40 is $290.00');
  ok(pending && near(pending.evidenceValue, independent),
    'aggregated pending is the independent $290', pending && String(pending.evidenceValue));
  ok(pending.components.length === 2, 'both pending debits remain as components');
}

console.log('\n=== 3. pending credit/refund/payment uses Lunch Money v2 sign ===');
{
  const extra = clone(payload);
  extra.transactions.push({
    id: 88021,
    account_id: 3006,
    date: '2026-08-15',
    amount: -25.00,
    payee: 'REFUND',
    is_pending: true,
  });
  const report = observeWith(extra);
  const pending = report.observations.find(o => o.observationId === 'lm-3006-pending');
  const independent = independentExposure(PENDING, -25);
  ok(near(independent, 225), 'independent 250 + (−25 credit) is $225.00');
  ok(pending && near(pending.evidenceValue, independent),
    'pending credit reduces exposure using v2 negative-credit sign',
    pending && String(pending.evidenceValue));
  const refund = pending.components.find(c => c.providerTransactionId === '88021');
  ok(refund && refund.sign === 'credit', 'negative Lunch Money amount is a credit');
}

console.log('\n=== 4. pending + posted remain separate facts ===');
{
  const report = observeWith();
  const posted = report.observations.find(o => o.observationId === 'lm-3006-debt');
  const pending = report.observations.find(o => o.observationId === 'lm-3006-pending');
  ok(posted && posted.fact === 'posted-balance' && near(posted.evidenceValue, POSTED),
    'posted stays $862.68');
  ok(pending && pending.fact === 'pending' && near(pending.evidenceValue, PENDING),
    'pending stays $250.00');
  ok(!near(posted.evidenceValue, independentExposure(POSTED, PENDING)),
    'posted is not the collapsed $1,112.68');
  const reconPending = report.reconciliation.rows.find(r => r.observationId === 'lm-3006-pending');
  const reconPosted = report.reconciliation.rows.find(r => r.observationId === 'lm-3006-debt');
  ok(reconPosted && reconPosted.fact === 'posted-balance',
    'reconciler still compares posted as its own fact');
  ok(reconPending && reconPending.fact === 'pending',
    'reconciler still compares pending as its own fact');
}

console.log('\n=== 5+6. inferred exposure can exceed limit and is not household cash ===');
{
  const independent = independentExposure(POSTED, PENDING);
  const over = independentOverLimit(POSTED, PENDING, LIMIT);
  ok(near(independent, 1112.68), 'independent posted+pending is $1,112.68');
  ok(near(over, 12.68), 'independent over-limit is $12.68');
  const report = observeWith();
  const travel = report.cardInferences.find(c => c.cardId === 'travelvisa');
  ok(travel && travel.kind === 'inference-from-posted-plus-pending',
    'over-limit is labelled as an inference, not a new canonical balance');
  ok(travel && near(travel.posted, POSTED) && near(travel.pending, PENDING)
    && near(travel.exposure, independent) && near(travel.limit, LIMIT)
    && near(travel.overLimit, over),
    'Travel Visa inferred 862.68+250=1112.68 against limit 1100, over 12.68',
    travel && money(travel.exposure));
  ok(travel && travel.householdCash === 0 && report.cardCapacityIsCash === 0,
    'inferred over-limit is not household cash');
  ok(report.spendableCash === independentCash(),
    'spendable cash is still only the three mapped cash balances',
    money(report.spendableCash));
}

console.log('\n=== 7. unknown/unmapped account transactions cannot affect canonical reconciliation ===');
{
  const extra = clone(payload);
  extra.transactions.push({
    id: 88030,
    account_id: 3999,
    date: '2026-08-15',
    amount: 999.00,
    payee: 'UNMAPPED CHARGE',
    is_pending: true,
  });
  const report = observeWith(extra);
  ok(report.unmapped.some(u => u.providerAccountId === '3999'),
    '3999 stays unmapped');
  ok(!report.observations.some(o => String(o.providerAccountId) === '3999'),
    'unmapped account produces no observation');
  ok(!report.reconciliation.rows.some(r => String(r.observationId || '').includes('3999')),
    'unmapped pending does not enter reconcile rows');
  const travel = report.observations.find(o => o.observationId === 'lm-3006-pending');
  ok(travel && near(travel.evidenceValue, PENDING),
    'unmapped $999 does not change Travel Visa pending');
}

console.log('\n=== 8. DEBT&PAYMENTS and SAVINGS-DONT TOUCH cannot inflate household cash ===');
{
  const report = observeWith();
  const independent = independentCash();
  ok(near(independent, 2252.76), 'fixture mapped-cash identity 1320.13+932.05+0.58 is $2,252.76');
  ok(near(report.spendableCash, F.startingCashAmount(data.plan)),
    'observe spendable cash independently equals Forecast starting cash',
    money(report.spendableCash));
  ok(!near(report.spendableCash, report.spendableCash + 798.37 + 1000),
    'adding DEBT&PAYMENTS $798.37 and SAVINGS-DONT TOUCH $1,000 would disagree with spendable',
    money(report.spendableCash));
  ok(report.unmapped.some(u => u.providerAccountId === '3997'),
    'DEBT&PAYMENTS is unmapped');
  ok(report.unmapped.some(u => u.providerAccountId === '3996'),
    'SAVINGS-DONT TOUCH is unmapped');
  ok(!report.mapped.some(m => m.atlasRole === 'household-cash' && (m.providerAccountId === '3997' || m.providerAccountId === '3996')),
    'those two accounts are not household-cash');
}

console.log('\n=== 9+10. >90-day pending bill/payment is presumed settled for current forecast only ===');
{
  const extra = clone(payload);
  extra.transactions.push({
    id: 88040,
    account_id: 3006,
    date: '2026-05-01',
    amount: 87.50,
    payee: 'Shaw',
    is_pending: true,
    kind: 'bill-payment',
  });
  const age = O.calendarDaysBetween('2026-05-01', AS_OF);
  ok(age > 90, 'independent age is more than 90 days', String(age));
  const treatment = O.pendingForecastTreatment({
    pending: true, date: '2026-05-01', payee: 'Shaw', kind: 'bill-payment',
  }, AS_OF, { plan: data.plan, billPaymentPayees: identity.billPaymentPayees });
  ok(treatment.treatment === 'presumed-settled-for-current-forecast',
    'current-forecast treatment is presumed settled');
  ok(treatment.historicalStatus === 'pending',
    '>90-day age does not rewrite historical status to confirmed paid');
  ok(treatment.confidence === 'inferred', 'confidence is inferred, not confirmed');
  const report = observeWith(extra);
  const pending = report.observations.find(o => o.observationId === 'lm-3006-pending');
  ok(pending && near(pending.evidenceValue, PENDING),
    'current pending stays $250 — the aged Shaw $87.50 is excluded',
    pending && String(pending.evidenceValue));
  const aged = pending.components.find(c => c.providerTransactionId === '88040');
  ok(aged && aged.historicalStatus === 'pending'
    && aged.settlementTreatment === 'presumed-settled-for-current-forecast'
    && aged.contributesToCurrentPending === false,
    'aged component remains historically pending and does not reserve current pending');
}

console.log('\n=== 11. contradictory evidence prevents presumed settlement ===');
{
  const tx = {
    pending: true, date: '2026-05-01', payee: 'Shaw', kind: 'bill-payment',
    contradictoryEvidence: true,
  };
  const treatment = O.pendingForecastTreatment(tx, AS_OF, {
    plan: data.plan, billPaymentPayees: identity.billPaymentPayees,
  });
  ok(treatment.treatment === 'unresolved' && treatment.conflict === true,
    'contradictory evidence keeps the item unresolved');
  ok(treatment.historicalStatus === 'pending', 'historical status stays pending');
  const extra = clone(payload);
  extra.transactions.push(Object.assign({
    id: 88041, account_id: 3006, amount: 87.50, is_pending: true,
  }, tx));
  const report = observeWith(extra);
  const pending = report.observations.find(o => o.observationId === 'lm-3006-pending');
  const aged = pending.components.find(c => c.providerTransactionId === '88041');
  ok(aged && aged.contributesToCurrentPending === false && aged.conflict === true,
    'conflicted aged bill is not presumed settled into current pending');
}

console.log('\n=== 12. confirmed posted/statement evidence upgrades settlement ===');
{
  const treatment = O.pendingForecastTreatment({
    pending: true, date: '2026-05-01', payee: 'Shaw', kind: 'bill-payment',
    confirmedSettlement: true,
  }, AS_OF, { plan: data.plan });
  ok(treatment.treatment === 'confirmed-settled',
    'matching settlement evidence upgrades treatment to confirmed settled');
  ok(treatment.historicalStatus === 'pending',
    'provider historical status remains pending until the provider posts');
  ok(treatment.confidence === 'confirmed', 'confidence is confirmed');
}

console.log('\n=== 13. live provider still writesCanonicalState=false ===');
{
  const before = hashFile(DATA);
  const report = observeWith();
  ok(report.writesCanonicalState === false, 'observe report declares no write');
  ok(report.reconciliation.writesCanonicalState === false,
    'reconcile result declares no write');
  ok(hashFile(DATA) === before, 'data.json bytes are unchanged');
  const liveMap = JSON.parse(fs.readFileSync(LIVE_MAP, 'utf8'));
  ok(Array.isArray(liveMap.mappings) && liveMap.mappings.length === 0,
    'committed live map still has no real provider IDs');
}

console.log('\n=== 14. same-day cutover does not double-count identified payroll ===');
{
  const report = observeWith();
  const seaspan = report.representedEventCandidates.find(c => c.id === 'payroll' && c.date === PAYDAY);
  ok(seaspan && seaspan.providerTransactionId === '88011',
    'Seaspan payee + chequing-a + payday is an unambiguous represented candidate');
  ok(seaspan && seaspan.amountNotUsed === true,
    'amount similarity was not the identity');

  const amountOnly = clone(payload);
  amountOnly.transactions = [{
    id: 88050,
    account_id: 3001,
    date: PAYDAY,
    amount: -4274.98,
    payee: 'UNKNOWN DEPOSIT',
    is_pending: false,
  }];
  const rejected = observeWith(amountOnly);
  ok(!rejected.representedEventCandidates.some(c => c.id === 'payroll'),
    'same amount without Seaspan payee is not inferred as payroll');

  const liveEvents = F.expandEvents(data.plan, PAYDAY, F.addDays(PAYDAY, 14), {});
  ok(liveEvents.some(e => e.id === 'payroll' && e.date === PAYDAY),
    'live Forecast without an opening still emits Aug. 14 payroll');
  const cutover = Object.assign({}, data.plan, {
    opening: {
      asOf: PAYDAY,
      representedEvents: report.representedEventCandidates.map(c => ({ id: c.id, date: c.date })),
    },
  });
  const cutEvents = F.expandEvents(cutover, PAYDAY, F.addDays(PAYDAY, 14), {});
  ok(!cutEvents.some(e => e.id === 'payroll' && e.date === PAYDAY),
    'existing representedEvents omits the identified same-day payroll');
  ok(cutEvents.some(e => e.id === 'payroll' && e.date === '2026-08-28'),
    'the next payroll is not skipped');
  ok(cutEvents.some(e => e.id === 'mortgage' && e.date === PAYDAY),
    'unidentified same-day mortgage is not guessed from amount and still fires');
}

console.log('\n=== 16. childBenefit identity is payee+Chequing B+date, not amount ===');
{
  const current = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const ccbDate = '2026-08-20';
  const extra = clone(payload);
  extra.transactions = [{
    id: 88060,
    account_id: 3002,
    date: ccbDate,
    amount: -50,
    payee: 'CHILD TAX BEN CCB',
    is_pending: false,
  }];
  const report = observeWith(extra, { data: current, fetchedAt: '2026-08-20T18:00:00.000Z' });
  const ccb = report.representedEventCandidates.find(c => c.id === 'childBenefit' && c.date === ccbDate);
  ok(ccb && ccb.amountNotUsed === true && ccb.identity === 'payee+account+date',
    'CHILD TAX BEN + chequing-b + scheduled date is an unambiguous represented candidate');

  const amountOnly = clone(payload);
  amountOnly.transactions = [{
    id: 88061,
    account_id: 3002,
    date: ccbDate,
    amount: -50,
    payee: 'UNKNOWN DEPOSIT',
    is_pending: false,
  }];
  const rejected = observeWith(amountOnly, { data: current, fetchedAt: '2026-08-20T18:00:00.000Z' });
  ok(!rejected.representedEventCandidates.some(c => c.id === 'childBenefit'),
    'same scheduled date and similar amount without CHILD TAX BEN payee is not child benefit');

  const wrongAccount = clone(payload);
  wrongAccount.transactions = [{
    id: 88062,
    account_id: 3001,
    date: ccbDate,
    amount: -50,
    payee: 'CHILD TAX BEN CCB',
    is_pending: false,
  }];
  const misplaced = observeWith(wrongAccount, { data: current, fetchedAt: '2026-08-20T18:00:00.000Z' });
  ok(!misplaced.representedEventCandidates.some(c => c.id === 'childBenefit'),
    'CHILD TAX BEN credit on Chequing A is not inferred as child benefit');
}

console.log('\n=== 15. existing Forecast consumes the 16 August opening ===');
{
  const rec = F.recommend(data.plan, data.meta.asOf, {
    scenario: 'expected',
    incomeOverrides: {},
    disabled: [],
    extraDebtMonthly: 0,
    targetBuffer: data.plan.defaults.targetBuffer,
    fundingSources: data.plan.funding && data.plan.funding.options,
    debts: data.debts,
    extraFacilities: data.revolvingExtra,
    extraDebtTarget: data.plan.nextDollar && data.plan.nextDollar.target,
  });
  ok(data.plan.opening && data.plan.opening.asOf === data.meta.asOf,
    'live plan opening as-of agrees with meta.asOf');
  ok(near(F.startingCashAmount(data.plan), (data.plan.startingCash.breakdown || [])
    .reduce((s, r) => s + Number(r.value || 0), 0)),
    'live spendable opening independently equals the breakdown sum');
  ok(rec.mode !== 'openingGap' && rec.weekly !== 600,
    'existing Forecast consumes that opening; $600/week is not policy',
    `${rec.mode} weekly ${rec.weekly}`);
}

console.log('\n=== B78 identity: pending→posted same providerTransactionId ===');
{
  const extra = clone(payload);
  extra.transactions.push({
    id: Number(BELL_ID),
    account_id: 3006,
    date: '2026-08-16',
    amount: 250.00,
    payee: 'Bell Mobility',
    is_pending: false,
    status: 'reviewed',
  });
  const report = observeWith(extra);
  const ident = report.identityEvidence.find(e => e.providerTransactionId === BELL_ID);
  ok(ident && ident.transition === 'pending-to-posted',
    'same providerTransactionId is recognized as pending→posted');
  ok(ident && ident.ghostPending === false && ident.doubleCounted === false,
    'collapse does not keep a ghost pending or double-count');
  const pending = report.observations.find(o => o.observationId === 'lm-3006-pending');
  ok(!pending || !pending.components.some(c => c.providerTransactionId === BELL_ID && c.contributesToCurrentPending),
    'posted Bell does not remain in current pending exposure');
  const rawPending = report.transactions.filter(t => t.providerTransactionId === BELL_ID && t.pending);
  const rawPosted = report.transactions.filter(t => t.providerTransactionId === BELL_ID && !t.pending);
  ok(rawPending.length === 1 && rawPosted.length === 1,
    'both provider records are retained as evidence of the transition');
}

console.log('\n=== Plaid directed pending→posted uses Plaid ids, not Lunch Money ids ===');
{
  const extra = clone(payload);
  extra.transactions.push({
    id: 'lm-pending-101',
    account_id: 3006,
    date: '2026-08-15',
    amount: 100.00,
    payee: 'AMZN Mktp CA',
    is_pending: true,
    plaid_metadata: { transaction_id: 'plaid-pending-abc' },
  });
  extra.transactions.push({
    id: 'lm-posted-202',
    account_id: 3006,
    date: '2026-08-16',
    amount: 97.50,
    payee: 'AMZN Mktp CA',
    is_pending: false,
    plaid_metadata: {
      transaction_id: 'plaid-posted-def',
      pending_transaction_id: 'plaid-pending-abc',
    },
  });
  extra.transactions.push({
    id: 'lm-posted-unrelated',
    account_id: 3006,
    date: '2026-08-16',
    amount: 42.00,
    payee: 'UNRELATED STORE',
    is_pending: false,
  });
  const report = observeWith(extra);
  const pending = report.observations.find(o => o.observationId === 'lm-3006-pending');
  const independentPending = PENDING;
  const independentPostedSpend = Math.round((97.50 + 42.00) * 100) / 100;
  ok(near(independentPending, 250) && near(independentPostedSpend, 139.50),
    'independent arithmetic: remaining pending is Bell $250; posted pair is $139.50');
  ok(pending && near(pending.evidenceValue, independentPending),
    'linked $100 pending does not remain in Travel Visa pending exposure after Plaid settlement',
    pending && String(pending.evidenceValue));
  ok(pending && !pending.components.some(c => c.providerTransactionId === 'lm-pending-101'
        && c.contributesToCurrentPending),
    'settled Plaid pending authorization is not a current pending component');
  const actuals = report.currentPeriodActuals && report.currentPeriodActuals.transactions || [];
  const actualBlob = JSON.stringify(report.currentPeriodActuals || {});
  const posted975 = actuals.filter(tx => near(tx.amount, 97.50) && tx.pending !== true);
  const posted42 = actuals.filter(tx => near(tx.amount, 42.00) && tx.pending !== true);
  const leftoverPending100 = actuals.filter(tx => near(tx.amount, 100) && tx.pending === true);
  ok(posted975.length === 1 && posted42.length === 1 && leftoverPending100.length === 0,
    'sanitized actuals keep posted $97.50 and $42.00 and drop the linked pending $100');
  ok(!/plaid-pending-abc|plaid-posted-def|plaid_metadata|plaidTransactionId|pending_transaction_id/.test(actualBlob)
      && !/"providerTransactionId"\s*:/.test(actualBlob)
      && !/lm-pending-101|lm-posted-202/.test(actualBlob),
    'Plaid and Lunch Money provider ids do not reach sanitized current-period actuals');
}

console.log('\n=== B81 zero-pending proof contract ===');
{
  const extra = clone(payload);
  extra.transactions = extra.transactions.filter(tx => tx.is_pending !== true);
  extra.pendingCoverage = {
    complete: true,
    basis: O.PENDING_COVERAGE_BASIS,
    hasMore: false,
    startDate: null,
    endDate: null,
  };
  const proven = observeWith(extra);
  const tdcc = proven.observations.find(o => o.observationId === 'lm-3004-pending');
  const travelZero = proven.observations.find(o => o.observationId === 'lm-3006-pending');
  ok(tdcc && near(tdcc.evidenceValue, 0) && tdcc.unknown !== true,
    'CASE A: complete is_pending universe with no components emits pending 0');
  ok(tdcc && tdcc.pendingProof === 'is_pending-unbounded',
    'CASE A names the unbounded is_pending proof');
  ok(travelZero && near(travelZero.evidenceValue, 0) && travelZero.unknown !== true,
    'Travel Visa with no remaining pending components is also proven 0');
  ok(proven.pendingCoverage && proven.pendingCoverage.complete === true,
    'observe report preserves complete pending coverage');

  const bounded = observeWith(clone(payload));
  ok(!bounded.observations.some(o => o.observationId === 'lm-3004-pending'),
    'CASE B: empty bounded window does not emit pending 0 for TD Personal');
  const travelBounded = bounded.observations.find(o => o.observationId === 'lm-3006-pending');
  ok(travelBounded && near(travelBounded.evidenceValue, PENDING),
    'CASE C: nonzero Travel Visa pending still emits from components');
  ok(bounded.pendingCoverage && bounded.pendingCoverage.complete !== true,
    'fixture without pendingCoverage is not complete');
  ok(bounded.pendingCoverage
    && /bounded include_pending window is not proof/.test(bounded.pendingCoverage.reason),
    'CASE B records that bounded absence is not zero-proof');

  const datedClaim = clone(payload);
  datedClaim.transactions = datedClaim.transactions.filter(tx => tx.is_pending !== true);
  datedClaim.pendingCoverage = {
    complete: true,
    basis: 'is_pending-unbounded',
    hasMore: false,
    startDate: '2026-08-02',
    endDate: '2026-08-16',
  };
  const dated = observeWith(datedClaim);
  ok(!dated.observations.some(o => o.fact === 'pending' && !(o.components || []).length),
    'a dated is_pending query cannot prove zero even if complete is claimed');
  ok(dated.pendingCoverage && dated.pendingCoverage.status === 'bounded-window',
    'dated pending query is classified bounded-window');

  const truncatedClaim = clone(payload);
  truncatedClaim.transactions = [];
  truncatedClaim.pendingCoverage = {
    complete: true,
    basis: 'is_pending-unbounded',
    hasMore: true,
    startDate: null,
    endDate: null,
  };
  const truncated = observeWith(truncatedClaim);
  ok(!truncated.observations.some(o => o.fact === 'pending'),
    'has_more=true cannot prove zero');

  const cashbackUnknown = data.debts.find(d => d.id === 'cashback');
  ok(cashbackUnknown && cashbackUnknown.pendingUnknown === true,
    'canonical Cash Back pending is UNKNOWN on live data');
  ok(!bounded.observations.some(o => o.observationId === 'lm-3005-pending'),
    'CASE D: UNKNOWN pending is not manufactured as 0 from a bounded empty window');
}

console.log('\n=== history window is configurable ===');
{
  const current = O.lunchMoneyTransactionsUrl('2026-08-16T18:00:00.000Z');
  ok(current.searchParams.get('start_date') === '2026-08-02',
    'current-state default remains 14 days');
  const boundary = O.lunchMoneyTransactionsUrl('2026-08-19T01:06:40.929Z');
  ok(boundary.searchParams.get('end_date') === '2026-08-18',
    '01:06Z on 19 August UTC is still 18 August for the history window');
  const recon = O.lunchMoneyTransactionsUrl('2026-08-16T18:00:00.000Z', O.RECONCILE_HISTORY_DAYS);
  ok(recon.searchParams.get('start_date') === '2026-04-18',
    'reconcile mode asks for 120 days', recon.searchParams.get('start_date'));
  ok(O.historyDaysFromArgs({ mode: 'reconcile' }) === 120,
    '--mode reconcile selects the longer window');
  ok(O.historyDaysFromArgs({ mode: 'reconcile', historyDays: 30 }) === 30,
    'explicit --history-days wins over the mode default');
  ok(O.BILL_PAYMENT_PENDING_DAYS === 90,
    'the 90-day rule is scoped to pending bill/payment effects');
  const pendingUrl = O.lunchMoneyPendingUniverseUrl();
  ok(pendingUrl.pathname === '/v2/transactions',
    'pending-universe query targets GET /v2/transactions');
  ok(pendingUrl.searchParams.get('is_pending') === 'true',
    'pending-universe query sets is_pending=true');
  ok(current.searchParams.get('include_metadata') === 'true'
      && recon.searchParams.get('include_metadata') === 'true'
      && pendingUrl.searchParams.get('include_metadata') === 'true',
    'bounded and unbounded transaction requests set include_metadata=true');
  ok(!pendingUrl.searchParams.has('start_date') && !pendingUrl.searchParams.has('end_date'),
    'pending-universe query has no date bound');
  ok(O.PENDING_COVERAGE_BASIS === 'is_pending-unbounded',
    'complete coverage basis is the unbounded is_pending query');
}

console.log('\n=== CLI fixture run remains read-only ===');
{
  const before = hashFile(DATA);
  const out = execFileSync(process.execPath, [
    path.join(ROOT, 'scripts', 'provider-observe.js'),
    '--provider', 'lunchmoney',
    '--fixture', FIXTURE,
    '--map', MAP,
  ], { cwd: ROOT, encoding: 'utf8' });
  const parsed = JSON.parse(out);
  ok(parsed.writesCanonicalState === false, 'CLI JSON says writesCanonicalState false');
  ok(hashFile(DATA) === before, 'CLI run leaves data.json untouched');
  const travel = parsed.cardInferences.find(c => c.cardId === 'travelvisa');
  ok(travel && near(travel.exposure, 1112.68) && near(travel.overLimit, 12.68),
    'CLI reports the Bell inferred exposure');
}

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll pending-observe checks passed.');
