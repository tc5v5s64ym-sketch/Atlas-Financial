'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const F = require('../public/forecast');
const Live = require('../scripts/live-plan');
const O = require('../scripts/provider-observe');
const fixture = require('./fixtures/bank-fees-data');
const canonicalBefore = fs.readFileSync(require.resolve('../data.json'));
let cases = 0;
function run(x) {
  const before = JSON.stringify(x), r = Live.fromObservation(x);
  const packet = r.data.liveOverlay.currentPeriodActuals;
  const advice = F.recommend(r.data.plan, x.asOf, { debts:r.data.debts, currentPeriodActuals:packet });
  assert.equal(JSON.stringify(x), before, 'observation and canonical fixture remain immutable');
  const p = advice.payPeriodViews.find(p => p.start <= x.asOf && p.end >= x.asOf);
  const fees = p.bills.find(row => row.fees)?.fees;
  cases++;
  return { ...r, packet, advice, p, fees };
}
for (const amount of [10,24,80]) {
  const deduction = Math.max(24, amount);
  const expectedBad = 1000 -25 -deduction -150; // independent period ledger
  for (const [location,paid] of [['cash',0],['card',0],['card',amount]]) {
    const r = run(fixture(amount,location,paid));
    assert(r.fees, 'verified Bank fees appear under Fees in Bills');
    assert.equal(r.fees.plannedAllowance,24);
    assert.equal(r.fees.actual,amount);
    assert.equal(r.fees.overage,Math.max(0,amount-24));
    assert.equal(r.fees.periodCost,deduction);
    assert.equal(r.p.periodBillLoad,25+deduction);
    assert.equal(r.p.totalBillsThisPeriod,25+deduction);
    assert.equal(r.p.balanceAfterDeductions,expectedBad,'full-period income identity, independent of cash stock');
    assert.equal(r.p.predictedEndingBalanceTerms.closes,true);
    assert.equal(r.p.liveCurrentBalance,location === 'cash' ? 500-amount : 500-paid);
    assert.equal(r.advice.cardPurchaseCoverage.reservedCash,location === 'card' ? amount-paid : 0);
    assert.equal(r.fees.remainingAllowance,Math.max(0,24-amount));
    assert.equal(r.fees.protectedCash,Math.max(0,24-amount)+(location === 'card' ? amount-paid : 0));
    assert.equal(r.p.fromTodayFunding.availableNow,500-amount-25-150-Math.max(0,24-amount),
      'paid cash plus remaining allowance and uncovered card cash are reserved once');
    assert.equal(r.p.budgetProgress.bills.actual.amount,amount,'incurred fee contributes to Bills actuals once');
    assert.equal(r.p.budgetProgress.bills.planned.amount,49,'authored planned Bills total stays intact');
    assert.equal(r.p.householdBudget.some(row=>row.otherSpending),false,'fees are not Other Spending');
    assert.equal(r.p.paidBills,0,'posted fee is not fabricated paid Bills cash');
    assert.equal(r.p.bills.find(row=>row.id==='tdfees').planned,24);
    assert.deepEqual(run(fixture(amount,location,paid)).fees,r.fees,'replay is stable');
  }
}
for (const paid of [20,40]) {
  const r=run(fixture(80,'card',paid));
  assert.equal(r.p.liveCurrentBalance,500-paid);
  assert.equal(r.advice.cardPurchaseCoverage.reservedCash,80-paid);
  assert.equal(r.p.fromTodayFunding.availableNow,245);
  assert.equal(r.p.balanceAfterDeductions,745,'partial payment never incurs the cost again');
  assert.equal(r.p.budgetProgress.bills.actual.amount,80);
}
const reversed=fixture(80,'card',80);
reversed.payload.transactions.push(
  {id:80004,account_id:3004,date:reversed.asOf,amount:80,currency:'cad',is_pending:false,
    category_name:'Credit Card Payment',payee:'Invented confirmed payment reversal'},
  {id:80005,account_id:3001,date:reversed.asOf,amount:-80,currency:'cad',is_pending:false,
    category_name:'Credit Card Payment',payee:'Invented confirmed cash return'});
reversed.payload.accounts[0].balance=500;reversed.payload.accounts[3].balance=480;
reversed.data.plan.cardPurchaseCoverage.reversals=[{confirmed:true,paymentId:'invented-fee-payment',
  cardDebitRef:fixture.ref(reversed,80004),cashCreditRef:fixture.ref(reversed,80005),
  allocations:[{purchaseRef:fixture.ref(reversed,80001),amount:80}],otherAmount:0}];
const reversal=run(reversed);
assert.equal(reversal.advice.cardPurchaseCoverage.reservedCash,80);
assert.equal(reversal.p.balanceAfterDeductions,745);
assert.equal(reversal.p.fromTodayFunding.availableNow,245);
assert.equal(reversal.fees.actual,80,'payment reversal is not a second fee');
for (const mutate of [
  x=>{x.data.plan.cardPurchaseCoverage.payments=[];},
  x=>{x.payload.transactions[1].is_pending=true;},
  x=>{x.payload.transactions.push({...x.payload.transactions[2]});},
  x=>{x.data.plan.cardPurchaseCoverage.opening.confirmed=false;},
  x=>{delete x.data.plan.cardPurchaseCoverage.opening;}
]) {
  const x=fixture(80,'card',80);mutate(x);const r=run(x);
  assert.equal(r.advice.cardPurchaseCoverage.status,'unavailable');
  assert.equal(r.p.fromTodayFunding.availableNow,null,'unconfirmed allocation/opening cannot release cash');
  assert.equal(r.p.liveCurrentBalance,420,'observed cash stock survives the hold');
  assert.equal(r.fees.actual,80);
  assert.equal(r.fees.protectedCash,null);
  assert.equal(r.p.balanceAfterDeductions,745,'known incurred cost remains separate from unknown cash coverage');
}
const beforeOpening=fixture();beforeOpening.data.plan.cardPurchaseCoverage.opening.asOf='2026-09-19';
beforeOpening.payload.transactions[0].date='2026-09-18';
const bor=run(beforeOpening);
assert.equal(bor.fees.coverageStatus,'unconfirmed','no missing purchase annotation is silently called covered');
assert.equal(bor.fees.protectedCash,null);
assert.equal(bor.p.fromTodayFunding.availableNow,null);
assert.equal(bor.p.balanceAfterDeductions,745);
const unknownAllowance=fixture();unknownAllowance.data.plan.bills[0].confidence='unknown';
const uar=run(unknownAllowance);
assert.equal(uar.fees.status,'unavailable');
assert.equal(uar.p.balanceAfterDeductions,null);assert.equal(uar.p.fromTodayFunding.availableNow,null);
const pending=fixture(10);pending.payload.transactions[0].is_pending=true;
const pr=run(pending);
assert.equal(pr.fees.pending,10);assert.equal(pr.fees.posted,0);
assert.equal(pr.fees.transactions[0].pending,true);
assert.equal(pr.p.budgetProgress.bills.actual.trust,'estimated');
assert.equal(pr.p.budgetProgress.bills.actual.includesPending,true);
assert.equal(pr.advice.cardPurchaseCoverage.reservedCash,10);
assert.equal(pr.fees.remainingAllowance,14);
assert.equal(pr.p.balanceAfterDeductions,801);assert.equal(pr.p.paidBills,0);
const overPending=fixture(80);overPending.payload.transactions[0].is_pending=true;
const opr=run(overPending);
assert.equal(opr.p.periodBillLoadTrust,'estimated');
assert.equal(opr.p.balanceAfterDeductionsTrust,'estimated');
assert.equal(opr.fees.periodCostTrust,'estimated');
const replacement=fixture();
replacement.payload.transactions[0].plaid_metadata={transaction_id:'invented-posted',pending_transaction_id:'invented-pending'};
replacement.payload.transactions.push({...replacement.payload.transactions[0],id:80006,is_pending:true,
  plaid_metadata:{transaction_id:'invented-pending'}});
assert.equal(run(replacement).fees.actual,80,'directed replacement counts once');
for(const mutate of [
  x=>{delete x.payload.transactions[0].category_id;},
  x=>{x.payload.transactions[0].category_id=911;},
  x=>{x.payload.transactions[0].category_name='Groceries';},
  x=>{x.payload.categories=[];},
  x=>{x.payload.categories[0].archived=true;},
  x=>{x.payload.categories[0].is_group=true;},
  x=>{x.payload.categories.push({...x.payload.categories[0],id:911});},
  x=>{x.payload.transactions[0].currency='usd';x.payload.transactions[0].to_base=1;},
  x=>{delete x.payload.transactions[0].currency;},
  x=>{x.payload.transactions[0].amount=null;},
  x=>{x.payload.transactions[0].date=null;},
  x=>{x.payload.transactionWindow.complete=false;x.payload.transactionWindow.truncated=true;}
]) {
  const x=fixture();mutate(x);const r=run(x);
  assert.equal(r.fees?.status,'unavailable','catalog/category/window uncertainty never becomes a named fee total');
  assert.equal(r.p.balanceAfterDeductions,null);
  assert.equal(r.p.budgetProgress.bills.actual.amount,null);
}
// Effective native flags include transaction and catalog evidence. A false raw
// flag cannot override a true catalog flag; every nonempty combination holds.
const nativeFeeFlags = ['is_income','exclude_from_totals','exclude_from_budget'];
for (const source of ['transaction','catalog']) for (let mask=1;mask<8;mask++) {
  for (const location of ['cash','card']) for (const pending of [false,true]) {
    const x=fixture(37.19,location), tx=x.payload.transactions[0], category=x.payload.categories[0];
    for (let i=0;i<nativeFeeFlags.length;i++) {
      tx[nativeFeeFlags[i]]=source==='transaction' && Boolean(mask & (1<<i));
      category[nativeFeeFlags[i]]=source==='catalog' && Boolean(mask & (1<<i));
    }
    tx.is_pending=pending;
    if (location==='cash' && pending) x.payload.accounts[0].balance=500;
    const label=source+' flags '+mask+' '+location+' '+(pending?'pending':'posted');
    const r=run(x);
    assert.equal(r.packet.transactions[0].bankFeeCategory,'unconfirmed',label+' cannot qualify fee identity');
    assert(r.packet.bankFeeUnconfirmed.length>0,label+' retains uncertainty evidence');
    assert.equal(r.fees.status,'unavailable',label+' cannot publish a known fee cost');
    assert.equal(r.fees.actual,null,label+' cannot publish an incurred fee total');
    assert.equal(r.p.budgetProgress.bills.actual.amount,null,label+' cannot publish Bills actuals');
    assert.equal(r.p.balanceAfterDeductions,null,label+' cannot grant a known full-period deduction');
    assert.equal(r.p.fromTodayFunding.availableNow,null,label+' cannot grant cash permission');
    assert.equal(r.p.liveCurrentBalance,location==='cash' && !pending?500-37.19:500,
      label+' preserves observed cash independently of the hold');
  }
}
// Exact catalog id can qualify a transaction with no redundant display label.
const catalogOnly=fixture();delete catalogOnly.payload.transactions[0].category_name;
assert.equal(run(catalogOnly).fees.actual,80);
for(const location of ['cash','card']) {
  const x=fixture(10,location);x.payload.transactions[0].currency='eur';
  const r=run(x);assert.equal(r.fees.status,'unavailable');
  assert.equal(r.fees.actual,null);assert.equal(r.p.balanceAfterDeductions,null);
  assert(!JSON.stringify(r.packet.bankFeeUnconfirmed).includes('amount'));
}
const pendingCash=fixture(10,'cash');pendingCash.payload.transactions[0].is_pending=true;
pendingCash.payload.accounts[0].balance=500;
const pcr=run(pendingCash);
assert.equal(pcr.fees.pendingCashReserve,10);
assert.equal(pcr.fees.protectedCash,24,'pending cash cost plus unincurred allowance, once');
assert.equal(pcr.p.liveCurrentBalance,500,'pending bank fee does not invent posted cash loss');
assert.equal(pcr.p.balanceAfterDeductions,801);
// Merchant/notes cannot create a fee identity on a different catalog category.
const loose=fixture();loose.payload.categories.push({id:911,name:'Groceries'});
loose.payload.transactions[0].category_id=911;loose.payload.transactions[0].category_name='Groceries';
loose.payload.transactions[0].notes='Bank fees, annual and overlimit';
assert.equal(run(loose).fees,undefined);
for(const role of ['household-external','business','unmapped']) {
  const x=fixture();const map=x.accountMap.mappings[3];
  delete map.canonical;map.atlasRole=role;map.externalId='invented-business';
  const r=run(x);assert.equal(r.fees,undefined,'external/business/unmapped account cannot broaden household Fees');
}
for(const account of ['chequing-a','chequing-b','savings']) {
  const x=fixture(10,'cash');const index=['chequing-a','chequing-b','savings'].indexOf(account);
  x.payload.transactions[0].account_id=3001+index;
  x.payload.accounts[0].balance=index===0?490:500;
  if(index>0){x.data.plan.startingCash.breakdown[index].value=100;x.payload.accounts[index].balance=90;}
  const r=run(x);assert.equal(r.fees.actual,10);assert.equal(r.fees.cardReserve,0);
  assert.equal(r.p.liveCurrentBalance,index===0?490:500);
  assert.equal(r.p.balanceAfterDeductions,801);
}
for(const account of ['travelvisa','cashback','tdcc','mbna','triangle']) {
  const x=fixture(10);x.data.debts[0].id=account;x.data.plan.obligations[0].debtId=account;
  x.accountMap.mappings[3].canonical.id=account;
  const r=run(x);assert.equal(r.fees.actual,10);assert.equal(r.fees.cardReserve,10);
  assert.equal(r.p.liveCurrentBalance,500);
}
function advance(x,asOf) {
  x.asOf=asOf;x.payload.fetchedAt=asOf+'T18:00:00Z';x.payload.transactionWindow.endDate=asOf;
  x.payload.accounts.forEach(a=>{a.updated_at=asOf+'T17:00:00Z';});
}
const carried=fixture();advance(carried,'2026-10-05');
const carry=run(carried);
assert.equal(carry.fees,undefined,'an earlier-period fee never incurs again in this period');
assert.equal(carry.advice.cardPurchaseCoverage.reservedCash,80,'unpaid fee coverage carries across payday');
assert.equal(carry.advice.payPeriodViews.find(p=>p.start==='2026-09-18').bills.find(r=>r.fees).fees.actual,80);
assert.equal(carry.advice.payPeriodViews.find(p=>p.start==='2026-09-18').totalBillsThisPeriod,105,
  'historical total keeps the same fee composition rather than reverting to the scheduled allowance');
const next=fixture(40);advance(next,'2026-10-05');next.payload.transactions[0].date=next.asOf;
const nr=run(next);
assert.equal(nr.fees.plannedAllowance,0,'allowance stays on its authored September30/October30 period');
assert.equal(nr.fees.actual,40);assert.equal(nr.fees.periodCost,40);
assert.equal(nr.p.balanceAfterDeductions,1000-25-40-150,'the existing unresolved minimum remains carried; earlier fees do not');
assert.equal(nr.p.budgetProgress.bills.planned.amount,25,'only the unchanged carried minimum has a planned deduction here');
const future=fixture();future.payload.transactions[0].date='2026-10-05';
assert.equal(run(future).fees,undefined,'future-dated row is not current fee evidence');
// Actual fee legs already inside cash and their separately matched scheduled
// occurrence cannot be added a second time beside the incurred card cost.
const monthly=fixture();advance(monthly,'2026-09-30');
monthly.payload.accounts[0].balance=488;monthly.payload.accounts[1].balance=-12;
monthly.payload.transactions.push(...[3001,3002].map((account_id,i)=>({id:80008+i,account_id,
  date:'2026-09-29',amount:12,currency:'cad',is_pending:false,category_id:910,
  category_name:'Bank fees',payee:'MONTHLY ACCOUNT FEE'})));
const mr=run(monthly);
assert.equal(mr.fees.actual,104);assert.equal(mr.fees.periodCost,104);
assert.equal(mr.p.bills.find(row=>row.id==='tdfees').status,'PAID','only genuine paired bank evidence settles the scheduled bill');
assert.equal(mr.p.bills.find(row=>row.id==='tdfees').actual,24);
assert.equal(mr.p.budgetProgress.bills.actual.amount,104);
assert.equal(mr.p.balanceAfterDeductions,1000-25-104-150);
assert.equal(mr.advice.cardPurchaseCoverage.reservedCash,80);
const raw={id:7,account_id:1,date:'2026-09-20',amount:9,category_id:910,category_name:'Bank fees',is_pending:false};
const catalog=new Map([['910',{id:'910',name:'Bank fees'}]]);
assert.equal(O.normalizeLunchMoneyTransaction(raw,catalog).bankFeeCategory,'verified');
assert.equal(O.normalizeLunchMoneyTransaction({...raw,category_id:999},catalog).bankFeeCategory,'unconfirmed');
const safe=JSON.stringify(run(fixture()).fees);
assert(!/categoryId|category_id|provider|coverageRef|80001|910|Invented issuer cost/.test(safe),
  'presentation projection omits raw identities, merchant and notes');
assert.deepEqual(fs.readFileSync(require.resolve('../data.json')),canonicalBefore);
console.log('PASS Bank fees identity, allowance/cost/cash conservation, pending, payment lifecycle and period boundaries ('+cases+' synthetic observations)');
