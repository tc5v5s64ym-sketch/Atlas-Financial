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
