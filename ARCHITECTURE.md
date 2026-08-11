# Architecture

How this project is put together, where new material goes, and where it is
heading. `CONTEXT.md` orients a session; this explains the design.

---

## The shape: five layers, one direction

```
  raw/          SOURCE        statements, exports          immutable · local only
    ↓
  scripts/      EXTRACTION    decrypt, parse, normalise    deterministic · committed
    ↓
  derived/      INTERMEDIATE  parsed output, aggregates    disposable · local only
    ↓
  docs/         KNOWLEDGE     analysis, facts, questions   durable · committed
    ↓
  data.json     PUBLICATION   the figures the site shows   committed → deployed
```

Material only ever flows **down**. Nothing edits `raw/`. Nothing hand-writes
`derived/`. A figure that reaches `data.json` can always be traced back up to a
statement.

### Inside publication: source facts to a decision

`data.json` is not the last step. Within the published layer there is a second
one-way flow, and it exists because the alternative — every page working out its
own answer — produced a homepage that showed `$1,650/week` in one tile and `$0`
in the block underneath it.

```
  data.json              SOURCE FACTS      balances, rates, dated obligations
  public/periods.json    SPENDING HISTORY  generated; the only home for actuals
    ↓
  forecast.js  simulate()          cash, day by day
               projectDebts()      the same events, seen from the debt side
               budgetBreakdown()   essential vs discretionary vs already dated
               recommend()         THE weekly household cap
    ↓
  plan.js / deepdive.js / records.js / modellers.js   render only
```

**The engine decides; the pages render.** `forecast.js` is pure and DOM-free, so
`npm test` exercises exactly what the browser runs. A page that computes a
financial answer for itself is a bug — that is how the same question came to
have two answers.

Three rules follow from this, and the test suite enforces all three:

- **One fact, one home.** Historical spending lives in `periods.json` and is
  *derived* into the budget, never copied into `data.json`. `data.json` carries
  the classification and any owner override, not the amounts.
- **Every dated item declares where it would otherwise sit.** A bill or
  commitment names its `budgetCategory`, and that amount is subtracted from the
  category's average. Without it, Shaw is paid twice — once on the calendar and
  once inside a telecom average that already contains it.
- **Every obligation names the debt it moves.** `debtId` plus `effect`
  (`payment` or `capitalise`). Cash leaving the chequing account has to arrive
  somewhere, and the suite reconciles the two sides to the cent.

| Layer | Directory | Committed? | Rebuildable? |
|---|---|---|---|
| Source | `raw/` | **Never** | No — irreplaceable if lost |
| Extraction | `scripts/` | Yes | — |
| Intermediate | `derived/` | **Never** | Yes, by re-running scripts |
| Knowledge | `docs/` | Yes | No — human judgement |
| Publication | `data.json`, `public/` | Yes | Partly |

`raw/` is the only irreplaceable directory, so it is backed up separately —
`scripts/backup-raw.ps1` mirrors it into OneDrive, outside git entirely. Run it
after every capture session. Everything else can be rebuilt from it, or is in
git.

---

## The flow, end to end

A statement arrives → it becomes a live figure:

1. **Drop it in `raw/`.** Never edit it. Never rename it beyond a clear
   convention: `raw/statements-<institution>/<YYYY-MM-DD>-<account>.pdf`
2. **Extract.** Use an existing script if one fits; write one in `scripts/` if
   not. Statements are encrypted — see `docs/ACCOUNT_FACTS.md` for which scheme
   each issuer uses.
3. **Write intermediate output to `derived/`.** Never to `docs/`.
4. **Update knowledge** — `docs/ACCOUNT_FACTS.md` for new standing facts,
   `docs/positions.csv` for the account row, `docs/01_OPEN_QUESTIONS.md` for
   anything raised or answered.
5. **Update `data.json`** with figures that belong on the site.
6. **Commit and push.** Render deploys within a couple of minutes.

The pre-commit hook refuses steps 1 and 3 from reaching git, whatever else
goes wrong.

---

## Where things go

**One fact, one home.** The most common failure mode in a project like this is
the same number living in three files and drifting.

| Kind of thing | Home | Not |
|---|---|---|
| Rates, limits, due dates, renewal dates | `docs/ACCOUNT_FACTS.md` | anywhere else |
| Balances, available credit | `docs/positions.csv` and `data.json` | `ACCOUNT_FACTS.md` |
| **Work still to do** | **`BACKLOG.md`** | a chat message |
| **Things only a human can answer** | **`docs/01_OPEN_QUESTIONS.md`** | `BACKLOG.md` |
| Narrative analysis | `docs/00_MASTER_PICTURE.md` | `data.json` |
| Per-account depth | `docs/*_DEEP_DIVE.md` | the master picture |
| What the site displays | `data.json` | hardcoded in `public/` |

**Backlog versus questions.** A backlog item needs someone to *do* something and
can be closed by doing it. A question needs someone to *know* something and can
only be closed by an answer. Mixing them produces a list where nothing is
actionable because everything looks blocked.

**Facts and figures are kept apart deliberately.** A rate is stable; a balance is
not. Mixing them lets a stale balance masquerade as a standing fact.

### Adding a new account

1. Row in `docs/positions.csv` — set `entity` to Household or Business
2. Section in `docs/ACCOUNT_FACTS.md` with a **verified** date
3. Entry in `data.json` under `debts`, plus `utilisation` if revolving
4. Update `headline`, `netWorth` and `coverage` in `data.json` to match
5. Any new questions into `docs/01_OPEN_QUESTIONS.md`

---

## Principles

These have governed the work so far and should continue to.

**Tag every figure.** Verified from the institution / calculated / estimated /
unknown. An estimate is never presented as a verified fact. This is what makes
the analysis trustworthy rather than merely confident.

**Verify rather than assume.** Where a model can be checked against the
institution's own numbers, check it. The mortgage amortisation model was trusted
only because it reproduced TD's stated remaining term to within a month.

**Cross-check across sources.** PayPal's spending total was wrong until it was
checked against the bank-funding pulls. Two independent paths to the same number
is the cheapest error detection available.

**Corrections are folded in, not appended.** When something is found to be
wrong, the document is rewritten to be right, with a short note of what changed.
Readers should see the current position, not a history of the reasoning.

**State coverage honestly.** Say what was captured, what was not, and what could
not be categorised. `docs/00_MASTER_PICTURE.md` carries a coverage section for
exactly this reason.

**Read-only against institutions. Never handle an institution login credential.**
No transfers, payments, applications, setting changes, form submissions or
agreement acceptances. Passwords, PINs, security codes and 2FA are the owner's
alone. *(The application's own server-side secrets are a different thing — see
**The secret boundary** below, which is the one home for that line.)*

---

## Direction

**This file is the one home for direction.** It owns what Atlas is for, what is
in bounds, which authority owns which concept, and the gate each future
capability has to pass. Where any other document disagrees with this one about
direction, this file wins and the other is wrong.

*Sequencing* — the order work is done in, and the prompt for each piece — is a
different question and does not live here. When a build strategy exists at
`docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md` it will own that, and it may schedule
only what this file already permits. It does not exist yet, and nothing here
depends on it.

### The destination — owner-approved

Atlas is being built toward a **household financial operating system**: deeply
understood spending, unknown transactions burned down, Dale's and Amanda's input
reconciled, realistic budgets, a weekly safe-to-spend figure, upcoming
obligations and a financial calendar, planned purchases, deterministic horizons
and scenarios, debt and cash guidance, fresh data when it is earned, and an
assistant-neutral way to ask about all of it.

That destination is approved. **None of it authorises a technology.** Each gated
capability below still has to pass its own gate, and a gate is passed by
evidence and an owner decision — never by a plan reaching that line.

The tiers below describe **where the work stands**, not a ceiling.

### Tier 1 — complete the picture *(in progress)*

The analysis is only as good as its coverage, and four gaps currently limit it:

- **MBNA Mastercard** and **Affirm/Flexiti** — the last debts with unknown terms
- **The business** — roughly 29% of household income, with invisible costs
- **A home valuation** — without it, net worth is unstateable and the May 2027
  renewal cannot be modelled properly

### Tier 2 — cadence and trend *(the obvious next step)*

Today the site shows a **single point in time**. The questions that matter over
the next year are trend questions: is the HELOC actually falling, is Triangle
moving, did the changes stick.

The intended mechanism is `snapshots/<YYYY-MM-DD>.json` — one file per reading,
same shape as `data.json`, with the site drawing trend lines across them. This
needs no database: files in git give history, diffs and versioning for free.

### Tier 3 — an interaction layer *(gated, not yet earned)*

If the site should ever be something the household **writes to** — ticking off
questions, logging a payment, leaving notes — that is one of the two things that
can earn a store. **That trigger has not been reached.**

---

## Authority — what owns what

**Every concept has one owner.** A new piece of work either consumes an existing
owner or explicitly replaces it; it never quietly becomes a second one.

| Concept | Owner today |
|---|---|
| Direction, boundaries, capability gates, the secret boundary | **this file** |
| Who decides, who reviews, what a pull request carries | [`CLAUDE.md`](CLAUDE.md) |
| Work and findings | [`BACKLOG.md`](BACKLOG.md) |
| What only the household can answer | [`docs/01_OPEN_QUESTIONS.md`](docs/01_OPEN_QUESTIONS.md) |
| Standing facts — rates, limits, due dates | [`docs/ACCOUNT_FACTS.md`](docs/ACCOUNT_FACTS.md) |
| Sequencing of planned capability work | a build strategy, **once one exists** |

### Atlas is not greenfield

The financial authorities below are **incumbent**. Later work evolves, derives
from, replaces or deletes one of them — and says which. It does not stand up a
second engine, a second weekly figure, a second budget or a second calendar
beside them. This repository has already shipped that failure once, publishing
`$1,650/wk` in one tile and `$0/wk` below, because two pieces of code answered
the same question.

| Concept | Incumbent authority |
|---|---|
| Cash projection over the window | `Forecast.simulate` |
| Weekly household cap, next move | `Forecast.recommend`, `Forecast.recommendWeekly` |
| Coupled cash-and-debt walk | `Forecast.projectDebts` |
| Revolving headroom, limits, pending | `Forecast.utilisation` |
| Budget — owner targets against actuals | `Forecast.budgetBreakdown`, with classification and targets in `data.json` `plan.budget` |
| Historical spending series | generated `public/periods.json`, from `scripts/periods.js` |
| Published figures | `data.json` |
| Calendar — month grid and agenda | `renderCalendar()` in `public/plan.js`, from the same projection |
| Authority and reconciliation guards | the `npm test` suites |

---

## The gated capabilities

Each is **wanted** and **not yet permitted**. The gate is the whole rule: until
it is met, the capability is not started, and a plan that schedules it earlier is
wrong rather than persuasive. **Passing a gate is an owner decision, recorded** —
never an agent's judgement that the moment has come.

### A canonical transaction and history store

**Gate.** A store may be introduced when the current batch-derived foundation —
`data.json`, generated `public/periods.json`, and git as the history — can no
longer provide the **invariant, identity or idempotency** guarantees the work
needs, and that failure is **demonstrated on real household data rather than
predicted**.

**Candidate if the gate is met.** SQLite, as the smallest thing giving identity,
foreign keys, uniqueness and idempotent import without an operated service. It is
**not mandatory and not pre-authorised** — it is the current preferred minimal
answer *if* a store is earned at all. Postgres needs its own evidence.

**Not a reason to open it:** that a plan says so, that relational modelling would
be tidier, or that a later capability assumes it. Until the gate is met, **files
remain the right tool** — they give history, diffs and versioning for free, and a
store would only add failure modes.

### Automated financial-data connectivity

Reading account data automatically, rather than from files the owner exports, is
an **owner-approved desired capability**. It is gated on all five of:

1. **proven need** — the manual capture path is demonstrably the binding limit;
2. **current Canadian availability** — a provider that actually serves these
   institutions, verified when the work starts, not assumed;
3. **security review** — owner-reserved, and unchanged by anything here;
4. **provider semantics** — how it identifies accounts, transactions, pending
   state and corrections, and what its failure modes cost;
5. **a working canonical ingestion foundation** — idempotent import and identity
   proven **before anything live is pointed at it**.

Condition 5 is about pointing something live, not about building the foundation:
the foundation may be built first, without a provider, and doing so satisfies one
condition rather than opening the gate.

---

## The secret boundary

The line is between a secret that lets something **log in as the household** and
a secret that lets a server **read data it has been granted**. "No credentials"
is the wrong rule and was never true here — the server refuses to start without
`SITE_PASSWORD` and `SESSION_SECRET`.

### Absolute — no gate, not a tier

- a bank or institution **username or password**;
- a **PIN**, a security answer, or a one-time / 2FA code;
- any credential intended for **direct interactive login** to an institution;
- any **automated action against an account** — a transfer, a bill payment, an
  application, a setting change, a form submission, an agreement acceptance or
  an approval.

Atlas reads and publishes. Nothing below opens this list.

**Fail closed on ambiguity.** If a credential could authenticate Atlas *as the
household* through an institution's ordinary consumer-login path, treat it as
prohibited and **stop** — do not weigh it, do not proceed on the reading that
permits it. An enumeration fails open on the category nobody thought of; this
rule does not, and it is deliberately the catch-all rather than the list above.

### Gated — may be permitted later, not permitted now

Provider or API **service credentials**, and OAuth access or refresh tokens, for
**read-only** data access. Permitted only after the connectivity gate is met
**and** the owner approves — and never for anything on the absolute list.

### Where a secret may live — the canonical rule

**This is the one home for this rule.** Other documents defer to it and must not
restate a narrower or wider version.

A secret Atlas legitimately holds lives in exactly one of:

- **production** — the deployment platform's environment secrets, which is Render
  today; the platform's mechanism matters, not the provider's name;
- **local development** — an environment variable in the developer's own shell,
  which is how `SITE_PASSWORD` and `SESSION_SECRET` are supplied when running
  locally, exactly as `README.md` documents;
- **an encrypted server-side store**, if — and only if — a future approved
  provider needs a secret **persisted and rotated** rather than set once, which
  an environment variable cannot do. This exists so OAuth refresh rotation would
  not require inventing a second rule later. Not authorised today.

And **never**, in any context: in source control, in `data.json`, in a pull
request, client-side in any form the browser can read, or in a log.
