# Context for a new session

Read this first. The work spans **two folders**, and this repo is only one of them.

## Where things are

| | Path | In git? |
|---|---|---|
| **This repo — the deployed site** | `C:\Users\dnaud\Documents\finance-site` | Yes → `Atlas-Financial` (private) |
| **The analysis and source data** | `C:\Users\dnaud\Documents\finance-review-2026-08-09` | **No — deliberately** |

The split is deliberate. The analysis folder holds `raw/` — bank CSV exports and
statement PDFs containing full name, home address and partial card numbers. Those
must never be committed. Keeping them in a separate, non-git folder means they
cannot be added by accident.

**If the task involves analysis, open the review folder too.** This repo alone
has the published figures but none of the working data or reasoning.

## What is in the review folder

| File | What it is |
|---|---|
| `00_MASTER_PICTURE.md` | The canonical written summary. Start here |
| `01_OPEN_QUESTIONS.md` | The working agenda, ranked by what an answer would change |
| `positions.csv` | Data spine — one row per account, fixed schema |
| `MORTGAGE_HELOC_DEEP_DIVE.md` | Terms, payment splits, the May 2027 renewal |
| `CREDIT_CARD_DEEP_DIVE.md` | The TD card penalty rate and its 12-month clock |
| `dashboard.html` | The original local dashboard, superseded by this site |
| `raw/` | Source exports and statements. **Never commit. Never publish** |
| `analyze/` | Re-runnable scripts, including two PDF decryptors |

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
2. Commit and push to `main`
3. Render auto-deploys within a couple of minutes

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
