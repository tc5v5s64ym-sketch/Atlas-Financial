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
const command = (kind, targetId) => ({ version: 1, kind, targetId });
async function correction(s, kind, targetId, selection, controller = s.controller, session = 'A') {
  return controller.prepare({ session, command: command(kind, targetId), selection });
}
async function corrections() {
  const x = seed(); pair(x, 80102, 80103, 40);
  const s = setup(ledger(x)); const originalReceipt = await save(s, record(x));
  const original = (await s.store.snapshot()).decisions[0], targetId = original.record.id;
  const proposal = record(x, 40, 40), sourceBefore = JSON.stringify(observed(x));
  const p = await correction(s, 'replace', targetId, proposal);
  eq(p.status, 'prepared', 'replacement qualifies without counting its predecessor twice');
  eq([p.allocation.backfill, p.allocation.cardPayment], [40, 40], 'independent 4000 purchase cents + 4000 other cents = 8000 payment cents');
  eq((await s.controller.input()).plan.cardPurchaseCoverage.payments[0].allocations[0].amount, 80, 'preview does not change the effective claim');
  const replaced = await s.controller.confirm({ session: 'A', operationId: p.operationId });
  const state = await s.store.snapshot(), successorId = state.decisions[1].record.id;
  eq(state.decisions[0], original, 'replacement keeps exact original choice and provenance');
  eq(await s.restart().outcome({ session: 'A', operationId: originalReceipt.operationId }), originalReceipt, 'original receipt remains recoverable after correction');
  eq(await s.restart().confirm({ session: 'A', operationId: p.operationId }), replaced, 'restart repeats successor receipt without reapplying');
  eq((await s.controller.input()).plan.cardPurchaseCoverage.payments.map(d => d.id), [successorId], 'only successor reaches Forecast');
  const missingSuccessor = structuredClone(x);
  missingSuccessor.payload.transactions = missingSuccessor.payload.transactions.filter(tx => tx.id !== 80003);
  s.change(ledger(missingSuccessor));
  eq((await s.controller.input()).plan.cardPurchaseCoverage.payments.map(d => [d.id, d.confirmed]), [[successorId, false]],
    'missing successor evidence never revives predecessor or erases successor');
  const tooMuch = structuredClone(missingSuccessor);
  tooMuch.payload.transactions.find(tx => tx.id === 80102).amount = 40.01;
  tooMuch.payload.transactions.find(tx => tx.id === 80103).amount = -40.01;
  s.change(ledger(tooMuch));
  eq((await prepare(s, choice(tooMuch, 80102, 80103, 80001, 40.01))).status, 'unavailable', 'missing successor retains its 4000 cents, rejecting 4001 additional cents');
  s.change(x);
  eq((await s.controller.input()).plan.cardPurchaseCoverage.payments.map(d => [d.id, d.confirmed]), [[successorId, true]], 'evidence return requalifies successor alone');
  await save(s, choice(x, 80102, 80103, 80001, 40));
  let input = await s.controller.input();
  eq(input.plan.cardPurchaseCoverage.payments.map(d => d.confirmed), [true, true], 'replacement atomically releases exactly 4000 purchase cents for an independent pair');
  eq(input.plan.cardPurchaseCoverage.payments.reduce((sum, d) => sum + Math.round(d.allocations[0].amount * 100), 0), 8000, 'effective purchase claims total exactly the independent purchase amount');
  eq([F.startingCashAmount(input.plan), input.debts[0].balance], [380, 360], 'interpretation leaves observed bank ledger at 500-80-40 and 400+80-80-40');
  eq((await correction(s, 'replace', successorId, record(x))).status, 'unavailable', 'replacement cannot take 8000 cents while independent 4000-cent claim remains');
  const withdrawal = await correction(s, 'retract', successorId);
  eq(withdrawal.operation, { version: 1, kind: 'retract' }, 'withdrawal preview explicitly names its versioned operation');
  eq(Object.hasOwn(withdrawal, 'allocation'), false, 'retraction does not pretend to reverse a bank allocation');
  const undone = await s.controller.confirm({ session: 'A', operationId: withdrawal.operationId });
  eq(undone.status, 'confirmed', 'explicit undo is recorded');
  input = await s.restart().input();
  eq(input.plan.cardPurchaseCoverage.payments.length, 1, 'undo withdraws just the selected interpretation');
  eq([F.startingCashAmount(input.plan), input.debts[0].balance], [380, 360], 'undo never reverses bank cash or card debt');
  eq((await s.store.snapshot()).decisions.length, 3, 'undo erases no historical intent');
  eq(await s.restart().confirm({ session: 'A', operationId: withdrawal.operationId }), undone, 'undo receipt survives restart');
  eq((await correction(s, 'retract', successorId)).status, 'unavailable', 'new operation cannot withdraw an already withdrawn head');
  eq((await prepare(s, proposal)).status, 'unavailable', 'append cannot bypass withdrawn lineage');
  eq((await correction(s, 'replace', targetId, proposal)).status, 'unavailable', 'superseded original cannot fork the lineage');
  const restore = await correction(s, 'replace', successorId, proposal);
  eq(restore.status, 'prepared', 'explicit restoration revalidates against the independent retained claim');
  await s.controller.confirm({ session: 'A', operationId: restore.operationId });
  eq((await s.controller.input()).plan.cardPurchaseCoverage.payments.map(d => d.confirmed), [true, true], 'restoration preserves one active version and independent partial');
  eq(JSON.stringify(observed(x)), sourceBefore, 'all correction operations leave provider/canonical evidence unchanged');
  eq(/pc-|coverageRef|purchaseRef|debitRef|creditRef|session-|decision-/.test(JSON.stringify([p, replaced, withdrawal, undone, restore])), false, 'correction previews/receipts expose no private reference or saved-choice identity');

  for (const kind of ['replace', 'retract']) {
    const race = setup(); await save(race, record(race.x)); const id = (await race.store.snapshot()).decisions[0].record.id;
    const secondTab = race.restart();
    const a = await correction(race, kind, id, record(race.x, 40, 40));
    const b = await correction(race, kind, id, record(race.x, 20, 60), secondTab, 'B');
    const receipts = await Promise.all([race.controller.confirm({ session: 'A', operationId: a.operationId }), secondTab.confirm({ session: 'B', operationId: b.operationId })]);
    eq(receipts.map(r => r.status).sort(), ['confirmed', 'rejected'], 'different tabs/sessions serialize ' + kind);
    eq(receipts.find(r => r.status === 'rejected').reason, 'revision-changed', 'stale ' + kind + ' is terminal instead of rebased');
    eq(await race.restart().confirm({ session: 'B', operationId: b.operationId }), receipts[1], 'second-tab terminal outcome is durable');
    eq((await race.controller.outcome({ session: 'B', operationId: a.operationId })).status, 'unknown', 'another household session cannot inspect operation receipts');
  }
  for (const kind of ['replace', 'retract']) for (const committed of [false, true]) {
    const crash = setup(); await save(crash, record(crash.x)); const id = (await crash.store.snapshot()).decisions[0].record.id;
    const p = await correction(crash, kind, id, record(crash.x, 40, 40));
    const update = crash.storage.update.bind(crash.storage);
    crash.storage.update = async transform => { if (committed) await update(transform); throw new Error('synthetic interrupted write'); };
    eq((await crash.controller.confirm({ session: 'A', operationId: p.operationId })).status, 'unavailable', kind + ' interrupted write is uncertain');
    eq((await crash.restart().outcome({ session: 'A', operationId: p.operationId })).status, committed ? 'confirmed' : 'unknown', 'outcome distinguishes commit from no commit');
    crash.storage.update = update;
    if (!committed) eq((await crash.restart().confirm({ session: 'A', operationId: p.operationId })).status, 'unknown', 'restart does not reconstruct unknown uncommitted correction');
    eq((await crash.controller.confirm({ session: 'A', operationId: p.operationId })).status, 'confirmed', 'same retained preview safely retries ' + kind + ' after verification');
    eq((await crash.store.snapshot()).revision, 2, 'retry commits correction exactly once');
  }
  for (const kind of ['replace', 'retract']) {
    const retry = setup(); await save(retry, record(retry.x)); const id = (await retry.store.snapshot()).decisions[0].record.id;
    const p = await correction(retry, kind, id, record(retry.x, 40, 40));
    const update = retry.storage.update.bind(retry.storage);
    retry.storage.update = async () => { throw new Error('synthetic pre-commit failure'); };
    await retry.controller.confirm({ session: 'A', operationId: p.operationId });
    retry.storage.update = update;
    const changed = seed(); changed.payload.transactions[0].amount = 79; retry.change(changed);
    eq((await retry.controller.confirm({ session: 'A', operationId: p.operationId })).reason, 'evidence-changed', 'retry rechecks evidence before ' + kind);
    eq((await retry.store.snapshot()).decisions.length, 1, 'stale retry preserves predecessor');
  }
  const absent = setup(); await save(absent, record(absent.x)); const id = (await absent.store.snapshot()).decisions[0].record.id;
  const missing = seed(); pair(missing, 80102, 80103, 80);
  missing.payload.transactions = missing.payload.transactions.filter(tx => tx.id !== 80003); absent.change(ledger(missing));
  eq((await correction(absent, 'replace', id, record(absent.x, 40, 40))).status, 'unavailable', 'missing evidence cannot earn replacement');
  eq((await prepare(absent, choice(missing, 80102, 80103, 80001, 80))).status, 'unavailable', 'missing predecessor still retains all purchase claims');
  absent.change(seed());
  eq((await absent.controller.input()).plan.cardPurchaseCoverage.payments[0].confirmed, true, 'unchanged evidence restores original intent');
  const stale = await correction(absent, 'replace', id, record(absent.x, 40, 40));
  absent.change(ledger(missing));
  eq((await absent.controller.confirm({ session: 'A', operationId: stale.operationId })).reason, 'evidence-changed', 'evidence loss rejects prepared replacement');
  eq((await absent.store.snapshot()).decisions.length, 1, 'failed replacement erases nothing');
  const explicitUndo = await correction(absent, 'retract', id);
  eq(explicitUndo.status, 'prepared', 'household may explicitly withdraw intent while references are absent');
  await absent.controller.confirm({ session: 'A', operationId: explicitUndo.operationId });
  await save(absent, choice(missing, 80102, 80103, 80001, 80));
  missing.payload.transactions.push(seed().payload.transactions[2]); absent.change(ledger(missing));
  eq((await absent.controller.input()).plan.cardPurchaseCoverage.payments.length, 1, 'evidence return never resurrects explicitly withdrawn intent');
  eq((await correction(absent, 'replace', id, record(absent.x))).status, 'unavailable', 'withdrawn intent cannot return over reused purchase cents');

  const legacy = setup(); await save(legacy, record(legacy.x));
  const saved = await legacy.store.snapshot(), v1 = { revision: saved.revision, decisions: saved.decisions,
    outcomes: saved.outcomes.map(({ command, requestDigest, ...o }) => o) };
  const oldBody = JSON.stringify({ schema: 'atlas-card-payment-decisions/v1', state: v1, digest: S.digest(v1) });
  legacy.storage.replace(oldBody);
  eq((await legacy.controller.input()).plan.cardPurchaseCoverage.payments[0].confirmed, true, 'v1 choices remain safely requalified before migration');
  eq((await correction(legacy, 'retract', saved.decisions[0].record.id)).status, 'unavailable', 'controller cannot migrate v1 implicitly');
  const oldReader = C.createController({ store: { snapshot: async () => {
    const doc = JSON.parse(await legacy.storage.read());
    if (doc.schema !== 'atlas-card-payment-decisions/v1') throw new Error('card-decision-unavailable');
    return doc.state;
  } }, evidence: { read: async () => observed(legacy.x) }, sessions: {} });
  eq((await oldReader.input()).plan.cardPurchaseCoverage.payments.length, 1, 'rollback-reader control reads v1 before transition');
  const before = await legacy.store.snapshot(); await legacy.store.migrate({ expectedRevision: before.revision, expectedDigest: before.documentDigest });
  await assert.rejects(oldReader.input(), /card-decision-unavailable/, 'rollback reader cannot publish a plan by treating v2 as empty'); checks++;
  for (const body of ['{', oldBody.replace('/v1', '/v99')]) {
    legacy.storage.replace(body);
    await assert.rejects(legacy.controller.input(), 'corrupt/unsupported reader withholds entire dependent input'); checks++;
    eq(await correction(legacy, 'retract', saved.decisions[0].record.id), { status: 'unavailable' }, 'reader failure cannot erase claims via undo');
    eq(await legacy.storage.read(), body, 'reader failure never initializes over existing state');
  }
}
async function conservation() {
  // Joint conservation (ATLAS-044): a confirmed refund and payment
  // allocations against the same purchase share one bound —
  // covered + refunded <= purchase amount in exact cents. The validator
  // rejects an overallocating candidate; it never clamps or absorbs it.
  const withRefund = (x, refundAmount) => {
    x.payload.transactions.push({ ...x.payload.transactions[0], id: 80004,
      amount: -refundAmount, category_name: 'Refund', payee: 'Invented grocer refund' });
    x.data.plan.cardPurchaseCoverage.refunds.push({ confirmed: true,
      purchaseRef: fixture.ref(x, 80001), refundRef: fixture.ref(x, 80004) });
    return x;
  };
  const pairAmount = (x, amount) => {
    x.payload.transactions[1].amount = amount; x.payload.transactions[2].amount = -amount;
    return x;
  };
  const over = setup(ledger(withRefund(seed(), 30)));
  eq(await prepare(over, record(over.x, 80)), { status: 'unavailable' },
    'refund 30 + allocation 80 overallocates the 80 purchase: validator rejects');
  eq(await prepare(over, record(over.x, 80)), { status: 'unavailable' },
    'the same overallocating candidate replays to the same rejection');
  const centOver = setup(ledger(pairAmount(withRefund(seed(), 30), 50.01)));
  eq(await prepare(centOver, record(centOver.x, 50.01)), { status: 'unavailable' },
    'refund 30 + allocation 50.01 exceeds the purchase by one cent');
  const exact = setup(ledger(pairAmount(withRefund(seed(), 30), 50)));
  await save(exact, record(exact.x, 50));
  const afterExact = await exact.controller.input();
  eq(afterExact.plan.cardPurchaseCoverage.payments.length, 1);
  eq(afterExact.plan.cardPurchaseCoverage.payments[0].confirmed, true,
    'refund 30 + allocation 50 meets the bound exactly and stays confirmed');
  // Cumulative: a second payment of 1 on a fresh pair pushes claims to 81.
  const cumulativeX = pairAmount(withRefund(seed(), 30), 50); pair(cumulativeX, 80102, 80103, 1);
  const cumulative = setup(ledger(cumulativeX));
  await save(cumulative, record(cumulative.x, 50));
  eq(await cumulative.controller.prepare({ session: 'A', selection: choice(cumulative.x, 80102, 80103, 80001, 1) }),
    { status: 'unavailable' }, 'cumulative claims 50 + 30 + 1 exceed the 80 purchase');
  // Input order does not matter: a payment saved before its refund exists is
  // requalified jointly once the refund evidence arrives.
  const ordered = setup(ledger(seed()));
  await save(ordered, record(ordered.x, 80));
  const savedId = (await ordered.store.snapshot()).decisions[0].record.id;
  ordered.change(ledger(withRefund(ordered.x, 30)));
  const requalified = await ordered.controller.input();
  eq(requalified.plan.cardPurchaseCoverage.payments.map(d => [d.id, d.confirmed]),
    [[savedId, false]],
    'a refund arriving after the payment requalifies the joint bound: claim withheld');
}
async function conservationRepairRound() {
  // Repair round (Systems BLOCKING 6256681905 on the first ATLAS-044 head):
  // two ways the first joint bound still failed — a reversal-blind gross
  // bound, and a retained claim that vanished when its record broke.
  const withRefund = (x, refundAmount) => {
    x.payload.transactions.push({ ...x.payload.transactions[0], id: 80004,
      amount: -refundAmount, category_name: 'Refund', payee: 'Invented grocer refund' });
    x.data.plan.cardPurchaseCoverage.refunds.push({ confirmed: true,
      purchaseRef: fixture.ref(x, 80001), refundRef: fixture.ref(x, 80004) });
    return x;
  };
  const pairAmount = (x, amount) => {
    x.payload.transactions[1].amount = amount; x.payload.transactions[2].amount = -amount;
    return x;
  };
  // Finding 2: refund 30 + payment 80 whose own confirmed reversal returns
  // 30 nets covered 50 — a prefix-conserved valid history stays qualified.
  const reversalLegs = x => {
    x.payload.transactions.push(
      { id: 80402, account_id: 3004, date: x.asOf, amount: 30, currency: 'cad',
        category_name: 'Credit Card Payment', payee: 'Invented reversal', is_pending: false },
      { id: 80403, account_id: 3001, date: x.asOf, amount: -30, currency: 'cad',
        category_name: 'Credit Card Payment', payee: 'Invented reversal', is_pending: false });
    x.data.plan.cardPurchaseCoverage.reversals.push({ confirmed: true,
      paymentId: 'decision-' + 'a'.repeat(32),
      cardDebitRef: fixture.ref(x, 80402), cashCreditRef: fixture.ref(x, 80403),
      allocations: [{ purchaseRef: fixture.ref(x, 80001), amount: 30 }], otherAmount: 0 });
    return x;
  };
  // The controller mints opaque record ids at prepare time, so a reversal
  // naming its payment is exercised at the Forecast validator seam the
  // controller itself calls (the coverage suite pins the same history at
  // the publication surface with a stable payment id).
  const nettedX = ledger(reversalLegs(withRefund(seed(), 30)));
  eq(F.validateCardPaymentDecision({ ...observed(nettedX), record: record(nettedX, 80),
    retainedRecords: [] }).status, 'ready',
    'payment 80 + own reversal 30 + refund 30 validates: net claims are 80');
  // Unqualified reversal evidence creates no capacity: drop the cash leg
  // and the same candidate is judged on its gross claim again.
  const unqualifiedX = reversalLegs(withRefund(seed(), 30));
  unqualifiedX.payload.transactions = unqualifiedX.payload.transactions.filter(tx => tx.id !== 80403);
  eq(F.validateCardPaymentDecision({ ...observed(ledger(unqualifiedX)),
    record: record(unqualifiedX, 80), retainedRecords: [] }).status, 'unavailable',
    'a reversal with a missing leg releases nothing: gross 80 + refund 30 is rejected');
  // Allocation cap (Atlas ruling on the d1c5432e boundary question): an
  // allocation may not exceed the purchase itself, with no reversal
  // credit — a reversal acts on a previously allocated amount, and excess
  // pair money belongs in otherAmount. Pair 110, allocation 110, reversal
  // 30 is rejected; allocation 80 + other 30 with the same reversal is
  // the legitimate representation and validates.
  const capX = seed();
  capX.payload.transactions[1].amount = 110; capX.payload.transactions[2].amount = -110;
  reversalLegs(capX);
  eq(F.validateCardPaymentDecision({ ...observed(ledger(capX)),
    record: record(capX, 110), retainedRecords: [] }).status, 'unavailable',
    'allocation 110 against the 80 purchase is rejected even with a qualified reversal 30');
  const capControl = { ...record(capX, 80), otherAmount: 30, otherPurpose: 'required-payment' };
  eq(F.validateCardPaymentDecision({ ...observed(ledger(capX)),
    record: capControl, retainedRecords: [] }).status, 'ready',
    'allocation 80 + other 30 is the legitimate representation and validates');
  // Reversal cohort (Atlas ruling on the order-dependence reproduction):
  // one cohort qualification governs release capacity and publication. A
  // payment's confirmed reversals whose valid parts total MORE than the
  // split they reverse are conflicted as a whole — no first-fit subset
  // releases capacity, in any array order.
  const cohortLegs = (x, amounts) => {
    amounts.forEach((amount, i) => {
      const debit = 80502 + i * 100, credit = 80503 + i * 100;
      x.payload.transactions.push(
        { id: debit, account_id: 3004, date: x.asOf, amount, currency: 'cad',
          category_name: 'Credit Card Payment', payee: 'Invented reversal', is_pending: false },
        { id: credit, account_id: 3001, date: x.asOf, amount: -amount, currency: 'cad',
          category_name: 'Credit Card Payment', payee: 'Invented reversal', is_pending: false });
      x.data.plan.cardPurchaseCoverage.reversals.push({ confirmed: true,
        paymentId: 'decision-' + 'a'.repeat(32),
        cardDebitRef: fixture.ref(x, debit), cashCreditRef: fixture.ref(x, credit),
        allocations: [{ purchaseRef: fixture.ref(x, 80001), amount }], otherAmount: 0 });
    });
    return x;
  };
  for (const amounts of [[30, 60], [60, 30], [20, 70], [70, 20]]) {
    const cx = ledger(cohortLegs(withRefund(seed(), 30), amounts));
    eq(F.validateCardPaymentDecision({ ...observed(cx), record: record(cx, 80),
      retainedRecords: [] }).status, 'unavailable',
      'reversal cohort ' + amounts.join('+') + ' exceeds the 80 split: conflicted as a whole, no first-fit release in any order');
  }
  for (const amounts of [[30, 20], [30, 50]]) {
    const cx = ledger(cohortLegs(withRefund(seed(), 30), amounts));
    eq(F.validateCardPaymentDecision({ ...observed(cx), record: record(cx, 80),
      retainedRecords: [] }).status, 'ready',
      'reversal cohort ' + amounts.join('+') + ' within the split (incl. equality) releases in full');
  }
  { // A parent independently acceptable without reversal credit stays
    // acceptable: the conflicted cohort contributes nothing and poisons
    // nothing. Pair 80 = allocation 50 + otherAmount 30; refund 30.
    const cx = ledger(cohortLegs(withRefund(seed(), 30), [30, 60]));
    const independent = { ...record(cx, 50), otherAmount: 30, otherPurpose: 'required-payment' };
    eq(F.validateCardPaymentDecision({ ...observed(cx), record: independent,
      retainedRecords: [] }).status, 'ready',
      'allocation 50 + refund 30 meets the bound without reversal credit; the conflicted cohort changes nothing');
  }
  // Whole-payment cohort (Atlas ruling on the multi-purchase probe): the
  // cohort is the parent payment's WHOLE reversal cohort across every
  // purchase it allocates. Parent pair 160 = A80 + B80; reversals A30,
  // A60 (A subtotal 90 over its split) and B20 — B20 is disqualified with
  // the rest, so a refund of 20 on B leaves B claiming 100 and the parent
  // is rejected. Without the refund the parent qualifies on gross claims.
  const multiSetup = (specs, refundOnB) => {
    const x = seed();
    x.payload.transactions.push({ ...x.payload.transactions[0], id: 80005,
      amount: 80, date: '2026-09-19' });
    x.payload.transactions[1].amount = 160; x.payload.transactions[2].amount = -160;
    if (refundOnB) {
      x.payload.transactions.push({ ...x.payload.transactions[0], id: 80006,
        amount: -20, category_name: 'Refund', payee: 'Invented grocer refund' });
      x.data.plan.cardPurchaseCoverage.refunds.push({ confirmed: true,
        purchaseRef: fixture.ref(x, 80005), refundRef: fixture.ref(x, 80006) });
    }
    specs.forEach(([purchaseId, amount], i) => {
      const debit = 80702 + i * 100, credit = 80703 + i * 100;
      x.payload.transactions.push(
        { id: debit, account_id: 3004, date: x.asOf, amount, currency: 'cad',
          category_name: 'Credit Card Payment', payee: 'Invented reversal', is_pending: false },
        { id: credit, account_id: 3001, date: x.asOf, amount: -amount, currency: 'cad',
          category_name: 'Credit Card Payment', payee: 'Invented reversal', is_pending: false });
      x.data.plan.cardPurchaseCoverage.reversals.push({ confirmed: true,
        paymentId: 'decision-' + 'a'.repeat(32),
        cardDebitRef: fixture.ref(x, debit), cashCreditRef: fixture.ref(x, credit),
        allocations: [{ purchaseRef: fixture.ref(x, purchaseId), amount }], otherAmount: 0 });
    });
    return ledger(x);
  };
  const multiRecord = x => ({ id: 'decision-' + 'a'.repeat(32), confirmed: true,
    debitRef: fixture.ref(x, 80002), creditRef: fixture.ref(x, 80003),
    allocations: [{ purchaseRef: fixture.ref(x, 80001), amount: 80 },
      { purchaseRef: fixture.ref(x, 80005), amount: 80 }],
    otherAmount: 0, otherPurpose: null });
  const multiSpecs = [[80001, 30], [80001, 60], [80005, 20]];
  for (const specs of [multiSpecs, [multiSpecs[2], multiSpecs[0], multiSpecs[1]]]) {
    const cx = multiSetup(specs, true);
    eq(F.validateCardPaymentDecision({ ...observed(cx), record: multiRecord(cx),
      retainedRecords: [] }).status, 'unavailable',
      'whole-payment cohort conflicted by A: B20 releases nothing, so refund 20 + allocation 80 overclaims B');
  }
  {
    const cx = multiSetup(multiSpecs, false);
    eq(F.validateCardPaymentDecision({ ...observed(cx), record: multiRecord(cx),
      retainedRecords: [] }).status, 'ready',
      'without the refund the parent qualifies on gross claims; the disqualified cohort is irrelevant to capacity');
  }
  {
    const cx = multiSetup([[80001, 30], [80005, 20]], true);
    eq(F.validateCardPaymentDecision({ ...observed(cx), record: multiRecord(cx),
      retainedRecords: [] }).status, 'ready',
      'a valid multi-purchase cohort releases on both purchases (B: refund 20 + allocation 80 - release 20 = 80)');
  }
  // Finding 1: a retained confirmed claim whose debit leg is gone does not
  // release its cents. Retained 30 + refund 30 leave exactly 20 of room.
  const kept = setup(ledger(pairAmount(withRefund(seed(), 30), 30)));
  await save(kept, record(kept.x, 30));
  const broken = pairAmount(withRefund(seed(), 30), 30);
  pair(broken, 80102, 80103, 50); pair(broken, 80202, 80203, 20); pair(broken, 80302, 80303, 20.01);
  broken.payload.transactions = broken.payload.transactions.filter(tx => tx.id !== 80002);
  kept.change(ledger(broken));
  eq((await kept.controller.input()).plan.cardPurchaseCoverage.payments[0].confirmed, false,
    'the broken retained payment is itself withheld');
  eq(await prepare(kept, choice(broken, 80102, 80103, 80001, 50)), { status: 'unavailable' },
    'retained 30 + refund 30 + candidate 50 totals 110: rejected');
  eq(await prepare(kept, choice(broken, 80302, 80303, 80001, 20.01)), { status: 'unavailable' },
    'one cent past the retained room is rejected');
  eq((await prepare(kept, choice(broken, 80202, 80203, 80001, 20))).status, 'prepared',
    'candidate 20 fits retained 30 + refund 30 exactly');
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
async function purchasePostingContracts() {
  const cases = [
    ['posted', true], ['pending', false], ['raw-missing', false], ['raw-null', false],
    ['raw-string-false', false], ['raw-string-true', false], ['raw-zero', false], ['raw-one', false], ['raw-object', false],
    ['dto-missing', false], ['dto-null', false], ['dto-string-false', false], ['dto-zero', false], ['dto-object', false],
    ['dto-source-unknown', false], ['dto-source-null', false], ['dto-source-pending', false],
    ['pending-confirmed-treatment', false], ['pending-presumed-treatment', false], ['legacy-posted', true],
  ];
  for (const [mode, ready] of cases) for (const allocated of [80, 40]) {
    const x = seed(), raw = x.payload.transactions[0];
    if (mode.startsWith('pending')) { raw.is_pending = true; x.payload.accounts[3].balance = 320; }
    if (mode === 'raw-missing') delete raw.is_pending;
    const rawValues = { 'raw-null': null, 'raw-string-false': 'false', 'raw-string-true': 'true',
      'raw-zero': 0, 'raw-one': 1, 'raw-object': {} };
    if (Object.hasOwn(rawValues, mode)) raw.is_pending = rawValues[mode];
    const e = observed(x), original = JSON.stringify(e), packet = structuredClone(e.packet);
    const purchase = packet.transactions.find(tx => tx.atlasAccountId === x.cardId && tx.amount === 80);
    if (mode === 'dto-missing') delete purchase.pending;
    const dtoValues = { 'dto-null': null, 'dto-string-false': 'false', 'dto-zero': 0, 'dto-object': {} };
    if (Object.hasOwn(dtoValues, mode)) purchase.pending = dtoValues[mode];
    if (mode === 'dto-source-unknown') purchase.savingsPostingEvidence = 'unknown';
    if (mode === 'dto-source-null') purchase.savingsPostingEvidence = null;
    if (mode === 'dto-source-pending') purchase.savingsPostingEvidence = 'pending';
    if (mode === 'legacy-posted') delete purchase.savingsPostingEvidence;
    if (mode === 'pending-confirmed-treatment') purchase.pendingTreatment = 'confirmed-settled';
    if (mode === 'pending-presumed-treatment') purchase.pendingTreatment = 'presumed-settled-for-current-forecast';
    const proposed = record(x, allocated, 80 - allocated), outcome = F.validateCardPaymentDecision({ ...e, packet, record: proposed });
    eq(outcome.status, ready ? 'ready' : 'unavailable', mode + ': only qualified posted purchases receive confirmed allocation');
    if (ready) eq([outcome.allocation.backfill, outcome.allocation.cardPayment], [allocated, 80 - allocated],
      'independent cents: allocated ' + allocated * 100 + ' plus remaining purpose equals 8000');
    const plan = structuredClone(e.plan); plan.cardPurchaseCoverage.payments.push(proposed);
    const advice = F.recommend(plan, e.asOf, { debts: e.debts, currentPeriodActuals: packet });
    const rows = advice.cardPurchaseCoverage.purchases;
    eq(rows.length, 1, 'posting qualification never removes the counted purchase');
    eq([rows[0].amount, rows[0].covered, rows[0].remaining], [80, ready ? allocated : 0, ready ? 80 - allocated : 80],
      '8000 purchase cents remain counted; unqualified allocation covers no cents');
    eq([F.startingCashAmount(plan), e.debts[0].balance, e.debts[0].pending],
      [420, mode.startsWith('pending') ? 320 : 400, mode.startsWith('pending') ? 80 : 0],
      'cash 50000-8000; posted debt 40000+posted purchase-8000; pending authorization separate');
    eq(JSON.stringify(e), original, 'qualifier leaves real producer-shaped input immutable');
  }
  // The older schema already supplies an explicitly confirmed opening liability.
  // It is not an unqualified current row with its posting field omitted.
  const opening = seed(); opening.payload.transactions = opening.payload.transactions.slice(1);
  opening.payload.accounts[3].balance = 320;
  opening.data.plan.cardPurchaseCoverage.opening = { asOf: '2026-09-18', confirmed: true,
    currency: 'cad', fundingAccountId: 'chequing-a', purchases: [{ ref: 'invented-opening-purchase',
      accountId: opening.cardId, date: '2026-09-17', amount: 80, covered: 0, categoryLabel: 'Groceries' }] };
  const old = observed(opening), carry = { ...record(seed()),
    allocations: [{ purchaseRef: 'invented-opening-purchase', amount: 80 }] };
  eq(F.validateCardPaymentDecision({ ...old, record: carry }).status, 'ready', 'confirmed legacy opening retains its posted qualification');

  const retained = setup(); await save(retained, record(retained.x));
  const pending = seed(); pending.payload.transactions[0].is_pending = true; pending.payload.accounts[3].balance = 320;
  retained.change(pending);
  eq((await retained.controller.input()).plan.cardPurchaseCoverage.payments.map(p => p.confirmed), [false],
    'pending purchase withholds current qualification of the retained intent');
  eq((await retained.store.snapshot()).decisions[0].record.allocations[0].amount, 80, 'original 8000-cent claim stays retained');
  eq((await prepare(retained, record(pending))).status, 'unavailable', 'unqualified purchase cannot gain another confirmed claim');
  retained.change(seed());
  eq((await retained.controller.input()).plan.cardPurchaseCoverage.payments.map(p => p.confirmed), [true],
    'the same retained intent requalifies when explicit posted evidence returns');
  eq((await retained.store.snapshot()).decisions.length, 1, 'requalification never appends or activates another choice');
}
async function main() {
  await purchasePostingContracts();
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
  await corrections();
  await conservation();
  await conservationRepairRound();
  console.log('PASS private card decision foundation: ' + checks + ' synthetic provider/controller checks');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
