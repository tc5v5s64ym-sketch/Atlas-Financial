'use strict';
/* Live Budget/Plan payday sheet: after budget-polish decorateWaterfall,
 * `.operating-cash-explanation` must remain immediately after Q07.
 *
 * Independent of Forecast. Reconstructs the sibling order `plan.js`
 * `calendarWaterfallHtml` emits (Q02, Q04–Q07, then the explanation), then
 * runs the live polish transform. That is the path the household reads.
 *
 * `node test/test-operating-cash-explanation-placement.js`
 */
const UI = require('../public/budget-polish.js');
const fs = require('fs');
const path = require('path');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

function descendants(root) {
  const out = [];
  const walk = node => {
    for (const child of node.childNodes || []) {
      if (child.nodeType === 1) {
        out.push(child);
        walk(child);
      }
    }
  };
  walk(root);
  return out;
}

function matches(el, selector) {
  const sel = String(selector || '').trim();
  if (!sel || /[\s>+~]/.test(sel.replace(/\[[^\]]*]/g, ''))) return false;
  let rest = sel;
  while (rest) {
    if (rest[0] === '.') {
      const cls = /^\.([\w-]+)/.exec(rest);
      if (!cls || !el.classList.contains(cls[1])) return false;
      rest = rest.slice(cls[0].length);
      continue;
    }
    if (rest[0] === '[') {
      const attr = /^\[([^\]=]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]/.exec(rest);
      if (!attr || !el.hasAttribute(attr[1].trim())) return false;
      if (attr[2] != null || attr[3] != null || attr[4] != null) {
        const expected = attr[2] != null ? attr[2] : attr[3] != null ? attr[3] : attr[4];
        if (el.getAttribute(attr[1].trim()) !== expected) return false;
      }
      rest = rest.slice(attr[0].length);
      continue;
    }
    return false;
  }
  return true;
}

function createElement(doc, tag) {
  const attrs = Object.create(null);
  const el = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    ownerDocument: doc,
    parentNode: null,
    childNodes: [],
    get children() { return this.childNodes.filter(node => node.nodeType === 1); },
    get className() { return attrs.class || ''; },
    set className(value) { attrs.class = String(value == null ? '' : value); },
    classList: {
      add(name) {
        const parts = String(attrs.class || '').split(/\s+/).filter(Boolean);
        if (!parts.includes(name)) parts.push(name);
        attrs.class = parts.join(' ');
      },
      contains(name) {
        return String(attrs.class || '').split(/\s+/).includes(name);
      },
    },
    matches(sel) { return matches(el, sel); },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    setAttribute(name, value) { attrs[name] = String(value); },
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name); },
    appendChild(node) {
      if (node.parentNode) node.parentNode.removeChild(node);
      el.childNodes.push(node);
      node.parentNode = el;
      return node;
    },
    removeChild(node) {
      const index = el.childNodes.indexOf(node);
      if (index < 0) throw new Error('not a child');
      el.childNodes.splice(index, 1);
      node.parentNode = null;
      return node;
    },
    querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) { return descendants(el).filter(node => node.matches(sel)); },
  };
  return el;
}

function nextElementSibling(node) {
  const parent = node && node.parentNode;
  if (!parent) return null;
  const kids = parent.children;
  const index = kids.indexOf(node);
  return index >= 0 ? kids[index + 1] || null : null;
}

function treeIndex(root, node) {
  return descendants(root).indexOf(node);
}

function liveSourceWaterfall() {
  const doc = {
    createElement(tag) { return createElement(doc, tag); },
  };
  const waterfall = createElement(doc, 'section');
  waterfall.setAttribute('data-calendar-waterfall', 'this-pay-period');
  const q = number => {
    const wrap = createElement(doc, 'div');
    wrap.setAttribute('data-operating-question', number);
    waterfall.appendChild(wrap);
    return wrap;
  };
  q('02');
  q('04');
  q('05');
  q('06');
  const afterBudget = q('07');
  const explanation = createElement(doc, 'div');
  explanation.className = 'operating-cash-explanation';
  explanation.setAttribute('data-operating-cash-explanation', '');
  explanation.setAttribute('data-same-contract', 'false');
  waterfall.appendChild(explanation);
  return { doc, waterfall, afterBudget, explanation };
}

console.log('=== Source sibling order matches plan.js (Q07 then explanation) ===');
{
  const { waterfall, afterBudget, explanation } = liveSourceWaterfall();
  ok(nextElementSibling(afterBudget) === explanation,
    'before polish, explanation is the next sibling after Q07');
  ok(waterfall.children.indexOf(afterBudget) < waterfall.children.indexOf(explanation),
    'before polish, Q07 precedes the explanation among waterfall children');
}

console.log('\n=== After decorateWaterfall, live DOM order is still Q07 then explanation ===');
{
  const { doc, waterfall, afterBudget, explanation } = liveSourceWaterfall();
  ok(UI.decorateWaterfall(doc, waterfall) === true, 'decorateWaterfall groups the snapshot');

  const q07 = waterfall.querySelector('[data-operating-question="07"]');
  const expl = waterfall.querySelector('.operating-cash-explanation');
  const incomeCard = waterfall.querySelector('.atlas-income-card');
  const billsCard = waterfall.querySelector('.atlas-bills-card');
  const budgetCard = waterfall.querySelector('.atlas-household-budget-card');

  ok(q07 === afterBudget && expl === explanation,
    'polish rearranges existing nodes; it does not clone Q07 or the explanation');
  ok(budgetCard && q07.parentNode === budgetCard && expl.parentNode === budgetCard,
    'Q07 and the explanation live in the household-budget card');
  ok(q07 && expl && q07.parentNode === expl.parentNode,
    'Q07 and the explanation remain siblings after polish');
  ok(nextElementSibling(q07) === expl,
    'explanation is immediately after Q07 after decorateWaterfall');

  const q07At = treeIndex(waterfall, q07);
  const explAt = treeIndex(waterfall, expl);
  const incomeAt = treeIndex(waterfall, incomeCard);
  const billsAt = treeIndex(waterfall, billsCard);
  ok(q07At >= 0 && explAt > q07At,
    'tree order keeps Q07 before the explanation');
  ok(incomeAt >= 0 && billsAt > incomeAt && explAt > billsAt && explAt > incomeAt,
    'explanation is not left before Income/Bills (the live smoke failure)');
  const budgetKids = budgetCard && budgetCard.children || [];
  const q06 = waterfall.querySelector('[data-operating-question="06"]');
  ok(budgetKids[0] === q06 && budgetKids[1] === q07 && budgetKids[2] === expl,
    'household-budget card children are Q06, Q07, then explanation');
}

console.log('\n=== Missing explanation does not break polish ===');
{
  const doc = {
    createElement(tag) { return createElement(doc, tag); },
  };
  const waterfall = createElement(doc, 'section');
  waterfall.setAttribute('data-calendar-waterfall', 'this-pay-period');
  ['02', '04', '05', '06', '07'].forEach(number => {
    const wrap = createElement(doc, 'div');
    wrap.setAttribute('data-operating-question', number);
    waterfall.appendChild(wrap);
  });
  ok(UI.decorateWaterfall(doc, waterfall) === true,
    'decorateWaterfall still groups a snapshot with no explanation');
  const budgetCard = waterfall.querySelector('.atlas-household-budget-card');
  ok(budgetCard
      && budgetCard.querySelector('[data-operating-question="07"]')
      && !budgetCard.querySelector('.operating-cash-explanation'),
    'household-budget card still closes at Q07 when there is nothing to reprint');
}

console.log('\n=== Polish still does not invent a leftover/cash gap ===');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/budget-polish.js'), 'utf8');
  ok(!/leftover\s*-/.test(src)
      && !/operatingCash\s*-/.test(src)
      && !/sameContract/.test(src)
      && !/Forecast\s*\./.test(src),
    'placement move does not subtract leftover from cash or call Forecast');
}

if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
