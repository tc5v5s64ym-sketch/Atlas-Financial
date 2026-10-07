# Bank fees: incurred cost, allowance and cash coverage

Owner instruction, October 7: household bank and credit-card fees use the existing Fees line in Bills. Its authored amount and occurrence dates stay unchanged. The period fee deduction is the larger of that allowance and qualified incurred fees. A card charge reserves Bills cash; it does not change actual Bills Current Balance. A later explicitly matched cash payment releases its fee coverage without incurring the fee again. The owner's tentative payment remark authorizes no money movement.

## Authority and evidence

Forecast owns the entire composition, through private `periodBankFees`, `applyFeeAllowanceToCashEvents`, the existing purchase reconciliation and the full-period bill waterfall. The renderer reprints the supplied fields. Current Balance remains the incumbent observed Bills stock. Balance After Deductions remains period income minus assigned Bills (including fee overage) minus Household Budget; it is not from-today cash.

The provider observer qualifies the transaction's category id against the current ingested catalog: one active, non-group, non-income exact `Bank fees` category, no exclusion flags or conflicting display-name evidence. Only its qualification flag reaches sanitized actuals. No real category id is hard-coded or published. Merchant strings and notes cannot create fee membership or payment allocations. No Fees, Other bank fees or ATM category is created. Existing legacy categories and settlement identities retain their prior compatibility behavior.

Membership is explicit: mapped household-cash Chequing A, Chequing B and Savings, plus mapped revolving travelvisa, cashback, tdcc, mbna and triangle. External, business, unmapped or conflicting evidence cannot broaden household membership. Pending remains pending, including in the cost's trust label. Original paired-account monthly-fee settlement evidence stays separate; an unrelated card fee cannot mark that occurrence PAID. The special minimum-category setup is not assumed verified by this change.

## Independent invariant

For one established period, let A be its unchanged authored fee allowance and F its qualified incurred fees, including explicitly labelled pending costs. Forecast publishes:

- Period fee cost: max(A,F).
- Overage: max(0,F-A).
- Unincurred allowance: max(0,A-F).
- Current fee cash protection: unincurred allowance + uncovered card fees + pending cash fees.

Uncovered card fees already belong to the existing card cash floor. The cash walk therefore keeps only the unincurred allowance event, plus any pending bank-cash fee. Posted bank-cash fees already left their observed account. Matched card payment debits already left observed Bills cash; confirmed coverage release offsets that cash loss once. Payment intent, pairing, allocations, partial payments and reversals reuse the incumbent ledger. No automatic allocation or payment schedule is added.

Independent invented example: income1000, required minimum25, fee allowance24, Household Budget150 and an incurred card fee80. BAD is `1000 -25 -max(24,80) -150 =745`, before and after payment. Before payment Bills cash500 protects80 for the fee, giving245 after the other25+150 holds. After a matched80 payment cash420 protects0 for that fee, still giving245. It is never planned24 plus actual80, nor actual fee80 plus a second80 payment expense.

Only the period containing the authored allowance occurrence receives that allowance. It is not spread across other periods. An unpaid earlier fee carries in card coverage without becoming another period's fee cost. Unknown allowance, category identity, native units, bounds, replacements, opening or coverage cannot be published as a known zero. A pre-opening fee without a ledger annotation remains unconfirmed; observed cash and qualified incurred cost survive independently of unavailable cash permission.

## Consumer and proof

The active Budget Bills card prints the Fees group, unchanged plan versus incurred actual, overage and cash reservations. Fee transactions have a purple background plus explicit posted/pending and coverage text. Scheduled bill filters retain their separate payment semantics. The existing Why sheet keeps original scheduled-fee evidence and native drilldowns with focus restoration.

`node test/test-bank-fees-composition.js` runs independent observer -> live overlay -> Forecast -> active Budget publication cases: below/equal/above allowance; bank-paid, card-unpaid, matched-card-paid; partial/reversed/ambiguous payment; pending/replacement evidence; all explicit household cash/card roles; excluded/unmapped roles; catalog/id/name conflicts; native currency/missing values; unknown opening/allowance; genuine monthly-pair settlement; boundaries and replay. The same test fails against the pinned before tree because Bank fees do not appear in Bills.

`node test/browser-bank-fees-composition.js` exercises the actual Budget document, App.boot, Forecast and active renderer with invented served fixtures at1440,390,320px. It checks fee actuals, full-period BAD and observed Bills cash; purple plus state text; pending/missing/unknown states; keyboard disclosure and focus restoration; no horizontal overflow, mutations, external requests or writes. It is synthetic local acceptance, not deployed authenticated browser acceptance.

## Boundaries and closure

One outcome: existing-line fee cost and cash protection are composed once by Forecast, and the active Bills consumer shows that evidence. Four implementation files; test/fixture/registry/proof files counted separately. No canonical amount, baseline, allowance, assignment, provider rule/category, payment, paid-status invention, credentials, hosting or security setting changes. No new renderer or money store. Main's Worth a look bottom placement is preserved. The original v3 mockup remains a separate visual finish line and is not declared complete here.

Draft publication is for independent exact-head Atlas Contract / Systems Review. Full required CI must pass before any parent merge; this builder does not merge. Actual deployed fee rows and authenticated live browser acceptance remain unverified. No real household ledger rows or scaled real amounts are included in fixtures or evidence.
