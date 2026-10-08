'use strict';
// Print-only Balance After Deductions terms on the Budget period view.
// Invented household (other-period-target fixture plus two invented bills).
// Expected cents below come from the invented inputs, not from Forecast:
//   income 1,400.00 every period (one confirmed biweekly salary);
//   bills  212.34 rent (biweekly from Sep 30) + 88.21 estimated hydro (15th);
//   household current = six plans 475.00 (groceries 110.37 under its 220)
//             + Other observed 618.73 above its 450 policy = 1,093.73;
//   household future  = 475.00 + Other policy 450.00 = 925.00.
// The identity is re-added here in integer cents from the printed strings.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const F=require('../public/forecast'),fx=require('./fixtures/other-period-target');
const stub=()=>({innerHTML:'',value:'',dataset:{},style:{},classList:{add(){},remove(){},toggle(){}},
 addEventListener(){},querySelector(){return null},querySelectorAll(){return[]},appendChild(){},replaceChildren(){}});
const context=vm.createContext({Forecast:F,console,setTimeout,clearTimeout,addEventListener(){},
 document:{getElementById:stub,querySelectorAll(){return[]},addEventListener(){},documentElement:{dataset:{},style:{}}},
 localStorage:{getItem(){return null},setItem(){}},location:{pathname:'/',search:''}});
context.window=context;context.matchMedia=()=>({matches:false,addEventListener(){}});
const script=name=>fs.readFileSync(path.join(__dirname,'../public/'+name+'.js'),'utf8');
vm.runInContext(script('app'),context);vm.runInContext('App.boot=()=>{};',context);
for(const name of ['bill-detail','savings-inventory','budget-surface','plan'])vm.runInContext(script(name),context);
const render=(period,plan,compact)=>{context.period=period;context.plan=plan;context.compact=compact;
 return vm.runInContext('calendarWaterfallHtml(period,null,null,plan,compact)',context);};
const KEYS=['periodIncome','assignedBills','householdBudgetHold','balanceAfterDeductions'];
const LABELS=['Period income','Assigned bills (incl. required debt minimums)',
 'Household (greater of plan or spent, incl. Other)','Balance After Deductions'];
const block=(html,id)=>{const q=html.split('data-operating-question="07"')[1];assert.ok(q,'terms print inside Balance After Deductions');
 const b=q.split(`data-bad-terms-period="${id}"`)[1];assert.ok(b,'one block per period id '+id);return b.split('</div>\n  </div>')[0]+'</div>';};
// [data-bad-term-amount] sits inside [data-bad-term-value]: plain money2 text
// (no ≈ prefix; trust stays on data-bad-term-trust), empty when unavailable.
const terms=b=>KEYS.map((key,i)=>{const m=b.match(new RegExp(`data-bad-term="${key}" data-bad-term-trust="([a-z]+)"><span data-bad-term-label>([^<]*)</span><span data-bad-term-value>(.*?)<span data-bad-term-amount>([^<]*)</span></span></div>`));
 assert.ok(m,'value and amount hooks for '+key);assert.equal(m[2],LABELS[i]);
 return{trust:m[1],text:(m[3]+m[4]).replace(/<[^>]+>/g,''),amount:m[4]};});
const cents=text=>{const m=text.match(/^(?:≈ estimated )?(−?)\$([\d,]+)\.(\d\d)$/);assert.ok(m,'money text: '+text);
 return (m[1]?-1:1)*(Number(m[2].replace(/,/g,''))*100+Number(m[3]));};

const f=fx.build(618.73);
f.plan.bills=[{id:'invented-rent',label:'Invented rent',frequency:'biweekly',anchor:'2026-09-30',amount:212.34,confidence:'confirmed',payingAccount:'chequing-a'},
 {id:'invented-hydro',label:'Invented hydro',frequency:'monthly',day:15,amount:88.21,confidence:'estimated',payingAccount:'chequing-a'}];
const advice=F.recommend(f.plan,f.date,{...f.plan.defaults,debts:[],currentPeriodActuals:f.packet});
const views=advice.payPeriodViews.filter(v=>v.timelineRole!=='past');
const expected=[['current',140000,21234,109373,false],['next',140000,30055,92500,true],
 ['future',140000,21234,92500,true],['future',140000,30055,92500,true]];
assert.ok(views.length>=4);
// (a) current + next + two later periods: printed terms close to the cent.
expected.forEach(([role,income,bills,hold,future],i)=>{
 const v=views[i];assert.equal(v.timelineRole,role);
 for(const compact of [true,false]){
  const sealed=JSON.stringify(v),b=block(render(v,f.plan,compact),v.id);
  assert.match(b,/data-bad-terms-status="published"/);
  const t=terms(b),[I,B,H,R]=t.map(x=>cents(x.text));
  assert.deepEqual([I,B,H],[income,bills,hold],`${v.id}: printed terms match invented inputs`);
  assert.equal(I-B-H,R,`${v.id}: Income − Bills − Household = Balance After Deductions to the cent`);
  assert.equal(R,income-bills-hold);
  // Trust marks follow the stamps plan.js already uses for these values.
  assert.equal(t[1].trust,bills===30055?'estimated':'calculated','estimated hydro marks bills');
  assert.equal(t[2].trust,future?'estimated':'calculated','future Other policy hold is estimated');
  assert.equal(t[3].trust,future?'estimated':'calculated');
  t.forEach(x=>assert.equal(x.text.startsWith('≈ estimated'),x.trust==='estimated'));
  t.forEach(x=>assert.equal(x.text,(x.trust==='estimated'?'≈ estimated ':'')+x.amount));
  assert.equal(JSON.stringify(v),sealed,'printing cannot rewrite the publication');
 }
});
// (b) null terms (Forecast's fail-closed publication) print Unavailable for
// all four, with no fallback to afterHouseholdBudget or the funded result.
const cur=views[0],fallback=['$93.93','93.93'];
// Fail-closed shapes: Forecast's null object (card minimum or income gate,
// forecast.js nulls terms and stamps the result unavailable), a non-closing
// object, a missing field, and the operating-plan-unavailable publication.
const failClosed={predictedEndingBalanceTerms:null,balanceAfterDeductions:null,predictedEndingBalance:null,balanceAfterDeductionsTrust:'unavailable'};
for(const over of [{predictedEndingBalanceTerms:null},failClosed,{...failClosed,operatingPlanUnavailable:true},
 {predictedEndingBalanceTerms:{...cur.predictedEndingBalanceTerms,closes:false}},{predictedEndingBalanceTerms:undefined}]){
 const v={...cur,...over};
 for(const compact of [true,false]){
  const b=block(render(v,f.plan,compact),v.id);
  assert.match(b,/data-bad-terms-status="unavailable"/);
  assert.deepEqual(terms(b).map(x=>[x.trust,x.text,x.amount]),KEYS.map(()=>['unavailable','Unavailable','']));
  fallback.forEach(s=>assert.ok(!b.includes(s),'no fallback figure '+s));
 }
}
// A single missing term is Unavailable for that term only.
const one=block(render({...cur,predictedEndingBalanceTerms:{...cur.predictedEndingBalanceTerms,assignedBills:null}},f.plan,true),cur.id);
assert.deepEqual(terms(one).map(x=>x.text==='Unavailable'),[false,true,false,false]);
// An unavailable trust stamp fails closed even when a number exists.
const untrusted=block(render({...cur,balanceAfterDeductionsTrust:'unavailable'},f.plan,true),cur.id);
assert.deepEqual(terms(untrusted).map(x=>x.text==='Unavailable'),[false,false,false,true]);
// (c) Amount hook on Forecast's published Oct 8 2026 terms (snapshot
// data-2026-10-08-548check.json: income, bills, household, BAD per period;
// household is calculated only in the current period). The Oct 6 snapshot
// published null terms, which is the fail-closed shape covered in (b).
const OCT8=[[6635.92,2706.67,3197.42,731.83,'$731.83'],[6652.30,3097.00,2175.00,1380.30,'$1,380.30'],
 [6651.99,2537.70,2275.00,1839.29,'$1,839.29'],[6432.85,2584.46,2175.00,1673.39,'$1,673.39']];
OCT8.forEach(([I,B,H,R,bad],i)=>{const v={...cur,predictedEndingBalanceTerms:{...cur.predictedEndingBalanceTerms,
 periodIncome:I,assignedBills:B,householdBudgetHold:H,balanceAfterDeductions:R},incomeTrust:'estimated',
 periodBillLoadTrust:'estimated',budgetHoldTrust:i?'estimated':null,balanceAfterDeductionsTrust:'estimated'};
 for(const compact of [true,false]){const t=terms(block(render(v,f.plan,compact),v.id));
  assert.equal(t[3].amount,bad);
  assert.deepEqual(t.map(x=>x.trust),['estimated','estimated',i?'estimated':'calculated','estimated']);
  t.forEach(x=>{assert.ok(!/[≈a-z]/i.test(x.amount),'plain amount '+x.amount);assert.equal(x.text,(x.trust==='estimated'?'≈ estimated ':'')+x.amount);});
  const [ci,cb,ch,cr]=t.map(x=>cents(x.amount));assert.equal(ci-cb-ch,cr);}
});
// Unavailable terms leave the amount hook empty.
for(const b of [one,untrusted])terms(b).filter(x=>x.trust==='unavailable').forEach(x=>assert.equal(x.amount,''));
// (d) Q07 result hooks: data-budget-result-trust plus [data-budget-result-amount]
// (plain money2, empty when unavailable) on the Q07 step (both layouts) and the
// non-compact hero. Visible text stays (≈ estimated) + amount, or Unavailable.
const result=(html,compact)=>{const strip=x=>x.replace(/<[^>]+>/g,'');
 const out=[html.match(/data-operating-question="07"[^>]*?data-budget-result-trust="([a-z]+)"[^]*?<span class="budget-step-value"[^>]*>(.*?)<span data-budget-result-amount>([^<]*)<\/span><\/span>/)];
 if(!compact)out.push(html.match(/data-budget-period-result data-budget-result-trust="([a-z]+)">[^]*?<p class="budget-period-result-value"[^>]*>(.*?)<span data-budget-result-amount>([^<]*)<\/span><\/p>/));
 return out.map(m=>{assert.ok(m,'Q07 result hook');return{trust:m[1],text:strip(m[2]+m[3]),amount:m[3]};});};
const funded={...cur,plannedCostFunding:{status:'ready',start:cur.start,end:cur.end,contribution:100,afterProposedFunding:1675,trust:'estimated',items:[],unscheduled:[]}};
for(const [v,trust,amount] of [[cur,'calculated','$93.93'],[views[1],'estimated','$174.45'],[funded,'estimated','$1,675.00'],[{...cur,...failClosed},'unavailable','']])
 for(const compact of [true,false]){const r=result(render(v,f.plan,compact),compact);assert.equal(r.length,compact?1:2);
  r.forEach(x=>{assert.deepEqual([x.trust,x.amount],[trust,amount]);assert.ok(!/≈/.test(x.amount));
   assert.equal(x.text,trust==='unavailable'?'Unavailable':(trust==='estimated'?'≈ estimated ':'')+amount);});}
console.log('bad terms print: 4 periods × 2 layouts close to the cent; null/non-closing/untrusted terms print Unavailable; amount hook plain (Oct 8 BAD 731.83/1,380.30/1,839.29/1,673.39); Q07 + hero result hooks (funded $1,675.00 est, unavailable empty)');
