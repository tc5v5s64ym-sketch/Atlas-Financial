# Fuel budget owner instruction — 2026-10-10

Dale explicitly instructed: “Just increase it to 555 starting with this pay
period.” The delegated instruction identifies CAD $555 per Seaspan pay period,
effective October 9–22, 2026 and every later period, preserving earlier periods.
This is an owner-approved planning target, not observed spending or an
institution-verified charge.

The runtime home is `data.json` → `plan.budget.categories[id=fuel]`:
`plannedPayday`, `targetEffectiveFrom`, and bounded `targetHistory`. The previous
CAD $325 payday amount remains the policy through October 8, 2026. The monthly
equivalent remains derived; no second stored monthly fuel amount is added.

Forecast consumes that one input to calculate Household Budget holds, remaining
capacity and Balance After Deductions. It uses each period's start when selecting
the target, and each payday when a named span crosses the boundary. The increase
is CAD $230 per affected pay period. Actual spending still fulfills the existing
`max(planned, actual)` hold; it is not added to the target a second time.

All other category budgets, historical spending aggregates, openings, snapshots,
bills and transaction membership are preserved. No Lunch Money transaction or
rule is edited. The separately built streaming-bill PR overlaps `data.json` but
owns bill rows, not this fuel category; neither builder's patch is copied onto
the other's branch.

Proof: `node test/test-fuel-effective-target.js` exercises synthetic independent
amounts before October 9, in October 9–22, and in later periods, plus current
cash/action publications, overspend, historical disclosure, and named spans
crossing the effective date. Separate assertions prove the authorized canonical
$555 input reaches the household publication. Full figure comparisons are
recorded on the draft PR against its exact base revision.
