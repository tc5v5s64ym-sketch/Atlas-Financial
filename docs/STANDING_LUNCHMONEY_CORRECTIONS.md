# Bounded category-only standing Lunch Money corrections — inactive candidate

Dale's 2026-10-09 request authorizes this implementation and synthetic proof.
It does not install private storage or keys, provision household grants, expand
OAuth consent, activate, deploy, merge or authorize a real provider write.
No household transaction, receipt or credential is used in public fixtures.

## Current state and integration

Fresh-main verification on f6ee6b84c96e5c87cb85aa9d7fdf9a9a7d6212fa found
STILL BROKEN: interactive apply requires exact confirmed=true and MCP instructions
require preview approval; main had no standing grant/evidence authority.
AGENTS.md and canonical repository guidance were read. Main has no .agents/skills;
neither cataloged repository procedure applies. One outcome: a distinct,
bounded category-correction contract with afterward audit.

Default construction remains inactive. It performs no standing-store/provider
reads, creates no key/grant/directory and exposes the five incumbent tools.
Interactive category/notes/splits and literal preview confirmation remain intact.

The prepared backend-only server.js hunk injects the optional runtime after
OAuth config and derives metadata/step-up from the same validated service.
Dale explicitly approved publication of that exact construction hunk on
2026-10-09 after automatic review enforced #548's file hold. That approval covers
publication only. It does not enable the flag, install storage/keys/grants,
expand consent, deploy, merge or authorize provider writes. No UI/redesign
behavior or builder is touched; #548's redesign hold remains. test/test.js,
#558 and #557 files/modules remain untouched.

## Explicit owner authority

Runtime pins an externally installed Ed25519 owner PUBLIC key. The signing key
is held by the owner outside the runtime/store/repository. Signed context and
grant envelopes are verified before use. MCP has no owner-control tools and
cannot mint, widen, renew or revoke grants. Source prose, model confidence,
approvedByOwner fields and guessed references supply no signature or authority.

A category-only grant binds:
- exact subject, verified client and OAuth resource;
- provider budget, active token digest/credential version and context/parser version;
- exact account namespace/IDs and an explicit date window (at most 366 days);
- allowed existing from/to category IDs and pinned semantic category signatures;
- atlas-delegated-category-review/v1, notes=false, creation/expiry (at most 30 days);
- immutable grant/revision/approval references, revocation and 1–1000 attempts.

These are ceilings, not activated defaults. Replacement/renewal requires a new
owner-approved grant. A revoked grant cannot be overwritten or revived.

Owner CLI: scripts/assistant-standing-owner.js. It defines commands and creates
nothing when imported:
1. plan --file <private-payload.json> prints the canonical payload digest.
2. approve --file <private-payload.json> --approve-digest <exact-digest>
   --signing-key <owner-private-key-path> signs only that exact owner decision.
3. init --file <signed-context.json> --root <new-private-directory>
   --public-key <pinned-public-key-path> initializes context, with no grant.
4. provision / revoke --file <signed-envelope.json> --root <private-directory>
   --public-key <pinned-public-key-path> --resource <exact-resource> applies the
   corresponding verified owner action.
5. list reports private grant/attempt status.
6. plan-reconcile --attempt-ref <opaque-attempt> performs one GET using the
   existing credential, produces a bound observation/digest; after owner
   signing, reconcile checks the same read-only observation and known request closure,
   releases a conclusively observed hold and permanently revokes the affected grant.
7. plan-lock-recovery / recover-lock requires an owner-signed exact lock digest
   and verifies the recorded process is dead. It never releases attempt holds.

CLI paths are absolute and outside the repository; runtime pins the public key
outside the store. The owner/operator must install appropriate private filesystem
access and protect the signing key separately. These commands are code only;
this task runs them only against temporary synthetic CI data.

## Honest delegated evidence

submit_lunchmoney_category_evidence admits a distinct typed client review under
an existing signed owner grant. The client researches sources through current
authorized connectors; Atlas receives source references/excerpt digests,
extracted facts, item classifications, rationale and unresolved issues.
No server-side Gmail connection, mailbox credential/refresh grant, background
feed or wider mailbox access is introduced.

The schema rejects caller provenance/authority fields. The server stamps subject,
client/resource and an immutable review digest; provenance is explicitly
delegated-client-review and independentlyVerified=false. A digest identifies
the client's supplied excerpt; it does not prove Gmail provenance or truthful
extraction. The client assertions and server consistency checks are distinct
from an independently verified receipt/classification.

This conservative initial policy requires a complete positive-expense receipt:
exact payee/date/currency/total matching, positive whole-cent item amounts summing
to the total, all items assigned to the same allowed destination, no issues and
a resolved review disposition. Mixed, partial, uncertain, conflicting, refund,
fractional-cent or unsupported cases remain unresolved. No fuzzy targeting or
merchant-only inference. Source content never grants permission.

The stored evidence binds the complete provider-before fingerprint, exact
category body, grant revision, actor/resource, category context and expiry
(maximum ten minutes or grant expiry). Admission does not write the provider.
prepare_standing_lunchmoney_correction then creates the exact ephemeral preview;
apply_standing_lunchmoney_correction consumes it under the live grant.
Caller text is never fabricated into the legacy trusted-evidence-policy schema.
The older trusted-record path remains distinct and has no production attestor
installed by this change.

## Durable one-host authority

scripts/assistant-standing-store.js stores only bounded capability/evidence/
attempt/receipt state for this operation, not a general transaction ledger or
receipt platform. The supported installation is one POSIX host on durable private
storage: directory 0700, snapshots/lock 0600, symlink refusal, 32 MiB ceiling,
exclusive acquisition/recovery gate and process lock, atomic snapshot replacement and file/directory fsync.
The snapshot checksum detects corruption; it is not an external tamper-proof
audit service. Filesystem access and owner-key separation remain essential.

All processes/grants share the same budget/transaction target lease. Reserve
atomically rechecks identity, scope bindings, expiry/revocation, evidence/body,
category context and budgets; consumes evidence/preview and charges an attempt
before any PUT. No refund follows a possibly sent write. Restart retains limits,
replay markers, revocation and unresolved attempts. Busy/stale locks fail closed;
no process automatically steals another's lock. Recovery and writer acquisition
share an exclusive gate. A crash with that gate held remains fail-closed and
requires offline operator intervention; no automated gate recovery is provided.

After reservation, the executor re-reads target/categories under the same
credential, checks the original fingerprint, then verifies the live reservation.
The credential is also pinned for readback and audit catalog reads. Exactly one
PUT sends category_id only with update_balance=false. Independent GET verifies
the requested category and every untouched field except updated_at; a changed
category context is also unverified. No splits, notes, amounts, deletions,
balances, accounts, payments, rules or Forecast changes on this path.

finish commits terminal audit WITHOUT releasing quarantine. Only known verified
readback plus a validated attributed receipt permits acknowledgeVerified.
A finish commit with a lost/malformed reply stays held even if suspension fails
and the service restarts. An ambiguous acknowledgment after known audit/readback
leaves the edit honestly applied and reports uncertain continuation, never a
provider retry. Owner reconciliation performs no write and cannot revive grants. A durably
armed provider request with unknown completion remains quarantined even if a
GET still shows the old category; that read does not prove no late write can
arrive. Known pre-dispatch failure or a returned provider request is required.

get_lunchmoney_correction_audit returns private before/proposed/readback,
pending/terminal outcomes, receipt/actor and honestly labeled delegated review
for the matching subject/client/resource, including expired/revoked grants.
Client audit item categories use recorded opaque references; raw provider IDs
remain confined to private authority state.
This supports the afterward report and unresolved-write inspection.

No provider compare-and-swap is documented. Shared Atlas leases and post-lock
reads prevent Atlas instances from overwriting stale reads; an unrelated external
client can still race the final GET/PUT. Readback detects observed changes but
cannot prove absence of all external provider side effects.

## Default-off installation boundary

Runtime variables exist as code interfaces only; none are configured here:
ATLAS_STANDING_CORRECTIONS_ENABLED, ATLAS_STANDING_STORE_PATH,
ATLAS_STANDING_OWNER_PUBLIC_KEY_PATH. Missing/invalid configuration, Windows or
a nonprivate installation leaves the capability unavailable. Real paths (including ancestor symlinks) must remain outside the public project;
owner init checks the existing parent's real path before creating storage. Existing tools and
OAuth JWT issuer/JWKS/audience/resource/expiry/subject validation are unchanged.

A valid capability adds four tools and requires
atlas.transactions.correct-with-grant in addition to current-read and transaction
read/write scopes. The backend construction hunk couples metadata, HTTP step-up and dispatch to the
same capability state. A flag or OAuth scope alone cannot authorize a correction.

The signed context must contain an unexpired, explicitly approved provider API
contract proof. Synthetic proof is accepted only by direct testOnly injection,
never by production server configuration. Unknown rule effects or missing/malformed/expired positive safe-integer proof
expiry refuse activation and writes; live eligibility rechecks the expiry. Default env parsing does not configure a store or consent. The default production construction performs no standing-store reads and exposes
no standing tools. Provider-contract proof and separate activation prerequisites
remain unresolved.

## Authoritative provider contract and remaining blocker

Checked 2026-10-09:
- https://lunchmoney.dev/v2/overview documents PUT validation and field behavior.
- https://github.com/lunch-money/lunch-money-js-v2/blob/main/src/types.generated.ts
  (inspected blob 66d71737f0dce66f50bbe0de680fd5b9a77ee9df, SDK 2.11.1) documents
  updateTransaction's update_balance=false query parameter; no rule-suppression
  option is present for that update operation.
- https://support.lunchmoney.app/setup/rules describes automatic category-rule
  creation and optional rules running on transaction updates.

These sources do NOT establish that API category PUT bypasses both rule creation
and execution. UI semantics are not proof of API behavior; readback of one
transaction cannot establish absence of rules/other-target effects. Therefore
production provider-rule safety is a concrete unresolved prerequisite. Obtain
authoritative API-specific confirmation or a separately owner-approved rehearsal
before an actual provider-contract proof is installed. This task conducts none.
No rule creation/management endpoint or provider setting change is added.

## Verification and activation

Synthetic proof exercises genuine owner signatures/exact digests, forged grants,
delegated-vs-independent provenance, uncertainty/mixed facts, real temporary
storage, two process contention, replay/revocation across restart, fsync/rename
crash/rollback, unknown-dispatch quarantine after an old-state GET, locked
reconciliation race, concurrent recovery/writer exclusion, malformed/live proof
expiry, ancestor-symlink containment, MCP audit privacy, committed audit reply loss plus failed suspension, signed dead-lock
recovery, read-only reconciliation, actual MCP-to-store-to-mock-provider category
execution and unchanged interactive/default HTTP/JWT behavior. Public fixtures
contain only synthetic data. Full npm test on a superseded head is not a final
candidate certificate.

Before activation, the owner must approve the exact reviewed SHA and deployment/
resource, pinned owner key/operator channel, durable private directory/topology/
permissions/backup/access/audit retention, provider API semantics proof, exact
subject/client/budget/credential/accounts/dates/category signatures, named
delegated policy with its provenance limits, expiry/attempt ceiling, working
revocation/recovery and additional issuer consent. Notes remain disabled until
real observer/map/plan/tag/catalog parser proof and separate exact permission.
Atlas Contract / Systems Review is required before merge; this task stops at
Draft and performs no activation or merge.
