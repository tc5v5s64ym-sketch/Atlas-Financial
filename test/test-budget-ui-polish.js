'use strict';
/* Approved Budget UI presentation contract.
 *
 * This is deliberately a presentation test. Forecast and plan.js still own
 * every amount and settlement state; budget-polish.js may only translate an
 * already-rendered status into visual language and rearrange existing DOM.
 */
const fs = require('fs');
const path = require('path');
const UI = require('../public/budget-polish.js');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

console.log('=== Budget polish stays downstream of Forecast ===');
{
  const src = read('public/budget-polish.js');
  ok(!/Forecast\s*\./.test(src), 'presentation layer does not call Forecast');
  ok(!/data\.json|periods\.json|fetch\s*\(/.test(src),
    'presentation layer does not read canonical financial sources');
  ok(!/reduce\s*\(|\.amount\s*[+\-*/]/.test(src),
    'presentation layer does not total or recalculate money');
  ok(/data-live-current-balance/.test(src)
    && /data-payday-balance/.test(src)
    && /data-operating-question/.test(src),
    'presentation reads the incumbent rendered semantic DOM');
}

console.log('\n=== approved bill status language is calm and explicit ===');
{
  const paid = UI.billStatePresentation('PAID');
  const toPay = UI.billStatePresentation('still due');
  const pending = UI.billStatePresentation('pending');
  const check = UI.billStatePresentation('needs confirmation');
  ok(paid && paid.label === 'PAID' && paid.kind === 'paid',
    'settled bill maps to PAID');
  ok(toPay && toPay.label === 'TO PAY' && toPay.kind === 'to-pay',
    'unpaid bill maps to TO PAY, not due/late wording');
  ok(pending && pending.label === 'PENDING',
    'pending keeps its incumbent meaning rather than being relabelled paid/unpaid');
  ok(check && check.label === 'CHECK',
    'needs-confirmation remains distinct from unpaid');
  ok(!/[!]/.test([paid, toPay, pending, check].map(x => x.label).join(' ')),
    'normal bill states use no alarm icon or exclamation wording');
  ok(UI.cleanBillLabel('Mortgage · Aug 28 · PAID', 'PAID') === 'Mortgage · Aug 28',
    'inline PAID suffix is removed when a status pill will replace it');
  ok(UI.cleanBillLabel('BC Hydro · Sep 1 · still due', 'still due') === 'BC Hydro · Sep 1',
    'inline still-due suffix is removed when TO PAY pill will replace it');
}

console.log('\n=== approved hierarchy and app navigation are present ===');
{
  const html = read('public/index.html');
  const css = read('public/budget-polish.css');
  const shared = read('public/styles.css');
  ok(/budget-polish\.css/.test(html) && /budget-polish\.js/.test(html),
    'Budget page loads the approved visual layer');
  ok(/atlas-current-balance-card/.test(css)
    && /atlas-period-summary/.test(css),
    'Current Balance plus rollover/payday summary have dedicated hierarchy');
  ok(/atlas-income-card/.test(css)
    && /atlas-bills-card/.test(css)
    && /atlas-household-budget-card/.test(css),
    'Income, Bills and Household Budget remain first-class distinct cards');
  ok(/atlas-bill-row-paid/.test(css) && /atlas-bill-row-to-pay/.test(css),
    'paid and to-pay bill rows have separate visual states');
  ok(/\.atlas-period-summary\s*>\s*:only-child\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s.test(css),
    'a lone Rollover or Payday summary fills the row instead of leaving a false empty card');
  ok(/--atlas-purple:\s*color-mix\([^;]*var\(--text-primary\)[^;]*\);/.test(css),
    'Bills accent adapts against the current theme text token instead of using a dark-only low-contrast fixed purple');
  ok(/--nav-icon-budget/.test(shared)
    && /--nav-icon-bills/.test(shared)
    && /--nav-icon-subscriptions/.test(shared)
    && /--nav-icon-credit/.test(shared)
    && /--nav-icon-planning/.test(shared),
    'all five household tab icons remain defined');
  ok(/\.sitenav-household \.sitenav-icon[\s\S]*display:block/.test(shared),
    'phone tab selector renders icons');
}

if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
