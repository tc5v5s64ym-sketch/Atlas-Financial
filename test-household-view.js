'use strict';
/* Plain-language homepage acceptance.
 *
 * The underlying operating answer remains public/plan.js + Forecast. This
 * suite proves the household readability layer stays downstream of that
 * answer, does not become a planner, and groups repetitive diagnostics rather
 * than dumping them onto the default phone view.
 */
const fs = require('fs');
const path = require('path');
const H = require('./public/household-view.js');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');

console.log('=== default homepage speaks to the household first ===');
{
  const html = read('public/index.html');
  ok(/<div class="kicker">Today<\/div>/.test(html),
    'the first surface is labelled Today, not an internal operating-surface term');
  ok(/The useful answer first: what to do today, what you can spend/.test(html),
    'the intro says what the page is for in ordinary language');
  const planAt = html.indexOf('<script src="/plan.js"></script>');
  const householdAt = html.indexOf('<script src="/household-view.js"></script>');
  ok(planAt >= 0 && householdAt > planAt,
    'plain-language presentation runs after the incumbent plan renderer');
  ok(/<link rel="stylesheet" href="\/household-view\.css">/.test(html),
    'the mobile household presentation stylesheet is loaded');
}

console.log('\n=== duplicate diagnostics are grouped and translated ===');
{
  const grouped = H.aggregateTexts([
    'A material observation could not be safely classified.',
    'A material observation could not be safely classified.',
    'Category allocation is incomplete, so named remaining is not an exact claim.',
    'A material observation could not be safely classified.',
  ]);
  ok(grouped.length === 2 && grouped[0].count === 3,
    'three identical diagnostics become one grouped row');
  ok(H.friendlyDiagnostic(grouped[0].text, grouped[0].count)
      === '3 observations still need classification.',
    'generic classification jargon becomes one human-readable count');
  ok(H.friendlyDiagnostic(grouped[1].text, grouped[1].count)
      === 'Some spending is still uncategorized, so category remaining amounts are not exact.',
    'category trust limitation keeps its meaning in ordinary language');
  ok(H.friendlyDiagnostic(
      '60 unmatched household cash movements were not classified into modeled items.', 1)
      === '60 cash movements still need review.',
    'unmatched-cash volume is summarized instead of repeated');
}

console.log('\n=== the readability layer does not become a financial authority ===');
{
  const src = read('public/household-view.js');
  ok(!/Forecast\s*\./.test(src), 'does not call Forecast');
  ok(!/data\.json|periods\.json|fetch\s*\(/.test(src),
    'does not read financial sources or fetch evidence');
  ok(!/paydayAllocation|currentPeriodAction|debtPriority|fundingSequence|projectDebts|simulate\s*\(/.test(src),
    'does not recreate an engine or allocation authority');
  ok(/querySelector|textContent|cloneNode|replaceChildren/.test(src),
    'works only from already-rendered presentation content');
  ok(/See data quality details/.test(src) && /See future costs/.test(src),
    'diagnostic depth remains available behind explicit details');
  ok(/No safe spending amount right now\./.test(src)
    && /No money movement needed today\./.test(src),
    'the first-screen action language is direct and household-readable');
  ok(/Spendable cash · not credit/.test(src),
    'the compact cash fact preserves the credit-is-not-cash boundary');
}

console.log('\n=== trust caveats are translated, not deleted ===');
{
  const normal = H.friendlySpendingNote(
    "Forecast.recommend's supported household cap through the next payday. Essential costs come out of it first."
  );
  ok(normal === 'This is the household spending limit until the next payday. Essential costs come out of it first.',
    'essential-cost ordering survives the plain-language rewrite');
  const limited = H.friendlySpendingNote(
    "Forecast.currentPeriodAction's current weekly permission through the next payday. Current remaining spend cannot be confirmed from the incumbent trust contract."
  );
  ok(limited === 'This is the household spending limit until the next payday. Current remaining spend is not confirmed.',
    'an unavailable remaining-spend claim stays visible in ordinary language');
}

console.log('\n=== current values are copied, not recalculated ===');
{
  ok(H.cashValueFromNote('Current spendable cash: $123.45 · Spendable cash. Not credit.') === '$123.45',
    'cash display copies a synthetic already-rendered value');
  ok(H.cashValueFromNote('No cash value here') === null,
    'missing rendered cash does not invent one');
}

if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
