# Bills header recorded payments

Owner source: “lets fix it”, 2026-10-07 16:41 UTC, after the recorded
minimum-payment omission was explained. Baseline main:
`0d93adb47b8c9b9ac7074e0faab2a6bb20cd91ec`.

Incumbent: Forecast's `budgetPeriodProgress` publication, consumed by the
active Budget overview Bills row and Bills card. `cardMinimumState` remains
the sole validator of native minimum payment posting, intent, identity and
cycle. Native bill rows intentionally retain `actual: null`; their separate
`cashPaid` evidence must not be mistaken for the scheduled minimum or a
second debt/cash deduction.

This change adds validated native money sent to the recorded Bills numerator
once per selected scheduled occurrence. It preserves the original planned
denominator, including a smaller minimum than the amount sent. The header is
recorded settlements and minimum money sent toward selected scheduled bills;
it is not all bank outflows in the period. Its existing Info renders this
scope and the separation from lender confirmation and cash-opening inclusion.

Unknown lender or cash-inclusion confirmation retains known posted money
with partial evidence. Pending, withdrawn, conflicting or wrong-purpose
allocations do not become money sent. No later payment rewrites a completed
period at its boundary. The existing bounded coverage, future-period and
operating-unavailable guards continue to withhold actuals. Category-derived
confirmation and reversal withdrawal remain owned by their existing protocol.
Independent owner confirmation is not silently replaced by inferred provider
allocation or netted against an unrelated credit.

## Independent proof

All amounts below are invented. One recorded bill is 139.73. Original
requirements are 40.05 + 70.07 + 20.09; corresponding posted sends are
67.43 + 81.29 + 29.17. Therefore:

- Original scheduled plan: 139.73 + 40.05 + 70.07 + 20.09 = **269.94**.
- Recorded payments: 139.73 + 67.43 + 81.29 + 29.17 = **317.62**.
- Baseline incorrectly publishes **139.73**, omitting the three native sends.

`node test/test-bills-header-payments.js` has 113 assertions covering these
independent cents, overpayment, partial sends, legacy/display double-count
attempts, split allocations, native debit reuse, purpose, pending/withdrawn
evidence, issuer/cash inclusion uncertainty, moved due dates, wrong cycles,
coverage, future/history and immutable inputs.

`node test/test-card-minimum-category.js` exercises the real provider
observation -> Live -> Forecast category confirmation boundary, including
the header amount and withdrawal after posted reversal evidence.

The optional browser companion is `test/browser-bills-header-payments.js`.
With externally provisioned Playwright and a Chromium/Edge executable:

```sh
NODE_PATH=<playwright-node-modules> CHROME_PATH=<browser> \
ATLAS_BUDGET_SCREENSHOTS_DIR=<evidence-directory> \
node test/browser-bills-header-payments.js
```

It runs actual App.boot with all requests intercepted and invented data at
1440, 390 and 320 pixels. Complete, pending, issuer-unknown and truncated
coverage states reconcile the overview, Bills card and native Info. Keyboard
opening/dismissal restores the exact trigger; repeat actions, period/month
return and resizing preserve the published numbers. Screenshots and a
synthetic provenance manifest are generated outside version control. The
full required deterministic command remains `npm test`.

An independent pinned-main comparison also verifies the entire Forecast
recommendation in eight evidence variants after removing only the changed
Bills progress actual and explanatory semantics. All other publications,
including original requirements, row settlement, cash/debt walks, deductions,
remaining fields, holds and funding proposals, are identical.

## Limits

This is a header publication repair. It creates no minimum-allocation policy,
fee classification, provider write, canonical input change or renderer
arithmetic. It does not calculate remaining bills as plan minus recorded
money. Live coverage can still withhold the header; no live visual acceptance
is claimed. Independent Atlas Contract / Systems Review is required before
merge because a household-facing figure changes.
