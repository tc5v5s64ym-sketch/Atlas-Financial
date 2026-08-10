'use strict';
/* Data and authority invariants. `node test-invariants.js`

   ONE FACT, ONE HOME. This file is where that principle is enforced rather
   than merely stated. A contradiction between two parts of the repository is
   a TEST FAILURE, not a warning — a financial plan that disagrees with itself
   is worse than no plan, because it still looks authoritative.

   Every check here exists because the contradiction it tests for was real. */

const fs = require('fs');
const path = require('path');
const F = require('./public/forecast.js');
const data = require('./data.json');
const periods = require('./public/periods.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const money = n => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const read = p => fs.readFileSync(path.join(__dirname, p), 'utf8');

const plan = data.plan;
const asOf = data.meta.asOf;

console.log('=== cash classification ===');
const cash = plan.startingCash;
const CLASSES = ['spendable', 'operational', 'staging', 'other-liquid', 'restricted'];
const spendableSum = cash.breakdown.reduce((s, b) => s + b.value, 0);
ok(near(spendableSum, cash.amount),
  'spendable household cash equals its component accounts',
  `${money(spendableSum)} = ${money(cash.amount)}`);
ok(cash.breakdown.every(b => b.class === 'spendable'),
  'every account inside the plan opening balance is classified spendable');
ok((cash.heldElsewhere || []).every(h => CLASSES.includes(h.class)),
  'every excluded pot carries a real classification',
  (cash.heldElsewhere || []).map(h => h.class).join(', '));
ok((cash.heldElsewhere || []).every(h => h.class !== 'spendable'),
  'nothing excluded from the plan is labelled spendable');

// Amanda's account is operational, not household money. This is the whole
// reason the plan opens at $79.84 rather than $2,771.69.
const amanda = (cash.heldElsewhere || []).find(h => /DEBT&PAYMENTS/.test(h.label));
ok(amanda && amanda.class === 'operational',
  "Amanda's DEBT&PAYMENTS account is operational / pass-through, not spendable",
  amanda ? money(amanda.value) : 'missing');

// The cash register must still reconcile to the balance sheet: every cash
// account in `assets` appears in exactly one class, and the totals agree.
const cashAccounts = cash.breakdown.concat(cash.heldElsewhere || []);
const registerTotal = cashAccounts.reduce((s, a) => s + a.value, 0);
const assetCashLabels = ['DEBT&PAYMENTS chequing', 'Chequing A', 'Chequing B', 'Savings',
  'SAVINGS-DONT TOUCH', 'Wise (two US spending accounts)'];
const assetCashTotal = data.assets
  .filter(a => assetCashLabels.includes(a.label))
  .reduce((s, a) => s + a.value, 0);
ok(near(registerTotal, assetCashTotal),
  'the cash register reconciles to the cash rows on the balance sheet',
  `${money(registerTotal)} vs ${money(assetCashTotal)}`);
ok(cashAccounts.length === assetCashLabels.length,
  'and covers exactly the same accounts, no more and no fewer',
  `${cashAccounts.length} accounts`);

// The defect this replaced: a headline tile that added all six together.
ok(!data.headline.some(h => /cash on hand/i.test(h.label)),
  'the undifferentiated "Cash on hand" headline is gone',
  'it summed spendable, pass-through, staging and US holiday money as one figure');
ok(/startingCash/.test(read('public/deepdive.js')),
  'the Deep Dive cash tile derives from the plan cash register instead');

console.log('\n=== assets and debts reconcile ===');
const assetTotal = data.assets.reduce((s, a) => s + a.value, 0);
ok(near(assetTotal, data.netWorth.assets),
  'assets sum to the published net-worth asset figure',
  `${money(assetTotal)} vs ${money(data.netWorth.assets)}`);
const debtTotal = data.debts.reduce((s, x) => s + (x.balance || 0), 0);
ok(near(debtTotal, data.netWorth.debts),
  'debts sum to the published net-worth debt figure',
  `${money(debtTotal)} vs ${money(data.netWorth.debts)}`);
const secured = data.debts.filter(x => x.secured).reduce((s, x) => s + x.balance, 0);
const consumer = data.debts.filter(x => !x.secured).reduce((s, x) => s + x.balance, 0);
ok(near(secured + consumer, debtTotal),
  'secured plus consumer debt is the whole of it',
  `${money(secured)} + ${money(consumer)}`);
ok(data.debts.every(x => typeof x.secured === 'boolean'),
  'every debt declares whether it is secured');

console.log('\n=== HELOC semantics agree everywhere ===');
const heloc = plan.obligations.find(o => o.id === 'heloc');
ok(heloc && heloc.nonCash === true,
  'the plan marks HELOC interest as a non-cash charge');
const withHeloc = F.simulate(plan, asOf, { scenario: 'expected', weeklyVariable: 0, targetBuffer: 500 });
const stripped = JSON.parse(JSON.stringify(plan));
stripped.obligations = stripped.obligations.filter(o => !o.nonCash);
const without = F.simulate(stripped, asOf, { scenario: 'expected', weeklyVariable: 0, targetBuffer: 500 });
ok(near(withHeloc.ending, without.ending),
  'and it therefore moves no cash', `${money(withHeloc.ending)} either way`);
ok(withHeloc.totals.noncash > 0,
  'while still being tracked as a real economic cost', money(withHeloc.totals.noncash));
// The economic cost has to appear on the debt side, or it is being hidden.
ok(/capitalis/i.test(read('docs/ACCOUNT_FACTS.md')),
  'ACCOUNT_FACTS records the capitalisation');
ok(/capitalis/i.test(JSON.stringify(plan.assumptions)),
  'and the plan assumptions say so too');

// One canonical HELOC fact, and no page may contradict it.
const helocDebt = data.debts.find(x => x.id === 'heloc');
ok(helocDebt.interestTreatment === 'capitalised',
  'the debt record is the canonical home for how HELOC interest is treated',
  helocDebt.interestTreatment);
ok(helocDebt.cashPayment === 0,
  'and it says $0.00 of household cash leaves for it', money(helocDebt.cashPayment));
ok(helocDebt.monthlyInterest > 0,
  'while the economic cost is stated separately', money(helocDebt.monthlyInterest));
ok(heloc.nonCash === true && near(heloc.amount, helocDebt.monthlyInterest),
  'the plan obligation agrees with it on both counts', money(heloc.amount));

// The Modeller added the $814.18 to the mortgage and called the total "today",
// which invented a household bill that nobody pays.
const modellers = read('public/modellers.js');
ok(/cashPayment/.test(modellers),
  'the Modeller reads the cash figure, not the interest charge');
ok(!/const helocNow = heloc\.payment/.test(modellers),
  'and no longer treats the capitalised charge as a monthly payment');
ok(/interestTreatment === 'capitalised'/.test(modellers),
  'it branches on the canonical fact rather than assuming');
ok(/economic/i.test(modellers),
  'and labels the economic cost separately from household cash');

// Deep Dive listed it among ordinary dated payments.
const helocUpcoming = data.upcoming.filter(u => /HELOC/i.test(u.what));
ok(helocUpcoming.length > 0, 'the HELOC charge still appears on the dated list');
ok(helocUpcoming.every(u => u.kind === 'noncash'),
  'but marked non-cash, not as a payment falling due',
  helocUpcoming.map(u => u.kind).join(', '));
ok(helocUpcoming.every(u => !/minimum/i.test(u.what)),
  'and no longer called a "minimum"', helocUpcoming.map(u => u.what).join(', '));
ok(/noncash/.test(read('public/deepdive.js')),
  'Deep Dive renders a non-cash row differently from a payment');

// The stale cash figures in the note predated the $79.84 household-cash model.
ok(!/roughly \$874|nearer \$590/.test(data.upcomingNote),
  'the upcoming note no longer quotes cash figures from the pre-classification model');
ok(/79\.84|\$79/.test(data.upcomingNote),
  'and states the spendable household position instead');

console.log('\n=== positions.csv cannot disagree with canonical state ===');
// It is DERIVED reporting output for its computed rows. Running the generator
// in --check mode is the invariant: if data.json has moved and the CSV has not,
// this fails rather than quietly publishing two balance sheets.
const posGen = require('child_process').spawnSync(process.execPath,
  ['scripts/positions-summary.js', '--check'], { cwd: __dirname, encoding: 'utf8' });
ok(posGen.status === 0, 'positions.csv computed rows reconcile with data.json',
  posGen.status === 0 ? 'in step' : (posGen.stderr || '').split('\n').slice(0, 3).join(' | '));

// And the detail rows, which are a captured record rather than generated.
const csv = read('docs/positions.csv').split(/\r?\n/).map(r => {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < r.length; i++) {
    const c = r[i];
    if (c === '"') { if (q && r[i + 1] === '"') { cur += '"'; i++; } else q = !q; continue; }
    if (c === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur); return out;
});
const csvVal = label => {
  const row = csv.find(c => c[2] === label);
  return row ? Number(row[6]) : null;
};
ok(near(csvVal('Total visible assets'), assetTotal),
  'the CSV asset total equals data.json', money(csvVal('Total visible assets')));
ok(near(csvVal('Total known debt'), debtTotal),
  'and the debt total', money(csvVal('Total known debt')));
ok(near(csvVal('Financial-account net worth'), assetTotal - debtTotal),
  'and financial-account net worth', money(csvVal('Financial-account net worth')));
ok(csvVal('Silver bullion') != null,
  'the silver has a position row — its absence was the drift',
  money(csvVal('Silver bullion') || 0));
// Every debt in data.json must have a matching CSV row at the same balance.
for (const x of data.debts) {
  const row = csv.find(c => c[4] === 'Liability' && Math.abs(Number(c[6]) - x.balance) < 0.01);
  ok(!!row, `debt "${x.label}" has a matching position row`, money(x.balance));
}

console.log('\n=== the page does not contradict itself ===');
// Three ways it did, all found by exact-head review of a84b7e9.
const planJs2 = read('public/plan.js');

// 1. A funding source was chosen on `unusable` alone, so raising the buffer
//    knob past a source's balance still credited the full amount as a
//    debt-free transfer and declared the plan sound.
ok(/fundingSources/.test(planJs2),
  'the page hands the ranked sources to the engine rather than choosing one itself');
ok(/advice\.funding/.test(planJs2), 'and reads the allocation back');
{
  const SRC = { scenario: 'expected', incomeOverrides: {}, disabled: [], extraDebtMonthly: 0,
    fundingSources: plan.funding.options };
  const ranked = plan.funding.options.slice().sort((a, b) => a.rank - b.rank).filter(o => !o.unusable);

  // Default buffer: one source, nothing borrowed.
  const base = F.recommend(plan, asOf, Object.assign({}, SRC, { targetBuffer: 500 }));
  ok(base.funding.feasible && base.funding.parts.length === 1 && base.funding.borrowed === 0,
    'at the $500 buffer one debt-free source covers the gap',
    base.funding.parts.map(p => p.short).join(' + '));

  // Raised buffer: the gap outruns the largest source but a COMBINATION works,
  // and the borrowed part must land on the facility it is drawn from.
  const big = F.recommend(plan, asOf, Object.assign({}, SRC, { targetBuffer: 3000 }));
  ok(big.gap.amount > ranked[0].available,
    'at a $3,000 buffer the gap exceeds the largest single source',
    `${money(big.gap.amount)} vs ${money(ranked[0].available)}`);
  ok(big.funding.feasible && big.funding.needsCombination,
    'but a combination reaches it, so the plan is feasible',
    big.funding.parts.map(p => `${p.short} ${money(p.amount)}`).join(' + '));
  ok(near(big.funding.borrowed, 851.31),
    'and the shortfall against the free source is borrowed', money(big.funding.borrowed));
  const bigProj = F.projectDebts(plan, data.debts, asOf,
    Object.assign({}, big.simOptions, { weeklyVariable: big.weekly, extraFacilities: data.revolvingExtra }));
  ok(near(bigProj.byId.heloc.drawn, big.funding.borrowed),
    'the debt projection records that draw against the HELOC', money(bigProj.byId.heloc.drawn));
  const cross = bigProj.crossings.find(c => c.id === 'heloc' && !c.alreadyOver);
  ok(cross && cross.date === '2026-08-31',
    'so the HELOC crossing moves to 31 August, not the 30 September of a debt-free injection',
    cross ? cross.date : 'none');

  // Beyond every source combined: infeasible, and modelled as such.
  const huge = F.recommend(plan, asOf, Object.assign({}, SRC, { targetBuffer: 8000 }));
  ok(!huge.funding.feasible && huge.funding.shortfall > 0,
    'a gap beyond every source combined is reported unfunded, not silently filled',
    money(huge.funding.shortfall));
  const injected = huge.funding.parts.reduce((a, p) => a + p.amount, 0);
  ok(injected < huge.gap.amount,
    'and only what can actually be funded is injected',
    `${money(injected)} of ${money(huge.gap.amount)}`);
}
ok(/fundingShort/.test(planJs2), 'the page has a state for an unfundable gap');
ok(/needsCombination/.test(planJs2), 'and one for a gap that takes more than one source');
// The funding cards judged sources against the day's payment while the band
// judged them against the gap, so they disagreed on screen.
ok(/const needed = fundingGap/.test(planJs2),
  'the funding cards are judged against the gap, not the day\'s payment');
ok(!/const enough = o\.available >= dueThatDay/.test(planJs2),
  'the old dueThatDay verdict is gone');

// 2. Two budget explanations on one page disagreed about provenance: the cap
//    section said nine owner targets, the detailed section said none.
ok(!/No owner-built budget has been supplied/.test(planJs2),
  'the detailed budget no longer claims no owner budget exists');
ok(!/every figure here is a historical actual/.test(planJs2),
  'nor that every figure is a historical actual');
ok(/ownerTargetCount/.test(planJs2),
  'both budget explanations count the owner targets from the same result');

// 3. Consumer debt appeared twice under one label, $247.18 apart, because the
//    compact snapshot summed raw balances while the tile used the projection.
ok(!/const consumer = d\.debts\.filter\(x => !x\.secured\)/.test(planJs2),
  'the compact snapshot no longer re-sums raw balances for consumer debt');
ok(/const consumer = today\.consumer/.test(planJs2),
  'it reuses the projected day-zero figure the tile shows');

// 4. Borrowing status was read from the single-source case, so a two-part
//    allocation containing an $851.31 HELOC draw reported "creates no debt".
ok(/fundingPlan && fundingPlan\.borrowed > 0/.test(planJs2),
  'borrowing status comes from the whole allocation, not just a lone source');
ok(!/fundingIsDraw = !!\(fundingSource && fundingSource\.debtId\)/.test(planJs2),
  'the single-source-only test is gone');

// 5. The Next move card promised a restored buffer even when the gap cannot be
//    fully funded and the window stays below it.
ok(/gap && fundingShort/.test(planJs2),
  'the success copy is gated on the gap actually being fundable');

// 6. The Modeller charged SIMPLE interest on a balance the same page says
//    capitalises, then reported the opening balance as still owed.
ok(/Math\.pow\(1 \+ helocRate \/ perYear, perYear \* years\)/.test(modellers),
  'the Modeller compounds capitalised HELOC interest at the monthly charge cadence');
ok(!/heloc\.balance \* \(heloc\.rate \/ 100\) \* years/.test(modellers),
  'and the simple-interest calculation is gone');
// The benefit of stopping capitalisation only exists after consolidating; the
// row was shown in keep-separate mode, contradicting the note beneath it.
ok(/helocCapitalised && consolidate/.test(modellers),
  'the stopped-capitalisation row is gated on actually consolidating');
ok(/still capitalising/.test(modellers),
  'and the keep-separate case says the opposite, as it should');
{
  // At the default horizon the difference is not a rounding matter, and the
  // cadence matters too: monthly against annual is another $9,212.
  const h = data.debts.find(x => x.id === 'heloc');
  const r = h.rate / 100;
  const annual = h.balance * Math.pow(1 + r, 18);
  const monthly = h.balance * Math.pow(1 + r / 12, 12 * 18);
  ok(monthly > h.balance * 2,
    'over 18 years a capitalising HELOC more than doubles',
    `${money(h.balance)} → ${money(monthly)}`);
  ok(monthly - annual > 9000,
    'and compounding monthly rather than annually is worth another $9,212',
    money(monthly - annual));
  // The charge really is monthly — the cadence is not an assumption.
  const helocObl = plan.obligations.find(o => o.id === 'heloc');
  ok(helocObl.frequency === 'monthly',
    'the plan records the charge as monthly, which is the cadence used',
    helocObl.frequency);
}
// A boolean cannot describe a mixed funding plan.
ok(/fundingPlan\.parts\.map/.test(planJs2),
  'the scoreboard renders the allocated parts rather than a single source');
ok(!/'the top-ranked source'/.test(planJs2),
  'and no longer calls a two-part plan "the top-ranked source"');
ok(/helocDrawn > 0/.test(planJs2),
  'the HELOC risk says whether THIS plan draws on it');
// The cap qualifier attached one simulation's condition to another's answer.
ok(/capIfCovered/.test(planJs2),
  'a partly-funded cap reports what full coverage would allow, separately');
// Written once. The same sentence on the tile and the headline meant fixing
// one and leaving the other describing a different simulation.
ok((planJs2.match(/once the \$\{money\(fundingGap\)\} gap is covered/g) || []).length === 1,
  'the cap qualifier is composed in exactly one place',
  `${(planJs2.match(/once the \$\{money\(fundingGap\)\} gap is covered/g) || []).length} occurrence(s)`);
ok(/capQualifier/.test(planJs2) &&
   (planJs2.match(/\$\{capQualifier\}/g) || []).length >= 2,
  'and both the tile and the headline read that one value');
// The first action carries a fixed amount; claiming it restores the buffer is
// only true when that amount actually reaches the current gap.
ok(/actionCovers/.test(planJs2),
  'the Next move outcome is judged against the current gap, not merely feasibility');
// An override that breaches must be reported as a breach, whatever else is
// true about the opening gap.
ok(/overrideBreaches/.test(planJs2),
  'a manual weekly figure that breaches the buffer is reported before gap copy');
{
  const O = { scenario: 'expected', incomeOverrides: {}, disabled: [], extraDebtMonthly: 0,
    targetBuffer: 500, fundingSources: plan.funding.options };
  const adv = F.recommend(plan, asOf, O);
  const over = F.simulate(plan, asOf, Object.assign({}, adv.simOptions, { weeklyVariable: 1500 }));
  ok(over.min.balance < 0,
    'and $1,500/week really does go negative even with the gap covered',
    money(over.min.balance));
}
// The note named categories that stopped being $0 when sinking funds were split.
ok(/fullyDatedNames/.test(planJs2),
  'the fully-dated categories are derived, not named in prose');
ok(!/Insurance and children's sports show \$0/.test(planJs2),
  'and the stale sentence claiming sports shows $0 is gone');
// The ledger has to add up on the page, not just in the engine.
ok(/T\.injections > 0/.test(planJs2),
  'gap funding appears as its own ledger row so the rows reconcile');
// And in the weekly table and the mobile cards, which had the same problem one
// level down: week 1 opened at $79.84, its visible rows implied $1,695.58 and
// it displayed $2,738.74.
ok(/anyInjection/.test(planJs2), 'the weekly table gains a gap-funding column when there is one');
ok(/w\.injections \? ` \+ \$\{money\(w\.injections\)\} funding`/.test(planJs2),
  'and the mobile card includes it in the inflow line');
{
  const O = { scenario: 'expected', incomeOverrides: {}, disabled: [], extraDebtMonthly: 0,
    targetBuffer: 500, fundingSources: plan.funding.options };
  const adv = F.recommend(plan, asOf, O);
  for (const w of adv.sim.weeks) {
    const implied = w.opening + w.confirmedIncome + w.estimatedIncome + w.injections
      - w.obligations - w.bills - w.commitments - w.variable - w.extra;
    if (!near(implied, w.closing, 0.02)) {
      ok(false, `week ${w.n} reconciles from its displayed columns`,
        `${implied.toFixed(2)} vs ${w.closing.toFixed(2)}`);
    }
  }
  // Asserted, not reported. Without this the summary passes over an empty week
  // list and claims every week reconciles when none was examined.
  ok(adv.sim.weeks.length >= 13,
    'every week reconciles from opening + inflows − outflows to its closing',
    `${adv.sim.weeks.length} weeks compared`);
}
// An unfunded gap outranks an override breach: at that buffer no weekly figure
// fixes it, so blaming spending points at the wrong thing.
ok(planJs2.indexOf('if (gap && fundingShort)') < planJs2.indexOf('} else if (gap && overrideBreaches)'),
  'the funding shortfall is tested before the override breach');
ok(/No weekly spending\s*\n?\s*figure fixes this/.test(planJs2),
  'and says plainly that no spending figure fixes it');
// The mission and the Next move must not instruct an unsafe override either.
ok(/cut spending to \$\{money\(recommended\)\} a week/.test(planJs2),
  'the mission stops instructing a weekly figure that breaches');
ok(/if \(!fundingShort\) \{\s*\n\s*missionParts\.push/.test(planJs2),
  'and offers no spending instruction at all when the gap cannot be funded — '
  + 'spending is not a remedy for money that does not exist');
// Split funding must not be measured half-applied.
{
  const O = { scenario: 'expected', incomeOverrides: {}, disabled: [], extraDebtMonthly: 0,
    targetBuffer: 3000, fundingSources: plan.funding.options };
  const adv = F.recommend(plan, asOf, O);
  const onDay = adv.sim.events.filter(e => e.date === adv.gap.date && e.kind === 'injection');
  ok(onDay.length === 1,
    'a top-up drawn from two sources is ONE cash event', `${onDay.length} injection event(s)`);
  ok(onDay[0].parts && onDay[0].parts.length === 2,
    'while still carrying both origins for debt attribution',
    onDay[0].parts.map(p => p.debtId || 'cash').join(' + '));
  ok(adv.holds && adv.weekly === 1250,
    'so the day closes on the buffer and the cap survives the split',
    `$${adv.weekly}/week, floor ${money(adv.sim.min.balance)}`);
  ok(near(adv.sim.min.balance, 3000),
    'the floor is the day’s close, not a figure from mid-transfer',
    money(adv.sim.min.balance));
  const pr = F.projectDebts(plan, data.debts, asOf,
    Object.assign({}, adv.simOptions, { weeklyVariable: adv.weekly, extraFacilities: data.revolvingExtra }));
  ok(near(pr.byId.heloc.drawn, 851.31),
    'and the borrowed portion still lands on the HELOC', money(pr.byId.heloc.drawn));
}

// Money paid toward debt has to arrive somewhere. simulate() takes the whole
// payment out of cash before projectDebts() sees it, so clamping a balance at
// zero deletes the overshoot rather than saving it: at $2,000/month, $6,340.00
// left the account against $5,737.68 of Cash Back Visa and interest, and
// $602.32 reduced nothing at all. The identity below is the real guarantee —
// it is checked at payment sizes either side of clearing the target, and at
// one large enough to clear several cards.
{
  const sizes = [0, 500, 2000, 5000, 12000];
  for (const extra of sizes) {
    // `debts` passed, because that is how the page calls it and it is what lets
    // the engine size a payment against the debt that exists. Without it these
    // once passed for the wrong reason: nothing was discarded only because a
    // paid-off card's minimum was being cascaded onto another card, which is a
    // payment nobody makes. Capped properly, an uncapped run SHOULD report a
    // residual — so testing the uncapped path here was testing the defect.
    const adv = F.recommend(plan, asOf, { scenario: 'expected', incomeOverrides: {},
      disabled: [], extraDebtMonthly: extra, targetBuffer: plan.defaults.targetBuffer,
      fundingSources: plan.funding.options, debts: data.debts,
      extraDebtTarget: plan.nextDollar.target });
    const pr = F.projectDebts(plan, data.debts, asOf, Object.assign({}, adv.simOptions,
      { weeklyVariable: adv.weekly, extraFacilities: data.revolvingExtra,
        extraDebtTarget: plan.nextDollar.target }));
    let open = 0, close = 0, interest = 0, paid = 0, drawn = 0;
    for (const d of data.debts) {
      const s = pr.byId[d.id];
      open += d.balance + (d.pending || 0);
      close += s.balance; interest += s.interest; paid += s.paid; drawn += s.drawn;
    }
    ok(near(close, open + interest + drawn - paid),
      `at ${money(extra)}/month extra, every dollar paid reduces a balance`,
      `closing ${money(close)} vs opening+interest+drawn−paid ${money(open + interest + drawn - paid)}`);
    ok(Math.abs(pr.unabsorbed) < 0.005,
      `and nothing is discarded at ${money(extra)}/month`, money(pr.unabsorbed));
  }
  // The specific case Codex reported, and the cascade that now catches it.
  const adv = F.recommend(plan, asOf, { scenario: 'expected', incomeOverrides: {},
    disabled: [], extraDebtMonthly: 2000, targetBuffer: plan.defaults.targetBuffer,
    fundingSources: plan.funding.options });
  const pr = F.projectDebts(plan, data.debts, asOf, Object.assign({}, adv.simOptions,
    { weeklyVariable: adv.weekly, extraFacilities: data.revolvingExtra,
      extraDebtTarget: plan.nextDollar.target }));
  ok(near(pr.byId.cashback.balance, 0),
    'at $2,000/month the target card is cleared inside the window',
    money(pr.byId.cashback.balance));
  ok(pr.byId.tdcc.balance < 1799.97 - 500,
    'and the overshoot moves to the next highest-rate consumer debt, not nowhere',
    `TD credit card ${money(1799.97)} → ${money(pr.byId.tdcc.balance)}`);
  // The order must stay derived from rate, matching nextDollar rank 7, rather
  // than becoming a second hand-written ranking that can drift from the policy.
  // A payment cannot be larger than the debt left to receive it. Once the
  // cascade is exhausted the money must stay in the account — returning an
  // `unabsorbed` figure nobody reads does not make the projection right.
  // At $80,000/month the third payment had $7,584.05 with nowhere to go while
  // cash lost all of it.
  {
    const O = { scenario: 'expected', incomeOverrides: {}, disabled: [],
      extraDebtMonthly: 80000, targetBuffer: plan.defaults.targetBuffer,
      fundingSources: plan.funding.options, extraDebtTarget: plan.nextDollar.target };
    const uncapped = F.recommend(plan, asOf, O);
    const capped = F.recommend(plan, asOf, Object.assign({}, O, { debts: data.debts }));
    const spent = s => s.sim.events.filter(e => e.kind === 'extra')
      .reduce((a, e) => a + Math.abs(e.amount), 0);
    ok(spent(capped) < spent(uncapped),
      'an extra payment is capped at the debt available to receive it',
      `${money(spent(uncapped))} asked, ${money(spent(capped))} spent`);
    ok(capped.sim.ending > uncapped.sim.ending,
      'so the remainder stays as cash instead of draining away',
      `${money(capped.sim.ending - uncapped.sim.ending)} kept`);
    // Capping must change the CASH side only. Measuring the caps before the gap
    // injection was known made them $956.81 too small, quietly paying the HELOC
    // down less than the household actually could.
    const walk = a => F.projectDebts(plan, data.debts, asOf, Object.assign({}, a.simOptions,
      { weeklyVariable: a.weekly, extraFacilities: data.revolvingExtra,
        extraDebtTarget: plan.nextDollar.target }));
    const pu = walk(uncapped), pc = walk(capped);
    ok(data.debts.every(d => near(pu.byId[d.id].balance, pc.byId[d.id].balance, 0.02)),
      'and every closing balance is identical with and without the cap',
      'capping is a cash correction, not a debt one');
    // What `unabsorbed` reports must be the real gap between cash out and debt
    // down, or it is just another number nobody can act on.
    const cashOut = capped.sim.events
      .filter(e => e.amount < 0 && (e.kind === 'extra' || e.kind === 'obligation'))
      .reduce((a, e) => a + Math.abs(e.amount), 0);
    const paidOn = data.debts.reduce((a, d) => a + pc.byId[d.id].paid, 0);
    ok(near(pc.unabsorbed, cashOut - paidOn),
      'and the reported unabsorbed figure is exactly the cash that reduced nothing',
      `${money(pc.unabsorbed)}`);
    ok(Math.abs(pc.unabsorbed) < 0.005,
      'nothing at all is left unabsorbed', money(pc.unabsorbed));
  }

  // The same rule has to hold for DATED MINIMUMS, not just extras. Capping one
  // and not the other left $693.11 leaving cash against balances already at
  // zero — the two projections still disagreeing, just by less. "A scheduled
  // minimum is contractual" was the wrong reason to leave it: the obligation is
  // to a BALANCE, and a bank does not take a minimum on a card that is paid off.
  // Checked at an input far past anything reachable, because that is where the
  // rule is tested rather than merely satisfied.
  for (const extra of [80000, 500000]) {
    const O = { scenario: 'expected', incomeOverrides: {}, disabled: [],
      extraDebtMonthly: extra, targetBuffer: plan.defaults.targetBuffer,
      fundingSources: plan.funding.options, extraDebtTarget: plan.nextDollar.target,
      debts: data.debts };
    const adv = F.recommend(plan, asOf, O);
    const pr = F.projectDebts(plan, data.debts, asOf, Object.assign({}, adv.simOptions,
      { weeklyVariable: adv.weekly, extraFacilities: data.revolvingExtra,
        extraDebtTarget: plan.nextDollar.target }));
    const cashOut = adv.sim.events
      .filter(e => e.amount < 0 && (e.kind === 'extra' || e.kind === 'obligation'))
      .reduce((a, e) => a + Math.abs(e.amount), 0);
    const landed = data.debts.reduce((a, d) => a + pr.byId[d.id].paid, 0);
    ok(near(cashOut, landed),
      `at ${money(extra)}/month, every dollar leaving cash for debt lands on one`,
      `${money(cashOut)} out, ${money(landed)} landed`);
    // Sub-cent, not exactly zero: subtracting a quarter-million dollars in
    // pieces leaves float residue (8.4e-11 here), which is arithmetic noise
    // rather than money. A cent is the smallest amount that could be one.
    ok(Math.abs(pr.unabsorbed) < 0.005,
      `and nothing is unabsorbed at ${money(extra)}/month`,
      pr.unabsorbed === 0 ? '$0.00 exactly' : `${pr.unabsorbed.toExponential(1)} — float residue`);
  }
  // A MINIMUM AND AN EXTRA PAYMENT ARE NOT THE SAME KIND OF THING, even though
  // they look alike in the ledger. A minimum is one lender's demand about one
  // account: when that account is paid off the bank does not take it, and it
  // certainly does not move it to a different card. An extra payment is the
  // household choosing to put surplus at debt, and `plan.nextDollar` says where
  // it goes next. Cascading the first paid $170 to the TD credit card on
  // 1 November for a Cash Back Visa at zero since 30 October — a decision
  // nobody made.
  {
    const O = { scenario: 'expected', incomeOverrides: {}, disabled: [],
      extraDebtMonthly: 2000, targetBuffer: plan.defaults.targetBuffer,
      fundingSources: plan.funding.options, extraDebtTarget: plan.nextDollar.target,
      debts: data.debts };
    const adv = F.recommend(plan, asOf, O);
    const pr = F.projectDebts(plan, data.debts, asOf, Object.assign({}, adv.simOptions,
      { weeklyVariable: adv.weekly, extraFacilities: data.revolvingExtra,
        extraDebtTarget: plan.nextDollar.target }));
    ok(near(pr.byId.cashback.balance, 0),
      'at $2,000/month the Cash Back Visa clears inside the window');
    const cardMinimums = adv.sim.events.filter(e => {
      const o = (plan.obligations || []).find(x => x.id === e.id);
      return e.kind === 'obligation' && o && o.debtId === 'cashback';
    });
    ok(cardMinimums.every(e => e.date <= '2026-10-01'),
      'and no minimum is charged to it after it is paid off',
      cardMinimums.map(e => e.date).join(', ') || 'none');
    ok(!cardMinimums.some(e => e.date === '2026-11-01'),
      'specifically, the 1 November $170 is not taken from cash at all');
    // The paid-off card's minimum must not turn up on another account either.
    ok(pr.byId.tdcc.balance > 400,
      'and it is not redirected to the next debt in the policy chain',
      `TD credit card closes ${money(pr.byId.tdcc.balance)}, not ${money(239.09)}`);
    // The cascade still applies where it belongs — to explicit extra payments.
    ok(pr.byId.tdcc.balance < 1799.97,
      'while an EXTRA payment still cascades once its target is clear',
      `${money(1799.97)} → ${money(pr.byId.tdcc.balance)}`);
  }

  // A capitalising charge must never be capped — it ADDS to a balance rather
  // than reducing one, so the rule that governs payments does not apply to it.
  {
    const O = { scenario: 'expected', incomeOverrides: {}, disabled: [],
      extraDebtMonthly: 500000, targetBuffer: plan.defaults.targetBuffer,
      fundingSources: plan.funding.options, extraDebtTarget: plan.nextDollar.target,
      debts: data.debts };
    const adv = F.recommend(plan, asOf, O);
    const charges = adv.sim.events.filter(e => e.kind === 'noncash');
    const declared = (plan.obligations || []).filter(o => o.nonCash);
    ok(charges.length > 0 && declared.length > 0,
      'the capitalising HELOC charge still appears when every debt is cleared',
      `${charges.length} charge(s)`);
  }

  // Passing the debt records through the page's knob state put financial data
  // one `JSON.stringify(state)` away from localStorage — balances and credit
  // limits written to the disk of whatever machine the page was opened on,
  // outside the authenticated gate that protects everything else.
  ok(!/JSON\.stringify\(state\)/.test(planJs2),
    'the page never serialises its whole state — that would persist balances',
    'localStorage sits outside the authenticated financial-data gate');
  ok(/const KNOBS = \[/.test(planJs2) && /for \(const k of KNOBS\) out\[k\] = state\[k\]/.test(planJs2),
    'only an explicit list of planning knobs is written to localStorage');
  ok(!/KNOBS = \[[^\]]*debts/.test(planJs2),
    'and the debt records are not on that list');
  ok(/for \(const k of KNOBS\) if \(saved\[k\] !== undefined\)/.test(planJs2),
    'and only those keys are restored, so a stale or tampered payload cannot '
    + 'supply its own balances for the plan to be built on');

  const forecastSrc = read('public/forecast.js');
  ok(/plan\.nextDollar` rank 7/.test(forecastSrc) && /sort\(\(a, b\) => \(b\.rate \|\| 0\) - \(a\.rate \|\| 0\)\)/.test(forecastSrc),
    'the cascade order is derived from rate and cites the policy that sets it');
  const unsecured = data.debts.filter(d => !d.secured).sort((a, b) => b.rate - a.rate);
  ok(unsecured[0].id === plan.nextDollar.target,
    'and the policy target really is the highest-rate consumer debt',
    `${unsecured[0].id} at ${unsecured[0].rate}%`);
}
ok(/gap && overrideBreaches/.test(planJs2),
  'and the Next move outcome says what the override actually does');
ok(/still to find before/.test(planJs2),
  'and says what is left when the action alone is not enough');

console.log('\n=== provenance claims are supported ===');
const nd = plan.nextDollar;
ok(nd.provenance === 'derived',
  'the next-dollar ordering is labelled derived, not owner-stated', nd.provenance);
ok(!/household's stated policy|owner-stated/i.test(nd.note),
  'and the note no longer claims the household stated it');
ok(/DERIVED PLAN POLICY|not an owner instruction/i.test(nd.provenanceNote),
  'the provenance note says plainly that no owner approved it');
// The policy must not CLAIM owner authority. Explaining what would change if
// the owner did approve it is not a claim, so the check looks for the claim
// shapes rather than for any mention of the phrase.
const CLAIMS_OWNER = /(is|the household's|as an?) owner[- ]stated|household's stated policy|owner[- ]approved/i;
ok(!CLAIMS_OWNER.test(JSON.stringify(nd)),
  'the next-dollar policy makes no claim of owner authority');
ok(/would change this field to owner-stated/i.test(nd.provenanceNote),
  'and says what evidence would be needed to earn one');
// Where owner-stated IS used, it carries a date or a named source.
const budgetTargets = plan.budget.categories.filter(c => c.targetSource);
ok(budgetTargets.length > 0, 'the owner budget targets declare a source',
  `${budgetTargets.length} categories`);
ok(budgetTargets.every(c => /owner-stated-20\d\d-\d\d-\d\d/.test(c.targetSource)),
  'and each source is dated', budgetTargets[0].targetSource);

console.log('\n=== one authority per contested fact ===');
const accountFacts = read('docs/ACCOUNT_FACTS.md');
const master = read('docs/00_MASTER_PICTURE.md');
const dataStr = JSON.stringify(data);

// Amanda's pay cadence. ACCOUNT_FACTS once said both bi-weekly and
// semi-monthly, in the same file, 236 lines apart.
ok(/semi-monthly/i.test(accountFacts),
  'ACCOUNT_FACTS states the semi-monthly cadence');
ok(!/Tennis BC pay is also bi-weekly/i.test(accountFacts),
  'and no longer also claims it is bi-weekly');
ok(!/Seaspan and Tennis BC both land the same day/i.test(dataStr),
  'data.json no longer claims her pay lands on the Seaspan payday');
ok(!/\$?3,507/.test(master),
  'the stale $3,507/month Tennis BC figure is gone from the master picture');

// BC Hydro. Three files disagreed about whether it still had a household route.
ok(!/no current route through chequing:\*\* BC Hydro/i.test(accountFacts),
  'ACCOUNT_FACTS no longer lists BC Hydro as an unknown route');
ok(/moved to Amanda's DEBT&PAYMENTS account in May 2026|moved here in May 2026/i.test(accountFacts),
  'and records that it moved to her account in May 2026');
ok(!/BC Hydro \(absent from chequing since April 2026/i.test(dataStr),
  'the stale HELOC-route claim is gone from the plan assumptions');
ok(!/They ride inside the variable budget's averages instead/.test(dataStr),
  'and BC Hydro is no longer said to ride inside the household variable budget');
ok(!/summary: 'BC Hydro/.test(read('scripts/calendar-ics.js')),
  'the household calendar no longer emits a BC Hydro reminder');

console.log('\n=== no financial event appears twice ===');
const window = F.simulate(plan, asOf, { scenario: 'expected', weeklyVariable: 0, targetBuffer: 500 });
const keys = new Map();
for (const e of window.events) keys.set(e.id + '@' + e.date, (keys.get(e.id + '@' + e.date) || 0) + 1);
const duplicated = [...keys].filter(([, n]) => n > 1);
ok(duplicated.length === 0, 'every scheduled event is unique on (id, date)',
  duplicated.length ? duplicated.map(([k]) => k).join(', ') : `${keys.size} events`);

const ids = plan.income.concat(plan.obligations, plan.bills || [], plan.commitments).map(x => x.id);
ok(new Set(ids).size === ids.length, 'every plan item has a unique id', `${ids.length} items`);

// A dated bill must not also be inside the variable budget for its category.
const budget = F.budgetBreakdown(plan, periods, { paypalPerMonth: data.paypal.perMonth });
const catIds = new Set(plan.budget.categories.map(c => c.id));
for (const b of (plan.bills || [])) {
  ok(b.budgetCategory === null || catIds.has(b.budgetCategory),
    `bill "${b.id}" resolves to a real budget category or explicitly to none`);
}
for (const c of budget.categories) {
  ok(c.planned <= c.historical + 0.01 || c.target != null,
    `category "${c.id}" never carries more than it has historically cost`,
    `${money(c.planned)} of ${money(c.historical)}`);
}

console.log('\n=== the plan derives from canonical state ===');
const advice = F.recommend(plan, asOf, {
  scenario: 'expected', incomeOverrides: {}, disabled: [], extraDebtMonthly: 0,
  targetBuffer: plan.defaults.targetBuffer,
});
ok(advice.sim.daily[0] !== undefined && near(
  advice.zero.daily[0].balance + 0, plan.startingCash.amount),
  'the forecast opens on the cash register, not a typed-in number',
  money(plan.startingCash.amount));
// The page must not be able to show a different weekly figure from the engine.
const planJs = read('public/plan.js');
ok(/Forecast\.recommend\(/.test(planJs),
  'the Plan page calls the single recommendation authority');
ok(!/recommendWeekly\(/.test(planJs),
  'and does not solve the budget a second time by itself');
ok(!/postGapWeekly|shifted\.startingCash/.test(planJs),
  'the DOM-level re-slicing that double-counted the first payday is gone');

console.log('\n=== confidence, provenance and freshness ===');
const planItems = plan.income.concat(plan.obligations, plan.bills || [], plan.commitments);
const missingConfidence = planItems.filter(x => !x.confidence);
ok(missingConfidence.length === 0, 'every planning input carries a confidence tag',
  missingConfidence.map(x => x.id).join(', ') || `${planItems.length} items`);
ok(planItems.every(x => ['confirmed', 'estimated', 'planned'].includes(x.confidence)),
  'and the tags come from a closed vocabulary');
ok(/^\d{4}-\d{2}-\d{2}$/.test(data.meta.asOf), 'the as-of date is a real date', data.meta.asOf);
ok(periods.asOf === data.meta.asOf,
  'the generated spending history is as-of the same day as the plan',
  `${periods.asOf} vs ${data.meta.asOf}`);
ok(plan.budget.ownerTargets && plan.budget.ownerTargets.status,
  'the budget records whether an owner target exists',
  plan.budget.ownerTargets.status);

console.log('\n=== stale publication fails validation ===');
// The generated file must not be older than the hand-edited one, and must not
// be empty — a dashboard of $0.00s once shipped that way.
ok(periods.periods && Object.keys(periods.periods).length >= 3,
  'periods.json carries its period lenses', Object.keys(periods.periods).join(', '));
ok(periods.periods.ytd.spendingTotal > 0,
  'and real spending totals, not zeros', money(periods.periods.ytd.spendingTotal));
ok((periods.monthly || []).length > 0, 'and a monthly series', `${periods.monthly.length} months`);

// Every data.json key must be read by some page, or it is dead weight that
// will drift out of date unnoticed.
const allScripts = ['app', 'forecast', 'plan', 'modellers', 'deepdive', 'records']
  .map(f => read('public/' + f + '.js')).join('\n');
const orphans = Object.keys(data).filter(k => !new RegExp('\\.' + k + '\\b').test(allScripts));
ok(orphans.length === 0, 'no orphaned data.json keys', orphans.join(', ') || 'all keys rendered');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
