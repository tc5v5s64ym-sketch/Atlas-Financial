# Finance Review — folder guide

Everything here is **local**. Nothing has been uploaded, published, or shared.
No file contains an account number, card number, reference code, or address.

## Start here

| File | What it is | Who it's for |
|---|---|---|
| **`dashboard.html`** | The whole picture on one screen. Open in a browser. | Everyone — start here |
| **`00_MASTER_PICTURE.md`** | The canonical written summary. Sections 8–10 address the accountant, the mortgage advisor, and joint decisions. | Everyone |
| **`01_OPEN_QUESTIONS.md`** | Every unanswered question, ranked by what the answer changes. This is the working agenda. | Dale + wife |
| **`positions.csv`** | The data spine — one row per account, fixed schema. New accounts append here. | Machine-readable |

## Per-account detail

| File | Covers |
|---|---|
| `MORTGAGE_HELOC_DEEP_DIVE.md` | Terms, payment splits, amortisation, the May 2027 renewal, whether the current allocation is optimal |
| `CREDIT_CARD_DEEP_DIVE.md` | The penalty rate — how it started, where the 12-month count stands, statement-by-statement history |
| `FINANCIAL_REVIEW_2026-08-09.md` | The original full review. Superseded by `00_MASTER_PICTURE.md`, kept for its detailed spending and recurring-charge tables |
| `SANITIZED_SUMMARY_2026-08-09.csv` | The original flat summary. Superseded by `positions.csv` |

## Working data

- **`raw/`** — original CSV exports and statement PDFs, unmodified. Never edit these.
- **`derived/`** — intermediate analysis output.
- **`analyze/`** — the scripts. Re-runnable if the raw data is refreshed.

Statement PDFs are encrypted by TD (standard handler, RC4-128, empty user
password). `analyze/pdfdecrypt.js` decrypts them locally for reading; the
originals in `raw/` are untouched.

## Adding the next account

Same steps each time, so the work stays comparable:

1. **Capture the terms** — balance, limit, available, rate and its basis, fixed
   or variable, structure (revolving / interest-only / amortising / instalment),
   minimum or required payment, frequency, next due date, maturity or renewal.
2. **Pull the longest transaction history the institution allows**, and record
   the exact coverage achieved — including what was *not* available.
3. **Add one row to `positions.csv`.** Set `entity` to Household or Business.
   Leave unknowns blank and set `confidence` honestly.
4. **Add any new questions to `01_OPEN_QUESTIONS.md`**, with what the answer
   would change.
5. **Update `00_MASTER_PICTURE.md`** and the dashboard tiles if the account
   moves a headline number.

Confidence values in use: `VERIFIED_TD` (or `VERIFIED_<institution>`),
`CALCULATED`, `ESTIMATE`, `PAYMENTS_ONLY`, `NEEDS_OWNER`, `NOT_REVIEWED`,
`NOT_VALUED`, `NOT_CALCULABLE`, `LOW_CONFIDENCE`.

## Queued

- Other credit cards (Canadian Tire Mastercard, MBNA, and any others)
- The wife's business — accounts, revenue, cost of goods, tax status
- Home valuation
- Any further institutions

## Standing rules for this work

- Read-only. No transfers, payments, applications, setting changes, profile
  edits, form submissions, or agreement acceptances.
- No credentials are ever requested or entered.
- Raw financial files stay local; only sanitised aggregates leave `raw/`.
- Every figure is tagged verified / calculated / estimated / unknown, and an
  estimate is never presented as a verified fact.
