'use strict';
const assert = require('node:assert/strict');
const F = require('../public/forecast');
const Live = require('../scripts/live-plan');
const O = require('../scripts/provider-observe');
const OA = require('../scripts/operating-answer');
const RT = require('../scripts/refresh-trust');
const Assistant = require('../scripts/assistant-packet');
const fixture = require('./fixtures/card-purchase-coverage-data');
function run(x) {
  const before = JSON.stringify(x);
  const r = Live.fromObservation(x);
  assert.equal(JSON.stringify(x),before,'inputs are immutable');
  const advice = F.recommend(r.data.plan,x.asOf,{debts:r.data.debts,
    currentPeriodActuals:r.data.liveOverlay.currentPeriodActuals});
  const period = advice.payPeriodViews.find(p=>p.start==='2026-09-18');
  return {...r,advice,period};
}
const before=run(fixture('before')),purchase=run(fixture());
assert.equal(before.period.fromTodayFunding.availableNow,500-25-150);
assert.equal(purchase.period.fromTodayFunding.availableNow,500-25-70-80,
  'card purchase needs coverage immediately; it cannot free 80 before cash backfill');
assert.equal(purchase.period.liveCurrentBalance,500,'observed Bills balance stays actual');
assert.equal(purchase.period.householdBudget[0].spent,80);
assert.equal(purchase.period.householdBudget[0].hold,150,'purchase remains in original allowance once');
assert.equal(purchase.advice.cardPurchaseCoverage.reservedCash,80);
const x=fixture('backfill');
x.payload.transactions[0].amount=30;
x.payload.transactions[1].amount=10;x.payload.transactions[2].amount=-10;
x.payload.accounts[0].balance=490;x.payload.accounts[3].balance=420;
fixture.confirm(x,'partial-first',80002,80003,[[80001,10]]);
let partial=run(x);
assert.equal(partial.advice.cardPurchaseCoverage.reservedCash,20);
assert.equal(partial.period.fromTodayFunding.availableNow,490-25-120-20);
assert.equal(partial.period.householdBudget[0].spent,30);
assert.equal(partial.period.fromTodayFunding.operatingBills,25,'backfill does not settle the minimum');
const secondCash={...x.payload.transactions[1],id:80004,amount:25};
const secondCard={...x.payload.transactions[2],id:80005,amount:-25};
x.payload.transactions.push(secondCash,secondCard);
x.payload.accounts[0].balance=465;x.payload.accounts[3].balance=395;
fixture.confirm(x,'partial-second',80004,80005,[[80001,20]],5,'prior-debt');
const complete=run(x);
assert.equal(complete.advice.cardPurchaseCoverage.reservedCash,0);
assert.equal(complete.advice.cardPurchaseCoverage.payments[1].backfill,20);
assert.equal(complete.advice.cardPurchaseCoverage.payments[1].cardPayment,5);
assert.equal(complete.period.fromTodayFunding.availableNow,465-25-120);
assert.equal(complete.period.liveCurrentBalance,465);
assert.equal(complete.data.debts[0].balance,395);
assert.equal(complete.period.householdBudget[0].spent,30,'transfers cannot add expense');
assert.equal(complete.period.fromTodayFunding.operatingBills,25);
for(const mutate of [
  y=>delete y.data.plan.cardPurchaseCoverage,
  y=>y.data.plan.cardPurchaseCoverage.payments=[],
  y=>y.data.plan.cardPurchaseCoverage.payments[1].otherPurpose=null,
  y=>y.payload.transactions[0].currency='usd',
  y=>delete y.payload.transactions[0].currency,
  y=>y.payload.transactions[1].currency='eur',
  y=>y.payload.transactions[2].is_pending=true,
]) {
  const y=structuredClone(x);mutate(y);const unknown=run(y);
  assert.equal(unknown.advice.cardPurchaseCoverage.status,'unavailable');
  assert.equal(unknown.period.fromTodayFunding.status,'unavailable');
  assert.equal(unknown.period.fromTodayFunding.availableNow,null);
  assert.equal(unknown.period.liveCurrentBalance,465,'unknown intent keeps actual Bills cash');
}
for(const currency of ['usd','eur',null,'']) {
  const y=fixture();y.payload.transactions[0].currency=currency;
  y.payload.transactions[0].to_base=1.4;
  const unknown=run(y),packet=unknown.data.liveOverlay.currentPeriodActuals;
  assert.equal(packet.transactions.length,0,'raw foreign purchase never prints as CAD expense');
  assert.equal(packet.cardCoverageUnconfirmed.length,1);
  assert(!JSON.stringify(packet.cardCoverageUnconfirmed).includes('amount'));
  assert.equal(unknown.period.householdBudget[0].spent,null,'unqualified value is withheld rather than called zero');
  assert.equal(unknown.period.fromTodayFunding.availableNow,null);
}
const pending=fixture();pending.payload.transactions[0].is_pending=true;
assert.equal(run(pending).advice.cardPurchaseCoverage.reservedCash,80);
// Provider-directed replacement keeps one purchase reference, without amount/time guessing.
const directed=fixture();directed.payload.transactions[0].plaid_metadata={
  transaction_id:'posted-invented',pending_transaction_id:'pending-invented'};
directed.payload.transactions.push({...directed.payload.transactions[0],id:80006,
  plaid_metadata:{transaction_id:'pending-invented'},is_pending:true});
const one=run(directed);
assert.equal(one.advice.cardPurchaseCoverage.reservedCash,80);
assert.equal(one.period.householdBudget[0].spent,80);
directed.payload.transactions.at(-1).currency='usd';
assert.equal(run(directed).period.fromTodayFunding.availableNow,null,'replacement cannot launder missing/foreign units');
// Exact remote83 safety cases are retained under explicit intent rather than
// payment-window heuristics. Missing identity/pending cash legs never credit coverage.
for (const mutate of [
  y => y.payload.transactions[2].is_pending = true,
  y => y.payload.transactions[1].is_pending = true,
  y => y.payload.transactions.push({ ...y.payload.transactions[2] }),
]) { const y=structuredClone(x); mutate(y);
  assert.equal(run(y).advice.cardPurchaseCoverage.status,'unavailable'); }
const missingId=structuredClone(x); delete missingId.payload.transactions[2].id;
assert.throws(() => Live.fromObservation(missingId),/missing a stable id/);
for (const mutate of [y => y.payload.transactions[0].amount = null,
  y => y.payload.transactions[0].date = null]) {
  const y=fixture(); mutate(y);
  const row=O.normalizeLunchMoneyTransaction(y.payload.transactions[0]);
  const packet=O.sanitizedCurrentPeriodActuals({fetchedAt:y.payload.fetchedAt,
    transactionWindow:y.payload.transactionWindow,pendingCoverage:y.payload.pendingCoverage,
    transactions:[row]}, {plan:y.data.plan,accountMap:y.accountMap,asOf:y.asOf});
  assert.equal(packet.cardCoverageUnconfirmed.length,1,'invalid mapped card evidence cannot become a zero opening');
  assert.equal(F.visaPaymentReconciliation(packet.transactions,{plan:y.data.plan,
    debts:y.data.debts,packet,asOf:y.asOf}).status,'unavailable');
}
const noIntent=structuredClone(x); noIntent.data.plan.cardPurchaseCoverage.payments=[];
const unknownState=run(noIntent).data;
const operational=OA.fromRefreshedState(unknownState,{mode:'live-overlay'});
assert.equal(operational.moneyAvailable.value,null);
const unknownAdvice = run(noIntent).advice;
assert.equal(unknownAdvice.paydayAllocation.available,null);
assert.equal(unknownAdvice.paydayAllocation.paydayShellTrust.available,'unknown');
assert.equal(run(noIntent).period.extraDebt.status,'unavailable');
assert.equal(run(noIntent).period.extraDebt.allocated,null);
const printerSource=require('fs').readFileSync(require.resolve('../public/plan.js'),'utf8');
const extraPrinter=require('vm').runInNewContext('('+printerSource.match(/^function extraRepaymentHtml\([\s\S]*?\n\}/m)[0]+')');
const unknownPrint=extraPrinter(run(noIntent).period);
assert(unknownPrint.includes('data-extra-debt="unavailable"'));
assert(!unknownPrint.includes('No extra'));
assert.equal(run(noIntent).advice.currentPeriodAction.categories[0].committed,30,
  'unknown earmarking cannot erase known spending');
const trust=RT.fromIncumbent({data:unknownState,mode:'live-overlay'});
assert.equal(trust.exactFiguresAvailable,false);
assert.equal(trust.displayState,'attention-needed');
assert(trust.coverageLimits.some(row=>row.id==='card-purchase-coverage-unconfirmed'));
assert.equal(operational.currentSpendingPermission.weekly,null);
const assistant=Assistant.buildPacket({data:unknownState,periods:null,questionsMarkdown:''});
assert.equal(assistant.forecast.status,'unavailable');
assert.equal(assistant.current.spendableHouseholdCash.value,null);
assert.equal(assistant.current.spendableHouseholdCash.observedCash,465);
// Sanitized coverage identifiers are stable, account-bound hashes. Neither the
// original provider identity nor issuer payment IDs are published by the ledger.
const raw={providerAccountId:'invented-account',providerTransactionId:'invented-row',
 plaidTransactionId:'invented-pending'};
const ref=O.cardCoverageReference(raw);
assert.match(ref,/^pc-[a-f0-9]{24}$/);
assert.equal(O.cardCoverageReference({...raw,providerTransactionId:'invented-posted',
 plaidTransactionId:'new-native',pendingTransactionId:'invented-pending'}),ref);
assert.notEqual(O.cardCoverageReference({...raw,providerAccountId:'different-account'}),ref);
assert.equal(O.cardCoverageReference({...raw,providerTransactionId:null}),null);
const safe=JSON.stringify(complete.period.cardPurchaseCoverage);
assert(!/8000[1-5]|providerTransactionId|plaidTransactionId|accountId|purchaseRef/.test(safe));
const history=O.postedHistoryDaysForCarriedSettlement({now:'2026-09-20T18:00:00Z',
 plan:{cardPurchaseCoverage:{opening:{confirmed:true,asOf:'2026-07-22'}}}});
assert.equal(history,60,'confirmed opening extends bounded history by independently counted days');
assert.equal(O.postedHistoryDaysForCarriedSettlement({now:'2026-09-20T18:00:00Z',
 plan:{cardPurchaseCoverage:{opening:{confirmed:true,asOf:'2026-01-01'}}}}),120,
 'the existing observation cap is retained; ledger rejects incomplete cutover coverage');
console.log('PASS independent observed cash/debt/spending ledger: purchase, partial and combined backfill, pending, intent/currency unknown and directed replacement');
