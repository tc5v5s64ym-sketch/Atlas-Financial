# Latest reported Savings goal allocation

Source: Dale's explicit 2026-10-12 policy: "it should always just use the balance
that knows" and "Whatever is in lunch money, consider it the latest and
greatest." The decision desk approved this bounded first PR. Failed-refresh
retention is a separate follow-on.

Acceptance: valid reported balances allocate Saved through the existing
chronological allocator despite older or mixed balance dates. Actual balance
and check dates remain visible. Dated reports do not earn payment backing or
top-ups. Successful invalid evidence never falls back to an older balance.

## Boundary

`Forecast.savingsObservedStock` qualifies reported balances and retains the
observation's actual check date. Its same-run, non-serialized integer cents
reach the allocator directly; no dollars round trip or new cache is involved.
`savingsCombinedBacking` computes one goal
allocation from that stock, separately from its existing same-day funding
status and payments. `savingsDailyFunding` retains the allocation even when its
funding period is unavailable. `recommend` still seeds only `backing.funding`
before the native cash walk. No calculator, allocation cache, store or provider
write is added.

The existing Plan Saved print/stamp sites and bar painter consume the result
unchanged. The compact Plan evidence reprints neutral check-date wording.
Inventory labels dated allocations honestly and reprints Forecast's
short evidence description. Historical and projected periods still withhold
current Saved figures. Manual assignment history and actual-transfer evidence
remain separate.

## Independent synthetic proof

On baseline `c1d8c155552d87bc93aa0425147f1a00570146a9`, changing only balance
dates from same-day to older/mixed dates preserves reported $119 but changes
group Saved $95 and home Saved $24 to unknown. The new acceptance restores
those calculated allocations without restoring payment or top-up permission.

Independent cents: $119 = $60 first club cost + $24 annual home cost + $35
second club cost. The grouped club result is $95 against a $230 requirement;
the annual home result is $24 against $24. New $129 stock gives $60/$24/$45;
a withdrawal to $39.02 gives $39.02/$0/$0; zero stock is known zero, and $254
covers all three costs. Replays do not accumulate. A zero requirement and
settled-member filtering remain native.

The focused suite covers missing/duplicate/wrong account identities, wrong
currency/source, absent/impossible/future/contradictory dates, invalid cents,
negative balances, pending movements, unresolved requirements, unavailable
operating cash and card coverage. Vancouver midnight preserves the original
check/balance dates and the Saved allocations of the already-supplied packet;
this does not claim server continuity across a failed GET or restart.

Commands:

```text
node test/test-savings-latest-known-allocation.js
node test/test-chronological-savings-publication.js
node test/test-chronological-savings-conservation.js
node test/test-chronological-savings-review-boundaries.js
node test/test-provider-v2-savings-stock.js
node test/test-savings-observed-stock.js
node test/test-savings-daily-allocation-contract.js
node test/test-savings-daily-consumer.js
node test/test-savings-group-members.js
node test/test-annual-savings-payperiod.js
node test/test-travel-visa-annual-fee.js
node test/test-forecast.js
node test/test-authority-coverage.js
node test/proof-savings-latest-known-allocation.js BASE_SHA
node test/browser-savings-latest-known-allocation.js
npm test
```

The explicit-base comparison runs both revisions' own Forecast sources on 26
invented incumbent/provider cases. It compares complete recommendation outputs,
allowing only Saved fields and named provenance additions; cash, card coverage,
pending protection, cap, payday, debt, reserve-payment, top-up and schedule
outputs must match. It has no historical-object dependency in the normal suite.

On initial code head `0f895387718ac53e61730de3c030ce5fb5fa9f38`, all 13 focused
numerical/provider/render suites pass. The 26-case comparison reports 15,086
equal subtrees and zero unexpected output changes. Its source-bound synthetic
receipt is [comparison.json](savings-latest-known/comparison.json).

The real App.boot/browser proof passes nine cases on installed Edge
154.0.4258.62: older/mixed dates, prior Vancouver day, independent card gate,
withdrawal, zero, full funding, pending movement and invalid future date.
The unchanged stamp/bar painter produces amber/full, red/zero and neutral
unknown treatments. Keyboard focus restores, no horizontal overflow appears,
and no external request, write or page error occurs. All served bytes match
the committed sources in [browser.json](savings-latest-known/browser.json);
its nine captures are alongside that receipt. [Dated partial/full bars](savings-latest-known/stale-date-390-light.png)
and [known zero bars](savings-latest-known/zero-stale-390-light.png) are compact
examples. Source binding uses exact Git blob bytes, with no hash normalization.

Draft [#595](https://github.com/tc5v5s64ym-sketch/Atlas-Financial/pull/595)
records the continuing full-suite, exact-head hosted and independent review
gates. A following evidence-only commit preserves every exercised production
and test source blob; it does not claim a new runtime or Systems PASS. All
new proof inputs are synthetic; no household figures, private evidence or
local full-suite logs are uploaded.

## Bounded exact-cent repair

A new large-valid-input control exposed a collateral cents change in the
initial implementation: converting the validated combined cents to dollars
and back could alter the native unallocated figure. The repair retains the
validator's private integer on its same-run stock object and passes that
integer to the one allocator. It is not serialized, retained across reads,
cached as an allocation, or calculated by another path.

Independent control: 8,000,000,000,000,001 input cents minus 25,401 requirement
cents leaves 7,999,999,999,974,600 cents. The native remainder must stay
79,999,999,999,746 dollars. A second control combines 100,000,000 dollars
and 29 cents; its remainder after 254.01 is 99,999,746.28. The new acceptance
has 32 passing cases, and the expanded 28-case complete-output comparison
has zero unexpected changes. The earlier nine-case browser receipt remains
explicitly qualified to the initial code; it is not claimed as fresh evidence
for the repaired/integrated head.

The original full local `npm test` run reached a terminal result: 349 passed,
20 failed out of 369 suites (exit 1). It exercised the initial code; only
documentation/evidence changed while it ran. The failures are not a PASS and
their local logs are not published. Exact final-head hosted tests and Systems
Review remain gates; the full-suite result is recorded on the Draft.

## Prior-check-day copy repair and current-main composition

Systems [BLOCK 5493495671](https://github.com/tc5v5s64ym-sketch/Atlas-Financial/pull/595#pullrequestreview-5493495671)
on `e425af75` identified one remaining false freshness sentence in the compact
Plan evidence: a valid yesterday-checked packet could say "today's observation
date." The repair changes only that sentence to "Balance dates are separate
from the observation check date." The correct published check date remains
in Info. No financial predicate, amount, status or style changes in this repair.

The new rendered prior-check-day assertion fails before that one-line repair
and passes after it: the Forecast day is October 7, the check day remains
October 6, and the provider balance day remains October 5. The fresh browser
case opens Info and its Earlier planning calculation & obligation evidence
to verify both statements through the live consumer. Existing finished browser
cases are not rerun or claimed as fresh-head evidence.

Current main `007d904937d69862e080d9c4e3725ce41ed40c4a` (#593) is integrated
once without conflicts. Its card validator/export and two test-registration
lines are disjoint from the Savings edits; the foundation/store files retain
main's bytes. The net PR remains the Savings outcome. The current-base
28-case output comparison and new foundation checks are bounded composition
proofs. [Integrated comparison](savings-latest-known/integrated-comparison.json)
records zero unexpected changes and 16,210 equal subtrees against that current
main. Its [binding](savings-latest-known/integrated-comparison-binding.json)
preserves the execution-head qualification and checks recorded source bytes
against code head `e63a50eb3ac89a69a6eed7c6d6ff1072e803b560`. Forecast's
recorded bytes use the explicit Windows CRLF checkout representation; the
other three recorded files match exact Git bytes. This is stated rather than
claimed as an all-files raw-Git-byte run. The browser proof below uses exact
Git bytes with no normalization. No finished comparison is rerun merely to
replace a metadata SHA.

The new prior-check-day browser case passes on that exact clean code head;
[receipt](savings-latest-known/browser-prior-check.json) and
[capture](savings-latest-known/prior-check-day-390-light.png) are recorded.
It opens the real Info and Earlier planning evidence and proves the original
October 6 check/October 5 balance dates against the October 7 Forecast day,
the neutral sentence, unchanged Saved stamps/bars, withheld top-up, restored
focus, no overflow, no page error, no external request and no write.

The integrated #593 controller passes 144 synthetic checks; the store passes
12 Windows type/privacy/inertness checks and does not claim POSIX durability.
Three originally failing authenticated Savings integration suites pass after
linking the existing local dependencies into the isolated checkout. No package
is installed and no credentials or security setting changes. The original
full-suite terminal result remains 349/369, with 20 failures; no finished full
suite is repeated or promoted to PASS. Hosted final-head checks and root
Systems re-review remain pending.

At root's request for fresh repaired-source bindings, a separate
[final comparison receipt](savings-latest-known/final-comparison.json) is
recorded on clean head `b8b573588ddb8fca2e1518fbab4ab198baa7f057` against main
`007d904937d69862e080d9c4e3725ce41ed40c4a`: 28 synthetic cases, 16,210 equal
subtrees, zero unexpected changes. All four exercised source hashes equal
that head's exact Git blob bytes, with no line-ending normalization. This
supersedes the earlier comparison's source-encoding qualification; no completed
test suite or old browser matrix is repeated. A following evidence-only commit
preserves these exercised source blobs.

## Posted-transfer cutoff coherence repair

Root's new Systems BLOCK on exact `27f6ce0c483bc0b615df82990914e2bb8506f11b`
supersedes PASS 5493933061. [Advisory 4250998004](https://github.com/tc5v5s64ym-sketch/Atlas-Financial/pull/595#discussion_r4250998004)
identified a conservation defect: independently invented A=100/B=0, posted
A-to-B transfer 100 on October 7, A reported 100 dated October 6, B reported
100 dated October 8, checked October 8. The pre-repair Saved rows allocate
176/24 from reported 200 although the independent ledger conserves 100.
The failing-before assertion reproduced this defect on that exact source.

The bounded Forecast guard retains both reports and their actual dates. It
uses the incumbent proven internal-movement identity and separately qualifies
unique IDs, exact cents, debit/credit signs, CAD, explicit posted status,
account role and noncontradictory aliases, real dates, explicit complete
transaction coverage and observation bounds. For each proven move between
configured Savings accounts, both reports must be strictly before their own
posted leg dates or strictly after. Opposite inclusion and same-day equality
withhold Saved: date-only reports cannot establish intraday ordering.
Recognized but unmatched, ambiguous or unqualified reserve-transfer evidence
also fails closed. No transfer amount is subtracted or added to a report.
Proven operating/reserve movements remain under their incumbent gates.

The same chronological allocator runs once when this coherence condition and
the other existing allocation conditions pass. The guard adds no cash,
coverage, pending or top-up permission. Same-day native backing also fails
closed on unqualified transfer evidence; the guard cannot grant readiness.
No provider/server/store change, new cache, durable retention or calculator
is introduced. Needed remains 230/24 while Saved and its grouped members are
unknown across all publication lenses, Plan stamps/detail and shared Inventory.

The acceptance suite now passes 73 cases. New controls include asynchronous
and inverse cutoffs, reverse direction, same-day ambiguity, coherent before/
after and separately posted leg dates, exact 100.01 cents, later coherent
replacement and next-day stability, unrelated mixed 95/24 and genuine zero,
unknown stock/pending/coverage and malformed currency, amounts, dates, roles,
aliases, IDs, duplicate reference/ID and unmatched evidence. The nine focused
chronological/provider/consumer/group/internal-movement/Forecast/authority
regression suites pass. The original full-suite failure remains qualified
above; no current full-suite PASS or new Systems PASS is claimed.

Earlier receipts above are historical relative to this production repair.
Fresh [cutoff browser](savings-latest-known/browser-cutoff-coherence.json) and
[full-output comparison](savings-latest-known/coherence-comparison.json)
receipts bind clean code head `2a4ef02779ac92a756ca186eba08c61706e3ad5e`,
with exact Git blob bytes and no normalization. The comparison passes the
prior 28 controls and new 38 cutoff ledgers: 66 cases, 5,451 equal subtrees,
zero unexpected changes. Only Saved fields and named allocation reason/status
changes differ. All cash, native funding/payment, cap, payday, card, debt,
pending, schedule and top-up outputs agree with pre-repair head `27f6ce0c`.
The original reports remain untouched, including reported 200 in the rejected
counterexample. The numerical receipt binds 12 source/fixture/proof files.

The real App.boot/browser proof passes seven new cutoff cases on installed
Edge 154.0.4258.62: asynchronous and inverse, both-before and both-after,
unrelated mixed, zero and duplicate. All 65 bound sources match committed
bytes; all 30 served-source hashes agree. Saved stamps/bars, Info reason,
known Needed, keyboard focus restoration and no overflow are verified.
There are no page errors, external requests or writes. The
[uncertain capture](savings-latest-known/cutoff-double-count-390-light.png)
and [coherent refreshed capture](savings-latest-known/cutoff-both-after-390-light.png)
were visually inspected. These are synthetic desktop-browser proofs at 390px,
not an actual iPhone or bank-reconciliation claim. A following evidence-only
commit preserves every exercised production/test blob.
Draft #595 remains open pending required checks and a new exact-head Systems
review. Release sequencing with #596 remains the coordinator's responsibility.

## Incumbent transfer-form admission repair

Root [Systems BLOCK 5494925090](https://github.com/tc5v5s64ym-sketch/Atlas-Financial/pull/595#pullrequestreview-5494925090)
on exact `45fa53946d99cf5cbd78c740535c4b562890a1c9` verified the referenced
counterexample repair but found a narrower bypass. The provider can publish
`kindHint: 'transfer'` without a parsable reference. The guard admitted only
`isInternalTransferIdentity`, although incumbent `isInternalHouseholdTransfer`
also recognizes `transfer` and `internal-transfer` hints. Invented hint-only
reserve legs therefore left reported 200 allocated as Saved 176/24 without
any proven pair. The new assertion fails before the one-line repair.

Admission now reuses `isInternalHouseholdTransfer`. Exact pairing remains
solely incumbent `provenInternalMovementForTx`; a hint, malformed/missing
reference or direction, or identity flag cannot prove a pair by equal amounts.
The existing unmatched/unqualified branch withholds Saved. No balance,
allocation arithmetic, date, cash gate, provider or renderer code changes.

Seven new forms exercise hint-only, internal-transfer hint, one hinted leg,
invalid reference, missing reference, missing direction and identity-only flag.
All retain original reported 200, have zero proven pairs, and withhold Saved
across rows, lenses, Plan stamps/detail, grouped members and shared Inventory;
Needed remains 230/24. The acceptance suite now has 80 cases. Five focused
internal-movement/consumer/review-boundary/provider/authority suites cover this
one-line admission change; all pass. Earlier receipts remain bound to their
original sources. The fresh [comparison](savings-latest-known/transfer-forms-comparison.json)
passes 73 cases against exact pre-repair `45fa5394`: 1,165 equal subtrees,
zero unexpected changes outside Saved and named allocation status/reasons.
The [three-case browser receipt](savings-latest-known/browser-transfer-forms.json)
passes hint-only, invalid reference and missing reference through real App.boot,
Saved stamps/bars and Info. Needed remains known, top-up withheld and focus
restored, with no overflow, page error, external request or write. The
[hint-only capture](savings-latest-known/cutoff-hint-only-390-light.png) was
visually inspected. No finished browser matrix is rerun or relabelled.

Both receipts bind clean code `da6a3efa93851a5f5f4dcb384637832797fb8cc7`,
using exact Git blob bytes with no normalization (12 numerical source/fixture/
proof files, 65 browser-bound sources and 30 served hashes). The following
evidence-only commit preserves all exercised production/test blobs.
Current-head hosted checks and exact-head Systems re-review
remain required, with no merge or deployment by this builder.

## Unified Savings-account movement boundary

Root [BLOCK 5495280645](https://github.com/tc5v5s64ym-sketch/Atlas-Financial/pull/595#pullrequestreview-5495280645)
supersedes PASS 5495028834 on exact `edc322d4`. Fresh advisory
[P1 4251556087](https://github.com/tc5v5s64ym-sketch/Atlas-Financial/pull/595#discussion_r4251556087)
identified the operating-cash endpoint skip. A reported A100 dated October 6,
B0 dated October 8 and exact posted Savings-to-chequing100 on October 7
left Saved76/24 ready despite independently remaining Savings10000-10000=0
cents. Direct posted fees/debits/credits were also outside the old admission.
The new withdrawal, fee and same-day deposit assertions all fail before this
repair; the approved dispatch now covers one coherent account boundary.

Only Forecast's private coherence predicate changes in production. It admits
every nonzero row touching configured Savings through raw or incumbent account
identity, then requires unique IDs, strict CAD cents, explicit posted status,
canonical role/identity with noncontradictory aliases, real dates and complete
coverage/observation bounds. Missing identity on an explicit reserve row fails
closed. Recognized transfer forms still require the incumbent exact pair;
both legs are qualified, including a cash counterparty. Hints/equal amounts
never manufacture a pair. No balance is reconstructed, subtracted or rewritten.

- Two Savings endpoints: each cutoff compares to its own posted leg. Both
  strictly before or both strictly after is coherent; opposite inclusion or
  same-day equality is unresolved.
- One Savings endpoint: its report must be strictly after its posted leg,
  for deposits and withdrawals alike. Before/same-day is unresolved.
- Direct Savings fee/debit/credit: the same strict-after rule applies.
- No Savings endpoint or genuine zero principal: irrelevant to this boundary.

Older/mixed reports remain usable without contradictory movement evidence.
All original balances, cents, bank dates and check dates remain untouched.
Saved rows/lenses/stamps/details/grouped members/Inventory withhold together;
independently known Needed remains230/24. The gate uses the existing fail-closed
backing/funding paths and never grants cash, top-up or movement permission.
Ambiguous current reports can newly withhold native backing; this conservative
effect is explicitly tested against the incumbent pending-unknown backing
control, with the original transaction packet. Cash/card/budget/cap/debt/payday
outputs must match that independently existing held-backing route except for
truthful reason strings. Ordinary coherent cases require complete-output
equality outside Saved/provenance; no broad numerical exemption is used.

The positive deposit oracle now uses valid DD404 grammar and October6 posting
before October7 reports; its independent12900-cent allocation remains60/24/45.
A separate valid same-day pair withholds Saved instead of weakening production.
Other positive synthetic deposits/credits use posted-before-report dates,
retaining their independent amounts, contribution and conservation oracles.
The chronological publication suite passes17/17. The latest acceptance suite
passes130 cases, including50 account-boundary ledgers and malformed direct/
counterparty evidence. Earlier completed receipts remain historical; new
comparison/browser evidence will bind this repaired clean source head.

Both prior exact-edc hosted runs reached terminal failure: standard369/370,
refresh-isolation1/1, aggregatefailure. The unsupported DEPOSIT10 fixture was
the only failed suite; it is now repaired with grammar and coherent dates.
Historical local349/369 with20 failures remains a separate FAILED run.
No old CI or reviewer execution is promoted to PASS. Required new-head tests,
current-main composition and exact-head Systems acknowledgement remain gates.

The broader commit was rejected twice by automatic approval review because it
did not accept the delegated instruction as trusted authorization. The repair
was held local and uncommitted pending direct confirmation. Local pre-approval
proof validated exact working bytes against staged index blobs, explicitly
marks `uncommittedStagedSnapshot: true` and `releaseHeadQualified: false`, and
does not satisfy the repository's clean committed-source release gate. The
temporary proof harness changes source-binding verification only; financial
and browser tests were unchanged. No commit workaround was used. Dale directly
approved the requested commit/push at2026-10-12T20:43:33Z. The single authorized
retry succeeded as code51fd718cdb50ea24bea9ea2c28f5de9eb967bb23, with the normal
privacy hook enabled. All prior failures and review qualifications remain intact.

Fresh normal [comparison](savings-latest-known/account-boundary-comparison.json)
and [browser receipt](savings-latest-known/browser-account-boundary.json) now
bind that clean committed code head with exact Git bytes and no normalization,
using the repository's original source-binding harness. The temporary staged
harness is not used or claimed as release proof. Comparison passes123 ledgers,
170,416 equal subtrees and zero unexpected changes, including31 explicit
held-backing controls. Nine regression suites and130 acceptance cases pass.
The corrected chronological publication suite passes17/17 with the independent
12900-cent positive oracle and same-day negative control.

Eight fresh Edge154.0.4258.62 cases pass: withdrawal/deposit before report,
same-current-day deposit, direct fee/credit before report, coherent withdrawal
to zero, deposit to100 and fee to98.75. All65 browser-bound source blobs and30
served hashes agree; numerical receipt binds12 source/fixture/proof files.
Needed and Saved stamps/bands/Info, focus restoration and no overflow are
verified; no page error, external request or write occurs. The
[withdrawal capture](savings-latest-known/cutoff-boundary-withdraw-before-390-light.png)
and [coherent fee capture](savings-latest-known/cutoff-boundary-fee-after-390-light.png)
show the independent unavailable and74.75/24 outcomes. These are synthetic
desktop-browser proofs at390px, not an actual iPhone/bank-reconciliation claim.
The following evidence-only commit preserves all exercised production/test
blobs. New-head CI and exact-head Systems review remain pending.

Main advanced to9c414fcd2858f801744d6d4c35a0a1d748069865 through#597 and#589.
Server refresh changes and the shared card-face runtime/styles are newer than
this branch's007d9049 base. Integration need is reported before edits; no main
or release merge occurs in this repair publication. Current-main composition
and its exact-head verification remain coordinator gates.
