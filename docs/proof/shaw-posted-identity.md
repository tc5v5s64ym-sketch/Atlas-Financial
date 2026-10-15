# Guarded posted Shaw identity

One outcome: the exact shortened display name `Shaw` can identify the existing
Shaw bill when independent original-description, Bills-account, native-CAD,
debit, posted-evidence, occurrence and uniqueness guards all hold. The existing
long aliases remain unchanged. Forecast remains the calculator and classifier.

Current-state source: explicit Atlas repair instruction after a read-only
diagnosis. On main `6520782b54ceec8dc96e1208e90a9e1dd9e29004`, the displayed-payee
gate in `provider-observe.payeeMatchesRule` does not accept the shortened name.
An original bank description does not substitute for that displayed-payee gate.
The missing represented-transaction link leaves the named bill unverified and
the observation in Other Spend. No household transaction data is needed here.

## Independent invented ledger

The fixture uses only invented dates in April/May 2031, transaction/account IDs,
balances and amounts. Opening Bills cash500, observed debit17.23, household
allowance150 and income1000 are unchanged between merchant variants.

With the long alias, Bills actual is17.23 once, remaining0 and Other0. Before the
repair the shortened name instead leaves the bill's17.23 requirement still due
and adds17.23 to Other: the period balance is815.54 instead of832.77. The observed
Bills stock remains482.77 in both cases. The corrected short alias reproduces the
same one-cost result as the incumbent long alias, without modifying input state.

An actual21.07 receipt still identifies the bill, prints actual21.07 and leaves
observed Bills stock478.93. The authored plan and its period-cost projection remain
17.23, matching incumbent behavior; the repair does not reinterpret that projection.

## Proof boundary

`node --test test/test-shaw-posted-identity.js`

The same final28 tests against the exact unchanged base produce15 PASS/13 FAIL;
the candidate produces28 PASS/0 FAIL. To select an isolated base producer, set
`ATLAS_TEST_APP_ROOT` to that exact checkout; the fixture and literal oracles stay
unchanged. The tests drive actual normalization, observer identity, sanitized
actuals, live overlay, Forecast, Bills progress and Other Spend publication.

Controls cover both display variants, case/whitespace normalization, the original
long aliases, variable positive amount, missing/wrong original description,
wrong account, broader merchant, refund, duplicate candidates, pending/unknown
posting, native currency, once-date boundaries, category/note-only attempts and
malformed explicit posting qualifiers. Seven-day early/late once boundaries are
accepted; eight-day boundaries are refused by incumbent occurrence rules.

`requiredPostingEvidence: posted` is checked at the existing shared identity
boundary. It is opt-in and present only on the new exact alias. Explicit invalid
qualifiers fail closed. Pending and unknown posting cannot enter either normal
settlement or pending-only Bills receipts through the new alias.

The existing long-alias pending-only receipt/display behavior is pinned unchanged.
Its distinction from source-backed posted settlement is a separate **NEXT PR**
finding; this repair does not certify or broaden that behavior. The new alias is
posted-only. There is no Forecast change, global original-name fallback, generic
category-to-bill shortcut, provider call/write, household-input change or activation.
Independent Systems Review is required before release; the builder supplies no PASS.
