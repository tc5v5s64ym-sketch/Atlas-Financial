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
 * "UNCHANGED" IS MEANINGLESS WITHOUT ITS BASELINE. Say what a snapshot was
 * compared against, every time, in the same sentence as the claim.
 *
 * On the pull request that INTRODUCES this script there is no base snapshot to
 * diff against, because the script does not exist on the base revision. CI says
 * so plainly — "no baseline to compare against" — and a local run therefore
 * compares the head against some EARLIER COMMIT ON THE SAME BRANCH, not against
 * the base branch.
 *
 * That distinction is not pedantry; it was got wrong here. Several commits on
 * that first PR reported "no published figure moves", which was true of each
 * commit against the one before it, and it was then summarised as though the
 * whole branch had moved nothing. The branch in fact moved a dozen published
 * figures — the weekly allocation split, effective consumer debt, revolving
 * headroom, the positions and net-worth figures, liquidity and coverage — all
 * of them intended, all of them listed on the merge card. What did not move was
 * the $1,250/week household cap, which is a cash constraint and the one number
 * the correctness work was least able to change.
 *
 * So: "unchanged since the previous commit" and "unchanged against main" are
 * different claims, and only the second one is what a reader assumes.
 */

const path = require('path');
const ROOT = path.join(__dirname, '..');
const F = require(path.join(ROOT, 'public', 'forecast.js'));
const data = require(path.join(ROOT, 'data.json'));

let periods = null;
try { periods = require(path.join(ROOT, 'public', 'periods.json')); } catch { /* optional */ }

const plan = data.plan;
const asOf = data.meta.asOf;
const WEEKS_PER_MONTH = 365.25 / 12 / 7;
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
put('cash.spendableToday', plan.startingCash.amount);
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

const advice = F.recommend(plan, asOf, opts);
put('plan.mode', advice.mode);
if (advice.funding) {
  put('plan.fundingSource', advice.funding.parts.map(p => p.id).join('+'));
  put('plan.fundingBorrowed', advice.funding.borrowed);
  put('plan.fundingShortfall', advice.funding.shortfall);
}
put('plan.weeklyCap', advice.weekly);
put('plan.weeklyCapMonthly', advice.weekly * WEEKS_PER_MONTH);
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
const budget = periods ? F.budgetBreakdown(plan, periods, {
  paypalPerMonth: data.paypal ? data.paypal.perMonth : 0,
}) : null;
if (budget) {
  put('budget.basis', budget.basis);
  put('budget.essentialPerMonth', budget.essentialMonthly);
  put('budget.requiredPerMonth', budget.requiredMonthly);
  put('budget.requiredPerWeek', budget.requiredMonthly / WEEKS_PER_MONTH);
  put('budget.discretionaryPerMonth', budget.discretionaryMonthly);
  put('budget.reservePerMonth', budget.reserveMonthly);
  put('budget.datedPerMonth', budget.datedMonthly);
  const food = budget.categories.find(c => c.id === 'groceries');
  const fuel = budget.categories.find(c => c.id === 'fuel');
  if (food && fuel) {
    put('budget.foodAndFuelPerMonth', food.planned + fuel.planned);
    put('budget.foodAndFuelPerWeek', (food.planned + fuel.planned) / WEEKS_PER_MONTH);
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
  const cash = m.day === 0 ? plan.startingCash.amount
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
put('balance.assets', data.netWorth.assets);
put('balance.debts', data.netWorth.debts);
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
