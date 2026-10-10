# Card panels browser proof — UI Task 2 repair (PR #575)

Synthetic-fixture renders only (`test/fixtures/card-period-movements-data.js`,
served through route interception; invented balances and payees). No live
site, no household figures, no credentials.

## What this proves

`test/browser-card-period-movements.js` boots the real app (`App.boot`)
against the fixture and asserts, from rendered state:

- the card strip's period, per-card qualification and the trigger's
  qualified reported balance (Scope A: labelled Balance, as-of date, and a
  Manual-statement source label only where the publication supports one);
- the native detail-sheet lifecycle for card panels: open, Close, Escape,
  focus return, remount restore, viewport change;
- **the plan-unavailable regression**: with the operating plan withheld,
  the Budget surface's unavailable branch still renders the card/HELOC
  triggers — and, after this repair, the native sheet host — so card and
  HELOC sheets open there with balances/ledger/qualification intact
  (Close, Escape, focus return, remount restore all asserted on that
  branch at 1440/390/320);
- **switching period while the sheet is open**: the same card panel is
  restored in the new period with the new period's qualification
  ("Future period not observed", no borrowed ledger), focus stays inside
  the sheet, and stepping back restores the current ledger;
- visible navigation: the river slider's keyboard contract steps exactly
  one period each way; the visible Today button returns; the granularity
  toggle is driven inside the period-figures sheet where the blend face
  re-homes it, and month view is exited through its own visible drill
  button and drilldown exit.

## Qualifications (claims deliberately narrowed)

- The while-open period switch is the one transition not driven by a
  visible control: the sheet is a modal dialog (`showModal`), so the
  background — river, arrows, wheel — is inert by design while it is
  open. The switch is delivered through the app's own window-step
  control, the same handler the visible controls invoke, and every
  assertion is on the rendered result.
- The manual-statement qualifier's "· Dated …" suffix is not visible
  text on the blend face and is not asserted anywhere. The visible dated
  evidence is the trigger Balance line and the open panel's dated
  observation line; both are asserted from rendered text.

## Receipt

`proof.json` is the run receipt: runtime (Node, Chromium), the exercised
sources bound by git blob SHA (content addresses — each resolves in the
pushed head's tree on GitHub), the integration base the run was produced
against (`basedOn`), and every committed screenshot with its SHA-256.
The committed set is the `complete` and `plan-unavailable` states; a full
run (all five evidence states + plan-unavailable) is the default.

## Reproduce

```bash
CHROME_PATH=<Chromium> node test/browser-card-period-movements.js
# committed-artifact mode:
ATLAS_BUDGET_SCREENSHOTS_DIR=docs/proof/card-panels-2026-10-10 \
ATLAS_PROOF_ONLY=complete,plan-unavailable \
ATLAS_PROOF_BASE=<main sha> \
CHROME_PATH=<Chromium> node test/browser-card-period-movements.js
```

Requires Node with `playwright` resolvable and a Chromium executable.
