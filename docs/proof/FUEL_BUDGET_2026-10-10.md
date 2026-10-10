# Fuel budget figures comparison — 2026-10-10

Base: `5faac95f70415e90c442c2d0339d466c94cd108f` (fresh main). The draft PR records the resulting exact head.

This is a calculated comparison of each revision's own Forecast and canonical inputs evaluated for October 10, 2026, without a live provider packet. Resulting surplus and future cash remain **estimated**. This does not establish today's bank cash or replace the dated August 19 canonical opening. All amounts are CAD.

Fuel changes from **$325 to $555 per pay period**, a $230 increase, from October 9–22 onward. Dog food remains OFF in October 9–22 and ON in October 23–November 5; Other remains $450 each period.

| Seaspan period | Fuel before → after | Household hold before → after | Estimated Balance After Deductions before → after |
|---|---:|---:|---:|
| 2026-10-09–2026-10-22 | 325.00 → 555.00 | 2,175.00 → 2,405.00 | 669.18 → 439.18 |
| 2026-10-23–2026-11-05 | 325.00 → 555.00 | 2,275.00 → 2,505.00 | 1,759.29 → 1,529.29 |
| 2026-11-06–2026-11-19 | 325.00 → 555.00 | 2,175.00 → 2,405.00 | 1,673.39 → 1,443.39 |

September 25–October 8 still uses $325. When evaluated on October 8, its household hold remains $2,275 and its estimated surplus remains $959.20. When evaluated as a completed period on October 10, it remains unchanged; no retained original household plan or unobserved actual is invented.

Actual spending fulfills the existing hold once: `max(planned, actual)`. The $230 reduction in the table assumes fuel actuals do not exceed the planned amount. With overspend, the hold difference depends on actuals; the transaction evidence itself is unchanged.

## All changed October 10 scenario snapshot figures

Each revision runs its own `scripts/figures-snapshot.js` exported `buildFiguresSnapshot`, with only the in-memory `meta.asOf` evaluation date set to `2026-10-10`; canonical files stay unchanged.

| Published figure | Base | Candidate | Change |
|---|---:|---:|---:|
| payday.riskShortfall | 3,555.13 | 3,785.13 | 230.00 |
| operating.this.projectedEnding | 669.18 | 439.18 | -230.00 |
| operating.this.householdBudgetTotal | 2,175.00 | 2,405.00 | 230.00 |
| operating.next.householdBudgetTotal | 2,275.00 | 2,505.00 | 230.00 |
| budget.essentialPerMonth | 4,248.22 | 4,748.27 | 500.05 |
| budget.requiredPerMonth | 5,038.29 | 5,538.34 | 500.05 |
| budget.requiredPerWeek | 1,158.70 | 1,273.70 | 115.00 |
| budget.foodAndFuelPerMonth | 2,663.28 | 3,163.33 | 500.05 |
| budget.foodAndFuelPerWeek | 612.50 | 727.50 | 115.00 |
| planning.trajectory.weeklyVariable | 1,110.50 | 1,225.50 | 115.00 |
| planning.trajectory.2026-10.cash.amount | 901.25 | 539.82 | -361.43 |
| planning.trajectory.2026-11.cash.amount | 527.04 | -327.24 | -854.28 |
| planning.trajectory.2026-12.cash.amount | -3,598.79 | -4,962.36 | -1,363.57 |
| planning.trajectory.2027-01.cash.amount | -2,820.11 | -4,692.96 | -1,872.85 |
| planning.trajectory.2027-02.cash.amount | 10,782.52 | 8,449.67 | -2,332.85 |
| planning.trajectory.2027-03.cash.amount | 12,504.24 | 9,662.09 | -2,842.15 |
| planning.trajectory.2027-04.cash.amount | 14,966.59 | 11,631.59 | -3,335.00 |
| planning.trajectory.2027-05.cash.amount | 17,600.46 | 13,756.18 | -3,844.28 |
| planning.trajectory.2027-06.cash.amount | 20,381.00 | 16,043.85 | -4,337.15 |
| planning.trajectory.2027-07.cash.amount | 19,925.06 | 15,078.63 | -4,846.43 |
| planning.trajectory.2027-08.cash.amount | 22,642.80 | 17,287.08 | -5,355.72 |
| planning.trajectory.2027-09.cash.amount | 25,423.33 | 19,574.76 | -5,848.57 |
| planning.trajectory.2027-10.cash.amount | 25,654.31 | 19,657.88 | -5,996.43 |

The projected November month-end cash changes from positive $527.04 to negative $327.24. This consequence is disclosed; no budget, income, debt or savings input is adjusted to conceal it. The future trajectory retains its incumbent daily monthly-equivalent cash-walk behavior.

The unmodified default snapshot, which evaluates the historical `meta.asOf` of August 19, has **zero changed figure keys**. The automatic figures comment therefore cannot substitute for the October 10 comparison above.

## Derived reporting rows

`node scripts/positions-summary.js` regenerates only the two changed computed rows in `docs/positions.csv`. Essential monthly estimate: $5,038.29 → $5,538.34 (+$500.05); its reporting weekly equivalent: $1,162.68 → $1,278.08; weeks of essentials covered: 3.7 → 3.4. The report retains financial-account opening August 19 and actual-history coverage August 24, and advances only the owner-budget-target provenance to October 10. Other captured rows are identical. The report's incumbent 12/52 weekly conversion differs from Forecast's calendar-week equivalent; no conversion policy changes here.

## Independent proof and scope

The synthetic fixture uses invented fuel targets $85 → $215 and salary/category inputs, independently asserting `salary - bills - sum(max(plan, actual))`. Boundary dates include October 8, 9, 10, 22, 23 and November 6. Whole payday enumeration proves $85 + $215 across September 25–October 22 and $215 + $215 for October. The regression fails against the base Forecast on the October 8 boundary. Canonical assertions separately verify the owner-approved $555 input.

The canonical JSON is identical outside the Fuel category and the fuel-related ownerTargets summary. `public/periods.json`, all snapshots, openings, bills, other category budgets and actual membership are untouched. Existing historical authority tests use a date-bounded retired-Fuel fixture; the new active/future suite consumes the real canonical input.

Open PR #573 (`agent/owner-streaming-bills`, inspected head `2abcee190695e3a856df93cbb1c1d7dcf2463b6e`) also touches `data.json` and `test/test.js`; its bill rows are outside this fuel category. Merged PR #566 is inherited from this refreshed base; its Provincials February 12, 2027 funding-ready planning input and all other commitments are byte-for-byte identical to current main. PR #569 changes a separate Forecast savings-alias surface. Other open PRs may append suites to the registry. Keep all of those patches when integrating, and rerun checks/Systems Review on any new head; this PR is not stacked on them and does not edit their worktrees.
