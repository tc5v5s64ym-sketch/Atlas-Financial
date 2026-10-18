# Private planned-cost correction contract — ATLAS-080

**FOUNDATION - NOT COMPLETION. No persistence writer, storage destination,
production caller or activation exists in this slice.**

Dale's 17 October 2026 instruction resumes implementation in the saved completion
plan's dependency order. ATLAS-080 is the distinct prerequisite for private
planned-cost corrections supporting Savings ATLAS-025. The earlier documentation
pause is superseded; storage, access, operation and activation decisions are not.
The existing transaction editor and payment-choice store do not edit planned costs.
The completion plan and current backlog remain the outcome/status sources; this
document describes this bounded contract and its proposed operational boundary.

## Current-main evidence and boundary

At base `7846f672851d663c8e7ad7d85d849524d98788a8`, native planned requirements
live on commitments, yearly bills and budget reserves. There is no private
planned-cost correction path. `card-payment-decision-store.js` stores payment
interpretations; `private-period-history.js` retains observations. Neither owns
planned inputs. This is a **missing capability**, not a Forecast repair.

`scripts/planned-input-contract.js` supplies pure JSON transitions only, following
the incumbent versioned/checksummed document, revision binding and explicit
adoption conventions. It imports only Node crypto. It reads no file, environment,
credential or provider. No production module imports it. The only current consumer
is `test/test-planned-input-contract.js` with invented data. A caller cannot enable
persistence with a flag because no adapter is included.

The next consumer is the server-owned effective-plan input composition before
observer history selection and Forecast publication, shared by browser and
assistant. That live caller does not yet exist. It requires a separate file
handoff, approved storage and operator-access contracts, exact-head Systems Review
and connected tests.
Financial computations remain in Forecast. This module produces no allocation,
payment, balance, funding verdict or Paid state.

## Bounded input and revision contract

- Stable targets are `commitment:<native id>` from `plan.commitments[].id`.
  Labels, array indexes, occurrence dates and display groups are never identities.
  Missing/duplicate IDs reject. Reordering preserves identity; source renaming
  changes the fingerprint and invalidates old previews. Group members keep their
  native IDs. Bill/reserve namespaces and group-wide atomic edits are deferred.
- Explicit adoption takes the exact complete commitment inventory and a separately
  accepted fingerprint. It preserves every original row and its metadata. No
  repository data is read or migrated automatically. The document schema is
  `atlas-private-planned-inputs/v1`; commands have version 1. Unknown schemas,
  missing/corrupt data and rollback fail closed, never become an empty plan.
- `correct` changes only `amount` and/or `date` on an unsettled point commitment
  whose confidence is `estimated` or `unknown`. Its confidence stays unchanged.
  Amount accepts nonnegative finite cents or explicit unknown; date accepts a real
  ISO calendar date or explicit unknown only without a retained `when` fallback.
  Any native `settledOn` metadata refuses correction/removal conservatively;
  settlement parsing stays with Forecast. Trust promotion, settled rows, ranges,
  amount schedules and payment-timing contracts are outside this first slice.
  They require separately qualified semantics, not broader patch keys.
- `remove` is an explicit tombstone in effective inputs, not settlement, payment,
  deletion of history or release of a savings earmark. `retract` targets the exact
  current operation and restores its immediate predecessor as a new dated revision.
  It can restore a removed requirement. Stale heads cannot fork. Further edits
  must name the new head. No operation alters original retained rows.
- The private preview binds an opaque caller-context token (`actorId`), household,
  unique operation ID, command, source fingerprint, exact document digest/revision
  and ten-minute expiry. Actor-token equality provides request continuity only;
  this module neither authenticates that token nor establishes a named person or
  permission to edit. A future authenticated, authorized server caller must resolve
  the context, retain the preview server-side and render the exact before/after
  proposal privately. The digest is an integrity check, not an authentication
  credential or a substitute for explicit user confirmation. Browser-supplied
  preview objects, actor IDs and timestamps are not trusted.
- `confirmCandidate` validates the retained preview and the confirmed digest and
  returns new bytes plus expected/next pins. Its status is **candidate**, never
  saved. Rejected/stale previews have no state effect. One operation ID binds one
  request; matching recorded requests recover a receipt, conflicting reuse rejects.
  Outcome lookup matches the supplied actor-context token and household. Audit
  revisions retain before/after, command, that context token, operation ID, request
  digest and monotonic recorded time; they do not prove named-person attribution.
- Composition replaces the exact native rows once in memory and retains native
  order. The complete legacy inventory must still match. Source drift fails closed
  and needs explicit reconciliation; it must not silently rebase or revive public
  legacy inputs. No patch reaches actual accounts, provider transactions or stored
  closed-period records. The caller must never compose today's inputs into an old
  original close.

All documents, previews, pins, receipts and composed rows are **private**. Fixed
error text avoids leaking input values, but this is not a transport/authentication
layer. Checksums detect accidental damage; a malicious authorized writer can
recompute them. Inputs are bounded to 200 commitments, 1,000 operations and 2 MiB.
Reaching a limit fails closed; this slice has no compactor or automatic migration.

## Concrete operational proposal — not approved or installed

Propose one versioned file named `planned-inputs.json` in a dedicated
`/var/lib/atlas-private/planned-inputs/` directory on a **persistent POSIX volume
attached to the single Atlas application writer**. The path is a proposal only;
the hosting plan/volume, exact mount and operational owner have not been selected
or qualified. Render's current ephemeral filesystem does not qualify. This task
adds no disk, service, paid plan, directory, setting, credential or permission.

Before any production writer is implemented, Dale must approve this destination
and the following access/operation/backup/migration contract, or select a concrete
alternative. Any hosting cost or access change needs its own explicit decision.

1. **Isolation:** dedicated service UID; owner-only directory/file permissions;
   outside every repository, worktree, static root, logs and public artifacts;
   refuse symlink components, hard-linked files, wrong owner/mode or replaced root.
   The existing shared household-password login issues a signed expiry-only
   session. It does not establish named-person identity or Dale-only correction
   authority. Before implementing a writer or live caller, approve the permitted
   operator scope and qualify its server-side enforcement and audit attribution.
   Private scope must be server-resolved under that approved access choice. This
   foundation grants no write authority and implements no authentication change.
2. **One writer:** exactly one application instance with an exclusive lock around
   read, exact digest/revision compare, transformation, write and readback. Include
   administration and restore tools in this exclusion. No overlapping deployment
   writers or independent filesystem editors. A lock is not stolen by age; an
   orphan lock withholds writes until inspected through a reviewed recovery path.
3. **Atomicity/durability:** write the complete state and operation receipt together
   to an exclusive private temporary file on the same volume; sync the file,
   atomically replace, sync the directory, then read/validate the exact next pin
   before reporting success. A changed expected pin rejects the whole operation.
   Unsupported filesystem durability fails closed. A crash or lost reply is
   unknown until outcome lookup; never automatically retry an uncertain write.
4. **Backup:** after durable readback, retain an encrypted copy plus the household,
   revision and full-document digest on a separately controlled owner-private
   backup destination. Proposed custody is an owner-held encrypted backup outside
   the service volume; the device/location, retention, encryption mechanism and
   operator must be approved before implementation. No encryption key is added
   here. Service disk snapshots alone are not this independent recovery receipt.
5. **Restore:** stop/exclude all writers, inspect the latest independently held
   successful pin, verify backup bytes against it, and validate schema/history.
   An older valid backup is not silently accepted as latest. Missing latest bytes
   remain a disclosed recovery gap and writes stay withheld. Install only through
   a reviewed atomic recovery adapter, restart, read back and reconcile. Never
   fall back to the public baseline after newer private operations.
6. **Legacy cutover:** inventory exact native commitments privately, obtain approval
   of the exact fingerprint, adopt once, then make private composition the sole
   effective authority for those IDs. Keep public legacy data read-only as retained
   baseline evidence; it must not be a fallback or parallel write destination.
   Current source drift blocks until a bounded reviewed migration. Bill/reserve
   support, grouped edits and physical removal of legacy publication are separate
   closure work; no general canonical-store migration is authorized here.

The writer and live caller must prove lock/crash behavior, real filesystem sync,
restart and redeploy survival, backup restoration and authorized household
isolation on that approved destination. The existing card file adapter explicitly
does not qualify Windows storage. This slice makes no POSIX/Windows/Render
durability claim and installs no adapter from another domain.

## Proof and remaining closure

Run the new suite explicitly:

```text
node test/test-planned-input-contract.js
```

It exercises pure contract behavior with synthetic state and a serialized memory
adapter, competing previews, exact readback, uncertain outcomes and restoration
against an independently retained pin. Those are contract/serialization proofs,
not persistent-storage, deployed restart or live household acceptance.
The parent-designated registry writer added this suite to `test/test.js` in
`992d95e768926ff3dc76c0857c06721abc39aa0f`. It is now selected by `npm test` and the
standard CI group. Registration alone does not prove execution or a passing run;
record exact-head hosted outcomes and standalone execution separately.

Required next decisions/work: approve the concrete storage/access/backup/migration
contract; obtain shared-file and Forecast handoffs;
implement and qualify the approved writer; integrate a single effective input path
and exact private preview/confirmation; prove downstream Forecast recalculation
and private correction/removal acceptance. Paid behavior stays under ATLAS-025/024
with ATLAS-042/044 payment evidence; immutable full-view history under 046/047.
Neither is implemented here. No real inputs are changed.

This candidate requires independent Atlas Contract / Systems Review because it
defines a private schema/authority boundary. A builder/advisory pass is not that
review. Draft publication does not authorize merge, activation or completion.
