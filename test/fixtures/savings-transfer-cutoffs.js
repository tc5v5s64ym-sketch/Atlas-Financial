'use strict';
// Independent conservation ledger: before A=100/B=0; after A=0/B=100.
const fx = require('./savings-daily-allocation-contract');
// Literal independent ledgers: an external withdrawal empties 100; a deposit
// supplies 100; a 1.25 fee leaves 98.75. Date-only equality is unresolved.
const boundaryCases = [
  ['withdraw-before', 'withdraw', '2026-10-06', 100, null],
  ['withdraw-same', 'withdraw', '2026-10-07', 100, null],
  ['withdraw-after', 'withdraw', '2026-10-08', 0, [0, 0, 0]],
  ['deposit-before', 'deposit', '2026-10-06', 0, null],
  ['deposit-same', 'deposit', '2026-10-07', 100, null],
  ['deposit-after', 'deposit', '2026-10-08', 100, [60, 24, 16]],
  ['fee-before', 'fee', '2026-10-06', 100, null],
  ['fee-same', 'fee', '2026-10-07', 98.75, null],
  ['fee-after', 'fee', '2026-10-08', 98.75, [60, 24, 14.75]],
  ['debit-before', 'debit', '2026-10-06', 100, null],
  ['debit-same', 'debit', '2026-10-07', 0, null],
  ['debit-after', 'debit', '2026-10-08', 0, [0, 0, 0]],
  ['credit-before', 'credit', '2026-10-06', 0, null],
  ['credit-same', 'credit', '2026-10-07', 100, null],
  ['credit-after', 'credit', '2026-10-08', 100, [60, 24, 16]],
  ['neither', 'neither', '2026-10-06', 95, [60, 24, 35]],
  ['zero-row', 'zero-row', '2026-10-06', 95, [60, 24, 35]],
].map(([name, kind, date, value, saved]) => ({ name: 'boundary-' + name, kind, date, value, saved }));
for (const [kind, value] of [['withdraw', 0], ['deposit', 100], ['fee', 98.75], ['debit', 0], ['credit', 100]])
  boundaryCases.push({ name: 'boundary-' + kind + '-same-current', kind, date: '2026-10-08',
    postedDate: '2026-10-08', value, saved: null });
for (const bad of ['currency', 'missing-currency', 'amount', 'null-amount', 'fractional', 'date', 'future-date',
  'impossible-date', 'role', 'missing-role', 'alias', 'id', 'duplicate-id', 'pending', 'missing-pending',
  'coverage', 'coverage-gap', 'observation', 'account-whitespace', 'missing-account', 'currency-flag']) boundaryCases.push({ name: 'boundary-direct-bad-' + bad,
  kind: 'fee', date: '2026-10-08', value: 100, saved: null, bad });
for (const bad of ['counter-currency', 'counter-date', 'counter-role', 'counter-alias', 'counter-duplicate', 'counter-currency-flag'])
  boundaryCases.push({ name: 'boundary-' + bad, kind: 'withdraw', date: '2026-10-08', value: 0, saved: null, bad });
boundaryCases.push({ name: 'boundary-neither-currency-flag', kind: 'neither', date: '2026-10-06', value: 95,
  saved: [60, 24, 35], bad: 'outside-currency-flag' });
function fixture(mode = 'double-count') {
  const input = fx.advance(fx.fixture(), '2026-10-08');
  input.plan.savingsEarmarks.allocationPolicy = { order: 'due-date-first-combined-pool',
    effectiveFrom: '2026-10-05', source: 'Independent invented cutoff policy' };
  const accounts = input.plan.savingsPoolObservation.accounts;
  Object.assign(accounts[0], { value: 100, evidenceDate: '2026-10-06' });
  Object.assign(accounts[1], { value: 100, evidenceDate: '2026-10-08' });
  const legs = [
    { id: 'cutoff-out', date: '2026-10-07', amount: 100, currency: 'CAD', pending: false,
      accountRole: 'household-reserve', atlasAccountId: 'savings', tfrReference: 'AA101', tfrDirection: 'TO' },
    { id: 'cutoff-in', date: '2026-10-07', amount: -100, currency: 'CAD', pending: false,
      accountRole: 'household-reserve', atlasAccountId: 'savings-dont-touch', tfrReference: 'AA101', tfrDirection: 'FR' },
  ];
  if (mode === 'inverse') {
    Object.assign(accounts[0], { value: 0, evidenceDate: '2026-10-08' });
    Object.assign(accounts[1], { value: 0, evidenceDate: '2026-10-06' });
  }
  if (mode === 'both-before') { accounts[1].value = 0; accounts.forEach(row => { row.evidenceDate = '2026-10-06'; }); }
  if (mode === 'both-after') { accounts[0].value = 0; accounts.forEach(row => { row.evidenceDate = '2026-10-08'; }); }
  if (mode === 'same-day') { accounts[0].value = 0; accounts.forEach(row => { row.evidenceDate = '2026-10-07'; }); }
  if (mode === 'same-day-one') accounts[0].evidenceDate = '2026-10-07';
  if (mode === 'opposite-direction') {
    legs[0].atlasAccountId = 'savings-dont-touch'; legs[1].atlasAccountId = 'savings';
    accounts[0].evidenceDate = '2026-10-08'; accounts[1].evidenceDate = '2026-10-06';
  }
  if (mode === 'unrelated-mixed' || mode === 'zero') {
    accounts[0].value = mode === 'zero' ? 0 : 95;
    accounts[1].value = mode === 'zero' ? 0 : 24;
    legs.length = 0;
  }
  if (mode === 'unknown-stock') delete accounts[0].value;
  if (mode === 'pending') legs[0].pending = true;
  if (mode === 'missing-pending') delete legs[0].pending;
  if (mode === 'currency') legs[1].currency = 'USD';
  if (mode === 'missing-currency') delete legs[1].currency;
  if (mode === 'fractional') { legs[0].amount = 100.001; legs[1].amount = -100.001; }
  if (mode === 'string-amount') legs[0].amount = '100';
  if (mode === 'null-amount') legs[0].amount = null;
  if (mode === 'date') delete legs[0].date;
  if (mode === 'impossible-date') legs[0].date = '2026-02-30';
  if (mode === 'future-date') legs[0].date = '2026-10-09';
  if (mode === 'alias') legs[0].accountId = 'savings-dont-touch';
  if (mode === 'alias-outside') { legs[0].atlasAccountId = 'chequing-a'; legs[0].accountId = 'savings'; legs[0].accountRole = 'household-cash'; }
  if (mode === 'missing-id') delete legs[0].id;
  if (mode === 'malformed-id') legs[0].id = ' cutoff-out ';
  if (mode === 'role') legs[0].accountRole = 'revolving-credit';
  if (mode === 'duplicate') legs.push({ ...legs[0] });
  if (mode === 'ambiguous-reference') legs.push({ ...legs[1], id: 'cutoff-in-extra' });
  if (mode === 'duplicate-id-elsewhere') input.opts.currentPeriodActuals.transactions.push({ id: 'cutoff-out',
    date: input.asOf, amount: 1, currency: 'CAD', pending: false, atlasAccountId: 'chequing-a', accountRole: 'household-cash' });
  if (mode === 'unmatched') legs.pop();
  if (['hint-only', 'hint-internal', 'hint-one-leg', 'invalid-reference', 'missing-reference', 'missing-direction', 'identity-flag'].includes(mode)) {
    legs.forEach(row => { row.kindHint = mode === 'hint-internal' ? 'internal-transfer' : 'transfer'; });
    if (['hint-only', 'hint-internal', 'hint-one-leg', 'identity-flag'].includes(mode)) {
      legs.forEach(row => { delete row.tfrReference; delete row.tfrDirection; });
    }
    if (mode === 'hint-one-leg') delete legs[1].kindHint;
    if (mode === 'invalid-reference') legs.forEach(row => { row.tfrReference = 'not-a-reference'; });
    if (mode === 'missing-reference') legs.forEach(row => { delete row.tfrReference; });
    if (mode === 'missing-direction') legs.forEach(row => { delete row.tfrDirection; });
    if (mode === 'identity-flag') legs.forEach(row => { delete row.kindHint; row.internalTransferIdentity = true; });
  }
  if (mode === 'unknown-coverage') input.opts.currentPeriodActuals.transactionCoverage = { complete: false };
  if (mode === 'missing-coverage') delete input.opts.currentPeriodActuals.transactionCoverage;
  if (mode === 'coverage-gap') input.opts.currentPeriodActuals.coverageStart = '2026-10-08';
  if (mode === 'unknown-observation') delete input.opts.currentPeriodActuals.observationAsOf;
  if (mode === 'packet-currency') input.opts.currentPeriodActuals.currency = 'USD';
  if (mode === 'zero-movement') { accounts[0].value = 95; accounts[1].value = 24; legs.forEach(row => { row.amount = 0; }); }
  if (mode === 'coherent-split-dates') { legs[0].date = '2026-10-06'; accounts[0].value = 0;
    accounts.forEach(row => { row.evidenceDate = '2026-10-08'; }); }
  if (mode === 'split-posting-dates') legs[0].date = '2026-10-06';
  if (mode === 'exact-cents') {
    legs[0].amount = 100.01; legs[1].amount = -100.01;
    accounts[0].value = 0; accounts[1].value = 100.01;
    accounts.forEach(row => { row.evidenceDate = '2026-10-08'; });
  }
  const boundary = boundaryCases.find(row => row.name === mode);
  if (boundary) {
    Object.assign(accounts[0], { value: boundary.value, evidenceDate: boundary.date });
    accounts[1].value = ['neither', 'zero-row'].includes(boundary.kind) ? 24 : 0;
    const cash = input.plan.startingCash.breakdown[0];
    const row = (id, amount, account, role) => ({ id, amount, date: boundary.postedDate || '2026-10-07', currency: 'CAD',
      pending: false, atlasAccountId: account, accountRole: role });
    if (['withdraw', 'deposit', 'neither'].includes(boundary.kind)) {
      const source = boundary.kind === 'withdraw' ? 'savings' : 'chequing-a';
      const destination = boundary.kind === 'neither' ? 'chequing-b' : boundary.kind === 'withdraw' ? 'chequing-a' : 'savings';
      legs.splice(0, legs.length,
        { ...row('boundary-out', 100, source, source === 'savings' ? 'household-reserve' : 'household-cash'), tfrReference: 'DD404', tfrDirection: 'TO' },
        { ...row('boundary-in', -100, destination, destination === 'savings' ? 'household-reserve' : 'household-cash'), tfrReference: 'DD404', tfrDirection: 'FR' });
      if (boundary.kind === 'withdraw') cash.value += 100;
      if (boundary.kind === 'deposit') cash.value -= 100;
    } else legs.splice(0, legs.length, row('boundary-direct', boundary.kind === 'fee' ? 1.25
      : boundary.kind === 'credit' ? -100 : boundary.kind === 'zero-row' ? 0 : 100, 'savings', 'household-reserve'));
    const tx = legs[0], counter = legs[1], bad = boundary.bad;
    if (bad === 'currency') tx.currency = 'USD';
    if (bad === 'missing-currency') delete tx.currency;
    if (bad === 'amount') tx.amount = '1.25';
    if (bad === 'null-amount') tx.amount = null;
    if (bad === 'fractional') tx.amount = 1.251;
    if (bad === 'date') delete tx.date;
    if (bad === 'future-date') tx.date = '2026-10-09';
    if (bad === 'impossible-date') tx.date = '2026-02-30';
    if (bad === 'role') tx.accountRole = 'household-cash';
    if (bad === 'missing-role') delete tx.accountRole;
    if (bad === 'alias') tx.accountId = 'chequing-a';
    if (bad === 'account-whitespace') tx.atlasAccountId = ' savings ';
    if (bad === 'missing-account') delete tx.atlasAccountId;
    if (bad === 'id') delete tx.id;
    if (bad === 'duplicate-id') legs.push({ ...tx });
    if (bad === 'pending') tx.pending = true;
    if (bad === 'missing-pending') delete tx.pending;
    if (bad === 'coverage') delete input.opts.currentPeriodActuals.transactionCoverage;
    if (bad === 'coverage-gap') input.opts.currentPeriodActuals.coverageStart = '2026-10-08';
    if (bad === 'observation') delete input.opts.currentPeriodActuals.observationAsOf;
    if (bad === 'currency-flag') input.opts.currentPeriodActuals.currencyUnconfirmed = [{ id: tx.id, currency: null }];
    if (bad === 'outside-currency-flag') input.opts.currentPeriodActuals.currencyUnconfirmed = [{ id: tx.id, currency: null }];
    if (bad === 'counter-currency') counter.currency = 'USD';
    if (bad === 'counter-date') delete counter.date;
    if (bad === 'counter-role') counter.accountRole = 'household-reserve';
    if (bad === 'counter-alias') counter.accountId = 'savings';
    if (bad === 'counter-duplicate') legs.push({ ...counter });
    if (bad === 'counter-currency-flag') input.opts.currentPeriodActuals.currencyUnconfirmed = [{ id: counter.id, currency: null }];
  }
  input.opts.currentPeriodActuals.transactions.push(...legs);
  return input;
}
module.exports = fixture;
module.exports.boundaryCases = boundaryCases;
