# Card reported-balance face proof — UI Task 2 follow-on (2026-10-11)

Synthetic-fixture renders only (`test/fixtures/card-period-movements-data.js`,
served through route interception; invented balances and payees). No live
site, no household figures, no credentials.

## What this proves

`test/browser-card-period-movements.js` boots the real app (`App.boot`)
against the fixture and asserts, from rendered state (computed style and
bounding boxes, not DOM presence):

- **the emphasis swap**: when a card trigger prints the publication's
  reported balance, the balance is the primary face figure (16px / 650 /
  primary ink) and the net change is demoted (weight 520, direction
  colours kept). At wide widths the balance occupies the grid's primary
  `chg` slot and the delta the `bal` slot; at ≤1100px — where the `chg`
  column cannot hold the 16px balance string beside the card name — the
  balance takes a full-width primary row under the name row and the
  demoted delta stays at the top right. The blend (non-gface) face
  restates the swap in its own columns and is measured on clones of the
  real triggers. Both themes, 1440/390/320.
- **the gate**: triggers with no balance line (past and future periods)
  match none of the swap rules — the unavailable dash keeps the primary
  slot, the delta keeps its original weight, and no figure is promoted
  or invented. A genuine published $0.00 still prints $0.00 (unit suite).
- **the dash cases**: net unavailable alongside a published balance
  (Amazon and Triangle, every served state; Travel in the
  opening-missing/truncated states) — the dash follows the delta to the
  demoted position; with neither figure available it stays primary.
- **reading order**: the balance span is emitted before the delta, so
  assistive order matches the visual order.
- **face as-of dates**: only the Triangle and Amazon faces print the
  balance's as-of date; every other face omits the date segment. The
  detail panel keeps the dated reported-balance evidence for every card
  (Travel and Cash Back panels asserted). Keying is on the publication's
  canonical card id (`triangle` / `mbna` in Forecast's identity table),
  never on the display label — the unit suite carries a decoy whose
  label contains "Amazon" and asserts it is neither relabelled nor
  dated.
- **the Amazon face name**: exactly "Amazon", keyed on canonical id
  `mbna`. The publication label ("Amazon Mastercard") is unchanged and
  still names the panel and the screen-reader action.
- figures are byte-identical apart from position/emphasis and the two
  Atlas-directed face changes above: the unit suite
  (`test/test-card-period-movements.js`, 561 assertions) pins the
  publication semantics and the exact rendered strings.

Bite checks (each reverted, re-run, restored): the two face stylesheets'
swap blocks removed → the proof fails at "balance takes the primary
size"; the renderer reverted → the proof fails at "the Amazon face name
is exactly Amazon"; only the emission order reverted → the proof fails
at "balance precedes the delta in reading order".

## Qualifications (claims deliberately narrowed)

- The while-open period switch is delivered through the app's own
  window-step control (the modal sheet makes the background inert by
  design); every assertion is on the rendered result.
- The manual-statement qualifier's "· Dated …" suffix is not visible
  text on the blend face and is not asserted. The "· Manual statement"
  suffix on the balance line itself is a separate segment and is
  unchanged.
- The committed `docs/proof/budget-blend-browser-receipt.json` binds the
  blend stock harness's sources and predates this change; that harness
  aborts in its river-port section on this base (pre-existing, identical
  on pristine main — see PRs #577/#583). The bound receipt for this
  change is this directory's `proof.json`, whose `sourceBlobs` pin every
  exercised source including both face stylesheets.

## Receipt

`proof.json` (written by the test) records the runtime, the exercised
sources' git blob SHAs, every state/width pass with its contrast checks,
and SHA-256 for each screenshot in this directory.
