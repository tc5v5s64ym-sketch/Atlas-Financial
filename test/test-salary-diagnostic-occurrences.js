'use strict';
// Independently invented ledgers and explicit nominal occurrences. No live
// receipt, user-period income selection or production credential input.
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
function incumbent(value) {
  if (Array.isArray(value)) return value.map(incumbent);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'salaryMatcherDiagnostic')
    .map(([key, item]) => [key, incumbent(item)])
    .filter(([key, item]) => key !== 'observationReceipt' || Object.keys(item || {}).length));
}
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
  eq(diagnostic.scope, 'latest-covered-occurrence', 'explicit observer coverage scope, independent of user pay period');
  ok(!/\d{4}-\d{2}-\d{2}|2197|invented-|amandaSalary|providerTransactionId|payee/.test(JSON.stringify(diagnostic)),
    'no dates, identity, amounts, aliases or records in published diagnostic');
  const serve = result => {
    try { return Live.overlayLiveState({ data: x.data, report: result }).data; }
    catch (error) { return Live.failedOverlay(x.data, error.message, { report: result }); }
  };
  const data = serve(report), before = serve(disabled);
  eq(incumbent(data), incumbent(before), 'entire live publication conserved');
  const advice = value => F.recommend(value.plan, value.meta.asOf, { debts: value.debts, ...value.liveOverlay });
  eq(incumbent(advice(data)), incumbent(advice(before)), 'entire Forecast output conserved');
  const packet = value => Assistant.buildPacket({ data: value, periods: null, questionsMarkdown: '',
    env: {}, now: 'invented-fixed-clock' });
  eq(incumbent(packet(data)), incumbent(packet(before)), 'entire incumbent Assistant output conserved');
  eq(data.liveOverlay.observationReceipt.salaryMatcherDiagnostic, diagnostic, 'actual browser receipt projection');
  eq(packet(data)
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
    const latest = result.diagnostic.slots[slot.index];
    eq(latest.target, 'selected', 'latest native occurrence selected in full multi-month coverage');
    eq(latest.outcome, current === 'matched' ? 'matched' : current === 'ambiguous' ? 'ambiguous' : 'unmatched');
    // Narrowing ONLY the proven coverage, without selecting by receipt outcome,
    // leaves one current occurrence. Older rows remain in the synthetic payload
    // to prove they cannot lend a match, ambiguity or rejection to this target.
    x.payload.transactionWindow.startDate = slot.selectedStart;
    const selected = observe(x).diagnostic.slots[slot.index];
    eq(selected, latest, 'diagnostic target is unchanged when older coverage is removed');
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
  for (const row of observe(broad).diagnostic.slots) {
    eq(row.target, 'selected', 'latest native occurrence selected even across several months');
    eq(row.outcome, 'unmatched', 'older success does not replace an absent latest receipt');
  }
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

// Reproduce the normal August 6–October 6 runtime request with entirely
// invented financial rows. A carried once cash obligation extends the native
// history helper to 61 days; no shortened window or explicit target is injected.
function normalInput(mode = 'matched') {
  const x = input(slots[1], 'matched', 'matched'), asOf = '2026-10-06';
  x.data.meta.asOf = x.data.plan.opening.asOf = asOf;
  x.payload.fetchedAt = asOf + 'T18:00:00Z';
  x.payload.accounts.forEach(row => { row.balance_as_of = asOf; row.updated_at = asOf + 'T17:00:00Z'; });
  x.data.plan.income.filter(row => row.id.startsWith('amandaSalary')).forEach(row => { row.firstDue = '2026-08-19'; });
  x.data.plan.income.find(row => row.id === 'payroll').anchor = '2026-09-25';
  x.data.plan.obligations.push({ id: 'invented-carried-cash', label: 'Invented carried fixture',
    frequency: 'once', date: '2026-08-06', amount: 68.12 });
  const days = Live.livePostedHistoryDays(x.data, x.payload.fetchedAt, { rules: x.identityRules });
  eq(days, 61, 'incumbent runtime extends normal history to 61 days');
  const range = O.lunchMoneyTransactionsUrl(x.payload.fetchedAt, days);
  eq({ start: range.startDate, end: range.endDate }, { start: '2026-08-06', end: asOf }, 'actual runtime window shape');
  x.payload.transactionWindow = { startDate: range.startDate, endDate: range.endDate, complete: true };
  x.payload.transactions = x.payload.transactions.filter(row => row.id.startsWith('invented-'));
  const source = x.payload.transactions.find(row => row.id === 'invented-source-1');
  const credit = x.payload.transactions.find(row => row.id === 'invented-credit-1');
  const debit = x.payload.transactions.find(row => row.id === 'invented-debit-1');
  for (const row of x.payload.transactions) row.date = row.id.endsWith('-0')
    ? row.id.includes('source') ? '2026-08-30' : '2026-09-01'
    : row.id.includes('source') ? '2026-09-29' : '2026-10-01';
  // Give the earlier accepted packet its own explicit external account so
  // latest-source map failures cannot remove that older native success.
  x.accountMap.mappings.push({ providerAccountId: 'invented-older-salary',
    atlasRole: 'household-external', externalId: 'tennis-income' });
  x.payload.transactions.filter(row => row.id.endsWith('-0') && !row.id.includes('credit'))
    .forEach(row => { row.account_id = 'invented-older-salary'; });
  x.payload.transactions.push(
    { ...source, id: 'invented-mid-source', date: '2026-09-14', amount: -927.13 },
    { ...credit, id: 'invented-mid-credit', date: '2026-09-16', amount: -927.13 },
    { ...debit, id: 'invented-mid-debit', date: '2026-09-16', amount: 927.13 });
  const mapping = x.accountMap.mappings.find(row => row.providerAccountId === source.account_id);
  if (mode === 'wrong-role') mapping.atlasRole = 'household-reserve';
  if (mode === 'wrong-identity') mapping.externalId = 'invented-wrong-private-identity';
  if (mode === 'missing-external-identity') delete mapping.externalId;
  if (mode === 'missing-rule-identity') x.identityRules.filter(row => row.eventId.startsWith('amandaSalary'))
    .forEach(row => { delete row.counterpartExternalId; });
  if (mode === 'wrong-alias') source.payee = 'INVENTED COACHING RECEIPT';
  if (mode === 'missing-counterpart') x.payload.transactions.splice(x.payload.transactions.indexOf(debit), 1);
  if (mode === 'duplicate-counterpart') x.payload.transactions.push({ ...debit, id: 'invented-second-latest-debit' });
  if (mode === 'duplicate-receipt') x.payload.transactions.push({ ...source, id: 'invented-second-latest-source' });
  if (mode === 'duplicate-credit') x.payload.transactions.push({ ...credit, id: 'invented-second-latest-credit' });
  if (mode === 'refund-counterpart') debit.category_name = 'Refund';
  if (mode === 'missing-receipt') x.payload.transactions.splice(x.payload.transactions.indexOf(source), 1);
  if (mode === 'unmapped-source') source.account_id = 'invented-unmapped-latest-source';
  if (mode === 'wrong-source-account') {
    source.account_id = 'invented-other-latest-source';
    x.accountMap.mappings.push({ providerAccountId: source.account_id, atlasRole: 'household-external', externalId: 'tennis-income' });
  }
  for (const [tag, row] of Object.entries({ source, credit, debit })) {
    if (mode === 'pending-' + tag) row.is_pending = true;
    if (mode === 'foreign-' + tag) row.currency = 'usd';
  }
  return x;
}
const normalModes = ['matched', 'wrong-role', 'wrong-identity', 'missing-external-identity', 'missing-rule-identity',
  'wrong-alias', 'missing-counterpart', 'duplicate-counterpart', 'duplicate-receipt', 'duplicate-credit',
  'refund-counterpart', 'missing-receipt', 'unmapped-source', 'wrong-source-account',
  ...['source', 'credit', 'debit'].flatMap(tag => ['pending-' + tag, 'foreign-' + tag])];
const expectedReason = { 'wrong-role': 'SOURCE_ROLE_MISMATCH', 'wrong-identity': 'EXTERNAL_ID_MISMATCH',
  'missing-external-identity': 'EXTERNAL_ID_MISMATCH', 'missing-rule-identity': 'EXTERNAL_ID_MISSING',
  'wrong-alias': 'PAYROLL_ALIAS_MISMATCH', 'missing-counterpart': 'COUNTERPART_MISSING',
  'duplicate-counterpart': 'COUNTERPART_AMBIGUOUS', 'duplicate-receipt': 'RECEIPT_AMBIGUOUS',
  'duplicate-credit': 'REPRESENTATION_AMBIGUOUS', 'refund-counterpart': 'COUNTERPART_MISSING',
  'wrong-source-account': 'SOURCE_ACCOUNT_MISMATCH' };
for (const mode of normalModes) {
  const x = normalInput(mode), { report, diagnostic } = observe(x), end = diagnostic.slots[1];
  eq(F.expandEvents(x.data.plan, '2026-08-06', '2026-10-06', {})
    .filter(event => event.id.startsWith('amandaSalary')).map(({ id, date }) => ({ id, date })), [
    { id: 'amandaSalaryMonthEnd', date: '2026-08-31' }, { id: 'amandaSalary15', date: '2026-09-15' },
    { id: 'amandaSalaryMonthEnd', date: '2026-09-30' }], 'normal native multi-month salary occurrences');
  eq(end.target, 'selected', mode + ': latest month-end selected without narrowing runtime coverage');
  eq(end.outcome, mode === 'matched' ? 'matched' : mode === 'duplicate-credit' ? 'ambiguous'
    : mode === 'missing-rule-identity' ? 'not-evaluated' : 'unmatched', mode + ': latest native outcome');
  if (expectedReason[mode]) ok(end.reasons.includes(expectedReason[mode]), mode + ': genuine selected occurrence failure visible');
  if (mode.startsWith('pending-') || mode.startsWith('foreign-')) ok(end.gates.nativePostedCad.rejected, mode + ': own qualification failure visible');
  if (mode !== 'missing-rule-identity') ok(report.representedEventCandidates.some(row =>
    row.id === 'amandaSalaryMonthEnd' && row.date === '2026-08-31'), mode + ': older accepted income remains represented');
  if (['missing-receipt', 'unmapped-source'].includes(mode)) {
    eq(end.reasons, [], 'missing candidate association stays unconfirmed, never inferred from older success');
    eq(end.gates.payrollAlias.evaluated, false, 'older source cannot lend payroll-alias evidence');
  }
  ok(!/2026-|2197|927|invented-|amandaSalary|tennis-income/.test(JSON.stringify(diagnostic)), 'normal-window output exposes no private date/map/amount');
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
const duplicate = D.create({ startDate: '2026-06-25', endDate: '2026-08-02',
  occurrences: [{ kind: 'income', id, date }, { kind: 'income', id, date }] });
unevaluated(duplicate.finish({ unique: [{ id, date }], ambiguous: [] }).slots[1], 'ambiguous');
const context = { startDate: '2026-06-25', endDate: '2026-08-02', occurrences: [
  { kind: 'income', id, date: other }, { kind: 'income', id, date },
  { kind: 'income', id, date: '2026-08-31' }] };
const latestCollector = D.create(context);
eq(latestCollector.forOccurrence(id, other), undefined, 'earlier native occurrence cannot write gates');
eq(latestCollector.forOccurrence(id, '2026-08-31'), undefined, 'future occurrence outside covered end cannot be selected');
ok(latestCollector.forOccurrence(id, date), 'latest covered date receives ID-bound recorder');
context.occurrences.reverse();
ok(D.create(context).forOccurrence(id, date), 'selection independent of native occurrence row order');
for (const mutate of [
  x => { x.startDate = 'malformed'; }, x => { x.endDate = '2026-02-30'; },
  x => { x.startDate = '2026-09-01'; }, x => { x.occurrences[0].date = 'malformed'; },
]) { const x = clone(context); mutate(x); unevaluated(D.create(x).finish({ unique: [], ambiguous: [] }).slots[1], 'unavailable'); }
const olderDuplicate = clone(context); olderDuplicate.occurrences.push({ kind: 'income', id, date: other });
ok(D.create(olderDuplicate).forOccurrence(id, date), 'older duplicate does not replace unique latest target');
const valid = finish({ unique: [{ id, date }], ambiguous: [] });
for (const mutate of [
  packet => { packet.scope = 'single-covered-occurrence'; }, packet => { packet.schema = 'atlas-salary-matcher-diagnostic/v1'; },
  packet => { packet.slots[1].target = 'verified'; },
  packet => { packet.slots[1].target = 'ambiguous'; }, packet => { packet.slots[1].date = date; },
]) {
  const packet = { schema: D.SCHEMA, scope: D.SCOPE,
    slots: [finish({ unique: [], ambiguous: [] }), clone(valid)] };
  packet.slots[0] = O.observe(fx.input()).observationReceipt.salaryMatcherDiagnostic.slots[0];
  mutate(packet); eq(D.project(packet), undefined, 'scope, target and private date fail closed');
}
console.log('PASS salary occurrence scope: ' + cases + ' independent observations / ' + checks
  + ' assertions; both slots, six mixed-cycle counterexamples, normal 61-day runtime window and 20 independent controls,'
  + ' absent/future/stale/undated/malformed coverage, latest duplicate ambiguity,'
  + ' ID+date resolution, scoped gates, private dates and exact financial conservation');
