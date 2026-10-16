# PR 636: complete signed Budget amount containment

This is the bounded repair of the [independent Systems blocker](https://github.com/tc5v5s64ym-sketch/Atlas-Financial/pull/636#issuecomment-6226792298)
on `38ac964267017c375525bbd2ca6a19fd75acc3f4`. That review remains **BLOCKING**
for its reviewed head; this repair requires independent exact-head re-review.
Current main remains `a5a20e6ef2b41df271e0b5004869a81104fda2a9`. Repository
authority and the Forecast-runtime skill were refreshed before the repair;
their blobs are unchanged from main. No competing implementation PR was open.

## Reproduced before editing

The review's invented January 1–14, 2027 fixture was reproduced independently:
4,444.44 income minus a 1,234,567.89 bill minus targets
100.01 + 200.02 + 300.03 gives **−$1,230,723.51**. At 390px the dollar span's
right edge is 394.921875 while the hero ends at 378, in both themes. The last
dollar digit clips and the cents wrap. The original sign-only matrix missed
this containment failure.

Committed failing-before control: `651dcfb8eee092002cd1ff65543b1417ebec76f7`
(expanded tests above the reviewed head; production source unchanged).
The [before receipt](clipping-before/receipt.json) records 42 full-page cases:
positive, zero, negative, negative cent, large negative, large positive and
unavailable at 320/390/1440px in both themes. It exits 1 with 20 containment
assertion failures, including the exact 390px blocker and desktop clipping.
It also records eight resize/reflow states at 720px and back to 390px.

[Before dark](clipping-before/large-negative-390-dark.png) ·
[Before light](clipping-before/large-negative-390-light.png)

## Repair and proof

Executed repaired source: `1c0cd3cce8d963e3150db0639b1efcef362fd364`.
Only `public/budget-blend.js` changes production behavior. The existing
nonwrapping dollar/cents group is reused on the ordinary BAD face. The existing
tile layout and resize path measures that complete group against the available
row and hero content width, reducing its font only on overflow. CSS sizing is
restored before each measurement; fonts-ready repeats the measurement.
This also avoids retaining a reduced size after a layout change.

No amount is parsed, rounded, abbreviated or recalculated by this repair.
Existing text nodes, source amounts, trust qualifiers and accessibility labels
are retained. CSS, Forecast, financial inputs, security and shared tests are
unchanged. Unavailable faces have no dollar/cents nodes and are left alone.

The [after receipt](clipping-after/receipt.json) passes **42/42 cases and eight
resize records**, with zero page errors or external requests. The complete
dollars and cents fit their row and the clipped hero; cents remain on the
amount line. Both large signs, cent/zero values and six unavailable cases pass.

Every before/after case preserves native and visible text, computed colors,
protected accessibility markup, trigger labels and computed hatch paint.
Every ordinary case retains its prior font size. Both ordinary 390px negative
PNG files are byte-identical before/after. Fresh 320px dark and 390px dark/light
large-negative captures were visually inspected.

[After dark](clipping-after/large-negative-390-dark.png) ·
[After light](clipping-after/large-negative-390-light.png) ·
[After 320px](clipping-after/large-negative-320-dark.png)

The after run tightens cents-line detection against the dollar element's
upper half. The stored before geometry independently fails that stronger
predicate for all four large 390px cases. The original containment assertions
are unchanged. Both `public/budget-blend.js` and this focused browser script
therefore differ between the two source bindings; no identical-harness claim
is made for the added cents-line predicate.

Both receipts bind committed raw bytes, Git blobs, runtime and screenshot
hashes, with a clean start and unchanged source after the run. Later proof-only
publication is not relabeled as an executed browser head.

Commands (external Playwright Core modules and installed Edge):

```powershell
node test/test-budget-signed-cents.js
node test/test-bad-terms-print.js
node test/test-bad-timeline-river.js
$env:NODE_PATH='<external renderer tools>/node_modules'
$env:CHROME_PATH='<Edge or Chromium executable>'
$env:PROOF_OUTPUT_DIR='<absolute directory outside the checkout>'
node test/browser-budget-signed-cents.js
```

All three Node checks pass on the repaired code. The browser command fails on
the stored before control and passes on repaired source. The focused tests
remain standalone; the shared 398-suite registry is unchanged.

## Qualification and remaining gates

Headless Windows Edge 155.0.4283.45, Playwright Core 1.64.1, Node v24.18.0,
with `--disable-accelerated-2d-canvas`. Requests use intercepted synthetic local
assets/data only. The 720px resize is a reflow control, not a physical zoom or
screen-reader acceptance claim. No household figures, credentials, financial
provider calls, signed-in production or hardware-renderer proof is involved.

The original dark-on-dark and hatch/amount combination remain unverified and
outside this bounded blocker repair. The previously reported local Windows
storage/platform failures are not waived. Full applicable CI and independent
Systems re-review on the new exact head remain gates. Do not merge or deploy.
