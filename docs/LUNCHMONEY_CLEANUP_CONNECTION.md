# Lunch Money cleanup connection — inactive draft

Owner instruction 2026-10-09: finish the editing connection from PR #559 on a
separate branch, preserve its safeguards and original descriptions/notes, add
names/categories/notes/tags/clear transfer labels/reusable cleanup instructions,
run tests and open one draft. No amounts, money movement, deletion, #548 work or
real automatic edits before final access approval.

The branch starts at #559 head a6c2b390849cdf215eaebf784c55f12ea422384c,
which incorporates current main 509f0910aabfe0eadb93a8db7476b4cc70a65764.
Main's interactive schema accepts categories/notes/splits but has no display-name,
tag, transfer-label or reusable instruction inputs. #559 adds its default-off
bounded category authority. Current-state verdict: PARTIALLY FIXED; metadata
cleanup requires code. The owner specifically requested this dependency. The new
draft includes #559's foundation and waits for its disposition before merge;
after #559 merges, refresh this branch from main and review the resulting exact
head. No change is made to either existing pull request or #548's held UI.

## One outcome and its consumer

The existing MCP prepare_lunchmoney_edit → apply_lunchmoney_edit path can preview
and verify one metadata cleanup while retaining the bank's original description
and all prior notes/tags. The live consumer is the already-installed MCP editing
interface; no UI, new financial planner, mailbox access, provider rule, schedule
or ledger is added. Forecast continues to recompute only from observed provider
evidence. This draft does not deploy or configure access.

Names change payee only. original_name and all other unrequested transaction
fields are verified unchanged by a separate provider GET. A name edit is refused
when the original bank description is unavailable. Read rows show
originalBankDescription, its availability, and opaque tag references; missing
tags are unknown, not an empty set. Tag names become available after a catalog
lookup with includeTags=true. Raw provider IDs remain server-side.

Notes use notesAppend, which retains the exact original string, including
whitespace, and appends a newline plus the supplied addition. The legacy notes
input also appends; it cannot replace or clear prior text. The preview shows the
complete resulting notes. Notes beyond the existing size limit are refused.
An exact already-present suffix supplied through notesAppend is retained without
adding a duplicate. No note normalization or rewrite is performed.

Tags use tagRefsAdd and the provider's additional_tag_ids command, never a
replacement tag_ids write. Existing tags must be known and well formed. Each
addition must name an existing active tag. Before dispatch the server rechecks
the tag's identity, name and active status. Readback must contain exactly the
union of original and requested tags, independent of order. Missing tags,
unexpected tags or changed untouched fields make the result write-unverified.

New metadata and recipe previews require already-reviewed, posted, ungrouped,
unsplit transactions. This retains #559's protection against an incidental
review-status change from Lunch Money's update settings. Existing category
selection remains a provider-ledger change, with current category validation;
it does not independently establish Atlas budget classification or household
policy. The incumbent conserving split interface is preserved; recipes cannot
split transactions or contain amounts.

## Clear transfer labels

transferLabel accepts fromAccountRef and toAccountRef from a fresh catalog.
The server resolves the exact account namespaces, requires distinct accounts,
and checks the transaction account against the supplied direction: a provider
debit must be on the from side and a provider credit on the to side. Zero or
unknown direction is refused. Account labels are rechecked before dispatch.

The resulting payee is `Transfer: Bills → Weekly`, for example. The preview
explicitly says this is a display label based on the supplied direction, not
independent proof of a matched transfer. No account association, amount,
category, transfer linkage, balance or financial policy changes merely because
a label is supplied. It never initiates a transfer. Counterparty and purpose
remain caller-supplied evidence.

## Reusable cleanup instructions

prepare_lunchmoney_cleanup_instruction returns portable, strict JSON data. It
makes no provider call or write and grants no authority. The caller may retain
that data and pass it to prepare_lunchmoney_edit with a fresh transactionRef in
another session. Atlas does not persist a new instruction store.

Example returned instruction (synthetic names):

```json
{
  "schema": "atlas-lunchmoney-cleanup-instruction/v1",
  "name": "Receipt cleanup",
  "changes": {
    "payee": "Readable Shop",
    "categoryName": "Household",
    "notesAppend": "Receipt checked.",
    "tagNamesAdd": ["Receipt matched"]
  }
}
```

Each use resolves exact, unique, active current category/tag names. Transfer
recipes identify each account by its exact name and plaid/manual namespace.
Missing, duplicate or ambiguous names fail closed. Renamed categories/tags are
not guessed. Recipes do not select transactions or run over a merchant, date
window or account. No fuzzy target, bulk operation or automatic loop is added.
An instruction already matching the transaction returns no-changes without a
preview or write. This repeat behavior is distinct from retrying an uncertain
write, which is always forbidden.

Every nonempty result is a fresh, subject-bound, expiring, single-use preview.
Show its exact before/proposed contents and obtain confirmation of that preview.
apply_lunchmoney_edit still requires literal confirmed=true and the incumbent
write scope. An instruction, source document, model assertion or instruction
title cannot manufacture confirmation or a standing grant. Transaction and
catalog changes invalidate the preview. An ambiguous response/readback consumes
the preview and must not be retried.

## Provider contract and access hold

Read-only check on 2026-10-09 of the official
[Lunch Money v2.11.1 OpenAPI](https://lunchmoney.dev/v2/openapi) confirms the
separate editable payee/read-only original_name fields, replacing notes, and
additive additional_tag_ids versus replacing tag_ids. The implementation sends
only the selected metadata with update_balance=false and verifies a subsequent
GET. It has no DELETE, money movement or new amount-edit endpoint.

These documented field semantics and synthetic tests do not establish absence
of automatic provider rules or effects on other transactions. PR #559's
[provider-safety/access requirements](STANDING_LUNCHMONEY_CORRECTIONS.md) remain
open. The reusable instruction path requires individual preview confirmation;
it never broadens the category-only standing grant schema to metadata. Notes,
names and tags may affect incumbent Atlas evidence parsing, so a future
automatic metadata path requires its own exact owner permission and real parser
proof. No such automatic metadata path is installed here.

The standing runtime remains default-off. No private store/key/grant is created,
no environment flag is changed, no consent is granted, no connection is replaced,
no real provider write is tested, and no deployment or merge is performed.
Final access approval and exact-head Atlas Contract / Systems Review are still
required before activation/merge where applicable. The builder cannot supply
its own Systems PASS.

## Proof and limits

test/test-assistant-cleanup.js exercises the real service and official MCP SDK
against independently authored synthetic provider behavior. It checks exact
wire fields, byte-preserved notes/original description/metadata, signed amount
and account preservation, additive tags, debit/credit transfer labels, portable
recipes across fresh instances, repeat no-op, uncertain results, stale/expired
previews, wrong-subject/scopes, forbidden fields and changed/missing catalogs.
The expected PUT body and preservation values are fixture facts, not outputs
of a second invocation of the implementation.

The test is registered in npm test and the focused standing workflow. Existing
interactive, provider-amount, balance, standing-authority, real-store and HTTP/JWT
proofs remain applicable. The private durable authority intentionally requires
POSIX; Windows cannot certify its fsync/permissions/locking contract. Linux CI
on the final exact head is required for the full certificate. Synthetic tests
prove Atlas behavior, not a live connection or provider side-effect exemption.
