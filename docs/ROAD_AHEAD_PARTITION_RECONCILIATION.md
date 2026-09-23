# Road Ahead Month / Seaspan Pay Period reconciliation

Owner-requested audit, 2026-09-22. One outcome: changing the Road Ahead
partition preserves dated financial membership, trust and published cents.

## Current-state gate

**PARTIALLY FIXED.** Inspected GitHub main
`76e44f497e106bebfce7a00ad7789feaea16d046` before implementation; there were
no open PRs. `Forecast.baselineTrajectory` already built both series from one
`prepareBaselineTrajectoryWalk`; `planningTrajectory` forwarded the same plan,
debts, opening and applied-overlay actuals. `planningRoadAheadPeriods` selected
the series and `planningRoadAheadStage3Result` selected its standalone result.
The schedule, standalone-result identity and trust boundaries were already
shared. Existing period tests largely reused `expandEvents`, `projectDebts`,
`budgetBreakdown` or `spendingCycle` to produce their expected answers.

Two reproducible manifestations of one defect remained: cent rounding depended
on where the display cut the walk.

* The committed 365-day household plan showed normal-spending totals of
  **$55,765.77** in Month and **$55,765.75** in Pay Period. Independently rounding
  each span created different totals. The correctly rounded whole-horizon
  spending is **$55,765.74** (`$1,069.48 / 7 × 365`). These are published
  component totals, not a claim that months should equal individual pay periods.
* Synthetic $1.01 debts at 6% daily-accruing annual interest, paid off January 2
  and January 30 from a January 1 opening, each have a cent-rounded payoff of
  $1.01. Main grouped their fractional accrued-interest payoffs first: Month
  printed **$2.03** while the two pay periods totalled **$2.02**.

## Small repair inside Forecast

Normal spending now uses differences between cent-rounded spending at two
boundaries of the existing walk. Integer fortnight cents preserve the recent
baseline's half-cent weekly rate. The named planned-budget categories use those
same boundaries, including the existing last-line attribution of rounding, so
switching views cannot move cents between categories either.

Each dated event is published in cents before grouping it into a span. This
includes payments capped by debt absorption that contain fractional accrued
interest. The coupled cash/debt simulation keeps its existing internal
precision. No extra ledger, exported planner, stored financial fact, UI change,
new spending assumption, savings allocation or surplus carry was introduced.
Spending-boundary arithmetic has no opening-cash or prior-surplus operand.

## Independent proof

`node test/test-road-ahead-reconciliation.js` is registered in `npm test`.
Its expected results never call Forecast's calendar, spending-cycle, budget,
classification, simulation or debt helpers:

* A test-only date scanner builds the expected monthly, biweekly, quarterly and
  yearly occurrences directly from fixture/source rows. A separate integer-day
  calendar builds both partitions, covering each horizon day exactly once.
* An integer remainder allocator assigns normal-spending pennies one day at a
  time. It tests each component and stage, exact named membership, original
  scheduled dates, and whole-horizon conservation of cents and budget categories.
* Named boundary fixtures include payday, the preceding day, month end, clamped
  February dates, leap day, partial first cycles/months, income, recurring bills,
  required debt, two named purchases, prepaid occurrences, and old unresolved
  once or live-lookback recurring obligations. Carry applies at the opening
  without rewriting the original due date. Historical income is not replayed.
* Separate zero-interest principal arithmetic proves required/extra payment
  absorption and cessation at payoff. Separate daily interest arithmetic proves
  the fractional-payoff rounding case.
* A hand-classified recent-actual fixture proves completed posted $101.01 plus
  current full-period $103.01 gives a **$102.01** fortnight estimate and an exact
  $51.005 weekly walk rate. All complete 14-day spans retain $102.01. Incomplete
  or absent coverage preserves unavailable recent data and the independently
  computed planned fallback, never zero or a promoted trust label. The existing
  provisional-baseline suite additionally covers split parents/children,
  pending-to-posted twins, named-commitment settlement and classification.
* Calculated, estimated and unavailable cases check component/result trust.
  Unmodelled payroll withholds the affected spans; an earlier span can remain
  publishable. Equal trust is not demanded for differently dated spans.
* Executed page functions prove one Forecast packet supplies both series.
  Repeated switches leave it unchanged. Injected enormous cumulative cash does
  not appear as the Road Ahead result. Changing opening cash does not change
  standalone stages. The existing standalone-result suite separately proves a
  later deficit survives a larger earlier surplus.

`node test/road-ahead-mutation-check.js` compiles isolated in-memory mutations
without editing Forecast or household data. All seven must produce assertion
failures: old span rounding, omitted bills, doubled required debt, shifted
application dates, promoted bill trust, cumulative cash replacing stage 3, and
fractional debt rounded only after grouping. This is optional proof tooling,
not a new governance gate or runtime authority.

## Deterministic committed-household result

The audit reads committed sanitized `data.json` and `public/periods.json` at the
**2026-08-19 opening**, for **2026-08-19 through 2027-08-18**. This is not a new
live household observation. No recent transaction packet is committed, so the
recent baseline is unavailable and both views use the disclosed owner-target
fallback. Expected fallback comes directly from the owner targets and their
cadences, independently annualized. Known outflows are independently enumerated,
including BC Hydro's first-occurrence credit, represented prepaid occurrences,
and the separate HELOC cash minimum rather than its noncash capitalisation.
Opening principal exceeds the entire scheduled payment total for each current
debt even without interest, independently ruling out an absorption reduction.

Both partitions now total exactly:

| Component | Published horizon total |
|---|---:|
| Income | $181,562.36 |
| Joint-cash bills | $13,018.72 |
| Required debt | $57,792.21 |
| Normal spending, planned fallback | $55,765.74 |
| Dated point commitments | $11,100.00 |
| Scheduled extra debt | $0.00 |
| Algebraic sum of standalone results | $43,885.69 |

Income through 2026 and all outflow/spending components are independently
reconciled from input rows. The 2027 payroll amount is an **estimate**: this
suite proves its partition conservation, while `test-dale-payroll-regime.js`
provides the separate paystub/statutory proof and its explicit model tolerances.
Neither proof verifies future deposits. The algebraic net above is **not**
available cash, savings, an automatic funding plan, or additional cash required.

## Scope limits and findings disposition

The existing architecture defines stages as joint-cash bills, required debt,
normal spending, dated non-optional point commitments, and scheduled extra debt.
Card-paid bills are separate reserved gravity in the cash walk; held-elsewhere
bills, noncash capitalisation and optional commitments are not second joint-cash
stage deductions. Synthetic exclusion cases preserve that existing boundary.
This PR does not claim the standalone stage identity includes every cash-walk
reserve or that a surplus makes every unresolved future cost affordable.

On this committed opening, Warriors, downstairs couch, exterior painting,
Indio tournament, Provincials and vehicle maintenance lack a point amount or a
usable exact cash date. They remain known Forecast commitments; neither view
invents an event or silently resolves them. Settlements are interpreted relative
to the dated opening; later settlement dates do not rewrite that opening.

No new household fact, trust promotion, production action or owner answer is
needed for the rounding repair. Forecast retains sole authority. Atlas Contract
/ Systems Review is **REQUIRED** for changed household-facing arithmetic and its
independent numerical proof. The owner's instruction is to stop at the PR and
**not merge**.
