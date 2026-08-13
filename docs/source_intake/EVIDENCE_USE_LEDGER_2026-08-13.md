# Atlas Financial — Evidence-Use Ledger

**Status:** Dated preservation prototype. **Superseded** as the live disposition
index by [`docs/evidence_use/register.json`](../evidence_use/register.json).
This file remains historical evidence: it is how the August 13 IDs were first
named. It is not a second fact store, not an engine authority, and not the
live routing record.

**As of:** August 13, 2026  
**Purpose:** Prove that every material item gathered in this work has a destination, consumer, question, action, scenario, or explicit parking state.

The `evidence-ids` fence below is the explicit-ID declaration for this pack.
CI covers these IDs only. It does not claim that every sentence in this file
has been identified.

```evidence-ids
EMP-001
EMP-002
EMP-003
EMP-004
EMP-005
EMP-006
EMP-007
EMP-008
PEN-001
PEN-002
PEN-003
PEN-004
PEN-005
PEN-006
PEN-007
PEN-008
PEN-009
PEN-010
PEN-011
BILL-HYD-001
BILL-HYD-002
BILL-HYD-003
BILL-HYD-004
BILL-FOR-001
BILL-FOR-002
BILL-FOR-003
BILL-ROG-001
BILL-ROG-002
BILL-ROG-003
BILL-ROG-004
BILL-ROG-005
BILL-OTH-001
BILL-OTH-002
BILL-OTH-003
BILL-SUB-001
MTG-001
MTG-002
MTG-003
MTG-004
HELOC-001
HELOC-002
HELOC-003
HELOC-004
TAX-001
MTG-005
HH-001
HH-002
HH-003
HH-004
HH-005
HH-006
HH-007
HH-008
HH-009
HH-010
HH-011
HH-012
HH-013
HH-014
HH-015
HH-016
HH-017
HH-018
HH-019
HH-020
HH-021
HH-022
HH-023
HH-024
HH-025
SPORT-001
TRAVEL-001
TRAVEL-002
TRAVEL-003
COMMIT-001
COMMIT-002
COMMIT-003
COMMIT-004
TXN-001
TXN-002
TXN-003
TXN-004
TXN-005
ARC-001
ARC-002
ARC-003
ARC-004
ARC-005
ARC-006
ARC-007
ARC-008
ARC-009
```


This ledger deliberately uses descriptive source statuses rather than inventing a new confidence enum. The repository's verified/calculated/estimated/unknown vocabulary and existing source-method labels still require an owner-approved mapping.

## Status key

- **Observed:** directly supported by an institution document or account record.
- **Calculated:** derived arithmetically from observed evidence.
- **Owner-stated:** attributed to Dale or Amanda; not automatically joint policy.
- **Proposed policy:** requested target or priority awaiting the required household/owner promotion.
- **Question:** a missing or contradictory fact only the household or later evidence can resolve.
- **Action:** a dated follow-up or reconciliation task.
- **Scenario:** a hypothetical planning result, never a promise.
- **Advisory:** architecture or audit input, not an adopted repository authority.

## Employment, payroll, and compensation

| ID | Item | Source status | Intended canonical destination | Intended consumer/use | Current state or blocker |
|---|---|---|---|---|---|
| EMP-001 | Employer, employment grade, and employment dates | Observed | Standing employment facts | Records and compensation context | Preserved in synthesis; not on `main` |
| EMP-002 | Effective-dated base-salary history; current salary $158,091 | Observed | Effective-dated income facts | Payroll calendar and income scenarios | Preserved; current engine uses a simpler net deposit |
| EMP-003 | Semi-monthly-to-biweekly conversion and 26-pay cadence | Observed | Payroll schedule | Shared event calendar and cash forecast | Preserved; not absorbed |
| EMP-004 | Current $6,080.42 gross and observed $4,248–$4,275 recurring net range | Observed | Dated payroll observations | Near-term cash forecast and payroll reconciliation | Preserved; net range must not become a timeless guarantee |
| EMP-005 | 2024–2026 bonus payouts and late-February cadence | Observed | Dated bonus observations plus bonus-plan terms | Cash scenarios and statutory-deduction model | Preserved; future bonus remains variable |
| EMP-006 | CPP, CPP2, and EI completion dates and deposit-year rule | Observed/calculated | Statutory-deduction history/rules | Payroll engine | Preserved; no per-deposit statutory model yet |
| EMP-007 | 2024 and 2025 T4 reconciliation | Observed | Tax-year employment summaries | Records and annual reconciliation | Preserved; must not overwrite base salary |
| EMP-008 | Annual raise occurs around March 1; recent raises remembered as 4–5% | Owner-stated pattern/history | Attributed evidence beside compensation history | Calendar context only | Current evidence shows 2026 effective date Feb 22; no future percentage may be hard-coded |

## Pension and retirement

| ID | Item | Source status | Intended canonical destination | Intended consumer/use | Current state or blocker |
|---|---|---|---|---|---|
| PEN-001 | Seaspan DCPP plan profile, dates, vesting, and retirement dates | Observed | Standing pension facts | Records and retirement modelling | Preserved; not on `main` |
| PEN-002 | $144,365.95 balance as of 2026-08-12 and earlier dated balances | Observed | Dated positions | Net worth and retirement windows | Preserved; pensions currently excluded from live net worth |
| PEN-003 | 100% SL Granite 2050 allocation | Observed | Dated investment allocation | Retirement/risk context | Preserved; no change recommended solely from recent returns |
| PEN-004 | Required 5%, optional 1%, and employer 6% current election | Observed | Effective-dated contribution elections | Payroll and retirement modelling | Preserved; optional election history varies |
| PEN-005 | 2025, Q1 2026, and H1 2026 account movements | Observed/calculated | Position and contribution history | Reconciliation and retirement trend | Preserved; no history consumer yet |
| PEN-006 | Historical YTD, 3-month, 1/2/3/5-year returns | Observed | Historical performance observations | Context only | Preserved; must not become forecast return automatically |
| PEN-007 | Ramp employee contribution about 1 point annually toward 12% | Proposed policy | Versioned household retirement policy | Scenario and recommendation engine | Conditional on cash, revolving debt, HELOC pressure, and reserves |
| PEN-008 | Age-60 projections under 3%, 5%, and 7% return scenarios | Scenario | Scenario runs | Retirement comparison | Preserved; incomplete without taxes, inflation, CPP, Amanda assets, and caps |
| PEN-009 | Withdrawal start and Granite 2045 versus 2050 | Question | Open questions | Retirement policy decision | Requires owner decision before fund reconsideration |
| PEN-010 | Spouse/beneficiary inconsistencies | Action/question | Owner action record | Reminder only | Must be corrected directly with Sun Life; never automated |
| PEN-011 | Dale initially did not know the current employee percentage/plan ceiling | Historical owner-stated unknown | Superseded evidence trail | Provenance only | Later payroll/plan evidence establishes current 5% required + 1% optional; future ceiling still requires plan evidence |

## Bills, utilities, and reminders

| ID | Item | Source status | Intended canonical destination | Intended consumer/use | Current state or blocker |
|---|---|---|---|---|---|
| BILL-HYD-001 | BC Hydro $234 equal-payment schedule | Observed | Effective-dated bill schedule | Cash forecast | Preserved; not on `main` |
| BILL-HYD-002 | August balance forward, new charges, late fee, and $451.24 due | Observed | Invoice and obligation observations | Reconciliation and next-due | Whether account is current remains unresolved |
| BILL-HYD-003 | Twelve-month consumption/cost history | Observed/calculated | Utility history | Norms, seasonality, and future schedule review | Preserved; must remain distinct from equal-payment cash schedule |
| BILL-HYD-004 | September 2025 $1,115.71 catch-up | Observed | Non-recurring reconciliation event | Historical analysis | Must not be treated as the monthly norm |
| BILL-FOR-001 | FortisBC $124 equal-payment schedule | Observed | Effective-dated bill schedule | Cash forecast | Preserved; not on `main` |
| BILL-FOR-002 | Latest $32.37 actual cost for 1.4 GJ and annual history | Observed/calculated | Utility invoice/history | Seasonality and schedule review | Preserved; distinct from $124 cash schedule |
| BILL-FOR-003 | September 2026 equal-payment review | Action | Dated reminder/action | Reminder and bill update | Future result unknown until statement arrives |
| BILL-ROG-001 | Rogers Xfinity Premier 2G contract and $78.40 bill | Observed | Bill contract, schedule, and invoice | Cash forecast and records | Preserved; payment reconciliation still required |
| BILL-ROG-002 | $80 ValuePlan discount expiring 2027-12-28 | Observed | Contract term | Reminder/look-ahead | Preserved; no live reminder consumer |
| BILL-ROG-003 | 2027-09-29 and 2027-11-28 review dates | Calculated/action | Dated reminders | Reminder engine/calendar | Preserved; delivery unimplemented |
| BILL-ROG-004 | Approximate $168 post-promotion bill if other terms stay fixed | Scenario/estimate | Scenario input | Look-ahead only | Must remain visibly conditional |
| BILL-ROG-005 | Historical Shaw merchant label versus Rogers owner statement | Previously conflicting evidence, now current bill observed | Provider identity history plus current contract | Records and bill schedule | August bill establishes current Rogers-together-with-Shaw/Rogers Xfinity service; do not rewrite historical merchant evidence |
| BILL-OTH-001 | Bell Mobility about $150/month | Owner-stated estimate | Proposed bill fact pending evidence | Budget completeness | Exact amount unresolved |
| BILL-OTH-002 | Telus amount/route, garbage provider/cadence/amount | Question | Open questions | Bill completeness | No sufficient current evidence |
| BILL-OTH-003 | BCAA and ICBC coverage overlap | Question | Existing account-fact question | Recommendation after clarification | Dale to confirm intent/coverage |
| BILL-SUB-001 | $250 subscription cap and PayPal audit request | Proposed policy/action | Proposed target plus audit queue | Budget/norms after transaction audit | Subscription identities and totals must come from evidence |

## Mortgage, HELOC, and property obligations

| ID | Item | Source status | Intended canonical destination | Intended consumer/use | Current state or blocker |
|---|---|---|---|---|---|
| MTG-001 | $559,281.35 mortgage position at 2025-12-31 | Observed | Mortgage position history | Records, trend, renewal | Preserved; must not overwrite later balance |
| MTG-002 | 3.64% variable rate basis, $1,600 biweekly payment, 2027-05-01 maturity | Observed | Standing mortgage terms | Forecast and renewal model | Mostly corroborates existing Atlas terms |
| MTG-003 | 2025 principal $18,178.10 and interest $23,421.90 | Observed/calculated | Mortgage payment history | Trend and reconciliation | Preserved; no structured history consumer yet |
| MTG-004 | $97,200 annual prepayment privilege and current-term fees/rules | Observed | Contract terms | Prepayment/renewal scenarios | Do not assume terms survive renewal |
| HELOC-001 | July opening/closing balance and 99.23% statement utilization | Observed | HELOC position history | Debt trend and risk | Preserved; later Atlas balance remains current |
| HELOC-002 | 4.90% rate, $202,654 limit, and $814.18 July interest | Observed | Standing terms plus dated interest charge | Debt projection | Preserved; interest is capitalized in current model |
| HELOC-003 | July advances/charges, credits, and $4,117.85 net increase | Observed/calculated | Private transaction reconciliation plus aggregate history | Debt and transfer analysis | Private counterparties remain local-only |
| HELOC-004 | $814.18 minimum shown due 2026-08-21 | Observed/action | Dated obligation with reconciliation state | Cash forecast, next-due, reminders | High-priority blocker: payment/funding not confirmed |
| TAX-001 | $5,639.67 property-tax draw funded through HELOC | Observed | Reconciled annual expense plus funding source | Reserve planning | Future cash reserve needed to avoid repeat borrowing |
| MTG-005 | May 2027 renewal and possible HELOC consolidation | Action/scenario | Long-range plan event | Renewal modeller and recommendation engine | Keep visible; future terms unknown |

## Household goals, preferences, and commitments

| ID | Item | Source status | Intended canonical destination | Intended consumer/use | Current state or blocker |
|---|---|---|---|---|---|
| HH-001 | Restaurants/takeout $600/month | Amanda-stated proposed policy | Proposed household budget target | Budget and norms after approval | Supersedes Amanda's earlier $800 statement; not joint policy |
| HH-002 | Sports about $10,000/year or $385 per Dale payday | Amanda-stated proposed policy | Proposed sinking-fund target | Goal funding and cash scenarios | Live budget still uses a lower generic allowance |
| HH-003 | Travel $15,000/year | Amanda-stated proposed policy | Proposed sinking-fund target | Goal funding and scenarios | Distinct from historical travel spending |
| HH-004 | Health buffer $100/month and personal/flexible $600/month | Amanda-stated proposed policy | Proposed budget targets | Budget scenarios | Awaiting household decision |
| HH-005 | $500 cash-floor preference | Amanda-stated proposed policy | Proposed buffer policy | Recommendation engine | Must be reconciled with current modelling default and Dale's view |
| HH-006 | Protect sports/travel before aggressive extra debt repayment | Amanda-stated priority | Proposed household policy | Recommendation ordering/scenarios | Conflicts with live debt-first ordering; owner decision required |
| HH-007 | Garage/dental-lab rent treated as ended | Amanda-stated planning instruction | Effective-dated income status | Cash forecast | Historical facts remain; planning treatment should be dated |
| HH-008 | Coaching revenue separate until obligations are handled | Amanda-stated boundary | Business/pass-through policy | Household cash and income classification | Only actual household transfers become household cash |
| HH-009 | No additional missing Amanda account | Amanda-stated evidence | Attributed evidence beside transaction question | Reconciliation context | Does not by itself resolve unexplained $186.16 movement |
| HH-011 | Groceries $1,800/month, excluding dog food | Amanda-stated proposed policy | Proposed household budget target and category definition | Budget/norms after approval | Retains routine household consumables; not joint policy |
| HH-012 | Gas/normal transportation $1,300/month | Amanda-stated proposed policy | Proposed household budget target | Budget/norms after approval | Excludes tournament travel and vehicle maintenance |
| HH-013 | Kids clothing/shoes/cleats $150/month | Amanda-stated proposed policy | Proposed kids sinking-fund target | Budget and goal funding | Seasonal spending; not joint policy |
| HH-014 | Vehicle maintenance $200/month or $2,400/year | Amanda-stated proposed policy | Proposed reserve target | Goal funding and vehicle planning | No known major repair currently due |
| HH-015 | Dog food $100 biweekly and vet about $300/year | Owner-stated plus estimate | Proposed pet schedule/reserve | Budget and goal funding | Dog food is outside groceries; vet remains estimated |
| HH-016 | School $210/year, swimming about $360/year, tutoring excluded | Owner-stated/estimate/exclusion | Kids schedules, reserve, and dated exclusion | Budget/goal funding | Add tutoring only if restarted |
| HH-017 | Christmas $5,000–$6,000/year | Amanda-stated estimate/target | Proposed annual sinking fund | Goal funding | Replaces an earlier unrealistic $1,200 assumption only after approval |
| HH-018 | Birthdays and other gifts about $3,350/year | Amanda-stated/calculated estimate | Proposed annual sinking fund | Goal funding | Seasonal/irregular, not a monthly actual |
| HH-019 | Property-tax planning target $6,000/year | Amanda-stated proposed policy | Proposed reserve target | Goal funding | Stronger actual is $5,639.67; target and actual answer different questions |
| HH-020 | Home-insurance recollection about $3,000/year | Owner-stated rounded estimate | Attributed evidence only | Context | Verified current amount $3,131.76 remains financial authority |
| HH-021 | DIY exterior painting $700–$1,200 in fall 2026 | Conditional estimate | Proposed home commitment/scenario | Cash scenario | Not a quote; timing and amount remain flexible |
| HH-022 | Downstairs couch $1,700, preferred Nov–Dec 2026 | Amanda-stated likely purchase | Proposed commitment | Cash scenario | $0 currently saved; explicitly delayable |
| HH-023 | Combined food behavior: groceries plus restaurants/takeout | Amanda-stated analytical preference | Proposed analysis rule | Budget/norms analysis | Does not merge the categories' accounting identities |
| HH-024 | Free $500–$1,000/month by cutting discretionary items before sports/travel | Amanda-stated tradeoff | Proposed scenario/policy | Recommendation scenarios | Not adopted household ordering |
| HH-025 | Desired 12-month outcome: pre-funded sports/travel/irregulars, less stress, declining debt | Amanda-stated success definition | Proposed household outcome | Plan evaluation and scenarios | Awaiting Dale's corresponding view and joint adoption |
| SPORT-001 | Historical Fusion/Burrards program totals and disputed $527.80 | Transaction-derived finding/question | Sports history plus reconciliation question | Historical norms | Disputed payment must not be double-counted |
| TRAVEL-001 | Seattle and Tacoma estimates $700–$950 each | Conditional estimate | Tournament scenarios | Goal funding and cash scenarios | Conditional on selection; not posted spending |
| TRAVEL-002 | Indio estimate $5,260–$5,460 before points | Conditional estimate | Tournament scenario | Goal funding and cash scenarios | Airfare cash cost may change with points |
| TRAVEL-003 | One or two additional tournaments | Unknown/optional | Scenario placeholder/question | Goal planning | No amount or date until evidence exists |
| COMMIT-001 | Fusion camp $786 | Owner-stated status plus matching amount | Commitment/payment reconciliation | Cash forecast | Amanda says paid; live plan says upcoming |
| COMMIT-002 | Tryouts $140, Burrards $623, Warriors about $800 | Owner-stated/estimated commitments | Dated commitments | Cash forecast and reminders | Evidence/timing varies by item |
| COMMIT-003 | Fusion travel-team fee about $2,000+ | Conditional estimate | Proposed commitment | Scenario only | Selection and exact amount unknown |
| COMMIT-004 | Three live-plan Fusion installments of $500 | Existing plan records/question | Commitment reconciliation | Cash forecast | Relationship to travel-team/season fees remains unresolved |
| HH-010 | Emergency reserve, Amanda retirement/RESP, Dale policy view | Question | Open questions | Household policy | Not captured sufficiently yet |

## Transactions, evidence coverage, and ingestion

| ID | Item | Source status | Intended canonical destination | Intended consumer/use | Current state or blocker |
|---|---|---|---|---|---|
| TXN-001 | 4,762 transactions across 48 statements and multiple providers | Calculated coverage summary | Coverage metadata | Trust/records | Current repo claim; complete raw-file coverage still unverified |
| TXN-002 | Subscription and recurring-charge candidates from email/PayPal | Observed candidate evidence | Merchant/subscription audit queue | Budget/norms after reconciliation | Candidate identity is not yet canonical truth |
| TXN-003 | Interac, Fusion, Coinbase, Wise, and Yakima evidence | Observed/reconciliation findings | Private ledger plus questions/actions | Transfer, asset, and commitment analysis | Several movements remain unresolved; private details stay local |
| TXN-004 | Transaction identity, pending lifecycle, and idempotent import gaps | Advisory finding/action | Ingestion backlog/strategy | Future trusted import | Not yet complete |
| TXN-005 | Original PDFs, screenshots, payroll files, and exports | Private source evidence | Local ignored `raw/` plus private backup | Replay/rebuild only | Must never enter Git; owner placement/backup outstanding |

## Architecture, audits, and owner intent

| ID | Item | Source status | Intended canonical destination | Intended consumer/use | Current state or blocker |
|---|---|---|---|---|---|
| ARC-001 | All supplied information must be used or explicitly parked | Owner product intent | Future architecture rule after adoption | Intake receipt/evidence-use proof | Preserved; implementation undecided |
| ARC-002 | One fact/one home, one plan/many windows, engine decides/pages explain | Existing direction plus owner intent | `ARCHITECTURE.md` if clarification is adopted | Entire system | Direction exists; implementation incomplete |
| ARC-003 | Copilot architecture game plan | Advisory proposal | Dated advisory record only | Architecture decision input | Must not become a second roadmap |
| ARC-004 | Engine-lineage audit and 1,134-row inventory | Advisory audit evidence | Dated advisory record | Baseline and migration verification | Snapshot of `main` at the recorded SHA |
| ARC-005 | External architecture reviews supplied by the owner | Advisory review evidence | Decision table/dated review synthesis | Architecture deliberation | Consensus and disagreements preserved in conversation capture |
| ARC-006 | Confidence-vocabulary unification | Advisory finding plus owner-reserved decision | Existing trust contract and source-method mapping | Validation and publication | Mapping not approved |
| ARC-007 | Evidence-use ledger/intake receipt first versus fact schema first | Architecture decision | Existing architecture/build strategy | Sequencing | Owner decision required after review reconciliation |
| ARC-008 | Generated `data.json` after fact/policy split and parity proof | Advisory destination | Future architecture/cutover | Publication | Not authorized now |
| ARC-009 | Generated copilot export versus live API | Architecture/security decision | Future copilot contract | Chat interface | API would be security-relevant and owner-gated |

## Coverage verdict

Every material data group gathered in this work now has a recorded disposition. This is a preservation proof only. Most rows remain **captured but not absorbed** because their canonical destinations or consumers do not yet exist, are incomplete, or require an owner/household decision.

### Source-to-ledger coverage map

| Source record | Covered by ledger IDs |
|---|---|
| Employment and pension synthesis — employment, salary, payroll, bonus, statutory deductions, T4 | `EMP-001`–`EMP-008` |
| Employment and pension synthesis — plan profile, positions, elections, movements, performance, scenarios, questions | `PEN-001`–`PEN-011` |
| Household bill synthesis — Hydro | `BILL-HYD-001`–`BILL-HYD-004` |
| Household bill synthesis — FortisBC | `BILL-FOR-001`–`BILL-FOR-003` |
| Household bill synthesis — Rogers contract, invoice, expiry, reminders, provider history | `BILL-ROG-001`–`BILL-ROG-005` |
| Mortgage/HELOC synthesis — mortgage positions, terms, reconciliation, privileges, renewal | `MTG-001`–`MTG-005` |
| Mortgage/HELOC synthesis — HELOC position, terms, activity, minimum | `HELOC-001`–`HELOC-004`, `TAX-001` |
| Amanda interview, August 10 — monthly preferences, kids, sports, travel, gifts, home, vehicles, medical, pets | `HH-001`–`HH-025`, `SPORT-001`, `TRAVEL-001`–`TRAVEL-003`, `COMMIT-001`–`COMMIT-004` |
| Amanda interview, August 12 — priorities, tradeoffs, supersessions, income/account rules, bills, watchlist, open questions | `HH-001`–`HH-025`, `BILL-OTH-001`–`BILL-OTH-003`, `BILL-SUB-001`, `COMMIT-001`–`COMMIT-004` |
| Dale interview, August 12 — raise/bonus/statutory patterns, pension intent/unknowns, internet statement | `EMP-005`, `EMP-006`, `EMP-008`, `PEN-007`, `PEN-011`, `BILL-ROG-005` |
| Transaction/email reconciliation and raw coverage | `TXN-001`–`TXN-005` |
| Architecture plan, audits, reviews, owner product intent | `ARC-001`–`ARC-009` |

The material heading/table cross-check is complete. Exact future canonicalization can split a grouped ledger row into smaller fact IDs, but it may not drop the source labels, uncertainty, supersession, or unresolved blockers recorded here.
