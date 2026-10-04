# FortisBC annual-review no-pay bill — September 9, 2026

**Status:** sanitized owner-supplied evidence, received October 4.

**Sources:** September 9 FortisBC invoice (both pages), October 4 owner portal screenshot, and secure read-only ledger corroboration.

**Authorized change:** Dale approved only the confirmed current-period Fortis correction on October 4. Hydro and future utility dating/netting remain outside this update.

Standing facts live in `docs/ACCOUNT_FACTS.md`; bill inputs live in `data.json`;
Forecast remains the planner. Raw files and account/address/meter/payment-slip
identifiers are excluded.

```evidence-ids
BILL-FOR-004
```

The bill covers **August 11–September 9**. Its printed due date is **October 1**,
its amount is **$71.15 CR**, and it says **DO NOT PAY**. The old **$124**
equal-plan charge less **$195.15** annual settlement leaves the credit:
independently, **12,400 − 19,515 = −7,115 cents**. The $195.15 has already
offset this bill; do not also apply the full annual credit to bank cash or a
future bill.

The prior July 11–August 10 bill was **$124**; the invoice records **$124
received September 1**, leaving **$0** prior balance. The October 4 secure
read-only ledger lookup corroborates one posted native-CAD BILLS ACCOUNT
Fortisbc Energy Bpy **$124 debit on September 1** in the August 20–October 4
provider response. Preserve that actual and the incumbent
`fortis@2026-09-03` early-payment identity. No provider record is changed.

Automatic re-enrolment changes the monthly plan amount to **$102**. That is
the new equal payment, not the invoice's **$38.40** usage cost or old $124
charge. The next issued total and cash due date are not established here.

The October 4 portal corroborates **DO NOT PAY / $71.15 Credit**, last payment
**$124 on September 1**, and next **bill issuance October 8**. Issuance is not
a due date. Its negative last-bill "Withdrawal on Oct 1" label is not bank
refund, debit, payment, or a paid-$0 settlement.

## October-only routing

`fortis.noPaymentRequiredOn: ["2026-10-03"]` names the already-modeled October
occurrence that this no-pay statement supersedes. October 3 is the incumbent
forecast date, not a newly confirmed due. Forecast emits no cash requirement
for that occurrence and does not synthesize `PAID`, actual $0, a bank credit,
or a new obligation. September's identity/amount/cadence remain intact.

`fortis.utilityAccountCredit` retains **$71.15 as of October 4**. There is no
`firstDue` or application date; the existing credit contract therefore does
not net it from any future occurrence. Utility credit stays separate from
bank cash. Repeated evaluation never changes the credit or cash inputs.

Future amount/cadence/date inputs retain the incumbent conservative placeholders,
with `confidence: estimated`: neither $124 nor the modeled next due is a
confirmed future invoice fact. This trust correction leaves forecast amounts
and dates unchanged. The new $102 plan
is documented; a later explicitly scoped update must use the next issued
statement to replace the future total/date and decide any credit application.
This PR does not confirm those legacy placeholders as the new equal plan or
guess a future due. It does not alter Hydro, financial openings/baseline,
cash stocks, savings/card coverage, credentials or provider transactions.
