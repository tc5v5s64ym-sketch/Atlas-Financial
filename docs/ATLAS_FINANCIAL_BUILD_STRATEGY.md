# Atlas Financial — Build Strategy

**Repository:** `tc5v5s64ym-sketch/Atlas-Financial`  
**Status:** living execution strategy  
**Owner:** Dale  
**Architecture / dispatch authority:** ChatGPT  
**Implementation surface:** owner-approved agent (Claude Code, Codex, Cursor, or equivalent)  
**Primary rule:** current repository state beats this plan.

---

## 1. Purpose

Atlas Financial is being built as a **household financial operating system**.

Its job is not to become a generic finance dashboard or to recreate ChatGPT inside the app. It should know the household's financial state extremely well, calculate financial truth deterministically, make the near and long horizon obvious, and give Dale and Amanda enough warning to make small corrections before money problems become large ones.

The product should ultimately answer, in plain language:

1. Where are we right now?
2. Where is our money actually going?
3. What can we safely spend?
4. What is coming, and can we afford it?
5. What should we change?
6. What happens if we choose something different?

The intended product relationship is closer to **checking the weather** than doing accounting.

Example:

> **Good week.**  
> $816 safe through Sunday.  
> Mortgage Wednesday; payday Friday.  
> Sports registration Monday.  
> Nothing needs attention.

Or:

> **Tight week.**  
> Household spending is already 72% through target.  
> $2,100 of sports fees is due Monday.  
> Keep discretionary spending below $140 through Friday and the plan stays intact.

Atlas must be **ruthless about truth and flexible about life**.

It should not optimize for minimum possible spending. It should optimize for a financially sustainable version of the life the household actually values.

---

## 2. Product boundary

### Atlas owns

- canonical financial facts;
- provenance;
- account and transaction identity;
- household/business boundaries;
- classifications and household overrides;
- balances, debt and limits;
- recurring obligations;
- planned commitments;
- goals;
- household policy;
- deterministic budgets;
- safe-to-spend;
- deterministic forecasts and scenarios;
- reconciliation and data health;
- calendar/publication state.

### Conversational assistants own

- conversation;
- explanation;
- interpretation;
- current outside research;
- recommendation;
- translating natural-language intent into **proposed** structured changes.

An assistant never becomes the ledger, calculator, or canonical mutation authority.

Do **not** build another "Soul" layer. Preserve durable conclusions, not a bespoke imitation of a good chat session.

---

## 3. Permanent engineering thesis

> More agent autonomy comes from a smaller box.

> One PR = one independently provable outcome.

> One financial concept = one canonical owner + one canonical representation + one mutation path.

> Source evidence is preserved.

> Derived state is rebuildable.

> Views consume truth; they do not define it.

> Machines validate closed structure. Reviewers validate meaning.

Every future PR must answer:

1. What household capability becomes true because this merges?
2. Which financial authority does it own or consume?
3. Did it create another place that decides something already owned elsewhere?
4. What proves the full source → truth → calculation → consumer path works?
5. What happens with missing, stale, duplicated or contradictory evidence?
6. Could a plausible-but-wrong number still go green?
7. If this is foundation work, which named next consumer closes the loop?

---

## 4. Model-selection gate

Model choice is an **execution-cost decision**, not an authority decision. Model identity grants no extra merge or product authority.

Model names change quickly. Record the exact model name displayed by the implementation surface; never guess.

### ECONOMY tier — default

Use the current owner-approved lower-cost capable coding model. At strategy creation, **Claude Sonnet 5** is the preferred Claude Code economy model.

Default ECONOMY work:

- documentation-only changes;
- small deterministic tests;
- fixtures;
- straightforward schema additions after authority is already settled;
- simple adapters against an already-defined contract;
- UI rendering that consumes an existing deterministic API;
- housekeeping and mechanical migrations with complete proof.

### FRONTIER tier — escalate when judgment is the risk

Use the owner-approved strongest available model when one or more escalation triggers fires. Record the exact displayed model name rather than guessing or hardcoding a marketing name that the implementation surface does not expose.

FRONTIER triggers:

- a canonical financial authority is being created, moved, deleted, or reconciled;
- money semantics are ambiguous;
- a migration/cutover can create two live truths;
- security/credentials/authentication boundaries change;
- provider synchronization semantics are uncertain;
- safe-to-spend, forecast, debt strategy, or another household-acted-on figure changes authority;
- multiple legitimate designs survive current-state audit;
- a model has failed to close the same root cause after two implementation/review rounds;
- the implementation agent proposes an atomicity exception;
- the PR has substantial cross-layer coupling;
- a failed acceptance campaign reveals an authority defect rather than a local bug.

### Model-switch rule

Start with the recommended model listed for the PR.

The agent may move **ECONOMY → FRONTIER** without owner interruption when a FRONTIER trigger is hit, but must record:

- trigger;
- model switched from;
- model switched to;
- why the cheaper model was no longer appropriate.

Do not downgrade FRONTIER → ECONOMY mid-PR merely to save tokens after architecture has become ambiguous. Finish the independently provable outcome with the model tier that can safely close it.

At every trajectory review, reassess whether the current model tiers still make sense.

---

## 5. Strategy flexibility — controlled, not rigid

This file is a **living execution strategy**, not scripture.

A future PR prompt is permission to inspect current state, **not permission to manufacture work**.

Before every PR:

1. refresh exact current `main`;
2. record starting SHA;
3. confirm clean worktree;
4. run `npm test`;
5. read `AGENTS.md`, `CLAUDE.md`, this strategy, relevant authority docs, current code, `BACKLOG.md`, and `docs/01_OPEN_QUESTIONS.md`;
6. classify the planned PR outcome as:
   - STILL NEEDED;
   - ALREADY SATISFIED;
   - PARTIALLY SATISFIED;
   - STALE / SUPERSEDED;
   - NEEDS OWNER ANSWER.
7. If already satisfied, **stop and skip it**.
8. If the intended outcome is wrong for current state, stop and route to a trajectory review rather than implementing the stale prompt.

### Strategy-change threshold

Do not rewrite this strategy for every small discovery.

A dedicated strategy-update PR is justified when:

- a phase goal changes;
- more than two future PRs need reordering or replacement;
- an assumed technology is no longer appropriate;
- a newly discovered authority changes the architecture;
- a phase acceptance gate shows the planned next phase is not the highest-value next move;
- a model-tier policy materially changes.

Small implementation discoveries belong in backlog/finding dispositions, not a roadmap rewrite.

---

## 6. Trajectory review gates

At each named gate, STOP implementation and review:

- exact current `main`;
- this strategy;
- `BACKLOG.md`;
- `docs/01_OPEN_QUESTIONS.md`;
- household actions / urgent real-world financial findings;
- completed phase acceptance evidence;
- what the phase taught us;
- whether the next phase is still the highest-value next move.

Classify future planned PRs:

- KEEP;
- REWRITE;
- MOVE;
- MERGE;
- SPLIT;
- SKIP — ALREADY SATISFIED;
- DELETE;
- ADD.

A trajectory review may change future PR numbering/content through a dedicated strategy-update PR.

### Gate T0 — after authority/governance foundation
After PR #6.

### Gate T1 — after "Know Us"
After PR #15 acceptance.

### Gate T2 — first product-complete release
After Safe-to-Spend shadow acceptance following PR #19.

**This is the strongest gate in the plan.**  
Phases 3–6 must re-earn their priority here.

### Gate T3 — after Horizon / Calendar
After PR #24 acceptance.

### Gate T4 — after Live Daily Data
After PR #28 acceptance.

### Gate T5 — after Conversational Interface
After PR #32 acceptance.

---

## 7. Golden Household

Atlas will maintain one synthetic **Golden Household** dataset containing the ugly financial cases this system must survive without exposing real household data in Git or CI.

Minimum corpus:

- multiple chequing/savings accounts;
- credit card;
- HELOC/debt;
- recurring salary/income;
- internal transfers;
- credit-card payments;
- business/pass-through money;
- refunds;
- fees and interest;
- two legitimate identical merchant/date/amount purchases;
- duplicate file import;
- partial import then retry;
- pending → posted amount/date/ID change;
- disappearing pending transaction;
- user classification override followed by re-import;
- annual irregular expense;
- sports commitment;
- unknown transaction;
- planned vacation;
- low-cash week;
- provider/account external-ID change;
- stale source;
- reconciliation mismatch;
- malicious transaction memo treated as inert data.

Every money-touching PR must prove that its intended change does not silently corrupt unrelated Golden Household truths.

Real household data:

- may be processed through explicitly approved private/local paths;
- never enters Git;
- never becomes CI fixture data;
- never appears in PR bodies, issues, logs, or synthetic test corpora;
- never becomes the only proof of a financial invariant.

---

# PHASE 0 — TRUST THE BUILD

## PR #4 — Install this Build Strategy

**Recommended model:** ECONOMY / Sonnet 5  
**Escalate if:** current governance says a second strategy authority would conflict with `ARCHITECTURE.md` or `CLAUDE.md`.

### Why

Capture the product destination, ordered execution sequence, model gates, trajectory reviews, Golden Household requirement, and every future PR prompt inside the repo so the build does not depend on chat history.

### Acceptance

One authoritative strategy exists, current governance points to it where necessary, and it does not duplicate `BACKLOG.md`, architecture authority, or owner-question authority.

### Prompt

```text
You are implementing Atlas Financial PR #4: install the repo-owned Build Strategy.

Repository: tc5v5s64ym-sketch/Atlas-Financial

HARD GATE:
Start from fresh current main. Record SHA, clean worktree, npm test.
Read AGENTS.md, CLAUDE.md, ARCHITECTURE.md, BACKLOG.md, docs/01_OPEN_QUESTIONS.md and current planning/governance docs.

ONE OUTCOME:
Install one authoritative Atlas Financial Build Strategy containing:
- product destination;
- permanent authority principles;
- model-selection/escalation gate;
- Golden Household requirement;
- trajectory-review gates;
- ordered future PRs with copy/paste prompts;
- phase acceptance campaigns.

Do not create a second backlog, second architecture authority, or second governance system.
If an equivalent build-strategy home already exists, extend/replace it instead of duplicating it.

NON-GOALS:
No product code.
No financial figure change.
No database.
No UI.
No backlog cleanup except references needed to make the strategy truthful.

PROOF:
References resolve; npm test green; docs do not claim conflicting homes.

This changes product direction and requires exact-head Atlas Contract / Systems Review.
Stop review-ready. Do not start PR #5.
```

---

## PR #5 — Financial Cohesion & Authority Contract

**Recommended model:** FRONTIER  
**Why model:** this decides the semantics future agents must obey.

### Why

Atlas already has facts in statements, derived files, `data.json`, `periods.json`, docs, forecast code and pages. Future transaction ingestion, goals, calendar and assistants will multiply those surfaces. This PR defines which layer is allowed to decide what.

### Backlog connection

Current backlog has repeated examples of plausible-but-wrong interpretation:
- transfer/card-payment confusion;
- PayPal conversion double counting;
- business/pass-through ambiguity;
- fee abbreviations;
- missing accounts;
- historical averages vs owner budget targets.

### Acceptance

A reviewer can identify CURRENT owner, INTENDED owner, consumers and conflicts for every important household-acted-on concept.

### Prompt

```text
You are implementing PR #5: Financial Cohesion & Authority Contract.

ENTRY:
PR #4 merged. Fresh current main; record SHA; clean tree; npm test.
Read the Build Strategy and all authority/governance docs.

ONE OUTCOME:
Install one canonical financial-truth contract:
SOURCE EVIDENCE → OBSERVATION → CANONICAL FACT → RULE/COMMITMENT → DETERMINISTIC PROJECTION → VIEW.

Define:
ONE FINANCIAL CONCEPT = ONE OWNER + ONE REPRESENTATION + ONE MUTATION PATH.

Audit actual current owners for:
cash, balances, debt effective balances, limits/headroom, HELOC interest,
historical spending, budget targets, transfers, recurring obligations,
weekly cap, 30/60/90 forecast, net worth/positions and page consumption.

Record CURRENT / INTENDED / CONSUMERS / CONFLICTS.
Do not refactor product code in this PR.

Must define actual/pending/committed/planned/statistical distinctions,
household vs account cash flow, provenance, user override authority,
provider IDs as aliases, derived-state rebuildability, view-only rendering,
AI explanation without ledger authority, and replace/derive/delete preference.

Machine tests may verify structure/references only; do not pretend regex understands finance prose.

Run npm test.
Required exact-head ChatGPT systems review.
Stop review-ready; do not start PR #6.
```

---

## PR #6 — Executable Authority Registry & Boundary Guard

**Recommended model:** ECONOMY initially  
**Escalate to FRONTIER if:** enforcement requires a new interpretation of financial ownership rather than mechanically encoding PR #5.

### Why

Documentation alone is too easy for the next agent to violate. Encode the smallest closed-form parts of the authority contract.

### Acceptance

At least one real authority-drift class reliably turns red, with mutation proof.

### Prompt

```text
Implement PR #6: Executable Authority Registry & Boundary Guard.

ENTRY:
PR #5 merged. Fresh current main; baseline tests green.

ONE OUTCOME:
Mechanically enforce the smallest truthful subset of the Financial Cohesion & Authority Contract.

Create a machine-readable registry/equivalent describing:
- concept;
- canonical owner;
- allowed consumer/projection;
- provenance class where useful;
- CURRENT / DERIVED / LEGACY status.

Add deterministic guard(s) that catch real structural drift without parsing English.
At minimum prove:
- a second canonical owner turns red;
- removing/duplicating a registered owner turns red;
- one high-risk known boundary cannot quietly move into a page/duplicate store.

Do not build a fake general static analyzer.
No financial behavior change.

Mutation proof required.
npm test green.
Exact-head systems review because authority enforcement changes.
Stop. Run trajectory Gate T0 before PR #7.
```

---

# PHASE 1 — KNOW US

## PR #7 — SQLite Canonical Store Foundation

**Recommended model:** FRONTIER  
**Why model:** choosing the first durable canonical record store is an authority move.

### Why

Use a zero-maintenance relational store early enough to enforce identity, foreign keys, uniqueness and idempotency without operating Postgres. SQLite is allowed to be the long-term answer.

### Acceptance

Fresh DB can be created/migrated deterministically; current published Atlas behavior remains unchanged.

### Prompt

```text
Implement PR #7: SQLite Canonical Store Foundation.

ENTRY:
Gate T0 completed and strategy still says this is next.
Fresh main, tests green, read authority docs.

CURRENT-STATE GATE:
If the repo already has an equivalent canonical relational store with migrations, STOP and route to strategy review.

ONE OUTCOME:
Add a local SQLite canonical-store foundation for future household finance records.

Requirements:
- migration mechanism with immutable applied migrations;
- foreign keys enabled;
- application access layer appropriate to current runtime;
- exact local path/config pattern that never commits real household DB data;
- synthetic disposable DB for tests;
- no production/current data cutover;
- no page behavior change.

Document expand/backfill/switch/contract discipline for future breaking changes.
No Postgres unless current state proves SQLite cannot satisfy this outcome.

TEST:
empty DB → latest schema;
repeated test DB creation;
migration failure red;
real household DB path ignored from git.

This is FOUNDATION — NOT COMPLETION.
Named consumer: PR #8.
Stop review-ready.
```

---

## PR #8 — Canonical Money & Account Identity

**Recommended model:** FRONTIER

### Why

Exact money and stable account identity must exist before transaction truth. External/provider IDs are aliases; amounts carry currency; binary float must not become canonical money.

### Backlog connection

The household has many accounts, unidentified accounts, card/debt facilities, Wise/PayPal and possible future provider reconnections.

### Prompt

```text
Implement PR #8: Canonical Money & Account Identity.

ENTRY:
PR #7 merged; fresh main; tests green.

ONE OUTCOME:
Create load-bearing canonical Money and Account identity contracts in SQLite/domain code.

Money:
- exact minor units or equally exact justified representation;
- explicit currency;
- explicit sign convention;
- reject silent cross-currency arithmetic.

Account:
- immutable Atlas internal ID;
- household/entity ownership boundary;
- type/currency/status;
- external/source identifiers stored as aliases/history, not primary identity;
- ambiguous account mapping must remain unresolved rather than auto-merge.

Record household-originated provenance actor fields from day one where applicable.

PROPERTY/DB TESTS:
exact arithmetic;
currency mismatch;
DB round trip;
external ID changes without new Atlas account;
ambiguous matching does not collapse.

No transactions yet.
No provider API.
Stop review-ready.
```

---

## PR #9 — Golden Household Acceptance Corpus

**Recommended model:** ECONOMY  
**Escalate if:** expected financial truths reveal unresolved semantics rather than fixture construction.

### Why

Install the finance equivalent of a Golden Session before transaction work spreads.

### Prompt

```text
Implement PR #9: Golden Household Acceptance Corpus.

ENTRY:
PR #8 merged; fresh main; tests green.

ONE OUTCOME:
Create one synthetic 18-month Golden Household dataset and an acceptance harness that later money-touching PRs must preserve.

Include the minimum cases named in the Build Strategy:
multiple accounts/debts, transfers, card payments, refunds, identical purchases,
duplicate imports, pending/posted lifecycle, classification override,
annual irregular cost, sports, planned travel, stale source, mismatch, malicious memo.

Define expected canonical truths independently of the implementation under test.
Do not derive expected answers by calling the same production function being tested.

No real household data.
No product behavior change.

Prove at least one deliberate mutant/fixture corruption turns acceptance red.
Stop review-ready.
```

---

## PR #10 — Canonical Transaction & Observation Model

**Recommended model:** FRONTIER

### Why

Atlas needs one answer to “what financially happened?” while preserving “what the source said” separately.

### Prompt

```text
Implement PR #10: Canonical Transaction & Observation Model.

ENTRY:
PR #9 merged; fresh main; Golden Household green.

ONE OUTCOME:
Create one canonical Transaction representation linked to immutable source observations.

Transaction:
- immutable Atlas ID;
- canonical account;
- exact Money;
- authorized/posted dates as distinct where known;
- canonical merchant/description with provenance;
- lifecycle/status representation;
- household/business/economic-role fields only where authority contract permits.

Observation:
- source evidence reference;
- source/provider transaction alias;
- observed status/date/amount/description;
- observed timestamp;
- source relationship fields.

Provider/source IDs are aliases, never Atlas primary identity.
Every canonical transaction must have observation provenance or explicit household-created source class.

Prove two legitimate same-merchant/date/amount purchases remain distinct.
Do not implement transfer pairing or classifications yet.
Stop review-ready.
```

---

## PR #11 — Idempotent Historical Import Pipeline

**Recommended model:** FRONTIER initially

### Why

The revised plan explicitly names the missing bridge from existing 12–18 month exports into canonical state.

### Backlog connection

B16, PayPal/CSV gaps, second-month intake, existing statement/export workflows.

### Prompt

```text
Implement PR #11: Idempotent Historical Import Pipeline.

ENTRY:
PR #10 merged; fresh main; Golden Household green.

ONE OUTCOME:
Import the household's realistically available machine-readable historical formats into immutable observations/canonical records idempotently.

Start from actual supported formats in the repo, prioritizing CSV; add OFX/QFX only if real available source shapes justify them.

Pipeline:
file fingerprint → ingest run → immutable source evidence → deterministic parse →
account mapping → transaction observations/materialization → reconciliation summary → success.

Same artefact N times = same canonical state.
Crash halfway + retry = same final state.
Never dedupe solely by merchant/date/amount.
Malformed rows are explicit, not silently dropped.

Synthetic fixtures in tests only.
Real files remain local/private.
Stop review-ready.
```

---

## PR #12 — Transfer & Double-Count Truth

**Recommended model:** FRONTIER

### Why

Money moving between household accounts is not household consumption. Card payments and HELOC movements must not create fake spending.

### Backlog connection

Resolved $46,657 card payments, Amanda/joint transfers, PayPal funding, B31 chains, B63/B64 business/pass-through routing.

### Prompt

```text
Implement PR #12: Transfer & Double-Count Truth.

ENTRY:
PR #11 merged; fresh main; Golden Household green.

ONE OUTCOME:
Represent internal transfer relationships so account cash flow remains real while household income/spending nets correctly.

Required semantics:
- chequing → savings: account flows ±, household spend/income 0;
- credit-card payment: cash/debt movement, not second household purchase;
- household-boundary crossing is explicit;
- one missing side remains unresolved;
- fuzzy matches produce candidates, not destructive auto-pairing;
- user-confirmed pairing has authority.

Golden Household must prove:
same-amount unrelated transactions do not pair;
card payment does not double count;
account forecast still sees liquidity movement.

Stop review-ready.
```

---

## PR #13 — Classification Authority & Household Override

**Recommended model:** FRONTIER for authority implementation; ECONOMY acceptable if PR #5 already fully specifies precedence and work is mechanical.

### Why

The daily cleanup ritual is useless if imports/models can overwrite household decisions.

### Prompt

```text
Implement PR #13: Classification Authority & Household Override.

ENTRY:
PR #12 merged; fresh main; Golden Household green.

ONE OUTCOME:
Give classification one write authority with provenance/history and durable household override precedence.

Use exact precedence from current authority docs. Expected shape:
HOUSEHOLD/USER > explicit household rule > model/automation > source/provider.

Do not overwrite source evidence.
A household override survives re-import and classifier-version changes until explicitly reset.
Record actor/provenance for household decisions.

Merchant text is untrusted data, never agent instruction.

TEST:
override + reimport;
rule/model changes;
explicit reset;
history inspectable;
malicious memo inert.

Stop review-ready.
```

---

## PR #14 — Unknown-Charge Cleanup Workflow

**Recommended model:** ECONOMY

### Why

Turn canonical classifications into a short repeatable household habit and data-quality loop.

### Backlog connection

uncategorized spending, unknown transfers, business inventory uncertainty, missing merchant meaning.

### Prompt

```text
Implement PR #14: Unknown-Charge Cleanup Workflow.

ENTRY:
PR #13 merged; fresh main; tests + Golden Household green.

ONE OUTCOME:
Provide a simple Needs Review / Unknown workflow backed by canonical classification/relationship writes.

User should be able to review a small transaction queue and:
confirm suggestion, choose category, mark transfer/business, or leave unknown.

Show:
- unknown transaction count;
- unknown dollars;
- classification coverage.

A decision must flow into canonical history and downstream aggregates; this is not a UI-only tag.

Keep UI extremely simple.
No AI chat.
No budget redesign.
Browser/integration proof for the actual write path.
Stop review-ready.
```

---

## PR #15 — 18-Month Household Spending Baseline

**Recommended model:** FRONTIER

### Why

Build the real-life baseline that future budgets will tighten from instead of guessing.

### Backlog connection

B16, B34, B40, B54, B62, PayPal correction, fees/interest, business/household separation, Q0.

### Prompt

```text
Implement PR #15: 18-Month Household Spending Baseline.

ENTRY:
PR #14 merged; fresh main; Golden Household green.

ONE OUTCOME:
Produce one canonical, reproducible household spending baseline from canonical transactions.

For meaningful categories calculate:
monthly average, median, recent 3/6/12 month views, seasonal range,
high/low months, recurring merchants, unusual spikes, confidence/coverage.

Exclude/internalize transfers correctly.
Keep business/pass-through money distinct.
Historical actuals are NOT owner budget targets.

Every aggregate must drill to canonical transactions and reconcile to the source window.

No budget recommendation yet.
No calendar redesign.

PHASE ACCEPTANCE:
Atlas must truthfully answer “Where did our money go?”
Run Gate T1 after merge/acceptance before Phase 2.
```

---

# PHASE 2 — RUN OUR MONEY

## PR #16 — Household Financial Policy & Attribution

**Recommended model:** FRONTIER

### Why

Math cannot know which lifestyle priorities the household chooses to protect.

### Prompt

```text
Implement PR #16: Household Financial Policy & Attribution.

ENTRY:
Gate T1 says Phase 2 remains next. Fresh main.

ONE OUTCOME:
Create structured durable household financial policy with attribution.

Support:
protected/flexible priorities;
cash-buffer philosophy;
debt objective;
retirement/lifestyle priorities;
risk/austerity tolerance;
individual preference vs joint decision.

Every household-originated policy records actor/source:
Dale / Amanda / Joint (or canonical person IDs if current model requires).

This is NOT an AI personality/soul system.
Do not infer policy from spending alone.
Unknown policy stays unknown.

No budget math change except minimal read integration proof.
Stop review-ready.
```

---

## PR #17 — Evidence-Based Budget Targets

**Recommended model:** FRONTIER

### Why

A target must be informed by actual behavior but remain distinct from historical average.

### Backlog connection

Q0 owner budget workbooks, current historical-derived weekly cap, sports/travel realities.

### Prompt

```text
Implement PR #17: Evidence-Based Budget Targets.

ENTRY:
PR #16 merged; fresh main; baseline still reconciles.

ONE OUTCOME:
Create canonical household budget targets that clearly distinguish:
historical actual / current recent rate / owner target / Atlas recommendation.

Recommendations must be deterministic and explain required reduction from observed behavior.
Protected household priorities must not be treated as generic waste.

A category target must not mutate historical actuals.
Owner-stated target outranks recommendation.
Do not silently fill unknown targets.

Expose enough UI to compare Historical / Current / Recommended / Owner Target.
No safe-to-spend yet.
Stop review-ready.
```

---

## PR #18 — Obligations, Schedules & Planned Commitments

**Recommended model:** FRONTIER

### Why

Budget averages and dated cash obligations are different concepts. Atlas needs to know Christmas, sports fees, mortgage and annual insurance before they arrive.

### Backlog connection

B29 payment calendar, B69 home insurance, B67 Fusion invoice, property tax, debt due dates.

### Prompt

```text
Implement PR #18: Obligations, Schedules & Planned Commitments.

ENTRY:
PR #17 merged; fresh main.

ONE OUTCOME:
Represent separately:
1. budget target;
2. scheduled/committed occurrence;
3. planned/sinking commitment;
4. actual/pending transaction.

Migrate current known household schedule semantics from existing authoritative sources without duplicating owners.
A future $5,000 purchase is never an actual transaction.
A monthly budget target is never a scheduled bank withdrawal.

Preserve provenance and uncertainty.
Reuse/derive from existing payment-calendar work rather than create a second schedule truth.

Tests must prove dated items are not double counted inside category budget averages.
Stop review-ready.
```

---

## PR #19 — Safe-to-Spend v1 — SHADOW ONLY

**Recommended model:** FRONTIER

### Why

Safe-to-spend is likely the most important day-to-day number and therefore must earn trust before becoming behavioral authority.

### Prompt

```text
Implement PR #19: Safe-to-Spend v1 in SHADOW mode.

ENTRY:
PR #18 merged; fresh main; baseline/budget/obligation tests green.

ONE OUTCOME:
Create one deterministic weekly Safe-to-Spend calculation consuming canonical:
cash, income timing, obligations, debt minimums, budget targets,
protected buffer and known commitments.

It must NOT become the household's authoritative spending instruction yet.

Publish/log it clearly as SHADOW with:
calculation date;
horizon;
inputs/version;
uncertainties;
predicted low cash point;
reason codes.

No AI arithmetic.
No duplicate page-owned calculation.

Create a real-world shadow evaluation procedure comparing weekly prediction against what actually happens.

After merge, run the shadow campaign for enough real weeks to evaluate usefulness.
Defects get separate PRs.

PHASE ACCEPTANCE / GATE T2:
Only graduate when household evidence supports it.
Gate T2 must re-justify every later phase.
```

---

# PHASE 3 — SEE THE HORIZON
# Only proceed after Gate T2 explicitly keeps this phase.

## PR #20 — Goals & Planned Spending

**Recommended model:** ECONOMY if authority already clear; FRONTIER if goal lifecycle conflicts with commitments.

### Prompt

```text
Implement PR #20: Goals & Planned Spending.

ENTRY:
Gate T2 explicitly keeps Phase 3. Fresh main.

ONE OUTCOME:
Create canonical future goals/planned-spend lifecycle:
idea → considering → planned → committed → actual.

Store amount/range, target date/window, priority/status, actor/provenance and uncertainty.
A goal affects scenarios/funding only according to its status; it never becomes an actual transaction by existing.

Provide a simple way to enter an item such as:
Palm Springs / Jan 2027 / ~$6,000 / considering.

No scenario engine yet.
Stop review-ready.
```

---

## PR #21 — Deterministic Horizon Forecast

**Recommended model:** FRONTIER

### Prompt

```text
Implement PR #21: Deterministic Horizon Forecast.

ENTRY:
PR #20 merged; fresh main.

ONE OUTCOME:
Evolve the current forecast authority to deterministic 30/60/90-day and 12-month horizons consuming canonical state.

Inputs:
opening cash/debt, income timing, scheduled obligations,
budget/variable-spend assumptions, enabled planned commitments, explicit assumptions.

Every run records:
input snapshot/reference;
run timestamp;
algorithm version;
scenario label;
assumptions;
outputs/confidence.

Daily timing and same-day ordering must be deterministic.
Transfers affect account liquidity but not household consumption.
Stale/unreconciled data lowers confidence rather than disappearing.

Do not create a second forecast engine.
Stop review-ready.
```

---

## PR #22 — Forecast Self-Grading / Backtesting

**Recommended model:** ECONOMY for instrumentation; FRONTIER if scoring reveals forecast semantic changes are required.

### Prompt

```text
Implement PR #22: Forecast Self-Grading / Backtesting.

ENTRY:
PR #21 merged; fresh main.

ONE OUTCOME:
Make forecasts accountable against later actuals without rewriting historical forecasts.

Persist/version enough original inputs/outputs to score:
7d / 30d / 90d balance error;
low-balance date/value error;
meaningful category/variable-spend error where valid.

Scores are deterministic data-health outputs.
A poorly performing forecast becomes visibly lower-confidence; do not let prose hide it.

No new forecasting algorithm unless required to make scoring truthful.
Stop review-ready.
```

---

## PR #23 — Scenario Engine

**Recommended model:** FRONTIER

### Prompt

```text
Implement PR #23: Scenario Engine.

ENTRY:
PR #22 merged; fresh main.

ONE OUTCOME:
Run deterministic what-if scenarios without mutating base household truth.

At minimum support:
enable/disable a planned goal;
change a budget target;
change an expected transfer/income assumption;
change debt-payment allocation.

Scenario outputs use the same forecast authority as base.
Scenario state is never actual state.

Prove Palm Springs-style scenario reports impact on:
cash path, debt path, buffer, funding gap and displaced/competing commitments.

Stop review-ready.
```

---

## PR #24 — Financial Calendar & Horizon Experience

**Recommended model:** ECONOMY for rendering if APIs are settled; FRONTIER if UX requires new financial semantics.

### Why

This is the primary human interface: understandable month/week horizon, not accountant software.

### Prompt

```text
Implement PR #24: Financial Calendar & Horizon Experience.

ENTRY:
PR #23 merged; fresh main.

ONE OUTCOME:
Create the primary calendar/horizon UI consuming existing deterministic outputs only.

Month/week should show:
paydays/inflows;
bills/obligations;
planned purchases/goals;
weekly Safe-to-Spend status;
Comfortable / Watch / Tight / Shortfall states.

Tap day/week to explain the deterministic drivers in plain language.

The calendar may render and explain.
It may NOT calculate its own financial truth.

Make the UI polished, phone-friendly and obvious to a non-finance user.
Use browser/e2e acceptance for source → engine → calendar.

PHASE ACCEPTANCE:
Enter a meaningful goal and prove Atlas answers:
Can we afford it? When? What changes? What happens to cash/debt/buffer?
Run Gate T3.
```

---

# PHASE 4 — MAKE IT LIVE
# Only proceed if Gate T3 keeps it.

## PR #25 — Provider-Neutral Live Ingestion & Transaction Lifecycle

**Recommended model:** FRONTIER

### Prompt

```text
Implement PR #25: Provider-Neutral Live Ingestion & Transaction Lifecycle.

ENTRY:
Gate T3 keeps Phase 4. Fresh main.

ONE OUTCOME:
Define one live-source ingestion port feeding the SAME evidence/observation/canonical pipeline as historical files, and close pending/posted/revision/removal semantics needed for live data.

Required lifecycle cases:
pending amount/date/ID changes;
pending disappears;
posted revised;
source removes record;
source supplies no pending data.

Source/provider models may not leak downstream.
Checkpoint/cursor semantics belong to source ingestion, not finance domain truth.

No real provider yet beyond synthetic adapter proof.
Golden Household lifecycle cases must pass.
Stop review-ready.
```

---

## PR #26 — Reconciliation & Data Health

**Recommended model:** FRONTIER

### Prompt

```text
Implement PR #26: Reconciliation & Data Health.

ENTRY:
PR #25 merged; fresh main.

ONE OUTCOME:
Make “Can Atlas trust this data?” a canonical machine-readable output.

Track:
source freshness;
records received/added/modified/removed;
duplicate artefacts;
pending/posted matches;
unresolved account mappings/transfers;
statement opening/closing residual where available;
soft live-balance reconciliation;
orphan observations;
projection/forecast freshness.

Hard and soft reconciliation must be distinguished.
Never silently discard unexplained residual.

Expose a simple data-health consumer for UI/forecast confidence.
Stop review-ready.
```

---

## PR #27 — First Automated Canadian Financial-Data Connector

**Recommended model:** FRONTIER

### Prompt

```text
Implement PR #27: First Automated Canadian Financial-Data Connector.

ENTRY:
PR #26 merged; fresh main.

CURRENT-MARKET GATE:
Research CURRENT official/primary documentation for viable Canadian providers.
Do not select Wealthica, Plaid, Flinks, direct screen automation, or future open-banking access from memory.
Compare coverage for the household's actual institutions, consent/auth flow,
transactions/balances, sync semantics, sandbox/testing, cost and commercial/private-use feasibility.

ONE OUTCOME:
Add ONE selected provider behind the provider-neutral port.

Requirements:
checkpoint advances only after durable canonical success;
pagination/retry idempotent;
reauth/disconnect preserves Atlas account identity/history;
provider IDs/categories remain aliases;
server-side secrets only;
no raw token logs.

Manual file import remains fallback.

Use official sandbox/test environment where possible.
Required security/systems review.
Stop review-ready.
```

---

## PR #28 — Scheduled Daily Sync & Resilience

**Recommended model:** FRONTIER

### Prompt

```text
Implement PR #28: Scheduled Daily Sync & Resilience.

ENTRY:
PR #27 merged; fresh main.

ONE OUTCOME:
Turn the first provider into a reliable daily freshness loop without creating a second source of truth.

Daily:
provider → evidence/observation → canonical state → reconciliation →
classification queue → budget/safe-to-spend → forecast/calendar freshness.

Use the smallest reliable scheduler/background mechanism compatible with the current stack.
Do not add Redis/Temporal/etc without observed need.

Prove:
duplicate delivery harmless;
worker crash/retry converges;
checkpoint cannot outrun durable commit;
stale/dead sync visible;
manual fallback still works.

PHASE ACCEPTANCE:
Run unattended and observe a new purchase flow through to the user-facing plan without hand-editing canonical figures.
Run Gate T4.

At Gate T4 explicitly decide whether SQLite is still enough.
Postgres migration is NOT pre-authorized; add it only if current evidence earns it.
```

---

# PHASE 5 — CONVERSATIONAL ASSISTANT INTERFACE
# Only proceed if Gate T4 keeps it.

## PR #29 — Assistant-Neutral Read Interface

**Recommended model:** FRONTIER for security boundary; ECONOMY for mechanical tool definitions after boundary is approved.

### Prompt

```text
Implement PR #29: Assistant-Neutral Read Interface.

ENTRY:
Gate T4 keeps Phase 5. Fresh main.

ONE OUTCOME:
Expose a bounded read interface that lets an owner-approved conversational assistant understand current Atlas state without direct database access.

Reads may include:
household status;
spending/budget;
transactions/evidence;
debt;
calendar/goals;
forecast/scenarios;
policy;
data health.

The interface is assistant-neutral. ChatGPT is the first expected client, not a domain dependency.

Do not expose raw bank credentials/provider tokens.
Do not create mutation tools.
Security review required.
Stop review-ready.
```

---

## PR #30 — Proposed Change Interface

**Recommended model:** FRONTIER

### Prompt

```text
Implement PR #30: Proposed Change Interface.

ENTRY:
PR #29 merged; fresh main.

ONE OUTCOME:
Allow assistants to translate natural-language household intent into structured PROPOSALS that Atlas validates through canonical mutation paths.

Examples:
goal proposal;
classification proposal;
planned commitment;
household policy proposal.

Assistant cannot directly overwrite balances, reconciliation, source evidence or deterministic outputs.

Every proposal records:
actor;
source assistant/session metadata where appropriate;
proposed change;
validation result;
accept/reject state;
resulting canonical record if accepted.

No autonomous financial actions.
Stop review-ready.
```

---

## PR #31 — Multi-Person Household Attribution & Approval Semantics

**Recommended model:** FRONTIER

### Prompt

```text
Implement PR #31: Multi-Person Household Attribution & Approval Semantics.

ENTRY:
PR #30 merged; fresh main.

ONE OUTCOME:
Support Dale and Amanda as distinct household actors without turning one person's preference into joint household policy.

Define which update classes may be:
individual observations/preferences;
individually authoritative classifications;
joint commitments/policies requiring explicit household agreement.

Preserve attribution/history.
Do not build surveillance features or spouse scoring.
Do not force all input through Dale.

Test conflicting proposals and joint acceptance path.
Stop review-ready.
```

---

## PR #32 — Daily Financial Briefing

**Recommended model:** ECONOMY for presentation; FRONTIER only if new recommendation authority is introduced.

### Prompt

```text
Implement PR #32: Daily Financial Briefing.

ENTRY:
PR #31 merged; fresh main.

ONE OUTCOME:
Produce a concise household briefing from existing canonical/deterministic outputs.

Target feel: checking the weather.

Include only meaningful items such as:
safe-to-spend;
weekly category pressure;
next major obligation/payday;
cash-buffer warning;
goal status;
data-health caveat;
small unknown-transaction queue.

No new finance calculations in the briefing layer.
No guilt/scolding language.
Sometimes the correct message must be: “You're fine; no action needed.”

Provide an assistant-readable and human-readable representation.
Run Gate T5 after acceptance.
```

---

# PHASE 6 — OPTIMIZE OUR LIFE
# Optional. Only proceed if Gate T5 says these are now the highest-value problems.

## PR #33 — Opportunity Engine

**Recommended model:** FRONTIER for financial opportunity semantics; current market research handled by assistant at use time.

### Prompt

```text
Implement PR #33: Opportunity Engine.

ENTRY:
Gate T5 keeps Phase 6. Fresh main.

ONE OUTCOME:
Detect evidence-backed household conditions worth investigating without hardcoding current market products.

Examples:
avoidable account fees;
expensive revolving credit;
duplicate/overlapping recurring service;
insurance increase;
idle cash;
interest leakage;
subscription creep;
rewards opportunity where debt economics do not overwhelm it.

Atlas identifies the CONDITION and evidence.
Conversational assistant researches current products/options when requested.

No autonomous applications/account changes.
Stop review-ready.
```

---

## PR #34 — Debt & Cash Strategy

**Recommended model:** FRONTIER

### Prompt

```text
Implement PR #34: Debt & Cash Strategy.

ENTRY:
PR #33 merged; fresh main.

ONE OUTCOME:
Create one deterministic next-dollar strategy comparing eligible destinations for surplus cash.

Consider:
interest cost;
minimums;
utilization/headroom risk;
cash-buffer policy;
liquidity;
known commitments;
household policy.

Do not optimize reward points while ignoring materially higher revolving interest.
Do not let separate pages own competing payoff rules.

Backtest/sensitivity-test the strategy against Golden Household and current canonical semantics.
Stop review-ready.
```

---

## PR #35 — Long-Horizon Household Planning

**Recommended model:** FRONTIER

### Prompt

```text
Implement PR #35: Long-Horizon Household Planning.

ENTRY:
PR #34 merged; fresh main.

ONE OUTCOME:
Extend Atlas from near-horizon operations to evidence-backed 1/3/5/10-year household planning.

Candidate domains only where current data supports them:
retirement;
pension;
mortgage renewal;
RESP;
home/moving;
long-term debt;
savings/net-worth trajectory.

Do not manufacture precision from missing facts.
Owner questions are explicit gates.
Current tax/product/rate research stays outside canonical math unless captured with date/provenance assumptions.

The key user question is trade-off visibility:
“If we move / spend / save differently, what happens to the other goals?”

Required systems review.
Stop review-ready.
```

---

# 8. Phase acceptance campaigns

## Phase 0 — Trust acceptance

PASS only if:
- governance/strategy/authority each have one home;
- a second owner for a registered concept turns red;
- future agents can locate build strategy and current truth.

## Phase 1 — Know Us acceptance

PASS only if:
- canonical transaction provenance exists;
- historical import is idempotent;
- transfers/card payments do not double count;
- household overrides survive re-import;
- spending baseline reconciles to transaction evidence;
- Atlas can drill household → category → merchant → transactions;
- stale backlog/open-question claims discovered by the phase are dispositioned.

Verdict:
`PASS — Atlas can truthfully explain where the household's money went`
or
`NOT YET — failed acceptance IDs + dispositions`.

## Phase 2 — Run Our Money / product-complete v1

Safe-to-Spend must run in SHADOW before household authority.

Evaluate over real weeks:
- predicted cash low vs actual;
- missed obligations;
- whether uncertainty was disclosed;
- too-strict / too-loose behavior;
- whether the number would have caused a harmful decision;
- whether household budget targets are actually livable.

Graduate only when evidence supports:
`PASS — household can run its week from Atlas without a parallel budget`.

Then **Gate T2** re-justifies every later phase.

## Phase 3 — Horizon acceptance

Enter a meaningful planned goal.

PASS only if one canonical chain answers:
- Can we afford it?
- When?
- What must change?
- What happens to cash?
- What happens to debt?
- What happens to buffer?
- Which competing goal is displaced?
- Why is a calendar week marked tight?

Calendar may not calculate independently.

## Phase 4 — Live acceptance

PASS only if:
- automated source produces canonical observations;
- duplicates/retries are harmless;
- account identity survives provider changes;
- reconciliation/freshness is visible;
- new purchase updates budget/safe-to-spend/forecast/calendar without hand-editing figures;
- provider can be removed without changing domain contracts.

## Phase 5 — Assistant acceptance

PASS only if:
- a new assistant session can read current Atlas context;
- assistant numbers match deterministic Atlas evidence;
- natural-language intent becomes a proposal, not a silent mutation;
- Dale/Amanda attribution survives;
- malicious imported merchant/memo text cannot invoke a tool;
- removing the assistant changes no canonical financial result.

## Phase 6 — Optimization acceptance

PASS only if:
- opportunities cite Atlas evidence;
- current market advice is researched at use time;
- next-dollar strategy has one owner;
- long-horizon outputs expose uncertainty and household trade-offs;
- no automated movement/application/account action exists.

---

# 9. Backlog and household urgency

The execution plan decides **what software is intentionally built next**.

`BACKLOG.md` is discovered work, not permission to build.

`docs/01_OPEN_QUESTIONS.md` is what only the household can answer.

Real-world urgent financial actions operate on a different clock than software work. A critical HELOC/credit/insurance/payment issue must not wait behind PR #17 because the roadmap says so.

At each trajectory review, backlog items should be classified:

- KEEP;
- PROMOTE TO EXECUTION PLAN;
- MOVE TO OPEN QUESTION;
- MOVE TO HOUSEHOLD ACTION;
- MERGE;
- ALREADY SATISFIED;
- STALE / SUPERSEDED;
- DELETE.

Backlog age does not create priority.

Duplicate identifiers, stale questions and superseded financial claims are authority defects in planning state and should be corrected when a trajectory-review PR has that outcome.

---

# 10. Technology decisions are earned

### SQLite

Chosen as the first canonical relational store because it gives constraints, transactions and idempotent structure without operating a server.

It is not a disposable prototype by definition.

### PostgreSQL

Not on the scheduled roadmap.

At Gate T4, or earlier only if current evidence demands it, ask whether SQLite has become the limiting factor.

Valid reasons could include:
- hosted concurrent multi-user writes;
- remote assistant/service access;
- background-worker locking/throughput;
- deployment architecture making local SQLite unsafe;
- measured operational requirements.

“Postgres is more professional” is not a reason.

### Bank/provider API

The strategy intentionally does not lock a provider now.

At PR #27, research the current Canadian market and the household's actual institutions from official sources.

### AI model/provider

The assistant interface is provider-neutral.

ChatGPT is expected to be the primary household interface, but Atlas does not encode ChatGPT as financial authority.

---

# 11. Strategy stop conditions

Stop the roadmap and request owner/decision-desk input if:

- a household fact is required and cannot be derived;
- a figure would be promoted from estimate to verified;
- raw statements/credentials/secrets handling changes;
- an institution write/action is proposed;
- product scope changes from household read/advice to autonomous financial action;
- the strategy and current authority contract genuinely conflict;
- two future paths remain equally legitimate after current-state audit.

Otherwise, the active implementation agent should continue autonomously within the current PR's box.

---

# 12. End-state test

The intended Atlas should eventually support a moment like this:

> **Wednesday**  
> You're okay.  
> $612 is safe for the rest of this week.  
> Groceries are normal; restaurant spending is already 82% through target.  
> $2,100 of sports fees is due Monday. Payday is Friday.  
> Projected cash bottoms at $3,480 next Tuesday, above the agreed $3,000 floor.  
> Palm Springs remains fundable.  
> Keep restaurant/takeout under $75 until Friday.  
> Two transactions still need categorization.

Then Dale can ask an assistant:

> What if we spend $120 on takeout tonight?

The assistant should call/read deterministic Atlas scenario outputs and explain the consequence.

Or:

> Amanda found a house she loves. What does moving do to us?

Atlas supplies household truth. The assistant can research current outside conditions. The result should explain the trade against debt, retirement, sports, travel and cash buffer without either spouse needing to understand the underlying finance machinery.

That is the destination.

---

## Immediate order from current main

At strategy creation, PR #3 has merged.

The next intended order is:

1. PR #4 — install this strategy;
2. PR #5 — Financial Cohesion & Authority Contract;
3. PR #6 — Executable Authority Registry & Boundary Guard;
4. STOP — Gate T0;
5. continue only from exact current state.

**Current state wins over this list.**
