'use strict';
// Exercise the shipped DOM decorator with invented already-printed strings.
// This checks text preservation and sign grouping, never financial arithmetic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/budget-blend.js'), 'utf8');
const fn = source.slice(source.indexOf('  function splitPrintedCents('),
  source.indexOf('  function selectedPeriodIsCurrent('));
assert.ok(fn.startsWith('  function splitPrintedCents('), 'shipped decorator is present');

function decorate(printed, unavailable = false) {
  let children;
  const document = {
    createElement(tag) { return { tag, className: '', textContent: '' }; },
    createTextNode(textContent) { return { textContent }; },
    createDocumentFragment() { return { children: [], appendChild(x) { this.children.push(x); },
      append(...xs) { this.children.push(...xs); } }; },
    createTreeWalker() { let pending = true; return { nextNode() {
      if (!pending) return null;
      pending = false;
      return { textContent: printed, parentElement: { closest() { return null; } },
        replaceWith(fragment) { children = fragment.children; } };
    } }; },
  };
  const value = { classList: { contains(name) { return unavailable && name === 'is-unavailable'; } },
    querySelector() { return null; } };
  vm.runInNewContext(fn + '\nsplitPrintedCents(value);', { document, value, NodeFilter: { SHOW_TEXT: 4 } });
  return children;
}

for (const [printed, dollars, prefix = ''] of [
  ['−$3,152.99', '−$3,152'], ['-$3,152.99', '-$3,152'],
  ['$1,847.01', '$1,847'], ['$0.00', '$0'], ['−$0.01', '−$0'],
  ['−$123,456.78', '−$123,456'],
  ['≈ estimated −$42.50', '−$42', '≈ estimated '],
  ['Result: -$42.50', '-$42', 'Result: '],
]) {
  const children = decorate(printed);
  assert.equal(children.map(x => x.textContent).join(''), printed, 'printed text stays byte-for-byte equal');
  assert.equal(children.find(x => x.className === 'blend-dollars')?.textContent, dollars,
    'sign stays in the same full-size, nonwrapping dollar span: ' + printed);
  assert.equal(children.find(x => x.className === 'blend-term-prefix')?.textContent || '', prefix,
    'only the qualifier is styled as a prefix');
  assert.equal(children.find(x => x.className === 'blend-cents')?.textContent, printed.slice(-3));
}
assert.equal(decorate('Unavailable', true), undefined, 'unavailable values are untouched');
assert.equal(decorate('—'), undefined, 'unknown glyph is untouched');
console.log('PASS Budget signed cents: both minus glyphs stay with dollars; positive, zero, qualifiers and unavailable text are preserved');
