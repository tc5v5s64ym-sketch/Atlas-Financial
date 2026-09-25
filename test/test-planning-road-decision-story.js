'use strict';
/* Road Ahead primary story reprints Forecast stage1, planned spending, and stage2.
 * Stage2 = stage1 − planned is proved on the fixture, not by page arithmetic.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const F = require('../public/forecast.js');
const { sourceText } = require('./test-source-text');

const ROOT = path.join(__dirname, '..');
const read = file => sourceText(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const live = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
const periods = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/periods.json'), 'utf8'));

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};
const money2 = n => (n < 0 ? '−$' : '$') + Math.abs(Number(n)).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cents = n => Math.round(Number(n) * 100);

function loadPage() {
  const appSrc = read('public/app.js');
  const grab = re => { const m = re.exec(appSrc); if (!m) throw new Error('missing ' + re); return m[0]; };
  const helpers = [
    grab(/^const money = .*$/m), grab(/^const money2 = .*$/m), grab(/^const pct = .*$/m),
    grab(/^const fmtDate = .*$/m), grab(/^const fmtDateLong = .*$/m), grab(/^const fmtDateFull = .*$/m),
  ].join('\n');
  const ctx = {
    Forecast: F, console,
    App: { hooks: [], register() {}, boot() {} },
    $: () => ({ innerHTML: '', textContent: '' }),
  };
  vm.runInNewContext(`${helpers}\n${read('public/planning.js')}`, ctx, { filename: 'public/planning.js' });
  return ctx;
}

function step(html, name) {
  return (String(html).split(`data-planning-road-decision-step="${name}"`)[1] || '')
    .split('data-planning-road-decision-step="')[0];
}

const page = loadPage();
const planningSrc = read('public/planning.js');
const decisionSrc = planningSrc.slice(
  planningSrc.indexOf('function planningRoadAheadDecisionHtml('),
  planningSrc.indexOf('function planningRoadAheadWaterfallHtml('),
);

console.log('=== Decision story reprints Forecast; the page does not subtract stages ===');
{
  ok(!/stage1\.result\.amount\s*[-+*/]/.test(decisionSrc)
    && !/stage2\.result\.amount\s*[-+*/]/.test(decisionSrc)
    && !/commitments\.amount\s*[-+]/.test(decisionSrc),
    'decision story source does not subtract stage1, stage2, or planned spending');
  ok(/planningRoadPublishedLines\(s2\.commitments\)/.test(decisionSrc)
    && !/christmas|silver|9500|Burrards/i.test(decisionSrc),
    'planned lines are a Forecast reprint with no hard-coded roster');
}

const traj = F.baselineTrajectory(live.plan, live.debts, live.meta.asOf, {
  periods, extraFacilities: live.revolvingExtra,
});

function provePeriod(period, granularity, label) {
  const html = page.planningRoadAheadDecisionHtml(period, granularity);
  const s1 = period.stage1.result.amount;
  const planned = period.stage2.commitments.amount;
  const s2 = period.stage2.result.amount;
  const lines = (period.stage2.commitments.lines || []);
  ok(/data-planning-road-decision-step="before"/.test(html)
    && /data-planning-road-decision-step="planned"/.test(html)
    && /data-planning-road-decision-step="after"/.test(html),
    `${label} shows before, planned spending, and after`);
  ok(step(html, 'before').includes(page.planningRoadSignedMoney(s1))
    && step(html, 'after').includes(page.planningRoadSignedMoney(s2)),
    `${label} reprints Forecast stage1 and stage2 amounts`);
  ok(step(html, 'planned').includes(planned === 0 ? money2(0) : '−' + money2(planned)),
    `${label} reprints the Forecast planned-spending amount`);
  if (lines.length) {
    const lineSum = lines.reduce((sum, row) => sum + cents(row.amount), 0);
    ok(lineSum === cents(planned),
      `${label} fixture: sum of named lines equals the planned amount`,
      `${lineSum} vs ${cents(planned)}`);
    ok(lines.every(row => step(html, 'planned').includes(row.label)),
      `${label} reprints each Forecast line label`);
  }
  ok(cents(s1) - cents(planned) === cents(s2),
    `${label} fixture: stage2 = stage1 − planned`,
    `${s1} − ${planned} vs ${s2}`);
  ok(!/data-planning-road-secondary="debt-strategy"/.test(html)
    && !/After debt strategy/.test(html),
    `${label} primary story does not include the debt-strategy disclosure`);
}

console.log('\n=== Month and Pay Period ===');
{
  const month = traj.months.find(m => m.stage2 && m.stage2.commitments
    && Array.isArray(m.stage2.commitments.lines) && m.stage2.commitments.lines.length);
  ok(!!month, 'live walk publishes a month with named stage2 lines');
  if (month) provePeriod(month, 'month', month.month);
  const pay = (traj.payPeriods || []).find(p => p.stage2 && p.stage2.commitments
    && Array.isArray(p.stage2.commitments.lines) && p.stage2.commitments.lines.length);
  ok(!!pay, 'live walk publishes a pay period with named stage2 lines');
  if (pay) provePeriod(pay, 'pay-period', pay.payday || pay.id);
}

console.log('\n=== Shortfall, zero, and unavailable ===');
{
  const base = JSON.parse(JSON.stringify(traj.months[0]));
  base.stage1.result = { amount: 500, status: 'calculated', identity: 'standalone-period-surplus-deficit', priorPeriodSurplus: 'excluded', phrase: 'surplus phrase' };
  base.stage2.commitments = {
    amount: 800,
    status: 'estimated',
    lines: [
      { id: 'pub-a', label: 'Published commitment A', amount: 500, status: 'estimated', date: '2026-12-09' },
      { id: 'pub-b', label: 'Published commitment B', amount: 300, status: 'estimated' },
    ],
  };
  base.stage2.result = { amount: -300, status: 'calculated', identity: 'standalone-period-surplus-deficit', priorPeriodSurplus: 'excluded', phrase: 'This period needs this amount saved before it arrives. Earlier surplus is not applied.' };
  base.stage3.result = { amount: -900, status: 'calculated' };
  const gap = page.planningRoadAheadDecisionHtml(base, 'month');
  ok(/Shortfall before planned spending/.test(step(gap, 'before')) === false
    && /Available to allocate/.test(step(gap, 'before'))
    && /Shortfall after deductions/.test(step(gap, 'after'))
    && !/Surplus after deductions/.test(step(gap, 'after'))
    && /Published commitment A/.test(step(gap, 'planned'))
    && /Published commitment B/.test(step(gap, 'planned'))
    && step(gap, 'planned').includes('−' + money2(800))
    && !step(gap, 'after').includes(money2(900)),
    'a negative stage2 is Shortfall after planned spending and does not reprint stage3');

  const even = JSON.parse(JSON.stringify(base));
  even.stage2.commitments = { amount: 0, status: 'calculated', lines: [] };
  even.stage2.result = { amount: 500, status: 'calculated', identity: 'standalone-period-surplus-deficit', priorPeriodSurplus: 'excluded' };
  const zeroHtml = page.planningRoadAheadDecisionHtml(even, 'pay-period');
  ok(/data-planning-road-planned-lines="total-only"/.test(step(zeroHtml, 'planned'))
    && step(zeroHtml, 'planned').includes(money2(0))
    && !/Published commitment A/.test(zeroHtml)
    && /Surplus after planned spending/.test(step(zeroHtml, 'after')),
    'zero planned spending reprints $0 and invents no named lines');

  const withheld = JSON.parse(JSON.stringify(base));
  withheld.stage1.result = { status: 'unavailable', reason: 'withheld' };
  withheld.stage2.commitments = { status: 'unavailable', reason: 'withheld' };
  withheld.stage2.result = { status: 'unavailable', reason: 'withheld' };
  const held = page.planningRoadAheadDecisionHtml(withheld, 'month');
  ok(/Available to allocate/.test(step(held, 'before'))
    && /After deductions/.test(step(held, 'after'))
    && !/Surplus after deductions/.test(step(held, 'after'))
    && !/Shortfall after deductions/.test(step(held, 'after'))
    && /planning-road-amount-unavailable/.test(step(held, 'before'))
    && /planning-road-amount-unavailable/.test(step(held, 'planned'))
    && /planning-road-amount-unavailable/.test(step(held, 'after'))
    && !/\$0\.00/.test(held),
    'unavailable before, planned, and after stay em-dashes and are not $0');

  const road = page.planningRoadAheadHtml(traj, 'month', monthKey(traj), live.meta.asOf);
  ok(/data-planning-road-secondary="debt-strategy"/.test(road.stages)
    && /After debt strategy/.test(road.stages)
    && /data-planning-road-wf="final"/.test(road.stages),
    'stage3 remains a secondary disclosure under the component waterfall');
}

function monthKey(trajectory) {
  return trajectory.months[0].month;
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll Road Ahead decision-story checks passed.');
