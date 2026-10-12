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
observation's actual check date. `savingsCombinedBacking` computes one goal
allocation from that stock, separately from its existing same-day funding
status and payments. `savingsDailyFunding` retains the allocation even when its
funding period is unavailable. `recommend` still seeds only `backing.funding`
before the native cash walk. No calculator, allocation cache, store or provider
write is added.

The existing Plan Saved print/stamp sites and bar painter consume the result
unchanged. Inventory labels dated allocations honestly and reprints Forecast's
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

On code head `0f895387718ac53e61730de3c030ce5fb5fa9f38`, all 13 focused
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
