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

The existing canonical `plan.startingCash.heldElsewhere[id=wise]` identity preserves the merchant-payment route without adding an account. Each new bill uses `payingAccount: wise`, `householdObligation: true`, `jointCash: false`, and explicit `fundingAccount: chequing-a`. The optional funding source represents the owner's future Bills funding intent. Forecast derives one planned cash requirement per individual bill occurrence from that same amount and estimated date, attributed to Bills; it retains Wise separately as `merchantPayingAccount`. This is not an automatic transfer or a confirmed future payment date. Wise remains outside spendable starting cash, and no revolving-card reserve is created. A receipt payment mask does not identify Travel Visa; no such mapping is inferred.

Wise is absent from the current Lunch Money catalog according to the delegated read-only verification. No provider account alias, merchant settlement rule, instrument mapping, Wise balance or posting history is invented. Future funding is a planned household cash requirement; actual transfer posting, current Wise balance and individual merchant settlement remain unverified. Today's CAD 47 funding cannot settle future charges by amount alone. Ordinary future unpaid bills reserve their planned cost normally, without a new global unknown-withholding rule; existing actual-reconciliation safeguards remain intact.

## Approved bounded funding repair

Independent review found that the initial held-elsewhere-only representation increased subscription inventory by CAD 47 but omitted future household funding from Bills. The delegating decision desk approved the bounded repair in this same PR, using the existing future-household Bills policy, the approved monthly additions and owner-confirmed Bills-to-Wise backfill. Dale also clarified that the subscriptions remain split by bill, never clumped into one CAD 47 bill.

Four separate canonical bill rows remain the sole amount/date authority. October's first forward requirements are **1343 + 1679 + 335 = 3357 cents**. November has all four: **1343 + 1343 + 1679 + 335 = 4700 cents**. The actual October 10 CAD 47 backfill is source evidence only, not a fifth bill, parallel transfer schedule, additional expense, income, paid marker or inferred future coverage. The funding field is valid only for the existing Bills household cash source and a held-elsewhere merchant route; contradictory fields fail explicitly. Bills without the field retain incumbent behavior.

Forecast owns event cash attribution, current-period Bills rows, payday allocation, Bills period-end balance, budget netting and future trajectory. Expanded funded events use Bills as `payingAccount` for their single cash requirement, retain the canonical Wise route in `merchantPayingAccount`, and publish a source/route label. Advancing a live opening preserves unresolved funding through the incumbent `priorAsOf` carry and exact-occurrence representation rules. No new actual matcher or provider mapping is added.

Exact repair file boundary: `data.json` (four funding fields and their provenance); `public/forecast.js` (validated optional bill funding contract and consistent cash attribution); this intake; `docs/evidence_use/register.json` (actual funding remains excluded, future intent has separate review); `test/test-owner-streaming-bills.js` (independent ledger and downstream/negative controls); `test/test-helpers.js`, `test/test-live-debt-horizon.js`, `test/test-road-ahead-reconciliation.js`, and `test/test-owner-subscription-bills.js` (existing independent cash/dated-cost oracles include Bills-funded held-elsewhere costs). The bounded Prime intake correction and test-registry addition remain part of the original approved four-bill intake. No UI, live-overlay, provider, account-identity, historical actual or frozen-snapshot file is edited.

## Canonical routing and preservation

`STREAMING-001` through `STREAMING-004` route to the appended bill rows `paramount-plus`, `stacktv`, `prime-video-ad-free` and `crave-standard-ads`. `STREAMING-005` is deliberately excluded from canonical transaction/state integration for the reasons above. `CONSUMED` in the evidence register proves routing, not settlement or financial correctness.

The explicit owner instruction authorizes this input edit under `docs/skills/evidence-intake.md` step 4. Existing bills, income, debts, guilt-free targets, opening, account identities, transaction rules, frozen snapshots and actual spending history are preserved. No provider write, payment, account setup, credential access, UI change, merge or deployment is authorized. Required Atlas Contract / Systems Review remains PENDING on the draft PR.
