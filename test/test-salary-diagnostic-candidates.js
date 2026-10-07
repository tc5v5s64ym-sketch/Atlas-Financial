'use strict';
// Independent invented two-ID/date ledgers. Candidate intent/association is
// never established by assigning each rule its own date or by equal amounts.
const assert = require('node:assert/strict'), cp = require('node:child_process');
const path = require('node:path'), Module = require('node:module');
const O = require('../scripts/provider-observe'), D = require('../scripts/salary-match-diagnostic');
const F = require('../public/forecast'), Live = require('../scripts/live-plan'), Assistant = require('../scripts/assistant-packet');
const fx = require('./fixtures/salary-diagnostic-data');
const minimumCategoryExpectation = require('./fixtures/minimum-category-conservation');
const ROOT = path.resolve(__dirname, '..'), BASE = '6d1e151c8f2d124b544496d7b882953ea1dc7520';
const historical = cp.spawnSync('git', ['-c', 'safe.directory=' + ROOT.replace(/\\/g, '/'),
  'show', BASE + ':scripts/provider-observe.js'], { cwd: ROOT, encoding: 'utf8' });
let old;
if (historical.status === 0) {
  const filename = path.join(ROOT, 'scripts/provider-observe.js'), prior = new Module(filename);
  prior.filename = filename; prior.paths = Module._nodeModulePaths(path.dirname(filename));
  prior._compile(historical.stdout, filename); old = prior.exports;
}
const clone = x => JSON.parse(JSON.stringify(x));
let checks = 0, cases = 0;
const eq = (a, b, why) => { assert.deepEqual(a, b, why); checks++; };
const ok = (value, why) => { assert.ok(value, why); checks++; };
function incumbent(value) {
  if (Array.isArray(value)) return value.map(incumbent);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'salaryMatcherDiagnostic')
    .map(([key, item]) => [key, incumbent(item)])
    .filter(([key, item]) => key !== 'observationReceipt' || Object.keys(item || {}).length));
}
function input() {
  const x = fx.input(), rows = x.payload.transactions;
  const source = rows.find(row => row.id === 'salary'), credit = rows.find(row => row.id === 'credit');
  const debit = rows.find(row => row.id === 'debit'), asOf = '2026-07-31';
  x.data.meta.asOf = x.data.plan.opening.asOf = asOf;
  x.payload.fetchedAt = asOf + 'T18:00:00Z';
  x.payload.accounts.forEach(row => { row.balance_as_of = asOf; row.updated_at = asOf + 'T17:00:00Z'; });
  x.payload.transactionWindow = { startDate: '2026-07-01', endDate: asOf, complete: true };
  x.payload.transactions = [];
  for (const [tag, receipt, transfer, amount] of [
    ['mid', '2026-07-14', '2026-07-16', 927.13], ['end', '2026-07-30', asOf, 1817.23],
  ]) x.payload.transactions.push(
    { ...source, id: tag + '-source', date: receipt, amount: -amount },
    { ...credit, id: tag + '-credit', date: transfer, amount: -amount },
    { ...debit, id: tag + '-debit', date: transfer, amount });
  return x;
}
function observe(x) {
  cases++;
  const unchanged = JSON.stringify(x), report = O.observe(x);
  const disabled = O.observe({ ...clone(x), salaryDiagnostic: false });
  const conserved = clone(report); delete conserved.observationReceipt.salaryMatcherDiagnostic;
  eq(conserved, disabled, 'entire observation conserved with candidate diagnostics enabled');
  if (old) eq(conserved, minimumCategoryExpectation(old.observe(clone(x)), x, old),
    'immutable main financial matcher conservation with exact empty protocol additions');
  eq(JSON.stringify(x), unchanged, 'ledger/mapping/schedule remain immutable');
  const diag = report.observationReceipt.salaryMatcherDiagnostic;
  eq(D.project(diag), diag, 'closed sanitized schema');
  ok(!/927|1817|fixture-|mid-source|end-source|2026-|PRIVATE|payee|providerAccountId/.test(JSON.stringify(diag)), 'raw candidate evidence stays private');
  const serve = value => {
    try { return Live.overlayLiveState({ data: x.data, report: value }).data; }
    catch (error) { return Live.failedOverlay(x.data, error.message, { report: value }); }
  };
  const after = serve(report), before = serve(disabled);
  eq(incumbent(after), incumbent(before), 'whole live publication conserved');
  const advice = data => F.recommend(data.plan, data.meta.asOf, { debts: data.debts, ...data.liveOverlay });
  eq(incumbent(advice(after)), incumbent(advice(before)), 'entire Forecast output conserved');
  const packet = data => Assistant.buildPacket({ data, periods: null, questionsMarkdown: '', now: 'invented-fixed-clock', env: {} });
  eq(incumbent(packet(after)), incumbent(packet(before)), 'entire incumbent Assistant output conserved');
  eq(after.liveOverlay.observationReceipt.salaryMatcherDiagnostic, diag, 'actual served readback');
  eq(packet(after).metadata.observationReceipt.salaryMatcherDiagnostic, diag, 'same Assistant receipt');
  return diag;
}
const clean = observe(input());
eq(clean.slots.map(row => [row.target, row.outcome]), [['selected', 'matched'], ['selected', 'matched']], 'distinct targets match their own native pairs');
for (const [index, tag] of ['mid', 'end'].entries()) {
  const own = input(); own.payload.transactions = own.payload.transactions.filter(row => row.id.startsWith(tag));
  eq(observe(own).slots[index], clean.slots[index], 'another salary cannot lend failures to this clean slot');
}
for (const row of clean.slots) {
  eq(row.reasons, ['REPRESENTED'], 'two clean packets have no invented rejection');
  ok(Object.values(row.gates).filter(flags => flags.evaluated).every(flags => !flags.rejected), 'clean own evaluated gates pass only');
}
const mutations = {
  'missing-counterpart': (x, tag) => { x.payload.transactions = x.payload.transactions.filter(row => row.id !== tag + '-debit'); },
  'duplicate-counterpart': (x, tag) => { x.payload.transactions.push({ ...x.payload.transactions.find(row => row.id === tag + '-debit'), id: tag + '-duplicate-debit' }); },
  'pending-counterpart': (x, tag) => { x.payload.transactions.find(row => row.id === tag + '-debit').is_pending = true; },
  'foreign-counterpart': (x, tag) => { x.payload.transactions.find(row => row.id === tag + '-debit').currency = 'usd'; },
  'pending-credit': (x, tag) => { x.payload.transactions.find(row => row.id === tag + '-credit').is_pending = true; },
  'foreign-credit': (x, tag) => { x.payload.transactions.find(row => row.id === tag + '-credit').currency = 'usd'; },
  'pending-source': (x, tag) => { x.payload.transactions.find(row => row.id === tag + '-source').is_pending = true; },
  'foreign-source': (x, tag) => { x.payload.transactions.find(row => row.id === tag + '-source').currency = 'usd'; },
  'wrong-alias': (x, tag) => { x.payload.transactions.find(row => row.id === tag + '-source').payee = 'INVENTED DIFFERENT EMPLOYER'; },
  'missing-receipt': (x, tag) => { x.payload.transactions = x.payload.transactions.filter(row => row.id !== tag + '-source'); },
  'duplicate-receipt': (x, tag) => { x.payload.transactions.push({ ...x.payload.transactions.find(row => row.id === tag + '-source'), id: tag + '-duplicate-source' }); },
  'duplicate-credit': (x, tag) => { x.payload.transactions.push({ ...x.payload.transactions.find(row => row.id === tag + '-credit'), id: tag + '-duplicate-credit' }); },
  'not-income': (x, tag) => { x.payload.transactions.find(row => row.id === tag + '-source').is_income = false; },
  'unmapped-source': (x, tag) => { x.payload.transactions.find(row => row.id === tag + '-source').account_id = 'invented-unmapped-source'; },
  'malformed-source-date': (x, tag) => { x.payload.transactions.find(row => row.id === tag + '-source').date = 'not-a-date'; },
};
for (const [bad, tag] of ['mid', 'end'].entries()) for (const [mode, mutate] of Object.entries(mutations)) {
  const x = input(); mutate(x, tag); const diag = observe(x), good = 1 - bad;
  eq(diag.slots[good], clean.slots[good], mode + ': other-slot failure cannot poison the matched slot');
  eq(diag.slots[bad].outcome, mode === 'duplicate-credit' ? 'ambiguous' : 'unmatched', mode + ': native bad-slot outcome preserved');
  if (mode === 'wrong-alias') ok(diag.slots[bad].reasons.includes('PAYROLL_ALIAS_MISMATCH'), 'genuine own alias rejection remains visible');
  if (mode === 'missing-counterpart') ok(diag.slots[bad].reasons.includes('COUNTERPART_MISSING'), 'genuine own counterpart failure retained');
  if (mode === 'duplicate-counterpart') ok(diag.slots[bad].reasons.includes('COUNTERPART_AMBIGUOUS'), 'genuine own counterpart ambiguity retained');
  if (['missing-receipt', 'not-income', 'unmapped-source', 'malformed-source-date'].includes(mode)) {
    for (const gate of D.GATES.filter(gate => !['window', 'rule', 'externalIdentity', 'representation'].includes(gate)))
      eq(diag.slots[bad].gates[gate].evaluated, false, 'unestablished association leaves ' + gate + ' unevaluated');
    eq(diag.slots[bad].reasons, [], 'unestablished candidate cannot invent missing evidence');
  }
}
const equalAmounts = input(); equalAmounts.payload.transactions.forEach(row => { row.amount = Math.sign(row.amount) * 1117.19; });
eq(observe(equalAmounts).slots, clean.slots, 'equal amounts neither establish association nor lend failures');
const reversed = input(); reversed.payload.transactions.reverse();
eq(observe(reversed), clean, 'row order cannot choose a candidate');
const unrelated = input(); unrelated.payload.transactions.push({ id: 'invented-unrelated-pending-credit', account_id: 'fixture-hub',
  date: '2026-07-20', amount: '-431.27', currency: 'cad', is_pending: true, is_income: false, category_name: 'Refund' });
eq(observe(unrelated), clean, 'unrelated pending refund is not an occurrence-bound salary attempt');
const unknown = input(); unknown.payload.transactions = unknown.payload.transactions.filter(row => !row.id.endsWith('-source'));
const unbound = observe(unknown);
for (const row of unbound.slots) {
  eq(row.outcome, 'unmatched', 'native matcher result is distinct from an unknown attempt scope');
  eq(row.reasons, [], 'no invented target rejection when neither packet is established');
}
const midId = 'amandaSalary15', endId = 'amandaSalaryMonthEnd';
const collector = D.create({ startDate: '2026-07-01', endDate: '2026-07-31', occurrences: [
  { kind: 'income', id: midId, date: '2026-07-15' }, { kind: 'income', id: endId, date: '2026-07-31' }] });
eq(collector.forDate('2026-07-14').record, undefined, 'window handles cannot write candidate gates');
eq(collector.forOccurrence('unknown-id', undefined), undefined, 'unknown target cannot pass undefined-date equality');
collector.forOccurrence(midId, '2026-07-15').record(endId, 'payrollReceipt', false, 'RECEIPT_MISSING');
const packet = collector.finish({ unique: [], ambiguous: [] });
eq(packet.slots[1].gates.payrollReceipt.evaluated, false, 'ID-bound recorders reject another rule ID');
eq(packet.slots[1].reasons, [], 'ID-bound recorders cannot lend reasons');
console.log('PASS salary candidate attribution: ' + cases + ' independent observations / ' + checks
  + ' assertions; two IDs/dates, 10 original credit/counterpart counterexamples, all pending/foreign legs,'
  + ' mixed native outcomes, alias/missing/duplicate evidence, unknown association, equal amounts, order,'
  + ' closed ID-bound recorders, redaction and complete financial/served/Assistant conservation');
