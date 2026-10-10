# Four active streaming bills - owner approval 2026-10-10

This is bounded, sanitized source intake for an explicit owner-approved bill-input edit. `data.json` `plan.bills` owns the current schedules; Forecast owns the calendar, subscription inventory and cash consequences. This file is not a transaction ledger or a second planning authority. Private receipt images, order identifiers and payment-instrument details are omitted.

```evidence-ids
STREAMING-001
STREAMING-002
STREAMING-003
STREAMING-004
STREAMING-005
```

## Owner evidence and approval

Dale supplied four receipts. The parent ChatGPT session inspected the receipt pixels and asked whether all four services were active and monthly. Dale confirmed, "Yes let's add them", and approved these missing subscriptions. The implementation uses that delegated owner evidence; the builder did not independently retrieve the private images or query a provider.

| Evidence | Service | Receipted CAD total, tax included | Receipt date | Estimated monthly anchor | First forward planning occurrence |
| --- | --- | ---: | --- | ---: | --- |
| STREAMING-001 | Paramount+ | 13.43 | 2026-09-12 | 12 | 2026-10-12 |
| STREAMING-002 | STACKTV | 16.79 | 2026-09-22 | 22 | 2026-10-22 |
| STREAMING-003 | Prime Video ad-free | 3.35 | 2026-09-25 | 25 | 2026-10-25 |
| STREAMING-004 | Crave Standard with ads | 13.43 | 2026-10-09 | 9 | 2026-11-09 |

Independent receipt-total reconciliation: **1343 + 1679 + 335 + 1343 = 4700 cents**, or **CAD 47.00/month**. Amounts and active monthly status are owner-confirmed. The receipt days are estimated recurring anchors, not confirmed future invoice deadlines. Overall schedule `confidence` and `dateConfidence` remain `estimated`; a later invoice or owner-confirmed renewal day can resolve the timing through the normal authorized input path.

The first occurrences activate the next forward anchors after this October 10 approval. September receipts do not establish October payment, and Crave's October 9 receipt does not create November settlement. No historical bill occurrences, purchases, arrears or paid markers are added. The existing Amazon Prime membership is separate and unchanged at CAD 11.19 monthly on the 19th, paid from Travel Visa.

## Wise payment and funding evidence

The owner confirmed Wise payment and a **CAD 47.00 Bills-to-Wise transfer on 2026-10-10** to cover these costs (`STREAMING-005`). That is funding/backfill, separate from the owner's CAD 150 guilt-free funding. It is not additional income, a fifth expense, four new purchases, or proof of any particular bill occurrence settling. This PR records the transfer only here and in the bill provenance; it adds no canonical transfer, purchase, opening balance, card-coverage payment or represented event.

Additional Wise receipt evidence relayed by the parent on 2026-10-10 confirms that the **CAD 47.00 sent by Dale is available in the recipient account**. This closes the recipient-credit evidence gap for the same funding/backfill item, not for any individual subscription charge. The builder consumes the delegated receipt verification without retrieving email or publishing its private link, transfer identifier or recipient account details. Lunch Money posting and account mapping remain unverified; the receipt does not establish a current Wise balance, future funding or bill settlement.

The existing canonical `plan.startingCash.heldElsewhere[id=wise]` identity supports these bills without adding an account. Each new bill uses `payingAccount: wise`, `householdObligation: true`, `jointCash: false`. Forecast's existing held-elsewhere rule publishes the household obligation while excluding it from joint-chequing deductions and revolving-card reserves. Wise remains outside spendable starting cash. A receipt payment mask does not identify Travel Visa; no such mapping is inferred.

Wise is absent from the current Lunch Money catalog according to the delegated read-only verification. No provider account alias, merchant settlement rule, instrument mapping, Wise balance or posting history is invented. The native held-elsewhere schedule does **not** forecast future Bills-to-Wise replenishment or reconcile Wise charges. The owner-confirmed funding is not evidence for either capability. These remain known representation limits, not an invitation to add new funding policy in this PR.

## Canonical routing and preservation

`STREAMING-001` through `STREAMING-004` route to the appended bill rows `paramount-plus`, `stacktv`, `prime-video-ad-free` and `crave-standard-ads`. `STREAMING-005` is deliberately excluded from canonical transaction/state integration for the reasons above. `CONSUMED` in the evidence register proves routing, not settlement or financial correctness.

The explicit owner instruction authorizes this input edit under `docs/skills/evidence-intake.md` step 4. Existing bills, income, debts, guilt-free targets, opening, account identities, transaction rules, frozen snapshots and actual spending history are preserved. No provider write, payment, account setup, credential access, UI change, merge or deployment is authorized. Required Atlas Contract / Systems Review remains PENDING on the draft PR.
