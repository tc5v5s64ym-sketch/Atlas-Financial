# Skills catalog

Procedural instructions for recurring classes of work.

**Load on demand.** A fresh agent should not read this folder until the
task matches a row below. Skills are not Atlas authority, not Forecast,
not household truth, and not owner policy.

How the layers fit: [`../AGENT_CONTEXT.md`](../AGENT_CONTEXT.md).
Permanent authority stays in `ARCHITECTURE.md` and `CLAUDE.md`.

## Catalog

| Skill | Load when | File |
|---|---|---|
| `implement-pr` | Implementing any bounded pull request | [implement-pr.md](implement-pr.md) |
| `forecast-runtime` | Changing `public/forecast.js`, `data.json` plan policy, or a page that renders a household-facing figure | [forecast-runtime.md](forecast-runtime.md) |
| `evidence-intake` | Absorbing owner-supplied statements, screenshots, conversations, workbooks, or interviews | [evidence-intake.md](evidence-intake.md) |

Load **one** matching skill. If two match, load both; do not invent a
combined super-skill.

## Not a skill in v1

| Class of work | Where the procedure already lives |
|---|---|
| Exact-head Atlas Contract / Systems Review | `CLAUDE.md` — load that section when requesting or performing the review. Recurring SHA pitfall: lesson L-003. |
| Builder/model handoff | `docs/BUILDER_PORTABILITY.md` |
| Merge card mechanical fields | `.github/PULL_REQUEST_TEMPLATE.md` plus `CLAUDE.md` |

Do not copy those into this folder. A skill that restates an authority
document is the defect this catalog exists to avoid.

## Adding or removing a skill

A new skill needs a recurring class of work and a procedure that is not
already one load away in an authority document. Removing a skill that
nothing uses, or that only copies `CLAUDE.md`, is a legitimate PR.
Skills change through reviewed repository PRs, not by agent memory.
