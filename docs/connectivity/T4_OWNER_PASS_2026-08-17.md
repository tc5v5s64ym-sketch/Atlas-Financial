# T4 owner pass — 2026-08-17

Owner decision: **PASS T4**.

This records permission to **start** `B81` / `AF-LIVE-02` and build the
earned trusted canonical-refresh mechanism. It does **not** mark trusted
refresh as already complete, and it does **not** authorize unattended
production writes.

Exact `main` at the decision: `479e6df97a860ff2dce0e2c5ddf45eb708d43a39`
(PR #96 / B79 merged). No open pull requests at that head.

## What passed

`ARCHITECTURE.md`'s five connectivity conditions were assessed. Conditions
1, 2, 4, and 5 were met on that head. Condition 3 (security review) is
owner-reserved; the owner passed it with the restrictions below.

Lunch Money remains the normal operational update feed. Forecast remains
the sole planning / calculation authority.

## What this does not authorize

- unattended production writes
- scheduled automatic refresh
- a production `LUNCHMONEY_ACCESS_TOKEN` in Render
- institution usernames, passwords, PINs, OTP, or security answers
- money movement or any institution action
- bypassing `scripts/reconcile.js`
- silently applying ambiguous evidence

Atlas may continue to GET Lunch Money locally when the owner sets
`LUNCHMONEY_ACCESS_TOKEN` in the shell. The token is still a configured
secret under `ARCHITECTURE.md`. Official Lunch Money tokens are not
provider-scoped read-only; Atlas usage remains GET-only.

## Known evidence that must stay unresolved

- unused Chequing B $10 from B21
- Triangle same-day +$112.70 with no winner
- no real pending→posted household case
- endpoint origin the observer does not preserve

Do not apply those merely because they were observed.

## Earned mechanism, once built

```
Lunch Money observation
    → scripts/provider-observe.js
    → scripts/reconcile.js
    → deterministic proposed change set
    → explicit preview
    → explicit owner approval
    → bounded data.json update
    → validation
    → Forecast
```

Default operation is non-writing. No approval means no canonical write.
Snapshot / history stays `scripts/snapshot-balances.js`. After the later
opening-state-transition repair, an approved `--approve-opening` write
must construct same-date Household evidence and the dated snapshot
before `data.json` is permanently mutated; the snapshot writer is not
replaced and is no longer a required operator follow-up after a
successful opening.
