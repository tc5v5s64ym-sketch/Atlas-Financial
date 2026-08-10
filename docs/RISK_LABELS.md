# Risk labels and the review gates

**What a pull request has to carry before it can merge, and why.**

This repository is unusual in what can go wrong with it. Nothing here serves
traffic, holds a queue or takes a payment. The failure mode is quieter: it
publishes a number, a household reads it, and acts. A figure that is wrong and
looks plausible does more damage than a crash, because a crash gets noticed.

So the gates are not about whether the code runs. They are about whether it is
**true**, and whether **one fact still has one home**.

---

## The primary label — exactly one per PR

This answers a single question: **what does the owner have to do about this?**

| Label | Means | Owner action |
|---|---|---|
| `auto-safe` | No published figure moves and no fact changes home. | None. Merge on green. |
| `figures-moved` | A number the household reads is different afterwards. | Read the figures diff, confirm each move was intended. |
| `owner-decision` | Rests on a household fact only Dale or Amanda can supply. | Answer the question. Blocked on a person, not on code. |
| `blocked` | A gate failed, or a contradiction is open. | Not mergeable as it stands. |

Enforced by `risk-label-gate.yml`, which publishes the `risk-label/primary`
commit status. It is not automatic and cannot be: no path or diff tells you
whether a change needs the owner's judgement. That is the point of asking.

**It runs from `main`, not from the branch.** The gate uses
`pull_request_target`, which loads its definition from the default branch, so
it does not run on the pull request that introduces it — and cannot be
subverted by a pull request that edits it. That is the trust property, and the
cost is that the gate is inert until it has landed on `main` once.

**`figures-moved` is not a warning.** Most substantive work here moves figures
— that is what the work is for. It means *look at the diff before merging*,
nothing more.

## Category labels — zero or more, applied automatically

`engine` · `published-figures` · `plan-page` · `authority-docs` · `security` ·
`tests` · `infrastructure` · `evidence-only`

Applied by path from `.github/labeler.yml`. They describe what was touched.
They are never blocking and carry no judgement — a change to `engine` is not
automatically riskier than a change to a document that states a rate.

---

## The gates

### `merge-card-check` — blocking

The PR body must carry the Atlas Merge Card with every field answered.

The check is **literal, never semantic**. It can tell a claim from a blank; it
cannot tell a true claim from a false one, and nothing it passes should be read
as verified. What it buys is that a change to a household's published numbers
cannot merge while silent about what it moved.

`none`, `No` and `n/a — <reason>` are real answers and pass. An empty row is
silence, and silence is what the check exists to fail.

#### The Delivery block — closed forms, and one subtraction

One pull request, one independently provable outcome. `CLAUDE.md` holds that
rule; the card records it, and this is the part of the record a check can hold:

| Line | What the check enforces |
|---|---|
| `One outcome`, `Non-goals` | present and not blank — nothing about the words |
| `Scope status` | opens `WITHIN` or `EXCEEDED`; `EXCEEDED` carries a reason |
| `Atomicity exception` | opens `YES` or `NO`; `YES` carries a reason |
| `Blocking review rounds` | opens `0`, `1`, `2` or `3+` |
| `Scope reassessment` | opens `N/A`, `CONTINUE` or `SPLIT` — and at two or more rounds, not `N/A`, with a reason. **`SPLIT` fails**: a pull request declaring it must be divided may not merge until it has been |
| `Proof level` | opens `UNIT`, `INTEGRATION`, `BROWSER`, `LIVE`, `OWNER EVIDENCE` or `MIXED` |
| `Open loops closed` / `created` | a non-negative integer and nothing else |
| `Net open loops` | an integer, and equal to created minus closed |
| `Loops left open` | present; and when the net is **positive**, a real answer rather than an absence word |

**Eleven lines in three kinds: five closed vocabularies, three integers, three
prose lines checked only for being answered at all.** Not one of them is a rule
about what a sentence means — deliberately, and as the direct lesson of the
thirty-one false greens above. A field that opens with its answer cannot be
beaten by a new wording, and a subtraction cannot be argued with; a prose field
is asked for presence precisely because nothing more can honestly be asked of it.
The one line here that is *verified* rather than merely witnessed is the net:
three numbers that have to agree.

**What it therefore cannot tell**, and does not try to: whether the outcome is
genuinely one outcome, whether an `EXCEEDED` scope is justified, whether a
`CONTINUE` after three rounds is safer than splitting, whether an atomicity
exception is real, or whether the three prose lines say anything. Those are the
required review's — questions 8 to 12 — and the card is where the judgement is
recorded. The scope tripwires are review prompts, never thresholds: `EXCEEDED`
is a legitimate, passing answer that asks for an explanation, because some honest
work is large.

### `Published figures review` — advisory

A bot comment listing exactly which published figures differ between the base
branch and the PR head.

It does not read the diff. It **runs the engine on both revisions and compares
the answers**, because the defect that prompted all of this was a weekly
spending cap that was wrong by $400 and derived — no test failed, nothing
crashed, and a source diff would not have shown it.

Advisory on purpose. A figure moving is usually the point; the failure mode is
a figure moving *unnoticed*. If the comment lists something the merge card does
not mention, one of the two is wrong — either the card is incomplete, or the
change had an effect nobody intended. Resolve it before merging.

### Atlas Contract / Systems Review — required, and deliberately not a check

The one **required** review lane. ChatGPT performs it; an implementation agent
cannot satisfy it by re-reading its own work in a clean context, because that is
the same agent with the same blind spots. It reads the **exact head** — a review
of an earlier commit does not cover a later one.

It is listed here so the map of review surfaces is complete, but it is not one
of these gates and must never become one: no workflow, no commit status, no
required check, no reviewer account. It is recorded in the merge card's review
block — required or not with the trigger, the exact SHA read, who read it, and
what happened to each finding.

`merge-card-check` verifies those four fields are answered; that a SHA recorded
as reviewed **is the current head**, so a verdict cannot outlive the code it was
about; that the reviewer names **this lane** rather than the advisory one; and
that the findings line disposes of what it lists rather than calling it
unanswered. That is a different thing from verifying a review happened, which no
check here can do.

What it deliberately does **not** do is read a list of findings and decide each
one was answered. Every rule tried for that false-failed ordinary phrasing —
"two raised: one fixed, one routed to B72" has a clause carrying no disposition
word and is a complete answer. Judging a list is the reviewer's job.

**A known limit, stated rather than approximated again.** The check treats a
disposition word as negated when a negation sits in the same clause. That
catches the plain denials and it is deliberately not a fourth attempt at
grammatical scope. Two sentences show why no rule of this kind can be right:

> `P1 was not, in any way, fixed` — a denial the check does not catch.
> `P1 was not only fixed but independently tested` — an assertion it must not fail.

They differ only in grammar, so any mechanical rule that catches the first
fails the second. A word window was tried and defeated, a clause rule is what
stands, and `not only` is excluded as a fixed idiom. **Whether a sentence
asserts or denies its own disposition is a reviewer's read, and the card is
where that judgement is recorded.** The check's job is that the field is not
blank and names a disposition at all.

The same closing move solved the two identity fields where it *was* available:
`Exact reviewed head` must be a bare 40-character SHA and `Reviewer` must read
exactly `ChatGPT`, so neither needs a vocabulary of denials that can never be
finished. Where a field can be closed, it is closed; where it cannot, the limit
is written down here instead of guessed at.

[`CLAUDE.md`](../CLAUDE.md) holds the trigger list and the twelve questions the
review asks — seven about truth and authority, five about whether the work is
one pull request at all. It is the only home for them; do not restate them here.

### Codex review — advisory, but its findings are not

Codex reviews pull requests on this repository. That is configured in the
org's Codex settings, not here, and nothing in this repo turns it on or off.

Two things here do surround it:

**`codex-review.yml`** reports whether the Codex review still describes the
code that is here. Codex reviews on open and on ready-for-review; it does not
re-review after a push. On this repository's first PR it found two real P1s,
both were fixed and pushed, and its verdict stayed attached to a revision that
no longer existed — which reads exactly like a review of the current one. A
stale approval is worse than no approval.

The workflow compares the newest commit Codex actually reviewed against the
head and keeps one comment updated in place: current, stale by N commits, or
none yet.

It *reports* rather than *requests*, and that is a correction rather than a
design choice. Posting `@codex review` from CI was tried and does not work —
Codex answers a mention from `github-actions[bot]` with "create a Codex
account and connect to github", because the request must come from a linked
human account. The result was two useless comments on every push. Making it
work would mean storing a human PAT as a repository secret, and secrets here
live only in Render. So a human comments `@codex review` when the freshness
comment says stale.

**The merge card's `Advisory review` row** records what happened to each
finding: fixed, non-issue with the reason, or deferred to the backlog. This is
the part that actually holds — a review nobody dispositions is decoration, and
"the bot commented" is not a disposition. `none raised` is a real answer when
the review came back clean.

Disagreeing with a finding is fine and often correct. Saying why, in the card,
is what makes it a decision rather than an omission.

### `tests` — blocking

`npm test`. Six suites: static sanity, the forecast engine and its
opening-gap regression, household-budget reconciliation, the coupled
cash-and-debt model, the authority invariants, and the merge-card check's own
behaviour.

**An invariant failure is a failure, not a warning.** A plan that disagrees
with itself is worse than no plan, because it still looks authoritative.

**The merge-card suite guards the gate above.** `test-mergecard.js` extracts the
real `script:` body out of `merge-card-check.yml` and runs it against completed
and broken cards — including both false greens the check has actually shipped,
where a card went green while saying in plain words that the required review had
not happened. It then reverts each guard in the extracted source
— the pending markers, the closed forms, the delivery vocabularies, the
open-loop arithmetic — and proves a committed case goes the wrong way, so a
guard cannot be removed without a test noticing. A copy of the check would prove
only that the copy still works.

---

## Why these and not more

Every gate here exists because the thing it checks actually went wrong:

- The weekly cap double-counted a payday and shipped, reading `$1,650/week`
  when the answer was `$1,250` → **figures review**.
- The same page showed `$1,650/wk` in one tile and `$0/wk` in the block below,
  because two pieces of code answered the same question → **invariant tests**.
- `ACCOUNT_FACTS.md` contradicted itself about Amanda's pay cadence, 236 lines
  apart, and about whether BC Hydro still had a household route →
  **invariant tests**, and the `authority-docs` label so those changes are
  visible.
- The pre-commit hook lost its executable bit and git silently skipped it, so
  the guard against committing raw statements looked installed and was not →
  **static sanity**.

There is no coverage gate, no linter and no bundle-size check. Not because
they are bad, but because nothing here has yet been broken by their absence,
and a gate nobody believes in gets clicked through.

---

## Setup, once

The labels are created by `labels.yml` from `.github/labels.yml` the first
time either lands on `main`.

To make the risk gate binding, add `risk-label/primary` to the required status
checks for `main` in branch protection, alongside `test`. That is deliberately
a manual owner action — a workflow that grants itself merge authority is not a
gate.
