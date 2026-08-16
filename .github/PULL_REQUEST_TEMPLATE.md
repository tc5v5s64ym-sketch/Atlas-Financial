<!--
  Atlas Financial merge card.

  Human-readable review record only. It is not an executable state machine.
  GitHub Pro branch protection plus the Atlas CI check are the mechanical
  gates. ChatGPT records exact-head Atlas review when a high-risk trigger
  fires. A builder cannot declare that review PASS.
-->

## Atlas Merge Card

| Field | Value |
|---|---|
| **Outcome** | <!-- one independently provable outcome --> |
| **Figures moved** | <!-- each Plan-page published figure, or none --> |
| **Tests** | <!-- exact commands and results --> |
| **Owner decision required** | <!-- No, or the exact owner-reserved question --> |
| **Exact reviewed head** | <!-- 40-character SHA when review is required, else N/A --> |
| **Review result** | <!-- PASS / BLOCKING / N/A --> |

Builder: <!-- surface --> / <!-- displayed model; if withheld, say so --> / supporting: <!-- each other model and role, or None --> / dispatch: <!-- normally ChatGPT -->

### Current-state evidence

<!-- Source, one of STILL BROKEN / ALREADY FIXED / PARTIALLY FIXED / FIXED BUT UNTESTED / STALE-SUPERSEDED / NEEDS OWNER ANSWER, and the exact current-main evidence. -->

### What changed

<!-- One independently provable outcome. Non-goals belong here too. -->

### Proof

<!--
  Exact deterministic commands. For a financial figure, include an independent
  reconciliation rather than only a test of the function that computes it.
-->

### Atlas Contract / Systems Review

<!--
  `CLAUDE.md` owns the trigger list. The blocking question is: is this exact
  head unsafe or architecturally wrong to merge? ChatGPT answers it. Cursor
  does not write PASS.
-->
