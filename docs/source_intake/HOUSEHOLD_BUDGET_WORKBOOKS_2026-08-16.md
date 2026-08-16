# Household budget workbooks — evidence classification

**Record status:** Attributed source evidence. Not a second budget authority.  
**As of:** 2026-08-16  
**Owner of this record:** classification of the two named household workbooks  
**Does not own:** current `plannedMonthly` values, Forecast arithmetic, or whether
a historical workbook line should become future policy.

This is a one-time absorption of evidence that Q0 said was missing. The binaries
stay out of git. Current owner-stated budget policy remains in
`data.json` `plan.budget`.

```evidence-ids
WB-001
WB-002
WB-003
```

## Source location

Both files were emailed by Amanda to Dale on **2026-08-09**, the day before
the Aug. 10 owner-stated targets:

| File | Role | In git? |
|---|---|---|
| `HOME BUDGET.xlsx` | Older household semi-monthly / per-paycheque plan | **No** — belongs under `raw/` |
| `monthly_budget_tracker_template.xlsx` | Tracker template with a `My Recommendation` section | **No** — belongs under `raw/` |

Cell-level workbook dumps are not committed. Amounts below are the
owner-inspected observations used for this classification, labelled
approximate where the source is a per-paycheque line converted ×2. Binary
verification of every other cell remains external to the repository.

Payroll converted from semi-monthly to biweekly on 18 July 2025
(`docs/source_intake/EMPLOYMENT_PENSION_FACTS_2026-08-13.md`). A per-paycheque
workbook is therefore at best historical planning, not proof of current
biweekly policy.

## Authority that wins

Commit `bb24b520334bf90b484aedd32024de00d4838b16` (2026-08-10) recorded nine
owner-stated monthly targets and said they were **not workbook-verified**. That
later owner statement is current policy. An older planning workbook does not
replace it unless a later owner authority says so. None was found.

`My Recommendation` in the tracker template is advisory material derived from
April/May actuals. A recommendation is not owner-approved household policy.

## Classification

| Workbook line | Observed figure | Atlas home today | Class |
|---|---|---|---|
| Groceries | ~$600 / paycheque ≈ $1,200 / month | `groceries` `plannedMonthly` **$1,800** owner-stated-2026-08-10 | CONFLICT WITH LATER OWNER POLICY |
| Gas / Transportation | ~$200 / paycheque ≈ $400 / month | `fuel` `plannedMonthly` **$1,300** owner-stated-2026-08-10 | CONFLICT WITH LATER OWNER POLICY |
| Weekend spending | ~$400 / paycheque ≈ $800 / month | no unique home; amount equals `restaurants` $800 | HISTORICAL OWNER PLAN — mapping unconfirmed |
| Personal | ~$300 / paycheque ≈ $600 / month | `shopping` `plannedMonthly` **$600**, owner line `Personal` | CURRENT POLICY MATCH on amount; Personal → Shopping mapping still open |
| Subscriptions | ~$150 / paycheque ≈ $300 / month | `subscriptions` `plannedMonthly` **$300** | CURRENT POLICY MATCH on amount |
| Dog food / Sports / Household / Medical | not in the inspected HOME BUDGET lines above | owner-stated 2026-08-10 targets $110 / $250 / $150 / $100 | NOT MATERIAL in the observed HOME BUDGET lines; current policy unchanged |
| Debt / bill planning in HOME BUDGET | present; amounts not independently extracted | Plan bills, commitments, and debts already have homes | ALREADY REPRESENTED ELSEWHERE |
| Sinking-fund / annual / irregular planning in HOME BUDGET | present as planning; cell amounts not independently extracted | named in `ownerTargets.sinkingFundsNamed`; unquantified | HISTORICAL OWNER PLAN / POTENTIALLY NEW FACT — needs owner confirmation of *current* amounts |
| Bank-fee planning in HOME BUDGET | may be present; not independently extracted | `tdfees` lives in the fees lens, not the spending cap | ALREADY REPRESENTED ELSEWHERE unless the owner later approves a different current amount |
| `My Recommendation` (tracker template) | derived from April/May actuals | none — advisory only | ADVISORY / RECOMMENDATION |

## What this does not change

None of the nine Aug. 10 `plannedMonthly` values. The weekly cap. Forecast
arithmetic. Debt allocation. No new recurring cash obligation from a historical
workbook row.

## What Atlas still lacks after classification

These are policy questions, not missing files:

1. Current approved amounts for the named sinking funds that still have none
   (home insurance, Christmas, travel, annual bills, emergency top-up).
   Historical workbook planning is not that approval.
2. Whether owner `Personal` is the transaction record's Shopping category.
   The workbooks do not settle the mapping.
3. Whether the nine targets are a complete current budget or a subset.
   Finding the workbooks does not make the historical workbook the missing
   remainder.

Travel remaining a historical actual, and School & clubs remaining Q24, are
unchanged.

## Proof this record is not a second budget

Current policy is still the nine `plannedMonthly` literals with
`targetSource` `owner-stated-2026-08-10`. This file classifies evidence.
It does not feed Forecast.
