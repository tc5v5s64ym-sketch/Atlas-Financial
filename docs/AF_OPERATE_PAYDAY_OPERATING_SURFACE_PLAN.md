# AF-OPERATE — Payday Operating Surface

**Status:** TEMPORARY EXECUTION PLAN — owner-approved 2026-08-24

**Delete this file when the campaign is complete.** Its job is to preserve the
campaign finish line, slice boundaries and acceptance criteria while the work is
in flight. It is not a permanent authority document.

`ARCHITECTURE.md` still owns product direction and authority boundaries.
`docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md` still owns sequencing.
`BACKLOG.md` still owns work/findings. `Forecast` remains the sole financial
planning/calculation authority. If this file ever disagrees with those
authorities, this file is wrong.

This plan exists because the owner explicitly instructed Atlas to finish the
household operating surface now and to avoid drifting into unrelated cleanup.

---

## Finish line

On payday, the owner opens Atlas and within **60 seconds** can determine:

1. what money is available;
2. what must be paid or reserved before the next payday;
3. what money is protecting known future costs;
4. what surplus, if any, is directed toward debt;
5. what can still be spent until the next payday; and
6. what freshness, coverage or uncertainty could change that answer.

The finished experience is decision-first. Deep Dive, Records and Modellers may
remain available as diagnostic/analysis surfaces, but they are not the default
household operating workflow.

No slice may create a second payday planner, second budget engine, second debt
priority engine, second historical-spending authority, or page-side financial
arithmetic. The engine decides; pages render.

---

## Campaign rules

### No side quests

During AF-OPERATE, unrelated work waits unless the existing build-strategy
interruption rule is met. A finding may jump the queue only when it is:

- a wrong published financial answer;
- a security/privacy/data-safety breach;
- falsified gate evidence; or
- a demonstrated material source gap likely to change the household plan.

Ugly CSS, old merchant cleanup, historical completeness, refactors, comments,
helper cleanup and other useful-but-noncritical work go to the backlog and wait.

### One outcome per PR

Each slice below is one independently provable outcome. Do not combine adjacent
slices simply because they touch the same page or function.

### Preserve the incumbent authorities

- Lunch Money = operational evidence/update feed.
- `public/periods.json` = historical spending authority.
- `Forecast` = sole planning/calculation authority.
- `Forecast.paydayAllocation` = payday allocation authority.
- `Forecast.currentPeriodAction` = between-paydays action authority.
- Existing master-Forecast future-cost/debt functions remain the source of
  future pressure and debt consequences.

### Actionable, not executable

Atlas may tell the household what action the plan calls for. AF-OPERATE does
**not** authorize payments, transfers, card actions, financial-institution
writes, unattended canonical writes, or other money movement.

---

## Current campaign baseline

AF-OPERATE begins only from current `main` after PR #168.

PR #168 (`Expose a secure read-only Atlas assistant packet`) is merged. The
campaign must re-fetch current `main` before every slice; never reuse the SHA in
this plan as a substitute for current-state verification.

The campaign also starts with one demonstrated financial-correctness problem:
committed historical actuals predate the cleaned Lunch Money classifications.
The historical baseline must be corrected through the incumbent actuals path
before the new operating surface is trusted as the household default.

---

## Ordered slices

GitHub assigns the PR numbers. Use the AF-OPERATE IDs below as the stable names;
do not make correctness depend on anticipated PR numbers.

### AF-OPERATE-00 — Lock the campaign

**Outcome:** this temporary plan is committed to the repository so a fresh
builder can recover the owner-approved campaign intent without chat history.

**Changes:** this file only unless current governance mechanically requires a
minimal pointer elsewhere.

**Proof:** a fresh agent can state the finish line, non-goals, ordered slices,
interruption rule and deletion condition by reading this file plus the normal
repository authorities.

**Non-goals:** no financial code, no website change, no new authority.

---

### AF-OPERATE-01 — Correct the historical actuals authority

**Outcome:** Atlas historical spending reflects the cleaned, trustworthy Lunch
Money history through the incumbent Atlas actuals pipeline.

**Why first:** Forecast budgeting currently consumes `public/periods.json`; a
new homepage must not make stale historical category values look more
trustworthy merely by presenting them better.

**Requirements:**

- use the best trustworthy continuous Lunch Money history;
- map cleaned Lunch Money categories into incumbent Atlas canonical categories;
- preserve transfers, income, debt payments and travel-exclusion semantics
  without double counting;
- handle PayPal overlap conservatively;
- regenerate `public/periods.json` through the incumbent generator rather than
  hand editing;
- preserve uncertainty where category coverage remains incomplete;
- do not invent a new historical-spending store or classifier.

**Proof / finish condition:** provider/history totals independently reconcile;
no transaction is double-counted; Forecast consumes the refreshed actuals; no
raw transaction/provider identifiers or secrets enter git; any household-facing
figures moved receive the review/proof required by current governance.

**Non-goals:** no new budget targets, debt policy or homepage redesign.

---

### AF-OPERATE-02 — Put the decision-first operating surface first

**Outcome:** the homepage leads with the household operating questions instead
of the full diagnostic report.

**Changes:** introduce the operating surface using existing Forecast outputs.
Keep useful existing analytical material available as secondary/collapsed or
separate diagnostic content until the final campaign cleanup; do not create a
half-built homepage by deleting working diagnostics too early.

**The default surface must answer, in order:**

1. What do I do now?
2. What can we spend until next payday?
3. What is today's money protecting?
4. What debt is receiving surplus?
5. What could make this answer wrong?

**Proof / finish condition:** no page-side financial arithmetic; every financial
number reconciles to an incumbent Forecast/actuals authority; old diagnostics do
not provide a competing headline answer.

---

### AF-OPERATE-03 — Make payday allocation actionable

**Outcome:** `Forecast.paydayAllocation` is rendered as an ordered payday action
sheet.

The presentation should make clear:

- money available;
- required payments/reserves;
- essential spending hold;
- known future-cost set-asides;
- extra debt allocation when permitted;
- unallocated/optional remainder; and
- cash that must remain untouched.

**Proof / finish condition:** displayed allocations plus displayed remainder
reconcile exactly to the available resources used by Forecast. No page-side
allocation logic. Estimated/unknown inputs retain their trust labels.

**Non-goal:** Atlas does not execute any payment or transfer.

---

### AF-OPERATE-04 — Make the between-paydays view usable

**Outcome:** `Forecast.currentPeriodAction` becomes the daily household operating
view after payday.

It should show, using incumbent authority:

- bills handled / represented;
- bills unverified or still due;
- category spending used and remaining where the category claim is trustworthy;
- weekly spending permission;
- next decision/payday date; and
- visible freshness/coverage limitations.

**Proof / finish condition:** stale or incomplete transaction/category coverage
cannot masquerade as an exact remaining amount. No second budget engine.

---

### AF-OPERATE-05 — Show future financial gravity

**Outcome:** the operating surface makes visible what today's money is protecting
using the existing master-Forecast future-cost authorities.

Compactly show meaningful items such as:

- funded / on-track;
- amount still required;
- date pressure;
- at-risk/unfunded state; and
- payday set-aside where incumbent Forecast exposes it.

**Proof / finish condition:** a protected commitment outside the short display
window remains visible and affects today's plan only through the existing master
Forecast. No new goals/funding engine.

---

### AF-OPERATE-06 — Make the debt attack explicit

**Outcome:** the homepage exposes the incumbent next-dollar / extra-debt answer
without inventing household policy.

Show separately:

- required debt payments;
- extra principal/debt allocation;
- current target when Atlas has authority to name one;
- amount this payday; and
- what happens when capacity is released, when incumbent Forecast already knows.

**Owner stop:** if the repository lacks the household policy needed to choose
between cards, HELOC, liquidity and known future costs, stop on that exact
question. Do not silently choose by APR or invent austerity policy.

**Proof / finish condition:** every displayed debt action traces to incumbent
Forecast plus explicit household policy/evidence.

---

### AF-OPERATE-07 — Payday acceptance and campaign cleanup

**Outcome:** prove the complete household payday experience against current,
live-qualified Atlas state and retire only genuinely superseded homepage clutter.

**Acceptance test:** on a phone, starting from the homepage, the owner can answer
within 60 seconds:

- how much money is actually available;
- what to pay/hold/set aside now;
- what can be spent until next payday;
- which future costs are being protected;
- what debt receives surplus; and
- what uncertainty could change the answer.

The numbers must independently reconcile to Forecast and the current actuals
trust contract. Diagnostic/deep-dive surfaces remain available where they still
serve a real purpose; they stop competing with the operating answer.

**Campaign closeout:**

1. confirm every AF-OPERATE slice is complete or explicitly retired;
2. close/retire the corresponding backlog work;
3. remove any temporary campaign-only routing/pointers added solely to run the
   campaign; and
4. **delete this file in the final cleanup PR.**

No permanent roadmap tombstone is required. Git history and merged PRs are the
record that AF-OPERATE happened.

---

## Target finished homepage

The exact wording/layout may evolve, but the information hierarchy should feel
roughly like this:

### As of DATE — current / partially current / attention needed

### What to do now

Available: **$X**

Pay / hold / set aside:

- required payment — $X
- essential spending hold — $X
- future commitment — $X
- extra debt — $X

Leave **$X** in cash.

### What you can spend

**$X/week**, with only useful category guardrails underneath it.

### What this paycheque is protecting

- Future item A — on track
- Future item B — needs $X by DATE

### Debt attack

- Target — [incumbent Forecast answer]
- Extra this payday — $X
- Projected consequence — $X / date / next target where already authoritative

### What could change this answer

Only material freshness, coverage, estimated-input and owner-policy limitations.

A collapsed/secondary **Why / Road ahead** area may show 30/90/365-day
consequences without turning the default homepage back into a diagnostic dump.

---

## Definition of done

AF-OPERATE is done when the homepage is a trustworthy household operating
surface, not merely a prettier dashboard, and the owner can use it on payday
without needing ChatGPT, Codex, Deep Dive or manual arithmetic to determine what
the plan says to do.

At that point this temporary plan is deleted.
