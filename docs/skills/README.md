# Skills catalog

Procedural instructions for recurring classes of work.

**Load on demand.** A fresh agent should not read this folder until the
task matches a row below. Skills are not Atlas authority, not Forecast,
not household truth, and not owner policy. There is no minimum skill
count. A skill that only copies an always-loaded authority document
should be deleted, not kept for symmetry.

How the layers fit: [`../AGENT_CONTEXT.md`](../AGENT_CONTEXT.md).
Permanent authority stays in `ARCHITECTURE.md` and `CLAUDE.md`.

## Catalog

| Skill | Load when | File |
|---|---|---|
| `forecast-runtime` | Changing `public/forecast.js`, `data.json` plan policy, or a page that renders a household-facing figure | [forecast-runtime.md](forecast-runtime.md) |
| `evidence-intake` | Absorbing owner-supplied statements, screenshots, conversations, workbooks, or interviews | [evidence-intake.md](evidence-intake.md) |

Load **one** matching skill. If two match, load both; do not invent a
combined super-skill. Most implementation work matches neither row:
follow `CLAUDE.md`, which is already always loaded.

## Not a skill in v1

| Class of work | Where the procedure already lives |
|---|---|
| Bounded implementation pull request | `CLAUDE.md` — already always loaded. Do not copy current-state verification, branch rules, the one-outcome rule, merge-card rules, review triggers, or merge behavior into a skill. |
| Exact-head Atlas Contract / Systems Review | `CLAUDE.md` — load that section when requesting or performing the review. Recurring SHA pitfall: lesson L-003. |
| Builder/model handoff | `docs/BUILDER_PORTABILITY.md` |
| Merge card mechanical fields | `.github/PULL_REQUEST_TEMPLATE.md` plus `CLAUDE.md` |

## Lessons for a matching skill

A skill may cite specific lesson IDs. When a recurring failure seems
relevant, search [`../lessons/TECHNICAL.md`](../lessons/TECHNICAL.md)
for terms related to the current task. Do not read the whole lessons
store at the start of every implementation. The store is allowed to
grow.

## Adding or removing a skill

A new skill needs a recurring class of work and a procedure that is not
already one load away in an authority document. Removing a skill that
nothing uses, or that only copies `CLAUDE.md`, is a legitimate PR.
Skills change through reviewed repository PRs, not by agent memory.
