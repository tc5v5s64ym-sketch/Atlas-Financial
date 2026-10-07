# Bills-only expected period-end balance

This is one added Forecast publication, rendered on the active pay-period Budget view as **Expected Bills balance at period end**. It is always an estimate when available. It is not spending or transfer permission.

## Source and current-state gate

Source: the owner's 2026-10-07 instruction, dispatched through the active ChatGPT decision desk, to show the expected ending stock of the Bills account while preserving the existing Balance After Deductions calculation.

Verdict: **STILL BROKEN** before this change. Main had the income-based period waterfall and dated account observations, but no Bills-only closing-stock publication. The implementation was rebased onto `c2f4ca19bba7a772be218bbc412da9920926d0ee`, including merged #541 and #542. No unpublished card-strip branch was consumed.

Authority: `Forecast.billsAccountPeriodBalance`, consumed by `planDefaultView` and the Budget renderer. This is a missing capability, with one new owner. The renderer formats the returned terms and trust state; it does not calculate a balance.

## Calculation and trust contract

The estimate is:

```
dated posted Bills cash
+ qualified future income not already represented in that cash
- remaining calendar bill cash
- remaining household funding estimate
- other required planned cash outflows
- uncovered earlier / nonbudget card cash
```

The household estimate uses the incumbent active Budget hold, H, including its existing treatment of overspending. Observed funding, F, comprises net paired Bills-to-Weekly funding, eligible direct Bills household purchases, and validated current-Budget card-backfill allocations, less confirmed reversals. Whole mixed card payments are not treated as household backfill.

Remaining household cash is `max(0, H - F, pending Bills household cash + uncovered current-Budget card cash)`. This is an explicitly estimated aggregate funding attribution. It does not establish per-category allocations. Uncovered earlier or nonbudget card cash is protected separately, using the existing reconciler's validated coverage. Negative Bills balances remain negative; Weekly's balance, overdraft and Savings balances do not enter this figure.

The stock and source date remain visible when the total is unavailable. The estimate withholds on incomplete posted/pending coverage, missing or duplicate native identities, unpaired outgoing Bills transfers, ambiguous payment intent or card opening, unknown remaining requirements, unqualified income, or contradictory balance/date evidence. A dated provider observation is allowed to lag when newer posted Bills movements are not being mixed into that older stock. Neither an owner's newer bank number nor a back-solved opening silently replaces the canonical baseline.

Existing Balance After Deductions, Month, Road Ahead, Savings and simulation-opening semantics are preserved. The new estimate is an added field, with its own label and scope.

## Independent numerical proof

All values below are invented samples, not live household balances. The primary fixture's hand-worked cash identity is:

```
H = 300.22 + 220.15 = 520.37
F = 240.16 + 31.27 + 88.43 = 359.86
remaining household = 520.37 - 359.86 = 160.51
closing = 1,373.29 + 643.17 - 93.41 - 160.51 - 27.19 = 1,735.35
```

The `111.11` posted card payment includes only `88.43` of validated current household backfill; the `22.68` prior-debt/required-payment portion is excluded from F. Its posted cash is already in the source stock.

`node test/test-bills-period-end-balance.js` passes **197 assertions across 26 independent cases**. These cover negative stock, paid/funded costs, funded and unfunded overspending, equal amounts with distinct native identities, duplicate identities, mixed minimum/backfill, paired returns, card reversals, cross-period carry, early income, pending/uncovered cash floors, provider lag and contradictory observations. Inputs and canonical data remain unchanged; repeat calls are stable.

`node test/test-bills-period-end-negative-controls.js` rejects **eight deliberately wrong implementations**: including Weekly overdraft, deducting H twice, ignoring returns, counting an entire mixed payment as backfill, discarding the pending/card floor, replaying early salary, releasing earlier carry, and publishing an unknown result as ready.

The numerical suite and mutation controls are registered in `test/test.js`.

## Preservation and rendered proof

`ATLAS_BILLS_BALANCE_BASE=origin/main node test/probe-bills-period-end-preservation.js` passes against merged main `c2f4ca19`: every existing `Forecast.recommend` advice field is deeply equal across seven variants after removing only the added `billsAccountPeriodBalance` key. This compares the baseline module with the candidate, rather than reconstructing its old outputs. The variants include Weekly overdraft, overfunding, unknown card opening, truncated ledger, earlier carry and household overspending.

`node test/browser-bills-period-end-balance.js` passes actual `App.boot` at **1440, 390 and 320px** for estimated, unknown card coverage and incomplete ledger states. Every state exercises disclosure opening, keyboard Escape, close-button focus restoration and horizontal overflow. Estimated states additionally exercise repeated disclosure actions, next/previous period selection, Month/pay-period navigation and viewport resizing. The local run recorded zero browser exceptions, external requests and non-GET requests. All provider responses are invented and intercepted; no deployed page, bank profile or live data is used.

The following screenshots were inspected as actual pixels. They are invented samples:

- [Estimated desktop card](bills-period-end-sample-estimated-1440.png)
- [Estimated 320px card](bills-period-end-sample-estimated-320.png)
- [Unavailable card coverage at 390px](bills-period-end-sample-coverage-unknown-390.png)
- [Desktop calculation disclosure](bills-period-end-sample-details-1440.png)

The runtime proof above was completed on source head `6b6045d53fac15f4c56cf4b0464c2a9f0eecc1c7`. The following commit adds only this proof and sample screenshots. Full `npm test` is running on that runtime source; its result and the exact draft head must be recorded in the PR merge card. No full-suite pass is claimed here.

## Review and remaining uncertainty

This financial/trust change requires Atlas Contract / Systems Review before merge. The owner additionally requires independent agent review; the builder does not satisfy either lane. Draft publication is authorized after the targeted numerical and browser proof. Merge and deployment are outside this task.

This estimate cannot establish per-category funding, invent payment intent, or settle genuine missing card-opening/coverage evidence. Those existing guards may keep the live total unavailable until the native evidence is confirmed. The dated known Bills stock remains visible.
