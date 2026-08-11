# Atlas Financial — agent entrypoint

Every agent starts here, on every surface — Claude Code, Codex, Cursor, or
whatever else Dale approves. This file routes; it defines nothing of its own.

Read in this order:

1. [`CLAUDE.md`](CLAUDE.md) — who decides, who reviews, when to stop for a
   person, and what a pull request has to carry. It keeps its filename for
   continuity and binds every surface equally.
2. [`CONTEXT.md`](CONTEXT.md) — layout, current state, standing rules.
3. [`ARCHITECTURE.md`](ARCHITECTURE.md) — the five layers and the direction.
4. [`docs/ACCOUNT_FACTS.md`](docs/ACCOUNT_FACTS.md) — standing facts. Never ask
   the owner for anything already recorded there.
5. [`BACKLOG.md`](BACKLOG.md) — work that can be done, and what blocks each item.
6. [`docs/01_OPEN_QUESTIONS.md`](docs/01_OPEN_QUESTIONS.md) — what only the
   household can answer.
7. `docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md` — the ordered build sequence, **once
   it exists**. It does not yet, so today planned work comes from `BACKLOG.md`.
   When it does exist, **it owns the order of planned capability work** — read it
   before starting any; `ARCHITECTURE.md` still owns direction, authority and the
   gates, and the strategy sequences only what those permit.

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

## Branches and scope

A fresh branch from current `main`, and **one independently provable outcome per
pull request** — not one topic. `CLAUDE.md` holds the rule, the scope tripwires,
the atomicity exception and the review-churn reassessment; the card's
**Delivery** block is where each is recorded.

Do not continue another agent's branch without first checking `main`, the open
pull requests, and the current-state gate. Two agents never work the same
outcome at once.

## Compact launcher

This is the one launcher. Do not write a second one.

> Read `AGENTS.md`, then take the owner's instruction if there is one — else the
> first eligible item in `BACKLOG.md`. **Once a build strategy exists, it
> sequences planned capability work**: `BACKLOG.md` stays the record of work and
> findings and feeds the strategy, rather than independently overriding its order.
> How an urgent finding interleaves with that order is the strategy's to define.
> Verify current state before editing.
> One independently provable outcome, fresh branch, merge card filled, findings
> dispositioned. Stop only for an owner-reserved item or the required review.

Before implementing, report only: the item, the current-state verdict, whether
code is actually required, and any owner gate. Then go.
