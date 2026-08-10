<!--
  Atlas Financial merge card.

  This repository publishes numbers a household makes decisions on. The review
  question is never "does the code work" — it is "is this true, and does one
  fact still have one home". Fill the card honestly; "unknown" and "not
  required, because …" are real answers and are better than a confident guess.

  The `merge-card-check` workflow verifies this card is PRESENT and FILLED. It
  is a literal check — it can tell a claim from a blank, and nothing more. It
  cannot tell a true statement from a false one. That part is the reviewer's.

  Two blocks below the prose sections are as load-bearing as the table: the
  required review (`CLAUDE.md` holds the trigger list) and the disposition of
  every finding made along the way.
-->

## 🟦 Atlas Merge Card

| Field | Value |
|---|---|
| **Title** | <!-- one line --> |
| **Primary risk** | <!-- exactly one: auto-safe / owner-decision / figures-moved / blocked --> |
| **Files / categories touched** | <!-- concise --> |
| **Current-state verdict** | <!-- the source (backlog item / question / owner instruction), then exactly one of: STILL BROKEN / ALREADY FIXED / PARTIALLY FIXED / FIXED BUT UNTESTED / STALE-SUPERSEDED / NEEDS OWNER ANSWER — checked on current main BEFORE any change --> |
| **Builder surface** | <!-- the tool this work ran on, e.g. Claude Code / Codex / Cursor --> |
| **Primary builder model** | <!-- the exact model name the surface displays. Never guessed — if the surface withholds it, say so --> |
| **Supporting / explore models** | <!-- each other model and what it did, or None --> |
| **Architecture / dispatch authority** | <!-- who dispatched and architecturally owns this work, normally ChatGPT --> |
| **Figures moved** | <!-- which published figures change, or "none". The Published figures review comment computes this — reconcile against it. --> |
| **Reproduced / disproved** | <!-- for a claimed defect: how it was reproduced on current main BEFORE the fix, or how it was disproved. "n/a — not a defect fix" is fine. --> |
| **Authority impact** | <!-- did any fact change its home? name the winner and what was deleted. "none" if no authority moved. --> |
| **Tests** | <!-- exact command and result, e.g. `npm test` — 5 suites, 289 checks, all passing --> |
| **Security** | <!-- auth gate / CSP / secret handling / pre-commit hook: unchanged, or exactly what changed and why --> |
| **Advisory review** | <!-- Codex and any other automated reviewer: what each finding was, and its disposition — fixed / non-issue with reason / deferred to backlog. "none raised" if the review came back clean. A finding left unanswered blocks the merge, not the review. --> |
| **Owner decision required** | <!-- No, or the exact question the household has to answer --> |
| **Estimated inputs added** | <!-- any new estimate, and what would confirm it. "none" if all figures are derived or verified. --> |

---

### What changed

<!-- What this does, in plain terms. Someone reading it in six months should
     understand why it was necessary without opening the diff. -->

### Why the numbers are right

<!-- The evidence. For anything financial: how was it checked INDEPENDENTLY of
     the code that produces it? A test that exercises the same function that
     computes the answer proves consistency, not correctness. Where a figure is
     derived, say what it was reconciled against. -->

### What this does NOT do

<!-- Scope boundary. What a reader might reasonably assume was covered and was
     not — deliberately deferred work, and anything left estimated. -->

### Known uncertainty

<!-- What could still be wrong, and what would settle it. Say "none known" only
     if you mean it. -->

### Delivery

<!--
  One pull request, one INDEPENDENTLY PROVABLE OUTCOME. `CLAUDE.md` holds the
  rule, the scope tripwires, the atomicity exception, the review-churn
  reassessment and the closed-loop chain.

  Seven of these lines are CLOSED FORMS: the value OPENS with one of the listed
  words, and anything after it is yours. That is deliberate — a check can hold a
  vocabulary and an integer, and nothing more. Whether the outcome is genuinely
  one outcome, whether an EXCEEDED scope is justified, and whether a CONTINUE
  after three rounds is right are the required review's to judge, not the
  check's.

  Reasons are required where a value switches something off: EXCEEDED,
  atomicity YES, and any reassessment after two or more blocking rounds.
-->

- **One outcome**: <!-- the single thing this makes true, in one line -->
- **Non-goals**: <!-- what a reader might assume was covered and was not -->
- **Scope status**: <!-- WITHIN, or EXCEEDED — <why>. Tripwires: <=8 implementation files, <=~600 implementation lines, tests/fixtures/generated counted separately -->
- **Atomicity exception**: <!-- NO, or YES — <what splitting would break, and why one closure condition covers the pieces> -->
- **Blocking review rounds**: <!-- 0 / 1 / 2 / 3+ — exact-head rounds that blocked -->
- **Scope reassessment**: <!-- N/A below two rounds; otherwise CONTINUE — <why one root cause> or SPLIT — <what moves out> -->
- **Proof level**: <!-- UNIT / INTEGRATION / BROWSER / LIVE / OWNER EVIDENCE / MIXED -->
- **Open loops closed**: <!-- integer -->
- **Open loops created**: <!-- integer -->
- **Net open loops**: <!-- created minus closed; the check does the arithmetic. Preference is <= 0 -->

### Atlas Contract / Systems Review

<!--
  The one REQUIRED review lane. ChatGPT performs it — an implementation agent
  cannot satisfy its own architecture gate, because a clean context is the same
  agent with the same blind spots. An agent's own clean-context read is advisory
  confidence and goes in the card's `Advisory review` row instead.

  Required when this pull request touches: the engine or a derived figure the
  household acts on · a fact changing home · the review machinery itself · the
  security gate · what counts as evidence · an estimate reaching the decision
  page · direction · genuine ambiguity. The list is wide on purpose; "no trigger
  fired" is a claim that has to survive reading it. `CLAUDE.md` holds the full
  list and the twelve questions the review asks — seven about truth and
  authority, five about whether this is one pull request at all.

  It reads the EXACT head. A review of an earlier commit does not cover a later
  one — push after a review and it has to be repeated. That is the same staleness
  the Codex freshness comment reports, and it is no less serious here, so the
  card check enforces it: when this block says a review was required, the SHA
  below has to be this pull request's current head.
-->

- **Required**: <!-- OPEN with "required" (then name the trigger that fired) or "not required" (then say why none did). Only the opening decides whether the exact-head checks run; later prose never reclassifies it. -->
- **Exact reviewed head**: <!-- the full 40-character commit SHA the reviewer read, or n/a -->
- **Reviewer**: <!-- who performed the required review, or n/a -->
- **Findings and dispositions**: <!-- each finding + fixed / non-issue with the reason / routed. "none" if it came back clean; "n/a" if no review was required -->

### Additional findings

<!--
  Everything noticed while doing this work takes exactly ONE disposition, so a
  real finding cannot quietly evaporate and cannot silently expand this pull
  request.

  DELETE the lines that do not apply. An unfilled disposition is this scaffold
  rather than an answer, and the check fails it — otherwise the one block that
  is meant to be load-bearing would never have to be edited. "None" cannot
  stand beside a disposition that carries content, because a pull request
  cannot both have found nothing and have dispositioned something.

  A thing a human has to KNOW is a question (docs/01_OPEN_QUESTIONS.md). A thing
  someone has to DO is backlog (BACKLOG.md). The row above records the decision
  this PR is blocked on; this section records what it found along the way.
-->

- None
- FIXED NOW:
- NEXT PR:
- REJECTED:
- ADDED TO BACKLOG:
- OWNER DECISION REQUIRED:

---

<!--
  The review surfaces, and what each one is worth:

  · `merge-card-check` (blocking) — this card exists and is filled. Literal
    only: it cannot tell a true claim from a false one.
  · `Published figures review` (advisory) — a bot comment computing which
    published figures actually moved, by running the engine on the base and on
    this head. If it lists a figure the card does not mention, one of the two
    is wrong: either the card is incomplete, or the change had an effect that
    was not intended. Resolve it before merging.
  · `Codex review freshness` (advisory) — whether the Codex review still
    describes the code that is here. Its findings are answered in the
    `Advisory review` row.
  · The Atlas Contract / Systems Review — required when a trigger fires, and
    deliberately NOT a GitHub check, a status, or a reviewer account. It is
    recorded in the block above and nowhere else.
-->
