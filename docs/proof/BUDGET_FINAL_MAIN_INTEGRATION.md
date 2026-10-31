# Final main integration - PR #548

The current observation-qualification repair and source binding are recorded in [the amount repair report](BUDGET_AMOUNT_QUALIFICATION_REPAIR.md). This earlier repair/integration record is historical; the current receipt exercises 0465f65817a719ae4f5198313a5a125e80c8acf6. The reproduced Engine blocker supersedes prior release-clearance claims pending independent repair verification.

Dale directed one clean integration of the held current main into the existing PR. Main was verified as fc3e6cfd97b09478559f5bec05556ecd365624a6 before merging; the published starting head was 280c9b87a407cd627f2494cd537661c0756127c0. The prior builder confirmed read-only status. The owner checkout and its Git metadata were not changed. No merge or deployment is authorized here.

## Exact source boundary

- Exercised integration commit: 5fdadcd916c78e484c8a45504aedf2c0b7af2b04.
- Source tree: 3aece8f28404ad693e43f61982e45c53b4f885aa.
- Parents: 280c9b87a407cd627f2494cd537661c0756127c0, fc3e6cfd97b09478559f5bec05556ecd365624a6.
- Full source delta from the previous head is exactly the already-merged #561 addition: public/transaction-edit.css (+208), public/transaction-edit.js (+782), test/browser-transaction-edit.js (+386), test/test-transaction-edit.js (+755), test/test.js (+1), plus its five screenshots. No deletion.
- All imported blobs match main except the test registry, which combines the PR's existing suites with main's one added suite. All existing Budget/selector/Forecast, canonical data, provider, package, authority and workflow files are unchanged from 280c9b87a407cd627f2494cd537661c0756127c0.
- No material visual or financial change was made. The new transaction-edit component remains the upstream isolated component; this integration adds no live consumer or provider/configuration mutation.

The complete binary source-integration patch has SHA256 f1b8f259b25edbd8cc0065e5295423ac64eecd93f91361f23f9bfca2098fb77e. Publication after the exercised commit changes only docs/proof. The receipt is checked against raw Git blobs without normalization before and after browser execution.

## Fresh exact-source proof

The existing fixture-only Budget runner passed: 55 screenshots, 193 tracked raw/Git bindings and 30 served assets, errors:[], externalRequests:[]. The receipt now binds current main fc3e6cfd97b09478559f5bec05556ecd365624a6; the two new inert public files and test registry are included in the clean source tree. Existing served Budget assets remain identical.

The source-bound runner covers owner annotation repairs, native live dragging before release through remounts, timeline/focus/canvas retention, light/dark, emulated touch/cancellation, same-date native refresh, original geometry and spring, qualified and incomplete history, unavailable selectable dates, known zero, all Household rows and Other, native Income evidence, and the approved layout without Income/Payday tiles or page navigation. The upstream transaction-edit regression suite and syntax check passed separately. No formatter repair was repeated.

Existing 582 financial snapshot values carry through exact equality of the numerical snapshot script and its inputs; current-head figures CI remains a separate gate. Required complete hosted correctness checks are pending at publication and will be recorded in the PR card. Older 350/350 results certify only the prior head/base; they are not presented as current-head PASS.

## Approval and review boundary

Dale explicitly said at 2026-10-10 11:25:24 UTC: "Ok I approve the new design". That approval covers the design presented at 280c9b87a407cd627f2494cd537661c0756127c0 and carries to this verified mechanical integration because all existing Budget presentation files and served assets are byte-identical. It does not approve an unreviewed material visual or financial change. No repeated approval request is made for the identical design.

Root Systems PASS review 5478753358 covers 280c9b87a407cd627f2494cd537661c0756127c0. A bounded root Systems re-review of the new publication remains required; the builder does not carry or self-issue PASS. The remaining independent Design/Engine/Money and current-head full-check gates are coordinated by root. No builder Ready, merge or deployment is performed.

The saved household preview's qualified fresh Household evidence remains unavailable. The earlier reserve-role map validation limitation is separate configuration/data work; it was not changed or bypassed. Forecast remains the financial authority, estimate qualification and honest Unavailable states remain intact.
