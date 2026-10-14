# Payday-gap cash identity proof

All account IDs, reports, dates, labels and amounts in this proof are invented.
No owner screenshot, private provider packet, credential or bank history is included.

## Defect and repair

Frozen base: `52532e1719e39643b048a8783609719220ad2ddf` (deployed PR613).
`provider-observe.js: householdCashIdsFromPlan` demanded a household-cash mapping
for every opening breakdown row, including a correctly mapped purpose reserve.
That prevented earning `paydayGapComplete`, so `live-plan.js` could not retain a
legitimate snapshot. `Forecast.savingsDailyFunding` then emitted
“No original payday cash observation supports the cycle bridge.”
`savingsClosingProjection` passed that hold to future closes; both renderers
displayed it through the shared publication.

The adapter now uses the same chequing identities as Forecast's spendable
opening when those identities exist. Generic legacy mapping requirements remain.
The original-cash presence guard in `live-plan.js` prevents null/blank/missing
cash from becoming zero during the newly usable reconstruction path. A matching
valid frozen snapshot remains independently usable. Forecast is unchanged:
its snapshot, original-to-current reconciliation and all other gates remain.
Reconstruction also requires exactly one original row for each required operating
identity. Duplicate observations cannot manufacture a larger known opening;
a valid existing frozen snapshot still takes precedence.

## Independent reconciliation

Invented original operating cash: 70 + 30 = 100. Complete posted gap: credit20,
debit7. Original payday opening: **100 + 20 - 7 = 113**. The reported reserve119
does not enter this opening. Real `Live.fromObservation` calls the observer and
retains exactly113; it never substitutes current live cash or scheduled income.

The shared Forecast publication becomes ready in the fully qualified invented
case. Operating cash plus projected Savings conserves **113 + 119 + future
receipts**, with future actual Saved unknown and money-movement permission absent.
No canonical input, transaction, settlement or history is changed.

## Before and after

The exact expanded `test/test-payday-opening-authority.js` test text run against
the frozen base runtime fails9 checks. The repair passes all115 authority checks,
including44 new checks. Controls retain missing/wrong operating mappings,
truncated/incomplete/short windows, unknown pending coverage, pending cash,
unmapped rows, untrusted amounts, missing original cash and conflicting snapshots.
Numeric zero, numeric strings and valid retained snapshots remain supported.

Independent review found duplicate canonical operating rows could produce a
false known opening on candidate `d8489f70f55464310efcadfe6d24be1ada5e87c0`.
The same expanded test text fails the duplicate-A and duplicate-B real-pipeline
checks on that runtime, while the narrow identity guard repairs both. The tests
verify no reconstructed snapshot and unavailable current funding, plus unchanged
inputs. Two separate controls preserve valid frozen snapshots with duplicate
original rows. No next-period diagnostic or Forecast policy changed.

```powershell
node test/test-payday-opening-authority.js
```

Nine affected suites passed: provider-observe, live-plan, payday-opening-authority,
savings-observer-contract, savings-future-closing, savings-card-recipient,
reported-savings-earmarks, authority-coverage and source-check-status.

The browser proof generates the same invented report through each revision's
real observer and live adapter, serves that revision's real public assets, and
intercepts every GET. It verifies navigation through October23, November6 and
November20, ending at the invented November20–December3 period. Before: the exact
bridge reason and unknown closing. After: qualified closing and conserved cash.
Four cases pass at390 and1440 pixels, with no errors, external requests, writes,
input mutation or horizontal overflow. The images show invented data only.

```powershell
$env:ATLAS_GAP_BASE_APP_ROOT='<clean base52532e1 checkout>'
$env:ATLAS_GAP_BROWSER_PROOF='<output directory>'
node test/browser-payday-gap-cash-identity.js
```

`browser-verification.json` records actual served-asset and backend file hashes.
These are working-file bindings from the proof run, not an invented Git-head
attestation. Runtime and test blobs are frozen with this candidate. The canonical
600-field comparison against base52532e1 moves0 fields; it does not prove that
live figures remain unchanged when a previously withheld snapshot becomes known.

## Evidence limit and release boundary

The owner's Info reason matches this reproduced mechanism, and the source check
does not mean Savings balances are absent. The live provider packet has not been
independently replayed. The owner screenshot's selector is cropped; the requested
November20–December3 context is not asserted as its verified selected date.
Correcting this prerequisite can reveal a later legitimate hold. Owner figures
reconciliation, signed-in/Safari acceptance, exact-head Systems Review and full
CI are required before release. No merge, deploy, provider write, financial input,
classification policy, durable history or Muse sweep/Fuel implementation is part
of this repair.
