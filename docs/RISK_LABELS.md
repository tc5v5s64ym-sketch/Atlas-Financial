# Risk labels and review gates

This file records the repository's merge gates, what each gate checks, and the
demonstrated failure that justifies it. [`CLAUDE.md`](../CLAUDE.md) owns review
authority and the bounded review protocol.

## Primary risk label — exactly one

| Label | Meaning | Owner action |
|---|---|---|
| `auto-safe` | No published figure moves and no fact changes home. | None. Merge on green. |
| `figures-moved` | A figure the household reads changes. | Read the figures diff and reconcile it with the card. |
| `owner-decision` | A household fact or owner-reserved decision is outstanding. | Answer the exact question. |
| `blocked` | A hard gate failed or a real blocker remains. | Do not merge. |

`risk-label-gate.yml` enforces exactly one primary label. It runs from the
default-branch workflow through `pull_request_target`, so a pull request cannot
weaken the copy of the gate that judges it.

Category labels are descriptive and non-blocking:

`engine` · `published-figures` · `plan-page` · `authority-docs` · `security` ·
`tests` · `infrastructure` · `evidence-only`

## Hard gates

### `merge-card-check`

The merge card check validates only mechanical facts:

- the Atlas Merge Card heading exists;
- the required table rows exist and are not blank placeholders;
- `Current-state verdict` opens with one documented closed value;
- the architecture-review decision opens `REQUIRED` or `NOT REQUIRED`;
- a required review records a bare 40-character SHA equal to the PR head,
  `Reviewer: ChatGPT`, and `Review outcome: PASS`; and
- a not-required review records `N/A` for head, reviewer, and outcome.

It does not parse prose, negation, severity, scope, dispositions, review rounds,
or open-loop narratives. It does not prove a review happened. It prevents the
mechanical failure in which a required verdict outlives the code it covered.

`test-mergecard.js` executes the real inline workflow script. It proves missing
fields, invalid decisions, stale heads, wrong reviewer identity, and non-passing
required outcomes fail.

### `tests`

`npm test` runs seven suites:

1. static and security sanity;
2. forecast engine and opening-gap regression;
3. household-budget reconciliation;
4. coupled cash-and-debt reconciliation;
5. one-authority invariants;
6. named authority-surface coverage; and
7. merge-card mechanical behavior.

These stay blocking because they protect demonstrated failures:

- the weekly cap double-counted a payday;
- one page published `$1,650/week` and `$0/week` for the same concept;
- standing facts contradicted each other in separate locations;
- the incumbent authority table repeatedly omitted real financial authorities;
- a new authority surface could otherwise be added without being registered; and
- the raw-data pre-commit safety hook silently stopped running after its
  executable bit was lost.

The authority-surface guard deliberately claims coverage only of the named,
mechanically enumerable surfaces recorded by `B75`: Forecast exports, the named
`data.json plan.*` policy keys, the payoff/renewal calculators, and the named
artifact-writing scripts. It proves that removing a known row or adding a new
Forecast export without classification fails. Page scripts that decide rather
than render remain a review-detectable class because no honest closed mechanical
signature exists for them.

The numerical suites use independent totals or identities where correctness is
at stake. A test of the same function that computes the answer is not an
independent reconciliation.

### Security and secret checks

The static suite and pre-commit hook keep identifiers, raw/derived data,
credentials, secrets, PDFs, and protected security behavior out of tracked
changes. These controls remain hard because the repository contains private
household source material and previously lost its hook protection silently.

### Owner-reserved gates

No workflow can authorize raw-data handling, credentials, security
infrastructure, a household fact, an estimate-to-verified promotion, a store,
financial-data connectivity, or a direction change. The owner gate in
`CLAUDE.md` remains blocking.

## Review surfaces

### Published figures review — advisory reconciliation

`figures-review.yml` runs the engine on the base and head and comments with the
figures that changed. It exists because the shipped weekly-cap defect changed a
derived answer without crashing. The workflow is advisory because moving a
figure is often the purpose of a PR; an unexplained mismatch between the comment
and merge card is still a correctness defect to resolve.

### Atlas Contract / Systems Review — trigger-based blocking review

This manual review is required only for the high-risk triggers in `CLAUDE.md`.
The question is whether the exact head is unsafe or architecturally wrong to
merge. The initial pass reports blockers only. A follow-up verifies the named
fixes and the high-risk surface changed by those fixes. It does not reopen the
untouched artifact for unlimited new findings.

### Independent improvement audit — optional

Default to at most one advisory pass. A second pass is justified only for a
high-severity/systemic finding or a response that materially changes a high-risk
runtime, security, schema, authority, cutover, or product-trust surface. The
retired `codex-review.yml` freshness reporter is not needed under this rule: an
ordinary push does not create a requirement to rerun an optional audit.

## Control retirement

Governance controls are not grow-only. `CLAUDE.md` owns the lifecycle rule. A
control may be narrowed or retired when another surviving control covers its
demonstrated failure at least as directly, or when the protected path no longer
exists and a focused regression test proves that fact.

The retired controls in the simplification were review-prose parsing,
negation handling, advisory freshness reporting, review-round accounting,
machine-scored scope/atomicity narratives, and open-loop arithmetic. None
protected product behavior. The surviving tests, reconciliations, invariants,
security checks, exact-head equality, risk label, and owner gates do.

## Setup

The labels are created from `.github/labels.yml`. Add `risk-label/primary` and
`test` to branch protection's required status checks for `main`. The owner makes
that repository-setting change; a workflow does not grant itself merge
authority.
