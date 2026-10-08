# Budget redesign PR A — visual proof

Fixture browser proof for the pay-period Budget bento. Every shot uses `test/fixtures/budget-surface-data.js` through the existing page scripts, except the two card shots, which use `test/fixtures/card-period-movements-data.js`. Nothing here was read from the live site, and no figure was copied from the design prototype.

## Placement

Desktop, two columns. The hero is one glass tile on the left, spanning the income tile and the payday tile on the right. Bills is the calendar tile under the hero. Household budget is the ring tile beside it. Card movement is the tile under Bills. Saving for is the goals tile beside the cards. Upcoming costs & savings, the one-pot Today and Payday funding views, stays a full-width block under that grid. Worth a look, Recorded account balances, Savings accounts & evidence, and the snapshot sit behind “More on this page”.

On a narrow screen the order is hero, Bills, Income beside Payday, Household, Cards, Saving for, then the funding block.

The payday number is the digit already printed in “in N days”. Planned Savings, the Bills balance pill, and the period-end Bills line are the figures the page already renders. A percent that the goal row does not already contain stays Unavailable.

## #546 and #547

Card movement keeps the published heading, aria-label, hooks, and fail-closed words. The glass tile is the wrapper. The strip itself stays transparent with no border. `budget-blend-cards-1440-light.png` and `budget-blend-cards-320-dark.png` are that fixture.

#547’s Saving for rows stay in the goals tile, including Saved, Needed, and This period. The funding section keeps its Today and Payday tabs and the “Currently backed” lines. Those hooks are not clipped.

## How it was run

```bash
CHROME_PATH=/usr/bin/google-chrome node test/browser-budget-blend-proof.js
```

Playwright served `public/` at `http://budget.test/` and aborted every other origin. Light and dark used `hfd-theme` / `data-theme`. Viewports were 1440, 390, and 320. One fail-closed packet (`unavailablePlan`) was shot in light at 1440 and dark at 390. The shots were taken with motion allowed so the rings and payday marks paint. The stylesheet still removes tilt and animation when `prefers-reduced-motion: reduce` is set.

## Contrast and focus

Sampled text against its painted background was at least 4.5:1 for body text and 3:1 for large text, in both themes. The receipt lists each sample.

Tab order from the top of the light 1440 page includes the household destinations, the period controls, and the hero. Each of the first 18 stops had a solid outline of at least 2px.

## Files

Screenshots and `budget-blend-browser-receipt.json` in this directory. The proof script is `test/browser-budget-blend-proof.js`. It is not in the `test/test.js` registry.
