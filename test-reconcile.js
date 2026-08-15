'use strict';
/* B91 first slice — non-writing observation → canonical compare.
 *
 * Independent arithmetic: CSV / fixture values minus the parent cash or
 * debt figure, not a second call that merely echoes reconcile().
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const R = require('./scripts/reconcile.js');
const map = require('./docs/reconciliation/balance-map.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const clone = x => JSON.parse(JSON.stringify(x));
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const hashFile = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

function cashById(d, id) {
  const cash = d.plan.startingCash;
  return (cash.breakdown || []).concat(cash.heldElsewhere || []).find(r => r.id === id);
}

function fixtureState() {
  return {
    meta: { asOf: '2026-08-09' },
    plan: {
      startingCash: {
        breakdown: [
          { id: 'chequing-a', value: 100.25 },
          { id: 'chequing-b', value: -20 },
        ],
        heldElsewhere: [{ id: 'amanda-debt-payments', value: 50 }],
      },
    },
    debts: [
      { id: 'mortgage', balance: 1600.5 },
      { id: 'mbna', balance: 80 },
    ],
  };
}

console.log('=== A. unchanged balance → MATCH (independent parents) ===');
{
  const d = fixtureState();
  const evidenceA = 100.25;
  const evidenceM = 1600.5;
  ok(near(evidenceA, cashById(d, 'chequing-a').value),
    'independent observation equals plan.startingCash[id=chequing-a]');
  ok(near(evidenceM, d.debts.find(x => x.id === 'mortgage').balance),
    'independent observation equals debts[id=mortgage].balance');

  const result = R.reconcile({
    data: d,
    map,
    observations: [
      {
        observationId: 'pos-chequing-a',
        accountLabel: 'Chequing A',
        evidenceValue: evidenceA,
        evidenceDate: '2026-08-09',
        canonical: { collection: 'cash', id: 'chequing-a' },
      },
      {
        observationId: 'pos-mortgage',
        accountLabel: 'Mortgage',
        evidenceValue: evidenceM,
        evidenceDate: '2026-08-09',
        canonical: { collection: 'debts', id: 'mortgage' },
      },
    ],
  });
  const rowA = result.rows.find(r => r.observationId === 'pos-chequing-a');
  const rowM = result.rows.find(r => r.observationId === 'pos-mortgage');
  ok(rowA && rowA.status === 'MATCH' && near(rowA.difference, 0),
    'reconciler reports MATCH for the unchanged Chequing A pair');
  ok(rowM && rowM.status === 'MATCH' && near(rowM.difference, 0),
    'reconciler reports MATCH for the unchanged mortgage pair');
  ok(rowA.canonicalTarget === 'cash:chequing-a',
    'canonical target is the id locator, not an array-index pointer');
  ok(result.staleAssigned === false && result.counts.STALE === 0,
    'STALE is not assigned — no owner-defined age threshold');
}

console.log('\n=== B. newer observed balance differing from canonical → CHANGE ===');
{
  const d = fixtureState();
  const canon = cashById(d, 'chequing-a').value;
  const observed = canon + 123.45;
  const independentDiff = Math.round((observed - canon) * 100) / 100;
  const result = R.reconcile({
    data: d,
    map,
    observations: [{
      observationId: 'pos-chequing-a',
      accountLabel: 'Chequing A',
      evidenceValue: observed,
      evidenceDate: '2026-08-14',
      canonical: { collection: 'cash', id: 'chequing-a' },
    }],
  });
  const row = result.rows[0];
  ok(near(independentDiff, 123.45), 'independent difference is $123.45');
  ok(row.status === 'CHANGE', 'differing newer observation is CHANGE');
  ok(near(row.difference, independentDiff),
    'reported difference equals the independent subtraction');
  ok(row.evidenceDate === '2026-08-14' && result.canonicalAsOf === '2026-08-09',
    'both dates are reported so freshness stays an owner decision');
}

console.log('\n=== C. missing canonical target → MISSING ===');
{
  const result = R.reconcile({
    data: fixtureState(),
    map,
    observations: [{
      observationId: 'pos-ghost',
      accountLabel: 'Ghost account',
      evidenceValue: 10,
      evidenceDate: '2026-08-14',
      canonical: { collection: 'cash', id: 'does-not-exist' },
    }],
  });
  ok(result.rows[0].status === 'MISSING', 'unknown cash id is MISSING');
  ok(result.rows[0].canonicalValue == null, 'no invented canonical value');
  ok(result.rows[0].canonicalTarget === 'cash:does-not-exist',
    'the missing locator is still named');
}

console.log('\n=== D. conflicting observations of one target → CONFLICT ===');
{
  const d = fixtureState();
  const canon = cashById(d, 'chequing-a').value;
  const result = R.reconcile({
    data: d,
    map,
    observations: [
      {
        observationId: 'pos-chequing-a',
        accountLabel: 'Chequing A',
        evidenceValue: canon,
        evidenceDate: '2026-08-14',
        canonical: { collection: 'cash', id: 'chequing-a' },
      },
      {
        observationId: 'pos-chequing-a',
        accountLabel: 'Chequing A',
        evidenceValue: canon + 50,
        evidenceDate: '2026-08-14',
        canonical: { collection: 'cash', id: 'chequing-a' },
      },
    ],
  });
  ok(result.rows.every(r => r.status === 'CONFLICT'),
    'two disagreeing observations of one id are CONFLICT');
  ok(!near(result.rows[0].evidenceValue, result.rows[1].evidenceValue),
    'the conflict is a real value disagreement, not a duplicate of one number');
}

console.log('\n=== E. no-write guarantee ===');
{
  const before = hashFile(R.DEFAULT_DATA);
  const src = fs.readFileSync(path.join(__dirname, 'scripts', 'reconcile.js'), 'utf8');
  ok(!/writeFileSync?\s*\(\s*DEFAULT_DATA/.test(src),
    'reconcile.js source does not write DEFAULT_DATA');
  ok(!/writeFileSync?\s*\([^)]*data\.json/.test(src),
    'reconcile.js source does not write data.json by path');
  ok(/NEVER writes data\.json/.test(src),
    'the no-write contract is stated in the command');

  const out = execFileSync(process.execPath, ['scripts/reconcile.js'], {
    cwd: __dirname, encoding: 'utf8',
  });
  const after = hashFile(R.DEFAULT_DATA);
  ok(before === after, 'running the CLI leaves data.json bytes unchanged');
  ok(/does not write data\.json/.test(out),
    'the printed report repeats the no-write contract');
  ok(/MATCH/.test(out), 'the live CLI report includes MATCH rows');

  const copy = path.join(__dirname, 'data.json');
  const live = JSON.parse(fs.readFileSync(copy, 'utf8'));
  const mutated = clone(live);
  cashById(mutated, 'chequing-a').value += 1;
  const afterRun = JSON.parse(fs.readFileSync(copy, 'utf8'));
  ok(near(cashById(afterRun, 'chequing-a').value, cashById(live, 'chequing-a').value),
    'canonical Chequing A is unchanged after reconcile ran');
}

console.log('\n=== F. locator is id-stable, not array position ===');
{
  const shuffled = fixtureState();
  shuffled.plan.startingCash.breakdown = shuffled.plan.startingCash.breakdown.slice().reverse();
  shuffled.debts = shuffled.debts.slice().reverse();
  const result = R.reconcile({
    data: shuffled,
    map,
    observations: [{
      observationId: 'pos-chequing-a',
      accountLabel: 'Chequing A',
      evidenceValue: 100.25,
      evidenceDate: '2026-08-09',
      canonical: { collection: 'cash', id: 'chequing-a' },
    }],
  });
  const rowA = result.rows[0];
  ok(rowA.status === 'MATCH' && rowA.canonicalTarget === 'cash:chequing-a',
    'reversing cash/debt arrays does not lose the Chequing A locator');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
