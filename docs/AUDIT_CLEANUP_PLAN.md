# Atlas Repository Truth Audit Cleanup Plan

**Status:** ACTIVE  
**Owner instruction:** 2026-08-21  
**Baseline audit:** [`docs/advisory/REPOSITORY_TRUTH_AUDIT_2026-08-21.md`](advisory/REPOSITORY_TRUTH_AUDIT_2026-08-21.md)  
**Baseline audited main:** `baff0376a1a2084417add564f60fba388a2cfb0f`  
**Campaign trigger phrase:** `action the audit cleanup plan`

This is a **temporary owner-directed execution tracker**, not a new financial, planning, fact, store, review, or permanent sequencing authority. Current `main`, `AGENTS.md`, `CLAUDE.md`, `ARCHITECTURE.md`, and `docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md` still win wherever the dated audit has gone stale.

The purpose of this file is cross-session continuity. A fresh session must be able to resume the cleanup without reconstructing the 2026-08-21 audit from chat history.

## Operating contract

When the owner says **"action the audit cleanup plan"**:

1. Read `AGENTS.md` and its current authority/read order first.
2. Read this tracker and the frozen baseline audit.
3. Inspect current `main`, open PRs, and the exact current state of the next candidate finding before changing anything.
4. **Do not rerun the full repository audit.** The dated audit is the baseline. Revalidate only the finding being actioned and the high-risk surface its fix touches.
5. Do not duplicate an outcome already being worked in an open PR. Finish or disposition that PR first.
6. Take the first `TODO` item below that is not owner-blocked, unless current repository truth shows it is already fixed, stale, superseded, or unsafe to do next.
7. Use one independently provable outcome per PR. A finding may be split if current evidence shows it contains multiple outcomes. Findings may be combined only when current `CLAUDE.md`'s one-outcome rule is genuinely satisfied.
8. **Every campaign PR must update this file.** Before merge, record the truthful terminal status, PR number, and one-sentence proof/result for the finding it actually resolves.
9. An owner-blocked item does not stop unrelated cleanup. Mark it `WAITING OWNER` and continue to the next eligible item. Never invent the answer.
10. High-risk triggers still require Atlas Contract / Systems Review on the exact current PR head. This tracker cannot satisfy or waive that review.
11. Do not turn audit observations into new household facts, owner policy, borrowing permission, reserve targets, priorities, schemas, stores, or a second planner.
12. PR #134 merged before this tracker landed. It is not one of F-01…F-18 and does not count as campaign progress.
13. When all findings have truthful terminal dispositions, perform a **light final reconciliation only**: verify this table against current repo state and make sure campaign PRs left no contradiction on the surfaces they touched. Do not repeat the full audit.
14. The final campaign PR must **delete this file**. The dated audit remains historical evidence; Git history preserves this tracker. Do not create a replacement roadmap.

## Progress summary

Baseline findings: **P0 = 0 · P1 = 5 · P2 = 11 · P3 = 2**.  
Current progress: **0 / 18 findings dispositioned**.

Status vocabulary:

- `TODO` — eligible after current-state revalidation.
- `WAITING OWNER` — requires a non-derivable household / owner decision.
- `IN PR #N` — optional while a campaign PR is open.
- `DONE — PR #N` — merged and proved.
- `ALREADY FIXED` — current main already satisfies the finding; do not invent code.
- `SUPERSEDED` — the dated finding no longer applies for a documented reason.
- `DEFERRED` — intentionally left for opportunistic cleanup; reason recorded.

## Execution tracker

| Order | Finding | Target outcome | Status | Completion / proof record |
|---:|---|---|---|---|
| 1 | **F-01** | Records renders commitment ranges / undated commitments through the authoritative Forecast publication view; no `$0.00` for a range-only amount and no `Invalid Date`. | **TODO** | |
| 2 | **F-02** | Reconcile TD Cash Back Visa and Travel Visa standing-facts prose to the canonical 2026-08-19 state, removing stale balance/minimum/limit claims from the wrong home. | **TODO** | |
| 3 | **F-04** | Re-derive B71 Triangle limit-risk conclusion from the current canonical opening / `Forecast.projectDebts`; no stale “remains under” claim presented as current. | **TODO** | |
| 4 | **F-03** | One authoritative coaching-income overstatement answer reaches both Deep Dive surfaces; no `$650` vs `$1,650` contradiction. | **TODO** | |
| 5 | **F-05** | Reconcile Evidence-Use Register dispositions for the six interview-derived commitments with the owner gate and the values already live in `plan.commitments`; add only a guard justified by the resolved authority state. | **WAITING OWNER** | Owner must confirm whether the 2026-08-16 absorption satisfied the joint-household promotion gate for HH-021, HH-022, TRAVEL-002, COMMIT-002, COMMIT-003 and HH-014. |
| 6 | **F-06** | Q2 status claims outside `01_OPEN_QUESTIONS.md` cannot contradict the sole question-status authority; correct current conflicts and add the narrow deterministic guard if current governance still calls for it. | **TODO** | |
| 7 | **F-07** | Q3's secured-debt and financial-account-net-worth fragment are current or explicitly dated historical figures, not stale-as-current. | **TODO** | |
| 8 | **F-08** | B91's completed record clearly labels the 2026-08-16 block historical and no longer asserts that superseded opening / Q19 state as current. | **TODO** | |
| 9 | **F-09** | `00_MASTER_PICTURE.md` no longer labels its 2026-08-09 actionable section current; new-session orientation does not route a reader to stale actions as today's truth. | **TODO** | |
| 10 | **F-10** | B19's closure accurately says what was refreshed, and deep-dive documents do not present superseded liquidity / “now” actions without a date. | **TODO** | |
| 11 | **F-11** | `STORE_QUESTION_B79.md` carries a dated supersession note for T4/B81 while preserving the still-valid store verdict. | **TODO** | |
| 12 | **F-12** | `CLAUDE.md`, PR template, and mechanical merge-card token use one vocabulary for the stale/superseded verdict. | **TODO** | |
| 13 | **F-13** | B72 is closed if current main still proves the bad commit fixture is gone; do not create code for an already-fixed item. | **TODO** | |
| 14 | **F-14** | Resolve whether a midpoint home value / point household net worth may be published at all; then make `positions.csv` / derived summaries follow that owner decision without inventing policy. | **WAITING OWNER** | Owner decision required: range-only presentation vs permission for midpoint estimate. |
| 15 | **F-15** | Separate Amanda's continuing Tennis BC / household-transfer stream from the stopped garage/lab-funded stream so Deep Dive and the forward plan do not contradict each other. | **TODO** | |
| 16 | **F-16** | New-session orientation records the dated 2026-08-21 live acceptance result without moving the canonical opening. A newer canonical cutover remains a separate owner-reserved decision. | **TODO** | Explicit non-goal: do not promote 2026-08-21 to canonical opening in this finding. |
| 17 | **F-17** | Historical suite-count comments stop masquerading as current when their files are next honestly touched. | **DEFERRED** | Opportunistic only; not worth a dedicated PR unless current state raises severity. |
| 18 | **F-18** | The unnumbered outbound-e-transfer question has one question-authority home: fold into Q1 or assign a proper Q id without creating a duplicate question. | **TODO** | |

## Priority and batching

- **F-01 → F-04 are first.** They are the baseline audit's P1 household-facing correctness / contradiction work that does not require an owner answer.
- **F-05 waits for the owner** and must not stall F-06 onward.
- Default to **one finding per PR**. If current evidence proves two findings share one root cause and one acceptance condition, current governance may permit one PR; record why in the merge card. Do not batch merely because both are documentation.
- F-17 stays deferred unless an honest touch to one of those files makes the cleanup in-scope.
- The audit's recommendations are dated advice, not an override of current repository governance. Reproduce each finding before acting.

## Required update in every campaign PR

Before merge, update only the row(s) the PR actually resolves:

- terminal status / disposition;
- PR number;
- exact proof in one short sentence;
- any remainder still open.

Do not mark a row done merely because a PR opened or a test passed on an old head.

## Completion / self-delete

The campaign is complete when every F-01…F-18 row has a truthful terminal disposition and no campaign-created contradiction remains on the surfaces changed.

The final campaign PR must:

1. perform the light reconciliation described above;
2. delete `docs/AUDIT_CLEANUP_PLAN.md`;
3. state in the PR body that Git history preserves the completed tracker;
4. leave the frozen dated audit as historical evidence only;
5. introduce no replacement roadmap or permanent campaign authority.

After deletion, normal work selection returns to `docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md`.