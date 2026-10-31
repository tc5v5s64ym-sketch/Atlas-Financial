# Private figures evidence

The public figures comment reports counts, not acceptance. An unchanged
comparison may succeed. Changed figures or a missing baseline remain incomplete
until the owner has seen the figure-level diff and reconciled every intended
change against the merge card, as CLAUDE.md requires. A green count formatter,
an evidence receipt, and a builder's assertion do not perform that owner look.

Use an already authorized local private location. Do not upload these files to
GitHub comments, logs, checks, artifacts, or the repository. On Windows, verify
that the destination parent's ACL grants only the authorized owner and system;
POSIX mode bits alone do not establish that boundary. No private delivery service
or credentials are provisioned by this change.

1. Read the live PR metadata through the authorized read-only connection and
   record its full 40-character base and head SHAs privately. Fetch those objects
   and check out the exact head in an isolated full-history clone/worktree.
2. In that checkout run `node scripts/figures-private-diff.js prepare BASE_SHA
   HEAD_SHA ABSOLUTE_PRIVATE_DIRECTORY`, using a new child directory of the
   approved private location. The helper runs each revision's **own** snapshot
   script in a detached checkout, with repository tokens removed. Its private
   `figures.md` preserves identifiers, before/after values and deltas, and names
   both exact revisions. Raw snapshot files and the digest receipt stay private.
   Missing snapshot code, execution/storage failure, an existing output directory
   or a checkout not on the supplied head returns 78 and does not claim review.
3. Re-read live PR metadata. If either SHA moved, discard the comparison as stale
   and prepare fresh evidence. Run `node scripts/figures-private-diff.js verify
   BASE_SHA HEAD_SHA ABSOLUTE_PRIVATE_DIRECTORY` with the newly verified SHAs;
   missing, modified or stale evidence returns 78. Verification proves bytes and
   revisions, not owner reconciliation.
4. Through that authorized private location, the owner looks at every changed
   row and reconciles it against the card. Record the existing review's outcome
   and exact base/head privately; public records may state only that reconciliation
   occurred, its exact revisions and any sanitized disposition. This is the
   existing owner look, not another approval ceremony.

There is currently no verified confidential cross-job delivery/receipt mechanism.
The hosted changed/missing-baseline job therefore stays incomplete; it does not
consume a self-attested receipt or automatically turn acceptance green. If the
owner cannot access the approved private evidence, report that delivery blocker
and keep acceptance withheld. The unchanged job requires no new evidence route.
