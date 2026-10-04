'use strict';
// Each caller explicitly asserts an empty coverage ledger at this synthetic
// cutover. This is never derived from a balance, amount, timing or fetched rows.
module.exports = asOf => ({ opening: { asOf, confirmed: true, currency: 'cad',
  fundingAccountId: 'chequing-a', purchases: [] }, payments: [], refunds: [], reversals: [] });
module.exports.packet = packet => packet && { ...packet,
  ...(Array.isArray(packet.transactions) ? { transactions: packet.transactions.map(tx => ({
    currency: 'cad', coverageRef: tx.id == null ? null : 'synthetic-' + tx.id, ...tx })) } : {}) };
