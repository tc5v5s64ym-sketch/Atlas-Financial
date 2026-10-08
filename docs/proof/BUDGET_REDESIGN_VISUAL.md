# Budget redesign PR A — visual proof

Fixture browser proof for the pay-period Budget bento. Every shot uses `test/fixtures/budget-surface-data.js` through the existing page scripts, except the two card shots, which use `test/fixtures/card-period-movements-data.js`. Nothing here was read from the live site, and no figure was copied from the design prototype.

## Placement

A slim header row sits above the grid: Pay period / Month, the period arrows, the range, and Choose period. The Overview / Spending / Bills / Upcoming chips are not on the face.

Desktop, two columns. The hero is one glass tile on the left, spanning the income tile and the payday tile on the right. Its face is one equation row: each term is a label over a full-period number, with spaced minus signs between Income, Bills, and Household budget. Bills account is a small pill on that same row, at the top right. Balance After Deductions is a label on the next line, then the large number with the est. pill after it. Planned Savings and the expected Bills balance at period end are two small pills at the bottom. Bills is the calendar tile under the hero. Household budget is the liquid-ring tile beside it, with a thin left arc on each ring. Card movement is a compact vertical list under Bills, one row per card, at every width. Saving for shows only the rings and the legend. Upcoming costs & savings and Where it comes from are glass tiles under the grid, with the one-pot Today and Payday views still visible. Worth a look stays on the page, after recorded balances. The privacy paragraph sits inside “More on this page”. Recorded account balances, Savings accounts & evidence, and the snapshot stay behind that row.

On a narrow screen the header stays above the grid. The hero equation stays a three-column grid, label over number, and the Bills account pill sits on the line above that grid. The order is hero, Bills, Income beside Payday, Household, Cards, Saving for, then the funding tiles. Card rows stay vertical, with no sideways scroller. Deposit dates sit on a muted second line. Body padding at the bottom matches the floating nav height. At 390, after scrolling to the end of the page, the “More on this page” row sits above the dock. A full-page capture still paints the fixed dock over the stitch. That overlap is the capture, not the scrolled page.

The income headline is the full-period plan figure already rendered, with an est. pill when that figure is already marked estimated. Deposit rows copy the income lines the page already prints. The actual/planned sentence stays visible as a quiet line under those deposits, using the step text the page already rendered. The payday number is the digit already printed in “in N days”, centred in an arc ring. The date at the bottom left is the published payday date, without a weekday the page does not print. The payday sentence stays in the DOM as screen-reader text and is not on the face. A future period with no “in N days” digit shows the word Unavailable inside the ring, at a smaller size, and the ring stays inside the tile. Planned Savings and the period-end Bills line are the figures the page already renders, shown as pills. Each goal legend shows one status word. Saved, Needed, and this period stay on the source rows, which remain in the DOM at zero height. A missing status is left blank rather than renamed Unavailable.

## #546 and #547

Card movement keeps the published heading, aria-label, hooks, and fail-closed words. The glass tile is the wrapper. The strip itself stays transparent with no border. Each row is the name, the net or “Net unavailable”, a short direction mark, and the chevron, separated by a hairline. The mark is not scaled to the net change. The same vertical list is used below 600px. `budget-blend-cards-1440-light.png` and `budget-blend-cards-320-dark.png` are that fixture.

#547’s Saving for rows stay under `[data-budget-savings-goals]`, including Saved, Needed, and This period. The legend shows the status word. The source rows stay in the DOM for the existing hooks and are not closed details. The funding section keeps its Today and Payday tabs and the “Currently backed” lines. Those hooks are not clipped.

The household spent-to-date figure and the “N of M known categories over plan” count stay visible on the Household header, with “$X left” on that same header. Still planned, From today, and the cycle dates sit in Household detail. Income keeps its actual/planned line. The Bills face is the header and the calendar. Paid, not paid, and to-confirm lists, the ratio, the remaining sentence, and the plan-deduction line stay in the Bills detail panel, in the DOM, hidden until Details is opened. Balance after bills stays in the DOM and is not on the face. The latest recorded Bills balance, a cash shortfall or funding-gap notice, and the period-info disclosure sit in Period figures. Per-category rows stay collapsed. A ring opens that category’s sheet from the keyboard, and an over-plan category shows the existing over-plan word on its ring. Unknown household categories use the hatched unavailable marker and do not draw a liquid level. When Other spending already prints “of planned …”, including “≈estimated”, that phrase is copied onto the visible footer row.

## How it was run

```bash
CHROME_PATH=/usr/bin/google-chrome node test/browser-budget-blend-proof.js
```

Playwright served `public/` at `http://budget.test/` and aborted every other origin. Light and dark used `hfd-theme` / `data-theme`. Viewports were 1440, 390, and 320. One fail-closed packet (`unavailablePlan`) was shot in light at 1440 and dark at 390. The next pay period is `budget-blend-1440-light-next.png`, so the Unavailable payday word and the contained ring are in the set. The shots were taken with motion allowed so the rings and payday arcs paint. The stylesheet still removes tilt and the confirm-dot pulse when `prefers-reduced-motion: reduce` is set. Each payday arc is a circle stroke with a dash gap; that rotation is the layout of the days. In dark mode the pressed Pay period control is the light pill and Month is not.

## Contrast and focus

Sampled text against its painted background was at least 4.5:1 for body text and 3:1 for large text, in both themes. The receipt lists each sample.

Tab order from the top of the light 1440 page includes the household destinations, the period controls, and the hero. Each of the first 18 stops had a solid outline of at least 2px.

## Files

Screenshots and `budget-blend-browser-receipt.json` in this directory. The proof script is `test/browser-budget-blend-proof.js`. It is not in the `test/test.js` registry.
