# Atlas Financial — agent brief

**Who decides, who reviews, and when something stops for a person.**

This file holds the operating, review and merge rules. Its filename is retained
for historical continuity; it binds every approved implementation surface and
model equally. It deliberately holds nothing else, because the rest already has
a home:

| For | Read |
|---|---|
| Orientation in a new session | [`CONTEXT.md`](CONTEXT.md) |
| Builder portability and repository-state handoff | [`docs/BUILDER_PORTABILITY.md`](docs/BUILDER_PORTABILITY.md) |
| How the layers fit together, and the direction | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| What the CI gates check and why each exists | [`docs/RISK_LABELS.md`](docs/RISK_LABELS.md) |
| Work that can be done | [`BACKLOG.md`](BACKLOG.md) |
| What only the household can answer | [`docs/01_OPEN_QUESTIONS.md`](docs/01_OPEN_QUESTIONS.md) |
| What to build next, and in what order | [`docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md`](docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md) |
| Task procedure (load on demand) | [`docs/skills/README.md`](docs/skills/README.md) |
| Durable technical lessons (non-authoritative; search, do not always-load) | [`docs/lessons/README.md`](docs/lessons/README.md) |
| Agent context architecture | [`docs/AGENT_CONTEXT.md`](docs/AGENT_CONTEXT.md) |

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
one-outcome rule, the verification gate, the review lane, the owner-reserved
stops, or merge authority. Two agents never hold the role for the same outcome
at the same time.

The agent selects the work, verifies current state before editing, implements
one independently provable outcome on a fresh `agent/<outcome>` branch from
current `main`, proves the numbers independently, opens the pull request with
the merge card filled, and addresses any real high-severity advisory defect.
When a high-risk trigger has fired, it requests the Atlas Contract / Systems
Review only after the head is a stable merge candidate, then merges the exact
passing head.

### Independent agent review — any agent that is not the active builder

Advisory, always. Fix the real findings, say why for the ones you reject, and
record both in the merge card. Never manufacture a review status out of a bot's
wording, its reactions, or its identity.

### GitHub Actions

The deterministic hard gates. A required check that is missing, stale, skipped,
errored, timed out, cancelled or failed **is a failure**, not an absence of one.

---

## The two review lanes

|  | Atlas Contract / Systems Review | Independent improvement audit |
|---|---|---|
| Performed by | ChatGPT | An agent that is not the active builder |
| Status | **Required only when a high-risk trigger fires** | Optional |
| Question | Is this exact head unsafe or architecturally wrong to merge? | What could be improved? |
| Result | `PASS` or `BLOCKING` | Findings with dispositions |
| Is it a GitHub check? | No | No |

The lanes are separate. An improvement does not become a blocker because a
reviewer noticed it. A real product, financial, security, authority, or trust
defect remains a blocker because the defect is real.

### Atlas Contract / Systems Review — blocking architecture review

**ChatGPT performs this review.** When a high-risk trigger fires, the review is
required governance before merge. When no high-risk trigger fires, it is not
required. The active implementation agent cannot satisfy its own architecture
gate. The review is not a GitHub status check. It never authorizes a household
fact, raw data release, secret, schema, production write, or promotion from
estimated to verified. Those remain owner-reserved.

#### High-risk triggers

The review is required only when a pull request changes one of these:

- runtime logic that computes or publishes a figure the household acts on, or
  the independent numerical/invariant proof that permits that logic to merge;
- the sole authority for a fact, figure, engine decision, security boundary, or
  store, including a cutover, compatibility bridge, or bridge sunset;
- authentication, sessions, cookies, CSP, secret handling, raw-data boundaries,
  a schema, a production write path, or a destructive operation;
- the verified / calculated / estimated / unknown trust contract, an estimate
  reaching a decision surface, or a claim being promoted to verified;
- an owner-reserved gate, product direction, or the product trust contract;
- a deterministic hard gate whose pass/fail result protects one of the items
  above; or
- unresolved ambiguity about one of the items above.

Ordinary documentation or status precision does not trigger the review when it
records current state without moving an authority or trust claim. Neither do
routine tests, refactors, templates, or comments that leave runtime and hard-gate
semantics unchanged.

#### When the review is requested

Do not request this review until the pull request is a credible merge
candidate:

- implementation is complete;
- the merge card is current;
- deterministic tests and checks applicable to the head are green;
- figures review has completed when applicable;
- one optional independent advisory pass, if run, has completed;
- genuine high-severity advisory findings have already been repaired; and
- the head is expected to stay stable.

ChatGPT reviews a candidate for merge, not the first implementation attempt.
Optional advisory suggestions need not all be fixed. Correct-but-improvable
work may proceed to systems review.

#### Bounded review protocol

The blocking question is one sentence:

> Is this exact head unsafe or architecturally wrong to merge?

The initial review reports only merge blockers. It checks one-authority
ownership, false-green proof, numerical/trust invariants, security and owner
boundaries, and bridge cleanup. Correct-but-improvable work receives `PASS`; any
improvement notes go to the optional audit.

If the review returns `BLOCKING`, repair only the named blockers and prove those
repairs with targeted tests plus the normal applicable checks. Then request
bounded re-review on the new exact head. The follow-up reads that head, verifies
the named fixes, and checks the high-risk surface changed by those repairs. It
does **not** reopen the untouched artifact for an unlimited new review. A new
blocker is in scope only when the fix introduced a new high-severity defect,
changed another high-risk surface, or made the original blocker impossible to
verify without that adjacent fact.

If a review repair itself introduces another genuine high-risk blocker, one
bounded repair is reasonable. If the process then continues producing
blocker-after-blocker, stop the automation and review churn and return the
design or process to the decision desk for reassessment. Do not create an
endless repair / re-review loop.

There is no target number of rounds and no "run until clean" rule. The terminal
result is `PASS` when no unsafe or architecturally wrong condition remains.

#### Merge-card record

The review block records five fields:

- **Required** — opens `REQUIRED` or `NOT REQUIRED`;
- **Exact reviewed head** — the current full SHA when required, else `N/A`;
- **Reviewer** — `ChatGPT` when required, else `N/A`;
- **Review outcome** — `PASS` before merge when required, else `N/A`; and
- **Findings and fix verification** — the blocker record or `N/A`.

Those fields are the governance record. When the review is required, merge waits
for ChatGPT `PASS` on the current exact head. That wait is a review contract, not
a GitHub status check.

`merge-card-check` enforces only that the card is filled and the closed openings
are structurally valid. It does **not** parse or enforce ChatGPT identity,
`PASS`, `BLOCKING`, or review-SHA equality. Confidence that the change is not
junk comes from `npm test`, the secret hook, and the figures comment.
Decision-desk advice from ChatGPT remains optional and is a separate role from
this review.

### Independent improvement audit — optional and bounded

Default to at most **one advisory pass** on a coherent head. Do not request a
second pass because ordinary fixes made the first pass stale. A second pass is
justified only when the first found a high-severity or systemic defect, or the
response materially changed a high-risk runtime, security, schema, authority,
cutover, or product-trust surface.

Lower-severity improvements may be accepted, rejected with a short reason, or
routed. They do not require another audit. `not run` is a valid merge-card
answer. An unresolved high-severity product/trust defect still blocks, but the
blocker is the defect, not the existence or freshness of an advisory review.

---

## Merge gate

The active implementation agent merges when all of these hold:

- `npm test` and the other applicable GitHub checks passed **on the exact
  current head**;
- the merge card is complete, including attribution;
- exactly one primary risk value, taken from the Merge Card and projected onto
  the GitHub label (`docs/RISK_LABELS.md`);
- no real financial, security, authority, invariant, or product-trust blocker
  remains;
- one independently provable outcome, clean branch, no unrelated drift, no
  secret or raw data; and
- no owner-reserved item is outstanding.

When a high-risk trigger has fired, Atlas Contract / Systems Review `PASS` on
the current exact head is also required governance before merge. ChatGPT
performs that review. The builder cannot satisfy it. It is not a GitHub status
check: `merge-card-check` does not parse or enforce ChatGPT identity, `PASS`,
`BLOCKING`, or review-SHA equality.

When no high-risk trigger has fired, the systems review is not required.
Decision-desk advice from ChatGPT remains optional help. `auto-safe` work may
still merge on green.

Do not invent a generic owner-approval ceremony, and do not treat the parked
paid OpenAI reviewer as this review.

Failed `tests` or merge-card completeness checks start one automatic Cursor
repair. The patch is tested before it is pushed. Two failed attempts stop
and comment; they do not loop. A repair must not weaken a financial test.

## Merge policy

The Merge Card `Primary risk` row decides what the owner does. The GitHub
primary label is a projection of that row, not a second judgement.
`docs/RISK_LABELS.md` defines each closed value:

- **`auto-safe`** — no published figure moves. Merge on green when no
  systems-review trigger fired. No approval click. A high-risk trigger still
  waits for Atlas Contract / Systems Review `PASS` on the current head.
- **`figures-moved`** — the owner sees the figures diff before the merge. That
  is a *look*, not a sign-off ritual: reconcile the bot's list against the card,
  and if they disagree, one of them is wrong.
- **`owner-decision`** — blocked on a person, not on code.
- **`blocked`** — not mergeable as it stands.

For high-risk triggered work, green tests, a complete card, no real blocker,
and Atlas Contract / Systems Review `PASS` on the current head make a merge
candidate. GitHub remains the repository source of truth; that review is
recorded there, not enforced as another required status check.

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

### Fresh `main`, surface-neutral branches, and the stacking exception

New implementation work uses `agent/<outcome>` on every surface. Existing
`claude/*` branches remain valid historical branches; do not rename them or use
them as evidence that new work is Claude-specific.

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

Under or over them, a reviewer asks whether the pull request still has one
independently provable outcome. The tripwires are guidance, not merge-card
fields and not CI thresholds. Some honest work is large.

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

### Scope stays a reviewer judgement

Reviewers may ask for a split when a pull request contains independent outcomes.
They do not count review rounds or require a machine-readable reassessment. If a
fix reveals a separate outcome, route it. If splitting would create two live
authorities or an unsafe intermediate state, keep the atomic change together and
state why in ordinary prose.

## The Closed-Loop Delivery Contract

Every implementation pull request should be explainable as one chain:

**purpose → authority → implementation → integration → proof → cleanup →
closure.**

Work is finished when a loop is closed, not when code lands. Use the merge-card
reviewer-guidance section to state the outcome, non-goals, authority, consumer,
proof, and cleanup in concise prose. CI does not score or count them.

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

CI may enforce a fixed vocabulary, a field's presence, a SHA shape, equality to
the current head, an arithmetic identity, or another deterministic fact. CI may
not infer meaning from prose, negation, severity wording, scope arguments,
finding dispositions, or review-round narratives.

`merge-card-check` therefore checks required rows, the current-state opening,
and that the review decision opens `REQUIRED` or `NOT REQUIRED` with the closed
`N/A` fields when not required. It does not judge whether the human trigger
decision was correct, and it does not parse or enforce `PASS`, `BLOCKING`,
review-SHA equality, or ChatGPT identity. File paths are facts, not prose;
they are not a second review-status gate in this check. Small-PR discipline,
closed-loop delivery, advisory dispositions, and cleanup explanations remain
reviewer guidance.

## Governance-control lifecycle

Governance controls are retained, changed, or retired on evidence. They are not
grow-only.

A new hard control needs all four:

1. a demonstrated product or trust failure it would have caught;
2. a deterministic predicate with no prose interpretation;
3. a focused test that proves the predicate fails on the mechanical defect; and
4. a named retirement condition or reason it is permanent.

Review an existing control when it repeatedly blocks safe work, duplicates
another guard, or its original failure path disappears. Retire or narrow it when
another surviving control covers the demonstrated failure at least as directly,
or when the protected path no longer exists and a regression test proves that.
The governance PR states what is removed, what replaces its protection, and the
evidence. A change to a product/trust hard gate still triggers the Atlas Contract
/ Systems Review. Owner-reserved production, schema, security, data, and
verification gates cannot be retired without the owner's explicit decision.

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
- **Never ask for or handle an institution login credential.** A bank username or
  password, a PIN, a security answer, a one-time or 2FA code — anything that logs
  in as the household — is the owner's alone. On doubt, stop.
- `raw/` and `derived/` never enter git, a pull request, a comment, or a
  conversation. Only sanitised aggregates leave `raw/`.
- **A secret Atlas legitimately holds** — `SITE_PASSWORD`, `SESSION_SECRET`, and
  one day possibly an approved read-only provider token — lives only where
  [`ARCHITECTURE.md`](ARCHITECTURE.md) permits, and never in the repository, in
  `data.json`, in a pull request body, in a log, or delivered to or persisted in
  the browser. That file is the one home for the rule; do not restate a narrower
  version here.
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

**On any doubt about a credential, stop.** If it could authenticate Atlas *as the
household* through an institution's ordinary login path, it is prohibited.
[`ARCHITECTURE.md`](ARCHITECTURE.md) states that fail-closed rule and is the one
home for it.

**Two gated capabilities:** a canonical store, and trusted canonical
refresh from live financial-data connectivity. The store is wanted and not
authorised. Live **read-only** Lunch Money observation already exists and
has been exercised. T4 passed 2026-08-17 for the earned preview/approve
writer (`scripts/canonical-refresh.js`). Automatic or unrestricted
production **writes**, scheduled refresh, and a Render Lunch Money token
remain **not** authorised.
[`ARCHITECTURE.md`](ARCHITECTURE.md) holds the exact gate for each. A capability
is started when its gate is met and Dale says so, not when a plan reaches that
line. Owner-reserved stop 5 is unchanged. The 2026-08-17 Lunch Money feed
decision is product direction; the later same-day T4 pass is the write-gate
pass with those production reservations.

**Still nothing here:** no second dashboard, and no governance system beyond this
file. The gates that exist are the ones that caught something real. Add a gate
when something goes wrong that it would have caught, and not before.

**One roadmap, in three parts that do not overlap.**
[`ARCHITECTURE.md`](ARCHITECTURE.md) owns *direction, authority and the gates*;
[`docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md`](docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md)
owns *sequencing within what direction permits*; [`BACKLOG.md`](BACKLOG.md) owns
*work and findings*. A second one of any of those is the thing to refuse.