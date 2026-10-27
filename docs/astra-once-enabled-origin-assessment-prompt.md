# Once-enabled-origin rollback — independent assessment prompt (Astra)

**Status:** prompt of record, prepared by Muse on 2026-10-27 at Dale's direction, following the ATLAS-080 assessment (issue #721, Blocker B6). It commissions an assessment only — no code, no repo changes, no credentials, no live data. The prompt text below is what gets sent.

---

You are acting as the independent architecture/security assessor for one bounded problem in the Atlas Financial repo (github.com/tc5v5s64ym-sketch/Atlas-Financial). This is a DESIGN ASSESSMENT ONLY: no code, no repo changes, no credentials, no live data, synthetic examples only.

THE PROBLEM — once-enabled-origin rollback:
Atlas's Savings write path has never been activated in production. Today the server can safely assert "never activated" because that is true of this release. Once Savings is ever enabled on an origin (a deployment/host), that fact must become permanent history. The hazard: if the app is later rolled back — binary, configuration, or whole deployment restored to a pre-activation state — the rolled-back copy must NOT be able to claim "never activated" again and publish baseline (pre-activation) inputs as if activation never happened. A pre-activation exemption that can be revived by rollback is a silent safety failure.

An independent assessment of the saved-corrections design (issue #721, ATLAS-080) isolated this as Blocker B6 and an open question: "What mechanism will enforce once-enabled-origin history outside rollbackable application binaries/configuration?" The anchor design (issue #756) guards settlement and planned-input stores against rollback, but its proposed records do not yet establish this origin lifecycle. This assessment is to determine whether a mechanism exists, and if so what it is — or to prove rigorously that it requires an external record, and specify exactly what that record must be.

SETTLED RULES — do not relitigate these; design within them:
- Activation is a separate, explicit owner decision. Nothing in your design activates anything, and "the assessment ran" is not activation evidence.
- Forecast is the sole financial calculation authority. Origin history is an authority/eligibility fact, never a calculation input.
- Unknown is not "never activated": if origin history cannot be read or cannot be trusted, the origin must fail closed (refuse the pre-activation exemption), never default to never-activated.
- No automatic replay: a restored or retried state must not silently re-establish or erase activation history.
- Fencing is a known UNSOLVED problem on an accepted-risk track. Do not design a fencing mechanism; if your mechanism needs one, say so and mark it OPEN.
- The anchor/currentness design (issue #756) is a dependency under revision, not an established guarantee. You may propose that it carry this record, but you must state exactly what it would need to add — do not assume it already covers this, and do not design a competing anchor authority.
- No new recurring charges in any recommendation without flagging it as an explicit owner decision.
- Privacy: origin history contains no household financial content — if your design would store any, flag that as a defect in the design, not a feature.

YOUR ASSESSMENT MUST ANSWER:
1. Threat model: enumerate the rollback vectors precisely (binary downgrade, config restore, whole-VM/container restore, database-only restore, fresh redeploy pointing at old data, operator error) and for each, what a "never activated" claim would wrongly permit.
2. The record: what exactly is stored for "this origin was enabled at least once" (fields, identity of the origin, monotonicity, timestamps and their limits), where it lives, and which single component is its authority. Define "origin" precisely enough that a redeploy, a hostname change, and a storage migration can each be classified.
3. The check: where in startup/publication the once-enabled fact is consulted, what happens on each read outcome (present, proven-absent, missing, malformed, stale, store unavailable), and why proven-absent is distinguishable from not-yet-checked.
4. Survival argument: for each rollback vector in (1), show step by step why the record survives it or admit it does not. A mechanism that lives anywhere the rollback can reach is not a mechanism — say so plainly if that is your conclusion.
5. Interaction: how this record interacts with the issue #756 anchor/currentness design and the ATLAS-080 planned-input domain — one authority or explicitly separated domains, and what must never be conflated.
6. Qualification: the exact evidence (tests, drills, restore exercises) that would prove the property before activation is allowed — including the drill where a synthetic origin is activated, rolled back to its pre-activation release, and must refuse the pre-activation exemption from a cleared browser and a new device.
7. Slicing: if a sound mechanism exists, the smallest independently-reviewable build slices in dependency order, each with its file boundary. If it does not exist without an external record, specify that record's minimum properties instead and mark the slices BLOCKED on it.

DELIVERABLE: one document with those seven sections, findings rated blocker/major/minor, and a final short list titled "Owner decisions" — anything only the household owner can decide, in plain language. If a question cannot be answered from this prompt, list it under "Open questions" rather than speculating. Before writing, you may ask me at most three focused questions if an ambiguity would change the design; otherwise proceed.
