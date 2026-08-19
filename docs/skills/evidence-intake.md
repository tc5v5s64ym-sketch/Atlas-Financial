# Skill: evidence-intake

**Load when** absorbing owner-supplied statements, screenshots,
conversations, workbooks, interviews, or other source documents into
the repository.

**Do not load for** a pure Forecast change that uses facts already in
`data.json` / `ACCOUNT_FACTS.md`.

**This is procedure, not authority.** Source intake is not household
truth. Interviews are not joint policy. The Evidence-Use Register
routes; it does not prove a figure. Forecast remains the planner.

Also scan [`../lessons/TECHNICAL.md`](../lessons/TECHNICAL.md),
especially L-005.

---

## Where incoming evidence goes

| Kind | Home | Must not become |
|---|---|---|
| Attributed thing a person *said* | `docs/household_interviews/` | verified fact or joint policy |
| What a *document* establishes, still not live authority | `docs/source_intake/` or `docs/MASTER_PLAN_REQUIREMENTS.md` | a second `ACCOUNT_FACTS.md` |
| Standing verified fact (rate, limit, due date) | `docs/ACCOUNT_FACTS.md` | a balance |
| Balance / published figure | `data.json` (and `positions.csv` as the account-row snapshot) | owner policy |
| Routing of a declared evidence ID | `docs/evidence_use/register.json` | financial correctness |
| Raw bills, statements, credentials | `raw/` (gitignored) | git, a PR, a chat dump |

`docs/household_interviews/README.md` and
`docs/evidence_use/README.md` own those folders' rules. This skill
does not copy them.

## Procedure

1. Classify before filing. Document vs interview vs already-verified
   standing fact vs live balance. Mixing them is how a stale balance
   masquerades as a standing fact, and how "Dale said this" becomes
   fake policy (L-005).
2. Preserve speaker, date, uncertainty, and unresolved items on
   interview evidence. Do not silently promote ESTIMATE / TARGET /
   CONDITIONAL / UNKNOWN.
3. Reconcile against an incumbent where one exists. Lunch Money is the
   normal operational feed and is still **evidence**, not the planner.
   Institutional evidence, when available and in conflict, is stronger
   factual evidence.
4. Do not write `data.json` from intake by hand-waving. Canonical
   writes go through the earned preview / approve path, or an explicit
   owner-approved edit recorded on the merge card. Unattended
   production writes are not approved.
5. For a declared evidence ID, add a register row. `CONSUMED` means
   routed to a named incumbent, not "the number is right."
6. Unknown stays unknown. Do not pick a provider, a payday amount, or
   a joint target from chat.

## Stop

Anything that would present an estimate as verified, handle a
credential, commit `raw/`, or encode owner policy the owner has not
given, is an owner-reserved stop (`CLAUDE.md`). This skill cannot
clear it.
