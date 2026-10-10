'use strict';
// A whole-window Forecast verdict is not a selected-pay-period publication.
// Exercise the face consumer with invented dates/figures and the real status API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Forecast = require('../public/forecast');
const source = fs.readFileSync(path.join(__dirname, '../public/budget-blend.js'), 'utf8');
const consumer = /^  function paintPlanStatus\(hero\) \{[\s\S]*?^  \}/m.exec(source)?.[0];
assert.ok(consumer, 'the actual hero consumer is readable');
// Include the old mapping when proving the regression against the unfixed tree.
const mapping = /^  const PLAN_STATUS = \{[\s\S]*?^  \};/m.exec(source)?.[0] || '';
class Node {
  constructor(className = '', textContent = '') {
    this.className = className; this.textContent = textContent;
    this.children = []; this.parent = null;
  }
  appendChild(node) { node.parent = this; this.children.push(node); return node; }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  querySelector(selector) {
    return this.children.find(node => node.className.split(' ').includes(selector.slice(1)))
      || this.children.map(node => node.querySelector(selector)).find(Boolean) || null;
  }
}
function fixture(verdict, stale) {
  const band = { attributes: { 'data-plan-status': verdict.id }, verdict,
    textContent: verdict.id === 'negative' ? 'Shortfall expected around October 14.' : 'Whole-window plan status',
    getAttribute(name) { return this.attributes[name] || null; } };
  const hero = new Node();
  const id = hero.appendChild(new Node('blend-hero-id'));
  const range = id.appendChild(new Node('blend-hero-range', 'Aug 14 – Aug 27'));
  const now = id.appendChild(new Node('blend-now', 'Now'));
  const result = hero.appendChild(new Node('budget-step-value', '$123.45'));
  const panel = hero.appendChild(new Node('blend-hero-panel-body'));
  const evidence = panel.appendChild(new Node('native-evidence', 'Original source and uncertainty qualifiers'));
  if (stale) {
    id.appendChild(new Node('blend-plan-chip', 'Short'));
    panel.appendChild(new Node('blend-plan-note', 'Plan status covers the next 13 weeks, not just this pay period.'));
  }
  const document = { getElementById: name => name === 'status-band' ? band : null,
    createElement: () => new Node() };
  const paint = vm.runInNewContext(mapping + '\n' + consumer + '\npaintPlanStatus',
    { document, selectedPeriodIsCurrent: () => true });
  return { band, hero, range, now, result, panel, evidence, paint };
}
const sim = { min: { balance: -31.19, date: '2026-10-14' }, buffer: 500,
  ending: 1250, end: '2026-11-18', daily: [
    { date: '2026-08-20', balance: 3000 },
    { date: '2026-10-14', balance: -31.19 },
    { date: '2026-11-18', balance: 1250 },
  ] };
const negative = Forecast.planStatus({ mode: 'feasible', sim }, { sim });
assert.equal(negative.id, 'negative');
assert.equal(negative.firstNegative, '2026-10-14');
const positiveSim = { ...sim, min: { balance: 700, date: '2026-10-14' },
  daily: sim.daily.map(row => ({ ...row, balance: 700 })) };
const onPlan = Forecast.planStatus({ mode: 'feasible', sim: positiveSim }, { sim: positiveSim });
assert.equal(onPlan.id, 'onPlan');
for (const [name, verdict, stale] of [
  ['future October shortfall', negative, false],
  ['whole-window On plan', onPlan, false],
  ['stale hero verdict after remount', negative, true],
]) {
  const f = fixture(verdict, stale);
  const bandBefore = JSON.stringify(f.band);
  const evidenceBefore = f.evidence.textContent;
  f.paint(f.hero);
  assert.equal(f.hero.querySelector('.blend-plan-chip'), null,
    name + ' cannot publish selected-period hero confidence');
  assert.equal(JSON.stringify(f.band), bandBefore, name + ' retains native status and identity');
  assert.equal(f.range.textContent, 'Aug 14 – Aug 27');
  assert.equal(f.now.textContent, 'Now');
  assert.equal(f.result.textContent, '$123.45');
  assert.equal(f.evidence.parent, f.panel);
  assert.equal(f.evidence.textContent, evidenceBefore, name + ' retains original evidence');
  console.log('PASS ' + name + ': no selected-period confidence chip; native status, dates, result and evidence retained');
}
