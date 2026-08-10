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

## The three things agents get wrong here

**The review lanes are not interchangeable.** ChatGPT performs the required
Atlas Contract / Systems Review when a trigger fires. Codex — or any agent that
is not the active builder — is advisory. An agent's own clean-context re-read of
its own work is advisory confidence and never satisfies the required lane.
`CLAUDE.md` holds the trigger list, the questions, and the four fields the merge
card records.

**Advisory does not mean ignorable.** No bot blocks a merge; an unanswered
finding does. Fix it, reject it with a reason, or route it — in the card.

**The proof has to be independent.** A test that exercises the same function
that computes a figure proves consistency, not correctness. Reconcile against
something else: a second method, the institution's own number, or a total that
has to agree.

## Declare who did the work

Four fields in the merge card: builder surface, primary builder model,
supporting models (or `None`), and the dispatch authority. Record the model name
your surface actually displays. If it withholds it, say so plainly — never guess
one. `CLAUDE.md` holds the rule.

## Branches

A fresh branch from current `main`, one concern per pull request. Do not
continue another agent's branch without first checking `main`, the open pull
requests, and the current-state gate. Two agents never work the same concern at
once.

## Compact launcher

This is the one launcher. Do not write a second one.

> Read `AGENTS.md`, then take the first eligible item in `BACKLOG.md` — or the
> owner's instruction if there is one. Verify current state before editing.
> One concern, fresh branch, merge card filled, findings dispositioned. Stop
> only for an owner-reserved item or the required review.

Before implementing, report only: the item, the current-state verdict, whether
code is actually required, and any owner gate. Then go.
