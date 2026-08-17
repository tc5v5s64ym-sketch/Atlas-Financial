'use strict';
/* Every published headline figure, as one flat JSON map. `node scripts/figures-snapshot.js`
 *
 * This exists so a pull request cannot move a number the household acts on
 * without anyone noticing. CI runs it on the base revision and on the head,
 * diffs the two, and posts the result on the PR. A change here is not a
 * failure — it is usually the whole point of the change — but it has to be
 * SEEN, and it has to match what the merge card says was intended.
 *
 * The rule for what belongs in here: if the household could read it off the
 * Plan page and do something differently because of it, it belongs. Anything
 * that is only evidence does not.
 *
 * Output is a flat `{ "label": value }` map so the diff is trivial and stable
 * across revisions. Values are numbers where they are money, strings where
 * they are dates or verdicts. Keys must be STABLE: renaming one shows up as a
 * removal plus an addition, which is noise. Add new keys freely.
 *
 * THIS SCRIPT DOES NOT COMPARE ANYTHING. Running it emits ONE snapshot: the
 * figures as of the revision it is run from. It selects no baseline and holds
 * no opinion about what came before. `node scripts/figures-snapshot.js` answers
 * "what are the figures here", never "what changed".
 *
 * The baseline belongs entirely to whoever does the comparing. CI checks out
 * the PR base into a worktree and runs THAT revision's own copy of this script,
 * then diffs the two. Where the base revision has no copy — as on the pull
 * request that introduces the script — there is nothing to diff against, and CI
 * says so rather than inventing one.
 *
 * SO ANY "UNCHANGED" CLAIM MUST NAME BOTH REVISIONS. Not because it is tidier,
 * but because the alternative was got wrong here: comparing this script's
 * output against a file generated earlier from a mid-branch commit is a real
 * and useful check, and it is NOT a comparison against the base branch. The two
 * were conflated. Several commits reported "no published figure moves", each
 * true against the commit before it, and that was then summarised as though the
 * whole branch had moved nothing — and once described as confirmed "against
 * base", which CI had explicitly declined to do.
 *
 * The branch in fact moved a dozen published figures: the weekly allocation
 * split, effective consumer debt, revolving headroom, the positions and
 * net-worth figures, liquidity and coverage. All intended, all listed on the
 * merge card. What did not move was the $1,250/week household cap — a cash
 * constraint, and the one number that correctness work was least able to shift.
 *
 * If you are writing the claim, write the command that supports it. Each
 * revision runs its OWN copy of this script, because the engine's shape changes
 * between revisions and one revision's script against another's data is not a
 * comparison of anything:
 *
 *   git worktree add /tmp/base <revision> && \
 *     node /tmp/base/scripts/figures-snapshot.js > /tmp/base.json
 *   node scripts/figures-snapshot.js > /tmp/head.json
 *   diff /tmp/base.json /tmp/head.json     # unchanged AGAINST <revision>
 *
 * Substitute a different revision and the claim changes with it. Name it.
 *
 * That recipe needs <revision> to HAVE a copy of this script, which is exactly
 * what the base branch lacks until this first merges — verified, not assumed:
 * against `origin/main` today the second line has no file to run. When the base
 * cannot produce a snapshot the honest answer is that there is no base
 * comparison, which is what CI reports. It is not a licence to substitute a
 * mid-branch commit and keep the word "base".
 */

const path = require('path');
const ROOT = path.join(__dirname, '..');
const F = require(path.join(ROOT, 'public', 'forecast.js'));
const data = require(path.join(ROOT, 'data.json'));

let periods = null;
try { periods = require(path.join(ROOT, 'public', 'periods.json')); } catch { /* optional */ }

const plan = data.plan;
const asOf = data.meta.asOf;
const round = n => Math.round(n * 100) / 100;

const out = {};
const put = (key, value) => {
  out[key] = typeof value === 'number' && isFinite(value) ? round(value) : value;
};

put('meta.asOf', asOf);
put('meta.windowDays', plan.windowDays);
put('meta.targetBuffer', plan.defaults.targetBuffer);
put('meta.scenario', plan.defaults.scenario);

/* ---- the cash position ------------------------------------------------- */
put('cash.spendableToday', F.startingCashAmount(plan));
for (const h of plan.startingCash.heldElsewhere || []) {
  put(`cash.elsewhere.${(h.class || 'unclassified')}`,
    (out[`cash.elsewhere.${h.class || 'unclassified'}`] || 0) + h.value);
}

/* ---- the recommendation, which is the point of the whole page ---------- */
const opts = {
  scenario: plan.defaults.scenario, incomeOverrides: {}, disabled: [],
  extraDebtMonthly: plan.defaults.extraDebtMonthly || 0,
  targetBuffer: plan.defaults.targetBuffer,
};
// The funding source decides whether covering an opening gap costs anything,
// so the snapshot uses the same default the page does.
opts.fundingSources = (plan.funding || {}).options;
opts.extraFacilities = data.revolvingExtra;

const advice = F.recommend(plan, asOf, opts);
put('plan.mode', advice.mode);
if (advice.funding) {
  put('plan.fundingSource', advice.funding.parts.map(p => p.id).join('+'));
  put('plan.fundingBorrowed', advice.funding.borrowed);
  put('plan.fundingShortfall', advice.funding.shortfall);
}
put('plan.weeklyCap', advice.weekly);
put('plan.weeklyCapMonthly', F.monthlyFromWeekly(advice.weekly));
put('plan.effectiveFrom', advice.effectiveFrom);
put('plan.bindingDate', advice.binding.date);
put('plan.bindingBalance', advice.binding.balance);
put('plan.endingCash', advice.sim.ending);
put('plan.lowestCash', advice.sim.min.balance);
put('plan.lowestCashDate', advice.sim.min.date);
if (advice.gap) {
  put('plan.gapAmount', advice.gap.amount);
  put('plan.gapDate', advice.gap.date);
  put('plan.gapDueThatDay', advice.gap.dueOnGapDay);
}

const T = advice.sim.totals;
put('totals.confirmedIncome', T.confirmedIncome);
put('totals.estimatedIncome', T.estimatedIncome);
put('totals.obligations', T.obligations);
put('totals.bills', T.bills);
put('totals.commitments', T.commitments);
put('totals.nonCashInterest', T.noncash);

/* ---- what the cap has to cover ----------------------------------------- */
// The weekly figures below are the engine's, not this script's. It kept its
// own copy of the weeks-per-month constant until the conversion moved into
// Forecast — a third copy, beside the page's and the suite's, in the one file
// whose whole job is to prove published figures did not move.
const budget = periods ? F.budgetBreakdown(plan, periods, {
  paypalPerMonth: data.paypal ? data.paypal.perMonth : 0,
  weeklyCap: advice.weekly,
  asOf,
}) : null;
if (budget) {
  put('budget.basis', budget.basis);
  put('budget.essentialPerMonth', budget.essentialMonthly);
  put('budget.requiredPerMonth', budget.requiredMonthly);
  put('budget.requiredPerWeek', budget.cap.essentialWeekly);
  put('budget.discretionaryPerMonth', budget.discretionaryMonthly);
  put('budget.reservePerMonth', budget.reserveMonthly);
  put('budget.datedPerMonth', budget.datedMonthly);
  const food = budget.categories.find(c => c.id === 'groceries');
  const fuel = budget.categories.find(c => c.id === 'fuel');
  if (food && fuel) {
    put('budget.foodAndFuelPerMonth', budget.cap.foodFuelPlannedMonthly);
    put('budget.foodAndFuelPerWeek', budget.cap.foodFuelPlannedWeekly);
  }
}

/* ---- the debt side ------------------------------------------------------ */
const proj = F.projectDebts(plan, data.debts, asOf,
  Object.assign({}, advice.simOptions, { weeklyVariable: advice.weekly,
    extraFacilities: data.revolvingExtra,
    extraDebtTarget: plan.nextDollar && plan.nextDollar.target }));
for (const m of proj.marks) {
  if (![0, 30, 60, 90].includes(m.day)) continue;
  const tag = m.day === 0 ? 'today' : 'day' + m.day;
  const cash = m.day === 0 ? F.startingCashAmount(plan)
    : (advice.sim.daily.find(p => p.date === m.date) || {}).balance;
  put(`scoreboard.${tag}.cash`, cash);
  put(`scoreboard.${tag}.consumerDebt`, m.consumer);
  put(`scoreboard.${tag}.heloc`, m.heloc);
  put(`scoreboard.${tag}.creditHeadroom`, m.headroom);
  put(`scoreboard.${tag}.facilitiesOverLimit`, m.overLimitCount);
}
put('debt.interestOverWindow', proj.marks[proj.marks.length - 1].interestToDate);
for (const c of proj.crossings || []) {
  put(`debt.overLimit.${c.id}`, c.alreadyOver ? 'already over today' : c.date);
}

/* ---- the balance sheet -------------------------------------------------- */
put('balance.assets', F.publicationTotals(data).assets);
put('balance.debts',
  data.debts.reduce((s, x) => s + (x.balance || 0), 0));
// POSTED only, and named so. The scoreboard's consumer-debt figure is posted
// PLUS known pending, because a pending charge is money already spent; these
// two sat in one report as `balance.consumerDebt` $29,842.83 against
// `scoreboard.today.consumerDebt` $30,090.01 with nothing saying why.
put('balance.consumerDebtPosted',
  data.debts.filter(x => !x.secured).reduce((s, x) => s + x.balance, 0));
put('balance.consumerDebtPending',
  data.debts.filter(x => !x.secured).reduce((s, x) => s + (x.pending || 0), 0));
put('balance.consumerDebtEffective',
  data.debts.filter(x => !x.secured).reduce((s, x) => s + x.balance + (x.pending || 0), 0));
put('balance.securedDebt',
  data.debts.filter(x => x.secured).reduce((s, x) => s + x.balance, 0));

const helocSnap = F.compactSnapshot(data.debts, data.helocHistory);
if (helocSnap.heloc) {
  put('heloc.vsLastMonth', helocSnap.heloc.delta);
  put('heloc.vsLastMonthVerdict', helocSnap.heloc.id);
}
const dive = F.deepDive(data);
if (dive.heloc && dive.heloc.current != null) {
  put('heloc.currentOpening', dive.heloc.current);
}

/* ---- what the household is told to do ----------------------------------- */
const first = (plan.actions || [])[0];
if (first) {
  put('action.next', first.what);
  put('action.nextAmount', first.amount);
  put('action.nextDue', first.due);
}
put('action.openCount', (plan.actions || []).filter(a => a.status !== 'done').length);
if (plan.nextDollar) put('policy.nextDollarTarget', plan.nextDollar.target);

process.stdout.write(JSON.stringify(out, null, 2) + '\n');
