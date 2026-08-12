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
- **State** — all five recorded decisions have moved, and the scan for the ones
  the list never named ran on 2026-08-12. It is no longer the last thing standing
  between `B73` and closed: it read every browser file and found **eight further
  page-side authorities**, seven of them in `public/plan.js`, each recorded in
  `B73` with the mutation evidence that the node suite cannot reach it. Seven
  came from the scan and the eighth from the blocking review that read it, which
  is recorded in `B73` rather than smoothed over. This item
  is therefore not complete, and it keeps its own rule — one decision per pull
  request, reconciled against a hand-computed case. `B73` states the order.

  **The first two of the eight have moved, together.** The status band went
  first, as this item said it should; the funding-source cards went with it
  rather than after it, because both interpreted the same `gap` and the same
  funding result and splitting them would have left the page judging coverage
  beside an engine that had just taken the verdict — two live answers to one
  question, which is the defect this item exists to end. That is the atomicity
  exception `CLAUDE.md` names, not a widened outcome: one authority boundary,
  one closure condition. `Forecast.planStatus` owns the verdict and the two
  dates inside it; `Forecast.recommend`'s funding result owns the per-source
  coverage. The band's source-order regex in `test-invariants.js` is retired in
  the same pull request, replaced by engine mutation tests rather than kept
  beside them.

  **The third has moved on its own.** The weekly↔monthly conversion and the
  discretionary-room verdict are `Forecast.budgetBreakdown`'s, in a `cap` block
  measured against the weekly figure the page is actually showing.
  `WEEKS_PER_MONTH` is the engine's and is deliberately not exported, so the
  suites re-derive it from the calendar rather than importing the answer. The
  move found a **third** copy of that constant — `scripts/figures-snapshot.js`,
  the file that proves published figures did not move — and retired it along
  with the page's.

  **Five remain**, and one decision per pull request still holds for them.
  AF-CAL-01's entry gate names this item, so that work is not open yet either.

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
- **Prompt** — *Decide whether the exported `.ics` derives from
  `Forecast.expandEvents` or stays independent, and prove the answer. Note it
  covers statement closes and renewal reminders the projection does not model.*

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
`BACKLOG.md` and finish it before AF-HIST-01. Do not solve the gap by standing up
another forecast, another calendar or another budget.

---

## Phase 2 — cadence and trend · to T2

Spending, interest and fees already have history through `public/periods.json`.
**Account balances do not.** That is the gap, and it is what `ARCHITECTURE.md`
Tier 2 describes. This phase begins only after the Phase 1 product exit above is
true, so infrastructure cannot outrun the operating picture the household needs.

### AF-HIST-01 · Balance snapshots and trend

- **Outcome** — one file per reading, same shape as `data.json`, with the site
  drawing trend lines across them, so "is the HELOC actually falling" is
  answerable from the repository.
- **Incumbent** — `data.json` for current figures; `public/periods.json` for the
  spending series, which this does **not** duplicate. `NEW`, consumer named: the
  Plan and Deep Dive pages.
- **Tier** — M3. **Backlog** — `B20`.
- **Entry gate** — **T1 plus the Phase 1 product exit above**.
- **Acceptance** — **each snapshot's identity and contents reconcile
  independently** against the contemporaneous `data.json`, the `positions.csv`
  row, or institution evidence — right account, right date, right balance. That is
  the acceptance that matters: a check that two files render a trend and that
  re-running adds no duplicate proves storage and rendering, not that the history
  the household reads is true. Also: a snapshot is written without hand-editing;
  re-running produces no duplicate; and the spending series stays
  `public/periods.json`'s and is not re-derived here.
- **Prompt** — *Implement `snapshots/<YYYY-MM-DD>.json` per `B20`. Files, not a
  store — `ARCHITECTURE.md` says git gives history, diffs and versioning free, and
  the store gate is closed. Do not touch the spending series.*

### AF-INTAKE-01 · Prove the intake path on a second month

- **Outcome** — a second month of statements goes through capture, extraction and
  publication, and what broke is recorded.
- **Incumbent** — `scripts/` and the flow in `ARCHITECTURE.md`. `CONSUME`.
- **Tier** — M2. **Backlog** — `B21`.
- **Entry gate** — AF-HIST-01, so a snapshot exists to compare against.
- **Acceptance** — the run is reproducible from the documented steps alone; every
  manual intervention is written down, because those are the evidence T3 needs.
  New unknown or ambiguous transactions from this intake are surfaced as a
  **forward clarification queue** for the household; the run does not reopen an
  18-month forensic categorisation project merely because old unknowns exist.
- **Prompt** — *Run the documented intake for a second month. Change nothing to
  make it work — record what needed a human and surface the new unknowns that need
  household clarification. That record is the input to AF-INGEST-01.*

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

`BACKLOG.md` holds what each actually says, including the evidence and the
options — this file names them so the sequence does not lose them, and does not
keep a second copy of the reasoning. Neither changes a figure, and neither should
be scheduled as though it did.

---

## What this file deliberately does not schedule

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