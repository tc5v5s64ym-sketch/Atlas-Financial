# Card purchase backfills and scheduled minima

Source: Dale's explicit household instruction, dispatched 2026-10-04:
Amanda moves money from Bills when she purchases on a credit card; those
backfills must not automatically count as the scheduled minimum payment.

Current-state verdict: **STILL BROKEN** on main
`9a0ec4e6d0399cd3c9608609ae3a8af3426a9680` before repair.
`provider-observe.representedEventHitGroups` accepts a mapped posted card
payment alias, allowed posting date and amount at least the minimum.
`live-plan.applyLiveCutover` then adds the exact scheduled occurrence to
`plan.opening.representedEvents`. No approved payment-purpose discriminator
exists. Notes are observed but cannot establish settlement intent.

## Independent reproduction and repaired result

Every amount and account identifier in `test/fixtures/card-backfill-data.js`
is invented. The fixture starts with Bills cash 500 and card debt 400,
observes an 80 grocery purchase, and an 80 Bills debit plus card credit.
Both transfer notes explicitly say purchase backfill, not minimum earmarking.

The independent ledger is:

- Bills cash: 500 - 80 = 420.
- Posted card debt: 400 + 80 - 80 = 400.
- Grocery consumption: 80 once; neither transfer leg is another expense.
- Grocery allowance: 150 - 80 = 70 remaining.
- Existing scheduled minimum reserve: 25, until confirmed separately.
- Current funding capacity: 420 - 70 - 25 = 325.

Main falsely publishes the minimum PAID, actual -80, remaining 0;
the current funding capacity becomes 350. The repaired observation has
no card-minimum candidate or represented actual. Forecast retains its
existing occurrence, remaining 25, and publishes capacity 325.
There is no added obligation or separate backfill liability.

## Evidence, intent and issuer treatment

Payment aliases identify movements. Mapped card identity establishes the
destination. Neither establishes which household purpose the payment serves.
Equal amounts, purchase timing, statement-cycle timing, a payment category,
free-text notes, tags, reviewed status, and pending-to-posted replacement
do not reliably establish minimum intent under the current contract.

The bounded repair withholds automatic card-minimum settlement in the
incumbent observer. It covers both card credits and named Bills debits,
including Triangle and MBNA, pending replacement inheritance, observation,
sanitized actuals, and reconciliation receipts. It recognizes a payment
obligation linked to a mapped revolving-credit facility or the existing
unsecured Revolving debt structure; it is not an event-name blacklist.
HELOC, mortgage, ordinary bills, salary identity and spending classification
keep their existing paths.

The established explicit confirmation mechanism is the exact scheduled
`{id, date}` in `plan.opening.representedEvents`, supplied through existing
owner/evidence-controlled inputs. Existing confirmations survive refresh.
Actual statement evidence that the lender minimum was satisfied must remain
recognized there: a household backfill purpose does not override the issuer's
treatment. Missing transaction linkage does not prove an unpaid lender minimum.
The existing bill-evidence sheet explicitly says this.

A future automatic distinction needs owner-confirmed payment-purpose evidence
bound to an exact transaction and occurrence, and separate issuer evidence.
Choosing a notes/tag convention, mixed-payment allocation, or a separate
household reserve would need an explicit decision. This PR creates none of
those schemas or obligations. No clarification blocks the conservative repair;
an ambiguous payment simply stays unconfirmed.

## Proof and scope

`node test/test-card-backfill-intent.js` exercises the real observer,
reconciler, live overlay, Forecast, bill sheet and incumbent Budget printer.
Independent fixtures cover all five cards, exact and excess amounts, ambiguous
notes, repeat reads, refunds/reversals, pending purchases/payments, directed
pending replacement, overdue unverified state, exact owner/issuer confirmation,
prepaid confirmation, wrong-date confirmation, and a differently named mapped
card. Purchase and movement amounts, input immutability and canonical file bytes
are independently asserted.

The older minimum-settlement suites now reject automatic settlement rather
than codifying the reproduced defect. Their other account/date/refund and
spending exclusions remain. No UI implementation file changes; #488 and the
funding/Month work consume the repaired Forecast publications without a
presentation branch dependency. Independent Systems Review and green exact-head
required checks remain merge gates. This branch is published as a draft only.
