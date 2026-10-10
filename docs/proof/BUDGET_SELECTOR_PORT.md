# Original g-blend selector port — Draft #548

Implemented in the existing builder task and PR, before any other widget port.
Owner source: [original-code instruction](https://github.com/tc5v5s64ym-sketch/Atlas-Financial/pull/548#issuecomment-6090989561)
and [light/dark clarification](https://github.com/tc5v5s64ym-sketch/Atlas-Financial/pull/548#issuecomment-6091424187).
No Ready transition, merge, deployment, provider write or separate Lunch Money work.

## Source correspondence

| Original component | Production port | Adaptation |
|---|---|---|
| index.html river subtree | budget-blend.js paintRiver | Original canvas/slide/values/months/playhead/pill/beam/orb; native ARIA and publications. |
| river.js Spring, monotone, layout, drawing | public/budget-river.js | Original 190/27 spring, .008 integration steps, Hermite curve, original 52/44 spacing, 164/152 heights, 28/24 radii, 40 seeded particles, bead pulse, 20px orb, 90px lens and 1.6 second reveal. |
| river.js bind/go/place/hover | budget-river.js | Original fit versus pan direction, .75/.25 velocity, 80ms freshness, .6 threshold, 140 projection, maximum four-position fling, keyboard and hover. Stable native capture survives tile remounts; cancellation drops queued selection. |
| app.js queueSelect/select | budget-blend.js native adapter | One native publication per animation frame while held; commit cancels stale queued scrub. Reuses the same river element/controller after every native remount; the original is-in class prevents the entrance replaying while held. |
| app.js Today and T | native header and controller | Return to actual published current period when available. No generated dates or page navigation. |
| blend.css river section and tile-in | budget-gface.css | Scoped original dimensions, compact labels, original dark colours/compositing/gradients/glow and entrance. Light palette follows the later owner instruction; reduced motion remains visible. |

The preserved original river.js is a test-only fixture. Its CSS fixture contains
the original river section with a test namespace. Neither enters a production
script chain. The original HTML/CSS/JS still match the ZIP. Raw original SHA256:

- `index.html`: `5d6e49cb4bd68d9838a16f0483f997e6684e2d5d6ac0d1a457a4a93a78740db9`
- `css/blend.css`: `768b4b9a13d51bf14cad12415e1ee0d1cf4d96b9b2cf8d48b4dd90cbb574b85d`
- `js/river.js`: `ea69d4fe3f24f9bf6a8becf8d5b9b014eff7bec1ae8de8f7e10324268d4d4ccb`
- `js/app.js`: `2e9c1371c2e946fb317f5bf7ddc03dba55a7f29b5151b492c26caee260debe34`

## Native ownership and deliberate differences

The adapter consumes ol[data-bad-timeline] and selects its exact actual date via
the incumbent native wheel. Forecast and plan.js still own dates, figures, trust,
historical qualification, panels and financial behavior. Full published currency
prints immediately; no numeric count-up or monetary interpolation is imported.
Known zero remains zero. Unknown values have dashes/Unavailable, no bead/orb/beam,
and break the curve, particles and lens across gaps. Missing dates cannot create
selection destinations. Native estimated amounts retain dotted estimate marks and
accessible qualification. Positive amounts receive no mockup tight threshold.

The light river differs from the ZIP's dark-both-themes CSS because Dale explicitly
requested light and dark. Wheel gestures preserve ordinary page scrolling unless
horizontal or the selector is focused. Vertical touch can scroll the page. Reduced
motion stops particles/spring/fling and keeps the selector visible. Animation
work stops when detached, hidden or disposed; the native dialog pauses drawing.
The brand remains the existing non-navigation label. Dale's subsequent browser comments authorized the focused hero, Household and HELOC repairs. See [the current panel report](BUDGET_PANEL_REPAIRS.md); other original interactions remain preserved.

No data.js, prototype sample finances, financial calculation/classification,
confirmation, recategorization or prototype panel money is used by production.
Test inputs are fixed invented publications, separate from the household preview.

The latest owner report of a clunky selector is repaired in [the focused smoothness proof](BUDGET_SELECTOR_SMOOTHNESS.md). The approved design and original motion constants remain unchanged.

## Independent browser evidence

Source commit: `7929a5ba2456c6f84c17a405e3f5b45b859d4ced`.
Integrated main: `657339f46862f187ba2ab81c066e5cd474318b2b`.
All actual source bytes equal Git blobs before and after the complete proof.
The [receipt](budget-blend-browser-receipt.json) records source/served/screenshot
hashes and the riverPort test results. Full proof: 55 screenshots,
191 bound files, 30 served assets, zero page errors or external requests.

- Native mouse drag begins on an amount label at 1440, 390 and 320 in light/dark.
  Native progress, hero period and visible range change before release. The same
  held gesture publishes a second period through a second remount; one river remains fully opaque throughout both remounts.
- Cancellation keeps the last actual native publication. Arrow navigation, Today,
  T, the three-state theme button and automatic OS colour changes are exercised.
- Emulated touch at 390 in both themes updates native selection before release;
  cancellation keeps its native result. This caught and repaired implicit canvas
  capture transfer being mistaken for cancellation on the stable mount.
- Six original/port comparisons use the same invented publications and pointer
  input. Width, height, fit/pan, x/y coordinates, slopes and sampled curve points
  match the independent original. All 80 actual spring steps match. Three dark
  static canvas comparisons have exactly zero differing RGBA channels. Wall-clock
  flowing particles are not claimed pixel-identical across separate RAF clocks.
- Resize and reduced motion are exercised. Paired screenshots use the same fixed
  camera/time; the original needs explicit redraw after a settled reduced resize.
- Existing full proof continues to cover native drawers, Bills filters, nested
  Back, Month, all Household lines, unavailable data, known zero, qualified versus
  incomplete history, current/future periods and layout/focus.

| View | Working native surface | Original comparison |
|---|---|---|
| Desktop light | [capture](budget-river-port-1440-light.png) | [pair](budget-river-pair-1440-light.png) |
| Desktop dark | [capture](budget-river-port-1440-dark.png) | [pair](budget-river-pair-1440-dark.png) |
| 390 light/dark | [light](budget-river-port-390-light.png), [dark](budget-river-port-390-dark.png) | [light](budget-river-pair-390-light.png), [dark](budget-river-pair-390-dark.png) |
| 320 light/dark | [light](budget-river-port-320-light.png), [dark](budget-river-port-320-dark.png) | [light](budget-river-pair-320-light.png), [dark](budget-river-pair-320-dark.png) |

Numerical snapshot against current main: all 582 keys unchanged, SHA256
`60b0328bc9174270ef23c1bba6e2d61f52cc674204ad6cd07728ad6eeabc8ac6`.
Physical-device touch and signed-in production remain untested. Builder proof
does not provide formal Systems PASS or final visual approval. Keep Draft.

The latest date-formatter dependency repair and its validation are recorded in [the CI repair report](BUDGET_SELECTOR_FORMATTER_CI_REPAIR.md). Source binding above is refreshed by the complete clean-start proof after that repair.
