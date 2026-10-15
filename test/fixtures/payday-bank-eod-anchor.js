'use strict';
// Wholly invented accounts, dates, source references and cents.
const gap = require('./payday-gap-reserve-data');
const clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const i = gap.input();
  i.window.startDate = '2026-09-29';
  // Bank B: start34 - earlier debit4 - later debit7 = EOD23.
  // Original B30 is preserved; no claim about its intraday cutoff is needed.
  i.transactions.unshift(
    { id:'invented-opening-day-first', date:'2026-09-29', amount:4, currency:'CAD', pending:false,
      atlasAccountId:'chequing-b', accountRole:'household-cash' },
    { id:'invented-opening-day-second', date:'2026-09-29', amount:7, currency:'CAD', pending:false,
      atlasAccountId:'chequing-b', accountRole:'household-cash' });
  const payload = gap.payload(i);
  payload.accounts.find(a => a.id === '9102').balance = 23;
  payload.transactions = i.transactions.map((t, n) => ({ id:'invented-provider-'+n,
    account_id:t.atlasAccountId === 'chequing-b' ? 9102 : 9101, date:t.date, amount:t.amount,
    currency:'CAD', is_pending:false, payee:'INVENTED CASH LEG '+n }));
  const data = { meta:{asOf:'2026-09-29'}, plan:i.plan, debts:[] };
  data.plan.opening.cashReconstructionAnchor = {
    source:'bank-statement', asOf:'2026-09-29', includedThrough:'end-of-household-day',
    timezone:'America/Vancouver', currency:'CAD', ownerApproved:true,
    approvalRef:'invented-owner-approval-only',
    accounts:[{id:'chequing-a', value:70, statementRef:'invented-bank-a'},
      {id:'chequing-b', value:23, statementRef:'invented-bank-b'}],
  };
  return { ...i, data, payload };
}
module.exports = { fixture, clone };
