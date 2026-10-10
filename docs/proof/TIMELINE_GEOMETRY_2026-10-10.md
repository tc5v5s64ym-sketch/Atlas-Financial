# Timeline tile geometry — owner-approved shorter tile (2026-10-10)

Decision: Atlas (ChatGPT), Slack thread `1791643517.522249` — geometry decided
in reply `1791643681.447539`; implementation hold lifted in reply
`1791645205.466779` with gesture semantics frozen (original drag/fling
retained exactly; no edge auto-pan; no direction or selection changes).

First head `1ebe5404` carried the source change and a standalone proof.
Systems Review `5479984271` verified the source change and BLOCKED the release
on the proof harness only. Replacement head `93598acb` answered that review's
six requirements; Systems Review `5480338180` resolved the harness re-pin, the
prose correction, the breakpoint/extreme captures and the blob bindings, and
kept the release BLOCKED on three proof/legibility items plus a main
integration refresh. This note and the committed proof below are the current
head's record, answering both reviews.

## Change (production scope: two files)

- `public/budget-gface.css` — `.tile.t-river` height 164px → **123px** desktop,
  152px → **114px** mobile (both the ≤759px rule and the reduced-motion rule);
  `.river-vals` bottom 30px → 28px; `.months` bottom 9px → 7px; `.playhead-pill`
  top 9px → 7px and height 32px → 24px; `.playhead-beam` top fallback 40px →
  30px, bottom 52px → 51px. Pill and value-label font sizes unchanged; all
  labels remain inside the tile.
- `public/budget-river.js` — `layout()` insets: band top 52 → **38**
  (desktop) / **36** (mobile); bottom inset 52/50 → **51/49**; the
  `--beam-top` value pinned to a constant 30px (1px above the pill's bottom
  edge, as before); plus, in `place()`, the selected-extreme legibility
  placement described under Round 2 below (selected label steps aside from
  the orb at the band's bottom edge; covered neighbouring labels yield).
  The value domain (`vmin = min(0, …)`, span), the per-run path construction,
  drag/fling, keyboard, selection publication, adoption and reduced-motion
  code are unchanged (checkable from the PR diff: the JS diff is confined to
  `layout()`, the `--beam-top` line and the legibility block in `place()`,
  and the label-state resets in `labels()`).

## Resulting geometry (asserted by the executable proof)

| Form | Tile | Band top | Band bottom (from top) | Band height | Clearance above band | Clearance below band |
|---|---|---|---|---|---|---|
| Desktop | 123px | 38 | 72 | 34px | 7px | 7px |
| Mobile | 114px | 36 | 65 | 29px | 5px | 5px |

The band is centred between the playhead pill's bottom edge (31px) and the
value labels' top edge (44px from the bottom) with equal clearances. Peaks and
dips map to the band extremes. The monetary zero line is **not** forced to the
centre: it sits wherever the unchanged domain mapping puts it — strictly
inside the band for mixed-sign domains, and exactly at the band's bottom edge
for all-positive domains (where `vmin = 0`). An earlier draft of this note
claimed the zero line is "strictly inside the band" without qualification;
that was wrong for the all-positive cases and is corrected here — the mapping
was never changed to match the prose.

## Executable proof (Systems Review 5479984271, items 1, 2, 4, 5, 6)

- `test/browser-river-geometry-proof.js` — committed, re-runnable from a clean
  checkout of the head: `CHROME_PATH=<chromium> node test/browser-river-geometry-proof.js`.
  It binds the exercised sources to the checkout's Git blobs
  (`test/proof-source-binding.js`), runs 24 geometry cases (all-positive,
  mixed-negative, mid-year unavailable gap, narrow/pan × 1280/390/320 ×
  dark/light), captures the screenshots in `docs/proof/browser/`, and writes
  `timeline-geometry-receipt.json` (source bindings, runtime, per-case and
  behaviour results, SHA-256 of every screenshot) plus
  `timeline-geometry-after.json` (full geometry detail). Sources are verified
  unchanged after the run.
- `test/browser-budget-river-port.js` — the repo's native river harness,
  updated for the approved geometry: tile-height expectations 164/152 →
  123/114; the prototype comparison now asserts horizontal geometry and run
  structure identical to the fixture, and every vertical position of the port
  equal to the prototype's position affinely remapped onto the new band (same
  domain, different insets). Cross-canvas pixel equality was dropped (the
  canvases legitimately differ in height); pixel proof is now the port's own
  deterministic static frame. All held-drag, live-selection, cancellation,
  spring, resize and reduced-motion assertions are preserved. Its run
  against this head is recorded, with per-case results, in
  `docs/proof/browser/timeline-geometry-native-receipt.json` (run with
  `CHROME_PATH=<chromium> RIVER_RESULT_JSON=<path> node
  test/browser-budget-river-port.js`): 8 native live-drag viewport/theme
  cases and 6 prototype-comparison results against the actual app sources,
  bound to the pushed head's Git blobs (see the receipt's
  `remoteVerification`).
- Selected-extreme visual proof (item 4): `after-selected-max-*` /
  `after-selected-min-*` captures place the 20px orb on the band's top/bottom
  edge (selected series maximum / minimum); the receipt records orb and pill
  rectangles alongside. Held-drag visual proof: `after-held-drag-*` captures
  are taken mid-gesture with the drag state live and scrub publications
  recorded in the receipt.
- Breakpoint divergence (item 5): `after-breakpoint-700-dark.png` (viewport
  700 → CSS mobile height 114 with JS desktop insets, element width 676) and
  `after-breakpoint-narrow800-dark.png` (viewport 800 → CSS desktop height 123
  with JS mobile insets, element width 500), plus resize transitions crossing
  both breakpoints (1280 → 700 → 664 → 663 → 390 → 760 → 1280) with geometry
  and selection asserted at every step — all in the receipt.
- Behaviour asserted by the executable proof: drag scrub publishes live
  selection (`onChange`, `how: "scrub"`); keyboard traversal moves the
  selection with `how: "commit"` publications (the host-owned `aria-valuenow`
  is covered by the native harness on the real page); period-switch remount
  via `adopt()` keeps geometry and selection; reduced-motion renders settled
  at the mobile geometry; over the unavailable gap the value series has two
  known runs with null positions between them, and the orb/beam are hidden.

## Round 2 (Systems Review 5480338180)

1. **Source-bound native-harness results.** The native harness's PASS was
   previously prose in the packet, and the geometry receipt's recorded
   source commit was a local commit the API push flow never created
   (404). The harness now records its own structured results
   (`timeline-geometry-native-receipt.json`, above), and both receipts'
   bindings were finalized against the PUSHED head: the exercised code
   commit below is a GitHub commit, its tree is the local exercised tree
   byte-for-byte, and every bound file's Git blob was compared against
   that head's tree fetched from GitHub (see `remoteVerification` in
   each receipt).
2. **Standalone fixture defects** (`test/browser-river-geometry-proof.js`).
   The gap fixture's second known run was written `[5, 11]`, which the
   controller reads as the index set {5, 11} — indices 6–10 silently had
   no run. It is now `[5, 6, 7, 8, 9, 10, 11]`, and the proof asserts the
   exact run-id assignment. The fixture formatter also rendered a null
   (unknown) value as `$0`; it now mirrors the shipped formatter
   (`budget-blend.js` `compactRiverAmount`): a non-finite value renders
   as `—`, never a number. The gap captures now show a true break with
   `—` labels and the second run drawn through all its points.
3. **Selected-minimum legibility.** In `after-selected-min-390-dark.png`
   the 20px orb sat on the selected `−$420` label. Narrow presentation
   correction in `place()` (`public/budget-river.js`): when the orb's
   disc would cover the selected value label — only possible for points
   at the band's bottom edge — the label steps sideways just clear of
   the disc (toward the side with more room, clamped inside the tile),
   and any neighbouring label the disc or the stepped label would cover
   fades out until clear. Selection, domain, gestures, fonts and the
   band geometry are unchanged. The selected-min captures were retaken
   at 1280/390/320 in both themes, and the geometry receipt's
   `extremes` entries record the orb and selected-label rectangles for
   every extreme case: disjoint in all of them, with no visible
   neighbouring-label overlap.
4. **Integration refresh.** This head integrates current main
   `a1b6fa0b8b86abfe35100e4c12f1b3e8f16d931d` (seven commits past the
   previous merge base `29063eec`). None of those commits touches this
   PR's files; the production/harness diff against the new main is
   byte-identical to the diff against `29063eec` (diff-verified), and
   both proofs were re-run against the integrated head.

## Before state

`before-*.png` and `timeline-geometry-before-report.json` were captured
against the pre-change geometry (base `d9960dfe`) during the first head's
build and are retained as the change's before record.

Legibility: fonts are unchanged. The one legibility defect found in
review (item 3 above) was corrected by label placement within the
agreed geometry, not by deviating from it, so Atlas's escape hatch was
not triggered and no deviating variant is proposed.
