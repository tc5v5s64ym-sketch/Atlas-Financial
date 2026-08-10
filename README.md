# Household finances — private dashboard

A password-protected household finance site built around a practical 90-day
plan, with the historical analysis and interactive payoff and mortgage-renewal
modelling behind it.

**This repository must stay private.** It contains balances, rates, income and
debts. It contains no account numbers, card numbers, names or addresses — but it
is still the whole financial picture of two people.

---

## What is in here

| Path | Purpose |
|---|---|
| `server.js` | Express app: password gate, security headers, serves the data |
| `data.json` | **Every figure on the site**, including the `plan` block the forecast runs on |
| `public/index.html` + `plan.js` | **Plan** — the homepage: 90-day forecast, budget, next actions |
| `public/forecast.js` | The 13-week projection engine — pure, DOM-free, node-testable |
| `public/modellers.html` + `.js` | **Modellers** — payoff and mortgage-renewal tools |
| `public/deepdive.html` + `.js` | **Deep Dive** — debt, HELOC, flows, lacrosse, questions |
| `public/records.html` + `.js` | **Records** — balance sheet, coverage, assumptions, privacy |
| `public/app.js` | Shared core: helpers, charts, theme, navigation, boot |
| `public/styles.css` | Styling, light and dark |
| `test-local.js` | Smoke test for the auth gate — run it after any change to `server.js` |
| `test-forecast.js` | Tests the forecast engine — run it after any change to the `plan` block |
| `render.yaml` | Render blueprint |

## Security model

- **Fails closed.** Without `SITE_PASSWORD` and `SESSION_SECRET` the server
  refuses to start, so a misconfigured deploy cannot serve the data publicly.
- `data.json` is served **only** to an authenticated session. It is not in the
  static directory.
- Sessions are stateless HMAC-signed cookies — HttpOnly, SameSite=Lax, and
  Secure whenever the request is HTTPS. A tampered cookie is rejected.
- Login attempts are throttled to 8 per 15 minutes per IP.
- `noindex` headers plus a `robots.txt` that disallows everything.
- A strict Content-Security-Policy; no inline scripts, no third-party requests.

**Secrets live in Render environment variables and nowhere else.** Never commit
them, and never put them in `data.json`.

## Running it locally

Set the two environment variables, then start. Placeholders below are shown in
angle brackets deliberately — the pre-commit hook blocks anything that looks
like a real secret assignment, including in documentation.

```bash
npm install
export SITE_PASSWORD=<at least 8 characters>
export SESSION_SECRET=<at least 16 characters>
npm start
```

Then open http://localhost:3000. On Windows PowerShell, set the same two
variables with `$env:` prefixes before running `npm start`.

Run the smoke test against a running server:

```bash
node test-local.js
```

## Deploying to Render

1. Push this repository to a **private** GitHub repo.
2. In Render, create a new Web Service from the repo (or use the blueprint in
   `render.yaml`).
3. Set **`SITE_PASSWORD`** by hand to a strong shared password.
4. Let Render generate **`SESSION_SECRET`**.
5. Deploy. Every push to the default branch redeploys automatically.

The free plan sleeps after inactivity, so the first visit in a while takes about
thirty seconds to wake. For a couple of check-ins a week that is fine.

## Updating the picture

Edit `data.json`, commit, push. Render redeploys and the site reflects the new
figures. No HTML or JavaScript changes needed for a routine update.

When adding an account, add an entry to `debts` (and `utilisation` if it is
revolving), then update `headline`, `netWorth` and `coverage` to match.

## What this is not

Financial education and planning support — **not** professional financial, tax,
legal, mortgage or investment advice. The modellers are illustrative: they
assume rates hold and no new spending goes on, and they ignore fees, penalties,
qualification and loan-to-value. Real decisions need a licensed professional.

## Related

- **`AGENTS.md`** / **`CLAUDE.md`** — how work gets done here: who decides, who
  reviews, and what a pull request has to carry before it merges
- **`CONTEXT.md`** — read first in a new session: layout, state, standing rules
- **`ARCHITECTURE.md`** — how the layers fit together, where new material goes,
  and the staged direction
- **`docs/ACCOUNT_FACTS.md`** — rates, limits, due dates, the renewal date
- **`docs/RISK_LABELS.md`** — the CI gates, and the defect each one exists to
  catch

Raw bank exports and statement PDFs live in `raw/` on this machine only. They
contain names, addresses and partial card numbers, are gitignored, and are
additionally blocked by `.githooks/pre-commit`.
