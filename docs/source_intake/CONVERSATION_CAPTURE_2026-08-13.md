# Atlas Financial — Conversation Capture and Preservation Ledger

**Status:** Preservation record; not a fact authority, policy decision, implementation plan, or engine input  
**Captured through:** August 13, 2026  
**Repository baseline checked:** `main` at `957ed62fb6bd5e058505ecde60c78aaf3a7491f6`  
**Purpose:** Make sure the evidence, facts, preferences, questions, architectural intent, and review feedback gathered in this work are not forgotten before Atlas architecture and ingestion are decided.

## 1. Rules for reading this record

- `captured` means preserved with provenance; it does not mean the engine uses it.
- `absorbed` means the item has a declared canonical home and a named consumer, or is explicitly parked as a question, action, proposal, or dated exclusion.
- Source evidence, observations, canonical facts, household policy, planned events, derived results, and published wording remain different stages.
- Amanda-only and Dale-only preferences remain attributed evidence until they become a joint household decision through the repository's owner path.
- No item in this record may silently change `data.json`, `public/forecast.js`, a budget, a forecast, a confidence label, or a recommendation.
- Original statements, payroll files, screenshots, invoices, and transaction exports remain local-only in `raw/` and must never enter Git.
- This record contains sanitized summaries only. It deliberately omits account numbers, tax identifiers, employee identifiers, home addresses, payment credentials, private counterparties, and transaction reference strings.

## 2. Current preservation status

| Material | Current location/status | What remains |
|---|---|---|
| Amanda household interviews and continuation | Already merged to `main`; latest merge is PR 25 | Reconcile and promote only owner-approved household decisions; do not treat Amanda-only targets as joint policy |
| Employment, payroll, bonus, T4, pension, and benefits synthesis | Preserved on branch `agent/preserve-financial-source-syntheses`, commit `c29358977e229a02dbb2689066aa1fc351195511` | No open PR; not on `main`; later canonical integration required |
| Hydro, FortisBC, and Rogers synthesis | Same branch and commit as employment/pension | No open PR; not on `main`; reminder delivery and transaction reconciliation still required |
| Mortgage and HELOC synthesis | Preserved on branch `agent/preserve-mortgage-heloc-source-synthesis`, commit `cabac38200cb676ec93054d60b6aa3e4ab054c2a` | No open PR; not on `main`; HELOC minimum-payment funding still unresolved |
| Engine-lineage audit | Local artifact `Atlas_Engine_Lineage_Audit_2026-08-13.md` | Not in the repository; advisory evidence only |
| Data-point inventory | Local artifact `Atlas_Data_Point_Inventory_2026-08-13.csv`, 1,134 data rows plus header | Not in the repository; use as migration/audit evidence, not as a second canonical data model |
| Copilot architecture game plan | Local artifact `ATLAS_FINANCIAL_COPILOT_ARCHITECTURE_GAME_PLAN.md` | Not adopted; must be reconciled into the existing architecture, build strategy, and backlog rather than becoming a second roadmap |
| Original source files | Supplied through Gmail, screenshots, PDFs, and Library copies during this work | Must be copied by the owner into the local repository's ignored `raw/` tree and backed up with the existing raw backup process; originals must not be committed |

There are currently **no open pull requests**. The three sanitized source syntheses are preserved on two branches but are not part of `main`.

## 3. New source packs and key anchors

The detailed data points live in the three source syntheses named above. This section is an index and a set of high-value reconciliation anchors, not a duplicate source of truth.

### 3.1 Employment, payroll, and incentive compensation

- Current base salary: **$158,091**, effective February 22, 2026.
- Current regular gross pay: **$6,080.42 biweekly**, on 26 deposits per year.
- Observed current recurring net deposit after 2026 CPP/CPP2/EI completion and the current optional pension deduction: approximately **$4,248–$4,275**, averaging about **$4,264**.
- Payroll changed from semi-monthly to biweekly in July 2025; Atlas must not smooth this into twelve equal months when building the cash calendar.
- Bonus is variable and normally arrives separately in late February. Verified gross/net bonuses exist for 2024, 2025, and 2026; a 20% bonus is a scenario ceiling, not guaranteed income.
- CPP, CPP2, and EI must be modeled by deposit date and annual maximum. The late-February bonus materially accelerates the dates on which deductions stop.
- T4 employment income is salary plus bonus and taxable benefits. It must not overwrite effective-dated base salary.

### 3.2 Pension and retirement evidence

- Sun Life DCPP balance: **$144,365.95 CAD as of August 12, 2026**.
- Investment: **100% SL Granite 2050 Fund**.
- Current contribution election: required employee **5%**, optional employee **1%**, employer **6%**; current combined funding **12%**.
- The recurring optional 1% began in June 2026 and earlier optional elections varied, so contributions must be effective-dated.
- Historical net returns shown through July 2026 include **12.8% over five years**. This is historical performance, not a forecast assumption.
- Owner planning intent captured in the source synthesis: preserve the required employee contribution and employer match; consider increasing the employee total by about one percentage point annually toward 12%, but only when cash flow, revolving debt, HELOC pressure, and emergency reserves allow it.
- Open retirement decisions: expected pension-withdrawal start, Granite 2045 versus 2050 after that decision, retirement comparisons at age 60 and 65, and Sun Life spouse/beneficiary inconsistencies.

### 3.3 Bills and utilities

- BC Hydro equal-payment schedule: **$234/month**. August evidence showed a carried balance and late fee; whether the account is current remains unresolved.
- FortisBC equal-payment schedule: **$124/month**. A September 2026 reconciliation may change the schedule, but the new amount is unknown until a statement confirms it.
- Rogers internet current bill: **$78.40/month**, with the August invoice paid/current.
- Rogers ValuePlan discount: **$80/month**, expiring **December 28, 2027**.
- Required Atlas reminder dates: **September 29, 2027** (90 days) and **November 28, 2027** (30 days), unresolved until a replacement price or renewed promotion is recorded.
- The unchanged-price post-promotion estimate is approximately **$168/month**; it remains an estimate, not a confirmed future bill.
- Hydro and Fortis equal-payment amounts are cash schedules, not same-month consumption costs. Invoices, schedules, payments, late fees, and reconciliation/catch-up events must remain distinct.
- Each payment must be reconciled to imported transactions before adding an expense, so bills and payments are not counted twice.

### 3.4 Mortgage and HELOC

- Mortgage historical balance as of December 31, 2025: **$559,281.35** at **3.64% variable**, with **$1,600 biweekly** payments and a **May 1, 2027** maturity.
- The historical statement reconciles 2025 payments to **$18,178.10 principal** plus **$23,421.90 interest** across 26 payments.
- Current-term annual charge-free lump-sum privilege: **$97,200**; do not assume this survives renewal.
- HELOC July 31, 2026 closing balance: **$201,085.16** against a **$202,654** limit, or **99.23% utilization** at the statement date.
- July HELOC interest and minimum due: **$814.18**, due August 21, 2026.
- The statement proves interest was capitalized and that a separate minimum was displayed. It does not prove the minimum cleared or identify its funding account.
- Until payment is reconciled, the 91-day plan may overstate cash by **$814.18** if it does not reserve the obligation.
- The later Atlas HELOC position remains the current balance; the July statement belongs in history and must not overwrite it.
- The mortgage and HELOC source PDFs contain private identifiers and must remain outside Git.

## 4. Household goals, preferences, and unresolved policy

These items are already preserved in the Amanda interview record on `main`. They are repeated here only to make their engine-absorption status impossible to miss.

### Amanda-attributed targets and preferences

- Restaurants/takeout target: **$600/month**, superseding Amanda's earlier $800 statement.
- Sports and activities target: approximately **$10,000/year**, preferably about **$385 from each of Dale's 26 biweekly pays**.
- Travel target: **$15,000/year**, including tournament travel and room for one or two additional tournaments.
- Subscriptions: initial **$250/month cap** plus a PayPal/recurring-charge audit request.
- Medical/health buffer: **$100/month**.
- Adult personal plus non-routine household: **$600/month combined**.
- Cash-floor preference: **$500**.
- Restaurants/takeout, subscriptions, and groceries are the spending watchlist, in that order.
- Food behavior should be measured as groceries plus restaurants/takeout together.
- Sports and travel are protected priorities in Amanda's requested plan; this conflicts with the live debt-first `nextDollar` ordering when surplus is scarce.
- Garage/dental-lab rent should be treated as ended for planning until Amanda says it resumes.
- Coaching revenue remains separate until coach and business obligations are handled; only actual transfers to the household become household cash.
- Amanda states there is no additional missing Amanda bank account. This does not by itself reconcile the unexplained $186.16 movement already tracked by Atlas.

### Commitments and bill questions

- Fusion camp: **$786**, Amanda says already paid; the live plan still treats it as upcoming. Amount agrees, status/timing does not.
- Fusion tryouts: **$140** expected.
- Burrards field registration: **$623** expected.
- Warriors Academy: approximately **$800** likely.
- Fusion travel-team program: approximately **$2,000+**, conditional on selection and not yet exact.
- Potential tournament travel: Seattle, Tacoma, and Indio events already preserved in the interview record; participation and costs remain conditional.
- Bell Mobility: Amanda estimates approximately **$150/month**; the exact amount is unresolved.
- Telus amount and payment route remain unresolved.
- Garbage-disposal provider, cadence, and amount remain unresolved.
- BCAA and ICBC coverage overlap remains an existing question for Dale.
- The current bill resolves the Rogers/Shaw identity conflict for the August 2026 service evidence: the bill is branded Rogers together with Shaw and names Rogers Xfinity service. Historical merchant naming should remain historical evidence rather than being rewritten.

### Household decisions not yet made

- Dale's corresponding view on Amanda's targets, priority order, protected categories, and debt strategy.
- Emergency-savings target and priority relative to debt, sports, travel, and optional pension contributions.
- Amanda's retirement and RESP intentions.
- Which policy wins when protected lifestyle goals compete with revolving-debt reduction.
- Whether and when the source targets should replace current `data.json` budget lines.

## 5. Existing transaction and email evidence that must stay connected

- The repository already reports **4,762 transactions across 48 statements** covering TD, Triangle, MBNA, PayPal, and Wise sources.
- Prior email reconciliation identified subscription and recurring-charge candidates, Interac and transfer evidence, Fusion payments, a Coinbase asset transfer, Wise-linked transfers, and an unresolved Yakima reservation reconciliation.
- Merchant and email evidence are supporting observations; settlement and account records remain the financial authority.
- Known transaction-system gaps remain: identity stability, pending lifecycle, idempotent import, complete raw-file coverage, and proof that every source reconciles to the derived outputs.
- Planned purchases and goals must never masquerade as posted transactions. Credit-card purchases are consumption plus debt; later card payments are cash-out plus debt-down, not a second copy of the purchase.

## 6. Product intent captured from the owner

The owner is not asking only for a budget dashboard. The intended destination is an all-encompassing household financial picture and copilot in which all supplied information can influence the relevant forecasts, planning windows, reminders, recommendations, risks, questions, and scenarios.

The repeated requirements are:

1. Everything supplied must receive a visible disposition; nothing may disappear into storage.
2. One fact has one canonical home, but one fact may have many declared consumers.
3. One household plan should support multiple time windows without creating contradictory planners.
4. The deterministic engine decides; pages and the copilot explain the same results.
5. AI may extract candidate observations and explain structured outputs, but it must not invent facts, policy, or figures.
6. Evidence, confidence, effective dates, provenance, freshness, and supersession must travel with the fact.
7. Facts and policy must remain separate. Evidence extraction must not overwrite targets, priorities, or owner decisions.
8. Every intake should eventually produce a human-readable receipt showing what was extracted, reconciled, changed, consumed, parked, questioned, or excluded.
9. Scenarios must be isolated and must never mutate canonical facts.
10. Raw evidence stays private and local; only sanitized, necessary records enter Git.

## 7. Architecture reviews received — preserved as advisory input

The reviews broadly agree on the destination but disagree on sequencing and how much infrastructure to introduce first. None of these points is adopted merely because it appears here.

### Strong consensus

- Atlas currently guarantees capture better than absorption.
- A source-to-use receipt or evidence-use ledger is the earliest honest proof that supplied evidence affected the system or was explicitly parked.
- The existing repo authorities must remain: `ARCHITECTURE.md` for direction/gates, the build strategy for sequence, and `BACKLOG.md` for work. The game plan must not become a second roadmap.
- The current confidence/provenance vocabularies are inconsistent and need an owner-approved mapping before automation relies on them.
- The existing schedule authorities must be unified through the B74 outcome; adding a fourth timeline would worsen the named defect.
- Raw files remain manual/local until the connectivity gate is deliberately passed.
- Website and copilot should consume the same structured plan result.
- The original source layer is irreplaceable and its backup should become more reliable.
- `data.json` must not be regenerated from extracted facts until facts and owner-authored policy have been separated and a parity proof shows the cutover changes machinery rather than household figures.

### Live architectural disagreements to resolve later

1. **Sequence:** finish B73/B74 and the current 13-week operating picture first, or pull a small fact/source schema forward now.
2. **First preservation product:** evidence-use ledger over existing artifacts versus a universal canonical fact model.
3. **Gate timing:** formalize no-orphan immediately because a real orphan failure exists; delay impact/freshness hard gates until their deterministic predicates and demonstrated failures satisfy the governance lifecycle.
4. **`data.json`:** keep hand-authored publication until a composer has parity tests versus invert it into generated output earlier.
5. **Model shape:** evolve the existing `Forecast` engine and event stream versus introduce multiple named domain engines; all reviewers agree there must not be multiple independent planners.
6. **Long horizons:** either expand the shared simulator or explicitly reconcile short-horizon simulation with the existing analytic renewal/payoff models; do not claim every horizon is already one engine window.
7. **Copilot access:** prefer a sanitized generated plan export first versus a live read-only API; any API is security-relevant and owner-reserved.
8. **Policy representation:** keep policy in current code/files initially versus move it into a versioned, owner-approvable decision table later.

### Automation idea preserved, not authorized

The proposed long-term inversion is:

`raw/` → deterministic parser → rebuildable observations → reconciliation → canonical sanitized facts + owner-authored policy → generated publication → existing deterministic engine.

Safety conditions proposed by the reviews include schema validation, stable identity and idempotency, a ceiling on automated confidence, no-orphan build checks, human-readable intake receipts, policy/fact separation, scenario isolation, and human review before verified promotion. Provider connectivity, a database, a live copilot API, and changes to confidence labeling remain owner-gated.

## 8. What is captured but not yet absorbed

| Domain | Captured? | In `main`? | Engine consumer complete? | Current disposition |
|---|---:|---:|---:|---|
| Amanda interview and household targets | Yes | Yes | No | Attributed evidence and owner questions; not joint policy |
| Employment and salary history | Yes | No | No | Sanitized synthesis on branch; payroll engine still uses a simpler net-deposit model |
| Bonus and statutory deduction seasonality | Yes | No | No | Sanitized synthesis on branch; needed for longer horizons |
| Pension balances, elections, performance, and scenarios | Yes | No | No | Sanitized synthesis on branch; no retirement engine consumer yet |
| Hydro/Fortis/Rogers schedules and contract terms | Yes | No | Partial | Sanitized synthesis on branch; payment reconciliation and reminders incomplete |
| Rogers promotion expiry | Yes | No | No live reminder | Dates preserved; delivery unimplemented |
| Mortgage historical statement facts | Yes | No | Partial | Sanitized synthesis on branch; history consumer incomplete |
| HELOC July statement and August minimum | Yes | No | Partial and potentially unsafe | Payment/funding reconciliation is a high-priority question |
| Transaction and statement history | Yes | Yes/locally derived | Partial | Strong current coverage; identity, pending lifecycle, idempotency, and raw coverage still incomplete |
| Architecture game plan and audits | Yes | No | Not applicable | Advisory design evidence; must be reconciled into existing authorities later |

## 9. Open questions and near-term risk items

### Financially urgent or date-sensitive

- Confirm the disposition and funding of the **$814.18 HELOC minimum due August 21, 2026**.
- Confirm whether the **BC Hydro $451.24** amount shown due has been paid and the account is current.
- Capture the **September 2026 Fortis** equal-payment reconciliation.
- Reconcile Fusion camp's already-paid status before treating it as an upcoming cash need.
- Preserve the **May 1, 2027 mortgage renewal** and HELOC-consolidation decision in long-range planning.
- Surface the Rogers promotion reminders in 2027.

### Household and planning decisions

- Dale's view on the household priority ordering and Amanda's targets.
- Emergency-reserve target and priority.
- Pension withdrawal timing and optional-contribution ramp conditions.
- Amanda's retirement and RESP intentions.
- Bell, Telus, garbage, BCAA/ICBC, subscriptions, PayPal recurring charges, and any remaining household bills.
- Whether the unexplained $186.16 movement is reconciled without inventing an account.

### Architecture decisions for a later session

- Adopt the thin evidence-use ledger first or a minimal fact/source schema first.
- Decide how confidence vocabulary maps to source/method metadata.
- Decide when `data.json` can safely become generated.
- Define the honest relationship between the 91-day simulation and longer analytic models.
- Define the copilot's first read-only contract: generated export or later API.

## 10. Recommended preservation package for the repository

This is a storage/disposition package, not an implementation campaign:

1. `docs/source_intake/CONVERSATION_CAPTURE_2026-08-13.md` — this ledger.
2. `docs/source_intake/EVIDENCE_USE_LEDGER_2026-08-13.md` — explicit destination, consumer, question, action, scenario, or parking state for every material evidence group.
3. `docs/source_intake/EMPLOYMENT_PENSION_FACTS_2026-08-13.md` — already preserved on a branch.
4. `docs/source_intake/HOUSEHOLD_BILL_FACTS_2026-08-13.md` — already preserved on a branch.
5. `docs/source_intake/MORTGAGE_HELOC_FACTS_2026-08-13.md` — already preserved on a branch.
6. `docs/advisory/ENGINE_LINEAGE_AUDIT_2026-08-13.md` — dated, explicitly non-authoritative audit.
7. `docs/advisory/COPILOT_ARCHITECTURE_GAME_PLAN_2026-08-13.md` — dated design record, explicitly not a roadmap.
8. `docs/advisory/DATA_POINT_INVENTORY_2026-08-13.csv` — migration/audit evidence, not canonical facts.

Before any commit, scan all eight artifacts for personal identifiers and exact account numbers. Do not include source PDFs, screenshots, Gmail exports, payroll statements, T4s, or private transaction details. Use one independently provable preservation outcome; architecture adoption and engine activation are separate later outcomes.

## 11. Preservation acceptance test

This capture phase is complete only when all of the following are true:

- every source pack above is either on `main` or has a named, durable repository disposition;
- every fact or preference is marked as observed, calculated, estimated, owner-stated, proposed policy, joint policy, question, action, exclusion, or derived scenario;
- no original private source file is tracked;
- no source synthesis silently changes a live figure or engine behavior;
- the architecture reviews are stored as advisory records rather than a second authority;
- the next session can answer, without chat memory, what was supplied, where it is preserved, what Atlas uses today, what remains parked, and what decisions are still open.

## 12. Deliberate stopping point

After preservation, stop. Do not select a schema, rewrite `data.json`, add gates, build a copilot API, or activate new budget/pension/bill/debt logic in the same outcome. The next outcome is an architecture decision that reconciles this evidence with the existing architecture and build strategy.
