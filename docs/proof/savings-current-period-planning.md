# Current-period Savings planning

Owner instruction: `ownerSentinel_f70d821f734481919f25b706ea7ab1a6`,
2026-10-16 12:57 UTC. Current salary can remain expected before posting.
The Budget period keeps its own income/bills/Household surplus or deficit;
Savings carries a hypothetical closing ledger across periods. Actual observed
Savings and matched receipts/transfers replace projected credits once.

## Boundary

`currentSavingsPlanningBasis` is private to Forecast. `savingsDailyFunding`
reaches it only after its incumbent reserve, original payday opening, complete
cash/movement, current Budget and supported-income gates. It reuses native
period income and exact matched receipt/transfer identities. The captured
planning context belongs to one `recommend` execution; nothing is cached or
stored. Actual bank funding continues through its existing received-income,
cash-floor and available-now guards, with unchanged output fields.

`recommend` passes that context to `savingsClosingProjection`. The projection
uses the current period's native planned surplus, less receipts already in
Savings and matched transferred amounts, with the existing goal-bill overlap
restored before the goal cost is debited once. It does not cap this scenario
at today's transfer capacity or reserve it for later operating needs.

An expected current receipt omitted from the native forward cash walk arrives
by the current close in this hypothetical scenario. The same amount enters
the scenario's operating side, so an estimated Savings addition is conserved,
not invented money. The private current Bills boundary adjustment is net of
that forecast income; the actual source cash rows remain untouched. Future
periods still consume their single published `paydaySweep` unchanged.

Negative current period net remains signed in Budget, operating cash and the
closing diagnostics. A positive projected credit is never turned into an
actual transfer, and an operating deficit does not silently withdraw Savings.
A goal that makes the Savings pot negative still withholds that close and
publishes its signed shortage; earlier qualified closes survive later gaps.

The existing public closing shape, selection validator, renderers, history,
source balance schema and transfer-now publisher are unchanged. The closing
diagnostics additionally name `currentPeriodSurplusDeficit`. The actual live
withholding reported during diagnosis—missing same-day reserve backing—still
withholds. This change does not invent current opening evidence.

## Independent invented ledgers

The new 36-case suite supplies no household/provider data and performs no
networking. It compares literal hand-derived cents, preserves complete input
bytes, checks the public sealed selection, and retains actual/estimated and
movement-permission boundaries.

- Observed Savings119, Bills80, expected current salary200: projected Savings
  closes319 whether the scheduled day is before, today or elapsed. No posted
  receipt is fabricated; transfer-now capacity remains60 where available.
- A matched receipt into Bills leaves200 to project; a receipt directly into
  Savings or a matched Bills-to-Savings transfer yields observed319 plus0.
  Re-anchoring the next period at observed319 plus a new expected300 gives619,
  never819. Incomplete/ambiguous claimed inclusion withholds.
- Salary200 and Household plan100: spend0 or50 leaves projected surplus100;
  spend125 leaves75. Opening Savings119 therefore closes219,219,194.
- A dated50 goal gives119+200-50=269, once. An unaffordable500 goal preserves
  signed Savings -181 and withholds allocations. A current period net -100
  stays negative, with its operating shortage visible and no automatic draw.
- The independent future-only S1 control remains119+1080=1199, then+1000=2199.
  Missing/stale/pending reserve, missing payday opening and missing movement
  evidence retain their holds.

With the exact unmodified main engine at
`a898d374b7f893f37fa37e01eabe84f33cbda021`, the original25-case suite is15 pass/10 fail.
The initial candidate is25/25. The initial18-case test-first commit independently
recorded12 pass/6 fail before production edits.

Required Systems Review found two legitimate live-overlay states absent from
that original proof: same-day `same-day-inbound-unproven`, and elapsed salary
after the live opening advances (`elapsed-inbound-unproven`). Budget still
includes the supported expected salary, while cash correctly omits it. The
private planning basis now carries those two states as unreceived forecast
income instead of skipping them. Unsupported authority/reasons still withhold;
claimed receipt identities still must reconcile before any forecast replacement.
The bank-transfer publisher, opening guards and live cash omission are unchanged.

The committed test-first expansion `e2198f5d6304e61e88121af8e54163e0e5c095d2`
records34 pass/2 fail on engine `c038da185e31d1a9dbf1a248c53e38e66dd92b33`.
The repaired suite is36/36, including the reviewer's four before/on/after
controls, three matched receipt/destination/transfer cases, two missing receipt
claims and two unsupported-income controls. Both newly repaired cases keep
119+200=319 Savings and80 operating cash; no posted receipt is fabricated.

One neighboring future-closing test is explicitly superseded by this owner
instruction: a later4000 goal used to suppress an earlier current200 projected
credit. It now preserves the bank's transfer hold, independently checks the
earlier119+200=319 close, and still withholds the later signed -1601 shortage
(119+200+1080+1000-4000). Other future sweep and inclusion controls remain.

Commands: `node test/test-savings-current-period-projection.js`;
the unmodified-engine control sets `ATLAS_TEST_APP_ROOT` to a clean exact-main
checkout. Run the neighboring Savings, Forecast and authority-coverage suites
and the full `npm test` manifest. Focused passes are not full CI success.
