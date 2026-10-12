'use strict';
// Independent conservation ledger: before A=100/B=0; after A=0/B=100.
const fx = require('./savings-daily-allocation-contract');
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
  input.opts.currentPeriodActuals.transactions.push(...legs);
  return input;
}
module.exports = fixture;
