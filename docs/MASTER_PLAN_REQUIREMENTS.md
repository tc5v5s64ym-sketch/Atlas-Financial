# Master-plan source intake — bills, payroll and compensation

**Owner evidence recorded 2026-08-12.**

This file is a **source-intake and owner-evidence record**: what the master plan
still needs from real documents, what the owner has supplied so far, and what is
deliberately still unknown. It holds no product direction, no financial
authority and no sequencing.

| For | Read |
|---|---|
| What Atlas is for, and the one-plan-many-windows product direction | [`../ARCHITECTURE.md`](../ARCHITECTURE.md) |
| Work eligibility, order and interruption | [`ATLAS_FINANCIAL_BUILD_STRATEGY.md`](ATLAS_FINANCIAL_BUILD_STRATEGY.md) |
| Work and findings | [`../BACKLOG.md`](../BACKLOG.md) |
| Standing facts, once verified | [`ACCOUNT_FACTS.md`](ACCOUNT_FACTS.md) |
| Balances and published figures | [`positions.csv`](positions.csv), [`../data.json`](../data.json) |

The product contract this evidence serves — one grand plan, every horizon a
window onto it, two interfaces and one answer — is stated **once**, in
`ARCHITECTURE.md` under **Direction**. It is not restated here. An earlier draft
of this file carried its own copy of it, which is how a second home for direction
starts.

**Nothing below promotes an old employment document into a current payroll
fact.** Where current evidence is missing, it stays missing.

---

## 1. Bills: the source document matters, not just the transaction

A bank or card transaction proves that an amount moved. **It is not a substitute
for the bill itself.** The plan should ingest the actual invoice or statement for
material recurring household bills wherever the owner can obtain it.

The bill establishes facts a transaction usually cannot:

- provider, and the service or account type;
- billing period, and the consumption or service period;
- statement date and due date;
- amount currently due versus total or previous balance;
- fixed charges versus usage charges;
- taxes, fees, credits, rebates and late charges;
- equal-payment or budget-billing arrangements, and their true-ups;
- rate or plan changes;
- contract or promotional expiry;
- arrears or carried balances;
- seasonal usage patterns;
- whether a charge is recurring, annual, irregular or one-off.

Reconcile the bill to the payment transaction where possible, so the plan knows
both **what was owed** and **what was actually paid**.

### The first bill-source pack

The owner wants bill-level intake for the household's recurring obligations,
starting with:

- **FortisBC** — natural gas;
- **BC Hydro** — electricity;
- **Rogers** — owner states this is the household internet bill;
- **garbage / waste pickup** — provider, cadence, amount and due-date pattern
  still to be supplied;

then the rest of the material recurring bills: other utilities and telecom,
insurance policies and renewals, property tax and other annual municipal
charges, debt statements rather than only debt-payment transactions, and any
subscription or membership whose source document adds real terms or renewal
information.

### The Rogers-versus-Shaw discrepancy is unresolved, deliberately

`ACCOUNT_FACTS.md` carries a transaction-derived **Shaw internet** entry —
$78.40 in May–July 2026 — while the owner now states the internet bill is
**Rogers**. Until a current bill or account source settles it, this stays an open
identity question: Rogers may have replaced Shaw, may be separate, or the
transaction description may represent something else. **Do not silently pick one
from chat or merchant text.**

### Raw bills follow the raw-source rules

Bills carry account numbers, addresses and other private detail. They go through
the repository's existing `raw/` handling — never casually committed. What is
kept durably is the verified financial fact, its provenance and its date: enough
to reproduce the plan without carrying unnecessary identifiers.

---

## 2. Dale employment and compensation — evidence captured 2026-08-12

The source documents below were supplied by the owner in conversation and are
**not committed to this repository**. The facts are recorded so the model can be
updated without treating old documents as current policy where they are not.

### Strong documentary facts

**2025 rewards statement supplied by owner**

- Annual base salary: **$151,283**, effective **1 March 2025**.
- Incentive Bonus Plan: **17% target / 20% maximum** for that statement year.
- Target bonus shown: **$25,718**; maximum shown: **$30,257**.
- Company pension contribution value shown: **$9,077**, consistent with roughly
  6% of the stated base salary.
- 2025 vacation entitlement shown: **20 days**.
- Statement also showed average benefits value **$7,800** and Personal Spending
  Account eligibility **$500**; these are compensation/benefit values, not
  spendable salary.

**Signed 2022 Area Manager employment agreement**

- Position: Area Manager, JSS, Grade 7 in that agreement.
- The agreement preserved **14 December 2015** as the service date for
  vacation/service purposes.
- 2022 salary in that agreement was $123,000; it is historical and superseded by
  later compensation evidence.
- Salary was payable **semi-monthly** in approximately equal instalments, and
  reviewed annually.
- The DCPP required the employee to contribute **5%** and the company **6%** of
  basic monthly salary, up to CRA annual limits, under the plan terms then in
  force.
- It referred to a maximum 20% IBP opportunity for the Area Manager position in
  2022.

**2022 salaried benefits summary**

- Confirms a Defined Contribution Pension Plan.
- Confirms employee contribution **minimum 5%** and company contribution **6%**
  of basic monthly salary under that plan summary.
- Extended health and dental premiums were stated as 100% employer-paid.
- Basic life insurance and AD&D were each stated as **3× annual earnings,
  maximum $1,000,000**, with plan age/termination rules.
- Paid medical leave was stated as **100% of salary for up to 105 consecutive
  days** per eligible issue.
- LTD formula in that summary: **75% of the first $7,000 of monthly earnings plus
  55% of the balance**, maximum monthly benefit $15,000, subject to plan terms
  and evidence requirements.
- A $250 wellness reimbursement existed in the 2022 summary. Current availability
  must be rechecked before using it.

**2020 Incentive Bonus Plan text — mechanism, not current percentage authority**

- For Grade 6+, the historical performance weights were Financial 50%, Safety &
  Environment 25%, Individual 25%.
- A profitability/funding gate applied.
- The historical plan used 70% performance thresholds and stated that an
  individual result below 70% eliminated the payout.
- Eligible compensation was earned base salary, and excluded employer pension
  contributions, benefits, overtime and various other non-base amounts.
- Absent extraordinary circumstances, incentive awards were stated to be paid
  **by the end of February** after year-end results and approval, before the RRSP
  deadline.
- The percentage table in this 2020 plan is **not current authority** for Dale's
  bonus percentage, because later employment and rewards evidence differs.

**2019 vacation policy — historical policy only**

- For Grades 6+, the policy listed 20 working days for 1–10 completed years, 25
  for 11–19, and 30 after 20.
- It allowed a once-per-year payout of up to five accrued vacation days; that
  payout was not treated as eligible earnings for IBP, pension contributions or
  other benefits.
- The document itself warns that printed copies may be out of date. Do **not**
  put vacation payout into the live plan until current policy is confirmed.

**2016 Sun Life pension brochure — structural and historical only**

- Confirms the plan is a DCPP, and that payroll contributions to a registered
  plan receive the tax deduction through payroll.
- Describes target-date and self-directed investment options that existed then.
- Old fund lists, fees and access instructions are **not current financial facts**
  and must not be imported into the live plan.

---

## 3. Owner-stated payroll pattern, pending current verification

The owner describes a recurring annual take-home pattern the plan should support
explicitly, rather than reducing salary to annual salary ÷ 12:

1. **January:** CPP/EI deductions restart, reducing take-home pay versus late in
   the prior year.
2. **Late February:** the annual bonus normally arrives around this period.
3. **March 1:** the annual salary raise becomes effective every year.
   **Owner-confirmed 2026-08-12**, and independently consistent with the supplied
   2025 rewards statement showing the $151,283 salary effective 1 March 2025. The
   raise amount varies; recent raises have typically been roughly 4–5%, but the
   actual percentage must be recorded each year rather than assumed.
4. **Later in the year:** CPP/EI annual maximums are reached, raising net pay
   again. The owner recalls this occurring around June, but the crossover should
   be calculated or observed rather than hard-coded to June.
5. The owner has been using one of these take-home increases to raise voluntary
   pension saving by **another 1 percentage point**, intending to repeat that
   annually until the employee contribution reaches **12%**.

The owner does **not** currently know the exact total employee pension percentage
or the exact current plan rule permitting and limiting the optional contribution.
Record the policy intent; do not infer a current total from the historical 5%
minimum.

This calendar matters because a nine-month plan crosses several different
take-home regimes even when annual salary is unchanged.

---

## 4. Current unknowns — do not guess

The next payroll, pension and bill evidence should resolve these without
reopening old transaction forensics:

1. **Current annual base salary.** The raise's effective date is known —
   **1 March** — but the current post-raise amount needs the payroll portal or a
   current compensation source.
2. **Current payroll cadence.** The 2022 agreement says semi-monthly; current
   bank-deposit analysis in `ACCOUNT_FACTS.md` describes Dale's payroll as
   bi-weekly. A current pay stub or payroll portal should settle which is now
   true.
3. **Current employee pension contribution percentage.** The owner states an
   extra +1 percentage point was added this year; the total is not known.
4. **Current optional-pension rules and maximum.** The owner states a 12%
   employee ceiling; obtain current plan or payroll evidence before modelling
   that ceiling as verified.
5. **Current employer pension formula and CRA cap mechanics.** Historical
   evidence says 6% up to CRA limits and the 2025 rewards statement is consistent
   with 6%; current plan evidence still wins.
6. **2026 IBP target and maximum percentage**, plus the actual annual payout when
   known. Do not copy the 2020 grade table forward.
7. **Current annual raise percentage and the resulting salary.** The effective
   date is no longer unknown: it is 1 March each year.
8. **Year-to-date CPP, CPP2, EI, tax and other payroll deductions**, so the model
   can reproduce the actual net-pay step changes and the annual maximum dates.
9. **Current pension balance, holdings, contribution history and fees** from Sun
   Life.
10. **Current vacation policy** — only if vacation payout is going to be modelled
    as an available optional cash event.
11. Equivalent compensation, payroll and pension facts for Amanda wherever they
    materially affect the household plan.
12. **Current bill-source pack:** recent bills or statements for FortisBC, BC
    Hydro, Rogers/internet and garbage/waste pickup first, then the rest of the
    material recurring bills, so bill terms, due dates and service periods can be
    reconciled to transaction evidence rather than inferred from merchant
    charges.
13. **Internet provider identity:** owner states Rogers; the transaction-derived
    repository fact says Shaw. Resolve from a current bill or account source
    before modelling either as the sole current provider.

---

## 5. What evidence is worth most

**Payroll:** a current payroll portal view or pay stub, plus current Sun Life plan
and account information. One early-year stub, one post-raise stub, and one from
after the CPP/EI maximums are reached would be especially useful for
gross-to-net reconciliation.

**Bills:** the provider's own PDF or statement, or a complete account-page
capture showing the billing period, amount due, due date and plan or rate
details. A transaction screenshot alone is weaker evidence.
