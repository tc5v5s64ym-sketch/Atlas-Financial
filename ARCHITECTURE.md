# Architecture

How this project is put together, where new material goes, and where it is
heading. `CONTEXT.md` orients a session; this explains the design.

---

## The shape: five layers, one direction

```
  raw/          SOURCE        statements, exports          immutable · local only
    ↓
  scripts/      EXTRACTION    decrypt, parse, normalise    deterministic · committed
    ↓
  derived/      INTERMEDIATE  parsed output, aggregates    disposable · local only
    ↓
  docs/         KNOWLEDGE     analysis, facts, questions   durable · committed
    ↓
  data.json     PUBLICATION   the figures the site shows   committed → deployed
```

Those five layers are the **file-evidence path**. They remain how statement
PDFs, exports, and other captured files move when that path is used. They are
not the household's normal operational refresh.

Material only ever flows **down**. Nothing edits `raw/`. Nothing hand-writes
`derived/`. A published figure traces to its evidence: a Lunch Money
observation on the normal refresh path, or a statement / institution artifact
when that file path is the source.

### Inside publication: source facts to a decision

`data.json` is not the last step. Within the published layer there is a second
one-way flow, and it exists because the alternative — every page working out its
own answer — produced a homepage that showed `$1,650/week` in one tile and `$0`
in the block underneath it.

```
  data.json              SOURCE FACTS      balances, rates, dated obligations
  public/periods.json    SPENDING HISTORY  generated; the only home for actuals
    ↓
  forecast.js  simulate()          cash, day by day
               projectDebts()      the same events, seen from the debt side
               budgetBreakdown()   essential vs discretionary vs already dated
               recommend()         THE weekly household cap
               incomeDeadline()    when a modelled income becomes required
               renewal()           the May 2027 renewal, from the same debts
    ↓
  plan.js / deepdive.js / records.js / modellers.js   render only
```

**The engine decides; the pages render.** `forecast.js` is pure and DOM-free, so
`npm test` exercises exactly what the browser runs. A page that computes a
financial answer for itself is a bug — that is how the same question came to
have two answers.

Three rules follow from this, and the test suite enforces all three:

- **One fact, one home.** Historical spending lives in `periods.json` and is
  *derived* into the budget, never copied into `data.json`. `data.json` carries
  the classification, any owner override, and any explicit current-regime
  assumption — not a second copy of the historical series.
- **Every dated item declares where it would otherwise sit.** A bill or
  commitment names its `budgetCategory`, and that amount is subtracted from the
  category's average. Without it, Shaw is paid twice — once on the calendar and
  once inside a telecom average that already contains it.
- **Every obligation names the debt it moves.** `debtId` plus `effect`
  (`payment` or `capitalise`). Cash leaving the chequing account has to arrive
  somewhere, and the suite reconciles the two sides to the cent.
- **Household values may change without rewriting behaviour tests.** Engine
  behaviour uses synthetic fixtures and independent arithmetic; authority tests
  mutate the parent and check the child follows; live cents belong only in
  deliberately live reconciliation. A copied household figure is not a
  specification.

| Layer | Directory | Committed? | Rebuildable? |
|---|---|---|---|
| Source | `raw/` | **Never** | No — irreplaceable if lost |
| Extraction | `scripts/` | Yes | — |
| Intermediate | `derived/` | **Never** | Yes, by re-running scripts |
| Knowledge | `docs/` | Yes | No — human judgement |
| Publication | `data.json`, `public/` | Yes | Partly |

`raw/` is the only irreplaceable directory, so it is backed up separately —
`scripts/backup-raw.ps1` mirrors it into OneDrive, outside git entirely. Run it
after every capture session. Everything else can be rebuilt from it, or is in
git.

---

## The flow, end to end

**Normal operation — owner-approved 2026-08-17.** Lunch Money is the
household's **normal operational financial update feed**. The owner does not
want to maintain the same current account data twice by syncing Lunch Money
and separately downloading routine monthly statements into Atlas.

```
institutions / owner-maintained Lunch Money accounts
    ↓
Lunch Money                              evidence / update feed
    ↓
Atlas observation + reconciliation       read-only observe; non-writing compare
    ↓
canonical Atlas state                    data.json; automatic write not yet earned
    ↓
Forecast                                 sole planning / calculation authority
    ↓
Atlas website / ChatGPT / other consumers
```

Forecast remains the sole deterministic planning and financial calculation
authority. Lunch Money is an evidence/update source. It is not the planner,
not the canonical Atlas plan, not household policy, and not authority over
future commitments, priorities, or owner decisions. Where institutional
evidence directly contradicts Lunch Money and is available, the institution
is stronger factual evidence.

Routine use is:

1. Lunch Money automatically refreshes connected accounts.
2. The owner updates any manual Lunch Money accounts when they want those
   balances current.
3. Atlas reads Lunch Money.
4. Atlas reconciles new observations against canonical state.
5. Supported changes flow through the earned Atlas refresh /
   canonical-update mechanism (`scripts/canonical-refresh.js`): observe →
   reconcile → preview → explicit owner approval → bounded `data.json`
   write. Default is still a non-writing preview. Unattended production
   writes and a Render Lunch Money token are **not** authorised.
6. Forecast recalculates.
7. Atlas exposes the freshness and uncertainty that remain.

Some household accounts or cards are not automatically refreshed by Lunch
Money and require the owner to update current balances there. That is
**accepted owner policy**. Do not require a duplicate Atlas statement-import
workflow merely because those accounts are manual in Lunch Money. Atlas
consumes the state Lunch Money reports while preserving truthful freshness /
observation metadata. If a manually maintained Lunch Money account is stale:
do not pretend it is institution-live; do not manufacture a newer balance;
do not block all other current-state refresh because that one account is
older; preserve and report its actual observed or provider-updated freshness
where available. Accuracy of that account's contribution to the outlook
depends on the owner's Lunch Money update. Do not invent a generic count of
manual accounts. Triangle and MBNA are the owner-named monthly
statement-maintained exceptions; their evidence cadence lives in
[`docs/ACCOUNT_FACTS.md`](docs/ACCOUNT_FACTS.md) and is keyed by canonical
Atlas identity. Cadence may accept current-cycle statement evidence. It
never rewrites `evidenceDate`. Cash Back and the other live TD accounts
keep exact-day freshness.

Owner-only information still enters Atlas separately when Lunch Money cannot
know it: future commitments, planned purchases and travel, household policy,
priorities, cancellation or settlement knowledge, unknown account purpose,
contractual facts Lunch Money does not supply, and exceptional corrections.
That is not duplicate balance maintenance.

**The file path remains for manual, historical, and fallback evidence.**
Historical and manual statement files are useful for backfill, dispute and
verification, contractual terms Lunch Money does not expose, direct
institutional evidence when a provider value conflicts, and unusual evidence
collection. They are **not** the routine monthly operational refresh
requirement. Proven statement extraction tooling is not deleted and is not
declared useless. It is not the operational prerequisite for Atlas freshness.

When a statement file is the source:

1. **Drop it in `raw/`.** Never edit it. Never rename it beyond a clear
   convention: `raw/statements-<institution>/<YYYY-MM-DD>-<account>.pdf`
2. **Extract.** Use an existing script if one fits; write one in `scripts/` if
   not. Statements are encrypted — see `docs/ACCOUNT_FACTS.md` for which scheme
   each issuer uses.
3. **Write intermediate output to `derived/`.** Never to `docs/`.
4. **Update knowledge** — `docs/ACCOUNT_FACTS.md` for new standing facts,
   `docs/positions.csv` for the account row, `docs/01_OPEN_QUESTIONS.md` for
   anything raised or answered.
5. **Update `data.json`** with figures that belong on the site.
6. **Commit and push.** Render deploys within a couple of minutes.

The pre-commit hook refuses file-path steps 1 and 3 from reaching git,
whatever else goes wrong.

---

## Where things go

**One fact, one home.** The most common failure mode in a project like this is
the same number living in three files and drifting.

| Kind of thing | Home | Not |
|---|---|---|
| Rates, limits, due dates, renewal dates | `docs/ACCOUNT_FACTS.md` | anywhere else |
| Balances, available credit | `docs/positions.csv` and `data.json` | `ACCOUNT_FACTS.md`. `positions.csv` is the account-row snapshot, **not** a universal fact database |
| **Work still to do** | **`BACKLOG.md`** | a chat message |
| **Things only a human can answer** | **`docs/01_OPEN_QUESTIONS.md`** | `BACKLOG.md` |
| Narrative analysis | `docs/00_MASTER_PICTURE.md` | `data.json` |
| Per-account depth | `docs/*_DEEP_DIVE.md` | the master picture |
| **What one person said, attributed and dated** | **`docs/household_interviews/`** | `data.json`, a budget target, or joint policy |
| What the site displays | `data.json` | hardcoded in `public/` |

**Backlog versus questions.** A backlog item needs someone to *do* something and
can be closed by doing it. A question needs someone to *know* something and can
only be closed by an answer. Mixing them produces a list where nothing is
actionable because everything looks blocked.

**Facts and figures are kept apart deliberately.** A rate is stable; a balance is
not. Mixing them lets a stale balance masquerade as a standing fact.

**An interview is one person's evidence, not the household's decision.** It keeps
the estimate, target, conditional and unresolved labels the speaker gave it, and
promoting any of them to a verified figure or a shared target is a separate step —
owner-reserved, because it changes how a figure is tagged.
`docs/household_interviews/README.md` holds the rules for that folder; this file
records only that the folder is where such evidence lives.

### Adding a new account

1. Row in `docs/positions.csv` — set `entity` to Household or Business
2. Section in `docs/ACCOUNT_FACTS.md` with a **verified** date
3. Entry in `data.json` under `debts`, plus `revolvingExtra` if it is an overdraft rather than a debt
4. Derived publication totals follow from those rows via `Forecast.publicationTotals` — do not store a matching headline, net-worth total, or second HELOC limit
5. Any new questions into `docs/01_OPEN_QUESTIONS.md`

---

## Principles

These have governed the work so far and should continue to.

**Tag every figure.** Verified from the institution / calculated / estimated /
unknown. An estimate is never presented as a verified fact. This is what makes
the analysis trustworthy rather than merely confident.

**Verify rather than assume.** Where a model can be checked against the
institution's own numbers, check it. The mortgage amortisation model was trusted
only because it reproduced TD's stated remaining term to within a month.

**Cross-check across sources.** PayPal's spending total was wrong until it was
checked against the bank-funding pulls. Two independent paths to the same number
is the cheapest error detection available.

**Corrections are folded in, not appended.** When something is found to be
wrong, the document is rewritten to be right, with a short note of what changed.
Readers should see the current position, not a history of the reasoning.

**State coverage honestly.** Say what was captured, what was not, and what could
not be categorised. `docs/00_MASTER_PICTURE.md` carries a coverage section for
exactly this reason.

**Read-only against institutions. Never handle an institution login credential.**
No transfers, payments, applications, setting changes, form submissions or
agreement acceptances. Passwords, PINs, security codes and 2FA are the owner's
alone. *(The application's own server-side secrets are a different thing — see
**The secret boundary** below, which is the one home for that line.)*

---

## Direction

**This file is the one home for direction.** It owns what Atlas is for, what is
in bounds, which authority owns which concept, and the gate each future
capability has to pass. Where any other document disagrees with this one about
direction, this file wins and the other is wrong.

*Sequencing* — the order work is done in, and the prompt for each piece — is a
different question and does not live here. `docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md`
now owns that sequencing, and it may schedule only what this file already permits.
Nothing in the strategy can pass a gate or override direction recorded here.

### The destination — owner-approved

Atlas is being built toward a **household financial operating system**: deeply
understood spending, unknown transactions burned down, Dale's and Amanda's input
reconciled, realistic budgets, a weekly safe-to-spend figure, upcoming
obligations and a financial calendar, planned purchases, deterministic horizons
and scenarios, debt and cash guidance, fresh data when it is earned, and an
assistant-neutral way to ask about all of it.

That destination is approved. **None of it authorises a technology.** Each gated
capability below still has to pass its own gate, and a gate is passed by evidence
and an owner decision — never by a plan reaching that line.

The tiers below describe **the stage each capability is at**, not a ceiling — and
not a record of current progress, which is `BACKLOG.md`'s.

### One plan, many windows — owner-approved 2026-08-12, refined 2026-08-16

Atlas maintains **one master household financial forecast**, and every horizon
is a window onto it. That forecast is the dated projection Forecast produces
from `data.json` `plan` and the opening cash and debt facts. Its knowledge
horizon is **at least twelve months** from the opening as-of.

The live Plan page still *displays* a 91-day window (`plan.windowDays`). That
display is a view, not the plan's knowledge bound. `Forecast.recommend`
searches the knowledge horizon; the weekly figure on screen is from that
master walk, not from the visible range alone.

**Named ranges are views of that same forecast.** Week, payday, month, 13 weeks,
6 months, 1 year, and a custom date range are different spans of the same dated
projection, from the same starting facts. A custom range may start after the
opening as-of; that is still a slice of the master walk, not a second forecast.
They are not separate engines and not separate answers. A payday plan is Forecast
output shown for a payday span; it is not a second payday planner.

**Changing the visible range never changes what the plan knows.** Shortening the
window does not drop a later commitment from the forecast, from safe-to-spend,
or from the funding sequence. Changing an input recalculates every affected
view from that one plan, so a short-horizon answer cannot quietly contradict a
long-horizon one.

**The deterministic engine stays where financial decisions are made.** Forecast
is the planner and the calculation authority. That is the rule at the top of
this file applied to the destination, not replaced by it. A page, ChatGPT, a
Google Sheet, or a later helper may not stand up a second planner, a generic
planning schema, or a parallel authority. The capabilities below are earned by
**evolving Forecast in place**. Until a capability is earned it is not an
incumbent-table row, and the absence of a row is not a licence to invent an
owner beside Forecast.

**Two consumers plus one execution tracker, one answer.**

| Surface | What it is for |
|---|---|
| The website | visual presentation and inspection of the plan |
| ChatGPT | conversational query, explanation and scenario interface |
| Google Sheet | execution tracking of a plan Forecast already produced |

None of them may create a second financial answer, and none is an authority.
They consume the same ones. A surface that works a figure out for itself is the
defect `B73` exists to close, arriving through a new door. The **normal**
refresh chain is Lunch Money → observation + reconciliation → canonical Atlas
state → Forecast → those three surfaces. `B91` is done. Lunch Money is the
evidence/update feed, not a second planner. Owner-approved preview/apply
writes are earned (`B81` first slice). Unattended production writes are
not. Sequencing of remaining production-reservation work lives in
[`docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md`](docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md).

**What the plan is expected to cover, as each capability is earned:** material
income and compensation, debts, bills, spending and budget, known dated
commitments, sinking funds, planned purchases and travel, and assets, pension
and investments — together with the scenario inputs that vary them. Naming them
here authorises none of them; each still passes its own gate below.

**Safe-to-spend is constrained by the future the plan knows, not by today's
balance and not by the visible range.** `Forecast.recommend` remains the weekly
household cap. Known major costs, required debt payments and the buffer policy
hold back today's figure even when they fall outside the span on screen. That
function, not a second cap, searches `Forecast.knowledgeHorizon`. An estimate
still cannot be presented as verified.

**Forecast preserves simultaneous feasibility among protected commitments.**
Protected future commitments — dated cash events, dated ranges that keep
their deadline without collapsing to a midpoint, and undated known needs —
must remain jointly feasible before any residual is accelerated. A dated
range stays encumbered from the point it is funded or due until settlement
or authorized release; optional residual is after that still-encumbered
principal. That is not a serial leftover queue. Owner-stated priority ranks
only what is left after harder constraints are met, and among optional
items it wins over date. `adjustable` is bounded-flex, not
optional; required / bounded-flex / optional is derived from owner-stated
fields and is never invented onto a live row. When a commitment is fully
funded, paid, deferred, reduced, or otherwise releases contribution
capacity, Forecast reallocates that freed capacity across the remaining
plan. Encumbered principal is not free cash: completion releases future
contribution capacity, not the earmarked principal itself. Freed capacity
does not automatically become safe-to-spend. This is not a goals engine
and not a generic priority schema. `Forecast.fundingSequence` is the
presentation order; `Forecast.recommend` sets the weekly cap as the
maximum current discretionary outflow that leaves the protected master
plan feasible without unapproved borrowing. Promoting a priority ranking
to owner instruction stays owner-reserved (`plan.nextDollar` is still
derived).

**Planned debt is allowed when it is the better household plan, not only
when cash is short.** Intentional borrowing may be part of the planned path
when preserving cash for higher-priority needs is better than paying a
commitment from cash in time. A cash shortfall that cannot cover a
commitment in time remains one valid reason, not the only one. When the
plan includes borrowing, Forecast must project the borrowing, the
consequences — interest, headroom, limit-crossing, later cash — and a
repayment path on the same coupled cash-and-debt walk, in advance.
Unforecast borrowing is not a plan. Debt is deterministic and
owner-constrained; it is never automatic. This does not create a second
debt modeller; `Forecast.projectDebts` and `Forecast.recommend` remain the
walk. It does not authorise an automated action against an account.

**Major future plans show ON TRACK / AT RISK / FUNDING GAP.** A named major
future plan the household is funding — travel, a sports season, the May 2027
renewal, a large purchase — publishes exactly one of those three verdicts from
Forecast, with a dollar funding margin or gap. ON TRACK means the
authoritative/base case is jointly feasible. AT RISK is only an explicitly
represented protected uncertainty case (a range ceiling) failing while the
base case remains feasible. Authoritative infeasibility is a FUNDING GAP;
cutting remaining discretionary is not the AT RISK test. Amount ranges stay
ranges: no midpoint or lower-bound point may masquerade as the requirement.
Pages render the verdict; they do not invent it. This is not a goals
product and not a fifth published-figure trust label. The four-label contract
for a published figure — verified / calculated / estimated / unknown — is
unchanged.

**A scenario changes an input to this plan.** It is not a disconnected
calculator, and its answer is compared against the same baseline the plan
publishes.

**Provenance survives into the plan.** Whether an input or a result is verified,
calculated, owner-stated, estimated or unknown travels with it, so a polished
surface cannot make a provisional assumption look settled. This does not touch
the four-label contract for a **published** figure — verified / calculated /
estimated / unknown, under **Principles** above — which stays owner-reserved.

The evidence behind this — which bills and payroll documents to collect, what is
currently unknown, and what would close each gap — is source intake rather than
direction, and lives in [`docs/MASTER_PLAN_REQUIREMENTS.md`](docs/MASTER_PLAN_REQUIREMENTS.md).
That file records what a document establishes and states no direction of its own;
what a person *said* stays attributed and dated in `docs/household_interviews/`,
per the table above.

### Tier 1 — complete the picture *(in progress)*

The analysis is only as good as its coverage. **Which gaps are still open is
`BACKLOG.md`'s to say**, and `docs/01_OPEN_QUESTIONS.md`'s for anything only the
household can answer. This file names the tier; it does not carry its contents.

That is not tidying. The list that stood here called MBNA and Affirm/Flexiti the
last debts with unknown terms and said net worth was unstateable without a home
valuation — while `BACKLOG.md` recorded capture as complete, Flexiti closed, the
home valued at $1.1m–$1.4m and net worth at $357k–$657k. It also promised four
gaps and listed three. A second copy of another document's work state drifts, and
this one already had.

### Tier 2 — cadence and trend *(the obvious next step)*

**Spending, interest and fees already have history** — `public/periods.json`
feeds a monthly trend on the Deep Dive, and `B65` records the period selector as
done. **Account balances now have dated openings** — `snapshots/<YYYY-MM-DD>.json`
is a by-product of a successful refresh. Each file is a same-date financial-state
subset (account identity, side, currency, posted balance, pending when known),
not a copy of `data.json` policy. `data.json` remains the current-state
authority. The Plan page reads those openings and prints display deltas. A
second independently reconciled opening is required before a trend is claimed;
unknown stays unknown. The 18-month `helocHistory` series on Deep Dive is a
separate monthly chart of historical observations inside current-state
`data.json` and is not this mechanism. The current HELOC opening on that
chart is composed from `debts.heloc`; it is not a second stored copy of
today's balance.

The distinction matters because the loose version of this sentence said the whole
site was a single point in time, which would send later work to rebuild a
spending trend that already ships.

### Tier 3 — an interaction layer *(gated, not yet earned)*

If the site should ever be something the household **writes to** — ticking off
questions, logging a payment, leaving notes — that is one of the two things that
can earn a store. **That trigger has not been reached.**

---

## Authority — what owns what

**Every concept has one owner.** A new piece of work either consumes an existing
owner or explicitly replaces it; it never quietly becomes a second one.

| Concept | Owner today |
|---|---|
| Direction, boundaries, capability gates, the secret boundary | **this file** |
| Who decides, who reviews, what a pull request carries | [`CLAUDE.md`](CLAUDE.md) |
| Work and findings | [`BACKLOG.md`](BACKLOG.md) |
| What only the household can answer | [`docs/01_OPEN_QUESTIONS.md`](docs/01_OPEN_QUESTIONS.md) |
| Standing facts — rates, limits, due dates | [`docs/ACCOUNT_FACTS.md`](docs/ACCOUNT_FACTS.md) |
| Sequencing of planned capability work | [`docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md`](docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md) |
| Whether an explicitly identified supplied evidence item has been routed or parked | [`docs/evidence_use/register.json`](docs/evidence_use/register.json) |
| Agent context architecture — authority vs skills vs learned lessons | [`docs/AGENT_CONTEXT.md`](docs/AGENT_CONTEXT.md) |

### Evidence-Use Register

The register owns **routing and parking**, not financial values. It is an index
over existing authorities, not a sixth architectural layer and not a second
roadmap.

For each explicitly identified evidence ID it records exactly one of:
`CONSUMED`, `PROPOSED`, `UNRESOLVED`, `SUPERSEDED`, or `EXCLUDED`.

**`CONSUMED` means the item is routed to a named incumbent that exists.** It
does not mean the incumbent figure is financially correct, current,
independently verified, or correctly trust-labelled. Pointer existence is not
a green financial proof. Correctness stays with the incumbent, independent
evidence, and the normal figure / review gates. The register does not prove
value freshness: changing a routed payroll amount can still leave CI green.
After `B91` exists, fold or derive the useful routing protection into that
loop; do not delete the register until that replacement is proven.

CI covers **declared IDs only**. It cannot read Markdown and decide what is
material. An unidentified sentence is outside this gate.

### Atlas is not greenfield

The financial authorities below are **incumbent**. Later work evolves, derives
from, replaces or deletes one of them — and says which. It does not stand up a
second engine, a second weekly figure, a second budget or a second calendar
beside them. This repository has already shipped that failure, publishing
`$1,650/wk` in one tile and `$0/wk` below, because two pieces of code answered
the same question. The schedule overlap that used to sit under this table is
closed: `Forecast.expandEvents` is the one cash calendar.

| Concept | Incumbent authority |
|---|---|
| The schedule — what is due, when, how often | `Forecast.expandEvents`, via `simulate`, from the `plan` inputs. An unresolved known once cash obligation still on the plan remains binding when Forecast start advances past its reservation date; the event keeps that scheduled date rather than acquiring the caller's start, and the cash walk still deducts the amount at this opening. The coupled `projectDebts` walk applies that same cash obligation at this opening via the same `cashWalkDate`; absorption still keys the original scheduled date, so `recommend` cannot drop the carried amount after caps. Advancing as-of is not settlement evidence. Received once income keeps window semantics. Non-cash once charges keep window semantics so a historical capitalisation is not applied again. Settled once outflows are removed, named on `representedEvents` for this start, or encoded as `firstDue` on the recurring row. Dated occurrences already inside the opening observation may be named on `plan.opening.representedEvents` or `opts.representedEvents` and are omitted only when that date is the simulation start (`plan.opening` only when its `asOf` is that start). A future represented date is ignored. That list is opening-date settlement evidence, not a date-wide skip and not a second event engine. A dated commitment may carry `settledOn` (a `YYYY-MM-DD`). `Forecast.commitmentSettledBy` treats that cash requirement as already satisfied only when the date is on or before the simulation start. The record stays; its scheduled date does not move. Human-readable historical status is derived from the date's presence. Sinking-fund and estimated-commitment risk use the same helper. `representedEvents` is not used for this. A dated bill may carry `payingAccount`. `Forecast.billIsHouseholdObligation` is true unless the bill is explicitly `householdObligation: false`; paying-account metadata never flips that. `Forecast.billAffectsJointCash` suppresses joint-cash deduction only when the paying account is on `plan.startingCash.heldElsewhere`. No payingAccount, a `breakdown` payer, or an unknown/typo id fail closed and still deduct. An externally paid household obligation still appears on the `expandEvents` schedule and in `Forecast.nextDue`; `Forecast.simulate` and `Forecast.nextPaymentOut` do not treat it as cash leaving the joint pool. A utility account balance is not a bill |
| Cash projection over the window | `Forecast.simulate`. `opts.horizonDays` walks the master; `opts.viewDays` slices the same walk for display; `opts.viewStart` may begin that slice after as-of so a custom range is a real offset, not an as-of prefix of the same length. A sliced week recomputes its in-range income, bills, obligations, variable and other aggregates from the clipped events and days; it does not keep the original week's full totals. Default remains `plan.windowDays` so a caller that has not asked for the master still gets the view |
| Knowledge horizon — how far the master forecast knows | `Forecast.knowledgeHorizon`. At least twelve months for every plan, independent of whether recurring streams exist, and always long enough to include every dated unsettled commitment, including range-only rows that have a date but no point amount. Undated rows do not extend it and do not become cash events. The visible range is not an input |
| Weekly household cap | `Forecast.recommend` — **and only it**. The weekly search walks `Forecast.knowledgeHorizon`, not the visible range, so a dated commitment outside the span on screen still binds today's figure. Undated protected principal and still-unsettled dated-range principal are encumbered against the same master walk, so a known undated commitment or a funded-but-unpaid dated range constrains today's cap rather than being labelled after the fact. An unsettled dated point commitment whose scheduled date is before as-of remains protected principal until `settledOn`, cancellation, or authorized release; passing the due date does not invent a new due date and does not turn the unpaid amount into spendable cash. Overdue protected point amounts and overdue dated-range floors are an as-of constraint: current surplus after the model buffer and same-day authoritative cash effects must cover their aggregate floor, so later horizon income cannot make a past deadline look feasible. A passed ranged deadline keeps its original date and its min/max; it is not tested against a simulation day that does not exist. Explicitly authorized planned debt may close that current gap only through the existing same-walk financing path. Opening-gap detection stays on the visible opening so a later shortfall cannot become an Amanda/HELOC injection today. When even zero discretionary spend cannot keep the protected plan feasible, `Forecast.recommend` returns `mode: infeasible` with the first failing constraint, date, dollar shortfall and affected commitment; it does not publish `$0/week` as a feasible safe-to-spend answer. `holds` is that same protected-feasibility predicate (cash buffer, still-encumbered principal including overdue unsettled point amounts and overdue dated-range floors, every still-future dated-reserve deadline). The same result derives `nearBoundary` from existing `zero.events`: named joint-cash outflows on the next payday date and the following calendar day. That list is payday-output visibility, not a second horizon |
| Funding sequence among future commitments | `Forecast.fundingSequence`, from unsettled `plan.commitments`. Presentation order only: required, then bounded-flex, then optional. Protected rows then use dated timing, certainty, and owner-stated `priority`. Optional residual ranking is owner-stated `priority` first, then date and certainty — an earlier optional item does not outrank a later one the owner ranked higher. Feasibility is simultaneous, not this list consumed as a serial leftover pool. No commitment id is special. Completing or disabling one item drops it from the sequence and releases future contribution capacity; encumbered principal is not free cash |
| Major future-plan verdicts — ON TRACK / AT RISK / FUNDING GAP | `Forecast.majorPlans`. ON TRACK means the authoritative/base case is jointly feasible, with a dollar margin. AT RISK is an explicit protected uncertainty case (a range ceiling) failing while the base case remains feasible. FUNDING GAP is authoritative infeasibility on this path, with a dollar gap. A dated range is tested against surplus on its stated date, not against leftover after later income, and remains encumbered from the point it is funded or due until settlement or authorized release. An overdue protected point amount or overdue dated-range floor is tested against as-of surplus, not leftover after later income, keeps its original scheduled date, and is aggregated with every other overdue protected floor so the same current dollar cannot fund two of them. An overdue range stays a range: min/max are not collapsed, and a missing pre-as-of simulation day is not treated as a full-floor gap when current cash covers the floor. Dated-range margin is `surplus − due.floor` (base) and `surplus − due.ceiling` (uncertainty), not the surplus itself: ON TRACK exposes the nonnegative uncertainty margin, AT RISK the positive base margin with the ceiling shortfall, FUNDING GAP a negative base margin. Optional residual is taken after all still-encumbered protected principal. Optional items contribute nothing to protected safe-to-spend but keep their actual point or range target for residual funding, margin/gap, and owner-priority ranking. Ordinary transactions and budget categories are not graded. A range is not collapsed to its floor. Flexible items may be marked deferred; a non-flexible date is never rewritten |
| Planned-debt consequences when borrowing is explicitly permitted | `Forecast.plannedDebt`. Default is `permitted: false` and `borrowed: 0`. A purpose-specific draw requires named purposes (`plannedDebtPurposes`); a generic allow flag does not finance every gap. An owner-authorized amount (`plannedDebtAmounts`) may finance a named purpose even when the cash path is already feasible; a cash shortfall is one reason to borrow, not the only one. Capacity uses `openingBalance` (posted plus pending); unknown pending is not usable room. The draw is capped by named-facility capacity (and an owner `plannedDebtMax` when supplied), inserted into the same Forecast cash projection and `Forecast.projectDebts` walk as proceeds, interest, future balance, and required repayment cash flows, and is feasible only when a repayment cadence is supplied, that post-financing walk still holds the protected plan under the same predicate as the weekly search (buffer path, overdue as-of constraint, still-encumbered principal, and every still-future dated-reserve deadline), and the named facility never crosses its limit on the walk — not only that the ending balance is under. Automatic draws for protected overdue purposes consume that protected overdue aggregate remaining once, but only up to the base floors of the named auto-eligible protected overdue purposes — naming one purpose does not authorize financing another. An earlier explicit `plannedDebtAmounts` draw on the same protected overdue pool reduces the shared remainder before any auto-sized draw is added. Each auto draw is also capped by that named purpose's own base floor. Optional overdue residual purposes keep independent remaining and are not collapsed into that shared protected gap. Q19 HELOC cash treatment is not resolved here |
| Income dependency deadline — when a modelled income becomes required to preserve the buffer | `Forecast.incomeDeadline` |
| Next due — which named cash obligation the household owes soonest | `Forecast.nextDue`, from `Forecast.expandEvents`. Names one event; two obligations on one day do not become a day-total. Distinct from `Forecast.nextPaymentOut`. `public/deepdive.js` holds the wording only |
| Next payment out — cash leaving on the next outflow date of the projection | `Forecast.nextPaymentOut`, from the same `expandEvents` stream (`sim.events` on the Plan page). Names the day and sums every cash outflow on it; two registrations on one day are one payment as far as the account is concerned. Distinct from `Forecast.nextDue`, which names one obligation from that stream. `public/plan.js` holds the wording and the 3-day tile tone only |
| Unallocated ending cash — the remainder after the target buffer and windowed reserves, and whether that is free cash | `Forecast.unallocatedCash`, from `sim.ending`, `sim.buffer`, `budget.reserveMonthly` and `plan.windowDays`. Converts the monthly reserve over the window with the calendar month `365.25 / 12`, subtracts buffer and reserves, and decides the leftover verdict on the published cent. `public/plan.js` holds the wording only |
| Compact snapshot — secured debt total, monthly interest across every facility, and HELOC month-on-month direction | `Forecast.compactSnapshot`, from the debt records' posted `balance` / `annualInterest` / `secured` and `helocHistory`. `balance` is the posted opening; pending is added only through `openingBalance`. A month of interest is a twelfth of the recorded annual figure. The HELOC verdict is the posted `debts.heloc` opening minus the last monthly `helocHistory` observation; `helocHistory` is not a second current balance. The verdict follows the published whole-dollar delta, so a move that prints `$0` is unchanged rather than growth. `public/plan.js` holds the wording and the sign only |
| Publication totals — Deep Dive headline total debt, annual interest and credit left; Records net-worth lines; the income footer; the commitments total; the lacrosse verified total; and the HELOC limit the history chart draws | `Forecast.publicationTotals`, from posted `debts` balances and `annualInterest`, `assets` values (cash rows derive from `plan.startingCash` via a `cash` id; non-cash rows keep their own value), `income` line totals over `incomeCaptureMonths` (the historical income evidence window, not a code constant and not `periods.json` spending buckets), unsettled `plan.commitments` (the one home for known major future costs; open ranges contribute no point amount), `lacrosse.sources`, the HELOC debt `limit`, and `Forecast.utilisation` for headroom. Recurring historical-income monthly figures are `round(total / incomeCaptureMonths)`; a stored `perMonth: null` keeps a one-off from becoming recurring. The same twelfth `compactSnapshot` uses. Pages hold the wording only |
| Deep Dive derived totals — held-elsewhere grouping, period spending average, discretionary share, avoidable fees, Cash Back Visa cycle fit, the mortgage's monthly interest, and the published HELOC history/trend | `Forecast.deepDive`, from `plan.startingCash.heldElsewhere` values and the spendable breakdown sum, the selected `periods` entry, `interestCheck` rows, the `cashback` / `mortgage` / `heloc` debt records, and `helocHistory`. The card rate is the Cash Back Visa `rate`; a cycle is off when `|eff − rate| > 4` percentage points, the incumbent band. Mortgage monthly interest is `monthOfAnnual` on that debt's `annualInterest` — the same twelfth `compactSnapshot` uses. Discretionary share counts only rows whose published spend type is `discretionary`; a mixed essential/discretionary source category publishes as `unknown` and is not counted as either class. The published HELOC series is the stored monthly observations plus the current `debts.heloc` opening. The month-on-month delta is the same `debts.heloc` minus last observation identity `compactSnapshot` uses; Deep Dive classifies that delta, and the since-paydown delta, by the published cent (`money2`) so a sub-dollar move cannot read unchanged beside two different displayed balances. The compact Plan tile keeps whole-dollar classification. `public/deepdive.js` holds the wording only |
| Plan phase titles and the risk list — which heading each 30-day block gets, which risks appear, and the figures inside them | `Forecast.planPhases`, from the `recommend` and `projectDebts` results plus the already-run `incomeDeadline`, `counterfactuals` and `budgetBreakdown`. Over-limit-today and the HELOC crossing are the same helpers `Forecast.mission` uses. The Amanda window impact is the incumbent `amount × 3`. The HELOC draw is `drawnOn(funding, 'heloc')`, the same sum the HELOC alternative prices. `public/plan.js` holds the wording only |
| Coupled cash-and-debt walk | `Forecast.projectDebts`. Past unresolved once cash obligations are applied at this opening via the same `cashWalkDate` `simulate` uses; `obligationAbsorbed` still keys the original scheduled date |
| Revolving headroom, limits, pending | `Forecast.utilisation`, from posted `debts` plus pending via `openingBalance`. Chequing B overdraft `used` is `max(0, −` the `chequing-b` cash-register balance `)`; the facility keeps its own limit, label and note. Synthetic fixtures may still pass `used` with no `cash` id |
| Budget — owner targets against actuals, including the grocery and fuel monthly figures the Plan page prints | `Forecast.budgetBreakdown`, with classification, owner targets, and any current-regime assumption in `data.json` `plan.budget`. Each category's `gross` is the pre-dated monthly amount (owner target if present, else current-regime undated + dated, else historical); `planned` is that amount after dated items. A `currentMonthly` value is the known undated current recurring amount and outranks the historical average; it loses to an owner target. The `cap` block publishes the grocery/fuel pair from those fields and does not re-decide the fallback. `public/plan.js` holds the wording only |
| Weeks in a month, and every figure converted between the two | `WEEKS_PER_MONTH` in `public/forecast.js` — the calendar's own `365.25 / 12 / 7`, deliberately **not** exported. `Forecast.monthlyFromWeekly` says a weekly cap in months; `Forecast.budgetBreakdown`'s `cap` block owns every other conversion |
| Whether the weekly cap leaves any discretionary room, and the shortfall when it does not | `Forecast.budgetBreakdown`'s `cap` block, measured against the weekly figure the page is **showing**; `public/plan.js` holds the wording only |
| The mission — which instructions the homepage gives, and in what order | `Forecast.mission`, from the `recommend` and `projectDebts` results. When `recommend.mode` is `infeasible`, that is the mission outcome and spending / surplus-use instructions are not emitted. When `recommend.nearBoundary` has items, that instruction is emitted before surplus-use (`helocLimit` / `surplusToCard`); `public/plan.js` holds the wording only |
| The status band — which of eight verdicts the Plan page publishes about the window, and the dates inside it | `Forecast.planStatus`, from the `recommend` result and the simulation on screen; `public/plan.js` holds the wording, the tone class and the HTML only. `infeasible` is copied from `recommend.mode` / `advice.infeasible` |
| Current funding-option available / revolving headroom used to cover an opening gap | `Forecast.resolveFundingSources`, from extra-facility `cash` locators, `Forecast.utilisation` (`debtId` locators and residual unclaimed revolving rows), and extra facilities. A `cash` locator onto `plan.startingCash.heldElsewhere` is observational identity only and is not household funding while Q25 is OPEN — the raw held-elsewhere balance is not `available`. Stored `plan.funding.options[].available` is not current-state. A usable option with a declared planning available and no locator keeps that figure. `Forecast.recommend` consumes that view. `public/plan.js` holds the wording only |
| Whether a funding source covers the opening gap, contributes to it, or cannot reach it | `Forecast.recommend`'s funding result — `funding.sources`, the same allocation seen per source; `public/plan.js` holds the wording only |
| Alternative opening-gap assumptions — which counterfactual applies, what assumption stands for it, and whether its answer means anything | `Forecast.counterfactuals`, from the `recommend` and `projectDebts` results. Each alternative copies `recommend`'s `planOptions` and replaces exactly one key, so the scenario, buffer, overrides, disabled commitments and debt state cannot drift from the plan on screen. Full coverage is exactly the shortfall, finite and non-borrowed; a facility funds the gap only through its own declared headroom. `public/plan.js` holds the wording only |
| The May 2027 renewal — what it costs, what folding the HELOC in changes | `Forecast.renewal`, from the debt records and `plan.obligations`; `public/modellers.js` holds the wording only |
| Mortgage rate conventions — what a quoted rate means | `RATE_BASIS` in `public/forecast.js`: fixed compounds semi-annually, variable monthly. `Forecast.renewal` requires the basis and has no default |
| The next move the household is told to make | `plan.actions` in `data.json` for owner-policy rows (what, amount, due, owner). Current-limit satisfaction on a row with `debtId` is `Forecast.resolveActions` from utilisation (unknown pending or over-limit stays `open`; otherwise `done`). `public/plan.js` renders `Forecast.resolveActions` / `Forecast.nextMove` |
| What the next move achieves — which of five outcomes the "What happens after" line publishes, and the figures inside it | `Forecast.nextMove`, from the `recommend` result, the simulation on screen and `plan.actions[0]`. The action's amount is a fixed figure sized for the default buffer, so coverage is judged against the **current** gap on the engine's own half-cent — and restoring that gap takes coverage **and** a due date on or before it, since money arriving after the day it is needed clears nothing on that day. `public/plan.js` holds the wording only |
| Where the next surplus dollar goes | `plan.nextDollar` in `data.json`; its `target` feeds `Forecast.projectDebts` |
| Payoff modelling — which debts may be modelled, what a payment does to one, and what clears it | `Forecast.payoffDebts`, `Forecast.payoffModel` and `Forecast.paymentForMonths`, from the debt records and `plan.obligations`; `public/modellers.js` holds the wording only |
| Debt rate conventions — what a debt's quoted rate means per period, and how closely a monthly model reproduces it | `PAYOFF_RATE_BASIS` and `PAYOFF_BASIS_PRECISION` in `public/forecast.js`, from each debt record's `rateConvention`. A prime-linked facility is compounded monthly, so a monthly period is **exact**. A card charges a daily rate over the days in each statement cycle, so a monthly period is a **monthly-equivalent** average: exact over a year, and published with the cycle band for any single period. An undeclared convention throws |
| What one debt costs the household in cash each month | `monthlyCashFor` in `public/forecast.js`, from `plan.obligations`; read by both `Forecast.renewal` and the payoff modeller |
| Historical spending series | generated `public/periods.json`, from `scripts/periods.js`. Category rollup is `Forecast.rollupSpending`: mixed comparable source types (`essential` and `discretionary`) publish `type: unknown` with the source `types` retained, rather than the first event's class. Totals stay conserved. |
| Account-balance history — dated openings only | `snapshots/<YYYY-MM-DD>.json`, written by `scripts/snapshot-balances.js` after a successful canonical refresh. Same-date subset of `plan.startingCash` / `debts` (identity, side, currency, posted balance, pending). Mixed-date `positions.csv` rows are omitted. Re-running the same reading is a no-op; a conflicting same-date file fails closed. Not current-state, not Forecast input, not spending history. Spendable completeness for a dated opening is derived from that opening's `plan.startingCash.breakdown` and stored on the snapshot as coverage metadata; `public/plan.js` / `public/balance-history.js` consume that metadata and hold display deltas and wording only. A spendable-household-cash total is withheld unless every expected spendable identity from that dated opening is present. Revolving display shows posted and pending separately and does not trend when pending is unknown |
| Published facts and owner policy | `data.json` |
| Derived publication aggregates of those facts | `Forecast.publicationTotals` |
| Calendar — the on-page month grid and agenda | `renderCalendar()` in `public/plan.js` — **presentation of `sim.events` only** |
| Calendar — the exported `.ics` | `scripts/calendar-ics.js`: cash-payment VEVENTs **derived** from `Forecast.expandEvents` over a longer horizon; standing reminder VEVENTs (statement closes, tax deadlines, mortgage renewal) remain a thin non-cash overlay. `X-WR-TIMEZONE` is `Forecast.HOUSEHOLD_TIMEZONE` |
| Read-only provider observation | `scripts/provider-observe.js` turns a Lunch Money fixture, or a local GET when `LUNCHMONEY_ACCESS_TOKEN` is set, into B91 observations. Live mapping is by provider account ID, not display name. Real live IDs stay in gitignored `docs/connectivity/provider-account-map.local.json`; the committed live map remains the empty schema. Fixture mapping lives only under `docs/connectivity/fixtures/`. Unknown IDs stay unmapped. Mapped revolving-credit pending transactions become `fact: pending` observations (Lunch Money v2: positive debit, negative credit). Same `providerTransactionId` pending+posted collapses to posted and does not double-count. Numeric pending is the sum of unresolved mapped pending components. Proven zero pending is emitted only when `GET /v2/transactions?is_pending=true` with no `start_date`/`end_date` completes with `has_more=false`; absence of pending rows inside the bounded `include_pending` history window is not zero and remains UNKNOWN / unproven. A pending bill/payment older than 90 days may be presumed settled for current forecasting only (`confidence: inferred`); historical provider status stays pending. That 90-day rule is not a universal STALE threshold. Transaction history is `--history-days` / `--mode current-state` (14 days) or `--mode reconcile` (120 days). `representedEventCandidates` require payee pattern + mapped account + scheduled date; amount similarity is not identity and does not write `plan.opening`. Candidates whose scheduled date is not the current opening as-of are historical evidence and are not fed to the current-opening posting compare; they must not backfill `representedEvents`. Same-day CHANGE records no canonical winner when time evidence is missing. `--identity-proof` prints a sanitized identity fingerprint. Instants become household financial dates through `Forecast.financialDate` in the ACCOUNT_FACTS timezone `America/Vancouver`; a UTC `YYYY-MM-DD` prefix is not a household date. Never writes `data.json`. Not a financial authority, not Forecast, and not a silent writer. |
| Trusted canonical refresh | `scripts/canonical-refresh.js` is the earned write path. It consumes the incumbent observer and reconciler, emits a deterministic sanitized preview, and writes `data.json` only after an exact owner approval matches that preview. Four distinct approval contracts: `previewId` (`atlas-canonical-refresh-preview/v1`) authorizes posted household-cash values and posted debt balances whose reconcile status is CHANGE and whose date relation is canonical-older; `cutoverApprovalId` (`atlas-cutover-pending-approval/v1`) authorizes only the exact candidate-date pending transitions and does not advance the opening; `openingApprovalId` (`atlas-opening-cutover-approval/v1`) authorizes one atomic opening cutover binding the complete candidate posted state, the complete candidate pending state, candidate-date `representedEvents`, the incumbent balance-map routing from canonical locator to Household `accountLabel` and `observationId` plus excluded labels, and advancing `meta.asOf` / `plan.opening.asOf` together; `recoveryApprovalId` (`atlas-opening-artifact-recovery-approval/v1`) authorizes reconstruction of missing same-date Household `positions.csv` rows and `snapshots/<date>.json` from a complete MATCH observation packet when that canonical opening already exists, and binds the exact proposed recovered positions and snapshot bytes plus expected artifact pre-state so an unrelated incumbent structural edit cannot reuse the old approval. Recovery never writes `data.json`, never infers those artifacts from `data.json` alone, never advances the opening, and cannot be authorized by `previewId`, `cutoverApprovalId`, or `openingApprovalId`. Unmapped, unknown, stale, same-day, conflicting, credit-capacity, and historical-opening evidence are refused. Default is non-writing. Optional `--cutover-as-of YYYY-MM-DD` appends the opening-cutover preflight: MATCH is not freshness, unresolved same-day/pending evidence fails closed, UNKNOWN pending and unproven zero block the opening, and same-day scheduled events require representation evidence. Opening-cutover freshness compares those household dates, not UTC date prefixes. Statement cadence may accept older posted evidence without rewriting `evidenceDate`. The preflight preview never writes. `--cutover-as-of --apply --approve-opening <openingApprovalId>` is the only write that establishes a new canonical opening. `--cutover-as-of --recover-opening-artifacts --apply --approve-recovery <recoveryApprovalId>` is the only write that reconstructs missing same-date positions and snapshot for an already-approved opening; it reuses `opening-household-rows.js` and incumbent snapshot-balances semantics and is atomic/fail-closed. Unattended production writes and a Render token are not this command. Snapshot history stays `scripts/snapshot-balances.js` after a successful opening. Forecast remains the planner. The live household opening remains a later explicit owner-approved run. |
| Observation-to-canonical cash/debt compare | `scripts/reconcile.js` (non-writing). Maps `docs/positions.csv` Household rows through `docs/reconciliation/balance-map.json` id locators onto `plan.startingCash` / `debts`. Commitment settlement observations live in `docs/reconciliation/commitment-settlements.json` and compare a paid date against `plan.commitments[].settledOn`; they do not go through `positions.csv` or the balance map. Hydro observations live in `docs/reconciliation/utility-observations.json`. Amanda-income observations live in `docs/reconciliation/amanda-income-observations.json`. Card-state observations live in `docs/reconciliation/card-state-observations.json` and distinguish posted balance, pending, limit, available credit, and confirmed payment; they are not a second financial authority. Limit and available credit are never household cash. Unknown pending is not $0. Pending is not manufactured as limit − posted − available unless that identity is proven for that card and timestamp. Posting observations live in `docs/reconciliation/posting-observations.json` and compare whether a scheduled occurrence has posted against `plan.opening.representedEvents`. Forecast remains authority for what should happen; posting evidence is authority for what has happened. Unknown posting is not posted and is not unposted. Does not write `data.json`. STALE is not assigned. The owner 90-day rule lives on pending bill/payment observations in `scripts/provider-observe.js` and is not a reconcile STALE status. Not a universal fact database |

**The 2026-08-16 master-forecast contract is now earned in Forecast.**
Safe-to-spend across the known future is `Forecast.recommend` walking
`Forecast.knowledgeHorizon` and reserving protected principal jointly.
Funding sequence is presentation order; reallocation of freed contribution
capacity is `Forecast.fundingSequence` plus the weekly search. Planned-debt
consequences with a repayment path are `Forecast.plannedDebt` and stay
opt-in. ON TRACK / AT RISK / FUNDING GAP are `Forecast.majorPlans`. A page,
ChatGPT, or Sheet that answers any of them first is the `B73` defect
arriving through a new door.

**The table is not a closed list, and reading it as one is how work goes wrong.**
Three rounds of advisory review added five rows to it that inspection had missed.
So the rule, not the enumeration, is what binds:

- **`data.json` `plan` is the authority for what the engine is told** — the
  obligations, bills, commitments, groups, funding, budget targets, `nextDollar`
  policy and written actions. Changing what the household is *told to do* means
  changing `data.json`, not adding logic that decides it elsewhere.
- **`Forecast` is the authority for what follows from that** — the schedule, the
  projection, the cap, the debt walk, headroom and the budget split. Changing what
  *follows* means changing the engine, where the node suite can prove it.
- **A page script renders; it does not decide.** `renderCalendar()` and
  `renderPlan()` format what they are given.

**Page scripts broke that third rule in the instances `B73` recorded, and those
instances have moved.** The scan for the ones nobody had named ran on
2026-08-12. It read every browser file and found eight more — the largest being
the status band at the top of the Plan page, which selects which of seven
verdicts the household reads and picks two of the dates inside them. Seven of
the eight were found by reading; the eighth, the funding-source cards a few
lines below that same band, was found by the required review after the scan had
called itself complete. `B73` is the work record for which they were, that they
have now all moved, and that the item is closed. **None of those page-side
defects was a row in the table above**: a page script that decides is an unnamed
authority, which is a defect to close, not an incumbent to register. The rows
the moves added name the engine functions that replaced them.

The recorded instances have been moved into the engine rather than argued away.
The Amanda-transfer deadline: `public/plan.js` re-ran the simulation with her
transfer zeroed and selected the first below-buffer day itself, and
`Forecast.incomeDeadline` now owns that counterfactual. The "Next due" tile:
`public/deepdive.js` used to filter a hand-kept `upcoming` list; `Forecast.nextDue`
now selects from the same `expandEvents` stream the Plan calendar already uses. The homepage
mission: `public/plan.js` chose which instructions the household was given and
composed the sentence, and `Forecast.mission` now owns that selection, returning
the instructions and the figures behind them while the page keeps the wording.
The May 2027 renewal: `public/modellers.js` compounded the HELOC, totalled both
sides' interest and compared the result against today's household cash, and
`Forecast.renewal` now owns all of it — including the amortised payment, which
had been sitting in `public/app.js`, the shared page core, where it decided a
household-facing figure outside the suite's reach. The payoff modeller:
`public/modellers.js` solved the annuity behind its "clear in 5 / 3 / 1 years"
presets and picked its own slider floor, on top of `payoff()` in that same page
core, and `Forecast.payoffDebts` / `Forecast.payoffModel` now own which debts may
be modelled, what each owes today, the rate convention each is charged under, the
minimum a larger payment is measured against, and the projection itself. The
status band and the funding-source cards, which moved together because they read
one result: `public/plan.js` re-derived `fundingShort`, hand-copied the engine's
buffer comparison and its EPSILON as `sim.min.balance < sim.buffer - 0.005`,
selected which of seven verdicts the household read, walked the daily balances
for the first breach and the first negative day, totalled the funding parts, and
a few lines below asked `o.available >= needed` about each source in its own
arithmetic. `Forecast.planStatus` now owns the verdict and both dates, and
`Forecast.recommend`'s funding result owns the per-source coverage — so the two
cannot disagree, which they had. The Deep Dive derived totals: `public/deepdive.js`
grouped and totalled `heldElsewhere`, averaged a period's spending, totalled
discretionary spend and avoidable fees, flagged Cash Back Visa cycles with a
page-side `26.99` and a ±4pp band, summed the implied and charged columns, and
hardcoded `~$1,620/month` for the mortgage, and `Forecast.deepDive` now owns
all of it — the card rate from the Cash Back Visa record, the incumbent `>`
band, and `monthOfAnnual` on the mortgage's `annualInterest`, the same twelfth
`compactSnapshot` uses. The published HELOC history chart used to draw a
hand-maintained current endpoint from `data.helocHistory` beside a different
live `debts.heloc` opening; `Forecast.deepDive` now composes that series from
the monthly observations plus the current debt record, and the page holds
the wording. In each
case the page renders the returned result and a focused test reconciles the move
against a hand-computed case.

**This section used to say "no page script is known to break it", and the scan is
why it no longer does.** The count said *two* until a review found a third, in
the same file as one of the renderers this section praises; it reached zero
because five were moved, not because anything had audited what was left. Moving
an authority out of a file does not clear the file — the payoff modeller was
still deciding in `public/modellers.js` after the renewal moved out of it, and
`public/plan.js` held seven of the eight instances the scan found, having
already had two moved out of it — and one of those seven was missed by the scan
itself and caught by the review. The recorded `plan.js` and `deepdive.js`
instances have since moved; `B73` is the work record, now closed. The absence
of a known instance was never evidence that none existed, and searching is what
settled the recorded set.

Anything not named above belongs to one of those three rules, or is that defect.
If it is genuinely unclear which, that is a question for the required review —
never a licence to stand up a fourth answer.

Four of those rows carry a trap, and each is recorded rather than smoothed over.

**The cap and the next move are two authorities, not one.** `recommend` computes
the cap, the gap and the funding result; the instruction the household actually
reads is authored by hand in `data.json` `plan.actions` and rendered from
`plan.actions[0]`. They were one row here until an advisory review split them —
which matters, because a later change to the recommender that leaves the written
action untouched would move the figures under an instruction that no longer
matches them, and nothing would notice.

**`Forecast.recommendWeekly` is not a co-owner of the weekly cap.** It is the
solver `recommend` calls, and on an opening-gap plan it returns `0` while
`recommend` funds the gap and re-solves for the cap the household can actually
afford. When even zero spend cannot keep the protected plan feasible,
`recommendWeekly` still returns `0` and `recommend` returns `mode: infeasible`
rather than publishing that zero as a feasible cap. `forecast.js` calls
`recommend` *the* single authority in its own words.
A page reading the solver directly is precisely how `$1,650/wk` and `$0/wk`
shipped on the same screen — so later work consumes `recommend`, never the
solver beneath it.

**The renewal comparison is `Forecast.renewal`'s, and it opens on the same debt
state as everything else.** It reads balances through the shared
`openingBalance` rule — posted plus pending, the rule the debt walk opens on and
headroom is measured against — and takes today's household cash from
`plan.obligations`, so the HELOC's $0.00 of cash is derived from its `nonCash`
charge rather than asserted, and a change to the mortgage payment moves the
comparison the household reads. `data.json` `mortgage` keeps the renewal's
standing facts (maturity, remaining years, prepayment room) and is no longer a
second home for the balance, rate, or bi-weekly payment the arithmetic and the
slider open on. What is left in the page is
wording, colour and layout.

**A quoted rate is not a number on its own, and the renewal used to treat it as
one.** Canada prices the two mortgage products on different compounding: a fixed
rate is quoted "calculated half-yearly, not in advance", a variable rate
compounded monthly. The modeller applied the monthly convention to every rate its
slider could reach, including the fixed quotes TD's April 2027 offer letter will
carry. On TD's own published example — $300,000 at 3.00% — that is $2,071.74 a
month against a true $2,069.07 over 15 years; on this household's balance at
3.64% over 18 years it overstated the payment by $7.57 a month and $1,634.99 over
the term. `RATE_BASIS` now holds both conventions and `Forecast.renewal` **requires**
the caller to name one: there is deliberately no default, because a default is
the assumption again with better manners. The page makes it a household choice
and never prints a rate without its convention. The HELOC keeps its own — it is
prime-linked whatever the mortgage renews into, so choosing fixed must not
reprice the facility sitting beside it.

**The schedule has one owner.** Dates, amounts and recurrence are
`Forecast.expandEvents`'s, from the `plan` inputs. `renderCalendar()` only
formats the `sim.events` it is handed. The exported `.ics` derives its
cash-payment VEVENTs from that same expander over a longer horizon; statement
closes, tax deadlines, the mortgage-renewal countdown and the HELOC contractual
21st remain reminder-only look-points and are tagged so they cannot be read as
chequing outflows. A
hand-kept `upcoming` list used to be a third schedule; it is deleted. Paid
forensic notes live in `data.json` `settled` as an overlay and do not decide
what is due. A commitment that has already been paid keeps its dated
`plan.commitments` row and records that fact as `settledOn`. Forecast
omits the future cash event only when `settledOn` is on or before the
simulation start.

**HELOC 21st vs month-end is not settled by this architecture.** The live cash
plan still models HELOC interest as a month-end `nonCash` capitalisation,
because the observed posting is a debit on the HELOC itself with no matching
chequing payment. TD also states a contractual minimum due on the 21st. The
Aug. 14 payday session added contradictory household evidence (~$1,000
historical payments; owner belief that payment/interest came from chequing;
autodebit mechanics unverified). The exported calendar keeps that 21st as a
reminder-only look-point, not a chequing outflow, and derives the month-end
capitalisation reminder from the Plan. The architectural split remains:
month-end `nonCash` capitalisation on the cash plan, 21st reminder-only on
the calendar. This file does not pick 21st or month-end to make the calendar
cleaner. Remaining August 2026 household cash impact is answered in
[`docs/01_OPEN_QUESTIONS.md`](docs/01_OPEN_QUESTIONS.md) Q19: the 14 August
$1,100 payment satisfies the $814.18 minimum, so Forecast must not reserve
another August joint-cash HELOC minimum. That does not make interest free.

**Current-state refresh uses Lunch Money as the normal feed; Forecast stays
the engine.** Owner decision **2026-08-17**: Lunch Money is the household's
normal operational financial update feed. Forecast remains the deterministic
financial engine and the sole planning / calculation authority. Lunch Money
is evidence, not the planner, not canonical household policy, and not
authority over future commitments, priorities, or owner decisions. The live
read-only GET seam (`scripts/provider-observe.js`) is an **incumbent** and
has already been exercised. `scripts/reconcile.js` is the non-writing
compare. **T4 passed 2026-08-17.** `scripts/canonical-refresh.js` is the
earned preview / approve / bounded-write path. **Unattended production
writes are not approved.** B91 is done. Direction, not a schema:

- freshness belongs to the evidence class (live balances, contractual
  recurring facts, household policy, derived engine results), not merely one
  typed `meta.asOf`;
- a live opening observation needs cutover / as-of semantics so events
  already represented in that observation are not replayed;
- Forecast schedule is authority for what *should* happen; settlement
  evidence is authority for what *has* happened;
- account/statement balance, past-due amount, current amount due, and due
  date are distinct;
- “is this a household obligation?” and “which account pays it?” are
  distinct;
- posted balance, pending, limit, and available credit are distinct, and
  available credit is never cash;
- an account balance is not automatically spendable household cash;
- reliable salary, coaching net economics, and transfers must not share one
  income authority;
- `Forecast.recommend` is the mathematical maximum under the protected
  floor, not an operational household target unless owner policy exists.

Do **not** satisfy this gap with a database, second canonical store, generic
fact schema, workflow engine, event sourcing, classification registry,
provenance graph, staging platform, generated `data.json`, `plan.proposals[]`,
a `source` object on every numeric leaf, a second payday or budgeting engine,
or leaf-level provenance. Existing interviews, open questions, and dated
owner policy remain enough for household intent. Preferred shape, when built:
existing observation record → one canonical pointer into `data.json` →
comparison → owner-approved canonical edit → Forecast. The first B91 slice
adds the non-writing compare (`scripts/reconcile.js`) and the
`representedEvents` cutover on `Forecast.expandEvents`. The D3 slice adds
`settledOn` on a dated commitment and settlement observations against that
field. The D4/D5 slice adds Hydro observations
(`docs/reconciliation/utility-observations.json`) that distinguish an
informational account balance from dated `plan.bills` dues, and paying-account
attribution from household-obligation status. Live Hydro canonical state is
unchanged. The D2 slice adds Amanda-income observations
(`docs/reconciliation/amanda-income-observations.json`) that distinguish
Tennis BC salary deposits, coaching/business inflows, business
obligations, household transfers, and household-available remainder.
`plan.income.amandaTransfer` remains the household-cash Forecast
authority; observed salary is not promoted into Forecast. Unknown
business obligations fail closed and do not invent a remainder. Live
Amanda income canonical state is unchanged. The D8 slice adds card-state
observations (`docs/reconciliation/card-state-observations.json`) that
distinguish posted balance, pending, limit, available credit, and
confirmed payment. Limit and available credit are never household cash.
Unknown pending is not $0. A scheduled minimum is not a confirmed posted
payment. Live card balances, limits, pending, and payments are unchanged.
The later pending-transaction slice lets `scripts/provider-observe.js`
derive a mapped revolving-credit pending observation from Lunch Money
transactions, including the 2026-08-16 Bell Mobility $250 Travel Visa
fixture. That observation is evidence. It does not write `debts[].pending`.
The D7 slice adds posting observations
(`docs/reconciliation/posting-observations.json`) that compare whether a
scheduled occurrence has posted against `plan.opening.representedEvents`.
Forecast remains authority for what should happen; posting evidence is
authority for what has happened. Unknown posting is not posted and is
not unposted. Live `plan.opening` is unchanged. The D11 slice derives
`Forecast.recommend.nearBoundary` from existing `zero.events` (next
payday date through the following calendar day) and has `Forecast.mission`
name those joint-cash obligations before surplus-use guidance. It does
not add a horizon, change the weekly search, or write `data.json`. Those
slices did not finish B91 by themselves. Sequencing and the Aug. 14
payday acceptance corpus live in the build strategy and
[`docs/source_intake/PAYDAY_ACCEPTANCE_2026-08-14.md`](docs/source_intake/PAYDAY_ACCEPTANCE_2026-08-14.md).
The later current-state cutover wrote the 2026-08-16 Forecast opening
from the Lunch Money observation plus same-day card screenshots, kept
Fusion camp/tryouts `settledOn: "2026-08-14"`, and kept the 1 September
Hydro dated due. It does not invent Aug. 14 joint-cash opening balances,
does not resolve Q19, and does not encode $600/week. Observation files
remain evidence; the reconciler remains non-writing. B91 is done.
A later successful refresh writes posted current-state fields into
`data.json` only through `scripts/canonical-refresh.js` after an explicit
preview approval. `scripts/snapshot-balances.js` remains the dated-history
writer after a successful as-of cutover and is not a second current-state
authority. That snapshot write does not change Forecast inputs. Unattended
production writes from Lunch Money are **not** authorised.

**`plan.nextDollar` is derived, not instructed.** Its own provenance note says so:
neither Dale nor Amanda has stated or approved the `protect-then-highest-cost`
ordering — the implementation derived it from the penalty-rate clock and the
current facts. It is the incumbent because it is what the site acts on today, not
because anyone signed it off. Promoting it to an owner instruction is an
owner-reserved decision, not a documentation edit.

---

## The gated capabilities

Each is **wanted** and **not yet permitted**. The gate is the whole rule: until
it is met, the capability is not started, and a plan that schedules it earlier is
wrong rather than persuasive. **Passing a gate is an owner decision, recorded** —
never an agent's judgement that the moment has come.

### A canonical transaction and history store

**Gate.** A store may be introduced when the current batch-derived foundation —
`data.json`, generated `public/periods.json`, and git as the history — can no
longer provide the **invariant, identity or idempotency** guarantees the work
needs, and that failure is **demonstrated on real household data rather than
predicted**.

**Candidate if the gate is met.** SQLite, as the smallest thing giving identity,
foreign keys, uniqueness and idempotent import without an operated service. It is
**not mandatory and not pre-authorised** — it is the current preferred minimal
answer *if* a store is earned at all. Postgres needs its own evidence.

**Not a reason to open it:** that a plan says so, that relational modelling would
be tidier, or that a later capability assumes it. Until the gate is met, **files
remain the right tool** — they give history, diffs and versioning for free, and a
store would only add failure modes.

### Automated financial-data connectivity

Lunch Money as the **normal operational update feed** is owner-approved
product direction (2026-08-17). That direction does **not** authorize bank
credentials in Atlas, money movement, autonomous institution changes, silent
production writes, bypassing reconciliation, or treating unknown or stale
values as current.

Two capabilities must not be conflated:

- **Live read-only observation** — already built and exercised.
  `scripts/provider-observe.js` may GET Lunch Money locally when
  `LUNCHMONEY_ACCESS_TOKEN` is set, or on the owner's Windows home PC when
  the CurrentUser DPAPI blob described under **The secret boundary** is
  present. That seam does not write `data.json` and does not store a bank
  password.
- **Trusted canonical refresh** — owner-passed **2026-08-17** (T4).
  `scripts/canonical-refresh.js` is the earned preview / approve / bounded
  write. Automatic or unrestricted production writes, scheduled refresh, and
  a Render Lunch Money token remain **not** approved. The pass record is
  [`docs/connectivity/T4_OWNER_PASS_2026-08-17.md`](docs/connectivity/T4_OWNER_PASS_2026-08-17.md).

Pointing **unattended production** writes at the live feed remains gated
on owner authorization that this T4 pass did **not** grant. The five
connectivity conditions and the 2026-08-17 owner pass earned the local
preview/approve writer:

1. **proven need** — recorded: the owner will not maintain the same current
   account data twice via Lunch Money and a separate routine statement import;
2. **current Canadian availability** — a provider that actually serves these
   institutions, verified when the work starts, not assumed;
3. **security review** — owner-reserved, and unchanged by anything here;
4. **provider semantics** — how it identifies accounts, transactions, pending
   state and corrections, and what its failure modes cost;
5. **a working canonical ingestion foundation** — idempotent import and
   identity proven **before automatic canonical writes are pointed at the
   live feed**.

Condition 5 is about trusted writes, not about building the foundation, and
not about the existing read-only GET: the foundation may be built first, and
doing so satisfies one condition rather than opening the gate. The existing
live Lunch Money GET is an incumbent. Future trusted canonical refresh is
the remaining capability to earn.

**Current seam.** Owner instruction 2026-08-16 recorded condition 1 and
authorised a fixture-first observe path. The 2026-08-17 feed direction
names Lunch Money as the normal feed. The later 2026-08-17 owner pass
opens T4 for the earned preview/approve writer only. It does not authorize
unattended production writes or a production token.

---

## The secret boundary

The line is between a secret that lets something **log in as the household** and
a secret that lets a server **read data it has been granted**. "No credentials"
is the wrong rule and was never true here — the server refuses to start without
`SITE_PASSWORD` and `SESSION_SECRET`.

### Absolute — no gate, not a tier

- a bank or institution **username or password**;
- a **PIN**, a security answer, or a one-time / 2FA code;
- any credential intended for **direct interactive login** to an institution;
- any **automated action against an account** — a transfer, a bill payment, an
  application, a setting change, a form submission, an agreement acceptance or
  an approval.

Atlas reads and publishes. Nothing below opens this list.

**Fail closed on ambiguity.** If a credential could authenticate Atlas *as the
household* through an institution's ordinary consumer-login path, treat it as
prohibited and **stop** — do not weigh it, do not proceed on the reading that
permits it. An enumeration fails open on the category nobody thought of; this
rule does not, and it is deliberately the catch-all rather than the list above.

### Gated — may be permitted later, not permitted now

Provider or API **service credentials**, and OAuth access or refresh tokens, for
**read-only** data access. The T4 pass permits the local Lunch Money GET-only token:
`LUNCHMONEY_ACCESS_TOKEN` in the owner's shell, or the Windows CurrentUser
DPAPI blob under **Where a secret may live**. Atlas usage remains GET-only
even though Lunch Money personal tokens are not provider-scoped read-only.
A production token in Render is still **not** authorised. Never for
anything on the absolute list.

### Where a secret may live — the canonical rule

**This is the one home for this rule.** Other documents defer to it and must not
restate a narrower or wider version.

**Two kinds of secret, and the rule differs.** A **configured secret** is one
Atlas is given and holds: `SITE_PASSWORD`, `SESSION_SECRET`, and — only if the
connectivity gate is ever passed — a provider, API or OAuth credential. A
**session credential** is one the server *issues* to a browser after a successful
sign-in: today the signed, expiring `hfd_session` token. Everything below about
where a secret may live governs **configured secrets**; the session credential is
covered separately at the end, and the two must not be conflated.

A configured secret lives in exactly one of:

- **production** — the deployment platform's environment secrets, which is Render
  today; the platform's mechanism matters, not the provider's name. A Lunch Money
  token in Render remains **not** authorised;
- **local development** — an environment variable in the developer's own shell.
  That is how `SITE_PASSWORD` and `SESSION_SECRET` are supplied when running
  locally, exactly as `README.md` documents, and it remains the override for
  `LUNCHMONEY_ACCESS_TOKEN` (CI, tests, and advanced local use);
- **the owner's Windows home-PC Lunch Money GET-only store** — a CurrentUser
  DPAPI-encrypted file at `%LOCALAPPDATA%\Atlas-Financial\secrets\lunchmoney.dat`,
  decryptable only in that Windows user context, outside the repository.
  Bootstrap is `node scripts/local-credentials.js setup-lunchmoney`. An existing
  blob is not replaced unless `--replace` is passed. Removal is
  `node scripts/local-credentials.js remove-lunchmoney`. Non-Windows processes
  and remote/cloud agents do not read or emulate this file. This is not a
  Render token, not a GitHub Actions secret, and not a cloud secret store;
- **an encrypted server-side store**, if — and only if — a future approved
  provider needs a secret **persisted and rotated** rather than set once, which
  an environment variable cannot do. This exists so OAuth refresh rotation would
  not require inventing a second rule later. Not authorised today. The
  Windows DPAPI file above is not this store.

And a configured secret goes **never**: into source control, into `data.json`,
into `.env`, into a script, into a command line, into a pull request, into a
log, into GitHub Actions, or into the browser in any form — not in JavaScript,
not in `localStorage` or any cookie, not in a file the page fetches, not
embedded in markup. **No configured secret is ever stored client-side**, and
nothing below relaxes that. The Windows DPAPI blob is ciphertext outside the
repository; it is not a second copy of the plaintext token.

#### The session credential

`server.js` issues `hfd_session` after a correct password: a token signed with
`SESSION_SECRET` and carrying its own expiry. It is **permitted in the browser**,
and in exactly one form — an **`HttpOnly` cookie that page JavaScript cannot
read**, `SameSite=Lax`, and `Secure` whenever the request is HTTPS. Not in
`localStorage`, not in a readable cookie, not in a URL, not in markup.

That is the deployed gate, and this paragraph aligns the rule with it rather than
authorising anything new. **It grants nothing else**: no provider, API or OAuth
credential may be stored client-side under it, and it does not touch the absolute
prohibitions above on institution login credentials or automated account actions.

Two earlier drafts of the prohibition were wrong in the same direction, and review
caught both. The first read "client-side in any form the browser can read" and
outlawed Atlas's own sign-in page — the household typing the shared password is
the secret being *used*, over HTTPS, and the server never sends it back. The
second banned "browser storage" outright and outlawed the session cookie that same
page sets. The defect each time was writing a prohibition before saying which kind
of secret it governs, which is why the distinction now comes first.
