'use strict';
/* AF-OPERATE-03 — the default homepage renders Forecast.paydayAllocation as
 * an ordered, reconciled action sheet. Forecast remains the sole allocator.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const F = require('./public/forecast.js');
const data = require('./data.json');
const periods = require('./public/periods.json');
const { sourceText } = require('./test-source-text');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const read = file => sourceText(fs.readFileSync(path.join(__dirname, file), 'utf8'));

function loadSheet() {
  const appSrc = read('public/app.js');
  const planSrc = read('public/plan.js');
  const grab = (src, re, label) => {
    const match = re.exec(src);
    if (!match) throw new Error('missing ' + label);
    return match[0];
  };
  const source = [
    grab(appSrc, /^const money2 = .*$/m, 'money2'),
    grab(appSrc, /^const fmtDate = .*$/m, 'fmtDate'),
    grab(planSrc, /^const PAYDAY_ACTION_KIND = \{[\s\S]*?^\};$/m, 'PAYDAY_ACTION_KIND'),
    grab(planSrc, /^function paydayAllocationTrustNote\([\s\S]*?\n\}$/m, 'paydayAllocationTrustNote'),
    grab(planSrc, /^function paydayAllocationSheetHtml\([\s\S]*?\n\}$/m, 'paydayAllocationSheetHtml'),
  ].join('\n');
  return vm.runInNewContext(`${source}\n({ paydayAllocationSheetHtml, money2 });`);
}

function currentAllocation() {
  const plan = data.plan;
  const asOf = data.meta.asOf;
  return F.recommend(plan, asOf, {
    scenario: 'expected',
    targetBuffer: plan.defaults.targetBuffer,
    extraDebtMonthly: 0,
    disabled: [],
    fundingSources: plan.funding && plan.funding.options,
    debts: data.debts,
    extraFacilities: data.revolvingExtra,
    extraDebtTarget: plan.nextDollar && plan.nextDollar.target,
    periods,
    paypalPerMonth: data.paypal && data.paypal.perMonth,
  }).paydayAllocation;
}

console.log('=== available resources are independently grounded ===');
{
  const alloc = currentAllocation();
  const opening = (data.plan.startingCash.breakdown || [])
    .reduce((sum, row) => sum + Number(row.value || 0), 0);
  let sameDayIncome = 0;
  for (const row of data.plan.income || []) {
    if (row.frequency === 'once' && row.date === data.meta.asOf) {
      sameDayIncome += Number(row.amount || 0);
    }
  }
  const independentAvailable = opening + sameDayIncome;
  const sheet = loadSheet();
  const html = sheet.paydayAllocationSheetHtml(alloc);
  ok(near(alloc.available, independentAvailable),
    'Forecast available equals spendable opening plus independently enumerated same-day income');
  ok(html.includes(`data-allocation-available>${sheet.money2(alloc.available)}`),
    'the rendered available amount is Forecast.paydayAllocation.available');
}

console.log('\n=== allocation lines preserve Forecast order and amounts ===');
{
  const alloc = currentAllocation();
  const sheet = loadSheet();
  const html = sheet.paydayAllocationSheetHtml(alloc);
  let previous = -1;
  for (const [index, line] of alloc.lines.entries()) {
    const marker = `data-allocation-key="${line.key}" data-allocation-order="${index + 1}"`;
    const at = html.indexOf(marker);
    ok(at > previous, `line ${line.key} stays in Forecast order`);
    ok(at >= 0 && html.slice(at).includes(line.label)
      && html.slice(at).includes(sheet.money2(line.amount)),
    `line ${line.key} label and amount come from Forecast.paydayAllocation`);
    previous = at;
  }
  ok((html.match(/data-allocation-key=/g) || []).length === alloc.lines.length,
    'the sheet adds no allocation line outside Forecast.paydayAllocation.lines');
  const unverified = alloc.obligations.items.filter(item => item.settlement === 'unverified');
  for (const item of unverified) {
    ok(html.includes(item.label) && /Settlement unverified:/.test(html),
      `bill reserve retains Forecast settlement state for ${item.id}`);
  }
  if (alloc.essentials.fundingAttribution === 'unattributed') {
    ok(/unattributed essential-spending hold/.test(html),
      'a partial essential pool does not imply category-level funding');
  }
}

console.log('\n=== displayed totals reconcile independently ===');
{
  const alloc = currentAllocation();
  const sheet = loadSheet();
  const html = sheet.paydayAllocationSheetHtml(alloc);
  const independentAllocated = alloc.lines.reduce((sum, line) => sum + Number(line.amount), 0);
  ok(near(independentAllocated, alloc.allocatedTotal),
    'independent line sum equals Forecast allocatedTotal');
  ok(near(independentAllocated + alloc.remainder, alloc.available),
    'independent allocation total plus remainder equals Forecast available');
  ok(near(alloc.identity, alloc.available),
    'Forecast identity equals its available resources');
  const reconciliation = `${sheet.money2(alloc.allocatedTotal)} allocated + ${sheet.money2(alloc.remainder)} remainder = ${sheet.money2(alloc.available)} available resources`;
  ok(html.includes(reconciliation),
    'the page displays Forecast reconciliation fields without recalculating them');
}

console.log('\n=== untouched, future, extra-debt and remainder states are explicit ===');
{
  const alloc = currentAllocation();
  const html = loadSheet().paydayAllocationSheetHtml(alloc);
  ok(/Leave untouched/.test(html) && /data-allocation-state="untouched"|future-path/.test(html),
    'cash that must remain untouched is explicitly identified from protectedPath/future-path output');
  for (const row of alloc.futureCosts || []) {
    ok(html.includes(row.label) && html.includes(loadSheet().money2(row.allocated)),
      `future-cost state ${row.id} retains its Forecast allocation`);
  }
  ok(/Extra debt allocation/.test(html) && html.includes(loadSheet().money2(alloc.extraDebt.allocated)),
    'zero extra debt remains an explicit zero, not an implied payment');
  ok(/Unallocated remainder|Unallocated \/ optional remainder/.test(html)
    && html.includes(loadSheet().money2(alloc.remainder)),
  'the Forecast remainder is displayed explicitly');
}

console.log('\n=== trust, unresolved and unavailable states fail closed ===');
{
  const sheet = loadSheet();
  const synthetic = {
    available: 100,
    allocatedTotal: 100,
    remainder: 0,
    identity: 100,
    lines: [{ key: 'obligations', kind: 'obligations', label: 'Keep for bills', amount: 100 }],
    obligations: { fundingAttribution: 'unattributed', items: [
      { label: 'Estimated minimum', confidence: 'estimated', settlement: 'unverified' },
      { label: 'Unknown settlement', confidence: 'unknown' },
    ] },
    essentials: { fundingAttribution: 'complete' },
    protectedPath: { allocated: 0 },
    futureCosts: [],
    extraDebt: { allocated: 0 },
    unresolved: [{ id: 'undated', label: 'Undated required cost',
      reason: 'Required, but no exact date — no payday contribution assigned.' }],
  };
  const html = sheet.paydayAllocationSheetHtml(synthetic);
  ok(/Estimated minimum · estimated/.test(html) && /Unknown settlement · unknown/.test(html),
    'estimated and unknown obligation inputs keep their trust treatment');
  ok(/Settlement unverified: Estimated minimum/.test(html)
    && /unattributed reserve pool/.test(html),
  'settlement and partial-pool attribution stay qualified rather than implying a bill priority');
  ok(/Undated required cost/.test(html) && /unresolved; no payday allocation/.test(html),
    'an unresolved future cost is not fabricated into an allocation');
  ok(/\$0\.00/.test(html) && /No extra debt payment is allocated/.test(html),
    'zero output explicitly says no extra payment is allocated');
  const unavailable = sheet.paydayAllocationSheetHtml(null);
  ok(/allocation unavailable/i.test(unavailable) && /No payment, transfer, debt action/.test(unavailable),
    'unavailable output implies no money movement');
  ok(/does not prove or initiate a payment, transfer or card action/.test(html),
    'the actionable sheet explicitly remains non-executable');
}

console.log('\n=== the page remains a renderer, not a calculator ===');
{
  const src = read('public/plan.js');
  const fn = /function paydayAllocationSheetHtml\([\s\S]*?\n\}/m.exec(src);
  ok(!!fn, 'the action-sheet renderer is a bounded function');
  ok(fn && !/\bForecast\.[A-Za-z]+\s*\(/.test(fn[0]),
    'the action sheet calls no Forecast function');
  ok(fn && !/\.reduce\(|allocatedTotal\s*[+\-*/]=?|remainder\s*[+\-*/]=?|available\s*[+\-*/]=?/.test(fn[0]),
    'the action sheet contains no allocation or reconciliation arithmetic');
  ok(fn && /alloc\.lines\.map/.test(fn[0]) && /alloc\.allocatedTotal/.test(fn[0])
    && /alloc\.remainder/.test(fn[0]) && /alloc\.available/.test(fn[0]),
  'the renderer consumes Forecast lines and reconciliation fields directly');
}

if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
