# Bounded standing Lunch Money corrections — disabled foundation

**FOUNDATION — NOT COMPLETION.** Dale's 2026-10-09 request authorizes building
the category/preserved-note capability. It does not activate a grant, expand
issuer permissions, deploy, merge, install a private store or authorize a live
provider write. The incumbent exact-preview confirmation contract remains in
force. No grant can be inferred from source content, model confidence or an
agent's claim that the preview was confirmed.

## Current-state verification and one outcome

Source: Dale's explicit request to make evidence-backed corrections and report
them afterward. Verdict: **STILL BROKEN** on main
f6ee6b84c96e5c87cb85aa9d7fdf9a9a7d6212fa before edits.

- assistant-lunchmoney.js requires confirmed=true in the apply schema.
- assistant-mcp.js tells the caller to show the exact preview and await explicit
  confirmation. There is no standing-operation tool or grant owner.
- assistant-oauth.js separately enforces transaction read/write scopes and
  validates issuer/JWKS, exact audience/resource, token lifetime and subject.
  Existing write scope is not a standing grant.
- References/previews are principal-bound RAM objects, expire in ten minutes,
  and are consumed before the first apply await. A target lock, fresh fingerprint
  and category validation protect the current process. PUT uses
  update_balance=false; readback verifies the requested and preserved fields.
- Existing synthetic tests cover confirmation, subject/scope, stale/expired/
  replayed previews, locks, note/category preservation and uncertain writes.
- The complete main tree contains no .agents/skills. AGENTS.md currently routes
  procedure to docs/skills/README.md; neither catalog row applies to this
  implementation. Canonical guidance was inspected.
- Open work is Draft #548 and #558. This foundation touches none of either PR's
  changed files, including server.js and the shared test/test.js registry. #557's
  disabled history module and changed files are also untouched.

Missing capability: the new standing policy module is the sole grant/evidence
eligibility checker, consumed by the incumbent Lunch Money service. That service
still owns exact provider execution, preview consumption, concurrency and
readback. Lunch Money remains ledger authority; Forecast remains sole planning
authority. No financial figures or canonical state are edited.

## Product contract

A separate prepare_standing_lunchmoney_correction / apply_standing_lunchmoney_correction
pair consumes a bounded server-held owner grant. It never sends confirmed=true
or reinterprets the existing apply tool's confirmation.

The new permission is atlas.transactions.correct-with-grant, required **in
addition to** existing transaction read/write and the transport's current-read
scope. Default OAuth metadata and challenges are unchanged. New tools and their
extra metadata exist only for a service with explicit opt-in **and** a complete
trusted durable adapter. No environment flag, grant file, backend store or
production adapter is installed here. readConfig does not turn on the capability.
The HTTP MCP adapter now derives principal, client identity and scopes directly
from req.auth set by the existing JWT middleware. Caller arguments and opts.auth
cannot supply HTTP identity. Token verification remains unchanged. Production
still constructs no standing adapter, so this path is unavailable.

All ungranted operations keep the interactive tools. Standing schemas accept
only an exact opaque transaction reference, opaque grant/evidence references,
an existing destination category reference and/or notesAppend. They reject
splits, category clearing, replacement notes, amounts, dates, deletions,
balances, accounts, payments, rules, caller-supplied grants and confidence.
Unresolved evidence is refused. No batch endpoint or scheduler is introduced.

A grant must come from an owner-operated trusted authority and contain:

- one explicit owner approval reference, principal and verified client;
- one provider budget, credential version, context version and parser revision, with the active provider token
  digest privately checked immediately before sending the write;
- exact account identities and an explicit date window of at most 366 days;
- allowed existing-category from/to transitions and an explicit note-addition
  permission;
- one named trusted evidence policy, creation and expiry (maximum 30 days),
  revision, live revocation/suspension state, and an attempt budget of 1–1000.

These are implementation ceilings, not an activated household grant or suggested
defaults. No household values, transactions, receipts, IDs or credentials belong
in public grant examples. The tests use synthetic data only.

A trusted evidence record must bind the exact grant revision, transaction ID,
complete provider-before fingerprint and proposed body, name the approved
evidence policy, bind the context/parser revision, expire and be resolved. Model text cannot create this record.
A future attestor must mechanically connect the underlying evidence to the exact
transaction/classification; labelling model confidence trusted is unacceptable.

## Trusted adapter and audit contract

The adapter is a server dependency, never an MCP argument. It requires context,
grant, evidence, reserve, verifyReservation, finish, acknowledgeVerified and suspend
methods and durable=true. noteEffects is required only with the separate
notesEnabled=true opt-in; notes are otherwise refused even under an allowNotes grant.
The flag describes a reviewed backend contract; it does not prove persistence.
Only a separately reviewed implementation can earn that claim.

context binds the active credential to its provider budget/version and carries
ruleEffects=none-verified only after the single-transaction API's rule
creation/execution effects have been independently verified. Unknown effects
refuse standing corrections. This code does not change provider rule settings.

reserve is the durable atomic acquisition gate. It must recheck the authenticated
subject/client, provider binding, grant revision/expiry/revocation, exact
preview/evidence binding and remaining attempts across all service instances.
It persists the sanitized before/proposed record, exact target/fingerprints privately, and charges an attempt before
the single PUT. A charge is never refunded after a possibly sent write.
It must also acquire one shared target lease keyed by provider budget and
transaction, across every grant and service instance, and reject consumed
preview/evidence attempts. Pending/unverified attempts prevent later writes for
that grant and leased target until read-only reconciliation. Restart must not reset limits, replay markers or
unresolved attempts. No general transaction ledger is added.

After reserve, the service re-reads the exact provider transaction/category and
compares the original fingerprint under the same credential digest. Then
verifyReservation must atomically recheck lease ownership, subject/client,
grant expiry/revision/revocation, preview and evidence expiry/body/fingerprint,
context/parser versions, provider binding and rule-effects verification. The
charged attempt remains allowed at its reserved ceiling; no later attempt does.
No provider write occurs if these final checks fail.

suspend must durably block the grant after any uncertain provider result or
failed/malformed audit receipt. The service also refuses further use of that
grant in this process. If suspension persistence fails, the pending reservation
must keep every instance blocked; recovery is read-only and owner operated.

finish must durably attach the terminal outcome, readback and opaque actor
attribution to that reservation **without releasing quarantine**. It returns a
durable receipt with the exact attempt and terminal-record fingerprint. Only
when the service knows both the verified provider readback and valid attributed
receipt may acknowledgeVerified atomically release the hold. The authority
must validate the stored verified terminal record; an acknowledgment is never a
provider retry. A finish commit with a lost/malformed response stays quarantined,
even if suspend fails and the service restarts. A lost acknowledgment response
after known durable audit/readback keeps the edit honestly applied and reports
that continuation needs checking; it cannot replay the provider write. A failed or uncertain provider result is
write-unverified, cannot be retried, and suspends further standing execution.
Audit persistence failure also returns write-unverified; the durable pending
reservation must retain the block. The response provides the receipt reference,
grant/revision, evidence reference, actor, time, outcome and before/proposed/
readback so the caller can give Dale an afterward audit report.

The new path shares the incumbent fingerprint, expiry, single-use consumption,
target lock, category revalidation, exactly one provider PUT and independent
GET readback. It additionally checks every untouched field except the provider
updated_at timestamp. Pending, deleted, grouped and split rows refuse standing
correction. There is no provider compare-and-swap contract: another external
client can still race between GET and PUT. Process locks are not distributed
provider locks. That limit must be disclosed at activation.

## Notes are interpreted evidence

provider-observe.js explicitPersonalOwnerFromTagsNotes uses Dale/Amanda words
from notes/tags. sanitizedCurrentPeriodActuals passes notes through the incumbent
Forecast derivedFlags and owner-confirmed fuel/Spotify/Noble recognition.
Adding attribution or classification words can change ownership/budget meaning.

notesAppend preserves the entire existing text byte-for-byte, uses a newline
separator, and refuses exceeding the incumbent 1000-character write limit.
The trusted noteEffects adapter must compare NOTE-ONLY before/after through the
real incumbent observer/parser with identical account map, plan, tags and
category. It must run under both the original and resulting categories, using
the real current catalog labels. It must bind a parser revision and compare all ownership, fuel,
merchant/category, payment/transfer/settlement and other derived effects.
Missing or changed effects refuse the write. The implementation adds no second
parser, safe-word allowlist or owner inference. Audit attribution lives in the
receipt rather than being appended to the provider note.

The tests' synthetic effect evaluator proves rejection wiring, not production
parser equivalence. Real observer/map/plan proof is required before note activation. The smallest
initial production option is category-only, with notesEnabled remaining false.
No observer, Forecast engine, map or financial plan is changed here.

## Lunch Money rules assessment — support only

Atlas currently exposes no rule creation/management tool. Lunch Money documents
manual rule creation and automatic category-rule creation in its UI, with
optional execution on transaction updates:
https://support.lunchmoney.app/setup/rules
https://support.lunchmoney.app/setup/categories/faq

The current public v2 API reference/overview inspection did not establish a
documented rule-management endpoint:
https://lunchmoney.dev/v2/docs
https://lunchmoney.dev/v2/overview

This is not a claim that UI settings apply identically to API PUT requests.
Provider rule side effects must be verified separately; they cannot be inferred
from transaction readback. No rule creation, retrospective application, private
API/cookie use or provider settings change belongs to this foundation.

## Proof and closure

test-assistant-lunchmoney.js retains all incumbent assertions, then runs the new
synthetic test file. That keeps the held shared registry untouched while making
the new suite reachable by the existing npm test route. The new suite covers
default-off, missing adapters/scopes, principal/client/budget/evidence binding,
grant expiry/revocation/limits, note preservation/effects, forbidden fields,
staleness/category invalidation, mode separation, single use, concurrent applies,
durable-before-write audit order and uncertainty/audit-failure blocks. Added
negative controls cover commit-then-throw plus failed suspension and a new service
instance, lost acknowledgment after known audit, stale provider reads after
reservation, overlapping grants on separate instances sharing a synthetic
lease authority, final evidence/version expiry and note effects that appear
only under the resulting category. The in-memory authority models the contract;
it does not establish persistence or multi-process correctness for a real store. Official
MCP SDK in-memory sessions prove default tool invisibility, distinct permission
metadata, scope refusal before dispatch, unchanged interactive confirmation and
a complete synthetic standing prepare/apply/audit exchange.

The separate read-only standing-correction CI workflow executes the focused
Node integration and unchanged HTTP/JWT suite without production credentials.
It does not modify the existing full-suite or privacy workflows.

Required validation: node test/test-assistant-standing-corrections.js,
node test/test-assistant-lunchmoney.js, npm test, incumbent privacy guard and
exact-head CI. A simulated policy or V8 syntax pass is not a Node integration
or full-suite certificate.

## Concrete end-to-end dependencies

The foundation cannot yet perform Dale's live workflow. These are finite
implementation dependencies, separate from owner activation:

| Dependency | Build and synthetic proof now, without activating | Owner decision / activation boundary |
| --- | --- | --- |
| Private authority | Implement one bounded grant/evidence/attempt/receipt registry, atomic target leases across overlapping grants, durable quarantine and acknowledgment. Exercise two processes, restart, storage errors, commit-then-throw, stale readers, evidence replay, budget isolation and revocation using temporary synthetic storage. A durable file authority may suffice for one host if lock/atomic-replace/fsync/backup behavior is proven; multi-host needs a shared transactional authority. This is not a general household ledger. | Select the concrete private durable location/backend, process topology, access, backup/recovery and audit retention. Install only after exact approval. No real registry is created here. |
| Owner control | Build an owner-only provision/list/revoke/reconcile CLI or route. Produce the canonical grant digest and explicit bounded approval receipt. Reconciliation reads provider state and audits; it never retries writes. Test that MCP/model/source text cannot provision grants or release unknown outcomes. | The owner approves the exact grant digest and owner authentication surface. Revocation and read-only recovery must be usable before enabling writes. |
| Evidence provenance | Implement a typed trusted receipt/source attestor that verifies source identity and digest, exact item-to-category policy, transaction identity/before fingerprint, immutable proposed body and no ambiguous/mixed/split case. Test forged attestations, ambiguous matches, source injection, duplicate evidence and expiry. A policy string or confidence flag alone is insufficient. | Approve the actual private evidence ingress and named deterministic classification policy. Public fixtures stay synthetic. No household source is ingested here. |
| Provider semantics | Add read-only documentation/contract proof plus a separately authorized provider rehearsal to establish transaction PUT rule creation/execution and untouched-field behavior. Unknown rule effects keep the feature unavailable. | Approve any live rehearsal separately. No rule creation/settings/actual writes are authorized by this build. |
| Note effects | Build real incumbent observer/parser equivalence tests with synthetic account map, plan, tags and current category catalog; compare all derived ownership/classification/payment effects at original and destination categories. | Category-only can be considered first. Notes remain separately off until parser proof and exact note permission are reviewed and approved. |
| Product wiring | Install the reviewed authority/attestor dependencies behind an explicit disabled configuration and couple conditional tools, metadata and step-up to the same capability state. Verified HTTP client forwarding is already implemented in the MCP adapter. Test default construction, withheld scope, mixed batches, full HTTP JWT client binding and revoked grants. | Approve exact resource/deployment and issuer consent for the additional scope. Existing read/write tokens acquire no new grant implicitly. |

All build/test items can be prepared disabled with synthetic data under the
current request. Installing persistent household access, accepting household
evidence, widening issuer consent or enabling execution requires a separate
exact owner approval. No broad activation approval is requested for an
unfinished adapter. Green foundation tests are not end-to-end readiness.
Independent advisory review of 94ef3d2 identified the missing adapter/provenance
and commit/reply-loss problems; this revision addresses contract/wiring and
synthetic negative controls, while actual-store and real-parser proof remain
open. It is not a Systems PASS.

Before activation, Dale must approve the exact reviewed implementation SHA,
deployment/resource, verified subject and client, provider budget/credential
binding, named account/date/category/evidence scope, notes permission, expiry,
attempt ceiling, revocation method, private audit storage/access/retention and
the issuer's additional permission/consent. This must be a separate exact
approval after the adapter and provider semantics are concrete and reviewed.
That approval cannot authorize splits, payments, rules or Forecast changes
through this capability. Atlas Contract / Systems Review is required before
merge. This task stops at Draft and performs no activation, deployment, merge,
security setting change, OAuth grant expansion or provider write.
