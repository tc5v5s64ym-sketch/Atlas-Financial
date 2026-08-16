'use strict';
/* 2026-08-16 household-evidence absorption.
 * `node test-aug16-evidence.js`
 *
 * Independent proofs for the authorised canonical cleanup. Does not invent a
 * second Forecast, and does not redo PR #79 pending-transaction logic.
 */
const fs = require('fs');
const path = require('path');
const F = require('./public/forecast.js');
const data = require('./data.json');
const { sourceText } = require('./test-source-text');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const money = n => Number(n).toFixed(2);

const questions = sourceText(fs.readFileSync(path.join(__dirname, 'docs/01_OPEN_QUESTIONS.md'), 'utf8'));
const plan = data.plan;
const asOf = data.meta.asOf;
const windowEnd = F.addDays(asOf, (plan.windowDays || 91) - 1);
const tennis = (plan.startingCash.heldElsewhere || []).find(h => h.id === 'amanda-debt-payments');
const spendable = F.startingCashAmount(plan);
const independentSpendable = (plan.startingCash.breakdown || [])
  .reduce((s, r) => s + Number(r.value || 0), 0);

function statusOf(id) {
  const re = new RegExp('### ' + id + '\\.[\\s\\S]*?\\*\\*Status:\\*\\*\\s*([^\\n]+)');
  const m = re.exec(questions);
  return m ? m[1].trim() : null;
}

console.log('=== 1. TENNIS INCOME does not inflate household starting cash ===');
{
  ok(!!tennis && tennis.id === 'amanda-debt-payments',
    'canonical identity remains amanda-debt-payments');
  ok(/TENNIS INCOME/.test(tennis.label),
    'display name is TENNIS INCOME', tennis.label);
  ok(tennis.class === 'operational' && near(tennis.value, 2691.85),
    'held-elsewhere operational balance is unchanged', money(tennis.value));
  ok(near(spendable, independentSpendable) && near(spendable, 79.84),
    'starting cash is the three spendable rows only', money(spendable));
  ok(Math.abs(spendable - (independentSpendable + tennis.value)) > 1,
    'adding TENNIS INCOME would inflate opening cash — and is not done');
}

console.log('\n=== 2. old garage/lab transfer is not forecast as ongoing income ===');
{
  const ids = (plan.income || []).map(s => s.id);
  ok(!ids.includes('garageRent') && !ids.includes('labRent') && !ids.includes('garageLab'),
    'no garage/lab income stream exists on the plan');
  const hay = JSON.stringify(plan.income);
  ok(!/1,?100/.test(hay) || ids.includes('amandaTransfer'),
    'amandaTransfer remains the household-crossing estimate, not the ended rent');
  ok(/^ANSWERED\b/.test(statusOf('Q5')), 'Q5 is ANSWERED', statusOf('Q5'));
  ok(!plan.income.some(s => /garage|lab rent/i.test(s.label + (s.note || ''))),
    'no income row is labelled as garage/lab rent');
}

console.log('\n=== 3. School & clubs is consistently ESSENTIAL ===');
{
  const school = plan.budget.categories.find(c => c.id === 'school');
  ok(school && school.class === 'essential',
    'plan.budget school class is essential', school && school.class);
  ok(/^ANSWERED\b/.test(statusOf('Q24')), 'Q24 is ANSWERED', statusOf('Q24'));
  ok(/essential/i.test(statusOf('Q24') + questions),
    'canonical question records essential');
  const targets = plan.budget.categories.filter(c => c.plannedMonthly != null);
  ok(targets.length === 9, 'nine Aug. 10 owner plannedMonthly targets unchanged in count');
  ok(school.plannedMonthly == null, 'school still has no owner monthly target');
}

console.log('\n=== 4. old Hydro arrears is not a future obligation ===');
{
  const hydro = (plan.bills || []).filter(b => /hydro/i.test(b.id + b.label));
  ok(!hydro.some(b => b.id === 'hydro-due-now' || near(b.amount, 213.79)),
    'no $213.79 / hydro-due-now future bill');
  ok(!hydro.some(b => near(b.amount, 451.24)),
    'the $451.24 account balance is not scheduled');
  const sep = hydro.find(b => b.id === 'hydro-due-sep1');
  ok(sep && near(sep.amount, 237.45) && sep.date === '2026-09-01',
    'Sep. 1 $237.45 Hydro remains');
  ok(/^ANSWERED\b/.test(statusOf('Q17')), 'Q17 arrears portion is ANSWERED', statusOf('Q17'));
}

console.log('\n=== 5. Telus does not recur after owner-confirmed closure ===');
{
  ok(!(plan.bills || []).some(b => /telus/i.test(b.id + b.label)),
    'no Telus plan.bills row');
  ok(/TELUS IS CLOSED/.test(plan.billsNote),
    'billsNote records Telus closed');
  ok(/^OPEN\b/.test(statusOf('Q18')),
    'Q18 remains open only for residual Bell facts', statusOf('Q18'));
  ok(/TELUS IS CLOSED/.test(questions),
    'open-questions file records Telus closed');
}

console.log('\n=== 6. Noble quarterly garbage without duplicating history ===');
{
  const noble = (plan.bills || []).find(b => b.id === 'noble-garbage');
  ok(noble && near(noble.amount, 95.85) && noble.date === '2026-09-18'
    && noble.frequency === 'once' && noble.budgetCategory === 'household',
    'Noble is a once $95.85 due 2026-09-18 household bill');
  const events = F.expandEvents(plan, asOf, windowEnd, {});
  const nobleEvents = events.filter(e => e.id === 'noble-garbage');
  ok(nobleEvents.length === 1 && nobleEvents[0].date === '2026-09-18'
    && near(nobleEvents[0].amount, -95.85),
    'exactly one Noble cash event in the 91-day window');
  ok(!events.some(e => e.id === 'noble-garbage' && e.date === '2026-03-18'),
    'March 18 history is not duplicated as a future event');
  ok(!events.some(e => e.id === 'noble-garbage' && e.date === '2026-06-18'),
    'June 18 is not invented as arrears');
}

console.log('\n=== 7–8. Triangle posted/pending stay separate; Aug. 10 payment recorded without on-time claim ===');
{
  const tri = data.debts.find(d => d.id === 'triangle');
  ok(tri && near(tri.balance, 13197) && near(tri.pending, 15.62),
    'Triangle posted $13,197.00 pending $15.62',
    `${money(tri.balance)} + ${money(tri.pending)}`);
  const exposure = Math.round((tri.balance + tri.pending) * 100) / 100;
  ok(near(exposure, 13212.62),
    'independent exposure is posted+pending $13,212.62', money(exposure));
  ok(!near(tri.balance, exposure),
    'posted is not silently collapsed to exposure');
  const obl = plan.obligations.find(o => o.id === 'triangle');
  const hay = [tri.pendingNote, tri.note, obl && obl.note].filter(Boolean).join(' ');
  ok(/2026-08-10|Aug\. 10/.test(hay) && /\$300/.test(hay),
    'Aug. 10 $300 payment is recorded');
  ok(/on-time/i.test(hay) && /not proven/i.test(hay),
    'on-time status is not invented');
  ok(/287\.38/.test(hay) && /not household cash|never cash/i.test(hay),
    'available credit is not converted to household cash');
}

console.log('\n=== 9. MBNA current $8,003.61; statement owns min/due/APR ===');
{
  const mbna = data.debts.find(d => d.id === 'mbna');
  const obl = plan.obligations.find(o => o.id === 'mbna');
  ok(mbna && near(mbna.balance, 8003.61) && near(mbna.pending, 0),
    'current posted is $8,003.61 pending $0', money(mbna.balance));
  ok(!near(mbna.balance, 7855.12),
    'current is not rounded back to the statement amount');
  ok(obl && near(obl.amount, 158.27) && obl.day === 31,
    'statement minimum $158.27 due month-end stays on the obligation');
  ok(/21\.74/.test(mbna.rateBasis) && near(mbna.rate, 21.74),
    'purchase APR 21.74% comes from the statement');
  ok(/22\.99/.test(mbna.rateBasis),
    'cash advance / BT APR 22.99% comes from the statement');
  ok(mbna.nextDue === '2026-08-31', 'due date 2026-08-31');
  ok(near(mbna.annualInterest, 1779.24),
    'annualInterest remains $148.27 × 12', money(mbna.annualInterest));
}

console.log('\n=== 10–11. stale Fusion 3 × $500 gone; future estimate is not a confirmed invoice ===');
{
  const ids = (plan.commitments || []).map(c => c.id);
  ok(!ids.includes('fusion-sep') && !ids.includes('fusion-oct') && !ids.includes('fusion-nov'),
    'the three live-plan $500 Fusion rows are gone');
  const events = F.expandEvents(plan, asOf, windowEnd, {});
  ok(!events.some(e => /fusion-sep|fusion-oct|fusion-nov/.test(e.id)
    || (e.label && /Fusion season —/.test(e.label) && near(Math.abs(e.amount), 500))),
    'Forecast emits no confirmed $500 Fusion season cash events');
  const item = (data.commitments.items || []).find(i => /Fusion upcoming/i.test(i.what));
  ok(item && item.confidence === 'estimated' && /TBD|unknown/i.test(item.when + item.note),
    'upcoming Fusion is an estimated planning item, not a confirmed invoice');
  ok(/^ANSWERED\b/.test(statusOf('Q23')), 'Q23 is ANSWERED', statusOf('Q23'));
}

console.log('\n=== 12–13. Burrards registrations settled; ~$700 team fees remain estimated ===');
{
  const b1 = plan.commitments.find(c => c.id === 'burrard1');
  const b2 = plan.commitments.find(c => c.id === 'burrard2');
  ok(b1 && b1.settledOn === '2026-08-16' && b2 && b2.settledOn === '2026-08-16',
    'both Burrards registrations are settledOn 2026-08-16');
  const events9 = F.expandEvents(plan, asOf, windowEnd, {});
  ok(events9.some(e => e.id === 'burrard1') && events9.some(e => e.id === 'burrard2'),
    'an Aug. 9 opening still reserves them (settledOn is after as-of)');
  const events16 = F.expandEvents(plan, '2026-08-16', F.addDays('2026-08-16', 90), {});
  ok(!events16.some(e => e.id === 'burrard1' || e.id === 'burrard2'),
    'an Aug. 16 opening omits the paid registrations');
  const fees = (data.commitments.items || []).find(i => /Burrards upcoming team/i.test(i.what));
  ok(fees && fees.confidence === 'estimated' && near(fees.amount, 700)
    && /TBD|unknown/i.test(fees.when + fees.note),
    '~$700 team fees remain estimated/TBD');
  ok(!(plan.commitments || []).some(c => /team fee/i.test(c.label) && near(c.amount, 700)),
    'no fabricated exact Burrards team-fee plan.commitments row');
}

console.log('\n=== 14–15. Bell baseline is not $356.62; pending $250 is not double-counted ===');
{
  ok(!(plan.bills || []).some(b => /bell/i.test(b.id + b.label)),
    'no Bell row is dated as a joint-cash bill');
  ok(!(plan.bills || []).some(b => near(b.amount, 356.62) || near(b.amount, 104.20)),
    'neither $356.62 nor ~$104.20 is a dated cash bill');
  const facts = fs.readFileSync(path.join(__dirname, 'docs/ACCOUNT_FACTS.md'), 'utf8');
  ok(/\$356\.62/.test(facts) && /104\.20/.test(facts),
    'ACCOUNT_FACTS records the Aug bill and the June baseline separately');
  ok(/inferred residual/i.test(facts) && /\$250/.test(facts),
    'the $250 pending payment is recorded without marking Bell fully settled');
  ok(!/second Bell \$250 expense/i.test(JSON.stringify(plan.bills)),
    'plan.bills does not invent a second Bell $250 expense');
}

console.log('\n=== 16–18. HELOC interest posting and cash payment stay distinct; Aug. 1 not silently paid ===');
{
  const heloc = plan.obligations.find(o => o.id === 'heloc');
  const debt = data.debts.find(d => d.id === 'heloc');
  ok(heloc && heloc.nonCash === true && near(heloc.amount, 814.18),
    'HELOC obligation remains non-cash $814.18');
  ok(debt && near(debt.cashPayment, 0) && debt.interestTreatment === 'capitalised',
    'cashPayment stays $0; interest is capitalised');
  const events = F.expandEvents(plan, asOf, windowEnd, {});
  ok(!events.some(e => e.id === 'heloc' && e.kind !== 'noncash'),
    'no HELOC chequing outflow was invented');
  ok(!events.some(e => e.id === 'heloc' && e.date === '2026-08-01'),
    'Aug. 1 PAD is not fabricated as a cash event');
  ok(/^OPEN\b/.test(statusOf('Q19')), 'Q19 remains OPEN', statusOf('Q19'));
  ok(/must not claim confident zero household\s+cash impact/i.test(questions),
    'Q19 still forbids claiming confident zero cash impact');
}

console.log('\n=== 19. Q20 and Q21 remain unresolved ===');
{
  ok(/^OPEN\b/.test(statusOf('Q20')), 'Q20 emergency reserve remains OPEN', statusOf('Q20'));
  ok(/^OPEN\b/.test(statusOf('Q21')), 'Q21 $527.80 remains OPEN', statusOf('Q21'));
  ok(/does \*\*not\*\* currently know|does not currently know/i.test(questions),
    'Q20 records that the owner does not know the emergency-cash target');
}

console.log('\n=== nine owner budget targets unchanged ===');
{
  const want = {
    groceries: 1800, fuel: 1300, household: 150, health: 100,
    pets: 110, sport: 250, subscriptions: 300,
    restaurants: 800, shopping: 600,
  };
  for (const [id, amt] of Object.entries(want)) {
    const c = plan.budget.categories.find(x => x.id === id);
    ok(c && near(c.plannedMonthly, amt), `${id} plannedMonthly still ${amt}`);
  }
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
