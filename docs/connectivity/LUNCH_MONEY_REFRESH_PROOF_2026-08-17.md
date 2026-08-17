# Lunch Money refresh proof — 2026-08-17

Sanitized owner-run evidence for **B21 / AF-INTAKE-01**. This is the one
committed proof home for that live run. It records what the incumbent
observer and reconciler produced. It does not write canonical state, does
not choose a winner for a same-day discrepancy, and does not invent a
pending→posted transition.

Raw provider JSON, the access token, real Lunch Money account IDs, and
real provider transaction IDs stay out of git.

## Command

Owner-run locally, 2026-08-17:

```text
node scripts/provider-observe.js --provider lunchmoney --live --mode reconcile
```

The token existed only as the local environment variable
`LUNCHMONEY_ACCESS_TOKEN`. The live provider-account map existed only as
the gitignored local file `docs/connectivity/provider-account-map.local.json`.

`--mode reconcile` uses the incumbent 120-day history window.

## Live run

| Fact | Value |
|---|---|
| Fetched | 2026-08-17T23:38:15.373Z |
| Mapped Atlas accounts | 10 |
| Intentionally unmapped accounts | 2 |
| Observed spendable household cash | $2,242.76 |
| Canonical write | false |

The two intentionally unmapped accounts were **DEBT&PAYMENTS** and
**SAVINGS-DONT TOUCH**. Current Atlas policy excludes both from household
cash. This run does not reclassify them.

The observer/reconciler did **not** write `data.json`.

## Reconciliation result

Counts:

| Status | Count |
|---|---|
| MATCH | 11 |
| CHANGE | 8 |
| CONFLICT | 0 |
| MISSING | 0 |
| STALE | 0 |

Date relations:

| Relation | Count |
|---|---|
| canonical-older | 8 |
| same-day | 2 |
| canonical-newer | 0 |
| incomparable | 9 |

### Material / non-matching facts

**1. cash:chequing-b — fresh $10 change**

| Field | Value |
|---|---|
| Evidence date | 2026-08-17 |
| Canonical | $932.05 |
| Observed | $922.05 |
| Difference | −$10.00 |
| Status | CHANGE |
| Date relation | canonical-older |

This fully explains observed spendable cash moving from the current
2026-08-16 canonical opening of $2,252.76 to the live observation of
$2,242.76. It is evidence of a fresh change. **B21 does not apply it to
`data.json`.**

**2. debts:triangle posted balance — same-day discrepancy**

| Field | Value |
|---|---|
| Evidence date | 2026-08-16 |
| Canonical | $13,197.00 |
| Lunch Money observation | $13,309.70 |
| Difference | +$112.70 |
| Status | CHANGE |
| Date relation | same-day |

Do not choose a winner in B21. The existing canonical figure came from
direct institution evidence. This is a same-day provider/direct-evidence
discrepancy whose precise intraday freshness is not established by this
run. It requires freshness/time resolution or stronger direct evidence
before any canonical replacement.

**3–8. Historical payroll posting candidates — reconciliation/noise
limitation**

The 120-day live history identified six historical payroll postings by
payee + mapped account + scheduled date. Amount similarity was not used.

Dates:

- 2026-04-24
- 2026-05-08
- 2026-05-22
- 2026-06-05
- 2026-06-19
- 2026-07-03

The reconciler labels them CHANGE because those real historical postings
sit against current `representedEvents`, which belongs to the current
opening/cutover. Treat this as a demonstrated reconciliation/noise
limitation for later work, **not** as six current household financial
corrections. Do not change the current opening or backfill
`representedEvents` from B21.

## Freshness observed

Actual evidence dates only. Newer freshness is not manufactured.

**2026-08-17**

- cash:chequing-a
- cash:chequing-b
- cash:savings
- debts:cashback limit
- debts:cashback posted-balance
- debts:heloc
- debts:mortgage
- debts:tdcc limit
- debts:tdcc posted-balance
- debts:travelvisa limit
- debts:travelvisa posted-balance

**2026-08-16**

- debts:mbna posted-balance
- debts:triangle posted-balance

## Manual vs automatic provider freshness limit

The current Lunch Money observer calls the connected/plaid endpoint and
the manual-account endpoint, then merges the returned accounts into one
normalized list. The normalized B21 report does **not** preserve which
endpoint each account came from.

This live run therefore cannot truthfully classify individual mapped
accounts as automatically connected versus owner-maintained/manual.

That does not block B21 closure:

- actual evidence dates are preserved
- stale/manual values are not fabricated as newer
- unrelated mapped accounts are not blocked
- the owner-maintained-versus-connected distinction simply remains unknown
  where the observer does not preserve it

Do not fix this runtime limitation inside B21. Carry it as explicit input
to B78 / future refresh work only if demonstrated acceptance needs it.

## Credit safety proof

`cardCapacityIsCash`: **0**

Observed card inference examples (pending unresolved / unknown; household
cash 0; unknown true):

| Card | Posted | Limit |
|---|---|---|
| tdcc | $1,705.94 | $2,000 |
| cashback | $4,799.43 | $5,000 |
| travelvisa | $862.68 | $1,100 |

The live path preserved:

- credit limit ≠ cash
- available / credit capacity ≠ cash
- unresolved pending ≠ zero
- exposure is not invented when pending is unknown

## Transaction identity result

Real pending→posted transitions observed: **0**

Do not claim B21 proved a real pending→posted transition. Existing
fixture/unit coverage may remain cited as deterministic coverage. The
real household acceptance case remains not observed.

Represented-event candidates observed: the six historical payroll
postings listed above. No amount matching was used.

## Human intervention required

1. Owner locally supplied `LUNCHMONEY_ACCESS_TOKEN`.
2. Owner created the gitignored local provider-account map.
3. Owner mapped 10 real Lunch Money accounts to existing canonical Atlas IDs.
4. DEBT&PAYMENTS and SAVINGS-DONT TOUCH were deliberately left unmapped.
5. The first Windows PowerShell write of the local JSON map used UTF-8 BOM,
   which Node rejected.
6. The owner rewrote the same local map as UTF-8 without BOM.
7. The live observe → reconcile command then completed successfully.
8. Raw live provider JSON was removed from the repository working tree and
   retained only as temporary/local evidence.

The PowerShell BOM issue is a documented local setup footgun. It is not
runtime architecture work unless repeated evidence shows a product need.

## Closure verdict

B21 may be marked DONE. Acceptance:

| Criterion | Result |
|---|---|
| Genuinely fresh later live observation | YES |
| Incumbent live observer succeeded | YES |
| Incumbent reconciler consumed it | YES |
| Reproducible documented command | YES |
| Human intervention recorded | YES |
| Actual freshness preserved | YES |
| Material changes/discrepancies surfaced | YES |
| Stale/manual account distinction not fabricated | YES |
| Unrelated accounts not blocked | YES |
| Automatic canonical write | NO |
| Statement/PDF workflow required | NO |
| Secrets / provider IDs / raw live output committed | NO |

A real pending→posted transition was **not** observed. That does not
invalidate B21; record it for B78 / T3 acceptance evaluation.

## B78 inputs learned from this run

1. **No real pending→posted case.** T3 / B78 cannot treat B21 as that proof.
   Fixture collapse remains deterministic coverage only.
2. **120-day payroll posting-candidate noise.** Payee + mapped account +
   scheduled date against current-opening `representedEvents` produces
   CHANGE rows that are not current financial corrections. Do not backfill
   the opening from them.
3. **Endpoint origin is not preserved.** Automatic-versus-manual account
   classification remains unknown unless a later outcome demonstrates that
   the normalized report must keep endpoint origin.
4. **Triangle same-day discrepancy.** Provider $13,309.70 vs direct-evidence
   canonical $13,197.00 needs freshness/time resolution or stronger
   institution evidence before any canonical replacement.
5. **Fresh $10 Chequing B change is real and unused.** Observed spendable
   cash is $2,242.76. Applying it is a later owner-approved canonical edit,
   not B21 and not automatic.
6. **UTF-8 BOM is a local map-writing footgun**, not a runtime product
   defect unless it recurs as a demonstrated need.
7. **Credit safety held on the live path.** Capacity is not cash; unknown
   pending is not zero.
8. **Unmapped policy held.** DEBT&PAYMENTS and SAVINGS-DONT TOUCH stayed
   out of household cash.

B78 / AF-INGEST-01 is the next identity/idempotency outcome. T4 / B81
remain closed. This proof does not authorize a canonical writer, a store,
or a trusted automatic write.
