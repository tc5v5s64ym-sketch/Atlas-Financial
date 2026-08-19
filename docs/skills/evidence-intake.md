# Skill: evidence-intake

**Load when** absorbing owner-supplied statements, screenshots,
conversations, workbooks, interviews, or other source documents into
the repository.

**Do not load for** a pure Forecast change that uses facts already in
`data.json` / `ACCOUNT_FACTS.md`.

**This is procedure, not authority.** Source intake is not household
truth. Interviews are not joint policy. The Evidence-Use Register
routes; it does not prove a figure. Forecast remains the planner.

Relevant lesson — search [`../lessons/TECHNICAL.md`](../lessons/TECHNICAL.md)
for **L-005**. Do not load the whole store.

## Where incoming evidence goes

| Kind | Home | Must not become |
|---|---|---|
| Attributed thing a person *said* | `docs/household_interviews/` | verified fact or joint policy |
| What a *document* establishes, still not live authority | `docs/source_intake/` or `docs/MASTER_PLAN_REQUIREMENTS.md` | a second `ACCOUNT_FACTS.md` |
| Standing verified fact (rate, limit, due date) | `docs/ACCOUNT_FACTS.md` | a balance |
| Balance / published figure | `data.json` (and `positions.csv` as the account-row snapshot) | owner policy |
| Routing of a declared evidence ID | `docs/evidence_use/register.json` | financial correctness |
| Raw bills, statements, credentials | `raw/` (gitignored) | git, a PR, a chat dump |

Folder rules live in those folders' READMEs. This skill does not copy
them.

## Procedure

1. Classify before filing. Mixing kinds is how a stale balance
   masquerades as a standing fact, and how "Dale said this" becomes
   fake policy (L-005).
2. Preserve speaker, date, uncertainty, and unresolved items. Do not
   silently promote ESTIMATE / TARGET / CONDITIONAL / UNKNOWN.
3. Reconcile against an incumbent where one exists. Lunch Money is
   evidence, not the planner.
4. Canonical `data.json` writes go through the earned preview / approve
   path, or an explicit owner-approved edit recorded on the merge card.
5. For a declared evidence ID, add a register row. `CONSUMED` means
   routed to a named incumbent, not "the number is right."

Anything that would present an estimate as verified, handle a
credential, commit `raw/`, or encode owner policy the owner has not
given, is an owner-reserved stop (`CLAUDE.md`).
