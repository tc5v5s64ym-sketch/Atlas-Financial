'use strict';
const assert=require('node:assert/strict'),F=require('../public/forecast'),O=require('../scripts/provider-observe');
const fx=require('./fixtures/budget-income-receipts'),clone=x=>JSON.parse(JSON.stringify(x));
const built=fx.build(),before=JSON.stringify(built.data.plan);
const salary=built.candidates.find(x=>x.id==='amandaSalaryMonthEnd');
assert.ok(salary,'early external payroll and later paired transfer earn the bracketed salary occurrence');
assert.equal(salary.date,'2026-06-30');assert.equal(salary.postingDate,'2026-07-01');
assert.equal(salary.observedAmount,-1733.18,'actual receipt differs from expected plan 1800.25');
assert.deepEqual(new Set(salary.providerTransactionIds),new Set(['credit','debit','salary']));
const advice=F.recommend(built.data.plan,fx.AS_OF,{...built.data.plan.defaults,debts:[],currentPeriodActuals:built.packet});
const period=advice.payPeriodViews.find(x=>x.timelineRole==='current');
assert.equal(period.start,fx.START);assert.equal(period.end,fx.END);
assert.deepEqual([period.budgetProgress.income.actual.amount,period.budgetProgress.income.planned.amount],
 [4226.36,4320.50],'independent cents: 249318 + 173318; original plan 252025 + 180025');
assert.equal(period.budgetProgress.income.actual.completeness,'complete');
assert.equal(period.incomeTotal,4226.36,'active deduction chain reuses the receipt selector, not original planned income');
assert.equal(period.balanceAfterDeductions,3834.08,'actual receipts 4226.36 minus reserve 392.28; no bills in this invented period');
assert.equal(period.income.filter(x=>x.id==='amandaSalaryMonthEnd').length,1);
assert.ok(!period.income.some(x=>x.otherIncome),'transfer and external coaching are not new Other Income');
assert.equal(period.income.find(x=>x.id==='payroll').actual,-2493.18,'native payroll cents stay exact');
assert.deepEqual([period.budgetProgress.household.actual.amount,period.budgetProgress.household.planned.amount],
 [345.94,365],'independent current-cycle eligible debits 21531+10265+1835+963; current plans 22000+8500+6000');
assert.equal(period.budgetHold,392.28,'independent reserve max(220,215.31)+max(85,102.65)+max(60,18.35)+9.63');
assert.equal(period.householdBudget.find(x=>x.id==='other-spending').spent,9.63);
assert.deepEqual(period.householdBudget.find(x=>x.id==='other-spending').recon.map(x=>x.amount),[9.63]);
assert.equal(JSON.stringify(built.data.plan),before,'read-only Forecast publication preserves policy and amounts');
function noSalary(mutate,message){const rows=fx.transactions();mutate(rows);assert.ok(!fx.build(rows).candidates.some(x=>x.id==='amandaSalaryMonthEnd'),message);}
noSalary(rows=>rows.splice(rows.findIndex(x=>x.providerTransactionId==='salary'),1),'transfer pair without payroll identity stays unconfirmed');
noSalary(rows=>rows.find(x=>x.providerTransactionId==='salary').payee='INVENTED COACHING RECEIPT','business gross receipt is not salary');
noSalary(rows=>rows.find(x=>x.providerTransactionId==='salary').currency='usd','foreign payroll units do not become CAD');
noSalary(rows=>rows.find(x=>x.providerTransactionId==='salary').pending=true,'pending source is not received');
noSalary(rows=>rows.find(x=>x.providerTransactionId==='credit').pending=true,'pending transfer is not representation');
noSalary(rows=>rows.splice(rows.findIndex(x=>x.providerTransactionId==='debit'),1),'missing counterpart does not prove BILLS receipt');
noSalary(rows=>rows.push({...rows.find(x=>x.providerTransactionId==='salary'),providerTransactionId:'ambiguous-source'}),'two same-amount payroll sources are ambiguous');
noSalary(rows=>rows.push({...rows.find(x=>x.providerTransactionId==='credit'),providerTransactionId:'ambiguous-credit'}),'two same-amount BILLS transfers are ambiguous');
noSalary(rows=>rows.find(x=>x.providerTransactionId==='salary').date='2026-06-14','receipt outside complete evidence window cannot earn settlement');
for(const id of ['credit','debit']) noSalary(rows=>rows.find(x=>x.providerTransactionId===id).currency='usd','all transfer legs require native CAD');
noSalary(rows=>rows.find(x=>x.providerTransactionId==='salary').providerAccountId='fixture-weekly','same amount from a different provider account is not proof');
noSalary(rows=>rows.find(x=>x.providerTransactionId==='salary').isIncome=false,'source must be a classified income receipt');
noSalary(rows=>rows.find(x=>x.providerTransactionId==='salary').amount=-1733.17,'named employer with a different amount cannot join this transfer');
noSalary(rows=>rows.find(x=>x.providerTransactionId==='salary').date='2026-07-02','source after the transfer cannot bracket the nominal event');
noSalary(rows=>rows.find(x=>x.providerTransactionId==='debit').date='2026-07-02','counterpart must prove the same dated transfer');
const noBounds=clone(built.input);delete noBounds.transactionWindow.startDate;
assert.ok(!O.representedEventCandidates(noBounds).some(x=>x.id==='amandaSalaryMonthEnd'),'complete flag without explicit bounds is insufficient');
const exact=clone(built.input);for(const tx of exact.transactions.filter(x=>['salary','credit','debit'].includes(x.providerTransactionId))){tx.date='2026-06-30';tx.amount=tx.amount<0?-1800.25:1800.25;}
const exactSalary=O.representedEventCandidates(exact).filter(x=>x.id==='amandaSalaryMonthEnd');
assert.equal(exactSalary.length,1,'stronger receipt packet and legacy exact-date/amount evidence do not double count');
assert.equal(exactSalary[0].providerTransactionIds.length,3);
const twoOccurrences=clone(built.input);twoOccurrences.transactionWindow.startDate='2026-06-01';
twoOccurrences.transactions.find(x=>x.providerTransactionId==='salary').date='2026-06-14';
assert.ok(!O.representedEventCandidates(twoOccurrences).some(x=>x.id==='amandaSalaryMonthEnd'),
 'two bracketed semi-monthly occurrences cannot use one source');
const missing=fx.build(fx.transactions().filter(x=>x.providerTransactionId!=='salary'));
const unavailable=F.recommend(missing.data.plan,fx.AS_OF,{...missing.data.plan.defaults,debts:[],currentPeriodActuals:missing.packet})
 .payPeriodViews.find(x=>x.timelineRole==='current').budgetProgress.income;
assert.equal(unavailable.actual.amount,2493.18);assert.equal(unavailable.actual.completeness,'partial','unknown salary is not forced equal to plan');
const truncated=clone(built.input);truncated.transactionWindow.complete=false;
assert.equal(O.representedEventCandidates(truncated).length,0,'incomplete fetch cannot earn settlement');
console.log('PASS invented receipt -> unique transfer -> sanitized actuals -> Forecast -> active period; unequal plan/actual, exclusions, exact cents, scope, ambiguity and household reserve identity');
