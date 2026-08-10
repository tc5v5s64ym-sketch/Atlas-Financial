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

### `tests` — blocking

`npm test`. Five suites: static sanity, the forecast engine and its
opening-gap regression, household-budget reconciliation, the coupled
cash-and-debt model, and the authority invariants.

**An invariant failure is a failure, not a warning.** A plan that disagrees
with itself is worse than no plan, because it still looks authoritative.

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
