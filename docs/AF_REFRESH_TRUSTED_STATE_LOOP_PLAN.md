# AF-REFRESH — Trusted State Refresh Loop

**Status:** ACTIVE CAMPAIGN — owner-approved 2026-08-24; AF-REFRESH-01 and AF-REFRESH-02 merged

**AF-REFRESH-03 is DONE.** The next eligible slice is AF-REFRESH-04. Do not start
AF-REFRESH-04 in this pull request.

This file is a temporary execution plan, not a new authority. It exists so a
fresh builder can move directly from the completed Payday Operating Surface
campaign into the next owner-approved outcome without relying on chat history.
Delete this file when AF-REFRESH is complete; merged PR history is the durable
record.

`ARCHITECTURE.md` still owns product direction and authority boundaries.
`docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md` still owns sequencing. `BACKLOG.md`
still owns findings/work. `data.json` and the incumbent canonical files retain
their existing ownership. Lunch Money remains the normal operational update
feed. Forecast remains the sole financial planning/calculation authority.

This campaign must evolve the incumbent B21/B78/B81 seams rather than build a
second ingestion, reconciliation, store, planner, or financial authority.

---

## Why this campaign exists

AF-OPERATE answers the question:

> Given what Atlas currently knows, what should the household do?

The next reliability problem is:

> Can the household trust that Atlas knows current reality before Forecast
> answers?

The desired closed loop is:

**observe reality → reconcile evidence → update only what is proven → Forecast →
operating answer → observe reality again**

Atlas should remove the recurring burden of manually wondering whether a bill
posted, whether a reserve is still needed, whether a balance is stale, or
whether the operating answer is based on yesterday's state.

That does **not** mean Atlas receives permission to move money or silently alter
household policy. The goal is low-friction truth maintenance, not financial
autonomy.

---

## Finish line

After AF-REFRESH, the owner can deliberately trigger one trusted refresh flow
and, without manual reconciliation, determine:

1. when Atlas last observed live financial reality and what that observation
   covered;
2. which balances / posted / pending evidence changed;
3. which modeled obligations were proven represented/settled, which remain due,
   and which remain genuinely unverified;
4. which material observations Atlas could not safely classify or reconcile;
5. which canonical changes are mechanically supported and which require an
   owner answer;
6. that any canonical mutation stayed behind the incumbent explicit
   preview/approve boundary;
7. that Forecast reran from the resulting trusted state rather than a second
   planner; and
8. what, if anything, changed in the household operating answer.

A second refresh over the same provider evidence must be a deterministic no-op.

The finished experience should feel like Atlas maintains its own situational
awareness while still asking the household only for genuinely non-derivable
facts or policy.

---

## Existing authorities and seams — preserve them

AF-REFRESH starts by consuming what Atlas has already earned:

- Lunch Money = normal operational financial update feed.
- Production Lunch Money access = owner-authorized **on-demand GET-only
  observation**.
- `scripts/provider-observe.js` = incumbent provider observation seam.
- Existing reconciliation / settlement machinery = incumbent evidence matcher;
  do not create a second matcher beside it.
- B78 identity/idempotency proof = provider observation identity is already
  earned; preserve it.
- `scripts/canonical-refresh.js` / B81 = incumbent bounded
  preview/approve canonical-refresh writer.
- `scripts/live-plan.js` / B81 = incumbent read-only live overlay.
- Files remain the canonical foundation; B79's store gate stays closed unless
  demonstrated evidence reopens it.
- `public/periods.json` remains the historical-spending authority.
- Forecast remains the sole planner.
- `Forecast.paydayAllocation` remains payday allocation authority.
- `Forecast.currentPeriodAction` remains between-paydays action authority.

Before every implementation slice, verify these names and boundaries on current
`main`; if the repository has evolved, current authority wins over this plan.

---

## Hard boundaries

This campaign does **not** authorize:

- financial-institution writes;
- provider writes;
- payments, transfers, card actions, debt draws, or money movement;
- unattended canonical writes;
- scheduled/background production refresh;
- a second transaction store;
- a second canonical database;
- a second reconciliation engine;
- a second planner or budget engine;
- silent promotion of estimates or ambiguous evidence to verified facts;
- inferred household policy;
- treating available credit as household cash; or
- asking the owner to confirm something Atlas can already prove.

Background/scheduled observation can be considered later only if the owner
explicitly authorizes that separate boundary after the on-demand loop is proven.
AF-REFRESH must not smuggle a scheduler in as an implementation detail.

---

## Trust model

Every refresh must keep these states distinct:

### Live observed state

Ephemeral provider evidence: balances, posted transactions, pending evidence,
coverage, and observation timestamps. Observation is evidence, not automatically
canonical household truth.

### Canonical household state

The incumbent repository-backed facts and generated authorities. They change
only through an already-authorized canonical path with provenance and the
required preview/approval boundary.

### Household-only facts / policy

Cancellations, priorities, future intentions, permission to borrow, uncertain
business/household splits, or any other fact the provider cannot prove. These
remain owner evidence and must not be inferred from absence or merchant data.

### Forecast result

Derived only after the trusted state is selected. Forecast decides the plan;
refresh/reconciliation code does not.

---

## Known queued owner evidence

Owner-stated 2026-08-24:

- the recurring **CMAW Local 1995 union dues payment of $25/month has been
  cancelled**.

This planning PR records the evidence but deliberately does **not** mutate the
active AF-OPERATE household model. AF-REFRESH-01 owns that prospective change.
It must retire the future recurrence without inventing whether a current-cycle
occurrence already posted or is still unsettled; current-cycle settlement must
be reconciled from actual evidence.

**AF-REFRESH-01 consumption:** the owner statement above is the cancellation
authority. The monthly Plan bill is retired. The 15 August once row remains
because incumbent posting evidence still records that occurrence as unknown.

If more owner facts arrive before AF-REFRESH begins, do not silently bundle them
into AF-REFRESH-01. Each still has to satisfy the one-independently-provable-
outcome rule or be routed through an existing evidence intake mechanism.

---

## Ordered PR-level slices

GitHub assigns PR numbers. `AF-REFRESH-*` IDs below are stable campaign IDs.

### AF-REFRESH-00 — Queue the successor campaign

**Outcome:** this file is committed while AF-OPERATE is still active so the next
campaign is recoverable from repository state.

**Changes:** this plan only.

**Proof:** a fresh agent can identify the finish line, incumbent seams, hard
boundaries, first implementation slice, acceptance test, and activation gate
without chat history.

**Non-goals:** no runtime change, no financial figure change, no canonical data
change, no AF-OPERATE implementation change.

**Activation gate:** AF-OPERATE-07 must merge before AF-REFRESH-01 starts.

---

### AF-REFRESH-01 — Retire the cancelled union-dues recurrence

**Outcome:** the owner-confirmed cancelled $25/month CMAW recurrence no longer
creates future household obligations after the proven cancellation point.

**Requirements:**

- use the explicit owner statement as the authority for cancellation;
- preserve historical occurrences;
- do not infer that an already-scheduled/current-cycle occurrence settled merely
  because the recurrence was cancelled;
- reconcile the current-cycle occurrence against incumbent actual evidence;
- if the effective cancellation boundary cannot be established safely, stop on
  that exact owner/evidence question rather than inventing a date;
- run Forecast through the resulting canonical state and expose any figure
  movement under current governance.

**Independent proof:** future event expansion contains no unauthorized recurring
$25 occurrences beyond the supported cancellation boundary, historical rows are
unchanged, and any current-cycle settlement classification is independently
traced to actual evidence.

**Likely risk:** figures may move; use current governance at implementation time.

**State:** DONE. Monthly `uniondues` row removed. `uniondues-aug15-outstanding`
retained because posting remains unknown. Historical `periods.json` Union dues
actuals unchanged. Next eligible slice is AF-REFRESH-02.

---

### AF-REFRESH-02 — One trusted on-demand observation receipt

**Outcome:** one owner-triggered refresh action produces a sanitized, complete
receipt of the incumbent live observation without writing canonical data.

The receipt should expose only what is operationally useful, such as:

- observation as-of time;
- source/coverage status;
- account coverage/freshness;
- posted/pending completeness;
- counts of newly observed/changed provider identities;
- whether the observation is safe to pass into incumbent reconciliation; and
- explicit fail-closed reasons when it is not.

**Requirements:**

- evolve/compose `provider-observe` / the incumbent read-only seam;
- preserve B78 identity/idempotency behavior;
- no raw provider identifiers or sensitive payees in committed/public output;
- no canonical write;
- no provider write;
- no second observation store.

**Independent proof:** two reads of identical provider evidence produce the same
sanitized fingerprint/receipt and zero canonical diff; truncated/incomplete
coverage cannot report a false-current result.

**State:** DONE. `scripts/provider-observe.js --receipt` prints one sanitized
observation-coverage receipt from the incumbent GET-only seam. Identical
evidence yields the same fingerprint; truncated/partial/unproven coverage
cannot report ready; canonical files are unchanged. Next eligible slice is
AF-REFRESH-03.

---

### AF-REFRESH-03 — Reconcile observed reality to modeled obligations

**Outcome:** the refresh receipt flows through the incumbent reconciliation /
settlement authority and produces one trustworthy current-state reconciliation
receipt.

For modeled current-period obligations, keep these states distinct:

- represented / settled by trusted evidence;
- upcoming / still due;
- unverified settlement;
- ambiguous / unresolved evidence; and
- not applicable / outside the covered observation window.

**Requirements:**

- extend the incumbent matcher only where demonstrated gaps exist;
- never treat "not observed" as proof of "unpaid";
- never let the same transaction settle two occurrences;
- preserve amount/date tolerances and account boundaries already owned by the
  reconciliation architecture;
- surface materially unmatched household cash movement for review without
  inventing a match;
- no second matcher or transaction ledger.

**Independent proof:** a separate ledger/identity reconciliation proves every
represented occurrence consumes one compatible live transaction at most once,
and known unverified cases remain unverified.

**State:** DONE. `scripts/provider-observe.js --reconciliation-receipt` prints
one sanitized obligation-reconciliation receipt gated on the AF-REFRESH-02
observation receipt. Not-ready packets fail closed without a trusted
classification. Ready packets consume the incumbent `representedEventCandidates`
matcher and `Forecast.currentPeriodObligationStates`. CMAW
`uniondues-aug15-outstanding` stays unverified without identity-complete
evidence. Canonical state is unchanged. Next eligible slice is AF-REFRESH-04.

---

### AF-REFRESH-04 — Turn reconciliation into a bounded canonical refresh proposal

**Outcome:** the existing B81 canonical-refresh path can take the trusted
observation/reconciliation result and present one explicit candidate canonical
change set.

The candidate should distinguish:

- mechanically provable updates;
- no-op/replayed evidence;
- owner-fact questions;
- ambiguous evidence that must not write; and
- downstream generated artifacts that would change if approved.

**Requirements:**

- use the incumbent `canonical-refresh` preview/approve writer;
- preserve existing allowlists/bounds/provenance;
- **preview first**;
- no automatic approval;
- no unattended canonical mutation;
- no write merely because live state differs from canonical state;
- owner questions only for non-derivable material facts.

**Independent proof:** the preview exactly matches the eventual approved bounded
write; replay after approval is a no-op; rejected/unresolved rows cannot leak
into canonical state.

---

### AF-REFRESH-05 — Recompute the operating answer from refreshed state

**Outcome:** after a trusted live overlay or approved canonical refresh, the
incumbent Forecast produces the household operating answer from that refreshed
state with no manual arithmetic or second planning path.

The refresh result should make it obvious whether the operating answer changed
in material ways, using incumbent Forecast fields, for example:

- money available;
- obligations still protected;
- current spending permission;
- future-cost protection;
- extra-debt allocation when authorized; and
- material freshness/trust limitations.

**Requirements:**

- consume Forecast outputs; do not recalculate their financial meaning in the
  refresh layer;
- live overlay and canonical modes must not silently disagree about provenance;
- a stale/incomplete observation cannot make the operating answer look more
  precise;
- zero/no-change is a valid result.

**Independent proof:** the same refreshed inputs supplied directly to Forecast
produce the same operating values; the refresh/orchestration layer contributes
no competing financial arithmetic.

---

### AF-REFRESH-06 — Make refresh trust visible and low-friction

**Outcome:** the household-facing operating surface clearly states whether the
answer is current enough to act on and exposes the owner-triggered refresh path
without turning the homepage back into diagnostics.

Compactly show, using incumbent trust results:

- last observed / reconciled as-of;
- current / partially current / attention-needed state;
- important unresolved material items;
- whether pending/category/account coverage limits exact claims;
- whether a canonical proposal is waiting for explicit approval; and
- the smallest owner question needed to finish reconciliation, if one exists.

**Requirements:**

- page renders trust state; it does not invent freshness rules or settlement;
- no raw transaction/provider details on the household surface;
- no modal approval ceremony when there is nothing to approve;
- do not ask the owner about already-proven facts.

**Independent proof:** synthetic current/stale/incomplete/ambiguous cases render
distinctly, and exact household-actionable figures remain suppressed whenever
the incumbent trust contract says they are unavailable.

---

### AF-REFRESH-07 — Live closed-loop acceptance and cleanup

**Outcome:** prove the entire refresh loop against real current household state,
then retire campaign-only scaffolding.

**Acceptance test:** from a trusted environment, the owner deliberately starts a
refresh and can determine, without manual reconciliation:

1. what live evidence changed;
2. what modeled items were represented, remain due, or remain unverified;
3. what material item, if any, needs an owner answer;
4. what canonical changes are proposed before any write;
5. what Forecast says after the trusted state is selected;
6. whether the operating answer changed; and
7. exactly how fresh/complete the result is.

Then run the same refresh again against unchanged provider evidence. It must be
an idempotent no-op.

**Security acceptance:** prove no provider/FI write, no unattended canonical
write, no scheduled/background refresh, no secret/raw identifier publication,
and no credit-as-cash behavior.

**Campaign closeout:**

- close/retire any campaign-specific backlog items;
- remove temporary campaign-only routing/scaffolding;
- keep reusable incumbent refresh/reconciliation functionality;
- delete `docs/AF_REFRESH_TRUSTED_STATE_LOOP_PLAN.md` in the final cleanup PR.

---

## What success feels like

The owner should no longer have to maintain Atlas by mentally tracking what has
posted since the last update.

A successful refresh should read more like:

> Observed today at 7:42 AM. Coverage current. 18 new/changed transactions.
> Mortgage and BCAA reconciled. One modeled item remains unverified. One new
> transaction needs classification. No provider writes occurred. Forecast was
> recomputed from the trusted state; the operating answer changed in the fields
> shown below.

The exact wording is not authority and may evolve. The important property is
that every statement traces to the incumbent observation, reconciliation,
canonical, and Forecast authorities.

---

## Explicit non-goals for this campaign

Do not turn AF-REFRESH into:

- a new database/store migration;
- historical merchant cleanup;
- complete historical classification;
- a bill-payment system;
- autonomous money movement;
- a scheduler/background daemon;
- push notifications;
- a new AI financial planner;
- provider-side categorization writes;
- a generic event-sourcing architecture;
- a reason to reopen already-proven B21/B78/B79/B81 work wholesale.

Those may be separately considered only when evidence shows they solve a real
remaining problem and current repository governance permits them.

---

## Handoff from AF-OPERATE

AF-OPERATE-07 and AF-REFRESH-01 through AF-REFRESH-03 have merged. AF-REFRESH
is the active campaign. After AF-REFRESH-03 merges, a fresh builder should:

1. re-fetch current `main` and open PRs;
2. read `AGENTS.md` and the normal authority chain;
3. read this file;
4. verify that its incumbent seams still exist and that current repository
   authority has not superseded the plan; and
5. execute **AF-REFRESH-04 only**.

The activation instruction is therefore simple:

> Read `AGENTS.md` and `docs/AF_REFRESH_TRUSTED_STATE_LOOP_PLAN.md` from current
> main, verify current state, and execute the next eligible AF-REFRESH slice.

One independently provable outcome at a time.
