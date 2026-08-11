<!--
  Atlas Financial merge card.

  `merge-card-check` validates only mechanical facts: required rows are filled,
  the current-state verdict has a closed opening, and a required architecture
  review records PASS on this exact head. It does not interpret prose, scope,
  negation, findings, or review quality.
-->

## 🟦 Atlas Merge Card

| Field | Value |
|---|---|
| **Title** | <!-- one line --> |
| **Primary risk** | <!-- auto-safe / owner-decision / figures-moved / blocked --> |
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

  The blocking question is: Is this exact head unsafe or architecturally wrong
  to merge? Improvement ideas belong in the optional advisory audit.

  On follow-up, verify the named blocker fixes and the high-risk surface changed
  by those fixes. Do not reopen the whole artifact for unlimited new findings.

  Closed forms enforced by CI:
  - Required opens REQUIRED or NOT REQUIRED.
  - REQUIRED: exact current 40-character head, Reviewer ChatGPT, outcome PASS.
  - NOT REQUIRED: head, reviewer, and outcome are each N/A.
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
