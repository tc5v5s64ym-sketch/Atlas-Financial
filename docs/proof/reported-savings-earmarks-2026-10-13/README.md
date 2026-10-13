# Reported savings earmarks — synthetic proof

All figures and account labels in this folder are invented. No owner screenshot,
provider payload, credential, or private financial reconciliation is included.

`proof.json` records 20 successful real App.boot / observer-to-browser cases from
clean code commit `c940030c336d09665de21a7ae726a80512eda9fe`, based on released main
`e29adebc5811ccbe108f4213441dd0fdb9de386b`. It binds exact checkout bytes to Git
blobs, including Forecast, live-plan and provider-observe. This proof refresh commit
changes only this folder; a final-head rerun is recorded separately in the PR card.

- `audit-D1-320-dark.png`: mobile current reported Saved remains known despite
  the invented older unpaired savings withdrawal.
- `audit-D1-1440-light.png`: the same defect case on desktop.
- `audit-truncated-390-light.png`: valid current reports survive incomplete
  movement history while native backing and new contributions remain held.
- `cutoff-double-count-390-light.png`: a proven inter-reserve snapshot overlap
  retains the reported total but withholds Saved.
- `stale-both-390-refreshed.png`: two real Manual Refresh operations replace the
  reported pot rather than accumulating it.

The integrated code also passes the independent 88-case source-sum/allocation and review-boundary
matrix and all 36 affected suites. The D1 fixture fails on exact released main
after asserting that its reported total is known. Synthetic Edge proof is not
signed-in physical Safari acceptance. Full exact-head CI and independent Systems
Review remain required before release.

Bounded review repairs after Root BLOCK5510762437:

- Historical, next and future selected-period Inventory now print Unknown stock
  and omit today's reported sum and balance dates. The native Budget Accounts &
  evidence tile payload is exercised; current reports remain visible.
- The overlap hold requires explicit complete posted/pending coverage with no
  contradictory status or pagination flags, plus coherent source window bounds.
  The incumbent generic coverage helpers and native backing gates are unchanged.
- New regressions run on exact reviewed b4ec7b34 before repair: 34 cases,
  21 failures and 13 passing controls. All 88 cases pass on repaired code.
  Invalid coverage retains source reportedStock200 and chronological earmarks;
  qualified complete overlap controls still withhold Saved.
