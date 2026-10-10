'use strict';
// Isolated transaction-edit form: adapter safety contract, uncertain-save
// verification protocol, and rendering safety. All fixtures are synthetic
// and invented here; the adapter is the in-memory mock from the component.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const TE = require('../public/transaction-edit');

const CATS = [
  { id: 'cat-groceries', name: 'Groceries' },
  { id: 'cat-dining', name: 'Dining out' },
  { id: 'cat-transport', name: 'Transport' },
];
function txn(overrides) {
  return {
    id: 'syn-tx-00', displayName: 'Corner Grocery',
    originalDescription: 'SQ *CORNER GROCERY 4417 MAPLE RIDGE BC',
    amount: 42.18, date: '2026-09-14', account: 'Synthetic Chequing',
    categoryId: 'cat-groceries', version: 3, ...(overrides || {}),
  };
}
function setup(overrides, script) {
  const seed = txn(overrides);
  const adapter = TE.createMockAdapter([seed], script || {});
  const settled = [];
  const form = TE.createForm({
    transaction: seed, categories: CATS, adapter,
    onSettled: result => settled.push(result),
  });
  return { seed, adapter, form, settled };
}

async function prepareDiffAndNoMutation() {
  const { seed, adapter, form } = setup({ id: 'syn-tx-01' });
  form.setName('Corner Grocery & Deli');
  form.setCategory('cat-dining');
  const preview = await form.preview();
  assert.equal(form.state(), 'preview');
  assert.deepEqual(preview.changes, [
    { field: 'displayName', label: 'Name', from: 'Corner Grocery', to: 'Corner Grocery & Deli' },
    { field: 'categoryId', label: 'Category', from: 'cat-groceries', to: 'cat-dining' },
  ]);
  assert.equal(preview.baseVersion, 3);
  assert.deepEqual(adapter.snapshot(seed.id), seed, 'prepare must not mutate the store');
  assert.match(form.html(), /Corner Grocery &amp; Deli/);
  assert.match(form.html(), /Dining out/);
}

async function noChangeDisablesPreview() {
  const { adapter, form } = setup({ id: 'syn-tx-02' });
  assert.equal(form.canPreview(), false);
  assert.match(form.html(), /data-action="preview" disabled/);
  assert.equal(await form.preview(), null);
  assert.equal(adapter.calls.prepare, 0, 'no prepare call when nothing changed');
  // Editing back to the baseline value is also "no change".
  form.setName('Something Else');
  assert.equal(form.canPreview(), true);
  form.setName('Corner Grocery');
  assert.equal(form.canPreview(), false);
  assert.equal(await form.preview(), null);
  assert.equal(adapter.calls.prepare, 0);
}

async function validationBlocksPrepare() {
  const { adapter, form } = setup({ id: 'syn-tx-03' });
  form.setName('   ');
  assert.match(form.html(), /Enter a name\./);
  assert.equal(await form.preview(), null);
  form.setName('x'.repeat(81));
  assert.match(form.html(), /80 characters or fewer/);
  assert.equal(await form.preview(), null);
  form.setName('A Perfectly Fine Name');
  form.setCategory('cat-does-not-exist');
  assert.match(form.html(), /Choose one of the existing categories\./);
  assert.equal(await form.preview(), null);
  assert.equal(adapter.calls.prepare, 0, 'validation blocks every prepare call');
  form.setCategory('cat-dining');
  assert.ok(await form.preview(), 'valid input prepares');
  assert.equal(adapter.calls.prepare, 1);
}

async function staleAfterVersionMoves() {
  const { seed, adapter, form } = setup({ id: 'syn-tx-04' });
  form.setName('My New Name');
  const first = await form.preview();
  adapter.mutateExternally(seed.id, { displayName: 'Changed By Someone Else' });
  const result = await form.apply();
  assert.equal(result.outcome, 'stale');
  assert.equal(form.state(), 'stale');
  assert.equal(adapter.snapshot(seed.id).displayName, 'Changed By Someone Else',
    'the stale preview applied nothing');
  const html = form.html();
  assert.match(html, /changed since your preview/);
  assert.doesNotMatch(html, /data-action="apply"/, 'a stale preview offers no apply');
  assert.match(html, /data-action="reprepare"/);
  // Explicit reprepare: fresh preview against current values, then apply.
  const second = await form.reprepare();
  assert.ok(second && second.id !== first.id);
  assert.equal(second.changes[0].from, 'Changed By Someone Else');
  assert.equal(second.baseVersion, 4);
  const applied = await form.apply();
  assert.equal(applied.outcome, 'applied');
  assert.equal(adapter.snapshot(seed.id).displayName, 'My New Name');
}

async function duplicateApplyClicks() {
  const { adapter, form } = setup({ id: 'syn-tx-05' });
  form.setName('Once Only');
  await form.preview();
  const [a, b] = await Promise.all([form.apply(), form.apply()]);
  assert.equal(a.outcome, 'applied');
  assert.equal(b, null, 'the duplicate call is refused by the single-flight guard');
  assert.equal(adapter.calls.apply, 1, 'adapter.apply ran exactly once');
  assert.equal(await form.apply(), null, 'no apply after settlement either');
  assert.equal(adapter.calls.apply, 1);
}

async function applyThrowUncertain() {
  const { seed, adapter, form } = setup({ id: 'syn-tx-06' }, { nextApply: 'throw-before-mutate' });
  form.setName('Uncertain Name');
  const preview = await form.preview();
  const result = await form.apply();
  assert.deepEqual(result, { outcome: 'uncertain' });
  assert.equal(form.state(), 'uncertain');
  assert.equal(adapter.calls.apply, 1);
  assert.equal(await form.apply(), null, 'an uncertain preview can never be applied again');
  assert.equal(adapter.calls.apply, 1, 'no second apply was attempted');
  const html = form.html();
  assert.match(html, /couldn’t confirm whether this change saved/);
  assert.match(html, /do not assume it saved/);
  assert.doesNotMatch(html, /data-action="apply"/);
  assert.match(html, /<fieldset class="txe-fields" disabled>/, 'the form is locked');
  assert.match(html, /data-action="recheck"/, 'the only recovery is an explicit re-check');
  const note = TE.pendingNotes.get(seed.id);
  assert.deepEqual(note, {
    txnId: seed.id, previewId: preview.id, baseVersion: 3,
    intendedChanges: [{ field: 'displayName', from: 'Corner Grocery', to: 'Uncertain Name' }],
  }, 'the pending-verification note is recorded exactly');
  assert.equal(adapter.snapshot(seed.id).displayName, 'Corner Grocery', 'throw-before-mutate wrote nothing');
  // In-form re-check: the adapter attests not-applied, so the form unlocks
  // on the verified snapshot — still without any further apply call.
  assert.equal(await form.recheck(), 'editing');
  assert.equal(TE.pendingNotes.get(seed.id), null, 'attestation cleared the note');
  assert.equal(form.baseline().displayName, 'Corner Grocery');
  assert.match(form.html(), /did not save/);
  assert.equal(adapter.calls.apply, 1);
  TE.pendingNotes.clear(seed.id);
}

async function closeReopenOldPreviewUnusable() {
  const { seed, adapter, form } = setup({ id: 'syn-tx-07' });
  form.setName('Doomed Preview');
  await form.preview();
  form.close();
  assert.equal(form.isClosed(), true);
  assert.equal(form.html(), '');
  assert.equal(await form.apply(), null, 'a closed form cannot apply its old preview');
  assert.equal(adapter.calls.apply, 0);
  const fresh = TE.createForm({ transaction: adapter.snapshot(seed.id), categories: CATS, adapter });
  assert.equal(fresh.state(), 'editing', 'a reopened form starts fresh');
  assert.equal(await fresh.apply(), null, 'the reopened form holds no preview to apply');
  assert.equal(adapter.calls.apply, 0);
  assert.equal(adapter.snapshot(seed.id).displayName, 'Corner Grocery');
}

async function closeWhileApplyingSettlesViaCallback() {
  const seed = txn({ id: 'syn-tx-08' });
  const base = TE.createMockAdapter([seed]);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const adapter = {
    prepare: base.prepare, status: base.status, outcome: base.outcome,
    apply: async id => { await gate; return base.apply(id); },
  };
  const settled = [];
  const form = TE.createForm({ transaction: seed, categories: CATS, adapter,
    onSettled: r => settled.push(r) });
  form.setName('Settled While Closed');
  await form.preview();
  const inFlight = form.apply();
  form.close();
  release();
  const result = await inFlight;
  assert.equal(result.outcome, 'applied');
  assert.deepEqual(settled, [{ outcome: 'applied', txnId: seed.id, version: 4 }],
    'the in-flight result is reported to onSettled, never assumed by a form');
  const reopened = TE.createForm({ transaction: base.snapshot(seed.id), categories: CATS, adapter: base });
  assert.equal(reopened.state(), 'editing', 'no note exists, so no verification gate');
}

async function closeWhileApplyingThrows() {
  const seed = txn({ id: 'syn-tx-09' });
  const base = TE.createMockAdapter([seed], { nextApply: 'throw-after-mutate' });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const adapter = {
    prepare: base.prepare, status: base.status, outcome: base.outcome,
    apply: async id => { await gate; return base.apply(id); },
  };
  const settled = [];
  const form = TE.createForm({ transaction: seed, categories: CATS, adapter,
    onSettled: r => settled.push(r) });
  form.setName('Saved Behind A Closed Form');
  await form.preview();
  const inFlight = form.apply();
  form.close();
  release();
  assert.deepEqual(await inFlight, { outcome: 'uncertain' });
  assert.equal(settled.length, 1);
  assert.equal(settled[0].outcome, 'uncertain');
  assert.ok(TE.pendingNotes.get(seed.id), 'the note is recorded even though the form was closed');
  const reopened = TE.createForm({ transaction: seed, categories: CATS, adapter: base });
  assert.equal(reopened.state(), 'verify-first', 'the reopened form must verify before editing');
  assert.equal(await reopened.verify(), 'editing');
  assert.equal(reopened.baseline().displayName, 'Saved Behind A Closed Form');
  TE.pendingNotes.clear(seed.id);
}

function escapingAndReadOnlyRendering() {
  const hostile = {
    id: 'syn-tx-10', displayName: '<img src=x onerror=alert(1)>',
    originalDescription: '<script>alert(2)</script>',
    amount: 42.18, date: '2026-09-14', account: 'A "quoted" <b>account</b>',
    categoryId: 'cat-x', version: 1,
  };
  const adapter = TE.createMockAdapter([hostile]);
  const form = TE.createForm({ transaction: hostile,
    categories: [{ id: 'cat-x', name: '<svg onload=alert(3)>' }], adapter });
  const html = form.html();
  assert.doesNotMatch(html, /<img|<script|<svg/, 'no live hostile markup — everything is escaped text');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
  assert.match(html, /&lt;svg onload=alert\(3\)&gt;/);
  // Read-only facts render as text in a definition list — never as inputs.
  assert.equal((html.match(/<input/g) || []).length, 1, 'only the name field is an input');
  assert.equal((html.match(/<select/g) || []).length, 1, 'only the category field is a select');
  assert.match(html, /<dl class="txe-kv">/);
  assert.match(html, /\$42\.18/);
  assert.doesNotMatch(html, /<input[^>]*42\.18/, 'the amount is never an input value');
}

async function mockApplyIdempotent() {
  const seed = txn({ id: 'syn-tx-11' });
  const adapter = TE.createMockAdapter([seed]);
  const preview = await adapter.prepare(seed.id, { displayName: 'Idempotent Name' });
  const before = adapter.snapshot(seed.id);
  assert.deepEqual(before, seed, 'prepare did not mutate');
  const first = await adapter.apply(preview.id);
  const second = await adapter.apply(preview.id);
  assert.deepEqual(first, { outcome: 'applied', version: 4 });
  assert.deepEqual(second, first, 'second apply replays the recorded outcome');
  assert.equal(adapter.snapshot(seed.id).version, 4, 'the store mutated exactly once');
}

async function appliedUpdatesBaseline() {
  const { seed, adapter, form } = setup({ id: 'syn-tx-12' });
  form.setName('New Baseline');
  form.setCategory('cat-transport');
  await form.preview();
  const result = await form.apply();
  assert.equal(result.outcome, 'applied');
  assert.equal(form.state(), 'applied');
  assert.deepEqual(form.baseline(), { displayName: 'New Baseline', categoryId: 'cat-transport', version: 4 });
  assert.match(form.html(), /Changes saved/);
  assert.match(form.html(), /New Baseline/);
  assert.match(form.html(), /Transport/);
  form.editAgain();
  assert.equal(form.state(), 'editing');
  assert.equal(form.canPreview(), false, 'the saved values are the new baseline — nothing to preview');
  assert.equal(adapter.snapshot(seed.id).version, 4);
}

async function rejectedFlow() {
  const { form } = setup({ id: 'syn-tx-13' }, { nextApply: 'reject' });
  form.setName('Refused Name');
  await form.preview();
  const result = await form.apply();
  assert.equal(result.outcome, 'rejected');
  assert.equal(form.state(), 'rejected');
  assert.match(form.html(), /Synthetic adapter rejection/);
  form.editAgain();
  assert.equal(form.state(), 'editing');
}

async function reopenAttestedAppliedClears() {
  const { seed, adapter, form } = setup({ id: 'syn-tx-14' }, { nextApply: 'throw-after-mutate' });
  form.setName('Actually Saved');
  await form.preview();
  await form.apply();
  assert.equal(form.state(), 'uncertain');
  form.close();
  assert.ok(TE.pendingNotes.get(seed.id), 'closing the form does not clear the note');
  const applyCalls = adapter.calls.apply, prepareCalls = adapter.calls.prepare;
  // Reopen with the STALE pre-save snapshot on purpose: the baseline must
  // come from adapter.status during verification, never from the caller.
  const reopened = TE.createForm({ transaction: seed, categories: CATS, adapter });
  assert.equal(reopened.state(), 'verify-first');
  assert.match(reopened.html(), /data-action="verify"/);
  assert.match(reopened.html(), /<fieldset class="txe-fields" disabled>/);
  assert.equal(await reopened.verify(), 'editing');
  assert.equal(TE.pendingNotes.get(seed.id), null, 'attested applied clears the note');
  assert.equal(reopened.baseline().displayName, 'Actually Saved');
  assert.equal(reopened.baseline().version, 4);
  assert.match(reopened.html(), /Your earlier change did save/);
  assert.equal(adapter.calls.apply, applyCalls, 'no resubmission after reopen');
  assert.equal(adapter.calls.prepare, prepareCalls, 'no new preview after reopen');
}

async function reopenAttestedAppliedWithLaterChange() {
  const { seed, adapter, form } = setup({ id: 'syn-tx-15' }, { nextApply: 'throw-after-mutate' });
  form.setName('Saved Then Changed');
  await form.preview();
  await form.apply();
  form.close();
  adapter.mutateExternally(seed.id, { displayName: 'Changed Afterwards' });
  const reopened = TE.createForm({ transaction: seed, categories: CATS, adapter });
  assert.equal(await reopened.verify(), 'editing');
  assert.equal(TE.pendingNotes.get(seed.id), null,
    'a known fate clears even when the values moved on afterwards');
  assert.match(reopened.html(), /did save/);
  assert.match(reopened.html(), /changed since/);
  assert.equal(reopened.baseline().displayName, 'Changed Afterwards',
    'the baseline is the current verified snapshot, not the intent');
  assert.equal(reopened.baseline().version, 5);
}

async function reopenAttestedNotAppliedUnlocksFresh() {
  const { seed, adapter, form } = setup({ id: 'syn-tx-16' }, { nextApply: 'throw-before-mutate' });
  form.setName('Never Saved');
  const oldPreview = await form.preview();
  await form.apply();
  form.close();
  const reopened = TE.createForm({ transaction: seed, categories: CATS, adapter });
  assert.equal(reopened.state(), 'verify-first');
  assert.equal(await reopened.verify(), 'editing');
  assert.equal(TE.pendingNotes.get(seed.id), null);
  assert.match(reopened.html(), /did not save/);
  assert.equal(reopened.baseline().version, 3, 'baseline is the verified snapshot');
  assert.equal(reopened.canPreview(), false, 'unlock alone submits nothing');
  reopened.setName('Deliberate Retry');
  const fresh = await reopened.preview();
  assert.notEqual(fresh.id, oldPreview.id, 'a fresh preview, never a re-apply of the old one');
  assert.equal(fresh.baseVersion, 3);
  const result = await reopened.apply();
  assert.equal(result.outcome, 'applied');
  assert.equal(adapter.snapshot(seed.id).displayName, 'Deliberate Retry');
}

async function reopenOutcomeUnknownStaysLocked() {
  const script = { nextApply: 'throw-before-mutate', outcomeUnavailable: true };
  const { seed, adapter, form } = setup({ id: 'syn-tx-17' }, script);
  form.setName('Fate Unknown');
  await form.preview();
  await form.apply();
  form.close();
  const applyCalls = adapter.calls.apply, prepareCalls = adapter.calls.prepare;
  const reopened = TE.createForm({ transaction: seed, categories: CATS, adapter });
  assert.equal(await reopened.verify(), 'locked');
  assert.match(reopened.html(), /locked for reconciliation/);
  assert.match(reopened.html(), /Check again/);
  assert.equal(await reopened.verify(), 'locked', 'repeated checks stay locked while unknown');
  assert.ok(TE.pendingNotes.get(seed.id), 'the note survives failed verification');
  assert.equal(adapter.calls.apply, applyCalls, 'zero apply calls after reopen');
  assert.equal(adapter.calls.prepare, prepareCalls, 'zero prepare calls after reopen');
  TE.pendingNotes.clear(seed.id);
}

async function reopenFullMatchUnknownStaysLocked() {
  // The write DID land (throw-after-mutate) so current values fully match
  // the intent — but the adapter cannot attest, so values must not clear.
  const script = { nextApply: 'throw-after-mutate', outcomeUnavailable: true };
  const { seed, adapter, form } = setup({ id: 'syn-tx-18' }, script);
  form.setName('Matches But Unproven');
  await form.preview();
  await form.apply();
  form.close();
  assert.equal(adapter.snapshot(seed.id).displayName, 'Matches But Unproven',
    'the values really do match the intent in this scenario');
  const applyCalls = adapter.calls.apply, prepareCalls = adapter.calls.prepare;
  const reopened = TE.createForm({ transaction: adapter.snapshot(seed.id), categories: CATS, adapter });
  assert.equal(await reopened.verify(), 'locked',
    'a full value match with outcome unknown stays locked — values are not proof');
  assert.ok(TE.pendingNotes.get(seed.id));
  assert.equal(adapter.calls.apply, applyCalls);
  assert.equal(adapter.calls.prepare, prepareCalls);
  TE.pendingNotes.clear(seed.id);
}

async function reopenPartialMatchStaysLocked() {
  const script = { nextApply: 'throw-before-mutate', outcomeUnavailable: true };
  const { seed, adapter, form } = setup({ id: 'syn-tx-19' }, script);
  form.setName('Half Saved Name');
  form.setCategory('cat-dining');
  await form.preview();
  await form.apply();
  form.close();
  // Another actor sets only the name to the intended value afterwards.
  adapter.mutateExternally(seed.id, { displayName: 'Half Saved Name' });
  const reopened = TE.createForm({ transaction: seed, categories: CATS, adapter });
  assert.equal(await reopened.verify(), 'locked', 'a partial match stays locked');
  const html = reopened.html();
  assert.match(html, /You tried to save/);
  assert.match(html, /Current now/);
  assert.match(html, /Dining out/, 'the intended category is visible for reconciliation');
  assert.equal(adapter.calls.apply, 1);
  assert.equal(adapter.calls.prepare, 1);
  TE.pendingNotes.clear(seed.id);
}

async function reopenConflictingValuesStayLocked() {
  const script = { nextApply: 'throw-before-mutate', outcomeUnavailable: true };
  const { seed, adapter, form } = setup({ id: 'syn-tx-20' }, script);
  form.setName('Intended Name');
  await form.preview();
  await form.apply();
  form.close();
  adapter.mutateExternally(seed.id, { displayName: 'A Third Value' });
  const reopened = TE.createForm({ transaction: seed, categories: CATS, adapter });
  assert.equal(await reopened.verify(), 'locked',
    'conflicting values without an attestation stay locked');
  assert.match(reopened.html(), /Intended Name/);
  assert.match(reopened.html(), /A Third Value/);
  assert.equal(adapter.calls.apply, 1);
  assert.equal(adapter.calls.prepare, 1);
  TE.pendingNotes.clear(seed.id);
}

async function reopenCheckFailureStaysLocked() {
  // status() throws during verification: even an attested fate cannot
  // establish a baseline, so the form stays locked until a check succeeds.
  const script = { nextApply: 'throw-after-mutate', statusError: true };
  const { seed, adapter, form } = setup({ id: 'syn-tx-21' }, script);
  form.setName('Saved But Unreadable');
  await form.preview();
  await form.apply();
  form.close();
  const reopened = TE.createForm({ transaction: seed, categories: CATS, adapter });
  assert.equal(await reopened.verify(), 'locked');
  assert.ok(TE.pendingNotes.get(seed.id));
  assert.equal(adapter.calls.apply, 1, 'zero apply calls after reopen');
  assert.equal(adapter.calls.prepare, 1, 'zero prepare calls after reopen');
  script.statusError = false;
  assert.equal(await reopened.verify(), 'editing', 'an explicit re-check can still clear it');
  assert.equal(reopened.baseline().displayName, 'Saved But Unreadable');
  // outcome() throwing is likewise a failed check, not a clearance.
  const script2 = { nextApply: 'throw-before-mutate', outcomeError: true };
  const second = setup({ id: 'syn-tx-22' }, script2);
  second.form.setName('Outcome Unreadable');
  await second.form.preview();
  await second.form.apply();
  second.form.close();
  const reopened2 = TE.createForm({ transaction: second.seed, categories: CATS, adapter: second.adapter });
  assert.equal(await reopened2.verify(), 'locked');
  assert.ok(TE.pendingNotes.get(second.seed.id));
  TE.pendingNotes.clear(second.seed.id);
}

async function noteIsPerTransaction() {
  const a = setup({ id: 'syn-tx-23' }, { nextApply: 'throw-before-mutate' });
  a.form.setName('Locked One');
  await a.form.preview();
  await a.form.apply();
  const b = setup({ id: 'syn-tx-24' });
  assert.equal(b.form.state(), 'editing', 'a note on one transaction never locks another');
  assert.equal(b.form.canPreview(), false);
  b.form.setName('Free To Edit');
  assert.equal(b.form.canPreview(), true);
  TE.pendingNotes.clear(a.seed.id);
}

async function mockOutcomeAttestations() {
  const seed = txn({ id: 'syn-tx-25' });
  const adapter = TE.createMockAdapter([seed], {});
  assert.equal(await adapter.outcome('preview-nope'), 'unknown');
  const p1 = await adapter.prepare(seed.id, { displayName: 'After' });
  assert.equal(await adapter.outcome(p1.id), 'unknown', 'no fate before any apply attempt');
  adapter.script.nextApply = 'throw-after-mutate';
  await assert.rejects(() => adapter.apply(p1.id));
  assert.equal(await adapter.outcome(p1.id), 'applied', 'throw-after-mutate attests applied');
  const p2 = await adapter.prepare(seed.id, { displayName: 'Before' });
  adapter.script.nextApply = 'throw-before-mutate';
  await assert.rejects(() => adapter.apply(p2.id));
  assert.equal(await adapter.outcome(p2.id), 'not-applied', 'throw-before-mutate attests not-applied');
  adapter.script.outcomeUnavailable = true;
  assert.equal(await adapter.outcome(p1.id), 'unknown', 'outcome-unavailable attests unknown');
}

function sourceSeams() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public/transaction-edit.js'), 'utf8');
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|localStorage|sessionStorage)\s*[.(]/,
    'no network or storage seam');
  assert.doesNotMatch(source, /\bset(?:Timeout|Interval)\s*\(/,
    'no timers — an uncertain write is never retried or polled automatically');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public/transaction-edit.css'), 'utf8');
  assert.doesNotMatch(css, /position\s*:\s*(?:fixed|absolute)/,
    'panel content only — no popup/overlay positioning');
}

async function run() {
  await prepareDiffAndNoMutation();
  await noChangeDisablesPreview();
  await validationBlocksPrepare();
  await staleAfterVersionMoves();
  await duplicateApplyClicks();
  await applyThrowUncertain();
  await closeReopenOldPreviewUnusable();
  await closeWhileApplyingSettlesViaCallback();
  await closeWhileApplyingThrows();
  escapingAndReadOnlyRendering();
  await mockApplyIdempotent();
  await appliedUpdatesBaseline();
  await rejectedFlow();
  await reopenAttestedAppliedClears();
  await reopenAttestedAppliedWithLaterChange();
  await reopenAttestedNotAppliedUnlocksFresh();
  await reopenOutcomeUnknownStaysLocked();
  await reopenFullMatchUnknownStaysLocked();
  await reopenPartialMatchStaysLocked();
  await reopenConflictingValuesStayLocked();
  await reopenCheckFailureStaysLocked();
  await noteIsPerTransaction();
  await mockOutcomeAttestations();
  sourceSeams();
  console.log('PASS transaction edit form: exact-diff preview without mutation, validation gates, stale, single-flight apply, uncertain lock + note, close/reopen safety, attestation-only reopen clearance (applied / applied-then-changed / not-applied fresh preview), unknown + full-match + partial + conflicting + check-failure all stay locked with zero post-reopen apply/prepare calls, per-transaction notes, mock outcome attestations, escaping, read-only facts, no network/storage/timer seams');
}
module.exports = { txn, CATS };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
