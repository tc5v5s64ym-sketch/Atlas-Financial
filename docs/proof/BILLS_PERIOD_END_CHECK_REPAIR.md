# Bills period-end publication: four hosted check repairs

This is a bounded repair of the four failing suites on #543 head `837564de129a7a11b406c89b77d9b5acec7f4a9c`, not a change to the financial calculation. The original failures and independent diagnostic are recorded in [the reviewer handoff](https://github.com/tc5v5s64ym-sketch/Atlas-Financial/pull/543#issuecomment-6048010299). The [prior exact-head Systems PASS](https://github.com/tc5v5s64ym-sketch/Atlas-Financial/pull/543#pullrequestreview-5449028957) remains a historical verdict; the repaired head requires its own bounded review and green checks.

Merged main `48ede6901123605efd0e146ce128cc1f742a1fb6` (#544) is integrated. Git blob comparisons establish:

- Forecast is unchanged from reviewed #543: `c1cab912cadc51cb5f4e933a2942572bce483b76`.
- Budget renderer is unchanged from reviewed #543: `64210f0a7076ae8aed58a80a0ddad0dd65ed15b3`.
- Canonical data is identical to merged #544 main: `f4adb50fb284b77cc08517f345f461d24559df9a`.

## Repairs and retained protection

| Suite | Exact defect and repair | Protection retained |
|---|---|---|
| Recorded minimum action | Its pinned old engine predates the added Bills publication. Validate that addition, then exclude only its three concrete publication paths before monetary/null comparison. | Frozen `ab4cd7ec` baseline, all original comparisons and 462 action assertions retained. Added controls still reject a one-cent incumbent change, unexpected monetary additions and a false publisher; 465 assertions pass. |
| Strict minimum date cache | The VM-only hook named the former first export. Target the unique export-object declaration and assert the private date function was exposed. | Independent Gregorian oracle, hostile/malformed types, false cache hits, eviction, 256-entry bound and actual timezone child processes retained; 10,910 checks pass. Production exports are unchanged. |
| Savings immutable before/after | Its pinned engine also predates this authorized addition. Use the same narrowly scoped positive validation before the original complete-object comparison. | Frozen `210fb231` baseline and all incumbent money/trust/display/publisher mutations retained. Added controls reject false Bills readiness, wrong publisher and a namespace outside the three authorized paths. Missing and explicitly empty savings configurations both pass. |
| Synchronized Budget wheels | The mock returned wheel objects for every DOM selector. Return wheels only for the actual wheel selector, and no nodes for absent controls. | Unmodified production event handlers, row selection, pointer capture/cancellation, clicks, keyboard, bounds, motion and resizing still pass all 18 original checks. |

The shared comparison helper preserves every other field and value. These two synthetic probes supply no actuals packet, so the addition must have Forecast ownership, Bills-only/CAD scope, the correct as-of, unavailable/unknown/null total, no spending permission and the explicit incomplete-ledger issue. All three paths must be present. This is not a blanket namespace deletion or a new numerical oracle. The added figure retains its separate independent native/funding proof.

## Integrated verification

- All four named failing suites pass locally.
- The 775-assertion Bills numerical/native proof and ten deliberate wrong-code controls pass.
- Every incumbent advice field remains equal to merged main `48ede690` across 13 variants after removing only the added publication key.
- #544's independent annual-fee proof passes with canonical scope, dated invented cash/debt ledger, estimate stamps and current-year preservation.
- Full-suite and required hosted results will be recorded on the frozen head in the PR merge card. No completed full-suite result is inferred from these targeted passes.

Reviewer task `01a1149d-70ca-7579-a5b9-1a016b425024` should review this test/proof delta, the trusted #544 integration and continued native-unknown/payer controls on the exact new head. Coordinator: `01a1186d-afdd-721e-873a-dd4dbf6500cd`. No merge is authorized by this builder proof; the repository requires current-head Systems PASS and all required checks green.
