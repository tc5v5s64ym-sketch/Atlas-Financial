# Atlas Financial — agent brief

**Who decides, who reviews, and when something stops for a person.**

This file holds the operating, review and merge rules. It deliberately holds
nothing else, because the rest already has a home:

| For | Read |
|---|---|
| Orientation in a new session | [`CONTEXT.md`](CONTEXT.md) |
| How the layers fit together, and the direction | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| What the CI gates check and why each exists | [`docs/RISK_LABELS.md`](docs/RISK_LABELS.md) |
| Work that can be done | [`BACKLOG.md`](BACKLOG.md) |
| What only the household can answer | [`docs/01_OPEN_QUESTIONS.md`](docs/01_OPEN_QUESTIONS.md) |

One fact, one home. Where this file and one of those appear to disagree about a
mechanism, that file is right about the mechanism and this one is right about
the authority.

## The failure mode this governs

Nothing here serves traffic, holds a queue or takes a payment. The damage this
repository can do is quieter: it publishes a number, a household reads it, and
acts on it. A figure that is wrong and looks plausible does more harm than a
crash, because a crash gets noticed.

Review here is therefore never "does the code work". It is **is this true, and
does one fact still have one home**.

---

## Roles

### Dale — owner

Dale owns the household facts, the direction, and anything that cannot be
derived from what is already in the repository: whether a figure may be
presented as verified, what happens to raw statements, credentials and secrets,
what the site is for, and which tier of `ARCHITECTURE.md` is entered next.

Dale may merge anything, or withdraw any of the authority below. Routine work
does not wait for him to click merge — see **Merge policy**.

### The decision desk, and the Atlas Contract / Systems Review — ChatGPT

ChatGPT does two separate things, and they should not be confused.

1. **The decision desk** helps Dale resolve genuinely non-derivable product,
   scope and trust forks. It never answers a household fact — those are
   questions for the household and live in `docs/01_OPEN_QUESTIONS.md` — and it
   never holds work items, which live in `BACKLOG.md`.
2. **The Atlas Contract / Systems Review** reads a triggered pull request. It is
   the one required review lane, defined below.

**Use one name for the lane everywhere.** Two names for one lane read as two
lanes.

### The approved active implementation agent

The one agent Dale has approved to implement work here at a given time. It is a
role, not a product name: Claude Code, Codex, Cursor or another owner-approved
surface may hold it, running whichever model that surface runs.

The surface and the model change nothing — not the branch rules, the
one-concern rule, the verification gate, the review lane, the owner-reserved
stops, or merge authority. Two agents never hold the role for the same concern
at the same time.

The agent selects the work, verifies current state before editing, implements
one concern on a fresh branch, proves the numbers independently, opens the pull
request with the merge card filled, obtains the required review when a trigger
fires, dispositions every advisory finding, and merges the exact passing head.

### Independent agent review — Codex, and anything like it

Advisory, always. Fix the real findings, say why for the ones you reject, and
record both in the merge card. Never manufacture a review status out of a bot's
wording, its reactions, or its identity.

### GitHub Actions

The deterministic hard gates. A required check that is missing, stale, skipped,
errored, timed out, cancelled or failed **is a failure**, not an absence of one.

---

## The two review lanes

|  | Atlas Contract / Systems Review | Independent agent review |
|---|---|---|
| Performed by | ChatGPT | Codex, or any agent that is not the active builder |
| Status | **Required when a trigger fires** | Advisory, always |
| Reads | The exact head | Whatever head it reviewed — check freshness |
| Recorded in | The merge card's review block | The merge card's `Advisory review` row |
| Is it a GitHub check? | **No. Never.** | No |

Neither lane is a GitHub status, a required check, a reviewer account, or an
approval click. Both are recorded in the merge card, which is where this
repository keeps its review truth.

### The Atlas Contract / Systems Review — required when a trigger fires

**ChatGPT performs this review.** That is an authority boundary, not a
preference. The implementation agent may not satisfy its own architecture gate:
a clean context is not an independent authority — it is the same agent with the
same model and the same blind spots, and it will reproduce them confidently. An
agent's own clean-context read is welcome as **advisory confidence** and belongs
under advisory findings. It never satisfies this gate.

The merge card records **who** performed the review, so a review that did not
come from this lane is visible as one.

**It reads the exact head.** A review of an earlier commit does not cover a
later one. Push after a review and the review must be repeated — this is the
same failure the Codex freshness reporter exists to catch, and it is not less
serious because the reviewer is ChatGPT.

**It never authorizes anything about the household's real money or data.** It
does not release a raw file, approve a secret, or turn an estimate into a
verified figure. Those are owner-reserved.

#### When it is required

A pull request that touches any of these:

- **the engine, or any derived figure the household acts on** — the forecast,
  the recommendation, the budget split, the cash or debt walk;
- **a fact changing home** — an authority move, or the deletion of a competing
  claim;
- **the review machinery itself** — the merge card check, the figures review,
  the risk-label gate, the labels manifest, the Codex freshness reporter, or a
  test suite standing in for a gate;
- **the security gate** — the auth gate, session and cookie handling, CSP,
  secret handling, `.gitignore`, or the pre-commit hook;
- **what counts as evidence** — the verified / calculated / estimated / unknown
  discipline, or how coverage is stated;
- **an estimate reaching the decision page**, or an estimate being promoted to
  verified;
- **direction** — a change to the tiers in `ARCHITECTURE.md`, the scope of the
  site, or the trust contract; and
- **genuine ambiguity**, whenever the right answer is arguable.

The list is deliberately wide, and most substantive work here touches it.
"No trigger fired" is a claim that has to survive reading the list — it is not
the default.

#### What the review asks

1. Does this hold in the next legitimate state of the repository, not only
   against today's data? *(Next month's statements, a new account, a rebuilt
   period file.)*
2. Can missing, no-op, defaulted, circular or hardcoded evidence produce a false
   green? *(A test that asserts whatever the code computes. A figure reconciled
   against itself.)*
3. Does the proof establish identity, content, order and authority — not
   cardinality alone? *(Right account, right amount, right date, right source —
   not "twelve rows changed".)*
4. Does it stay correct when historical records coexist with current state?
   *(Superseded statements, an older snapshot, a carried estimate.)*
5. What authority wins, what loses, what bridge remains, and when is the bridge
   removed?
6. Could this falsely advance a claim — of coverage, of verification, or of a
   figure's tag?
7. What temporary machinery must be deleted?

#### What the merge card records

Four fields, in the card's **Atlas Contract / Systems Review** block:

- **Required** — with the trigger that fired, or the reason none did;
- **Exact reviewed head** — the full commit SHA the reviewer read;
- **Reviewer** — who performed it;
- **Findings and dispositions** — every finding, each marked fixed, non-issue
  with the reason, or routed.

`merge-card-check` verifies those four are answered. It is a literal check: it
can tell a claim from a blank, and nothing more. It cannot tell whether a review
happened, and passing it is not evidence that one did.

### Independent agent review — advisory, but its findings are not

Codex reviews pull requests here. `docs/RISK_LABELS.md` covers how the freshness
reporter works and why it reports rather than requests.

What matters for authority: a finding is advisory in the sense that no bot
blocks a merge, and binding in the sense that **an unanswered finding does**.
Every one gets fixed, rejected with a reason, or routed — in the card's
`Advisory review` row. Disagreeing with a finding is fine and often correct.
Saying why is what makes it a decision rather than an omission.

---

## Merge gate

The active implementation agent merges when all of these hold:

- every applicable GitHub check passed **on the exact current head**;
- the merge card is complete, including attribution and the review block;
- exactly one primary risk label, and it is honest about what the owner has to
  do (`docs/RISK_LABELS.md`);
- the required review is recorded and read the exact merged head, when a trigger
  fired;
- every advisory finding is dispositioned;
- one concern, clean branch, no unrelated drift, no secret or raw data; and
- no owner-reserved item is outstanding.

## Merge policy

The primary risk label decides what the owner does, and `docs/RISK_LABELS.md`
defines each one:

- **`auto-safe`** — merge on green. No approval click, no waiting.
- **`figures-moved`** — the owner sees the figures diff before the merge. That
  is a *look*, not a sign-off ritual: reconcile the bot's list against the card,
  and if they disagree, one of them is wrong.
- **`owner-decision`** — blocked on a person, not on code.
- **`blocked`** — not mergeable as it stands.

The owner never has to click approve to make a green, in-scope pull request
mergeable. Owner-reserved items are **gates on specific questions**, never merge
approvals.

## Merge-card attribution

Every pull request declares who did the work, in the merge card. It is the only
place — no commit trailer, no model registry, no tracking sheet beside it.

- **Builder surface** — the tool the work ran on;
- **Primary builder model** — the exact model name the surface displays;
- **Supporting / explore models** — every other model used and what it did, or
  `None`;
- **Architecture / dispatch authority** — who dispatched and architecturally
  owns the work, normally ChatGPT.

Record the model name the surface actually shows. **Never guess one.** If the
surface withholds its model identity, say exactly that. Attribution is declared
evidence, not proof, and it grants no authority — it records who acted.

`None` is a real answer for supporting models alone. The other three name a real
surface, a real model (or a plain statement that it is withheld), and a real
authority.

---

## Before editing — the Current-State Verification Gate

State, in the merge card:

1. **Source** — the backlog item, open question, or owner instruction behind
   this work.
2. **Verdict** — exactly one of `STILL BROKEN` · `ALREADY FIXED` ·
   `PARTIALLY FIXED` · `FIXED BUT UNTESTED` · `STALE / SUPERSEDED` ·
   `NEEDS OWNER ANSWER`.
3. **Evidence** — the exact file, function, figure or test, and how it was
   checked *on current `main`, before any change*.

If it is already fixed, do not manufacture code. If it is fixed but untested,
prove it rather than refactor it. For anything financial, the proof has to be
independent of the code that produces the answer — a test exercising the same
function proves consistency, not correctness.

## Branch and scope rules

- One pull request, one concern. If a fix spreads, split it.
- A fresh branch from current `main`. Never stack later work on an open branch
  without saying so in the card.
- Stage only intended files. Never `.env`, credentials, raw statements, derived
  output, or unrelated drift.
- The pre-commit hook is the safety net and it is never bypassed. If a fresh
  clone lost `core.hooksPath`, restore it before committing anything.

## Finding disposition

Anything found along the way takes exactly one disposition, recorded in the
card's **Additional findings** section. It does not silently expand the pull
request:

1. **FIX NOW** — fixed and proved in this pull request.
2. **REJECTED** — with the reason, in the pull request.
3. **ADDED TO BACKLOG** — an item in `BACKLOG.md`, named in the card.
4. **OWNER DECISION REQUIRED** — stop and ask. If it is something a human has to
   *know* rather than *do*, it is a question and belongs in
   `docs/01_OPEN_QUESTIONS.md`, not the backlog.

An advisory finding does not automatically become work. Dispositioning it is
what makes that a decision.

## Owner-reserved stops

Stop for Dale — do not infer approval — for:

1. a household fact only Dale or Amanda can supply;
2. presenting an estimate as verified, or changing how a figure is tagged;
3. anything touching raw statements, credentials, secrets, or what leaves
   `raw/`;
4. security-relevant infrastructure: the auth gate, session handling, CSP, the
   pre-commit hook, repository visibility;
5. direction — the tiers in `ARCHITECTURE.md`, what the site is for, or adding a
   database, a bank integration or an aggregator;
6. a genuine unresolved conflict between two of these rules.

Routine analysis, tests, refactors, derivable wording, advisory disposition and
clean merges are **not** owner stops. Do not stop merely to report that a pull
request is ready to merge.

## Absolute data safety

- **Read-only against every institution.** No transfers, payments,
  applications, setting changes, form submissions or agreement acceptances.
- **Never ask for or handle credentials.** Passwords, PINs, security codes and
  2FA are the owner's alone.
- `raw/` and `derived/` never enter git, a pull request, a comment, or a
  conversation. Only sanitised aggregates leave `raw/`.
- Secrets live in Render and nowhere else — not in the repository, not in
  `data.json`, not in a pull request body.
- **Tag every figure** verified / calculated / estimated / unknown. An estimate
  is never presented as a verified fact.
- A contradiction between two published figures is a stop, not a footnote.

## Testing

```bash
npm test
```

Then whatever the change actually touches: `node test-forecast.js` after any
change to the `plan` block, `node test-local.js` after `server.js`, and
`node verify-live.js` against the deployed site for the security behaviour
visible without a password.

A test should prove the failure cannot recur through the path a household
actually reads — not only through the helper that was just written.

## What not to build

Unless Dale says otherwise: no database, no bank or aggregator integration, no
stored credentials, no automation acting against an account, no second dashboard
or roadmap, and no governance system beyond the one in this file. The gates that
exist are the ones that caught something real. Add a gate when something goes
wrong that it would have caught, and not before.
