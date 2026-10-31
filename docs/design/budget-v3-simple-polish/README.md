# Budget simple detail polish

Owner's latest simplicity direction is the target for this bounded follow-up to
#494. Extra default cards, a new funding sidebar, roster counts and shortfall
legends are not prerequisites for finishing this scope.

The spending card keeps its actual/original-plan amounts and moves the separate
reserve explanation into Household Info. Its unchanged native total, categories,
transaction evidence and progress publication remain in the same evidence node.
The reserve rule is explicitly labeled there, rather than explaining a different
quantity underneath the actual headline.

Detail spacing and typography are scoped to the existing modal. No evidence node,
warning, source, trust state, amount or disclosure is hidden or reconstructed.
Mobile Month adds one quiet Result / In & out / Costs this month shortcut row;
desktop does not show it. Enter moves focus to the chosen heading. A refresh
restores that heading and its location marker. Existing month/period selection,
modal close and exact return focus are retained.

There is one active renderer. Forecast publications, financial selectors,
settlement, observer, allocations, deductions, canonical amounts and baseline
assignments are unchanged. Protected cash, focus-debt extras, truly unassigned
cash and warnings remain accessible through the incumbent dated funding evidence.
No Bills-only carryover is invented. Missing period receipts and original-plan
snapshots remain unavailable / Not confirmed.

All captures use an independent invented fixture, with network interception.
Main before-images are from merge `6b8a050d50183e0941558584808d068b1f933b2a`.
The exact candidate head and final test/hash results belong in the PR; screenshots
alone are not a passing-head claim. The original #480 pixels remain a reference,
with the later single-flow and simplicity directions taking precedence.

| View | Desktop | 320px |
|---|---|---|
| Default Budget | [Page](current-1440.png) | [Page](current-320.png) |
| Household Info | [Sheet](reserve-info-1440.png) | [Sheet](reserve-info-320.png) |
| Individual category | - | [Sheet](category-320.png) |
| Bill and unavailable payment evidence | - | [Sheet](bill-320.png) |
| Quiet Month shortcuts | - | [Month](month-320.png) |
| Main beside compact Info | [Comparison](comparison-reserve-info-1440.png) | [Comparison](comparison-reserve-info-320.png) |
| Main beside Month | - | [Comparison](comparison-month-320.png) |

No additional necessary functional gap was found in the scoped core flow. A
future confirmed savings status still needs a Forecast-owned dated receipt and
original-requirement snapshot; the absent confirmation is not a reason to invent
funding or change a starting assignment.
