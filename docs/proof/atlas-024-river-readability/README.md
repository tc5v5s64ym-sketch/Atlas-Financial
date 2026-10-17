# ATLAS-024: whole Budget timeline labels

One presentation outcome: a painted selected amount remains whole and clear
inside the existing river viewport; clipped context amounts and month/year
fragments do not masquerade as complete labels. Production changes are confined
to `place()` in `public/budget-river.js`.

## Current-state reproduction

The branch started from freshly fetched main
`c3ddcb782e520dc4d3e066681d9e8ff4bdbc541d`. Its native App/Forecast integration
clips context amounts and month/year labels at 320px and 390px in both themes.
Main later advanced to `d4d1284606ef34b097f788a50bc41de56872fa83` with released
startup-accessibility PR #639. That disjoint change was integrated into this
feature branch before the final proof; river/geometry and authority blobs were
unchanged on main. The PR's production diff against that main is still only the
river paint function.
An explicit river-component publication control also reproduces a clipped
selected negative sign: the unchanged `-$1234.6k` glyph box starts at
`-3.820313px` in the 296px mobile tile. Its full publication stays
`-$1,234,567.89` throughout. The component control is identified separately from
native Forecast fixtures in every record.

The invented native January fixture publishes January 1–14, 2027 and preserves
its signed amount and cents. That selected native value was already complete
before this repair; this proof does not claim an exact reproduction of the
owner's original hatched scene. Native clipping at the viewport edges and the
large-negative component clipping are independently reproduced defects.

| Phase | Exercised source | Result |
|---|---|---|
| Original clipping control | `f650c86a213f245822b24bacca92bdc1ba2058e1` | FAIL, exit 1; 74 boundary failures only; all 32 incumbent input controls pass |
| Selected-neighbour control | `e726483f5285617de205d4de758584ba5f930210` | FAIL, exit 1; four settled End-position separation failures; all 32 incumbent controls pass |
| Final repair | `c1c11e44563a406633f0e4b6cb69f36777f60184` | PASS, exit 0; 66 cases; no failures, page errors or external requests; all 32 incumbent controls pass |

The original control's runtime bytes equal main. The second control and final
repair use the exact same test blob. After it exposed the four collisions,
one production condition was changed so neighbouring labels also yield to an
undisplaced selected amount. The original clipping assertions remain unchanged.
The final harness additionally waits for the incumbent CSS opacity fade to
finish before checking separation; the transition itself is unchanged.

## Repair boundary

- Reuse the existing selected-label displacement and hit box to clamp a
  visible selected value inside the viewport. Preserve its period target.
- Reuse the existing neighbour-yield rule for every selected value, including
  a selected value that did not need displacement.
- Suppress partial context amount labels until their entire box fits; restore
  visibility as the camera or selection returns.
- Keep month/year labels whole inside the existing rounded corners, deriving
  clearance from the current radius and row position. Restore labels when clear.

The geometry authority in `docs/proof/TIMELINE_GEOMETRY_2026-10-10.md` freezes
gesture semantics and expressly forbids edge auto-pan. No camera, drag/fling,
keyboard, date, selection, period spacing, tile size, financial formatter,
calculation, input, trust, or unknown-state meaning changes. Forecast, assistant
packet, app/styles/plan sources, financial tests and the shared registry are
unchanged. No CSS change was needed.

## Native synthetic proof

Run from a clean checkout with external Playwright/Playwright Core and installed
Edge/Chromium:

```text
NODE_PATH=<external modules>
CHROME_PATH=<browser executable>
PROOF_OUTPUT_DIR=<absolute directory outside checkout>
PROOF_BASELINE=<before/receipt.json>
RIVER_PORT_PROOF=1
node test/browser-budget-river-readability.js
```

The before execution omits `PROOF_BASELINE`. The final command compares its
66 records against that original before receipt: 48 native cases (two invented
fixtures × three true viewport widths × two themes × current/Home/End/Home-again)
and 18 explicitly identified component publication controls. Widths are 320,
390 and 1440 CSS pixels, device scale 1. Each phase has twelve hashed PNGs.

Receipts bind 226 public assets, scripts, fixtures, harness and package files to
exact Git blobs and raw SHA-256 bytes, verify served bytes, require a clean start,
and verify sources again at completion. Frozen source sections cover Spring,
lifecycle/adoption, geometry/curve, coordinate/hit mapping, input, selection and
canvas paint. Those hashes match before/after. The exact native OL HTML, slider
ARIA, selected date, pill HTML, hero signs/cents, label strings/trust states,
camera transforms and canvas PNG hashes also match across all 66 cases.
Positive, zero, negative and unknown publications are retained; the unchanged
prototype controls include a selected genuine-zero period.

The unmodified `proveRiverPort` assertions execute in both qualified phases:
eight native live-drag cases, six prototype comparisons, five yielded-neighbour
reselect cases, seven displaced-label hit targets and six held non-pan presses.
They include repeated and interrupted input, cancellation, touch, fling,
remount continuity and reduced motion. They are not replaced by the new bounds
checks. The dedicated browser proof is manual; no shared test registration changes.

Diagnostic numbers are stored to six decimal places, while assertions use
unrounded measurements. Monetary strings, HTML, Git bindings, hashes and image
bytes stay exact. These receipts are synthetic evidence, not household data.

## Supporting regression checks

`supplemental-checks.json` records exact-source results and bindings:

- Unmodified `test/browser-river-geometry-proof.js`: PASS, 24 geometry cases,
  nine selected-extreme captures, two held-drag captures, two breakpoint cases,
  seven resize transitions and 38 screenshot hashes. Run in an isolated clean
  clone to preserve existing committed geometry evidence.
- Unmodified `test/browser-budget-month-contrast.js`: PASS against the released
  Month after-receipt, 18 native cases, 126 amount records and six signed-hero
  controls, with no page errors or external requests.
- Nine focused Node suites: timeline contracts, native Budget surface, Month,
  signed cents, UI polish, pay-period swipe, timeline periods, period progress
  and synchronized wheels; all exit 0.

The supplemental file is a result/provenance summary. The full geometry and
Month output receipts and PNG sets remain outside the checkout. It records
their raw receipt hashes and exact source bindings without presenting rounded
copies of their measurements as original outputs. Hosted full-suite and review
results belong in the PR merge card.

## Hatch evidence gap and browser limits

Ten native fixture/theme diagnostics—ordinary, zero-income, no-scale,
withheld-savings and unavailable-plan, in both themes—found no visible
`repeating-linear-gradient` paint in the actual surface or its pseudo-elements.
The unavailable packet has no river. The current river source has known-run
gaps and a dotted zero line; Gface hides the older hatched ring treatment.
The separate untracked deposit-track rule exists but is not painted in these
fixtures. This is a bounded diagnostic, not a hatch-legibility PASS. Hatch code
is unchanged. An exact current native scene that actually paints the reported
hatch is still needed to reproduce and assess that part of the report.

Runtime: Node 24.18.0, headless Edge 155.0.4283.45, Playwright Core 1.64.1,
software Canvas2D (`--disable-accelerated-2d-canvas`). The geometry harness uses
an external launch-only preload; its hash is recorded in the supplemental file.
This is qualified software-renderer evidence, not default-GPU acceptance.
Fresh before/after pixels were inspected at mobile widths and desktop, in both
themes. No physical-device, zoom, screen-reader speech or production household
acceptance is claimed. All requests are intercepted local synthetic fixtures;
no provider, credentials or authenticated production tab is used. The protected
production tab was not reloaded, closed, discarded or otherwise manipulated.

Commits following the exercised source add only this proof directory. The final
publication must retain every exercised source blob; the builder checks those
bindings again before publishing. Draft only: independent exact-head Atlas
Contract / Systems Review remains PENDING, and this task authorizes no merge or
deployment.
