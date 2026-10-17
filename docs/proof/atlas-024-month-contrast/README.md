# ATLAS-024: Month amount contrast

The native **Month > Money in and out** card inherited the fixed `#1a2b33`
amount color from `public/budget-polish.css:636-639`. On its dark `#1b1b1a`
card this was 1.18:1. The active `.budget-v3-month .budget-month-amount`
selector now uses the incumbent `--text-primary` theme token. This is one
presentation declaration; no number, label, formatter, arithmetic or trust
publication changed.

| Evidence | Before | After |
|---|---|---|
| Exercised source commit | `8c74cbf834e3e121b03063e8f7cd1449929d6fe6` | `719fa3b86414f0a38554336bd9fd7adb0b4d32c8` |
| Result | FAIL, exit 1: 126 contrast failures only | PASS, exit 0: no failures |
| Dark computed and sampled raster contrast | 1.179747:1 | 15.780801:1 |
| Light computed and sampled raster contrast | 14.610968:1 | 18.283836:1 |
| Native Month cases / numerical amount records | 18 / 126 | 18 / 126 |
| PR636 large-negative hero controls | 6 passing | 6 passing, identical to before |
| Page errors / external requests | 0 / 0 | 0 / 0 |

The before commit has runtime bytes identical to main
`84a18e591cfe5e1f6e8f0648e540effecf2bdad8`; only the standalone test had been
added. The after source differs by the single scoped CSS declaration.
Receipts bind all tracked public assets, scripts, fixtures, the test and
package files to exact Git blobs and SHA-256 bytes, assert a clean start,
verify the served bytes, and verify unchanged source at completion. Each
receipt also hashes its nine PNGs. Later commits in this PR add only this
proof directory; the exercised runtime and harness blobs stay identical.

## Render proof

Native navigation runs the full App and Forecast with invented served-plan
fixtures: Period figures dialog > Month. Widths are 320, 390 and 1440 CSS px,
at device scale 1, in both themes. Three fixture variants cover estimated,
confirmed/calculated and large native amounts. Each case contains positive
income, outflow markers and genuine `$0.00` planned spending. A large native
income of `$1,234,567.89` is asserted.

Two explicitly identified publication controls use the actual incumbent
`budgetMonthComponentRow` renderer: calculated `-12.34` and unavailable/null.
These are component presentation controls, not injected Forecast inputs or
independent financial-engine proof. They assert exact sign/cents/trust and
unavailable copy distinct from zero. The earlier PR636 January 1-14 fixture
independently expects `-$1,230,723.51` and checks the complete dollar and cent
parts stay inside the hero at every width/theme.

The test independently computes WCAG luminance contrast from actual computed
foreground/card colors, then samples numerical text rectangles from the PNG,
excluding trust-pill text. Every raster sample contains the exact computed
foreground color; over 1,000 raster pixels confirm the opaque computed card
background. All 126 amounts exceed 4.5:1 after the repair.

The after run compares exact row HTML/text, labels, amount and row geometry,
numeric text ranges, trust tag HTML/colors/backgrounds, outflow accessibility
markers and unavailable copy with before. All are unchanged. There is no
horizontal card overflow or numeric text outside the card. All six PR636 hero
text/geometry/accessibility records are also identical.

Representative screenshots, visually inspected in addition to machine checks:

- [390px dark before](before/estimated-390-dark.png) and [after](after/estimated-390-dark.png)
- [320px dark after](after/estimated-320-dark.png)
- [Large amount, 390px dark](after/large-390-dark.png)
- [1440px dark](after/estimated-1440-dark.png) and [light](after/estimated-1440-light.png)
- [Preserved PR636 hero](after/hero-control-390-dark.png)

## Reproduction

Install Playwright or Playwright Core outside the repository; provide an
installed Chromium/Edge binary. On a clean checkout of the before commit:

```powershell
$env:NODE_PATH='<external modules directory>'
$env:CHROME_PATH='<Edge or Chromium executable>'
$env:PROOF_OUTPUT_DIR='<absolute directory outside checkout>/before'
node test/browser-budget-month-contrast.js
```

Expected: exit 1 with only dark amount contrast failures. On the repaired
source commit, use the identical test and add:

```powershell
$env:PROOF_OUTPUT_DIR='<absolute directory outside checkout>/after'
$env:PROOF_BASELINE='<before directory>/receipt.json'
node test/browser-budget-month-contrast.js
```

Expected: exit 0, 18 Month cases, 126 amount records, six preserved hero
controls, no failures. The proof ran on Node 24.18.0, Playwright Core 1.64.1
and headless Edge 155.0.4283.45, with reduced motion and
`--disable-accelerated-2d-canvas`.

Focused incumbent suites also passed:

```text
node test/test-budget-month-view.js     20 checks passed
node test/test-budget-surface.js        ALL CHECKS PASSED
node test/test-budget-signed-cents.js   PASS
```

The browser test is standalone. The shared test registry and Muse-owned
Forecast/ATLAS-077 files were not edited. Hosted CI results belong to the
exact PR head and are recorded in its merge card.

## Limits

Synthetic native desktop-browser rendering only: no household data, live
provider calls, browser credentials, captured private screenshot or physical
device claim. This directly reproduces the reported color defect but does
not claim pixel equivalence to the private Slack screenshot.

An initial zero-income packet omitted the planned Household Budget breakdown;
the app correctly displayed `Month unavailable` / `This is not $0.` rather
than the card under test. It is not counted as a successful render case.
Genuine zero planned-spending values in valid native Month records are covered;
zero-income Month availability is outside this color repair. Unavailable text
and trust-pill colors are preserved, not re-audited or changed. Hatching and
other surfaces are outside this repair.

Systems Review remains PENDING. No merge or deployment is authorized by this
builder's proof.
