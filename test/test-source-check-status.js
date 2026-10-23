'use strict';
// Run the actual shared boot, not a duplicate of its status formatter.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { cases, dataFor } = require('./fixtures/source-check-status');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
async function boot(testCase) {
  const elements = [], input = dataFor(testCase), before = JSON.stringify(input);
  class Element {
    constructor() { this.children = []; this.attributes = {}; elements.push(this); }
    set textContent(value) { this.text = value; this.children = []; }
    get textContent() { return this.text || ''; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    querySelectorAll() { return []; }
    prepend(child) { this.children.unshift(child); child.parent = this; }
    append(...children) { for (const child of children) { this.children.push(child); child.parent = this; } }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    addEventListener() {}
  }
  const wrap = new Element(), head = new Element();
  const document = { body: new Element(), documentElement: new Element(), getElementById: () => null,
    querySelectorAll: () => [], createElement: () => new Element(),
    querySelector: selector => selector === '.wrap' ? wrap : selector === '.site-head-inner' ? head : null };
  const context = { document, console, AbortController, Intl, addEventListener() {}, location: { href: '' },
    // No pending operation. Other storage retains the old unavailable behavior.
    localStorage: { getItem(key) { if (key === 'atlas-settlement-pending-v1') return null; throw Error('synthetic non-marker storage unavailable'); },
      setItem() { throw Error('storage write forbidden'); }, removeItem() { throw Error('storage removal forbidden'); } },
    matchMedia: () => ({ addEventListener() {} }), setTimeout, clearTimeout,
    fetch: async () => ({ status: 200, ok: true, headers: { get: name => testCase.headers[name] || null }, json: async () => input }) };
  vm.createContext(context); vm.runInContext(source + '\nglobalThis.app = App;', context);
  let renders = 0; context.app.register(() => renders++); context.app.boot(); await flush(); await flush();
  assert.equal(renders, 1, testCase.name + ': admitted response still renders');
  assert.equal(JSON.stringify(input), before, testCase.name + ': status cannot change data, dates, amounts or trust');
  return elements.find(element => Object.hasOwn(element.attributes, 'data-observation-check')).textContent;
}
(async () => {
  for (const testCase of [...cases, { name: 'malformed-state', headers: {},
    trust: { displayState: 'constructor', exactFiguresAvailable: true },
    includes: ['Provider check details unavailable.', 'Financial coverage details unavailable.'] }]) {
    const text = await boot(testCase);
    for (const expected of testCase.includes) assert.ok(text.includes(expected), testCase.name + ': expected ' + expected + '; got ' + text);
    assert.ok(!text.includes('Provider check unavailable'), testCase.name + ': qualification is not provider failure');
  }
  console.log('PASS source-check status: eight actual shared-boot response/trust cases; source status stays separate from financial coverage and data is unchanged');
})().catch(error => { console.error(error); process.exitCode = 1; });
