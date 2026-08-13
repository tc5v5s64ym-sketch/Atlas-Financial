# Atlas Financial Copilot - Architecture Game Plan

**Status:** Dated advisory design proposal; not adopted and not a sequencing authority  
**Prepared:** August 13, 2026  
**Product owner:** Dale  
**Scope:** Turn raw household financial evidence into one traceable, deterministic master financial plan and an evidence-backed financial copilot

## Authority note

This document is an implementation proposal. It does not create a second source
of architectural authority. If adopted into the Atlas Financial repository, the
approved product rules belong in `ARCHITECTURE.md`, sequencing belongs in
`docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md`, current work state belongs in
`BACKLOG.md`, and this document should either be folded into those authorities
or retained only as a dated design record.

## 1. The outcome

Atlas will become a household financial operating system that:

1. accepts financial evidence from statements, exports, invoices, emails,
   screenshots, interviews and owner decisions;
2. extracts facts without treating extraction as truth;
3. reconciles those facts against existing accounts, transactions, contracts,
   obligations and prior observations;
4. gives every fact one canonical home;
5. routes every fact to each relevant deterministic financial engine;
6. produces one grand household financial plan;
7. exposes different time horizons as windows onto that same plan;
8. explains recommendations conversationally without allowing AI or a page to
   invent financial truth;
9. proves which source evidence supports every material answer; and
10. reports any fact that is unused, stale, contradictory or awaiting a human
    decision.

The product contract is:

> Atlas must ingest household financial evidence, convert it into a
> provenance-backed and effective-dated financial model, reconcile it against
> existing truth, route every fact to the appropriate engines, and prove which
> forecasts, recommendations, reminders, scenarios and views it affects.

## 2. Non-negotiable rules

### One fact, one canonical home

A fact is stored according to what it means, not according to which page wants
to show it. Multiple consumers reference the same fact. They do not copy it.

### One plan, many windows

The 14-day, 91-day, 9-month, 12-month, mortgage-renewal and retirement views are
different spans of the same dated plan. They are not separate forecasts with
separate assumptions.

### The deterministic engine decides

Financial arithmetic, classifications, constraints, recommendations and
verdicts live in tested engine code. Website pages and ChatGPT render and
explain engine outputs.

### AI never becomes financial truth

AI may:

- extract candidate observations;
- suggest classifications;
- explain results;
- identify contradictions;
- ask targeted questions; and
- describe scenarios returned by deterministic engines.

AI may not:

- silently create or overwrite a verified fact;
- calculate the authoritative forecast itself;
- promote one person's preference to household policy;
- treat an estimate as confirmed;
- make transactions or change institution settings; or
- bypass reconciliation and approval gates.

### Provenance and time travel with the fact

Every material fact retains:

- its source;
- observation date;
- effective date or period;
- verification status;
- confidence;
- supersession history;
- household/person/business scope; and
- derivation path when calculated.

### Raw financial evidence remains private

Raw statements, PDFs, exports and identifiers stay outside Git. Sanitized facts,
aggregates, opaque identities and derived publications may be committed.

### Files remain the current foundation

This design is logical, not a pre-authorization for PostgreSQL, Supabase or any
other database. Atlas should first implement identity, provenance, routing and
no-orphan guarantees with its current repository-native files. A store is
introduced only after the existing architecture's gate is demonstrably met.

## 3. End-to-end system

```text
RAW EVIDENCE
Bank exports | card statements | payroll | pension | bills | emails
Mortgage/HELOC | invoices | screenshots | interviews | owner decisions
                                |
                                v
SOURCE REGISTRY
Opaque source ID | type | dates | hash | coverage | privacy | ingestion status
                                |
                                v
EXTRACTION
Candidate observations | deterministic parser version | validation results
                                |
                                v
RECONCILIATION AND CLASSIFICATION
Account match | duplicate detection | transfer match | obligation fulfilment
Conflict detection | effective dating | confidence | household scope
                                |
                                v
CANONICAL FINANCIAL MODEL
Ledger | accounts | positions | debts | income | bills/contracts
Assets | pensions | goals | policies | questions | actions
                                |
                                v
SHARED FINANCIAL EVENT TIMELINE
Posted | pending | scheduled | estimated | proposed | scenario
                                |
              +-----------------+------------------+
              |                 |                  |
              v                 v                  v
        CASH-FLOW ENGINE    DEBT ENGINE       BUDGET ENGINE
        RETIREMENT ENGINE   GOAL ENGINE       REMINDER ENGINE
        NET-WORTH ENGINE    SCENARIO ENGINE   HEALTH/RISK ENGINE
              |                 |                  |
              +-----------------+------------------+
                                |
                                v
ONE MASTER PLAN SNAPSHOT
Position | norms | obligations | horizons | risks | tradeoffs | next actions
                                |
                    +-----------+-----------+
                    |                       |
                    v                       v
                 WEBSITE              CHATGPT COPILOT
               visual inspection      query and explanation
```

## 4. The six truth stages

Atlas must not confuse these stages:

| Stage | Meaning | Example |
|---|---|---|
| Source evidence | The original artifact | Sun Life statement PDF |
| Candidate observation | What a parser believes it found | Balance appears to be $144,365.95 |
| Canonical fact | Reconciled financial truth | Pension balance $144,365.95 observed 2026-08-12 |
| Planned event | A future event produced from facts | Next pension deduction on payday |
| Derived result | Deterministic calculation | Age-60 pension scenario |
| Presentation | Human-facing wording or chart | Retirement card on the website |

A source is not a fact. A fact is not automatically a plan event. A plan event
is not a derived recommendation. A rendered sentence is never an authority.

## 5. Canonical financial domains

### 5.1 Source registry

One record per evidence artifact:

- `source_id`;
- source type;
- institution/provider;
- statement or coverage period;
- observed/received date;
- private locator or safe repository path;
- content hash or fingerprint where safe;
- parser and parser version;
- privacy classification;
- ingestion status; and
- reconciliation summary.

The registry proves that a source was processed. It does not store sensitive
payloads in Git.

### 5.2 Accounts and ownership

One identity per financial account or facility:

- `account_id`;
- institution;
- account type;
- owner/entity: Dale, Amanda, Household or Business;
- currency;
- cash classification;
- open/closed status; and
- safe opaque external identity.

This domain prevents renamed statement labels from creating duplicate accounts.

### 5.3 Transaction ledger

One canonical record per posted or pending movement:

- `transaction_id`;
- account;
- posted and effective dates;
- amount and currency;
- pending/posted/corrected status;
- merchant/payee classification;
- category;
- transfer group;
- household-consumption treatment;
- linked debt, bill, goal or income stream;
- source observation; and
- reconciliation status.

A transfer is a movement, not automatically income or spending.

### 5.4 Positions

Dated snapshots rather than timeless balances:

- cash balance;
- card balance;
- available credit;
- mortgage principal;
- HELOC balance;
- pension balance;
- RESP balance;
- investment value; and
- other assets or liabilities.

New snapshots never erase history.

### 5.5 Debt terms and obligations

Separate stable terms from changing balances and dated payments:

- rate and rate basis;
- limit;
- compounding convention;
- secured/unsecured status;
- minimum-payment rules;
- payment frequency;
- statement close and due dates;
- penalty-rate conditions;
- maturity or renewal;
- prepayment terms; and
- dated minimum obligations.

### 5.6 Income and compensation

Keep separate:

- effective-dated base salary;
- pay cadence;
- gross payroll events;
- statutory deductions;
- net deposit observations;
- bonus plan;
- bonus observations and scenarios;
- business revenue;
- business expenses;
- actual household transfers; and
- benefits or reimbursements.

Salary, T4 income, bonus, business revenue and household cash are not
interchangeable.

### 5.7 Bills and contracts

Model four distinct things:

1. contract terms;
2. recurring schedule;
3. individual invoice;
4. actual payment.

This allows Atlas to know that Rogers currently costs $78.40, the ValuePlan
promotion expires December 28, 2027, an invoice was issued, and a payment later
fulfilled it - without counting the bill twice.

### 5.8 Assets, pension and investments

Separate:

- account identity;
- dated balance;
- contribution rules;
- contribution observations;
- employer contributions;
- current investment allocation;
- historical performance;
- assumed future return scenarios;
- vesting/locking rules;
- retirement dates; and
- beneficiary or maintenance actions.

Historical returns never silently become forecast assumptions.

### 5.9 Goals, preferences and household policy

Goals are planning constraints, not ledger entries:

- goal ID and description;
- person or household scope;
- speaker/source;
- proposed/approved status;
- priority;
- target amount or outcome;
- target date;
- flexibility;
- funding rule;
- conditions;
- conflicts; and
- review date.

Amanda's preference remains Amanda's evidence until a joint-policy gate promotes
it. Atlas may still show its scenario impact before approval.

### 5.10 Questions and actions

An unknown fact and a work item are different:

- a question needs a human answer;
- an action needs someone to do something;
- a reminder needs a date and resolution state; and
- a data-quality issue needs reconciliation.

Each remains visible until explicitly resolved.

## 6. How routing works

The router classifies a candidate observation by meaning:

| Observation | Canonical owner | Typical consumers |
|---|---|---|
| Merchant purchase | Ledger | Budget, norms, cutback analysis |
| Card interest charge | Ledger linked to debt | Interest trends, debt projection |
| Card balance | Position history | Net worth, utilization, debt plan |
| Card rate | Debt terms | Interest and payoff engines |
| Card minimum | Dated obligation | Cash forecast, reminders |
| Card payment | Transfer/payment event | Cash and debt reconciliation |
| Utility invoice | Invoice observation | Bill reconciliation |
| Utility recurring amount | Bill schedule | Forecast and budget |
| Promotion expiry | Contract term | Reminder and long-range scenario |
| Salary | Employment facts | Payroll generator |
| Payroll deposit | Income event | Cash flow and reconciliation |
| Pension contribution | Payroll plus asset event | Cash flow and retirement |
| Pension balance | Position history | Net worth and retirement |
| Travel target | Goal/policy | Sinking fund and scenario engine |
| Household priority | Approved policy | Recommendation ordering |

Routing must be deterministic wherever possible. AI can propose a route, but a
schema validator and domain-specific rules decide whether it is permitted.

## 7. Stable identities tie the streams together

The system joins domains through IDs rather than repeated labels:

- `source_id`;
- `account_id`;
- `transaction_id`;
- `transfer_group_id`;
- `position_id`;
- `debt_id`;
- `obligation_id`;
- `bill_id`;
- `income_stream_id`;
- `pension_id`;
- `goal_id`;
- `policy_id`;
- `scenario_id`; and
- `plan_run_id`.

Example:

```text
Restaurant purchase
  transaction_id: txn_...
  account_id: visa_cashback
  debt_id: cashback
  category_id: restaurants
  household_consumption: true
```

The purchase affects spending and the card balance. The later card payment is a
different transaction linked to the same debt and a transfer group. It reduces
cash and debt but does not create a second restaurant expense.

## 8. The shared event timeline

All planning engines consume one normalized event stream:

| Event state | Meaning |
|---|---|
| Posted | Settled and part of history |
| Pending | Institution reports it but it may change |
| Scheduled | Contract or rule produces it |
| Estimated | Expected amount/date with uncertainty |
| Proposed | A person's suggested plan input |
| Approved | Household planning policy |
| Scenario | Temporary what-if input |
| Cancelled/superseded | Retained historically but not active |

Every event declares its effects:

- cash in/out;
- debt up/down;
- asset up/down;
- income;
- consumption category;
- tax/statutory effect;
- goal funding;
- fulfilment of an obligation; and
- confidence.

This is the seam that lets one event participate in several engines without
being copied.

## 9. Deterministic domain engines

### Cash-flow engine

Produces:

- daily balances;
- low points;
- funding gaps;
- safe-to-spend;
- required buffers;
- income deadlines; and
- horizon comparisons.

### Budget and norms engine

Produces:

- historical category norms;
- seasonal patterns;
- essential/discretionary/reserve classifications;
- owner-target comparisons;
- unusual-spending signals;
- dated-item deductions to prevent double counting; and
- realistic cutback candidates.

### Debt engine

Produces:

- balance projections;
- interest costs;
- utilization;
- minimum-payment calendars;
- payoff comparisons;
- over-limit and penalty-rate risks;
- repayment ordering; and
- mortgage/HELOC renewal scenarios.

### Asset and net-worth engine

Produces:

- dated net worth;
- liquid versus restricted assets;
- household versus business position;
- secured-debt ratios; and
- stale/missing valuation warnings.

### Retirement engine

Produces:

- pension contribution history;
- employer-match value;
- age-60 and age-65 scenarios;
- 3%, 5% and 7% net-return scenarios;
- contribution-ramp comparisons;
- target-date-fund alignment;
- retirement-income readiness; and
- maintenance/beneficiary actions.

### Goals and sinking-fund engine

Produces:

- required monthly funding;
- progress;
- conflicts between goals;
- earliest achievable dates;
- consequences of delay;
- proposed-versus-approved comparisons; and
- which goals are threatened by current cash/debt conditions.

### Reminder and contract engine

Produces:

- bill and payment reminders;
- statement due dates;
- promotion expiries;
- insurance/property-tax renewals;
- mortgage renewal checkpoints;
- pension maintenance actions;
- evidence refresh requests; and
- resolution state.

### Recommendation engine

Consumes outputs from the other engines and applies an explicit policy:

- protect mandatory obligations;
- respect approved household priorities;
- hold the required buffer;
- prevent avoidable penalties and over-limit conditions;
- fund essential life;
- address dangerous debt growth;
- fund approved goals; and
- compare the marginal value of the next dollar.

The recommendation policy must be explicit, versioned and labelled as either
derived or owner-approved.

## 10. The master plan

The master plan is a generated snapshot, not a manually written document.

Each run records:

- `plan_run_id`;
- as-of date and time;
- source/fact-set version;
- engine version;
- scenario;
- household-policy version;
- horizons generated;
- unresolved conflicts;
- stale inputs; and
- output evidence links.

The master picture contains:

1. **Current position**
   - cash, assets, debts, net worth and available credit.
2. **Normal household operation**
   - income, bills, spending norms, fees and interest.
3. **Committed future**
   - dated obligations, contracts, goals and known purchases.
4. **Forecast**
   - 14-day, 91-day, 9-month, 12-month, renewal and retirement windows.
5. **Risk**
   - cash gaps, over-limit conditions, missed payments, stale evidence and
     unfunded goals.
6. **Recommendation**
   - what to do next, what the next dollar should do, and why.
7. **Tradeoffs**
   - what changes under alternative inputs.
8. **Confidence**
   - verified, calculated, estimated and unknown inputs/results.

## 11. The copilot contract

ChatGPT is an interface to the master plan, not a second planner.

The copilot may answer:

- What needs attention today?
- What is coming in 30, 90, 270 or 365 days?
- What can we safely spend?
- Why did safe-to-spend change?
- Where should the next dollar go?
- What happens if pension contributions rise by 1%?
- Can the household afford a trip or sports commitment?
- What happens at the May 1, 2027 mortgage renewal?
- Which bills or contracts need attention?
- What data is missing, contradictory or stale?
- Which recommendation is based on an estimate?

Every answer returns:

- the engine result;
- as-of date;
- scenario;
- supporting facts;
- assumptions;
- confidence;
- unresolved blockers; and
- links or IDs for source-to-answer traceability.

## 12. Intake receipt

Every new source produces a use receipt:

```text
Source: Sun Life statement
Status: reconciled

Candidate observations: 18
Canonical facts created: 5
Canonical facts updated: 7
Duplicates: 4
Conflicts: 1
Questions created: 1

Affected outputs:
  changed  Net worth
  changed  Retirement forecast
  changed  Contribution scenarios
  changed  Payroll deduction model
  created  Beneficiary action
  no effect  91-day bill calendar

Unconsumed facts: 0
```

The receipt is the user's proof that upload did not mean storage-only.

## 13. Required safeguards

### No-orphan gate

Every canonical fact must end in one of:

- named engine consumer;
- named presentation/evidence consumer;
- unresolved question;
- required action/reminder;
- explicit exclusion with reason and review date.

CI fails on anything else.

### One-authority gate

CI fails when two records claim to be active authority for the same fact and
effective period.

### Reconciliation gate

CI checks:

- pending-to-posted identity;
- transfer pairing;
- invoice-to-payment fulfilment;
- cash-out/debt-down equality;
- opening plus movements equals closing;
- no duplicate imports; and
- no double-counted bill/category amounts.

### Impact gate

Changing a load-bearing fact in a test fixture must change every expected
downstream output. If changing salary does not move the pay calendar, the fact
is not connected.

### Freshness gate

Balances, rates, bills and time-sensitive assumptions carry freshness rules.
Stale facts remain visible but cannot masquerade as current.

### Privacy gate

Tracked output rejects:

- account numbers;
- addresses;
- tax identifiers;
- credentials;
- raw statement payloads; and
- private transaction descriptions that are not required for the plan.

## 14. How current Atlas maps to the destination

| Current component | Current role | Destination |
|---|---|---|
| `raw/` | Local source evidence | Remains immutable/private |
| `scripts/` | Extraction and analysis | Versioned deterministic ingestion |
| `derived/` | Local intermediates | Rebuildable normalized observations |
| `docs/ACCOUNT_FACTS.md` | Standing facts | Migrated/compiled into canonical facts |
| `docs/positions.csv` | Account positions | Dated canonical position history |
| interview files | Attributed human evidence | Goal/policy proposals and questions |
| `public/periods.json` | Spending aggregates | Derived ledger projections |
| `data.json` | Hand-curated publication | Generated publication from canonical state |
| `public/forecast.js` | Current planning engine | Expanded domain/master-plan engine |
| page scripts | Rendering plus remaining decisions | Render-only consumers |
| written master picture | Manual narrative | Generated master-plan summary |

The migration must preserve working behaviour while replacing manual authority
one slice at a time.

## 15. Implementation campaign

Every PR must deliver one independently provable outcome. Do not stack a giant
migration.

### PR 1 - Fact and source contract

Deliver:

- source schema;
- observation schema;
- canonical fact schema;
- status and confidence vocabulary;
- effective dating;
- supersession;
- privacy rules;
- consumer declarations; and
- schema validation.

Proof:

- representative salary, pension, bill, debt, balance, goal and transaction
  fixtures validate;
- invalid or ownerless facts fail.

### PR 2 - No-orphan and one-authority gates

Deliver:

- fact-to-consumer manifest;
- duplicate-authority detection;
- stale-fact detection; and
- CI report.

Proof:

- orphan, overlapping active fact and missing review date mutations fail.

### PR 3 - Source registry and intake receipt

Deliver:

- opaque source identity;
- source fingerprint;
- parser version;
- ingestion summary; and
- human-readable use receipt.

Proof:

- same source imported twice is detected;
- no sensitive identifier enters tracked output.

### PR 4 - Canonical transaction identity and reconciliation

Deliver:

- stable transaction identity;
- pending/posting lifecycle;
- transfer pairing;
- account identity;
- idempotent import; and
- safe local completeness report.

Proof:

- repeated import produces zero new transactions;
- transfers do not become spending;
- corrections retain history.

This PR must satisfy the repository's existing store gate before selecting any
database. If files can meet the invariants, files remain the implementation.

### PR 5 - Shared event timeline

Deliver:

- normalized event effects;
- obligation fulfilment;
- event states;
- payer/account scope;
- recurrence expansion; and
- one schedule authority.

Proof:

- forecast calendar, upcoming list and ICS reconcile to the same events.

### PR 6 - Employment and payroll activation

Deliver:

- effective salary history;
- biweekly schedule;
- bonus events;
- CPP/CPP2/EI annual limits;
- pension payroll deductions; and
- 91-day, 9-month and 12-month income views.

Proof:

- statutory deductions stop at verified thresholds;
- three-paycheque months appear;
- salary and election mutations move net pay.

### PR 7 - Pension and retirement activation

Deliver:

- dated pension positions;
- employee/employer contributions;
- election history;
- allocation;
- retirement dates;
- return scenarios;
- net-worth integration; and
- beneficiary/maintenance actions.

Proof:

- pension balance changes net worth and retirement results;
- optional contributions change cash and retirement together;
- historical returns do not alter forecast assumptions.

### PR 8 - Bills, contracts and reminders

Deliver:

- recurring schedules;
- invoices;
- payments;
- reconciliations;
- promotion/renewal terms;
- payer scope; and
- reminder resolution.

Proof:

- Rogers 90-day and 30-day reminders generate;
- invoices and payments do not double count;
- Hydro/Fortis equal-payment reconciliations remain separate from normal bills.

### PR 9 - Debt and renewal unification

Deliver:

- debt terms and position history;
- minimum obligations;
- actual payment links;
- interest treatment;
- payoff;
- utilization;
- penalty states; and
- mortgage/HELOC renewal scenarios.

Proof:

- HELOC cash payment versus capitalization is explicit;
- cash-out equals debt-down;
- balance, rate and limit mutations reach every relevant result.

### PR 10 - Goals, priorities and household policy

Deliver:

- proposed versus approved state;
- speaker attribution;
- joint-policy gate;
- sinking-fund rules;
- priority/flexibility; and
- scenario-only use of unapproved preferences.

Proof:

- Amanda-only evidence cannot silently change household policy;
- approval moves the expected master-plan outputs.

### PR 11 - Master-plan composer

Deliver:

- one plan run;
- shared assumptions;
- many horizons;
- current position;
- risks;
- goals;
- recommendations;
- confidence; and
- evidence graph.

Proof:

- all horizons reconcile;
- changing one input updates every affected window;
- no page-side financial decisions remain.

### PR 12 - Copilot query contract

Deliver:

- structured read-only plan API;
- evidence-backed responses;
- scenario requests routed to deterministic engines;
- uncertainty and stale-data disclosure; and
- source/answer trace.

Proof:

- website and copilot return the same underlying answer;
- AI wording cannot alter figures or policy.

### PR 13 - Generated master picture and migration cleanup

Deliver:

- generated master-picture Markdown/page;
- generated open questions/actions;
- generated publication;
- deletion of superseded manual authorities; and
- migration reconciliation report.

Proof:

- no duplicate active authority remains;
- every legacy live data point has a disposition;
- every previously supplied source synthesis has been activated or explicitly
  routed to a question/exclusion/review.

## 16. Current evidence migration list

The migration must include, at minimum:

- all current `data.json` leaves;
- generated transaction/period history;
- account positions and standing facts;
- mortgage and HELOC evidence;
- credit-card statements, rates, balances, payments and interest;
- employment, salary, bonus and payroll evidence;
- CPP, CPP2 and EI seasonality;
- pension balances, contribution elections and performance observations;
- Hydro, Fortis and Rogers evidence;
- Rogers promotion reminders;
- Amanda and Dale interview evidence;
- life goals, targets, priorities and unresolved disagreements;
- sports, travel, Christmas, taxes, insurance and other sinking funds;
- existing questions, reminders and actions; and
- every sanitized source-intake document already committed.

Each item receives a migration disposition:

- canonicalized and consumed;
- duplicate of a stronger source;
- superseded;
- proposed policy awaiting approval;
- unresolved question;
- excluded with reason and review date; or
- source evidence requiring local reconciliation.

## 17. Concrete cross-domain examples

### Credit-card purchase

A restaurant purchase:

- is one ledger expense;
- increases the card debt;
- affects restaurant norms;
- affects discretionary-room analysis;
- affects future interest and minimum estimates;
- reduces safe-to-spend; and
- may delay goal funding.

The later card payment moves cash to debt and does not create new spending.

### Pension payday

One payroll event:

- records gross income;
- applies tax/CPP/CPP2/EI;
- reduces cash for employee pension contributions;
- increases the pension for employee and employer contributions;
- produces net cash;
- updates retirement projections; and
- changes the optional-contribution-versus-debt tradeoff.

### Rogers contract

One contract:

- creates the $78.40 monthly schedule;
- links future invoices and payments;
- generates September 29 and November 28, 2027 reminders;
- creates a post-promotion price-risk scenario; and
- affects long-range safe-to-spend.

### Mortgage and HELOC

The mortgage and HELOC share secured-property exposure but retain separate debt
identities, rates, payments and amortization rules. The renewal engine can test
consolidation without overwriting the baseline plan.

### Travel goal

An approved travel goal:

- creates a required sinking-fund path;
- competes with debt repayment and other goals;
- constrains safe-to-spend;
- appears in 9- and 12-month windows; and
- can be scenario-tested without pretending the trip is already booked.

## 18. Definition of done

Atlas is ready to claim it is an all-encompassing financial copilot only when:

- every source produces an intake receipt;
- every canonical fact has provenance and time semantics;
- every fact has a consumer, question, action, exclusion or review;
- every major answer traces back to source evidence;
- every source traces forward to its effects;
- transaction import is idempotent;
- pending/posting and transfers cannot double count;
- all schedule surfaces share one event authority;
- all financial verdicts live in tested engines;
- every horizon comes from the same plan run;
- household and individual policy remain distinct;
- stale or estimated inputs are unmistakable;
- the website and copilot cannot disagree;
- the master picture is generated from current truth;
- raw PII remains outside Git; and
- changing a load-bearing fact breaks a test until every expected result is
  updated.

## 19. Immediate next move

The first implementation outcome is:

> Build the fact/source schema and no-orphan contract, then import the current
> repository state as the baseline inventory without changing published
> financial answers.

That foundation creates the proof system required for every later domain. It
lets Atlas start parsing existing evidence immediately while preventing
storage-only ingestion, duplicate authority and silent disconnection from the
master plan.
