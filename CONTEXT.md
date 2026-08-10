# Context for a new session

**Read in this order:**

1. **`AGENTS.md`, then `CLAUDE.md`** — who decides, who reviews, when to stop
   for a person, and what a pull request has to carry. Governance only; it
   repeats nothing below
2. **This file** — layout, current state, standing rules
3. **`ARCHITECTURE.md`** — the five layers, where new material goes, the direction
4. **`docs/ACCOUNT_FACTS.md`** — rates, limits, due dates, renewal. Never ask the
   owner for anything already recorded there
5. **`BACKLOG.md`** — work that can be done, and what is blocking each item
6. **`docs/01_OPEN_QUESTIONS.md`** — what only the household can answer

**The distinction between the last two matters.** If an item needs a human to
*know* something, it is a question. If it needs someone to *do* something, it is
backlog. They drift into each other unless kept apart deliberately.

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
| `00_MASTER_PICTURE.md` | The canonical written summary |
| `01_OPEN_QUESTIONS.md` | The working agenda, ranked by what an answer would change |
| `positions.csv` | Data spine — one row per account, fixed schema |
| `MORTGAGE_HELOC_DEEP_DIVE.md` | Terms, payment splits, the May 2027 renewal |
| `CREDIT_CARD_DEEP_DIVE.md` | The TD card penalty rate and its 12-month clock |
| `dashboard.html` | The original local dashboard, superseded by the deployed site |

## State as at 2026-08-09

**Captured:** TD (11 accounts, 4,222 transactions over 18 months), TD credit card
(11 statements), mortgage and HELOC terms, Triangle Mastercard (5 statements),
PayPal (351 transactions).

**Outstanding:** MBNA Mastercard, Affirm/Flexiti, the wife's business, a home
valuation, and WebBroker holdings (blocked — needs an exchange-agreement
acceptance, which is the account holder's decision).

**Four questions only the household can answer**, all in `01_OPEN_QUESTIONS.md`:
where $46,657 of "credit card" transfers actually go; what the two unidentified
accounts are; why the monthly spousal transfer stopped after May 2026; and
whether the business makes money after cost of goods.

## How to update the site

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
| Modellers | `modellers.html` | `modellers.js` | Payoff and renewal modelling |
| Deep Dive | `deepdive.html` | `deepdive.js` | Debt, HELOC, flows, lacrosse, questions |
| Records | `records.html` | `records.js` | Balance sheet, coverage, assumptions |

`public/forecast.js` is the engine — cash projection, debt projection, the
household-budget split, and the weekly-cap recommendation. It is pure and
DOM-free, so the node suite exercises exactly what the browser runs.

**Run `npm test` after any change to `data.json` or to a page script.** Five
suites, in dependency order:

| Suite | What it protects |
|---|---|
| `test-static.js` | JSON parses, scripts compile, every id a script writes to exists, no identifier or secret in a tracked file, the security gate is intact |
| `test-forecast.js` | The schedule against hand-computed totals, and the opening-gap regression |
| `test-budget.js` | Food and fuel are provably inside the weekly cap, and nothing dated is counted twice |
| `test-debt.js` | Cash out reconciles to debt down, to the cent |
| `test-invariants.js` | One fact, one home — contradictions between files fail the build |

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

**Rebuild the generated one after any new capture**, or the period selector goes
stale while the rest of the page updates:

```bash
node scripts/periods.js . 2026-08-09
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

Adding an account means an entry in `debts` (and `utilisation` if revolving),
then updating `headline`, `netWorth` and `coverage` to match. Add any new
questions to `01_OPEN_QUESTIONS.md` in the review folder, and a row to
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
- **Never ask for or enter credentials.** Passwords, PINs, security codes — the
  owner handles all of these.
- **Raw financial files stay local.** Only sanitised aggregates leave `raw/`.
- **Tag every figure** verified / calculated / estimated / unknown. An estimate
  is never presented as a verified fact.
- **Secrets live only in Render.** `SITE_PASSWORD` and `SESSION_SECRET` are not
  in this repo, not in `data.json`, and not in any conversation.

## Live

- Site: https://atlas-financial-o6w1.onrender.com (password-gated)
- Render service: `srv-d9scik142hec73c2q6jg`, free plan, auto-deploys from `main`
- Free instances sleep after ~15 minutes idle; a cold start takes up to a minute
