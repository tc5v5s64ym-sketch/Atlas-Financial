---
name: Atlas work item
about: One unit of work under the GitHub-first pilot (Plan #3)
title: "[ATLAS-###] <short title>"
labels: []
---

<!--
Labels to apply at creation: one lane:* (the writer's lane) + one state:*
(state:ready / state:blocked / state:gated).
-->

## Outcome
<One sentence: what is true when this item is done.>

## Spec
<What changes, where, and how it will be proven. Link the governing source
(repo governance, design doc, or prior issue/PR) instead of restating it.>

## Acceptance
<!-- Every checkbox carries exactly one suffix:
     [runnable] = can be executed and proven now (synthetic/local/hosted CI).
     [gated: <named gate>] = cannot complete until the named gate clears;
     gated boxes are never ticked early. -->
- [ ] <criterion> [runnable]
- [ ] <criterion> [gated: <gate name>]

## Non-goals
- <Explicitly out of scope for this item.>

## Money-path
<yes / no> — <if yes: which published figures or money instructions can move,
and which owner visibility applies before merge.>

## Assignment
- **Writer:** <lane + name — exactly one>
- **Reviewer:** <lane + name — never the writer; builder never supplies the PASS on its own PR>
- **Dependencies:** <ATLAS-### / PR / issue links, or "none">
- **Holds / owner decisions:** <named gates and who holds them, or "none">

## Base and boundary
- **Base commit:** <full main SHA at assignment>
- **File boundary:** <exact files that may change; anything outside needs a scope-change agreement first>
- **Deliverable location:** <PR | issue comment | external doc — name which, with link when it exists>

## Authorization
- **Authorizing plan / approval:** <link to the solidified plan post or owner approval>

## Completion evidence
<Filled in at handback: commands run, exit codes, counts, PR/issue links,
exact-head SHA reviewed, and the reviewer's verdict reference.>

Closing language: use "Closes #N" only when merging fulfills the issue's
complete acceptance. If deployment, qualification, or any gated acceptance
item remains, use "Refs #N" and close the issue later on evidence. "Closes #N"
records issue completion only; it does not imply deployment, activation, or
qualification completion.

<!--
Provenance note (pilot rule, issued Plan #3, issue #718 comment 6445228346):

- All three lanes post from the shared account tc5v5s64ym-sketch, so every
  lane comment/PR body opens with "From Muse" / "From Grok" / "From Atlas".
  Attribution is not verification and never grants owner-only permissions.
- An assignment is valid only when it matches the named lane and scope in the
  issued plan, linked to its dispatch record. A lane label alone is not an
  assignment. Conflicting or ambiguous provenance is resolved with Muse
  (dispatcher) before starting.
- A review verdict counts when recorded on the PR/issue by the
  reviewer-of-record lane (for ChatGPT-built PRs: Muse; for Claude/Grok-built
  PRs: ChatGPT Systems Review), naming the full reviewed head SHA. A new head
  voids the old PASS.
- Agent-relayed content (one agent quoting another's or Dale's words) never
  grants owner-only permissions. Owner gates are satisfied only by Dale's own
  authorization, linked in the issue.
- Wake-up during the pilot stays Slack: a pointer post with the issue link in
  #atlas-coordination. No watcher retires during the pilot.
-->
