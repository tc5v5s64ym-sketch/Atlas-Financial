# Context for a new session

**Start at [`AGENTS.md`](AGENTS.md).** It is the universal router and owns the
read order; this file is one entry in it.

Everything below is context and current state — the layout, what has been
captured, how the site is changed, and the standing rules for working on it.
It routes nothing and states no reading order of its own. A second order lived
here until 2026-08-12 and had already drifted: it omitted two documents the
router lists and still announced the build strategy as something that did not
exist yet, months after it did.

**Current product posture (2026-08-17).** Lunch Money is the household's
**normal operational financial update feed** (owner decision 2026-08-17).
Forecast remains the sole deterministic planning and calculation authority.
Lunch Money is evidence, not the planner and not canonical household policy.
Live read-only observation already exists and has been exercised; automatic
canonical writes are **not** approved. Owner-maintained Lunch Money account
freshness is accepted owner policy and does not block unrelated
automatically refreshed accounts. The household cash schedule has one
Plan owner (`Forecast.expandEvents`, PR #37). Question OPEN / ANSWERED status
is owned by [`docs/01_OPEN_QUESTIONS.md`](docs/01_OPEN_QUESTIONS.md); Deep Dive
cannot close a question on its own. The master-forecast direction already
lives in [`ARCHITECTURE.md`](ARCHITECTURE.md). Known major future costs
already live on `plan.commitments` (`B95` / PR #82). The published Forecast
opening is 2026-08-16 (`B91` / `AF-RECON-01`). Forecast is the one
master plan (`B94` / `AF-PLAN-01`): the 91-day Plan display is a view
of a ≥12-month knowledge horizon. The household payday answer is
composed from that Forecast (`B96` / `AF-PLAN-02`). Dated account-balance
openings live in `snapshots/` (`B20` / `AF-HIST-01`); `data.json` remains
current-state authority. Do not treat 9 August
conclusions as today's household truth. The critical path lives
in
[`docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md`](docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md).
Do not copy that sequence here. Do not treat a second month of routine
statement files as the next operational prerequisite.

Everything lives in **one folder**:

```
C:\Users\dnaud\Documents\atlas-financial
```

Open that and you have the whole project — the deployed site, the analysis, the
source data and the scripts.

## Layout

| Path | What it is | In git? |
|---|---|---|
| `server.js`, `data.json`, `public/` | The deployed site | **Yes** |
| `snapshots/` | Dated account-balance openings (history, not current state) | **Yes** |
| `docs/` | The analysis and written reports | **Yes** |
| `scripts/` | Re-runnable analysis scripts | **Yes** |
| `raw/` | Bank exports and statement PDFs | **NO — never** |
| `derived/` | Intermediate analysis output | **NO** |
| `scripts/local-config.json` | Account fragments the scripts need | **NO** |

`raw/` contains full name, home address and partial card numbers. It must never
be committed, published, or pasted into a conversation.

## `raw/` is backed up to OneDrive — run it after every capture

`raw/` is gitignored by design, so **git is not its backup**. It is mirrored
instead to `C:\Users\dnaud\OneDrive\atlas-financial-backup\raw`:

```bash
powershell -ExecutionPolicy Bypass -File scripts\backup-raw.ps1
```

Verifies file count and byte count after copying, and writes a SHA-256
`MANIFEST.txt` into the backup. It is a **mirror**, so deletions propagate —
it refuses to run against an empty source, and refuses to mirror deletions when
the source has shrunk by more than 20% unless `-Force` is passed. Currently
**manual**; see B45.

## The pre-commit hook is the safety net

`.githooks/pre-commit` **refuses any commit** that stages a file under `raw/` or
`derived/`, a `.pdf`, or — importantly — any file whose *content* contains a
personal identifier, account number or secret. It catches content-level mistakes
a `.gitignore` never could.

It is installed via `git config core.hooksPath .githooks`. If a fresh clone ever
loses that setting, **run that command before committing anything.** Verify it
works by staging a `raw/` file and confirming the commit is refused.

Never bypass it with `--no-verify`.

## Read `docs/ACCOUNT_FACTS.md` before asking the owner anything

It holds every standing fact — interest rates, credit limits, payment due dates,
the mortgage renewal date, payment structures, and how each institution's data is
obtained. **The owner should never have to supply these twice.** If a fact is
missing there, add it once it is known.

Balances are not in that file; they change constantly and live in `positions.csv`
and `data.json`.

## Key documents in `docs/`

| File | What it is |
|---|---|
| `ACCOUNT_FACTS.md` | **Standing facts — rates, limits, due dates, renewal. Read first** |
| `ATLAS_FINANCIAL_BUILD_STRATEGY.md` | **Sequencing** — what to build next, subordinate to `ARCHITECTURE.md` |
| `00_MASTER_PICTURE.md` | The canonical written summary |
| `01_OPEN_QUESTIONS.md` | The working agenda, ranked by what an answer would change |
| `evidence_use/register.json` | **Evidence-Use Register — routed or parked, for declared IDs only. Owns no financial value** |
| `positions.csv` | Data spine — one row per account, fixed schema |
| `MORTGAGE_HELOC_DEEP_DIVE.md` | Terms, payment splits, the May 2027 renewal |
| `CREDIT_CARD_DEEP_DIVE.md` | The TD card penalty rate and its 12-month clock |
| `dashboard.html` | The original local dashboard, superseded by the deployed site |

## Current state as at 2026-08-16

This is the product picture a new session should start from. It is **not** the
9 August first-pass capture this file used to open on.

**Published Forecast opening is 2026-08-16.** `data.json` `meta.asOf` and
`plan.opening.asOf` are that cutover. Spendable cash is the independently
summed Lunch Money mapped balances (Chequing A $1,320.13 + Chequing B
$932.05 + Savings $0.58 = $2,252.76). The 14 August payday cluster is
already inside those snapshots and is not replayed. Amanda / TENNIS INCOME
is still held-elsewhere. Q19 remains OPEN. `B91` is done. Dated
balance openings for 2026-08-09 and 2026-08-16 live in `snapshots/`;
`B20` is done. TENNIS INCOME and SAVINGS-DONT TOUCH still have only
the 2026-08-09 reading.

**Captured (broader than the old 11-account / 4,222-transaction picture):**
`data.json` `meta` currently records TD (15 accounts) · Triangle Mastercard ·
MBNA · PayPal ×2 · Wise ×2; 4,762 transactions; 48 statements. Mortgage and
HELOC terms are in. MBNA is captured. Affirm/Flexiti is owner-confirmed paid
off and closed. A live Lunch Money observation pull ran on 2026-08-16; that
pull stays out of git.

**Known major future costs already have one Plan home** (`B95` / PR #82):
unsettled `plan.commitments`. Amounts, timing, flexibility, and ranges
live on those rows — do not copy them here. Annual irregulars already
supported by Atlas evidence stay where they already live (home insurance and
vehicle maintenance on `plan.commitments`; property tax as the existing
reserve). Remaining unknowns are Q22. This is not a goals engine.

**Still outstanding / owner-blocked:** the wife's business economics (Q1); a
home valuation (Q3); WebBroker holdings (Q11 — needs an exchange-agreement
acceptance, which is the account holder's decision); the two unidentified
accounts (Q6); where the $46,657 of "credit card" transfers go (Q2). Q5 (why
the monthly spousal transfer stopped after May 2026) is **ANSWERED** — the
garage/lab income ended.

**Do not carry these 9 August conclusions forward as current truth.** The
2026-08-16 opening replaced them: spendable cash is $2,252.76; Burrards
registrations are settled; Triangle posted is the screenshot $13,197.00
plus $15.62 pending. The HELOC crossing on this opening is a later
charge-date fact, not the 31 August registration-draw story.

Household questions live in `01_OPEN_QUESTIONS.md`. Sequencing lives in the
build strategy. Do not invent a second list here.

## How to update the site

**Routine freshness is not a second statement download.** The intended
operating path is Lunch Money → Atlas observation + reconciliation →
canonical Atlas state → Forecast → the site. Today the canonical write is
still an explicit `data.json` edit after that compare; automatic production
writes are not earned. File capture remains the fallback/backfill/direct-
evidence path, not the monthly operational requirement.

When a published figure does need to change:

1. Edit `data.json` in this repo — every figure on the site comes from it
2. **Check it renders** — see below
3. Commit and push to `main`
4. Render auto-deploys within a couple of minutes

**Adding a figure to `data.json` does not put it on the page.** A page script
has to read it and its HTML has to have somewhere to put it. Six keys once sat
in `data.json` unrendered — including the entire income section — because that
step was skipped.

The site is four pages, each with its own script; `public/app.js` is the
shared core (helpers, charts, theme, boot) loaded by all of them:

| Page | HTML | Script | What it shows |
|---|---|---|---|
| Plan (homepage) | `index.html` | `plan.js` + `forecast.js` | The 90-day forecast, budget, next actions |
| Modellers | `modellers.html` | `modellers.js` + `forecast.js` | Payoff and renewal modelling |
| Deep Dive | `deepdive.html` | `deepdive.js` | Debt, HELOC, flows, lacrosse, questions |
| Records | `records.html` | `records.js` | Balance sheet, coverage, assumptions |

`public/forecast.js` is the engine — cash projection, debt projection, the
household-budget split, and the weekly-cap recommendation. It is pure and
DOM-free, so the node suite exercises exactly what the browser runs.

**Run `npm test` after any change to `data.json` or to a page script.**
[`test.js`](test.js) is the suite registry: it names every suite and the
dependency order they run in, and running it is the only honest way to know what
the suite currently is. This file keeps no copy of that list — a hand-maintained
inventory drifts the first time a suite is added, and then confidently describes
a test run nobody has performed. One lived here until 2026-08-12 claiming five
suites against a registry that held fifteen.

What they protect, in kind rather than by name: that the JSON parses and every
script compiles, that every id a script writes to exists, that no identifier or
secret reaches a tracked file and the security gate is intact, that the schedule
and the opening-gap recovery match hand-computed totals, that food and fuel are
provably inside the weekly cap with nothing dated counted twice, that cash out
reconciles to debt down to the cent, and that one fact keeps one home — a
contradiction between two files fails the build.

**An invariant failure is a failure, not a warning.** A plan that disagrees with
itself is worse than no plan, because it still looks authoritative.

Two things the suite deliberately cannot cover, because they need something CI
does not have: `node test-local.js` (needs `TEST_PASSWORD` and a running
server) and `node verify-live.js` (needs the deployed site).

### The engine owns the answers; the pages render them

`Forecast.recommend()` is the single authority for the weekly household cap.
Both the headline tile and the budget breakdown read that one result. They used
to be computed separately, and the page shipped showing `$1,650/week` at the top
and `$0/week` underneath. **Do not solve a financial question inside a page
script.** If a page needs a number that does not exist yet, add it to
`forecast.js` where it can be tested.

Check for orphans before pushing (scans every page script):

```bash
node -e "const d=require('./data.json'),fs=require('fs');const a=['app','forecast','plan','modellers','deepdive','records'].map(f=>fs.readFileSync('public/'+f+'.js','utf8')).join('\n');for(const k of Object.keys(d))if(!new RegExp('\\\\.'+k+'\\\\b').test(a))console.log('orphaned:',k)"
```

### Two data files, and one of them is generated

| File | Edited how | Contains |
|---|---|---|
| `data.json` | **by hand** | balances, rates, notes, questions, coverage |
| `public/periods.json` | **generated** | monthly spending, interest and fees series |

**Rebuild the generated one after any new spending capture**, or the period
selector goes stale while the rest of the page updates:

```bash
node scripts/periods.js . 2026-08-16
```

**Run it from the main checkout, not a worktree** — `raw/` and `derived/` are
local-only, so a worktree root has no source data. From a worktree, pass the
main checkout's path as the first argument instead of `.`. The script refuses
to write when it finds zero events (that mistake once shipped a dashboard of
$0.00s), so getting this wrong now fails at the prompt rather than on the site.

Pass today's date — it decides what "this month", "last month" and "year to
date" mean. It writes `derived/periods.json` and `public/periods.json`, and both
are read from the same auth-gated path as `data.json`.

### Preview locally before deploying

```bash
powershell -ExecutionPolicy Bypass -File scripts\preview.ps1
```

Stages `public/` and `data.json` into one directory and serves them at
<http://localhost:8899>. It validates the JSON and syntax-checks `app.js` first,
so a broken change fails at the prompt rather than as a blank page.

**Rendering check only** — the password gate and security behaviour are not
exercised. For those, `node test-local.js` with the password, and
`node verify-live.js` against the deployed site.

Adding an account means an entry in `debts` (and `revolvingExtra` if it is an
overdraft rather than a debt). Headline, net-worth and income totals are
derived by `Forecast.publicationTotals` from those rows — do not store a
matching copy. Add any new questions to `01_OPEN_QUESTIONS.md`, and a row to
`positions.csv`.

After changing `server.js`, run the smoke test:

```bash
TEST_PASSWORD=<the password> node test-local.js
```

Against the live site, `node verify-live.js` checks the security behaviour that
is visible without a password.

## Standing rules for this work

- **Read-only against financial institutions.** No transfers, payments,
  applications, setting changes, form submissions or agreement acceptances.
- **Never ask for or enter an institution login credential.** Bank passwords,
  PINs, security codes, 2FA — the owner handles all of these. On any doubt about
  whether a credential logs in as the household, stop.
- **Raw financial files stay local.** Only sanitised aggregates leave `raw/`.
- **Tag every figure** verified / calculated / estimated / unknown. An estimate
  is never presented as a verified fact.
- **Secrets live only where `ARCHITECTURE.md` permits**, and that file is the one
  home for the rule — do not restate a narrower version of it here. Today the two
  secrets that exist are supplied as Render environment secrets in production and
  as environment variables in your own shell when running locally.
  `SITE_PASSWORD` and `SESSION_SECRET` are never in this repo, never in
  `data.json`, never in a log, never in any conversation, and never delivered to
  or persisted in the browser. Typing the shared password into the sign-in form is
  the secret being *used*, not stored, and is not an exception to that.

## Live

- Site: https://atlas-financial-o6w1.onrender.com (password-gated)
- Render service: `srv-d9scik142hec73c2q6jg`, free plan, auto-deploys from `main`
- Free instances sleep after ~15 minutes idle; a cold start takes up to a minute
