'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const cp = require('node:child_process'), Module = require('node:module');
const { isDeepStrictEqual } = require('node:util');
const O = require('../scripts/provider-observe'), D = require('../scripts/salary-match-diagnostic');
const Live = require('../scripts/live-plan'), Assistant = require('../scripts/assistant-packet');
const F = require('../public/forecast'), fx = require('./fixtures/salary-diagnostic-data');
const ROOT = path.resolve(__dirname, '..'), BASE = '6d1e151c8f2d124b544496d7b882953ea1dc7520';
const filename = path.join(ROOT, 'scripts/provider-observe.js');
// Local review compares the immutable base too. Shallow CI has no historical
// object: the always-on disabled comparison and independent receipt fixtures
// still run; never require network access or mutate the checkout for a test.
const historical = cp.spawnSync('git', ['-c', 'safe.directory=' + ROOT.replace(/\\/g, '/'),
  'show', BASE + ':scripts/provider-observe.js'], { cwd: ROOT, encoding: 'utf8' });
let old;
if (historical.status === 0) {
  const prior = new Module(filename); prior.filename = filename;
  prior.paths = Module._nodeModulePaths(path.dirname(filename));
  prior._compile(historical.stdout, filename); old = prior.exports;
}
const clone = x => JSON.parse(JSON.stringify(x));
let checks = 0;
const eq = (a, b, label) => { assert.ok(isDeepStrictEqual(a, b), label); checks++; };
const ok = (x, label) => { assert.ok(x, label); checks++; };
function incumbent(x) {
  if (Array.isArray(x)) return x.map(incumbent);
  if (!x || typeof x !== 'object') return x;
  return Object.fromEntries(Object.entries(x).filter(([k]) => !['salaryMatcherDiagnostic', 'observationReceipt'].includes(k))
    .map(([k, v]) => [k, incumbent(v)]));
}
// Preserve every pre-existing receipt field too; only remove its new leaf.
function reportWithoutDiagnostic(report) {
  const copy = clone(report); delete copy.observationReceipt.salaryMatcherDiagnostic; return copy;
}
function served(report, data) {
  try { return Live.overlayLiveState({ report, data }).data; }
  catch (err) { return Live.failedOverlay(data, err.message, { report }); }
}
const modes = ['matched', 'missing-identity', 'empty-identity', 'wrong-identity', 'wrong-role',
  'ineligible-rule', 'missing-rule', 'renamed', 'missing-receipt', 'wrong-alias', 'wrong-amount',
  'not-income', 'late-receipt', 'missing-counterpart', 'duplicate-counterpart', 'duplicate-receipt',
  'final-ambiguity', 'wrong-source-account', 'multiple-occurrences', 'no-occurrence',
  'incomplete-window', 'malformed-window', 'missing-window',
  ...['credit', 'debit', 'salary'].flatMap(id => ['pending-' + id, 'foreign-' + id, 'malformed-' + id])];
let matched;
for (const mode of modes) {
  const x = fx.input(mode), untouched = JSON.stringify(x);
  const before = old ? old.observe(clone(x)) : O.observe({ ...clone(x), salaryDiagnostic: false });
  const after = O.observe(x), disabled = O.observe({ ...clone(x), salaryDiagnostic: false });
  const packet = after.observationReceipt.salaryMatcherDiagnostic;
  ok(packet && D.project(packet), mode + ': valid bounded diagnostic');
  eq(reportWithoutDiagnostic(after), before, mode + ': entire incumbent observer result conserved');
  eq(reportWithoutDiagnostic(after), disabled, mode + ': enabling diagnostic cannot change observation/identity/actuals');
  eq(JSON.stringify(x), untouched, mode + ': input remains immutable');
  const dataBefore = served(before, x.data), dataAfter = served(after, x.data);
  eq(incumbent(dataAfter), incumbent(dataBefore), mode + ': opening, recognition, exclusions and household publication conserved');
  eq(incumbent(F.recommend(dataAfter.plan, dataAfter.meta.asOf, { debts: dataAfter.debts, ...dataAfter.liveOverlay })),
    incumbent(F.recommend(dataBefore.plan, dataBefore.meta.asOf, { debts: dataBefore.debts, ...dataBefore.liveOverlay })),
    mode + ': full Forecast output unchanged');
  const options = { periods: null, questionsMarkdown: '', now: 'invented-fixed-clock', env: {} };
  const assistant = Assistant.buildPacket({ data: dataAfter, ...options });
  eq(incumbent(assistant), incumbent(Assistant.buildPacket({ data: dataBefore, ...options })), mode + ': incumbent assistant output conserved');
  eq(dataAfter.liveOverlay.observationReceipt.salaryMatcherDiagnostic, packet, mode + ': served existing receipt projection');
  eq(assistant.metadata.observationReceipt.salaryMatcherDiagnostic, packet, mode + ': assistant copies the same receipt');
  eq(O.observationReceipt(after, { accountMap: x.accountMap }).salaryMatcherDiagnostic, packet, mode + ': receipt reconstruction retains diagnostic');
  ok(O.observationReceiptLooksSanitized(after.observationReceipt), mode + ': receipt sanitizer');
  const blob = JSON.stringify(packet);
  for (const sentinel of ['fixture-', 'invented-', 'PRIVATE', '2026-', '1733', 'tennis-income', 'amandaSalary', 'FIXTURE PAYROLL', 'FIXTURE TENNIS EMPLOYER PAY', 'payee', 'providerAccountId'])
    ok(!blob.includes(sentinel), mode + ': forbidden raw sentinel absent');
  const end = packet.slots[1];
  if (mode === 'matched') { matched = packet; eq(end.outcome, 'matched'); ok(end.gates.representation.passed); }
  if (['missing-identity', 'empty-identity'].includes(mode)) {
    eq(end.outcome, 'not-evaluated'); ok(end.reasons.includes('EXTERNAL_ID_MISSING'));
    eq(end.gates.payrollReceipt, { evaluated: false, passed: false, rejected: false });
    ok(!end.reasons.includes('RECEIPT_MISSING'), 'prefilter rejection is not a missing receipt claim');
  }
  if (mode === 'wrong-identity') { ok(end.reasons.includes('EXTERNAL_ID_MISMATCH')); eq(end.gates.payrollReceipt.evaluated, false); }
  if (mode === 'wrong-role') ok(end.reasons.includes('SOURCE_ROLE_MISMATCH'));
  if (mode === 'missing-receipt') ok(end.reasons.includes('RECEIPT_MISSING'));
  if (mode === 'wrong-alias') ok(end.reasons.includes('PAYROLL_ALIAS_MISMATCH'));
  if (mode === 'wrong-amount') ok(end.reasons.includes('AMOUNT_GUARD_MISMATCH'));
  if (mode === 'wrong-source-account') ok(end.reasons.includes('SOURCE_ACCOUNT_MISMATCH'));
  if (mode === 'duplicate-receipt') ok(end.reasons.includes('RECEIPT_AMBIGUOUS'));
  if (mode === 'duplicate-counterpart') ok(end.reasons.includes('COUNTERPART_AMBIGUOUS'));
  if (['multiple-occurrences', 'no-occurrence'].includes(mode)) {
    eq(end.gates.occurrence.evaluated, false, 'an unestablished candidate cannot evaluate a target occurrence');
    ok(!end.reasons.includes('OCCURRENCE_AMBIGUOUS') && !end.reasons.includes('OCCURRENCE_MISSING'),
      'unbound candidate rejection is not attributed to the selected slot');
  }
  if (mode === 'final-ambiguity') { eq(end.outcome, 'ambiguous'); ok(end.reasons.includes('REPRESENTATION_AMBIGUOUS')); ok(!end.gates.representation.passed); }
  if (mode === 'incomplete-window') { eq(end.outcome, 'not-evaluated'); eq(end.gates.rule.evaluated, false); }
  if (mode === 'missing-rule') { eq(end.outcome, 'not-evaluated'); ok(end.reasons.includes('RULE_MISSING')); }
}
for (const mutate of [
  p => { p.secret = 'PRIVATE RAW'; }, p => { p.slots.push(clone(p.slots[0])); },
  p => { p.slots.reverse(); }, p => { p.slots[0].slot = 'private-person'; },
  p => { p.slots[0].outcome = 'verified'; }, p => { p.slots[0].providerAccountId = 'PRIVATE'; },
  p => { p.slots[0].gates.externalIdentity.raw = 'PRIVATE'; },
  p => { p.slots[0].gates.rule.passed = 1; }, p => { p.slots[1].gates.rule.evaluated = false; },
  p => { p.slots[0].reasons = ['PRIVATE']; }, p => { p.slots[0].reasons = ['RULE_MISSING', 'RULE_MISSING']; },
  p => { delete p.slots[0].reasons[0]; p.slots[0].reasons.length = 1; },
  p => { p.slots[0].reasons.raw = 'PRIVATE'; }, p => { p.slots[0].gates.rule = null; },
  p => { p.slots[0].outcome = 'matched'; p.slots[0].gates.representation.evaluated = false; },
  p => { p.slots[0].gates.unknown = { evaluated: true, passed: true, rejected: false }; },
  p => { p[Symbol('private')] = 'PRIVATE'; },
  p => { Object.defineProperty(p.slots[0], 'hidden', { value: 'PRIVATE' }); },
  p => { Object.defineProperty(p.slots[0].gates.rule, 'passed', { get: () => true }); },
  p => { Object.defineProperty(p.slots, '0', { get: () => p.slots[1] }); },
  p => { Object.setPrototypeOf(p.slots[0].gates.rule, { raw: 'PRIVATE' }); },
]) {
  const p = clone(matched); mutate(p); eq(D.project(p), undefined, 'malformed diagnostic fails closed');
  const receipt = { salaryMatcherDiagnostic: p }; eq(O.observationReceiptLooksSanitized(receipt), false);
  const data = fx.input().data; data.liveOverlay = { applied: false, observationReceipt: receipt };
  eq(Assistant.buildPacket({ data, periods: null, questionsMarkdown: '', env: {} }).metadata.observationReceipt,
    undefined, 'malformed diagnostic never reaches assistant');
}
for (const value of [undefined, null, false, 0, '', [], {}, { schema: D.SCHEMA, slots: null }]) eq(D.project(value), undefined);
const cyclic = clone(matched); cyclic.slots[0].reasons.push(cyclic); eq(D.project(cyclic), undefined);
eq(O.observationReceiptLooksSanitized({ salaryMatcherDiagnostic: cyclic }), false, 'cyclic diagnostic does not throw');
for (const mutate of [x => { x.payload = null; }, x => { x.accountMap = null; },
  x => { x.payload.transactions[0].id = null; }, x => { x.identityRules = {}; }]) {
  const x = fx.input(); mutate(x);
  let oldError, newError;
  try { (old || O).observe({ ...clone(x), salaryDiagnostic: false }); } catch (e) { oldError = e.constructor.name; }
  try { O.observe(x); } catch (e) { newError = e.constructor.name; }
  ok(oldError); eq(newError, oldError, 'malformed observer input preserves existing failure behavior');
}
const reordered = fx.input(); reordered.payload.transactions.reverse(); reordered.identityRules.reverse();
eq(O.observe(reordered).observationReceipt.salaryMatcherDiagnostic, matched, 'candidate order does not change diagnostic');
eq(O.observe(fx.input()).observationReceipt.salaryMatcherDiagnostic, matched, 'repeated observation does not accumulate flags');
eq(O.observe(fx.input('renamed')).observationReceipt.salaryMatcherDiagnostic, matched, 'raw account labels do not change diagnostic');
console.log('PASS salary matcher diagnostic: ' + modes.length + ' independent observation cases, ' + checks
  + ' assertions; ' + (old ? 'immutable-base + disabled' : 'disabled (historical object unavailable)')
  + ' conservation, prefilter/final ambiguity, receipt/assistant wiring, strict redaction and malformed inputs');
