# Live closed-loop acceptance — 2026-08-25 (AF-REFRESH-07)

This is a **gate-stop record**, not a trusted household live proof. Atlas
Contract / Systems Review blocked the earlier display-name reconstruction as
a bypass of the incumbent account-map authority. This repair stops at that
gate. Campaign scaffolding stays. No successor campaign.

Raw provider JSON, the access token, real Lunch Money account IDs, and real
provider transaction IDs stay out of git.

## Current-state gate

Checked on current `main` `1e89f2def7b078cf1b94a884e25ec6eb2f2c2254`
before the original live attempt, and re-checked in this repair environment.

**Source.** Explicit owner instruction: execute AF-REFRESH-07 — live
closed-loop acceptance and cleanup.

**Verdict.** STOPPED — the trusted live account map is missing.

**Evidence.**

| Transport | Present |
|---|---|
| Lunch Money GET-only credential | yes |
| Owner-supplied production account-map secret | no |
| gitignored owner-observed `docs/connectivity/provider-account-map.local.json` | no |

Live mapping is by `providerAccountId`, never the display name. Production
uses the owner-supplied map secret. The local file is owner-observed IDs.
Display names remain labels only. Reconstructing a map from Lunch Money
labels is not that authority.

`--live` now fails closed **before any provider GET** when that map is
missing. The CLI names the incumbent transports and refuses display-name
reconstruction.

## What this does not claim

The earlier in-memory overlay, settlement counts, `previewId`, and Forecast
cents depended on a reconstructed display-name map. Internal arithmetic on
that run cannot be promoted to trusted household acceptance. Those cents are
not restated here.

Canonical `data.json` remains the 2026-08-19 opening. No `--apply`. No
`--approve-opening`. Posted `previewId` cannot authorize pending or an
opening. A newer canonical opening remains an owner-reserved
`--approve-opening <openingApprovalId>` approval.

## What remains

- Fixture composition of the closed-loop packet in
  `scripts/refresh-loop-acceptance.js` (not a live household proof).
- Incumbent observer, reconciler, preview/approve, live overlay, operating
  answer, and refresh-trust seams.
- `docs/AF_REFRESH_TRUSTED_STATE_LOOP_PLAN.md` — AF-REFRESH stays active.
- The same AF-REFRESH-07 live acceptance, once the owner supplies the
  incumbent provider-ID map through one of the two transports above.

## Security acceptance

| Bound | Result |
|---|---|
| Provider / FI write | none — observer remains HTTP GET only; this repair issued no live GET |
| Unattended canonical write | none — no `--apply` |
| Scheduled / background refresh | none |
| Secret / raw identifier publication | none in this document |
| Credit as cash | not re-evaluated from untrusted mapping |
| Display-name map reconstruction | refused |

Unverified is not unpaid. Any newer canonical opening remains an
owner-reserved `--approve-opening <openingApprovalId>` approval.
