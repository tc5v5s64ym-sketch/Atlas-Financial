# Bills period-end balance: native amount and payer repair

This records the bounded repair of the two private independent-review findings on PR #543 head `cd595687f1a66ce35f9de1d03fde9de2ff5451ed`. It is builder verification, not an independent review verdict. The financial repair source is `062c07a10bb082582615aa8687a63c3e1cda74d1`; the subsequent commit adds this proof, sample pixels and pointer-open checks. The PR merge card records the frozen candidate and pending re-review/checks.

## Unknown native amounts

The incumbent calendar/event projections can omit null, missing or nonfinite scheduled amounts. The Bills publication now validates eligible native remaining bill/obligation, commitment and future-income occurrences before those projections. It uses incumbent cadence, statement occurrence, settlement, disabled/optional and carry rules. It does not change those owners or any existing publication.

Explicit numeric zero, named no-pay, observed settlement, omitted income adjustments and out-of-period occurrences remain distinct from unknown. Missing/nonfinite eligible Bills amounts make only the added estimate unavailable; dated known stock survives. Unknown totals do not display incomplete components as $0.00.

## Bills-specific payer scope

Explicit Weekly, Savings and other known cash payers do not imply a new Bills debit or transfer. The new publication excludes their native future cash requirements. Unknown explicit payer ids withhold the result. Unassigned household outflows retain the owner's existing Bills funding anchor; this assumption is published and disclosed. Card funding, allocations, minimum payments, paired transfers, reversals and uncovered carry keep their incumbent treatment.

## Independent repair identity

Every value is an invented sample. Reviewer-selected control:

```
823.47 + 263.19 - 17.23 - 9.41 - (71.13 + 29.27) = 959.62
```

| Native change | Correct added publication |
|---|---|
| No change | Estimated $959.62 |
| Eligible bill/commitment/income amount null, missing, NaN or infinite | Unavailable, amount null; stock $823.47 preserved |
| Explicit bill amount zero | Estimated $976.85 |
| Explicit commitment amount zero | Estimated $969.03 |
| Explicit future income amount zero | Estimated $696.43 |
| Bill paid by Weekly or Savings with no Bills cash event | Estimated $976.85 |
| Commitment paid by Weekly or Savings | Estimated $969.03 |
| Unknown explicit future payer | Unavailable with account-scope reason |

## Verification

- The reviewer-selected original **25 cases now pass**, including all eleven previously failing cases, with stable repeat calls and immutable inputs. The unchanged reviewer script was copied into this worktree's evidence directory and only its source root was redirected; this is a builder replay, not independent approval.
- `node test/test-bills-period-end-native-requirements.js`: **578 independent assertions across 45 cases**, including both helper and actual `Forecast.recommend(...).defaultView` publications. Covers nonfinite/missing values, explicit zero, known/unknown payer scope, required payments, settlement, disabled/optional rows, carry and income adjustments.
- The original **197 assertions / 26 cases** still pass. `node test/test-bills-period-end-negative-controls.js` rejects **10 deliberately wrong implementations**, including removal of native validation and forcing other cash payers into Bills stock.
- The preservation probe against main `c2f4ca19bba7a772be218bbc412da9920926d0ee` passes **13 variants**, including all three native unknown amount types and explicit other-account bill/commitment payers. Every existing advice field is deeply equal after removing only the added balance key.
- `test-authority-coverage.js` and `test-budget-surface.js` pass.
- The actual-App browser harness passes **16 scenarios**: the original nine desktop/mobile trust states plus seven reviewer-selected native amount/payer cases at 320px. It checks pointer opening/closing, keyboard Escape/focus restoration, no horizontal overflow, and no partial terms in unavailable states. Estimated states also cover repeated actions, period navigation, Month toggle and resize. Zero external/non-GET requests or page exceptions. Pixel evidence was inspected.

Invented sample screenshots:

- [Unknown native bill: stock retained](bills-period-end-sample-native-bill-unavailable-320.png)
- [Unknown native commitment: stock retained](bills-period-end-sample-native-commitment-unavailable-320.png)
- [Weekly-paid bill excluded from Bills stock](bills-period-end-sample-native-weekly-payer-320.png)

No full-suite pass is claimed for this repair. The old local run was not restarted; its log has no completion result. Exact-head hosted tests/figures checks and bounded independent Systems re-review remain required. No production data, live provider ledger, credentials, merge or deployment are included.
