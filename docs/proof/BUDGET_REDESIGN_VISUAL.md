# Budget redesign PR A — visual proof

Fixture browser proof for the pay-period Budget bento. Every shot uses `test/fixtures/budget-surface-data.js` through the existing page scripts, except the two card shots, which use `test/fixtures/card-period-movements-data.js`. Nothing here was read from the live site, and no figure was copied from the design prototype.

## Placement

A slim header row sits above the grid: Pay period / Month, the period arrows, the range, and Choose period. The Overview / Spending / Bills / Upcoming chips are not on the face.

Desktop, two columns. The hero is one glass tile on the left, spanning the income tile and the payday tile on the right. Its face is the full-period equation Income − Bills − Household budget, then Balance After Deductions. Bills account is a small pill at the top right. Planned Savings and the expected Bills balance at period end share one quiet line at the bottom. Bills is the calendar tile under the hero. Household budget is the liquid-ring tile beside it. Card movement is a vertical list under Bills. Saving for shows only the rings and the legend. Upcoming costs & savings and Where it comes from are glass tiles under the grid, with the one-pot Today and Payday views still visible. The privacy paragraph and Worth a look sit inside “More on this page”. Recorded account balances, Savings accounts & evidence, and the snapshot stay behind that row.

On a narrow screen the header stays above the grid. The order is hero, Bills, Income beside Payday, Household, Cards, Saving for, then the funding tiles. Below 600px the card track still scrolls sideways so five cards fit; at 601px and above each card is one full row. Body padding at the bottom matches the floating nav height. At 390, after scrolling to the end of the page, the “More on this page” row sits above the dock. A full-page capture still paints the fixed dock over the stitch. That overlap is the capture, not the scrolled page.

The income headline is the full-period plan figure already rendered, with an est. pill when that figure is already marked estimated. Deposit rows copy the income lines the page already prints. The payday number is the digit already printed in “in N days”. The date under the ring is the published payday date, without a weekday the page does not print. Planned Savings, the Bills balance pill, and the period-end Bills line are the figures the page already renders. A percent that the goal row does not already contain stays Unavailable.

## #546 and #547

Card movement keeps the published heading, aria-label, hooks, and fail-closed words. The glass tile is the wrapper. The strip itself stays transparent with no border. Each row has a short direction mark. The mark is not scaled to the net change. `budget-blend-cards-1440-light.png` and `budget-blend-cards-320-dark.png` are that fixture.

#547’s Saving for rows stay under `[data-budget-savings-goals]`, including Saved, Needed, and This period. They are visually collapsed on the tile and remain in the DOM for the existing hooks. The funding section keeps its Today and Payday tabs and the “Currently backed” lines. Those hooks are not clipped.

## How it was run

```bash
CHROME_PATH=/usr/bin/google-chrome node test/browser-budget-blend-proof.js
```

Playwright served `public/` at `http://budget.test/` and aborted every other origin. Light and dark used `hfd-theme` / `data-theme`. Viewports were 1440, 390, and 320. One fail-closed packet (`unavailablePlan`) was shot in light at 1440 and dark at 390. The shots were taken with motion allowed so the rings and payday marks paint. The stylesheet still removes tilt and the confirm-dot pulse when `prefers-reduced-motion: reduce` is set. The payday ring rotation stays, because that rotation is the layout of the days.

## Contrast and focus

Sampled text against its painted background was at least 4.5:1 for body text and 3:1 for large text, in both themes. The receipt lists each sample.

Tab order from the top of the light 1440 page includes the household destinations, the period controls, and the hero. Each of the first 18 stops had a solid outline of at least 2px.

## Files

Screenshots and `budget-blend-browser-receipt.json` in this directory. The proof script is `test/browser-budget-blend-proof.js`. It is not in the `test/test.js` registry.
