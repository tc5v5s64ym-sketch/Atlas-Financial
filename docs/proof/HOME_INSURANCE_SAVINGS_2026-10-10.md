# Home insurance: one planned savings expense

Source: Dale's explicit instruction, delegated 2026-10-10: take home
insurance out of this pay period's Bills and leave it as an item being saved
for. The referenced period is **future January 29-February 11, 2027**, not
October. Existing date, estimate, merchant route and unknown paying card
remain the standing facts in `ACCOUNT_FACTS.md` and `data.json`.

Base: `08d9b8c89425279054cf9770646c71c403856f14`, refreshed from main before
editing. Current-state verdict: **STILL BROKEN**. `calendarBillSections`
printed Square One in paycheck Bills although `fundingSequence` already
classifies that native annual card-paid event as required planned spending.

## Financial consequence

Canonical Forecast outputs, financial as-of **2026-08-19**, not a current
live October balance. CAD; income contains estimated future payroll.

| January 29-February 11, 2027 | Before | After |
|---|---:|---:|
| Income | 6,237.39 | 6,237.39 |
| Paycheck Bills | 5,972.59 | 2,840.83 |
| Household Budget | 2,405.00 | 2,405.00 |
| After Bills | 264.80 | 3,396.56 |
| Balance After Deductions | -2,140.20 | 991.56 |

Independent subtraction: 5,972.59 - 3,131.76 = 2,840.83;
6,237.39 - 2,840.83 - 2,405.00 = 991.56. The canonical active period
remains income 6,652.30, Bills 299.87, Household Budget 1,725.00,
balance 4,627.43. The independent synthetic October 9-22 current-period
test also remains unchanged.

This is reclassification of the paycheck deduction, not cancellation or new
funding. One estimated 3,131.76 expense stays on February 10, 2027 in
`expandEvents`, `fundingSequence`, Plan Spend and Road Ahead Stage 2. Native
simulation and Road Ahead outputs remain unchanged. Canonical savings
observations are absent; backing, precise proposals and location projection
remain unavailable. A higher paycheck remainder does not establish that the
premium is funded or create extra-debt permission.

The same native annual cost's **unfunded** portion remains protected in the
internal operating carry and the future extra-debt projection. Known reserve
backing offsets only that exact occurrence. Unknown annual amount/timing
withholds that debt projection. This prevents a naive Bills-only deletion
from turning the corrected 991.56 remainder into 491.56 of debt allocation
before the premium is backed. The final canonical extra allocation stays 0.

The existing selected-period allocator formerly added back a bill payment
already deducted in Bills. With the annual cost excluded before those totals,
its already-deducted bill amount and corresponding planning credit become
zero. Its required top-up and single expense consumption survive.

## Independent regression proof

`test/test-annual-savings-payperiod.js` uses invented amounts: 80 operating,
119 savings, 60 club cost October 21, 17.29 premium October 25, and a 77
receipt November 2. Household stock is 199 -> 139 -> 121.71 -> 198.71.
The premium reduces savings from 59 to 41.71 once; operating remains 80
at that payment. Bills excludes it before rows, total, remaining, trust and
Balance After Deductions are composed. Input and settlement are immutable.

A 200 premium has only 59 backed after the earlier club cost. The remaining
141 still leaves an operating shortfall of 61 on October 25; November's
receipt cannot fund it backward. Unknown stock/price/date retains the named
requirement and withholds precise funding. Monthly card bills and annual
joint-cash bills retain their existing deductions. The six-test regression
was red on base and passes with this repair; a seventh test protects the
unfunded/unknown annual cost from new extra-debt allocation.

`test/test-budget-period-funding.js` independently proves 250 earlier top-up
+ 350 later top-up = one 600 payment, with zero duplicate Bills offset.
`test/test-square-one-annual-bill.js` proves the real future window, date,
estimate, one native event, one Plan Spend row and one Road Ahead Stage 2
expense. Ordinary Forecast and authority checks run with the full suite.

## Separate future projected-Savings follow-up

Owner clarification 2026-10-10 22:27: browsing future periods should show how
funding progresses through planned items if the household stays on budget.
This repair does not implement that feature.

Publication path: `Forecast.recommend().savingsFunding` is the sole shared
packet; `savingsFundingPublication` qualifies its native selected period.
Budget `budgetDailySavingsFor` / `budgetSavingsGoalsHtml` and
`SavingsInventory` reprint it. Direct `savingsFundingTimeline` is withheld
under the combined policy; consumers must use the shared packet's timeline.

Two distinct barriers remain:

1. `savingsDailyFunding` requires both dated observed savings stocks, known
   requirements, current operating cash, complete cycle cash/transaction and
   pending evidence, unique account identity, a proven original payday cash
   bridge, matched settled internal transfers, reconciled received income,
   and known card-purchase protection. `recommend` makes timeline availability
   depend on this current actual packet plus the native funding schedule and
   supported income horizon. Main #569 allows only explicitly external null
   aliases; every actual reconciliation gate survives. Main #566 supplies the
   Provincials date; its date is not an unresolved requirement here.
2. Even with a ready timeline, non-current `periodViews[].packet` deliberately
   publishes `saved: null`, stock unavailable, and backing unavailable. It
   projects selected top-ups only, copies today's requirement totals, and does
   not reprint the chronological stock after intervening draws. The UI then
   labels that saved amount unavailable. This is a missing projected-stock
   consumer contract, not evidence that actual savings is zero.

Bounded next outcome: evolve this same shared Forecast publication to expose
**Projected** selected-period closing stock and due-date-first remaining
requirements, reusing its one native period-residual schedule and matched
draws. Keep observed/actual stock and contribution fields separate and unknown
where unproven. Give the conditional projection its own prerequisite result
(trusted current opening, clear observed savings, known expense roster,
supported income/budget and cash-floor protection), rather than borrowing
actual fulfillment status. Do not remove original-payday, transaction,
transfer, received-income or card reconciliation gates from actual claims.
Missing historical card evidence must remain explicit; it can affect opening
protection without turning a conditional future plan into confirmed history.
Prove period deficits, intervening payments, requirement depletion, horizon
clipping, whole-cent conservation and UI Projected wording in that separate PR.

## Scope and residual gates

One runtime owner changed: Forecast's payday Bills classification for its
existing annual card-paid planned-expense class, including the undated case.
No canonical amount/date/account edit, UI refactor, merge or deployment.
PRs #571, #572, #570 and #575 were checked open before work. #570 shares the
Forecast file for a separate streaming funding outcome; this patch touches
`calendarBillSections` and its `calendarPeriodWaterfalls` consumer and requires integration revalidation after
concurrent merges. Systems Review remains **PENDING**, required before merge.

The ordinary figures snapshot reports its 600 current/default figures
unchanged against this exact base. It does not snapshot every future Budget
window; the separate before/after JSON proves the January window change and
that all period income/budget terms, expanded expenses, the 365-day native
simulation and the full Road Ahead baseline trajectory remain identical.
