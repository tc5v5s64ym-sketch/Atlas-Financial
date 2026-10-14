# Savings TD card recipient proof

All amounts, dates, labels, references and provider rows in this proof are
invented. No owner screenshot or private source payload is published.

Released base: `76aacf6f57824ab253a018e3e3012951b4315533`.
Implementation/test source: `a528c7dcfa02c472d1f9832997b7a13569c6ef7a`.
The proof commit adds only this directory; its runtime/test blobs remain bound
to that source commit by the SHA256 digests in `proof.json`.

Standing recipient-class authority is the answered Q2 in
`docs/01_OPEN_QUESTIONS.md`: the exact TD `reference TFR-TO C/C` bank form means
payment to a known card. It does not identify an individual card, payment purpose
or expense settlement. Source normalization retains that class as a boolean;
Forecast still qualifies the posted debit and its own balance cutoff.

Run `node --test test/test-savings-card-recipient.js`: 44/44 cases pass. Run the
same candidate test against a base checkout using `ATLAS_TEST_APP_ROOT`: 10 fail
and 34 controls pass. Invented expected cents are independent: reports95 +24
sum119; a qualified future receipt1000 yields closing1119, with no historical
7.25 debit deducted again, no invented goal cost, and no actual settlement.
Projected trust remains estimated and money movement remains not granted.

Run `node test/proof-savings-card-recipient-before-after.js`: 13 exact-base
comparisons preserve source balances and settlement evidence. Six untyped
controls preserve entire native advice and original packet bytes exactly.
Only proven recipients acquire the boolean; unrelated packets acquire no false
marker. Recognized types deliberately change classification diagnostics;
qualifying Savings backing can also change its existing proposals and cash-plan
consumers. Those downstream figures are not claimed unchanged. A contradictory
cash destination now holds rather than being accepted as a generic cash pair.

Run `node test/browser-savings-card-recipient.js` with Playwright available and
`CHROME_PATH` set for the local Chromium installation if needed. The proof
intercepts every request: invented local GETs only, zero external calls/writes.
Ten cases at390/1440 pixels exercise Budget's selected future tile, expanded Info,
the existing evidence sheet and SavingsInventory, with replay and immutability.
Its sheet opener is exercised by keyboard; this is not Safari/phone pointer
acceptance. Each screenshot and32 served assets have digests in `proof.json`.

The separate required-card-coverage control remains unavailable after the
movement gate clears. Recognizing this recipient cannot supply a card opening,
credit match, allocation or complete coverage. Generic unmatched transfers,
unknown destination, payee/note lookalikes, wrong sign/direction, duplicate/replay,
pending, incomplete source coverage and ambiguous balance cutoffs still hold.

Full test results and independent exact-head Systems Review are recorded on the
Draft merge card. Owner source reconciliation and device acceptance are separate
from this wholly synthetic proof.
