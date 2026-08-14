# Atlas Financial — build strategy

**The order work is done in, and what each piece has to prove.**

This document is **subordinate to [`ARCHITECTURE.md`](../ARCHITECTURE.md)**. That
file owns direction, which authority owns which concept, and the gate each future
capability must pass. This one owns *sequencing within what direction already
permits*. Where the two disagree, `ARCHITECTURE.md` wins and this file is wrong.

It also does not own work or findings. [`BACKLOG.md`](../BACKLOG.md) does, and
every item here names its backlog entry rather than restating it — including the
later-phase items, which are recorded there as `QUEUED` so the work record can
show them and their blockers rather than leaving them visible only here. A question only
the household can answer lives in
[`docs/01_OPEN_QUESTIONS.md`](01_OPEN_QUESTIONS.md).

**What this is not.** It is not a promise of completeness. It sequences the work
that is currently known and named; `BACKLOG.md` holds items this document has not
scheduled, and a backlog item is not ineligible merely because no phase names it.
Scheduling here authorises nothing that `ARCHITECTURE.md` has not already
permitted — reaching a line in this file passes no gate.

Capabilities that are wanted but not yet in Phases 1–4 are recorded in
**Later capabilities — status and reopen trigger**. That table is memory and
trigger, not a second order of work.

**Current sequencing (14 August 2026).** B74, B87, B88 and B89 are closed. The remaining
implementation order is the **Post-B74 architecture disposition** below. Next
implementation outcome: spending-classification reconciliation (`B90`). Next major product
milestone: evidence refresh / reconciliation (`B91`). History (`B20`) follows
that loop; it is not the next infrastructure item.

---

## Atlas is not greenfield

Every item below either **consumes, evolves, derives from, replaces or deletes**
an existing authority, and says which. None stands a second one beside it.
`ARCHITECTURE.md`'s incumbent table is the list; this file cites it rather than
copying it, because a second copy would drift.

The dispositions used here:

| Disposition | Means |
|---|---|
| `CONSUME` | Uses an incumbent unchanged. |
| `EVOLVE` | Changes an incumbent in place; it stays the owner. |
| `DERIVE` | Produces something new *from* an incumbent, which stays the owner. |
| `REPLACE` | Retires an incumbent and names its successor. |
| `NEW` | Nothing owns the concept today; adds one owner with a named consumer. |

---

## Model tiers

Which agent capability an item needs, decided by **what it can get wrong**, not by
how much typing it involves.

| Tier | For work that | Requires |
|---|---|---|
| **M1** | touches no financial figure and moves no authority — housekeeping, comments, docs | the normal merge gate |
| **M2** | changes one named authority along a proof path that already exists | a test that fails before and passes after |
| **M3** | **moves, creates or retires a financial authority**, or changes what the household is told | proof **independent of the code under change**; this is on `CLAUDE.md`'s high-risk trigger list, so the blocking review applies |
| **M4** | cannot proceed without an owner decision or a household fact | the owner, before any code |

M3 is the tier that has hurt this repository. `Forecast.recommend` exists as *the*
single authority because two pieces of code once answered the same question and
the site published `$1,650/wk` beside `$0/wk`. A test exercising the function
under change proves consistency, not correctness — M3 needs a second path to the
same number.

**A tier is a floor, not a ceiling.** An item may be raised when the work turns
out to touch more than expected; it is never quietly lowered to move faster.

**A tier says what capability the work needs. It does not say whether the
blocking review applies** — that is decided separately by `CLAUDE.md`'s
high-risk trigger list, against what the pull request actually touches. **An M1 or
M2 item can trigger the review and several here do**, most obviously any item
that changes a deterministic hard gate protecting an authority. Reading the tier
as the review answer is how an item skips a gate it should have met.

---

## Trajectory gates

Phase boundaries. Each is a condition on the repository, checked before the next
phase starts — not a date.

| Gate | Holds when |
|---|---|
| **T1** | Every financial answer the site publishes has a named owner reachable by `npm test`, and the authority record is mechanically checked rather than maintained by inspection. |
| **T2** | Account balances have history, so a trend question can be answered from the repository rather than from memory. |
| **T3** | Import is **idempotent and identity-stable on real household data** — re-importing changes nothing, and a corrected record updates rather than duplicates. Proven on files, with no provider involved. |
| **T4** | `ARCHITECTURE.md`'s connectivity gate is met in full, and **the owner has passed it**. |

T1–T3 are conditions an agent can demonstrate. **T4 is an owner decision** and
nothing here can satisfy it. Reaching T3 satisfies one of the connectivity gate's
five conditions; it does not open the gate.

---

## Owner-approved planning posture — 2026-08-11

The household does **not** need a forensic reconstruction of every historical
purchase before Atlas can plan. The captured history is already sufficient to
establish useful spending norms and build the current picture, subject to the
confidence rules below.

- **Historical unknowns stay in the money.** An unresolved transaction still
  counts in total spending and cash movement. Uncertainty changes category
  precision and confidence; it does not make the dollars disappear and does not
  block the budget or forecast by itself.
- **Material omissions are different.** A whole account, meaningful income
  stream, recurring obligation or other source gap that could materially change
  the plan is a correctness issue and may interrupt the sequence. Twenty old
  merchant labels are not the same thing as a missing credit card.
- **From now forward, clean the ledger as it arrives.** Every fresh intake should
  surface new unknown or ambiguous transactions for household clarification.
  Before live connectivity exists this happens at intake; same-day automatic
  notification waits for the connectivity gate rather than being faked by a
  polling architecture that is not yet authorised.
- **Household interviews are evidence, not silent policy.** Amanda's attributed
  interview can inform candidate assumptions, questions and scenarios. Nothing
  in it becomes a verified household fact or shared target merely because an
  agent can read it; promotion still needs the owner decision described in
  `ARCHITECTURE.md`.
- **The near-term product is the operating picture.** The current build should
  get to one trustworthy 13-week story, a week-by-week safe-to-spend view, one
  financial calendar, and the cash/debt consequence of known large commitments
  or owner-supplied planned purchases **before ingestion infrastructure becomes
  the centre of the work**.
- **Raw-source completeness is verification, not a standing gate.** `raw/`
  remains the immutable source and privacy boundary. A targeted local source
  audit is appropriate when reconciliation exposes a material gap; proving that
  every old file was consumed exactly once is not a prerequisite to using the
  captured history for planning.

These are planning assumptions, not permission to invent money. The existing
financial-correctness, provenance, security, one-authority and owner-reserved
boundaries remain unchanged.

---

## When an urgent finding may interrupt the order

`ARCHITECTURE.md` gives this file the order of planned capability work, and
`BACKLOG.md` feeds it rather than overriding it. That leaves one question, which
belongs here: **what may jump the queue.**

A finding pre-empts the current phase when **any** of these is true:

1. **a published figure is wrong** — the site is telling the household something
   untrue, or two published figures disagree;
2. **a data-safety or security boundary is breached** — anything touching `raw/`,
   a credential, a secret, or the auth gate;
3. **a gate's evidence has been falsified** — something this file or
   `ARCHITECTURE.md` relies on turns out not to hold, so the sequence is built on
   a false premise;
4. **a material source gap is demonstrated** — an omitted account, meaningful
   income stream or recurring obligation is likely to change the household plan.
   Ordinary historical categorisation uncertainty does not qualify.

Everything else — including work that is genuinely valuable and obviously next —
goes to `BACKLOG.md` and waits for its phase. "This is quick" and "we are already
in that file" are not entries on the list above.

**An interruption is still one pull request with one outcome.** It carries its own
merge card, records that it pre-empted and what it displaced, and does not absorb
the phase work it interrupted. Two interruptions do not merge into one.

**If a phase is interrupted more than twice**, the phase itself is the thing to
re-examine — repeated pre-emption usually means the sequence is wrong rather than
that the findings are unlucky.

---

## Post-B74 architecture disposition — 14 August 2026

Accepted sequencing after PR #37 merged. This is not a second roadmap: it
**reorders work this file already owns**. `ARCHITECTURE.md` still owns
direction and gates. `BACKLOG.md` still owns the work items named below.

Governing principle: **finish connecting what exists; delete duplicate
authorities; build the refresh loop.** Do not create another architecture
layer.

The conversation audit that produced this disposition was not preserved as a
repository advisory file. This section is the accepted decision; it does not
depend on that transcript remaining the runtime roadmap.

### What B74 closed — do not reopen

PR #37 gave the household cash schedule one Plan owner:

```
data.json plan
    ↓ Forecast.expandEvents
household cash schedule
    ├── Plan calendar
    ├── nextDue
    ├── nextPaymentOut
    └── ICS cash-payment VEVENTs

standing institutional facts
    ↓
reminder-only VEVENTs
```

Closed, and not to be reopened because an older audit described the pre-B74
state:

- multiple household cash-schedule authorities;
- `data.json upcoming` as a future schedule;
- hardcoded ICS cash-payment definitions;
- separate Plan / nextDue / nextPaymentOut cash calendars;
- RESP missing from the Plan cash path;
- union dues disappearing before confirmed cancellation;
- HELOC 21st represented as a chequing cash payment;
- fixed-five-month recurrence expansion.

Q19 remains intentionally open for HELOC household cash semantics. The 21st
stays reminder-only.

### Remaining order

Immediate correctness / cleanup, then the next major product milestone, then
history as a by-product of refresh. This **replaces** the earlier Phase 2
opening that put `AF-HIST-01` / `B20` immediately after the Phase 1 product
exit.

```
B87  question-status authority
  ↓
B88  CRLF / Windows test reliability
  ↓
B89  derive remaining duplicate publication values
  ↓
B90  spending-classification reconciliation
  ↓
B91  evidence refresh / reconciliation     ← next major product milestone
  ↓
B20  history from successful refresh
  ↓
longer forecast horizon when a household question requires it
```

Later items are not mechanically blocked by every earlier one. Agents must
still be able to tell the intended sequence. A published-figure, data-safety,
falsified-gate, or material-source-gap finding may still interrupt, per the
rules above.

### Immediate cleanup — not the major milestone

- **`AF-QSTAT-01` / `B87`** — one authority for OPEN / ANSWERED. **Complete.**
- **`AF-LINE-01` / `B88`** — tests must not spuriously depend on checkout
  line endings. **Complete.**
- **`AF-PUB-01` / `B89`** — where Atlas already has canonical inputs and
  deterministic derivation, do not store the result independently. Narrow;
  do not redesign `data.json`. **Complete.**
- **`AF-CLASS-01` / `B90`** — the same household spending category cannot
  silently tell contradictory essential/discretionary stories. Prefer a
  small guard. Preserve `business` and `reserve`. **Next implementation outcome.**

### Next major product milestone — evidence refresh / reconciliation

**`AF-RECON-01` / `B91`.** Atlas captures and extracts well; canonical
household state still changes mainly by hand. Connect existing extractors to
existing canonical state with a small reconciliation report:

```
raw evidence → existing extractors → derived evidence
    → reconciliation report (evidence value/date, Atlas value, difference, unresolved)
    → owner-approved change → canonical household state → Forecast → product interfaces
```

First version intentionally small. Owner approval remains required before
evidence changes canonical household financial policy or state where
appropriate.

**Do not build** a database; a second canonical store; a generic fact schema;
a staging/approval platform; a large provenance framework; another extraction
architecture; or another forecast or recurrence engine.

### After the refresh loop

- **`AF-HIST-01` / `B20`** — balance history should be a **by-product of
  successful refreshes**, not an independent system built first. Do not pull
  it ahead of `AF-RECON-01` because an earlier revision of this file did.
- **Longer operating horizons** — later. B74 proved recurrence expansion can
  already run beyond the 91-day display. Extend the operating picture only
  when a concrete household question requires it. Do not add a second engine.
- **`AF-INTAKE-01` / `B21`** — a second-month intake run remains the proof
  that the refresh path works on new evidence. It waits on `AF-RECON-01`,
  not on snapshots existing first.

### Open governance question — do not solve here

Hard boundaries stay: financial and product correctness, security/privacy,
data integrity, production writes, destructive/schema changes, explicit owner
authority. Do not add governance machinery.

Accepted open question: **routine evidence / financial-state refresh may
eventually need a cheaper review lane than an engine authority change.**
`AF-RECON-01` should produce evidence about what ceremony is actually
necessary. Do not carve that lane in advance.

---

## AF-EVID-01 · Evidence-Use Register — Phase 1 interruption

Adopted from the August 13 recommendation after PR #27. This item interrupts
Phase 1 because captured evidence could sit unused with CI still green. B73
and B74 have since closed. The register remains routing-only: `CONSUMED` is
not a financial green, and `AF-RECON-01` is the remaining absorption gap.

- **Outcome** — every explicitly identified evidence ID has exactly one
  CI-checked disposition against an existing incumbent. `CONSUMED` proves
  routing, not financial correctness.
- **Incumbent** — `NEW`. Consumes `docs/01_OPEN_QUESTIONS.md`, household
  interviews, `ARCHITECTURE.md`, and advisory records as destinations. Does
  **not** replace `Forecast`, `data.json` `plan`, ACCOUNT_FACTS, or published
  trust labels.
- **Tier** — **M3**. New architectural authority plus a deterministic hard
  gate. **Backlog** — `B85`.
- **Acceptance** — a governed ID with no disposition fails `npm test`; a
  `CONSUMED` pointer at a missing path fails; the suite does not compare
  amounts and does not claim semantic completeness of prose.
- **Non-goals** — payroll/HELOC/Fusion/budget figure fixes; B73/B74; a fact
  schema; generated `data.json`; a store; a copilot API.

---

## Phase 1 — make the current picture provable · to T1

The site already publishes figures the household acts on. Before anything is
built *on* that picture, the picture needs owners that a test can reach.

### AF-AUTH-01 · Make the authority record mechanically checkable

- **Outcome** — a check enumerates every named authority-producing surface and
  fails when one is absent from `ARCHITECTURE.md`'s incumbent table.
- **Incumbent** — the table itself, and the `npm test` suites. `EVOLVE`.
- **Tier** — M2, and it **triggers the blocking review**: it creates a deterministic hard gate whose pass/fail protects the authority record, which is on `CLAUDE.md`'s trigger list. Low complexity, high consequence. **Backlog** — `B75`.
- **Entry gate** — none; this is the first item.
- **Acceptance** — removing a row from the table fails the suite; adding a new
  `Forecast` export without a row fails the suite; the check states which
  surfaces it covers and does not claim completeness beyond them.
- **Prompt** — *Add a test that enumerates the authority-producing surfaces named
  in `B75` and asserts each appears in `ARCHITECTURE.md`'s incumbent table. Prove
  it by deleting a row and watching it fail. Claim coverage of the named
  surfaces, not completeness.*

### AF-AUTH-02 · Move page-script decisions into the engine

- **Outcome** — each financial decision recorded in `B73` is computed in a
  testable engine function; the page renders the result.
- **Incumbent** — `Forecast`, which gains the functions; `public/modellers.js`,
  `public/deepdive.js` and `public/plan.js`, which lose the arithmetic. `EVOLVE`.
- **Tier** — **M3**. These figures reach the household: the renewal comparison,
  the "Next due", the date Amanda's transfer is required by, the homepage
  mission, and the payoff modeller.
- **Backlog** — `B73`.
- **Entry gate** — AF-AUTH-01, so a new engine function cannot land unnamed.
- **Acceptance** — each moved decision reconciles against a **hand-computed case**
  rather than against the function that now produces it; the page renders and
  decides nothing; `B73` closes only after checking for instances beyond those
  recorded.
- **Prompt** — *Take one decision from `B73`. Move it into `public/forecast.js`,
  reconcile the result against a hand-computed case, and leave the page rendering
  only. One decision per pull request — five decisions is five outcomes.*
- **State** — **complete.** Every decision recorded in `B73` has moved,
  including the eight the 2026-08-12 scan found. Item 8 — Deep Dive derived
  totals and Cash Back Visa fit — was the last of them and closed `B73` on
  2026-08-14. What each move settled is `B73`'s; this file does not keep a
  second running count. AF-CAL-01's entry gate is now met. This item does not
  start `B74`.

### AF-CAL-01 · Give the schedule one owner

- **Outcome** — the on-page calendar and the exported `.ics` stop deriving from
  different sources, or each is shown to answer a genuinely different question.
- **Incumbent** — `Forecast.expandEvents` owns the schedule;
  `scripts/calendar-ics.js` derives its own. `DERIVE` or `REPLACE` — the item
  decides which and records it.
- **Tier** — M3. **Backlog** — `B74`.
- **Entry gate** — AF-AUTH-02, so the schedule authority is settled first.
- **Acceptance** — a due date or amount corrected in one place cannot sit stale in
  the other, and a test demonstrates that; or the document records why the two
  legitimately differ, and what stops them drifting.
- **State** — **complete.** Merged as PR #37 on 2026-08-14. Owner chose
  Option A: ICS cash payments `DERIVE` from `Forecast.expandEvents`; standing
  reminders stay independent and tagged as non-cash. `data.json` `upcoming` is
  deleted as a schedule authority. Acceptance is proved by
  `test-schedule-authority.js`. HELOC 21st vs month-end cash treatment remains
  Q19 and is not closed by this item; the 21st stays on the calendar as a
  reminder-only look-point, not a cash payment. Do not reopen the closed
  schedule-authority list in the post-B74 disposition.

### AF-QSTAT-01 · One authority for question status

- **Outcome** — `docs/01_OPEN_QUESTIONS.md` decides OPEN / ANSWERED; household-
  facing surfaces cannot independently contradict it. Demonstrated live split:
  Q2 and Q5.
- **Incumbent** — `docs/01_OPEN_QUESTIONS.md`. `EVOLVE` the publication copy
  (`data.json` `questions` and any docs that restate status) so it derives or
  is guarded, not a second status authority. `REPLACE` the independent Deep
  Dive status bit.
- **Tier** — M2, and it **may trigger the blocking review** if the PR changes
  `data.json` or a page the household reads. **Backlog** — `B87`.
- **Entry gate** — AF-CAL-01 complete.
- **Acceptance** — a test fails when a household-facing surface claims a
  question is answered while `01_OPEN_QUESTIONS.md` still has it OPEN, or the
  reverse; Q2 and Q5 are the proving cases. The PR does not invent household
  answers.
- **Non-goals** — answering Q2/Q5 as a household fact; a question registry
  product; moving financial figures.
- **State** — **complete.** `docs/01_OPEN_QUESTIONS.md` remains the sole
  status authority. `data.json` `questions` no longer encodes answered via
  `tier === 0` or `ANSWERED —` records. Deep Dive renders priority tiers only.
  Q2 and Q5 stay OPEN. Acceptance is proved by `test-question-status.js`.

### AF-LINE-01 · Tests must not depend on checkout line endings

- **Outcome** — source-scraping tests express code/architecture invariants
  without spuriously failing on CRLF.
- **Incumbent** — the `npm test` suites. `EVOLVE`.
- **Tier** — M1. **Backlog** — `B88`.
- **Entry gate** — after `AF-QSTAT-01`, because this is cheap and isolated,
  not because question status depends on it.
- **Acceptance** — the function-boundary extractors that currently match LF
  and miss CRLF no longer fail a CRLF checkout; Linux CI remains green. Prefer
  newline-tolerant regexes and/or `.gitattributes` `eol=lf`. Do not weaken the
  invariants the regexes were protecting.
- **Non-goals** — Windows product support as a feature; changing financial
  tests' numerical meaning.
- **State** — **complete.** Source-inspection tests normalize checkout newlines
  at the test input boundary (`test-source-text.js`). LF and CRLF of the same
  logical source extract the same blocks; the old LF-only `\n}\n` boundary still
  misses CRLF; malformed source still fails. Proved by `test-line-endings.js`.
  No `.gitattributes`; product bytes and financial answers are unchanged.

### AF-PUB-01 · Stop storing derived publication totals

- **Outcome** — where Atlas already has canonical inputs and deterministic
  derivation, the published result is not maintained independently. Known
  copies: headline total debt, net-worth totals, income total, duplicated
  mortgage publication/model values.
- **Incumbent** — `data.json` `debts` / `assets` / `income` / `plan` as
  inputs; the stored totals `DERIVE` or are deleted. `EVOLVE` in place.
  **Do not redesign `data.json`.**
- **Tier** — M3 if a household-facing figure is now derived rather than
  stored. **Backlog** — `B89`.
- **Entry gate** — after `AF-LINE-01`.
- **Acceptance** — each named copy is either derived from its canonical
  parent at render/test time, or deleted because a consumer already computes
  it; a mutation of the parent moves the published total; no schema redesign.
- **Non-goals** — splitting forensic/archive material out of `data.json`; a
  generic DTO layer.
- **State** — **complete.** `Forecast.publicationTotals` derives Deep Dive
  headline total debt, annual interest and credit left, Records net-worth
  lines, the income footer, the commitments total, the lacrosse verified
  total, and the HELOC chart limit from the canonical rows. `data.json`
  `headline`, `netWorth` numeric totals, `incomeTotal`, `helocLimit`,
  `commitments.total`, `lacrosse.verified`, and the mortgage block's
  balance / rate / bi-weekly payment are deleted. Credit left moves from
  the stale stored $1,415.95 to `Forecast.utilisation`'s $1,415.98, which
  the Plan tile, upcoming note and positions.csv already published.
  Proved by `test-publication-totals.js`.

### AF-CLASS-01 · Guard overlapping spending classifications

- **Outcome** — the same household spending category cannot silently tell
  contradictory essential/discretionary stories. Genuinely distinct semantics
  (`business`, `reserve`) stay distinct.
- **Incumbent** — `plan.budget.categories[].class` for the forward cap;
  `docs/merchant-library.csv` `type` → `periods.json` for historical mix.
  `EVOLVE` with a guard, not a new classifier.
- **Tier** — M2. **Backlog** — `B90`.
- **Entry gate** — after `AF-PUB-01`.
- **Acceptance** — overlapping category labels cannot disagree on
  essential/discretionary without a failing test; `business` and `reserve`
  are named exceptions, not silently coerced.
- **Non-goals** — a unified classification ontology; recategorising history.

### Phase 1 product exit — useful before infrastructure

Before Phase 2 starts, the current authorities must add up to a household-facing
operating picture rather than merely a collection of correct components. This is
a sequencing checkpoint, not a new engine and not a licence to duplicate any
financial answer.

The existing product must be able to show, from the same authorities:

- **one 13-week story** — current cash position, expected income, obligations,
  known commitments, the lowest projected point and the major pressure dates;
- **one week-by-week operating budget** — the `Forecast.recommend` safe-to-spend
  figure, what each week has to absorb, and whether a week is below the buffer;
- **one calendar/look-ahead** — next due, Amanda income dependency where relevant,
  paydays and known large events all reconciled to the schedule authority;
- **the consequence of a known large commitment or owner-supplied planned
  purchase** — amount and date enter the existing plan/commitment path, and Atlas
  can show whether cash covers it, what has to be saved or moved, and what debt
  is created if borrowing is required; and
- **honest confidence** — historical unknowns remain included in total spending
  and are not allowed to masquerade as zero merely because their category is
  unresolved.

If the existing authorities cannot answer one of those without page-local maths
or a second planner, record the smallest missing product capability in
`BACKLOG.md` and finish it before `AF-RECON-01`. Do not solve the gap by standing
up another forecast, another calendar or another budget. Do not skip the
post-B74 cleanup (`B87`–`B90`) to start snapshots.

### AF-RECON-01 · Evidence refresh / reconciliation loop

The next major product milestone after the cleanup above. Not a new layer:
connect the extractors and canonical state that already exist.

- **Outcome** — a small, repeatable reconciliation report compares extracted
  evidence to current Atlas canonical values (value, date, difference,
  unresolved). Owner-approved changes then update canonical household state.
  First version covers a closed set, not every field in `data.json`.
- **Incumbent** — existing `scripts/` extractors, `derived/`, `data.json`,
  `public/periods.json`. `NEW` report, `CONSUME` extractors, `EVOLVE` the
  handoff into `data.json`. Does **not** replace `Forecast`, the Evidence-Use
  Register, or `01_OPEN_QUESTIONS.md`.
- **Tier** — M3. **Backlog** — `B91`.
- **Entry gate** — Phase 1 product exit plus `AF-CLASS-01` (`B90`). Cleanup
  first so the loop is not reconciling duplicate authorities.
- **Acceptance** — an unexplained drift on the closed set fails; a matching
  pair passes; the report does not write canonical state by itself; no new
  store, schema, staging platform, provenance graph, extractor architecture,
  or forecast engine.
- **Prompt** — *Connect one existing extractor to one canonical figure with a
  reconciliation report the suite can fail. Owner-approved edits still land in
  `data.json`. Do not generate `data.json`. Record what review ceremony the
  run actually needed — that is evidence for the open governance question,
  not a new gate.*

---

## Phase 2 — cadence and trend · to T2

Spending, interest and fees already have history through `public/periods.json`.
**Account balances do not.** That remains the T2 gap. **This phase no longer
starts with snapshots.** Post-B74, `AF-RECON-01` is the milestone after Phase 1;
history is a by-product of successful refresh, not the next item after the
product exit.

### AF-HIST-01 · Balance snapshots and trend

- **Outcome** — one file per reading, same shape as `data.json`, with the site
  drawing trend lines across them, so "is the HELOC actually falling" is
  answerable from the repository. Prefer producing the snapshot from a
  successful refresh rather than a separate capture ritual.
- **Incumbent** — `data.json` for current figures; `public/periods.json` for the
  spending series, which this does **not** duplicate. `NEW`, consumer named: the
  Plan and Deep Dive pages.
- **Tier** — M3. **Backlog** — `B20`.
- **Entry gate** — **`AF-RECON-01` complete**, plus T1 and the Phase 1 product
  exit. Do not start this item because an earlier revision of this file put it
  first in Phase 2.
- **Acceptance** — **each snapshot's identity and contents reconcile
  independently** against the contemporaneous `data.json`, the `positions.csv`
  row, or institution evidence — right account, right date, right balance. That is
  the acceptance that matters: a check that two files render a trend and that
  re-running adds no duplicate proves storage and rendering, not that the history
  the household reads is true. Also: a snapshot is written without hand-editing;
  re-running produces no duplicate; and the spending series stays
  `public/periods.json`'s and is not re-derived here.
- **Prompt** — *Implement `snapshots/<YYYY-MM-DD>.json` per `B20` as a by-product
  of the refresh loop. Files, not a store — `ARCHITECTURE.md` says git gives
  history, diffs and versioning free, and the store gate is closed. Do not touch
  the spending series.*

### AF-INTAKE-01 · Prove the intake path on a second month

- **Outcome** — a second month of statements goes through capture, extraction and
  publication, and what broke is recorded.
- **Incumbent** — `scripts/` and the flow in `ARCHITECTURE.md`. `CONSUME`.
- **Tier** — M2. **Backlog** — `B21`.
- **Entry gate** — `AF-RECON-01`, so the intake writes against a reconciliation
  report rather than only a snapshot file. Snapshots (`AF-HIST-01`) should come
  out of this run when they can, not block it.
- **Acceptance** — the run is reproducible from the documented steps alone; every
  manual intervention is written down, because those are the evidence T3 needs.
  New unknown or ambiguous transactions from this intake are surfaced as a
  **forward clarification queue** for the household; the run does not reopen an
  18-month forensic categorisation project merely because old unknowns exist.
- **Prompt** — *Run the documented intake for a second month through the
  reconciliation loop. Change nothing to make it work — record what needed a
  human and surface the new unknowns that need household clarification. That
  record is the input to AF-INGEST-01.*

---

## Phase 3 — an ingestion foundation · to T3

**Files, still.** This phase builds identity and idempotency on the foundation
that exists, without a provider and without a store.

### AF-INGEST-01 · Idempotent import with stable identity

- **Outcome** — importing the same statement twice changes nothing; a corrected
  record updates rather than duplicates; every imported row traces to its source.
- **Incumbent** — `scripts/` extraction and `derived/`. `EVOLVE`.
- **Tier** — M3. **Backlog** — `B78`.
- **Entry gate** — **T2**, plus AF-INTAKE-01's record of manual steps.
- **Acceptance** — demonstrated **on real household data, not fixtures**:
  re-import is a no-op, a corrected amount updates in place, and identity survives
  a re-run. This is the evidence T3 is made of.
- **Prompt** — *Make import idempotent and identity-stable on the file
  foundation. No store, no provider. The proof is a real re-import that changes
  nothing.*

### AF-STORE-01 · The store question, answered by evidence

- **Outcome** — a written answer to whether the file foundation can still give
  the invariant, identity and idempotency guarantees the work needs.
- **Incumbent** — `data.json`, generated `public/periods.json`, and git as the
  history. `CONSUME` unless the gate is met.
- **Tier** — **M4** — `ARCHITECTURE.md` says passing the gate is an owner
  decision, recorded. **Backlog** — `B79`.
- **Entry gate** — AF-INGEST-01 complete, so the answer rests on a foundation that
  was actually pushed.
- **Acceptance** — the answer cites what **failed on real data**. "Relational
  modelling would be tidier" and "a later capability assumes it" are named in
  `ARCHITECTURE.md` as things that are not reasons, and remain so.
- **Prompt** — *Report whether the file foundation demonstrably failed, with the
  evidence. Do not introduce a store. If the gate is met, the owner decides.*

---

## Phase 4 — connectivity · gated at T4

**Not scheduled.** `ARCHITECTURE.md` gates this on five conditions including
security review and an owner decision. Two items are named so the phase has a
shape, and neither may start before the gate.

### AF-LIVE-01 · Evaluate providers, point nothing live

- **Outcome** — a written evaluation of what actually serves these institutions
  in Canada, verified when the work starts, and what each provider's failure modes
  cost.
- **Tier** — M4. **Backlog** — `B80`. **Entry gate** — T3 **and** an owner decision to evaluate.
- **Acceptance** — no provider chosen, no credential obtained, no connection
  attempted. Evaluation is reading and writing.
- **Prompt** — *Evaluate current Canadian availability and provider semantics per
  `ARCHITECTURE.md`'s conditions 2 and 4. Choose nothing. Obtain no credential.*

### AF-LIVE-02 · Point something live

- **Outcome** — one read-only connection, after the full gate.
- **Tier** — M4. **Backlog** — `B81`. **Entry gate** — **all five conditions**, owner-passed.
- **Acceptance** — read-only; no institution login credential, ever, under
  `ARCHITECTURE.md`'s absolute; any provider token handled under the secret
  boundary's configured-secret rule.
- **Prompt** — *Do not start this item. It exists so the phase has an end, and it
  begins only when the owner records that the gate is passed.*

---

## Governance follow-ups — not product truth

These concern **how work is governed**, not what the household's figures are.
They are sequenced separately, do not consume a phase slot, and do not gate any
product item. They are recorded here because leaving them only in a merge card
would lose them.

- **`B76` — the scope tripwire counts implementation only.** For a
  documentation-only change it therefore offers a reviewer no numeric prompt at
  all. Carried forward from a superseded pull request under a fresh identifier,
  and narrowed since: scope is now explicitly a reviewer judgement rather than a
  card field.
- **`B77` — the connector bypasses the pre-commit hook.** Commits authored through
  the GitHub connector are made through the API, so no local hook runs on them.
  Nothing is wrong in the repository today; the gap is structural.
- **Cheaper review lane for routine refresh.** Recorded, not solved. Hard
  boundaries stay. `AF-RECON-01` / `B91` should produce evidence about whether
  a figures-only evidence update needs the same architecture review as an
  engine-authority change. Do not add a gate to get there.

`BACKLOG.md` holds what each actually says, including the evidence and the
options — this file names them so the sequence does not lose them, and does not
keep a second copy of the reasoning. Neither changes a figure, and neither should
be scheduled as though it did.

---

## What this file deliberately does not schedule

- **A database, second canonical store, generic fact schema, staging/approval
  platform, large provenance framework, second extraction architecture, or
  second forecast/recurrence engine.** Post-B74: connect what exists. None of
  those is authorised by reaching `AF-RECON-01`.
- **Anything behind a closed gate.** A canonical store and automated connectivity
  are wanted and not permitted; `ARCHITECTURE.md` holds both gates and this file
  schedules toward them without opening either.
- **A forensic cleanup of the historical ledger.** Old unknown transactions stay
  in total spending and may stay categorically unresolved unless they are large
  enough to materially change the plan. The forward ledger gets cleaner as fresh
  data arrives.
- **A standing 100% raw-source coverage campaign.** `raw/` remains the bedrock and
  must remain private and immutable, but source-coverage work is targeted when a
  material reconciliation gap appears; it is not a prerequisite to planning from
  the captured history.
- **Household questions.** `docs/01_OPEN_QUESTIONS.md` holds what only Dale or
  Amanda can answer. Several phases would move faster with answers, and none of
  them can be unblocked by an agent.
- **Owner actions.** Items marked *owner action* in `BACKLOG.md` are the owner's
  and are not sequenced here.
- **Silently reconciling one household member's stated preferences against
  another's.** Attributed interview evidence may inform a candidate scenario or a
  question, but a shared target needs the promotion/owner decision described in
  `ARCHITECTURE.md`; an agent does not decide whose statement wins.
- **Everything in `BACKLOG.md` this file has not named.** Those items stay
  eligible. This document is a sequence, not a gate on the backlog.

The named later capabilities, and the trigger that would reopen each, live in
the section that follows. That is how they stay findable without being
scheduled.

---

## Later capabilities — status and reopen trigger

This is not a second roadmap. It does not invent pull-request numbers, dates,
engines, schemas, APIs, or infrastructure. It is the memory of worthwhile
capabilities that [`ARCHITECTURE.md`](../ARCHITECTURE.md) names as destination,
that dated advisory notes preserve, or that the household has discussed, so they
cannot disappear merely because they are not in Phases 1–4.

Advisory origins are evidence, not adopted architecture. In particular
[`docs/advisory/COPILOT_ARCHITECTURE_GAME_PLAN_2026-08-13.md`](advisory/COPILOT_ARCHITECTURE_GAME_PLAN_2026-08-13.md)
is a dated design proposal and is **not** a sequence;
[`docs/advisory/EVIDENCE_ABSORPTION_RECOMMENDATION_2026-08-13.md`](advisory/EVIDENCE_ABSORPTION_RECOMMENDATION_2026-08-13.md)
explicitly declined to adopt that 13-PR copilot stack. This table does not
resurrect it.

| Status | Means |
|---|---|
| **ACTIVE** | Already sequenced in this file. The phase item is the work; do not invent a parallel programme. |
| **GATED** | `ARCHITECTURE.md` holds a capability gate. This file sequences toward it without opening it. Reopening is the owner passing that gate, not a plan line. |
| **PARKED** | Worthwhile and not forgotten. Wait for the named trigger. No date, no engine, no schema, no API. |

| Capability | Status | Home today | Reopen trigger |
|---|---|---|---|
| Evidence refresh / reconciliation | **ACTIVE** | `AF-RECON-01` / `B91`. Next major product milestone after `B87`–`B90`. | Already sequenced. Do not replace with a store, schema, or copilot absorption stack. |
| Balance history / snapshots | **ACTIVE** | Phase 2 `AF-HIST-01` / `B20`. **After** `AF-RECON-01`, as a by-product of refresh. | Already sequenced. Do not start because an older revision put it first in Phase 2. |
| Longer operating forecast horizon | **PARKED** | 91-day `windowDays`; expander already walks further (B74 / ICS to 2027-05-01). `Forecast.renewal` remains a separate question. | A concrete household question the 91-day operating picture cannot answer. Reuse `expandEvents`. Never a second recurrence or forecast engine. |
| Improved ingestion | **ACTIVE** | Phase 3 `AF-INGEST-01` / `B78`, to T3. Files still; no provider and no store. | Already sequenced. Entry is T2 plus `AF-INTAKE-01`'s record of manual steps. |
| Automated financial-data connectivity / transaction feeds | **GATED** | `ARCHITECTURE.md` connectivity gate. Phase 4 `AF-LIVE-01` / `B80` and `AF-LIVE-02` / `B81`, not scheduled until T4. | The owner passes the five-condition gate. Evaluation may start only after T3 and an owner decision to evaluate. Choose nothing and obtain no credential until then. |
| Richer payroll / bonus / pension-contribution modelling | **PARKED** | The 91-day plan consumes estimated net pay. A statutory payroll engine (`EMP-006`) is excluded. Optional pension cash is already inside that net. No bonus cash event is on the live plan. | A named consumer that current net cannot serve — a window that includes a CPP/EI reset, or an owner-supplied bonus or pension cash event, or an owner-supplied horizon that needs statutory seasonality. Do not build a payroll engine in order to absorb a net `Forecast` already consumes. |
| Retirement planning | **PARKED** | `ARCHITECTURE.md` destination names pension and investments. Live published net worth excludes pensions. There is no `Forecast` retirement function. The advisory copilot "retirement engine" is not adopted. | An owner decision to include pensions in a published window, or to earn a retirement span on the one plan. Not a second planner. |
| Goals and sinking funds | **PARKED** | `ARCHITECTURE.md` destination names sinking funds. Dated commitments already have a plan path. Interview sports/travel amounts remain proposed, not shared policy. The advisory "goals engine" is not adopted. | Owner-promoted shared targets, or a product-exit gap that the existing plan/commitment path cannot answer. Do not stand up a goals engine beside `Forecast`. |
| ChatGPT / copilot interface | **PARKED** | `ARCHITECTURE.md` already names ChatGPT as a conversational consumer, not an authority. A live copilot API is owner-reserved. The dated copilot game plan is advisory and not adopted. | The owner asks for a repository-state or generated-export interface after one-plan authorities are stable. Never a second financial answer, never the advisory copilot stack, and never a live API without an owner security decision. |

A row here does not make an unlisted `BACKLOG.md` item ineligible. Canonical
store remains **GATED** where Phase 3 already records it (`AF-STORE-01` /
`B79`): a demonstrated file-foundation failure on real data, then an owner
decision — not because a later capability would like a database.