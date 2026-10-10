# Savings group members — browser proof (PR #571, repair of Systems Review 5480089910, Finding 3)

## What was wrong

The grouped-member markup added by this PR placed a nested
`<ul class="budget-savings-members">` inside the sheet's goal row
(`<li data-budget-savings-total-goal>` of `.budget-savings-contributions`).
Two incumbent CSS facts broke it:

- `.budget-savings-contributions li { display:grid; … }` is a **descendant**
  selector, so every member `<li>` also became a goal-row grid.
- The members `<ul>` itself is a **fourth grid child** of the goal row and
  spanned nothing, so it was squeezed into the first grid column.

Measured on the reviewed head's CSS (desktop 1280, light): each member entry
was 209px wide and **408–524px tall**, with the member name wrapping one
character per line — unreadable. At 390/320 the ≤520px media query masked
part of it (members 95–115px tall, still confined to the first column).

## The narrow repair (authorized by the review for this surface)

`public/budget-surface.css`, savings-contributions region only:

- The goal-row rules are scoped to direct children
  (`.budget-savings-contributions > li`), so member entries no longer inherit
  the goal-row grid.
- `.budget-savings-members` spans the goal row's full grid width
  (`grid-column: 1 / -1`) with a small subordinate indent, and its entries
  get their own grid with the same three-column rhythm as the goal rows
  (two columns under the existing ≤520px media query, mirroring the goal
  rows' responsive treatment). No other rules change; no other surface is
  restyled.

## Method

Harness: `test/browser-savings-group-members.js` (Playwright + headless
Chromium, the repo's browser-proof pattern). The real App boots on an
invented ledger (the savings-daily-consumer fixture plus a third grouped
commitment), so Forecast itself publishes the three-member group; the
Budget tile, the Planned Savings detail sheet and the Savings inventory
embedded in the sheet's Info details are captured at **1280 / 390 / 320 px**
in **light and dark** themes. The "before" captures use the reviewed head's
CSS (this repair round's JS changes do not alter markup or layout, so the
CSS is the only layout variable); the "after" captures use the repaired
CSS and the harness's assertions enabled:

- exactly three separate member entries per surface, in published order;
- every entry has a real box and no horizontal text overflow
  (`scrollWidth ≤ clientWidth`);
- every entry prints its published needed figure (60.00 / 170.00 / 90.00);
- the sheet's member list spans the goal row's full width
  (computed `grid-column: 1 / -1`; measured list width = goal-row width);
- no document-level horizontal overflow at any width.

## Results (sheet, member entry height / list width vs goal-row width)

| Width | Theme | Before | After |
|---|---|---|---|
| 1280 | light/dark | 408–524px tall, name one character per line, list in first column only (entry 209px of a 452px row) | 43px rows, list 452px = row 452px |
| 390 | light/dark | 95px tall, first column only | 84px rows, list 358px = row 358px |
| 320 | light/dark | 115px tall, first column only | 84px rows, list 288px = row 288px |

Inventory entries render as three separate readable entries at every width
and theme, before and after (that surface had no grid defect). Full
measurements, runtime and screenshot SHA-256 hashes:
`savings-members-before-report.json` and `savings-members-after-report.json`
in this directory; the harness also records the source-file hashes of
`public/plan.js`, `public/savings-inventory.js`, `public/budget-surface.css`
and `public/savings-inventory.css` that produced the captures.

## Tile note (measured, incumbent behaviour)

On the Budget bento, the savings tile face is a fixed-height summary
(266px, `overflow: hidden`). The tile card's member rows render below that
fold — the same position the goal context line occupies — and are read in
the Planned Savings sheet the tile opens, which is the sheet proven above.
The harness records the member rows' presence and published figures inside
the tile card (`firstMemberTopRel` in the reports) and captures the tile
face as rendered; the face's clipping is the blend shell's incumbent
presentation for all below-fold tile content, not a defect this PR
introduces or widens.

## Artifacts

`docs/proof/browser/members-{tile,sheet,inventory}-{1280,390,320}-{light,dark}-{before,after}.png`
(36 captures), plus the two report JSONs named above.
