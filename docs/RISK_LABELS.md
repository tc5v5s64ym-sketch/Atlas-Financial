# Risk labels and review gates

This file records the repository's merge gates, what each gate checks, and the
demonstrated failure that justifies it. [`CLAUDE.md`](../CLAUDE.md) owns review
authority and the bounded review protocol.

## Delivery path

Cursor builds and runs focused/local tests → pull request → one GitHub-hosted
**Atlas CI** check → ChatGPT exact-head Atlas Contract / Systems Review when a
high-risk trigger fires → `PASS` plus green CI → merge.

GitHub Pro branch protection (configured by the owner after the code that
introduces Atlas CI lands) enforces the PR + CI boundary on `main`. Intended
settings:

- `main` is protected
- changes land through a pull request
- the required status check is **Atlas CI**
- force pushes and deletion are blocked
- "require branch to be up to date" stays off unless a real race appears —
  that setting mostly creates extra CI reruns
- do **not** require a GitHub reviewer; a single-owner repository would
  self-block
- the owner retains emergency/bypass authority

Native ChatGPT / Codex usage is the review lane. There is no OpenAI API
review path and no `OPENAI_API_KEY` in Actions.

## Primary risk — human guidance, not a GitHub label gate

| Signal | Meaning | Owner action |
|---|---|---|
| no figures moved, no owner question | Safe on green Atlas CI, plus ChatGPT `PASS` when review was required. | None. Merge on green. |
| figures moved | A Plan-page figure the household reads changes. | Read the Atlas CI figures summary and reconcile it with the card. |
| owner decision required | A household fact or owner-reserved decision is outstanding. | Answer the exact question. |
| blocked | A hard gate failed or a real blocker remains. | Do not merge. |

The merge card records the signal. GitHub labels are optional description.
They are not a second merge authority.

## Hard gates

### Atlas CI

One GitHub-hosted job per pull-request head update. It does not also run on
branch push. The check name is `Atlas CI`.

It preserves the demonstrated deterministic protection:

- `npm test` — the financial publication correctness suite in [`test.js`](../test.js),
  including the static/raw-data guard in `test-static.js`
- published-figure comparison — `scripts/figures-snapshot.js` on base and head,
  diffed by `scripts/figures-compare.js`, written to the check summary

A moved figure does not fail the job. The failure mode this comparison exists
to catch is a figure moving *unnoticed*. The weekly-cap defect that started
the correctness work changed a derived answer by $400 without crashing; a
`data.json` diff would not have shown it.

Scope of the snapshot is Plan-page headline figures. It does not cover Deep
Dive, Records, or Modellers.

No secrets are used. The password gate and live-site checks stay out of CI
because they need `SITE_PASSWORD` and a deployed instance.

`test-atlas-ci.js` proves this is the only workflow, that it still runs
`npm test` and the figure comparison, and that the OpenAI API review path
and the retired orchestration files are gone.

### `npm test`

[`test.js`](../test.js) is the registry. This file keeps no copy of that list.

**Why the suites block** is this file's, and each one earns it against a
demonstrated failure:

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
Atlas CI repeats the content scan via `test-static.js`; the hook does not run
in Actions.

### Owner-reserved gates

No workflow can authorize raw-data handling, credentials, security
infrastructure, a household fact, an estimate-to-verified promotion, a store,
financial-data connectivity, or a direction change. The owner gate in
`CLAUDE.md` remains blocking.

## Review surfaces

### Published figures — Atlas CI summary

The same Atlas CI job writes which Plan-page figures moved. It exists because
the shipped weekly-cap defect changed a derived answer without crashing. Moving
a figure is often the purpose of a PR; an unexplained mismatch between the
summary and the merge card is still a correctness defect to resolve.

### Atlas Contract / Systems Review — trigger-based blocking review

This review is required only for the high-risk triggers in `CLAUDE.md`.
The question is whether the exact head is unsafe or architecturally wrong to
merge. ChatGPT performs it on the exact head. A builder cannot declare `PASS`.
There is no Actions job that calls the OpenAI API to produce that review.

### Independent improvement audit — optional

Default to at most one advisory pass. Native Codex automatic reviews remain
an acceptable advisory first pass. Codex is not Atlas `PASS` authority.

## Control retirement

Governance controls are not grow-only. `CLAUDE.md` owns the lifecycle rule.

This simplification retires custom machinery whose purpose is now carried by
GitHub Pro branch protection, the one Atlas CI check, ChatGPT exact-head
review, and Cursor's own build/repair:

- OpenAI API first-review and re-review (`OPENAI_API_KEY`)
- first/rereview dispatchers
- Codex/Cursor repair GitHub-Action orchestration
- Merge Card mechanical/executable gate
- risk-label Actions gates and redundant label Actions
- PENDING / card-sync / retry plumbing
- scripts and tests that existed solely to prove that orchestration

What replaces each demonstrated protection:

| Retired control | Surviving protection |
|---|---|
| `tests` workflow (push + pull_request) | Atlas CI on pull_request only, still running `npm test` |
| `figures-review.yml` comment job | Same snapshot comparison inside Atlas CI, on the check summary |
| `merge-card-check` exact-head / REQUIRED fields | ChatGPT exact-head review as a human record; Atlas CI for code; builder cannot write `PASS` |
| `risk-label/primary` | Figures summary + merge-card owner-decision row + branch protection |
| OpenAI API Atlas review | Native ChatGPT exact-head review on the ChatGPT subscription |
| Cursor repair Actions | Cursor's own build/repair on the PR |
| Label sync / auto-label | Optional manual labels; not a safety property |

The earlier-retired controls (review-prose parsing, advisory freshness
reporting, the broken `codex-review-request.yml` dispatcher) stay retired.

Standing auto-merge of qualifying no-figures-moved pull requests remains
owner-granted and must not become operational until GitHub itself is
enforcing **Atlas CI** on `main`. That grant does not apply to
figures-moved work, owner-reserved stops, or any other owner-reserved item.
