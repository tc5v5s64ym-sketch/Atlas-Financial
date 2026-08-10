<!--
  Atlas Financial merge card.

  This repository publishes numbers a household makes decisions on. The review
  question is never "does the code work" — it is "is this true, and does one
  fact still have one home". Fill the card honestly; "unknown" and "not
  required, because …" are real answers and are better than a confident guess.

  The `merge-card-check` workflow verifies this card is PRESENT and FILLED. It
  is a literal check — it can tell a claim from a blank, and nothing more. It
  cannot tell a true statement from a false one. That part is the reviewer's.
-->

## 🟦 Atlas Merge Card

| Field | Value |
|---|---|
| **Title** | <!-- one line --> |
| **Primary risk** | <!-- exactly one: auto-safe / owner-decision / figures-moved / blocked --> |
| **Files / categories touched** | <!-- concise --> |
| **Figures moved** | <!-- which published figures change, or "none". The Published figures review comment computes this — reconcile against it. --> |
| **Reproduced / disproved** | <!-- for a claimed defect: how it was reproduced on current main BEFORE the fix, or how it was disproved. "n/a — not a defect fix" is fine. --> |
| **Authority impact** | <!-- did any fact change its home? name the winner and what was deleted. "none" if no authority moved. --> |
| **Tests** | <!-- exact command and result, e.g. `npm test` — 5 suites, 289 checks, all passing --> |
| **Security** | <!-- auth gate / CSP / secret handling / pre-commit hook: unchanged, or exactly what changed and why --> |
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

---

<!--
  A note on the two review gates:

  · `merge-card-check` (blocking) — this card exists and is filled.
  · `Published figures review` (advisory) — a bot comment computing which
    published figures actually moved, by running the engine on the base and on
    this head. If it lists a figure the card does not mention, one of the two
    is wrong: either the card is incomplete, or the change had an effect that
    was not intended. Resolve it before merging.
-->
