'use strict';
// Invented evidence uses the incumbent provider pipeline, never household files.
const assert = require('node:assert/strict');
const F = require('../public/forecast');
const Live = require('../scripts/live-plan');
const fixture = require('./fixtures/card-purchase-coverage-data');
let checks = 0;
const eq = (a, b, why) => { assert.deepEqual(a, b, why); checks++; };
function seed() {
  const x = fixture('backfill');
  delete x.data.plan.cardPurchaseCoverage.opening;
  x.payload.transactions.slice(1).forEach(t => { t.category_name = 'Payment, Transfer'; t.notes = null; });
  return x;
}
function observed(x) {
  const data = Live.fromObservation(x).data;
  return { plan: data.plan, debts: data.debts, asOf: x.asOf, packet: data.liveOverlay.currentPeriodActuals };
}
function record(x, amount = 80, otherAmount = 0) {
  return { id: 'decision-' + 'a'.repeat(32), confirmed: true,
    debitRef: fixture.ref(x, 80002), creditRef: fixture.ref(x, 80003),
    allocations: amount ? [{ purchaseRef: fixture.ref(x, 80001), amount }] : [],
    otherAmount, otherPurpose: otherAmount ? 'required-payment' : null };
}
// This is intentionally the first assertion: baseline has no validation seam.
eq(typeof F.validateCardPaymentDecision, 'function', 'Forecast owns proposed choice validation');
const S = require('../scripts/card-payment-decision-store');
const C = require('../scripts/card-payment-decisions');
const actorA = 'session-' + 'a'.repeat(64), actorB = 'session-' + 'b'.repeat(64);
function memory() {
  let body = S.initialDocument(), tail = Promise.resolve();
  return { read: async () => body, replace: value => { body = value; },
    update(transform) {
      const run = tail.then(() => { body = transform(body); });
      tail = run.catch(() => {}); return run;
    } };
}
function setup(x = seed(), storage = memory(), factory = C.createController) {
  let clock = Date.parse('2026-09-20T18:00:00Z'), source = x;
  const store = S.createStore(storage);
  const evidence = { read: async () => observed(source), resolve: choice => choice };
  const sessions = { actor: session => session === 'A' ? actorA : session === 'B' ? actorB : null };
  const options = () => ({ store: S.createStore(storage), evidence, sessions, now: () => clock });
  const make = () => factory(options());
  return { x, storage, store, controller: make(), restart: make,
    upgraded: () => C.createController(options()),
    change: next => { source = next; }, advance: ms => { clock += ms; } };
}
async function prepare(s, choice = record(s.x)) { return s.controller.prepare({ session: 'A', selection: choice }); }
function ledger(x) {
  x.payload.accounts[0].balance = 500 - x.payload.transactions.filter(tx => tx.account_id === 3001).reduce((sum, tx) => sum + tx.amount, 0);
  x.payload.accounts[3].balance = 400 + x.payload.transactions.filter(tx => tx.account_id === 3004).reduce((sum, tx) => sum + tx.amount, 0);
  return x;
}
function pair(x, debit, credit, amount) {
  const model = seed();
  x.payload.transactions.push({ ...model.payload.transactions[1], id: debit, amount },
    { ...model.payload.transactions[2], id: credit, amount: -amount });
}
function choice(x, debit, credit, purchase, amount) {
  return { id: 'decision-' + 'a'.repeat(32), confirmed: true,
    debitRef: fixture.ref(x, debit), creditRef: fixture.ref(x, credit),
    allocations: [{ purchaseRef: fixture.ref(x, purchase), amount }], otherAmount: 0, otherPurpose: null };
}
async function save(s, proposal) {
  const p = await prepare(s, proposal); eq(p.status, 'prepared', 'synthetic intent has a real reconciler preview');
  const result = await s.controller.confirm({ session: 'A', operationId: p.operationId });
  eq(result.status, 'confirmed', 'synthetic intent is saved through the controller'); return result;
}
async function retainedLifecycle() {
  for (const missing of ['credit', 'debit']) for (const overlap of missing === 'credit' ? ['debit-and-purchase', 'debit-only', 'purchase-only'] : ['credit']) {
    const s = setup(); await save(s, record(s.x));
    const next = seed();
    pair(next, 80102, 80103, 80);
    next.payload.transactions.push({ ...next.payload.transactions[0], id: 80004 });
    const proposal = choice(next, overlap === 'purchase-only' || missing === 'debit' ? 80102 : 80002,
      missing === 'debit' ? 80003 : 80103, overlap === 'debit-only' ? 80004 : 80001, 80);
    const absentId = missing === 'credit' ? 80003 : 80002;
    next.payload.transactions = next.payload.transactions.filter(tx => tx.id !== absentId);
    s.change(ledger(next));
    eq((await s.controller.input()).plan.cardPurchaseCoverage.payments[0].confirmed, false, 'missing evidence withholds A but retains its claim');
    eq((await prepare(s, proposal)).status, 'unavailable', 'retained ' + overlap + ' cannot be reused while A is missing');
    eq((await s.store.snapshot()).decisions.length, 1, 'conflicting disappearance-phase proposal adds no intent');
    next.payload.transactions.push(seed().payload.transactions.find(tx => tx.id === absentId)); s.change(ledger(next));
    eq((await s.controller.input()).plan.cardPurchaseCoverage.payments.map(p => p.confirmed), [true], 'A requalifies alone after its evidence returns');
  }
  // Same purchase is legitimate when independent exact payment legs cover disjoint cents.
  const partial = seed(); partial.payload.transactions[1].amount = 40; partial.payload.transactions[2].amount = -40;
  pair(partial, 80102, 80103, 40);
  const valid = setup(ledger(partial)); await save(valid, choice(partial, 80002, 80003, 80001, 40));
  const absent = structuredClone(partial); absent.payload.transactions = absent.payload.transactions.filter(tx => tx.id !== 80003);
  valid.change(ledger(absent)); await save(valid, choice(absent, 80102, 80103, 80001, 40));
  eq((await valid.controller.input()).plan.cardPurchaseCoverage.payments.map(p => p.confirmed), [false, true], 'valid independent partial survives A missing');
  valid.change(partial);
  eq((await valid.controller.input()).plan.cardPurchaseCoverage.payments.map(p => p.confirmed), [true, true], '40 + 40 covers 80 without double use after return');
  const extra = structuredClone(absent); pair(extra, 80202, 80203, 0.01); valid.change(ledger(extra));
  eq((await prepare(valid, choice(extra, 80202, 80203, 80001, 0.01))).status, 'unavailable', 'connected third claim cannot spend one latent cent again');
  eq((await valid.store.snapshot()).decisions.length, 2, 'legitimate partial intents stay retained');
  for (const purpose of ['other', 'prior-debt']) {
    const s = setup(), a = { ...record(s.x), allocations: [], otherAmount: 80, otherPurpose: purpose }; await save(s, a);
    const next = seed(); pair(next, 80102, 80103, 80);
    const b = { ...choice(next, 80002, 80103, 80001, 80), allocations: [], otherAmount: 80, otherPurpose: purpose };
    next.payload.transactions = next.payload.transactions.filter(tx => tx.id !== 80003); s.change(ledger(next));
    eq((await prepare(s, b)).status, 'unavailable', 'zero-purchase ' + purpose + ' intent still consumes its retained debit');
  }
  for (const changed of ['credit-amount', 'missing-purchase']) {
    const s = setup(); await save(s, record(s.x));
    const next = seed(); pair(next, 80102, 80103, 80);
    const b = changed === 'credit-amount' ? choice(next, 80102, 80103, 80001, 80)
      : { ...choice(next, 80002, 80103, 80001, 80), allocations: [], otherAmount: 80, otherPurpose: 'prior-debt' };
    if (changed === 'credit-amount') next.payload.transactions.find(tx => tx.id === 80003).amount = -79;
    else next.payload.transactions = next.payload.transactions.filter(tx => tx.id !== 80001);
    s.change(ledger(next));
    eq((await s.controller.input()).plan.cardPurchaseCoverage.payments[0].confirmed, false, changed + ' withholds current qualification');
    eq((await prepare(s, b)).status, 'unavailable', changed + ' never retires the retained claim');
  }
  const independent = seed(); independent.payload.transactions.push({ ...independent.payload.transactions[0], id: 80004 });
  pair(independent, 80102, 80103, 80);
  const separate = setup(ledger(independent)); await save(separate, record(independent));
  const missingA = structuredClone(independent); missingA.payload.transactions = missingA.payload.transactions.filter(tx => tx.id !== 80003);
  separate.change(ledger(missingA)); await save(separate, choice(missingA, 80102, 80103, 80004, 80));
  separate.change(independent);
  eq((await separate.controller.input()).plan.cardPurchaseCoverage.payments.map(p => p.confirmed), [true, true], 'entirely independent choices remain qualified');

  // Load real old-controller records, including the exact disappearance bug.
  // The pre-repair controller is preserved verbatim as a checked-in fixture
  // (scripts/card-payment-decisions.js at head 8aa3018e, blob 827ff197) so
  // this regression never depends on a Git object outside the target history.
  const path = require('node:path'), Module = require('node:module');
  const source = require('node:fs').readFileSync(
    path.join(__dirname, 'fixtures/card-payment-decisions-before-repair.js'), 'utf8');
  const old = new Module(path.join(__dirname, '../scripts/card-payment-decisions-before-repair.js'));
  old.filename = old.id; old.paths = Module._nodeModulePaths(path.dirname(old.filename)); old._compile(source, old.filename);
  for (const connected of [false, true]) {
    const initial = seed(); if (connected) initial.payload.transactions.push({ ...initial.payload.transactions[0], id: 80004 });
    const legacy = setup(ledger(initial), memory(), old.exports.createController); await save(legacy, record(initial));
    const hidden = structuredClone(initial); pair(hidden, 80102, 80103, 80);
    const b = choice(hidden, 80002, 80103, connected ? 80004 : 80001, 80);
    hidden.payload.transactions = hidden.payload.transactions.filter(tx => tx.id !== 80003); legacy.change(ledger(hidden));
    await save(legacy, b);
    if (connected) {
      pair(hidden, 80202, 80203, 80);
      const c = choice(hidden, 80202, 80203, 80004, 80);
      hidden.payload.transactions = hidden.payload.transactions.filter(tx => tx.id !== 80103); legacy.change(ledger(hidden)); await save(legacy, c);
      hidden.payload.transactions.push({ ...initial.payload.transactions[2], id: 80103 });
    }
    hidden.payload.transactions.push(initial.payload.transactions.find(tx => tx.id === 80003)); legacy.change(ledger(hidden));
    const count = connected ? 3 : 2;
    eq((await legacy.controller.input()).plan.cardPurchaseCoverage.payments.map(p => p.confirmed), Array(count).fill(true), 'old source reproduces conflicting requalification');
    const repaired = await legacy.upgraded().input();
    eq(repaired.plan.cardPurchaseCoverage.payments.map(p => p.confirmed), Array(count).fill(false), 'complete cohort withholds all connected conflicting claims');
    eq((await legacy.store.snapshot()).decisions.length, count, 'repair retains every previously saved intent');
    eq(F.recommend(repaired.plan, repaired.asOf, { debts: repaired.debts, currentPeriodActuals: repaired.packet }).paydayAllocation.available, null,
      'unknown opening and conflicted cohort never publish available cash');
    eq(F.cardMinimumState(repaired.plan, repaired.asOf).payments, [], 'requalification manufactures no minimum satisfaction');
  }
  for (const last of [33, 33.01]) {
    const all = seed(); all.payload.transactions[1].amount = 19; all.payload.transactions[2].amount = -19;
    pair(all, 80102, 80103, 28); pair(all, 80202, 80203, last);
    const s = setup(ledger(all), memory(), last === 33 ? C.createController : old.exports.createController);
    await save(s, choice(all, 80002, 80003, 80001, 19));
    const hidden = structuredClone(all); hidden.payload.transactions = hidden.payload.transactions.filter(tx => tx.id !== 80003); s.change(ledger(hidden));
    await save(s, choice(hidden, 80102, 80103, 80001, 28));
    eq((await s.upgraded().input()).plan.cardPurchaseCoverage.payments.map(p => p.confirmed), [false, true], 'valid retained 19 + 28 partials stay usable');
    hidden.payload.transactions = hidden.payload.transactions.filter(tx => tx.id !== 80103); s.change(ledger(hidden));
    const c = choice(hidden, 80202, 80203, 80001, last);
    if (last > 33) eq((await s.upgraded().prepare({ session: 'A', selection: c })).status, 'unavailable', 'three-choice aggregate rejects 8001 against 8000 cents');
    await save(s, c); s.change(all);
    eq((await s.upgraded().input()).plan.cardPurchaseCoverage.payments.map(p => p.confirmed), Array(3).fill(last === 33),
      'all three retained choices requalify together only when their aggregate fits');
    eq((await s.store.snapshot()).decisions.length, 3, 'aggregate rejection withholds qualification without erasing intent');
  }
}
async function main() {
  const s = setup(), before = JSON.stringify(s.x), e = observed(s.x);
  eq((await s.controller.input()).plan, e.plan, 'empty store leaves the complete effective plan unchanged');
  const valid = F.validateCardPaymentDecision({ ...e, record: record(s.x) });
  eq(valid.status, 'ready', 'real reconciler accepts the explicitly selected pair with unknown opening');
  eq([valid.allocation.backfill, valid.allocation.cardPayment], [80, 0], 'independent 8000-cent allocation');
  const p = await prepare(s);
  p.allocation.backfill = 999; // A preview reply is never apply authority.
  eq(p.status, 'prepared', 'prepare produces a reviewable preview');
  eq((await s.store.snapshot()).revision, 0, 'prepare does not write');
  eq(await s.controller.confirm({ session: 'B', operationId: p.operationId }),
    { status: 'unknown', operationId: p.operationId }, 'another session cannot confirm or inspect a preview');
  const receipt = await s.controller.confirm({ session: 'A', operationId: p.operationId });
  eq(receipt.status, 'confirmed', 'one exact confirmation commits');
  eq(receipt.revision, 1, 'choice and receipt share one revision');
  eq(await s.restart().outcome({ session: 'A', operationId: p.operationId }), receipt, 'restart recovers the operation outcome');
  eq(await s.restart().confirm({ session: 'A', operationId: p.operationId }), receipt, 'repeat confirmation reads receipt without reapplying');
  eq((await s.store.snapshot()).decisions.length, 1, 'one persisted choice');
  eq((await s.store.snapshot()).decisions[0].record.allocations[0].amount, 80, 'mutated preview cannot alter the private confirmed choice');
  const input = await s.restart().input();
  eq(input.plan.cardPurchaseCoverage.opening, undefined, 'input composition never invents an opening');
  const money = F.recommend(input.plan, input.asOf, { debts: input.debts, currentPeriodActuals: input.packet });
  eq(money.cardPurchaseCoverage.status, 'unavailable', 'unknown opening keeps global coverage unavailable');
  eq(money.paydayAllocation.available, null, 'no financial activation or available-cash claim');
  eq(input.plan.obligations[0].amount, 25, 'independent 2500-cent minimum remains unchanged');
  eq(F.cardMinimumState(input.plan, input.asOf).payments, [], 'purchase intent manufactures no minimum-satisfaction evidence');
  eq(JSON.stringify(s.x), before, 'provider/canonical input remains immutable');
  eq(/pc-|coverageRef|purchaseRef|debitRef|creditRef|session-|decision-/.test(JSON.stringify([p, receipt])), false,
    'public previews and receipts contain no private identities');

  const lost = setup(), lp = await prepare(lost);
  const update = lost.storage.update.bind(lost.storage);
  lost.storage.update = async transform => { await update(transform); throw new Error('invented lost reply'); };
  eq((await lost.controller.confirm({ session: 'A', operationId: lp.operationId })).status, 'unavailable', 'post-commit reply loss is uncertain');
  eq((await lost.restart().outcome({ session: 'A', operationId: lp.operationId })).status, 'confirmed', 'verify outcome after reply loss');
  eq((await lost.store.snapshot()).decisions.length, 1, 'lost reply cannot cause a second allocation');

  const race = setup(), a = await prepare(race), b = await prepare(race);
  const competing = await Promise.all([a, b].map(pv => race.controller.confirm({ session: 'A', operationId: pv.operationId })));
  eq(competing.map(r => r.status).sort(), ['confirmed', 'rejected'], 'concurrent different previews cannot rebase or double allocate');
  eq((await race.store.snapshot()).decisions.length, 1, 'revision comparison protects the choice once');
  eq((await race.restart().outcome({ session: 'A', operationId: b.operationId })).status, competing[1].status, 'stale result is durable too');
  const same = setup(), sp = await prepare(same);
  await Promise.all([1, 2].map(() => same.controller.confirm({ session: 'A', operationId: sp.operationId })));
  eq((await same.store.snapshot()).revision, 1, 'simultaneous same-operation confirmation commits once');

  const changed = setup(), cp = await prepare(changed), edited = seed();
  edited.payload.transactions[0].amount = 79;
  changed.change(edited);
  eq((await changed.controller.confirm({ session: 'A', operationId: cp.operationId })).reason, 'evidence-changed', 'confirm re-reads changed evidence');
  eq((await changed.store.snapshot()).decisions.length, 0, 'stale evidence is not saved');
  eq((await changed.restart().outcome({ session: 'A', operationId: cp.operationId })).status, 'rejected', 'changed-evidence outcome survives restart');
  const expired = setup(), ep = await prepare(expired); expired.advance(600001);
  eq((await expired.controller.confirm({ session: 'A', operationId: ep.operationId })).reason, 'preview-expired', 'preview expiry is terminal');
  const noPreview = await s.restart().confirm({ session: 'A', operationId: 'operation-' + 'f'.repeat(32) });
  eq(noPreview.status, 'unknown', 'restart cannot reconstruct or auto-apply an unconfirmed preview');

  // Saved intent survives missing evidence. Qualification does not survive it.
  const missing = seed(); missing.payload.transactions = missing.payload.transactions.slice(0, 1);
  s.change(missing);
  eq((await s.controller.input()).plan.cardPurchaseCoverage.payments[0].confirmed, false, 'missing references withhold qualification');
  eq((await s.store.snapshot()).decisions.length, 1, 'missing history never erases intent or asks for it again');
  s.change(seed());
  eq((await s.controller.input()).plan.cardPurchaseCoverage.payments[0].confirmed, true, 'identical independent evidence restores qualification');
  const reordered = seed(); reordered.payload.transactions.reverse(); s.change(reordered);
  eq((await s.controller.input()).plan.cardPurchaseCoverage.payments[0].confirmed, true, 'observer row ordering is not persistent identity');
  const replaced = seed(); replaced.payload.transactions[0].id = 80999; s.change(replaced);
  eq((await s.controller.input()).plan.cardPurchaseCoverage.payments[0].confirmed, false, 'a different native purchase cannot inherit the choice');
  const relabeled = seed(); relabeled.payload.transactions[0].category_name = 'Other Bank Fees'; s.change(relabeled);
  eq((await s.controller.input()).plan.cardPurchaseCoverage.payments[0].confirmed, false, 'material category change cannot silently reuse the choice');

  // Contradictory declarations go through the actual provider/reconciler path.
  const double = seed(); fixture.confirm(double, 'invented-earlier-claim', 80002, 80003, [[80001, 80]]);
  eq(F.validateCardPaymentDecision({ ...observed(double), record: record(double) }).status, 'unavailable', 'shared exact cash/card legs cannot be allocated twice');
  const over = seed();
  over.payload.transactions.push({ ...over.payload.transactions[1], id: 80102 }, { ...over.payload.transactions[2], id: 80103 });
  fixture.confirm(over, 'invented-earlier-claim', 80102, 80103, [[80001, 80]]);
  eq(F.validateCardPaymentDecision({ ...observed(over), record: record(over) }).status, 'unavailable', 'independent payment legs cannot allocate the same purchase cents twice');
  for (const change of [
    x => { x.payload.transactions[1].is_pending = true; },
    x => { x.payload.transactions[2].currency = 'usd'; },
    x => { x.payload.transactionWindow.complete = false; },
  ]) {
    const bad = seed(); change(bad);
    eq(F.validateCardPaymentDecision({ ...observed(bad), record: record(bad) }).status, 'unavailable', 'unqualified provider evidence fails closed');
  }
  const pendingGap = seed(); pendingGap.payload.pendingCoverage.complete = false;
  assert.throws(() => observed(pendingGap), /pending-freshness-unproven/, 'real live pipeline rejects incomplete pending'); checks++;
  eq(F.validateCardPaymentDecision({ ...e, record: { ...record(s.x), otherAmount: 0.01 } }).status,
    'unavailable', 'independent conservation: 8000 + 1 does not equal 8000 cents');
  const required = setup(); const rp = await prepare(required, record(required.x, 0, 80));
  eq(rp.allocation.otherPurpose, 'required-payment', 'explicit nonpurchase purpose is preserved');
  await required.controller.confirm({ session: 'A', operationId: rp.operationId });
  const ri = await required.controller.input();
  eq(F.cardMinimumState(ri.plan, ri.asOf).payments, [], 'required-payment household intent manufactures no issuer satisfaction');
  // Coverage must enter BEFORE the real observer rebuilds minimum evidence.
  // A consumer-only stale category packet is not a new financial defect.
  const categorized = seed();
  categorized.payload.categories = [{ id: 9001, name: 'Minimum payment - TD Travel Visa', is_income: false,
    is_group: false, exclude_from_totals: true, exclude_from_budget: true }];
  categorized.payload.transactionWindow.startDate = '2026-09-17';
  categorized.payload.transactions[1].category_id = 9001;
  delete categorized.payload.transactions[1].category_name;
  categorized.payload.transactions[1].payee = 'TFR-TO C/C';
  const beforeChoice = Live.fromObservation(categorized);
  eq(beforeChoice.report.cardMinimumCategoryEvidence.payments.length, 1, 'real provider path recognizes the exact minimum category');
  const chosen = record(categorized); categorized.data.plan.cardPurchaseCoverage.payments = [chosen];
  const afterChoice = Live.fromObservation(categorized);
  eq(afterChoice.report.cardMinimumCategoryEvidence.payments.length, 0, 'real observer excludes the exact debit already allocated to purchases');
  eq(F.cardMinimumState(afterChoice.data.plan, categorized.asOf).payments.length, 0, 'cross-ledger purpose is not reused as minimum satisfaction');
  eq([F.startingCashAmount(afterChoice.data.plan), afterChoice.data.debts[0].balance], [420, 400],
    'independent issuer/cash ledger remains 500 - 80 and 400 + 80 - 80');
  const balanceOnly = seed(); balanceOnly.payload.transactions = [];
  eq(F.validateCardPaymentDecision({ ...observed(balanceOnly), record: record(seed()) }).status, 'unavailable',
    'reported card balance cannot substitute for purchase/payment evidence');
  const corrupt = setup(); corrupt.storage.replace('{"private": "invented-canary"}');
  eq(await corrupt.controller.prepare({ session: 'A', selection: record(corrupt.x) }), { status: 'unavailable' }, 'corruption leaks no paths or values');
  eq(await setup().controller.prepare({ session: 'not authenticated', selection: record(seed()) }), { status: 'unavailable' }, 'missing authentication adapter result fails closed');
  await retainedLifecycle();
  console.log('PASS private card decision foundation: ' + checks + ' synthetic provider/controller checks');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
