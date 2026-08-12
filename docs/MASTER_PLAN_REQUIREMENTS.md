# Atlas Financial — Master Plan Requirements

**Owner direction recorded 2026-08-12.**

This document records the household-facing product Atlas is being built to serve and the employment/compensation inputs newly supplied by the owner. It is a requirements and source-intake record, **not a second financial-calculation authority and not a second work-sequencing authority**.

- `ARCHITECTURE.md` owns architectural direction and financial authorities.
- `docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md` owns work eligibility, order and interruption.
- `BACKLOG.md` owns work/findings state.
- `docs/ACCOUNT_FACTS.md`, `positions.csv` and `data.json` remain the homes for durable/current financial facts once verified and modelled.

Nothing below should silently promote an old employment document into a current payroll fact. Where current evidence is missing, it stays missing.

---

## 1. The product: one grand master plan, many views

Atlas should maintain **one coherent household financial plan**. A one-week view, a three-week view, a three-month view and a nine-month view are not separate plans; they are different windows into the same dated projection and the same starting facts.

The plan must be able to answer, from one underlying model:

- What can the household safely spend this week?
- What must happen over the next 1, 2 or 3 weeks?
- What does the next 2, 3, 9 or 12 months look like?
- Which bills, debt payments, renewals, trips, registrations and planned purchases create pressure, and when?
- What should available cash do next: preserve liquidity, fund a known commitment, or reduce debt?
- What is the cash/debt consequence of adding or removing an expense?
- What changes if extra income arrives?
- What changes if salary, pension contribution, bonus, interest rate, debt payment or purchase timing changes?

A change to an input must recalculate the affected horizons from the same plan. No short-horizon answer should quietly contradict the long-horizon answer.

### Primary interfaces

**Website:** the visual presentation and inspection surface for the plan.

**ChatGPT:** the conversational interpretation/query surface. The household should be able to ask for a weekly brief, a three-week plan, a three-month outlook, an explanation of why a month is tight, or the consequence of a proposed purchase without manually interpreting several dashboards.

Neither interface should invent a separate financial answer. Both consume the same plan authorities.

---

## 2. What the master plan must know

The durable model should eventually cover the household's material financial system:

### Income and compensation

- salary and spouse salary;
- pay cadence and actual net-pay behaviour;
- bonus target, range, expected payment date and actual payout when known;
- overtime/extra income/side income where applicable;
- owner-entered one-off extra income;
- pension contributions, employer contributions and optional employee contributions;
- CPP, CPP2 where applicable, EI and tax deductions as dated payroll effects rather than a flat monthly percentage;
- annual salary increases and their effective pay period;
- benefits/payroll deductions that materially change take-home pay.

### Debt

For every debt: current balance, limit, rate, rate convention, minimum, due date, interest cost, amortisation/revolving behaviour and any renewal/repricing date. Extra repayment decisions must be evaluated against both interest savings and household liquidity.

### Spending and budget

The budget must use transaction history as evidence of what normal life actually costs, while preserving the distinction between:

- historical actual spending;
- owner-set target budget;
- known dated commitments;
- planned future purchases/trips;
- estimates and unknowns.

Atlas should learn from actual-vs-plan variance. A repeated real cost should not remain hidden behind an unrealistic target without being surfaced for an owner decision.

### Bills: the source document matters, not just the transaction

A bank/card transaction proves that an amount moved. **It is not a substitute for the bill itself.** Atlas should ingest the actual invoice/statement for material recurring household bills wherever the owner can obtain it.

The bill can establish facts a transaction often cannot:

- provider and service/account type;
- billing period and consumption/service period;
- statement date and due date;
- amount currently due versus total/previous balance;
- fixed charges versus usage charges;
- taxes, fees, credits, rebates and late charges;
- equal-payment/budget-billing arrangements and true-ups;
- rate/plan changes;
- contract or promotional expiry;
- arrears or carried balances;
- seasonal usage patterns;
- whether a charge is recurring, annual, irregular or one-off.

Atlas should reconcile the bill to the payment transaction where possible, so the plan knows both **what was owed** and **what was actually paid**.

The owner specifically wants bill-level source intake for the household's recurring obligations. Known examples to collect include:

- **FortisBC** — natural gas;
- **BC Hydro** — electricity;
- **Rogers** — owner states this is the household internet bill;
- **garbage / waste pickup** — provider, cadence, amount and due-date pattern still to be supplied;
- other utilities/telecom bills as they are identified;
- insurance bills/policies and renewals;
- property tax and other annual municipal charges;
- debt statements, not only debt-payment transactions;
- subscriptions/memberships or other material recurring invoices where the source document adds useful terms or renewal information.

**Do not silently reconcile provider-name conflicts.** Current `ACCOUNT_FACTS.md` contains a recent transaction-derived **Shaw internet** entry ($78.40 in May–July 2026), while the owner now states the internet bill is **Rogers**. Until a current bill or account evidence resolves it, treat this as an open identity/current-provider question: Rogers may have replaced Shaw, be separate, or the transaction description may represent something else.

Raw bills can contain account numbers, addresses and other private source detail. They should follow the repository's existing raw-source/privacy handling rather than being casually committed to Git. The durable model should retain the verified financial facts, provenance and dates needed to reproduce the plan without exposing unnecessary raw identifiers.

### Planned purchases and sinking funds

Vacations, tournaments, Christmas, insurance, property tax, registrations, repairs, vehicles and other known large costs should enter the plan **before** their payment date. Atlas should show the amount that must effectively be reserved over time rather than discovering the full cost on the due date.

### Assets and retirement

Cash, investments, RESP, pension/retirement accounts and other material assets should be represented with their restrictions and purpose. Retirement assets are part of the household position but are not automatically short-term liquidity.

---

## 3. Planning behaviour Atlas should support

### Safe-to-spend is constrained by the future

Safe-to-spend is not simply current cash minus today's bills. It must preserve the cash required for known future commitments, required debt payments and the household's chosen liquidity/buffer policy across the requested horizon.

### Debt strategy is not APR-only

Atlas should quantify the benefit of high-rate debt repayment, but it must not recommend draining operational cash only to force the household to borrow it back. Debt reduction, liquidity, promotional/penalty rates, mortgage/HELOC renewal timing and future commitments all compete for the same dollar.

### Scenario comparison

A scenario changes inputs to the master plan rather than creating a disconnected calculator. Examples:

- add a $4,000 one-off income payment;
- receive a different annual bonus;
- increase employee pension contribution by 1 percentage point;
- take a $6,000 vacation in a chosen month;
- buy something now versus six weeks later;
- put an extra $2,500 against a card or HELOC;
- change a planned purchase amount;
- change an interest rate or renewal assumption.

The comparison should show cash lows, safe-to-spend, debt balances/interest, important dates and recovery/payoff timing against the baseline.

### Confidence matters

Every important input/result should preserve whether it is verified, calculated, owner-stated, estimated or unknown. A polished page must not make a provisional assumption look like a verified fact.

---

## 4. Dale employment and compensation — evidence captured 2026-08-12

The source documents below were supplied by the owner in conversation and are **not committed to this repository**. The facts are recorded here so the model can be updated without treating the old documents as current policy where they are not.

### Strong documentary facts

**2025 rewards statement supplied by owner**

- Annual base salary: **$151,283**, effective **1 March 2025**.
- Incentive Bonus Plan: **17% target / 20% maximum** for that statement year.
- Target bonus shown: **$25,718**; maximum shown: **$30,257**.
- Company pension contribution value shown: **$9,077**, consistent with roughly 6% of the stated base salary.
- 2025 vacation entitlement shown: **20 days**.
- Statement also showed average benefits value **$7,800** and Personal Spending Account eligibility **$500**; these are compensation/benefit values, not spendable salary.

**Signed 2022 Area Manager employment agreement**

- Position: Area Manager, JSS, Grade 7 in that agreement.
- The agreement preserved **14 December 2015** as the service date for vacation/service purposes.
- 2022 salary in that agreement was $123,000; it is historical and superseded by later compensation evidence.
- The agreement said salary was payable **semi-monthly** in approximately equal instalments and salary was reviewed annually.
- The DCPP required the employee to contribute **5%** and the company **6%** of basic monthly salary, up to CRA annual limits, under the plan terms then in force.
- The agreement referred to a maximum 20% IBP opportunity for the Area Manager position in 2022.

**2022 salaried benefits summary**

- Confirms a Defined Contribution Pension Plan.
- Confirms employee contribution **minimum 5%** and company contribution **6%** of basic monthly salary under that plan summary.
- Extended health and dental premiums were stated as 100% employer-paid.
- Basic life insurance and AD&D were each stated as **3× annual earnings, maximum $1,000,000**, with plan age/termination rules.
- Paid medical leave was stated as **100% of salary for up to 105 consecutive days** per eligible issue.
- LTD formula in that summary: **75% of the first $7,000 of monthly earnings plus 55% of the balance**, maximum monthly benefit $15,000, subject to plan terms and evidence requirements.
- A $250 wellness reimbursement existed in the 2022 summary. Current availability must be rechecked before using it.

**2020 Incentive Bonus Plan text — mechanism, not current percentage authority**

- For Grade 6+, the historical performance weights were Financial 50%, Safety & Environment 25%, Individual 25%.
- A profitability/funding gate applied.
- The historical plan used 70% performance thresholds and stated that an individual result below 70% eliminated the payout.
- Eligible compensation was earned base salary and excluded employer pension contributions, benefits, overtime and various other non-base amounts.
- Absent extraordinary circumstances, incentive awards were stated to be paid **by the end of February** after year-end results/approval and before the RRSP deadline.
- The percentage table in this 2020 plan is **not current authority** for Dale's bonus percentage because later employment/rewards evidence differs.

**2019 vacation policy — historical policy only**

- For Grades 6+, the policy listed 20 working days for 1–10 completed years, 25 for 11–19, and 30 after 20.
- It allowed a once-per-year payout of up to five accrued vacation days; that payout was not treated as eligible earnings for IBP, pension contributions or other benefits.
- This document explicitly warns that printed copies may be out of date. Do **not** put vacation payout into the live plan until current policy is confirmed.

**2016 Sun Life pension brochure — structural/history only**

- Confirms the plan is a DCPP and payroll contributions to a registered plan receive the tax deduction through payroll.
- Describes target-date and self-directed investment options that existed then.
- Old fund lists/fees and old access instructions are **not current financial facts** and must not be imported into the live plan.

---

## 5. Owner-stated compensation pattern to model, pending current payroll verification

The owner describes a recurring annual take-home pattern that Atlas should support explicitly rather than reducing salary to annual salary ÷ 12:

1. **January:** CPP/EI deductions restart, reducing take-home pay versus late in the prior year.
2. **Late February:** annual bonus normally arrives around this period.
3. **March 1:** the annual salary raise becomes effective every year. **Owner-confirmed 2026-08-12**, and independently consistent with the supplied 2025 rewards statement showing the $151,283 salary effective 1 March 2025. The raise amount varies; recent raises have typically been roughly 4–5%, but the actual percentage must be recorded each year rather than assumed.
4. **Later in the year:** CPP/EI annual maximums are reached, causing another increase in net pay. The owner recalls this occurring around June, but Atlas should calculate/observe the actual crossover rather than hard-code June.
5. The owner has been using one of these take-home increases to raise voluntary pension saving by **another 1 percentage point**. The intended policy is to repeat that annually until the employee contribution reaches **12%**.

Important: the owner does **not** currently know the exact total employee pension percentage or the exact current plan rule that permits/limits the optional contribution. Record the policy intent; do not infer a current total from the historical 5% minimum.

This payroll calendar matters because a nine-month plan crosses several different take-home regimes even when annual salary is unchanged.

---

## 6. Current unknowns — do not guess

The next payroll/benefit evidence should resolve these without reopening old transaction forensics:

1. **Current annual base salary.** The annual raise effective date is known: **March 1**. The current post-raise salary amount still needs the payroll portal/current compensation source.
2. **Current payroll cadence.** The 2022 agreement says semi-monthly; current bank-deposit analysis in `ACCOUNT_FACTS.md` has described Dale's payroll as bi-weekly. A current pay stub/payroll portal should settle which is now true.
3. **Current employee pension contribution percentage.** Owner states an extra +1 percentage point was added this year, but the total is not known.
4. **Current optional-pension rules and maximum.** Owner states a 12% employee ceiling; obtain current plan/payroll evidence before modelling the ceiling as verified.
5. **Current employer pension formula/CRA cap mechanics.** Historical evidence says 6% up to CRA limits and the 2025 rewards statement is consistent with 6%; current plan evidence still wins.
6. **2026/current IBP target and maximum percentage**, plus the actual annual payout when known. Do not copy the 2020 grade table forward.
7. **Current annual raise percentage/resulting salary.** The effective date itself is no longer unknown: it is March 1 each year.
8. **Year-to-date CPP, CPP2, EI, tax and other payroll deductions**, so the model can reproduce the actual net-pay step changes and annual maximum dates.
9. **Current pension balance, holdings, contribution history and fees** from Sun Life.
10. **Current vacation policy** only if Atlas is going to model vacation payout as an available optional cash event.
11. Equivalent compensation/payroll/pension facts for Amanda wherever they materially affect the household master plan.
12. **Current bill-source pack:** actual recent bills/statements for FortisBC, BC Hydro, Rogers/internet and garbage/waste pickup first, followed by the rest of the household's material recurring bills. The goal is to reconcile bill terms/due dates/service periods to transaction evidence rather than infer the whole obligation from merchant charges.
13. **Internet provider identity:** current owner statement says Rogers; recent transaction-derived repo fact says Shaw. Resolve from a current bill/account source before modelling either as the sole current provider.

Preferred payroll evidence is a current payroll portal/pay stub and current Sun Life plan/account information. One early-year pay stub, one post-raise stub and one after CPP/EI maximums are reached would be especially useful for gross-to-net reconciliation.

Preferred bill evidence is the actual provider PDF/statement or a complete account-page capture that shows the billing period, amount due, due date and plan/rate details. A transaction screenshot alone is weaker evidence.

---

## 7. Build implication

The near-term authority cleanup remains valuable: Forecast needs to become a trustworthy deterministic financial engine before ChatGPT or the website can rely on it.

But the product exit should be judged against the master-plan objective above, not against the number of pages or charts built.

A feature is valuable when it materially improves at least one of:

1. correctness/completeness of the master financial plan;
2. ability to update assumptions and recalculate the plan;
3. ability to understand, inspect or explain the plan;
4. ability to compare a proposed decision against the baseline plan.

A conventional dashboard feature that does none of those is not automatically worth building.
