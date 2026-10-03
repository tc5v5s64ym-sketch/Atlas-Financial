# Confirmed savings inventory acceptance proof

All accounts, goals, balances, targets, assignments and screenshots in this
proof are **synthetic**. Real pool identities and starting amounts remain unset.
The owner convention and its evidence have one authority home in
[`ARCHITECTURE.md`](../../ARCHITECTURE.md#confirmed-savings-purpose---owner-decision-2026-10-02).

## One outcome and its live consumers

Budget and Plan Spend print the same Forecast inventory: confirmed purpose,
current cash and trust, per-goal backing, unallocated cash or pool deficit.
The production input remains unconfigured and prints setup unknown. No real
account mapping, balance, target or starting assignment is added by this PR.

`Forecast.savingsInventory` is the sole reconciler. The incumbent GET observer
provides sanitized, ephemeral account evidence, distinct from intent.
`public/savings-inventory.js` formats the same packet on both pages and computes
no financial result. Requirements come from existing commitments, yearly bills,
group members and `budget-reserve` `plan.budget.categories` rows (class
`reserve`). Group/member and cross-source aliases cannot pledge a goal
twice. Silver already in cash is not added again or assigned a purpose.

The configured inventory is a non-additive breakdown of that cash. ACR still
uses the designated reserve once and is not increased by goal funding or the
second pool. Incremental `planSpendPaydayFunding`, Budget period funding and
from-today proposals are withheld when configured, including invalid
configuration. The withholding ends only after independently proved allocator
seeding **and** reserve-backed payment cash flows are integrated. Displayed
funding alone is never subtracted to claim cash feasibility.

## Before / after against immutable main

Base: `210fb231bff9422fa9eca568b4e0acb68cece854`.
`test/test-savings-earmarks-before-after.js` compiles that exact prior engine
from Git and executes both engines on identical synthetic input.

| Condition | Before | After |
|---|---|---|
| Configured purpose | No inventory owner or published actual breakdown | Confirmed intent and observed pool partition published |
| Zero-baseline funding schedule | Still publishes an incremental instruction on configured intent | Incremental instruction explicitly withheld |
| No configuration | Incumbent Forecast result | Entire incumbent recommend result preserved, plus setup unknown |
| Explicit empty configuration | Incumbent Forecast result | Same incumbent result, plus setup unknown |

## Independent cents oracle

Fixture: [`test/fixtures/savings-earmarks.js`](../../test/fixtures/savings-earmarks.js).
The oracle uses independent literal expectations and BigInt equality over
the original inputs and published partition. It does not call the producing
helpers to obtain expected values.

Pool A has confirmed intent of 247.80 (169.37 + 78.43). Pool B has intent of
99.99 and cash of 144.08, leaving 44.09 unallocated.

| Synthetic Pool A case | Observed cash | Intent retained | Unallocated | Deficit | Individual backed claim |
|---|---:|---:|---:|---:|---|
| Starting / repeated refresh | 301.17 | 247.80 | 53.37 | 0 | Full confirmed amounts |
| Settled inflow +25.04 | 326.21 | 247.80 | 78.41 | 0 | Full confirmed amounts |
| Settled outflow -42.11 | 259.06 | 247.80 | 11.26 | 0 | Full confirmed amounts |
| Cash below intent | 200.00 | 247.80 | Unknown | 47.80 | Withheld for every goal in this pool |
| Negative observed balance | -4.21 | 247.80 | Unknown | 252.01 | Withheld for every goal in this pool |

For backed cash, cash = intent + residual. For a deficit, cash + deficit =
intent. No prorating or goal haircut occurs. Another independently covered pool
keeps its backing. The same goal split across pools is aggregated once.

Additional controls cover currency/type/alias conflicts, exact cents, stale or
missing dates, pending coverage and movements, confirmation newer than cash,
unknown starting assignments, explicit confirmed empty assignments, appended
revisions, paid/reduced/removed goals, group/member overlap, duplicate goals,
refunds, inter-pool location changes, and unchanged canonical intent. Paid or
reduced requirements do not release intent. Missing references retain the
amount while withholding backing. Unknown intent is not zero saved or fully
unallocated cash.

## Executable proof levels

```text
node test/test-savings-earmarks.js
node test/test-savings-earmarks-integration.js
node test/test-savings-earmarks-before-after.js
node test/test-forecast.js
node test/test-authority-coverage.js
npm test
node scripts/privacy-guard.js --staged
node scripts/figures-snapshot.js
```

The integration test reaches the actual authenticated server, GET observation,
reconciliation, in-memory overlay, Forecast, and both actual page mounts. Pool
failure does not invalidate independently valid chequing evidence. Inputs on
disk and confirmed purpose remain unchanged. The test never uses a real token
or calls a financial provider.

Optional real-browser command (Playwright installed outside the repository):

```text
NODE_PATH=<isolated Playwright directory> CHROME_PATH=<browser executable> node test/browser-savings-earmarks.js
```

It exercises both full pages at 1440, 390 and 320 pixels; backed, deficit,
stale, pending, unknown-intent, setup-unknown and hostile-label states;
keyboard disclosure, no overflow, no injected markup, no runtime errors,
identical visible inventory, and absent incremental Plan Spend instructions.
All network requests are confined to the synthetic loopback server.
Selected [mobile backed proof](savings-earmarks-mobile-backed.png) and
[mobile deficit proof](savings-earmarks-mobile-deficit.png) are synthetic.

Final exact head/tree, deterministic results, figures comparison and CI links
belong to the PR Merge Card. Independent Atlas Contract / Systems Review is
required before merge and cannot be supplied by this builder.

## Configuration and update path

The optional block has `version: 1`, `currency: CAD`, exactly two distinct
`pools` (`id`, `accountId`, optional `label`) and ordered `history`. A history
entry is a full confirmation snapshot with `revision`, `confirmedAt`, `source`
and supplied pool snapshots. Each supplied pool has `poolId` and `allocations`
of `{ goalRef: { kind, id }, amount }`; allowed reference kinds are commitment,
yearly-bill, group and budget-reserve. A budget-reserve reference reads one
existing `plan.budget.categories` row with class `reserve`, using its
`plannedAmount` and confidence. Competing bill/commitment ids or duplicate
category ids withhold backing. It adds no cash event, recurrence, payment
settlement or automatic release. A missing pool snapshot means unknown assignments; an
explicit empty allocation array means confirmed no assignments. Amounts are
nonnegative whole cents. Balance and target fields are rejected.

Confirmed inputs initially use the existing owner-authorized input-update / PR
workflow. Append a revision and retain prior snapshots. The incumbent provider
map identifies the actual accounts; a new reserve alias uses the narrowly
validated `household-reserve` role. The incumbent `savings` mapping remains
compatible. Reserve aliases cannot become operating cash or repurpose excluded
staging, held business cash or debt identities. No new persistent writer,
database, ledger, bank action, Lunch Money write, authentication, signing,
credential or network setting is introduced.

## Property-tax reference acceptance

`test/test-savings-property-tax.js` reproduces unsupported reference rejection
on immutable main `0c15c462bfbc2c6559eb4a580660ab682bec4699`. The new path reads
a synthetic estimated Budget reserve requirement of 487.63 and confirmed intent
of 103.27. In a pool with observed cash 144.08 and separate insurance intent
11.13, the independent cents partition is 14,408 = 10,327 + 1,113 + 2,968.
The requirement remains estimated, and unknown starting assignments publish
null intent and residual, not zero funded.

An isolated 1,000 chequing opening still emits exactly one unchanged reserve
event for -487.63, on its incumbent planning date; ending cash is 512.37.
Entire event and simulation packets match with and without the earmark reference.
Alias, missing/wrong-class/duplicate category, malformed target, reduction and
past-date controls preserve intent and prevent duplicate pledges or inferred
settlement. The authenticated integration reaches GET observation, overlay,
Forecast and both actual page mounts with the same synthetic property-tax goal,
and confirms unknown assignments stay unknown. No production configuration,
identity or starting balance is supplied by this reference support.

## Platform limits

Windows runs must report their actual failures. On untouched base, the figures
coverage suite cannot create its symlink (`EPERM`), shell wrapper / fake-gh
fixtures fail in the repair and head-sync suites, and the synthetic DPAPI
round-trip fails. These checks remain intact; Ubuntu CI and all required
exact-head checks must pass before merge. No security or access setting is
changed to make local checks green. Deployed/live financial behavior and the
real account setup are not claimed by synthetic proof.
