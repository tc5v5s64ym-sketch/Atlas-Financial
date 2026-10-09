'use strict';
// Dependency-free ownership/focus contract tests for the native controller.
// This small DOM double exercises original-node movement and modal events;
// viewport placement and real focus/animation still require browser proof.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/plan.js'), 'utf8');
const controller = source.slice(source.indexOf('function budgetDetailSheetController(mount) {'),
  source.indexOf('\nfunction budgetRemount(mount, ctx)'));
assert.ok(controller.startsWith('function budgetDetailSheetController'));
function selectors(text, separator) {
  let depth = 0, start = 0;
  const result = [];
  for (let i = 0; i < text.length; i++) {
    if ('[('.includes(text[i])) depth++;
    if ('])'.includes(text[i])) depth--;
    if (!depth && text[i] === separator) { result.push(text.slice(start, i)); start = i + 1; }
  }
  result.push(text.slice(start));
  return result.map(value => value.trim()).filter(Boolean);
}
class Element {
  constructor(document, tag, attrs = {}) {
    this.ownerDocument = document; this.tagName = tag; this.attrs = { ...attrs };
    this.children = []; this.parentNode = null; this.listeners = new Map();
    this.hidden = false; this.inert = false; this.disabled = false; this.open = false;
    this.scrollTop = 0; this.textContent = ''; this.tabIndex = ['button', 'summary'].includes(tag) ? 0 : -1;
    const classes = new Set((attrs.class || '').split(' ').filter(Boolean));
    this.classList = { contains: value => classes.has(value), add: value => classes.add(value),
      remove: value => classes.delete(value), toggle: (value, on) => {
        const yes = on === undefined ? !classes.has(value) : on;
        if (yes) classes.add(value); else classes.delete(value); return yes;
      } };
  }
  get isConnected() { return this.ownerDocument.body === this || !!this.parentNode?.isConnected; }
  get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
  hasAttribute(key) { return key === 'inert' ? this.inert : key === 'hidden' ? this.hidden : key in this.attrs; }
  getAttribute(key) { return this.hasAttribute(key) ? this.attrs[key] ?? '' : null; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  removeAttribute(key) { delete this.attrs[key]; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  removeChild(node) { this.children.splice(this.children.indexOf(node), 1); node.parentNode = null; }
  insertBefore(node, before) {
    assert.ok(!node.contains(this), 'moving an original source must not form a DOM cycle');
    if (node.parentNode) node.parentNode.removeChild(node);
    this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, node);
    node.parentNode = this; return node;
  }
  appendChild(node) { return this.insertBefore(node, null); }
  before(node) { this.parentNode.insertBefore(node, this); }
  matches(selector) {
    const choices = selectors(selector, ',');
    if (choices.length > 1) return choices.some(choice => this.matches(choice));
    const parts = selectors(selector, ' ');
    if (parts.length > 1) return this.matches(parts.pop()) && !!this.parentNode?.closest(parts.join(' '));
    const has = selector.match(/:has\(> (.+)\)$/);
    if (has) { if (!this.children.some(child => child.matches(has[1]))) return false; selector = selector.slice(0, has.index); }
    const not = selector.match(/:not\(([^)]+)\)/);
    if (not) { if (this.matches(not[1])) return false; selector = selector.replace(not[0], ''); }
    const tag = selector.match(/^[a-z]+/);
    if (tag && tag[0] !== this.tagName) return false;
    const classes = [...selector.matchAll(/\.([\w-]+)/g)];
    if (classes.some(match => !this.classList.contains(match[1]))) return false;
    return [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)]
      .every(([, key, value]) => this.hasAttribute(key) && (value === undefined || this.getAttribute(key) === value));
  }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [child, ...child.querySelectorAll('*')])
      .filter(child => selector === '*' || child.matches(selector));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getClientRects() { return this.isConnected && !this.closest('[hidden]') ? [{}] : []; }
  focus() {
    if (this.getClientRects().length && !this.disabled && !this.closest('[inert]'))
      this.ownerDocument.activeElement = this;
  }
  scrollIntoView() {}
  addEventListener(type, handler) {
    const list = this.listeners.get(type) || []; list.push(handler); this.listeners.set(type, list);
  }
  emit(type, extra = {}) {
    const event = { target: this, preventDefault() { this.defaultPrevented = true; }, ...extra };
    for (const handler of this.listeners.get(type) || []) handler(event);
    return event;
  }
  getBoundingClientRect() { return { left: 20, right: 520, top: 16, bottom: 884 }; }
  showModal() { assert.equal(this.open, false); this.open = true; this.showCount = (this.showCount || 0) + 1; }
  close() { this.open = false; this.closeCount = (this.closeCount || 0) + 1; this.emit('close'); }
}
function fixture() {
  const document = { createElement(tag) { return new Element(document, tag); } };
  document.body = new Element(document, 'body'); document.activeElement = document.body;
  const add = (parent, tag, attrs) => parent.appendChild(new Element(document, tag, attrs));
  const mount = add(document.body, 'main', {});
  const section = add(mount, 'section', { class: 'budget-surface-period', 'data-budget-browse': 'bills' });
  const heading = add(section, 'button', { 'data-blend-bills-open': '', 'aria-expanded': 'false' });
  const panel = add(section, 'div', { 'data-blend-bills-panel': '' }); panel.hidden = true;
  const row = add(panel, 'button', { 'data-budget-bill-open': 'hydro', 'data-budget-browse-origin': 'current',
    'data-budget-bill-date': '2026-10-09', 'aria-expanded': 'false' });
  const owner = add(mount, 'section', { class: 'budget-surface-period' }); owner.hidden = true;
  const detail = add(owner, 'details', { 'data-bill-detail': '' });
  add(detail, 'summary', { 'data-period-bill': 'hydro', 'data-bill-date': '2026-10-09' });
  const evidence = add(detail, 'p', {}); evidence.textContent = 'Fixture publication: $120.00; unconfirmed';
  const after = add(owner, 'span', {});
  const otherTrigger = add(mount, 'button', { 'data-budget-window-choose': '' });
  const other = add(owner, 'div', { 'data-budget-window-picker': '' }); other.hidden = true;
  const dialog = add(mount, 'dialog', { 'data-budget-detail-sheet': '' });
  const header = add(dialog, 'header', {});
  const close = add(header, 'button', { 'data-budget-detail-close': '', 'aria-label': 'Close details' });
  const title = add(header, 'h2', { 'data-budget-detail-title': '' });
  const body = add(dialog, 'div', { 'data-budget-detail-body': '' });
  const calls = [];
  let forwarded = null;
  const context = vm.createContext({ document, CSS: { escape: value => value },
    BudgetSheetMotion: {
      from(node, action) { const previous = forwarded; forwarded = node; try { return action(); } finally { forwarded = previous; } },
      opener: () => forwarded,
      origin: node => ({ node }),
      cancel() {},
      departure: node => ({ node }),
      enter() { assert.equal(dialog.open, true); assert.equal(document.activeElement, close); calls.push('enter'); },
      detail(_, direction) { assert.equal(dialog.open, true); calls.push('detail:' + direction); },
      leave() { assert.equal(dialog.open, false); assert.equal(document.activeElement, heading); calls.push('leave'); },
    } });
  vm.runInContext(controller, context);
  const sheet = context.budgetDetailSheetController(mount);
  return { document, mount, panel, heading, row, detail, evidence, owner, after, dialog, close, title, body,
    other, otherTrigger, calls, sheet, motion: context.BudgetSheetMotion, back: dialog.querySelector('[data-budget-detail-back]') };
}
function openBills(f) { f.sheet.open(f.panel, f.heading, 'Bills'); }
function openBill(f) { f.sheet.open(f.detail, f.row, 'Hydro'); }
function originalEvidence(f) {
  assert.equal(f.detail.parentNode, f.owner);
  assert.equal(f.detail.nextSibling, f.after);
  assert.equal(f.evidence.textContent, 'Fixture publication: $120.00; unconfirmed');
}
{
  const f = fixture(); openBills(f);
  assert.equal(f.panel.parentNode, f.body);
  assert.equal(f.panel.hidden, false);
  assert.equal(f.heading.getAttribute('aria-expanded'), 'true');
  assert.equal(f.back.hidden, true);
  f.body.scrollTop = 240; openBill(f);
  assert.equal(f.dialog.showCount, 1, 'push retains the same native modal');
  assert.equal(f.panel.hidden, true); assert.equal(f.panel.inert, true);
  assert.equal(f.detail.parentNode, f.body);
  assert.equal(f.back.hidden, false);
  assert.equal(f.back.getAttribute('aria-label'), 'Go back');
  f.back.emit('click');
  originalEvidence(f);
  assert.equal(f.panel.parentNode, f.body); assert.equal(f.panel.hidden, false); assert.equal(f.panel.inert, false);
  assert.equal(f.body.scrollTop, 240);
  assert.equal(f.document.activeElement, f.row);
  assert.equal(f.row.getAttribute('aria-expanded'), 'false');
  assert.equal(f.title.textContent, 'Bills');
  assert.equal(f.dialog.open, true); assert.equal(f.dialog.closeCount, undefined);
  assert.deepEqual(f.calls, ['enter', 'detail:1', 'detail:-1']);
  f.close.emit('click');
  assert.equal(f.panel.hidden, true);
  assert.equal(f.panel.parentNode, f.heading.parentNode);
  assert.equal(f.heading.getAttribute('aria-expanded'), 'false');
  assert.equal(f.document.activeElement, f.heading);
  assert.equal(f.close.getAttribute('aria-label'), 'Close details');
  assert.equal(f.dialog.closeCount, 1);
}
for (const action of ['close', 'escape', 'backdrop']) {
  const f = fixture(); openBills(f); openBill(f);
  if (action === 'close') f.close.emit('click');
  if (action === 'escape') assert.equal(f.dialog.emit('cancel').defaultPrevented, true);
  if (action === 'backdrop') f.dialog.emit('click', { clientX: 2, clientY: 2 });
  originalEvidence(f);
  assert.equal(f.panel.parentNode, f.heading.parentNode);
  assert.equal(f.panel.hidden, true); assert.equal(f.panel.inert, false);
  assert.equal(f.document.activeElement, f.heading);
  assert.equal(f.dialog.open, false); assert.equal(f.dialog.closeCount, 1);
  assert.equal(f.document.body.classList.contains('budget-detail-open'), false);
  assert.equal(f.calls.at(-1), 'leave', 'exit decoration starts after native close/focus restoration');
}
{
  const f = fixture(); openBills(f); openBill(f);
  f.sheet.open(f.other, f.otherTrigger, 'Choose period');
  originalEvidence(f);
  assert.equal(f.panel.hidden, true);
  assert.equal(f.back.hidden, true, 'unrelated incumbent opens still replace rather than nest');
  assert.equal(f.other.parentNode, f.body);
  f.otherTrigger.setAttribute('aria-expanded', 'true'); // A skin can finish after native remount restore.
  f.sheet.close(false);
  assert.equal(f.otherTrigger.getAttribute('aria-expanded'), 'false');
  assert.equal(f.other.parentNode, f.owner); assert.equal(f.other.hidden, true);
}
{
  const first = fixture(); openBills(first); openBill(first);
  const state = first.sheet.snapshot();
  assert.equal(state.frames.length, 2);
  assert.ok(!JSON.stringify(state).includes('$120'), 'snapshot stores identities, never financial content');
  first.sheet.close(false); originalEvidence(first);
  const fresh = fixture();
  assert.equal(fresh.sheet.restore(state), true);
  assert.equal(fresh.back.hidden, false);
  assert.equal(fresh.detail.parentNode, fresh.body);
  assert.deepEqual(fresh.calls, [], 'remount restore does not replay entry/detail animation');
  fresh.sheet.back(); assert.equal(fresh.document.activeElement, fresh.row);
  fresh.sheet.close(false); originalEvidence(fresh);
  const missing = fixture(); missing.panel.removeAttribute('data-blend-bills-panel');
  assert.equal(missing.sheet.restore(state), false, 'missing parent must not restore a stranded detail');
  assert.equal(missing.dialog.open, false); originalEvidence(missing);
}
{
  const addIncome = f => {
    const node = f.document.createElement('button');
    node.classList.add('blend-income'); f.mount.appendChild(node); return node;
  };
  const first = fixture(), income = addIncome(first);
  first.motion.leave = () => {
    assert.equal(first.dialog.open, false);
    assert.equal(first.document.activeElement, income, 'native close immediately returns to the visible proxy');
  };
  first.otherTrigger.hidden = true;
  first.motion.from(income, () => first.sheet.open(first.other, first.otherTrigger, 'Income'));
  assert.equal(income.getAttribute('aria-expanded'), 'true');
  assert.equal(income.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(first.other.parentNode, first.body, 'proxy does not replace the original evidence');
  const state = first.sheet.snapshot();
  assert.equal(state.triggerSelector, '[data-budget-window-choose]');
  assert.equal(state.openerSelector, '.blend-income');
  first.sheet.close();
  assert.equal(income.getAttribute('aria-expanded'), 'false');
  const fresh = fixture();
  assert.equal(fresh.sheet.restore(state), true, 'native identity can restore before blend creates the proxy');
  fresh.otherTrigger.hidden = true;
  const nextIncome = addIncome(fresh);
  fresh.motion.leave = () => {};
  fresh.sheet.close();
  assert.equal(fresh.document.activeElement, nextIncome, 'close resolves the visible proxy created after remount');
  assert.equal(nextIncome.getAttribute('aria-expanded'), 'false');
}
console.log('PASS native Budget drawer: original-node ownership, nested Back, full dismissal, focus, immutable evidence and remount identity chain');
