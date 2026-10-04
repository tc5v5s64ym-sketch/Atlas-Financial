# Budget exact-period actuals and original plans

This slice implements the owner's actual/planned follow-up to #493. Forecast
owns the new `budgetPeriodProgress` publication; the one active Budget renderer
reprints it. The cash walk, deductions, classifications, observer and settlement
rules are unchanged. No canonical amount or savings assignment changes.

## Published figures

- Income: confirmed received / original scheduled plan. Raw named-income credits
  and incumbent positive benefit/Other Income follow Forecast's shared receipt
  selector. Unverified receipt amounts remain unknown.
- Bills: confirmed settled paid / original scheduled occurrence plan. An actual
  payment cannot replace the original denominator. Contradictory, unverified or
  missing settlement makes the observed subtotal explicitly partial.
  A confirmed early payment counts for its occurrence inside the current period;
  its scheduled due date is not used as a payment-date cutoff. Future periods
  still cannot claim actual payments.
- Household: incurred category and Other spending / original authored category
  plan. Refunds retain their sign; observed pending spending is included and
  labeled. The reserve deduction remains the incumbent higher-of-plan-and-spend
  calculation, separately preserved in native evidence and the final balance.
  Completed periods have no dated original category-plan snapshot, so their
  original denominator is unavailable. Today's targets cannot rewrite history.
  Historical category rows also withhold target/remaining amounts and target-based
  bars, retaining observed spending and native transaction evidence.
- Savings: an exact future/payday period can reprint the existing allocator's
  minimum-now requirement when the full requirement has complete goal attribution.
  This is the **current Forecast requirement**, not an original payday snapshot.
  A short or unassigned proposal cannot become a full goal requirement. Past and
  mid-period requirements are unavailable without an original snapshot.

Bounded coverage, period and as-of matching, explicit null trust, missing dates
and amounts, posted-only observations and future scope are checked in Forecast.
Partial observed subtotals remain labeled partial, with no complete progress bar.
Known zero plans never cause percentage division. Future actuals are unavailable.

Every goal remains **Not confirmed**: account balances, owner assignment snapshots,
proposal totals, cumulative proposals and paid costs are not proof of contributions
made toward this period's plan. Required contributions, where supported, are shown
separately from fulfillment. Native goal, bill, category and account evidence stays
reachable with exact keyboard focus restoration.

## Independent proof

The invented active household has received income 2,600 / original plan 4,050;
confirmed paid bills 1,400 / original plan 1,665 (partial settlement); incurred
household spending 308.55 + 74.20 + 38.75 + Other 22.99 = 444.49 / original category
plan 450 + 160 + 120 = 730. The independently reconciled reserve remains 752.99
and final balance remains 4,050 - 1,665 - 752.99 = 1,632.01.

A second invented requirement fixture has a 600 cost due next period. Next
period capacity is independently 1,000 - 200 - 150 - 300 = 350, so minimum-now
requirements are 250 then 350. Their confirmed fulfillment and remaining
contribution are unavailable, even when proposed funding reaches the whole cost.

`test/test-budget-period-progress.js` covers original denominator identity,
negative reversals, known zero and missing values, field-specific trust,
incomplete/posted-only evidence, pending spending, contradictory settlement,
historical and future scopes, requirement attribution, immutable inputs and active
consumers. Existing active financial contracts and three actual-page browser
harnesses remain required. Browser traffic is intercepted; all captures use
independent invented inputs at 1440/390/320px. Exact-head results belong in the PR
merge card; these files alone are not a passing-head claim.

## Smallest future evidence needed for period savings confirmation

This is a proposed future receipt contract, **not implemented or populated here**.
One owner-confirmed, period-scoped receipt can establish both missing facts:

1. Exact period start/end, currency, confirmation date and stable goal ID.
2. The original agreed contribution requirement for that goal and period, or an
   explicit statement that no original plan was recorded.
3. Confirmed new contribution amount for the same goal and period, its dated
   source/evidence reference, and explicit complete/partial coverage. Known zero
   requires affirmative confirmation of no contribution; absent data stays unknown.

The smallest owner action is to confirm those two amounts and their goal attribution
for one selected period, supported by a dated contribution receipt/transaction.
Account cash, assignment revisions and transfers without confirmed purpose do not
substitute. No starting household allocations need changing to supply this receipt.
A future Forecast-owned consumer would validate scope, currency, attribution and
coverage, then publish fulfilled, remaining and status. Until then, Not confirmed
is the truthful final state and does not block this technical slice.

## Remaining visual differences

The complete v3 target is not claimed. Exact-payday protection/unassigned hierarchy,
funding/income attention, mobile Month shortcuts and shared detail spacing remain
on the existing finite checklist. Bills-only carryover still lacks its own
publication; savings fulfillment still lacks the receipt described above. Starting
savings assignments remain unconfirmed. Mockup sample values and demo controls
are not shipped.

## Captures

All images below use independently invented fixtures. Reference amounts differ
intentionally; they are a hierarchy/layout comparison, not a financial equality
claim. The owner's later actual/planned and compact-goal directions supersede
the reference's deduction-bar interpretation.

| Evidence | Desktop | 320px |
|---|---|---|
| Active page | [Overview](current-1440.png) | [Overview](current-320.png) |
| Approved reference beside active page | [Comparison](comparison-1440.png) | [Comparison](comparison-320.png) |
| Category original-plan ratios | — | [Spending](spending-320.png) |
| Paid/original-plan headline with partial evidence | — | [Bills](bills-320.png) |
| Exact future requirements and unavailable actuals | — | [Future period](future-requirements-320.png) |
| Named requirements; fulfillment Not confirmed | — | [Goals](goal-requirements-320.png) |
