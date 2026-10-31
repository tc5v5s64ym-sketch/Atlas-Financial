# Exact whole-cent provider amounts for split previews and readback

Source: owner-authorized narrow repair after the independent main0edf7a1 audit.
The audit found `12.5000` could be read but could not preview conserving caller
splits `6.25 + 6.25`. Source tracing also found returned four-place children were
passed to the strict caller parser. A synthetic pre-change control reproduced
the latter as `write-unverified` even for a two-place parent.

[Lunch Money's amount contract](https://lunchmoney.dev/amounts-and-balances)
documents decimal strings with up to four places for both transactions and
children. Provider evidence is retained verbatim. Strict caller/write input
continues to accept only the existing bounded two-place syntax.

The separate private provider-cent converter validates that wire syntax and
requires every decimal place after cents to be zero. BigInt parsing constructs
the exact cent magnitude before converting to Number; magnitudes exceeding
Number.MAX_SAFE_INTEGER are rejected. Fractional cents are never rounded.
Only the provider parent and returned child conversion sites use this helper;
expected outgoing child amounts still use the original strict parser.

This is a provider-format availability fix, not new write authorization.
Signed conservation, nonzero same-sign children, original parent wire identity,
currency/date/payee/account/category/notes readback, scope/subject, explicit
confirmation, preview fingerprint/expiry/consumption, locks, and no retry after
ambiguous or mismatched writes remain unchanged. No currency conversion,
balance update, household amount/policy, Forecast, rules or credential change is
introduced. Query outputs keep their original fractional/provider strings.

`test/test-assistant-provider-amounts.js` uses an injected synthetic transport
and synthetic token only. Positive controls cover positive/negative, two/three/
four-place and leading-zero whole-cent parents with four-place returned children.
Independent hand-cent expectations cover conservation. Fractional/unsafe parent
controls, strict caller syntax, signed/nonzero/conservation rejection,23
post-write readback mutations, confirmation/subject/scope/staleness/category
guards and ambiguous-write consumption remain unavailable or unverified.
Private in-memory helper exposure tests the exact safe-integer boundary without
changing production exports. Existing lookup/precision/error sanitization and
bounded edit suites remain in the validation path.

No live provider query or write is needed or authorized for this proof. Apply
controls call only the in-process fixture; no real split, category edit, rule,
token, account or transaction is touched. The existing registry entry is reused,
so concurrent date-validation work needs no duplicate registration. Exact-head
focused/privacy/hosted checks and parent-owned Systems review remain merge gates.
