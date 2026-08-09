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

| Layer | Directory | Committed? | Rebuildable? |
|---|---|---|---|
| Source | `raw/` | **Never** | No — irreplaceable if lost |
| Extraction | `scripts/` | Yes | — |
| Intermediate | `derived/` | **Never** | Yes, by re-running scripts |
| Knowledge | `docs/` | Yes | No — human judgement |
| Publication | `data.json`, `public/` | Yes | Partly |

`raw/` is the only irreplaceable directory. **Back it up separately.** Everything
else can be rebuilt from it, or is in git.

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

**Read-only against institutions. Never handle credentials.** No transfers,
payments, applications, setting changes, form submissions or agreement
acceptances. Passwords, PINs, security codes and 2FA are the owner's alone.

---

## Direction

Deliberately staged. **Nothing below tier 1 is decided.**

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

### Tier 3 — an interaction layer *(undecided, and gated)*

If the site should ever be something the household **writes to** — ticking off
questions, logging a payment, leaving notes — that is the point at which a
database earns its place, and Render Postgres would be the choice.

**That trigger has not been reached.** Until the site needs to accept input,
files are the right tool and a database would only add failure modes.

### Explicitly not planned

Connecting directly to bank APIs or aggregators; storing credentials of any
kind; automating any action against an account. This system reads what the
owner gives it and publishes a private view. That boundary is the design.
