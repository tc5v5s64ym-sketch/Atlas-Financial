# Home insurance: one planned savings expense

Source: Dale's explicit instruction, delegated 2026-10-10: take home
insurance out of this pay period's Bills and leave it as an item being saved
for. The referenced period is **future January 29-February 11, 2027**, not
October. Existing date, estimate, merchant route and unknown paying card
remain the standing facts in `ACCOUNT_FACTS.md` and `data.json`.

Base: `db2a80033d321eefd894457c499e80063b16d6e0`, refreshed main for the
R1/R2 repair. Original inspection began at `08d9b8c`; #571 and #572 merged
without changing Forecast or household inputs. Current-state verdict on base:
**STILL BROKEN**. `calendarBillSections`
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
funding. The existing home purpose-reserve `yearly-bill` goal reference
explicitly assigns Square One to Savings. Annual cadence or card payment
alone does not: Travel Visa's separately owner-directed annual fee retains
its paycheck Bills deduction. One estimated 3,131.76 expense stays on February 10, 2027 in
`expandEvents`, `fundingSequence`, Plan Spend and Road Ahead Stage 2. Native
simulation and Road Ahead outputs remain unchanged. Canonical savings
observations are absent; backing, precise proposals and location projection
remain unavailable. A higher paycheck remainder does not establish that the
premium is funded or create extra-debt permission.

The same native annual cost's **unfunded** portion remains protected in the
internal operating carry, future extra-debt projection and major-purchase capacity. Known reserve
backing offsets only that exact occurrence. Unknown annual amount/timing
withholds both debt and purchase allocations. This prevents a naive Bills-only deletion
from turning the corrected 991.56 remainder into 491.56 of debt allocation
before the premium is backed. The final canonical extra-debt and purchase allocations both stay 0.

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
requirement and withholds precise funding. Monthly card bills, unrelated
annual card fees and annual joint-cash bills retain their existing deductions.
The twelve-test regression passes; seven fail on unchanged base. Removing
either native unfunded debt or purchase protection fails independently.
Known zero savings preserves 80 operating - 60 club - 200 premium = -180 at
the deadline; the later 77 leaves -103 without backdating funding.

`test/test-budget-period-funding.js` independently proves 250 earlier top-up
+ 350 later top-up = one 600 payment, with zero duplicate Bills offset.
`test/test-square-one-annual-bill.js` proves the real future window, date,
estimate, one native event, one Plan Spend row and one Road Ahead Stage 2
expense. The older payday-reset oracle independently expects 200 - 40 - 80 =
80 of routine entitlement and 55 of remaining goal need. The immutable
absent/empty-earmark historical comparison retains all annual card-paid rows
and compares every incumbent field; no annual row is removed from that oracle.
Ordinary Forecast and authority checks run with the full suite.

## R1/R2 repair proof

Parent findings reproduced on exact prior candidate
`229a2e37404fb13d3f776e592b4fc32694e54688`. The attempted GitHub review
submission returned "user cancelled MCP tool call". No published BLOCK review
ID is confirmed; it was not retried. These findings are authorized repair
guidance, not a claimed published review or candidate PASS.

R1: an original October 9 snapshot of 200 predates an October 10 annual
payment of 100 and an October 11 observed operating opening of 100. A later
November 2 receipt is 77. The prior candidate incorrectly carried 200 into
October 23 and 277 into November 6. Both the unmodified review fixture and
its explicitly marked Savings variant now publish 100 and 177, matching the
independent 200 - 100 and 200 - 100 + 77 arithmetic and native cash walk.
Funding and extra-debt are unavailable in this input; no allocation release
is claimed. The marked variant keeps Bills at zero so narrowing cannot mask
the carry defect by restoring the duplicate deduction.

Represented Savings occurrences between the original snapshot and as-of
qualify that snapshot's carry as unknown: today's reserve balances cannot
prove a historical cash split. The existing native observed-opening walk
supplies the subsequent opening when available. No historical expense is
replayed from that observed opening and no historical backing is invented.
Same-day represented payment, an opening already including payment, and an
unavailable operating plan are tested. Removing this qualification fails two
tests. The existing as-of `annualSavingsNeed` / `annualSavingsUnknown`
protection remains; no second withheld-cost field or subtraction is added.

R2: Travel Visa's estimated 149 fee on October 6, 2027, without an explicit
Savings goal, retains Bills 149 and BAD -149 in the zero-income/zero-budget
review scenario. The prior candidate incorrectly published Bills 0/BAD 0.
Its native expense/date/estimate remain unchanged. All three named R1/R2
regressions fail on the prior candidate and pass on the repaired source.

The independent partial-backing case has 80 operating, 40 evidenced Savings,
60 income/top-up on October 23, and one 100 premium on October 25. Payment
consumes 40 current backing + 60 projected top-up once, leaving operating 80,
Savings 0, combined cash 80: 80 + 40 + 60 - 100 = 80. Bill-payment offset
and duplicate funding-credit terms remain zero. This is a hypothetical
projection, not a permission to transfer money.

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

Before adding projected stock, the supplied independent main review
(`task-11/atlas-review-report.md`, reviewed db12bc9) identifies a separate
financial prerequisite: future Savings uses the cap-based knowledge walk,
not the selected Budget spending and finalized-payroll basis. Its invented
80-target case publishes Budget contribution 80 and gap 55 alongside ready
Savings contribution 135. Raising the target to 180 leaves negative Budget
BAD (base -44; after this annual-classification repair -20), unavailable
Budget funding, yet the same ready 135 Savings proposal. January knowledge
receipts are 4,264 versus finalized Budget 3,849.40 per cheque. The review
also proves remainingGap 90 instead of 170 - 35 current backing - 80 proposed
= 55, and future detail wording Unsent top-up today. These are separate
findings, reproduced without live balances; this repair does not fix them.
The supplied report is not an exact-head Systems Review of this candidate.

Dependency order for a separate repair: carry calculated protectedNow into
projected remaining-gap arithmetic while leaving actualSaved unknown; unify
all future Savings quantities with one Budget-matched dated walk using
finalized receipts, household holds, operating floors, protected costs and
one serial allocator. Preserve legitimate uncommitted carry rather than
transferring every positive BAD or draining committed savings. Prove target
variation, January payroll transition, an earlier deadline, later deficit,
source equality and whole-cent conservation. Then publish and render
projected stock/requirements and the correct projected-period detail label.
No arithmetic moves into the page.

Bounded next outcome: evolve this same shared Forecast publication to expose
**Projected** selected-period closing stock and due-date-first remaining
requirements, using the repaired Budget-matched native period-residual schedule and matched
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
explicitly Savings-assigned annual card-paid expense, including the undated
case and its internal carry protection.
No canonical amount/date/account edit, UI refactor, merge or deployment.
PRs #571, #572, #570 and #575 were checked open before work; #571 and #572 are
now in the base. #570 shares the
Forecast file for a separate streaming funding outcome; this patch touches
`calendarBillSections` and its `calendarPeriodWaterfalls` consumer and requires integration revalidation after
concurrent merges. Systems Review remains **PENDING**, required before merge.
The separate #578 remaining-gap repair and the proposed Budget-matched future
Savings design are outside this outcome. The planning addendum is preserved
outside this branch. No household input changes or competing builder were
introduced here. Full exact-head check results are recorded on the Draft PR;
the prior candidate's 359-suite PASS does not satisfy the repaired-head gate.

The ordinary figures snapshot reports its 600 current/default figures
unchanged against this exact base. It does not snapshot every future Budget
window; the separate before/after JSON proves the January window change and
that all period income/budget terms, expanded expenses, the 365-day native
simulation and the full Road Ahead baseline trajectory remain identical.
