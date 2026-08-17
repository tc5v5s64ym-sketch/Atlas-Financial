<!--
  Atlas Financial merge card.

  `merge-card-check` validates only mechanical facts: required rows are filled,
  the current-state verdict has a closed opening, Primary risk opens with a
  closed value, and Required opens REQUIRED or NOT REQUIRED (with N/A for
  head, reviewer, and outcome when not required). It does not interpret prose,
  scope, negation, findings, or review quality. It does not parse or enforce
  ChatGPT identity, PASS, BLOCKING, or review-SHA equality.

  Atlas Contract / Systems Review is required governance when a CLAUDE.md
  high-risk trigger fires, and not required otherwise. That is not a GitHub
  status check.
-->

## 🟦 Atlas Merge Card

| Field | Value |
|---|---|
| **Title** | <!-- one line --> |
| **Primary risk** | <!-- one of: auto-safe / figures-moved / owner-decision / blocked — plain text or ordinary inline code --> |
| **Files / categories touched** | <!-- concise --> |
| **Current-state verdict** | <!-- OPEN with STILL BROKEN / ALREADY FIXED / PARTIALLY FIXED / FIXED BUT UNTESTED / STALE-SUPERSEDED / NEEDS OWNER ANSWER; then source and evidence from current main --> |
| **Builder surface** | <!-- the tool this work ran on --> |
| **Primary builder model** | <!-- the displayed model name; if withheld, say so --> |
| **Supporting / explore models** | <!-- each other model and role, or None --> |
| **Architecture / dispatch authority** | <!-- normally ChatGPT --> |
| **Figures moved** | <!-- each published figure, or none --> |
| **Reproduced / disproved** | <!-- current-main evidence, or n/a --> |
| **Authority impact** | <!-- winner, loser, and bridge/sunset; or none --> |
| **Tests** | <!-- exact commands and results --> |
| **Security** | <!-- unchanged, or exact effect --> |
| **Advisory review** | <!-- not run / one pass with dispositions / second pass with the high-severity or systemic reason --> |
| **Owner decision required** | <!-- No, or the exact owner-reserved question --> |
| **Estimated inputs added** | <!-- estimate and confirmation path, or none --> |

### Current-state evidence

<!-- Source, exact current-main evidence, and the smallest allowed action. -->

### What changed

<!-- One independently provable outcome. -->

### Proof

<!--
  Exact deterministic commands. For a financial figure, include an independent
  reconciliation rather than only a test of the function that computes it.
-->

### Reviewer guidance — scope and closure

<!--
  These are reviewer questions, not machine-parsed fields:

  - Is this one outcome with explicit non-goals?
  - Does one authority win, with any loser removed or given an exact sunset?
  - Is the live consumer named and is the proof level correct?
  - Is temporary machinery removed or tied to an exact retirement condition?

  Keep the answers concise. Do not count review rounds or open loops.
-->

### Atlas Contract / Systems Review

<!--
  `CLAUDE.md` owns the narrow trigger list and review protocol.

  When a high-risk trigger fires, this review is REQUIRED governance before
  merge. ChatGPT performs it on the current exact head. The builder cannot
  satisfy it. Request it only on a stable merge candidate, not the first
  implementation attempt. Outcome is PASS or BLOCKING.

  When no high-risk trigger fires, it is NOT REQUIRED.

  Decision-desk advice is a separate, optional ChatGPT role.

  This is not a GitHub status check. Closed forms enforced by CI:
  - Required opens REQUIRED or NOT REQUIRED.
  - NOT REQUIRED: head, reviewer, and outcome are each N/A.
  Review SHA / PASS / PENDING / BLOCKING are documentary. They do not fail
  the mechanical check.
-->

- **Required**: <!-- REQUIRED — trigger; or NOT REQUIRED — why no high-risk trigger fired -->
- **Exact reviewed head**: <!-- 40-character SHA, or N/A -->
- **Reviewer**: <!-- ChatGPT, or N/A -->
- **Review outcome**: <!-- PASS, BLOCKING, or N/A -->
- **Findings and fix verification**: <!-- blockers and dispositions; follow-up verification; none; or N/A -->

### Additional findings

<!--
  Optional record. Fix a real in-scope safety/correctness defect. Route an
  adjacent improvement without widening this PR. CI does not parse this prose.
-->

### Non-goals and known uncertainty

<!-- What this does not do, what remains uncertain, and what would settle it. -->
