# Budget receipt repair and compact totals

Owner-directed correctness follow-up to #495, based on main
`1506058142fa0e84afc3106008e27255e887b227`, including #491's card-coverage and
minimum-intent protections. This is the constrained income repair and requested
subtitle removal. The later owner simplicity direction remains the UI target.

## Receipt identity

The legacy named salary guard requires the exact scheduled date and planned
amount. Independently invented raw evidence reproduces an employer receipt
before the nominal salary date and a paired household transfer after it, for
an amount different from the plan. Main omits that salary's actual.

The new path requires a complete, explicitly bounded posted window; native CAD
on every leg; an exact configured employer alias; a classified income credit
on the configured external provider account; a uniquely paired debit and BILLS
credit; matching receipt/transfer amounts; and exactly one named salary
occurrence bracketed by receipt and transfer dates. Competing sources,
counterparts, transfers or occurrences fail closed. Amount alone never proves
salary. Gross coaching receipts and generic transfers do not become income.
One receipt packet cannot settle multiple occurrences. Legacy identity remains
available, and the same transfer is not double counted by both paths.

Forecast's active period income total reuses its existing
`calendarIncomeContribution` selector. Known receipt magnitudes replace their
planned contribution; ordinary unconfirmed plan fallback remains the incumbent
Forecast behavior. Original planned row amounts and ratio denominators stay
unchanged. The interface computes no financial totals.

### Systems B1: received detail must use actual receipts

Review [5407130262](https://github.com/tc5v5s64ym-sketch/Atlas-Financial/pull/496#pullrequestreview-5407130262)
blocked head `91e9661`: the correct received total coexisted with individual
received lines showing their original planned movements. Every received-income
detail consumer now reads `Forecast.incomeReceivedAmount`, also used by the
progress receipt total. Original plan amounts remain explicitly labeled
`Original plan`; missing actuals print `Unavailable`. The represented-actual
map rejects null and malformed amounts instead of coercing them to zero.

The browser opens Info and independently sums only its received line amounts,
then compares those cents with its printed Actual total. Fifteen views cover
current, completed, absent-source, truncated and missing-actual evidence at
1440/390/320px, with unequal plan and actual amounts. Unit coverage additionally
checks contradictory settlement/trust, numeric zero and malformed actuals.
The review outcome for the replacement head remains pending independent review.

## Independent reconciliation

All amounts, dates, provider IDs and employer aliases in fixtures and captures
are independently invented. No current household receipt data is stored here.

| Contract | Independent cents oracle |
|---|---|
| Confirmed income | 249318 + 173318 = 422636 |
| Original income plan | 252025 + 180025 = 432050 |
| Household actual | 21531 + 10265 + 1835 + 963 = 34594 |
| Visible category plan | 22000 + 8500 + 6000 = 36500 |
| Existing spending reserve | max(22000,21531) + max(8500,10265) + max(6000,1835) + 963 = 39228 |
| Balance after deductions | 422636 - 0 bills - 39228 reserve = 383408 |

Prior-period/future spending, a refund, an unrelated external coaching receipt
and a historical category outside the visible category contract are excluded.
An omitted salary source stays partial; truncated evidence stays unknown.
An existing signed-credit regression now uses invented numbers and proves
positive receipt contribution, original-plan retention and the full deduction
identity rather than requiring planned payroll after receipt evidence exists.

## Presentation and proof

The numeric summaries retain actual/original-plan amounts. Partial evidence
uses a compact `*` plus screen-reader text; missing amounts use `Unknown`.
When both values are missing, one visible `Unknown` has accessible plan context.
Requested descriptions beneath Income, Bills, Household, Savings and the final
deduction total are removed. Incumbent detail/Info evidence retains caveats,
settlement status, reserve semantics and unavailable explanations.

| Same raw invented rows through each version's observer and renderer | Comparison |
|---|---|
| Received, desktop | [Main beside repair](comparison-received-1440.png) |
| Received, 320px | [Main beside repair](comparison-received-320.png) |
| Received Info, 320px | [Evidence](comparison-received-info-320.png) |
| Missing salary source, 320px | [Partial evidence](comparison-partial-320.png) |
| Truncated evidence, 320px | [Unknown evidence](comparison-unknown-320.png) |
| Completed-period received Info, 320px | [Historical receipt lines](history-info-320.png) |
| Missing actual Info, 320px | [Unavailable receipt amount](missing-actual-info-320.png) |

The PR records the frozen exact head, required suite outcome, browser results,
artifact hashes and independent Systems review. Screenshots alone are not a
passing-head claim. Active App.boot tests cover 1440/390/320px, compact numerics,
Info opening by keyboard, exact focus restoration above the dock, no overflow,
missing data and the independent deduction identity.

Current and completed received Info list `$2,493.18` and `$1,733.18`, separately
labeling the `$2,520.25` and `$1,800.25` original plans. Missing-actual Info lists
the known `$2,493.18` receipt, an unavailable salary receipt and a partial actual
subtotal of `$2,493.18`, without replacing the unknown with its plan.

## Remaining evidence gaps

The supported read-only Atlas connector exposes current category aggregates and
an unclassified subtotal/count, but no selected-period reconciliation membership
or payroll represented-actual packet. Its current main Forecast is unavailable
under the incumbent card-coverage guard. This environment has no existing local
observer token, DPAPI store, live account mapping or authenticated browser path.
Consequently this repair does not claim to explain the live one-cent payroll
discrepancy or verify live Other membership. Those require selected-period Atlas
reconciliation and original receipt/represented-event evidence. No rounding
adjustment, canonical amount change or fabricated completion is introduced.

Configured savings assignments remain unconfirmed. No demo/sample toggle ships.
No additional optional design expansion is part of this repair. The retained
#480 reference and subsequent owner-directed scope do not prove pixel completion.
