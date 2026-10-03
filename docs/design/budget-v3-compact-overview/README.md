# Budget v3: compact Current balance and evidence

Second slice on `agent/budget-v3-today-cash`, rebased onto actual merged main
`5178c0cf1f5899b6a5d510a4969719793d02f3e1` after the parent confirmed #485's
merge. Its final signed/zero-income repairs and all regressions are inherited.
No writes to #485 accompany this work. The complete #480 visual target remains
unfinished; this is the compact Current-balance/evidence outcome.

The actual approved #480 desktop/mobile captures remain the reference. Owner
clarifications narrow Current balance to the Bills account and request compact
default rows with explanations on demand. Accordingly, the permanent Today
card shows Current balance, its Bills-account-only qualifier, any essential
funding warning and the next-payday link. The household cash chart, allocation
legend, required protection, funding capacity and incumbent instruction bodies
are available through the info control, without a second permanent cash panel.

## Authority and independent evidence

Current balance reprints `currentBalancePublication` only when its published
identity is `chequing-a`, the documented Bills account, its amount is numeric
and its own trust is posted or planned-unconfirmed. Explicit null publications,
null amounts, other identities, nonnumeric amounts and unavailable trust stay
unavailable. Planned-unconfirmed retains the receipt qualifier. Savings and a
negative daily-spending account cannot enter this headline.

The on-demand funding breakdown is separately labelled across chequing
accounts. It selects the current period's `fromTodayFunding` even when another
period is selected. It reprints its own remaining bills/household, required
operating cash, funding capacity and proposal; the floor retains its own
Forecast trust. It never calculates a Bills-only keep amount, adds payday income
to observed cash or interprets capacity as a contribution. The next-payday link
opens the exact existing first schedule row, with the correct date. No buffer,
canonical assignment, household amount or engine rule changes.

The existing `paydayAllocation.protectedPath.allocated` also remains available
in info as **Keep for later**, qualified **After bills & essentials · across
chequing** and only when its own status is calculated. Missing protection is
unavailable, never replaced by the floor or zero. This field is the current
pooled allocation's future-walk protection; it is not a selected-period
required carryover or a Bills-account-only amount. It is deliberately excluded
from the default Current-balance card so the UI cannot imply a subtraction
between different scopes. A simple default required-carryover line needs a
matching Forecast publication seam; that is an outstanding financial boundary
for parent review. No new carryover calculation is introduced in the page.

The independent observation/overlay fixture publishes Bills cash 1,215,
spending cash 160, remaining bills 265, and remaining household
`(450 - 308.55) + (160 - 74.20) + (120 - 38.75) = 308.50`.
Required operating cash is `265 + 308.50 + 300 = 873.50`; funding capacity is
`1,375 - 873.50 = 501.50`. The proposal is published as 0, separately from
capacity. A second invented observation has spending cash -50 and savings
8,000: Current balance remains 1,215 while household transactions and remaining
needs stay present. Nothing is copied or scaled from the real household.

An independent grocery-overrun observation adds 200: groceries become
`212.40 + 96.15 + 200 = 508.55`, above the 450 target. The published household
reserve becomes `508.55 + 160 + 120 + 22.99 = 811.54`; the final balance is
`4,050 - 1,665 - 811.54 = 1,573.46`. The 58.55 overrun remains in the reserve and
reduces the result. Remaining household needs are `0 + 85.80 + 81.25 = 167.05`.
The transaction evidence, Bills-only balance and published scope remain intact.

## Interaction and visual evidence

Today info opens the complete current-position evidence. Back/Escape restores
the exact info or next-payday trigger. Period info holds the dated current-cash
proposal and explanation separately from the full-period result; Escape closes
it and restores its summary. The existing bill, income, household, savings and
transaction disclosures remain intact. Focused evidence controls scroll clear
of the mobile dock. Optional motion respects reduced-motion preferences.

| Width | Default overview | Funding detail on demand |
|---|---|---|
| 1440px | [Overview](current-1440.png) | [Detail](today-details-1440.png) |
| 390px | [Overview](current-390.png) | [Detail](today-details-390.png) |
| 320px | [Overview](current-320.png) | [Detail](today-details-320.png) |

Actual approved-reference comparisons for the compact period card:
[1440px](comparison-1440.png), [390px](comparison-390.png),
[320px](comparison-320.png). Remaining header/navigation differences remain
visible in the full overview captures and are not claimed complete.
Comparison crops hide the fixed Pages dock to show the complete card, matching
the reference crop. Full runtime captures keep the actual navigation. Browser
checks prove keyboard-focused period rows scroll clear of the real dock.
Additional narrow-mobile proof: [unknown assignments](withheld-320.png),
[negative spending account](negative-spending-320.png),
[observed grocery overrun](overspending-320.png).
Inherited signed-state proof with the compact styling:
[deficit](deficit-320.png), [signed overflow](overflow-320.png),
[known zero income](zero-income-320.png).

The captures load production `index.html`, App.boot, Forecast and the active
Budget renderer. All requests are intercepted with independent invented data;
external traffic is aborted. Active financial-contract and actual-browser
checks cover 1440/390/320px, signed deficits, overflow, zero income, missing
evidence, exact trigger focus return and the independently reconciled overrun.
The 320px money column accommodates the inline estimate marker even for large
signed amounts. Every row keeps the same chart origin and width.

## Remaining differences

The full visual target is incomplete. The existing finite checklist in
[the preceding slice](../budget-v3-period-hierarchy/README.md) still governs
closure:

1. Move header/period selection above the overview, and implement the approved
   day progress and Overview/Spending/Bills/Upcoming costs navigation.
2. Complete the unified Today/next-payday funding presentation using the shared
   publications and preserve scope/trust for all shortfall and withheld states.
   Resolve the default required-carryover publication seam without reassigning
   the pooled current-protection amount to the Bills-only balance.
3. Add Worth a look, real category bars and grouped bill drilldowns.
4. Replace native inline evidence with the shared accessible detail-sheet shell
   only after financial/evidence parity and focus-trap/restoration proof.
5. Finish Month layout/navigation, trust vocabulary and dark/mobile polish,
   comparing actual screenshots side by side with #480.

No demo toggle or mockup sample figures become production controls or data.
Configured starting savings assignments remain unconfirmed.
