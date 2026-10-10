'use strict';
// History H1: declared source completeness, closing state and household-day
// cutoff on new captures; legacy v1 byte/hash/ID compatibility; receipt path.
// Entirely invented finances and identities. No data.json, live GET or credential.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const History = require('../scripts/private-period-history');
const Forecast = require('../public/forecast');
const Live = require('../scripts/live-plan');
const Operating = require('../scripts/operating-answer');

const ANCHOR = '2030-02-01';
const clone = value => JSON.parse(JSON.stringify(value));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-history-h1-'));
const FIXTURE = path.join(__dirname, 'fixtures', 'private-period-history-v1');
// Frozen legacy archive written by the pre-H1 module on base 5dceb7c6.
const V1 = [
  { file: '00000001-d84b83847b86a9d7e946bd7181131e16a40404b842c7e8515f41409aafca3e96.json',
    sha256: 'f0f000afe8c851a90f06c0052af54ce70251d6265b0bd7b2822f07547cc00233',
    revisionId: 'd84b83847b86a9d7e946bd7181131e16a40404b842c7e8515f41409aafca3e96',
    captureId: '971efea3d6365be079a0845a5e469ed0934bd9c307190053a04ae88c969a6cac', kind: 'original' },
  { file: '00000002-00893c06c699d37c479f98f9cd6d35bb2c864870b62f504b55bf39cf297bd976.json',
    sha256: '0b4519fbb605c96b2192c21885960f48455aa8284bfccafe9ac1c685abae3193',
    revisionId: '00893c06c699d37c479f98f9cd6d35bb2c864870b62f504b55bf39cf297bd976',
    captureId: '99cebf8d05a6afcc5695db7840e30c721245e705ceb62ecfd06ae80cc3d59290', kind: 'closing' },
];
function directory(name) { const dir = path.join(temporary, name); fs.mkdirSync(dir, { mode: 0o700 }); return dir; }
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function rejects(fn, code) { assert.throws(fn, error => error.code === code, code); }
function shift(iso, minutes) { return new Date(Date.parse(iso) + minutes * 60000).toISOString().replace('.000Z', 'Z'); }

// Byte-for-byte the invented shape of test-private-period-history.js by default, parameterized by
// cycle start and source/capture clocks (needed for DST and 23:59 gates).
function input(day, kind, { start = ANCHOR, fetchedAt = day + 'T18:00:00Z', capturedAt } = {}) {
  const ids = ['chequing-a', 'chequing-b', 'savings'];
  const stamp = shift(fetchedAt, -1);
  const cash = ids.map((id, i) => ({ id, label: 'Invented cash ' + i, value: [1000, 500, 100][i], evidenceDate: day, confidence: 'confirmed' }));
  return {
    kind, capturedAt: capturedAt || shift(fetchedAt, 1), periodStart: start, periods: [],
    data: { meta: { asOf: day }, accounts: [], debts: [], revolvingExtra: [], plan: {
      opening: { asOf: day, representedEvents: [] }, startingCash: { breakdown: cash },
      defaults: { targetBuffer: 0, extraDebtMonthly: 0 },
      income: [{ id: 'payroll', label: 'Invented income', frequency: 'biweekly', anchor: ANCHOR, amount: 200, confidence: 'confirmed' }],
      bills: [], commitments: [], obligations: [], groups: [], funding: { options: [] },
      budget: { categories: [['groceries', 40], ['fuel', 15], ['restaurants', 10], ['dale-guilt-free', 5],
        ['amanda-guilt-free', 5], ['pets', 5], ['other-spend', 20]].map(([id, plannedPayday]) =>
        ({ id, label: 'Invented ' + id, plannedPayday, class: 'essential', confidence: 'confirmed', from: [] })) },
    } },
    accountMap: { provider: 'lunchmoney', schema: 'atlas-provider-account-map/v1', scope: 'owner-observed', mappings: ids.map((id, i) =>
      ({ providerAccountId: 'invented-account-' + i, atlasRole: 'household-cash', canonical: { id, collection: 'cash' } })) },
    identity: { rules: [], billPaymentPayees: [] },
    payload: { provider: 'lunchmoney', fetchedAt,
      accounts: cash.map((row, i) => ({ id: 'invented-account-' + i, name: 'Invented provider cash ' + i,
        currency: 'cad', balance: row.value, balance_as_of: stamp, updated_at: stamp })),
      categories: [{ id: 'invented-category', name: 'Groceries' }], tags: [{ id: 'invented-tag', name: 'invented household note' }],
      transactions: [{ id: 'invented-transaction', account_id: 'invented-account-1', date: start, amount: '12.34', currency: 'cad',
        category_id: 'invented-category', payee: 'Invented Market', original_name: 'INVENTED MARKET SOURCE',
        notes: 'invented evidence', tags: ['invented-tag'], is_pending: false, updated_at: shift(fetchedAt, -2) }],
      transactionWindow: { startDate: start, endDate: day, complete: true, hasMore: false, truncated: false },
      pendingCoverage: { complete: true, basis: 'is_pending-unbounded', hasMore: false },
    },
  };
}
function capture(data) {
  const clean = clone(data), time = clean.capturedAt; delete clean.capturedAt;
  return History.capture(clean, { now: () => new Date(time) });
}
function append(destination, candidate) { return History.append({ destination, enabled: true, candidate }); }
const reasonsOf = candidate => candidate.content.sourceCompleteness.reasons;
const transport = candidate => reasonsOf(candidate).filter(code => code.startsWith('transport:'));
// Classifier facts reconstructed from the same native observer/Forecast path.
function facts(data) {
  const candidate = capture(data), refreshed = Live.fromObservation(data);
  return { period: candidate.content.period, fetchedAt: candidate.content.provenance.fetchedAt,
    transactionWindow: candidate.content.provenance.transactionWindow,
    pendingCoverage: candidate.content.provenance.pendingCoverage,
    report: clone(refreshed.report), publication: clone(candidate.content.publication) };
}
const classify = f => History.sourceCompletenessFor(f);
const results = [];
function check(name, fn) { fn(); results.push(name); }

try {
  const CLOSE = input('2030-02-15', 'closing');

  check('receipt path reads report.obligationReconciliationReceipt (fails on base: always null)', () => {
    const candidate = capture(CLOSE);
    const expected = JSON.parse(JSON.stringify(Live.fromObservation(clone(CLOSE)).report.obligationReconciliationReceipt));
    assert.equal(expected.schema, 'atlas-obligation-reconciliation-receipt/v1');
    assert.notEqual(candidate.content.provenance.reconciliationReceipt, null, 'reconciliation receipt is retained');
    assert.deepEqual(candidate.content.provenance.reconciliationReceipt, expected);
  });

  check('new captures carry v2 metadata; publication stays native Forecast (inert)', () => {
    const candidate = capture(CLOSE);
    assert.equal(candidate.schema, 'atlas-private-period-history/v2');
    assert.deepEqual(candidate.content.cutoff, { rule: 'household-day', end: '2030-02-14', tz: 'America/Vancouver' });
    assert.equal(candidate.content.closingState, 'complete-at-capture');
    const refreshed = Live.fromObservation(clone(CLOSE)), options = Operating.recommendOpts(refreshed.data, {});
    options.periods = [];
    const native = Forecast.recommend(refreshed.data.plan, '2030-02-15', options).payPeriodViews.find(p => p.start === ANCHOR);
    assert.deepEqual(candidate.content.publication, JSON.parse(JSON.stringify(native)));
    assert.deepEqual(transport(candidate), [], 'full posted window, unbounded pending, fetched after cutoff');
    // The invented income occurrence is unsettled natively; that gap is retained, not dropped.
    assert.deepEqual(reasonsOf(candidate), ['publication:income-actual-unavailable']);
    assert.equal(candidate.content.sourceCompleteness.status, 'incomplete');
  });

  check('complete only when every layer is free of reasons', () => {
    const f = facts(CLOSE);
    f.publication.budgetProgress.income.actual = { ...f.publication.budgetProgress.income.actual, amount: 200, completeness: 'complete', trust: 'calculated' };
    assert.deepEqual(classify(f), { status: 'complete', reasons: [] });
  });

  check('legacy v1: exact bytes, hashes and IDs preserved; completeness unknown', () => {
    const archive = directory('legacy');
    for (const row of V1) {
      assert.equal(hash(path.join(FIXTURE, row.file)), row.sha256, 'committed v1 fixture bytes are frozen');
      fs.copyFileSync(path.join(FIXTURE, row.file), path.join(archive, row.file)); fs.chmodSync(path.join(archive, row.file), 0o600);
    }
    const listed = History.read({ destination: archive });
    assert.deepEqual(listed.map(row => [row.schema, row.revisionId, row.captureId, row.kind]),
      V1.map(row => ['atlas-private-period-history/v1', row.revisionId, row.captureId, row.kind]));
    for (const row of listed) {
      assert.deepEqual(row.sourceCompleteness, { status: 'unknown', reasons: [] });
      assert.equal(row.closingState, 'unknown');
    }
    const record = History.read({ destination: archive, revisionId: V1[0].revisionId });
    assert.deepEqual(History.completeness(record), { status: 'unknown', reasons: [], closingState: 'unknown', cutoff: null });
    assert.ok(!['sourceCompleteness', 'closingState', 'cutoff'].some(key => Object.hasOwn(record.content, key)), 'v1 is never upgraded in place');
    assert.equal(record.content.provenance.reconciliationReceipt, null, 'legacy null receipt stays as recorded');
    // A regenerated v2 retry of the same original content is the v1 revision.
    const retry = append(archive, capture(input(ANCHOR, 'original')));
    assert.deepEqual([retry.status, retry.revisionId, retry.schema], ['duplicate', V1[0].revisionId, 'atlas-private-period-history/v1']);
    // A genuine v2 revision chains after the legacy head without rewriting it.
    const correction = input('2030-02-16', 'actual-correction');
    correction.reason = 'invented later posting';
    correction.payload.transactions.push({ ...correction.payload.transactions[0], id: 'invented-late-posting', amount: '3.21' });
    const next = append(archive, capture(correction));
    assert.deepEqual([next.status, next.schema, next.previousRevision, next.baselineRevision],
      ['appended', 'atlas-private-period-history/v2', V1[1].revisionId, V1[0].revisionId]);
    for (const row of V1) assert.equal(hash(path.join(archive, row.file)), row.sha256, 'legacy file bytes unchanged after reads and appends');
    assert.equal(History.read({ destination: archive }).length, 3);
    // A legacy record may not acquire H1 labels; a v2 record may not omit them.
    const forged = clone(record); forged.content.closingState = 'complete-at-capture';
    rejects(() => History.replayPublication(forged), 'history-schema-invalid');
    const bare = capture(CLOSE); delete bare.content.cutoff;
    rejects(() => append(directory('bare-v2'), bare), 'history-schema-invalid');
    const shuffled = capture(input(ANCHOR, 'original'));
    shuffled.content.sourceCompleteness.reasons.reverse();
    rejects(() => append(directory('shuffled-v2'), shuffled), 'history-schema-invalid');
    const dishonest = capture(input(ANCHOR, 'original'));
    dishonest.content.sourceCompleteness.status = 'complete';
    rejects(() => append(directory('dishonest-v2'), dishonest), 'history-schema-invalid');
  });

  check('coverage: absent posted window', () => {
    const data = clone(CLOSE); delete data.payload.transactionWindow;
    assert.deepEqual(transport(capture(data)), ['transport:posted-window-absent', 'transport:posted-window-not-complete',
      'transport:posted-window-has-more-unknown']);
  });
  check('coverage: bounded and absent pending', () => {
    const bounded = clone(CLOSE);
    bounded.payload.pendingCoverage = { complete: true, basis: 'is_pending-unbounded', hasMore: false, startDate: ANCHOR, endDate: '2030-02-15' };
    assert.deepEqual(transport(capture(bounded)), ['transport:pending-coverage-bounded-window']);
    const absent = clone(CLOSE); delete absent.payload.pendingCoverage;
    assert.deepEqual(transport(capture(absent)), ['transport:pending-coverage-unproven']);
    const paged = clone(CLOSE); paged.payload.pendingCoverage.hasMore = true;
    assert.deepEqual(transport(capture(paged)), ['transport:pending-coverage-unproven']);
  });
  check('coverage: truncated and has-more', () => {
    const truncated = clone(CLOSE); Object.assign(truncated.payload.transactionWindow, { complete: false, truncated: true });
    assert.deepEqual(transport(capture(truncated)), ['transport:posted-window-not-complete', 'transport:posted-window-truncated']);
    const more = clone(CLOSE); Object.assign(more.payload.transactionWindow, { complete: false, hasMore: true });
    assert.deepEqual(transport(capture(more)), ['transport:posted-window-not-complete', 'transport:posted-window-has-more']);
  });
  check('coverage: contradictory declarations', () => {
    const claimed = clone(CLOSE); Object.assign(claimed.payload.transactionWindow, { complete: true, hasMore: true });
    assert.deepEqual(transport(capture(claimed)), ['transport:posted-window-contradictory', 'transport:posted-window-has-more']);
    const inverted = clone(CLOSE); Object.assign(inverted.payload.transactionWindow, { startDate: '2030-02-15', endDate: ANCHOR });
    assert.deepEqual(transport(capture(inverted)), ['transport:posted-window-contradictory', 'transport:posted-window-misses-start',
      'transport:posted-window-misses-end']);
    const future = clone(CLOSE); future.payload.transactionWindow.endDate = '2030-02-20';
    assert.deepEqual(transport(capture(future)), ['transport:posted-window-contradictory'], 'a window cannot end after its fetch day');
  });
  check('coverage: window misses either edge', () => {
    const late = clone(CLOSE); late.payload.transactionWindow.startDate = '2030-02-02';
    assert.deepEqual(transport(capture(late)), ['transport:posted-window-misses-start']);
    const early = clone(CLOSE); early.payload.transactionWindow.endDate = '2030-02-13';
    assert.deepEqual(transport(capture(early)), ['transport:posted-window-misses-end']);
  });

  check('unresolved account, balance, reconciliation, card and currency are retained reasons', () => {
    const base = facts(CLOSE);
    const only = (mutate, expected) => {
      const f = clone(base); mutate(f);
      assert.deepEqual(classify(f).reasons.filter(code => code !== 'publication:income-actual-unavailable'), expected);
    };
    only(f => { f.report.observationReceipt.accountCoverage.missingExpectedIdentities = ['invented']; }, ['evidence:mapped-account-missing']);
    only(f => { f.report.observationReceipt.failClosedReasons = ['required-cash-unobserved']; }, ['evidence:required-cash-unobserved']);
    only(f => { f.report.observationReceipt.balanceCoverage.requiredCashMissingDatedBalance = ['savings']; }, ['evidence:balance-unproven']);
    only(f => { delete f.report.observationReceipt; }, ['evidence:observation-receipt-unavailable']);
    only(f => { f.report.currentPeriodActuals.transactions.push({ date: '2030-02-02', amount: 1, currency: 'cad', accountRole: 'unmapped' }); }, ['evidence:unmapped-transaction-account']);
    only(f => { f.report.obligationReconciliationReceipt.counts.ambiguous = 1; }, ['evidence:reconciliation-unresolved']);
    only(f => { f.report.obligationReconciliationReceipt.trusted = false; }, ['evidence:reconciliation-unresolved']);
    only(f => { delete f.report.obligationReconciliationReceipt; }, ['evidence:reconciliation-receipt-unavailable']);
    only(f => { f.report.currentPeriodActuals.cardCoverageUnconfirmed = [{ ref: 'invented', date: null }]; }, ['evidence:card-coverage-unconfirmed']);
    only(f => { f.report.currentPeriodActuals.currencyUnconfirmed = [{ ref: 'invented' }]; }, ['evidence:currency-unconfirmed']);
    only(f => { delete f.report.currentPeriodActuals.transactions[0].currency; }, ['evidence:non-cad-transaction']);
    only(f => { delete f.report.currentPeriodActuals; }, ['evidence:current-period-actuals-unavailable']);
    only(f => { f.publication.cardPurchaseCoverage = { status: 'unavailable' }; }, ['publication:card-coverage-unavailable']);
    only(f => { f.publication.cardCoverageUnavailable = true; }, ['publication:card-coverage-unavailable']);
    only(f => { f.publication.operatingPlanUnavailable = true; }, ['publication:operating-plan-unavailable']);
    only(f => { f.publication.budgetProgress.currency = null; }, ['publication:currency-unavailable']);
    only(f => { f.publication.budgetProgress.coverage.remainingClaim = 'posted-only'; }, ['publication:actuals-coverage-not-precise']);
    // Several at once keep one fixed order regardless of discovery order.
    only(f => {
      f.publication.operatingPlanUnavailable = true;
      f.report.currentPeriodActuals.currencyUnconfirmed = [{}];
      f.report.observationReceipt.failClosedReasons = ['required-cash-balance-unproven', 'expected-mapped-identity-missing'];
    }, ['evidence:mapped-account-missing', 'evidence:balance-unproven', 'evidence:currency-unconfirmed', 'publication:operating-plan-unavailable']);
  });

  check('unresolved through the real observer path: non-CAD transaction', () => {
    const data = clone(CLOSE); data.payload.transactions[0].currency = 'usd';
    const reasons = reasonsOf(capture(data));
    // The native publication still counts this row (a routed finding, not
    // changed here); the archive retains the CAD-evidence gap as a reason.
    assert.equal(capture(data).content.publication.householdBudget.find(row => row.id === 'groceries').spent, 12.34);
    assert.ok(reasons.includes('evidence:non-cad-transaction'), reasons.join(','));
    assert.ok(!reasonsOf(capture(CLOSE)).includes('evidence:non-cad-transaction'));
  });

  check('true zero vs unavailable', () => {
    const zero = clone(CLOSE); zero.payload.transactions = [];
    const zc = capture(zero);
    assert.ok(zc.content.publication.householdBudget.filter(row => !row.informational).every(row => row.spent === 0), 'native zero spend');
    assert.ok(!reasonsOf(zc).some(code => code.startsWith('publication:household')), 'a true zero is not unavailable');
    const broken = clone(CLOSE);
    broken.payload.transactionWindow.complete = false; broken.payload.pendingCoverage.complete = false;
    const bc = capture(broken);
    assert.ok(bc.content.publication.householdBudget.every(row => row.spent == null), 'unavailable actuals never become zero');
    for (const code of ['publication:household-actual-unavailable', 'publication:household-category-actual-unavailable']) {
      assert.ok(reasonsOf(bc).includes(code), code);
    }
    const f = facts(CLOSE);
    f.publication.budgetProgress.household.actual.amount = 0;
    assert.ok(!classify(f).reasons.includes('publication:household-actual-unavailable'));
    f.publication.budgetProgress.household.actual.amount = null;
    assert.ok(classify(f).reasons.includes('publication:household-actual-unavailable'));
  });

  check('Vancouver 23:59 and next-midnight gate (PST)', () => {
    // Feb 14 23:59 PST is 2030-02-15T07:59Z. Existing closing gate is kept.
    rejects(() => capture(input('2030-02-14', 'closing', { fetchedAt: '2030-02-15T07:58:00Z', capturedAt: '2030-02-15T07:59:00Z' })), 'history-closing-date-invalid');
    const lateDay = capture(input('2030-02-14', 'first-observed', { fetchedAt: '2030-02-15T07:58:00Z', capturedAt: '2030-02-15T07:59:00Z' }));
    assert.equal(lateDay.content.closingState, 'provisional');
    assert.ok(reasonsOf(lateDay).includes('transport:source-fetched-before-cutoff'));
    // Fetched 23:59, captured 00:00: the capture clock is not the cutoff.
    const straddle = capture(input('2030-02-14', 'closing', { fetchedAt: '2030-02-15T07:59:00Z', capturedAt: '2030-02-15T08:00:00Z' }));
    assert.equal(straddle.content.closingState, 'provisional');
    assert.deepEqual(transport(straddle), ['transport:source-fetched-before-cutoff']);
    assert.deepEqual(straddle.content.cutoff, { rule: 'household-day', end: '2030-02-14', tz: 'America/Vancouver' });
    const midnight = capture(input('2030-02-15', 'closing', { fetchedAt: '2030-02-15T08:00:00Z', capturedAt: '2030-02-15T08:01:00Z' }));
    assert.equal(midnight.content.closingState, 'complete-at-capture');
    assert.deepEqual(transport(midnight), []);
    // 07:30Z is still Feb 14 in PST, although a fixed UTC-7 rule would say Feb 15.
    assert.equal(capture(input('2030-02-14', 'first-observed', { fetchedAt: '2030-02-15T07:30:00Z' })).content.closingState, 'provisional');
  });

  check('Vancouver DST (PDT after Mar 10) next-midnight gate', () => {
    const START = '2030-03-01';
    assert.equal(Forecast.spendingCycle(input('2030-03-14', 'first-observed', { start: START }).data.plan, START).end, '2030-03-14');
    const before = capture(input('2030-03-14', 'first-observed', { start: START, fetchedAt: '2030-03-15T06:59:00Z' }));
    assert.deepEqual([before.content.period.end, before.content.closingState], ['2030-03-14', 'provisional']);
    const after = capture(input('2030-03-15', 'closing', { start: START, fetchedAt: '2030-03-15T07:00:00Z' }));
    assert.deepEqual([after.content.closingState, after.content.cutoff.end], ['complete-at-capture', '2030-03-14']);
    assert.deepEqual(transport(after), []);
  });

  check('idempotent retries and deterministic reasons', () => {
    const archive = directory('retries');
    const first = append(archive, capture(CLOSE));
    // Same evidence, later fetch and capture clocks only.
    const again = clone(CLOSE); again.payload.fetchedAt = '2030-02-15T21:00:00Z'; again.capturedAt = '2030-02-15T21:01:00Z';
    const regenerated = capture(again);
    assert.deepEqual(regenerated.content.sourceCompleteness, capture(CLOSE).content.sourceCompleteness);
    assert.notEqual(regenerated.captureId, first.captureId, 'later clocks regenerate the capture');
    const retry = append(archive, regenerated);
    assert.deepEqual([retry.status, retry.revisionId], ['duplicate', first.revisionId]);
    assert.equal(append(archive, capture(CLOSE)).status, 'duplicate');
    assert.equal(History.read({ destination: archive }).length, 1, 'no duplicate revision');
    const listed = History.read({ destination: archive })[0];
    assert.deepEqual(listed.sourceCompleteness, capture(CLOSE).content.sourceCompleteness);
    assert.equal(listed.closingState, 'complete-at-capture');
    assert.ok(!JSON.stringify(listed).includes('invented-transaction'), 'metadata exports fixed codes only');
    const messy = clone(CLOSE); delete messy.payload.transactionWindow; delete messy.payload.pendingCoverage;
    const a = reasonsOf(capture(messy)), b = reasonsOf(capture(messy));
    assert.deepEqual(a, b);
    assert.deepEqual(a, History.REASONS.filter(code => a.includes(code)), 'reasons follow the published fixed order');
  });

  results.forEach(name => console.log('  ok - ' + name));
  console.log('PASS private pay-period history H1: completeness, closing state, cutoff, v1 compatibility and receipt path (' + results.length + ' checks)');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
