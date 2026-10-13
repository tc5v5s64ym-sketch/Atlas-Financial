# Reported savings earmarks — synthetic proof

All figures and account labels in this folder are invented. No owner screenshot,
provider payload, credential, or private financial reconciliation is included.

`proof.json` records 20 successful real App.boot / observer-to-browser cases from
clean code commit `43b047b6a3731704b3ba1e31b6f0064f326572e0`, based on released main
`e29adebc5811ccbe108f4213441dd0fdb9de386b`. It binds exact checkout bytes to Git
blobs, including Forecast, live-plan and provider-observe. This artifact commit
adds only this folder; a final-head rerun is recorded separately in the PR card.

- `audit-D1-320-dark.png`: mobile current reported Saved remains known despite
  the invented older unpaired savings withdrawal.
- `audit-D1-1440-light.png`: the same defect case on desktop.
- `audit-truncated-390-light.png`: valid current reports survive incomplete
  movement history while native backing and new contributions remain held.
- `cutoff-double-count-390-light.png`: a proven inter-reserve snapshot overlap
  retains the reported total but withholds Saved.
- `stale-both-390-refreshed.png`: two real Manual Refresh operations replace the
  reported pot rather than accumulating it.

The integrated code also passes the independent 54-case source-sum/allocation
matrix and all 36 affected suites. The D1 fixture fails on exact released main
after asserting that its reported total is known. Synthetic Edge proof is not
signed-in physical Safari acceptance. Full exact-head CI and independent Systems
Review remain required before release.
