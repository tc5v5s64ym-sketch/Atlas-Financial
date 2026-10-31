# Aug. 14 2026 payday acceptance corpus

**Record status:** Real-world acceptance evidence for `AF-RECON-01` / `B91`.
Not a roadmap, not a second planner, and not a household-policy authority.

**As of:** 14 August 2026, after pay landed.
**Owner:** Dale.
**Canonical sequence:** [`docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md`](../ATLAS_FINANCIAL_BUILD_STRATEGY.md).
**Work item:** `BACKLOG.md` `B91`.
**Open household questions:** [`docs/01_OPEN_QUESTIONS.md`](../01_OPEN_QUESTIONS.md).

This file preserves one payday session as the closed acceptance case for
evidence → canonical refresh. The B91 current-state cutover writes only
owner-approved facts that the committed corpus can support. It does not
make ChatGPT or a Sheet a second planner, and it does not encode the
session's chosen weekly spend as policy.

```
fresh evidence
    → reconciliation
    → canonical Atlas state
    → Forecast
    → payday-plan output
         ├── website renders
         ├── ChatGPT explains
         └── Google Sheet tracks execution
```

Given identical reconciled inputs, those three surfaces must agree. ChatGPT
and the Sheet must not construct a second budgeting model.

## Acceptance statement

After reconciling the facts below, Atlas's existing deterministic Forecast
must be able to produce the household payday plan. Do **not** assert that
$600/week is the expected output. The point is correct consumption of
reconciled evidence.

## Scenario that B91 must consume

- Aug. 14 payday.
- Live balances observed **after** pay landed.
- Mortgage expected Aug. 14 but **not yet posted** at observation time.
- Fusion camp already paid.
- Fusion tryouts already paid.
- BC Hydro, as observed that day:
  - $213.79 due now;
  - $237.45 due 1 September;
  - $451.24 total account balance.
- Amanda salary separate from coaching and from account transfers.
  Observed employment nets in this session: about $2,168.85 on the 15th and
  about $2,387.99 at month-end. Those amounts are session evidence, not a
  promotion to verified canonical income.
- Live credit-card posted balances, with pending amounts possibly unknown.
- Amanda's mixed-purpose DEBT&PAYMENTS account is **not** automatically
  spendable household cash.
- HELOC cash semantics remain unresolved (Q19).
- Obligations just beyond the next payday (around 28 August) remain visible
  to the existing 91-day Forecast.

## Four underlying problems, not thirteen tickets

The session findings cluster here. Implementation belongs to `B91` after
`B92` and `B93`, not to a ticket per letter.

### 1. Current-state cutover / freshness

- **D1.** Same-day income can double-count. A live opening balance observed
  after payday already includes the paycheques. Replacing stale
  `startingCash` with that live balance while the Aug. 14 payroll recurrence
  remains active lets `Forecast.expandEvents()` add the same payday again.
  A live opening observation needs explicit cutover / as-of semantics so
  events already represented in that observation are not replayed.
- **D7.** A schedule is not proof an event has posted. Examples from this
  session: mortgage expected Aug. 14 but not yet on the bank screenshot;
  Fit4Less; BCAA; ICBC; RESP; other same-day or next-day items. Forecast
  remains authority for what **should** happen. Fresh
  transaction/settlement evidence determines what **has** happened. Store
  minimum facts; derive human-readable statuses. Do not start a large
  lifecycle state machine.
- **D12.** Fresh evidence can exist while canonical state remains stale.
  This session: live balances vs 9 August starting cash; Fusion paid
  status; Rogers status; Hydro current due state; Amanda salary evidence;
  `HOME BUDGET` workbook located in Gmail. The required loop is evidence
  value/date → Atlas value → difference/conflict → disposition/unresolved
  → owner-approved canonical update.

### 2. Evidence → canonical reconciliation

- **D3.** Paid or settled commitments must stop reserving cash. Fusion camp
  (~$786) and Fusion tryouts ($140) were already paid while still modelled
  as future commitments.
- **D4.** Statement/account balance is not the amount currently due. Hydro
  showed $451.24 total, $213.79 overdue/due now, $237.45 new charges due
  1 September. Atlas schedules the dated cash requirement, not the whole
  account balance by default.
- **D5.** Household obligation and paying account are separate facts. Hydro
  remained a household obligation even though Amanda paid it from her own
  account. A bill must not vanish from household planning solely because
  it leaves an account outside the current simulated joint-cash pool.
- **D8.** Card state needs posted vs pending where evidence supports it:
  posted balance, pending, limit, available credit, confirmed payment.
  During this session Cash Back Visa and Travel Visa were over limit;
  posted balances were known; pending was unknown. Never treat available
  credit as cash.
- **D9.** Account balance is not household-available cash. Amanda's
  DEBT&PAYMENTS held $798.37 in this session; some may belong to
  coaching/business/pass-through obligations. A fresh balance does not
  automatically become spendable starting cash.

### 3. Material / wrong financial authorities

- **D2.** Amanda income must not collapse salary, coaching net economics,
  and transfers into one `amandaTransfer` authority. Transfers move
  already-earned money; they are not income. Do not silently promote the
  session nets without the owner-approved canonical edit.
- **D6.** HELOC cash semantics remain unresolved. The current model treats
  about $814.18 as capitalised and non-cash; the household has historically
  made ~$1,000 HELOC payments; the owner believed payment/interest came
  from chequing; minimum/autodebit mechanics remain unverified. Q19 stays
  open. B91 must not claim confident zero household cash impact while
  those mechanics are unresolved.

### 4. Payday output / recommendation semantics

- **D10.** `Forecast.recommend` solves the mathematical variable-spend
  maximum subject to the protected floor. This session chose a lower
  operating amount. Distinguish mathematical maximum, a household
  operational target **if policy exists**, and remaining margin above
  floor. Do **not** encode $600/week as household policy. Re-test this
  output question after B91; do not build an operational-margin feature
  in order to record it.
- **D11.** Near-boundary obligations (immediately after the next payday)
  affect whether current surplus should go to debt. The 91-day Forecast
  already sees them. Payday output should expose those obligations before
  recommending current surplus use, using existing Forecast output rather
  than another horizon or model.
- **D13.** ChatGPT and Google Sheet must not become financial authorities.

## What this file is not

It is not thirteen architecture tickets, not owner policy, not a second
Forecast, and not permission to change `data.json` from these numbers
without the B91 reconciliation loop.
