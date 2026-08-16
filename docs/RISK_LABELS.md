# Risk labels and review gates

This file records the repository's merge gates, what each gate checks, and the
demonstrated failure that justifies it. [`CLAUDE.md`](../CLAUDE.md) owns review
authority and the bounded review protocol.

## Primary risk — exactly one, from the Merge Card

| Label | Meaning | Owner action |
|---|---|---|
| `auto-safe` | No published figure moves and no fact changes home. | None. Merge on green. |
| `figures-moved` | A figure the household reads changes. | Read the figures diff and reconcile it with the card. |
| `owner-decision` | A household fact or owner-reserved decision is outstanding. | Answer the exact question. |
| `blocked` | A hard gate failed or a real blocker remains. | Do not merge. |

The Merge Card `Primary risk` row is the authority. The GitHub primary-risk
label is a synchronized projection of that closed value, not a second
judgement. `risk-label-gate.yml` reads the live card, applies exactly that
label, removes the other three, and requires the live GitHub label to equal
the card. It runs from the default-branch workflow through
`pull_request_target`, so a pull request cannot weaken the copy of the gate
that judges it. A malformed card fails red and does not invent a label.

Category labels are descriptive and non-blocking:

`engine` · `published-figures` · `plan-page` · `authority-docs` · `security` ·
`tests` · `infrastructure` · `evidence-only`

## Hard gates

### `merge-card-check`

The merge card check validates only mechanical facts:

- the Atlas Merge Card heading exists;
- the required table rows exist and are not blank placeholders;
- `Current-state verdict` opens with one documented closed value;
- `Primary risk` opens with one of `auto-safe` / `figures-moved` /
  `owner-decision` / `blocked`;
- the architecture-review decision opens `REQUIRED` or `NOT REQUIRED`;
- a required review records a bare 40-character SHA equal to the PR head,
  `Reviewer: ChatGPT`, and `Review outcome: PASS` — `PENDING` still fails
  closed, with an awaiting-review message rather than a generic PASS error;
- a not-required review records `N/A` for head, reviewer, and outcome; and
- card text is read from the live pull request (`pulls.get`), not the workflow
  event body. A closed PR, a non-`main` base, a PR or repository identity
  change, or a live head that is not the event head fails closed; and
- after trusted Atlas PASS card-sync, the default-branch repair workflow
  starts a fresh run of this same workflow via `workflow_dispatch`, with
  the PR number and expected head SHA. The dispatcher targets the PR head
  branch when that commit's workflow file already has the trigger, so the
  required check lands on that SHA. A PR head that predates the trigger
  cannot be targeted (`gh workflow run --ref` uses the workflow version at
  that ref); those runs use the default-branch workflow version, and this
  job records the required check on the expected PR head. That run uses
  the existing job name and the same live-PR validation. It fails closed
  if the live PR/head no longer matches. GitHub does not chain
  `pull_request` `edited` from `GITHUB_TOKEN`, so that event is not the
  automation path.

It does not parse prose, negation, severity, scope, dispositions, review rounds,
or open-loop narratives. It does not prove a review happened. It does not infer
PASS, merge, or write financial state. It prevents the mechanical failure in
which a required verdict outlives the code it covered, and the mechanical
failure in which a trusted PASS card-sync leaves the required check stale.

`test-mergecard.js` executes the real inline workflow script. It proves missing
fields, invalid decisions, stale heads, wrong reviewer identity, and non-passing
required outcomes fail. It proves the check reads the live PR body rather than
the workflow event body, and that a moved live head or a closed or retargeted
PR fails closed. It also proves `workflow_dispatch` with matching live PR/head
succeeds and fails closed on mismatch. A default-branch dispatch for a PR head
that predates the trigger records the required check on the expected head; a
non-default dispatch ref whose run SHA is not the expected head still fails
closed.

### `tests`

`npm test` runs the suites registered in [`test.js`](../test.js), which is the
registry. This file keeps no copy of that list: a second inventory drifts as
soon as a suite is added, and a gate document that misstates what the gate runs
is worse than one that does not enumerate it. One lived here until 2026-08-12
claiming seven suites against a registry that held fifteen.

What the suites are is `test.js`'s. **Why they block** is this file's, and each
one earns it against a demonstrated failure:

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
ordinary push does not create a requirement to rerun an optional audit. Native
Codex automatic reviews are the intended first advisory pass: Codex docs say
they post when a pull request is opened for review or marked ready, without an
`@codex review` comment. That lane is operational: PR #63 received a real
`chatgpt-codex-connector[bot]` review that found implementation defects. Codex
remains advisory. It is not Atlas PASS authority. The `codex-review-request.yml`
comment dispatcher remains retired: it never successfully posted `@codex review`,
and it is not replaced by another token or dispatcher. A justified second pass
remains a human `@codex review` comment. Atlas Contract / Systems Review, Merge
Card, and Codex→Cursor handling of genuine submitted Codex reviews remain
intact; deleting the broken dispatcher does not remove a hard merge authority.

## Control retirement

Governance controls are not grow-only. `CLAUDE.md` owns the lifecycle rule. A
control may be narrowed or retired when another surviving control covers its
demonstrated failure at least as directly, or when the protected path no longer
exists and a focused regression test proves that fact.

The retired controls in the simplification were review-prose parsing,
negation handling, advisory freshness reporting, review-round accounting,
machine-scored scope/atomicity narratives, and open-loop arithmetic. None
protected product behavior. The surviving tests, reconciliations, invariants,
security checks, exact-head equality, risk label, and owner gates do. The
later-retired `codex-review-request.yml` comment dispatcher is the same class:
it was a broken 403-producing comment poster, not a hard merge authority.
Native Codex automatic reviews are the intended first-pass advisory mechanism
and are proven operational as of PR #63. They remain advisory. Atlas Contract /
Systems Review, Merge Card, and Codex→Cursor handling of genuine submitted
reviews remain the surviving authorities.

## Setup

The labels are created from `.github/labels.yml`. Add `risk-label/primary` and
`test` to branch protection's required status checks for `main`. The owner makes
that repository-setting change; a workflow does not grant itself merge
authority.
