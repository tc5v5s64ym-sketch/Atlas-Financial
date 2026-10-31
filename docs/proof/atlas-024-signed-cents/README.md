# ATLAS-024: keep the printed minus attached to Budget dollars

Current-state verdict: **STILL BROKEN** on main
`a5a20e6ef2b41df271e0b5004869a81104fda2a9`. Source: the owner's delegated
ATLAS-024 financial-readability repair. Main and the empty open-PR list were
checked before implementation and again before publication.

The active Budget hero reproduces the detached sign on a wholly invented
January 1–14, 2027 period. `splitPrintedCents` in `public/budget-blend.js`
recognizes ASCII `-` but treats Unicode `−` as a qualifier prefix. At 320/390px
that prefix appears 22px above the dollar digits; at desktop it remains much
smaller than them. The river selector itself keeps its sign intact.

The repair accepts either existing printed minus glyph in the dollar span.
It changes no characters, arithmetic, financial inputs, Forecast publication,
trust label, color, CSS, navigation, hatching or security behavior.

## Failing-before controls

Executed source: `617c48c0d0e30f1cf3b9e8d31b97ac0a1dfcb775` (tests only above
main). `node test/test-budget-signed-cents.js` exits 1: expected the dollar span
`−$3,152`, observed `$3,152`.

The [before browser receipt](before/receipt.json) records 18 cases: positive,
zero and negative at 320/390/1440px, dark/light. All six negative cases fail
sign grouping and the no-isolated-prefix assertion. All other assertions pass.
The [dark](before/negative-390-dark.png) and
[light](before/negative-390-light.png) captures show the separate small sign.

## Passing-after evidence

Executed source: `895906ad5d251d645fb8cf3c140f2ed7b834b2d3`.
`node test/test-budget-signed-cents.js` passes both minus glyphs, positive,
zero, a negative cent, a larger amount, qualifiers and unavailable controls.

The identical [after browser matrix](after/receipt.json) passes all 18 cases,
with no page errors or external requests. Native and visible amount strings,
amount colors and computed hatch paint match before/after in every case.
Only `public/budget-blend.js` differs among the bound source files.
The [dark](after/negative-390-dark.png) and
[light](after/negative-390-light.png) captures were visually inspected: the sign
and dollar digits share the same full-size span and line.

Both receipts bind exact committed source bytes, Git blobs, runtime and
screenshot hashes; `cleanAtStart` and `unchangedAfterRun` are true. Later
evidence publication commits are not relabeled as executed browser heads.

Re-run from a clean checkout with Playwright or Playwright Core resolvable:

```powershell
$env:NODE_PATH='<external renderer tools>/node_modules'
$env:CHROME_PATH='<Edge or Chromium executable>'
$env:PROOF_OUTPUT_DIR='<absolute directory outside the checkout>'
node test/browser-budget-signed-cents.js
```

Runtime: Node v24.18.0, Edge 155.0.4283.45, Playwright Core 1.64.1,
headless Windows with `--disable-accelerated-2d-canvas`. All page requests are
intercepted local fixtures/assets. No household figures, credentials, signed-in
deployment or financial provider calls are used. These focused commands are
standalone; the shared suite registry is unchanged.

## Evidence gap and remaining gate

Dark-on-dark amounts were not reproduced in these cases. The report did not
include an original screenshot, viewport, theme state or affected selector.
The active river has no hatch background; the legacy unknown waterfall track
is hidden in the bento. Its existing hatch CSS was also exercised in an
explicit visible CSS-only control (not claimed as the original reported
combination), with unchanged computed paint. No speculative color/hatch repair
or broader ATLAS-024 closeout is claimed.

Atlas Contract / Systems Review remains **PENDING**. This proof is synthetic
browser evidence, not production or physical-device acceptance. Merge/deploy
requires independent exact-head Systems PASS, green required checks and no
remaining blockers.
