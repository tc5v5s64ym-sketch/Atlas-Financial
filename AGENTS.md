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
   `ARCHITECTURE.md`. Read it before selecting work. It decides what is
   eligible, in what order, and what may interrupt that order; this file states
   no selection rule of its own.
7. [`BACKLOG.md`](BACKLOG.md) — the record of work and findings. It feeds the
   strategy; it does not silently override the strategy's order.
8. [`docs/01_OPEN_QUESTIONS.md`](docs/01_OPEN_QUESTIONS.md) — what only the
   household can answer.

An explicit owner instruction may be the source of a pull request. Record it in
the Current-State Verification Gate. It does not erase the financial,
security, authority, trust, or owner-reserved boundaries in `CLAUDE.md` and
`ARCHITECTURE.md`.

## Authority, procedure, and lessons

The numbered list above is what a fresh agent always loads. It is already
long. Do not add task procedure or learned memory to it.

| Need | Load |
|---|---|
| Permanent Atlas authority | the read order above. Existing files remain authoritative. This file does not copy them. |
| Task procedure | only the matching skill in [`docs/skills/`](docs/skills/README.md) |
| Durable technical lessons | [`docs/lessons/TECHNICAL.md`](docs/lessons/TECHNICAL.md) — non-authoritative, evidence-traced |
| How those layers differ, write permission, future dreaming | [`docs/AGENT_CONTEXT.md`](docs/AGENT_CONTEXT.md) |

A lesson must never become household financial truth, owner policy, Forecast
behavior, or a second planner. Exact-head review procedure stays in
`CLAUDE.md`; do not load a parallel copy.

## The three things agents get wrong here

**The review lanes are not interchangeable.** ChatGPT is the decision desk.
It may review a high-risk change, but that review is not a SHA-matching merge
lock. Independent agent review is an optional improvement audit. Confidence
that a PR is not junk is `npm test`, the secret hook, and the figures
comment. `CLAUDE.md` holds the merge gate.

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
> otherwise select work as `docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md` directs — it
> owns eligibility, order and interruption, and this launcher restates none of
> it. Verify current repository state
> before editing. Use a fresh `agent/<outcome>` branch from current `main`.
> One independently provable outcome, merge card filled, findings
> dispositioned. Stop only for an owner-reserved item. Merge on green
> tests and a complete card when no high-risk trigger fired. When a
> high-risk trigger has fired, merge also waits for Atlas Contract /
> Systems Review `PASS` on the current exact head.

Before implementing, report only: the source/item, the current-state verdict,
whether code is actually required, and any owner gate. Then go.

## Cold-start acceptance trial

A fresh agent with no prior chat history can prove repository portability using
the read-only trial in [`docs/BUILDER_PORTABILITY.md`](docs/BUILDER_PORTABILITY.md).
Do not simulate or claim that trial from an already-contextualized session.