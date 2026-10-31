# Evidence absorption — architecture recommendation

**Status:** Dated advisory recommendation; not adopted architecture, not a
sequencing authority, not a fact store, and not an engine input.
**Post-B90:** remaining implementation order is owned by
[`docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md`](../ATLAS_FINANCIAL_BUILD_STRATEGY.md).
Do not read this file as “B91 next after B90”.
**Prepared:** 2026-08-13
**Builder surface:** Cursor (cloud agent)
**Primary builder model:** Grok 4.6
**Dispatch authority:** ChatGPT
**Product owner:** Dale

This file is the decision record ChatGPT and Dale asked for after PR #26
preserved the August 13 evidence pack. It recommends one small architectural
addition. It does not implement that addition.

Repository authorities beat this file. The August 13 advisory files remain
evidence and proposals, not adopted architecture.

---

## Entry gate (checked before analysis)

| Check | Result |
|---|---|
| Current `main` fetched | yes |
| PR #26 merged into `main` | **yes** — *Preserve sanitized August 13 financial evidence records*, merged 2026-08-13T21:50:44Z |
| Exact current `main` SHA | `c01c845f576e1b5836387f03e312a93bfa4d6b38` |
| Worktree clean before analysis | yes |
| `npm test` | **ALL 16 SUITES PASSED** |

Had PR #26 not been merged, this analysis would have stopped.

---

## A. Current-state verdict

**STILL BROKEN.**

PR #26 closed the preservation gap: the August 13 observations now survive in
git. It did not close the absorption gap. Captured evidence still has no
deterministic, inspectable disposition against a live incumbent, so Atlas still
cannot prove that information Dale supplied was used correctly or deliberately
parked.

The August 13 ledger already *describes* that gap. It is not a live mechanism:
several of its rows still say the syntheses are “not on `main`” after PR #26
merged them. A one-shot Markdown index drifts the moment repository state
moves. That is the defect, not a reason to replace the financial engine.

**Code is not required in this pull request.** This is the architecture
decision record. Implementation is the later PR named in section I.

**Owner gate on this analysis:** none. The recommendation itself asks ChatGPT
and Dale to adopt or reject the named mechanism. No household fact is asserted,
no estimate is promoted, and no published figure is moved.

---

## B. Exact demonstrated failure

Atlas can store a supplied fact in `docs/` and still leave the deterministic
engine running on a different, older, or contradictory value — or on silence —
with nothing in CI that fails.

“Captured” means a sanitised record exists. “Used” would mean one of five
closed outcomes is recorded against an existing authority and can be checked:

1. consumed by a named incumbent;
2. proposed, waiting for an owner/household gate;
3. parked as an unresolved question;
4. superseded by a named successor;
5. intentionally excluded, with a reason.

Today the fifth state that actually occurs is **orphaned**: preserved, maybe
even indexed once, and not binding on anything the household reads.

---

## C. Incumbent authority map

### End-to-end flow as it actually runs

```
raw/            SOURCE         owner drops files; never committed
  ↓  (manual run of a script; PDFs often need an owner password)
scripts/        EXTRACTION     deterministic parsers; committed
  ↓
derived/        INTERMEDIATE   rebuildable; never committed
  ↓  (almost entirely manual judgement)
docs/           KNOWLEDGE      ACCOUNT_FACTS, interviews, source_intake,
                               open questions, backlog, narrative
  ↓  (manual copy into publication; periods.js is the exception)
data.json       PUBLICATION    hand-authored figures the site shows
public/periods.json            generated spending / interest / fee series
  ↓
forecast.js     ENGINE         Forecast.simulate / projectDebts / recommend / …
  ↓
website         RENDER         plan.js / deepdive.js / records.js / modellers.js
```

Material is supposed to flow only down. The engine does not read `docs/`.
Pages are not supposed to decide. That design is sound. The break is the
handoff **into** `data.json` / `ACCOUNT_FACTS.md` / `01_OPEN_QUESTIONS.md`.

### Transition by transition

| Transition | Live authority | Automated | Manual | What can orphan | Provenance that survives | Trust/confidence that survives | Evolve, don’t replace |
|---|---|---|---|---|---|---|---|
| `raw/` → `scripts/` | owner placement + committed script | parse/decrypt when someone runs it | drop file, pick script, unlock PDF | unprocessed statements | filename convention only; no `source_id` | none | existing `scripts/`; later AF-INGEST-01 |
| `scripts/` → `derived/` | the script that wrote the file | write on run | invoking the run | derived files nobody publishes | rebuildable from `raw/` | none | keep `derived/` disposable |
| `derived/` → `docs/` | human judgement | almost nothing | ACCOUNT_FACTS, interviews, source_intake, questions | **this is the main leak** — a synthesis can sit unused | speaker, date, narrative | mixed vocabularies; not the published four-label contract | interviews, ACCOUNT_FACTS, 01_OPEN_QUESTIONS |
| `docs/` → publication | human copy into `data.json`; `scripts/periods.js` for history | `periods.json` only | **all of `data.json`** | docs facts never copied; top-level `data.json` keys the orphan scan cannot see | free-text `note` / `confidence` | plan uses `confirmed`/`estimated`; published contract is verified/calculated/estimated/unknown | keep `data.json` hand-authored; keep `periods.json` generated |
| publication → engine | `data.json` `plan` is what the engine is told; `Forecast` is what follows | `expandEvents` and the named Forecast functions | none, if the plan is right | `upcoming` vs `plan`; top-level `commitments`; Records-only blocks | event `confidence` (`confirmed`/`estimated`/`planned`) | engine does not invent amounts | `Forecast.simulate`, `projectDebts`, `recommend`, `budgetBreakdown` |
| engine → website | pages render; B73 still has three page-side groups | rendering | none | rendered-but-not-plan-fed sections (`assets`, forensic blocks) | mixed | a polished sentence can still make a provisional input look settled | finish B73; do not add page maths |

### Incumbents that already own the concepts (do not stand up seconds)

| Concept | Incumbent | Consumer today |
|---|---|---|
| Standing rates, limits, due dates | `docs/ACCOUNT_FACTS.md` | humans, `scripts/calendar-ics.js` |
| Dated balances | `docs/positions.csv` and `data.json` | Records page; debts feed Forecast |
| What the engine is told | `data.json` `plan` | `Forecast.expandEvents` → simulate / recommend / projectDebts |
| Historical spending series | generated `public/periods.json` | `Forecast.budgetBreakdown` |
| Weekly cap | `Forecast.recommend` only | Plan page |
| Budget split / owner targets | `data.json` `plan.budget` + `Forecast.budgetBreakdown` | Plan page |
| Next-dollar ordering | `data.json` `plan.nextDollar` (derived, not owner-approved) | `Forecast.projectDebts` |
| Attributed speech | `docs/household_interviews/` | humans; must not silently become policy |
| Questions only a person can answer | `docs/01_OPEN_QUESTIONS.md` | humans |
| Work to do | `BACKLOG.md` | agents |
| Published trust labels | verified / calculated / estimated / unknown | owner-reserved |
| On-page calendar | `Forecast.expandEvents` via `sim.events` | `renderCalendar()` |
| Exported calendar | `scripts/calendar-ics.js` from ACCOUNT_FACTS + observed recurrence | `.ics` (B74 overlap) |
| Next-due tile | `Forecast.nextDue` from `data.json` `upcoming` | Deep Dive (B74 overlap) |

The August 13 ledger and the 1,134-row inventory are **not** incumbents. They
are dated evidence that the handoff is unproven.

---

## D. Recommended smallest architecture change

**Name: Evidence-Use Register.**

A closed, CI-checked **index** over existing homes. It records, for every
material supplied evidence item, exactly one disposition against an incumbent
authority. It does not store the financial value. It does not compute a plan.
It does not replace `data.json`, `Forecast`, interviews, or ACCOUNT_FACTS.

### What it owns

- a stable evidence ID (the August 13 ledger IDs are the seed, not a second
  fact namespace);
- a pointer to the source record (source-intake file, interview, statement
  observation);
- exactly one disposition from a closed list:

  | Disposition | Means |
  |---|---|
  | `CONSUMED` | a named incumbent now holds the live value |
  | `PROPOSED` | attributed evidence awaiting an owner/household gate |
  | `UNRESOLVED` | parked in `01_OPEN_QUESTIONS.md` or an equivalent named question |
  | `SUPERSEDED` | a named successor ID is now the live row |
  | `EXCLUDED` | intentionally not used; reason and review date required |

- for `CONSUMED`: a pointer into an existing home (`data.json` path,
  ACCOUNT_FACTS section, `positions.csv` row, generated `periods.json`
  consumer);
- for `PROPOSED`: the owner gate and the interview/source that holds the
  proposal;
- for `UNRESOLVED`: the question ID;
- for `SUPERSEDED`: the successor ID;
- for `EXCLUDED`: reason plus review date;
- optionally, the **declared** engine/page consumer *if this item were
  consumed* — so exclusion is honest (“no Forecast consumer in the 91-day
  window”) rather than silent.

### What it does not own

- the number itself;
- verified / calculated / estimated / unknown;
- household policy;
- schedule expansion, cash projection, cap, debt walk, or budget arithmetic.

### Why this and not the game plan’s stack

The demonstrated failure is **missing proof of routing**, not missing
domains. A source registry, a canonical fact schema, nine engines, a shared
timeline, generated `data.json`, and a copilot API are five-plus new layers.
The register is one mechanism. An intake receipt is how a new source pack
writes rows into it. Consumer declarations are fields on those rows.
Reconciliation state is a disposition (`UNRESOLVED` or `CONSUMED`), not a
parallel ledger.

A canonical fact store beside `data.json` would be a second home for the same
figures — the failure Atlas has already shipped once.

### Where it lives

Knowledge layer, as a committed structured file (JSON or YAML) plus a focused
test. Not a new directory in the five-layer diagram. Not a database. The
August 13 Markdown ledger is the prototype and should be **derived from, then
retired or marked superseded by**, the register — not kept as a second index.

---

## E. Before / after flow

```
BEFORE (today)

  Dale supplies evidence
           |
           v
  docs/source_intake  or  household_interviews
           |
           +----> maybe a human copies it into data.json / ACCOUNT_FACTS
           |         |
           |         v
           |      Forecast  -->  website
           |
           +----> maybe it stays in docs forever
           |
           +----> maybe ACCOUNT_FACTS, calendar-ics.js, and plan.obligations
                    each tell a different story, and CI is green


AFTER (recommended)

  Dale supplies evidence
           |
           v
  source record (interview / source_intake / local raw observation)
           |
           v
  Evidence-Use Register  ---- must close one box ----
           |     CONSUMED --> existing incumbent --> Forecast / page
           |     PROPOSED --> owner gate; live plan unchanged
           |     UNRESOLVED --> 01_OPEN_QUESTIONS.md
           |     SUPERSEDED --> successor row
           |     EXCLUDED --> reason + review date
           |
           v
  CI fails if a material row has none of the five.

  Forecast.simulate / projectDebts / recommend  unchanged as authorities.
  data.json still hand-authored.
  No second engine.
```

---

## F. Seven evidence walkthroughs

Each row is: source → observation → disposition / canonical home → owner gate
→ engine consumer → published surface. Where the current architecture cannot
take a step, that is named.

### 1. Dale salary / payroll + CPP/EI seasonality

| Step | Current | Under the register |
|---|---|---|
| Source | 68 payroll statements + compensation screenshot, synthesised in `EMPLOYMENT_PENSION_FACTS_2026-08-13.md` (`EMP-002`–`EMP-006`) | unchanged; raw stays local |
| Observation | Base $158,091 from 2026-02-22; gross $6,080.42 biweekly; current net about $4,248–$4,275 after 2026 CPP/EI completion; EI ended 27 Mar, CPP 10 Apr, CPP2 8 May 2026 | same observations, still not “verified published” until an incumbent is updated |
| Disposition / home | **Orphaned.** Live `data.json` `plan.income[payroll]` is **$4,468.69**, labelled confirmed from “fifteen consecutive” deposits. Standing employment facts are not in ACCOUNT_FACTS. | Split the bundle. **Net deposit for the 91-day window:** `CONSUMED` into `plan.income` *or* `UNRESOLVED` if Dale must confirm the newer range before replacing $4,468.69. **Salary history:** `CONSUMED` into ACCOUNT_FACTS (standing) or `EXCLUDED` from the 91-day plan with review date. **CPP/EI per-deposit engine:** `EXCLUDED` until a consumer exists — the 91-day window is already past the 2026 completion dates, so a statutory payroll engine would not change this horizon. |
| Owner gate | Changing a published income figure is `figures-moved`. Inventing a statutory engine is not. Promoting T4 totals over base salary is forbidden (already recorded). | same |
| Engine consumer | `Forecast.expandEvents` already consumes `plan.income`. There is **no** statutory-deduction function. | keep `expandEvents`; do not add a payroll engine in order to absorb the current net |
| Published | Plan income calendar and weekly cap still use $4,468.69 | only after a later ordinary figure PR consumes the new net |
| Where it fails today | Preservation ≠ consumption. The live amount is stale relative to the August 13 observation. A 12-month statutory model has no incumbent and is not justified by the 91-day product exit. | Register closes the orphan. It does not secretly rewrite payroll. |

### 2. Pension balance and optional contribution policy

| Step | Current | Under the register |
|---|---|---|
| Source | Sun Life statements/screenshots (`PEN-002`, `PEN-004`, `PEN-007`) | unchanged |
| Observation | $144,365.95 as of 2026-08-12; required 5% + optional 1% + employer 6%; owner intent to ramp optional contributions later | balance is observed; ramp is proposed policy |
| Disposition / home | **Orphaned.** Live net worth **explicitly excludes pensions.** Optional 1% is already inside the observed net-pay range, not modelled as its own cash event. | **Balance:** `EXCLUDED` from Forecast; `PROPOSED` or later `CONSUMED` on the Records `assets` / `netWorth` path if Dale accepts inclusion. **Current election:** `CONSUMED` into ACCOUNT_FACTS as standing terms, or `EXCLUDED` from the 91-day cash plan because the cash effect is already in net pay. **Ramp to 12% employee:** `PROPOSED` in Dale’s interview; never a live `plan` input. |
| Owner gate | Including pension in published net worth. Adopting the ramp. Historical 12.8% five-year return must not become a forecast assumption (`PEN-006` stays `EXCLUDED` from Forecast). | same; register makes the gates visible |
| Engine consumer | **None** in `Forecast`. Records renders `assets` / `netWorth` without feeding the plan. | do not build a retirement engine |
| Published | Records caveat: pensions excluded | unchanged until an owner-accepted assets update |
| Where it fails today | No retirement modeller, and none is earned. The failure to close is the missing exclusion/proposal row, not the missing engine. | |

### 3. Rogers promotion expiry

| Step | Current | Under the register |
|---|---|---|
| Source | 2026-08-01 Rogers-together-with-Shaw invoice (`BILL-ROG-001`–`004`) | unchanged |
| Observation | Current bill $78.40; $80 ValuePlan expires 2027-12-28; review dates 2027-09-29 and 2027-11-28; ~$168 post-promo is an estimate | same |
| Disposition / home | **Partial.** `plan.bills` `shaw` already consumes **$78.40 on the 14th**. Label is still “Shaw internet”. ACCOUNT_FACTS payment calendar still says Shaw. Expiry and reminders have **no live consumer**. | **Cash schedule:** `CONSUMED` (`plan.bills` / ACCOUNT_FACTS amount). **Brand/contract terms:** later `CONSUMED` into ACCOUNT_FACTS (label correction is documentation, not a new engine). **Expiry reminders:** `EXCLUDED` from Forecast’s 91-day `expandEvents` (dates are in 2027) with review date; incumbent for a reminder is B74’s calendar decision, not a new reminder engine. **$168:** `EXCLUDED` as scenario/estimate. |
| Owner gate | none for the observed $78.40; estimate must not be published as verified | same |
| Engine consumer | `expandEvents` for the monthly $78.40. Nothing for 2027 reminders. Adding them to `plan.commitments` would be a lie about the 91-day cash window. Putting them only in ICS would widen B74. | keep the bill on `expandEvents`; park reminders until B74 names one schedule owner |
| Published | Plan calendar as “Shaw”; no 2027 look-ahead | amount already used; expiry still not a 91-day event |
| Where it fails today | The cash amount was absorbed by a human. The contract term was not. There is no reminder incumbent that is not already a B74 overlap. | Register records that honestly. It does not create a fourth calendar. |

### 4. HELOC minimum due

| Step | Current | Under the register |
|---|---|---|
| Source | 2026-07-31 HELOC statement (`HELOC-004`) | unchanged |
| Observation | $814.18 interest posted/capitalised 31 July **and** TD displayed $814.18 minimum due **21 August**. Statement does not prove the debit cleared or which account funded it. | same |
| Disposition / home | **Contradictory, not parked.** Live `plan.obligations` `heloc` is `nonCash` / `capitalise` on day **31**. `ACCOUNT_FACTS.md` payment calendar already lists **21st · HELOC minimum ~$814**. `scripts/calendar-ics.js` emits a monthly 21st HELOC minimum. `01_OPEN_QUESTIONS.md` does **not** carry the funding question. | **July 31 capitalisation:** `CONSUMED` by `plan.obligations` (that part is right about the posting). **August 21 minimum:** `UNRESOLVED` in `01_OPEN_QUESTIONS.md` until Dale confirms funding. Conservative cash reserve, if adopted, is an ordinary `plan.obligations` cash row — existing engine, not a new debt engine. |
| Owner gate | **Yes** — household fact: was it paid, from which account, or genuinely capitalised with no cash movement? | same; this is stop 1 in CLAUDE.md |
| Engine consumer | `expandEvents` currently adds a non-cash event, so `simulate` does not reserve $814.18 cash. ICS independently tells the household it is due on the 21st. | existing `expandEvents` can model a cash minimum **once the question is answered**. Until then the register forbids calling the 91-day cash plan complete. |
| Published | Plan: “no cash leaves.” ICS/ACCOUNT_FACTS: due the 21st. | contradiction becomes a named `UNRESOLVED` instead of two live answers |
| Where it fails today | The architecture **can** represent a dated cash obligation. What it cannot do is notice that ACCOUNT_FACTS, ICS, and `plan.obligations` disagree. That is B74 plus a missing question row. | |

### 5. Amanda’s $600 restaurant target

| Step | Current | Under the register |
|---|---|---|
| Source | `AMANDA_2026-08-10_PARTIAL.md` ($800) superseded by `AMANDA_2026-08-12_CONTINUATION.md` ($600) (`HH-001`) | interviews stay the evidence home |
| Observation | Amanda-stated proposed policy $600/month, effective now in her telling | still not joint policy |
| Disposition / home | Live `plan.budget` restaurants `plannedMonthly` is **800**, `targetSource` `owner-stated-2026-08-10`. Interview folder already forbids silent promotion. | **10 Aug $800:** `SUPERSEDED` by HH-001. **12 Aug $600:** `PROPOSED`. Live 800 remains `CONSUMED` as the current published target until Dale/Amanda jointly adopt 600. |
| Owner gate | **Yes** — joint-policy promotion; owner-reserved trust/policy change | same |
| Engine consumer | `Forecast.budgetBreakdown` already honours `plannedMonthly`; `recommend` reads that split | no new budget authority |
| Published | Plan budget still $800 | unchanged until an owner-decision figure PR |
| Where it fails today | The incumbent path exists. The newer attributed evidence did not move it, and nothing records “live 800 is superseded-as-proposal.” | |

### 6. Sports / travel priority

| Step | Current | Under the register |
|---|---|---|
| Source | Amanda 12 Aug: protect sports/travel before aggressive extra debt repayment (`HH-002`, `HH-003`, `HH-006`) | interviews |
| Observation | Proposed household priority; conflicts with live derived `plan.nextDollar` (`protect-then-highest-cost`), which ARCHITECTURE.md already says nobody signed off | same |
| Disposition / home | Interview evidence. Live next-dollar policy is Atlas-derived. Sports budget line is still a generic $250/month owner target, with Fusion/Burrard dated separately. | **Amanda priority:** `PROPOSED`. **Live nextDollar:** remains `CONSUMED` as derived recommendation, labelled not owner-approved. **$10k sports / $15k travel:** `PROPOSED` sinking-fund targets; not dated commitments. |
| Owner gate | **Yes** — whose priority wins; promoting `nextDollar` is already owner-reserved | same |
| Engine consumer | `projectDebts` / mission read `nextDollar`. There is no first-class “proposed policy scenario” that does not mutate `data.json`. | do not add a policy engine. A later scenario is a fixture that copies `recommend`’s `planOptions` and replaces one key — the pattern `Forecast.counterfactuals` already uses. |
| Published | Plan next-dollar copy; budget sports $250 | unchanged |
| Where it fails today | Architecture already separates interview evidence from policy. It does not prove the conflict is parked. | |

### 7. Fusion camp marked paid while live plan says upcoming

| Step | Current | Under the register |
|---|---|---|
| Source | Amanda 10 Aug and 12 Aug: $786 already paid (`COMMIT-001`) | interview + any matching raw transaction (local) |
| Observation | Amount agrees with `plan.commitments` `fusioncamp` $786 on **2026-08-16**. Status does not. Same amount also appears in `plan.actions` and `upcoming`. | same |
| Disposition / home | **Conflict, not closed.** `01_OPEN_QUESTIONS.md` does not list it. | `UNRESOLVED` until a posted transaction or Dale confirms. If paid, `CONSUMED` by removing or completing the commitment in `plan.commitments`, and the duplicate `upcoming` / `actions` surfaces must be listed as consumers or they become the next orphans (B74-adjacent). |
| Owner gate | Confirm payment (household or institution evidence). Owner-stated is not automatically verified. | same |
| Engine consumer | `expandEvents` currently treats it as cash out on 16 Aug, widening the gap the cap is sized against. | existing commitment path; no new commitment engine. A `paid` flag is optional later; deletion-with-register-row is enough. |
| Published | Plan calendar, “Fund the Fusion camp”, upcoming list | possibly overstates the 16 Aug cash need |
| Where it fails today | Architecture **can** drop a paid commitment. It cannot require the status conflict to be parked, and three publication lists can drift after one edit. | |

---

## G. What we deliberately do not build

| Proposal | Why not now |
|---|---|
| Supabase / Postgres / SQLite | Store gate in ARCHITECTURE.md is closed until file-based identity/idempotency **fails on real data**. This failure is an unproven handoff, not an invariant the file foundation cannot express. |
| A second financial engine | `Forecast` is the incumbent. A parallel planner is the $1,650/$0 defect returning. |
| Multiple independent domain planners (cash, debt, budget, retirement, goals, reminder, …) | Those are functions `Forecast` already has or does not yet need. New named engines without a named current consumer violate the closed-loop rule. |
| Live copilot API | Security-relevant, owner-reserved, and unnecessary for disposition proof. ChatGPT already consumes repository state. A generated export is the later, smaller interface if one is earned. |
| Automatic verified-fact promotion | Owner-reserved. The register’s `PROPOSED` / `CONSUMED` split exists so an agent cannot skip that gate. |
| Automated raw-file ingestion / connectivity | Connectivity gate is closed. Raw remains owner-placed and local. |
| Regenerating `data.json` from extracted facts | Facts and owner-authored policy are not yet separated; there is no parity proof. Generating publication now would move figures by machinery. Keep hand-authored `data.json`. |
| Universal canonical fact schema / 1,134-leaf import | The inventory catalogues publication scalars that already have a home. The orphans are **incoming evidence**, not every nested `data.json` leaf. Importing 1,134 leaves as a “fact graph” creates a second copy of publication. |
| Shared event timeline as a new layer | `Forecast.expandEvents` is the schedule authority. Unifying ICS/`upcoming` is B74, which **evolves** that incumbent. A fourth timeline is the named defect. |
| Statutory payroll engine, retirement engine, reminder engine | No current 91-day consumer for CPP seasonality (already complete for 2026), pension projection, or 2027 Rogers dates. Exclude with review dates; do not invent engines to make the register look busy. |
| Adopting the 13-PR copilot game plan | It is a destination sketch. It fails the one-outcome rule, opens gated capabilities, and replaces incumbents before they have been shown inadequate. |

---

## H. Required changes to repository authority

**Do not edit these in this pull request.** If ChatGPT and Dale adopt the
recommendation, later implementation would need:

| File | Change |
|---|---|
| `ARCHITECTURE.md` | Name the Evidence-Use Register as the owner of “whether supplied evidence has been used or parked.” Add the reverse-handoff rule: every committed source-intake or interview item must have a closed register row. Do not add a sixth layer to the diagram. Do not move financial arithmetic out of `Forecast`. |
| `docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md` | Insert one NEW item (e.g. `AF-EVID-01`) that may interrupt Phase 1 for this mechanism. Do not pull Phase 3 ingestion, a store, or generated publication forward. Do not cancel remaining B73/B74; they resume after the register exists. |
| `BACKLOG.md` | Record the new item and disposition the August 13 absorption findings. Do not copy the ledger’s figures into the backlog. |
| `CONTEXT.md` | One pointer in the layout/flow so a fresh session sees the register. No second reading order. |
| `test-authority-coverage.js` (or a sibling test) | Mechanical check that every register row has a closed disposition and that `CONSUMED` pointers exist. This is a new hard gate, so it belongs on the review trigger list by being a workflow/test that protects one-fact/one-home. |
| `docs/source_intake/EVIDENCE_USE_LEDGER_2026-08-13.md` | After the live register exists, mark this ledger superseded (dated preservation proof), not a second index. |

Unchanged as owners: `CLAUDE.md` (roles/review/merge), `docs/01_OPEN_QUESTIONS.md`
(questions), `docs/ACCOUNT_FACTS.md` (standing facts), `docs/positions.csv`,
`data.json` `plan`, `public/forecast.js`, `public/periods.json`, household
interview rules, published four-label trust contract,
`docs/MASTER_PLAN_REQUIREMENTS.md` (source intake only).

---

## I. Proposed implementation sequence

Maximum two PRs. The capability closes after PR 1. PR 2 is optional
authority-doc adoption if ChatGPT wants the mechanism proven in CI before the
prose authorities are rewritten — but the honest single outcome is “the
register exists and is checked,” which includes the ARCHITECTURE/strategy
sentences that make it an authority. Prefer **one PR** if Dale/ChatGPT accept
that atomicity; split only if they want the schema proven on a fixture before
naming it in ARCHITECTURE.md.

Urgent figure conflicts (stale payroll net, Fusion camp status, HELOC 21st
minimum) are **not** in this sequence. They are ordinary one-outcome
`figures-moved` or `owner-decision` PRs against incumbents that already exist.
Bundling them here would mix architecture with household facts.

### PR 1 — Evidence-Use Register, seeded from the August 13 pack

- **Outcome:** every material August 13 ledger ID has a closed, CI-checked
  disposition against an existing incumbent (as the repository actually stands:
  most rows `PROPOSED`, `UNRESOLVED`, or `EXCLUDED`; only already-live items
  `CONSUMED`).
- **Acceptance:** deleting a disposition, pointing `CONSUMED` at a missing
  path, or adding a source-intake ID with no row fails `npm test`. No published
  figure changes. No Forecast change.
- **Incumbent affected:** NEW register; CONSUME existing homes. ARCHITECTURE.md
  and the build strategy gain the rule (if this PR is the atomic adoption).
- **Runtime code:** no.
- **Atlas Contract / Systems Review:** **REQUIRED** — new deterministic hard
  gate protecting one-fact/one-home and the handoff into publication.
- **Owner gate:** none, provided the PR does not map or replace published trust
  labels and does not consume proposed policy into `plan.budget` / `nextDollar`.

### PR 2 — only if PR 1 was schema-only

- **Outcome:** ARCHITECTURE.md and the build strategy name the register as the
  handoff owner; the August 13 Markdown ledger is marked superseded by the
  live file.
- **Acceptance:** a reader of ARCHITECTURE.md can state who owns “used or
  parked”; the strategy schedules AF-EVID-01 without opening the store or
  connectivity gates.
- **Incumbent affected:** ARCHITECTURE.md (EVOLVE direction table), build
  strategy (NEW item).
- **Runtime code:** no.
- **Atlas Contract / Systems Review:** **REQUIRED** if ARCHITECTURE.md is
  changed (mechanically high-risk path).
- **Owner gate:** ChatGPT/Dale adoption of this recommendation — that is the
  dispatch decision, not a household fact.

No third PR. Absorbing payroll, HELOC cash treatment, Fusion status, or
Amanda’s $600 is subsequent ordinary work, one outcome each, after the
register can record what happened.

---

## J. Recommendation to ChatGPT

**RECOMMENDATION: Adopt the Evidence-Use Register now as the next architectural
outcome. Do not finish remaining B73/B74 first, and do not adopt the copilot
game plan, a canonical fact schema, generated `data.json`, or a second engine.**

- Treat “captured ≠ used” as a missing **disposition index over incumbents**,
  not as missing infrastructure. The August 13 ledger already showed the
  shape; make that shape live and CI-checked, then retire the Markdown copy.
- Interrupt Phase 1 for this one NEW item. Remaining B73 page-script moves and
  B74 calendar unification stay real, and they resume after the register
  exists; they do not close this gap if done first.
- Keep `Forecast.simulate`, `projectDebts`, `recommend`, `data.json` `plan`,
  `public/periods.json`, ACCOUNT_FACTS, interviews, and the four published
  trust labels as incumbents. Route evidence into them; do not compile a
  parallel fact graph.
- Do not promote Amanda’s $600, sports/travel priority, pension-in-net-worth,
  or the optional-contribution ramp in the register PR. Those stay `PROPOSED`
  until Dale answers. Do not auto-rewrite payroll or Fusion either — those are
  later figure PRs the register will make impossible to “lose.”
- Leave gated work gated: no store, no connectivity, no live copilot API, no
  verified-label changes, no raw-file automation. If a published cash figure
  is currently wrong (HELOC 21st vs day-31 non-cash; Fusion camp paid vs
  upcoming; payroll $4,468.69 vs ~$4,264), handle each as its own interruption
  against the incumbent that already owns it — not as architecture.
