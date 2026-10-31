'use strict';
// B92's known MBNA +500 negative control reaches B20's snapshot CLI before
// any failed debt assertion. Report that exact reconciliation rejection as
// a real failed assertion; preserve the original error in every case.
function isKnownMbnaReconciliationRejection(error, data, positions, map) {
  if (!error || error.status !== 1 || error.signal || error.code) return false;
  if (String(error.stdout || '') !== '') return false;
  const asOf = data && data.meta && data.meta.asOf;
  if (!asOf || !data.plan || !data.plan.opening || data.plan.opening.asOf !== asOf) return false;
  const debts = (data.debts || []).filter(row => row.id === 'mbna');
  const mappings = ((map && map.mappings) || []).filter(row =>
    row.canonical && row.canonical.collection === 'debts' && row.canonical.id === 'mbna');
  if (debts.length !== 1 || mappings.length !== 1) return false;
  const rows = (positions || []).filter(row => row.account_label === mappings[0].accountLabel && row.as_of === asOf);
  if (rows.length !== 1) return false;
  const canonical = Number(debts[0].balance), position = Number(rows[0].balance);
  if (!Number.isFinite(canonical) || !Number.isFinite(position) || canonical !== position + 500) return false;
  const expected = `mbna: canonical ${canonical} disagrees with positions.csv ${rows[0].balance} on ${asOf}`;
  const stderr = String(error.stderr || '').replace(/\r\n/g, '\n');
  return stderr === expected || stderr === expected + '\n';
}

function snapshotFirstReading(execute, data, positions, map, assertReading) {
  try { return execute(); }
  catch (error) {
    if (isKnownMbnaReconciliationRejection(error, data, positions, map)) {
      assertReading(false, 'current canonical MBNA reading agrees with same-date positions.csv',
        'snapshot writer rejected the intentionally divergent +500 reading');
    }
    // Other errors never manufacture an assertion or an expected-failure token.
    throw error;
  }
}
module.exports = { isKnownMbnaReconciliationRejection, snapshotFirstReading };
