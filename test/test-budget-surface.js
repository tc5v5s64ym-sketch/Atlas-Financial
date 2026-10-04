'use strict';
// The active Budget renderer, end to end: invented household -> real
// observation/overlay -> real renderPlan -> #operating-surface-body.
// Expected figures are worked out here from the fixture's own inputs,
// independently of Forecast.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const F = require('../public/forecast');
const fx = require('./fixtures/budget-surface-data');

const ROOT = path.join(__dirname, '..');
let failures = 0;
function ok(cond, msg, detail) {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${msg}${!cond && detail ? `  — ${detail}` : ''}`);
  if (!cond) failures++;
}

// Independent expectations from the fixture header.
const money = n => '$' + n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const EXPECT = {
  income: 2600 + 1450,
  bills: 1400 + 120 + 60 + 85,
  paid: 1400,
  remaining: 120 + 60 + 85,
  household: 450 + 160 + 120 + 22.99,
  available: 1215 + 160,
  billsAccount: 1215,
  floor: 300,
};
EXPECT.afterBills = EXPECT.income - EXPECT.bills;
EXPECT.final = Math.round((EXPECT.afterBills - EXPECT.household) * 100) / 100;

function stubEl() {
  return { innerHTML: '', textContent: '', hidden: false, value: '',
    style: { setProperty() {}, getPropertyValue() { return ''; } }, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, hasAttribute() { return false; },
    addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    appendChild() {}, insertAdjacentHTML() {}, closest() { return null; }, children: [] };
}

// Load the Budget page scripts in index.html order.
function page() {
  const els = new Map();
  const context = vm.createContext({ Forecast: F, console, addEventListener() {}, setTimeout, clearTimeout,
    document: { addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; },
      getElementById(id) { if (!els.has(id)) els.set(id, stubEl()); return els.get(id); },
      documentElement: { dataset: {}, style: {} }, createElement: stubEl, createElementNS: stubEl, body: stubEl() },
    window: { addEventListener() {}, matchMedia() { return { matches: false, addEventListener() {} }; } },
    localStorage: { getItem() { return null; }, setItem() {} }, location: { pathname: '/', search: '' } });
  // In a browser window is the global object; page scripts register on it.
  context.window = Object.assign(context, { matchMedia() { return { matches: false, addEventListener() {} }; } });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8'), context);
  vm.runInContext('App.boot = () => {}; App.once = () => {}; App.register = () => {};', context);
  for (const f of ['forecast-chequing.js', 'balance-history.js', 'bill-detail.js', 'savings-inventory.js',
    'budget-surface.js', 'plan.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', f), 'utf8'), context);
  }
  // Charts need a real SVG DOM; they are not part of this surface.
  vm.runInContext('forecastChart = () => {}; renderCalendar = () => {};', context);
  vm.runInContext(`globalThis.__retainedCalls = 0;
    const __retained = operatingSurfaceHtml;
    operatingSurfaceHtml = function (ctx) { globalThis.__retainedCalls++; return __retained(ctx); };
    const __active = budgetSurfaceHtml;
    budgetSurfaceHtml = function (ctx) { globalThis.__ctx = ctx; return __active(ctx); };`, context);
  return {
    context,
    render(served) {
      context.served = served;
      // App.boot sets App.data to the served packet before renderPlan runs.
      vm.runInContext("Object.defineProperty(App, 'data', { get: () => served, configurable: true });", context);
      vm.runInContext('Object.assign(state, served.plan.defaults, { debts: served.debts }); renderPlan(served, null, null);', context);
      return els.get('operating-surface-body').innerHTML;
    },
    rerender(js) { return vm.runInContext(`${js}; budgetSurfaceHtml(__ctx)`, context); },
  };
}

const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const step = (html, n) => {
  const m = new RegExp(`data-operating-question="${n}"[\\s\\S]*?</summary>`).exec(html);
  return m ? text(m[0]) : '';
};
const section = (html, kind) => {
  if (kind === 'period') return html.slice(html.indexOf('<!--budget-current-position-end-->'));
  const start = html.indexOf(`data-budget-surface-section="${kind}"`);
  if (start < 0) return '';
  if (kind === 'today') return html.slice(start, html.indexOf('<!--budget-current-position-end-->', start));
  const next = html.indexOf('data-budget-surface-section="', start + 10);
  return html.slice(start, next < 0 ? html.length : next);
};

console.log('\n=== one active renderer ===');
const p = page();
const html = p.render(fx.served());
console.log('\n=== published window above the compact overview ===');
ok(html.indexOf('data-budget-window-header') < html.indexOf('data-live-current-balance'),
  'the selected window precedes Current balance in the one primary section');
ok((html.match(/class="budget-surface-card /g) || []).length === 1,
  'Current balance and period deductions share one overview card');
ok((html.match(/data-budget-period-result/g) || []).length === 1
  && (html.match(/\$1,632\.01/g) || []).length === 1,
  'the final result is published once at the end, including its expanded evidence');
ok(/data-budget-window-range>Aug 14 – Aug 27</.test(html),
  'the title uses the actual published bounds rather than the This payday label');
ok(/<b>Day 7<\/b> of 14/.test(html) && /Next payday <b>Aug 28<\/b> · in 8 days/.test(html),
  'independent date identity: Aug 20 is day seven of Aug 14–27; Aug 28 is eight days later');
ok((html.match(/data-budget-wheel="period"/g) || []).length === 1
  && /data-budget-window-picker hidden/.test(html), 'one real period wheel is available on demand');
ok(/data-budget-detail-sheet/.test(html) && ['overview', 'spending', 'bills', 'upcoming'].every(key =>
  html.includes(`data-budget-section="${key}"`)), 'the compact section controls and one shared sheet are present');
const dateContext = vm.runInContext(`({ advice: { defaultView: {asOf: '2026-08-20'}, payPeriodViews: [
  {id: 'invented-invalid-dates', start: '2026-02-30', end: '2026-03-12', timelineRole: 'current'}] } })`, p.context);
p.context.dateContext = dateContext;
const missingDates = vm.runInContext('budgetWindowHeaderHtml(dateContext)', p.context);
ok(/Date progress unavailable/.test(missingDates) && !/<b>Day /.test(missingDates),
  'invalid dates withhold progress rather than normalizing into a fictitious day');
const missingAsOf = vm.runInContext(`dateContext.advice.payPeriodViews[0].start = '2026-08-14';
  dateContext.advice.payPeriodViews[0].end = '2026-08-27'; dateContext.asOf = '2026-08-20';
  dateContext.advice.defaultView.asOf = null; budgetWindowHeaderHtml(dateContext)`, p.context);
ok(/Date progress unavailable/.test(missingAsOf) && !/<b>Day /.test(missingAsOf),
  'an explicitly missing published as-of does not fall back to another date');
ok(/data-budget-surface="pay-period"/.test(html), 'renderPlan mounts the active Budget surface in pay-period view');
ok(p.context.__retainedCalls === 0, 'the retained operatingSurfaceHtml is not called on the page path',
  `${p.context.__retainedCalls} call(s)`);
ok(!/data-budget-more-views|data-current-payday-details/.test(html),
  'the old "More Budget views" and "Current payday details" disclosures are not rendered');
ok((html.match(/data-calendar-waterfall="/g) || []).length === 1, 'exactly one pay-period waterfall is printed');
const hero = text(/data-budget-period-result[\s\S]*?<\/div>/.exec(html)?.[0] || '');
ok(hero.includes(money(EXPECT.final)) && /estimated/.test(hero) && /Before savings/.test(hero),
  'the overview republishes the independently reconciled final balance and its estimate/before-savings qualifier');
const bar = id => /style="left:([^%]+)%;width:([^%]+)%"/.exec(
  html.split(`data-operating-question="${id}"`)[1]?.split('</summary>')[0] || '');
ok(bar('02') && Number(bar('02')[1]) === 0 && Number(bar('02')[2]) === 100,
  'income fills the fixed income scale');
ok(bar('04') && Math.abs(Number(bar('04')[1]) - EXPECT.afterBills / EXPECT.income * 100) < 1e-9
  && Math.abs(Number(bar('04')[2]) - EXPECT.bills / EXPECT.income * 100) < 1e-9,
  'the bill deduction occupies its independently derived segment on the same scale');
ok(bar('07') && Math.abs(Number(bar('07')[2]) - EXPECT.final / EXPECT.income * 100) < 1e-9,
  'the final bar keeps the income scale rather than rescaling the ending balance');
ok(!bar('savings') && /budget-waterfall-track is-unknown/.test(
  html.split('data-operating-question="savings"')[1]?.split('</summary>')[0] || ''),
  'unavailable savings are hatched with no invented zero-length numeric bar');

console.log('\n=== pay-period waterfall on the active surface ===');
console.log('\n=== published category bars and grouped bills ===');
const categoryBrowse = (output, id) => output.split(`data-budget-category-open="${id}" data-budget-browse-origin="spending"`)[1]?.split('</button>')[0] || '';
ok(text(categoryBrowse(html, 'groceries')).includes('$308.55 of $450.00')
  && text(categoryBrowse(html, 'groceries')).includes('$141.45 left'),
  'the default grocery row uses independently observed 212.40 + 96.15 and published remaining 141.45');
const categoryFill = /budget-category-fill" style="width:([^%]+)%/.exec(categoryBrowse(html, 'groceries'));
ok(categoryFill && Math.abs(Number(categoryFill[1]) - 308.55 / 450 * 100) < 1e-9,
  'category geometry uses spent/plan rather than a new reserve amount');
ok(/data-budget-browse-hold[\s\S]*?752\.99/.test(html)
  && /data-budget-browse-remaining[\s\S]*?308\.50/.test(html),
  'the reserve is the selected-period publication; current remaining is the matching dated from-today publication');
ok(/budget-bill-group[\s\S]*?Coming up[\s\S]*?data-budget-bill-open="card-minimum"/.test(html)
  && /To confirm[\s\S]*?data-budget-bill-open="hydro"/.test(html),
  'upcoming and unverified bill occurrences remain separate without inferring unpaid status');
ok(/budget-browse-paid[\s\S]*?data-budget-bill-open="mortgage"/.test(html)
  && /data-budget-browse-bills-remaining[\s\S]*?265\.00/.test(html),
  'paid occurrence is folded while the header reprints Forecast remaining bills 265');
const noSpent = p.rerender("__ctx.advice.payPeriodViews.find(row=>row.timelineRole==='current').householdBudget[0].spent = null");
ok(/Spending unavailable/.test(categoryBrowse(noSpent, 'groceries'))
  && !/141\.45 left|budget-category-fill/.test(categoryBrowse(noSpent, 'groceries')),
  'unavailable spending is not classified within plan, replaced by zero or given a numeric bar');
p.render(fx.served());
const noPlan = p.rerender("__ctx.advice.payPeriodViews.find(row=>row.timelineRole==='current').householdBudget[0].planned = null");
ok(/is-hatched/.test(categoryBrowse(noPlan, 'groceries')) && /data-budget-category-scale="unavailable"/.test(categoryBrowse(noPlan, 'groceries'))
  && !/budget-category-fill/.test(categoryBrowse(noPlan, 'groceries')) && /308\.55/.test(categoryBrowse(noPlan, 'groceries')),
  'missing category plan withholds only ratio geometry while observed spending stays known');
p.render(fx.served());
const noHoldTrust = p.rerender("__ctx.advice.payPeriodViews.find(row=>row.timelineRole==='current').budgetHoldTrust = 'unavailable'");
ok(/data-budget-browse-hold[^>]*><span class="budget-browse-unknown">Unavailable/.test(noHoldTrust),
  'an explicitly unavailable reserve stays unavailable in the new secondary summary');
p.render(fx.served());
const zeroBills = p.rerender("Object.assign(__ctx.advice.payPeriodViews.find(row=>row.timelineRole==='current'), {totalBillsThisPeriod:0,paidBills:0,remainingBills:0})");
ok(/budget-bills-progress is-no-scale/.test(zeroBills) && !/budget-bills-progress is-hatched/.test(zeroBills),
  'known zero bills use an explicit no-scale track rather than an unavailable hatch or a division by zero');
p.render(fx.served());
const unknownBill = p.rerender("Object.assign(__ctx.advice.payPeriodViews.find(row=>row.timelineRole==='current').bills.find(row=>row.id==='hydro'), {status:null,settlement:null})");
ok(/Status unavailable[\s\S]*?data-budget-bill-open="hydro"/.test(unknownBill),
  'a bill with no published settlement remains in the unknown group rather than being inferred due or paid');
p.render(fx.served());
const stampedHold = p.rerender("__ctx.advice.payPeriodViews.find(row=>row.timelineRole==='current').budgetHold = 612.34");
ok(/data-budget-browse-hold[^>]*>\$612\.34</.test(stampedHold),
  'the new reserve summary selects the publication without summing category rows');
for (const change of ["remainingHousehold = null", "currentThrough = '2026-09-10'", "asOf = '2026-08-19'", "trust = 'unavailable'"]) {
  p.render(fx.served());
  const result = p.rerender(`__ctx.advice.payPeriodViews.find(row=>row.timelineRole==='current').fromTodayFunding.${change}`);
  ok(/data-budget-browse-remaining[^>]*><span class="budget-browse-unknown">Unavailable/.test(result),
    `${change}: matching current remaining is withheld, never recomputed from categories`);
}
p.render(fx.served());

console.log('\n=== historical spending and bill summaries ===');
const browseCard = (output, kind) => {
  const start = output.indexOf(`data-budget-browse="${kind}"`);
  if (start < 0) return '';
  const from = output.slice(start);
  const end = from.indexOf('</section>');
  return from.slice(0, end < 0 ? from.length : end);
};
const selectPublishedPeriod = (pageObj, start) => pageObj.rerender(
  `planPayPeriodId = String((__ctx.advice.payPeriodViews.find(item => item.start === ${JSON.stringify(start)}) || {}).id || ${JSON.stringify(start)});
   __ctx.planPayPeriodId = planPayPeriodId`);
ok(/data-budget-spending-evidence="current"/.test(html)
  && /0 of 3 known categories over plan/.test(html)
  && /data-budget-bills-remaining-scope="actionable"/.test(html)
  && /data-budget-browse-bills-remaining[\s\S]*?265\.00/.test(html)
  && /left to pay or confirm/.test(browseCard(html, 'bills')),
  'current remaining 265 and the known-category count stay on the live period');
const unavailableHistory = selectPublishedPeriod(p, '2026-07-31');
const unavailableSpend = browseCard(unavailableHistory, 'spending');
ok(/data-budget-spending-evidence="unavailable"/.test(unavailableSpend)
  && /Spending unavailable · completed period/.test(unavailableSpend)
  && !/Observed spending · completed period/.test(unavailableSpend)
  && /data-budget-browse-hold[^>]*><span class="budget-browse-unknown">Unavailable/.test(unavailableSpend)
  && /Missing or incomplete history is not treated as observed spending/.test(unavailableSpend)
  && ['groceries', 'fuel', 'restaurants'].every(id => /Spending unavailable/.test(categoryBrowse(unavailableHistory, id))),
  'Jul 31–Aug 13 omitted observations stay unavailable, not counted $0 observed history');
p.render(fx.served());
const partialHistory = p.rerender(`
  (__ctx.advice.payPeriodViews.find(item => item.start === '2026-07-31').householdBudget.find(item => item.id === 'groceries')).spent = 80;
  (__ctx.advice.payPeriodViews.find(item => item.start === '2026-07-31').householdBudget.find(item => item.id === 'fuel')).spent = null;
  (__ctx.advice.payPeriodViews.find(item => item.start === '2026-07-31').householdBudget.find(item => item.id === 'restaurants')).spent = null;
  __ctx.advice.payPeriodViews.find(item => item.start === '2026-07-31').budgetHold = 80;
  planPayPeriodId = 'past:2026-07-31'; __ctx.planPayPeriodId = planPayPeriodId`);
const partialSpend = browseCard(partialHistory, 'spending');
ok(/data-budget-spending-evidence="partial"/.test(partialSpend)
  && /Incomplete spending evidence · completed period/.test(partialSpend)
  && !/Observed spending · completed period/.test(partialSpend)
  && /data-budget-browse-hold[^>]*><span class="budget-browse-unknown">Unavailable/.test(partialSpend)
  && !/data-budget-browse-hold[^>]*>\$80\.00</.test(partialSpend)
  && /80\.00 of/.test(categoryBrowse(partialHistory, 'groceries')),
  'partial history keeps the observed grocery 80 and withholds an incomplete counted total');
p.render(fx.served());
const knownHistory = p.rerender(`
  (__ctx.advice.payPeriodViews.find(item => item.start === '2026-07-31').householdBudget.find(item => item.id === 'groceries')).spent = 80;
  (__ctx.advice.payPeriodViews.find(item => item.start === '2026-07-31').householdBudget.find(item => item.id === 'fuel')).spent = 20;
  (__ctx.advice.payPeriodViews.find(item => item.start === '2026-07-31').householdBudget.find(item => item.id === 'restaurants')).spent = 10;
  __ctx.advice.payPeriodViews.find(item => item.start === '2026-07-31').budgetHold = 110;
  planPayPeriodId = 'past:2026-07-31'; __ctx.planPayPeriodId = planPayPeriodId`);
const knownSpend = browseCard(knownHistory, 'spending');
ok(/data-budget-spending-evidence="observed"/.test(knownSpend)
  && /Observed spending · completed period/.test(knownSpend)
  && /data-budget-browse-hold[^>]*>\$110\.00</.test(knownSpend)
  && /Completed periods show observed spending/.test(knownSpend),
  'complete lookback 80 + 20 + 10 reprints the published 110 counted total');
const hydroPage = page();
hydroPage.render(fx.served({ historicalHydroDay: 5 }));
const hydroLookback = selectPublishedPeriod(hydroPage, '2026-07-31');
const hydroPeriod = hydroPage.context.__ctx.advice.payPeriodViews.find(row => row.start === '2026-07-31');
ok(hydroPeriod && hydroPeriod.remainingBills === 0 && hydroPeriod.totalBillsThisPeriod === 120
  && hydroPeriod.bills.some(row => row.id === 'hydro' && row.date === '2026-08-05'
    && row.settlement === 'unverified' && row.status === 'planned' && row.remaining === 120),
  'Forecast seals Aug 5 Hydro 120 as planned/unverified and keeps historical remaining 0');
const hydroBills = browseCard(hydroLookback, 'bills');
ok(/data-budget-bills-remaining-scope="historical-unconfirmed"/.test(hydroBills)
  && /Settlement not fully confirmed/.test(hydroBills)
  && !/left to pay or confirm/.test(hydroBills)
  && !/\$0\.00/.test(/id="budget-bills-heading"[\s\S]*?<\/h2>/.exec(hydroBills)?.[0] || '')
  && /1 to confirm/.test(hydroBills)
  && /To confirm[\s\S]*?data-budget-bill-open="hydro"[\s\S]*?Not confirmed[\s\S]*?120\.00/.test(hydroBills)
  && /data-period-bill="hydro"[\s\S]*?Missing evidence does not mean unpaid/.test(hydroLookback),
  'unverified historical Hydro withholds the actionable $0 heading and keeps original evidence');
const paidHistory = hydroPage.rerender(`
  Object.assign(__ctx.advice.payPeriodViews.find(item => item.start === '2026-07-31').bills.find(item => item.id === 'hydro'), {status:'PAID',settlement:'represented',remaining:0});
  Object.assign(__ctx.advice.payPeriodViews.find(item => item.start === '2026-07-31'), {paidBills:120, remainingBills:0});`);
const paidBills = browseCard(paidHistory, 'bills');
ok(/data-budget-bills-remaining-scope="actionable"/.test(paidBills)
  && /data-budget-browse-bills-remaining[\s\S]*?0\.00/.test(paidBills)
  && /left to pay or confirm/.test(paidBills)
  && /budget-browse-paid[\s\S]*?data-budget-bill-open="hydro"/.test(paidBills)
  && !/To confirm[\s\S]*?data-budget-bill-open="hydro"/.test(paidBills),
  'paid historical Hydro can show the published $0 remaining without a false confirm group');
const unknownHistory = hydroPage.rerender(`
  Object.assign(__ctx.advice.payPeriodViews.find(item => item.start === '2026-07-31').bills.find(item => item.id === 'hydro'), {status:null,settlement:null,remaining:120});
  Object.assign(__ctx.advice.payPeriodViews.find(item => item.start === '2026-07-31'), {paidBills:0, remainingBills:0});`);
const unknownBills = browseCard(unknownHistory, 'bills');
ok(/data-budget-bills-remaining-scope="historical-unconfirmed"/.test(unknownBills)
  && /Settlement not fully confirmed/.test(unknownBills)
  && !/left to pay or confirm/.test(unknownBills)
  && /Status unavailable[\s\S]*?data-budget-bill-open="hydro"/.test(unknownBills)
  && /1 unavailable/.test(unknownBills),
  'unknown historical settlement withholds the $0 all-clear and does not infer unpaid');
const restoredCurrent = hydroPage.rerender(`
  planPayPeriodId = null; __ctx.planPayPeriodId = null`);
ok(/data-budget-spending-evidence="current"/.test(restoredCurrent)
  && /data-budget-browse-bills-remaining[\s\S]*?145\.00/.test(restoredCurrent)
  && /left to pay or confirm/.test(browseCard(restoredCurrent, 'bills'))
  && /0 of 3 known categories over plan/.test(restoredCurrent),
  'moving Hydro to Aug 5 leaves current remaining 60+85=145 on the live contract');
p.render(fx.served());
const nextProjected = p.context.__ctx.advice.payPeriodViews.find(row => row.timelineRole === 'next');
const nextBrowse = p.rerender(`planPayPeriodId = ${JSON.stringify(String(nextProjected.id || nextProjected.start))}; __ctx.planPayPeriodId = planPayPeriodId`);
ok(/data-budget-spending-evidence="projected"/.test(nextBrowse)
  && /Projected plan · spending not observed/.test(browseCard(nextBrowse, 'spending'))
  && /data-budget-bills-remaining-scope="actionable"/.test(nextBrowse),
  'the next payday still uses projected spending wording and the published remaining scope');
p.rerender('planPayPeriodId = null; __ctx.planPayPeriodId = null');

ok(step(html, '02').includes(money(EXPECT.income)) && /≈ estimated/.test(step(html, '02')),
  `Income is ${money(EXPECT.income)} with Forecast's estimated tag`, step(html, '02'));
ok(step(html, '04').includes(money(EXPECT.bills)), `Bills deduction is ${money(EXPECT.bills)}`, step(html, '04'));
ok(step(html, '05').includes(money(EXPECT.afterBills)), `Balance after bills is ${money(EXPECT.afterBills)}`, step(html, '05'));
ok(step(html, '06').includes(money(EXPECT.household)), `Household budget is ${money(EXPECT.household)}`, step(html, '06'));
ok(step(html, '07').includes(money(EXPECT.final)) && /≈ estimated/.test(step(html, '07')),
  `Balance After Deductions is ${money(EXPECT.final)}, estimated`, step(html, '07'));
ok(/Proposed savings[\s\S]*?Unavailable/.test(text(html)) && !/Proposed savings[^$]*\$0\.00/.test(step(html, 'savings')),
  'the period savings step with no funding snapshot reads Unavailable, never $0');

console.log('\n=== bills, evidence and spending on the active surface ===');
const t = text(html);
ok(t.includes(`Total bills this period ${money(EXPECT.bills)}`), `total bills are Forecast's ${money(EXPECT.bills)}`);
ok(t.includes(`Paid bills this period ${money(EXPECT.paid)}`), `paid bills are ${money(EXPECT.paid)}`);
ok(t.includes(`Remaining bills to pay ${money(EXPECT.remaining)}`), `remaining bills are ${money(EXPECT.remaining)}`);
ok(/data-period-bill="hydro"[\s\S]*?Missing evidence does not mean unpaid/.test(html),
  'a past-due bill with no linked payment is not called unpaid');
ok(/data-period-bill="mortgage"[\s\S]*?Linked transaction evidence/.test(html),
  'the paid mortgage keeps its linked transaction evidence');
ok(/data-budget-spent="groceries"[\s\S]*?Synthetic grocer[\s\S]*?212\.40[\s\S]*?Synthetic market[\s\S]*?96\.15/.test(html),
  'Groceries opens to its transactions');
ok(/data-other-spending[\s\S]*?Synthetic general store/.test(html), 'unassigned spending keeps its transaction');

console.log('\n=== signed deficits, overflow and known zero income on the financial path ===');
const summaryHtml = (source, id) => source.split(`data-operating-question="${id}"`)[1]?.split('</summary>')[0] || '';
const segments = source => [...source.matchAll(/class="budget-waterfall-bar([^\"]*)" style="left:([^%]+)%;width:([^%]+)%"/g)]
  .map(match => ({ negative: match[1].includes('is-negative'), left: Number(match[2]), width: Number(match[3]) }));
const deficitHtml = page().render(fx.served({ periodInternet: 1800 }));
// 4,050 income - (1,400 + 120 + 60 + 1,800) bills = 670;
// 670 - 752.99 household = -82.99. Shared axis is [-4,050, +4,050].
ok(step(deficitHtml, '04').includes(money(3380)) && step(deficitHtml, '05').includes(money(670)),
  'synthetic observations produce the independent 3,380 bill load and 670 after bills');
ok(/data-sign="negative"/.test(summaryHtml(deficitHtml, '07')) && /82\.99/.test(step(deficitHtml, '07'))
  && /estimated/.test(step(deficitHtml, '07')), 'the -82.99 final balance keeps its sign and Forecast estimate');
for (const id of ['06', '07']) ok(/data-budget-bar-state="deficit"/.test(summaryHtml(deficitHtml, id))
  && !/is-unknown/.test(summaryHtml(deficitHtml, id)), `${id}: a known negative start or amount is a deficit, never unknown`);
const incomeSegments = segments(summaryHtml(deficitHtml, '02'));
ok(incomeSegments.length === 1 && incomeSegments[0].left === 50 && incomeSegments[0].width === 50,
  'every signed-period row uses zero at the shared midpoint and the same income units');
const householdSegments = segments(summaryHtml(deficitHtml, '06'));
ok(householdSegments.length === 2 && householdSegments[0].negative && !householdSegments[1].negative
  && Math.abs(householdSegments[0].width - 82.99 / 4050 * 50) < 1e-9
  && Math.abs(householdSegments[1].width - 670 / 4050 * 50) < 1e-9,
  'the household deduction crosses zero: 82.99 below zero and 670 above, without losing either signed portion');
const overflowHtml = page().render(fx.served({ periodInternet: 10000 }));
ok(/is-overflow-start/.test(summaryHtml(overflowHtml, '07')) && /8,282\.99/.test(step(overflowHtml, '07'))
  && !/is-unknown/.test(summaryHtml(overflowHtml, '07')),
  'known -8,282.99 beyond the -4,050 axis gets signed overflow, not an unavailable hatch');
const zeroIncomeHtml = page().render(fx.served({ zeroIncome: true }));
ok(step(zeroIncomeHtml, '02').includes(money(0)) && !/Unavailable/.test(step(zeroIncomeHtml, '02')),
  'no invented salary receipt: zero income remains a published known zero');
for (const id of ['02', '04', '06', '07']) ok(/data-budget-bar-state="zero-income"/.test(summaryHtml(zeroIncomeHtml, id))
  && !/is-unknown/.test(summaryHtml(zeroIncomeHtml, id)) && segments(summaryHtml(zeroIncomeHtml, id)).length === 0,
  `${id}: zero income disables ratio geometry explicitly, without dividing by zero or changing trust`);
ok(/data-sign="negative"/.test(summaryHtml(zeroIncomeHtml, '07')) && /2,417\.99/.test(step(zeroIncomeHtml, '07')),
  'zero-income deficit independently reconciles 0 - 1,665 - 752.99 = -2,417.99');

console.log('\n=== published amount trust is independent of chart scaling ===');
// Fault injection at the Forecast publication boundary, through the active
// composer. The observation/Forecast regressions above reconcile real figures;
// this matrix checks that a missing ratio denominator cannot change their trust.
const matrixPage = page();
matrixPage.render(fx.served());
const publishedRow = '__ctx.advice.payPeriodViews.find(row => row.start === "2026-08-14")';
const matrix = (amount, amountTrust, income, incomeTrust, position = 0) => matrixPage.rerender(`
  Object.assign(${publishedRow}, { budgetHold: ${amount}, budgetHoldTrust: ${JSON.stringify(amountTrust)},
    predictedEndingBalance: ${amount}, afterHouseholdBudget: ${position},
    balanceAfterDeductionsTrust: ${JSON.stringify(amountTrust)},
    available: ${income}, incomeTrust: ${JSON.stringify(incomeTrust)} })`);
for (const trust of ['calculated', 'estimated', null]) for (const amount of [100, 0, -100]) {
  for (const income of [4050, 0]) {
    const result = matrix(amount, trust, income, trust || 'calculated', amount < 0 ? -100 : 0);
    for (const id of ['06', '07']) {
      const row = summaryHtml(result, id);
      ok(!/is-unknown|Unavailable/.test(row) && /data-budget-bar-state=/.test(row)
        && (income !== 0 || /data-budget-bar-state="zero-income"/.test(row)),
      `${trust} amount ${amount}, income ${income}, row ${id}: known money survives scale availability`);
    }
    const hero = text(/data-budget-period-result[\s\S]*?<\/div>/.exec(result)?.[0] || '');
    ok(!/Unavailable/.test(hero) && hero.includes(Math.abs(amount).toFixed(2)),
      `${trust} amount ${amount}, income ${income}: result hero agrees with row trust`);
  }
  for (const [income, incomeTrust] of [['null', 'unavailable'], ['NaN', 'calculated'],
    ['Infinity', 'estimated'], [4050, 'unknown'], [4050, 'untrusted'], [-4050, 'calculated']]) {
    const result = matrix(amount, trust, income, incomeTrust);
    for (const id of ['06', '07']) ok(/data-budget-bar-state="unscaled"/.test(summaryHtml(result, id))
      && !/is-unknown|Unavailable/.test(summaryHtml(result, id)),
    `${trust} amount ${amount}, denominator ${income}/${incomeTrust}, row ${id}: scale unavailable, money known`);
  }
  for (const position of ['null', 'NaN', 'Infinity']) {
    const result = matrix(amount, trust, 4050, 'calculated', position);
    ok(/data-budget-bar-state="unscaled"/.test(summaryHtml(result, '06'))
      && !/is-unknown|Unavailable/.test(summaryHtml(result, '06')),
    `${trust} amount ${amount}, position ${position}: missing chart position cannot withhold known money`);
  }
}
for (const amount of [100, 0, -100, 'null', 'NaN', 'Infinity', '"100"']) {
  for (const trust of ['unavailable', 'unknown', 'untrusted']) {
    const result = matrix(amount, trust, 4050, 'calculated');
    for (const id of ['06', '07']) ok(/is-unknown/.test(summaryHtml(result, id))
      && /Unavailable/.test(summaryHtml(result, id)) && segments(summaryHtml(result, id)).length === 0,
    `${amount}/${trust}, row ${id}: unpublished money is withheld with no numeric bar`);
    ok(/Unavailable/.test(text(/data-budget-period-result[\s\S]*?<\/div>/.exec(result)?.[0] || '')),
      `${amount}/${trust}: result hero also withholds unpublished money`);
  }
}
for (const amount of ['NaN', 'Infinity', '"100"']) {
  const result = matrix(amount, 'calculated', 0, 'calculated');
  for (const id of ['06', '07']) ok(/is-unknown/.test(summaryHtml(result, id))
    && /Unavailable/.test(summaryHtml(result, id)), `${amount}/calculated, row ${id}: nonnumeric money stays unknown at zero income`);
}

console.log("\n=== today's money and the next-payday plan ===");
const today = text(section(html, 'today'));
const period = text(section(html, 'period'));
ok(today.includes(`Money available ${money(EXPECT.available)} calculated`), `Money available is ${money(EXPECT.available)}, calculated`, today.slice(0, 200));
ok(today.includes(`Keep at least ${money(EXPECT.floor)} calculated`), `the floor is Forecast's ${money(EXPECT.floor)}, calculated`);
ok(today.includes(`Bills & required minimums ${money(EXPECT.remaining)} estimate`), 'bills still to pay today keep their estimate tag');
ok(/Nest Money funding plan — August 28 payday/.test(today), 'the next-payday plan is in the Today section, labelled with its payday');
ok(/From today · 2026-08-20/.test(period) && !/From today ·/.test(today),
  "today's proposal sits with the period, separate from the next-payday plan");
ok(today.includes(money(EXPECT.billsAccount)) && /Bills account only/.test(today), `Current balance is the published Bills-only ${money(EXPECT.billsAccount)}`);
ok((html.match(/data-live-current-balance-amount/g) || []).length === 1,
  'the Bills-only Current balance is printed once in the active overview');
const currentHero = /data-budget-cash-hero[\s\S]*?<\/p>/.exec(html)?.[0] || '';
ok(currentHero.includes(money(EXPECT.billsAccount)) && !currentHero.includes(money(EXPECT.available)),
  'the prominent Current balance does not aggregate daily-spending cash');
ok(/data-budget-today-evidence[^>]* hidden/.test(html), 'current-position explanations and instructions start folded');
const currentProtection = p.context.__ctx.advice.paydayAllocation.protectedPath;
const keepHtml = /data-budget-cash-keep[\s\S]*?<\/div>/.exec(html)?.[0] || '';
ok(currentProtection.status === 'calculated' && currentProtection.allocated > 300
  && keepHtml.includes(money(currentProtection.allocated)) && /After bills &amp; essentials/.test(keepHtml),
  'Keep republishes current Forecast protection, including future needs beyond the cash floor; it never substitutes the floor');
// Publication-boundary identity proof, independent of the detail-line amount.
// Engine correctness is independently cash-walk reconciled in test-prepare-ahead.
const stampedKeep = p.rerender("__ctx.advice.paydayAllocation.protectedPath = { status: 'calculated', allocated: 456.78 }; __ctx.advice.paydayAllocation.lines = [{ kind: 'future-path', amount: 9999 }]");
const stampedKeepHtml = /data-budget-cash-keep[\s\S]*?<\/div>/.exec(stampedKeep)?.[0] || '';
ok(stampedKeepHtml.includes('$456.78') && !/300\.00|9999|9,999/.test(stampedKeepHtml),
  'Keep uses the authoritative protected-path publication, independently of the floor or incompatible detail-line amounts');
const missingProtection = p.rerender("__ctx.advice.paydayAllocation.protectedPath = { status: 'unavailable', allocated: null }");
ok(/data-budget-cash-keep[\s\S]*?Unavailable/.test(missingProtection)
  && !/data-budget-cash-keep[\s\S]*?<\/div>/.exec(missingProtection)?.[0].includes('$0.00'),
  'unavailable protection stays unavailable, without a zero or cash-floor substitute');
p.render(fx.served());
ok(section(html, 'today').indexOf('data-budget-cash-detail') > section(html, 'today').indexOf('data-budget-today-evidence'),
  'household cash breakdown stays in the info disclosure, outside the permanent overview');
ok(/class="budget-period-info"[\s\S]*data-from-today-proposal[\s\S]*<\/details>/.test(section(html, 'period')),
  'the dated current-cash proposal stays reachable behind period info, distinct from the full-period result');
ok(/data-budget-cash-part="floor"[\s\S]*?calculated[\s\S]*?300\.00/.test(html),
  'the cash floor uses its own published calculated trust, rather than the proposal estimate');
ok(/data-budget-cash-answer[\s\S]*?873\.50[\s\S]*?501\.50/.test(html),
  'Today funding includes dining: (450 - 308.55) + (160 - 74.20) + (120 - 38.75) = 308.50; keep 265 + 308.50 + 300 = 873.50; capacity 1375 - 873.50 = 501.50');
const negativeSpending = page().render(fx.served({ spendingCash: -50, savingsCash: 8000 }));
const negativeHero = /data-budget-cash-hero[\s\S]*?<\/p>/.exec(negativeSpending)?.[0] || '';
ok(negativeHero.includes(money(1215)) && !negativeHero.includes(money(1215 - 50)) && !negativeHero.includes(money(8000)),
  'Current balance remains Bills-only when the daily-spending account is negative and savings are large');
ok(/data-budget-spent="groceries"[\s\S]*?Synthetic grocer[\s\S]*?212\.40/.test(negativeSpending)
  && /data-budget-cash-part="household"[\s\S]*?308\.50/.test(negativeSpending),
  'daily-spending transactions remain household actuals and future obligations despite its negative balance');
const missingBalance = p.rerender("__ctx.advice.defaultView.currentBalancePublication = { accountId: 'chequing-a', amount: null, trust: 'unavailable' }");
ok(/data-budget-cash-hero[^>]*>Unavailable<\/p>/.test(missingBalance),
  'a deliberately unavailable Bills balance is never refilled from another account or the old numeric field');
const missingPublication = p.rerender('__ctx.advice.defaultView.currentBalancePublication = null');
ok(/data-budget-cash-hero[^>]*>Unavailable<\/p>/.test(missingPublication),
  'an explicit null publication also stays unavailable instead of falling back to a duplicate publication');
for (const [accountId, amount, trust] of [['savings-a', 8000, 'posted'], ['chequing-a', '1215', 'posted'],
  ['chequing-a', 1215, 'unavailable']]) {
  const withheld = p.rerender(`__ctx.advice.defaultView.currentBalancePublication = ${JSON.stringify({accountId, amount, trust})}`);
  ok(/data-budget-cash-hero[^>]*>Unavailable<\/p>/.test(withheld),
    `${accountId}/${amount}/${trust}: Current balance withholds wrong identity, nonnumeric or untrusted money`);
}
const unconfirmedBalance = p.rerender("__ctx.advice.defaultView.currentBalancePublication = { accountId: 'chequing-a', amount: 1215, trust: 'planned-unconfirmed' }");
ok(/payday receipt unconfirmed/.test(text(unconfirmedBalance))
  && /budget-cash-est/.test(/data-budget-cash-hero[\s\S]*?<\/p>/.exec(unconfirmedBalance)?.[0] || ''),
  'the published planned-unconfirmed Bills balance keeps a visible receipt qualifier');
p.rerender("__ctx.advice.defaultView.currentBalancePublication = __ctx.advice.paydayAllocation.currentBalancePublication");

const overspendPage = page();
const overspendHtml = overspendPage.render(fx.served({ groceriesExtra: 200 }));
const overspendPeriod = overspendPage.context.__ctx.advice.payPeriodViews.find(row => row.start === '2026-08-14');
// 212.40 + 96.15 + 200 = 508.55 groceries, above the 450 target.
// Hold = 508.55 + 160 + 120 + 22.99 = 811.54; final = 4050 - 1665 - 811.54.
ok(overspendPeriod.budgetHold === 811.54 && overspendPeriod.balanceAfterDeductions === 1573.46
  && step(overspendHtml, '06').includes(money(811.54)) && step(overspendHtml, '07').includes(money(1573.46)),
  'observed grocery overrun raises the published household reserve and reduces the final balance by 58.55');
ok(overspendPeriod.fromTodayFunding.remainingHousehold === 167.05
  && /data-budget-spent="groceries"[\s\S]*?Synthetic extra grocer[\s\S]*?200\.00/.test(overspendHtml),
  'the observed overrun stays in transaction evidence; remaining household is 0 groceries + 85.80 fuel + 81.25 dining');

console.log('\n=== navigation ===');
const next = p.context.__ctx.advice.payPeriodViews.find(v => v.timelineRole === 'next');
const nextHtml = p.rerender(`planPayPeriodId = ${JSON.stringify(String(next.id || next.start))}; __ctx.planPayPeriodId = planPayPeriodId`);
ok(/Projected pay period/.test(text(nextHtml)) && nextHtml.includes(`data-calendar-waterfall="${next.id}"`),
  'selecting the next pay period prints its projected waterfall');
ok(/Today's money — current position/.test(text(section(nextHtml, 'today'))), 'Today stays on the current payday when another period is selected');
p.rerender('planPayPeriodId = null; __ctx.planPayPeriodId = null');

console.log('\n=== month view and month-to-pay-period drilldown ===');
const monthHtml = p.rerender("budgetGranularity = 'month'");
ok(/data-budget-surface="month"/.test(monthHtml), 'the Month switch shows the month view');
const monthComponent = vm.runInContext('budgetMonthViewHtml(__ctx, true)', p.context);
ok(monthHtml.includes(monthComponent), 'the incumbent Month financial body stays whole while its picker moves to the header');
ok((monthHtml.match(/data-budget-month-picker/g) || []).length === 1,
  'the active Month path has exactly one real picker');
ok(/See the pay periods in August 2026/.test(text(monthHtml)), 'the month offers its pay-period drilldown');
const drillHtml = p.rerender("budgetPayPeriodAnchorMonth = budgetSelectedMonth; budgetGranularity = 'pay-period'");
ok(/data-budget-surface="drilldown"/.test(drillHtml) && /data-budget-drilldown="2026-08"/.test(drillHtml),
  'entering Pay period from Month keeps the month-anchored drilldown');
ok(/data-budget-drilldown-exit/.test(drillHtml), 'the drilldown has a way back to the current pay period');
const back = p.rerender('budgetPayPeriodAnchorMonth = null; budgetDrilldownPayPeriod = null');
ok(/data-budget-surface="pay-period"/.test(back), 'leaving the drilldown returns to the current pay period');

console.log('\n=== withheld savings proposals ===');
const withheldPage = page();
const withheld = withheldPage.render(fx.served({ withheldSavings: true }));
const inventory = text(withheldPage.context.document.getElementById('savings-inventory').innerHTML);
// Configured accounts, unknown cash and unknown starting allocations are
// three different facts; each pool must keep the one that applies to it.
const poolA = inventory.slice(inventory.indexOf('Synthetic reserve A'), inventory.indexOf('Synthetic reserve B'));
const poolB = inventory.slice(inventory.indexOf('Synthetic reserve B'));
ok(poolA.length > 0 && poolB.length > 0, 'both configured savings accounts are listed by name', inventory.slice(0, 300));
ok(/^Synthetic reserve A Assignments unknown/.test(poolA) && /Observed pool cash \$0\.00 verified/.test(poolA),
  'pool A: observed cash is known and shown as observed; its assignments are unknown', poolA.slice(0, 300));
ok(/^Synthetic reserve B Cash unknown/.test(poolB) && /Observed pool cash Unknown/.test(poolB),
  'pool B: its cash is unknown, not $0', poolB.slice(0, 300));
ok([poolA, poolB].every(pool => /Confirmed assigned Unknown/.test(pool) && /Unallocated cash Unknown/.test(pool)
    && /Starting goal assignments have not been supplied/.test(pool)),
  'both pools: starting allocations are unknown, never $0');
ok(!/not set up/i.test(inventory), 'configured accounts are not called "not set up"');
const reason = 'Additional savings proposals are withheld until the funding plan accounts for existing assignments and the cash used to pay each cost.';
ok(text(withheld).includes(reason), "Forecast's withheld reason is shown");
ok(!/Proposed to set aside now/.test(withheld) && !/data-from-today-cost/.test(withheld),
  'no proposed amounts are printed while proposals are withheld');
ok(step(withheld, '07').includes(money(EXPECT.final)), 'the waterfall itself is unchanged by withheld savings');

console.log('\n=== current plan unavailable ===');
const downHtml = page().render(fx.served({ unavailablePlan: true }));
ok(/data-budget-surface="unavailable"/.test(downHtml) && /Current plan unavailable/.test(text(downHtml)),
  'an untrusted refresh shows the unavailable surface');
// The Aug 13 opening, independently: 15 bills account + 604.49 spending account.
ok(text(downHtml).includes(`Last trusted opening ${money(15 + 604.49)}`) && /As at August 13/.test(text(downHtml)),
  'the last trusted opening is the dated Aug 13 balance, labelled as dated', text(downHtml).slice(0, 400));
ok(!downHtml.includes(money(EXPECT.final)) && !/data-calendar-waterfall="/.test(downHtml),
  'no pay-period figures are printed when the plan is unavailable');
ok(!/data-budget-period-result/.test(downHtml), 'the overview is withheld with the unavailable operating plan');

console.log('\n=== known deficit is not unknown ===');
{
  // Independent fixture arithmetic, not a rerun of Forecast's leftover helper.
  const DEFICIT = {
    income: 2600 + 1450,
    bills: 1400 + 120 + 60 + 85 + 5000,
    household: 450 + 160 + 120 + 22.99,
  };
  DEFICIT.afterBills = DEFICIT.income - DEFICIT.bills;
  DEFICIT.final = Math.round((DEFICIT.afterBills - DEFICIT.household) * 100) / 100;
  const signed = n => (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-CA', {
    minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const deficitPage = page();
  const deficitHtml = deficitPage.render(fx.served({ deficitPeriod: true }));
  const published = deficitPage.context.__ctx.advice.payPeriodViews.find(row => row.start === '2026-08-14');
  ok(published && published.afterBills === DEFICIT.afterBills
    && published.afterHouseholdBudget === DEFICIT.final
    && published.balanceAfterDeductions === DEFICIT.final
    && published.balanceAfterDeductionsTrust === 'estimated',
    `Forecast publishes independently derived − after-bills ${DEFICIT.afterBills} and final ${DEFICIT.final}, estimated`,
    published && `${published.afterBills} / ${published.afterHouseholdBudget} / ${published.balanceAfterDeductionsTrust}`);
  const summaryHtml = id => deficitHtml.split(`data-operating-question="${id}"`)[1]?.split('</summary>')[0] || '';
  const heroText = text(/data-budget-period-result[\s\S]*?<\/div>/.exec(deficitHtml)?.[0] || '');
  ok(heroText.includes(signed(DEFICIT.final)) && /estimated/.test(heroText),
    'the hero keeps the published negative final and its estimate qualifier', heroText);
  ok(/budget-waterfall-track is-deficit/.test(summaryHtml('06')) && !/is-unknown/.test(summaryHtml('06'))
    && step(deficitHtml, '06').includes(money(DEFICIT.household)),
    'Household Budget with a negative start uses the deficit track, not the unknown hatch');
  ok(/budget-waterfall-track is-deficit/.test(summaryHtml('07')) && !/is-unknown/.test(summaryHtml('07'))
    && step(deficitHtml, '07').includes(signed(DEFICIT.final)) && /≈ estimated/.test(step(deficitHtml, '07')),
    'the final negative amount uses the deficit track and keeps its published dollars and estimate');
  ok(/budget-waterfall-track is-deficit/.test(summaryHtml('05')) && step(deficitHtml, '05').includes(signed(DEFICIT.afterBills)),
    'the negative after-bills row keeps its published deficit and is not hatched unknown');
  ok(!/style="left:/.test(summaryHtml('savings')) && /budget-waterfall-track is-unknown/.test(summaryHtml('savings'))
    && /Proposed savings[\s\S]*?Unavailable/.test(text(deficitHtml)),
    'unavailable savings stay hatched with no invented zero-length numeric bar');
}

console.log('\n=== known zero income is not unknown ===');
{
  // Independent fixture arithmetic: scheduled amounts stay 0; bills and
  // household targets are the canonical invented figures.
  const ZERO = {
    income: 0,
    bills: 1400 + 120 + 60 + 85,
    household: 450 + 160 + 120,
  };
  ZERO.afterBills = ZERO.income - ZERO.bills;
  ZERO.final = ZERO.afterBills - ZERO.household;
  const signed = n => (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-CA', {
    minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const zeroPage = page();
  const zeroHtml = zeroPage.render(fx.served({ zeroIncomeWithoutSpend: true }));
  const published = zeroPage.context.__ctx.advice.payPeriodViews.find(row => row.start === '2026-08-14');
  ok(published && published.available === ZERO.income
    && published.incomeTrust === 'calculated'
    && published.afterBills === ZERO.afterBills
    && published.budgetHold === ZERO.household
    && published.afterHouseholdBudget === ZERO.final
    && published.balanceAfterDeductions === ZERO.final
    && published.balanceAfterDeductionsTrust === 'estimated',
    `Forecast publishes independently derived $0 income, after-bills ${ZERO.afterBills} and final ${ZERO.final}, estimated`,
    published && `${published.available} / ${published.afterBills} / ${published.afterHouseholdBudget} / ${published.incomeTrust}`);
  const summaryHtml = id => zeroHtml.split(`data-operating-question="${id}"`)[1]?.split('</summary>')[0] || '';
  const heroText = text(/data-budget-period-result[\s\S]*?<\/div>/.exec(zeroHtml)?.[0] || '');
  ok(heroText.includes(signed(ZERO.final)) && /estimated/.test(heroText),
    'the hero keeps the published negative final and its estimate qualifier', heroText);
  ok(/budget-waterfall-track is-noscale/.test(summaryHtml('02')) && !/is-unknown/.test(summaryHtml('02'))
    && !/style="left:/.test(summaryHtml('02')) && step(zeroHtml, '02').includes(money(ZERO.income)),
    'known $0 income uses the no-scale track, not the unknown hatch or an invented bar');
  ok(/budget-waterfall-track is-deficit/.test(summaryHtml('04')) && !/is-unknown/.test(summaryHtml('04'))
    && !/style="left:/.test(summaryHtml('04')) && step(zeroHtml, '04').includes(money(ZERO.bills)),
    'bills with a negative remaining start stay a known deficit with no invented scale');
  ok(/budget-waterfall-track is-deficit/.test(summaryHtml('05')) && !/is-unknown/.test(summaryHtml('05'))
    && !/style="left:/.test(summaryHtml('05')) && step(zeroHtml, '05').includes(signed(ZERO.afterBills)),
    'the negative after-bills row keeps its published deficit and is not hatched unknown');
  ok(/budget-waterfall-track is-deficit/.test(summaryHtml('06')) && !/is-unknown/.test(summaryHtml('06'))
    && !/style="left:/.test(summaryHtml('06')) && step(zeroHtml, '06').includes(money(ZERO.household)),
    'Household Budget with a negative start uses the deficit track, not the unknown hatch');
  ok(/budget-waterfall-track is-deficit/.test(summaryHtml('07')) && !/is-unknown/.test(summaryHtml('07'))
    && !/style="left:/.test(summaryHtml('07'))
    && step(zeroHtml, '07').includes(signed(ZERO.final)) && /≈ estimated/.test(step(zeroHtml, '07')),
    'the final negative amount uses the deficit track and keeps its published dollars and estimate');
  ok(!/style="left:/.test(summaryHtml('savings')) && /budget-waterfall-track is-unknown/.test(summaryHtml('savings'))
    && /Proposed savings[\s\S]*?Unavailable/.test(text(zeroHtml)),
    'unavailable savings stay hatched with no invented zero-length numeric bar');
}

console.log('\n=== the layout module stays a layout module ===');
{
  const index = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const surfaceAt = index.indexOf('<script src="/budget-surface.js"></script>');
  ok(surfaceAt > 0 && surfaceAt < index.indexOf('<script src="/plan.js"></script>')
      && /href="\/budget-surface\.css"/.test(index),
    'index.html loads the surface stylesheet and script before plan.js');
  const src = fs.readFileSync(path.join(ROOT, 'public/budget-surface.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok(!/\bForecast\b/.test(src), 'budget-surface.js does not reach Forecast');
  ok(!/\.reduce\(|[^=!<>]=\s*[^=>]*[-+*/]\s*\d|\bamount\b|\bbalance\b|\btrust\b/.test(src),
    'budget-surface.js reads no money or trust field and does no arithmetic');
}

assert.ok(true);
if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
