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

Material only ever flows **down**. Nothing edits `raw/`. Nothing hand-writes
`derived/`. A figure that reaches `data.json` can always be traced back up to a
statement.

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
  the classification and any owner override, not the amounts.
- **Every dated item declares where it would otherwise sit.** A bill or
  commitment names its `budgetCategory`, and that amount is subtracted from the
  category's average. Without it, Shaw is paid twice — once on the calendar and
  once inside a telecom average that already contains it.
- **Every obligation names the debt it moves.** `debtId` plus `effect`
  (`payment` or `capitalise`). Cash leaving the chequing account has to arrive
  somewhere, and the suite reconciles the two sides to the cent.

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

A statement arrives → it becomes a live figure:

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

The pre-commit hook refuses steps 1 and 3 from reaching git, whatever else
goes wrong.

---

## Where things go

**One fact, one home.** The most common failure mode in a project like this is
the same number living in three files and drifting.

| Kind of thing | Home | Not |
|---|---|---|
| Rates, limits, due dates, renewal dates | `docs/ACCOUNT_FACTS.md` | anywhere else |
| Balances, available credit | `docs/positions.csv` and `data.json` | `ACCOUNT_FACTS.md` |
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
3. Entry in `data.json` under `debts`, plus `utilisation` if revolving
4. Update `headline`, `netWorth` and `coverage` in `data.json` to match
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

### One plan, many windows — owner-approved 2026-08-12

Atlas maintains **one grand household financial plan**, and every horizon is a
window onto it. A one-, two- or three-week view and a two-, three-, nine- or
twelve-month view are not separate forecasts; they are different spans of the
same dated projection, from the same starting facts. Changing an input
recalculates every affected horizon from that one plan, so a short-horizon
answer cannot quietly contradict a long-horizon one.

**The deterministic engine stays where financial decisions are made.** That is
the rule at the top of this file applied to the destination, not replaced by it.

**Two interfaces, one answer.**

| Surface | What it is for |
|---|---|
| The website | visual presentation and inspection of the plan |
| ChatGPT | conversational query, explanation and scenario interface |

Neither may create a second financial answer, and neither is an authority.
Both consume the same ones. A surface that works a figure out for itself is the
defect `B73` exists to close, arriving through a new door.

**What the plan is expected to cover, as each capability is earned:** material
income and compensation, debts, bills, spending and budget, known dated
commitments, sinking funds, planned purchases and travel, and assets, pension
and investments — together with the scenario inputs that vary them. Naming them
here authorises none of them; each still passes its own gate below.

**Safe-to-spend is constrained by the future, not by today's balance.** It has to
hold back what known commitments, required debt payments and the buffer policy
will need across the horizon being asked about.

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
That file records evidence and states no direction of its own.

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
done. What has no history is **account balances**: the site shows those at a
single point in time, so the questions that matter over the next year cannot be
answered — is the HELOC actually falling, is Triangle moving, did the changes
stick.

The distinction matters because the loose version of this sentence said the whole
site was a single point in time, which would send later work to rebuild a trend
capability that already ships.

The intended mechanism is `snapshots/<YYYY-MM-DD>.json` — one file per reading,
same shape as `data.json`, with the site drawing trend lines across them. This
needs no database: files in git give history, diffs and versioning for free.

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

### Atlas is not greenfield

The financial authorities below are **incumbent**. Later work evolves, derives
from, replaces or deletes one of them — and says which. It does not stand up a
second engine, a second weekly figure, a second budget or a second calendar
beside them. This repository has already shipped that failure, publishing
`$1,650/wk` in one tile and `$0/wk` below, because two pieces of code answered
the same question — and it still carries one, noted under the table.

| Concept | Incumbent authority |
|---|---|
| The schedule — what is due, when, how often | `Forecast.expandEvents`, via `simulate`, from the `plan` inputs |
| Cash projection over the window | `Forecast.simulate` |
| Weekly household cap | `Forecast.recommend` — **and only it** |
| Income dependency deadline — when a modelled income becomes required to preserve the buffer | `Forecast.incomeDeadline` |
| Next due — which published calendar obligation the household owes soonest | `Forecast.nextDue`, from `data.json` `upcoming` |
| Coupled cash-and-debt walk | `Forecast.projectDebts` |
| Revolving headroom, limits, pending | `Forecast.utilisation` |
| Budget — owner targets against actuals | `Forecast.budgetBreakdown`, with classification and targets in `data.json` `plan.budget` |
| Weeks in a month, and every figure converted between the two | `WEEKS_PER_MONTH` in `public/forecast.js` — the calendar's own `365.25 / 12 / 7`, deliberately **not** exported. `Forecast.monthlyFromWeekly` says a weekly cap in months; `Forecast.budgetBreakdown`'s `cap` block owns every other conversion |
| Whether the weekly cap leaves any discretionary room, and the shortfall when it does not | `Forecast.budgetBreakdown`'s `cap` block, measured against the weekly figure the page is **showing**; `public/plan.js` holds the wording only |
| The mission — which instructions the homepage gives, and in what order | `Forecast.mission`, from the `recommend` and `projectDebts` results; `public/plan.js` holds the wording only |
| The status band — which of seven verdicts the Plan page publishes about the window, and the dates inside it | `Forecast.planStatus`, from the `recommend` result and the simulation on screen; `public/plan.js` holds the wording, the tone class and the HTML only |
| Whether a funding source covers the opening gap, contributes to it, or cannot reach it | `Forecast.recommend`'s funding result — `funding.sources`, the same allocation seen per source; `public/plan.js` holds the wording only |
| Alternative opening-gap assumptions — which counterfactual applies, what assumption stands for it, and whether its answer means anything | `Forecast.counterfactuals`, from the `recommend` and `projectDebts` results. Each alternative copies `recommend`'s `planOptions` and replaces exactly one key, so the scenario, buffer, overrides, disabled commitments and debt state cannot drift from the plan on screen. Full coverage is exactly the shortfall, finite and non-borrowed; a facility funds the gap only through its own declared headroom. `public/plan.js` holds the wording only |
| The May 2027 renewal — what it costs, what folding the HELOC in changes | `Forecast.renewal`, from the debt records and `plan.obligations`; `public/modellers.js` holds the wording only |
| Mortgage rate conventions — what a quoted rate means | `RATE_BASIS` in `public/forecast.js`: fixed compounds semi-annually, variable monthly. `Forecast.renewal` requires the basis and has no default |
| The next move the household is told to make | `plan.actions` in `data.json`, rendered from `plan.actions[0]` by `public/plan.js` |
| What the next move achieves — which of five outcomes the "What happens after" line publishes, and the figures inside it | `Forecast.nextMove`, from the `recommend` result, the simulation on screen and `plan.actions[0]`. The action's amount is a fixed figure sized for the default buffer, so coverage is judged against the **current** gap on the engine's own half-cent — and restoring that gap takes coverage **and** a due date on or before it, since money arriving after the day it is needed clears nothing on that day. `public/plan.js` holds the wording only |
| Where the next surplus dollar goes | `plan.nextDollar` in `data.json`; its `target` feeds `Forecast.projectDebts` |
| Payoff modelling — which debts may be modelled, what a payment does to one, and what clears it | `Forecast.payoffDebts`, `Forecast.payoffModel` and `Forecast.paymentForMonths`, from the debt records and `plan.obligations`; `public/modellers.js` holds the wording only |
| Debt rate conventions — what a debt's quoted rate means per period, and how closely a monthly model reproduces it | `PAYOFF_RATE_BASIS` and `PAYOFF_BASIS_PRECISION` in `public/forecast.js`, from each debt record's `rateConvention`. A prime-linked facility is compounded monthly, so a monthly period is **exact**. A card charges a daily rate over the days in each statement cycle, so a monthly period is a **monthly-equivalent** average: exact over a year, and published with the cycle band for any single period. An undeclared convention throws |
| What one debt costs the household in cash each month | `monthlyCashFor` in `public/forecast.js`, from `plan.obligations`; read by both `Forecast.renewal` and the payoff modeller |
| Historical spending series | generated `public/periods.json`, from `scripts/periods.js` |
| Published figures | `data.json` |
| Calendar — the on-page month grid and agenda | `renderCalendar()` in `public/plan.js` — **presentation of `sim.events` only** |
| Calendar — the exported `.ics` | `scripts/calendar-ics.js`, from `docs/ACCOUNT_FACTS.md` and observed recurrence |
| Authority and reconciliation guards | the `npm test` suites |

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

**Page scripts do break that third rule today, and the repository now knows
where.** Every instance `B73` had recorded moved into the engine, and the scan
for the ones nobody had named ran on 2026-08-12. It read every browser file and
found eight more — the largest being the status band at the top of the Plan page,
which selects which of seven verdicts the household reads and picks two of the
dates inside them. Seven of the eight were found by reading; the eighth, the
funding-source cards a few lines below that same band, was found by the required
review after the scan had called itself complete. `B73` records each one with the mutation evidence that no test
reaches it, and each is its own outcome to move. **Those first two have now
moved**, together, because they interpreted the same `gap` and the same funding
result; six remain. **None of them is a row in the
table above, and none should become one**: a page script that decides is an
unnamed authority, which is a defect to close, not an incumbent to register. The
two rows the move added name `Forecast.planStatus` and the funding result, which
are engine authorities — not the page-side defect they replaced.

Seven instances have been moved into the engine rather than argued away. The
Amanda-transfer deadline: `public/plan.js` re-ran the simulation with her
transfer zeroed and selected the first below-buffer day itself, and
`Forecast.incomeDeadline` now owns that counterfactual. The "Next due" tile:
`public/deepdive.js` filtered `upcoming` for unpaid cash items, sorted them and
took the first, and `Forecast.nextDue` now owns that selection. The homepage
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
cannot disagree, which they had. In each
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
itself and caught by the review. It holds five now. The absence of a known
instance was never evidence that
none existed, and searching is what settled it.

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
afford. `forecast.js` calls `recommend` *the* single authority in its own words.
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
second home for the balance the arithmetic runs on. What is left in the page is
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

**There are already two calendars, and neither of them is `renderCalendar()`.**
The schedule — dates, amounts, recurrence — is `Forecast.expandEvents`'s, and
`renderCalendar()` only formats the `sim.events` it is handed; later calendar work
belongs in the engine, where it can be tested, not in the renderer. The two
*schedules* are that one and the exported `.ics`, which derives independently from
standing facts and observed recurrence and which `B29` records as imported into
Google Calendar. They can drift, and nothing today would notice. That is a
pre-existing overlap this file *records* rather than creates — recorded as `B74`.
Until it is resolved, neither is a licence to add a third.

**A third list of dated obligations already existed, and saying "two" was
generous.** `data.json` `upcoming` is the hand-kept payment calendar the Deep
Dive page has always published, maintained beside the `plan` block the projection
runs on. `Forecast.nextDue` *selects* from that list; it does not build a
schedule, and no new list was created to give it something to read. But an
authority that reads a hand-kept list inherits that list's staleness, so the
reconciliation is now B74's to settle across all three, and B74 records what each
currently answers.

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

Reading account data automatically, rather than from files the owner exports, is
an **owner-approved desired capability**. It is gated on all five of:

1. **proven need** — the manual capture path is demonstrably the binding limit;
2. **current Canadian availability** — a provider that actually serves these
   institutions, verified when the work starts, not assumed;
3. **security review** — owner-reserved, and unchanged by anything here;
4. **provider semantics** — how it identifies accounts, transactions, pending
   state and corrections, and what its failure modes cost;
5. **a working canonical ingestion foundation** — idempotent import and identity
   proven **before anything live is pointed at it**.

Condition 5 is about pointing something live, not about building the foundation:
the foundation may be built first, without a provider, and doing so satisfies one
condition rather than opening the gate.

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
**read-only** data access. Permitted only after the connectivity gate is met
**and** the owner approves — and never for anything on the absolute list.

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
  today; the platform's mechanism matters, not the provider's name;
- **local development** — an environment variable in the developer's own shell,
  which is how `SITE_PASSWORD` and `SESSION_SECRET` are supplied when running
  locally, exactly as `README.md` documents;
- **an encrypted server-side store**, if — and only if — a future approved
  provider needs a secret **persisted and rotated** rather than set once, which
  an environment variable cannot do. This exists so OAuth refresh rotation would
  not require inventing a second rule later. Not authorised today.

And a configured secret goes **never**: into source control, into `data.json`,
into a pull request, into a log, or into the browser in any form — not in
JavaScript, not in `localStorage` or any cookie, not in a file the page fetches,
not embedded in markup. **No configured secret is ever stored client-side**, and
nothing below relaxes that.

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
