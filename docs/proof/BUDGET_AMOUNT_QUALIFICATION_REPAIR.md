# Observed amount qualification repair - PR #548

Independent Engine review reproduced a real financial/trust blocker at f453827fde7d82860c44d0a07a9250919ffa1742. Empty string, whitespace, false and an empty array became complete calculated zero; true became a complete calculated one. The transaction normalizer performed Number(raw.amount) before the existing missing-amount guard, losing the original qualification. Matching invented endpoints did not prove a qualified posted ledger. The prior green 351-suite jobs and bounded Systems source PASS 5478802079 did not cover this case and are not release clearance for the repair.

## Bounded repair

- Exercised code: 0465f65817a719ae4f5198313a5a125e80c8acf6; source tree: f376b821a33b2129b873ff3c2f7f4378f2b3e61c; integrated main: fc3e6cfd97b09478559f5bec05556ecd365624a6.
- Exact delta from f453827fde7d82860c44d0a07a9250919ffa1742: scripts/provider-observe.js (+9/-3), test/test-card-period-movements.js (+69/-0), test/test-provider-observe.js (+28/-0). No existing assertion removed or weakened. Source patch SHA256: 9c15314708895a52ad7607912f704772cdf761136d4f235e2512f38b579da9b6.
- Normalize transactions through the existing amount helper. It accepts finite numbers and signed decimal strings before conversion; empty/blank inputs, booleans, arrays, objects, nonfinite and non-decimal representations remain null. Precision, sign and genuine zero are preserved. The [primary provider amount contract](https://lunchmoney.dev/amounts-and-balances) describes monetary decimal strings; the supported four-place controls remain unrounded at qualification.
- Reuse the existing missing-evidence and coverage-marker path. No coverage, identity, date, currency, pending, classification or financial formula branch was changed. Forecast retains publication authority. No canonical input, provider/configuration/credential, workflow, account map or public visual file changed. No Lunch Money editing implementation was added.

## Reproduction and verification

The original independent probe was read and rerun on the clean prior head, obtaining all five reported failures. Its source SHA256 is fc2f761d4ec5e1c6fadf3f0f74e830150dc03f8a49f11344e6779d11dc6c8772. The builder adaptation changes only the module root; all ten invented cases and their independently specified integer-cent endpoints/expected outcomes remain unchanged. It now has zero failures. All four valid control publications and existing null behavior exactly match the prior source. [Before/after native probe](amount-qualification-probe.json).

The new end-to-end regression first rejects the prior implementation at "empty string native qualified delta" (actual 0, expected null). Repaired movement tests pass 534 independent assertions. Twenty-two new observation -> sanitized overlay -> Forecast -> native renderer controls cover valid zero, debit/credit decimal inputs, malformed types and non-decimal forms with a separate 900 pending authorization. Malformed posted observations preserve unconfirmed markers and yield Unavailable, never a complete zero/one. Inputs and account maps are not mutated. Provider tests additionally cover supported four-place precision, finite scalar types, native identity/date/currency/pending preservation and malformed controls.

Eleven focused suites pass: movement, provider observation, live plan, pending observation, production live-overlay boundary, current-period actuals, Household classification, confirmed card-payment transfer, unresolved pending/posted spending, Forecast and authority coverage. Tests use invented fixtures/local mocks; no live credentials or provider write/request was used.

The prior published revision's own financial snapshot was executed in an isolated clean baseline worktree and compared with the repair's own snapshot. All 582 keys (296 numeric values plus date/verdict/string fields) are identical. Both raw snapshot outputs have SHA256 60b0328bc9174270ef23c1bba6e2d61f52cc674204ad6cd07728ad6eeabc8ac6. Prior references to "582 numerical values" mean the complete 582-key financial snapshot, not 582 number-typed values. Canonical inputs remain unchanged.

Fresh complete clean-start browser proof passes 55 screenshots, 193 raw/Git source bindings (including the changed observer), 30 served assets, errors:[], externalRequests:[]. Every served visual/Forecast asset hash is identical to the prior publication. It covers native early dragging/remount/focus/motion, original selector comparisons, both themes, fitted hero, all Household rows/Other, native HELOC panels, qualified history, unavailable dates and true zero. No separate Income/Payday tile, browser money calculation or page navigation was introduced. Publication after the exercised source changes only docs/proof.

## Release boundary

Dale's 2026-10-10 11:25:24 UTC approval of the presented design carries to unchanged public visual files. Independent bounded Design PASS and the 19 dated Money reconciliations may carry only under root's disposition of these unchanged valid publications. Fresh Household/HELOC completeness remains limited by the existing reserve-role configuration/evidence limitation; it is not corrected or bypassed.

Required complete hosted push/current-main correctness checks for the new publication are pending at publication. They register 351 suites, with existing assertions retained. Root must obtain independent Engine repair verification and a new exact-head Systems review; the builder does not self-issue or carry PASS. Keep Draft. No Ready, merge or deployment. No formatter repair was repeated.
