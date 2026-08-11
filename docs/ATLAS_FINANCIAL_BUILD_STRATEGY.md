# Atlas Financial — Build Strategy

**What gets built next, and in what order.**

This file sequences work toward the destination that
[`ARCHITECTURE.md`](../ARCHITECTURE.md) approves. It owns **order**, and nothing
else:

| Owns | File |
|---|---|
| Who decides, who reviews, when to stop for a person | [`CLAUDE.md`](../CLAUDE.md) |
| Direction, architectural boundaries, and the gate on each future capability | [`ARCHITECTURE.md`](../ARCHITECTURE.md) |
| **Sequencing within what direction permits** | **this file** |
| Work and findings | [`BACKLOG.md`](../BACKLOG.md) |
| What only the household can answer | [`docs/01_OPEN_QUESTIONS.md`](01_OPEN_QUESTIONS.md) |

**Where this file and `ARCHITECTURE.md` disagree, `ARCHITECTURE.md` wins and this
file is wrong.** It may schedule only what direction already permits, and a gated
capability is scheduled *behind its gate*, never in place of it.

**Current repository state beats this plan.** A strategy item is permission to
verify current state, never permission to manufacture work.

---

## 1. The destination

Deeply understood household spending; unknown transactions burned down; Dale's
and Amanda's input reconciled; realistic budgets; a weekly safe-to-spend figure;
upcoming obligations and a financial calendar; planned purchases and trips;
deterministic horizons and scenarios; debt and cash guidance; fresh data once it
is earned; assistant-neutral conversation about all of it; recommendations a
person can actually understand; a forecast that grades itself; and an interface
that is simple and enjoyable to use.

`ARCHITECTURE.md` approves that destination. It does not approve any technology
to reach it.

### The boundary that does not move

Atlas **reads and publishes**. It never moves money, never submits a form, never
accepts an agreement, and never holds an **institution login credential** — a
bank username or password, a PIN, a security answer, a one-time or 2FA code. No
gate opens those; they are not tiers.

The application's own server-side secrets are a different thing and already
exist. A **read-only** provider token would also be a different thing, is **not
authorised today**, and could only ever live inside the secret boundary in
[`ARCHITECTURE.md`](../ARCHITECTURE.md), which is the one home for that line.

### Atlas and assistants

Atlas owns canonical facts, provenance, identity, classification, balances,
obligations, policy, budgets, safe-to-spend, deterministic forecasts, scenarios,
reconciliation and publication state.

A conversational assistant owns conversation, explanation, interpretation,
outside research, recommendation, and turning intent into a **proposed**
structured change. An assistant never becomes the ledger, the calculator, or a
mutation authority.

---

## 2. What exists now

**Verified on `main` at `8ccd0e1` before this strategy was written.** Every
future item names its incumbent from this table, and a new item that overlaps one
of these rows must say `EVOLVE`, `REPLACE`, `DERIVE` or `DELETE` — never invent a
second owner in silence.

| Concept | Live authority today | Where |
|---|---|---|
| 90-day cash projection | `Forecast.simulate` | `public/forecast.js` |
| Weekly household cap · next move | `Forecast.recommend`, `Forecast.recommendWeekly` | `public/forecast.js` |
| Coupled cash-and-debt walk | `Forecast.projectDebts` | `public/forecast.js` |
| Revolving headroom, limits, pending | `Forecast.utilisation` | `public/forecast.js` |
| Budget: owner targets vs historical actuals | `Forecast.budgetBreakdown` | `public/forecast.js` |
| Budget **classification** (essential / discretionary / reserve / unknown) and owner targets | `plan.budget` | `data.json` |
| Historical spending series | generated `public/periods.json` | `scripts/periods.js` |
| Published household figures | `data.json` | + `scripts/figures-snapshot.js` |
| 90-day calendar — month grid and agenda | `renderCalendar()` | `public/plan.js` |
| Standing facts: rates, limits, due dates | `docs/ACCOUNT_FACTS.md` | |
| Authority and reconciliation guards | `test-invariants.js`, `test-forecast.js`, `test-budget.js`, `test-debt.js`, `test-static.js` | |
| Merge-card gate and its own proof | `.github/workflows/merge-card-check.yml`, `test-mergecard.js` | |

**Amounts are not duplicated.** `data.json` records the classification and the
owner target; the historical figure is derived at render time from
`public/periods.json`. One home per figure, already.

### What this means for planning

Atlas is **not greenfield**. There is one tested deterministic engine, one weekly
cap, one budget path, one calendar, one debt walk. The work below is mostly
**evolution of those**, and an item that reads like a fresh build of something in
the table above is a defect in this file.

---

## 3. Disposition vocabulary

Every strategy item declares what it does to the incumbent:

| | |
|---|---|
| `PRESERVE` | keep as-is; the item consumes it |
| `EVOLVE` | same authority, extended semantics or inputs |
| `REPLACE` | new owner takes over; the old one is deleted in the same outcome |
| `DERIVE` | the old surface remains but is computed from the new owner |
| `DELETE` | the concept goes away |
| `NEW` | genuinely nothing owns this today |

**Current-state verdicts use the repository's vocabulary, not a second one.**
When an item is picked up, its current-state gate answers exactly one of
`STILL BROKEN` · `ALREADY FIXED` · `PARTIALLY FIXED` · `FIXED BUT UNTESTED` ·
`STALE / SUPERSEDED` · `NEEDS OWNER ANSWER`, as `CLAUDE.md` defines and
`merge-card-check` enforces. This file does not define its own.

`ALREADY FIXED` means **stop and skip the item**, and say so.

---

## 4. Identifiers

Items carry a **stable ID**. GitHub PR numbers are assigned when work begins and
are recorded then — never predicted.

That is not a style preference. The first version of this file predicted `PR #5`
for the authority contract; the real PR #5 turned out to be Amanda's household
interview evidence, which made every downstream sequencing statement false.

`AF-GOV` governance · `AF-KNOW` knowledge reconciliation · `AF-PROOF` acceptance
harness · `AF-DATA` canonical data and identity · `AF-HOUSE` household input ·
`AF-BUDGET` budget · `AF-SPEND` safe-to-spend · `AF-FORECAST` forecast and
scenarios · `AF-CAL` calendar and obligations · `AF-LIVE` live connectivity ·
`AF-ASSIST` assistant interface · `AF-OPT` optimisation.

---

## 5. Model tiers

Model choice is an **execution-cost decision**. It grants no merge or product
authority, and no model name is architectural truth.

- **ECONOMY** — mechanical, well-specified, low-ambiguity work.
- **FRONTIER** — authority moves, financial correctness, migrations, security,
  anything where being confidently wrong is expensive.

**Escalate on risk, not prestige:** an authority boundary is in play, money-domain
correctness is at stake, the current-state verdict is ambiguous, two rounds of
review have not converged, or the item touches the gated capabilities.

Exact available model names change. **The implementing surface verifies what it
is actually running at execution time** and records it in the merge card; this
file never asserts a model name as a fact.

---

## 6. The financial urgency clock

**Software sequence does not delay real-world financial action.**

A live household financial problem — a facility approaching its limit, a payment
at risk, an insurance or credit deadline — operates on the household's clock, not
this file's. It may produce an immediate owner action while software work
continues separately, and it never waits behind a strategy item.

**The canonical record of those findings is [`BACKLOG.md`](../BACKLOG.md)**, with
household questions in [`docs/01_OPEN_QUESTIONS.md`](01_OPEN_QUESTIONS.md). This
file deliberately does not restate any financial finding or quote a figure: a
copy here would be a second home for a number that already has one, and would go
stale exactly when it mattered.

At every trajectory gate, read the backlog's urgent items **first**, before any
question about sequencing.

---

## 7. Phases and acceptance

A phase is complete when the **household** can do the thing, not when the code
merges.

| Phase | Complete when |
|---|---|
| **0 — Trust and truth** | Direction has one home; the strategy is discoverable; a synthetic acceptance corpus exists and guards money-domain change; planning knowledge matches current evidence |
| **1 — Know us** | The household can see where money actually goes, unknown charges are burned down to a stated threshold, and Dale's and Amanda's input is reconciled with attribution preserved |
| **2 — Run our money** | Realistic budgets, a weekly safe-to-spend figure the household trusts, obligations and a calendar they actually use. **Product-complete v1, and the strongest re-justification gate in this file** |
| **3 — Horizon** | Deterministic scenarios and a forecast that grades its own past predictions |
| **4 — Live** | Data refreshes without manual capture — **only if the `ARCHITECTURE.md` connectivity gate has been met** |
| **5 — Assistant** | The household can ask questions conversationally against Atlas truth, with proposals never mutating anything directly |
| **6 — Optimisation** | Debt and cash guidance, opportunities, long-horizon planning |

---

## 8. Trajectory gates

At each gate, **stop implementing** and review: exact current `main`; current
authorities; `BACKLOG.md` urgent items first; open household questions; how the
household is actually using the site; completed acceptance evidence; and the
remaining strategy.

Every remaining item is then `KEEP` · `REWRITE` · `MOVE` · `MERGE` · `SPLIT` ·
`SKIP` · `DELETE` · `ADD`.

| Gate | After |
|---|---|
| **T0** | Phase 0 complete |
| **T1** | Household understanding proven (Phase 1) |
| **T2** | Product-complete v1 (Phase 2) — the strongest gate |
| **T3** | Horizon proven (Phase 3) |
| **T4** | Before any live connectivity work, and re-decide whether a store was ever needed |
| **T5** | Before assistant work |

Gates are named by ID, never by PR number.

### When to rewrite this file

A dedicated strategy-update PR is justified when a phase goal changes, more than
two items need reordering or replacing, an assumed technology stops being
appropriate, a newly discovered authority changes the shape, a gate shows the
planned next move is not the highest-value one, or the model-tier policy changes.

Small implementation discoveries go to finding dispositions and `BACKLOG.md` —
not a roadmap rewrite.

---

## 9. Household evidence from more than one person

Dale and Amanda may each provide household evidence independently. The product
requirement, ahead of any mechanism:

- **attribution and provenance are preserved** — who said it, and when;
- **one person's statement is not automatically joint household policy**;
- **reconciliation is an explicit step** that can produce a joint decision, and
  disagreement is a household question, not a merge conflict;
- **the storage mechanism is subject to its own authority review.** Wherever
  interview evidence currently lands is *current practice*, not blessed
  architecture, and `AF-HOUSE-01` decides its permanent home.

---

# The items

Each carries: stable ID · outcome · why · incumbent · disposition · model tier ·
escalation · entry gate · acceptance · prompt.

Every item's prompt inherits the standing preamble:

> Start from fresh current `main`. Record the starting SHA, confirm a clean
> worktree, run `npm test`. Read `AGENTS.md`, `CLAUDE.md`, `ARCHITECTURE.md`,
> `CONTEXT.md`, this strategy, `BACKLOG.md`, `docs/01_OPEN_QUESTIONS.md`,
> `docs/ACCOUNT_FACTS.md`, and the current code and tests for the authority you
> are about to touch. Answer the current-state gate with one of the six verdicts.
> If `ALREADY FIXED`, stop and say so. One independently provable outcome, merge
> card filled, findings dispositioned. Stop review-ready.

---

## Phase 0 — Trust and truth

### `AF-GOV-01` — Install this build strategy

**Outcome.** One coherent build direction: `ARCHITECTURE.md` owns direction and
gates, this file owns sequencing, and an implementation agent following the
documented read path cannot miss it.
**Why.** The build should not depend on chat history.
**Incumbent.** `ARCHITECTURE.md` direction · `EVOLVE` — the staged tiers become
current state plus explicit gates, in the same home.
**Tier.** FRONTIER — it moves direction authority.
**Entry gate.** None; this is the first item.
**Acceptance.** No contradiction between `CLAUDE.md`, `ARCHITECTURE.md` and this
file; the read path reaches this file; references resolve; `npm test` green.
**Status.** In progress — this PR.

---

### `AF-KNOW-01` — Reconcile planning knowledge with current evidence

**Outcome.** The planning surfaces a future agent reads as input — `CONTEXT.md`
state, `docs/01_OPEN_QUESTIONS.md`, `BACKLOG.md` identifiers — agree with what
`data.json`, `public/periods.json` and `docs/ACCOUNT_FACTS.md` now show.
**Why.** Roadmap inputs that are quietly stale produce confidently wrong work.
Three instances are verified on `main` at `8ccd0e1`:

- `CONTEXT.md` still lists **MBNA Mastercard** under *Outstanding*, while
  `data.json` carries it in `meta.coverage`, as `debts[4]`, and as an obligation
  with a minimum;
- `docs/01_OPEN_QUESTIONS.md` **Q2** still asks where the `TFR-TO C/C` transfers
  go, which later card-payment evidence appears to answer;
- `BACKLOG.md` uses the identifier **`B70` twice**, for two unrelated items — the
  HELOC limit item and a standing-transfer item.

**Incumbent.** `CONTEXT.md`, `01_OPEN_QUESTIONS.md`, `BACKLOG.md` · `EVOLVE`.
**Tier.** ECONOMY, escalating to FRONTIER if a question turns out to be
financially load-bearing rather than stale.
**Escalate if.** Resolving a question changes a published figure, or the answer
is genuinely a household fact rather than a stale note.
**Entry gate.** `AF-GOV-01` merged.
**Acceptance.** Each of the three is verified against current evidence and either
corrected or explicitly kept with the reason; no duplicate backlog identifier
remains; no published figure moves.
**Prompt.**

```text
Implement AF-KNOW-01: reconcile stale planning knowledge with current evidence.

Verify each item against current repository state BEFORE changing it — the three
below are observations from 8ccd0e1, not established conclusions:

1. CONTEXT.md lists MBNA as Outstanding; check data.json coverage/debts/obligations.
2. 01_OPEN_QUESTIONS.md Q2 (TFR-TO C/C); check whether later card-payment evidence
   resolves it. If it does, close it with the evidence. If it does not, say so and
   leave it open.
3. BACKLOG.md has two items numbered B70. Renumber ONE of them, keeping the
   identifier of whichever is referenced elsewhere, and check for inbound references.

NON-GOALS: no engine change, no published figure moves, no backlog re-prioritisation,
no rewriting questions that are genuinely still open.

PROOF: figures review reports no moved figures; npm test green; every claim you
changed cites the evidence that changed it.
```

---

### `AF-PROOF-01` — Golden Household acceptance corpus

**Outcome.** One synthetic household — accounts, balances, limits, a transaction
history, obligations — with its expected deterministic truths recorded, wired
into `npm test`, so any future money-domain change is regression-tested against
answers that were fixed in advance.

**Why, and why here.** Every later money-domain item is required to preserve
Golden Household truth. **That is impossible unless the corpus exists first**, so
it is built before the first item that must satisfy it, not alongside one.

**This is the ordering rule.** Items in Phase 1 and later that change money-domain
behaviour name `AF-PROOF-01` as an entry gate. **Governance and documentation
work is exempt** — `AF-GOV-01` and `AF-KNOW-01` change no financial behaviour, so
they neither need nor can wait for the corpus.

**Incumbent.** The five existing suites · `PRESERVE` and extend. The corpus is a
new fixture consumed by existing test infrastructure, **not** a second test
system.
**Tier.** FRONTIER — the expected truths are the thing everything later is
measured against, and a wrong one is a false green forever.
**Escalate if.** The corpus would need to encode a real household figure. It must
be synthetic; no real balance, limit or identifier belongs in it.
**Entry gate.** `AF-GOV-01`.
**Acceptance.** A synthetic household runs through the existing engine; expected
truths are asserted independently of the code that computes them; the suite fails
if an engine answer moves; no real household data is in the fixture.
**Prompt.**

```text
Implement AF-PROOF-01: the Golden Household acceptance corpus.

Build ONE synthetic household fixture and its expected deterministic truths, and
wire it into npm test alongside the existing suites.

The expected truths must be derived INDEPENDENTLY of public/forecast.js — hand-
computed or brute-forced by a second method. A fixture whose expectations come
from running the engine proves consistency, not correctness, and CLAUDE.md
forbids exactly that for anything financial.

Cover at minimum: cash projection over the window, the weekly cap, the coupled
cash/debt identity, revolving headroom with pending, and the budget split.

NON-GOALS: no change to public/forecast.js behaviour; no real household figures;
no second test runner.

PROOF: the new suite fails when an engine answer is perturbed — demonstrate one
mutation and show the case that catches it.
```

---

## Phase 1 — Know us

### `AF-HOUSE-01` — Household evidence, attribution and reconciliation

**Outcome.** Dale's and Amanda's separately-given evidence has one recorded home,
with attribution preserved, and a defined step that turns two individual
statements into one household decision or one household question.
**Why.** Interview evidence already exists in the repository from more than one
person; without an attribution rule, one person's answer silently becomes policy.
**Incumbent.** Owner targets in `data.json plan.budget`; existing interview
material · `EVOLVE`. **Whatever path interview evidence currently sits in is
current practice, not blessed architecture** — this item decides the permanent
home.
**Tier.** FRONTIER — provenance and whose-statement-counts is an authority rule.
**Escalate if.** Reconciliation would overwrite an owner-stated target.
**Entry gate.** `AF-PROOF-01` if it changes any derived figure; otherwise
`AF-KNOW-01`.
**Acceptance.** Every household statement carries who and when; no single
person's statement becomes joint policy without a recorded reconciliation;
disagreements land in `01_OPEN_QUESTIONS.md`.

---

### `AF-DATA-01` — Transaction identity and the unknown-charge burn-down

**Outcome.** Every transaction the analysis relies on has stable identity, and
the population of unclassified or unexplained charges is measured and driven down
to a stated threshold.
**Why.** "Deeply understand household spending" is unachievable while a
meaningful share of transactions is unattributed. This is the item that makes
Phase 1 real.
**Incumbent.** `scripts/periods.js` → `public/periods.json`; the classification
in `data.json plan.budget`; `data.json unexplained` · `EVOLVE`.
**Tier.** FRONTIER.
**Escalate if.** Identity work starts to need guarantees the file-based
foundation cannot give — that is the `ARCHITECTURE.md` **store gate**, and it is
an owner decision, not a convenience. Record the evidence and stop.
**Entry gate.** `AF-PROOF-01`.
**Acceptance.** Unknown-charge share is stated before and after; no transaction
is counted twice; transfers between household accounts are not consumption; the
Golden Household truths still hold.

---

### `AF-DATA-02` — Transfer and double-count truth

**Outcome.** Money moving between household accounts, card payments and HELOC
movements never appear as household consumption.
**Why.** It is the most common way a spending picture becomes quietly wrong.
**Incumbent.** `Forecast.projectDebts`, the cash/debt identity in `test-debt.js`
· `EVOLVE` — extend the identity to the historical series, do not build a second
walk.
**Tier.** FRONTIER.
**Entry gate.** `AF-PROOF-01`, `AF-DATA-01`.
**Acceptance.** An independent reconciliation shows each dollar counted once
across cash, card and HELOC movement.

---

## Phase 2 — Run our money *(product-complete v1)*

### `AF-BUDGET-01` — Evidence-based budget targets

**Outcome.** Budget targets are reconciled against what the household actually
spends, with provenance for every target, and the gap between target and actual
stated rather than smoothed.
**Incumbent.** `Forecast.budgetBreakdown` + the nine owner targets and their
classification in `data.json plan.budget`, proven by `test-budget.js` ·
**`EVOLVE`. Do not build a second budget authority.**
**Tier.** FRONTIER.
**Entry gate.** `AF-PROOF-01`, `AF-HOUSE-01`.
**Acceptance.** Every target names its source and date; target-vs-history
provenance still passes; no category is double-counted against a dated
commitment.

---

### `AF-SPEND-01` — Resolve safe-to-spend against the incumbent weekly cap

**Outcome.** A decision, made before any implementation: is "safe-to-spend" the
**evolved name and semantics of `Forecast.recommend`**, or is it genuinely a
distinct concept?

**This item's first deliverable is that answer, in writing.**

- If **evolved** → `EVOLVE` `Forecast.recommend` / `recommendWeekly`. One
  authority, better semantics, same home.
- If **distinct** → the item must state precisely what question each one answers,
  why the household needs both, and how a reader knows which to act on.

**Two live weekly numbers is the failure mode**, and this repository has already
shipped it once — a page showing `$1,650/wk` in one tile and `$0/wk` below,
because two pieces of code answered the same question.
**Incumbent.** `Forecast.recommend`, `Forecast.recommendWeekly`.
**Tier.** FRONTIER.
**Entry gate.** `AF-PROOF-01`, `AF-BUDGET-01`.
**Acceptance.** Exactly one weekly household figure is published; if a second
concept exists it has a different name, a different question, and a test proving
they cannot be confused.
**Prompt.**

```text
Implement AF-SPEND-01: resolve safe-to-spend against the incumbent weekly cap.

FIRST, before any code: read public/forecast.js recommend()/recommendWeekly(),
public/plan.js where the weekly cap is published, and test-forecast.js. Then state
in the merge card whether safe-to-spend is (A) the evolved semantics of the existing
weekly-cap authority, or (B) a genuinely distinct concept — with the reasoning.

If (A): evolve the existing authority. Do not add a parallel one.
If (B): you must justify two published weekly numbers and prove a reader cannot
confuse them. Default to (A); (B) needs the stronger argument.

NON-GOALS: no second forecast engine; no second weekly figure without (B) proven.

PROOF: an invariant test asserting exactly one published weekly household figure.
```

---

### `AF-CAL-01` — Obligations and calendar usability

**Outcome.** The household can see what is due, when, and what it has to land by
— in a form they actually use.
**Incumbent.** `renderCalendar()` in `public/plan.js`, month grid plus mobile
agenda, derived from the same `sim` as everything else; `data.json upcoming` and
`commitments`; `scripts/calendar-ics.js` · **`EVOLVE` — usability, hierarchy and
interaction. Do not compute dates a second time.**
**Tier.** ECONOMY, escalating if it changes what a date means.
**Entry gate.** `AF-PROOF-01`.
**Acceptance.** The calendar still derives from one projection; no date or amount
is computed in the view.

---

### `AF-SPEND-02` — Safe-to-spend shadow graduation

**Outcome.** Before any changed weekly figure is published, it runs in shadow
against the incumbent for a stated period, and graduates only on recorded
agreement or an explained divergence.
**Why.** A weekly number the household acts on should not change silently.
**Incumbent.** whatever `AF-SPEND-01` decides · `PRESERVE` during shadow.
**Tier.** FRONTIER.
**Entry gate.** `AF-SPEND-01`.
**Acceptance.** Shadow and published figures are both recorded; graduation is an
owner-visible step.

---

## Phase 3 — Horizon

### `AF-FORECAST-01` — Scenarios on the existing engine

**Outcome.** The household can ask "what if" — a changed income, a large
purchase, a different payment — and get a deterministic answer.
**Incumbent.** `Forecast.simulate` and the existing scenario controls on the Plan
page · **`EVOLVE`. There is one forecast engine and it stays one.**
**Tier.** FRONTIER.
**Entry gate.** `AF-PROOF-01`.
**Acceptance.** Scenarios run through the same simulate path; the Golden
Household truths hold for the base case.

---

### `AF-FORECAST-02` — Forecast self-grading

**Outcome.** Atlas records what it predicted and later scores itself against what
happened, so confidence is earned rather than asserted.
**Incumbent.** none for grading · `NEW`, consuming `Forecast.simulate`.
**Tier.** FRONTIER.
**Entry gate.** `AF-FORECAST-01`, and enough elapsed history to grade.
**Acceptance.** A recorded prediction, a recorded outcome, and a stated error —
with no retroactive editing of what was predicted.

---

## Phase 4 — Live *(gated — not authorised)*

**Everything in this phase sits behind the `ARCHITECTURE.md` connectivity gate:
proven need, current Canadian availability, security review, provider semantics,
and a working canonical ingestion foundation. All five, plus an owner decision.**

Reaching this line in the file authorises nothing. If the gate is not met, the
correct action is to record the evidence and stop.

### `AF-LIVE-01` — Provider-neutral ingestion foundation

**Outcome.** Import is idempotent and provider-shaped data is normalised at the
edge, so no provider's semantics leak into Atlas truth.
**Incumbent.** `scripts/periods.js` and the capture scripts · `EVOLVE`.
**Tier.** FRONTIER. **Entry gate.** T4, and the connectivity gate.
**Acceptance.** The same file imported twice changes nothing.

### `AF-LIVE-02` — First automated connector

**Outcome.** One institution's data arrives without manual export.
**Incumbent.** The manual capture scripts and their routes in
`docs/ACCOUNT_FACTS.md` · **`PRESERVE`** — the connector is an additional source,
and the manual path stays working as the fallback. It is `NEW` only in that
nothing automates capture today.
**Tier.** FRONTIER. **Entry gate.** `AF-LIVE-01` and the full connectivity gate,
including a current availability check — **provider choice is not made in this
file and must be verified when the work starts, not assumed from it.**
**Acceptance.** Read-only. No institution login credential is ever held. Any
provider token stays inside the `ARCHITECTURE.md` secret boundary — server-side,
in the platform's secret mechanism, never in git, never in the browser, never in
a log — and exists at all only if the owner has approved it. A manual path still
works if the connector fails.

### `AF-LIVE-03` — Scheduled refresh and resilience

**Outcome.** Data refreshes on a schedule without a person starting it.
**Incumbent.** none — nothing schedules anything today · `NEW`, consuming
`AF-LIVE-02`.
**Tier.** FRONTIER — a partial picture published as complete is the failure mode
this repository exists to prevent.
**Entry gate.** `AF-LIVE-02` proven over a stated period.
**Acceptance.** A failed sync degrades to the last good state and says so; it
never publishes a partial picture as complete.

---

## Phase 5 — Assistant

### `AF-ASSIST-01` — Assistant-neutral read interface

**Outcome.** Any assistant can ask Atlas for truth through one documented surface
that returns facts and their provenance.
**Incumbent.** `data.json` as the published surface · `EVOLVE`.
**Tier.** FRONTIER — it is a trust boundary. **Entry gate.** T5.
**Acceptance.** Read-only; provenance travels with every figure.

### `AF-ASSIST-02` — Proposed-change interface

**Outcome.** An assistant can propose a structured change; a person approves it;
Atlas applies it.
**Incumbent.** none — every change today is a commit by the active agent ·
`NEW`. It does not replace that path; a proposal becomes an ordinary change
subject to the same review.
**Tier.** FRONTIER. **Entry gate.** `AF-ASSIST-01`.
**Acceptance.** No proposal path mutates anything without recorded approval.

---

## Phase 6 — Optimisation

### `AF-OPT-01` — Debt and cash guidance

**Incumbent.** `data.json plan.nextDollar` and the funding options, already
derived and already tested · **`EVOLVE`.**
**Tier.** FRONTIER. **Entry gate.** T2 passed, `AF-PROOF-01`.

### `AF-OPT-02` — Daily briefing and opportunities

**Incumbent.** the Plan page's Today and Next Move · `EVOLVE`.
**Tier.** ECONOMY. **Entry gate.** `AF-OPT-01`.

### `AF-OPT-03` — Long-horizon household planning

**Outcome.** The household can reason past the 90-day window — the mortgage
renewal, the debt path, the years rather than the quarter.
**Incumbent.** `Forecast.simulate` over `plan.windowDays`, and the HELOC/mortgage
modellers in `public/modellers.js` · **`EVOLVE`** — a longer horizon is a longer
run of one engine, not a second one.
**Tier.** FRONTIER. **Entry gate.** T2, `AF-FORECAST-02` — long horizons without
self-grading are guesses with a chart.

---

## Immediate order

1. `AF-GOV-01` — this PR;
2. `AF-KNOW-01`;
3. `AF-PROOF-01`;
4. **STOP — gate T0**, then continue only from exact current state.

**Current state wins over this list.** Anything below T0 is a plan, not a
commitment, and the gate exists to change it.
