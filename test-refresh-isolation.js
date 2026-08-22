'use strict';
/* B92 — ordinary household-value refresh must not rewrite unrelated suites.
 *
 * Mutates a throwaway copy of data.json on disk, runs the other npm test
 * suites in child processes, then restores the original bytes. Never leaves
 * a household figure changed.
 *
 * Live-reconciliation suites are allowed to fail when the mutated fact is
 * the thing they reconcile. Behaviour suites are not.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const F = require('./public/forecast.js');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;

const SUITES = [
  'test-static.js',
  'test-line-endings.js',
  'test-forecast.js',
  'test-income-deadline.js',
  'test-next-due.js',
  'test-next-payment-out.js',
  'test-schedule-authority.js',
  'test-question-status.js',
  'test-unallocated-cash.js',
  'test-compact-snapshot.js',
  'test-publication-totals.js',
  'test-mission.js',
  'test-status-band.js',
  'test-nextmove.js',
  'test-counterfactuals.js',
  'test-renewal.js',
  'test-payoff.js',
  'test-budget.js',
  'test-classification.js',
  'test-weekly-cap.js',
  'test-food-fuel.js',
  'test-plan-phases.js',
  'test-deepdive.js',
  'test-debt.js',
  'test-invariants.js',
  'test-authority-coverage.js',
  'test-evidence-use-register.js',
  'test-mergecard.js',
  'test-live-household.js',
  'test-dedup-facts.js',
  'test-reconcile.js',
  'test-cutover.js',
  'test-b20-history.js',
];

const CASES = [
  {
    id: 'cash',
    label: 'CASE A — Chequing A / starting cash +$1,000',
    allow: ['test-invariants.js', 'test-b20-history.js'],
    mutate(d) {
      const row = d.plan.startingCash.breakdown.find(b => /Chequing A/.test(b.label));
      row.value += 1000;
    },
  },
  {
    id: 'card',
    label: 'CASE B — MBNA posted and current balance +$500',
    allow: ['test-invariants.js', 'test-b20-history.js'],
    mutate(d) {
      const mb = d.debts.find(x => x.id === 'mbna');
      mb.balance += 500;
    },
  },
  {
    id: 'payrollBill',
    label: 'CASE C — payroll +$200 and Shaw +$20',
    allow: ['test-live-household.js'],
    mutate(d) {
      d.plan.income.find(s => s.id === 'payroll').amount += 200;
      d.plan.bills.find(b => b.id === 'shaw').amount += 20;
    },
  },
  {
    id: 'commitment',
    label: 'CASE D — remove Fusion camp commitment from the input',
    // Index pointers into plan.commitments are a current-main routing
    // snapshot. Removing an earlier row can make a later index fail
    // existence. That is related routing, not a household-figure rewrite.
    allow: ['test-evidence-use-register.js'],
    mutate(d) {
      d.plan.commitments = d.plan.commitments.filter(c => c.id !== 'fusioncamp');
    },
  },
];

function runSuite(file) {
  try {
    const out = execFileSync(process.execPath, [file], {
      cwd: ROOT, encoding: 'utf8', timeout: 180000,
    });
    return { file, ok: true, fails: 0, out };
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`;
    const fails = (out.match(/^\s*FAIL\s/gm) || []).length;
    return { file, ok: false, fails: fails || 1, out };
  }
}

function withMutatedData(mutate, fn) {
  const orig = fs.readFileSync(DATA);
  try {
    const data = JSON.parse(orig.toString('utf8'));
    mutate(data);
    fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + '\n');
    return fn();
  } finally {
    fs.writeFileSync(DATA, orig);
  }
}

console.log('=== B92 refresh isolation ===');
const restored = fs.readFileSync(DATA);
const report = [];

for (const c of CASES) {
  console.log(`\n--- ${c.label} ---`);
  const result = withMutatedData(c.mutate, () => {
    const failed = [];
    let asserts = 0;
    for (const file of SUITES) {
      const r = runSuite(file);
      if (!r.ok) {
        failed.push(r);
        asserts += r.fails;
        console.log(`  FAIL  ${file} (${r.fails} assertion(s))`);
      }
    }
    return { failed, asserts };
  });
  const after = fs.readFileSync(DATA);
  ok(Buffer.compare(restored, after) === 0,
    `${c.id}: data.json bytes restored after the mutation`);
  const unexpected = result.failed.filter(f => !c.allow.includes(f.file));
  const expected = result.failed.filter(f => c.allow.includes(f.file));
  ok(unexpected.length === 0,
    `${c.id}: no unrelated behaviour suite fails`,
    unexpected.length
      ? unexpected.map(f => `${f.file}×${f.fails}`).join(', ')
      : 'none');
  for (const name of c.allow) {
    ok(expected.some(f => f.file === name),
      `${c.id}: live recon ${name} still bites when that fact moves`);
  }
  report.push({
    id: c.id,
    failed: result.failed.map(f => `${f.file} (${f.fails})`),
    asserts: result.asserts,
  });
}

console.log('\n=== anti-mutation: financial truth still bites ===');
{
  const fixture = {
    windowDays: 14,
    defaults: { targetBuffer: 0 },
    startingCash: { amount: 500 },
    income: [{ id: 'p', label: 'Pay', frequency: 'once', date: '2026-01-04',
      amount: 1000, confidence: 'confirmed' }],
    obligations: [{ id: 'b', label: 'Bill', frequency: 'once', date: '2026-01-06',
      amount: 400, confidence: 'confirmed' }],
    commitments: [],
  };
  const sim = F.simulate(fixture, '2026-01-01', { weeklyVariable: 70, targetBuffer: 0 });
  const independent = 500 + 1000 - 400 - 140;
  ok(near(sim.ending, independent),
    'synthetic ending matches hand-computed start + in − bill − variable');
  ok(!near(sim.ending, 500 + 1000 - 140),
    'omitting the bill from that identity disagrees — conservation still bites');

  const rec = F.recommendWeekly(fixture, '2026-01-01', { targetBuffer: 100 });
  const days = F.knowledgeHorizon(fixture, '2026-01-01', {}).days;
  const over = F.simulate(fixture, '2026-01-01', {
    weeklyVariable: rec + 10, targetBuffer: 100, horizonDays: days,
  });
  ok(over.min.balance < 100, 'one $10 step above the cap still breaches the floor');

  const live = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const before = F.publicationTotals(live);
  const parent = live.debts.find(d => d.id === 'mbna');
  parent.balance += 500;
  const after = F.publicationTotals(live);
  ok(near(after.totalDebt, before.totalDebt + 500),
    'publication total debt follows a parent balance mutation');
  ok(!near(after.totalDebt, before.totalDebt),
    'and does not stay pinned to the pre-mutation total');

  const monthEnd = F.occurrences(
    { frequency: 'monthly', day: 31 }, '2026-08-09', '2026-11-07');
  ok(monthEnd.join(',') === '2026-08-31,2026-09-30,2026-10-31',
    'monthly day-31 still clamps to 30 Sep — a 31 Sep answer would fail');
  ok(!monthEnd.includes('2026-09-31'), 'September has no 31st');
}

console.log('\n=== blast-radius report ===');
for (const r of report) {
  console.log(`  ${r.id}: ${r.failed.length ? r.failed.join('; ') : 'no suite failures'} (${r.asserts} asserts)`);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
