# Store question — B79 / AF-STORE-01

Written answer to whether Atlas’s current file foundation can still provide
the invariant, identity, and idempotency guarantees the work actually
needs. This is the Phase 3 store-gate record. It does not introduce a
store, does not write canonical state, and does not open T4 / `B81`.

`ARCHITECTURE.md` owns the gate. Passing it is an owner decision,
recorded. This file records the evidence answer. It does not pass the
gate.

## Question

Can `data.json`, generated `public/periods.json`, the observation and
reconciliation files, dated `snapshots/`, and git as history still give
the guarantees the household path needs?

A store is justified only when a required guarantee has **failed on real
household data**, or the incumbent architecture cannot reasonably provide
it. Relational tidiness, convention, later-capability assumptions,
undemonstrated scale, and generic engineering preference are named in
`ARCHITECTURE.md` as things that are **not** reasons.

## Evidence used

No new live GET. No new household fact. No code change.

| Record | What it demonstrated |
|---|---|
| B78 / T3 · [`docs/connectivity/LUNCH_MONEY_IDENTITY_PROOF_B78.md`](connectivity/LUNCH_MONEY_IDENTITY_PROOF_B78.md) | Real 2026-08-16 Lunch Money observation replayed twice: identical identity fingerprint; MATCH 12 / CHANGE 0; display-name rename kept the same target; a Chequing B correction updated `cash:chequing-b` in place; unmapped accounts failed closed; credit was not cash; historical payroll did not backfill `representedEvents`; `data.json` unchanged. |
| B21 / AF-INTAKE-01 · [`docs/connectivity/LUNCH_MONEY_REFRESH_PROOF_2026-08-17.md`](connectivity/LUNCH_MONEY_REFRESH_PROOF_2026-08-17.md) | Later live observe → reconcile on 2026-08-17. Material surfaces (Chequing B $10, Triangle same-day, historical payroll noise) were reported without a canonical write. Unmapped policy and credit safety held. |
| B20 / AF-HIST-01 · `snapshots/2026-08-09.json` and `snapshots/2026-08-16.json` | Dated openings in files. Re-running the same reading is a no-op; a conflicting same-date file fails closed. T2 met on the stored HELOC pair. |
| Incumbent path | `scripts/provider-observe.js` maps by existing Lunch Money `providerAccountId`. `scripts/reconcile.js` is the non-writing compare. Canonical current state is an explicit `data.json` edit. Git is the history. The pre-commit hook refuses `raw/`, `derived/`, and identifier-bearing content. |

Starting `main` for this record: `3f8db809be0d59d033b7e81c8d315bb283e242d5`
(B78 #95 merged).

## Evaluation

| Required guarantee | Incumbent | Demonstrated on real data? | Failed in a way that needs a store? |
|---|---|---|---|
| Stable account identity | Provider account ID → one Atlas canonical id. Display name is a label. | Yes. B78 rename kept `chequing-a`. | No |
| Transaction identity / idempotency | Same `providerTransactionId` is one economic event. Re-observe of the same evidence is a no-op. | Yes. B78 second observe matched the first fingerprint. Fixture coverage collapses pending+posted on that id. | No |
| Duplicate prevention | Mapping is by id, not name. Unmapped ids produce no observation. Historical posting candidates do not mint current `representedEvents`. | Yes. B78 leftover: 8 mapped, 2 unmapped, empty live `representedEvents`. | No |
| Corrections update the same target | A changed balance stays on the existing canonical locator. | Yes. B78 Chequing B $932.05 → $922.05 stayed `cash:chequing-b` and did not write a second identity. | No |
| Unmapped fail-closed | Unknown provider ids stay unmapped. DEBT&PAYMENTS and SAVINGS-DONT TOUCH stay out of household cash. | Yes. B21 and B78. | No |
| Historical vs current opening | Posting candidates whose date is not `plan.opening.asOf` are historical evidence, not current-opening corrections. | Yes. B21 discovered the noise; B78 classified it without a store. | No |
| Reconciliation invariants | MATCH / CHANGE / CONFLICT / MISSING; same-day CHANGE chooses no winner without time evidence; credit capacity is never cash. | Yes. B78 replay MATCH 12 / CHANGE 0. B21 Triangle same-day left unresolved. | No |
| Auditability / history | Git versions every committed figure and proof. Dated `snapshots/` hold prior openings. Observation reports are local evidence; sanitized proofs are committed. | Yes. B20 two openings; B21 and B78 sanitized records. | No |
| Canonical-state integrity | Observe/reconcile do not write `data.json`. A published change is an explicit owner-approved edit. Conflicting same-date snapshots fail closed. | Yes. Both live/replay proofs left `data.json` bytes unchanged. | No |
| Transactional / database semantics | Not required by the current path: one non-writing compare, then one explicit canonical edit. No concurrent writers, no multi-row commit across a store. | Not demonstrated as a need. | No |

## What looked like a failure, and was not a store gap

These are real. None of them is a file-foundation identity or idempotency
collapse, and none of them is cured by SQLite or another store.

| Surface | What it actually is |
|---|---|
| B21 historical payroll CHANGE rows | A current-opening classification miss. B78 closed it in the incumbent observer. |
| Triangle same-day +$112.70 | Missing intraday freshness, not a missing unique key. A store would still have two same-day facts and no winner. |
| Unused Chequing B $10 | An unauthorized canonical update, not an identity failure. T4 / `B81` remains closed. |
| No real pending→posted case | Evidence absence. Fixture collapse already exists. Not a uniqueness failure. |
| Endpoint origin not preserved | Observer report completeness. Not a storage-engine defect. |
| Token / local map required for live GET | Owner-supplied secret and gitignored map. Expected. |
| Automatic canonical writes not earned | Connectivity gate / T4. A store is not that writer. |

## Verdict

**The file foundation has not demonstrably failed.** Atlas should stay
with files.

The guarantees B78 / T3 was built to prove — identity-stable, idempotent
Lunch Money observation against the existing reconciler — held on real
household data. The remaining household surfaces are freshness,
authorization, and missing provider evidence. Those are not store
semantics.

Do **not** introduce SQLite, Postgres, or any other store on this record.
Do **not** treat T4 / `B81` as opened.

## Owner-decision point

`ARCHITECTURE.md` still owns the store gate. **This record does not pass
it.**

No owner action is required to keep the file foundation.

An owner pass would be required only if later **real household data**
shows that files cannot provide a named invariant, identity, or
idempotency guarantee the work then actually needs. That pass is a
separate recorded decision. Tidiness, convention, and a later capability
wanting a database remain insufficient.

T4 / `B81` is a different gate and stays closed.
