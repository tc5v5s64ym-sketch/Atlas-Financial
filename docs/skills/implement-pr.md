# Skill: implement-pr

**Load when** implementing any bounded pull request.

**Do not load for** a read-only question, the cold-start trial, or a
review-only pass.

**This is procedure, not authority.** On conflict, `CLAUDE.md` and
`ARCHITECTURE.md` win. Do not treat this file as household truth, owner
policy, or Forecast.

Also scan [`../lessons/TECHNICAL.md`](../lessons/TECHNICAL.md) for a
matching technical lesson.

---

## Before any edit

1. Record the exact current `main` SHA.
2. Inspect open pull requests. Two agents never implement the same
   outcome at once.
3. Follow `AGENTS.md`'s read order. Do not skip `CLAUDE.md` or
   `ARCHITECTURE.md`.
4. Fill the Current-State Verification Gate from current `main`
   (`CLAUDE.md`). If it is already fixed, do not manufacture code.
5. If the work touches Forecast, `data.json` plan policy, or a page that
   renders a household figure, also load
   [`forecast-runtime.md`](forecast-runtime.md).
6. If the work absorbs owner-supplied evidence, also load
   [`evidence-intake.md`](evidence-intake.md).

## Branch and outcome

- Fresh `agent/<outcome>` from current `main`.
- One independently provable outcome. `CLAUDE.md` owns the outcome rule,
  tripwires, atomicity exception, and finding dispositions.
- Do not continue another agent's branch without the handoff in
  `docs/BUILDER_PORTABILITY.md`.

## While implementing

- Stage only intended files. Never `raw/`, `derived/`, credentials, or
  unrelated drift.
- Restore `core.hooksPath` to `.githooks` before committing locally.
  Never `--no-verify`.
- Classify defects (local / authority / missing capability) before
  widening the diff. `FIXED NOW` needs a test and must share this
  outcome's root cause or authority boundary.
- *"While I'm here"* is not a reason.

## Proof and card

- `npm test`, then whatever the change actually touches (`CLAUDE.md`
  Testing). After editing this skill folder or
  `docs/AGENT_CONTEXT.md`, also run `node test-agent-context.js`.
- A household-facing figure needs independent proof: a second method,
  an institution number, or a total that has to agree. A test of the
  same function that computes the figure is consistency, not
  correctness.
- Fill the Atlas Merge Card. Never guess a model name.
- Declare Atlas Contract / Systems Review `REQUIRED` or `NOT REQUIRED`
  from `CLAUDE.md`'s trigger list, against what the PR actually
  touches. Request that review only on a stable merge candidate.

## Stop

Owner-reserved stops, credentials, raw data, and merge policy remain
`CLAUDE.md`. This skill does not add a ceremony.
