# Budget payment and savings evidence follow-up

This isolated follow-up starts from merged #490 main
`ce97abdd3aa6b0000b5f06271e729fd7ff332783`. The approved v3 reference
is closed, unmerged #480; the parent closed it at the owner's explicit request.
The original reference pixels and comparisons remain in
[`../budget-v3-funding-month`](../budget-v3-funding-month/README.md).
The owner subsequently asked for simpler payment states, two clickable bill
filters, compact savings goals, and actual/planned figures with plain progress.
These directions supersede the reference's payment count chips and deduction
bar interpretation. The full visual target is not claimed complete.

## Implemented presentation

- Native bill evidence uses Paid green / Not paid red for supported settlement
  states, with Pending, To confirm and Unknown distinct. Date proximity never
  clears a bill or changes its status. The old green ON DATE treatment is gone.
- Two keyboard-accessible PAID / NOT PAID controls group the same published
  occurrences. NOT PAID means not confirmed paid: pending/unconfirmed entries
  retain their actual states inside the group. Both groups start visible;
  selecting a filter narrows the list, selecting it again restores all rows.
  Empty groups and counts remain explicit. Each occurrence opens native evidence
  with its date and returns focus to the exact trigger.
- The default savings card lists published names, with period fulfillment
  explicitly Not confirmed. It prints a trusted selected-period proposal only
  as a proposal, never as fulfillment. Published names remain available when
  funding is withheld. Missing names are not replaced with raw goal IDs.
  Account inventory and all reasons remain reachable through keyboard-accessible
  details; its formerly expanded technical paragraphs are collapsed by default.
- Category amounts read spent / original plan. Progress uses that original
  denominator; over-plan spending retains its actual amount and a red over-limit
  marker. Missing spending never becomes zero progress. Derived balance rows
  display their numeric balances without visible progress bars.

## Publication gaps requiring the financial builder

No page-side financial aggregate was added. Before the remaining owner requests
can be completed, Forecast needs to publish exact selected-period actual/planned
amounts with coverage, trust and semantics:

| Surface | Available now | Missing contract |
|---|---|---|
| Income waterfall | Individual receipt rows; planned income total | Trusted aggregate received / original planned |
| Household waterfall and header | Category planned/spent; aggregate reserve hold | Aggregate incurred spending / original plan, including explicit partial/unknown treatment |
| Bills waterfall and headline | Settled paid disclosure; period occurrence total | Original planned denominator that cannot be replaced by represented actual payment movement |
| Savings goals and waterfall | Proposed period contributions; projected gaps; saved balances | Exact-period required, confirmed fulfilled and remaining contribution; authoritative Funded / Still to fund / Not confirmed |

`budgetHold` is a reserve, not aggregate spending. `actualSaved` is a balance,
not this period's fulfillment. `cumulativeProposed` and projected `remainingGap`
cannot become confirmed saved contributions. Existing account backing is not
an inferred savings purpose. The renderer retains these unknowns rather than
guessing. Starting assignments remain unconfirmed and canonical amounts and
baseline assignments remain untouched.

The financial builder owns the new schema and independent numerical proof.
The parent has the detailed request in `final-polish-publication-request.md`
in the shared workspace. Integration remains pending; this draft is a reviewable
presentation slice, not a completed actual/planned or goal-fulfillment contract.

## Verification and fixtures

All captured browser traffic is intercepted. Values, names, dates and status
matrices are independently invented; no deployed data, scaled real values or
credentials are used. The native Bills sheet matrix covers eight evidence states
across six dates at 1440, 390 and 320px in light and dark themes (288 combinations).
Its injected rows prove presentation and raw-status preservation; the active
App/Forecast/Budget contracts separately prove financial semantics.

The active tests cover filters, source counts, unknown and contradictory status,
no settlement writes, empty groups, named savings evidence, unknown period
fulfillment, strict trust, historical/future scope and native drilldowns. Browser
tests cover focus restoration, responsive rerenders, 320px geometry, incomplete
observations, withheld savings, absent data and actual native evidence nodes.

Reproduction:

```text
node test/test-budget-owner-voice.js
node test/test-budget-ui-polish.js
node test/test-budget-surface.js
node test/test-household-budget-waterfall-contract.js
node test/test-authority-coverage.js
node test/browser-budget-bill-status.js
node test/browser-budget-v3-period.js
node test/browser-budget-v3-funding-month.js
npm test
```

Required CI and independent exact-head Atlas Contract / Systems Review remain
parent-owned merge gates. The builder does not merge.
