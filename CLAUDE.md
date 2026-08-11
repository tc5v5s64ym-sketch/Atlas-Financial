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
| **What to build next, and in what order** | [`docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md`](docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md) |

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

The merge card records **who** performed the review, and `merge-card-check`
rejects a required review credited to anyone but this lane. Recording the
performer began as a way to make a wrong reviewer *visible*; it now fails,
because a card naming the advisory lane as the required reviewer is not an
oversight to notice later — it is the gate being handed to the wrong authority.
An advisory read belongs in the card's `Advisory review` row.

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

And five about **delivery** — whether this is one pull request at all:

8. Is this genuinely one independently provable outcome, or several that merely
   arrived in the same session?
9. Did it absorb an adjacent finding that belongs in another pull request?
10. Has review churn stopped refining one root cause and started revealing
    separate ones?
11. Could this have been split safely — and if it could not, is the atomicity
    exception genuine rather than a synonym for "these changes are related"?
12. What loops does it close, what does it open, and what closes those?

There is deliberately no question here about a concept gaining a second
authority: that is question 5, which already asks what wins, what loses and when
the bridge goes. Nor about cleanup, which is question 7. One question, one home.

#### What the merge card records

Four fields, in the card's **Atlas Contract / Systems Review** block:

- **Required** — with the trigger that fired, or the reason none did;
- **Exact reviewed head** — the full commit SHA the reviewer read;
- **Reviewer** — who performed it;
- **Findings and dispositions** — every finding, each marked fixed, non-issue
  with the reason, or routed.

`merge-card-check` verifies those four are answered, and — when the block says a
review was required — that the recorded SHA is a real 40-character head **and is
this pull request's current head**. That is the exact-head rule made mechanical:
push after a review and the card goes red until the review is repeated.

It remains a literal check. It compares two strings. It cannot tell whether a
review happened, who really performed it, or whether it was any good, and
passing it is not evidence of any of those. What it removes is the one failure a
literal check can remove: a verdict quietly outliving the code it was about.

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
- one independently provable outcome, clean branch, no unrelated drift, no
  secret or raw data; and
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

**One pull request, one independently provable outcome.**

"One concern" was the older form of this rule and it is not enough. A concern is
a topic, and a topic stretches to fit whatever was found while working on it. An
outcome is something that either happened or did not, and it can be proved. A
pull request qualifies when it has all five:

1. one concrete outcome;
2. one root cause, or one authority boundary;
3. one acceptance condition a reader can state without opening the diff;
4. one level-correct proof;
5. explicit non-goals.

| One outcome | Too broad |
|---|---|
| Make pending card charges authoritative in day-0 revolving headroom | Make the 90-day plan correct |
| Correct the weekly-cap opening gap, and prove every cash event is counted once | Improve the architecture |
| Make owner budget targets authoritative for the essential / discretionary split | Build the transaction system |

The right-hand column is not too *large*. It is unprovable: nothing about it can
come back green or red.

Then, unchanged in substance:

- Stage only intended files. Never `.env`, credentials, raw statements, derived
  output, or unrelated drift.
- The pre-commit hook is the safety net and it is never bypassed. If a fresh
  clone lost `core.hooksPath`, restore it before committing anything.

### Fresh `main`, and the stacking exception

Every implementation pull request starts from current `main`. Later work is not
stacked on an open branch, and a merged branch is finished — follow-up work
restarts from `main`.

Stacking is an exception, and it needs a reason that survives being written
down: serial delivery from `main` would leave an incorrect intermediate
repository state, two live authorities, an unusable intermediate, or another
genuine atomicity problem. Convenience, speed, and "the files are already open"
are not reasons. When it is approved, the card records the dependency, the merge
order, the rebase or retarget step, and why serial delivery is unsafe.

### Scope budget — a tripwire, not a limit

Review tripwires, not rejection thresholds:

- **≤ 8 implementation files** — source, workflows, templates;
- **≤ ~600 changed implementation lines**;
- **tests, fixtures and generated output counted separately**, and stated
  separately;
- **one high-risk financial authority per pull request**, by preference.

Under them, the card says `WITHIN`. Over any of them, it says `EXCEEDED` and
says why — which is a prompt to reassess, not a failure. Some honest work is
large.

The numbers are gameable and the gaming is the thing to watch for: unrelated
code moved into one file, implementation hidden inside generated output, real
code labelled as a fixture, unrelated modules collapsed together. None of that
makes a pull request smaller; it makes the measurement wrong. Whether an
`EXCEEDED` pull request is still one outcome is the required review's call, not
the tripwire's.

### If it spreads, split it — and when it must not be split

Read the actual diff before marking a pull request ready. Crossing layers is
fine when one outcome needs all of them: engine plus tests plus a page plus the
document that states the rule is one pull request when the outcome is one. Work
discovered together is not one outcome because it was discovered together.

Several independently testable outcomes are several pull requests. Split them.

**The atomicity exception** goes the other way, and it is real: do not
manufacture a dishonest intermediate state just to make a pull request small. A
larger atomic pull request is right when splitting would leave two competing
live authorities, an incorrect published figure, a half-finished migration, a
weakened trust or safety invariant, or an unusable transition. The card records
`Atomicity exception: YES` and says what splitting would break, why the pieces
share one closure condition, and why this is safer than a sequence.

It is an exception. It is not a synonym for "these changes are related".

### Review churn — reassess at two rounds

Repeated review is not failure; some genuinely atomic work needs it, and this
repository's first two pull requests both did. But repeated review is also how a
pull request that is secretly several announces itself.

- **After two blocking exact-head rounds**, reassess and record the answer.
  Are the findings refinements of one root cause — or are they now surfacing
  independent outcomes, authorities, subsystems, migrations, proof systems or
  product decisions? One root cause: `CONTINUE`, with the reason. Independent:
  `SPLIT`.
- **After three**, `CONTINUE` has to say why finishing here is safer than
  splitting.

**`SPLIT` blocks the merge.** It is a pull request saying it has to be divided,
and one that says so may not merge in that state — otherwise the card records an
unperformed split as though it were a decision already carried out. Perform the
split; the pull request that remains reassesses its own scope honestly, which is
normally `CONTINUE` naming where the other outcome went.

There is no automatic failure at any number. The breaker exists to force the
question, not to punish review.

## The Closed-Loop Delivery Contract

Every implementation pull request should be explainable as one chain:

**purpose → authority → implementation → integration → proof → cleanup →
closure.**

Work is finished when a loop is closed, not when code lands. The card's
**Delivery** block is where the chain is recorded — the outcome and its
non-goals, scope status, atomicity exception, review rounds and reassessment,
proof level, and the open-loop count.

For every new production building block — a module, a derived figure, a script,
a workflow, a bridge — name:

- its **exact live consumer**, which exists;
- why it is needed **now**;
- how it is **integrated**;
- its **proof level**: unit proves local logic, integration proves wiring, a
  browser or full-session run proves the path a household actually reads, live
  proves the deployed system, owner evidence proves owner operation;
- whether it is **temporary or permanent**, and if temporary, the **exact**
  condition under which it is removed.

"Future flexibility", "useful foundation" and "might be useful later" are not
purposes. A foundation pull request is legitimate — it says
**FOUNDATION — NOT COMPLETION** and names the next consumer and the closure
step. What it may not do is call itself finished.

### Open-loop accounting

Every pull request reports three integers in the card: loops **closed**, loops
**created**, and the **net**. The preference is net ≤ 0. A positive net is
allowed and sometimes necessary; it is explained rather than hidden — so a
fourth line, **`Loops left open`**, names each one and what closes it, and the
check requires a real answer there whenever the net is positive. Three integers
can report a positive net; they cannot explain one.

This creates no new ledger, tracker or backlog system. `BACKLOG.md` and
`docs/01_OPEN_QUESTIONS.md` already hold work and questions, and an open loop
recorded here is normally one of those.

### Defect classification

Before fixing, classify — and record it in the card's **Authority impact** row,
which is already the home for what wins and what loses:

- **Local defect** — one owner is wrong. Fix that owner.
- **Authority defect** — two or more things decide the same concept. Choose one
  winner; remove the loser, derive it from the winner, or give it an exact
  sunset condition.
- **Missing capability** — nothing owns the concept. Add one owner, with a named
  consumer.

For an authority defect prefer **replace**, **derive**, **delete** — in that
order. Permanent reconciliation between two authorities is not a fix; it is the
defect with maintenance attached.

## Finding disposition

Anything found along the way takes exactly one disposition, recorded in the
card's **Additional findings** section. It does not silently expand the pull
request:

1. **FIXED NOW** — fixed and proved in this pull request.
2. **NEXT PR** — real, and the next pull request's outcome. Say what it is.
3. **REJECTED** — with the reason, in the pull request.
4. **ADDED TO BACKLOG** — an item in `BACKLOG.md`, named in the card.
5. **OWNER DECISION REQUIRED** — stop and ask. If it is something a human has to
   *know* rather than *do*, it is a question and belongs in
   `docs/01_OPEN_QUESTIONS.md`, not the backlog.

**FIXED NOW is the disposition that needs a test**, because it is the one that
grows the pull request. It is available when the finding shares this outcome's
root cause or authority boundary, or when this pull request cannot be correct or
honestly proven without it. Otherwise it is one of the other four.

*"While I'm here"* is not a reason. An advisory finding does not automatically
become work in this pull request either — classify it first. Dispositioning is
what makes any of this a decision rather than a drift.

## Agent autonomy

Inside a bounded pull request the active implementation agent has wide
latitude, and does not stop to ask permission to work. It may inspect,
reproduce, search, implement, refactor in scope, write tests — including
adversarial and mutation tests — fix in-scope defects, answer advisory review,
strengthen a proof, and update the documentation the outcome requires.

What it may not do is turn one pull request into another outcome.

**More autonomy through a smaller box, not through a bigger branch.** The box is
what makes the autonomy safe: a tightly bounded outcome can be reasoned about,
proved and reviewed on one head, so there is little left to ask about.

## Machines enforce structure; reviewers judge meaning

This is a rule about what may be automated, and it was bought expensively: the
merge card check shipped thirty-one false greens learning it.

- **A check may enforce a closed form.** A field drawn from a fixed vocabulary,
  a 40-character SHA, an integer, an arithmetic identity, the presence of an
  answer at all. These cannot be argued with, and no future wording defeats
  them.
- **A check may not judge prose.** Whether an explanation is honest, whether an
  outcome is genuinely one outcome, whether an `EXCEEDED` scope is justified,
  whether a `FIX NOW` really shares a root cause, whether a `CONTINUE` after
  three rounds is right — all of that is the required review's, and the card is
  where the judgement is recorded.

Do not add cleverer natural-language interpretation to the merge card check. The
recorded limit in [`docs/RISK_LABELS.md`](docs/RISK_LABELS.md) explains why a
rule of that kind cannot be finished. Where a field can be closed, close it;
where it cannot, write the limit down.

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
change to the `plan` block, `node test-local.js` after `server.js`,
`node test-mergecard.js` after the merge card check or the pull request
template, and `node verify-live.js` against the deployed site for the security
behaviour visible without a password.

**The review machinery is code, and it is tested like code.** A change to
`merge-card-check.yml` that nothing catches is a change to what may merge.

A test should prove the failure cannot recur through the path a household
actually reads — not only through the helper that was just written.

## What not to build

**Two absolutes, no gate, no exception:** never hold an **institution login
credential** — a bank username or password, a PIN, a security answer, a one-time
or 2FA code, or anything else meant for logging in as the household — and never
automate an action against an account. Atlas reads what it is given and publishes
a private view. It does not move money, submit a form, or accept an agreement.

That is narrower than "no secrets", and deliberately: the server already refuses
to start without `SITE_PASSWORD` and `SESSION_SECRET`. A **read-only** provider
or API token would be the same kind of thing and is **not authorised today** —
[`ARCHITECTURE.md`](ARCHITECTURE.md) holds the one secret boundary, including
where such a token could ever live: server-side only, in the deployment
platform's secret mechanism, never in git, never in the browser, never in a log.

**Two gated capabilities:** a canonical store, and automated financial-data
connectivity. Both are wanted and neither is authorised yet.
[`ARCHITECTURE.md`](ARCHITECTURE.md) holds the exact gate for each, and is the
only home for them — a capability is started when its gate is met and Dale says
so, not when a plan reaches that line. Owner-reserved stop 5 is unchanged.

**Still nothing here:** no second dashboard, and no governance system beyond this
file. The gates that exist are the ones that caught something real. Add a gate
when something goes wrong that it would have caught, and not before.

**One roadmap, in three parts that do not overlap.**
[`ARCHITECTURE.md`](ARCHITECTURE.md) owns *direction and the gates*;
[`docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md`](docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md)
owns *sequencing within what direction permits*; [`BACKLOG.md`](BACKLOG.md) owns
*work and findings*. A second one of any of those is the thing to refuse.
