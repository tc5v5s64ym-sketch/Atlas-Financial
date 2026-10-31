# Future Savings planned requirement roster

All cents, labels and screenshots here are independently invented. No provider
payload, household screenshot, credentials or production opening is included.

Base: `227108f54f62329d72621e8d129c2223cd953caa`.
Implementation source: `f6e886475695488db7c4c76d0c8cc65c2521300d`.
The subsequent proof commit changes artifacts only. `proof.json` binds the
32 actually served assets and eight test/fixture files to exact Git blob bytes,
and records eight screenshot hashes. No CRLF normalization is used.

## Independent date and requirement oracle

| Invented requirement | Planning date | Required CAD |
|---|---|---|
| Early installment | October 21 | 50 |
| Boundary installment | October 29 | 30 |
| Next installment | October 30 | 40 |
| Later goal | November 13 | 80 |

The first three belong to one installment group. At the inclusive October 29
close, the group has only its October 30 member, requiring 40; the later goal
still requires 80. At the November 12 close, only the later goal remains. At
the November 26 close, none remain. These are planned requirements, not proof
of actual payment. Undated requirements and overdue unproved costs stay visible.

On the base runtime, the final 16-case selected-roster suite has 14 failures and
two passing controls. Unqualified future views retain already elapsed planned
goals and their original grouped requirements. The implementation passes all
16, and the combined selected-roster/closing suite passes 64/64.

## Publication boundary

Forecast adds `savingsFunding.periodViews[].packet.plannedRequirements` only to
projected packets. It retires a requirement only when its dated, non-overdue
identity and cents match one unique native planned expense by selected close.
The surviving group requirement is summed in Forecast. Renderers perform no
date selection or monetary calculation. Missing or monetized roster fields,
duplicate members and mismatched selected dates fail closed in the shared
publication selector.

This field carries no saved stock, contribution, actual settlement or money
permission. Unknown closing stock and contribution remain unknown. Existing
explicit funding-gap presentations remain unchanged. Current and historical
packets retain their incumbent behavior.

Five complete synthetic recommendations match the exact base after removing
only this additive field: ready, unconfirmed card opening, missing actuals,
stale Savings evidence and an undated requirement. The comparison includes the
original current Savings publication and every incumbent native result.

## Actual consumer proof

`node test/browser-savings-selected-roster.js` passes eight cases across 1440px
and 390px, with the real keyboard period selector, Budget Savings tile, detail
sheet and inventory. It verifies first/second/all-retired views, inclusive due
dates, group requirements, current restoration, navigation replay, rerender,
input immutability and containment. All 42 existing closing-projection browser
cases also pass at 1440px, 390px and 320px. Both runs report zero page errors,
external calls or writes. See `proof.json` and `card-390.png` for the withheld
monetary case with the surviving planned roster.

This is synthetic browser proof, not physical Safari acceptance or fresh
provider qualification. Two configured sanitized Atlas current-state reads
timed out during live diagnosis. The existing owner card-opening question is
explicitly OPEN in `docs/01_OPEN_QUESTIONS.md`; no opening or allocation is
inferred here. Household future actual presentation is outside this repair.
