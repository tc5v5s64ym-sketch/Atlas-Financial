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
Current server.js also does not pass verified client identity to the service;
activation must wire that field from the verified token, never caller arguments.
Consequently the current production construction cannot use this path.

All ungranted operations keep the interactive tools. Standing schemas accept
only an exact opaque transaction reference, opaque grant/evidence references,
an existing destination category reference and/or notesAppend. They reject
splits, category clearing, replacement notes, amounts, dates, deletions,
balances, accounts, payments, rules, caller-supplied grants and confidence.
Unresolved evidence is refused. No batch endpoint or scheduler is introduced.

A grant must come from an owner-operated trusted authority and contain:

- one explicit owner approval reference, principal and verified client;
- one provider budget and credential version, with the active provider token
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
evidence policy, expire and be resolved. Model text cannot create this record.
A future attestor must mechanically connect the underlying evidence to the exact
transaction/classification; labelling model confidence trusted is unacceptable.

## Trusted adapter and audit contract

The adapter is a server dependency, never an MCP argument. It requires context,
grant, evidence, noteEffects, reserve, finish and suspend methods and durable=true.
The flag describes a reviewed backend contract; it does not prove persistence.
Only a separately reviewed implementation can earn that claim.

context binds the active credential to its provider budget/version and carries
ruleEffects=none-verified only after the single-transaction API's rule
creation/execution effects have been independently verified. Unknown effects
refuse standing corrections. This code does not change provider rule settings.

reserve is the final durable atomic gate. It must recheck the authenticated
subject/client, provider binding, grant revision/expiry/revocation, exact
preview/evidence binding and remaining attempts across all service instances.
It persists the sanitized before/proposed record, exact target/fingerprints privately, and charges an attempt before
the single PUT. A charge is never refunded after a possibly sent write.
Pending/unverified attempts must prevent later writes for that grant until
read-only reconciliation. Restart must not reset limits, replay markers or
unresolved attempts. No general transaction ledger is added.

suspend must durably block the grant after any uncertain provider result or
failed/malformed audit receipt. The service also refuses further use of that
grant in this process. If suspension persistence fails, the pending reservation
must keep every instance blocked; recovery is read-only and owner operated.

finish must durably attach the terminal outcome, readback and opaque actor
attribution to that reservation. A failed or uncertain provider result is
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
category. It must bind a parser revision and compare all ownership, fuel,
merchant/category, payment/transfer/settlement and other derived effects.
Missing or changed effects refuse the write. The implementation adds no second
parser, safe-word allowlist or owner inference. Audit attribution lives in the
receipt rather than being appended to the provider note.

The tests' synthetic effect evaluator proves rejection wiring, not production
parser equivalence. Real observer/map/plan proof is required before activation.

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
durable-before-write audit order and uncertainty/audit-failure blocks.

Required validation: node test/test-assistant-standing-corrections.js,
node test/test-assistant-lunchmoney.js, npm test, incumbent privacy guard and
exact-head CI. A simulated policy or V8 syntax pass is not a Node integration
or full-suite certificate.

The next consumer/closure step is an owner-approved production adapter wired
into the existing server with verified client identity, durable revocation/
attempt/audit behavior, exact evidence attestation and real note-parser proof.
Until that exists, default-off code is a reviewable foundation only.

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
