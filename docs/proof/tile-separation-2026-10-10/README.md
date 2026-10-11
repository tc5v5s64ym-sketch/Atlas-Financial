# Tile separation proof — mobile board backing (UI task 1)

Synthetic-fixture renders only (`test/fixtures/budget-surface-data.js`,
served through route interception exactly as in
`test/browser-budget-blend-proof.js`). No live site, no real figures.

Reproduce:

```bash
CHROME_PATH=<Chromium> node test/browser-tile-separation.js --label before
CHROME_PATH=<Chromium> node test/browser-tile-separation.js --label after
```

`--label` accepts both the space form (`--label before`) and the
equals form (`--label=before`). Argument parsing is strict: a missing,
misspelled, duplicated, or unrecognized argument fails loudly before
anything runs, so a proof can never silently execute under the wrong
label. `--label before` runs against the unmodified tree and asserts
the baseline; `--label after` asserts the outcome, cross-checks the
measured hero-tile facts and the board gap against the recorded
`before` facts, computes the pixel diff and a same-tree rerun noise
control, and stamps the run bindings (below) into `report.json`.
Optional `--source-head <sha> --source-tree <sha>` record the source
a run claims to test; the script refuses to stamp a run whose
checkout tree does not equal the claimed tree.

## What was wrong

On the stacked mobile board, `.blend-board` painted one flat
`var(--blend-bg)` rectangle behind all tiles
(`public/budget-gface.css`, `.budget-bento.atlas-g > .blend-board`).
That rectangle is the only background painted over the board's box —
the bento, the columns and every wrapper are transparent, and no other
stylesheet or script paints it — so it showed in the 18px gaps between
tiles and in the cutouts outside each tile's rounded corners, clipping
the page background (body gradients + the fixed ambient layer) into a
visible slab while the same background showed freely at the page sides.

## The change (one declaration, mobile only)

Inside the existing `@media (max-width: 759px)` rule for the same
selector: `background: transparent;`. Tile glass, borders, shadows,
gaps (18px), and the body/ambient background are untouched; desktop
keeps the flat gutter colour from the base rule.

## Evidence

Computed facts per width × theme are in `report.json` (`before` /
`after`), with before/after PNGs beside this README.

- 320px and 390px, both themes: board computed background goes from
  `rgb(236, 238, 242)` (light) / `rgb(5, 5, 7)` (dark) to
  `rgba(0, 0, 0, 0)`.
- Measured facts asserted identical before/after at every width and
  theme: the board background (above), the hero tile's glass
  background, border, shadow, and corner radius, and the 18px board
  gap. The hero is the only tile whose computed style is sampled;
  no other tile's internals are measured — the change is confined
  to the board's own background declaration, behind the tiles.
- Desktop 1280px, both themes: board background unchanged and the
  before/after PNGs are **byte-identical** (0 differing pixels).
- Mobile pixel diff (PNGs decoded in Chromium canvas, per-pixel max
  RGB channel delta; computed by the script during the `after` run;
  full table in `report.json`): 2.43–3.06% of pixels change — the
  board-rect area (gaps, corner cutouts, board margins) where the
  page background's gradient tints now show through instead of the
  flat fill, with every board-area channel delta ≤ 14. Sampled
  gap/cutout pixels sit on the page-background gradient, under the
  tiles' own preserved shadows. One exception is documented in
  `report.json` (`pixelDiff.noiseControl`): the river (timeline)
  canvas's label-brightness band varies between runs on an unchanged
  tree (animation-settle timing) and accounts for every >14 max
  delta in the mobile pairs; the `after` run reproduces the band by
  rendering 320-light twice on the identical tree and diffing the
  two renders (hot bbox y 84–97, the same band as the original
  proof).

## Bindings (this regeneration)

Stamped by the script into `report.json` (`bindings.runs`) from the
checkouts and files themselves:

- `before` run source: main `5faac95f70415e90c442c2d0339d466c94cd108f`,
  tree `b9c204764e8b57a6bdf8e66bed2d92fe26651109`; stylesheet under
  proof at that source: `public/budget-gface.css` sha256
  `645bc22636fcd9e6…` (unmodified).
- `after` run source: implementation commit
  `36286146cfe2123144dc71ac196fc006d1f047b8`, tree
  `b9a3d4a9193cc42d520743a11fe011d4788395e4` (this PR's head carries
  one further commit adding only this proof directory); stylesheet
  sha256 `f092db6148438836…` (with the fix).
- Fixture: `test/fixtures/budget-surface-data.js` sha256
  `f6a3c46fb037c41f7371aaaef08ffaab5256bda97cb9bc5f994e4ee54e5fac0b`
  (identical at both sources). Proof script sha256
  `3e12e88a9069af74f8cbb155da5cef2aab8e07164105a285e2eb7ae23d975f37`.
- Runtime: Chromium `156.0.8078.4` (headless shell), Node `v24.20.0`,
  linux-x64.

PNG sha256 (also in `report.json` under `bindings.pngSha256`):

| file | sha256 |
|---|---|
| `1280-dark-after.png` | `36c97ce9ceeeea00e543d689e08fbce9e8601869614cb493f8b4ebfa3e1a3379` |
| `1280-dark-before.png` | `36c97ce9ceeeea00e543d689e08fbce9e8601869614cb493f8b4ebfa3e1a3379` |
| `1280-light-after.png` | `71944cdc6fc3aa476d14658b27a7c8d878f9e2fa01031060c09cec8895e689c6` |
| `1280-light-before.png` | `71944cdc6fc3aa476d14658b27a7c8d878f9e2fa01031060c09cec8895e689c6` |
| `320-dark-after.png` | `3b1dbc9ce4356b05ea96ac74665d8a146babccbb9385a6e84c41da83db123233` |
| `320-dark-before.png` | `27438ff813485aaaf82b334c9c02e9c9377c508d59031e1c04a3755a1f44f80f` |
| `320-light-after.png` | `42cd5991b2a43b85064bad764ccabe2d94d5dbced1cc264192c46e48de2ac27b` |
| `320-light-before.png` | `7883f0d03278214d55e7938ec69a1e9338d8366ccef856ff92838ae0c4857a2a` |
| `390-dark-after.png` | `740ba415ec12252ac06de0d41ff483a2f56d9df5185b94e7898b297267e6c9d1` |
| `390-dark-before.png` | `22e4a86514a164a3db6821bced8d5e2431865341af42b5fb5ec8b08dd4927f79` |
| `390-light-after.png` | `2cef70fd902c6a06149e6235273ec53bf600b0969d4e10bbddbdf5295c3caf4e` |
| `390-light-before.png` | `d0764051bfe38b1669b765b5903b2856e0b153cea837932f5fcb8c270c90e3c7` |
