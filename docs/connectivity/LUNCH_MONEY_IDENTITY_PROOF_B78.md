# Lunch Money identity proof — B78 / AF-INGEST-01

Sanitized evidence that the incumbent Lunch Money observation/reconciliation
path is identity-stable and idempotent on **real household Lunch Money
data**. This is the T3 proof. It does not write canonical state, does not
choose a same-day winner, and does not invent a pending→posted transition.

Raw provider JSON, the access token, real Lunch Money account IDs, and
real provider transaction IDs stay out of git.

## What was already true on current main

Checked on `origin/main` `5c1efd27f2b80357eda7e16b985c4162fbf8c4d3`
before any edit:

- mapping is by existing `providerAccountId`, not display name
- unknown IDs stay unmapped
- `cardCapacityIsCash` is independently 0
- observe/reconcile never write `data.json`
- same `providerTransactionId` pending+posted collapses without double-count
  (fixture coverage; no real household transition in B21)

B21's later live GET (`2026-08-17T23:38:15.373Z`) remains the later
observation record. It is not reopened.

## Real evidence used

A new live GET was **not** available in this builder shell:
`LUNCHMONEY_ACCESS_TOKEN` was unset. The same human intervention B21
recorded is still required for a fresh pull.

The real-data proof therefore replays the leftover owner-run 2026-08-16
observe report (`fetchedAt` `2026-08-16T19:38:31.821Z`) through the
incumbent observer **twice**, using the gitignored local account map.
That leftover is reconstructed locally from the owner's earlier observe
output (accounts + transactions). The reconstruction stays out of git.

Command shape:

```text
node scripts/provider-observe.js --provider lunchmoney --fixture <local reconstructed payload> --identity-proof
```

The leftover is the same effective 2026-08-16 household evidence that
became the published opening. It is not a new institution pull and is
not a reason to treat B21's later 2026-08-17 observation as unused.

## Replay result

| Fact | Value |
|---|---|
| Evidence fetchedAt | 2026-08-16T19:38:31.821Z |
| Mapped Atlas accounts | 8 (chequing-a, chequing-b, savings, tdcc, cashback, travelvisa, heloc, mortgage) |
| Intentionally unmapped | 2 (DEBT&PAYMENTS, SAVINGS-DONT TOUCH) |
| Observed spendable household cash | $2,252.76 |
| First vs second observe | identical identity fingerprint |
| Display-name rename | same identity keys |
| Chequing B −$10 correction | same `cash:chequing-b` target; $932.05 → $922.05; no write |
| Canonical write | false |
| `data.json` bytes | unchanged |
| `cardCapacityIsCash` | 0 |
| Real pending→posted transitions | 0 |
| Endpoint origin preserved | false — not fabricated |

Reconciliation of the replay against the current 2026-08-16 opening:

| Status | Count |
|---|---|
| MATCH | 12 |
| CHANGE | 0 |
| CONFLICT | 0 |
| MISSING | 0 |
| STALE | 0 |

Date relations: same-day 9 · incomparable 3 · canonical-older 0 ·
canonical-newer 0.

No same-day discrepancy appears on this leftover, because it **is** the
published opening. The Triangle same-day +$112.70 case remains the B21
2026-08-17 record. This outcome does not choose a winner for it.

## Historical payroll posting-candidate noise

The leftover's Seaspan payroll on 2026-08-14 is still identified
(payee + mapped chequing-a + scheduled date; amount not used). It is
classified `historical-before-opening` with `mustNotBackfillOpening`.
It is **not** fed to the current-opening posting compare, so it cannot
appear as a current `representedEvents` CHANGE and cannot backfill the
empty live `plan.opening.representedEvents`.

That is the B21 120-day noise limitation, closed for current-opening
identity. D7 static posting observations in
`docs/reconciliation/posting-observations.json` are unchanged.

## Same-day / unused B21 surfaces, preserved

| Surface | This outcome |
|---|---|
| Triangle same-day +$112.70 | No winner. Observer now records `winnerChosen: false` when a CHANGE is same-day without time evidence. Canonical Triangle remains the screenshot figure. |
| Fresh Chequing B $10 from B21 | Evidence only. A corrected replay stays on `cash:chequing-b` and does not write. |
| Automatic vs manual endpoint origin | Still not in the normalized report. Not fabricated. |
| Real pending→posted | Still 0. Fixture collapse remains supporting coverage. Absence recorded; not blocking. |

## Deterministic coverage

`node test/test-b78-identity.js` (registered in `test/test.js`) proves the same
invariants on committed fixtures: re-observe no-op, display-name
stability, in-place amount correction, historical payroll excluded from
the current-opening compare, same-day CHANGE chooses no winner, unmapped
fail-closed, credit is not cash, `--identity-proof` print is sanitized.

## Human intervention required

1. Owner had already supplied the 2026-08-16 leftover observe report
   locally (Downloads; not committed).
2. Owner had already created the gitignored local provider-account map.
3. This builder shell did **not** have `LUNCHMONEY_ACCESS_TOKEN`, so no
   new live GET was performed.
4. Reconstruction of the leftover payload and the second observe both
   stayed local. Raw IDs and live JSON were not committed.

A later owner-supplied token can add a fresh live GET as additional
evidence. It is not required to reopen this identity outcome unless that
pull demonstrates a new identity defect.

## Closure verdict

B78 / AF-INGEST-01 may be marked DONE. T3 holds on this evidence.

| Criterion | Result |
|---|---|
| Real household Lunch Money data, not fixture-only | YES — 2026-08-16 leftover replay |
| Re-observe / re-reconcile is an identity no-op | YES |
| Display-name change keeps the same target | YES |
| Corrected amount updates the same target | YES |
| Unmapped accounts fail closed | YES |
| Provider credit is never household cash | YES |
| Historical payroll does not backfill `representedEvents` | YES |
| Same-day discrepancy chooses no winner | YES — code + B21 Triangle record |
| Fresh Chequing B unused unless separately authorized | YES |
| Endpoint origin not fabricated | YES |
| Real pending→posted | NO — recorded, not invented |
| Automatic canonical write | NO |
| Secrets / provider IDs / raw live output committed | NO |

T4 / B81 remain closed. This proof does not authorize a canonical writer,
a store, or a trusted automatic write.
