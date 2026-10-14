# Future Savings at period close

All amounts, fixtures and screenshots are invented. No provider payloads,
household figures, credentials or source documents enter this proof.

Forecast publishes qualified opening Savings plus eligible period surplus less
full due goal costs once. Both Savings renderers copy the selected future closing
pot and chronological remaining requirements. Current reported allocation, native
operating results and the generic minimum scheduler retain their contracts. Actual
future balances/payments/contributions remain unknown. Estimated provenance stays
internal; ordinary projections add no Forecast/Actual badges or assumption copy.
Genuine missing-data and funding-gap reasons remain visible. Navigation never
changes inputs or actual settlement.

## Independent numerical reconciliation

Opening Savings 300, operating either 80 or 1,000, incomes 400/400 and dated goal
costs 500/400 give 300 + 400 - 500 = 200, then 200 + 400 - 400 = 200. Operating
opening cannot change either Savings headline. Paid requirements leave only the
projected roster, first one then the other.

With incomes 100/100 instead, signed Savings carries -100 then -400 for both
operating openings. Stock is null and allocations are withheld; operating support
cannot make the shortage ready. Root's [BLOCK on exact 6f0f486c](https://github.com/tc5v5s64ym-sketch/Atlas-Financial/pull/610#pullrequestreview-5512258894)
identified the prior capped-draw error: 260/260 or 400/400, and ready 100/100 for
the shortage. Four identical owner-ledger cases fail on that frozen head and pass
with the bounded publication repair. Its household total conserved but its Savings
partition did not satisfy the owner model.

Positive closing arithmetic does not prove daily feasibility. First income on
October 24 with the 500 cost on October 16 still gives signed closing Savings 200,
but native cash first reaches -120 against floor 20. Publication stays unavailable
with a 140 gap. Existing current-tail unavailable gates are unchanged.

Opening 119 plus two eligible 1,000 surpluses closes at 2,119, allocated 1,500/619.
An intervening 80 goal expense leaves 2,039. Installments 80 due October 29 and
60 due November 12 retire at inclusive closes; the group disappears and closing
Savings is 1,979. Before/on/after-close and deterministic replay controls pass.

Opening 800, three incomes 200 and costs 500/600/400 closes at 500, 100 and signed
-100. The failing close withholds allocations; earlier closes remain visible.
A true zero starts with Savings 900: 900 + 600 - 1,500 = 0 while operating 100
remains 100. Operating carry is never added to Savings or used to clamp a deficit.

Routine deficits can limit eligible transfers at the protected floor. Native
Budget bill/Household deductions remain authoritative. An already deducted goal
bill adds back only its exact unique planned deduction before the full cost debit
once. Current-tail Bills/Savings receipt controls prove no duplicate income.
Unknown stock, pending movement, missing amounts/dates/receipts, ambiguous expenses
and unsupported periods stay unavailable. Malformed typed packets are rejected.

## Reproduction and source binding

`node --test test/test-savings-future-closing.js test/test-reported-savings-earmarks.js`

40 financial cases and 88 released current-report cases pass. For red reproduction
set `ATLAS_TEST_APP_ROOT` to exact `6f0f486c1fdf6197cf7a42b21cb9533e459dfd7c`
and use `--test-name-pattern='owner closing|full signed Savings'` with the current
closing suite. Same inputs/oracles; only the producing revision changes.

`node test/proof-savings-future-closing-before-after.js <exact-main-checkout>`

Ten complete recommendations equal released main
`a722031e0e7bc936426695066f2723420f8d64ff` after removing exactly the two new
publication fields named in the script. Released #607 App/resume bytes are retained.

`NODE_PATH=<Playwright runtime> CHROME_PATH=<Edge/Chromium> node test/browser-savings-future-closing.js`

The real App uses the visible river timeline, both Savings renderers, disclosures,
back/forward and rerender at 1,440/390/320 pixels. Eleven modes produce 33 cases.
Intercepted invented GETs serve one synthetic origin; external requests, writes,
page errors, input mutation and horizontal overflow fail. Cases record internal
trust separately from visible copy. The [receipt](proof.json) binds exact served
Git bytes, tests and screenshot hashes to the repaired code head; the artifact
commit preserves those blobs.

Screenshots: [operating 80](owner80-320.png), [operating 1,000](owner1000-320.png),
[signed shortage](owner-deficit-320.png), [payment before income](timing-320.png),
[true final zero](zero-closing-320.png), [group](group-320.png),
[installments](installments-320.png), [last affordable close](gap-320.png),
[expense](expense-390.png), [unknown](unknown-320.png), [ordinary close](ready-320.png).

Historical receipts: [initial](https://github.com/tc5v5s64ym-sketch/Atlas-Financial/blob/25470fd1f14d82709be07323f3ebf6eefa631656/docs/proof/future-savings-closing-2026-10-14/proof.json),
[inclusive close](https://github.com/tc5v5s64ym-sketch/Atlas-Financial/blob/34c891f043b1434158b098230ae4a6c9bad71d97/docs/proof/future-savings-closing-2026-10-14/proof.json),
[blocked integration](https://github.com/tc5v5s64ym-sketch/Atlas-Financial/blob/6f0f486c1fdf6197cf7a42b21cb9533e459dfd7c/docs/proof/future-savings-closing-2026-10-14/proof.json).
These do not establish acceptance for the repaired head.

Fresh exact-head Systems Review, full CI, owner figures reconciliation and signed-in
physical Safari acceptance remain release gates. No merge/deploy from this lane.
Production qualification is distinct from invented proof; absent current bank
evidence is not inferred away.
