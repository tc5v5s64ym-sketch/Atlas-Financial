# Production read-only Lunch Money access — owner pass 2026-08-23

Owner decision: **authorize Atlas production to use Lunch Money READ-ONLY,
on demand, to produce the live household plan.**

This records permission to configure the deployed website to invoke the
incumbent live overlay (`scripts/live-plan.js` / `scripts/provider-observe.js`)
when an authenticated household opens or refreshes Atlas. It does **not**
authorize unattended canonical writes, scheduled refresh, or writing anything
to Lunch Money.

Exact `main` at the decision: `71c068edd9bfa5711e73006b883db219193cfcc9`
(PR #163 merged). No open pull requests at that head.

## What passed

- Production may hold a Lunch Money GET-only token as a Render environment
  secret named `LUNCHMONEY_ACCESS_TOKEN`.
- Production may hold the existing `atlas-provider-account-map/v1` schema as a
  Render environment secret named `ATLAS_PROVIDER_ACCOUNT_MAP_JSON`. Real
  provider account IDs stay out of git.
- `ATLAS_LIVE_OVERLAY=live` may be set on the deployed service so
  authenticated `GET /data.json` uses the incumbent observation →
  reconcile → in-memory overlay → Forecast path.
- Fail-closed remains mandatory: untrusted live evidence serves the dated
  canonical opening and says so.

## What this does not authorize

- writing anything to Lunch Money
- unattended canonical writes
- automatically editing `data.json`
- automatically advancing the canonical opening
- polling, cron, or scheduled jobs
- storing raw transaction history
- exposing provider credentials or account IDs to the browser
- changing Forecast authority
- inventing settlement or categorization
- institution usernames, passwords, PINs, OTP, or security answers
- money movement or any institution action

Official Lunch Money tokens are not provider-scoped read-only. Atlas usage
remains GET-only.

## Owner Render step after merge

The secret values are never stored in git. After merge, the owner sets them
directly in Render → household-finances → Environment. This document names
the variables; it does not hold the values.
