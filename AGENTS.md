# Atlas Financial — agent entrypoint

Every agent starts here, on every surface — Claude Code, Codex, Cursor, or
whatever else Dale approves. This file is the universal router; it does not
create a second product, safety, review, merge, or sequencing authority.

Read in this order:

1. [`CLAUDE.md`](CLAUDE.md) — canonical operating and safety brief: who decides,
   who reviews, when to stop for a person, and what a pull request must carry.
   The filename is retained for historical continuity and binds every surface
   equally.
2. [`docs/BUILDER_PORTABILITY.md`](docs/BUILDER_PORTABILITY.md) — repository-state
   handoff, surface-neutral branch rules, legacy wording, and the fresh-agent
   cold-start acceptance trial.
3. [`CONTEXT.md`](CONTEXT.md) — layout, current state, standing rules.
4. [`ARCHITECTURE.md`](ARCHITECTURE.md) — the five layers, sole-authority
   direction, and capability gates.
5. [`docs/ACCOUNT_FACTS.md`](docs/ACCOUNT_FACTS.md) — standing facts. Never ask
   the owner for anything already recorded there.
6. [`docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md`](docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md)
   — **current planned-capability sequencing authority**, subordinate to
   `ARCHITECTURE.md`. Read it before selecting planned capability work.
7. [`BACKLOG.md`](BACKLOG.md) — the record of work and findings. It feeds the
   strategy; it does not silently override the strategy's order.
8. [`docs/01_OPEN_QUESTIONS.md`](docs/01_OPEN_QUESTIONS.md) — what only the
   household can answer.

An explicit owner instruction may be the source of a pull request. Record it in
the Current-State Verification Gate. It does not erase the financial,
security, authority, trust, or owner-reserved boundaries in `CLAUDE.md` and
`ARCHITECTURE.md`.

## The three things agents get wrong here

**The review lanes are not interchangeable.** ChatGPT performs the blocking
Atlas Contract / Systems Review when a high-risk trigger fires. It asks only
whether the exact head is unsafe or architecturally wrong to merge. Independent
agent review is an optional improvement audit: default one pass, with a second
only for a high-severity/systemic issue or a materially changed high-risk
surface. `CLAUDE.md` holds the trigger list and bounded follow-up protocol.

**A real defect still blocks.** The blocker is the financial, security,
authority, invariant, or trust defect itself — not an advisory review's status
or freshness. Route lower-severity improvements without running review until
clean.

**The proof has to be independent.** A test that exercises the same function
that computes a figure proves consistency, not correctness. Reconcile against
something else: a second method, the institution's own number, or a total that
has to agree.

## Declare who did the work

Four fields in the merge card: builder surface, primary builder model,
supporting models (or `None`), and the dispatch authority. Record the model name
your surface actually displays. If it withholds it, say so plainly — never guess
one. `CLAUDE.md` holds the rule.

## Branches, handoff, and scope

New work starts from current `main` on `agent/<outcome>`, regardless of surface.
Existing `claude/*` branches remain valid historical branches; do not rename or
reinterpret them as current work.

Use **one independently provable outcome per pull request** — not one topic.
`CLAUDE.md` owns the outcome rule, scope tripwires, atomicity exception and
review-churn reassessment; the merge card records the evidence.

Do not continue another agent's branch without first checking `main`, open pull
requests, and the Current-State Verification Gate. Two agents never implement
the same outcome at once. If a handoff must happen mid-PR, follow
`docs/BUILDER_PORTABILITY.md`; repository state, not chat memory, is the handoff.

## Compact launcher

This is the one launcher. Do not write a second one.

> Read `AGENTS.md`, then take the owner's explicit instruction if there is one;
> otherwise execute the first eligible planned capability item in
> `docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md`. Verify current repository state
> before editing. Use a fresh `agent/<outcome>` branch from current `main`.
> One independently provable outcome, merge card filled, findings
> dispositioned. Stop only for an owner-reserved item or the required review.

Before implementing, report only: the source/item, the current-state verdict,
whether code is actually required, and any owner gate. Then go.

## Cold-start acceptance trial

A fresh agent with no prior chat history can prove repository portability using
the read-only trial in [`docs/BUILDER_PORTABILITY.md`](docs/BUILDER_PORTABILITY.md).
Do not simulate or claim that trial from an already-contextualized session.