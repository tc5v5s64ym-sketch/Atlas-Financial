# Atlas Financial - Employment and Pension Facts

**Record status:** Sanitized source synthesis awaiting canonical integration  
**As of:** August 13, 2026  
**Owner:** Dale  
**Scope:** Seaspan employment income, payroll behaviour, and Sun Life defined-contribution pension

This record preserves the verified source synthesis so none of the supplied employment or pension evidence is lost. It is not a second standing-fact or publication authority. Canonical integration must place standing facts in `docs/ACCOUNT_FACTS.md`, dated balances in `docs/positions.csv` and `data.json`, live plan inputs in `data.json`, and derived answers in the Atlas engine. Until that integration is complete, future Atlas work should use this record instead of older conversational estimates. In particular, **$158,091 is the current base salary**; the approximately $170,000 figure was total taxable employment income, not base salary.

## Source evidence

- Gmail message: `Employment Information`, self-sent August 13, 2026.
- Compensation-history screenshot from Seaspan.
- 68 payroll statements covering January 2024 through August 2026.
- 2024 and 2025 T4 slips.
- Sun Life statements for calendar 2025, Q1 2026, and H1 2026.
- Sun Life account screenshots dated August 12, 2026 and showing returns through July 2026.
- Seaspan employment agreement, benefit summary, incentive plan, and pension-plan brochure.

Do not store or surface payroll employee numbers, bank details, home address, pension account numbers, or tax identifiers in derived views.

## 1. Employment and salary

### Employer and role

- Legal employer: Vancouver Shipyards Co. Ltd. / Vancouver Shipyards Company.
- Current compensation grade shown: 7S.
- Salary is annual wages paid through payroll.

### Verified salary history

| Effective period | Annual base salary | Change |
|---|---:|---:|
| July 1, 2020 - February 28, 2021 | $106,020 | - |
| March 1, 2021 - February 28, 2022 | $108,672 | +2.50% |
| March 1, 2022 - July 15, 2022 | $111,661 | +2.75% |
| July 16, 2022 - February 28, 2023 | $123,000 | +10.15% |
| March 1, 2023 - February 29, 2024 | $128,535 | +4.50% |
| March 1, 2024 - August 31, 2024 | $135,604 | +5.50% |
| September 1, 2024 - February 28, 2025 | $142,384 | +5.00% |
| March 1, 2025 - February 21, 2026 | $151,283 | +6.25% |
| February 22, 2026 - ongoing | **$158,091** | **+4.50%** |

The March 20, 2026 compensation record is a zero-dollar payroll conversion entry. It is not a second raise.

### Payroll cadence

- Payroll was semi-monthly through June 30, 2025.
- Payroll converted to biweekly beginning with the July 18, 2025 deposit.
- Current annual schedule is 26 regular deposits, including two three-paycheque months.
- Current regular gross pay is **$6,080.42 biweekly**.
- At the prior $151,283 salary, post-conversion regular gross was $5,818.58 biweekly.
- Before conversion, the $151,283 salary produced $6,303.46 semi-monthly.

### Current recurring net pay pattern

After CPP, CPP2, and EI were fully paid for 2026 and after the current 1% optional pension deduction began:

- Typical net deposit: approximately **$4,247.92 to $4,274.98**.
- Observed average: approximately **$4,264 per biweekly cheque**.
- Approximate average monthly regular take-home: **$9,239**, although actual cash flow follows two- and three-paycheque months rather than equal monthly deposits.

These are observed 2026 amounts, not permanent tax guarantees.

## 2. Incentive bonus

### Plan rule

- The employment agreement documents up to 20% maximum potential bonus for the applicable management role.
- The bonus is variable and is not guaranteed.
- The bonus is normally paid as a separate deposit near February 25 or 26 for the prior performance year.

### Verified payouts

| Deposit date | Gross bonus | Net deposit |
|---|---:|---:|
| February 26, 2024 | $23,640.11 | $12,642.67 |
| February 26, 2025 | $26,441.46 | $14,130.04 |
| February 25, 2026 | $29,168.11 | $15,570.25 |

Observed payouts were approximately 18.5%, 19.4%, and 19.5% of estimated eligible prior-year salary. Use 20% only as an upside/target scenario, not as guaranteed income.

Bonus payroll did not show an incremental DCPP deduction. The bonus materially accelerates the annual CPP, CPP2, and EI maximums.

## 3. CPP, CPP2, and EI seasonality

Atlas must calculate statutory deductions per deposit against the applicable calendar-year maximums. Do not hard-code a June step-up.

- Statutory contribution year follows the **deposit date**, even when the pay period ended in the prior calendar year.
- The late-February bonus causes annual maximums to be reached earlier than salary alone would.
- For 2026:
  - EI finished on the March 27 deposit.
  - Base CPP finished on the April 10 deposit.
  - CPP2 finished on the May 8 deposit.
  - From May 22 onward, no CPP, CPP2, or EI was deducted until the next January reset.
- For 2025, base CPP and EI finished in April and CPP2 finished on May 15.
- For 2024, the statutory maximums were reached by mid-May.

## 4. T4 reconciliation

| Tax year | Employment income | Income tax deducted | CPP | CPP2 | EI | RPP contributions | Pension adjustment |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2024 | $161,427.03 | $39,121.01 | $3,867.50 | $188.00 | $1,049.12 | $8,910.73 | $17,112.00 |
| 2025 | $171,193.90 | $43,604.78 | $4,034.10 | $396.00 | $1,077.48 | $7,296.02 | $15,900.00 |

T4 employment income includes salary, bonus, and taxable benefits. It must not overwrite the effective-dated base salary.

## 5. Seaspan defined-contribution pension

### Plan profile

- Plan: Seaspan Salaried Employees Pension Plan / Defined Contribution Pension Plan.
- Sun Life product: DCPP1.
- Registration number: 57757.
- Jurisdiction: federal; province of employment: British Columbia.
- Employment start: December 14, 2015.
- Plan join date: April 1, 2016.
- Vesting: 100%.
- Earliest plan retirement date: February 1, 2041, approximately age 55.
- Normal plan retirement date: February 1, 2051, approximately age 65.

### Current balance and investment

- Current balance: **$144,365.95 CAD as of August 12, 2026**.
- Investment: **100% SL Granite 2050 Fund** for both employee and employer contributions.
- Balance on June 30, 2026:
  - Locked in: $127,088.13.
  - Not locked in: $13,089.35.
  - Total: $140,177.48.

### Current contribution election

| Source | Rate | Current amount per biweekly pay |
|---|---:|---:|
| Required employee | 5% | $304.02 |
| Optional employee | 1% | $60.80 |
| Employer | 6% | $364.83 |
| **Total** | **12%** | **approximately $729.65** |

- Current employee total is 6%; current combined employee-and-employer funding is 12%.
- Annualized at the current salary, the current run rate is approximately $18,971, subject to CRA and plan limits.
- The recurring 1% optional election began with the June 19, 2026 deposit.
- Historical optional elections were variable:
  - 2024: temporary 7% optional contribution, $415.29 per semi-monthly pay, totaling $2,076.45.
  - 2025: one 2% optional deduction of $126.07.
  - 2026: current recurring 1% optional contribution.

Optional contributions must therefore be effective-dated, not represented as a timeless fixed rate.

### Verified account movement

| Period | Opening balance | Employee contributions | Employer contributions | Investment gains | Reported fees | Ending balance |
|---|---:|---:|---:|---:|---:|---:|
| Calendar 2025 | $83,994.48 | $7,592.65 | $8,959.89 | $15,886.29 | $(129.40) | $116,303.91 |
| Q1 2026 | $116,303.91 | $1,758.67 | $2,110.38 | $1,578.74 | $(205.62) | $121,546.08 |
| H1 2026 | $116,303.91 | $3,947.61 | $4,664.19 | $15,687.68 | $(425.91) | $140,177.48 |

From January 1, 2025 through June 30, 2026, the balance grew by $56,183.00. Approximately $25,164.34 came from employee and employer contributions, and approximately $31,018.66 came from net investment performance after reported fees.

### Historical performance snapshot

Net returns shown in the Sun Life app as of July 2026:

| Period | Return |
|---|---:|
| Year to date | 11.9% |
| 3 months | 5.2% |
| 1 year | 21.2% |
| 2 years | 17.6% |
| 3 years | 17.4% |
| 5 years | 12.8% |

The year-end 2025 asset mix was approximately 9.1% fixed income, 25.5% Canadian equity, 32.5% U.S. equity, 31.6% international equity, and 1.3% other. The fund was therefore approximately 89.6% equities.

Historical returns are evidence of past performance only. Do not use 12.8% as the base forecast return.

## 6. Locked planning decisions and assumptions

These are owner-approved planning choices, not employer or plan guarantees.

- Preserve the required 5% employee contribution and Seaspan's 6% contribution.
- Current optional contribution is 1%, making the employee total 6%.
- Intended ramp: increase the employee total by approximately one percentage point annually until it reaches 12%, making combined employee-and-employer funding 18%.
- Contribution increases are **conditional on cash flow and debt pressure**. They are not automatic obligations.
- If high-interest credit-card debt is revolving, optional pension contributions may be temporarily redirected to the cards while preserving the required 5% and employer 6%.
- The Granite target-date approach is acceptable and should not be changed merely because recent returns were strong.
- Granite 2045 is the closer match if pension withdrawals begin around 2046. Granite 2050 remains reasonable if the pension will not be needed until roughly 2050-2051 or if Dale deliberately accepts more equity risk.
- Do not change from Granite 2050 until the expected pension-withdrawal start date is decided.
- Retirement comparisons should include age 60 and age 65. The exact withdrawal start remains open.
- Forecast returns should use multiple net scenarios, including a conservative 3% case and moderate 5% and 7% cases.

### Simplified age-60 pension scenarios

The following are approximate nominal projections from the August 2026 balance, assuming 3% annual salary growth and excluding CPP, Amanda's retirement assets, the home, taxes, inflation, and future CRA/plan caps.

| Contribution strategy | 3% net return | 5% net return | 7% net return |
|---|---:|---:|---:|
| Maintain 12% combined | approximately $900,000 | approximately $1.15 million | approximately $1.49 million |
| Ramp to 18% combined | approximately $1.20 million | approximately $1.50 million | approximately $1.90 million |

These figures are scenarios, not promises.

## 7. Open actions and unresolved decisions

1. Confirm when pension withdrawals are expected to begin: retirement around 2046, normal plan age in 2051, or another bridge strategy.
2. Re-evaluate Granite 2045 versus Granite 2050 only after the withdrawal date and risk tolerance are explicit.
3. Before each optional-contribution increase, confirm current revolving credit-card debt, HELOC pressure, and liquid emergency reserves.
4. Correct the Sun Life profile inconsistency: Amanda is shown as wife and 100% primary beneficiary, but the spouse field says `Not on record`.
5. Review contingent beneficiaries: Logan and Linden are listed, but Luke is absent. Confirm the desired three-child allocation and trustee arrangements directly with Sun Life.
6. Future raises, bonus performance, tax rates, statutory maximums, fund returns, and CRA limits remain future variables and must never be stored as confirmed facts before they occur.

## 8. Atlas implementation rules

- Preserve evidence date, source type, and confidence for every fact.
- Keep salary, T4 income, bonus, taxable benefits, and pension contributions as separate concepts.
- Use effective-dated salary and contribution records.
- Generate the biweekly deposit calendar rather than smoothing cash flow into twelve equal months.
- Apply CPP, CPP2, and EI by deposit year and stop deductions only when the applicable maximum is reached.
- Model the bonus as a separate late-February cash event with gross and net scenarios.
- Record pension balances as dated snapshots; do not overwrite history with the latest value.
- Store investment returns as historical observations, never as guaranteed forecast inputs.
- Keep verified facts, owner decisions, projections, and open questions visibly distinct.
