# Selector smoothness — Draft #548

Source: Dale's latest instruction in the existing builder task: the date selector is clunky; make it smooth like the original g-blend mockup. Current-state verdict before editing: STILL BROKEN, code required. The isolated branch and Draft PR head db7e888 were checked; current main 657339f46862f187ba2ab81c066e5cd474318b2b was integrated and remained current. Main retains the incumbent native Budget selector; this repair continues the owner-approved #548 port. No owner decision is needed to build this repair. Final visual/release acceptance remains pending; keep Draft.

## Focused repair

- Retain the original river, canvas, label nodes, spring state, focus and pointer capture while native tiles update. Selection no longer resets canvas dimensions or rebuilds the entire printed year.
- Retain the original Aurora canvas/WebGL context through period remounts. Measure its final board size after writes instead of recompiling the shader between them.
- The river invokes the same native wheel selection function through a bounded period-selection event. It does not focus the hidden wheel while held. Compatibility clicks remain available to older/minimal mounts.
- Reuse locale formatter objects, never formatted financial results. Self-contained helpers preserve the existing standalone renderer test paths. Legacy local-date and currency strings match an independent built-in locale oracle, including signs, cents, zero, invalid dates and year boundaries.
- One resize listener follows the current board; discarded boards no longer accumulate resize listeners. New publications with the same dates rebuild labels/geometry when their native values or qualification change. ResizeObserver updates real geometry/pill width; window-resize and DOM-move compatibility paths remain.

The original 190/27 spring, .008 integration, fit/pan direction, spacing, heights, colours, reveal, velocity weighting and fling bounds are unchanged. Stateful DOM moves use [the browser's moveBefore API](https://developer.chrome.com/blog/movebefore-api) when available and fall back to normal insertion with visible focus restoration. No CSS design rewrite, sample finances, monetary interpolation, Forecast policy or provider work is introduced.

## Independent evidence

Exercised source: 7929a5ba2456c6f84c17a405e3f5b45b859d4ced. Source tree: 37d4fe03f0a94f06e0ea7cc495a8fa45e0945132. Integrated main: 657339f46862f187ba2ab81c066e5cd474318b2b.

Clean-start complete browser PASS: 55 screenshots, 191 tracked Git/raw-byte bindings and 30 served assets. Every source byte matched Git before and after execution. Receipt errors:[]; externalRequests:[]. Evidence-only publication must retain these exact source bytes.

Eight native held-drag cases cover 1440, 935, 390 and 320 pixels in both themes. The 935 cases add 24 invented recurring bills to exercise a larger native topology. Two consecutive updates publish the exact native date/period and hero figures before release while preserving the original element, all labels and the Aurora canvas, with no hidden-wheel focus. Keyboard, Today/T, cancellation, touch capture, resizing and reduced motion remain tested. Two same-date fixture refreshes go through real App -> Forecast -> native print -> river and prove that changed publications rebuild labels while preserving the canvas. Six separate original/port comparisons retain identical geometry and all 80 original spring steps; the three dark static canvas comparisons retain zero differing RGBA channels.

All 582 revision-owned numerical snapshot values match current main, SHA256 60b0328bc9174270ef23c1bba6e2d61f52cc674204ad6cd07728ad6eeabc8ac6. No canonical finances, Forecast calculator, account map, credential, provider state or separate Lunch Money implementation changes in this continuation. The previous fitted hero, all Household lines, native HELOC evidence, truthful Unavailable states and gapless board remain covered by the complete proof.

## Observed performance and limits

The preceding smoothness repair (source b76ac0f) used local Edge profiling of the same dated native preview at 935/390 pixels found repeated ~187-243 ms tasks before repair, including shader reinitialization, canvas/label rebuilds and hidden focus/layout work. After repair, the sampled river positioning median was ~0.1 ms instead of ~2.4-2.6 ms; retained adoption was ~0.1-0.2 ms instead of ~32-40 ms. Final sampled native update tasks were ~53-105 ms, and maximum frame gaps were ~100 ms at 935 and ~67 ms at 390 versus ~233 ms before repair. These instrumented local observations are separate from the raw-byte browser certificate. Native financial panels still have rendering cost; this is an improvement, not a universal 60-fps certificate.

Physical-device touch and signed-in deployment remain untested. Private working videos/captures use the dated native packet and are kept outside Git. Its existing unavailable observation is preserved; no private mapping guard is bypassed to manufacture spending. Full-suite/CI status is recorded in the PR merge card; this proof is neither formal Systems PASS nor final owner visual acceptance. No Ready, merge or deployment.

[935 light larger fixture](budget-river-port-935-light.png) · [935 dark larger fixture](budget-river-port-935-dark.png) · [complete receipt](budget-blend-browser-receipt.json).

The latest date-formatter dependency repair and its validation are recorded in [the CI repair report](BUDGET_SELECTOR_FORMATTER_CI_REPAIR.md). Source binding above is refreshed by the complete clean-start proof after that repair.
