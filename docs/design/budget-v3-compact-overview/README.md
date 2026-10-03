# Budget v3: compact Current balance and evidence

Unpublished next-slice checkpoint on `agent/budget-v3-today-cash`. It currently
starts at the original #485 slice, `e5316191d869c01bc06e6129a9faacd709ce6ea6`.
The parent must confirm #485 has merged before this branch rebases onto fresh
main and publishes a draft PR. The final signed/zero-income repairs from #485
must be inherited and verified during that rebase; this checkpoint does not
claim the older base is a final merge candidate. No writes to #485 accompany
this work.

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

The independent observation/overlay fixture publishes Bills cash 1,215,
spending cash 160, remaining bills 265, and remaining household
`(450 - 308.55) + (160 - 74.20) + (120 - 38.75) = 308.50`.
Required operating cash is `265 + 308.50 + 300 = 873.50`; funding capacity is
`1,375 - 873.50 = 501.50`. The proposal is published as 0, separately from
capacity. A second invented observation has spending cash -50 and savings
8,000: Current balance remains 1,215 while household transactions and remaining
needs stay present. Nothing is copied or scaled from the real household.

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

The captures load production `index.html`, App.boot, Forecast and the active
Budget renderer. All requests are intercepted with independent invented data;
external traffic is aborted. Active financial-contract and actual-browser
checks pass for this checkpoint at 1440/390/320px. Final exact-head suites and
new captures remain required after rebasing onto the merged #485 main.

## Remaining differences

The full visual target is incomplete. The existing finite checklist in
[the preceding slice](../budget-v3-period-hierarchy/README.md) still governs
closure:

1. Inherit and verify the final signed waterfall repair after fresh-main rebase.
2. Move header/period selection above the overview, and implement the approved
   day progress and Overview/Spending/Bills/Upcoming costs navigation.
3. Complete the unified Today/next-payday funding presentation using the shared
   publications and preserve scope/trust for all shortfall and withheld states.
4. Add Worth a look, real category bars and grouped bill drilldowns.
5. Replace native inline evidence with the shared accessible detail-sheet shell
   only after financial/evidence parity and focus-trap/restoration proof.
6. Finish Month layout/navigation, trust vocabulary and dark/mobile polish,
   comparing actual screenshots side by side with #480.

No demo toggle or mockup sample figures become production controls or data.
Configured starting savings assignments remain unconfirmed.
