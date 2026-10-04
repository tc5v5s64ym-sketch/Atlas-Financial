# Month-end bills and Other Spending

Source: Dale's 2026-10-04 reports that fees and the paid Google storage bill
appear in Other Spending while the bill remains unconfirmed. Verified base:
`96010f360c5022623ad404554565db8356f026b2`, main including #489.

## Evidence and its limits

The canonical bill is `tdfees`, two monthly plan fees combined as $35.90,
day 30. Its existing identity requires the MONTHLY ACCOUNT FEE debit pair
on distinct canonical chequing-a and chequing-b accounts. The storage bill
is `google-storage-100gb`, $3.13, last calendar day, identified by Google
AND original SERVICE _V on chequing-b. Other Google products are excluded.

Authorized read-only Lunch Money lookup, September 1 through October 4:
seven posted CAD fee rows. September 29: MONTHLY ACCOUNT FEE $17.95 on
BILLS, MONTHLY ACCOUNT FEE $17.95 on WEEKLY SPENDING, O.D.P. FEE $5 on
WEEKLY SPENDING, and MONTHLY ACCOUNT FEE $3.95 / CHQ RETURN FEE $2 on
DEBT&PAYMENTS. September 8: separate $29 overlimit charges on Cash Back
and Travel Visa. These are distinct costs, not seven copies of one bill.
The configured local-map example makes DEBT&PAYMENTS household-external;
it is never silently combined with the named household fee pair.

The Google lookup returns one posted September 29 CAD $3.13 Google row on
WEEKLY SPENDING, with the note naming Google One 100 GB storage. Parent
separately reports a September 30 charged Google One 100 GB receipt with
matching total. That is supporting service evidence, not a verified
receipt-to-bank link or a direction to execute. The read tool does not
expose original_name, and the incumbent Atlas current-state tool returned
an internal error. Thus actual Atlas Other membership, production map and
the Google SERVICE _V descriptor are not independently confirmed here.
This repair does not drop that descriptor guard, parse notes into authority,
or mark the real Google occurrence paid by hand.

## Concrete independent reproduction

Every amount and identifier in month-end-bill-data.js is invented. Fees are
12 + 12 = 24, storage is 4, extra overdraft is 7, with two external fees.
September 29 transactions precede the September 30 scheduled occurrences.

Main attaches the fee pair to **August 30**, not September 30. September's
fee remains reserved at 24. The eligible Google charge has no identity hit,
appears in Other at 4, and its bill remains reserved at 4. Other is 7 + 4 =
11. The same fixture posted September 30 correctly settles both bills.
Separately, the generic Other bank fees category exclusion hides unmatched
fee rows even without any scheduled occurrence or transaction linkage.

Independent ledger: Bills 500 - 12 = 488; Weekly 0 - 12 - 7 - 4 = -23;
household cash 465. Correct expense partition is bills 24 + 4 and Other 7,
total 35 once. Main incorrectly reserves another 28 and offers 437 from
today. Correctly linked posted bills leave zero reserve, capacity 465.
Observed cash already includes posted expenses; Other is not deducted again.

## Bounded repair and unresolved evidence

The three named identity rules use the incumbent nearest-occurrence path,
with early lookahead capped at one day. Fees retain the two distinct named
accounts, now exact monthly-account-fee alias, debit and posted requirements.
Google retains its original descriptor, account, direction and excluded
product guards. The incumbent late-posting / nearest-due relation remains;
this is not a general date/amount deduplicator or automatic Google classifier.

Other bank fees is no longer a blanket cash-account bill category. Cash fees
need uniquely linked represented bills to leave Other through Forecast.
The incumbent Other bank fees classification on revolving cards is preserved,
including the unchanged annual-card-fee proof. This PR does not authorize a
new card-fee accounting policy or say that issuer fees settle tdfees.
Unmatched household-cash overdraft, NSF, foreign-exchange or other fees remain
visible. Card overlimit fees retain the incumbent issuer-fee classification;
they are separate from the scheduled cash-account fee pair. External fees
remain external. Refund credits are not new
debits or settlement evidence. Pending legs, incomplete coverage, duplicate
candidates, missing descriptors and single fee legs remain unconfirmed;
unresolved pending cash withholds precise funding under the existing trust
contract. No refund-netting policy or second liability is introduced.

Synthetic tests exercise observer, live overlay, Forecast, current-period
recon and funding. They reconcile the independent ledger, equal distinct
fee legs, extra fee types, wrong product/account/descriptor, ambiguous Google
charges, one/two-day early boundaries, pending-to-posted directed replacement,
refund/reversal exclusion, partial coverage, replay and unchanged canonical
bytes. The proof does not claim repair of a real Google row whose descriptor
is unknown. Production acceptance must verify the bank descriptor/mapping.

No UI source, financial amounts, real transactions, provider categories,
account map, baseline or credentials change. Parent handles independent
Systems Review and merge; publication is draft only.

## Currency acceptance boundary (Systems B1)

The independent review of e8fd8a9 reproduced foreign storage and mixed fee
legs incorrectly publishing raw USD numbers as CAD bill actuals. Account
currency did not qualify those transactions: observer normalization discarded
their currency before the newly eligible early matching path.

The three changed rules now explicitly require native CAD transaction
currency. Normalization preserves the unit; each rule qualifies it before
identity hits, pending-only actuals and representation. A native pending-to-
posted link checks both rows, including a CAD posted row whose linked pending
authorization was foreign or missing units. Missing, foreign or conflicting
units withhold settlement; to_base is never used as a conversion authority.
No FX policy is introduced.

Such evidence is retained as a sanitized currency diagnostic without a raw
amount in the published actuals packet. The packet is incomplete and Forecast
withholds precise remaining/funding claims with a currency reason. Unrelated
CAD transaction and bill amounts remain unchanged; observed bank cash stays
the actual balance, and the unconfirmed scheduled obligation retains its
reserve. This scoped opt-in does not retrofit all incumbent identity rules
with a global currency contract.

Invented controls cover USD/EUR/missing/empty units, unequal mixed fee legs
7.23 USD plus 9.87 CAD, storage 2.45 USD with to_base 3.49, native replacements
with direct or inherited descriptors and currency conflicts in either
direction, pending-only foreign evidence, replay, CAD case normalization and
CAD replacements. CAD 12+12 fees and CAD 4 storage still reconcile the
independent 465 cash / 7 Other / 465 capacity oracle. Existing supported-CAD
fee and storage fixtures now state their units explicitly; their financial
assertions are unchanged, including the annual-card-fee proof.

## Noncandidate currency boundary (Codex P2)

Exact head 97a26fd fails the added independent regression: a USD Google /
SERVICE _V Refund credit yields one currency failure despite being unable
to satisfy the debit rule, and withholds otherwise qualified current funding.
The observer now reuses collectIdentityHits with only the currency guard
temporarily absent to test candidate eligibility. The real settlement path
still requires native CAD. Direction, mapped account, descriptor, exclusion,
scheduled occurrence and its permitted posting relation all remain incumbent
matcher decisions; this helper neither represents nor settles anything.

The additional controls cover credits, zero, wrong account, excluded product,
wrong descriptor, an absent scheduled occurrence, an expired once occurrence,
negative fee legs and directed pending replacements of noncandidate refunds.
These rows cannot create the scoped settlement-currency failure. Existing
foreign/missing/mixed candidate and native replacement safety assertions are
unchanged and pass. This remains a three-rule settlement boundary, not a
global foreign transaction conversion or classification policy.

## Separate finding: card-purchase cash protection

A separate invented purchase/backfill snapshot proves no duplicate expense
after both legs post, but exposes an existing purchase-only gap. Bills 500,
card debt 400, allowance 150 and minimum 25 initially offer capacity 325.
After an 80 card purchase without backfill: Bills remains 500, debt becomes
480, spending 80, allowance remaining 70, capacity incorrectly becomes 405.
After the 80 backfill: Bills 420, debt 400, remaining 70, capacity 325 again.
The purchase alone frees 80 because cash protection omits its coverage need.
The separate owner-directed purchase-coverage reserve contract needs review;
this PR does not implement an allocation store, payment intent convention,
new minimum policy or financial schema. Parent owns that follow-up.
