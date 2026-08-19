# Skill: forecast-runtime

**Load when** changing `public/forecast.js`, `data.json` plan policy
(`actions`, `nextDollar`, `budget`, obligations, bills, commitments,
opening), or a page script that currently renders a household-facing
figure (`public/plan.js`, `modellers.js`, `deepdive.js`, `records.js`,
`app.js`).

**Do not load for** copy edits that cannot move a figure, or for
evidence intake that does not touch the engine.

**This is procedure, not authority.** `ARCHITECTURE.md` owns the
incumbent table. `Forecast` is the calculation authority. This file
does not compute, and must not become, a second planner. It is not
household truth and not owner policy.

Also scan [`../lessons/TECHNICAL.md`](../lessons/TECHNICAL.md),
especially L-001, L-002, and L-006.

---

## Hard boundaries for this class of work

- **Engine decides; pages render.** If a page needs a number that does
  not exist yet, add it to `public/forecast.js` where `npm test` can
  reach it. Do not solve a financial question inside a page script.
- **One master plan.** Named ranges are views of Forecast. Do not stand
  up a payday engine, a goals engine, a Sheet planner, or a ChatGPT
  calculator beside it.
- **Never invent household facts or owner policy.** Missing facts go to
  `docs/01_OPEN_QUESTIONS.md`. Promotion from estimated to verified is
  owner-reserved.
- **Never silently create** another planner, store, schema, or
  authority. The store gate and unattended production writes stay
  closed until `ARCHITECTURE.md` says otherwise.

## Procedure

1. Name the incumbent in `ARCHITECTURE.md`'s table (or which of the
   three rules the concept belongs to: `plan` tells, Forecast follows,
   pages render). An unnamed page-side decision is a defect, not a new
   row.
2. Prefer **replace / derive / delete** over a permanent reconciliation
   between two owners.
3. Prove the change independently of the function under change. Fixture
   arithmetic, an institution number, or a conserved total. Do not copy
   live `data.json` cents into a behaviour test as the specification
   (L-006 / `B92`).
4. Run `npm test`. After engine or plan-block changes, the Forecast and
   authority-coverage suites are not optional extras; they are the
   path.
5. This class almost always fires a `CLAUDE.md` high-risk trigger.
   Request Atlas Contract / Systems Review only on a stable merge
   candidate. The builder cannot satisfy that review.

## What this skill does not authorize

A weekly cap, a payday number, a budget split, a debt walk, a trust
label, a production write, or a schema. Those stay with Forecast,
`data.json`, the owner, or the closed gates.
