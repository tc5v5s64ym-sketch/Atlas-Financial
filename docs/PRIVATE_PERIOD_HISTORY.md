# Private pay-period retention

**FOUNDATION — NOT COMPLETION. Automatic retention and Sheet writes are not active.**

Owner instruction, 2026-10-09: preserve financial pay-period history and populate
the owner's private reporting Sheet. This code-only slice can capture an
existing observation, append it privately, and retrieve the frozen publication.
It adds no provider transport, credential store, server route, scheduler,
infrastructure, financial policy, canonical writer, or Sheet connection.

Forecast remains the sole calculator/classifier. `scripts/private-period-history.js`
uses incumbent observer normalization, `Live.fromObservation`, operating-answer
options and `Forecast.recommend`. It selects one native `payPeriodViews` row;
it does not calculate category totals, historical targets, income, bills or BAD.
Current policy cannot become an original historical plan. Native nulls, zeros,
trust labels and coverage limits are retained unchanged.

## Private interface

`capture(input)` is in-memory only. Input is an already-read private JSON object
containing `data`, `payload`, `accountMap`, `identity`, `periods` (the existing
monthly source, possibly empty), optional
exact Forecast cycle `periodStart`, and `kind` (default `first-observed`). No
implicit current data, account map, identity policy or monthly source is loaded
as financial input. The existing operating projector reads its default monthly
file while composing options, but the caller's explicit `periods` replaces it
before Forecast runs. Input is not changed. The engine commit is read from Git,
and loaded transitive financial source files are hashed; a dirty financial
engine is refused rather than falsely attributed to a committed version.
Capture time belongs to the runtime clock. A caller-supplied `capturedAt` is
refused, so an old source fetch cannot be backdated into an original opening
publication. The in-process synthetic-clock seam is for isolated tests and is
not exposed by the CLI or an activation setting.
The existing live-map validator is required; fixture maps cannot authorize a
private production capture. Synthetic tests supply invented identities under
the same schema and perform no live GET or real capture.

`append({destination, candidate, enabled})` defaults to disabled and requires
`enabled: true`. The destination must already exist outside every Atlas
worktree and any other repository/bare repository. Public/static directory
segments and symlink components are refused. POSIX destinations must be owned
by the current user with no group/other access. Credentials/session/environment
objects and secret-like keys are refused. Never include authentication values
in financial notes or other source strings.

`read({destination})` returns metadata only. `read({destination, revisionId})`
returns a validated private record in-process for an authorized local consumer.
An optional `expectedHead` pins the last successful revision receipt and detects
tail truncation during recovery; a hash chain alone cannot detect removal of an
entire final suffix without that independent receipt or backup manifest.
`replayPublication(record)` uses frozen refreshed state and exact Forecast
options, checks the retained engine file hashes, and verifies equality with the
stored publication. It cannot substitute today's policy. Original provider
inputs are also retained for a later observer replay, with stable IDs, original
merchant, notes/tags, split/pending links and available source update timestamps.

Local operator commands:

```text
node scripts/private-period-history-cli.js capture --input <existing-private-input.json>
node scripts/private-period-history-cli.js capture --input <existing-private-input.json> --destination <verified-private-directory> --enable-private-history
node scripts/private-period-history-cli.js list --destination <verified-private-directory>
node scripts/private-period-history-cli.js inspect --destination <verified-private-directory> --revision <revision-id>
```

The first command previews metadata with capture disabled. Every CLI command
prints metadata or a fixed error code, never financial rows, source identities,
private paths or provider failures. The next reporting consumer is an explicitly
activated private runner and allowlisted aggregate Sheet mirror. Neither exists
as part of this PR; this is not a production-history completion claim.

## Versioned publication/evidence contract

`atlas-private-period-history/v1` records the Forecast cycle start/end inclusive
and household timezone; capture time separately from financial as-of and source
fetch time; engine commit/file fingerprints; source, policy, map and identity
fingerprints; source completeness/pending/observation receipts; native publication;
and private replay evidence. Records have a global sequence, SHA-256 revision ID,
previous revision, baseline reference and capture checksum. These detect damage
and accidental modification; they are not cryptographic authentication against
a malicious process with the same user's filesystem access.

- `original`: the first qualified observation on the opening household day.
  Both source fetch and capture must fall on that day, financial as-of must
  equal the cycle start, and the overlay must be applied. This does not assert
  a midnight/pre-transaction cash snapshot. Native opening uncertainty remains.
- `first-observed`: the initial observed baseline; original opening unavailable.
- `reconstructed`: a completed-period publication using the captured current
  policy, explicitly not the missing original historical plan.
- `plan-amendment`: requires an existing baseline, separate `declaredAt` and
  `effectiveFrom`, a revision reason, and preserves that baseline. Those are caller-supplied owner
  evidence, not inferred approval or a new policy authoring path.
- `closing`: one observed publication after period end; as-of must reach its
  end. Source coverage and native unavailable values can remain incomplete.
  A paginated-complete fetch does not prove all bank postings are final.
- `actual-correction`: requires a closing observation and appends another
  revision with a reason for changed posting, categorization, source/config or engine evidence.

Opening baselines and closing observations cannot be replaced. A matching retry
returns the existing revision. Identical financial/source content at a later
fetch/capture clock is a no-op; changed private evidence remains a revision even
when the published amounts agree. Prior periods without captured originals keep
that gap. No retention pruning or automatic deletion is implemented.

## Atomicity, recovery and activation boundary

One exclusive `.capture.lock` serializes writers. One revision file contains
publication plus evidence, avoiding cross-file partial commits. A random private
staging file is flushed; an atomic same-directory hard link publishes it without
replacement; the directory is flushed before success. Incomplete staging files
are ignored. Chain gaps, unknown schema, checksum mismatch, symlink entries or
missing evidence fail reads closed. No stale lock is cleared automatically.

After a crash, an operator must establish that the writer has stopped, validate
the committed chain, and only then remove its stale lock. Preserve committed
JSON files. Staging leftovers can be excluded from backup; a committed revision
is complete even when its staging hard link remains. Retry returns that revision.
An I/O failure after publication has an uncertain outcome; inspect/retry rather
than inventing success. Directory fsync/hard-link support is required and must
be proved on the actual runner/filesystem. Windows ACLs and durability are not
certified by Linux tests. The directory must be under trusted single-owner
control; concurrent hostile processes with the same user are outside this boundary.

Before activation, verify the exact private path, filesystem permissions and
durability, existing GET-only account mapping/access, committed engine, runner
availability, opening/closing capture rule and late-correction refetch cadence.
Capture only refetched source windows; this interface adds no historical polling.
Prove backup and restore into another private directory with every revision hash
intact. The documented owner-PC/OneDrive arrangement is a possible existing
destination, not verified here. `backup-raw.ps1` mirrors deletions and does not
already back up this separate archive or guarantee deletion recovery.

The free Render filesystem is ephemeral and no durable disk is configured.
A paid disk, new hosted storage, persistent credential/OAuth grant, security
change or scheduled job requires separate owner authorization. The PRIVATE Sheet
is a read-only reporting mirror until a supported already-authorized connection
is verified for its writer; ChatGPT connector access is not Atlas runtime access.
Only allowlisted aggregates/provenance may leave the private evidence boundary.
No raw archive belongs in Git, CI artifacts/logs, a PR, browser, or public output.

This schema/private write boundary requires Atlas Contract / Systems Review on
the completed implementation head under `CLAUDE.md`. This document supplies no
merge approval and does not weaken existing canonical/provider approval paths.
