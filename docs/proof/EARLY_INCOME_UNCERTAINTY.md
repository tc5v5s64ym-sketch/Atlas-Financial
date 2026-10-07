# Posted income before its nominal occurrence

## Current-state verification

Source: owner-authorized narrow correctness fix, delegated 2026-10-07 after
independent verification of the early-income audit. Verdict: **STILL BROKEN**
on main `b69dfa4f5929b2ad628ec592101475bd554c4cc6` before editing.
The only open implementation PR was #525, owning minimum-category confirmation.
This outcome does not alter that policy or the separate minimum-reversal question.

Independent invented posted ledgers through observation, live overlay and
Forecast reproduced two excess cash projections:

| Observation and nominal date | Actual cash including one receipt | Correct closing | Before repair |
| --- | ---: | ---: | ---: |
| Amanda receipt and paired Bills transfer Oct 30; nominal Oct 31 | 2800.25 | 2800.25 | 4600.50 |
| Payroll receipt Dec 31; nominal Jan 1 | 3500.00 | 3500.00 | 6000.00 |

Every row was posted CAD on or before its observation. These are scenarios,
not assertions about actual future employer posting. Correctly bracketed Amanda,
same-day payroll and unpaid future-payroll controls close on the independently
calculated correct balance. Existing future represented/held entries cannot
suppress early income under their incumbent contracts.

## One outcome

Already observed, qualified income must not assure additional future cash when
its nominal occurrence remains unresolved. Observed balances and schedules
survive; dependent cash/spending publications become unavailable with one
Forecast-owned reason. The repaired cases do not publish either the doubled
cash balance or a made-up zero/corrected balance. They remain unknown.

The read-only observer emits sanitized uncertainty, not settlement. Its window
is complete, current native provider coverage after the preceding scheduled
income occurrence, up to the observation date. The next native occurrence within
Forecast's existing knowledge horizon identifies a potentially overlapping
claim. Both Amanda slots share the employer receipt interval. This does not
associate a receipt with that occurrence as financial truth. There is no new
holiday, earlier-business-day, lookahead-days or net-pay policy.

Qualification reuses existing identity predicates: payroll employer identity,
household Bills account and credit direction; or native employer income in the
mapped external source, same-source transfer debit, and same-date opposite Bills
credit with exact packet amounts. All evidence must be posted native CAD,
inside coverage, and noncontradictory. Evidence consumed by supported settlement
cannot be borrowed. Competing otherwise-qualified legs also withhold claims,
without earning a represented event. Generic amounts, transfers, coaching and
external balances are insufficient.

`plan.opening.incomeReconciliation` is transient, qualified to that opening and
absent on ordinary conflict-free overlays. Same-date/later refreshes preserve
unresolved future evidence until its native date is reached; a vanished row is
not proof of an additional receipt. Existing same-day guards then own that day's
cash treatment. This marker never changes canonical income, owner assignments,
balances or provider data and is not a new financial store.

Forecast owns publication withholding. API projectors and the active Budget
renderer print its reason. The Budget unavailable surface retains the native
known posted Bills balance and its date instead of mislabelling fresh stock as
an old dated opening. Scheduled facts, original amounts, debts and evidence are
retained. Automatic early settlement remains a separate owner-policy question.

## Independent proof and checks

`test/test-early-income-uncertainty.js` uses only
`test/fixtures/early-income-data.js`, with invented accounts, employers, dates
and amounts. It traverses the native observer, live overlay, Forecast cash walk,
recommendation, actual assistant projector and full active Budget script.
Hand arithmetic supplies the cash expectations. It covers correct same-day,
bracketed and unpaid controls, untransferred source income, absent Bills credit,
wrong merchant/account/role/identity, mismatched packet amounts, variable net pay,
zero/debit payroll, native/foreign units, pending/contradictory rows, future or
stale ledger dates, incomplete coverage, competing packet legs, advancing and
same-date refreshes, unchanged owner policy and sanitized publications.

Required final-head validation: the focused suite, Forecast and financial
authority coverage, complete `npm test` in a separate disposable checkout,
privacy hook, native canonical-source figure conservation and actual synthetic
desktop/mobile/320px Budget rendering. Exact results belong in the PR merge card;
this document does not predeclare unrun checks green.

No production fixture, raw ledger, provider credential, configuration write,
employer calendar assignment or minimum-reversal treatment is introduced.
