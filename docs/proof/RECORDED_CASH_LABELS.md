# Current spendable cash and recorded balances

Owner-authorized presentation repair, verified first on main
`2da9c0abe7ab2fdb42e84be3e84943d07cbf26bb` (2026-10-07).

Forecast's `startingCashAmount` is already correct: household Chequing A+B;
designated Savings remains reserve evidence. Deep Dive and Budget's retained
13-week notes incorrectly named Savings beside that amount. The existing dated
history sum follows captured snapshot membership, which includes Savings, and
used the same spendable label. A historical account sum is not spending permission.

Independent invented audit balances reproduced the distinction: Chequing
1247.31+286.42 gives1533.73, while including Reserve973.58 gives2507.31.
Moving200 from chequing to reserve lowers spendable cash200 and leaves the
recorded broader sum unchanged. No household balance is inferred from those
examples.

This change corrects current presentation wording and calls the historical sum
**Recorded cash balances**. Its included-account disclosure lists the names
attached to each compared reading, with that reading's date. Coverage, captured
membership, balances, movements, account evidence and missing-data guards remain
unchanged. Different account sets remain incomparable. Legacy internal coverage
names remain for compatibility; no archived snapshot is reclassified or rewritten.

The existing history mount is moved out of Budget's hidden legacy section into
a closed, keyboard-accessible Recorded account balances disclosure. One mount
and one renderer remain. Current notes are corrected when displayed; stored
dated source explanations remain untouched. The legacy 13-week parent stays
hidden. Bills-only Current Balance, native Forecast totals and savings
assignments are separate and unchanged.

`test-recorded-cash-labels.js` uses only the independent
`test/fixtures/recorded-cash-labels-data.js`, traverses native observation,
Forecast and actual page printers, and checks hand totals1375 chequing,
1215 Bills-only and2507.31 recorded historical cash. It proves dated membership,
long names, completeness, changed-scope withholding, escaped names and immutable
inputs. Existing B20 numeric/provenance/history protections are retained; two
incomplete-output assertions now check the actual replacement label.

Manual `test/browser/recorded-cash-labels.cjs` covers real desktop/mobile/320px,
long membership names, Tab/Enter reachability and close focus, current notes,
missing history and overflow, using intercepted local source and invented data.
Its legacy-note screenshot reveals the hidden legacy parent for that test only;
history and Deep Dive checks use their real reachable surfaces.

Exact-head focused results, zero-publication-figure/archive comparison, privacy
hook and synthetic screenshots belong in the draft PR evidence. Independent
review and green required hosted checks remain release gates. This document
does not declare an unrun full suite or Systems PASS.

No provider request/write, canonical financial edit, household policy, new
calculation, estimate, savings assignment or money-movement permission is added.
