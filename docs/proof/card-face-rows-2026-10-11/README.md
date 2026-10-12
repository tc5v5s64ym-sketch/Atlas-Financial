# Card face rows proof — UI Task 2 second follow-on (2026-10-11)

Synthetic-fixture renders only (`test/fixtures/card-period-movements-data.js`,
served through route interception; invented balances and payees). No live
site, no household figures, no credentials.

## What this proves

`test/browser-card-period-movements.js` boots the real app (`App.boot`)
against the fixture and asserts, from rendered state (computed style and
bounding boxes, not DOM presence):

- **the face rule**: every card row is chip + short name + the published
  reported balance printed bare in the right-hand slot — no "Balance"
  prefix, no as-of date, no "Manual statement" suffix, no net-change or
  qualifier text anywhere on the tile, in either theme at 1440/390/320.
  The tile heading is exactly "Credit cards" and no heading net meta
  prints. Face names are the short publication labels; the Amazon card
  is exactly "Amazon".
- **the heading is semantic, not just painted** (Systems Review
  5485851551 R1 repair): the strip's actual `<h2>` and the region's
  `aria-label` read exactly "Credit cards" in every state — asserted by
  accessible name (`getByRole('heading', { name: 'Credit cards' })`),
  by exact heading text, and by the absence of any heading carrying the
  old "Card movement" name. On the plan-unavailable branch, where the
  renderer's own heading is the visible one (no blend furniture), the
  visible heading is asserted to be "Credit cards" as well; the first
  version of this follow-on changed only the blend skin's painted tile
  title and left the semantics behind, which is what the review caught.
- **the right-slot geometry** (the defect this follow-on kills): at every
  width the balance's grid area is the right slot (`chg`), its right edge
  equals the trigger's content right edge within 2px for every row, its
  top aligns with the card name's top (single-row rows — the ≤1100px
  full-width stacked second line is gone), and name and balance never
  overlap at 320px. On the previous face the balance stacked onto a
  second line at ≤1100px while "Unavailable" (the net dash) sat in the
  right slot; both are asserted absent.
- **the missing-balance state**: with one card's balance genuinely
  absent (the `balance-missing` passes: no canonical balance, no overlay
  proposal), its row prints the word "Unavailable" in the same right
  slot — same area, same right edge, state typography (12px / 500) —
  and the other rows keep their amounts. Past and future periods print
  the state word on every row: no period borrows the current balance.
  A genuine published $0.00 still prints $0.00 (unit suite).
- **the chip keying**: the per-row chip's network mark and hue key on the
  row's canonical card id (`data-budget-card-toggle`), never on the
  display name. Travel and Cash Back carry the Visa mark and Triangle
  and Amazon the Mastercard mark even though no face name contains a
  network word (under the old name-regex keying, Amazon had lost its
  Mastercard mark when its face name shortened to "Amazon", and Travel
  and Cash Back carried none). Emerald and the HELOC carry no mark.
- **the panel is untouched**: every panel assertion from the previous
  proof holds — the dated reported-balance evidence line, the manual
  statement observation, opening/closing blocks, ledgers, and the net
  evidence wording. Independently of this suite, the panel blocks were
  byte-compared between renders of the base renderer and this renderer
  across ten fixture publications (complete, future, historical,
  opening-missing, truncated, credit-ambiguous, zero-balance, HELOC,
  and two observed HELOC modes): 53 panels, byte-identical.
- **the blend (non-gface) face** restates the same rule in its own
  columns — balance in the right-hand column at primary size, no delta
  or dash elements — measured on clones of the real triggers.
- **contrast**: the balance text (the face's only figure) measures
  ≥ 4.5 against its painted background in both themes. (The previous
  proof measured the demoted net-change delta; the delta no longer
  prints on the face, so the block now measures the balance.)

## Receipt

`proof.json` is the harness's own receipt: the Chromium/Node runtime,
the SHA-256 of every screenshot, and `sourceBlobs` — git blob SHAs of
every exercised source file, so each file resolves by content in the
pushed head on GitHub. `basedOn` records the base commit the proof ran
against (current main at build time).

## Bite checks (each reverted, re-run, restored)

- Renderer reverted to the base version → the unit suite fails at
  "manual trigger balance shows the bare amount; provenance is
  panel-only".
- The ≤1100px stacked-swap CSS block restored alone → the browser proof
  fails at "complete 390px light: travelvisa balance occupies the right
  slot at every width".
- The net-change delta span restored alone (new balance kept) → the
  unit suite fails at "no trigger prints a net-change delta on the
  face".
- Heading repair (R1): with the new heading assertions in place and the
  renderer still at the reviewed head, the unit suite fails at "the
  strip region accessible name is Credit cards" and the browser suite
  fails at "complete 1440px light: one heading carries the accessible
  name Credit cards" (0 headings found); after the renderer fix both
  suites pass in full (unit 569 assertions; browser 21/21 passes), and
  the panel blocks re-compared byte-identical (53 panels, ten
  publications) between the base and repaired renderers.
