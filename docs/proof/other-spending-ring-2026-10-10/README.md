# Other Spending ring — browser proof (2026-10-10)

UI Task 4: Other Spending renders as a ring like its sibling categories —
spent/plan fill, amber identity — and the duplicate `.blend-other` footer
chip is retired. The published Actual / Planned pair leaves the tile
header and becomes the tile's bottom totals, printed verbatim; the
"Still planned… / From today" sentence leaves the header and lives in
the detail sheet's evidence body. Face layout per the owner amendment
(section below): the ring centre carries the category name and the
category's published Actual / Planned pair prints beneath the circle.
Two details of that face were corrected on the repair head below
(Systems Review 5482743628): the personal rings' visual centres read
exactly `Dale` / `Amanda`, and a pair with a missing side prints that
side explicitly as `Unavailable`.

Generator: `test/browser-budget-other-ring.js` (assertions + captures),
fixture `test/fixtures/other-period-target.js`. Receipt: `proof.json`
(basedOn = the main commit the PR integrates; exercised sources bound by
git blob SHA-1; a SHA-256 per screenshot; runtime recorded).

## States (after/)

Fixture Other Spending plan is $450.00; household Actual/Planned are the
fixture's published pair.

| State | Meaning | Centre | Beneath the circle | Arc |
|---|---|---|---|---|
| `partial` | spent $137.26 of $450 | `Other spending` | `Spent $137.26 / of planned $450.00` | spent/plan segment |
| `zero` | known zero spent | `Other spending` | `Spent $0.00 / of planned $450.00` | no segment, solid track (known zero ≠ unknown) |
| `over` | spent $618.73 of $450 | `Other spending` | `Spent $618.73 / of planned $450.00` | capped at full ring; `Over plan` pill stays visible; overflow lap at 37% with marker + tip |
| `over125` | spent $562.50 of $450 (125%) | `Other spending` | `Spent $562.50 / of planned $450.00` | full red lap + quarter overflow lap; marker at the lap origin; tip at the quarter point |
| `over200` | spent $900.00 of $450 (exactly 200%) | `Other spending` | `Spent $900.00 / of planned $450.00` | two complete red laps; tip back at the origin; marker stays; no `2x+` |
| `over2x` | spent $990.00 of $450 (220%) | `Other spending` | `Spent $990.00 / of planned $450.00` | two complete red laps; marker stays legible; display-only `2x+` beside the pair |
| `unknown` | transaction coverage truncated | `Other spending` | `Spent Unavailable / of planned $450.00` | no arc, dotted track — the actual never rendered as $0.00 |
| `noplan` | completed period, plan withheld | `Other spending` | `Spent $137.26 / of planned Unavailable` | no invented arc; totals print the plan as Unknown |
| `zeroplan` | a sibling category (Dog food) publishes a $0.00 plan | `Dog food` (that ring) | `Spent $0.00 / of planned $0.00` | no segment — no share is published for a zero denominator; the Other ring is unaffected |

Each state is captured at 1440 / 390 / 320 px in light and dark
(`other-ring-<state>-<width>-<theme>.png`, 54 files). Assertions in the
generator additionally cover: the ring opens the native Other Spending
detail panel (needs-category status read there), the From-today cell in
the evidence body, Escape/focus return, the accessible name carrying the
printed amounts and the unassigned status, and the bottom totals sitting
below the rings.

## Owner amendment head

The owner amended the Household tile layout after Systems Review PASS
5481530843 (recorded on the pre-amendment head
`7eb24a70901b1d70708eceb3a7223c576147135a`); the amendment was relayed
and boundary-approved by Atlas in #atlas-coordination thread
1791643511.871799 (approval ts 1791696019.164519) and supersedes the
amount-only centre. Now: the ring **centre carries the published
category name** (the source row's printed label, verbatim — the
fixture's personal categories publish "Dale guilt-free spending" /
"Amanda guilt-free spending" and print exactly that), and **beneath
each circle** the category's published Actual / Planned pair prints,
read from the row's own printed meta (`Spent X / of planned Y`; an
unknown side prints its published word, never `$0.00`; Other
Spending's unassigned row publishes no pair, so its spent token prints
alone). The tile's bottom totals are the unchanged published pair.
Fill, liquid and its R2 terminal states, and the accessible names are
exactly as the PASSed head established — the full printed status
(spent, planned/remaining, qualifications) stays in the accessible
name now that the visible centre carries the name. The state matrix
above was re-run for Other AND ordinary categories (groceries, fuel,
the personal categories) on this head, integrated on main
`acf2f7b70a31d3df4e1b93c8255f46c457f34565` (PR #575 merged first —
the sole overlap, `public/budget-blend.css`, was three-way merged so
#575's `.card-movement-balance` rules coexist with this PR's ring/total
rules; PR #576 then merged with no PR-file overlap — only the
`public/forecast.js` proof binding moved, and it was resynced; PR #570
then merged, overlapping `public/budget-gface.css` in its river-tile
rules only — three-way merged clean, disjoint from the ring rules).
Two sentences above describe that head exactly and are superseded on
the repair head (see the 5482743628 section below): the personal
centres printed the full published labels there, and the unassigned
row's spent token printed alone.

## Repair head — Systems Review 5482743628 (BLOCK on `8788cf15`)

Three bounded defects, all dispositioned on this head:

1. **Personal visual centres.** The personal rings' centres copied
   the full source labels (`Dale guilt-free spending` / `Amanda
   guilt-free spending`, multiline at 320px). The visual centre now
   maps the two personal categories to exactly `Dale` / `Amanda`;
   every other ring keeps its published name verbatim. Only the
   visual centre changes — the accessible name and the sheet
   identity keep the source row's full published label (asserted).
   The regressions that expected the full visual labels (the ring
   generator, the panel-repairs native-names check, and the blend
   proof's household-all shown names) now expect the approved short
   labels for those two rings.
2. **Missing pair side.** Other's no-plan row publishes no pair, and
   the beneath-circle label collapsed to the spent token alone
   (`$137.26`). The pair now always prints in Actual / Planned order:
   the known published side verbatim, the missing side explicitly
   `Unavailable` — never a lone amount, never an invented zero.
   Paired regressions: missing actual (`Spent Unavailable / of
   planned $450.00` for Other, `$220.00` for groceries, truncated
   coverage) and missing plan (`Spent $137.26 / of planned
   Unavailable` for Other, `Spent $110.37 / of planned Unavailable`
   for groceries, completed period).
3. **True zero-plan coverage.** A missing plan is not a zero plan.
   The generator now builds a fixture variant (`zeroPlan: ['pets']`)
   whose Dog food category publishes a $0.00 plan with known
   actuals: both pair sides print verbatim (`Spent $0.00 / of
   planned $0.00` — the known zero plan is a value, not
   `Unavailable`), and the established handling holds — no share is
   published for a zero denominator, so no arc, no liquid and no
   overflow decomposition. The `zeroplan` state joins the capture
   set (54 tile captures + 18 well close-ups).

The overflow geometry, the whole-ring red treatment, the marker and
tip, and the unknown / known-zero distinctions the review accepted
are unchanged. That head integrated current main `b78202c2` (PR
#579, which changed `public/forecast.js` and one classification
test): no implementation-file conflict, and the exercised
`public/forecast.js` source binding was resynced to the new main —
all bindings in `proof.json` resolved in the pushed tree. Atlas
then integrated that head onto main `b99e3c7e` (PR #580 merged) as
merge commit `e61f0e16`; the head below is that integrated tree plus
one bounded repair.

## Repair head — Systems Review 5483272344 (BLOCK on integrated head `e61f0e16`)

One bounded defect (Codex P2 5483241754): in a completed period, the
Other ring button's explicit accessible name omitted the
unavailable-plan qualification the visible pair prints (`Spent
$137.26 / of planned Unavailable`). The bridge built the name from
the source row's text alone; Other's row publishes no pair (its meta
is the unassigned note and its status carries the spent amount), so
no plan side reached the name, and no associated description
supplied it. The bridge now appends the synthesized `; planned
Unavailable` qualification to the Other ring's accessible name
exactly when its row publishes a spent amount but no printed pair —
the visible pair's own fallback condition — preserving the full
source label, status and amounts ahead of it. Known-plan names (a
printed pair exists) and every sibling ring are unchanged: their
source text already carries the pair. The generator asserts the
EFFECTIVE accessible name (the button's explicit `aria-label`, the
focus announcement — not the pair's descendant text) carries both
the actual amount and the qualification, with two controls: no
synthesis in the known-plan state, and the ordinary groceries ring's
name unchanged in the same completed period (its row already prints
the plan side `Unavailable`). Bite check: the updated generator
fails against the pre-repair integrated source exactly at the new
assertion, showing the pre-repair name (`Other spending $137.26 Not
yet assigned to a budget category Transactions ›`). The change is
not visual; the captures were re-rendered on the final tree
regardless, and all bindings in `proof.json` resolve in the pushed
tree.

## Overflow head — approved boundary (ts 1791699806.567609)

Past 100% of plan the ring **laps**, decomposing the same published
spent/plan share (the painter reads the unclamped ratio from the same
printed meta tokens; lap 1 and the liquid keep the clamped share
exactly as before). Atlas approved the boundary with two corrections,
both applied: **(1)** the red treatment covers the **whole ring** —
lap 1 *and* the overflow lap — not the overflow lap alone; within the
red treatment the overflow lap reads as a brighter core line and its
tip stays a distinct dot. **(2)** The **200% rule**: the second lap is
drawn exactly through 200% (its fraction is ratio − 1, capped at a
complete lap); past 200% the geometry stays two full laps and a
display-only **`2x+`** label prints beside the pair — a threshold
label, not a computed or printed percentage, and it never enters the
accessible name. A fixed **budget-limit marker** (an ink tick at the
lap origin, top of the ring) is painted above lap 1 and below the tip,
so it stays legible when the second lap completes and the tip returns
to the origin. Exact 100% draws a full lap with no overflow and no
marker; zero-plan / missing-plan and unknown-actual rings grow no
decomposition, no overflow, no marker and no label — the withheld /
unknown behaviour is untouched. The generator asserts the matrix for
Other AND groceries (125% and 220% via extra fixture transactions):
overflow presence only past 100%, computed red on both laps, drawn
fraction = share − 1 through 200% and complete at 200%, `2x+` only
past 200%, marker position, and tip position; `proof.json`'s
`pixelChecks.overflow` records the marker/tip pixels in both themes
(marker tick: (11, 12, 16) light / (245, 246, 248) dark at the well's
top-centre in the 125% and >200% wells, absent in the partial well;
125% tip: the exact over colour (194, 65, 12) light / (253, 186, 116)
dark).

## Repair head — Systems Review 5481323065 (R1/R2)

The first head applied the spent treatment to Other only. R1: **every**
Household ring now fills with the published spent/plan share, centres
the spent amount alone (centre treatment since superseded by the owner
amendment above), and levels its liquid by the spent share
(ordinary categories asserted in the generator: groceries partial +
overspend, fuel known-zero + exact, unknown under truncated coverage;
`test/browser-budget-unknown-ring.js` migrated to the same semantics).
R2: the liquid's terminal states — at a known zero there is **no liquid
element** (the wave surface otherwise leaves a visible sliver at the
bottom of the glass), and at a full or overspent share the liquid stays
(full arc, full interior). Well close-ups
(`other-well-<state>-<theme>.png`, 18 files on the current head —
the `zeroplan` state added two) carry the pixel evidence:
`proof.json`'s `pixelChecks` records the sampled interior pixels —
zero (245, 239, 234) matches unknown (238, 239, 243) at both sample
points (visibly empty), while overspent (226, 157, 77) is water-tinted
at both points (visibly full), light theme.

## Before set (before/)

The same fixture's partial state rendered by pristine current main (the
retired chip face: amber-dot chip row under the rings, the Still planned /
From today sentence in the tile header), at 1440 / 390 / 320 px in light
and dark. Captured with `ATLAS_OTHER_RING_ROOT` pointed at a pristine
main tree, `ATLAS_OTHER_RING_SHOTS_ONLY=1`, `ATLAS_OTHER_RING_BEFORE=1`.

## Reproduce

```
NODE_PATH=<playwright modules> CHROME_PATH=<Chromium> \
  node test/browser-budget-other-ring.js
```

Screenshots land in `ATLAS_OTHER_RING_SHOTS_DIR` (default: a temp dir);
the committed set was copied from a passing run on the pushed tree, and
every committed PNG's SHA-256 is recorded in `proof.json`.
