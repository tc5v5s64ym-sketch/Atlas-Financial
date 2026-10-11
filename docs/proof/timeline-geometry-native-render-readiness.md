# Native river proof: render readiness

This records the authorized proof-only repair after PR #570's integration onto released #576 main. Production files, financial publications, fixtures, strict displacement assertions and behavioural assertions are unchanged. The native harness's settledAt predicate adds only r._lastF === k, so a settled selected index must also have reached the original rendered frame.

Executed code commit: 7fefd1e329b2b5c0097bc84d0aa7d6692d48b018

Executed code tree: 4b7518914b018bbb3c2fec5494fba0e8a899c042

Tested main: 2cb88850dd8083fd0dbc7f8e69832142ccafb6ab

Prior integrated head: 9746f29649794143fa7efd27b935534d333a5abd

## Failing-before evidence

The original qualified candidate harness twice failed the reduced-motion displaced-label precondition at 390/dark. Bounded browser instrumentation then reproduced the unchanged assertion failure: index/head were settled at period 1, but last rendered f remained 4, displacement was 0px and the hit box was null. After the queued original RAF/place(), displacement became 30px and the hit box targeted period 1.

A same-task before/after-RAF transition reproduces the mechanism on both exact source35acd935 and prior integrated9746f296. The old settled predicate accepts the pre-RAF state; the added render guard rejects it and accepts the completed frame. Layout is 366x114, N12, pan=true, spacing44. Selected period/value stay unchanged, fonts are loaded, and label visibility/opacity are unchanged. The failing branch directly constructs an invented river fixture without Forecast or adoption. Separate default390/dark and stress935/light invented native fixture publications match exactly between source and prior candidate, with16 rows each.

Bounded diagnosis record: https://github.com/tc5v5s64ym-sketch/Atlas-Financial/pull/570#issuecomment-6106339193

## Passing-after evidence

Command: node --require ../release-evidence/pr570-software-canvas-preload.cjs test/browser-budget-river-port.js

The committed harness, all product scripts and all original strict assertions ran unchanged except the one-condition readiness guard. The full native proof passed all32 cases:8 native live drags,6 original-prototype comparisons,5 yielded-neighbour reselects,7 displaced-label hit targets and6 held non-pan presses. The reduced-motion displaced-label case retains the strict >22px precondition, records30px displacement and keeps the selected period after tapping. Page errors and failures are empty.

Receipt: [timeline-geometry-native-render-readiness-receipt.json](browser/timeline-geometry-native-render-readiness-receipt.json)

Receipt SHA256: f5a57ad18ec8dee5ac23601d235e66bbf3c3dbf891660ae3be4762d21a10e3b3

The receipt binds the executed code commit/tree above, cleanAtStart=true and unchangedAfterRun=true, with12 exact Git blob/raw-byte SHA256 bindings. The later publication adds only this proof document and the receipt. Compare every bound file with the final PR head; no provenance is rewritten to claim that a proof-only publication commit was executed.

## Browser qualification and limits

Runtime: Nodev24.18.0, Chromium/Edge154.0.4258.62, Playwright1.62.1, headless Windows. The external launch preload adds only --disable-accelerated-2d-canvas to the isolated proof process. Its SHA256 is 781be6d9d3c3e5d7e8a1e5ba658986862ec2009c43f58832211cfb61a75479c7. Browser request routes permit only local synthetic fixture GETs; no signed-in deployment, institution, provider, private household data or physical-touch claim is made.

Prior default Edge154 native runs on source and integrated candidate both fail the deterministic1440/light frame assertion with6813 differing channels. This receipt is qualified software-Canvas2D PASS, not default-renderer PASS. No clock, page function, assertion, production configuration or user browser setting was changed. Renderer-transition causation remains an inference.

Fourteen local native/prototype screenshot hashes were verified; fresh pixels were not inspected for this proof repair. No new screenshot legibility claim is made. Fresh standalone geometry previously passed24 cases at9746f296; all7 declared geometry bindings remain unchanged by this harness-only repair. That prior geometry receipt retains its own executed source identity and is not relabeled as a new-head run.

Original committed receipts, proof documents and59 PNGs retain their source bytes and provenance. Source Systems PASS5482044707 remains source-only; this repaired integrated head requires fresh root Systems review and all required full CI checks before Ready or merge. Automatic financial edits remain OFF. This proof change activates no financial capability.
