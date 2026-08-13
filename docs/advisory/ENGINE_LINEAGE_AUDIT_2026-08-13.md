# Atlas Financial Engine-Feeding Audit

**Status:** Dated advisory audit; not a fact, architecture, sequencing, or backlog authority  
**Audit date:** 2026-08-13  
**Audited branch:** `main` at `957ed62fb6bd5e058505ecde60c78aaf3a7491f6`  
**Repository:** `tc5v5s64ym-sketch/Atlas-Financial`  
**Scope:** repository-wide authority, provenance, ingestion, forecast, reminders, recommendations, look-ahead, pages, and tests  
**Companion inventory:** `Atlas_Data_Point_Inventory_2026-08-13.csv` enumerates every one of the 1,134 scalar values currently published in `data.json`.

## Executive verdict

Atlas has a real central forecast engine and substantial test coverage, but it does **not yet satisfy the no-orphan requirement** that every supplied fact either changes the master plan or has an explicit, tested reason not to.

The current state is:

- **Engine-fed:** the 91-day plan block, debts, mortgage, HELOC limit, and one look-ahead path.
- **Rendered but not plan-fed:** balance-sheet assets, net worth, historical income analysis, cash-flow analysis, PayPal, lacrosse, unexplained flows, counterparties, coaching analysis, and most forensic findings.
- **Preserved but not integrated:** the new verified employment, payroll, pension, Hydro, Fortis, Rogers, and promotion-expiry evidence.
- **Evidence awaiting joint-policy decisions:** several targets from Amanda's interviews.
- **Duplicated or drifting:** bills, dated events, open questions, and three schedule/look-ahead surfaces.
- **Not auditable from Git alone:** private raw transactions and statements, which are deliberately gitignored.

The two supplied source syntheses are preserved on branch `agent/preserve-financial-source-syntheses`, commit `c29358977e229a02dbb2689066aa1fc351195511`. They are intentionally marked as source intake rather than canonical authority, so they cannot silently become a second home for the same facts.

## What was inspected

- All 119 tracked repository files and the complete recursive tree.
- All 118 tracked text files other than `package-lock.json`, totalling about 1.70 million characters.
- Every browser page and page script.
- The full forecast engine.
- Every extraction, categorisation, publication, calendar, position, and verification script.
- Architecture, context, account facts, positions, interviews, master picture, requirements, backlog, open questions, and tests.
- Every scalar published in `data.json` (1,134 leaves).

This audit distinguishes four states that were previously easy to conflate:

| State | Meaning |
|---|---|
| Engine-fed | A value can change a forecast, recommendation, mission, calendar event, renewal result, or payoff result. |
| Rendered | A page shows the value, but it does not alter the master-plan answer. |
| Preserved | Evidence exists in the repository, but no canonical live model consumes it yet. |
| Missing | The fact is absent or only available in private raw data outside Git. |

## Current data flow

`raw/` and statements are local and gitignored. Extraction and categorisation scripts create derived material. A manually curated `data.json` and generated `public/periods.json` are loaded by the browser. `public/forecast.js` produces most planning answers, and the pages render those answers.

The intended architecture is sound:

`raw evidence → extraction/reconciliation → canonical facts → publication → forecast engine → pages/reminders/recommendations`

The weak link is the handoff into canonical facts and `data.json`. Most extraction scripts produce analysis or derived files; they do not update a governed fact registry or publication model. This makes integration dependent on a human remembering to copy a fact into every place that currently duplicates it.

## Runtime data disposition

| Runtime section | Current role | Master-plan effect | Audit finding |
|---|---|---:|---|
| `data.json.plan` | 91-day cash plan | Yes | Main engine input; 492 published leaves. |
| `data.json.debts` | Debt balances, rates, limits | Yes | Drives projection, payoff, mission, and renewal. |
| `data.json.mortgage` | Mortgage terms | Yes | Drives renewal and debt analysis. |
| `data.json.helocLimit` | HELOC constraint | Yes | Drives limit-crossing and mission logic. |
| `data.json.upcoming` | Hand-kept dated list | Partial | Drives `Forecast.nextDue`, while another forecast calendar answers a similar question from `plan`. |
| `public/periods.json` | Generated aggregate spending history | Yes | Drives budget history and category planning; individual raw events are not published. |
| `headline` | Summary tiles | No | Display only. |
| top-level `commitments` | Forensic/longer-horizon commitment summary | No | Separate from `plan.commitments`; duplication risk. |
| `assets`, `netWorth` | Balance sheet | No | Records page only; pension is missing. |
| `helocHistory`, `helocUse`, `helocChains` | Historical analysis | Mostly no | Rendered and partly referenced by page-side logic; not a governed forecast input. |
| `cashflow`, top-level `income` | Historical analysis | No | Does not drive the live income calendar. |
| `interestCheck` | Card-rate reconciliation | No | Deep Dive only, with some verdict logic still in the page. |
| `paypal`, `lacrosse`, `counterparties`, `coachPayment`, `unexplained` | Forensic evidence | No | Valuable analysis, but no explicit master-plan disposition. |
| `questions` | Displayed open questions | No | Separate from `docs/01_OPEN_QUESTIONS.md`; drift exists. |
| `coverage` | Data-source coverage table | No | Records page only. |

The companion CSV records this disposition for all 1,134 live scalar values. It is a baseline inventory, not the desired permanent architecture: the permanent answer should be generated by CI from a fact registry and explicit consumer declarations.

## New evidence: exact integration status

### Employment and payroll

| Fact | Correct canonical home | Required consumer | Live status |
|---|---|---|---|
| Base salary `$158,091`, effective 2026-02-22 | Effective-dated employment facts | Payroll generator and scenarios | Missing from main. |
| Gross biweekly pay `$6,080.42` | Derived payroll schedule | Income calendar | Missing. |
| Observed current net `$4,247.92–$4,274.98`, average about `$4,264` | Dated payroll observations | Forecast calibration | Missing; live plan still uses `$4,468.69`. |
| Biweekly cadence and anchor | Employment fact | Forecast event expansion | Cadence exists, but amount/source lineage is stale. |
| Three-paycheque months | Generated pay calendar | 9/12-month outlook | Not implemented because the live window is only 91 days. |
| Bonus history and late-February timing | Dated income observations | Annual scenario engine | Missing. |
| Bonus target/upside up to 20% | Scenario assumption, never confirmed income | Annual scenario engine | Missing. |
| CPP/EI/CPP2 per-deposit max behaviour | Payroll rules with year tables | Net-pay engine | Missing; no statutory payroll engine. |
| T4 values | Tax-year evidence | Reconciliation, not salary authority | Preserved only in source intake. |

### Pension

| Fact | Correct canonical home | Required consumer | Live status |
|---|---|---|---|
| Sun Life DCPP balance `$144,365.95` as of 2026-08-12 | Dated position snapshot | Net worth and retirement modeller | Missing; master picture explicitly omits pensions. |
| Required employee 5%, optional 1%, employer 6% | Effective-dated contribution rules | Payroll and retirement engine | Missing. |
| Optional 1% began 2026-06-19 | Effective-dated election | Payroll engine | Missing. |
| Planned conditional ramp to 18% combined | Owner planning policy | Scenario engine with debt/cash-flow gate | Missing. |
| 100% Granite 2050 | Dated allocation fact | Retirement-risk display | Missing. |
| Historical returns and fees | Dated observations | Performance display only | Missing; must never become the base forecast by accident. |
| Retirement dates and age-60/65 comparisons | Plan facts and scenarios | Retirement modeller | Missing. |
| Beneficiary/spouse inconsistencies | Open action | Reminder/action engine | Missing. |

### Utilities and Rogers

| Fact | Correct canonical home | Required consumer | Live status |
|---|---|---|---|
| Hydro equal payment `$234/month` | Effective-dated bill schedule | Full-household forecast | Known in evidence but deliberately absent from household-account forecast because Amanda pays it. |
| Hydro amount due `$451.24` and `$3.45` late fee | Invoice/payment observations | Reconciliation and action engine | Missing; payment status unresolved. |
| Hydro annual usage/cost and `$1,115.71` 2025 catch-up | Historical utility observations | Seasonality and anomaly logic | Missing. |
| Fortis equal payment `$124/month` | Effective-dated bill schedule | Forecast | Present only as a transaction-derived recurring bill. |
| Fortis September 2026 reconciliation | Expected event/open action | Reminder and update workflow | Missing. |
| Rogers current `$78.40/month` | Effective-dated bill schedule | Forecast | Amount/day present as “Shaw”; source terms and brand are missing. |
| Rogers ValuePlan expiry 2027-12-28 | Contract term | Reminder/look-ahead engine | Missing. |
| Rogers 90-day review 2027-09-29 | Derived reminder | Reminder engine and calendar | Missing. |
| Rogers 30-day escalation 2027-11-28 | Derived reminder | Reminder engine and calendar | Missing. |
| Post-promotion estimate about `$168/month` | Scenario, not confirmed bill | Long-range risk scenario | Missing. |

## Amanda interview evidence

The two interview files are properly treated as evidence rather than automatically as joint policy. Several values do not yet feed the live plan:

- restaurants `$600/month`, superseding the current `$800`;
- subscriptions `$250/month`;
- combined personal/flexible `$600/month`;
- health `$100/month`;
- sports about `$10,000/year`;
- travel `$15,000/year`;
- Christmas `$5,000–$6,000/year`;
- additional named reserves and conditional items.

Verified facts can be integrated directly with provenance. A preference from one household member must remain “proposed” until the repository's stated joint-policy gate is met. Atlas should still preserve, surface, and scenario-test proposed values; it should not silently promote them to approved household policy.

## Transaction history and repository boundary

The repository records 4,762 transactions and 48 statements in publication metadata. `scripts/periods.js` reads local raw/derived sources, categorises merchants through `merchant-library.csv`, and produces aggregate `derived/periods.json` and `public/periods.json`.

What the repository can prove:

- the aggregate spending history is consumed by budget logic;
- recurring patterns informed several manually authored plan values;
- positions and some summaries have cross-file invariants;
- raw PII is intentionally kept out of Git.

What the repository cannot prove by itself:

- every raw transaction has a stable identity;
- every raw transaction was imported once and only once;
- every source record has an explicit reconciliation/disposition;
- every utility payment was matched before a recurring bill was added;
- no private statement is missing from the local raw set.

This is not a reason to commit raw financial records. It requires a **local, privacy-preserving ingestion audit** that emits counts, hashes/opaque IDs, duplicates, unmatched records, and reconciliation status without publishing account identifiers or transaction descriptions. Backlog B78 already points toward stable import identity, but it is queued rather than complete.

## Drift and duplicate-authority findings

### Three schedules answer overlapping questions

1. `data.json.plan` → `Forecast.expandEvents` → on-page calendar.
2. `data.json.upcoming` → `Forecast.nextDue` and Deep Dive.
3. `scripts/calendar-ics.js` → `derived/household-payments.ics`.

They are not reconciled. The ICS script hardcodes dates/amounts independently, includes reminders the forecast does not model, and currently has no Rogers promotion reminder. Backlog B74 documents the problem but it remains unresolved.

### Recurring bills have multiple homes

`docs/ACCOUNT_FACTS.md`, transaction-derived notes in `data.json.plan.bills`, and `scripts/calendar-ics.js` all carry bill knowledge. Fortis is day 3 in the live plan but a different schedule appears in the calendar script. Rogers is still labelled Shaw. Hydro is real household spending but excluded from the household-account forecast. The model needs explicit payer/account scope rather than omission as the only representation of who pays.

### Open questions have two homes

`docs/01_OPEN_QUESTIONS.md` and `data.json.questions` can drift. The Markdown file contains stale questions already answered elsewhere, including older MBNA and home-value gaps. Open questions should have stable IDs and be published from one registry.

### Master picture is not a live master plan

`docs/00_MASTER_PICTURE.md` says its narrative is being rebuilt and that headline figures are superseded. It omits pensions. It is not generated from the engine, so updating `data.json` does not guarantee that the “master picture” changes. It should become a generated or tested projection of canonical facts, not a separate narrative authority.

## Remaining page-side financial authority

Backlog B73 remains open. Five of eight groups moved into the engine, but three groups remain:

1. Plan-page derived household totals: next-payment-out, reserve-window/unallocated cash, compact debt/interest/HELOC trend snapshot, and food/fuel subtotals.
2. Plan-page phase titles and risk-list selection/calculation.
3. Deep Dive derived totals and interest reconciliation, including page-chosen tolerance/rate literals and a hardcoded mortgage monthly figure.

Mutation evidence shows existing tests pass when several of these page-side financial decisions are deliberately broken. Until they move behind tested engine functions, “engine decides, pages render” is not fully true.

## Provenance and test-coverage gaps

All current plan income, obligations, bills, commitments, and debts carry some confidence labelling, but they generally lack structured source pointers, effective-date ranges, supersession links, reconciliation state, and consumer declarations.

Current tests provide many valuable numerical invariants, but the authority-coverage test only verifies a small declared set of engine exports, policy blocks, banned page calculators, and publication writers. It does not:

- enumerate every nested fact;
- require each fact to declare a canonical home;
- require a source and effective date;
- prove a fact reaches an engine output;
- reject an unconsumed fact;
- reconcile the three schedule surfaces;
- detect stale narrative or open-question duplication;
- exercise private raw-ingestion completeness.

The existing top-level orphan scan proves only that a top-level key name appears somewhere in code. It cannot prove that the 1,134 nested values are load-bearing.

## Target implementation

Atlas needs one governed fact graph, not more hand-maintained prose copies. A practical repository-native design is:

### 1. Source registry

One record per evidence item:

- opaque source ID;
- source type and evidence date;
- private locator or safe repository path;
- coverage period;
- extraction version;
- privacy classification;
- content hash where safe;
- ingestion and reconciliation status.

### 2. Canonical fact registry

One record per fact or effective-dated series:

- stable fact ID;
- subject and field;
- value, units, currency, cadence;
- effective-from/effective-to or observed-at;
- source IDs and evidence strength;
- status: verified, estimated, proposed, approved policy, scenario, derived, superseded, unresolved;
- payer/account scope;
- supersedes/superseded-by;
- privacy classification.

Salary, payroll deposits, bonus, deductions, pension elections, balances, recurring bills, invoices, payments, promotion terms, and reminders are different fact types and must remain separate.

### 3. Explicit derivation and consumer registry

Every derived value declares:

- input fact IDs;
- code owner/function;
- output ID;
- consumers;
- refresh trigger;
- test ID.

Every canonical fact must end in exactly one of:

- consumed by a named derivation/engine output;
- rendered as evidence by a named page;
- held as an unresolved question/action;
- intentionally excluded with an explicit reason and review date.

CI should fail on a fifth state: orphaned.

### 4. Generated publication

`data.json`, `public/periods.json`, the ICS calendar, reminder events, Records derivations, and the master-picture summary should be generated from the registries. Hand-authored policy prose can remain, but all figures and dates should be referenced by ID or generated.

### 5. Multiple plan horizons from one event stream

Generate 91-day, 9-month, 12-month, retirement, and renewal views from the same effective-dated facts:

- biweekly payroll calendar with three-paycheque months;
- deposit-year CPP/CPP2/EI maxima;
- separate bonus event/scenarios;
- utility schedules and reconciliations;
- contract/promotion reminders;
- annual/seasonal reserves;
- pension balance and contribution scenarios;
- debt and renewal projections.

This prevents “everything affects everything” from turning into every page reimplementing everything. Facts feed one event/derivation graph; each view selects a horizon.

## Recommended pull-request sequence

Each PR should have one independently provable outcome.

1. **Preserve source intake** — already committed on `agent/preserve-financial-source-syntheses`; review and merge without treating it as live authority.
2. **Add fact/source schema and no-orphan manifest** — include JSON Schema, IDs, statuses, source privacy rules, effective dating, supersession, consumer declarations, and a CI audit. Import the current 1,134-leaf inventory as the baseline.
3. **Migrate employment and payroll** — effective-dated salary, observed net deposits, biweekly calendar, bonus events, CPP/CPP2/EI rule engine, and 91-day/9-month/12-month tests.
4. **Migrate pension** — dated balance, contributions, election history, allocation, retirement dates, scenario returns, net-worth integration, and beneficiary actions.
5. **Migrate bills and reconciliation** — Hydro, Fortis, Rogers, payer/account scope, invoice-vs-payment separation, EPP reconciliations, and duplicate protection.
6. **Unify schedules and reminders** — one event stream generates forecast calendar, upcoming list, ICS, Rogers 90/30-day reminders, Fortis review, pension actions, and other look-ahead.
7. **Resolve Amanda policy deltas** — store proposed targets immediately, collect only the joint approvals needed, then generate budget policy and scenario comparisons.
8. **Move the three remaining B73 authority groups** — engine functions plus mutation-catching tests.
9. **Generate master picture and open questions** — replace duplicate narrative/query authorities with tested generated views.
10. **Run the local raw-ingestion audit** — stable opaque identities, duplicate detection, unmatched/reconciliation report, and safe aggregate attestation committed without PII.

## Completion gates

Atlas should not call this complete until:

- every canonical fact has a source or a documented derivation;
- every effective fact has a date range or observation date;
- every fact has a named consumer, question, exclusion, or review action;
- no page computes household-facing financial verdicts;
- every schedule view reconciles to the same event stream;
- all reminders are generated and have resolution state;
- new evidence changes the expected forecast/test snapshots;
- the master picture is generated or checked against live facts;
- the local ingestion audit reports zero unexplained duplicate imports;
- raw PII remains outside Git.

## Addendum - mortgage and HELOC statements received August 13

Two additional TD statements were inspected visually and reconciled against the
live model:

- The December 31, 2025 mortgage statement confirms a $559,281.35 dated
  balance, 3.64% variable rate at TD Mortgage Prime minus 0.96 percentage
  points, $1,600 biweekly payment, May 1, 2027 maturity, $97,200 annual
  prepayment privilege, and 2025 payments split into $18,178.10 principal and
  $23,421.90 interest. The later $546,026.58 Atlas balance remains the current
  observation.
- The July 31, 2026 HELOC statement confirms a $201,085.16 closing balance,
  $202,654 limit, $1,568.84 available, 4.90% rate, $814.18 July interest,
  $15,117.85 of advances/charges, $11,000 of credits, and $4,117.85 net balance
  growth. The later $201,586.16 Atlas balance remains the current observation.
- The $5,639.67 Maple Ridge property-tax draw was already classified and
  documented correctly in Atlas.
- A new high-priority reconciliation gap was found: TD displays an $814.18
  minimum due August 21 even though Atlas currently treats the July interest
  solely as a non-cash capitalized event. Until the payment or funding account
  is verified, the conservative cash plan must reserve $814.18 rather than
  assume no cash leaves.

The sanitized semantic extraction is preserved locally in
`Atlas_Financial_Mortgage_HELOC_Source_Facts.md` and committed as a separate
evidence slice on branch
`agent/preserve-mortgage-heloc-source-synthesis`, commit
`cabac38200cb676ec93054d60b6aa3e4ab054c2a`.

## Immediate truth

The new evidence is no longer at risk of being forgotten because the two sanitized source syntheses are committed on a dedicated branch. It is **not yet feeding the live Atlas engine**. The next implementation outcome should be the fact/source schema and no-orphan CI contract; without that foundation, copying the new numbers directly into `data.json` would update today’s screen while preserving the same structural risk that caused this concern.
