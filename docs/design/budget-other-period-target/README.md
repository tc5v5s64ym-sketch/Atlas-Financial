# Other spending: $450 each pay period

Owner instructions relayed October 4, 2026 explicitly set Other spending to
$450 every pay period, starting with September 25-October 8. The corresponding
source IDs and effective date are recorded in `docs/ACCOUNT_FACTS.md`.

Forecast publishes the dated target in the existing Other reconciliation row.
Current and future hold is `max(target, eligible actual)`, counted once. Unused
target remains reserved; above-target actual is never charged again alongside
another $450. The interface prints actual / planned and Forecast's remaining,
overspend and trust states. It adds no financial calculator or classification.
Native Info retains the target and transaction evidence. Completed-period Info
labels it `Configured target` and keeps the historical original plan unavailable.
Unknown actuals stay
unavailable, never zero or $450 left.

The former $800/month and $400 future-only fields are retired, with their source
metadata retained in bounded configuration history. They are not co-active.
The selected periods before September 25 keep their actual-only Other behavior.
Completed periods consume observed actual, rather than a present-day unused
reserve. Current configured targets are not asserted to be original historical
plan snapshots.

## Independent proof

Independent Systems review blocked head `2bf14a2` (also applicable to label-only
`e13275b`) because cash allocation reserved another $450 after Other was spent,
and undated non-calendar target readers changed figures before Sep 25. The
replacement shares the existing residual-evidence predicate between calendar
reconciliation and category cash consumption. It keeps unresolved classification
and pending cash protection, while consuming the evidence once under the dated
Other policy identity. All target readers select bounded retired configuration
before reading monthly/payday cadence; cash paths pass their dated asOf. Named
spans crossing Sep 25 apply each policy only on its side of the boundary.

The fixture now declares essential classifications, so it exercises the actual
cash allocator. Cash-required Other is 450 / 312.74 / 0 / 0 for observed
0 / 137.26 / 450 / 618.73. Today's money is named remaining 364.63 plus unused
Other, checked in actual App.boot at all three widths. Sep 24 cash/current-action
planned is 367.97 (`800 * 14 / (365.25 / 12)`), then 450 on Sep 25. Invented
August month publications are compared in full with the retired-policy walk.

Old-head required CI also exposed unbounded legacy-policy assertions in six
suites. Historical authority suites retain their original $800/$400 assertions
using explicitly bounded configuration, while active-policy contracts require
the approved $450 shape/source/effective date. The post-boundary timeline's
independent deduction uses 450 once; prior $400 timeline proof remains intact.
The authority invariant now requires the new Oct 4 source date. Earlier derived
essentials amounts return to their original values; only the two reporting
rows' later policy-input metadata differs from main.

All observation amounts, transaction identities and account IDs in fixtures
and screenshots are invented independently. $450 is the expressly approved
policy value. All browser requests are intercepted. Future row, reserve and
deduction publications retain estimated trust, including native Other Info.

| Observation | Independent cents contract |
|---|---|
| Other below target | Actual 13726; plan 45000; hold 45000; unused 31274 |
| Other at target | Actual 45000; plan 45000; hold 45000; unused 0 |
| Other above target | Actual 61873; plan 45000; hold 61873; overspend 16873 |
| Confirmed zero | Actual 0; plan 45000; hold 45000; unused 45000 |
| Six invented category plans | 22000 + 8500 + 6000 + 3500 + 4500 + 3000 = 47500 |
| Original household plan | 47500 + 45000 = 92500 |
| From Today, below target | 36463 remaining named-category plan + 31274 unused Other = 67737 |
| Covered prior period | Actual-only Other 8314, no $450 plan or reserve |
| Uncovered older history | No fabricated Other row or historical actual |

The unit checks the exact September 24/25 boundary, completed periods on both
sides, future once-only hold, missing observations, unchanged reconciliation
membership and canonical dog-food ON/OFF periods (2275 then 2175 total plans).
It proves every canonical input outside Other is unchanged. Generated positions
change only the two computed essentials reporting rows; balances, obligations,
savings assignments and other household evidence remain unchanged.

The history regression initially selected the oldest `past` timeline row in
July, outside the fixture's covered window. It now selects the covered September
11-24 period explicitly and asserts that uncovered older history stays unknown.
No production history or plan was invented to make that test pass.

Legacy $800/$400 regression assertions remain intact against explicitly retired
configuration. The purpose-savings canonical-isolation test now compares its
original immutable change heads rather than forbidding all future owner changes;
the new Other contract independently checks the full current canonical delta.

| Main beside authorized policy, same invented observations | Comparison |
|---|---|
| Desktop below target | [1440px](comparison-other-137.26-1440.png) |
| Narrow mobile below target | [320px](comparison-other-137.26-320.png) |
| Narrow mobile above target | [Over target](comparison-other-618.73-320.png) |
| Missing actual evidence | [Unknown remains unknown](comparison-other-null-320.png) |
| Native target and transaction Info | [Detail](comparison-other-137.26-info-320.png) |
| Completed-period configured target, original plan unknown | [Historical Info](history-info-320.png) |
| Next-period target, actual unavailable and estimated trust | [Future Info](next-info-320.png) |
| Other fully used; actual visible Today's money reserves only named 364.63 | [Current cash Info](used-other-cash-info-320.png) |

The active browser covers below/at/above at 1440/390/320px plus missing evidence
and completed/next-period Info at 320px (12 views), numeric-bar availability, target in Info, no horizontal
overflow, keyboard opening and exact return focus above the fixed mobile dock. Final-head tests, artifact
hashes, required CI and independent Systems review are recorded in the PR.

## Boundaries

This policy does not verify live Other membership or explain the live one-cent
payroll discrepancy. Required selected-period reconciliation/receipt evidence
is unavailable in this environment. Savings assignments remain unconfirmed.
The separate #496 receipt repair is integrated from merged main
`8ce4e67915e41dbfaee55ad0d2c09ed74b4b4e9c`; its receipt selectors and missing-actual
protections are retained. The comparisons use that fresh main as baseline.
This draft contains only the bounded Other policy change. No merge,
production credential access, sample toggle or claim of full v3 pixel completion.
