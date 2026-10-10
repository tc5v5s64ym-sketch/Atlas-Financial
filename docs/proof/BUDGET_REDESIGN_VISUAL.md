# Budget g-blend approved repairs — Draft #548

Current source binding and approval scope are recorded in [the final main integration report](BUDGET_FINAL_MAIN_INTEGRATION.md). The repair-specific record below is retained as history; the current receipt exercises 5fdadcd916c78e484c8a45504aedf2c0b7af2b04 with main fc3e6cfd97b09478559f5bec05556ecd365624a6.

Owner source: the 2026-10-09 instruction to remove the separate Income tile,
show every Household line, preserve trustworthy historical pay-period figures
with missing data unavailable, and address the 18 browser findings. Keep Draft;
no Ready transition or merge. Final owner visual approval and release reviews
remain outstanding.

## Current-state verification

The original selector port remains implemented. Dale's latest browser comments authorize the focused hero/Household/HELOC repair described in [the panel report](BUDGET_PANEL_REPAIRS.md). Before this repair: STILL BROKEN at 935 pixels and HELOC absent; code required. Current main 657339f46862f187ba2ab81c066e5cd474318b2b is integrated, including upstream #560 unchanged. Keep Draft; final owner visual and release approvals remain pending.

The original ZIP, extracted HTML/CSS/JS, demo.mp4 and approved PNGs remain accessible. No sample finances or calculations enter production. The original owner checkout and private map are untouched.

## Repaired face and evidence

Desktop has independent Hero / Bills / Cards and Household / Savings columns.
Mobile DOM and keyboard order is Hero, Bills, Household, Cards, Savings. Income
stays in the hero equation and opens its original native evidence; the separate
tile and its producer are removed. Payday stays off the face.

Household shows every native category, in native order, with three rings per
row at 1440, 390 and 320 pixels. The all-lines fixture has seven categories plus
Other Spending. Amounts, uncertainty, plan labels, category sheets and the
original Household disclosure remain native publications.
At narrow widths, the Other Spending qualifier gets its own line so it cannot
overlap or clip the separately printed amount. The all-lines proof checks this.

Historical BAD is printed only when Forecast publishes complete, finite,
trusted actual evidence for income, bills and Household for that exact period,
and the incumbent BAD terms close with a trusted finite result. This does not
recompute the figure, establish original historical targets, or replace the
assigned-deduction basis with an actual-payment sum. The native hero, Q07 and
hidden timeline share the same qualification. Qualified estimated BAD retains
its estimate mark. Missing evidence gives Unavailable and an empty amount hook.
Every valid period date remains selectable; unavailable values have no amount
geometry and break the river line. An explicit published zero remains zero.

Independent fixture checks include 4,017.25 payroll + 2,000 partner + 50 gift
minus 200 assigned deductions minus 40 Household = **5,827.25**, and a browser
case of 2,600 payroll minus 105 assigned bill minus 47.25 groceries minus 19.50
fuel = **2,428.25**. The receipts and settlement identities are invented test
evidence. They establish behavior, not a real household historical balance.

## Disposition of the original 18 browser findings

| Original findings | Count | Disposition and retained proof |
|---|---:|---|
| Geometry requires the clipped Household hold to be visible | 6 | Correct the stale face expectation. Verify the visible hero Income term and read the original hold/progress amount from Household Info. Preserve scroll, native source, geometry and disclosure checks. |
| Desktop tile slack | 2 | Remove the empty grid row made by the closed hero source disclosure and bound the hero minimum height. Savings measurement excludes clipped source children and measures the last visible content; overflow and padding remain checked. |
| Mobile Bills header | 4 | The approved flag-filled phone row omits numeric metadata. Verify that deliberate state rather than measuring a display:none element. Unavailable warnings stay visible; native amounts stay in the drawer. |
| Mobile Bills account pill alignment | 4 | Align the wrapped pill to the right edge of the hero top. Continue checking pill bounds and overlap with Household. |
| Household count on the face | 1 | Visibility respects closed native details. Open the original Q06 body and verify its count, amounts, qualifiers and returned keyboard focus. Historical disclosure assertions wait for the native dialog entrance to settle. |
| River adapter expected text | 1 | Full native currency and trust remain in the pill, slider value text and amount-label metadata. Compact labels use the original fmtK formatting. Check Unicode minus, unavailable gaps, known zero, native sign tone and Period figures access. |

## Browser proof

Run the existing fixture-only runner with Playwright and Chromium:

```powershell
$env:CHROME_PATH = '<Chromium executable>'
$env:PYTHON = '<Python with Pillow>'
$env:APPROVED_REFERENCE_DIR = '<exact approved reference PNG folder>'
$env:PROOF_BASE_SHA = '657339f46862f187ba2ab81c066e5cd474318b2b'
node test/browser-budget-blend-proof.js
```

The current run uses Microsoft Edge Chromium on Windows. It serves repository
assets and invented fixture JSON at `http://budget.test/`, aborts other origins,
and invokes no live site or provider write. Light/dark, 1440/390/320, current,
future, incomplete history, qualified history, unavailable, cards, all Household
lines, native Bills filters and nested Back, Month, resize, disclosure focus,
contrast and reduced-motion behavior remain covered.

The runner must start with a clean checkout whose actual source bytes equal its
Git blobs. Windows Git's default CRLF conversion initially failed this new
preflight. The isolated checkout's scoped source files were materialized directly
from Git blobs, and its index stat metadata was refreshed with no staged content
change. The clean-start and raw-byte checks then passed. No source hash or
screenshot expectation was manually substituted to make the proof pass.

Exercised code commit: `7929a5ba2456c6f84c17a405e3f5b45b859d4ced`.
Source tree: `37d4fe03f0a94f06e0ea7cc495a8fa45e0945132`.
The receipt binds **191 tracked sources** with Git blob IDs, raw SHA256 and
byte counts. Each repository asset served to the browser is checked against that
binding; every scoped source is checked again after execution. Only docs/proof/
changes may follow this code commit. No source hashes are normalized or substituted.

The fresh run passed: **55 screenshots**, **191 bound
sources**, **30 served repository assets**, `errors:[]`, `externalRequests:[]`.
All committed/exercised bytes and screenshot hashes were independently verified.

| Source | SHA256 of committed and exercised bytes |
|---|---|
| `public/plan.js` | `aa43b1a82aa748cdd49f680fc3e149b903cb8158c0ea2f9aabf8e7df55d2536f` |
| `public/budget-blend.js` | `27eef404171da6fb6eba8d18f913d5847ec9294d3f53723cee5036766adc6f32` |
| `public/budget-river.js` | `e6e90e515006bcf37d7ffec9b0728791af97e8e6164317d596c684bac2ffb8c9` |
| `public/budget-gface.css` | `5e1ad89bdc773f70ce1c5bc4f550a43a91f50ea7b0a1e110cb08835cf7be2b7e` |
| `test/browser-budget-blend-proof.js` | `121eca0ce8d3a5604c173becc746d0fca9ef7c2b1677a2b65e52555925177427` |
| `test/browser-budget-river-port.js` | `d27632f278bea950544dff167689bb3071d20da1186104e5251644cdb4d3343e` |

The receipt records results, exact reference hashes, source and served-asset
hashes, and screenshot hashes. `visualMatchApproved:false` remains an owner
decision. Side-by-side images
are review evidence; differences caused by native unavailable data are retained.
The approved dark reference ends before lower tiles, so lower dark fidelity
has no approved reference. Chromium emulated touch is tested before release and through cancellation. Physical-device touch and signed-in production remain untested.

Useful captures:

- [Current 935-pixel panel light](budget-panels-935-light.png) and [dark](budget-panels-935-dark.png)
- [Native unavailable panel light](budget-panels-935-light-unavailable.png) and [dark](budget-panels-935-dark-unavailable.png)

- [Current 935-pixel panel light](budget-panels-935-light.png) and [dark](budget-panels-935-dark.png)
- [Native unavailable panel light](budget-panels-935-light-unavailable.png) and [dark](budget-panels-935-dark-unavailable.png)

- [Working selector light](budget-river-port-1440-light.png) and [dark](budget-river-port-1440-dark.png)
- [Original versus port light](budget-river-pair-1440-light.png) and [dark](budget-river-pair-1440-dark.png)

- [Desktop light](budget-blend-1440-light.png) and [desktop dark](budget-blend-1440-dark.png)
- [Mobile light](budget-blend-390-light.png) and [mobile dark](budget-blend-390-dark.png)
- [Every Household line, desktop](budget-blend-1440-light-household-all.png), [390](budget-blend-390-light-household-all.png), [320](budget-blend-320-light-household-all.png)
- [Qualified history, desktop](budget-blend-1440-light-past-qualified.png), [390](budget-blend-390-light-past-qualified.png), [320](budget-blend-320-light-past-qualified.png)
- [Incomplete history](budget-blend-390-light-past.png)
- [Desktop comparison](side-1440-light.png) and [mobile comparison](side-390-light.png)

## Numerical and validation boundaries

public/forecast.js, canonical data and the numerical snapshot script are byte-identical to
integrated main `657339f46862f187ba2ab81c066e5cd474318b2b`. That revision's
own script and inputs were extracted from its exact Git blobs and executed
independently of the candidate checkout. Both 582-key numerical snapshots have
SHA256 `60b0328bc9174270ef23c1bba6e2d61f52cc674204ad6cd07728ad6eeabc8ac6`.
The Forecast-owned movement module now includes the recorded HELOC under the existing native evidence guards; it is separately reconciled in the panel proof. The Forecast-owned movement module now includes the recorded HELOC under the existing native evidence guards; it is separately reconciled in the panel proof. Historical aggregate availability is an intentional presentation repair and is
proved separately through the real renderer and browser.

The PR merge card records the full-suite outcome and actual hosted checkout
identity. The focused BAD terms, timeline river, historical pay-period and new
source-binding suites pass in the fresh checkout. Prior Windows full-suite
limitations remain historical results and are not relabeled as a new local full
PASS. No out-of-scope history or Lunch Money repair is included. Prior Systems
PASS does not certify this head.

The keyboard walk records **18 outlined stops** and **13 targets meeting its size and visibility predicate**. Its first 18 stops are not comprehensive accessibility clearance. **16 visible-text contrast samples** passed; **2 empty-text probes** are unevaluated. Design, Engine, Money, current-head Systems and Dale's final visual approval remain pending. Keep Draft.

The latest date-formatter dependency repair and its validation are recorded in [the CI repair report](BUDGET_SELECTOR_FORMATTER_CI_REPAIR.md). Source binding above is refreshed by the complete clean-start proof after that repair.
