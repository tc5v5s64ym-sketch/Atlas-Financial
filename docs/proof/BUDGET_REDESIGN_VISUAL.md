# Budget redesign PR A — visual proof

Fixture browser proof for the pay-period Budget bento. Every shot uses `test/fixtures/budget-surface-data.js` through the existing page scripts. Nothing here was read from the live site, and no figure was copied from the design prototype.

## What the shots show

The hero keeps the published equation in source order: Income, Bills, Balance after bills, Household budget, then Balance After Deductions, with Planned Savings on the same waterfall. Current balance stays the Bills-account figure. Expected Bills balance at period end keeps its own slot, including the Estimated stamp. The payday tile is the existing window progress (Day 7 of 14, next payday). Household budget and Bills are the existing browse sections. Saving for is the existing goals block. Unavailable, estimated, and To confirm wording stays on the page.

Household sits left of Bills because that is the source order of those sections, so keyboard focus moves left to right. The prototype draws Bills on the left; swapping the tiles would focus the right-hand tile first.

## How it was run

```bash
CHROME_PATH=/usr/bin/google-chrome node test/browser-budget-blend-proof.js
```

Playwright served `public/` at `http://budget.test/` and aborted every other origin. `prefers-reduced-motion: reduce` was on. Light and dark used the existing `hfd-theme` / `data-theme` mechanism. Viewports were 1440, 390, and 320. One fail-closed packet (`unavailablePlan`) was shot in light at 1440 and dark at 390.

`test/browser-budget-v3-period.js` also passed at 1440, 390, and 320 on this head: one overview card, static today column, no horizontal scroll, and the same published figures.

## Contrast and focus

Sampled text against its painted background was at least 4.5:1 for body text and 3:1 for large text, in both themes, including the payday tile and the unavailable card. The receipt lists each sample.

Tab order from the top of the light 1440 page: the six household destinations, then Pay period, Month, the previous/next period controls, then the rest of the hero and tiles. Each of the first 18 stops had a solid outline of at least 2px. Focused shots: granularity, Income, Balance After Deductions, a household category, and a savings goal.

## Files

Screenshots and `budget-blend-browser-receipt.json` in this directory. The proof script is `test/browser-budget-blend-proof.js`. It is not in the `test/test.js` registry.
