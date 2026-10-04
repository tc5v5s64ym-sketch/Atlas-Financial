# One household Actual / Planned total

Owner UI instructions relayed by ChatGPT on October 4, 2026:

- `Sentinel_cfd5067664a88191ba073e37046bbd29`: show one **Household Budget Total: Actual / Planned** instead of competing totals.
- `Sentinel_6a5a7f96e47c81919c55e7d920d2981b`: show **Remaining** on Other spend like the other budget rows.
- `Sentinel_3ede284a1b408191b0244f879d1fb980`: “Ok let’s clear that section up.”

These are display instructions. They authorize no new household fact, target,
baseline, savings assignment or financial calculation.

Current-state gate: **STILL BROKEN** on fresh main
`42988ff5217d08c57b75cd7c09164f1ca87d16e9` (merged #497).
The opened native household sheet labels `period.budgetHold` as Household Budget
Total, then separately appends Actual and original plan. Its native Other row
suppresses Remaining even when Forecast publishes a dated target and remaining.
The before captures reproduce both defects with independently invented inputs.

## Bounded renderer change

One default **Household Budget Total — Actual / Planned** prints the sealed
`Forecast.budgetPeriodProgress` household pair through the incumbent validity,
completeness, currency and trust checks. The unchanged deduction amount is
labeled **Protective spending reserve**, inside a keyboard-operable, initially
collapsed **Info: protective spending reserve** disclosure. Its reserve rule,
estimated markers and native evidence remain available.
Completed-period Info labels the historical amount **Completed-period spending
deduction**, rather than implying a current protective reserve.

The native dated Other row prints Forecast's signed Remaining. Missing actuals
show **Unavailable**, not an unspent allowance. Completed original Remaining
stays unknown and is omitted; a future remaining estimate keeps its estimated
marker and **Projected** context. Existing transaction nodes and focus
restoration remain on the same native sheet path.

No Forecast, policy, canonical input, deduction chain, generated report or
transaction membership changes. Existing reserve tests retain their numerical
assertions; only the reserve's user-facing label expectations change.

## Independent proof and pixels

All observations and category amounts in these artifacts are invented. Six
category plans sum to 475; groceries observed spending is 110.37; the explicitly
approved Other policy is 450. Under / at / over observations are 0 / 137.26 /
450 / 618.73. Expected household actuals are 110.37 / 247.63 / 560.37 / 729.10;
the original plan remains 925. Protective reserves remain 925 / 925 / 925 /
1093.73. Other Remaining is 450 / 312.74 / 0 / **−168.73**. These independent
constants do not call the producing selector to compute expected values.
An additional Other observation of 1034.19 puts the whole household actual
**1144.56** over its original **925** plan, with reserve **1509.19** and signed
Other Remaining **−584.19**; this also exercises an unchanged deficit deduction.

`test/test-budget-household-total-display.js` exercises the active native
composer, independent cents, immutable captured inputs/publications, preserved
deductions, current / missing / history / future and pending trust.
It is registered in the 293-suite `npm test` runner.

`test/browser-budget-household-total.js` uses actual `App.boot` with intercepted
HTTP and invented inputs at 1440, 390 and 320px. Thirteen views open the native
household and Other sheets. They verify the one total, unchanged original plan,
hidden reserve until keyboard opening, signed/missing Remaining, historical
unknown plan, projected trust, Escape focus restoration, visible restored
focus above the mobile dock, and no horizontal overflow. No production
credentials or live observations are accessed.

| View | Artifact |
|---|---|
| Desktop opened native sheet, before/after | [Comparison](comparison-household-137.26-1440.png) |
| 320px opened native sheet, before/after | [Comparison](comparison-household-137.26-320.png) |
| 320px whole household over plan, before/after | [Comparison](comparison-household-1034.19-320.png) |
| 320px missing actuals, before/after | [Comparison](comparison-household-null-320.png) |
| Other Remaining, before/after | [Comparison](comparison-other-remaining-137.26-320.png) |
| Completed period, original plan unknown | [Native sheet](household-history-320.png) |
| Future period, actual unknown | [Native sheet](household-next-320.png) |
| Unchanged reserve behind opened Info | [Native sheet](household-reserve-info-320.png) |

## Finite acceptance checklist

- One household Actual / Planned total in the default native sheet.
- Protective reserve behind explicitly labeled, keyboard-reachable Info.
- Unchanged original plan, reserve and financial deductions.
- Other Remaining: positive, zero, negative and unknown without fabricated history.
- Pending, partial, projected and unavailable evidence remain labeled.
- Desktop / mobile / 320px; native transactions and restored focus remain reachable.
- Exact-head unit, authority/financial-contract, full required CI and screenshot audit recorded in the PR.

This narrow owner-requested cleanup makes no full v3 pixel-completion claim.
Live Other membership and payroll-cent reconciliation remain unverified, and
savings starting assignments remain unconfirmed. Parent owns independent
exact-head Systems review, blocking-comment disposition, merge and deployment.
