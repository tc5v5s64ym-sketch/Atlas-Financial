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
| 1 | **F-01** | Records renders commitment ranges / undated commitments through the authoritative Forecast publication view; no `$0.00` for a range-only amount and no `Invalid Date`. | **IN PR #136** | Records Commitments block takes unsettled rows from `Forecast.publicationTotals().commitmentItems` (ranges and `when` intact) and keeps settled rows from `plan.commitments`. Independent proof in `test-major-future-costs.js`. |
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

---

# Dated Opus implementation prompt library — 2026-08-22

This section preserves the **ready-to-copy prompts produced from the 2026-08-21 repository truth audit** so a new session does not depend on chat history. It is **planning scaffolding, not authority**. Before using any prompt, obey the operating contract above: read current `AGENTS.md`, inspect current `main` and open PRs, reproduce the finding, and let current repository truth override stale SHAs, line numbers, counts, wording, or proposed implementation details.

Prompts for already-merged or superseded outcomes remain here only for continuity/history until this temporary tracker self-deletes. **Do not rerun completed work because a prompt exists below.**

## Owner decisions captured by the Opus plan

**Decision A — gates the F-05 prompt.** Did the 2026-08-16 absorption (B95 / PR #82, recorded in Q22) satisfy the *joint household decision* the Evidence-Use Register names as the owner gate for HH-021, HH-022, TRAVEL-002, COMMIT-002, COMMIT-003, HH-014? If yes, the register is stale. If no, do not use the affirmative PR 6 prompt below; return the boundary to the decision desk.

**Decision B — gates F-14; no implementation prompt until answered.** May `positions.csv` publish a single-point household net worth and LTV from the $1,250,000 midpoint of the owner's stated $1.1m–$1.4m home range? If not, the later implementation must change `scripts/positions-summary.js` and regenerate derived rows rather than hand-editing `positions.csv`.

**Decision C — separate from the F-16 record prompt.** Whether to cut a newer canonical opening from 2026-08-21 evidence remains owner-reserved. The F-16 prompt below records the live-acceptance evidence only and must not move the opening.

## PR 1 — Publish range and undated commitments honestly on Records

```text
Read AGENTS.md and follow its read order.

Source: Repository Truth Audit finding F-01, owner-dispatched.

Run the Current-State Verification Gate first. Confirm on current main that
public/records.js renders plan.commitments directly and that money2(null)
publishes "$0.00" for exterior-painting and indio-tournament, and
fmtDate(undefined) publishes "Invalid Date" for all eleven undated rows.
Record the verdict and the evidence in the merge card.

ONE OUTCOME: no plan.commitments row renders on the Records page as $0.00
when it carries only a range, or as "Invalid Date" when it carries no date.

Do this:
1. In public/records.js, render the Commitments block from the engine view
   rather than from plan.commitments directly. Forecast.publicationTotals(d)
   .commitmentItems already carries `amount`, `amountMin`, `amountMax`, `when`
   and `confidence`, and public/deepdive.js already formats ranges from it via
   its shownAmount() helper. Reuse that shape; do not invent a second
   formatter and do not add arithmetic to the page.
2. IMPORTANT: commitmentItems excludes settled commitments. On current data it
   returns 12 rows while plan.commitments holds 16 — burrard1, burrard2,
   fusioncamp and tryouts are settled and absent. Records currently shows those
   four with a "settled" label. Preserve them. Keep rendering settled rows from
   plan.commitments via Forecast.commitmentStatus(c) === 'settled', and take
   unsettled rows from commitmentItems. Do not drop a row the page shows today.
3. Do not change data.json. Do not change Forecast. Do not change the Deep Dive.

Proof required (independent of the code under change):
- Extend test-major-future-costs.js with assertions that fail before and pass
  after: for every plan.commitments row, the string the Records page would
  produce contains neither "$0.00" for a row whose amount is null nor
  "Invalid Date" for a row with no date; and every settled row still appears.
  Build the expected strings from plan inputs, not by calling the same
  formatter the page calls.
- Run: npm test

Non-goals: no change to the Deep Dive or Plan pages, no change to any
commitment amount or date, no new engine function, no new authority.

Merge card: primary risk figures-moved. Reconcile the figures-review comment
against the two rows that change ($0.00 -> $700-$1,200 and $0.00 ->
$5,260-$5,460). Judge the systems-review trigger honestly: this changes a
published figure the household acts on.
```

## PR 2 — Reconcile the two remaining ACCOUNT_FACTS card sections

```text
Read AGENTS.md and follow its read order.

Source: Repository Truth Audit finding F-02, owner-dispatched.

Run the Current-State Verification Gate. On current main, confirm:
- docs/ACCOUNT_FACTS.md:530-556 states the TD Cash Back Visa is "$682.43 OVER
  the limit" / "~$612.43" over, available credit $0.00, a $29.00/month
  over-limit fee "still accruing", and "Next minimum $762.36, due 1 Sep 2026".
- docs/ACCOUNT_FACTS.md:33 (payment calendar) states "1st | TD Cash Back Visa
  minimum | $762.36".
- docs/ACCOUNT_FACTS.md:636-660 states the Travel Visa at 98.0% of its limit
  with "$165.13 of pending charges will take it over".
- Forecast.utilisation on the published opening returns cashback posted
  4799.43 / limit 5000 / available 200.57 / overLimit false, and travelvisa
  posted 1205.33 / limit 1100 / overLimit true / overLimitBy 105.33.
- plan.obligations.cashback records that the 14 Aug $763 payment satisfied the
  $762.36 once row and that the next minimum is ~$170 firstDue 2026-10-01.
Record the verdict and evidence in the merge card.

ONE OUTCOME: no card section in docs/ACCOUNT_FACTS.md asserts a limit,
available-credit or over-limit-fee state that Forecast.utilisation contradicts
on the published opening.

Do this:
1. Give the TD Cash Back Visa and Travel Visa sections the same dated
   canonical-opening block that the Triangle (:349-356) and MBNA (:1856-1861)
   sections already carry. Follow that existing pattern exactly: name the
   2026-08-19 posted and pending figures, state that available credit is
   Forecast-derived and never household cash, and keep the prior readings as
   explicitly dated evidence rather than deleting them.
2. Remove or date the "1st | $762.36" payment-calendar row so the calendar does
   not publish a retired one-off over-limit spike as a recurring minimum. The
   HELOC row two lines above already uses a "see note" pointer for exactly this
   situation — reuse that pattern rather than inventing a new one.
3. Correct the Travel Visa text so it states the card is over its limit on
   posted, and that the Aug. 9 $165.13 Amazon pending is not carried forward
   (data.json debts.travelvisa already says so).
4. Also correct ACCOUNT_FACTS.md:1805-1806 "It is 99.5% drawn with $1,067.84
   left" to the current HELOC headroom. The conclusion (consolidation is not
   available) is unchanged; only the figure is stale.
5. Do not change data.json. Do not change any rate, limit, due date or
   statement fact — those are correct.

Proof required:
- Add rows to the existing "one authority per contested fact" section of
  test-invariants.js. That section already reads docs/ACCOUNT_FACTS.md and
  asserts against live data for Amanda's pay cadence and BC Hydro; follow those
  precedents. The new assertions must fail if ACCOUNT_FACTS states an
  over-limit or available-credit condition for a card that Forecast.utilisation
  contradicts. This extends an existing control; do not add a new workflow,
  gate or governance document.
- Run: npm test

Non-goals: no data.json change, no new governance control, no rewrite of the
dated 9 August evidence, no touching Triangle or MBNA (already correct).

Merge card: primary risk auto-safe (no published data.json figure moves).
Decide the systems-review trigger honestly — this changes a trust claim about
an account state, which is on the trigger list.
```

## PR 3 — Re-derive the Triangle limit finding (B71)

```text
Read AGENTS.md and follow its read order.

Source: Repository Truth Audit finding F-04, owner-dispatched.

Run the Current-State Verification Gate. On current main, run
Forecast.projectDebts against the published data.json opening and record the
actual crossings result. Confirm it contains a triangle crossing dated
2026-08-19 at day 0, that Forecast.utilisation gives Triangle available $4.68
at 99.97% used, and that Forecast.planPhases emits a facilityCrossing risk
which public/plan.js:304 renders as "Triangle Mastercard goes over its limit
on 19 August 2026". Record verdict STALE-SUPERSEDED with that evidence.

ONE OUTCOME: BACKLOG.md B71 states the Triangle limit result that
Forecast.projectDebts actually returns on the published 2026-08-19 opening.

Do this:
1. Rewrite B71's "Deterministic Forecast result" paragraph with the current
   result. The existing text describes the superseded 2026-08-16 opening
   (posted $13,197.00 + pending $15.62, headroom $287.38, firstOver null, peak
   $13,388.86 on 2026-09-06, 91-day ending $13,178.74). Replace it, and keep
   the old figures only if they are explicitly labelled as the retired
   2026-08-16 opening — the entry already does this correctly for the 9 August
   opening, so follow that pattern.
2. B71's existing RISK paragraph ("~$8/day at this balance ... thin room before
   the September payment is real") turned out to be the accurate part. Promote
   it rather than deleting it.
3. Decide and state whether B71 remains RESOLVED on the new opening or reopens.
   That is a judgement about the finding, not about the engine — make it
   explicitly and give the reason.
4. Do not change public/forecast.js, data.json, or any published figure. The
   engine and the Plan page are already correct. Do not add a new test or gate
   that parses BACKLOG prose.

Proof required:
- Quote the actual Forecast.projectDebts crossings output and the
  Forecast.utilisation Triangle row in the merge card as the independent
  evidence for the rewritten paragraph.
- Run: npm test (expect no change; this is a record correction).

Non-goals: no engine change, no data.json change, no new governance control, no
change to the HELOC crossing which is separately correct at 2026-10-31.

Merge card: primary risk auto-safe. No published figure moves.
```

## PR 4 — One home for the coaching income-overstatement figure

```text
Read AGENTS.md and follow its read order.

Source: Repository Truth Audit finding F-03, owner-dispatched.

Run the Current-State Verification Gate. Confirm on current main that
data.json questions[0].changes says household income is "overstated by up to
$1,650/month" and data.json incomeWarning says "overstated by about
$650/month, not the $1,650 previously feared", and that public/deepdive.js
renders both (line 387 for q.changes, line 283 for incomeWarning) into
deepdive.html (#questions line 228, #income-warning line 118). Record the
verdict and evidence.

ONE OUTCOME: the Deep Dive publishes exactly one figure for how much household
income is overstated by the coaching gross-revenue line.

Do this:
1. The incomeWarning figure is the one derived from Amanda's tracking sheets
   (27.7% coach share, $23,070 revenue against $6,397.50 coach payroll). It
   wins. Make questions[0].changes stop stating a competing number — either
   restate the derived one or refer to the warning. Do not delete the
   uncertainty caveat that the sheets cover a subset of the window.
2. Check docs/ACCOUNT_FACTS.md:754-780, which carries the "up to ~$1,650"
   bound, and BACKLOG.md B15, which says "roughly $650/month". Bring the
   surviving wording into line so one fact keeps one home. If the $1,650 has
   value as a historical upper bound, keep it explicitly labelled as the
   superseded fear, which is what incomeWarning already does.
3. Do not change any income total, perMonth figure, or incomeCaptureMonths. Do
   not change Forecast.

Proof required:
- Add an assertion to test-dedup-facts.js (B93 owns "derive or delete proven
  duplicate live facts") that fails when two published data.json strings state
  different monthly overstatement figures for the coaching line. This extends
  an existing control.
- Run: npm test

Non-goals: no change to the coaching split itself, no new question, no
reopening of B15 or B63, no new governance control.

Merge card: primary risk — check the figures-review comment. If it lists a
moved figure, use figures-moved; if it lists none, auto-safe.
```

## PR 5 — Question status stays with the question authority

```text
Read AGENTS.md and follow its read order.

Source: Repository Truth Audit finding F-06, owner-dispatched.

Run the Current-State Verification Gate. Confirm on current main:
- docs/01_OPEN_QUESTIONS.md Q2 status is OPEN.
- docs/positions.csv:27 is the row `RESOLVED,,TFR-TO C-C destination,...` with
  confidence VERIFIED and the text "RESOLVED - the transfers went to the
  cards ... NO undisclosed card and no leakage".
- BACKLOG.md:1880 reads "B18 The $46,657 resolved - it paid the cards. Nothing
  was hiding".
- data.json questions Q2 says it is "evidence about destinations, not a closed
  household answer", and CONTEXT.md:165 lists it as outstanding.
- test-question-status.js reads only docs/01_OPEN_QUESTIONS.md,
  data.json.questions and public/deepdive.js.
Record the verdict and evidence.

ONE OUTCOME: no file outside docs/01_OPEN_QUESTIONS.md asserts that a question
the authority marks OPEN is resolved, and the existing B87 guard reads the
files that did.

Do this:
1. Reword docs/positions.csv:27 and BACKLOG.md:1880 so both present the
   card-payment matching as evidence about destinations, which it is, and stop
   asserting the question is closed. Keep the analysis — it is real and useful.
   Do not delete the row or the backlog line. Do not change Q2's status; only
   the household can answer Q2.
2. Extend test-question-status.js to also read docs/positions.csv and
   BACKLOG.md and fail when either asserts RESOLVED / ANSWERED / CLOSED for a
   question the canonical file has OPEN. Reuse the existing
   findQuestionStatusDefects machinery and the existing mutation-proof pattern
   in that suite; add a mutation case proving the new inputs actually fail.
   This widens an existing control's inputs. Do not add a workflow, a new test
   file, or a new governance document.

Proof required:
- The new assertions must fail on the pre-change text and pass after.
- The added mutation case must fail when reverted.
- Run: npm test

Non-goals: do not answer Q2, do not change its status, do not touch the home
midpoint rows in positions.csv (that is a separate owner-gated question), do
not create a new authority.

Merge card: primary risk auto-safe.
```

## PR 6 — Register records the absorbed interview commitments

**Gate:** use this prompt only if Owner decision A has actually been answered **YES**. If it has not, stop at `WAITING OWNER`; never treat the wording inside this preserved prompt as proof that the decision happened.

```text
Read AGENTS.md and follow its read order.

Source: Repository Truth Audit finding F-05, owner-dispatched. Owner has
confirmed that the 2026-08-16 absorption recorded in docs/01_OPEN_QUESTIONS.md
Q22 (B95 / PR #82) satisfied the joint household gate for the rows below.
Record that owner instruction in the merge card as the source.

Run the Current-State Verification Gate. Confirm on current main:
- docs/evidence_use/register.json has HH-021, HH-022, TRAVEL-002, COMMIT-002,
  COMMIT-003 and HH-014 as "disposition":"PROPOSED" with an owner_gate reading
  "Joint household decision required before promotion into data.json plan or
  Forecast inputs."
- data.json plan.commitments carries the same values: exterior-painting
  700-1200, downstairs-couch 1700, indio-tournament 5260-5460, warriors 800,
  fusion-season 2000, vehicle-maintenance 2400.
- Forecast.majorPlans encumbers 700 + 1700 + 5260 + 2000 + 2400 = $12,060 of
  protected principal on the published opening.
- test-evidence-use-register.js:388 asserts "no amount comparison is performed
  against data.json or Forecast".
Record the verdict and evidence.

ONE OUTCOME: no PROPOSED row in docs/evidence_use/register.json describes a
value that is already live in data.json and consumed by Forecast.

Do this:
1. Move those six rows to CONSUMED with routed_to pointers at their actual
   plan.commitments locations, following the shape the existing CONSUMED rows
   already use (path + json_pointer, e.g. COMMIT-001 -> /plan/commitments/2).
   Cite the 2026-08-16 owner absorption as the gate that was met.
2. Review every remaining PROPOSED row the same way before finishing. At
   minimum check HH-001 (restaurants $600 vs live 800), HH-011 (groceries 1800),
   HH-012 (fuel 1300), HH-004 (health 100 / personal 600), HH-017 (Christmas
   $5-6k vs live 3500) and BILL-SUB-001 (subscriptions $250 vs live 300).
   Where the live value came from the separate dated 10 August owner targets
   rather than the interview, PROPOSED is correct — say so in the row or in the
   merge card rather than changing it.
3. Add a check to test-evidence-use-register.js that fails when a PROPOSED
   row's evidence value is already live at a data.json location. Keep it
   deterministic and keep it narrow: it may compare a declared numeric value
   against a declared pointer; it must not attempt to judge financial
   correctness, which ARCHITECTURE.md explicitly says the register does not own.
   Line 388's current assertion is the thing being replaced — replace it
   honestly rather than leaving a contradictory claim in the file.
4. Do not change data.json. Do not change any commitment amount, date or
   flexibility. Do not create a new register schema or a new authority.

Proof required:
- The new check must fail on the pre-change register and pass after.
- Run: npm test

Non-goals: no change to Forecast, no change to plan.commitments, no new
authority, no re-litigating the amounts.

Merge card: primary risk auto-safe. Record the owner instruction that resolved
the gate question. This touches an owner-reserved boundary, so judge the
systems-review trigger honestly.
```

## PR 7 — Refresh the two derived figures inside Q3

```text
Read AGENTS.md and follow its read order.

Source: Repository Truth Audit finding F-07, owner-dispatched.

Run the Current-State Verification Gate. Confirm docs/01_OPEN_QUESTIONS.md
Q3 states "$747,612.74 of debt is secured against it" (line 45) and "the
-$717,407 figure is only the financial-account fragment" (lines 47-48), and
that on current main Forecast.compactSnapshot().secured is 745674.46 and
Forecast.publicationTotals().financialAccountsOnly is -730394.82. Note that
the second figure moved in PR #134 when the $47.21 Cash Back Dollars entered
published assets. Record the verdict and evidence.

ONE OUTCOME: Q3 states the financial-account net worth and secured-debt totals
that the published opening derives.

Do this:
1. Replace both figures with the derived current values, or date the existing
   ones as the 2026-08-09 review figures. Prefer deriving: both are
   Forecast.publicationTotals / compactSnapshot outputs, and Q3 is a live
   question the household reads.
2. Do not answer Q3, change its status, or state a home value. Q3 stays OPEN
   and net worth stays unstateable until the household supplies a valuation.

Proof required:
- Quote the two engine outputs in the merge card.
- Run: npm test

Non-goals: no home valuation, no net-worth point estimate, no status change,
no new test (this is a figure refresh in a question body).

Merge card: primary risk auto-safe.
```

## PR 8 — No committed record asserts a superseded current state

```text
Read AGENTS.md and follow its read order.

Source: Repository Truth Audit findings F-08, F-09 and F-11, owner-dispatched.
These are one outcome, not three: three instances of a committed record
asserting a superseded state as current, with one shared closure condition.

Run the Current-State Verification Gate and confirm each on current main:
- BACKLOG.md:1255-1257 "Current-state cutover - complete 2026-08-16. The
  published Forecast opening is 2026-08-16 ... Spendable cash is independently
  $2,252.76"; :1265 "Q19 stays OPEN"; :1273-1277 "The live opening is
  2026-08-16 ... weekly $920 ... Q19 stays OPEN and fail-closed"; :1285 "do not
  claim confident zero household cash impact" -- all inside the DONE B91 entry,
  which at :1151-1152 correctly says the opening is now 2026-08-19.
- docs/STORE_QUESTION_B79.md:62, :80 and :95 say T4 / B81 remains or stays
  closed; T4 passed 2026-08-17 and B81 is DONE 2026-08-20.
- docs/00_MASTER_PICTURE.md:34-38 says the document is "being rebuilt (B17)"
  and that "Section 0 below has been brought up to date"; B17 is in BACKLOG's
  Done list at :1879, and §0 states a Triangle minimum as unpaid, the Cash Back
  Visa as $612.43 over limit with a $29 fee accruing, an $814.18 HELOC minimum
  due 21 Aug, $2,845.89 of cash and Chequing B overdrawn -- all superseded.
Record the verdict and evidence.

ONE OUTCOME: no committed file asserts a superseded published opening, question
status or capability status as current.

Do this:
1. In BACKLOG.md B91, mark the 2026-08-16 cutover block and the outcome lines
   as the historical closure record they are. Do not delete them -- they are
   the proof B91 was completed. The entry already does this correctly at
   :1151-1152; make the rest consistent with it. Q19's answered state must not
   be contradicted anywhere in the entry.
2. In docs/STORE_QUESTION_B79.md, add a dated note that T4 passed 2026-08-17
   and B81 completed 2026-08-20, superseding the "stays closed" statements.
   The store verdict itself -- the file foundation has not demonstrably failed
   -- is correct and unchanged. Do not reopen the store gate.
3. In docs/00_MASTER_PICTURE.md, correct the banner. Either bring §0 to the
   2026-08-19 opening or stop claiming it is current; do not leave a banner
   asserting a currency the section does not have. Also stop attributing the
   rebuild to B17, which is closed. Sections 1 onward are already correctly
   covered by the superseded warning -- leave them.
4. Consider adding a staleness note beside 00_MASTER_PICTURE.md in CONTEXT.md's
   key-documents table, which currently calls it "The canonical written
   summary" with no caveat. Only if it fits inside this outcome.
5. Do not change data.json, Forecast, or any published figure. Do not add a
   governance control that parses prose.

Proof required:
- Grep evidence in the merge card that no remaining occurrence of "opening is
  2026-08-16", "Q19 stays OPEN", "B81 remains closed" or an equivalent reads as
  current state anywhere in the repository.
- Run: npm test

Non-goals: no deletion of historical record, no reopening of B91, B79 or the
store gate, no new test, no data.json change.

Merge card: primary risk auto-safe. State the shared closure condition and why
the three files are one outcome rather than three topics.
```

## PR 9 — Separate the two Amanda transfer streams

```text
Read AGENTS.md and follow its read order.

Source: Repository Truth Audit finding F-15, owner-dispatched.

Run the Current-State Verification Gate. Confirm on current main:
- data.json incomeNote says "the $21,700 she transferred across. That transfer
  has been removed as an income line: it is an internal movement out of this
  income ... and the transfers stopped after May 2026 while the income did
  not", and public/deepdive.js:282 renders it.
- docs/positions.csv:39 also attributes the $21,700 to "an internal movement
  out of the Tennis BC pay".
- data.json plan.income.amandaTransfer models expected $2,182/month with a
  recent 5-month mean of $2,400, and plan.opening records 14 August 2026
  crossings of $2,168 and $790 from TENNIS INCOME into BILLS ACCOUNT.
- docs/ACCOUNT_FACTS.md:464-473 records 127 transfers / $25,445 over 18 months,
  continuing.
- docs/01_OPEN_QUESTIONS.md Q5 (ANSWERED) attributes the STOPPED ~$1,000-1,100
  monthly transfer to garage/lab income, not to the Tennis BC pay.
Record the verdict and evidence.

ONE OUTCOME: no published surface says Amanda's transfers to the household
stopped while plan.income models them as continuing.

Do this:
1. Rewrite the incomeNote clause so the two streams are distinct: the
   garage/lab-funded monthly transfer that ended (Q5 ANSWERED), and the
   continuing TENNIS INCOME -> Chequing B transfers that plan.income.
   amandaTransfer models. Whichever the $21,700 belongs to, say which.
2. Fix the same mis-attribution in docs/positions.csv:39 if it is wrong there
   for the same reason.
3. Do not change plan.income.amandaTransfer amounts or scenarios. Do not
   change any income total. Do not reopen Q5.

Proof required:
- Add an assertion to test-invariants.js's "one authority per contested fact"
  section (which already handles Amanda's pay cadence) that fails when a
  published data.json string claims her household transfers stopped while
  plan.income carries a non-zero forward amandaTransfer. Extends an existing
  control.
- Run: npm test

Non-goals: no change to the modelled transfer amounts, no reopening of Q5 or
Q25, no new authority.

Merge card: primary risk -- check the figures comment; likely auto-safe.
```

## PR 10 — Date the deep-dive claims; correct B19's title

```text
Read AGENTS.md and follow its read order.

Source: Repository Truth Audit finding F-10, owner-dispatched.

Run the Current-State Verification Gate. Confirm on current main:
- docs/CREDIT_CARD_DEEP_DIVE.md has no as-at banner, and states at :71
  "$1,799.97 (today)" and at :87-88 "$1,067.84 left on the HELOC and $82.28 of
  overdraft headroom". Current: TD card $1,705.94; HELOC headroom $2,167.84;
  Chequing B is +$309.77 with the overdraft unused.
- docs/MORTGAGE_HELOC_DEEP_DIVE.md:3 does carry "Captured 2026-08-09", but
  :229-231 presents $1,067.84 + $82.28 as available liquidity and :328-329
  gives a "Now -> Aug 21: cover HELOC minimum ($814.18)" action that Q19 has
  since answered as $0 additional.
- BACKLOG.md:1747 is titled "B19 . Refresh the mortgage and HELOC deep dive .
  DONE 2026-08-17", but `git log -- docs/MORTGAGE_HELOC_DEEP_DIVE.md` shows one
  commit (8bdcdd5, the initial consolidation). B19's body correctly describes
  what it did fix: the Deep Dive page's helocHistory endpoint.
Record the verdict and evidence.

ONE OUTCOME: neither deep-dive document presents a superseded balance or
liquidity figure as current, and B19's record names what it actually closed.

Do this:
1. Give docs/CREDIT_CARD_DEEP_DIVE.md a dated as-at banner in the shape
   MORTGAGE_HELOC_DEEP_DIVE.md already uses, and date or correct the
   "(today)" and headroom figures.
2. In docs/MORTGAGE_HELOC_DEEP_DIVE.md, mark the "Now -> Aug 21" action block
   as superseded by Q19 ANSWERED 2026-08-18. Leave the dated statement analysis
   alone -- it is correctly captured history and is the evidence Q19 was
   answered from.
3. Correct B19's title so it names the helocHistory endpoint it closed rather
   than implying the document was refreshed.
4. Do not rewrite the historical statement tables or recompute the deep-dive
   analysis. Do not change data.json.

Proof required:
- Show the diff establishes a date on every remaining current-tense balance
  claim in both files.
- Run: npm test

Non-goals: no refresh of the deep-dive analysis itself (that would be its own
outcome), no data.json change, no new test.

Merge card: primary risk auto-safe.
```

## PR 11 — Align the merge-card verdict token

```text
Read AGENTS.md and follow its read order.

Source: Repository Truth Audit finding F-12, owner-dispatched.

Run the Current-State Verification Gate. Confirm CLAUDE.md:309 requires the
current-state verdict to be one of "... STALE / SUPERSEDED ...", while
.github/workflows/merge-card-check.yml:266 accepts only 'STALE-SUPERSEDED' and
.github/PULL_REQUEST_TEMPLATE.md:23 uses STALE-SUPERSEDED. Confirm that a card
written verbatim to CLAUDE.md therefore fails the "Merge card mechanical
fields" check, and that a failed merge-card check is a workflow_run trigger for
atlas-test-repair.yml. Record the verdict and evidence.

ONE OUTCOME: a merge card written verbatim from CLAUDE.md's stated vocabulary
passes the Merge card mechanical fields check.

Do this:
1. Change CLAUDE.md:309 to the token the check and the PR template already
   use. The check is the mechanical gate and the template is what builders
   copy; CLAUDE.md is the wording that drifted. Do not change the workflow or
   the template.
2. Check the rest of CLAUDE.md's closed vocabularies against
   merge-card-check.yml and atlas-primary-risk.js while you are there, and
   report in the merge card whether any other token disagrees. Only fix one if
   it is the same defect.

Proof required:
- test-mergecard.js is the suite that owns merge-card check behaviour. Add or
  extend an assertion that the verdict vocabulary in CLAUDE.md matches the
  CURRENT_STATE list the workflow enforces, so this cannot drift again. The
  review machinery is code and is tested like code.
- Run: npm test

Non-goals: no change to the workflow's accepted values, no new governance
control, no change to the review lanes.

Merge card: primary risk auto-safe. This changes a governance document but not
a product/trust hard gate.
```

## PR 12 — Close B72

```text
Read AGENTS.md and follow its read order.

Source: Repository Truth Audit finding F-13, owner-dispatched.

Run the Current-State Verification Gate. Confirm that BACKLOG.md:372 still
describes the test-mergecard.js HEAD fixture as "b85274ce..." with a comment
calling it "a real commit on this branch", that test-mergecard.js:17 is
`const HEAD = 'a'.repeat(40);`, and that the string b85274ce appears nowhere in
the repository except in that backlog entry. Verdict: ALREADY FIXED.

ONE OUTCOME: BACKLOG.md no longer carries an open item for a test fixture that
no longer exists.

Do this:
1. Close B72, recording that the fixture is now a synthetic 40-character value
   and that the defect it described is gone.
2. Change nothing in test-mergecard.js. It is already correct.

Proof required:
- The grep result showing b85274ce survives only in the entry being closed.
- Run: npm test

Non-goals: nothing else. Do not bundle other backlog corrections into this.

Merge card: primary risk auto-safe. Current-state verdict ALREADY FIXED.
```

## PR 13 — Record the 2026-08-21 live-acceptance result in CONTEXT

```text
Read AGENTS.md and follow its read order.

Source: Repository Truth Audit finding F-16, owner-dispatched.

Run the Current-State Verification Gate. Confirm that CONTEXT.md:131-176
"Current state as at 2026-08-19" makes no reference to any later observation,
while docs/connectivity/LIVE_ACCEPTANCE_2026-08-21_NO_AUTO_BORROW.md records
that on the real 2026-08-21 read-only overlay spendable cash was $747.81, the
opening gap was $104.89 on 2026-08-27, funding.borrowed was $0,
plannedDebt.permitted was false, and the household weekly answer was unfunded
with no feasible cap. Confirm that only BACKLOG.md:122-128 currently mentions
it. Record the verdict and evidence.

ONE OUTCOME: CONTEXT.md's current-state section names the newest committed
financial evidence and what it shows, without moving the published opening.

Do this:
1. Add a short dated paragraph to CONTEXT.md's current-state section recording
   the 2026-08-21 read-only live acceptance and its result, pointing at the
   proof file. State plainly that the published opening remains 2026-08-19,
   that production publishes the dated opening, and that a newer canonical
   opening is owner-reserved.
2. Do not change data.json. Do not change meta.asOf or plan.opening. Do not
   cut a new opening -- that is an owner-reserved decision this PR must not
   pre-empt. Do not present the 2026-08-21 figures as the published state.
3. Do not restate the build strategy's sequence or create a second current-
   state list.

Proof required:
- Quote the proof file's figures in the merge card.
- Run: npm test (expect no change).

Non-goals: no new opening, no data.json change, no snapshot write, no live
observation, no new authority.

Merge card: primary risk auto-safe. Note explicitly that the published opening
is unchanged.
```

## Items deliberately not given dedicated Opus prompts

- **F-14 midpoint net worth:** waits on Owner decision B. If the answer is range-only, current evidence said the change belongs in `scripts/positions-summary.js` plus regeneration, with `test-invariants.js --check` moving together; do not hand-edit derived SUMMARY rows.
- **F-16 newer canonical opening:** waits on Owner decision C and is separate from PR 13 above.
- **F-17 stale suite-count comments:** opportunistic only; clean them when those files are honestly touched.
- **F-18 outbound-e-transfer question:** low-value deferred cleanup; fold into a future Q1 refresh or assign one canonical question id without duplicating the question.
- **B68 BCAA/ICBC overlap and B60 Coinbase security:** owner actions, not audit-cleanup implementation prompts.
