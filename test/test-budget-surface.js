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
  const start = html.indexOf(`data-budget-surface-section="${kind}"`);
  if (start < 0) return '';
  const next = html.indexOf('data-budget-surface-section="', start + 10);
  return html.slice(start, next < 0 ? html.length : next);
};

console.log('\n=== one active renderer ===');
const p = page();
const html = p.render(fx.served());
ok(/data-budget-surface="pay-period"/.test(html), 'renderPlan mounts the active Budget surface in pay-period view');
ok(p.context.__retainedCalls === 0, 'the retained operatingSurfaceHtml is not called on the page path',
  `${p.context.__retainedCalls} call(s)`);
ok(!/data-budget-more-views|data-current-payday-details/.test(html),
  'the old "More Budget views" and "Current payday details" disclosures are not rendered');
ok((html.match(/data-calendar-waterfall="/g) || []).length === 1, 'exactly one pay-period waterfall is printed');

console.log('\n=== pay-period waterfall on the active surface ===');
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

console.log("\n=== today's money and the next-payday plan ===");
const today = text(section(html, 'today'));
const period = text(section(html, 'period'));
ok(today.includes(`Money available ${money(EXPECT.available)} calculated`), `Money available is ${money(EXPECT.available)}, calculated`, today.slice(0, 200));
ok(today.includes(`Keep at least ${money(EXPECT.floor)} calculated`), `the floor is Forecast's ${money(EXPECT.floor)}, calculated`);
ok(today.includes(`Bills & required minimums ${money(EXPECT.remaining)} estimate`), 'bills still to pay today keep their estimate tag');
ok(/Nest Money funding plan — August 28 payday/.test(today), 'the next-payday plan is in the Today section, labelled with its payday');
ok(/From today · 2026-08-20/.test(period) && !/From today ·/.test(today),
  "today's proposal sits with the period, separate from the next-payday plan");
ok(period.includes(money(EXPECT.billsAccount)) && /Bills account only/.test(period), `bills-account balance is ${money(EXPECT.billsAccount)}`);

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
const monthComponent = vm.runInContext('budgetMonthViewHtml(__ctx)', p.context);
ok(monthHtml.includes(monthComponent), 'the month section is the incumbent Month view, whole');
ok(/See the pay periods in August 2026/.test(text(monthHtml)), 'the month offers its pay-period drilldown');
const drillHtml = p.rerender("budgetPayPeriodAnchorMonth = budgetSelectedMonth; budgetGranularity = 'pay-period'");
ok(/data-budget-surface="drilldown"/.test(drillHtml) && /data-budget-drilldown="2026-08"/.test(drillHtml),
  'entering Pay period from Month keeps the month-anchored drilldown');
ok(/data-budget-drilldown-exit/.test(drillHtml), 'the drilldown has a way back to the current pay period');
const back = p.rerender('budgetPayPeriodAnchorMonth = null; budgetDrilldownPayPeriod = null');
ok(/data-budget-surface="pay-period"/.test(back), 'leaving the drilldown returns to the current pay period');

console.log('\n=== withheld savings proposals ===');
const withheld = page().render(fx.served({ withheldSavings: true }));
const reason = 'Additional savings proposals are withheld until the funding plan accounts for existing assignments and the cash used to pay each cost.';
ok(text(withheld).includes(reason), "Forecast's withheld reason is shown");
ok(!/Proposed to set aside now/.test(withheld) && !/data-from-today-cost/.test(withheld),
  'no proposed amounts are printed while proposals are withheld');
ok(step(withheld, '07').includes(money(EXPECT.final)), 'the waterfall itself is unchanged by withheld savings');

console.log('\n=== current plan unavailable ===');
const down = fx.served();
down.liveOverlay.operatingPlan = 'unavailable';
down.liveOverlay.operatingPlanNote = 'Current plan unavailable. The latest refresh could not be trusted.';
const downHtml = page().render(down);
ok(/data-budget-surface="unavailable"/.test(downHtml) && /Current plan unavailable/.test(text(downHtml)),
  'an untrusted refresh shows the unavailable surface');
ok(!downHtml.includes(money(EXPECT.final)) && !/data-calendar-waterfall="/.test(downHtml),
  'no pay-period figures are printed when the plan is unavailable');

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
