# Mortgage and HELOC — Deep Dive

**Captured 2026-08-09 from TD EasyWeb, read-only.** Tags: **[TD]** read directly
from TD · **[CALC]** my arithmetic · **[EST]** inference · **[CONFIRM]** needs you.

Not professional financial, tax, legal, or mortgage advice.

---

## ⚠ Correction to my earlier report

My earlier report stated the HELOC showed **"net paydown of $47,930.55 — genuine
deleveraging."** **Withdraw that.** It was computed from chequing-account
transfers only, and the HELOC's own statement shows large outflows that never
touch chequing — e-transfers, credit-card payments, and a CRA payment drawn
directly from the line. The chequing view saw only one side of the account.

The direct evidence points the other way. Over 20 days in the most recent
window the HELOC balance **rose $6,749.18** [TD]. Details in §2.

---

## 1. Mortgage

### Terms as stated by TD [TD]

| Field | Value |
|---|---|
| Balance as of last payment | $546,026.58 |
| Accrued interest (not yet in balance) | $489.56 |
| **Interest rate** | **3.64% variable** |
| Rate basis | TD Mortgage Prime **− 0.96%** |
| Rate as of | Aug 09, 2026 |
| **Maturity date** | **May 01, 2027** |
| Term start date | May 01, 2022 |
| Term length | 60 months |
| **Remaining amortization** | **17 years, 9 months, 4 days** |
| Original amortization | 30 years |
| Original mortgage amount | $648,000.00 |
| Payment amount | $1,600.00 |
| **Payment frequency** | **Bi-weekly** |
| Next payment due | Aug 14, 2026 |
| Principal + interest portion | $1,600.00 (entire payment; no tax escrow) |
| **Annual prepayment limit** | **$97,200.00** |
| **2026 prepayment used** | **$0.00 — full room available** |

### Where each payment actually goes [CALC]

I validated the method before trusting it. TD reports $489.56 of accrued
interest as of Aug 09. Daily interest on $546,026.58 at 3.64% is
**$54.4477/day**, and $489.56 ÷ $54.4477 = **8.99 days** — exactly the nine days
since the Jul 31 payment. So TD is charging **simple daily interest at rate ÷ 365**,
and my model matches their books.

**Each $1,600.00 bi-weekly payment currently splits:**

| Component | Amount | Share |
|---|---|---|
| **Interest** | **$762.27** | 47.6% |
| **Principal** | **$837.73** | 52.4% |

**Over the next 12 months (26 payments, $41,600.00 total):**

| Component | Amount |
|---|---|
| Interest | **~$19,441** |
| Principal | **~$22,159** |

The principal share grows about **$1.17 per payment** as the balance falls. You
crossed the 50/50 point recently — the majority of every payment is now building
equity rather than paying the bank.

**Independent check on my model:** solving the annuity for $546,026.58 at
$1,600 bi-weekly and 3.64% gives **463.7 payments = 17 years 10 months**. TD
states 17 years 9 months 4 days. The model reproduces TD's own figure, so the
splits above can be relied on.

**Remaining interest if nothing changes: ~$195,893 [CALC]** — 463.7 payments ×
$1,600 = $741,920 total, less $546,026.58 of principal. This assumes the rate
stays at 3.64% for 17+ years, which it will not. Treat it as a scale, not a
forecast.

### You are already ahead of schedule — substantially

The required bi-weekly payment on $648,000 over 30 years at 3.64% is about
**$1,365 [CALC]**. You pay **$1,600** — an extra **$235 per payment, $6,110 per
year**.

That shows up in the amortization. You are 4 years 3 months into a 30-year
schedule. Straight-line, you would have **25 years 9 months** left. You actually
have **17 years 9 months**. **You have removed roughly 8 years** through the
overpayment and the bi-weekly frequency.

This is real and it is working. The question in §3 is not whether it is good —
it is whether it is the *best available* use of that $6,110.

### Prepayment position

**$97,200 of annual prepayment room, none used in 2026 [TD].** There is no
penalty obstacle to lump-sum prepayment. TD's own on-page projections [TD]:

- **+$50 per payment** → saves **$8,953.32** interest, pays off **39 weeks** sooner.
- **$500 lump sum** → saves **$453.34** interest, pays off **1 week** sooner.

Both assume the rate and payment hold for the full amortization.

---

## 2. HELOC

### Terms as stated by TD [TD]

| Field | Value |
|---|---|
| Revolving portion balance | $201,586.16 |
| **Available credit** | **$1,067.84** |
| **Credit limit** | **$202,654.00** [CALC] |
| **Utilization** | **99.5%** [CALC] |
| **Interest rate** | **4.90% variable** |
| Rate basis | TD Prime Rate **+ 0.45%** |
| TD Prime Rate | 4.45% as of Aug 09, 2026 |
| **Minimum payment due** | **$814.18** |
| Due date | **Aug 21, 2026** |
| Structure | Revolving, **interest-only** |

### This line is interest-only — the minimum pays down nothing [TD] [CALC]

The July 31 interest charge was **$814.18**. The minimum payment due is
**$814.18**. They are the same number.

**Paying the minimum reduces the principal by exactly $0.00.** This balance does
not amortize. Left alone at the minimum, $201,586.16 is still $201,586.16 in
twenty years, having cost roughly **$9,877.72 per year — about $823 per month —**
in interest indefinitely [CALC].

Contrast with the mortgage, where 52.4% of every payment buys equity.

### The balance is growing, not shrinking — confirmed over the full 18 months [TD]

**208 transactions captured, 2025-02-12 → 2026-08-04.** This is no longer a
20-day inference.

| | |
|---|---|
| Balance at start of window (Feb 12, 2025) | $194,049.20 |
| Balance at end of window (Aug 04, 2026) | **$201,586.16** |
| **Net change over 18 months** | **+$7,536.96** |
| Total advanced from the line | $86,513.51 |
| Total repaid to the line | $78,176.55 |
| **Total interest charged** | **$15,029.18** (18 charges, ~$835/month) |

**The interest is capitalizing.** $15,029.18 of interest was charged to the line
over the window, and because repayments ($78,176.55) came in below advances
($86,513.51), that interest was effectively borrowed rather than paid. This is
how an interest-only line grows while you are making payments on it.

### The annual pattern: paid down at bonus time, refilled by the next one

| Month | End balance | Net change |
|---|---|---|
| 2025-02 | $190,627.78 | — (after a $10,000 paydown) |
| 2025-05 | $198,578.57 | +$8,196.88 |
| 2025-08 | $198,366.81 | +$2,682.44 |
| 2025-12 | $202,058.59 | +$3,199.77 |
| **2026-02** | **$188,060.61** | **−$14,298.04** (the $16,100 bonus paydown) |
| 2026-03 | $190,953.11 | +$2,892.50 |
| 2026-04 | $193,168.43 | +$2,215.32 |
| 2026-05 | $195,659.82 | +$2,491.39 |
| 2026-06 | $196,967.31 | +$1,307.49 |
| 2026-07 | $201,085.16 | +$4,117.85 |
| 2026-08 | $201,586.16 | +$501.00 |

**Since the February 2026 bonus paydown, the balance has risen every single
month — +$13,525.55 in six months.** The February paydown of $14,298 has already
been more than undone. Two bonus cycles produced a net *increase* of $7,536.96.

This is the central finding of the whole review. **The annual paydown is not
reducing the debt; it is resetting headroom that then gets consumed.**

### What the line funded over 18 months [TD]

Advances totalling **$86,513.51**:

| Purpose | Amount | Items |
|---|---|---|
| Transfers to chequing / own accounts | $17,466.00 | 54 |
| **Credit-card payments** | **$22,230.00** | 32 |
| Large unidentified advances | $18,301.43 | **5** |
| **Interest capitalized** | **$15,029.18** | 18 |
| **E-transfers out** | **$13,061.90** | 26 |
| CRA tax owed | $400.00 | 1 |
| E-transfer fees | $25.00 | 26 |

Repayments totalling **$78,176.55**, almost entirely from chequing ($76,435.00),
plus $980.00 of cancelled e-transfers returning and $761.55 of direct payment.

Two items deserve your attention. **Five advances totalling $18,301.43** are
large and uncategorized [CONFIRM]. And **$22,230 of credit-card payments made
directly from the line** — more than the $24,817.93 I saw from chequing, meaning
your true card servicing is roughly $47,000 over 18 months against a card whose
balance never moved.

### What the line is being spent on [TD]

Within that 20-day window, drawn directly from the HELOC:

| Purpose | Amount |
|---|---|
| Credit-card payments (five transfers) | $2,910.00 |
| Outgoing e-transfers (five) | $2,850.00 |
| Transfer to Chequing A | $1,000.00 |
| CRA tax owed | $400.00 |
| Interest charge | $814.18 |
| E-transfer fees (five × $1.00) | $5.00 |

None of this appears in the chequing exports, which is why my first pass missed
it entirely.

Two things stand out. **A CRA tax payment is being financed on the line** —
which, alongside the resale income, reinforces the case for an accountant.
And **e-transfers are going out from the HELOC while e-transfers come in to
chequing as "resale" proceeds** [CONFIRM] — if the line is funding inventory
purchases, then the HELOC is working capital for the resale activity, and that
is a materially different thing from household borrowing. It would also change
the tax treatment of some of the interest. **This needs your confirmation.**

### The emergency backstop is gone

A HELOC is usually the fallback when something breaks. With **$1,067.84**
available, plus $82.28 of overdraft headroom and $200.00 of card credit, total
accessible credit is roughly **$1,350**. There is no meaningful reserve behind
your household.

---

## 3. Is the current structure optimal?

**No — in three specific, fixable ways.** The reasoning is arithmetic; the
decisions are yours and, where flagged, a professional's.

### The rate stack

| Debt | Balance | Rate | Amortizing? | Annual interest |
|---|---|---|---|---|
| Credit card | $1,799.97 | ~24% [EST] | Revolving | ~$450 [CALC] |
| Canadian Tire MC | Unknown | Unknown [CONFIRM] | Revolving | Unknown |
| MBNA MC | Unknown | Unknown [CONFIRM] | Revolving | Unknown |
| Affirm / Flexiti | Unknown | Unknown [CONFIRM] | Instalment | Unknown |
| **HELOC** | **$201,586.16** | **4.90%** | **No — interest only** | **$9,878** |
| **Mortgage** | **$546,026.58** | **3.64%** | **Yes — 52.4%/payment** | **$19,441** |

### Issue 1 — You are overpaying your cheapest debt while your second-cheapest is maxed and growing

You direct **$6,110/year** of voluntary extra principal at the **3.64%** mortgage.
The **4.90%** HELOC is at 99.5% and rising.

A dollar against the mortgage returns 3.64%. The same dollar against the HELOC
returns **4.90%**. The spread is **1.26 percentage points** — about **$77/year**
on $6,110 redirected. Modest in isolation, but it compounds, and it also rebuilds
the emergency credit line, which is worth more than the $77.

**The catch, and it is a real one:** lowering your mortgage payment to the
required ~$1,365 needs TD's agreement, may not be reversible, and would lengthen
your amortization back out. With maturity on **May 1, 2027**, a payment change now
sits awkwardly against a renewal eight months away. **This is a conversation to
have with TD, not a unilateral move**, and the renewal may be the natural moment.

### Issue 2 — The HELOC never amortizes, and nothing currently makes it

Because the minimum is pure interest, the HELOC only shrinks when you
deliberately overpay it. At present the balance is moving the wrong way.

To be plain about the scale: at 4.90% interest-only, clearing $201,586.16 would
need roughly **$1,700/month of principal on top of the ~$823 interest to retire it
in about ten years [CALC]**. That is not available from current cash flow. This
is not a balance you can pay off from monthly surplus — it needs either a
structural change at renewal, or the bonus/resale months redirected at it, or
both.

### Issue 3 — Card payments from the HELOC: right instinct, real risk

Paying a **~24%** credit card using a **4.90%** line is a ~19-point saving, and in
pure interest terms it is the correct move. Two cautions:

- It **converts unsecured debt into debt secured against your home**. A card
  default is a credit problem; a HELOC default is a housing problem.
- It only works if the card **stays** paid down. Otherwise you have moved the
  balance and kept the spending, and the HELOC absorbs both. The card sitting at
  90% utilization after all those payments suggests that may be happening
  [CONFIRM].

### What is genuinely working

- **Prime − 0.96% is an excellent mortgage discount.** Do not assume it repeats.
- **Bi-weekly at $235 above the required payment** has removed ~8 years of
  amortization. That discipline is the strongest thing in this file.
- **Using the HELOC rather than the card** for expensive balances is directionally
  right.
- **$97,200 of prepayment room, unused** means no penalty barrier when you do
  choose to act.

---

## 4. The renewal is the decision point — May 1, 2027

**Under nine months away.** Everything above funnels into it. At renewal you can
restructure in ways you cannot cheaply do today, and the current
prime−0.96% discount ends.

Questions worth having answered **before** you are in the renewal conversation:

1. **What replacement rate and discount will TD offer**, and how does it compare
   to other lenders? Prime − 0.96% is strong; the renewal offer may not match it.
2. **Should the HELOC be folded into the mortgage at renewal?** Combining
   $201,586 at 4.90% interest-only into an amortizing mortgage at a lower rate
   would cut the rate *and* force principal repayment. It would also raise the
   mortgage payment and put the full balance on an amortization schedule.
   **This is the single biggest lever available to you** — and precisely the
   decision that needs a mortgage professional, not me.
3. **Fixed or variable from here?** You have carried variable through a full
   term. That is a risk-tolerance question, not an arithmetic one.
4. **What is the penalty formula** if you move lenders before May 1, 2027?
5. **Does any HELOC interest relate to the resale activity**, and if so what is
   the tax treatment? **Accountant question.**

### Sequencing suggestion

- **Now → Aug 21:** cover the HELOC minimum ($814.18) and the card minimum
  ($94.03 by Aug 17). Stop new HELOC draws if at all possible — there is
  $1,067.84 left and no backstop behind it.
- **Next 30 days:** confirm the resale/inventory question, the two unidentified
  accounts, and the balances and rates on the three non-TD debts. You cannot
  rank debts you cannot see.
- **By ~January 2027:** get TD's renewal offer and at least one competing quote,
  with the HELOC-consolidation question explicitly on the table.
- **Ongoing:** direct bonus and strong resale months at the HELOC rather than
  the mortgage, since it is the higher rate and the one with no amortization.

---

## 5. Open items on these two accounts

1. ~~HELOC 18-month history not captured~~ — **now complete.** 208 transactions,
   2025-02-12 → 2026-08-04. The growth is the pattern, not a blip.
2. **Mortgage transaction history not captured** — not needed, since TD states
   the terms directly and my model reproduces their amortization figure.
3. **Are the HELOC e-transfers ($13,061.90) funding resale inventory?** [CONFIRM]
4. **What are the five large advances totalling $18,301.43?** [CONFIRM]
5. **Why is CRA tax being paid from the HELOC?** [CONFIRM]
6. **Non-TD debt rates and balances** — needed before any ranking is final.

**No changes were made to either account.** I did not use Make a Payment, Make a
Withdrawal, Increase Payment Amount, Set Up a Term Portion, or any prepayment
function.
