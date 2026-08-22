'use strict';
/* Forecast.paydayAllocation — independent numerical proof.
 *
 * Synthetic fixtures only. Live household cents are not the specification
 * (L-006). Each case rebuilds the expected dollars from the fixture inputs
 * rather than reading the function under test back to itself.
 *
 * `node test-payday-allocation.js`
 */
const F = require('./public/forecast.js');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.02) => Math.abs(Number(a) - Number(b)) <= eps;
const clone = x => JSON.parse(JSON.stringify(x));
const AS_OF = '2026-09-01';
const MONTH = 365.25 / 12;

function line(alloc, keyOrKind) {
  return (alloc.lines || []).find(l => l.key === keyOrKind || l.kind === keyOrKind || l.id === keyOrKind) || null;
}
function future(alloc, id) {
  return (alloc.futureCosts || []).find(r => r.id === id) || null;
}
function recon(alloc) {
  const sum = (alloc.lines || []).reduce((s, l) => s + l.amount, 0) + alloc.unallocated;
  return near(sum, alloc.available) && near(alloc.identity, alloc.available);
}

function opts(extra) {
  return Object.assign({
    paydayFloor: 100,
    targetBuffer: 0,
    debts: [],
    extraFacilities: [],
    extraDebtMonthly: 0,
  }, extra || {});
}

function planA(extra) {
  return Object.assign({
    windowDays: 200,
    defaults: { targetBuffer: 0 },
    startingCash: { amount: 500 },
    income: [
      { id: 'p1', label: 'Pay 1', frequency: 'once', date: '2026-09-15', amount: 560, confidence: 'confirmed' },
      { id: 'p2', label: 'Pay 2', frequency: 'once', date: '2026-12-01', amount: 5200, confidence: 'confirmed' },
    ],
    obligations: [],
    bills: [],
    commitments: [
      { id: 'oct', label: 'October cost', date: '2026-10-10', amount: 700, confidence: 'confirmed' },
      { id: 'later', label: 'Later cost', date: '2027-01-15', amount: 5500, confidence: 'confirmed' },
    ],
  }, extra || {});
}

const CARD = [{ id: 'card', label: 'Card', balance: 8000, rate: 19.99, limit: 10000, secured: false }];
const HELOC = [{ id: 'heloc', label: 'HELOC', balance: 0, rate: 5.45, limit: 25000, secured: true }];

console.log('=== A. nearer small vs later large ===');
{
  // Independent: future capacity before 10 Oct is the 15 Sep $560 pay.
  // October remaining $700 → required now $140.
  // Later remaining $5,500; 15 Sep is claimed by October, so later only
  // gets 1 Dec $5,200 → required now $300.
  // Naive nearer-first would spend the $500 cash on October and give later $0.
  const octFuture = 560;
  const laterFuture = 5200;
  const octNow = 700 - octFuture;
  const laterNow = 5500 - laterFuture;
  ok(octNow === 140 && laterNow === 300,
    'independent required-now is $140 and $300',
    `${octNow} / ${laterNow}`);

  const alloc = F.paydayAllocation(planA(), AS_OF, opts());
  const oct = future(alloc, 'oct');
  const later = future(alloc, 'later');
  ok(oct && near(oct.requiredNow, 140) && near(oct.allocated, 140),
    'October is allocated its required pressure, not the full $700',
    oct && `${oct.requiredNow} allocated ${oct.allocated}`);
  ok(later && near(later.requiredNow, 300) && near(later.allocated, 300),
    'the later larger commitment is also funded now',
    later && `${later.requiredNow} allocated ${later.allocated}`);
  ok(oct.allocated < 700 && later.allocated > 0,
    'cash is not exhausted on the nearer item');
  ok(near(alloc.unallocated, 500 - 140 - 300),
    'leftover after both required pressures is independently $60',
    String(alloc.unallocated));
  ok(recon(alloc), 'A reconciles');
}

console.log('\n=== B. redirection ===');
{
  const before = F.paydayAllocation(planA(), AS_OF, opts({ debts: CARD }));
  ok(near(before.extraDebt.allocated, 60),
    'before settlement, leftover after required pressure goes to extra debt',
    String(before.extraDebt.allocated));
  ok(near(future(before, 'oct').allocated, 140),
    'October still takes $140 before it is settled');

  const settled = planA();
  settled.commitments = settled.commitments.map(c =>
    c.id === 'oct' ? Object.assign({}, c, { settledOn: AS_OF }) : c);
  const after = F.paydayAllocation(settled, AS_OF, opts({ debts: CARD }));
  ok(!future(after, 'oct') || !(future(after, 'oct').allocated > 0),
    'settled October no longer takes a payday contribution');
  ok(near(after.extraDebt.allocated, 500) && near(after.unallocated, 0)
    && near(after.essentials.allocated, 0),
    'released capacity redirects to extra debt, not safe-to-spend',
    `extra ${after.extraDebt.allocated} unalloc ${after.unallocated}`);
  ok(after.extraDebt.allocated > before.extraDebt.allocated,
    'extra debt received the redirected dollars');
  ok(recon(after), 'B reconciles');
}

console.log('\n=== C. insufficient cash flow ===');
{
  const broke = planA({
    startingCash: { amount: 50 },
    commitments: [
      { id: 'oct', label: 'October cost', date: '2026-10-10', amount: 700, confidence: 'confirmed' },
      { id: 'later', label: 'Later cost', date: '2027-01-15', amount: 20000, confidence: 'confirmed' },
    ],
  });
  const laterFuture = 5200;
  const laterGap = 20000 - laterFuture;
  const alloc = F.paydayAllocation(broke, AS_OF, opts());
  const later = future(alloc, 'later');
  ok(later && later.verdict === 'FUNDING GAP' && near(later.shortfall, laterGap),
    'later commitment publishes an independent dollar shortfall',
    later && `${later.verdict} ${later.shortfall} vs ${laterGap}`);
  ok(later.allocated <= 50 && later.allocated < later.requiredNow,
    'the engine does not fabricate funding the household does not have',
    String(later.allocated));
  ok((alloc.risks || []).some(r => r.id === 'later' && r.verdict === 'FUNDING GAP'),
    'the allocation result exposes that funding gap as a risk');
  ok(recon(alloc), 'C reconciles');
}

console.log('\n=== D. no auto-borrow ===');
{
  const broke = planA({
    startingCash: { amount: 50 },
    commitments: [
      { id: 'oct', label: 'October cost', date: '2026-10-10', amount: 700, confidence: 'confirmed' },
      { id: 'later', label: 'Later cost', date: '2027-01-15', amount: 20000, confidence: 'confirmed' },
    ],
  });
  const alloc = F.paydayAllocation(broke, AS_OF, opts({ debts: HELOC }));
  ok(alloc.available === 50, 'available cash is still $50, not HELOC room');
  ok(alloc.plannedDebt.permitted === false && near(alloc.plannedDebt.borrowed, 0),
    'HELOC capacity is not treated as permission to borrow');
  ok((alloc.risks || []).some(r => r.verdict === 'FUNDING GAP' && r.shortfall > 0),
    'the cash shortfall remains a funding gap');
  ok(!(alloc.lines || []).some(l => /heloc|borrow/i.test(l.label)),
    'no allocation line is an automatic HELOC draw');
  ok(recon(alloc), 'D reconciles');
}

console.log('\n=== E. essential protection ===');
{
  const days = F.diffDays(AS_OF, '2026-09-14') + 1;
  const essWanted = 300 * days / MONTH;
  const fixture = planA({
    startingCash: { amount: 1000 },
    bills: [{ id: 'rent', label: 'Rent', frequency: 'once', date: '2026-09-05', amount: 400, confidence: 'confirmed' }],
    budget: { categories: [{ id: 'groceries', label: 'Groceries', class: 'essential', plannedMonthly: 300 }] },
    commitments: [
      { id: 'later', label: 'Later cost', date: '2026-09-20', amount: 10000, confidence: 'confirmed' },
      { id: 'opt', label: 'Optional trip', date: '2027-06-01', amount: 5000, optional: true, confidence: 'confirmed' },
    ],
  });
  const alloc = F.paydayAllocation(fixture, AS_OF, opts({ debts: CARD }));
  ok(near(alloc.obligations.allocated, 400),
    'rent is protected as a required obligation', String(alloc.obligations.allocated));
  ok(near(alloc.essentials.allocated, essWanted),
    'essential groceries for the period are protected independently',
    `${alloc.essentials.allocated} vs ${essWanted.toFixed(2)} over ${days} days`);
  const leftover = 1000 - 400 - essWanted;
  ok(alloc.optional.length === 0 || near((alloc.optional[0] && alloc.optional[0].allocated) || 0, 0),
    'optional goals do not take cash before bills and essentials');
  ok(alloc.extraDebt.allocated <= leftover + 0.02,
    'extra debt only receives what remains after protected buckets');
  ok(line(alloc, 'obligations') && line(alloc, 'essentials'),
    'the waterfall names bills and household spending first');
  ok(recon(alloc), 'E reconciles');
}

console.log('\n=== F. dynamic payday liquidity ===');
{
  const quiet = {
    windowDays: 40,
    defaults: { targetBuffer: 0 },
    startingCash: { amount: 2000 },
    income: [{ id: 'pay', label: 'Pay', frequency: 'once', date: '2026-09-15', amount: 1000, confidence: 'confirmed' }],
    obligations: [],
    bills: [{ id: 'small', label: 'Small', frequency: 'once', date: '2026-09-16', amount: 100, confidence: 'confirmed' }],
    commitments: [],
  };
  const heavy = clone(quiet);
  heavy.bills[0] = { id: 'big', label: 'Big', frequency: 'once', date: '2026-09-16', amount: 1800, confidence: 'confirmed' };
  const q = F.paydayAllocation(quiet, AS_OF, opts());
  const h = F.paydayAllocation(heavy, AS_OF, opts());
  // Independent: next pay $1,000 lands 15 Sep. The 16 Sep bill is after this
  // period, so it is liquidity, not a current obligation. Quiet: $1,000 covers
  // $100. Heavy: $1,800 − $1,000 = $800 must be kept from current cash.
  ok(near(q.liquidity.allocated, 0),
    'quiet near-term path keeps no extra liquidity', String(q.liquidity.allocated));
  ok(near(h.liquidity.allocated, 800),
    'bill-heavy path independently keeps $800 liquid', String(h.liquidity.allocated));
  ok(h.liquidity.allocated > q.liquidity.allocated,
    'protected liquidity changes with outflow timing, not a fixed cushion');
  ok(![500, 750, 1000].some(n => near(h.liquidity.allocated, n) && near(q.liquidity.allocated, n)),
    'neither path is an invented $500/$750/$1,000 payday cushion');
  ok(recon(q) && recon(h), 'F reconciles');
}

console.log('\n=== G. unknown deadline ===');
{
  const fixture = planA({
    commitments: [
      { id: 'undated', label: 'Undated cost', amount: 5000, confidence: 'confirmed' },
      { id: 'oct', label: 'October cost', date: '2026-10-10', amount: 700, confidence: 'confirmed' },
    ],
  });
  const alloc = F.paydayAllocation(fixture, AS_OF, opts());
  ok(!future(alloc, 'undated'),
    'an undated amount is not a required future-cost row');
  ok(!(alloc.lines || []).some(l => l.id === 'undated' && l.kind === 'future-cost'),
    'no mandatory set-aside is fabricated for the undated commitment');
  const undatedLine = (alloc.lines || []).find(l => l.id === 'undated');
  if (undatedLine) {
    ok(undatedLine.kind === 'optional',
      'undated residual, if any, uses optional residual semantics', undatedLine.kind);
  } else {
    ok(true, 'undated commitment received no payday contribution');
  }
  ok(!(alloc.futureCosts || []).some(r => r.id === 'undated' && r.date),
    'no date was invented for the undated commitment');
  const oct = future(alloc, 'oct');
  ok(oct && near(oct.allocated, 140),
    'the dated October row still follows required pressure');
  ok(recon(alloc), 'G reconciles');
}

console.log('\n=== H. input independence ===');
{
  const run = amount => F.paydayAllocation(planA({
    startingCash: { amount: 2000 },
    income: [{ id: 'p1', label: 'Pay 1', frequency: 'once', date: '2026-12-01', amount: 1000, confidence: 'confirmed' }],
    commitments: [{ id: 'goal', label: 'Season goal', date: '2027-01-15', amount, confidence: 'confirmed' }],
  }), AS_OF, opts());
  const a = run(3500);
  const b = run(4000);
  const g3500 = future(a, 'goal');
  const g4000 = future(b, 'goal');
  // Independent: one future $1,000 pay before 15 Jan. Required now is
  // remaining − $1,000, capped by the $2,000 cash on hand.
  ok(g3500 && near(g3500.requiredNow, 2500) && near(g3500.allocated, 2000)
    && near(g3500.shortfall, 500),
    '$3,500 target independently requires $2,500 now, allocates $2,000, gap $500',
    g3500 && `${g3500.requiredNow} alloc ${g3500.allocated} gap ${g3500.shortfall}`);
  ok(g4000 && near(g4000.requiredNow, 3000) && near(g4000.allocated, 2000)
    && near(g4000.shortfall, 1000),
    '$4,000 target independently requires $3,000 now, allocates $2,000, gap $1,000',
    g4000 && `${g4000.requiredNow} alloc ${g4000.allocated} gap ${g4000.shortfall}`);
  ok(g4000.shortfall > g3500.shortfall && g4000.requiredNow > g3500.requiredNow,
    'changing the input amount recomputes pressure with no code or policy change');
  ok(recon(a) && recon(b), 'H reconciles');
}

console.log('\n=== I. reconciliation identity ===');
{
  const fixtures = [
    planA(),
    planA({ startingCash: { amount: 50 } }),
    planA({ bills: [{ id: 'rent', label: 'Rent', frequency: 'once', date: '2026-09-05', amount: 200, confidence: 'confirmed' }] }),
  ];
  for (const [i, p] of fixtures.entries()) {
    const alloc = F.paydayAllocation(p, AS_OF, opts({ debts: i === 2 ? CARD : [] }));
    const kinds = {};
    for (const l of alloc.lines || []) {
      ok(!kinds[l.key], `fixture ${i} line key ${l.key} is unique`);
      kinds[l.key] = true;
    }
    ok(recon(alloc), `fixture ${i} available = allocated + unallocated`,
      `${alloc.available} vs ${alloc.allocatedTotal} + ${alloc.unallocated}`);
    ok(near(alloc.available, alloc.opening + alloc.todayIncome),
      `fixture ${i} available is opening plus same-day income, not credit`);
  }
}

console.log('\n=== J. variable future income ===');
{
  // Due 10 Oct. Pays: 15 Sep $100, 29 Sep $1,000, 13 Oct $1,000 (after the
  // deadline). Independent future capacity is $1,100, required now $400.
  // remaining÷3 paycheques = $500; remaining÷2 pre-deadline equal splits
  // would be $750. Neither equals the cash-path answer.
  const fixture = planA({
    startingCash: { amount: 800 },
    income: [
      { id: 'a', label: 'A', frequency: 'once', date: '2026-09-15', amount: 100, confidence: 'confirmed' },
      { id: 'b', label: 'B', frequency: 'once', date: '2026-09-29', amount: 1000, confidence: 'confirmed' },
      { id: 'c', label: 'C', frequency: 'once', date: '2026-10-13', amount: 1000, confidence: 'confirmed' },
    ],
    commitments: [{ id: 'due', label: 'Due', date: '2026-10-10', amount: 1500, confidence: 'confirmed' }],
  });
  const futureCap = 100 + 1000;
  const requiredNow = 1500 - futureCap;
  const naiveN = 1500 / 3;
  const naiveTwo = 1500 / 2;
  const alloc = F.paydayAllocation(fixture, AS_OF, opts());
  const due = future(alloc, 'due');
  ok(due && near(due.requiredNow, requiredNow) && near(due.allocated, requiredNow),
    'required now follows modeled $100+$1,000 before the deadline',
    due && `${due.requiredNow} vs independent ${requiredNow}`);
  ok(!near(due.requiredNow, naiveN) && !near(due.requiredNow, naiveTwo),
    'it is not remaining divided by the count of paycheques',
    `${due.requiredNow} vs /3=${naiveN} /2=${naiveTwo}`);
  ok(recon(alloc), 'J reconciles');
}

console.log('\n=== recommend attaches the same result ===');
{
  const rec = F.recommend(planA(), AS_OF, opts());
  const direct = F.paydayAllocation(planA(), AS_OF, opts());
  ok(rec.paydayAllocation, 'Forecast.recommend attaches paydayAllocation');
  ok(near(rec.paydayAllocation.available, direct.available)
    && near(future(rec.paydayAllocation, 'oct').allocated, future(direct, 'oct').allocated),
    'the attached result matches a direct call');
}

console.log('\n=== no second planner name ===');
{
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, 'public', 'forecast.js'), 'utf8')
    + fs.readFileSync(require('path').join(__dirname, 'public', 'plan.js'), 'utf8');
  ok(!/function paydayEngine|Forecast\.paydayPlan/.test(src),
    'paydayAllocation extends Forecast; it is not a second payday planner');
}

console.log('\n=== page renders Forecast lines in waterfall order ===');
{
  const fs = require('fs');
  const path = require('path');
  const planJs = fs.readFileSync(path.join(__dirname, 'public', 'plan.js'), 'utf8');
  const fn = /function paydayActionRows\([\s\S]*?\n\}$/m.exec(planJs);
  ok(!!fn, 'paydayActionRows is present');
  const body = fn ? fn[0] : '';
  ok(/alloc\.lines/.test(body),
    'the composer reads Forecast.paydayAllocation.lines');
  ok(!/coreKind|extra-debt.: 3/.test(body),
    'it does not reorder extra debt ahead of future-cost set-asides');
  ok(!/b\.amount - a\.amount/.test(body),
    'it does not sort allocation lines by size');
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll payday-allocation proofs passed.');
