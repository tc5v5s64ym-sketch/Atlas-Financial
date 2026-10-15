# Qualified Bills sweep proof

Source: Dale's approved simplified #620 repair, 2026-10-15 23:40:51 UTC.
Supersedes the v2 exemption expectations and the proposed v3/v4 designs.
The outcome is one qualified Bills remainder, consumed once by future Budget
openings and Savings closes. These are synthetic projected transfers, never
actual settlement or permission to move money.

The repair changes only `recommend`, `calendarPeriodWaterfalls`, and the
unavailable-sweep crediting path of `savingsClosingProjection`. The #618 opening
authorities remain unchanged. Main `6b4a07ea8450045bfd138da00e9cfee3686e73c2`,
including Shaw #621, is integrated without changing its implementation.

## Independent arithmetic

All fixtures are invented. The expected figures below come from account
conservation, not from a second invocation of Forecast.

| Case | Current Bills | First future opening / sweep | Final Savings / operating cash |
|---|---:|---:|---:|
| Snapshot80 plus posted inflow30; Savings119; two future receipts1000 | 110 | 110 / 1110 | 2229 / 0 |
| Same, inflow37 | 117 | 117 / 1117 | 2236 / 0 |
| Bills80 transfers50 to Savings119; two receipts1000 | 30 | 30 / 1030 | 2199 / 0 |
| Same, with excluded other chequing20 | 30 | 30 / 1030 | 2199 / 20 |
| Same, with excluded other chequing777 | 30 | 30 / 1030 | 2199 / 777 |

For the transfer case, current household cash is Bills30 + Savings169. The
50 already left Bills and must not be deducted again. Subsequent receipts
add2000, giving Savings2199 after both sweeps. The other account stays outside
that transfer. For inflow30, 119 + 110 + 2000 = 2229. The former80/1080 pin
omitted30 of physical Bills cash and is replaced by110/1110.

The retained S1 suite separately proves a negative remainder carries intact,
zero is known, a new paycheck is excluded from its own payday's transfer,
current-period receipt credit consumes once, goals consume once, and navigation
and repeat evaluation do not mutate the input or change the result.

## Evidence and unavailable chain

The new suite is `test/test-savings-sweep-qualified-basis.js`, included in the
normal manifest. It exercises public `recommend` and `savingsFundingPublication`
results. The paired-transfer controls reject null, empty, boolean, numeric-string
and nonfinite amounts; missing transaction identity or location; conflicting
aliases; unknown cash locations; stale observations or Bills rows; missing or
incomplete fetch coverage; contradictory windows; incomplete intervals; pending
Bills movements; malformed Bills stock; coerced snapshots; and dropped Bills
provenance even when independent current funding is READY.

Every unavailable basis loses future Budget openings and sweeps and withholds
dependent Savings closes. No `net + overlap` fallback can credit that unknown
amount. The dropped-row case preserves the independently supported current
funding status and its transferred50 disclosure while withholding future money.
Invalid planned future income also withholds its sweep and later opening.

## Changed expectations

The following previous S1 preservation expectations are intentionally replaced:

- Incomplete coverage without transfers: current opening survives; future
  opening80/sweep1080 becomes unknown.
- Complete EOD reconstruction85 and gap-embedded reconstruction135: their
  existing opening publications survive; future sweeps1085/1135 become unknown.
- Scalar80 or scalar0: valid current scalar opening survives; no Bills-specific
  future amount is inferred from it.
- Current Bills30/90 with absent or null snapshot: current stock display
  survives; midperiod stock alone does not establish the payday boundary.
- Future-dated rows marked posted inside today's observation: the contradictory
  packet no longer qualifies today's chain.
- Inflow30: both paired/no-leg and reserve-only controls now use110/1110.
- The #618 suite's future-Savings assertion now expects unknown while retaining
  its current opening, current funding, immutability and reconstruction controls.

No historical-share attribution or EOD qualification subsystem was added to
preserve those older numbers. Existing noncombined Budget displays retain their
incumbent behavior; current funding READY is never used as sweep qualification.

## Verification commands

`node --test test/test-savings-sweep-qualified-basis.js`

`node --test test/test-savings-payday-sweep-s1.js test/test-payday-bank-eod-anchor.js`

`npm test`

The PR merge card records the exact candidate SHA, failing-before comparisons,
terminal CI results, and the pending independent Systems Review. Test counts
alone do not establish financial correctness; the conservation ledgers above
and evidence-withholding assertions are the acceptance proof.
