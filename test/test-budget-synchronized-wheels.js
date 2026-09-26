'use strict';
/* Run the production selector and its actual event handlers on synthetic
 * published rows. Real waterfall/trust printing is also exercised by the
 * registered Budget payroll and historical suites. No live household cents. */
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { sourceText } = require('./test-source-text');
const source = sourceText(fs.readFileSync(path.join(__dirname, '../public/plan.js'), 'utf8'));
const css = sourceText(fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8'));
const context = vm.createContext({
  fmtDate: value => value,
  liveCurrentBalanceHtml: () => '<div data-live-current-balance>cash</div>',
  calendarWaterfallHtml: row => `<article data-proof-row="${row.id}">${JSON.stringify(row)}</article>`,
  periodBillLine: () => '',
});
vm.runInContext(source, context);
// Retain the production timeline composer and wiring; isolate unrelated views.
vm.runInContext(`
  calendarWaterfallHtml = row => '<article data-proof-row="' + row.id + '">' + JSON.stringify(row) + '</article>';
  liveCurrentBalanceHtml = () => '<div data-live-current-balance>cash</div>';
  operatingSurfaceHtml = ctx => payPeriodTimelineHtml(ctx.advice, ctx.planPayPeriodId, null, null, '', null);
  selectedPlanView = advice => advice.defaultView;
`, context);
const row = (id, start, end, role) => Object.freeze({
  id, start, end, rangeLabel: `${start} – ${end}`, timelineRole: role,
  incomeTotal: 1800, periodBillLoad: 300, householdBudgetTotal: 200,
  predictedEndingBalance: 1300,
});
const rows = Object.freeze([
  row('past', '2026-09-11', '2026-09-24', 'past'),
  row('current', '2026-09-25', '2026-10-08', 'current'),
  row('next', '2026-10-09', '2026-10-22', 'next'),
  row('nov-first', '2026-10-23', '2026-11-05', 'future'),
  row('nov-second', '2026-11-06', '2026-11-19', 'future'),
  row('dec', '2026-11-20', '2026-12-03', 'future'),
  row('jan', '2026-12-18', '2027-01-01', 'future'),
]);
const advice = { payPeriodViews: rows, defaultView: { asOf: '2026-09-26' } };
const original = JSON.stringify(advice);
const f = context;
let checks = 0;
function check(label, run) { run(); checks++; console.log('  PASS  ' + label); }
check('initial row is Forecast current, centered in its close month October', () => {
  const s = f.payPeriodSelection(advice, null);
  assert.equal(s.period, rows[1]);
  assert.equal(f.payPeriodCloseMonth(s.period), '2026-10');
  const html = f.payPeriodNavigatorHtml(s);
  assert.match(html, /data-selected-close-month="2026-10"/);
  assert.match(html, /--wheel-slot:46%;--wheel-offset:-19%/);
  assert.match(html, /--wheel-slot:52%;--wheel-offset:-28%/);
});
check('the three dispatched ranges map independently to October, October, November', () => {
  assert.deepEqual(rows.slice(1, 4).map(f.payPeriodCloseMonth), ['2026-10', '2026-10', '2026-11']);
});
check('months come only from published row ends, distinguish years, and retain first row ids', () => {
  const months = f.payPeriodMonths(f.payPeriodSelection(advice, null));
  assert.equal(months.length, 5);
  assert.equal(months[2].id, 'nov-first');
  assert.equal(months[4].key, '2027-01');
  assert.equal(months[4].name, 'January 2027');
});
check('entering November selects its first row; selecting October again keeps its second row', () => {
  assert.equal(f.payPeriodWheelSelection(advice, 'next', 'month', 2).period, rows[3]);
  assert.equal(f.payPeriodWheelSelection(advice, 'next', 'month', 1).period, rows[2]);
});
check('both wheels reject bounds, noninteger input, and never wrap', () => {
  for (const kind of ['month', 'period']) {
    for (const index of [-1, 99, 1.1, NaN]) {
      assert.equal(f.payPeriodWheelSelection(advice, 'current', kind, index).period, rows[1]);
    }
  }
});

// Minimal event targets model remounts and pointer capture. Handlers are the
// unmodified wirePlanLookPicker function, not a test reimplementation.
class Track {
  constructor(offset) {
    this.values = { '--wheel-offset': offset };
    this.style = { getPropertyValue: key => this.values[key], setProperty: (key, value) => { this.values[key] = value; } };
    this.classes = new Set();
    this.classList = { add: x => this.classes.add(x), remove: x => this.classes.delete(x) };
  }
}
class Wheel {
  constructor(kind, offset) {
    this.kind = kind; this.handlers = {}; this.track = new Track(offset); this.clientWidth = 360;
    this.capture = null;
  }
  getAttribute() { return this.kind; }
  querySelector() { return this.track; }
  addEventListener(name, fn) { this.handlers[name] = fn; }
  setPointerCapture(id) { this.capture = id; }
  hasPointerCapture(id) { return this.capture === id; }
  fire(name, extra = {}) {
    const e = Object.assign({ isPrimary: true, button: 0, pointerId: 1, clientX: 200, clientY: 20, preventDefault() { this.prevented = true; } }, extra);
    this.handlers[name](e);
    return e;
  }
}
const mount = {
  html: '', wheels: [], focused: null,
  set innerHTML(html) {
    this.html = html;
    const offsets = [...html.matchAll(/--wheel-offset:([^";]+)%/g)].map(m => m[1] + '%');
    this.wheels = [new Wheel('month', offsets[0]), new Wheel('period', offsets[1])];
  },
  get innerHTML() { return this.html; },
  querySelector(selector) {
    if (selector === '[data-pay-period-swipe]') return this;
    if (/aria-current/.test(selector)) return { focus: () => { this.focused = selector; } };
    return null;
  },
  querySelectorAll() { return this.wheels; },
};
function load(id) {
  context.id = id;
  vm.runInContext('planPayPeriodId = id;', context);
  mount.innerHTML = f.payPeriodTimelineHtml(advice, id, null, null, '', null);
  f.wirePlanLookPicker(mount, { advice, planLook: 'this-period', planPayPeriodId: id });
}
function selected() { return /data-selected-pay-period="([^"]+)"/.exec(mount.html)[1]; }
function swipe(kind, dx, dy = 0, cancel = false) {
  const wheel = mount.wheels[kind === 'month' ? 0 : 1];
  wheel.fire('pointerdown');
  wheel.fire('pointermove', { clientX: 200 + dx, clientY: 20 + dy });
  wheel.fire(cancel ? 'pointercancel' : 'pointerup', { clientX: 200 + dx, clientY: 20 + dy });
  return wheel;
}
function tap(kind, index) {
  const button = { getAttribute: () => String(index) };
  mount.wheels[kind === 'month' ? 0 : 1].fire('click', { detail: 1, target: { closest: () => button } });
}
check('one long period swipe advances exactly one Forecast row, even at multi-slot distance', () => {
  load('current'); swipe('period', -1000); assert.equal(selected(), 'next');
  swipe('period', -1000); assert.equal(selected(), 'nov-first');
  assert.match(mount.html, /data-selected-close-month="2026-11"/);
  assert.equal(mount.wheels[0].track.classes.has('is-moving'), true);
  assert.equal(mount.wheels[1].track.classes.has('is-moving'), true);
});
check('period tap and swipe select the same exact row and body; keyboard focus follows selection', () => {
  load('next'); swipe('period', -100); const html = mount.html;
  load('next'); tap('period', 3); assert.equal(mount.html, html);
  assert.match(mount.focused, /period/);
  assert.match(mount.html, /data-proof-row="nov-first"/);
});
check('month tap and swipe select the first November row and synchronize the period center', () => {
  load('next'); swipe('month', -100); const html = mount.html;
  load('next'); tap('month', 2); assert.equal(mount.html, html);
  assert.equal(selected(), 'nov-first');
  assert.match(mount.html, /--wheel-offset:-132%/);
});
check('vertical, subthreshold, cancelled, and nonprimary gestures do not select', () => {
  load('current'); swipe('period', 100, 180); assert.equal(selected(), 'current');
  swipe('period', -43); assert.equal(selected(), 'current');
  swipe('period', -100, 0, true); assert.equal(selected(), 'current');
  const wheel = mount.wheels[1];
  wheel.fire('pointerdown', { isPrimary: false }); wheel.fire('pointerup', { clientX: 0 });
  assert.equal(selected(), 'current');
});
check('keyboard moves one period or month and ignores other keys', () => {
  load('next'); mount.wheels[0].fire('keydown', { key: 'ArrowRight' }); assert.equal(selected(), 'nov-first');
  mount.wheels[1].fire('keydown', { key: 'ArrowRight' }); assert.equal(selected(), 'nov-second');
  mount.wheels[1].fire('keydown', { key: 'ArrowLeft' }); assert.equal(selected(), 'nov-first');
  mount.wheels[1].fire('keydown', { key: 'ArrowUp' }); assert.equal(selected(), 'nov-first');
});
check('actual swipe handlers keep both bounds and suppress post-drag clicks', () => {
  load('past'); const wheel = swipe('period', 100); assert.equal(selected(), 'past');
  wheel.fire('click', { detail: 1, target: { closest: () => ({ getAttribute: () => '1' }) } });
  assert.equal(selected(), 'past');
  load('jan'); swipe('period', -100); assert.equal(selected(), 'jan');
  swipe('month', -100); assert.equal(selected(), 'jan');
});
check('current-only balance and authoritative as-of survive both wheel paths; rows remain immutable', () => {
  load('current'); assert.match(mount.html, /data-live-current-balance/);
  tap('month', 2); assert.doesNotMatch(mount.html, /data-live-current-balance/);
  assert.match(mount.html, /data-household-as-of="2026-09-26"/);
  load('past'); assert.doesNotMatch(mount.html, /data-live-current-balance/);
  assert.equal(JSON.stringify(advice), original);
});
check('wheel inputs use named buttons, selected semantics, reduced motion, and no independent month state', () => {
  assert.match(mount.html, /type="button"/);
  assert.match(mount.html, /tabindex="0" aria-current="true"/);
  assert.match(css, /prefers-reduced-motion:reduce[\s\S]*?\.budget-wheel-track \{ animation:none !important; transition:none;/);
  assert.match(css, /touch-action:pan-y pinch-zoom/);
  assert.doesNotMatch(source, /let selectedMonth|let planMonth|data-pay-period-step/);
  assert.doesNotMatch(source, /baselineTrajectory|roadAhead|stage1|stage2|stage3/);
  assert.doesNotMatch(f.payPeriodNavigatorHtml.toString(), /incomeTotal|periodBillLoad|householdBudgetTotal|predictedEndingBalance|Forecast\./);
  assert.doesNotMatch(css, /pay-period-nav-button/);
});
console.log(`\nALL ${checks} SYNCHRONIZED WHEEL CHECKS PASSED`);
