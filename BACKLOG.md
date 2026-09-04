# Backlog

**Work that can be done.** Questions only the household can answer live in
`docs/01_OPEN_QUESTIONS.md` — keep the two apart. If an item needs a human to
*know* something, it is a question. If it needs someone to *do* something, it
belongs here.

Status: `READY` — nothing blocking · `BLOCKED` — waiting on the household ·
`QUEUED` — waiting on earlier work · `IN PROGRESS` — first slice landed, item
not closed

Last reviewed **2026-08-17**. Phase: **analysis** — capture is essentially done.
Lunch Money is the normal operational update feed; file capture is fallback.

**Owner-provided 2026-09-03 card-charge evidence** (pasted 2026-09-03).
Filed in
[`docs/source_intake/HOUSEHOLD_CARD_CHARGE_EVIDENCE_2026-09-03.md`](docs/source_intake/HOUSEHOLD_CARD_CHARGE_EVIDENCE_2026-09-03.md).
Coverage is ~7 months (2026-02-02 → 2026-09-03), not 18–24. Discovery is
not authorization: Phoenix, Mailchimp, Calendly, AICHATAPP, Amazon Prime,
Shopify, card interest, and repeating shopping were **not** added to
`plan.bills`. Candidate promotion is a later owner-confirmed one-outcome
PR, not a silent follow-on from this filing.

**Owner-instructed recurring card-charge audit** (2026-09-03). Discovery
only: `scripts/recurring-audit.js` inspects mapped revolving-credit Lunch
Money history and reports repeating merchants. It does not create or
promote Forecast bills. Phoenix / Amazon household conclusions require a
live GET-only run; synthetic tests are not household evidence.

**Follow-ups from the 2026-08-16 evidence pack** (not mixed into that
facts PR; each needs its own independently provable outcome):

- **Noble quarterly expander** — **DONE.** Forecast `occurrences()` expands `frequency: quarterly`. Canonical `noble-garbage` is the one quarterly row.

- **HELOC residual PAD** — **DONE 2026-08-18.** Q19 ANSWERED: the Aug. 14 $1,100 payment satisfies the $814.18 August minimum. Do not invent a duplicate August cash minimum.

- **Historical Telus in the telecom remainder** — **CLOSED 2026-08-18.**
  TELUS IS CLOSED. Future Telus cost is $0. Historical Telus spending remains in the record; the remainder-split planning blocker is removed.

- **Bell baseline vs card-paid current bill** — **DONE.** Forward Bell is the dated $121.00/month card-paid planning row on the 15th (`plan.bills` `bell`, Travel Visa reserved gravity). Q18 stays OPEN for settlement state.

- **Unresolved once cash obligations across a later Forecast start** —
  owner instruction 2026-08-18. A known unresolved cash obligation still
  on the plan must remain binding when Forecast start advances past the
  placeholder date used to reserve it. Advancing as-of is not settlement.
  Not a new backlog number; not the first production cutover.

**Critical path** is owned by
[`docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md`](docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md),
not by this file. Forecast-critical work through `B96`, plus `B20`, `B21`,
`B78`, `B79`, `B80`, and `B81`, is **done**. Unattended production writes,
scheduled refresh, and a newer live substitute opening remain reserved. A
production Lunch Money token is authorized for on-demand GET-only
observation (2026-08-23), not for canonical writes. Do **not**
wait for a second month of routine statement files. Provider-completeness,
broad historical forensics, old categorisation cleanup, and file-statement
backfill are not critical-path gates unless they expose a demonstrated
material source or financial-correctness gap.

**Operational knowledge lives in `docs/ACCOUNT_FACTS.md`**, not here: how each
institution's data is obtained, the download endpoints, and the traps that cost
time (TD's dead download button, MBNA's mirrored signs, the browser pane needing
to be visible, merchant strings needing normalising before matching).

---

## 🔴 The two that undercut everything else

**B70 · The HELOC limit is a planning boundary: $0 headroom means $0 additional borrowing** · **DONE / RESOLVED 2026-08-18** · *owner planning invariant; engine already held it*

HELOC available credit is borrowing capacity, never household cash or safe-to-spend. Unapproved borrowing cannot repair an otherwise-infeasible plan. Direct regression proofs live in `test-master-forecast.js` and `test-opening-gap-no-auto-borrow.js`. 2026-08-21 live overlay confirmation: [`docs/connectivity/LIVE_ACCEPTANCE_2026-08-21_NO_AUTO_BORROW.md`](docs/connectivity/LIVE_ACCEPTANCE_2026-08-21_NO_AUTO_BORROW.md).

**B71 · Triangle Mastercard limit risk on the published 2026-08-19 opening** · **REOPENED 2026-08-21** · *Forecast.projectDebts crosses $13,500 on day 0; 2026-08-16 under-limit result retired*

**Reopened, not an engine defect.** The 2026-08-18 resolution was that
Triangle **remains under** the $13,500 limit on the then-canonical B91
2026-08-16 opening (`firstOver` null). The published opening is now
2026-08-19. `Forecast.projectDebts` on that opening returns a Triangle
crossing on **2026-08-19 at day 0**. Forecast and the Plan page already
publish that crossing; this entry was the stale copy. B71 is a live
recorded risk until a later opening or payment changes the deterministic
result. No Forecast, `data.json`, or Plan-page change is required.

**KNOWN.** Canonical 2026-08-19 opening in `data.json`: posted
**$13,495.32** + pending **$0.00** = exposure **$13,495.32** against a
**$13,500.00** limit. Headroom **$4.68**. `Forecast.utilisation` reports
available **$4.68**, **99.97%** used, `overLimit` false at the opening
mark (the walk is under at the snapshot; interest takes it over the
same calendar day). Purchase APR **21.99%** / cash **22.99%**. Next
modelled minimum **$253.57**, `firstDue` **2026-09-07**, confidence
**estimated**. That headroom is **credit, not household cash**. B70
remains the planning boundary: it never increases safe-to-spend; $0
headroom would mean $0 additional borrowing capacity.

The 2026-08-16 opening — posted $13,197.00 + pending $15.62 = exposure
$13,212.62, headroom $287.38; `projectDebts` `firstOver` null; peak
$13,388.86 on 2026-09-06 ($111.14 of headroom); 91-day ending $13,178.74;
Aug. 10 $300 already inside that posted (independent identity:
13,497.00 − 300.00 = 13,197.00) — is retired dated evidence, not current
truth.

The 2026-08-09 opening — posted $13,497.00, $3.00 of headroom, day-90
$227.71 over-limit projection — is also retired evidence, not current
truth.

**Deterministic Forecast result (current 2026-08-19 plan; no invented purchases).**
On both the 91-day view and the 365-day knowledge horizon,
`projectDebts` reports Triangle `firstOver` **2026-08-19**, `day` **0**,
`alreadyOver` **false**. Opening used is under the limit; same-day
interest takes it over. 91-day ending balance **$13,475.95**. An
independent daily ledger — opening posted+pending, 21.99%/365 interest,
modelled 7th-of-month payments from `firstDue` — agrees with Forecast to
the cent: day-0 interest **$8.13** lifts the balance to **$13,503.45**;
peak modelled exposure is **$13,650.64 on 2026-09-06**, the day before
the first modelled $253.57 payment ($150.64 over). `Forecast.planPhases`
already emits `facilityCrossing` for Triangle on 2026-08-19;
`public/plan.js` renders that risk. The 2026-08-18 claim that the card
**remains under** the limit is **not** current and is retired with the
16 August opening.

**RISK.** Interest consumes the remaining headroom (~$8/day at this
balance; roughly $243/month against the estimated $253.57 minimum). Thin
room before the September payment is real: on this opening it is already
the day-0 crossing. Additional real-world purchases are not on the
deterministic path and Atlas does not invent them; they could produce a
worse result.

**UNKNOWN.** Issuer-specific over-limit treatment or fee. No Triangle
over-limit fee is observed in available committed evidence. That is not
a finding that Canadian Tire Bank charges none, and it is not modelled
as $0. The evidenced $29 over-limit fee belongs to the TD Cash Back Visa,
not Triangle.

**B63 · Where do the coach payments leave from?** · BLOCKED · *small*

Coaching money is **pass-through**: a remitter sends it, coaches are paid out of
it, the household keeps the margin. Her sheets put the coach share at **27.7%**.

But the 30 June remittance of **$9,646.25 went onto the HELOC the same day**, in
full, and **no coach payments appear in either mailbox**. Three readings:

1. She pays from an account not yet captured — most likely, see B64
2. Coaches were paid earlier or on a lag
3. They have not been paid from this money — an **unrecorded liability**, spent
   on a facility that does not amortise

**Partly answered:** **one coach is paid by cheque** from DEBT&PAYMENTS
(owner-stated) — $8,150 across five cheques, Feb–Nov 2025. So coach payments were
never going to appear as e-transfers, and the mailbox search was looking for the
wrong instrument.

**But the cheques stop in November 2025**, while her sheets show $6,397.50 of
coach pay between April and August 2026. **The 2026 route is still unidentified**
— most likely the account in B64.

**Partly answered again, 9 Aug 2026.** Recovering the deleted Interac
notifications produced a payment that had been invisible: **$2,160.00 on 6 July
to a named individual**, out of SAVINGS-DONT TOUCH, **four days after the
$9,646.25 remittance landed there** — 22.4% of it, against the 27.7% coach share
her sheets imply. A second, **$1,064.92**, went to another named individual on
5 August. **So the "unrecorded liability" worry is substantially reduced**: the
pass-through money was not simply absorbed by the HELOC.

What is still open is the rest of the route. This is one payment out of one
remittance, and the earlier conclusion that no coach payment existed was wrong
only because the evidence was in the bin — which is a reason to fix **B66**
before the next remittance rather than after it.

**Second lead:** a **Payworks** pay-statement notice, 29 Jun 2026. If the coaching
business runs payroll, the rest of the coaches are paid through it.

**The liability worry is softened but not closed.** Coaches are demonstrably paid;
what is unproven is whether the 30 June remittance was passed on before the
$9,646.25 went onto the HELOC.

**B64 · Amanda's other account** · BLOCKED · *small*

**Confirmed to exist by elimination**: $186.16 arrived in Chequing A on 14 Jul
2026 and **no $186.16 left any of the six captured accounts** that week. Interac
names only the receiving bank, never the sender, so the notification cannot
identify it. Her mailbox shows no other bank since **CIBC in 2019**.

Routes, cheapest first: **ask her** · check whether the old CIBC account is still
open · **pull a credit report**, which lists every open account and is definitive.

Prime candidate for where coach payments leave from, and for one of the **two
unidentified accounts** ($59,027) — the larger sent $33,598 across **142**
transfers, a frequency that fits paying a roster far better than anything else
considered.

---

## Blocked on the household

**B70 · Agree a standing transfer from Amanda's account** · **CLOSED 2026-08-22** · *small, high value*
Owner-confirmed 2026-08-22: the two fixed Tennis BC salaries land in
household accounts and are already Forecast household income. Coaching
surplus is transferred only after coaches/business obligations are paid
and is not a base-plan transfer. The live `$1,100` standing-transfer
action is retired. Do not put a fixed Amanda-transfer instruction back on
`plan.actions`. Historical ad-hoc crossings remain dated evidence; Q25
stays OPEN only for the coaching/business remainder.

**B13 · Business records — revenue and cost of goods** · *large*
Owner-stated 2026-08-29: no shop/resale/inventory business; seasonal coaching
leftover is gravy, not Forecast income. Historical receipts vs coach pay vs
HELOC-funded outbound remains Q1 OPEN. Do not invent a margin or split. Do
not treat planning settlement as a Q1 close. Dental-lab rent ended (see Q5).

**B56 · Separate the two businesses** · *medium*

The 2026-08-09 split still stands as dated evidence: parents' dental lab
(garage rent to May 2026) versus Amanda's seasonal coaching. Owner-stated
2026-08-29: coaching is not a resale/inventory shop; leftover is gravy, not
a Forecast income line. Historical coaching net remains Q1 OPEN.

| | Whose | What |
|---|---|---|
| **Dental lab** | her parents' | in the garage; paid rent to May 2026; "not going well" |
| **Coaching** | Amanda's | remitted in bulk; coaches paid out of it |

Business costs sit on household cards — `Head Canada Inc.` $1,043.37 is a
coaching expense Amanda absorbs personally (owner-confirmed), and the Travel Visa
mixes household, holiday and business on one card.

**B57 · The garage rent — is it coming back?** · *small*
$1,000–1,100/month from Mar 2025, stopped May 2026. **$12,600/year gone**, and
because it was misfiled as an internal transfer its loss never registered as an
income event. **Business use of the home** may affect insurance and creates both
a possible deduction and a capital-gains exposure — an accountant's question, and
they have one.

**B58 · The five cheques — $8,150** · **LARGELY ANSWERED 2026-08-09**
**Amanda pays a coach by cheque** (owner-stated). That fits: **all five were
written from DEBT&PAYMENTS**, her account, not the joint one.

| Date | Amount |
|---|---|
| 18 Feb 2025 | $980.00 |
| 15 Jul 2025 | **$3,010.00** |
| 9 Sep 2025 | **$2,835.00** |
| 27 Oct 2025 | $30.00 |
| 19 Nov 2025 | $1,295.00 |

The three large ones are term-sized at a $35/hour coach rate — $3,010 is 86
hours, $2,835 is 81. The $30 is something else.

**But they stop in November 2025.** There is not a single cheque in 2026, while
her tracking sheets show coaches being paid **$6,397.50 between April and August
2026**. So the cheque route was replaced — which points hard at **B64**, the
account outside the captured set.

**Still worth TD's cheque images** to confirm the payee, but the mechanism is no
longer a mystery.

**Also found: a `CHQ RETURN FEE` of $2.00 every month on DEBT&PAYMENTS**, 18 of
18 months, including months with no cheque written. **$24/year for a service that
went unused after November 2025.** Add to the fees dashboard (B30) and to the
account-plan review (B24).

**B59 · Coinbase** · *small*
Owner no longer uses it; recorded as dormant and excluded from net worth.
**Dormant is not empty** and the account is still open — statements were issued
as at June 2026. One look at the balance closes it permanently.

**B60 · Phishing against the Coinbase account** · **owner action** · *small*
Two emails from `info@afius.org` styled as Coinbase, 24 May and 11 Jun 2025,
**both carrying the identical code 523469** — a real one-time code never repeats.
Being unused makes the risk worse, not better: nobody is watching it. Closing the
account is the clean fix; otherwise a unique password and app-based 2FA.

**B27 · RESP holdings** · *small*
Balance $31,555.85 known; holdings, book value and contribution room are not.
Access needs OTC Markets and CME/S&P exchange agreements — **an owner decision,
never an agent's**.

**B51 · Narrow the home valuation** · *small* · planning set 2026-08-29; verified value remains Q3
Owner decision 2026-08-29: planning estimate **$1,200,000**; **$1,300,000** is
optimistic high only, not the plan. The 2026-08-09 $1.1m–$1.4m range and the
2026-08-21 $1.3m planning figure are dated evidence. Q3 stays OPEN until a
comparable the owner accepts as verified, a municipal assessment, or an
appraisal. A lender orders its own appraisal regardless.

**B43 · PayPal #2 — confirm account type** · *small*
Inferred personal from its transactions, not verified.

**B14 · Decide whether the business and her employment stay in scope** · *small*

---

## Ready — analysis, nothing blocking

**B97 · Read-only assistant access to Atlas** · **IN PROGRESS 2026-08-29** · *owner instruction; OAuth MCP connection slice*

Owner instruction 2026-08-24: expose one secure, read-only, sanitized assistant data surface backed by the incumbent live Atlas/Forecast authorities. First slice earned: `GET /assistant/current` via `scripts/assistant-packet.js`, dedicated `ATLAS_ASSISTANT_TOKEN` Bearer secret. Owner decision 2026-08-29 authorises the OAuth infrastructure specifically required for ChatGPT. Current slice: `POST /assistant/mcp` exposes that same packet as exactly one read-only MCP tool (`get_atlas_current`) behind OAuth issuer/JWKS, exact-resource, expiry, and `atlas.current.read` validation. Atlas is only the resource server; the external authorization server owns login, consent, PKCE, client registration, token issue, and refresh. Browser, static-assistant, and OAuth credentials remain separate. Not a ChatGPT financial planner, not a second Forecast, not a transaction store, and no writes. Deployment-provider configuration and ChatGPT installation are owner-operated configuration of this boundary, not another Atlas financial capability.

**B98 · Lookahead ten-block still prints debt and big-purchase rows** · **READY** · *Plan presentation only; found 2026-09-03*

The household Plan waterfall now ends at Balance after household budget (owner
instruction 2026-09-03). The week / next-period lookahead ten-block behind
"More views" in `public/plan.js` still prints Credit card to pay off first,
Other credit cards, Balance after debt repayment, Big purchases on the horizon
and Balance after big purchase allocation. Those rows are $0 extra / no
set-aside on lookahead spans by Forecast design. Decide with the Credit and
Planning content PRs whether that view also stops at the household-budget
boundary. Not a Forecast change.

**B99 · Modellers / Deep Dive / Records still carry the legacy four-link nav** · **READY** · *presentation only; found 2026-09-03*

The household nav is Plan | Credit | Planning. `modellers.html`, `deepdive.html`
and `records.html` remain routable but their own header still links Plan |
Modellers | Deep Dive | Records. Their future (household nav, a diagnostics
nav, or retirement) is owner direction; do not delete them on an agent's
initiative.

**B101 · Plaid pending→posted identity is not Lunch Money `id`** · **DONE 2026-09-04** · *financial-correctness interruption; owner instruction after live Amazon authorization/settlement investigation*

Live Lunch Money v2 only returns `plaid_metadata` when `include_metadata=true`. Atlas was requesting `include_pending` and the unbounded `is_pending` universe without that flag, treating Lunch Money `id` as `providerTransactionId`, and matching `posted.pendingTransactionId` to the pending Lunch Money id. Plaid's contract is `posted.plaid_metadata.pending_transaction_id === pending.plaid_metadata.transaction_id`, and the posted amount may differ. Current-period household spend/remaining and revolving pending exposure can double-count one purchase. Not Amazon-specific, not merchant fuzzy matching, not a new identity system. Forecast remains the planner.

**B100 · Figures snapshot does not cover the Credit and Planning surfaces** · **DONE 2026-09-04** · *governance; found 2026-09-03*

`scripts/figures-snapshot.js` now snapshots Plan, Credit, and Planning
household-facing figures. Credit keys copy `Forecast.creditAccounts` (balance,
pending, limit, utilisation headroom, rate, next minimum / due, HELOC
capitalise and cash minimum). Planning keys copy the same `Forecast.recommend`
`majorPlans` / `paydayAllocation` / `knowledge` the Planning page renders
(verdict, remaining, point or range, timing, allocated / not-assigned). Deep
Dive, Records, and Modellers remain outside. Not a Forecast change. Proved by
`test/test-figures-snapshot-credit-planning.js`.

**Dated 2026-08-09 BNPL reviews still combine Affirm and Flexiti** · **READY** · *docs only; not live current truth*

Dated 2026-08-09 reviews still print `Affirm / Flexiti` as one unknown BNPL line:
`docs/00_MASTER_PICTURE.md`, `docs/FINANCIAL_REVIEW_2026-08-09.md`,
`docs/MORTGAGE_HELOC_DEEP_DIVE.md`, `docs/dashboard.html`,
`docs/SANITIZED_SUMMARY_2026-08-09.csv`. They do not render as current on the live
Records / Deep Dive path (those pages read `data.json`). Do not rewrite them as
current truth. Owner instruction 2026-08-31 separated the live sources.

**B66 · Stop deleting the Interac notifications** · **owner action** · *small*
**The single cheapest fix in this file.** Interac's confirmation emails are the
only record of who is on the other end of an e-transfer, and both mailboxes are
deleting them. Gmail purges the bin after 30 days, so the evidence is being
destroyed on a rolling cycle — 26 of the 49 attributions recovered on 9 Aug were
sitting in the bin and would have been gone within weeks.

A filter on **both** accounts — `from:payments.interac.ca` → apply a label, skip
the inbox, **never delete** — costs nothing and makes every future transfer
attributable. It cannot recover what has already gone.

**B68 · Two auto-insurance policies at once** · **owner action** · *small*
**ICBC $99.91/month started 21 April 2026 and BCAA $82.96/month never stopped.**
Both are charged on the 15th, every month since. Auto insurance went from $82.96
to **$182.87/month — an extra $1,199 a year** — and nothing marks it as a
decision. If BCAA is optional coverage on top of ICBC basic Autoplan, fine. If it
should have ended when the ICBC policy began, one phone call recovers it.

**B69 · Home insurance — $3,131.76 a year, from an unknown account** · *small*
Square One, policy #5157890, **auto-renews 10 February**, whole year in one
payment. **It appears in none of the six accounts or five cards**, though
February 2026 is inside every coverage window.

Two further things: the premium is up **~17% in a year** ($2,730.36 → $3,131.76),
and the **January 2025 payment failed twice and the policy came within days of
cancellation**. A lapse on a mortgaged property is serious, and a single $3,131.76
debit is exactly the kind that fails when an account is short. Also worth asking
the insurer about the garage — see B57.

**B67 · The $1,806.00 Fusion invoice** · *small*
Invoice 86995864, 31 Aug 2025, paid by Dale — **and it appears in none of the
six accounts or five cards**, though it falls inside both coverage windows. The
other seven Dale-paid invoices predate card coverage and are explainable; this
one is not. Most likely an invoice total settled in instalments too small to
spot. One look at the LeagueApps payment history closes it.

**B28 · Rewards balances as minor assets** · **PARTIAL 2026-08-21** · *small*
Travel Visa **57,968 TD Rewards points**; Cash Back **$47.21**.
The dollar-denominated Cash Back Dollars **$47.21** now sit on `data.json`
`assets` and enter household asset / net-worth presentation through
`Forecast.publicationTotals`. That figure is the **2026-08-09** account
reading, not the 2026-08-19 opening; `docs/positions.csv` holds the dated
Household evidence. They are not spendable cash and not a funding source.
**Still open:** the 57,968 TD Rewards points have no single valuation basis
in current repository authority and are **not** assigned a dollar value. Do
not invent cents-per-point, a redemption method, or a rewards engine.

**B72 · `test-mergecard.js` names a commit that no branch holds** · **DONE 2026-08-22** · *housekeeping*

CLOSED. Current `test-mergecard.js` uses `const HEAD = 'a'.repeat(40);`. No code change was required. The string `b85274ce` survives only in historical prose.

**B73 · Financial decisions made inside page scripts** · **DONE 2026-08-14**
Every recorded page-script financial decision moved into Forecast. The item is closed on that recorded set; a new page-side decision, if one appears, is a new finding.

**B74 · Two calendars, and nothing notices when they disagree** · **DONE 2026-08-14**
PR #37. One authoritative household cash schedule: `data.json` `plan` → `Forecast.expandEvents`. Owner-confirmed 2026-08-24: the recurring CMAW Local 1995 $25/month payment is cancelled. AF-REFRESH-01 retired the monthly Plan bill and kept the 15 August once row; the 2026-08-25 live closed-loop receipt represented that occurrence from evidence without writing canonical state. AF-REFRESH is closed.

**B87 · One authority for question OPEN / ANSWERED status** · **DONE 2026-08-14**
`docs/01_OPEN_QUESTIONS.md` is the sole OPEN / ASKED / ANSWERED / BLOCKED authority. Q2 stayed OPEN in that PR. Proved by `test-question-status.js`.

**B88 · Tests must not depend on checkout line endings** · **DONE 2026-08-14** · *housekeeping*
Newline identity is normalized at the test input boundary (`test-source-text.js`). Proved by `test-line-endings.js`.

**B89 · Stop storing derived publication totals** · **DONE 2026-08-14** · *small*
`Forecast.publicationTotals` derives published totals from canonical rows. Proved by `test-publication-totals.js`.

**B90 · Guard overlapping essential / discretionary classification** · **DONE 2026-08-14** · *small*
Comparable essential/discretionary overlaps must agree or be named. School & clubs disagreement is Q24. Proved by `test-classification.js`.

**B91 · Evidence refresh / reconciliation loop** · **DONE 2026-08-16** · *architecture, current-state cutover*
Non-writing reconciliation over existing observation records; owner-approved edits land in `data.json` and Forecast consumes them. B91 closed on the 2026-08-16 cutover, which remains dated evidence in `snapshots/2026-08-16.json`. The live published opening is **2026-08-19**. Q19 is ANSWERED 2026-08-18.

**B92 · Make ordinary evidence refresh cheap** · **DONE 2026-08-14** · *tests, one outcome*
Behaviour tests no longer pin live household numbers; live cents remain only in deliberately live reconciliation. Proved by `test-refresh-isolation.js`.

**B93 · Derive or delete proven duplicate live facts** · **DONE 2026-08-14** · *architecture, one outcome*
Duplicate live facts derived or deleted. Q25 stays OPEN: the raw TENNIS INCOME balance is not household funding. Proved by `test-dedup-facts.js`.

**B94 · One master forecast; ranges are views** · **DONE 2026-08-16** · *engine earned; one outcome*
Forecast is the one master plan over a ≥12-month knowledge horizon; named ranges are views. Proved by `test-master-forecast.js`.

**B95 · Absorb known major future costs onto the master plan** · **DONE 2026-08-16** · *canonical plan / evidence absorption*
Known major future costs live on `plan.commitments`. Proved by `test-major-future-costs.js`.

**B96 · Prove the payday question end-to-end** · **DONE 2026-08-16** · *after B94; one outcome*
Household payday answer is composed from Forecast. Proved by `test-b96-payday.js`. Q19 is ANSWERED. Q20 / Q25 stay OPEN and fail-closed.

**B75 · Nothing checks that the authority table is complete** · **DONE 2026-08-11**
PR #10 added `test-authority-coverage.js` to the blocking `npm test` suite.

**B76 · The scope tripwire counts implementation only** · *needs a decision, not a fix*
`CLAUDE.md`'s scope budget counts **implementation** files and **implementation**
lines — source, workflows, templates — and counts documentation separately. For a
documentation-only pull request the tripwire therefore contributes nothing: there
is no numeric prompt at all, whether the change is eight lines or nine hundred.
The superseded PR #4 ran to over nine hundred documentation lines and PR A to
458; both were honest, and neither tripped anything.

**This finding is smaller than when it was first recorded, and the framing is
updated rather than carried across.** Scope is now explicitly a reviewer
judgement — the tripwires are "guidance, not merge-card fields and not CI
thresholds", and a reviewer asks whether the pull request is still one
independently provable outcome whether it is under or over them. So the gap is no
longer a gate that passes silently; it is a prompt that never fires for prose.

What remains worth deciding: a long document can carry an unreviewable amount of
authority-changing prose exactly as a long diff can carry code, and nothing draws
a reviewer's eye to that. Any answer should go through the governance-control
lifecycle rather than straight to a number — a new hard control needs a
demonstrated failure it would have caught, a deterministic predicate, a test that
proves the predicate fails on the defect, and a retirement condition. A
documentation line limit chosen without those is the gaming `CLAUDE.md` warns
about, with extra steps. Carried forward from PR #4, which recorded it under an
identifier since reused.

**B77 · The GitHub connector bypasses the pre-commit hook** · **DONE 2026-08-20** · *governance, small*
CI now applies the trusted default-branch copy of `scripts/privacy-guard.js` to every PR head. Adding the `privacy-guard` status to required checks on `main` remains an owner repository-setting action. Proved by `test-privacy-guard.js`.

**B82 · The figures comment claims a wider scope than it checks** · **DONE 2026-08-20** · *governance, small*
The figures comment names the snapshot's actual membership. B100 extended that membership to Credit and Planning; Deep Dive, Records, and Modellers remain outside. Proved by `test-figures-comment.js`.

**Issue #57 remainder · Autonomous delivery loop** · *governance, not a new B-id*

The repair → handoff → GPT-5.6 follow-up → card-sync middle is live as of
PR #63. Duplicate GitHub/Merge-Card primary-risk state closed in PR #64.
Owner granted first REQUIRED GPT-5.6 reviews on 2026-08-16; the first-review
wake-up is this outcome. Standing auto-merge of qualifying `auto-safe` PRs
is granted but must not become operational until GitHub itself enforces
`tests`, `Merge card mechanical fields`, and `risk-label/primary` on `main`.
Next-node wakeup remains later. They do not reorder `B91` and they are not
a slice taxonomy.

**B85 · Evidence-Use Register** · **DONE 2026-08-13** · *architecture, one outcome*
Live CI-checked disposition in `docs/evidence_use/register.json` (PR #28). The register owns routing and parking only; remaining parked IDs live there.

**B86 · Stale biweekly payroll net in the 91-day forecast** · **DONE 2026-08-13** · *figures, one outcome*
Live `plan.income` `payroll` replaced with the observed average **$4,264**, tagged estimated.

**B84 · `ARCHITECTURE.md` keeps its own running count of B73's progress** · **DONE 2026-08-20** · *documentation truth, small*
The second home for B73 progress arithmetic was removed from `ARCHITECTURE.md`.

**B83 · `CONTEXT.md`'s suite table names five of twelve suites** · **DONE 2026-08-12**
Suite inventories were removed rather than reconciled. `test.js` is the suite registry.

**B78 · Idempotent Lunch Money import with stable identity** · **DONE 2026-08-17** · *T3*
Incumbent observe/reconcile path is identity-stable and idempotent on the leftover 2026-08-16 observation. Proof: [`docs/connectivity/LUNCH_MONEY_IDENTITY_PROOF_B78.md`](docs/connectivity/LUNCH_MONEY_IDENTITY_PROOF_B78.md).

**B79 · The store question, answered by evidence** · **DONE 2026-08-18** · *owner-reserved gate stays closed*
The file foundation has not demonstrably failed. No store implemented. Gate remains closed. Written answer: [`docs/STORE_QUESTION_B79.md`](docs/STORE_QUESTION_B79.md).

**B80 · Evaluate connectivity providers, point nothing live** · **DONE 2026-08-16** · *owner brought this forward*
First provider for a personal read-only test: Lunch Money. Written evaluation: [`docs/connectivity/PROVIDER_COVERAGE.md`](docs/connectivity/PROVIDER_COVERAGE.md).

**B81 · Trusted canonical refresh from the live feed** · **DONE 2026-08-20** · *earned capability; production activation reserved*
Earned preview/approve writer, published 2026-08-19 canonical opening, and read-only live overlay. Production on-demand GET-only Lunch Money access is owner-authorized 2026-08-23. Unattended production writes, scheduled refresh, and a newer live substitute opening remain owner-reserved. They are not a missing B81 implementation slice and do not keep this item `IN PROGRESS`.

---

## Ready — needs a session at an institution

**TD EasyWeb.** Route and traps are in `ACCOUNT_FACTS.md`. Retention is ~7 years,
so none of this is time-sensitive.

- **B26 · Personal Visa, August 2025 statement** — 11 of 12; **not aged out**
- **B22 · Savings interest rates** — neither savings account has a captured rate
- **B23 · Chequing B overdraft rate** — drawn every month, cost unquantified
- **B24 · Account plans and fee structures** — $17.67/month across two accounts
  plus $3.95 on DEBT&PAYMENTS. **Some TD plans waive the fee at a minimum
  balance.** One of the few places an immediate saving may exist
- **B25 · Mortgage prepayment penalty formula** — a mortgage advisor will ask
  first
- **Tier 3 · chequing and savings statements**, 12 months each, for fee and
  interest detail. All five accounts are reachable from the same statements
  dropdown

**PayPal.** No monthly statements exist; the equivalent is a PDF activity report.

- **B8 · April–August 2026 gap** on account #1
- **B39 · history before March 2026** on account #2
- **B9 / B42 · per-subscription amounts and billing dates** — 16 and 10 merchants
  known by name only. **Always exhaust "See more"**: two only appeared after
  expanding twice
- **B38 · reconcile authorisations against settlements** on #2, as was done on #1
- **B44 · generate PDF activity reports** for the archive

**B49 · Wise statements** · *small* — activity CSVs held; statements not captured.

---

## Queued behind the above

**B15 · Rebuild the income picture** *(on B63)* · *medium*
Owner-stated 2026-08-29: do not add a coaching income line. Forecast uses
salaries (Seaspan, Tennis BC) and the child benefit. Coaching leftover is
gravy when it lands. Historical coach-pay net remains Q1 OPEN. The 2026-08-09
tracking-sheet derivation is dated subset evidence, not a current monthly
coaching-income figure. Do not invent a split.

**B16 · Finish the spending picture** *(on B34, B40)* · *medium*
Cards and chequing are both categorised. Remaining: merge the windows (12 months
of cards against 18 of chequing) and handle the PayPal overlap without
double-counting.

**B40 · Fold Instacart and delivery in** *(on B38)* · *medium*

**B19 · Compose the Deep Dive page `helocHistory` current endpoint from live `debts.heloc`** · **DONE 2026-08-17** · *small*
Closed the Deep Dive page current endpoint, not the historical `docs/MORTGAGE_HELOC_DEEP_DIVE.md` document. Q19 is ANSWERED 2026-08-18.

**B20 · `snapshots/<date>.json` and trend charts** · **DONE 2026-08-17** · *history as a refresh by-product*
Dated openings live in `snapshots/`. T2 holds for the stored HELOC pair.

**B30 · Fees dashboard** · **DONE 2026-08-09** — site section 11.

**B32 · Interest dashboard** · **DONE 2026-08-09** — site section 10.

**B65 · Period selector** · **DONE 2026-08-09** — this month / last month / YTD / all, built by `scripts/periods.js`. Rebuild after every capture or the selector goes stale.

**B21 · Prove the normal Lunch Money refresh path** · **DONE 2026-08-17** · *small*
Owner-run live observe → reconcile proof: [`docs/connectivity/LUNCH_MONEY_REFRESH_PROOF_2026-08-17.md`](docs/connectivity/LUNCH_MONEY_REFRESH_PROOF_2026-08-17.md).

**B29 · Payment calendar** · **DONE 2026-08-09**, **authority closed by B74 / PR #37 on 2026-08-14**
Cash-payment VEVENTs are derived from the Plan via `Forecast.expandEvents`.

---

## Done

**The 9 August analysis run — five items, all published to the site.**

- **B61 · E-transfer counterparties** — 24 → 49 of 204. Follow-up is **B66**.
- **B31 · Multi-hop chains** — premise disproved; B64 cannot be solved from transfer data.
- **B34 · Merchant library** — chequing uncategorised 12.0% → 4.5%.
- **B7 · The $158.55 interest charge** — explained as average-daily-balance retail interest, not a cash advance.
- **B62 · Youth lacrosse** — floor $5,143.56 → $5,729.47; 40% paid from the HELOC.

The 30 June coaching remittance was re-traced and a coach was paid out of it — $2,160.00 on 6 July. See B63.

**Capture — complete.** Every consumer debt in the household is captured.

- **B45** `raw/` backed up to OneDrive, verified, with a SHA-256 manifest
- **B1** `data.json` and `positions.csv` brought current
- **B10 / B36 / B46** MBNA = the Amazon Mastercard, one card not two. 21.74%,
  all 8 statements as PDF and CSV
- **B2 / B3 / B4 / B4b / B6** Both TD cards at 12 of 12 statements; Travel Visa
  limit $1,100
- **B48 / B50** Wise ×2 captured; the road trip totalled at ≈C$6,645
- **B55 / B55b** Coaching workbooks parsed — coaches take **27.7%**. The books
  cover late Apr–Aug 2026, so the share is extrapolated from ~4 months
- **B54** Card spending categorised — **$44,344.58**, 65% discretionary
- **B34** Merchant library seeded — 273 patterns
- **B17** Payoff ranking settled; net worth **$357k–$657k**
- **B18** The **$46,657** payment-matching investigation completed — captured cards received more than the labelled TFR-TO C/C transfers in the 12-month window. Destination evidence only; owner closed Q2 2026-08-29 in `docs/01_OPEN_QUESTIONS.md` (three TD credit cards; not a missing fourth TD Visa; June HELOC TFR-TO C/C lines still lack per-card destinations)
- **B52** The $10,000 Ivoclar charge — a funded pass-through, not household money
- **B53** `Head Canada` — a coaching business expense Amanda absorbs
- **B12** Home valued at $1.1m–$1.4m [ESTIMATE]
- **B37 / B11** Amex closed; Flexiti closed (owner 2026-08-31); Affirm has one
  final $32.53 payment due 2026-09-21, then no recurrence. Do not combine Affirm
  and Flexiti.
- **B5 / B35 / B41 / B33** Earlier verifications

---

## The three biggest numbers still uncertain

1. **Historical coaching P&L** — Q1 stays OPEN. Unmatched outbound $19,700
   may be coach pay; that is not written as fact. One payment is traced
   ($2,160.00, 6 Jul); the rest of the 2026 route is not. Planning does not
   wait on this: leftover coaching is not Forecast income.
2. **Two unidentified accounts** — $59,027, reachable via B64 and **only** via
   the e-transfer record: the internal-transfer data contains zero unidentified
   account numbers, so B31 cannot reach them
3. **$8,150 of cheques** — payee unknowable without TD's images

**And one that is no longer uncertain:** the $158.55 interest charge. It was
never a cash advance and never unexplained — the check was against the wrong
balance. See B7.
