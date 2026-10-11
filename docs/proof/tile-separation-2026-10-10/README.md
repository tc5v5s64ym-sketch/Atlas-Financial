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

---

## Amendment — mobile tile spacing 18px → 9px (2026-10-11)

Owner-directed via Atlas (UI task 1 lineage; Dale's amendment: tile
spacing 18px → 9px if still current, mobile only, preserve backing /
separation / padding, desktop unchanged). The sections above remain
the record of the original #572 separation proof; this section is the
record of the amendment's regeneration of the `after` state.

**Verified current first.** On main `2921aa62dddd452ddc7d56b6fd0c09f92f5cef9a`
(tree `64b4af9b3228dfaeb778f123da9af3e4b121e535`) the stacked-board gap
measured 18px (computed + all four rendered tile-to-tile deltas) at
320/390 in both themes, so the amendment's condition held.

**The change (one declaration).** `public/budget-gface.css`, inside the
same `@media (max-width: 759px)` block, `.budget-bento.atlas-g >
.blend-board`: `gap: 18px` → `gap: 9px`. Deliberately NOT changed: the
bento container's own ≤759px `gap: 18px` in the same block (it spaces
the non-tile stack rows — header / river / board / payday — not
tile-to-tile), tile padding (18px), the board's transparent background,
and every desktop rule (desktop 18px comes from separate base rules).
No JavaScript reads the gap.

**Proof changes** (`test/browser-tile-separation.js`). The board-gap
pin is now per width — 9px at 320/390, 18px at 1280; the amendment
supersedes the pinned value, not the separation invariant (board
background, gap-pixel show-through sampling, and the hero tile's
glass / border / shadow / radius assertions are unchanged, and the
hero facts still cross-check against the recorded `before` facts).
Added at the mobile widths: the five stacked tiles in reading order
(hero, bills, spending, cards, savings) with each rendered
tile-to-tile delta within 0.6px of 9 (measured: exactly 9, all four
deltas, both widths, both themes); horizontal overflow
`scrollWidth − innerWidth` = 0; and per-tile clipping
(`scrollHeight − clientHeight`) equal to the pristine-main baseline
(hero 0, bills 0, spending 9 — its internal overflow allowance by
design — cards 0, savings 0). One bookkeeping adaptation: pairs whose
before/after page sizes differ are recorded as `sizeMismatch` in
`report.json` instead of being pixel-diffed — the committed `before`
PNGs are the pre-#572 baseline from an older tree, and at ≤759px the
amendment itself shortens the stacked page, so a per-pixel diff would
measure translation and baseline drift, not spacing. The same-tree
noise control in this run was pixel-identical (0 differing pixels).
The light-theme gap-pixel sample now sits ~4.5px from the tile edges
and records a max delta of 26 vs the page margin (tile shadow falloff
inside the narrower gap; dark theme: 2) — recorded, as before, not
asserted.

**Bite.** With the single declaration reverted to 18px, the same proof
fails: `AssertionError: 320-light: board gap must be 9px ('18px' !==
'9px')`, with all four mobile combos measuring gap 18px against their
9px pins while desktop measures 18px against its unchanged 18px pin.

**Bindings (this regeneration).** `after` run source: implementation
commit `e8d277a6caaadb4fdd78e45e0270a20e50b8747d`, tree
`703857fe6cb24e23b483f8fb6db9260fea7be970` (the PR head carries one
further commit adding only this proof directory). Stylesheet sha256
`57aacac63c243dd79b3d0d30bf94d8a3492a001156b73f8f2758b30d8d67ed1f`
(with the amendment); fixture sha256 unchanged
(`f6a3c46fb037c41f7371aaaef08ffaab5256bda97cb9bc5f994e4ee54e5fac0b`);
proof script sha256
`f26953698d7aae1015bd507a0bbb8a78c1d5668c82fe008e1a355d08a5f97fc0`.
Runtime: Chromium `152.0.7977.82` (`chrome`), Node `v24.20.0`,
linux-x64. The `before` facts and PNGs are untouched from the original
proof.

Regenerated `after` PNG sha256 (also in `report.json`):

| file | sha256 |
|---|---|
| `1280-dark-after.png` | `691807b87a26f371d9ed0202baf7cdee1db4ea62ee9ce4b14b5ace3ee53ed78b` |
| `1280-light-after.png` | `ed489fb41384435254fadb8ead78ef25ef90f5ead55d963d31edd0f67be753da` |
| `320-dark-after.png` | `5bb1e07aa9932e2d42fe3f5e492d34e98ddec6a1ff710f129f866c1218c86e57` |
| `320-light-after.png` | `4e05e37102049479c038eb8b4bce2b67073f2aa5ac1f446a7dee6ed7c0ebeea2` |
| `390-dark-after.png` | `04373b48be48ae9e2256c04507e215b67000e3b45888908355b179cc75c81f8d` |
| `390-light-after.png` | `422ef36b25e3299eeabe20fc23e5cdc3a6319f50adbdb11941b5e0d84a1d35d7` |
