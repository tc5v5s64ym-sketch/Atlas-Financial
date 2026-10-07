'use strict';
// Manual isolated input proof; the shared test registry is owned by another task.
// The behavior ledger below is invented independently, never copied/scaled
// from the owner amount, canonical opening, provider rows or credentials.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const F=require('../public/forecast'),Live=require('../scripts/live-plan');
const data=require('../data.json'),fees=require('./fixtures/scheduled-fee-routing-data');
const root=path.join(__dirname,'..'),clone=x=>JSON.parse(JSON.stringify(x));
const row=data.plan.bills.find(r=>r.id==='travelvisa-annual-fee-2027');
assert(row,'the authorized estimate is present');
assert.equal(row.frequency,'yearly');assert.equal(row.confidence,'estimated');
assert.equal(row.dateConfidence,'estimated');assert.equal(row.jointCash,false);
assert.equal(row.payingAccount,'travelvisa');
assert(data.debts.some(r=>r.id===row.payingAccount));
assert.match(row.note,/owner-authorized.*planning estimate/i);
assert.match(row.note,/not an issuer payment due date/i);
assert.equal(Object.hasOwn(row,'settledOn'),false);
assert.equal(Object.hasOwn(row,'statementOccurrences'),false);
const before=JSON.parse(cp.execFileSync('git',['-c','safe.directory='+root.replace(/\\/g,'/'),
  'show','c2f4ca19bba7a772be218bbc412da9920926d0ee:data.json'],{cwd:root,encoding:'utf8'}));
const removed=clone(data);removed.plan.bills=removed.plan.bills.filter(r=>r.id!==row.id);
assert.deepEqual(removed,before,'one appended input is the complete semantic delta');
console.log('PASS canonical scope: one estimated, card-paid, annual input; all old state identical');
const bill={id:'invented-card-fee',label:'Invented card annual estimate',frequency:row.frequency,
  month:4,day:23,firstDue:'2031-04-23',amount:73.41,confidence:row.confidence,dateConfidence:row.dateConfidence,
  jointCash:row.jointCash,payingAccount:'invented-card'};
const plan={windowDays:30,defaults:{targetBuffer:0,extraDebtMonthly:0,scenario:'expected'},
  startingCash:{amount:1200,breakdown:[{id:'chequing-a',label:'Invented cash',value:1200}]},
  opening:{asOf:'2031-04-01',representedEvents:[]},income:[],obligations:[],bills:[bill],commitments:[],
  budget:{variableWeekly:0,categories:[]},actions:[]};
const input=JSON.stringify(plan);
const events=F.expandEvents(plan,'2031-04-01','2031-04-30').filter(r=>r.id===bill.id);
assert.equal(events.length,1);assert.equal(events[0].date,'2031-04-23');
assert.equal(events[0].amount,-73.41);assert.equal(events[0].cardPaid,true);
assert.equal(events[0].jointCash,false);assert.equal(events[0].payingAccount,'invented-card');
assert.equal(events[0].confidence,'estimated');
// General bill events publish overall estimate trust; dateConfidence stays
// on the canonical input. Plan Spend labels the date as a cash-planning date.
assert.equal(plan.bills[0].dateConfidence,'estimated');
assert.equal(F.expandEvents(plan,'2030-04-01','2030-04-30').some(r=>r.id===bill.id),false);
const long=F.expandEvents(plan,'2031-04-01','2032-04-30').filter(r=>r.id===bill.id);
assert.deepEqual(long.map(r=>r.date),['2031-04-23','2032-04-23'],'annual dates are projected, never historical arrears');
assert(long.every(r=>r.confidence==='estimated'));
const sim=F.simulate(plan,'2031-04-01',{horizonDays:30,weeklyVariable:0,extraDebtMonthly:0});
assert.equal(Math.round(sim.totals.reserved*100),7341,'one invented principal reserved once');
assert.equal(sim.totals.bills,0,'no planned chequing bill debit is invented');
assert.equal(F.representedOccurrence(plan,bill.id,bill.firstDue,'2031-04-23'),false);
assert.equal(JSON.stringify(plan),input,'native planner does not mutate the input');
console.log('PASS independent ledger: one dated 73.41 reserve, zero joint-cash bills, estimated amount/date, no historical arrears or settlement');
function current(x){const live=Live.fromObservation(x);const advice=F.recommend(live.data.plan,x.asOf,
 {debts:live.data.debts,currentPeriodActuals:live.data.liveOverlay.currentPeriodActuals});
 return {live,advice,p:advice.payPeriodViews.find(p=>p.start<=x.asOf&&p.end>=x.asOf)};}
const baseline=current(fees(16,true)),x=fees(16,true);
x.data.plan.bills.push({...bill,month:5,day:23,firstDue:'2027-05-23'});
const next=current(x);
assert.equal(next.p.budgetProgress.bills.actual.amount,16);
assert.equal(next.p.householdBudget.find(r=>r.otherSpending).spent,17.56);
assert.equal(next.advice.cardPurchaseCoverage.reservedCash,13.37);
assert.equal(next.p.fromTodayFunding.availableNow,408.44);
assert.equal(next.p.liveCurrentBalance,487.81);
assert.deepEqual(next.live.data.debts,baseline.live.data.debts);
assert.equal(next.p.bills.some(r=>r.id===bill.id),false);
console.log('PASS current-year preservation: unexpected fees stay Other Spend, card coverage and observed cash/debt conserved');
