# Atlas Repository Truth Audit — frozen advisory

**Historical evidence only.** This is the complete 2026-08-21 repository truth audit captured against the exact SHA below. It is not a current-state authority or a permanent sequencing document. Revalidate a finding against current `main` before acting. The temporary execution tracker is [`docs/AUDIT_CLEANUP_PLAN.md`](../AUDIT_CLEANUP_PLAN.md).

---

# ATLAS REPOSITORY TRUTH AUDIT

**Audited main:** `baff0376a1a2084417add564f60fba388a2cfb0f`
**Open PRs:** none
**Audit date:** 2026-08-21

Method note: every financial claim below was checked by running `public/forecast.js` against the committed `data.json` at this SHA, not by reading documentation. `npm test` passes (76/76 suites) at this head.

---

## 1. EXECUTIVE VERDICT

**The runtime is in better shape than the documentation around it.** The engine, the reconciliation chain, the snapshots and the 2026-08-19 cutover are coherent and internally consistent — I could not find a case where `Forecast` computes the wrong answer from `data.json`, and I could not find page-side financial logic that has crept back after the B73 cleanup. The defects I did find are almost all *staleness of record*: places where the repository knows the truth in one file and still asserts the old one in another. Two exceptions are live product defects on household-facing surfaces.

**Counts: P0 = 0 · P1 = 5 · P2 = 11 · P3 = 2.**

The five things that matter most:

1. **The Records page publishes two known commitments as `$0.00` and eleven as "Invalid Date".** `public/records.js` renders `plan.commitments` directly with `money2(c.amount)`; for the two range-only rows (`exterior-painting` $700–$1,200 and `indio-tournament` $5,260–$5,460) `amount` is `null`, and `money2(null)` returns `$0.00`. The Deep Dive renders the same rows correctly through `Forecast.publicationTotals`. This is unknown published as zero, on a surface a household reads, and no test covers it.

2. **`docs/ACCOUNT_FACTS.md` — the file every agent and the owner is told to read first — was reconciled to the 2026-08-19 opening for Triangle and MBNA but not for the TD Cash Back Visa or the Travel Visa.** It still says the Cash Back Visa is $612.43 over its limit with a $29.00/month over-limit fee accruing and $762.36 due 1 September. All three are false: it is at $4,799.43 against a $5,000 limit with $200.57 available, and the $763 payment on 14 August retired that minimum. In the same file the Travel Visa is described as *approaching* its limit when it is in fact $105.33 over — the one facility the Plan page currently names as over-limit.

3. **`BACKLOG.md` B71 is marked `DONE / RESOLVED` on a claim the current plan contradicts.** It states, as a "Deterministic Forecast result (current plan)", that Triangle "remains under" the $13,500 limit with `firstOver` null. On the published 2026-08-19 opening Triangle is at $13,495.32 — $4.68 of headroom, 99.97% utilised — and `Forecast.projectDebts` returns a Triangle limit crossing on day 0. The Plan page correctly publishes that crossing as a risk; the backlog says the risk was retired.

4. **The Evidence-Use Register still marks as `PROPOSED` — "owner gate required before promotion into data.json plan or Forecast inputs" — six interview items whose exact values are already live on `plan.commitments` and encumbered by `Forecast.recommend` today.** `exterior-painting` $700–$1,200 (HH-021), `downstairs-couch` $1,700 (HH-022), `indio-tournament` $5,260–$5,460 (TRAVEL-002), plus COMMIT-002, COMMIT-003 and HH-014. That is $12,060 of protected principal constraining the current $180/week cap. The register is ARCHITECTURE's named sole authority for routed-vs-parked, and its own test asserts at line 388 that it performs "no amount comparison against data.json or Forecast" — so this can drift silently and did.

5. **The Deep Dive publishes two different answers to "by how much is household income overstated?" on the same page.** The question card says "up to $1,650/month"; the income warning three sections above says "about $650/month, not the $1,650 previously feared". `CLAUDE.md` calls a contradiction between two published figures a stop.

What I looked hard for and did **not** find: page-side financial arithmetic that should be in Forecast; a secret or raw-data leak; a broken `CONSUMED` routing target in the register (all 25 resolve); an unreachable required check; a snapshot that disagrees with `data.json`; or any case where the engine treats available credit as cash. The `plan.actions` / `resolveActions` split, the `helocSummary` $7,536.96 figure, and the `periods.json` 2026-08-09 asOf all reconcile correctly once you check them.

---

## 2. FINDINGS TABLE

### P1

**F-01 — Records page publishes range commitments as $0.00 and undated ones as "Invalid Date"**

| | |
|---|---|
| **Severity / Category** | P1 · Publication consistency + trust (unknown as zero) |
| **Claim** | The Records page understates two known commitments to zero and prints an invalid date on eleven rows. |
| **Current evidence** | `public/records.js:51-55` renders `plan.commitments` directly: `` li(`${c.label} — ${fmtDate(c.date)}`, money2(c.amount), …) ``. `money2(null)` → `$0.00`; `fmtDate(undefined)` → `Invalid Date`. Executed against current `data.json`: `Exterior painting — Invalid Date $0.00`, `Indio tournament — Invalid Date $0.00`, plus 9 more `Invalid Date` rows. |
| **Conflicting evidence** | `public/deepdive.js:192-194` renders the same rows through `Forecast.publicationTotals().commitmentItems` with `shownAmount()`, correctly printing `$5,260–$5,460` and `Jan 2027`. `Forecast.majorPlans` encumbers $5,260 and $700 against today's cap. |
| **Authoritative home** | `Forecast.publicationTotals` (ARCHITECTURE.md:547) — Records already imports it for the balance sheet but not for commitments. |
| **Household consequence** | A household member reading the Records derivation list sees $0.00 for a $5,260–$5,460 January tournament and a $700–$1,200 painting job. Two surfaces disagree by $5,960–$6,660. |
| **Disposition** | FIX NOW. Route the Records commitments block through `commitmentItems`; add a test that fails when a range or undated row renders as `$0.00` / `Invalid Date`. |
| **Owner decision?** | NO |
| **PR outcome** | *Make Records publish range and undated commitments through the same engine view the Deep Dive uses.* |

**F-02 — ACCOUNT_FACTS card sections not reconciled to the 2026-08-19 opening**

| | |
|---|---|
| **Severity / Category** | P1 · Cross-repository conflict + stale-as-current |
| **Claim** | The standing-facts authority publishes a false over-limit state, a retired recurring minimum, and misses a real over-limit condition. |
| **Current evidence** | `docs/ACCOUNT_FACTS.md:530-556` — Cash Back "Balance $5,682.43 — **$682.43 OVER the limit**", "Available credit **$0.00**", "Still over the limit by ~$612.43", "$29.00/month, still accruing", "Next minimum **$762.36, due 1 Sep 2026** — unaffected". `:33` payment calendar — "1st | TD Cash Back Visa minimum | $762.36". `:636-660` Travel Visa "Balance $1,078.31 · pending $165.13", "**The $165.13 of pending charges will take it over**". |
| **Conflicting evidence** | `Forecast.utilisation` on current `data.json`: cashback posted $4,799.43, limit $5,000, **available $200.57, not over**; travelvisa posted $1,205.33, pending $0, **over by $105.33**. `plan.obligations.cashback` — the $763 payment on 14 Aug "satisfies the previous over-limit September spike of $762.36 … the once row was removed"; next minimum ~$170 `firstDue 2026-10-01`. `debts.travelvisa` — "The Aug. 9 $165.13 Amazon pending is not carried forward." |
| **Authoritative home** | `data.json` `debts` + `Forecast.utilisation` for current state; `ACCOUNT_FACTS.md` for standing terms only — the file's own line 7 says "Balances … are deliberately not repeated here." |
| **Household consequence** | The owner reads that the Cash Back Visa is $612 over its limit with a fee accruing and owes $762.36 on 1 September, and could pay against a condition that no longer exists or reserve $592/month more than the plan requires. Simultaneously they read that the Travel Visa has *not yet* gone over, when it is the one card that has. |
| **Disposition** | FIX NOW. Give the Cash Back and Travel Visa sections the same 2026-08-19 canonical-opening block Triangle (`:349-356`) and MBNA (`:1856-1861`) already carry, and remove the retired $762.36 payment-calendar row. |
| **Owner decision?** | NO |
| **PR outcome** | *Reconcile the two remaining ACCOUNT_FACTS card sections to the 2026-08-19 opening, with an invariant that fails when a card section states a limit condition the engine contradicts.* |

**F-03 — Two published figures for the income overstatement, on one page**

| | |
|---|---|
| **Severity / Category** | P1 · Household-facing contradiction |
| **Claim** | The Deep Dive tells the household its income is overstated by two different amounts. |
| **Current evidence** | `data.json` `questions[0].changes`: "Household income is currently overstated by up to $1,650/month." Rendered by `public/deepdive.js:387`. `data.json` `incomeWarning`: "So this total is overstated by about $650/month, **not the $1,650 previously feared**." Rendered by `deepdive.js:283`. Both mount on `deepdive.html` (`#questions` line 228, `#income-warning` line 118). |
| **Conflicting evidence** | `docs/ACCOUNT_FACTS.md:754-780` carries the "up to ~$1,650" bound; `:1741-1747` carries the ~$1,700-retained figure that implies ~$650. The `incomeWarning` text explicitly retires the $1,650. |
| **Authoritative home** | `data.json` `incomeWarning` — it is the one derived from the coaching workbooks (27.7% coach share). |
| **Household consequence** | A $1,000/month difference in how far to discount published income, published side by side. |
| **Disposition** | FIX NOW. Make the question card state the bound the warning derives, or point at it. |
| **Owner decision?** | NO |
| **PR outcome** | *Make the coaching-overstatement figure have one home and prove the two Deep Dive surfaces cannot state different amounts.* |

**F-04 — B71's "RESOLVED" Triangle conclusion is false on the current opening**

| | |
|---|---|
| **Severity / Category** | P1 · Stale conclusion / DONE item whose closure no longer holds |
| **Claim** | The backlog says the Triangle limit risk is retired; the live plan says the card crosses its limit today. |
| **Current evidence** | `BACKLOG.md:130-154` — "**DONE / RESOLVED 2026-08-18**"; "Canonical B91 2026-08-16 opening in `data.json`: posted **$13,197.00** + pending **$15.62** … Headroom **$287.38**"; "**Deterministic Forecast result (current plan; no invented purchases).** On both the 91-day view and the 365-day knowledge horizon, Triangle **remains under** the $13,500 limit. `projectDebts` reports `firstOver` null. Peak modelled exposure is **$13,388.86 on 2026-09-06**". |
| **Conflicting evidence** | The canonical opening is 2026-08-19, not 2026-08-16. `Forecast.utilisation`: Triangle posted $13,495.32, available **$4.68**, 99.97% used. `Forecast.projectDebts().crossings` includes `{id:'triangle', date:'2026-08-19', day:0, alreadyOver:false}`. `Forecast.planPhases().risks` includes `facilityCrossing` → the Plan page prints "Triangle Mastercard goes over its limit on 19 August 2026". |
| **Authoritative home** | `Forecast.projectDebts` (ARCHITECTURE.md:568). |
| **Household consequence** | The backlog's own 🔴 "the two that undercut everything else" section tells a reader the interest-eats-the-headroom risk is retired, while the site publishes an over-limit-fee risk starting today. B71's own RISK paragraph ("~$8/day … thin room before the September payment is real") turned out to be the accurate part. |
| **Disposition** | FIX NOW — re-derive B71 on the 2026-08-19 opening, or reopen it. |
| **Owner decision?** | NO |
| **PR outcome** | *Re-derive the Triangle limit finding on the published 2026-08-19 opening and record the day-0 crossing the engine now reports.* |

**F-05 — Evidence-Use Register marks live Forecast inputs as PROPOSED behind an owner gate**

| | |
|---|---|
| **Severity / Category** | P1 · Conflicting authority + owner-reserved boundary |
| **Claim** | The register says six interview items are parked pending an owner gate; the same values are live in `data.json` and encumbered by Forecast. |
| **Current evidence** | `docs/evidence_use/register.json` — HH-021, HH-022, TRAVEL-002, COMMIT-002, COMMIT-003, HH-014 all `"disposition":"PROPOSED"` with `"owner_gate":"Joint household decision required before promotion into data.json plan or Forecast inputs. Attributed speech is not automatically joint policy."` Sources: `AMANDA_2026-08-10_PARTIAL.md` / `AMANDA_2026-08-12_CONTINUATION.md`. |
| **Conflicting evidence** | `plan.commitments` carries exactly those values: `exterior-painting` 700–1200, `downstairs-couch` 1700, `indio-tournament` 5260–5460, `warriors` 800, `fusion-season` 2000, `vehicle-maintenance` 2400. `Forecast.majorPlans` on current data encumbers 700 + 1700 + 5260 + 2000 + 2400 = **$12,060** of protected principal against the $180/week cap. `01_OPEN_QUESTIONS.md` Q22 records the 2026-08-16 absorption by B95 and names those row ids. |
| **Why the guard missed it** | `test-evidence-use-register.js:388` — `ok(true, 'no amount comparison is performed against data.json or Forecast')`. The register's routing state is unverifiable against reality by design. |
| **Authoritative home** | `docs/evidence_use/register.json` (ARCHITECTURE.md:499) for routed-vs-parked; `data.json` `plan.commitments` for the value. |
| **Household consequence** | Either the register is stale (most likely — Q22 records the 2026-08-16 absorption) or attributed interview speech became a Forecast input without the joint owner decision ARCHITECTURE reserves. An agent consulting the register would conclude none of Amanda's estimates are in the plan. |
| **Disposition** | OWNER DECISION on which reading is true, then correct the register. |
| **Owner decision?** | **YES** — confirm the 2026-08-16 absorption satisfied the joint gate for these six ids. |
| **PR outcome** | *Move the absorbed interview items to CONSUMED with their `plan.commitments` pointers, and add a check that a PROPOSED row's evidence value is not already live in `data.json`.* |

### P2

| ID | Category | Claim | Current evidence | Conflicting / missing | Authoritative home | Consequence | Disposition | Owner? |
|---|---|---|---|---|---|---|---|---|
| **F-06** | Question status authority | Q2 is asserted RESOLVED/VERIFIED outside the status authority | `docs/positions.csv:30` entity `RESOLVED`, confidence `VERIFIED` — "the transfers went to the cards … **NO undisclosed card and no leakage**"; `BACKLOG.md:1880` "**B18** The **$46,657** resolved" | `01_OPEN_QUESTIONS.md:31-41` Q2 **OPEN**; `CONTEXT.md:165` lists it as outstanding; `data.json` Q2 card — "evidence about destinations, not a closed household answer". `test-question-status.js` reads only `data.json.questions` + `deepdive.js`, so neither file is guarded | `docs/01_OPEN_QUESTIONS.md` | A reader of the data spine concludes a Tier-1 question is closed; B87's one-authority rule is bypassed in two files the guard cannot see | Correct positions.csv and B18 wording; extend the B87 guard to positions.csv and BACKLOG | NO |
| **F-07** | Stale figures in an open question | Q3 states two superseded numbers as current | `01_OPEN_QUESTIONS.md:45` "**$747,612.74** of debt is secured against it"; `:47-48` "the **−$717,407** figure is only the financial-account fragment" | Current: `compactSnapshot.secured` = **$745,674.46**; `publicationTotals.financialAccountsOnly` = **−$730,442.03**. Both figures trace to the 2026-08-09 review | `data.json` + `Forecast.publicationTotals` | The household agenda quotes a net-worth fragment $13,035 off and a secured total $1,938 off, undated | Re-derive or date the two figures | NO |
| **F-08** | Stale conclusion inside a DONE record | B91's body still publishes the superseded 2026-08-16 opening as current state | `BACKLOG.md:1255-1257` "**Current-state cutover — complete 2026-08-16.** The published Forecast opening is 2026-08-16 … Spendable cash is independently $2,252.76"; `:1265` "Q19 stays OPEN"; `:1273-1277` "The live opening is 2026-08-16 … weekly $920 … Q19 stays OPEN and fail-closed"; `:1285` "do not claim confident zero household cash impact" | Same entry `:1151-1152` "The live published opening is now **2026-08-19**". Current: opening 2026-08-19, spendable $939.62, weekly $180, Q19 **ANSWERED 2026-08-18** ($0 additional) | `data.json` + `01_OPEN_QUESTIONS.md` | B91 contradicts itself; the "$814.18 is unresolved, do not claim zero" guidance is the opposite of the answered Q19 an agent must follow | Mark the 2026-08-16 block as historical record | NO |
| **F-09** | Stale conclusion presented as current | `00_MASTER_PICTURE.md` claims its "read first" section is up to date when it is not | `:34-38` "This document is being rebuilt (**B17**) … **Section 0 below has been brought up to date** because it is the actionable part"; `:41-94` §0 is the 2026-08-09 picture — Triangle minimum unpaid, "$5,612.43, still $612.43 over the $5,000 limit, with the $29.00 over-limit fee accruing", "$814.18 HELOC minimum 21 Aug", "$2,845.89 of cash", "Chequing B remains overdrawn"; `:504` action 2 "$1,067.84 of room left" | Q4b ANSWERED ($300 posted 2026-08-10); Q19 ANSWERED ($0 additional); Q26 ANSWERED; Cash Back under limit; Chequing B +$309.77; HELOC room $2,167.84. **B17 is in BACKLOG's Done list** (`:1879`), so the rebuild is attributed to a closed item. `CONTEXT.md:123` lists this file as "The canonical written summary" with no staleness note | `data.json` + `01_OPEN_QUESTIONS.md` | The document a new reader is pointed at gives six superseded time-sensitive actions under a banner asserting that section is current | Correct the banner (or §0), and note the staleness in CONTEXT's key-documents table | NO |
| **F-10** | Stale conclusion / DONE closure | B19's title claims the mortgage-HELOC deep dive was refreshed; the document was never touched | `BACKLOG.md:1747` "**B19 · Refresh the mortgage and HELOC deep dive** · **DONE 2026-08-17**". `git log -- docs/MORTGAGE_HELOC_DEEP_DIVE.md` → one commit, `8bdcdd5` (initial consolidation). B19's body says what it actually fixed: the Deep Dive page's `helocHistory` endpoint | The document still states HELOC $201,586.16 / available $1,067.84 (`:115-116`, `:229-231`) and "**Now → Aug 21:** cover HELOC minimum ($814.18)" (`:328-329`). `docs/CREDIT_CARD_DEEP_DIVE.md:71,87-88` states "$1,799.97 (today)" and "$1,067.84 left on the HELOC and $82.28 of overdraft headroom" with **no as-at banner at all** | `data.json` for balances | Two files CONTEXT names as key documents present superseded liquidity and a superseded "now" action; the mortgage one is at least dated, the credit-card one is not | Date the credit-card deep dive's current-state block; correct B19's title to what it closed | NO |
| **F-11** | Superseded capability status | `STORE_QUESTION_B79.md` says B81/T4 is still closed | `:62` "T4 / `B81` **remains closed**"; `:80` "Do **not** treat T4 / `B81` as opened"; `:95` "stays closed" | T4 passed 2026-08-17 (`docs/connectivity/T4_OWNER_PASS_2026-08-17.md`); B81 DONE 2026-08-20; the earned preview/approve writer and the 2026-08-19 opening exist | `ARCHITECTURE.md` capability gates | A reader of the store-question record concludes the canonical-refresh writer does not exist. The store verdict itself ("the file foundation has not demonstrably failed") is unaffected and remains correct | Add a dated "superseded by T4 2026-08-17 / B81" note | NO |
| **F-12** | Dead/incorrect governance | The canonical brief's merge-card vocabulary does not match the check that enforces it | `CLAUDE.md:309` — verdict must be one of `… STALE / SUPERSEDED …`. `.github/workflows/merge-card-check.yml:266` accepts `'STALE-SUPERSEDED'`. `.github/PULL_REQUEST_TEMPLATE.md:23` uses `STALE-SUPERSEDED` | A merge card written verbatim to `CLAUDE.md` fails `Merge card mechanical fields`, which is a `workflow_run` trigger for `atlas-test-repair.yml` | `merge-card-check.yml` owns the closed token set; `CLAUDE.md` owns the rule | A compliant card fails CI and starts an automatic repair round | Align the wording in `CLAUDE.md` (one token, one spelling) | NO |
| **F-13** | Fixed but never marked fixed | B72 describes a fixture that no longer exists | `BACKLOG.md:365` "The `HEAD` fixture is `b85274ce…`, with a comment calling it 'a real commit on this branch'" | `test-mergecard.js:17` — `const HEAD = 'a'.repeat(40);`. The string `b85274ce` appears nowhere in the repository except in the backlog entry describing it | `test-mergecard.js` | An open housekeeping item that is already done | ALREADY FIXED — close B72 | NO |
| **F-14** | Trust / range collapsed to a point | `positions.csv` publishes a single-point net worth from an invented home-value midpoint | `docs/positions.csv:28` Home `1250000.00` — "1250000 is the midpoint and is **NOT** an appraisal"; `:36` Household net worth **$519,557.97**; `:37` Home equity $504,325.54; `:38` LTV 59.7%. Generated by `scripts/positions-summary.js:129-137` | `data.json` `netWorth.caveat` declines to state a point ("At the owner's estimate of $1.1m-$1.4m …"); `ACCOUNT_FACTS.md:1815-1822` gives the endpoints ($357k / $657k; LTV 68.0% / 53.4%); `01_OPEN_QUESTIONS.md` Q3 says net worth "is currently unstateable"; B51 says "net worth swings 84%". Every `plan.commitments` range carries "no midpoint is invented" | `data.json` / `ACCOUNT_FACTS.md` | The data spine states a household net worth the question authority says cannot be stated. It is labelled ESTIMATE, so this is an authority tension rather than a lie | Either publish the range in positions.csv or record why the midpoint is permitted there | **YES** (whether a midpoint may be published at all) |
| **F-15** | Cross-surface conflict on a material income stream | The Deep Dive says Amanda's transfers stopped; the Plan models $2,182/month of them | `data.json` `incomeNote` (rendered `deepdive.js:282`): "the $21,700 she transferred across. That transfer has been removed as an income line: it is an internal movement out of this income … and **the transfers stopped after May 2026 while the income did not**". `positions.csv:39` repeats the attribution to "the Tennis BC pay" | `plan.income.amandaTransfer` — expected **$2,182/month**, "recent 5-month mean $2,400", and the 2026-08-19 opening records 14 August crossings of **$2,168 and $790** into BILLS ACCOUNT. `ACCOUNT_FACTS.md:464-473` — 127 transfers / $25,445 over 18 months, continuing. Q5 (ANSWERED) attributes the *stopped* ~$1,050/month transfer to **garage/lab income**, not Tennis BC pay | `plan.income` for the forward figure; Q5 for the stopped stream | Either the sentence mis-attributes the stopped garage transfer to the Tennis BC pay (contradicting Q5), or it claims the Tennis transfers stopped (contradicting the plan and the opening). One of the two is wrong either way. `Forecast.incomeDeadline` shows the window ends $4,364 lower without them | Separate the two streams in one sentence | NO |
| **F-16** | Financially material, absent from the operating picture | CONTEXT's current-state section omits the newest financial evidence the repository holds | `CONTEXT.md:131-176` "Current state as at 2026-08-19" — spendable $939.62, no mention of any later observation | `docs/connectivity/LIVE_ACCEPTANCE_2026-08-21_NO_AUTO_BORROW.md:73,91-113` — on the real 2026-08-21 overlay, spendable **$747.81**, opening gap **$104.89** on 2026-08-27, household answer **unfunded**, no feasible weekly cap. Only `BACKLOG.md:122-128` records it | `CONTEXT.md` for orientation; the published opening correctly remains 2026-08-19 | Production correctly publishes the dated opening and a newer substitute opening is owner-reserved — so this is not a wrong published figure. But the orientation document a fresh session starts from does not mention that the newest committed evidence flips feasibility | Add one dated line; do **not** move the opening | **YES** (whether to cut a newer opening at all) |

### P3 (kept sparse)

| ID | Category | Claim | Evidence | Disposition |
|---|---|---|---|---|
| **F-17** | Comments that no longer describe behaviour | Four files assert historical suite counts as if current | `test-nextmove.js:11` "ALL 15 SUITES PASSED"; `test-food-fuel.js:10` "ALL 20"; `test-deepdive.js:9` "ALL 22"; `public/forecast.js:3321,3738` "ALL 22"/"ALL 21". `test.js` registers 76 | Fold into the next PR that honestly touches each file. Not its own PR |
| **F-18** | Question with no home in the authority | The Deep Dive publishes an unnumbered question | `data.json` `questions[3]` — "Where does the rest of the $19,700 of e-transfers go?" — has no `id` and no entry in `01_OPEN_QUESTIONS.md`. It is Q1's outbound-transfer sub-part after $3,500 was traced to Wise; Q1 still says "$23,200 of outbound e-transfers" | Either give it a Q number or fold it into Q1 |

---

## 3. BACKLOG RECONCILIATION

Every non-DONE entry, classified.

| ID | Heading | Classification | Note |
|---|---|---|---|
| *(no id)* | Unresolved once cash obligations across a later Forecast start — owner instruction 2026-08-18 | **ALREADY FIXED** | Implemented and live: the four `*-aug15-outstanding` once rows dated 2026-08-16 still deduct at the 2026-08-19 opening; ARCHITECTURE.md:535 encodes the rule; `test-cutover-unresolved.js` proves it |
| *(no id)* | Historical Telus — CLOSED 2026-08-18 | **ALREADY FIXED** | Telecom is Shaw $78.40 dated + $121.00 Bell `currentMonthly`; verified in `budgetBreakdown` |
| B63 | Where do the coach payments leave from? | **OWNER-BLOCKED** | Genuinely needs Amanda / B64 |
| B64 | Amanda's other account | **OWNER-BLOCKED** | Needs the household or a credit report |
| B70 *(second use of the number)* | Agree a standing transfer from Amanda's account | **GENUINELY READY** but **NEEDS REFRAMING** | It is `plan.actions[0]` and `Forecast.nextMove` currently selects it as the next move. The ID collides with the DONE B70 HELOC item at `:85` — two different items share one number |
| B13 | Business records — revenue and cost of goods | OWNER-BLOCKED | Depends on B56 |
| B56 | Separate the two businesses | OWNER-BLOCKED | |
| B57 | The garage rent — is it coming back? | **PARTIALLY FIXED** | The income question is Q5 ANSWERED; what remains is the insurance / capital-gains accountant question. Worth reframing to just that |
| B58 | The five cheques — $8,150 | STILL VALID BUT LOW VALUE | "LARGELY ANSWERED"; residual is TD cheque images plus a $24/year CHQ RETURN FEE cleanup |
| B59 | Coinbase | OWNER-BLOCKED | One balance look closes it; `coverage` publishes it as `missing` |
| B60 | Phishing against the Coinbase account | **OWNER-BLOCKED — security** | Owner action; oldest untouched security item in the file |
| B27 | RESP holdings | OWNER-BLOCKED | Duplicates Q11 (BLOCKED on an exchange agreement) — see §4 |
| B51 | Narrow the home valuation | OWNER-BLOCKED | Duplicates Q3; also the root of F-14 |
| B43 | PayPal #2 — confirm account type | STILL VALID BUT LOW VALUE | |
| B14 | Decide whether the business and her employment stay in scope | **NEEDS REFRAMING** | Heading only, no body. Amanda's employment is already in scope (`amandaTransfer`, TENNIS INCOME); the business is not. The decision has effectively been made in the plan without closing the item |
| B66 | Stop deleting the Interac notifications | GENUINELY READY (owner action) | Prerequisite for B63 |
| B68 | Two auto-insurance policies at once | GENUINELY READY (owner action) | Both are correctly forecast ($182.87/month); this is the only backlog item with a proven, immediately available **$1,199/year** saving |
| B69 | Home insurance — $3,131.76/yr, unknown account | GENUINELY READY | `plan.commitments.home-insurance` names B69 as the open paying-account question |
| B67 | The $1,806.00 Fusion invoice | GENUINELY READY | |
| B28 | Rewards balances as minor assets | STILL VALID BUT LOW VALUE | Deliberately unvalued; correct — no valuation authority exists |
| B72 | `test-mergecard.js` names a commit no branch holds | **ALREADY FIXED** | F-13 |
| B76 | The scope tripwire counts implementation only | STILL VALID — needs a decision | Correctly framed as needing the governance-control lifecycle, not a fix |
| Issue #57 | Autonomous delivery loop remainder | STILL VALID | Blocked on the owner enforcing required checks on `main` — a repository-setting action, not code |
| B26 | Personal Visa, Aug 2025 statement | STILL VALID BUT LOW VALUE | Institution session |
| B22 | Savings interest rates | STILL VALID BUT LOW VALUE | Savings is $0.58 |
| B23 | Chequing B overdraft rate | **PARTIALLY SUPERSEDED** | "Drawn every month" is no longer true — Chequing B is +$309.77 and the overdraft is unused on this opening |
| B24 | Account plans and fee structures | GENUINELY READY | $35.90/month is dated on `plan.bills.tdfees`; the waiver question is real |
| B25 | Mortgage prepayment penalty formula | STILL VALID | Renewal-relevant |
| *(no id)* | Tier 3 — chequing/savings statements, 12 months | **STALE / SUPERSEDED** | The 2026-08-17 owner decision made Lunch Money the normal feed; the build strategy says explicitly "do not wait for a second month of routine statement files" |
| B8, B39, B9/B42, B38, B44 | PayPal gaps, subscriptions, settlements, PDF archive | STILL VALID BUT LOW VALUE | PayPal is ~$463/month inside the budget |
| B49 | Wise statements | STILL VALID BUT LOW VALUE | Wise is $205.92 |
| B15 | Rebuild the income picture | **STILL VALID — but its figure conflicts** | Says income overstated "roughly $650/month"; the Deep Dive question card still says $1,650 (F-03) |
| B16 | Finish the spending picture | STILL VALID | |
| B40 | Fold Instacart and delivery in | STILL VALID BUT LOW VALUE | |

**DONE items whose claimed closure no longer holds:**

- **B71** — F-04. The resolution was computed on a superseded opening and is now false.
- **B19** — F-10. Title claims the deep-dive document was refreshed; only the page's `helocHistory` was.
- **B91** — F-08. Closed correctly, but its body still asserts the 2026-08-16 opening and an OPEN Q19 as current.
- **B70 (HELOC)** — closure holds, but the entry frames its figures as "the 2026-08-16 opening"; the same numbers are now the 2026-08-19 opening. Cosmetic.

**Work recent PRs completed without a backlog update:** B72 (F-13). I found no other silently completed item.

---

## 4. OPEN QUESTION RECONCILIATION

| Q | Status in file | Classification |
|---|---|---|
| Q1 | OPEN | **Genuinely requires household input.** Needs the books. Correctly open |
| Q2 | OPEN | **Correctly open — but two other files contradict it** (F-06). The status authority is right; positions.csv and B18 are wrong |
| Q3 | OPEN | **Genuinely requires household input**, but its two stated figures are stale (F-07), and F-14 turns on it |
| Q6 | OPEN | Genuinely requires household input |
| Q7 | OPEN | Genuinely requires household input (a call to TD) |
| Q8 | OPEN | Genuinely requires household input |
| Q10 | OPEN | Genuinely requires household input. Low value — all four accounts are $0.00 |
| Q11 | BLOCKED | Correctly blocked — an exchange-agreement acceptance is the account holder's decision. **Duplicates B27**; one of the two should route to the other |
| Q12 | OPEN | Genuinely requires household input; folds into Q1 |
| Q14 | LOW PRIORITY | **Status token is outside the file's own declared set** (`OPEN · ASKED · ANSWERED · BLOCKED`, line 7). `test-question-status.js` parses it as `null` rather than failing. Cosmetic, but it is the status authority using an unlisted token |
| Q15 | OPEN | Genuinely requires household input |
| Q16 | OPEN | **Arguably an owner action, not a knowledge question.** Its own text says "An owner action only. Atlas must not attempt it." By `BACKLOG.md`'s opening rule ("if it needs someone to *do* something, it belongs here") this is a backlog item |
| Q18 | OPEN | **Correctly open, and correctly narrowed.** Only the pending $250 Bell settlement state remains; cost is closed at $121.00/month, which `budgetBreakdown` reserves. Well handled |
| Q20 | OPEN | Genuinely requires household input. Load-bearing: `plan.nextDollar` remains `provenance: derived` because of it |
| Q21 | OPEN | Genuinely requires household input. Historical classification only |
| Q22 | OPEN | **Correctly open and correctly narrowed** to three items (undated due dates, an Indio point amount, Provincials timing). This is the model the other questions should follow |
| Q25 | OPEN | Genuinely requires household input. Correctly fail-closed — TENNIS INCOME is excluded from spendable cash and the `amanda` funding option's available is 0 while Q25 is open |

No open question is answered by repository evidence today. Q16 is misfiled as a question; Q11/B27 are a duplicate pair; Q14 uses an off-vocabulary status.

---

## 5. ORPHANED / UNCONSUMED FACTS

Material only. Most of what I checked turned out to be consumed or deliberately parked with a reason.

| Fact | State | Assessment |
|---|---|---|
| Interview estimates HH-021 / HH-022 / TRAVEL-002 / COMMIT-002 / COMMIT-003 / HH-014 | **Consumed by Forecast, recorded as PROPOSED** | F-05. The reverse of orphaned: routed but recorded as parked |
| BCAA + ICBC running in parallel — $182.87/month, extra **$1,199/year** | Consumed (both dated on `plan.bills`, fail-closed) but **no owner deadline** | Correctly forecast. The saving is real, provable and the largest immediately available; it sits as B68 with no date |
| Square One home insurance $3,131.76/yr, **paying account unknown** | On `plan.commitments`; paying account still unattributed (B69) | Correctly encumbered, honestly flagged. Not orphaned |
| TD Rewards 57,968 points + Cash Back Dollars $47.21 | Captured, excluded from net worth (B28) | **Correctly parked.** No valuation authority exists; do not create one |
| Coinbase — account open, statements issuing to Jun 2026, holdings unknown | Captured; `coverage` publishes `missing`; excluded from net worth | Correctly parked. B60 (the phishing exposure) is the live part |
| ChatGPT subscription US$22.40 on MBNA — "not in any subscription list captured so far" (`ACCOUNT_FACTS:1940`) | Inside the $300/month `subscriptions` owner target by aggregate | Immaterial |
| CHQ RETURN FEE $2.00/month on TENNIS INCOME, 18/18 months, unused since Nov 2025 — $24/year | Recorded in B58, not on any plan row | Held elsewhere, so correctly outside joint cash. Immaterial |
| 2026-08-21 live acceptance: spendable $747.81, gap $104.89, unfunded | Committed evidence; not in CONTEXT's current-state section | F-16 |

---

## 6. CONFLICT MATRIX

| Concept | Source A | Source B | Which wins, and why |
|---|---|---|---|
| Cash Back Visa limit state | `ACCOUNT_FACTS.md:530-556` — $612.43 **over**, $0.00 available, $29/mo fee accruing | `Forecast.utilisation` from `data.json` — $4,799.43, **$200.57 available**, not over | **B.** `data.json` + the engine own current balances; ACCOUNT_FACTS's own line 7 says balances are not repeated there |
| Cash Back recurring minimum | `ACCOUNT_FACTS.md:33` — $762.36 on the 1st | `plan.obligations.cashback` — ~$170, `firstDue 2026-10-01`, Sept row satisfied by the 14 Aug $763 | **B.** The plan carries the settlement evidence |
| Travel Visa limit state | `ACCOUNT_FACTS.md:653-656` — 98.0% used, pending "**will** take it over" | `Forecast.utilisation` — **$105.33 over** on posted, pending $0 | **B.** Same reason |
| Triangle limit risk | `BACKLOG.md:145-154` — "remains under", `firstOver` null | `Forecast.projectDebts` — crossing on **2026-08-19, day 0**; $4.68 headroom | **B.** ARCHITECTURE.md:568 makes `projectDebts` the crossing authority |
| Commitment amounts on Records | `records.js` — Exterior painting **$0.00**, Indio **$0.00** | `publicationTotals.commitmentItems` / Deep Dive — $700–$1,200, $5,260–$5,460 | **B.** `Forecast.publicationTotals` is the named authority (ARCHITECTURE.md:547) |
| Income overstatement | `data.json questions[0]` — "up to $1,650/month" | `data.json incomeWarning` — "about $650/month, not the $1,650 previously feared" | **B.** It is derived from the coaching workbooks' 27.7% split; A is the superseded fear |
| Q2 status | `positions.csv:30` RESOLVED / VERIFIED; `BACKLOG:1880` "resolved" | `01_OPEN_QUESTIONS.md` Q2 **OPEN** | **B.** `01_OPEN_QUESTIONS.md` is the sole status authority (B87 / AF-QSTAT-01) |
| Published opening | `BACKLOG:1255-1277` — "the published Forecast opening is 2026-08-16 … Q19 stays OPEN" | `data.json meta.asOf` / `plan.opening.asOf` = **2026-08-19**; Q19 ANSWERED | **B.** `data.json` is the canonical opening; the backlog text is a historical record that is not labelled as one |
| Amanda's transfers | `data.json incomeNote` — "the transfers stopped after May 2026" | `plan.income.amandaTransfer` $2,182/mo + observed 14 Aug $2,168 and $790 | **B** for the forward figure; Q5 owns the *stopped* garage-funded stream. A conflates the two |
| Household net worth | `positions.csv:36` — **$519,557.97** from a $1,250,000 midpoint | `data.json netWorth.caveat` + `ACCOUNT_FACTS:1815-1822` — range $357k–$657k; Q3 "unstateable" | **B.** The range is the evidence; the midpoint is invented. Owner-reserved whether a midpoint may be published |
| Secured debt / financial-account net worth | `01_OPEN_QUESTIONS.md:45,48` — $747,612.74 / −$717,407 | `compactSnapshot.secured` $745,674.46 / `publicationTotals.financialAccountsOnly` −$730,442.03 | **B.** Derived from the current opening |
| Merge-card verdict token | `CLAUDE.md:309` — `STALE / SUPERSEDED` | `merge-card-check.yml:266` + PR template — `STALE-SUPERSEDED` | **B** mechanically (CI is the gate), but the fix belongs in `CLAUDE.md`, which is the rule's home |

---

## 7. FALSE POSITIVES REJECTED

Things I examined closely and deliberately did **not** classify as defects:

- **`helocSummary` "$7,536.96 growth"** looked wrong against the `helocHistory` chart (whose first point is $190,627.78). It is correct: the narrative window starts at $194,049.20 per `FINANCIAL_REVIEW_2026-08-09.md:39`, and `test-heloc-deepdive.js:46` guards the identity. Two different, correctly labelled windows.
- **`public/periods.json` `asOf: 2026-08-09`** — 10 days behind the opening, and it feeds historical category averages into the weekly cap. But the page prints "captured through 9 August 2026", `periods.json` is the declared sole home for spending actuals, and file capture is explicitly no longer the operational prerequisite. Correctly dated history.
- **`plan.actions[5]` stored `status: "open"` while `Forecast.resolveActions` derives `done`** — this is the designed split: ARCHITECTURE.md:562 gives current-limit satisfaction to `resolveActions`, and the page renders the derived value. Not drift.
- **Weekly cap $180 against essential need of $897/week** — this is not a hidden inconsistency; `budget.cap` publishes `hasDiscretionaryRoom: false`, `essentialShortfallWeekly $716.71`, and `roomVersusHousehold.verdict: "short"`. The engine is telling the truth about a hard position.
- **TENNIS INCOME $2,691.85 (a 2026-08-09 reading) inside the 2026-08-19 asset total** — disclosed in `assetsNote`, in the `heldElsewhere` note, and in `plan.assumptions`. Labelled, and excluded from spendable cash.
- **Thresholds in `public/plan.js`** (`Math.abs(e.amount) >= 50` agenda filter, `>= 250` notable events, `< 500` tone on revolving credit) — display filters and colours, not financial decisions. ARCHITECTURE explicitly says formatting is not authority drift.
- **`public/balance-history.js` computing deltas** — ARCHITECTURE.md:569 assigns display deltas to that module by name.
- **`modellers.js`, `deepdive.js`, `app.js`** — I scanned all four page scripts plus `app.js` and `balance-history.js` for arithmetic, comparisons and selection logic. Every financial decision routes through a named `Forecast.*` call. The B73 cleanup has held.
- **The August 13 advisory trio** — all three carry explicit "dated advisory / not adopted / not a sequencing authority" markers on their face, and nothing references them as a current plan.
- **`00-account-inventory-raw.md`, `FINANCIAL_REVIEW_2026-08-09.md`, `SANITIZED_SUMMARY_2026-08-09.csv`, `dashboard.html`** — all dated or superseded on their face. Correctly preserved history.
- **The parked OpenAI review workflows** (`atlas-first-review.yml`, `atlas-rereview.yml`, both exiting at line 54 with "Parked 2026-08-16: owner lean-CI") — intentionally parked, and `CLAUDE.md` and `docs/RISK_LABELS.md` both say so. Not a defect. (`CHATGPT.md` doesn't mention the parking, but it describes the *human* ChatGPT review lane, which is a different thing.)
- **ARCHITECTURE.md lines 606 and 638 saying "seven verdicts"** while line 556 says eight (`STATUS_BAND` has 8) — 606/638 describe the state at the 2026-08-12 B73 scan, not today. Historical narrative.
- **`ACCOUNT_FACTS.md:199-200` "See 'What she pays directly' below, which is the single authority for that list"** — that section does not exist. A broken internal pointer with no financial consequence; not worth a finding on its own.
- **Snapshot schema variance** (2026-08-09 carries two held-elsewhere accounts the later two omit; 2026-08-19 uses `confidence: OBSERVED` where 2026-08-16 uses `pendingUnknown`) — deliberate per B20: mixed-date rows are omitted, and `spendableCoverage.complete` is `true` on all three.
- **All 25 `CONSUMED` register targets** — I resolved every path, heading and JSON pointer. None is broken.

---

## 8. RECOMMENDED WORK ORDER

Six PRs. The first three are the only ones I would call urgent; the rest are cleanup that stops the same class of drift recurring. I have deliberately not turned every finding into a PR.

1. **Stop the Records page publishing a range commitment as $0.00.** (F-01) Route the commitments block through `Forecast.publicationTotals().commitmentItems`, the view the Deep Dive already uses. Proof: a test that fails when a range-only or undated `plan.commitments` row renders as `$0.00` or `Invalid Date`. *This is the only finding that puts a false number in front of the household today.*

2. **Reconcile the two remaining ACCOUNT_FACTS card sections to the 2026-08-19 opening.** (F-02) Give Cash Back and Travel Visa the same canonical-opening block Triangle and MBNA already carry; drop the retired $762.36 payment-calendar row. Proof: an invariant that fails when a card section in `ACCOUNT_FACTS.md` asserts an over-limit or available-credit state that `Forecast.utilisation` contradicts — the same shape as the existing Amanda-cadence and BC Hydro invariants.

3. **Re-derive B71 on the published opening.** (F-04) Replace the 2026-08-16 "remains under the limit" conclusion with what `projectDebts` reports on 2026-08-19, and let B71's own RISK paragraph become the finding. No code change; the engine is already right.

4. **Give the income-overstatement figure one home.** (F-03) One number, derived from the coaching workbooks, referenced by the question card rather than restated. Small, and it removes a live household-facing contradiction.

5. **Correct the four stale current-state records in one governance PR** — the B91 body's 2026-08-16 block (F-08), `STORE_QUESTION_B79.md`'s "B81 stays closed" (F-11), the `00_MASTER_PICTURE.md` §0 banner (F-09), and B72's closure (F-13). These share one root cause and one acceptance condition: no committed file asserts a superseded opening, question status or capability status as current.

6. **Close the two authority gaps the guards cannot see.** (F-06, F-05) Extend `test-question-status.js` to `docs/positions.csv` and `BACKLOG.md` so a RESOLVED/VERIFIED claim outside `01_OPEN_QUESTIONS.md` fails the build; and add a check that a `PROPOSED` register row's value is not already live in `data.json` — the register's own test currently asserts it performs no such comparison. Both are governance controls that meet the four-part lifecycle test in `CLAUDE.md`: each has a demonstrated failure in this audit, a deterministic predicate, and a focused test.

**Owner-reserved, not PR work:** F-05's gate question (did the 2026-08-16 absorption satisfy the joint household decision for those six interview items?), F-14 (may a midpoint home value be published in `positions.csv`?), and F-16 (whether to cut a newer canonical opening given the 2026-08-21 evidence). Also unchanged: B68's $1,199/year insurance overlap and B60's Coinbase phishing exposure are both waiting on a person, not on code.

**Not recommended:** no new governance beyond the two checks in item 6, no new store, schema or authority, and no correction to the dated historical documents (`FINANCIAL_REVIEW_2026-08-09.md`, `00-account-inventory-raw.md`, the advisory trio) — they are correctly preserved as evidence.

**The repository is cleaner than I expected on the axis that matters most.** The engine is the sole planner, the trust labels hold, the reconciliation chain is honest about what it does not know, and the fail-closed behaviour around unknown pending, unknown posting and unauthorised borrowing is real and tested. What has fallen behind is the prose around it — and specifically, the two card sections and one backlog conclusion that the 2026-08-19 cutover moved past without taking them along.

No files were modified, no branch created, no PR opened.