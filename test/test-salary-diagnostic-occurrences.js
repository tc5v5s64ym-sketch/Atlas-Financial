'use strict';
// Independently invented ledgers and explicit nominal occurrences. No live
// receipt, current-income selection heuristic or production credential input.
const assert = require('node:assert/strict'), cp = require('node:child_process');
const path = require('node:path'), Module = require('node:module');
const O = require('../scripts/provider-observe'), D = require('../scripts/salary-match-diagnostic');
const F = require('../public/forecast'), Live = require('../scripts/live-plan');
const Assistant = require('../scripts/assistant-packet'), fx = require('./fixtures/salary-diagnostic-data');
const ROOT = path.resolve(__dirname, '..'), BASE = '6d1e151c8f2d124b544496d7b882953ea1dc7520';
const historical = cp.spawnSync('git', ['-c', 'safe.directory=' + ROOT.replace(/\\/g, '/'),
  'show', BASE + ':scripts/provider-observe.js'], { cwd: ROOT, encoding: 'utf8' });
let old;
if (historical.status === 0) {
  const filename = path.join(ROOT, 'scripts/provider-observe.js'), module = new Module(filename);
  module.filename = filename; module.paths = Module._nodeModulePaths(path.dirname(filename));
  module._compile(historical.stdout, filename); old = module.exports;
}
const clone = x => JSON.parse(JSON.stringify(x));
let checks = 0, cases = 0;
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const ok = (value, label) => { assert.ok(value, label); checks++; };
const controls = [
  ['matched', 'missing'], ['ambiguous', 'missing'], ['ambiguous', 'matched'],
  ['matched', 'rejected-alias'], ['missing', 'matched'], ['matched', 'ambiguous'],
];
const slots = [
  { id: 'amandaSalary15', index: 0, asOf: '2026-07-20', start: '2026-06-01',
    dates: ['2026-06-15', '2026-07-15'], sources: ['2026-06-14', '2026-07-14'],
    credits: ['2026-06-16', '2026-07-16'], selectedStart: '2026-07-01' },
  { id: 'amandaSalaryMonthEnd', index: 1, asOf: '2026-08-02', start: '2026-06-25',
    dates: ['2026-06-30', '2026-07-31'], sources: ['2026-06-29', '2026-07-30'],
    credits: ['2026-07-01', '2026-08-01'], selectedStart: '2026-07-02' },
];
function input(slot, prior, current) {
  const x = fx.input(), rows = x.payload.transactions;
  const salary = rows.find(row => row.id === 'salary'), credit = rows.find(row => row.id === 'credit');
  const debit = rows.find(row => row.id === 'debit');
  x.data.meta.asOf = x.data.plan.opening.asOf = slot.asOf;
  x.payload.fetchedAt = slot.asOf + 'T18:00:00Z';
  x.payload.accounts.forEach(row => { row.balance_as_of = slot.asOf; row.updated_at = slot.asOf + 'T17:00:00Z'; });
  x.payload.transactionWindow = { startDate: slot.start, endDate: slot.asOf, complete: true };
  x.payload.transactions = rows.filter(row => !['salary', 'credit', 'debit'].includes(row.id));
  for (const [index, state] of [prior, current].entries()) {
    if (state === 'missing') continue;
    x.payload.transactions.push(
      { ...salary, id: 'invented-source-' + index, date: slot.sources[index], amount: -2197.31,
        ...(state === 'rejected-alias' ? { payee: 'INVENTED OTHER EMPLOYER' } : {}) },
      { ...credit, id: 'invented-credit-' + index, date: slot.credits[index], amount: -2197.31 },
      { ...debit, id: 'invented-debit-' + index, date: slot.credits[index], amount: 2197.31 });
    if (state === 'ambiguous') x.payload.transactions.push({ ...credit,
      id: 'invented-second-credit-' + index, date: slot.credits[index], amount: -2197.31 });
  }
  return x;
}
function observe(x) {
  cases++;
  const untouched = JSON.stringify(x), report = O.observe(x), conserved = clone(report);
  delete conserved.observationReceipt.salaryMatcherDiagnostic;
  const disabled = O.observe({ ...clone(x), salaryDiagnostic: false });
  eq(conserved, disabled, 'diagnostic never changes incumbent financial fields');
  if (old) eq(conserved, old.observe(clone(x)), 'immutable current-main observer conservation');
  eq(JSON.stringify(x), untouched, 'ledger and schedule inputs immutable');
  const diagnostic = report.observationReceipt.salaryMatcherDiagnostic;
  eq(D.project(diagnostic), diagnostic, 'closed scope/target projection round trip');
  eq(diagnostic.scope, 'single-covered-occurrence', 'explicit bounded scope, never a latest/current claim');
  ok(!/\d{4}-\d{2}-\d{2}|2197|invented-|amandaSalary|providerTransactionId|payee/.test(JSON.stringify(diagnostic)),
    'no dates, identity, amounts, aliases or records in published diagnostic');
  let data;
  try { data = Live.overlayLiveState({ data: x.data, report }).data; }
  catch (error) { data = Live.failedOverlay(x.data, error.message, { report }); }
  eq(data.liveOverlay.observationReceipt.salaryMatcherDiagnostic, diagnostic, 'actual browser receipt projection');
  eq(Assistant.buildPacket({ data, periods: null, questionsMarkdown: '', env: {} })
    .metadata.observationReceipt.salaryMatcherDiagnostic, diagnostic, 'actual Assistant readback scope');
  return { report, diagnostic };
}
function unevaluated(row, target) {
  eq(row.target, target, 'explicit target status');
  eq(row.outcome, 'not-evaluated', 'no guessed occurrence outcome');
  eq(row.reasons, [], 'no older or unrelated rejection reason borrowed');
  ok(Object.values(row.gates).every(flags => !flags.evaluated && !flags.passed && !flags.rejected),
    'all target gates remain unevaluated');
}
for (const slot of slots) {
  for (const [prior, current] of controls) {
    const x = input(slot, prior, current), result = observe(x);
    eq(F.expandEvents(x.data.plan, slot.start, slot.asOf, {})
      .filter(event => event.id === slot.id).map(event => event.date), slot.dates, 'two native scheduled occurrences');
    unevaluated(result.diagnostic.slots[slot.index], 'ambiguous');
    // Narrowing ONLY the proven coverage, without selecting by receipt outcome,
    // leaves one current occurrence. Older rows remain in the synthetic payload
    // to prove they cannot lend a match, ambiguity or rejection to this target.
    x.payload.transactionWindow.startDate = slot.selectedStart;
    const selected = observe(x).diagnostic.slots[slot.index];
    eq(selected.target, 'selected');
    eq(selected.outcome, current === 'matched' ? 'matched' : current === 'ambiguous' ? 'ambiguous' : 'unmatched');
    if (current === 'rejected-alias') ok(selected.reasons.includes('PAYROLL_ALIAS_MISMATCH'));
    if (prior === 'ambiguous' && current !== 'ambiguous') {
      ok(!selected.reasons.includes('REPRESENTATION_AMBIGUOUS'), 'old ambiguity excluded');
      ok(!selected.reasons.includes('COUNTERPART_AMBIGUOUS'), 'old counterpart gates excluded');
    }
    if (current === 'missing') {
      eq(selected.gates.payrollAlias.evaluated, false, 'old payroll source never diagnoses current alias');
      eq(selected.gates.counterpart.evaluated, false, 'old transfer never diagnoses current counterpart');
    }
  }
  const broad = input(slot, 'matched', 'missing'); broad.payload.transactionWindow.startDate = '2026-04-01';
  for (const row of observe(broad).diagnostic.slots) unevaluated(row, 'ambiguous');
  const none = input(slot, 'missing', 'missing'); none.payload.transactionWindow.startDate = none.payload.transactionWindow.endDate;
  for (const row of observe(none).diagnostic.slots) unevaluated(row, 'none');
  const incomplete = input(slot, 'matched', 'missing'); incomplete.payload.transactionWindow.complete = false;
  for (const row of observe(incomplete).diagnostic.slots) unevaluated(row, 'unavailable');
  const future = input(slot, 'missing', 'matched'); future.payload.transactionWindow.endDate = '2026-09-30';
  for (const row of observe(future).diagnostic.slots) unevaluated(row, 'unavailable');
  const stale = input(slot, 'matched', 'missing'); stale.payload.transactionWindow.endDate = slot.credits[0];
  for (const row of observe(stale).diagnostic.slots) unevaluated(row, 'unavailable');
  const undated = input(slot, 'matched', 'missing');
  undated.payload.accounts.forEach(row => { delete row.balance; delete row.balance_as_of; delete row.updated_at; });
  for (const row of observe(undated).diagnostic.slots) unevaluated(row, 'unavailable');
}

// Direct independent group controls isolate the ID+date predicate, including
// cross-ID transaction-consumed-twice groups with null group.id/group.date.
const id = slots[1].id, date = slots[1].dates[1], other = slots[1].dates[0];
function finish(groups) {
  const collector = D.create({ startDate: '2026-07-02', endDate: '2026-08-02',
    occurrences: [{ kind: 'income', id, date }] });
  collector.rule(id); collector.record(id, 'rule', true); collector.rulesScanned(); collector.resolve();
  return collector.finish(groups).slots[1];
}
eq(finish({ unique: [{ id, date: other }], ambiguous: [] }).outcome, 'unmatched', 'old accepted hit cannot settle target');
eq(finish({ unique: [{ id, date }], ambiguous: [{ id, date: other }] }).outcome, 'matched', 'old ambiguous group cannot mask target');
eq(finish({ unique: [], ambiguous: [{ id: null, date: null, hits: [{ id, date: other }] }] }).outcome,
  'unmatched', 'old cross-ID ambiguity cannot contaminate target');
eq(finish({ unique: [], ambiguous: [{ id: null, date: null, hits: [{ id, date }] }] }).outcome,
  'ambiguous', 'exact target cross-ID ambiguity retained');
const duplicate = D.create({ occurrences: [{ kind: 'income', id, date }, { kind: 'income', id, date }] });
unevaluated(duplicate.finish({ unique: [{ id, date }], ambiguous: [] }).slots[1], 'ambiguous');
const valid = finish({ unique: [{ id, date }], ambiguous: [] });
for (const mutate of [
  packet => { packet.scope = 'latest-salary'; }, packet => { packet.slots[1].target = 'verified'; },
  packet => { packet.slots[1].target = 'ambiguous'; }, packet => { packet.slots[1].date = date; },
]) {
  const packet = { schema: D.SCHEMA, scope: D.SCOPE,
    slots: [finish({ unique: [], ambiguous: [] }), clone(valid)] };
  packet.slots[0] = O.observe(fx.input()).observationReceipt.salaryMatcherDiagnostic.slots[0];
  mutate(packet); eq(D.project(packet), undefined, 'scope, target and private date fail closed');
}
console.log('PASS salary occurrence scope: ' + cases + ' independent observations / ' + checks
  + ' assertions; both slots, six mixed-cycle counterexamples, multi-month/absent/future/stale/undated coverage,'
  + ' ID+date resolution, scoped gates, private dates and exact financial conservation');
