'use strict';
/* Owner-voice Budget presentation: income labels, no rollover, Bills
 * planning chrome, and Forecast-owned Current Balance print.
 *
 * Forecast amounts, settlement, and walk math stay where they were. These
 * tests reconstruct the printed labels and prove Current Balance reprints
 * Forecast A+B for positive and negative Chequing B (L-002 / L-006). They
 * do not copy live household cents.
 *
 * `node test/test-budget-owner-voice.js`
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const F = require('../public/forecast.js');
const UI = require('../public/budget-polish.js');
const { sourceText } = require('./test-source-text');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const roundCent = n => Math.round((Number(n) || 0) * 100) / 100;
const read = file => sourceText(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));

function grab(src, re, label) {
  const match = re.exec(src);
  if (!match) throw new Error('missing ' + label);
  return match[0];
}

function loadComposer() {
  const appSrc = read('public/app.js');
  const planSrc = read('public/plan.js');
  const source = [
    grab(appSrc, /^const money = .*$/m, 'money'),
    grab(appSrc, /^const money2 = .*$/m, 'money2'),
    grab(appSrc, /^const fmtDate = .*$/m, 'fmtDate'),
    grab(appSrc, /^const fmtDateLong = .*$/m, 'fmtDateLong'),
    grab(planSrc, /^function liveOperatingPlanUnavailable\([\s\S]*?\n\}$/m, 'liveOperatingPlanUnavailable'),
    grab(planSrc, /^function paydayGlanceCashNote\([\s\S]*?\n\}$/m, 'paydayGlanceCashNote'),
    grab(planSrc, /^function providerBalanceDate\([\s\S]*?\n\}$/m, 'providerBalanceDate'),
    grab(planSrc, /^function glanceUpdatedNote\([\s\S]*?\n\}$/m, 'glanceUpdatedNote'),
    grab(planSrc, /^function liveCurrentBalanceHtml\([\s\S]*?\n\}$/m, 'liveCurrentBalanceHtml'),
    grab(planSrc, /^function glanceSignedMoney\([\s\S]*?\n\}$/m, 'glanceSignedMoney'),
    grab(planSrc, /^function glanceMoney\([\s\S]*?\n\}$/m, 'glanceMoney'),
    grab(planSrc, /^function glanceLineLabel\([\s\S]*?\n\}$/m, 'glanceLineLabel'),
    grab(planSrc, /^function calendarCurrentUnavailableHtml\([\s\S]*?\n\}$/m, 'calendarCurrentUnavailableHtml'),
    grab(planSrc, /^function calendarIncomeHtml\([\s\S]*?\n\}$/m, 'calendarIncomeHtml'),
    grab(planSrc, /^function periodBillLine\([\s\S]*?\n\}$/m, 'periodBillLine'),
  ].join('\n');
  return vm.runInNewContext(
    `${source}\n({ liveCurrentBalanceHtml, calendarIncomeHtml, periodBillLine, money2 });`,
    { Forecast: F }
  );
}

const composer = loadComposer();
const planSrc = read('public/plan.js');
const polishSrc = read('public/budget-polish.js');
const polishCss = read('public/budget-polish.css');

console.log('=== 1. Income labels and Dale exact dollars ===');
{
  const html = composer.calendarIncomeHtml({
    available: 4264,
    income: [
      {
        id: 'payroll', label: 'Payroll — Seaspan', incomeClass: 'dale',
        amount: 4264, confidence: 'estimated', status: 'arriving',
        glanceKind: 'in', movement: 4264, date: '2026-09-11',
      },
      {
        id: 'amandaSalary15', label: 'Amanda salary — Tennis BC — 15th',
        incomeClass: 'amanda', amount: 2168.85, confidence: 'confirmed',
        status: 'unresolved', settlement: 'not-relied-upon', notReliedUpon: true,
        glanceKind: 'in', movement: 2168.85, date: '2026-09-15',
      },
      {
        id: 'childBenefit', label: 'Child benefit', incomeClass: 'named',
        amount: 219.45, confidence: 'confirmed', status: 'arriving',
        glanceKind: 'in', movement: 219.45, date: '2026-09-20',
      },
    ],
    otherIncome: { amount: 0, items: [] },
  });
  ok(/Dale salary/.test(html) && !/Payroll — Seaspan/.test(html) && !/Seaspan/.test(html),
    'Dale payroll prints as Dale salary only');
  ok(/data-period-income="payroll"/.test(html),
    'Dale salary keeps the Forecast payroll identity');
  const daleAmt = html.match(/data-period-income="payroll"[\s\S]*?<span>([^<]*)<\/span>\s*<span>([^<]*)<\/span>/);
  ok(daleAmt && daleAmt[1] === 'Dale salary'
      && daleAmt[2] === '+' + composer.money2(4264)
      && !/about/i.test(daleAmt[2]) && !/about/i.test(daleAmt[0]),
    'Dale salary prints exact $4,264.00 with no about prefix',
    daleAmt && daleAmt[0]);
  ok(/Amanda salary/.test(html)
      && !/Tennis BC/.test(html)
      && !/not relied upon/.test(html)
      && /data-income-status="not-relied-upon"/.test(html),
    'Amanda salary drops Tennis BC / not-relied copy; settlement attr remains');
  ok(/Child benefit/.test(html) && /data-period-income="childBenefit"/.test(html),
    'Child benefit remains a named income line');
  ok(/Payday balance/.test(html) && !/Rollover balance/.test(html),
    'income block still prints Payday balance and never Rollover balance');
}

console.log('\n=== 2. Rollover is gone from Budget polish ===');
{
  ok(!/Rollover balance/.test(polishSrc) && !/atlas-rollover-summary/.test(polishSrc),
    'polish no longer relabels or cards Opening balance as Rollover');
  ok(/display:\s*none/.test(polishCss)
      && /data-operating-question="01"/.test(polishCss),
    'Budget CSS hides the waterfall opening / rollover question');
  ok(/atlas-payday-summary/.test(polishCss) && /atlas-current-balance-card/.test(polishCss),
    'payday balance and current balance keep dedicated hierarchy');
}

console.log('\n=== 3. Paycheck chrome: no strikethrough, no arriving green ===');
{
  ok(/text-decoration:\s*none/.test(polishCss)
      && /data-income-status="not-relied-upon"/.test(polishCss)
      && /data-income-status="arriving"/.test(polishCss),
    'Budget income card overrides Amanda strikethrough and arriving green');
  ok(!/line-through/.test(polishCss),
    'Budget polish does not restyle income as strikethrough');
}

console.log('\n=== 4. Bills planning chrome is not Forecast Paid ===');
{
  const paid = UI.planningBillChrome('PAID', '2026-09-11', '2026-09-15');
  ok(paid && paid.kind === 'paid' && paid.label === 'PAID' && paid.planning === false,
    'Forecast Paid stays verified Paid even after the due date');
  const onDate = UI.planningBillChrome('still due', '2026-09-11', '2026-09-11');
  ok(onDate && onDate.kind === 'planning-cleared' && onDate.label === 'ON DATE'
      && onDate.planning === true && onDate.label !== 'PAID',
    'a still-due bill is planning-cleared green on its due date without claiming Paid');
  const grace = UI.planningBillChrome('pending', '2026-09-11', '2026-09-14');
  ok(grace && grace.kind === 'planning-cleared' && grace.label === 'ON DATE',
    'three days past due without settlement still uses planning-cleared chrome');
  const late = UI.planningBillChrome('still due', '2026-09-11', '2026-09-15');
  ok(late && late.kind === 'double-check' && late.label === 'DOUBLE-CHECK'
      && late.planning === true,
    'four days past due without settlement surfaces DOUBLE-CHECK, not forever-green');
  const upcoming = UI.planningBillChrome('still due', '2026-09-20', '2026-09-11');
  ok(upcoming && upcoming.kind === 'to-pay' && upcoming.label === 'TO PAY',
    'a bill before its date stays TO PAY rather than planning-green');
  const noDate = UI.planningBillChrome('needs confirmation', null, '2026-09-11');
  ok(noDate && noDate.kind === 'check' && noDate.label === 'CHECK',
    'undated needs-confirmation stays CHECK; planning chrome does not invent a date');
  ok(/atlas-bill-row-planning-cleared/.test(polishCss)
      && /atlas-bill-state-planning-cleared/.test(polishCss)
      && /atlas-bill-row-double-check/.test(polishCss)
      && /ON DATE/.test(polishSrc)
      && /DOUBLE-CHECK/.test(polishSrc)
      && !/Forecast\s*\./.test(polishSrc),
    'planning-cleared and double-check are distinct CSS/chrome, not a Forecast Paid write');
  ok(/data-bill-date/.test(planSrc) && /data-household-as-of/.test(planSrc),
    'plan.js stamps bill dates and household as-of for presentation chrome');
  const billHtml = composer.periodBillLine({
    id: 'mortgage', label: 'Mortgage', status: 'still due',
    date: '2026-09-11', amount: 1600, glanceKind: 'still-due',
  });
  ok(/data-bill-date="2026-09-11"/.test(billHtml)
      && /data-bill-status="still due"/.test(billHtml),
    'bill rows keep Forecast still-due status and expose the ISO date');
}

console.log('\n=== 5. Current Balance reprints Forecast A+B ===');
{
  const a = 800.25;
  const bSurplus = 120.40;
  const bOverdraft = -75.10;
  const savings = 40;
  const independentSurplus = roundCent(a + bSurplus);
  const independentOverdraft = roundCent(a + bOverdraft);
  const excludingOverdraft = roundCent(a + Math.max(0, bOverdraft));
  ok(near(independentSurplus, 920.65),
    'independent surplus Current Balance is Chequing A + positive B',
    String(independentSurplus));
  ok(near(independentOverdraft, 725.15)
      && !near(independentOverdraft, excludingOverdraft)
      && near(excludingOverdraft, a),
    'independent overdraft Current Balance is A+B, not A-only',
    String(independentOverdraft));

  const htmlSurplus = composer.liveCurrentBalanceHtml(
    { liveCurrentBalance: independentSurplus, asOf: '2026-09-11' },
    null,
    { liveCurrentBalance: independentSurplus }
  );
  ok(htmlSurplus.includes(composer.money2(independentSurplus))
      && /Current Balance/.test(htmlSurplus)
      && !htmlSurplus.includes(composer.money2(roundCent(independentSurplus + savings))),
    'positive Chequing B prints Forecast A+B; savings stays out');

  const htmlOd = composer.liveCurrentBalanceHtml(
    { liveCurrentBalance: independentOverdraft, asOf: '2026-09-11' },
    null,
    { liveCurrentBalance: independentOverdraft }
  );
  ok(htmlOd.includes(composer.money2(independentOverdraft))
      && !htmlOd.includes(composer.money2(excludingOverdraft)),
    'negative Chequing B prints Forecast A+B, not A + max(0, B)');

  const observedHtml = composer.liveCurrentBalanceHtml(
    { liveCurrentBalance: independentOverdraft, asOf: '2026-09-18' },
    {
      applied: true,
      operatingPlan: 'live',
      observedCash: {
        complete: true,
        accounts: [
          { id: 'chequing-a', value: a },
          { id: 'chequing-b', value: bOverdraft },
        ],
      },
    },
    { liveCurrentBalance: independentOverdraft }
  );
  ok(observedHtml.includes(composer.money2(independentOverdraft))
      && !observedHtml.includes(composer.money2(excludingOverdraft)),
    'complete observedCash still reprints Forecast A+B Current Balance');

  const fallbackHtml = composer.liveCurrentBalanceHtml(
    { liveCurrentBalance: 501.11 },
    null,
    { liveCurrentBalance: 501.11 }
  );
  ok(fallbackHtml.includes(composer.money2(501.11)),
    'Current Balance still prints Forecast liveCurrentBalance when rows are absent');

  const liveFn = grab(planSrc, /^function liveCurrentBalanceHtml\([\s\S]*?\n\}$/m, 'liveCurrentBalanceHtml');
  ok(/view\.liveCurrentBalance|alloc\.liveCurrentBalance/.test(liveFn)
      && !/Math\.max\(0,\s*b\)/.test(liveFn)
      && !/chequing-a \+ max/.test(liveFn),
    'plan.js does not compose a second Current Balance from chequing rows');
}

if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
