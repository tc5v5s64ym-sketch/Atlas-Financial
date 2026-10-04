'use strict';
const source = require('./card-backfill-data');
const O = require('../../scripts/provider-observe');
module.exports = function fixture(stage = 'purchase') {
  const x = source();
  x.data.plan.cardPurchaseCoverage = {
    opening: { asOf: '2026-09-18', confirmed: true, currency: 'cad',
      fundingAccountId: 'chequing-a', purchases: [] },
    payments: [], refunds: [], reversals: []
  };
  x.payload.transactions.forEach(t => { t.currency = 'cad'; });
  if (stage !== 'backfill') {
    x.payload.transactions = x.payload.transactions.slice(0, stage === 'before' ? 0 : 1);
    x.payload.accounts[0].balance = 500;
    x.payload.accounts[3].balance = stage === 'before' ? 400 : 480;
  }
  return x;
};
module.exports.ref = (x,id) => {
  const raw = x.payload.transactions.find(t=>t.id===id);
  if (!raw) throw new Error('Synthetic reference row missing: '+id);
  return O.cardCoverageReference(O.normalizeLunchMoneyTransaction(raw));
};
module.exports.confirm = (x,id,debitId,creditId,allocations,otherAmount=0,otherPurpose=null) => {
  x.data.plan.cardPurchaseCoverage.payments.push({ id, confirmed:true,
    debitRef:module.exports.ref(x,debitId),creditRef:module.exports.ref(x,creditId),
    allocations:allocations.map(([purchaseId,amount])=>({purchaseRef:module.exports.ref(x,purchaseId),amount})),
    otherAmount,otherPurpose });
  return x;
};
