# Budget g-blend approved repairs — Draft #548

Owner source: the 2026-10-09 instruction to remove the separate Income tile,
show every Household line, preserve trustworthy historical pay-period figures
with missing data unavailable, and address the 18 browser findings. Keep Draft;
no Ready transition or merge. Final owner visual approval and release reviews
remain outstanding.

## Current-state verification

The latest source is the owner's instruction to pick up the
[bounded review findings](https://github.com/tc5v5s64ym-sketch/Atlas-Financial/pull/548#issuecomment-6090295139),
verify current main and regenerate proof from a clean checkout. Verdict before
this continuation: **STILL BROKEN** for release evidence. The review accepted
the approved repairs at `db9b9778eb4cf5a1812a39d37d277296d688c14d` in its
bounded source assessment, but found four source hashes did not reproduce from
committed bytes and the full-suite certificate used an older main. It did not
establish a new production defect or grant formal Systems PASS.

Current main `6a9f37da6009408e90013c39070f4b6be0a8ca3c` is integrated in
merge `3da15f0ab3f15e1d5833bf9e90e3193bdcdd2b0d`. Every file under `public/`
remains byte-identical to the approved `db9b977` tree. This continuation changes
only proof/test sources and generated evidence. Released main changes are
inherited without authoring a Lunch Money, private-history or backend repair.

The earlier approved repair removed the separate Income tile, restored qualified
historical BAD and addressed the original 18 findings recorded below. Every
Household category was already iterated; the repair strengthened the visibility,
order and overlap proof rather than creating another category renderer.

The original ZIP and extracted g-blend files are accessible. The approved
desktop light, desktop dark and mobile light PNG bytes match the SHA256 hashes
recorded in `budget-blend-browser-receipt.json`. Those references control the
visual comparison; prototype figures do not become financial evidence.

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
| River adapter expected text | 1 | Compare exact printed currency, including the Unicode minus. Preserve native qualified historical values; do not override them by date role. Continue checking unknown gaps, zero, negative tone and Period figures access. |

## Browser proof

Run the existing fixture-only runner with Playwright and Chromium:

```powershell
$env:CHROME_PATH = '<Chromium executable>'
$env:PYTHON = '<Python with Pillow>'
$env:APPROVED_REFERENCE_DIR = '<exact approved reference PNG folder>'
$env:PROOF_BASE_SHA = '6a9f37da6009408e90013c39070f4b6be0a8ca3c'
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

Exercised code commit: `586fd3e9334e3133c08eda01ea8e5edaa04f4799`.
Source tree: `27abdbd4f2ebc1e368249d18e24bf7f99fff50f7`.
The receipt binds 181 tracked sources with Git blob IDs, SHA256 and byte counts.
Each repository asset served to the browser is checked against that binding,
and every scoped source is checked again after execution. The published evidence
commit may follow this code commit only with `docs/proof/` changes; scoped source
blobs and exercised bytes must still match. The runner was committed before
execution and was not edited afterward.

The fresh run passed: **37 screenshots**, **181 bound sources**, **29 served
repository assets**, `errors:[]` and `externalRequests:[]`. All 37 screenshot
hashes, every bound source and every served-asset hash were independently
verified after execution. The three approved repaired production hashes now
match the bounded review's committed-byte hashes exactly:

| Source | SHA256 of committed and exercised bytes |
|---|---|
| `public/plan.js` | `f88968d6b73ec9267f7eb2c64f978d133f9b0f9383088e56b6256e4c2966b769` |
| `public/budget-blend.js` | `9e0d9de512d30fdf2d35c488579304caac4cb06144ba75485e3c36b6c2845995` |
| `public/budget-gface.css` | `29ccf6f753a7daf27e8b7739c39524e01b9c089244c68bcbee0276705297274d` |
| `test/browser-budget-blend-proof.js` | `3d525e2e99af313de0202860c170c94078dfe2394abddfbf9de0e8feb2942b05` |

The receipt records results, exact reference hashes, source and served-asset
hashes, and screenshot hashes. `visualMatchApproved:false` remains an owner
decision. Side-by-side images
are review evidence; differences caused by native unavailable data are retained.
The approved dark reference ends before lower tiles, so lower dark fidelity
has no approved reference. Physical touch and signed-in production are untested.

Useful captures:

- [Desktop light](budget-blend-1440-light.png) and [desktop dark](budget-blend-1440-dark.png)
- [Mobile light](budget-blend-390-light.png) and [mobile dark](budget-blend-390-dark.png)
- [Every Household line, desktop](budget-blend-1440-light-household-all.png), [390](budget-blend-390-light-household-all.png), [320](budget-blend-320-light-household-all.png)
- [Qualified history, desktop](budget-blend-1440-light-past-qualified.png), [390](budget-blend-390-light-past-qualified.png), [320](budget-blend-320-light-past-qualified.png)
- [Incomplete history](budget-blend-390-light-past.png)
- [Desktop comparison](side-1440-light.png) and [mobile comparison](side-390-light.png)

## Numerical and validation boundaries

Forecast, canonical data and the numerical snapshot script are byte-identical to
integrated main `6a9f37da6009408e90013c39070f4b6be0a8ca3c`. That revision's
own script and inputs were extracted from its exact Git blobs and executed
independently of the candidate checkout. Both 582-key numerical snapshots have
SHA256 `60b0328bc9174270ef23c1bba6e2d61f52cc674204ad6cd07728ad6eeabc8ac6`.
Historical aggregate availability is an intentional presentation repair and is
proved separately through the real renderer and browser.

The PR merge card records the full-suite outcome and actual hosted checkout
identity. The focused BAD terms, timeline river, historical pay-period and new
source-binding suites pass in the fresh checkout. Prior Windows full-suite
limitations remain historical results and are not relabeled as a new local full
PASS. No out-of-scope history or Lunch Money repair is included. Prior Systems
PASS does not certify this head.

The keyboard walk records **18 outlined stops and 13 targets meeting its size
and visibility predicate**; its first 18 stops are not comprehensive
accessibility clearance. **16 visible-text contrast samples** passed; **two
empty-text probes** are unevaluated. These limitations from the bounded review
do not authorize changing
the approved design. Design, Engine, Money, current-head Systems and Dale's final
visual approval remain pending. Keep Draft.
