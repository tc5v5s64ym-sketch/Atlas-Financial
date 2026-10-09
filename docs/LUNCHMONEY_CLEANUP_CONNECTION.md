# Lunch Money routine cleanup connection — inactive draft

Dale's 2026-10-09 instructions are the source of PR #560: preserve #559's
safeguards and finish supported automatic routine cleanup without asking for
individual transaction approval. Names, existing categories, additive notes/tags
and evidence-backed transfer labels are in scope. Uncertainty remains unresolved.
No amounts, splits, deletions or money movement are allowed on the routine path.

Current-state verdict: PARTIALLY FIXED. Fresh main
6a9f37da6009408e90013c39070f4b6be0a8ca3c contains #559's category-only standing
authority. #560's previous head 04f54fe8a08092168a1fe83798bcea79591e2d49 supplies
metadata previews but requires individual confirmation. This owner-directed
continuation stays on the same branch and PR. #548 and household UI are untouched.

## One outcome and authority

One outcome: the incumbent signed standing authority can execute a supported,
financially safe routine instruction and durably record its before/after for
an afterward report and private history sheet. Lunch Money owns transactions;
Forecast owns classification, calculations and planning. No competing ledger,
classifier, mailbox feed, scheduler or rule service is added.

A new atlas-standing-correction-grant/v2 binds the exact reusable JSON
cleanupInstructions and atlas-delegated-routine-cleanup/v1 policy. Its subject,
verified client/resource, budget/token, context/parser revision, account
namespace/IDs, date window, pinned category transitions, expiry, attempts,
revocation, target leases and audit/quarantine come from the incumbent authority.
Existing signed v1 category grants gain no metadata permission.

The externally owner-signed context must explicitly set cleanupEnabled=true,
pin the deployed parser revision and financialContextDigest, and include a
provider API proof covering category_id/payee/notes/additional_tag_ids with
updateBalanceFalse=true. The signing key stays outside the runtime. MCP can
neither grant nor widen authority. The default runtime reads no standing store,
creates no key/grant and exposes no automatic tools.

## Routine use after separately approved activation

1. Read fresh transactions/catalog, including tags when needed. Research the
   exact selected transaction through already-authorized sources.
2. Call submit_lunchmoney_cleanup_evidence with the signed cleanupInstruction,
   exact before facts, source references/digests, supportedChanges, rationale
   and no unresolved issues. Category changes additionally need the incumbent
   complete, positive, single-category receipt proof.
3. Call prepare_standing_lunchmoney_correction with that same instruction and
   issued evidenceRef. Preparation checks authority, fresh catalogs and the real
   financial-effect proof; it does not write.
4. Call apply_standing_lunchmoney_correction with previewId. No confirmed=true
   or individual approval is required. The server revalidates the grant/evidence,
   durably reserves one attempt, rechecks the target and effects under the shared
   lease, then makes one exact PUT with update_balance=false.
5. Report the verified change and durable audit receipt afterward. Read
   get_lunchmoney_correction_audit for history rows, including uncertain attempts.

Client evidence is labeled delegated-client-review, independentlyVerified=false.
The server checks consistency and bounds; it does not fetch or authenticate the
source excerpt. A digest or model confidence does not turn an assertion into
owner authority. Uncertain, partial, mixed, conflicting, pending, unreviewed,
split/grouped, out-of-bound or unsupported work is refused without a provider
write. A reusable recipe alone supplies no permission. The existing interactive
prepare/apply path still requires its exact individual confirmation.

## Preservation and reusable instructions

The instruction data schema is atlas-lunchmoney-cleanup-instruction/v1, with
name and changes containing payee, categoryName, notesAppend, tagNamesAdd or
transferLabel.from/to (exact account name and plaid/manual namespace).
prepare_lunchmoney_cleanup_instruction creates this data without a provider
call, grant or write. The signed grant must contain the identical instruction.

Names edit payee only and require a known original_name. The original bank
description, amount, date, currency, account and every untargeted provider field
remain exact. Notes retain the original string, including whitespace; only a
newline and the approved addition are appended. Existing suffixes are not
duplicated. Tags use additional_tag_ids, never a replacement tag_ids write;
readback must be exactly the original-plus-requested set. No tag is created.

Catalog names must resolve uniquely to active existing records. No fuzzy merchant
target, guessed category, amount/date matching as identity, bulk mutation or
provider rule is introduced. Already-matching instructions return no-changes,
with no reservation or PUT. Unknown writes are different: never retry them.

## Evidence-backed transfer labels

A standing transfer instruction labels one selected leg only. The real observer
identity parser must find the same explicit bank reference in the original
descriptions of exactly two transactions, with opposite TFR-TO/TFR-FR directions.
Both must be posted/reviewed, same-date, same-currency, exactly opposite nonzero
amounts, on the two exact distinct instruction accounts. Missing, third,
conflicting, pending or ambiguous legs are refused. Amount/date coincidence
without the directed bank reference supplies no proof.

The result is a payee such as Transfer: Synthetic Bills → Synthetic Weekly.
No amount, account, category or provider linkage changes because a label is
supplied. No transfer or payment is initiated. Only a label whose effects remain
neutral through the real Atlas path is eligible.

## Financial-effect proof

assistant-cleanup-effects.js is consumed by the optional production standing
adapter and synthetic service tests. It uses the real provider-observe,
live-plan overlay and Forecast.baselineTrajectory/operating answer, with the
current canonical data, account map, identity rules, public periods and a fresh
complete provider transaction/pending snapshot. Missing mappings, colliding
account IDs, incomplete coverage, stale target fingerprints, unavailable overlay
or unavailable Forecast fail closed.

The signed context pins the data/map/identity/periods digest and a hash of all
deployed public/scripts JavaScript. Changed policy, map, actuals basis or parser
requires a new approved context. The comparison removes only source/display
text; derived ownership, identities, coverage, settlement, trust, amounts,
dates, decisions and all financial outputs remain in the proof.

Metadata-only effects must be identical under BOTH the original and resulting
category. A supported, signed category correction may intentionally move its
budget classification; the audit records authorized-category-reclassification
and both effect digests. Category income/exclusion semantics and minimum-payment
confirmation identity cannot change. Category corrections also retain #559's
full-receipt proof and pinned semantic transition. The connection does not invent
classification or household policy to make a proof pass.

A final credential-pinned target GET follows all asynchronous effect/catalog
checks. Separate readback verifies requested fields, exact tag union and all
untargeted fields except updated_at. Unknown/unexpected provider results remain
quarantined; they cannot be reported as successful or retried. No provider
compare-and-swap is documented, so an unrelated client can still race GET/PUT.
Readback is detection, not a claim that all external races are prevented.

## Private history sheet

Every dispatched attempt is durably reserved before PUT, with full projected
before/proposed, actor, grant/evidence, request time and effect proof. The terminal
record adds outcome, reason, readback after and receipt. The matching-subject,
client/resource audit exposes a stable atlas-cleanup-history-row/v1 using
attemptRef as rowKey. It survives restart, includes uncertain/pending records,
and is an idempotent export key for the private history sheet. This is the
existing operation audit, not a new transaction ledger.

Sheet rows include complete name/category/notes/tags/original-description
before and after, unchanged amount/date/account evidence, source provenance,
the signed instruction, financial-effect digests, timestamps and outcome.
Missing after on an uncertain request stays unknown. finish must durably record
the outcome before acknowledgeVerified can release quarantine. Audit failure
cannot turn a possibly sent edit into a success.

The history feed is export-ready-not-synced. No sheet destination, connector
permission or spreadsheet write is installed by this PR; those belong to final
access setup. The configured consumer must export rows by rowKey, confirm the
private destination and report sheet synchronization honestly. Existing private
audit storage remains the recoverable source if export is unavailable.

## Access and review hold

Everything automatic stays OFF until exact-head tests and Atlas Contract /
Systems Review complete, and the owner approves the final resource/consent,
provider API semantics proof for every allowed field, durable private
installation, owner key/operator/revocation, exact signed context/grant,
financial inputs, history sheet destination/access/retention and activation.
No live provider edit, sheet write, new consent, secret handling, connection
replacement, environment flag change, deployment or merge is performed here.

The official [Lunch Money v2.11.1 OpenAPI](https://lunchmoney.dev/v2/openapi)
documents separate payee/original_name, additive additional_tag_ids, notes
replacement and update_balance=false. It does not establish API-specific
absence of automatic rule creation/execution or effects on other transactions.
[#559's provider-contract safety hold](STANDING_LUNCHMONEY_CORRECTIONS.md)
therefore still applies and now must cover every cleanup field. A synthetic
proof is never accepted as a production provider-contract proof.

## Verification

test-assistant-routine-cleanup.js exercises actual MCP standing admission and
apply without confirmation, the real observer/overlay/Forecast, independent
fixture arithmetic, preserving wire fields, category proof, paired transfer
references, uncertainty, forbidden operations, stale notes and unexpected
readback. On POSIX it also exercises real Ed25519 signed grants, the actual
private store, restart and private history access. Windows prints that durable
proof was not run; Linux CI must certify it.

The incumbent category-only, crash/quarantine/reconciliation/multiprocess,
interactive cleanup, HTTP/JWT, provider amount and balance tests remain
applicable. The new proof is registered in npm test and the focused standing
workflow. These are synthetic implementation proofs, not evidence of a live
write exemption, approved access or deployment. Systems Review is required;
the active builder cannot supply its own PASS.
