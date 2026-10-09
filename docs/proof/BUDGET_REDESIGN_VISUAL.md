# Budget g-blend approved repairs — Draft #548

Owner source: the 2026-10-09 instruction to remove the separate Income tile,
show every Household line, preserve trustworthy historical pay-period figures
with missing data unavailable, and address the 18 browser findings. Keep Draft;
no Ready transition or merge. Final owner visual approval and release reviews
remain outstanding.

## Current-state verification

Verdict: **PARTIALLY FIXED** before this repair. Remote head was
`a713b1d5adfaccc82e9122158d75536293f7c3b5`. Its committed browser receipt had
18 failures, and `plan.js` and the river adapter suppressed every historical BAD
amount. The Household adapter already iterated every native category; no new
category renderer was needed. Current main
`f6ee6b84c96e5c87cb85aa9d7fdf9a9a7d6212fa` was inspected and integrated before
repairs. New private-history files from main are unchanged by this repair.

The original ZIP and extracted g-blend files are accessible. The approved
desktop light, desktop dark and mobile light PNG bytes match the SHA256 hashes
recorded in `budget-blend-browser-receipt.json`. Those references control the
visual comparison; prototype figures do not become financial evidence.

## Repaired face and evidence

Desktop has independent Hero / Bills / Cards and Household / Savings columns.
Mobile DOM and keyboard order is Hero, Bills, Household, Cards, Savings. Income
stays in the hero equation and opens its original native evidence; the separate
tile and its producer are removed. Payday stays off the face.

Household shows every native category, in native order, with three rings per
row at 1440, 390 and 320 pixels. The all-lines fixture has seven categories plus
Other Spending. Amounts, uncertainty, plan labels, category sheets and the
original Household disclosure remain native publications.
At narrow widths, the Other Spending qualifier gets its own line so it cannot
overlap or clip the separately printed amount. The all-lines proof checks this.

Historical BAD is printed only when Forecast publishes complete, finite,
trusted actual evidence for income, bills and Household for that exact period,
and the incumbent BAD terms close with a trusted finite result. This does not
recompute the figure, establish original historical targets, or replace the
assigned-deduction basis with an actual-payment sum. The native hero, Q07 and
hidden timeline share the same qualification. Qualified estimated BAD retains
its estimate mark. Missing evidence gives Unavailable and an empty amount hook.
Every valid period date remains selectable; unavailable values have no amount
geometry and break the river line. An explicit published zero remains zero.

Independent fixture checks include 4,017.25 payroll + 2,000 partner + 50 gift
minus 200 assigned deductions minus 40 Household = **5,827.25**, and a browser
case of 2,600 payroll minus 105 assigned bill minus 47.25 groceries minus 19.50
fuel = **2,428.25**. The receipts and settlement identities are invented test
evidence. They establish behavior, not a real household historical balance.

## Disposition of the original 18 browser findings

| Original findings | Count | Disposition and retained proof |
|---|---:|---|
| Geometry requires the clipped Household hold to be visible | 6 | Correct the stale face expectation. Verify the visible hero Income term and read the original hold/progress amount from Household Info. Preserve scroll, native source, geometry and disclosure checks. |
| Desktop tile slack | 2 | Remove the empty grid row made by the closed hero source disclosure and bound the hero minimum height. Savings measurement excludes clipped source children and measures the last visible content; overflow and padding remain checked. |
| Mobile Bills header | 4 | The approved flag-filled phone row omits numeric metadata. Verify that deliberate state rather than measuring a display:none element. Unavailable warnings stay visible; native amounts stay in the drawer. |
| Mobile Bills account pill alignment | 4 | Align the wrapped pill to the right edge of the hero top. Continue checking pill bounds and overlap with Household. |
| Household count on the face | 1 | Visibility respects closed native details. Open the original Q06 body and verify its count, amounts, qualifiers and returned keyboard focus. Historical disclosure assertions wait for the native dialog entrance to settle. |
| River adapter expected text | 1 | Compare exact printed currency, including the Unicode minus. Preserve native qualified historical values; do not override them by date role. Continue checking unknown gaps, zero, negative tone and Period figures access. |

## Browser proof

Run the existing fixture-only runner with Playwright and Chromium:

```powershell
$env:CHROME_PATH = '<Chromium executable>'
$env:PYTHON = '<Python with Pillow>'
$env:APPROVED_REFERENCE_DIR = '<exact approved reference PNG folder>'
node test/browser-budget-blend-proof.js
```

The current run uses Microsoft Edge Chromium on Windows. It serves repository
assets and invented fixture JSON at `http://budget.test/`, aborts other origins,
and invokes no live site or provider write. Light/dark, 1440/390/320, current,
future, incomplete history, qualified history, unavailable, cards, all Household
lines, native Bills filters and nested Back, Month, resize, disclosure focus,
contrast and reduced-motion behavior remain covered.

The receipt records results, exact reference hashes, source hashes and screenshot
hashes. `visualMatchApproved:false` remains an owner decision. Side-by-side images
are review evidence; differences caused by native unavailable data are retained.
The approved dark reference ends before lower tiles, so lower dark fidelity
has no approved reference. Physical touch and signed-in production are untested.

Useful captures:

- [Desktop light](budget-blend-1440-light.png) and [desktop dark](budget-blend-1440-dark.png)
- [Mobile light](budget-blend-390-light.png) and [mobile dark](budget-blend-390-dark.png)
- [Every Household line, desktop](budget-blend-1440-light-household-all.png), [390](budget-blend-390-light-household-all.png), [320](budget-blend-320-light-household-all.png)
- [Qualified history, desktop](budget-blend-1440-light-past-qualified.png), [390](budget-blend-390-light-past-qualified.png), [320](budget-blend-320-light-past-qualified.png)
- [Incomplete history](budget-blend-390-light-past.png)
- [Desktop comparison](side-1440-light.png) and [mobile comparison](side-390-light.png)

## Numerical and validation boundaries

Forecast, canonical data and the numerical snapshot script are byte-identical to
the integrated main. The 578-key numerical snapshot SHA256 remains
`6c941205cb1719d0e9063a1d8fe7af33663a2be75cd2dc23494512b8724271b5`.
Historical aggregate availability is an intentional presentation repair and is
proved separately through the real renderer and browser.

The PR merge card records the full-suite outcome and exact-head hosted checks.
Windows `test-private-period-history.js` is evaluated separately against unchanged
main when its filesystem operations fail. No out-of-scope history or Lunch Money
repair is included. Prior Systems PASS does not certify this repair head.
