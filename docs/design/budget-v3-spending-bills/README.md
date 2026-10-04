# Budget v3: published category bars and grouped bill evidence

This outcome starts from merged main
`9a0ec4e6d0399cd3c9608609ae3a8af3426a9680` (#487). The visual reference remains
open PR #480 at `ad910ac2da1ac2f83d5de6aed983cff6bb275be5`. Its actual desktop,
mobile and 320px spending, bill and attention pixels were inspected before
implementation. Reference captures replace amounts and personal labels with
independent invented fixtures. They retain the prototype layout, including
its mobile dock. No live household data, scaled real amounts or credentials
are included. The two later Library feedback images remain locally unavailable
because the official helper needs Windows-unavailable `os.setxattr`; the
owner's explicit written correction governs the primary overview.

## One complete section interaction

The selected published pay period now has the approved category/bar hierarchy
and grouped bill card below its single primary overview. Category rows show
Forecast's plan, observed spending, published remaining or overrun, and
dimensionless bar geometry. Other spending stays hatched and unassigned.
Missing spending cannot be classified within plan; missing plans withhold
ratio geometry without losing known observations. Counts explicitly cover
only categories with known spending and remaining estimates.

The counted household reserve is the existing selected-period publication.
The separate current-only "Still planned / From today" figure uses only the
matching dated `Budget-from-today` publication with known amount, ready/gap
status, valid trust, matching financial as-of and matching period end. Future
and past selections do not borrow it. It is never reconstructed by adding
category rows. Today pace uses published cycle bounds and shared date helpers.

Bills are grouped from their published settlement/status: coming up, pending,
to confirm, paid/included in opening, and explicitly unavailable. An unverified
bill may already be paid; no date aging or unpaid inference is introduced.
Paid/total progress uses only a dimensionless published ratio. Known zero
bills are an explicit no-scale state; unavailable inputs remain hatched.
The deduction explanation keeps the assigned period load separate from
settlement evidence and amounts already settled in the opening.

Category, bill and their Worth a Look cards move the original transaction or
BillDetail DOM node into the existing single sheet, then restore it on Back.
Pending evidence, transaction totals, merchant details, paying-account context,
trust and unavailable explanations remain in the incumbent body. An ambiguous
bill occurrence opens the complete bill evidence instead of selecting an
arbitrary payment. Details/Why still reach the whole category/bill evidence.
Mobile Spending/Bills controls now navigate to the actual section heading.

Keyboard checks cover Enter, Escape/Back, original-node restoration, visible
exact-trigger focus, inert background, native nested disclosures, and refreshed
evidence after rerender and 390px-to-1440px resize. The #487 Next payday advisory
is addressed: focus is scrolled into view after the sheet scroll reset,
including on resize and return to mobile. Back also scrolls its exact trigger
into view. Capture-induced media-query rerenders are checked separately from
original-node identity; refreshed evidence is never a cached financial packet.

## Independent financial evidence

The unchanged invented fixture reconciles grocery spending 212.40 + 96.15 =
308.55 against a 450 plan, leaving the published 141.45. Household counted
reserve is 450 + 160 + 120 + 22.99 = 752.99. Current remaining household is
141.45 + 85.80 + 81.25 = 308.50. Bills total 1,400 + 120 + 85 + 60 = 1,665;
the paid mortgage is 1,400 and the outstanding/confirmable publication is 265.
These inputs independently reconcile full-period income 4,050 minus bills
1,665 minus household 752.99 to 1,632.01 before unavailable proposed savings.
Current Bills-only cash remains separately 1,215, never pooled cash or income.

An extra observed grocery purchase of 200 produces 508.55 spent and a 58.55
overrun. The published reserve rises to 811.54 and the final falls to 1,573.46.
Signed deficits, no-income states, negative spending-account cash, untrusted
refreshes and unknown savings assignments retain the existing financial proof.
Publication fault injection proves the new summary does not sum category rows,
borrow another period's funding, or print an explicitly unavailable reserve.

Forecast remains the sole financial authority and BudgetSurface the one active
renderer. The layout module reads no money/trust field. No Forecast rules,
canonical amounts, account mappings, floor or baseline assignments changed.
Configured savings assignments remain unconfirmed. The existing pooled
`protectedPath.allocated` remains qualified behind info; it is not selected-
period Bills-only required carryover. That publication gap remains open.

## Actual captures and visual comparisons

| Viewport | Spending comparison | Bills comparison | Attention comparison | Active overview |
|---|---|---|---|---|
| 1440px | [Spending](comparison-spending-1440.png) | [Bills](comparison-bills-1440.png) | [Attention](comparison-attention-1440.png) | [Overview](current-1440.png), [compare](comparison-1440.png) |
| 390px | [Spending](comparison-spending-390.png) | [Bills](comparison-bills-390.png) | [Attention](comparison-attention-390.png) | [Overview](current-390.png), [compare](comparison-390.png) |
| 320px | [Spending](comparison-spending-320.png) | [Bills](comparison-bills-320.png) | [Attention](comparison-attention-320.png) | [Overview](current-320.png), [compare](comparison-320.png) |

The reference has six planned categories and eleven bill rows; the active
independent fixture has three planned categories and four bill rows. Different
counts and amounts are input differences, not equality claims. Current scope
qualifiers and preservation of incumbent evidence take precedence over demo
labels or values. Nine comparisons were visually inspected; the full v3 design
is not declared complete. Overview comparisons also show the intentional owner
override of the prototype's two-card composition. Full captures retain the real mobile dock, while
section crops temporarily hide it to show unobscured content. Keyboard tests
separately prove focus remains above it.

Evidence: [category mobile](category-sheet-390.png),
[category 320px](category-sheet-320.png), [bill mobile](bill-sheet-390.png),
[bill 320px](bill-sheet-320.png), [resized category](category-resized-1440.png),
[resized bill](bill-resized-1440.png), [resized attention](attention-resized-1440.png),
[resized Next payday](next-payday-resized-1440.png).
States: [unknown assignments](withheld-320.png), [untrusted plan](unavailable-320.png),
[grocery overrun](overspending-320.png),
[missing spending with known zero income](zero-income-no-observations-320.png).

Reproduce with Playwright available through `NODE_PATH`, and `CHROME_PATH`
pointing to Chromium:

```text
ATLAS_BUDGET_SCREENSHOTS_DIR=<captures> node test/browser-budget-v3-period.js
node test/render-budget-v3-browse-comparisons.js <captures> <comparison-output>
node test/render-budget-v3-comparisons.js <captures> <comparison-output>
```

Every browser request is intercepted and served an invented fixture. No
provider, server credential or deployed data is contacted. Captures settle
fonts and render frames, reduce motion and disable capture animations.
Financial contracts: `node test/test-budget-surface.js` plus the seventeen
related Budget, household, bill evidence, funding and authority suites.
Required complete suite: `npm test`. Final-head results and host limitations
are recorded separately in the draft's proof.

## Finite full-design checklist

| Design difference | Current closure | Remaining work |
|---|---|---|
| Selector first; Current balance, deductions, final once | Preserved from #487; financial and browser proof | Owner visual review of the written override |
| Published dates, period/month navigation and progress | Preserved and regression checked | Complete Month section hierarchy |
| Category headers, actuals, remaining/overrun, bars, pace, unassigned state | Implemented with shared publications and original transaction sheet | Final typography/spacing parity across all real category counts |
| Grouped bills, progress, confirmation warning and folded paid group | Implemented from published settlement and original BillDetail | Final shared detail-sheet styling, while retaining all evidence |
| Worth a Look category/bill interactions | Implemented; keyboard and resize verified | Funding-gap and expected-income cards with their own publications |
| Today and next-payday funding layouts | Existing evidence retained; Next payday visibility fixed | Complete approved funding layouts and exact carryover publication seam |
| Savings goals, upcoming/undated costs, Month components and full responsive finish | Unknown assignments and unavailable states retained | Remaining approved sections and final desktop/mobile/320px reference parity |

These are bounded remaining outcomes, not a claim that the approved visual
target has been completed by this slice. #480 stays open as the reference.

## Historical presentation repair

Review findings [4175917633](https://github.com/tc5v5s64ym-sketch/Atlas-Financial/pull/488#discussion_r4175917633)
and [4175917638](https://github.com/tc5v5s64ym-sketch/Atlas-Financial/pull/488#discussion_r4175917638)
were reproduced on `2234446c186a4c04e951cfa02b0480a798376b2d` through real
Forecast lookback publications, using additional independently invented inputs.
No engine total or settlement state changes in the repair.
The final consolidation builds on Cursor's remote repair
`d7d4a0fb7dd4f14476963513d0c942044b27d581`, preserves its helpers and regression
coverage, and adds real observation/settlement cases, explicit trust guards and
historical bill scope for paid and unconfirmed history. The paid-history test
now requires its published paid amount and paid group while rejecting an
actionable historical headline; no payment-state assertion was relaxed.

The Jul 31-Aug 13 fixture has groceries $47.25, fuel $19.50 and an Aug 7 bill
of $105. Full and posted-only coverage publish $66.75 observed spending;
missing, partial and truncated coverage withhold category spending. The
historical published hold then omits unproven spending and is $0, which the
new summary withholds rather than promoting it to zero observed spending.
An incomplete category publication or explicit unknown trust also withholds
the summary while preserving separately known evidence. Published known zero
observations remain zero.
Other spending is included when checking historical evidence completeness;
its missing amount cannot silently promote the historical total to observed.
Current known-category counts likewise exclude explicitly withheld observations.

Forecast seals an unresolved historical bill as `planned`, with `unverified`
settlement and $105 on its row, while the historical actionable remaining
total excludes it and is $0. The card now says **Completed-period bills** and
describes settlement evidence, not an amount due now. The To confirm warning,
paid group, original BillDetail and transaction sheets remain reachable.
Current and future views keep their own publications: the invented current
remaining amount is $370 with the earlier $105 unresolved, or $265 when its
payment is represented. No historical sum is substituted into either view.

The active-path suite covers missing/partial/truncated/full/posted-only coverage
crossed with paid/unverified settlement, plus publication trust failures and
known zero observations. The browser repeats coverage and settlement cases at
1440, 390 and 320px, exercises keyboard evidence access and restores focus.
See `history-missing-unverified-*.png`, `history-full-unverified-*.png`,
`history-full-paid-*.png`, and `history-partial-320.png`. Existing normal-view
reference comparisons are regenerated on the repaired head.
The rerender browser proof first establishes the visible original evidence
sheet before forcing a refresh; it then requires refreshed evidence and exact
visible focus after resizing. No timed sleep or removed assertion is used.
