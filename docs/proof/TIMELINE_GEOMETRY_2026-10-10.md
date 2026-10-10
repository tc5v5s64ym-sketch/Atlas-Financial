# Timeline tile geometry — owner-approved shorter tile (2026-10-10)

Decision: Atlas (ChatGPT), Slack thread `1791643517.522249` — geometry decided
in reply `1791643681.447539`; implementation hold lifted in reply
`1791645205.466779` with gesture semantics frozen (original drag/fling
retained exactly; no edge auto-pan; no direction or selection changes).

First head `1ebe5404` carried the source change and a standalone proof.
Systems Review `5479984271` verified the source change and BLOCKED the release
on the proof harness only. This note and the committed proof below are the
replacement head's record, answering that review's six requirements.

## Change (production scope: two files)

- `public/budget-gface.css` — `.tile.t-river` height 164px → **123px** desktop,
  152px → **114px** mobile (both the ≤759px rule and the reduced-motion rule);
  `.river-vals` bottom 30px → 28px; `.months` bottom 9px → 7px; `.playhead-pill`
  top 9px → 7px and height 32px → 24px; `.playhead-beam` top fallback 40px →
  30px, bottom 52px → 51px. Pill and value-label font sizes unchanged; all
  labels remain inside the tile.
- `public/budget-river.js` — `layout()` insets only: band top 52 → **38**
  (desktop) / **36** (mobile); bottom inset 52/50 → **51/49**; plus the
  `--beam-top` value pinned to a constant 30px (1px above the pill's bottom
  edge, as before). The value domain (`vmin = min(0, …)`, span), the per-run
  path construction, drag/fling, keyboard, selection publication, adoption and
  reduced-motion code are byte-unchanged (checkable from the PR diff: the JS
  diff is confined to `layout()` and the `--beam-top` line in `place()`).

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
  spring, resize and reduced-motion assertions are preserved. Run natively
  against this head: PASS (native live drag across viewport/theme cases;
  amount-label starts and retained controller across native remounts).
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

## Before state

`before-*.png` and `timeline-geometry-before-report.json` were captured
against the pre-change geometry (base `d9960dfe`) during the first head's
build and are retained as the change's before record. The replacement head
integrates current main `29063eec`; the source diff against that main is
identical in content to the first head's diff (main did not touch these
regions beyond an unrelated selector rename in the same stylesheet).

Legibility: the agreed targets were met with fonts unchanged, so Atlas's
escape hatch was not triggered and no deviating variant is proposed.
