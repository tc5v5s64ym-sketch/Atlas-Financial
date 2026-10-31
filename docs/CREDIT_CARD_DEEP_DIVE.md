# Credit Card — Deep Dive from Statements

**Captured 2026-08-09 from TD EasyWeb statements, read-only.** Dated
statement analysis, not current Atlas financial state. Source: 11 unique
TD Visa statements, September 2025 → July 2026, downloaded as encrypted
PDFs from TD EasyWeb and decrypted locally. Current posted balances and
liquidity live in `data.json` and Forecast. Tags: **[TD]** read from
TD · **[CALC]** my arithmetic · **[EST]** inference · **[CONFIRM]** needs you.

Not professional financial, tax, or legal advice.

---

## 1. The headline

Your card is on a **penalty interest rate of 24.99% on purchases and 27.99% on
cash advances** [TD]. The normal rate is **TD Prime + 12.75% = 17.20%** [CALC].

You can get the normal rate back by making **12 consecutive on-time minimum
payments** [TD]. **The count has been reset four times**, most recently by the
**July 2026** statement. On the current path, the earliest restoration is
roughly **August 2027** [CALC] — and only if every payment from the August 2026
statement onward lands on time.

---

## 2. What the statements actually show

| Statement period end | Opening balance | Closing balance | Min payment received? | Penalty notice | Over $2,000 limit? |
|---|---|---|---|---|---|
| Sep 23, 2025 | $2,290.55 | $1,954.53 | Yes | — | — |
| Oct 23, 2025 | $1,954.53 | $2,336.06 | Yes | — | **OVER** |
| Nov 24, 2025 | $2,336.06 | $2,280.12 | Yes | — | **OVER** |
| **Dec 23, 2025** | $2,280.12 | $2,384.27 | **NOT RECEIVED** | — | **OVER** |
| **Jan 23, 2026** | $2,384.27 | $2,198.54 | **NOT RECEIVED** | rate box shows 24.99% | **OVER** |
| **Feb 23, 2026** | $2,198.54 | $1,940.47 | Yes | **PENALTY NOTICE BEGINS** | — |
| Mar 23, 2026 | $1,940.47 | $1,953.92 | Yes | Penalty | — |
| **Apr 23, 2026** | $1,953.92 | $1,994.97 | **NOT RECEIVED** | Penalty | — |
| May 25, 2026 | $1,994.97 | $1,885.94 | Yes | Penalty | — |
| Jun 23, 2026 | $1,885.94 | $1,862.46 | Yes | Penalty | — |
| **Jul 23, 2026** | $1,862.46 | $1,899.97 | **NOT RECEIVED** | Penalty | — |

All figures [TD], read from the statements themselves.

### How you got here

**Two consecutive missed minimums — December 2025 and January 2026 — triggered
the penalty rate.** The higher rate appears in the January statement's rate box
and the formal notice begins on the February statement. That is the standard
trigger, and the statements record it plainly.

**You were also over your $2,000 credit limit for four consecutive months**,
October 2025 through January 2026, peaking at **$2,384.27** — $384 over the
limit [CALC]. Being over-limit while missing minimums is the combination that
typically produces repricing.

### Why you are still at the penalty rate

TD's condition is **12 consecutive** on-time minimums. Since the penalty began
you have missed twice more:

- **April 2026** — count resets
- **July 2026** — count resets again

**As of the July 2026 statement you were at zero of twelve**, restarting
from the August 2026 statement [EST, based on TD's stated rule and the
observed misses].

---

## 3. What this is costing you

| | |
|---|---|
| Balance | $1,899.97 (Jul statement) / $1,799.97 (as at 2026-08-09) [TD] |
| Penalty rate | 24.99% purchases, 27.99% cash advances [TD] |
| Normal rate | 17.20% (TD Prime 4.45% + 12.75%) [CALC] |
| **Rate premium you are paying** | **7.79 percentage points** |
| Interest, Jun 24 – Jul 23 cycle | $37.51 [TD] |
| **Annual interest at penalty rate** | **~$450** [CALC] |
| **Annual interest at normal rate** | **~$310** [CALC] |
| **Annual saving from restoration** | **~$140** [CALC] |
| **TD's estimated payoff at minimums only** | **15 years 2 months** [TD] |

The direct interest saving is modest — about **$140/year** — because the balance
is small. **That is not the real prize.** The real prize is three-fold:

1. **The payment history itself.** Four missed minimums in twelve months is what
   drives repricing and shows up in credit reporting. Fixing the habit matters
   more than the $140.
2. **Restoring $2,000 of emergency credit.** As at 2026-08-09, with $1,067.84
   left on the HELOC and $82.28 of overdraft headroom, this card was a
   meaningful part of that dated remaining buffer. Those leftovers are not
   current Atlas liquidity.
3. **It is nearly free to fix.** The minimum is $94.03/month. You are already
   supposed to be paying it.

---

## 4. A rule change that now works against you [TD]

Effective **July 2, 2026**, TD amended the Cardholder Agreement:

> "We add the unpaid interest charge to your Balance at the end of the statement
> period. As a result, **we charge interest on unpaid interest**."

Your carried balance now compounds. Previously unpaid interest sat outside the
interest calculation; now it does not. On a balance that TD itself estimates
takes **15 years 2 months** to clear at minimums, compounding is not trivial.

TD also narrowed the definition of a Balance Transfer, and it explicitly **cannot
be used to pay another TD credit product**.

---

## 5. The card is dormant — which sharpens a different question

Across every statement examined, **purchases are nil**. The balance moves only
through interest charges and occasional payments. This is not an actively used
card; it is a stranded balance accruing penalty interest.

That resolves one earlier caveat — there is no hidden card spending to
categorize — and sharpens another:

**Over 18 months, $47,047.93 left your accounts labelled "TFR-TO C/C"**
($24,817.93 from chequing, $22,230.00 from the HELOC) [TD]. This card's own
statements show it received nothing like that. Its balance moved from $2,290.55
to $1,899.97 across the whole period — a net reduction of **$390.58**.

**Roughly $46,657 of "credit card" transfers went somewhere that is not this
card** [CALC]. I cannot determine the destination from TD's data. **This is the
single largest unexplained flow in the entire review** [CONFIRM].

---

## 6. What to do, in order — 9 August 2026 dated actions, not today's plan

**1. Pay $94.03 by August 17, 2026, and never miss again.**
This is the whole strategy. Automate it if at all possible — the evidence is that
manual payment has failed four times in twelve months. An automatic minimum
payment from Chequing A (which holds a balance) rather than Chequing B (which
was overdrawn as at 2026-08-09) would remove the failure mode.

**2. Call TD and confirm the count.**
Ask exactly which statement period starts the 12-consecutive sequence, and
whether the April and July misses reset it. My reading is that you are at zero
of twelve from August 2026, but TD's system is authoritative and this is a
five-minute call. Ask at the same time whether they will reprice earlier given
the balance is small and static.

**3. Clear the balance when a strong month allows.**
$1,799.97 from a bonus or strong resale month ends the interest entirely and
restores $2,000 of emergency credit. February and July have historically been
your strong months. Note this does **not** by itself restore the 17.20% rate —
TD's condition is payment history, not a zero balance — but it makes the rate
academic.

**4. Answer the $46,657 question.**
Until you know where those "TFR-TO C/C" transfers go, any debt ranking is
provisional.

---

## 7. Coverage and limits

- **11 unique statements captured: September 2025 → July 2026.** One download
  duplicated the June 2026 statement, so the **August 25, 2025** statement was
  not retrieved. TD's online statement archive covers the last 12 months.
- Statement PDFs are **encrypted** (standard security handler, RC4-128,
  revision 3, empty user password). I decrypted them locally to read them. The
  originals are preserved unmodified in `raw\statements\`.
- Per-statement interest amounts and rate boxes extracted cleanly for the
  penalty period. For **December 2025** my parser read a purchase rate of
  **26.99%** rather than 24.99%; the pattern match there is loose and I do not
  treat it as reliable [EST]. Every other rate reading is corroborated by the
  explicit notice text.
- The custom font encoding in these statements maps digits and punctuation
  reliably but scrambles some prose. Numeric fields are trustworthy; narrative
  text was read from the sections rendered in standard fonts.

**No changes were made to the card.** No payment, no payment plan, no limit
request, no dispute. The statements were downloaded as your own documents,
already loaded in the page.
