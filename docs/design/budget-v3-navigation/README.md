# Budget v3: one period overview and evidence sheets

This outcome starts from actual merged main
`cd491445e13a0fd41c9f48d56e2553c268135b23` (#486). The reference remains
open PR #480 at `ad910ac2da1ac2f83d5de6aed983cff6bb275be5`.
The approved desktop/mobile pixels were inspected before implementation.
The owner's later correction takes precedence over the reference's two cards:
one primary section, selector first, authoritative Bills-only Current balance,
period deductions, then Balance After Deductions once at the end. The result's
expanded evidence explains its scope without repeating its amount.

The two later live-feedback Library images could not be inspected locally:
the official materialization helper failed on Windows because `os.setxattr`
is unavailable. No real household screenshots, values, credentials or scaled
real data are included. The owner's explicit written correction was applied.

## One working interaction

The date header uses Forecast's selected published period bounds. Its day
progress uses the published financial as-of and shared date routines; missing
or invalid dates remain unknown. Month bounds may be a clipped projection
window and are labelled accordingly. Previous/next and the on-demand month
and period wheels select existing published rows. Month selection uses the
existing trajectory selector. No browser-clock financial dates are invented.

Current Bills cash remains current when a past or future period is selected,
with an explicit qualifier that it is not that period's opening. Full-period
income never includes current cash. Opening context, the current-cash proposal,
trust explanations and all existing evidence remain available through info.

Mobile Overview/Spending/Bills/Upcoming controls provide working evidence
shortcuts. Spending opens the incumbent household targets/actuals/transactions;
Bills opens the incumbent bill/debt/payment evidence; Upcoming opens the exact
published funding row. These are interim entry points until the complete
section layouts are built. They are not demo toggles or fabricated sections.

One native modal sheet moves the existing evidence DOM node into the sheet and
restores it on Back/Escape. It does not copy generated HTML or financial packets.
The background is inert, Tab is contained, and the exact original trigger
receives focus. Stable component identity also preserves an open sheet across
rerender/resize. The #486 advisory is covered: open Next payday at 390px,
resize to 1440px, then Back returns to Next payday, not Info. Nested financial
drilldowns remain native within their existing evidence bodies.

## Independent financial proof

The invented fixture independently reconciles period income 4,050 minus bills
1,665 minus household 752.99 to 1,632.01 before unavailable proposed savings.
Current Bills cash is separately 1,215; adding the spending account's 160 is
not permitted in that headline. The current pooled funding capacity remains
1,375 minus remaining bills 265, household 308.50 and floor 300 = 501.50.
An observed grocery overrun of 200 raises household reserve by 58.55 and lowers
the period result to 1,573.46. A negative spending account and large savings
leave the Bills headline unchanged while preserving transactions/obligations.
Known signed deficits, overflowing bars, known zero income, explicit nulls,
wrong account identity and unavailable trust keep the existing contract tests.

Forecast is the sole financial authority. The layout module reads no money or
trust field. No engine rules, canonical household amounts, buffers, baseline
assignments or account mappings are changed. Configured starting savings
assignments remain unconfirmed; no zero is assumed.

**Required-carryover publication gap remains open.** The incumbent
`protectedPath.allocated` is current pooled protection after obligations and
essentials. It is not Bills-only cash or selected-period required carryover.
It remains behind info with its explicit scope and is never subtracted from
the headline. A default selected-period/Bills-only carryover needs a matching
Forecast publication seam and independent financial proof in a later outcome.

## Actual browser captures and comparisons

| Width | Single overview | Reference comparison | Funding evidence |
|---|---|---|---|
| 1440px | [Overview](current-1440.png) | [Compare](comparison-1440.png) | [Detail](today-details-1440.png) |
| 390px | [Overview](current-390.png) | [Compare](comparison-390.png) | [Detail](today-details-390.png) |
| 320px | [Overview](current-320.png) | [Compare](comparison-320.png) | [Detail](today-details-320.png) |

Evidence sheets: [period picker](period-picker-390.png),
[spending](spending-sheet-390.png), [bills](bills-sheet-390.png),
[upcoming](upcoming-sheet-390.png), [mobile-to-desktop Next payday](next-payday-resized-1440.png).
Narrow states: [unknown assignments](withheld-320.png),
[unavailable plan](unavailable-320.png), [signed overflow](overflow-320.png),
[known zero income](zero-income-320.png).

Full captures retain the real mobile dock; keyboard checks prove focused
controls scroll clear of it. Comparisons show the intentional owner override
as well as outstanding design differences. They are not a visual-completion
claim. All requests in the browser harness are intercepted invented fixtures.

Validation commands: `node test/test-budget-surface.js`, the related Budget,
funding, household, bill evidence, Prepare Ahead and authority suites;
`node test/test-plan-unavailable-surface.js`; `npm test`;
`CHROME_PATH=<Edge> NODE_PATH=<Playwright> node test/browser-budget-v3-period.js`.
The PR proof records final-head results and any host limitations separately.

## Finite remaining design checklist

| Design difference | This outcome | Remaining closure |
|---|---|---|
| Selector first; one current/period flow; final shown once | Implemented and browser/contract verified | Owner visual review of the override |
| Published date header, day progress, period/month navigation | Implemented; missing dates fail closed | Complete month visual hierarchy |
| Tap evidence, Back, keyboard and resize focus | Implemented for current/info/picker/period rows/section shortcuts | Integrate future full section components into the same sheet |
| Spending category bars, targets/actuals and Worth a Look | Existing evidence preserved on demand | Build the actual approved category layouts using shared selectors |
| Grouped bill rows, status and payment detail hierarchy | Existing bill/payment evidence preserved | Build approved grouped default section with incumbent payment truth |
| Today and next-payday funding layouts | Current/next evidence reachable; scope preserved | Full approved layouts and the matching carryover publication seam |
| Remaining overview/month sections and final responsive finish | Unknown assignments and unavailable states preserved | Finish hierarchy, spacing, section content and reference parity at desktop/mobile/320px |

The next outcomes should close coherent complete section interactions, not
publish successive cosmetic-only PRs. The full v3 visual target is unfinished.
