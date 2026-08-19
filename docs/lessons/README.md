# Technical lessons

Durable, **non-authoritative** engineering lessons from actual Atlas
work.

The living list is [`TECHNICAL.md`](TECHNICAL.md).
How this layer fits: [`../AGENT_CONTEXT.md`](../AGENT_CONTEXT.md).

## How to load

Do not read `TECHNICAL.md` cover to cover at the start of every task.
Jump to a cited lesson ID, or search the file for terms related to the
current work, when a recurring failure seems relevant. The store is
allowed to grow; progressive disclosure depends on that targeted
retrieval.

## Hard boundary

A lesson is a warning about how work on this repository has gone
wrong. It is never:

- household financial truth
- owner policy, risk tolerance, reserve targets, or permission to
  spend or borrow
- Forecast behavior
- a second planner, store, schema, or authority
- a substitute for `ARCHITECTURE.md` or `CLAUDE.md`

If a lesson and an authority document disagree, the authority
document wins and the lesson is stale. Fix or delete the lesson.

## Permission

An agent may **propose or add** a lesson in a reviewed pull request
when all of these hold:

1. **Provenance** — a PR number, commit, review, test failure,
   incident, or other repository-traceable reference.
2. **Engineering scope** — the lesson is about architecture, tests,
   tools, or review churn, not about what the household should do
   with money.
3. **No silent promotion** — the PR does not also treat the lesson as
   a new always-loaded rule. If the failure needs a durable
   *authority* change, that change belongs in the owning document,
   with its own outcome and proof.
4. **Simplification allowed** — a lesson whose failure path is gone
   should be marked `retired` or deleted, with the evidence.

Agents may not maintain a private parallel lessons file and then
treat it as repository state. Chat scratch is not the handoff
(`docs/BUILDER_PORTABILITY.md`).

## Format

Each lesson in `TECHNICAL.md` has an id, status (`active` / `retired`),
evidence, the lesson itself, and an explicit **Not** line stating
what it must not be used as.
