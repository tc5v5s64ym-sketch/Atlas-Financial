# ATLAS-024: Month amount contrast

The native **Month > Money in and out** card inherited the fixed `#1a2b33`
amount color from `public/budget-polish.css:636-639`. On its dark `#1b1b1a`
card this was 1.18:1. The active `.budget-v3-month .budget-month-amount`
selector now uses the incumbent `--text-primary` theme token. This is one
presentation declaration; no number, label, financial formatter, arithmetic or trust
publication changed.

| Evidence | Before | After |
|---|---|---|
| Exercised source commit | `8c74cbf834e3e121b03063e8f7cd1449929d6fe6` | `22d47b8bd16c9b9f797b4382820d570a85cb2f4c` |
| Result | FAIL, exit 1: 126 contrast failures only | PASS, exit 0: no failures |
| Dark computed and sampled raster contrast | 1.179747:1 | 15.780801:1 |
| Light computed and sampled raster contrast | 14.610968:1 | 18.283836:1 |
| Native Month cases / numerical amount records | 18 / 126 | 18 / 126 |
| PR636 large-negative hero controls | 6 passing | 6 passing, identical to before |
| Page errors / external requests | 0 / 0 | 0 / 0 |

The before commit has runtime bytes identical to main
`84a18e591cfe5e1f6e8f0648e540effecf2bdad8`; only the standalone test had been
added. The after runtime differs by the single scoped CSS declaration; its
test harness also includes the receipt-precision repair described below.
Receipts bind all tracked public assets, scripts, fixtures, the test and
package files to exact Git blobs and SHA-256 bytes (224 before, 225 after,
including the new receipt serializer), assert a clean start,
verify the served bytes, and verify unchanged source at completion. Each
receipt also hashes its nine PNGs. Commits after the latest after run add only
this proof directory; its exercised runtime and harness blobs stay identical.

## B1: proof-receipt format repair

[Independent review of the prior head](https://github.com/tc5v5s64ym-sketch/Atlas-Financial/pull/638#issuecomment-6228804692)
accepted the presentation but found a required-check regression: long binary
floating-point contrast tails in the synthetic before receipt matched the
unchanged static identifier guard. Both original hosted runs failed the
static and refresh-isolation suites (396 of 398 unique suites passed).

The dedicated `test/lib/month-contrast-receipt.js` serializer now rounds only
the stored `contrast` and `pixelContrast` diagnostics to six decimal places.
All browser pass/fail assertions still use the unrounded values. Exact ratios
can be recalculated from the recorded foreground, sampled foreground pixel,
and background RGB colors. The serializer declares that precision in every
receipt; no geometry, monetary text, colors, bindings or image bytes are rounded.
The scanner, isolation helper, financial code and shared registry are unchanged.

The original before execution was not repeated or relabelled as a new run.
Its receipt was re-serialized from the exact file at the reviewed commit
`7e1f4ee7af2d23587c027a3366f1f86a197bfb1c`; `reformattedFrom` records its
commit/path/SHA-256. Every field other than those two diagnostics and explicit
format/provenance metadata is identical, and all threshold decisions are
unchanged. All original before images remain byte-identical. A fresh after
browser run at `22d47b8b` passed the full matrix against that baseline; its
nine image hashes are also identical to the independently reviewed after images.

Builder reproduction of the named blocker:

| Unchanged test path | Reviewed head | Repair |
|---|---|---|
| `node test/test-static.js` | exit 1, one failed check | exit 0, all checks passed |
| B92 `withMutatedFixture` / `runSuite('test-static.js')`, no-op mutation | exit 1, assertion failure | exit 0, success |

The prior before receipt has 126 identifier-shape matches from contrast
diagnostics; the repaired receipt has zero. Both original canonical input files
remain byte-identical across the isolated replays. The bounded controls and
preservation checks are recorded in [repair-checks.json](repair-checks.json).
Hosted exact-head standard, refresh-isolation and aggregate results belong in
the PR merge card; a local targeted replay alone does not establish their PASS.

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
