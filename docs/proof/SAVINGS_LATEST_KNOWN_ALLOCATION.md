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
