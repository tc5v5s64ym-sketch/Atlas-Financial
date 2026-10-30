'use strict';
/* ATLAS-026 (#723) income-override coercion: repro of record (test-only).
 *
 * Pins CURRENT shipped behaviour of `streamAmount` (public/forecast.js
 * L2730-2733 at main 733e49e5), reached through the exported
 * `expandEvents` path, where the global `isFinite()` coerces its argument
 * before the check:
 *
 *   if (override != null && isFinite(override)) monthly = Number(override);
 *
 * Observed: a string override '250' is accepted as the number 250 and a
 * boolean override `true` as 1. Neither is rejected or flagged.
 *
 * This file is a reproducer, not a fix and not a classification. It does
 * NOT decide whether the coercion is a defect, what a corrected rule
 * should accept, or how a rejected override should surface; that is
 * Atlas's call on #723. The "COERCION" assertions pass at 733e49e5
 * because they describe today's behaviour. If a later repair rejects
 * non-number overrides, those assertions are expected to flip and should
 * be rewritten by that repair. Controls (number override, no override,
 * non-finite string, null) must stay green either way.
 *
 * Not registered in test/test.js (same as the #801 repro-of-record
 * pattern); run directly: node test/test-forecast-723-income-override-coercion.js
 *
 * Synthetic fixtures only; amounts are unlike live household figures.
 */
const F = require('../public/forecast.js');

let failures = 0;
let passes = 0;
const ok = (cond, label, detail = '') => {
  if (cond) passes++; else failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' - ' + detail : ''}`);
};
const eq = (a, b) => a === b || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.005);

const START = '2026-11-01';
const END = '2026-11-30';
const FIXED = 37;              // stream.amount, used when no override applies
const SCENARIO_MONTHLY = 410;  // expected-scenario monthly figure

// One monthly stream with a fixed amount, one monthly stream with a
// scenario figure. Monthly frequency keeps the override value unscaled.
function plan() {
  return {
    income: [
      { id: 'fixed', label: 'Synthetic fixed stream', frequency: 'monthly',
        day: 10, amount: FIXED, confidence: 'confirmed' },
      { id: 'scen', label: 'Synthetic scenario stream', frequency: 'monthly',
        day: 12, amount: FIXED,
        scenarioMonthly: { expected: SCENARIO_MONTHLY, low: 300, high: 500 },
        confidence: 'estimated' },
    ],
    bills: [], obligations: [], commitments: [],
  };
}

function incomeAmount(id, overrides) {
  const opts = { scenario: 'expected' };
  if (overrides !== undefined) opts.incomeOverrides = overrides;
  const evs = F.expandEvents(plan(), START, END, opts) || [];
  const hits = evs.filter(e => e && (e.id === id || e.sourceId === id || e.streamId === id));
  return { count: hits.length, amount: hits.length ? hits[0].amount : undefined, raw: hits[0] };
}

function check(label, id, overrides, expected) {
  const r = incomeAmount(id, overrides);
  ok(r.count === 1, `${label}: exactly one ${id} occurrence in window`, `got ${r.count}`);
  ok(eq(r.amount, expected), `${label}: amount ${expected}`, `got ${JSON.stringify(r.amount)}`);
  ok(typeof r.amount === 'number', `${label}: amount is a number`, `got ${typeof r.amount}`);
}

console.log('COERCION (pins current behaviour at 733e49e5; not a ruling)');
check("string override '250' on fixed stream is accepted as 250", 'fixed', { fixed: '250' }, 250);
check("string override '250' on scenario stream is accepted as 250", 'scen', { scen: '250' }, 250);
check('boolean override true on fixed stream is accepted as 1', 'fixed', { fixed: true }, 1);
check('boolean override true on scenario stream is accepted as 1', 'scen', { scen: true }, 1);
check("whitespace-padded string ' 250 ' is accepted as 250", 'fixed', { fixed: ' 250 ' }, 250);

console.log('CONTROLS (must hold before and after any repair)');
check('numeric override 250 applies as 250', 'fixed', { fixed: 250 }, 250);
check('numeric override 250 replaces scenario figure', 'scen', { scen: 250 }, 250);
check('no overrides object: fixed stream uses stream.amount', 'fixed', undefined, FIXED);
check('no overrides object: scenario stream uses scenario figure', 'scen', undefined, SCENARIO_MONTHLY);
check('null override is ignored (fixed amount)', 'fixed', { fixed: null }, FIXED);
check("non-numeric string 'abc' is ignored (scenario figure)", 'scen', { scen: 'abc' }, SCENARIO_MONTHLY);
check('NaN override is ignored (fixed amount)', 'fixed', { fixed: NaN }, FIXED);
check('override for another id does not leak', 'fixed', { scen: 999 }, FIXED);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
