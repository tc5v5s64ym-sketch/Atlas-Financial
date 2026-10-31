# Atlas Financial - Mortgage and HELOC Source Facts

**Record status:** Sanitized source synthesis awaiting canonical integration  
**As of:** August 13, 2026  
**Owners:** Dale and Amanda  
**Scope:** TD variable mortgage annual statement and TD Home Equity FlexLine July 2026 statement

This record preserves verified source facts without storing account numbers, the secured-property address, telephone numbers, or transfer reference identifiers. It is not a second canonical authority. Dated balances belong in the position history, standing terms in `docs/ACCOUNT_FACTS.md`, live model inputs in `data.json`, private transactions in the local ingestion store, and derived conclusions in the Atlas engine.

## Source evidence

- TD Mortgage Annual Statement for December 31, 2024 through December 31, 2025, generated January 1, 2026.
- TD Home Equity FlexLine statement for July 1 through July 31, 2026.
- Compared on August 13, 2026 against Atlas `main` at `957ed62fb6bd5e058505ecde60c78aaf3a7491f6`.

The source PDFs must remain outside repository tracking because they contain borrower names, account numbers, and the home address.

## 1. Mortgage - dated statement facts

### Terms as of December 31, 2025

| Field | Verified value |
|---|---:|
| Outstanding principal | **$559,281.35** |
| Variable rate | **3.64%** |
| Rate basis | TD Mortgage Prime minus 0.96 percentage points |
| TD Mortgage Prime shown | 4.60% |
| Biweekly principal-and-interest payment | **$1,600.00** |
| Property-tax escrow | $0.00 |
| Optional credit-protection premium | $0.00 |
| Remaining amortization | **18 years, 4 months, 13 days** |
| Maturity date | **May 1, 2027** |
| Next payment shown | January 2, 2026 |

The statement began the year at $577,459.45 and a 4.64% variable rate. The discount to TD Mortgage Prime remained minus 0.96 percentage points; the lower end-of-year rate came from TD Mortgage Prime falling from 5.60% to 4.60%.

### 2025 payment reconciliation

| Component | 2025 total | Share of payments |
|---|---:|---:|
| Principal | **$18,178.10** | 43.70% |
| Interest | **$23,421.90** | 56.30% |
| **Total, 26 biweekly payments** | **$41,600.00** | 100% |

The totals reconcile exactly to 26 payments of $1,600. Average 2025 principal was approximately $699.16 per payment and average interest approximately $900.84. These are annual historical averages across a changing variable rate, not the split of the latest payment.

### Prepayment terms stated for the current term

- Annual charge-free lump-sum privilege: up to **$97,200**, equal to 15% of the original principal.
- Minimum lump sum: $100.
- Unused annual privilege does not carry forward.
- The privilege cannot itself be used to pay the mortgage off in full.
- The payment may be increased under TD's stated payment-increase clause, including the 100%-of-payment provision and the amount required over the original remaining amortization.
- Frequency may be changed among TD's stated monthly, semi-monthly, biweekly, weekly, and rapid variants.
- A larger prepayment or full payout before maturity may trigger a three-month-interest charge.
- The statement lists a $75 discharge-document fee and a $260 assignment-document fee, plus government registration costs.
- Property insurance acceptable to TD must remain in force for full replacement cost.

Do not assume these privileges survive renewal; the statement says they apply only during the current term unless the renewal agreement says otherwise.

### Atlas reconciliation

The annual statement is a historical snapshot. The newer Atlas position of $546,026.58 is therefore not contradicted. It confirms the rate basis, $1,600 biweekly schedule, May 1, 2027 maturity, absence of property-tax escrow, and $97,200 annual prepayment privilege already represented in Atlas.

The 2025 principal/interest totals and the exact dated balance are not currently structured as historical observations in the live model. They should be added to mortgage history, not overwrite the newer current position.

## 2. HELOC - July 2026 statement facts

### Statement position

| Field | Verified value |
|---|---:|
| Opening balance, July 1 | **$196,967.31** |
| Closing balance, July 31 | **$201,085.16** |
| Credit limit | **$202,654.00** |
| Available credit at statement date | **$1,568.84** |
| Utilization at statement date | **99.23%** |
| Variable rate | **4.90%** |
| Rate basis | TD Prime plus 0.45 percentage points |
| TD Prime shown | 4.45% |
| July interest charge | **$814.18** |
| Minimum payment shown | **$814.18** |
| Payment due date | **August 21, 2026** |
| Overdue amount shown | $0.00 |

The statement's July closing balance exactly matches the July point already in `data.json.helocHistory`. The newer Atlas position of $201,586.16 is a later observation and must remain the current position.

### July activity reconciliation

| Movement | Amount |
|---|---:|
| New advances, interest, and non-interest charges | **$15,117.85** |
| Payments and credits | **$11,000.00** |
| **Net balance increase** | **$4,117.85** |

Of the $4,117.85 increase, $814.18 was the posted interest charge; the remaining $3,303.67 was net additional borrowing/fees after credits.

The statement corroborates:

- a $5,639.67 Maple Ridge municipal-tax charge already classified in Atlas as property tax;
- $10,000 of credit into the HELOC from the staging-account route;
- multiple credit-card transfers;
- outgoing e-transfers and $1 fees;
- a $400 CRA tax payment;
- $814.18 of interest posted to the HELOC on July 31.

Private counterparties and reference identifiers must stay in the local transaction store.

### Minimum-payment treatment is still an action, not a settled modelling fact

The statement proves that:

1. $814.18 interest was added to the HELOC balance on July 31; and
2. TD displayed a separate $814.18 minimum due August 21.

It also displays a pre-authorized-debit date of August 1, 2026. The statement does not prove that this debit cleared, which account funded it, or whether another credit satisfied the minimum.

Atlas currently models the interest as a non-cash capitalized event and deducts $0 from household cash. That treatment correctly represents the July 31 posting and the absence of a matching payment in the transactions captured through August 9. It does **not** prove that the August 21 minimum can be ignored.

Until the payment is reconciled, the conservative plan must reserve **$814.18 of cash for August 21** or explicitly show the verified funding account. Once a posted payment or TD confirmation is captured, Atlas may decide whether it is:

- a household cash payment;
- a payment from Amanda's excluded operating account;
- satisfied by another HELOC credit;
- or genuinely carried/capitalized with no separate cash movement.

This is a high-priority reconciliation because the current forecast can overstate available household cash by $814.18 if a cash minimum is actually required.

## 3. Planning implications

- The mortgage statement strengthens the May 1, 2027 renewal deadline and gives exact historical amortization evidence.
- Mortgage prepayment room is not the current constraint; the maxed and growing HELOC is.
- July alone added $4,117.85 to the HELOC despite $11,000 of credits.
- Property tax was financed against the house. Atlas already captures the transaction, but the future annual reserve must prevent repetition.
- The HELOC July balance is historical and the later $201,586.16 Atlas balance remains current.
- The August 21 minimum-payment funding must be confirmed before the 91-day plan can be called cash-complete.
- Mortgage and HELOC statements should be stored as source observations with evidence dates; neither should be flattened into a timeless single balance.

## 4. Required Atlas disposition

| Data point | Canonical destination | Consumer |
|---|---|---|
| Mortgage dated balance and annual principal/interest | Mortgage position/history | Records, renewal model, trend |
| Mortgage rate basis, payment, maturity | Standing mortgage terms | Forecast and renewal engine |
| Prepayment privileges and fees | Mortgage contract terms | Renewal/prepayment scenarios |
| HELOC July opening/closing balance | HELOC position/history | Debt projection and trend |
| HELOC rate, limit, interest | Standing terms plus dated charge | Debt engine |
| July transfers/charges | Private transaction/reconciliation store | Spending, transfer, and debt analysis |
| August 21 minimum | Dated obligation with reconciliation state | Cash forecast, next-due, reminders |
| Property-tax draw | Reconciled annual expense plus funding source | Reserve engine and next-year reminder |

## 5. Open actions

1. Confirm whether the $814.18 HELOC minimum due August 21, 2026 is paid, scheduled, or satisfied, and identify the funding account without committing its identifier.
2. Preserve the July 31 HELOC balance as history; do not overwrite the later current balance.
3. Add the mortgage's 2025 principal/interest reconciliation and dated balance to history.
4. Ensure the 2027 property-tax reserve is funded in cash rather than defaulting to a HELOC draw.
5. Keep the May 1, 2027 renewal and HELOC-consolidation decision in the long-range plan.
