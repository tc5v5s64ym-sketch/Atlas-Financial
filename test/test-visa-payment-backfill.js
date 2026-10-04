'use strict';
// Invented cents and explicit intent. $30 purchase, $10 backfill, then
// $25 split ($20 backfill/$5 prior debt) leave $20 then $0 uncovered.
const assert=require('node:assert/strict');
const F=require('../public/forecast'), Detail=require('../public/bill-detail');
function tx(ref,amount,account='travelvisa',fields={}) {
 return {coverageRef:ref,date:'2026-09-20',amount,currency:'cad',atlasAccountId:account,account,
  accountRole:account==='chequing-a'?'household-cash':'revolving-credit',
  pending:false,categoryLabel:'Groceries',...fields};
}
function pair(id,amount) {return [
 tx(id+'-cash',amount,'chequing-a',{categoryLabel:'Credit Card Payment',cardPaymentIdentity:true}),
 tx(id+'-card',-amount,'travelvisa',{categoryLabel:'Credit Card Payment',cardPaymentIdentity:true})];}
function record(id,amount,otherAmount=0,otherPurpose=null,ref='p') {
 return {id,confirmed:true,debitRef:id+'-cash',creditRef:id+'-card',
 allocations:amount?[{purchaseRef:ref,amount}]:[],otherAmount,otherPurpose};
}
function seed(rows=[tx('p',30)]) {return {
 plan:{startingCash:{breakdown:[{id:'chequing-a',value:500}]},cardPurchaseCoverage:{
 opening:{asOf:'2026-09-18',confirmed:true,currency:'cad',fundingAccountId:'chequing-a',purchases:[]},
 payments:[],refunds:[],reversals:[]}},
 packet:{observationAsOf:'2026-09-20',coverageStart:'2026-09-18',coverageThrough:'2026-09-20',
 transactionCoverage:'complete',pendingCoverage:'complete',cardCoverageRequired:true,transactions:rows},
 asOf:'2026-09-20',debts:[{id:'travelvisa',label:'Invented card',structure:'Revolving'}]};}
function run(s) {
 const before=JSON.stringify(s),r=F.visaPaymentReconciliation(s.packet.transactions,s);
 assert.equal(JSON.stringify(s),before,'immutable inputs');
 assert.deepEqual(F.visaPaymentReconciliation(s.packet.transactions,s),r,'stable replay');return r;
}
function unavailable(s,code) {const r=run(s);assert.equal(r.status,'unavailable');
 assert.equal(r.reservedCash,null);if(code)assert(r.issues.some(i=>i.code===code),code);return r;}
let s=seed(),r=run(s);assert.equal(r.reservedCash,30);
s.packet.transactions.push(...pair('first',10));s.plan.cardPurchaseCoverage.payments.push(record('first',10));
r=run(s);assert.equal(r.reservedCash,30-10);assert.equal(r.payments[0].backfill,10);
assert.equal(r.payments[0].satisfiesMinimum,false);
s.packet.transactions.push(...pair('second',25));
s.plan.cardPurchaseCoverage.payments.push(record('second',20,5,'prior-debt'));
r=run(s);assert.equal(r.status,'ready');assert.equal(r.reservedCash,30-10-20);
assert.equal(r.payments[1].backfill,20);assert.equal(r.payments[1].cardPayment,5);
assert.equal(r.active.length,0);assert.equal(r.purchases[0].audit.length,2);
assert(r.payments.every(p=>p.satisfiesMinimum===false));
const confirmed=structuredClone(s);
for(const mutate of [
 x=>x.plan.cardPurchaseCoverage.payments=[],
 x=>x.plan.cardPurchaseCoverage.payments[1].otherPurpose=null,
 x=>x.plan.cardPurchaseCoverage.payments[1].confirmed=false,
 x=>x.packet.transactions=x.packet.transactions.filter(t=>t.coverageRef!=='second-cash'),
 x=>x.packet.transactions.find(t=>t.coverageRef==='second-cash').amount=24,
 x=>x.packet.transactions.find(t=>t.coverageRef==='second-cash').atlasAccountId='chequing-b',
 x=>x.packet.transactions.find(t=>t.coverageRef==='second-card').pending=true,
 x=>x.plan.cardPurchaseCoverage.payments[1].allocations[0].amount=21,
 x=>x.plan.cardPurchaseCoverage.payments.push(structuredClone(x.plan.cardPurchaseCoverage.payments[0])),
 x=>x.packet.transactions.push(structuredClone(x.packet.transactions[0])),
 x=>x.packet.transactions[0].pendingPostedAmbiguous=true,
 x=>x.packet.transactions[0].accountId='mbna',
 x=>delete x.plan.cardPurchaseCoverage.opening,
 x=>x.packet.coverageStart='2026-09-19',
 x=>x.packet.pendingCoverage='unknown',
 x=>x.packet.transactionCoverage='truncated',
 x=>x.packet.observationAsOf='2026-09-19',
 x=>x.plan.startingCash.breakdown[0].unknown=true
]) {const x=structuredClone(confirmed);mutate(x);unavailable(x);}
// Equal timing/amount cannot establish payment purpose.
s=seed([tx('p',30),...pair('same',30)]);r=unavailable(s);
assert.equal(r.payments[0].backfill,null);assert.equal(r.payments[0].cardPayment,null);
for(const currency of ['usd','eur',null,'']) {
 s=seed();s.packet.transactions[0].currency=currency;s.packet.transactions[0].to_base=1.4;
 r=unavailable(s);assert.equal(r.purchases.length,0,'foreign raw number is not CAD exposure');
 s=structuredClone(confirmed);s.packet.transactions.at(-1).currency=currency;unavailable(s);
}
s=seed();s.packet.transactions[0].currency=' CAD ';assert.equal(run(s).reservedCash,30);
s.packet.transactions[0].coverageCurrencyConflict=true;unavailable(s);
// Pending purchases protect cash immediately; an older pending row needs opening coverage.
s=seed();s.packet.transactions[0].pending=true;assert.equal(run(s).reservedCash,30);
s.packet.transactions[0].date='2026-09-17';unavailable(s,'coverage-pending-before-opening-unconfirmed');
// Explicit opening carry survives without a new purchase in this window.
s=seed([]);s.plan.cardPurchaseCoverage.opening.purchases=[{ref:'carried',date:'2026-09-17',
 accountId:'travelvisa',amount:30,covered:10,categoryLabel:'Groceries'}];
assert.equal(run(s).reservedCash,20);
s.plan.cardPurchaseCoverage.opening.purchases[0].accountId='invented-non-card';unavailable(s);
// Refund links reduce exposure; unlabeled negative card credits do not.
s=seed([tx('p',30),tx('refund',-12)]);unavailable(s);
s.plan.cardPurchaseCoverage.refunds=[{confirmed:true,refundRef:'refund',purchaseRef:'p'}];
r=run(s);assert.equal(r.reservedCash,18);assert.equal(r.purchases[0].refunded,12);
s.plan.cardPurchaseCoverage.refunds.push(structuredClone(s.plan.cardPurchaseCoverage.refunds[0]));unavailable(s);
s=seed([tx('p',30),tx('refund',-31)]);
s.plan.cardPurchaseCoverage.refunds=[{confirmed:true,refundRef:'refund',purchaseRef:'p'}];unavailable(s);
// Paired reversal restores previously covered cents, without creating another expense.
s=structuredClone(confirmed);
s.packet.transactions.push(tx('reversed-card',10,'travelvisa',
 {categoryLabel:'Credit Card Payment',cardPaymentIdentity:true}),
 tx('reversed-cash',-10,'chequing-a',{categoryLabel:'Credit Card Payment',cardPaymentIdentity:true}));
s.plan.cardPurchaseCoverage.reversals=[{confirmed:true,paymentId:'first',
 cardDebitRef:'reversed-card',cashCreditRef:'reversed-cash',
 allocations:[{purchaseRef:'p',amount:10}],otherAmount:0}];
r=run(s);assert.equal(r.reservedCash,10);assert.equal(r.purchases.length,1);
s.plan.cardPurchaseCoverage.reversals[0].allocations[0].amount=11;unavailable(s);
// Combined transfer explicitly names both purchases; no FIFO allocation inferred.
s=seed([tx('a',12),tx('b',18),...pair('combined',30)]);
s.plan.cardPurchaseCoverage.payments=[{...record('combined',12,0,null,'a'),
 allocations:[{purchaseRef:'a',amount:12},{purchaseRef:'b',amount:18}]}];
r=run(s);assert.equal(r.reservedCash,0);assert.equal(r.payments[0].purchases.length,2);
for(const amount of [NaN,Infinity,30.001,'30']) {s=seed();s.packet.transactions[0].amount=amount;unavailable(s);}
// Renderer prints the ledger, escapes labels and does not expose canonical account IDs.
s=seed();s.packet.transactions[0].categoryLabel='<img onerror=alert(1)>';
r=run(s);const html=Detail.visaPaymentsHtml([],r);
assert(html.includes('Card purchases to cover'));assert(html.includes('$30.00'));
assert(!html.includes('<img'));assert(!html.includes('travelvisa'));
r=run(confirmed);const done=Detail.visaPaymentsHtml(r.payments.map(F.visaPaymentPublication),r);
assert(done.includes('Confirmed backfill'));assert(!done.includes('genuine card payment'));
assert(done.includes('issuer minimum confirmation are separate'));
console.log('PASS explicit purchase/payment ledger: partial carry, ambiguity, units, pending, refunds, reversal, conservation and safe publication');
