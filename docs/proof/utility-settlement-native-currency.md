# Utility settlement requires native transaction units

Source: explicit ChatGPT decision-desk dispatch to investigate the generic
utility currency admission limitation identified during PR #500 review. Current
main at dispatch and reproduction was
`d6d3d291357c78c9d50012f93736c98336ba525e`. This is evidence qualification,
not a change to Fortis or Hydro schedules.

## Reproduced failure

`test/fixtures/utility-currency.js` uses invented amounts: a CAD 183.61
scheduled bill, a 59.83 transaction, and CAD 934.17 opening cash. The mapped
Bills account explicitly has CAD currency. Amounts intentionally differ.
The raw production observer receives the transaction's own currency; no
legacy native-unit adapter fills missing fields.

On the base identity document, all three rules (`fortis`, `hydro-due-sep1`,
`hydro-equal-payment`) accept each of CAD, USD and null transaction currency:
one represented occurrence, a 59.83 bill actual and zero remaining cash hold.
Forecast publishes `settlement: represented`, `actual: 59.83`, `remaining: 0`
for all nine controls. Thus USD/null evidence is falsely admitted as CAD.
This demonstrates a synthetic failure, not a claim about real utility debits.

The same current-main observer and Forecast sources reproduce the failure
with the base identity document. Both source files are unchanged by this PR.
The new regression failed before the repair at `fortis USD cannot settle a
CAD occurrence` (one candidate, expected zero).

## Smallest repair and authority

Add `requiredCurrency: cad` to those three rules. The existing shared
`ruleCurrencyQualified` contract already enforces transaction-native units
for posted matches, pending-only bill actuals and inherited pending
replacements. Unqualified evidence survives as `currencyUnconfirmed`, with
incomplete transaction coverage. Mapped account currency and `to_base` do not
provide an authorized FX conversion contract.

Forecast remains the sole calculator and occurrence authority. The observer
only earns evidence linkage. No new planner, FX converter, schedule, amount,
account, balance, opening, category, credit fact or real transaction changes.
The change touches none of PR #501's UI regions.

## Independent and consumer proof

Run `node test/test-utility-settlement-currency.js`.

For every identity, independent cents establish the expected 18361-cent
scheduled hold and 5983/6127-cent observations. Tests reach both the raw
observer and `Forecast.recommend().currentPeriodAction`, including:

- Native CAD settles once at the observed amount, retains the nominal plan,
  removes the cash hold and excludes the linked bill from category spending.
- USD, foreign `to_base`, absent, null and blank currency earn neither a
  settlement nor a CAD actual/spending row. Forecast retains the occurrence
  as unverified and withholds precise remaining claims.
- Native pending evidence keeps its incumbent provisional budget reservation
  and never earns a posted represented-event candidate. Foreign/missing-unit
  pending evidence is rejected.
- Wrong account, unrelated payee and refund cannot settle the utility.
- A repeated provider ID earns one settlement and one actual; two distinct
  compatible debits remain ambiguous. A separate foreign neighbor cannot
  supply another CAD amount and keeps coverage incomplete.
- A directed pending-to-posted provider replacement admits a native CAD
  61.27 posted actual once; a USD replacement cannot inherit CAD settlement.

The older Hydro fixture now declares its invented CAD units at its boundary,
preserving explicit overrides and every existing assertion. The new missing
and foreign-unit tests continue to call the raw observer without that adapter.

Canonical figures are compared using each exact revision's own
`scripts/figures-snapshot.js`; the PR evidence records the base and final head.
The expected canonical snapshot delta is zero. Live foreign/missing-unit
evidence intentionally changes from falsely represented to unverified, so a
zero canonical snapshot delta does not claim unchanged live evidence behavior.

## Separately reproduced incumbent limitation

On base `d6d3d291357c78c9d50012f93736c98336ba525e`, supplying the same invented
CAD provider row twice yields one settlement and one 5983-cent bill actual,
but two sanitized spending rows and an `excluded.bills` tally of 11966 cents.
This PR tests settlement/actual uniqueness for that replay, not general
sanitized-row deduplication. The tally issue predates and is independent of
native-currency qualification; it is reported for separate bounded triage.
No assertion or production guard is weakened to hide it.
