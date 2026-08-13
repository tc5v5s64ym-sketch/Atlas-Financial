# Atlas Financial - Household Bill Facts

**Record status:** Sanitized source synthesis awaiting canonical integration  
**As of:** August 13, 2026  
**Owner:** Dale  
**Scope:** Currently verified household electricity, natural-gas, and internet bills

This record preserves the verified bill-source synthesis so none of the supplied utility evidence is lost. It is not a second standing-fact or publication authority. Canonical integration must place standing terms in `docs/ACCOUNT_FACTS.md`, live schedules and reminders in `data.json`, observed spending in the generated history, and derived answers in the Atlas engine. It is also not proof that the corresponding bank or credit-card transaction has been imported. Atlas must reconcile each observed payment before creating or adding an expense so spending is never duplicated.

## Source evidence

- Gmail message: `utilities`, self-sent August 13, 2026.
- BC Hydro monthly consumption and billing-history CSV exports through August 10, 2026.
- FortisBC monthly consumption history, billing-history CSV, and invoice for July 11 through August 10, 2026.
- Rogers together with Shaw invoice dated August 1, 2026 for service from August 1 through August 31, 2026.

Do not store or surface utility account numbers, payment credentials, or the home address in derived views.

## 1. Current recurring bill schedule

| Provider | Service | Current recurring amount | Cadence | Payment method / timing | Evidence date |
|---|---|---:|---|---|---|
| BC Hydro | Electricity | **$234.00** | Monthly equal-payment plan | Monthly billing | August 10, 2026 |
| FortisBC | Natural gas | **$124.00** | Monthly equal-payment plan | Automatic withdrawal; current invoice scheduled September 1, 2026 | August 10, 2026 |
| Rogers together with Shaw | Internet | **$78.40** | Monthly | Automatic withdrawal; current invoice scheduled August 14, 2026 | August 1, 2026 |
| **Total** |  | **$436.40 per month** |  |  |  |

- Current scheduled annual household total for these three bills: **$5,236.80**.
- The Hydro and Fortis amounts are equal-payment-plan cash schedules, not the actual cost of that month's consumption.
- This total excludes any other household bills not yet supplied, including mobile phones and any separately billed water, sewer, garbage, insurance, subscriptions, or property charges.

## 2. BC Hydro electricity

### Current schedule and statement status

- Current equal-payment-plan amount: **$234 per month**.
- The August 10, 2026 statement/export shows:
  - Balance forward: **$213.79**.
  - New charges: **$237.45**.
  - New charges include the $234 equal payment and a **$3.45 late-payment charge**.
  - Amount shown due: **$451.24**.
- The carried balance may reflect payment timing, but it is unresolved until the live Hydro account confirms that it has been paid.

### Consumption and underlying cost

- Electricity consumption from August 2025 through July 2026: **17,765 kWh**.
- Average consumption: approximately **1,480 kWh per month**.
- Observed monthly range: **1,026 to 2,035 kWh**.
- Consumption was highest in winter and lowest in summer.
- Approximate accrued energy cost over the latest twelve billing periods: **$2,452.61**, or approximately **$204.38 per month**.
- This accrued-cost estimate excludes late fees, prior balances, and equal-payment-plan catch-up mechanics.

### Non-recurring item

- The **$1,115.71** equal-payment-plan charge appearing in September 2025 was a reconciliation/catch-up event, not a normal monthly electricity expense.
- Atlas must classify material future equal-payment-plan reconciliations separately from the $234 recurring schedule.

## 3. FortisBC natural gas

### Current schedule and statement status

- Current equal-payment-plan amount: **$124 per month**.
- Current invoice covers July 11 through August 10, 2026.
- Current-period actual consumption cost: **$32.37** for **1.4 GJ**.
- Current $124 withdrawal is scheduled for September 1, 2026.
- Fortis reported that actual costs since the equal-payment plan began were **$109.55 less than the amount billed**.
- The plan is reviewed quarterly and has a reconciliation scheduled for **September 2026**. Atlas should expect a possible credit or payment-plan adjustment, but neither is confirmed until the next statement arrives.

### Consumption and underlying cost

- Actual cost across the latest twelve bills: **$1,179.87**.
- Average actual cost: approximately **$98.32 per month**.
- Actual monthly cost range: **$32.37 to $177.67**.
- Total observed consumption: **79.0 GJ**.
- Gas is strongly seasonal, with the lowest consumption in summer and the highest in winter.

## 4. Rogers internet

### Current service and invoice

- Service: **Rogers Xfinity Internet Premier 2G**.
- Rogers Xfinity Gateway rental is included.
- Listed internet price: **$155.00 per month**.
- Automatic-payment discount: **$5.00 per month**.
- ValuePlan internet promotion: **$80.00 per month**.
- Current subtotal after discounts: **$70.00**.
- Current GST and PST: **$8.40**.
- Current total: **$78.40 per month**.
- The August invoice had a **$0 carried balance**, and the previous $78.40 invoice was paid.

### Promotion expiry and required reminder

The **$80 monthly ValuePlan promotion expires December 28, 2027**.

| Reminder stage | Date | Required action |
|---|---|---|
| Early review | **September 29, 2027** | Surface a prominent Atlas reminder 90 days before expiry; compare retention offers and competing internet plans. |
| Escalation | **November 28, 2027** | Surface a second reminder 30 days before expiry if no replacement price or renewed promotion has been recorded. |
| Expiry | **December 28, 2027** | Do not mark resolved until the future Rogers price or replacement provider has been confirmed and the recurring schedule updated. |

- If the listed price, automatic-payment discount, and current tax rates remained unchanged, the post-promotion bill would be approximately **$168 per month**.
- That would be an estimated increase of **$89.60 per month** or **$1,075.20 per year**.
- Under that unchanged-price scenario, the three known household bills would rise from **$436.40 to approximately $526.00 per month**.
- These post-expiry figures are planning estimates, not confirmed future charges; Rogers may change its base price, taxes, discounts, or available promotions before December 2027.

**Reminder delivery status:** The reminder dates and Atlas surfacing requirement are now recorded in this canonical fact set. A separate calendar or push-notification event has not been created.

## 5. Planning reference

The latest underlying annual energy costs were approximately:

| Service | Reference annual cost | Monthly average |
|---|---:|---:|
| Electricity | $2,452.61 | $204.38 |
| Natural gas | $1,179.87 | $98.32 |
| **Energy total** | **$3,632.48** | **$302.71** |

Adding the current Rogers price annualized produces a reference household total of approximately **$4,573.28 per year**, or **$381.11 per month**. This is a comparison metric only: the energy figures are backward-looking consumption costs while the Rogers figure is the current price annualized. The cash-flow budget must continue using the current scheduled total of **$436.40 per month** until the equal-payment plans change.

## 6. Open actions

1. Confirm whether the BC Hydro amount shown due, **$451.24**, has now been paid and the account is current.
2. Capture the September 2026 Fortis equal-payment-plan reconciliation and update the $124 schedule only if Fortis changes it.
3. Reconcile each Hydro, Fortis, and Rogers payment against imported Atlas transactions before adding expenses.
4. Add other household bills as source evidence becomes available so the household total is explicitly complete rather than assumed complete.
5. Implement Atlas reminder delivery for the Rogers review dates; the canonical dates exist, but no live notification channel is currently configured.

## 7. Atlas implementation rules

- Represent each provider's recurring amount as an effective-dated schedule.
- Store invoices and payments as separate observations linked through reconciliation metadata.
- Never treat a carried balance, late fee, promotion expiry, or equal-payment-plan reconciliation as the normal monthly bill.
- Preserve source date, billing period, service period, amount, discount, tax, and confidence for every observation.
- Keep account identifiers, home address, and payment credentials out of derived views and repository-tracked documentation.
- Recalculate household totals when a schedule changes; do not silently overwrite prior schedule history.
- Surface the Rogers promotion reminder at 90 days and again at 30 days unless it has been explicitly resolved.
