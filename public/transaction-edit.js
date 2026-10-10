/* Isolated transaction-edit form — content for the existing detail panel.
 *
 * This component renders a panel-content fragment (a <section>) only. It is
 * NOT a popup, overlay, modal or sheet system: no fixed positioning, no
 * backdrop, no dialog element. The host detail panel owns the chrome, the
 * close affordance and focus management; this form owns one transaction's
 * edit → preview → confirm → apply flow inside the panel body.
 *
 * Design source: the owner-supplied g-blend mockup (panel surface, controls,
 * type, spacing). Its sample financial data is NOT used anywhere here; every
 * transaction this file is ever shown with in tests and demos is synthetic.
 *
 * No fetching, no credentials, no storage, no financial calculation. The
 * amount is display-only formatting of a supplied number. Forecast is
 * untouched; nothing here computes or publishes a figure.
 *
 * ---------------------------------------------------------------------------
 * ADAPTER CONTRACT (injected by the host; the mock below is the reference)
 *
 *   prepare(txnId, changes) -> Promise<preview>
 *     Read-only. Returns { id, txnId, baseVersion, changes } where changes is
 *     [{ field, label, from, to }] — the exact diff against current values.
 *     Must not mutate anything.
 *   apply(previewId) -> Promise<{ outcome: 'applied', version }
 *                              | { outcome: 'stale' }
 *                              | { outcome: 'rejected', reason }>
 *     Single-flight per preview. A thrown/rejected promise means the outcome
 *     is UNKNOWN to the caller — never evidence of success or failure.
 *   status(txnId) -> Promise<transaction snapshot>
 *     Current verified values, used to establish a baseline after an
 *     uncertain outcome and on reopen verification.
 *   outcome(previewId) -> Promise<'applied' | 'not-applied' | 'unknown'>
 *     The adapter's own attestation of a past write's fate, from its write
 *     records — never inferred by this component from displayed values.
 *
 * HARD REQUIREMENT for the eventual live connection: the production adapter
 * MUST provide the definitive outcome query above, keyed by the
 * preview/operation id. The mock's in-memory attestation is only a stand-in
 * proving the client-side protocol. Whether the live backend can attest
 * per-write outcomes is UNVERIFIED and is a launch blocker for the live
 * integration: without it, any uncertain save leaves the transaction locked
 * for reconciliation by design (see the verify-first states below).
 *
 * UNCERTAIN-SAVE PROTOCOL (owner-specified):
 * - If apply() throws, the write's fate is unknown. The form locks, the
 *   preview can never be applied again, and a pending-verification note is
 *   recorded in a registry that OUTLIVES the form instance (closing the
 *   form does not clear it):
 *     { txnId, previewId, baseVersion, intendedChanges: [{field, from, to}] }
 * - Any later form for the same transaction opens in a verify-first state,
 *   locked, until the adapter attests a definitive outcome:
 *     outcome = 'applied'    -> note cleared, NO resubmission; the form
 *                               opens on the current verified snapshot. If
 *                               the values differ from the intent, a notice
 *                               says they changed since — the pending state
 *                               still clears, because the fate is known.
 *     outcome = 'not-applied'-> note cleared; the form unlocks on the
 *                               verified current snapshot. Any new save is
 *                               a fresh edit + fresh preview.
 *     anything else          -> stays locked for reconciliation: 'unknown',
 *                               a thrown/malformed outcome or status call,
 *                               partial matches, conflicting values — and
 *                               even a FULL value match, because displayed
 *                               values are never proof of a write's fate.
 * - The only exits from a lock are an explicit user-clicked re-check that
 *   reaches a definitive attestation, or closing. No auto-retry, no
 *   auto-polling, no timers, no user-side override.
 * ---------------------------------------------------------------------------
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TransactionEdit = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const MAX_NAME_LENGTH = 80;
  const EDITABLE = [
    { field: 'displayName', label: 'Name' },
    { field: 'categoryId', label: 'Category' },
  ];

  const text = value => typeof value === 'string' ? value : '';
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
    && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
  // Display-only formatting of a supplied number; no arithmetic on money.
  const money = value => typeof value === 'number' && Number.isFinite(value)
    ? '$' + value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : 'Unavailable';
  const clone = value => JSON.parse(JSON.stringify(value));

  /* ---------------- pending-verification registry ----------------
   * Outlives any form instance. Module-level by default; the host may
   * replace it (setPendingStore) with its own durable store implementing
   * get(txnId) / set(txnId, note) / clear(txnId). A note is removed ONLY by
   * a definitive adapter attestation during verification — never by
   * closing a form, and never by comparing displayed values. */
  function memoryStore() {
    const map = new Map();
    return {
      get: id => map.has(id) ? clone(map.get(id)) : null,
      set: (id, note) => { map.set(id, clone(note)); },
      clear: id => { map.delete(id); },
    };
  }
  let defaultStore = memoryStore();
  const pendingNotes = {
    get: txnId => defaultStore.get(txnId),
    has: txnId => defaultStore.get(txnId) != null,
    clear: txnId => defaultStore.clear(txnId),
  };
  function setPendingStore(store) {
    if (!store || typeof store.get !== 'function'
      || typeof store.set !== 'function' || typeof store.clear !== 'function') {
      throw new Error('pending store must implement get/set/clear');
    }
    defaultStore = store;
  }

  function validSnapshot(snap, txnId) {
    return !!snap && typeof snap === 'object' && snap.id === txnId
      && typeof snap.displayName === 'string' && typeof snap.categoryId === 'string'
      && Number.isInteger(snap.version);
  }

  /* ------------------------------ form ------------------------------ */
  function createForm(options) {
    const opts = options || {};
    const adapter = opts.adapter || {};
    const categories = (Array.isArray(opts.categories) ? opts.categories : [])
      .filter(c => c && typeof c.id === 'string' && typeof c.name === 'string')
      .map(c => ({ id: c.id, name: c.name }));
    const store = opts.pendingStore || defaultStore;
    const onSettled = typeof opts.onSettled === 'function' ? opts.onSettled : null;
    const txn = opts.transaction && typeof opts.transaction === 'object' ? clone(opts.transaction) : {};
    const txnId = text(txn.id);

    let note = txnId ? store.get(txnId) : null;
    let state = note ? 'verify-first' : 'editing';
    let baseline = {
      displayName: text(txn.displayName), categoryId: text(txn.categoryId),
      version: Number.isInteger(txn.version) ? txn.version : 0,
    };
    let draft = { displayName: baseline.displayName, categoryId: baseline.categoryId };
    let preview = null;
    let applyInFlight = false;
    let verifyBusy = false;
    let closed = false;
    let notice = null;        // { kind: 'ok'|'warn'|'alert'|'info', title, body }
    let rejectReason = '';
    let stillUnknown = false; // a re-check ran and still could not confirm
    let lastStatus = null;    // last verified snapshot seen during verification
    let el = null;

    const categoryName = id => {
      const found = categories.find(c => c.id === id);
      return found ? found.name : 'Unknown category';
    };
    const displayValue = (field, value) => field === 'categoryId' ? categoryName(value) : text(value);
    const trimmedName = () => draft.displayName.trim();

    function validationErrors() {
      const errors = {};
      const name = trimmedName();
      if (!name) errors.displayName = 'Enter a name.';
      else if (name.length > MAX_NAME_LENGTH) {
        errors.displayName = 'Keep the name to ' + MAX_NAME_LENGTH + ' characters or fewer.';
      }
      if (!categories.some(c => c.id === draft.categoryId)) {
        errors.categoryId = 'Choose one of the existing categories.';
      }
      return errors;
    }
    function changedFields() {
      const changed = [];
      if (trimmedName() !== baseline.displayName) changed.push('displayName');
      if (draft.categoryId !== baseline.categoryId) changed.push('categoryId');
      return changed;
    }
    function canPreview() {
      return state === 'editing' && !closed && changedFields().length > 0
        && Object.keys(validationErrors()).length === 0;
    }

    /* ---------------------------- rendering ---------------------------- */
    function fact(label, value, cls) {
      return '<div class="txe-kv-row"><dt>' + escape(label) + '</dt><dd'
        + (cls ? ' class="' + cls + '"' : '') + '>' + escape(value) + '</dd></div>';
    }
    function readOnlyBox() {
      return '<div class="txe-box"><dl class="txe-kv">'
        + '<div class="txe-kv-row txe-kv-stack"><dt>Original bank description</dt>'
        + '<dd class="txe-desc">' + escape(text(txn.originalDescription) || 'Unavailable') + '</dd></div>'
        + fact('Amount', money(txn.amount), 'num')
        + fact('Date', isDate(txn.date) ? txn.date : 'Unavailable')
        + fact('Account', text(txn.account) || 'Unavailable')
        + '</dl></div>';
    }
    function noticeHtml() {
      if (!notice) return '';
      return '<div class="txe-note txe-note-' + escape(notice.kind) + '" role="status">'
        + '<p class="txe-note-title">' + escape(notice.title) + '</p>'
        + (notice.body ? '<p class="txe-note-body">' + escape(notice.body) + '</p>' : '')
        + '</div>';
    }
    function changesList(changes) {
      return '<ul class="txe-changes">' + (changes || []).map(change =>
        '<li><span class="txe-ch-field">' + escape(change.label || change.field) + '</span>'
        + '<span class="txe-ch-from">' + escape(displayValue(change.field, change.from)) + '</span>'
        + '<span class="txe-ch-arrow" aria-hidden="true">→</span>'
        + '<span class="txe-ch-to">' + escape(displayValue(change.field, change.to)) + '</span></li>'
      ).join('') + '</ul>';
    }
    function fieldsHtml(disabled) {
      const errors = validationErrors();
      const dis = disabled ? ' disabled' : '';
      const options = categories.map(c => '<option value="' + escape(c.id) + '"'
        + (c.id === draft.categoryId ? ' selected' : '') + '>' + escape(c.name) + '</option>').join('');
      return '<div class="txe-field"><label class="txe-label" for="txe-name-' + escape(txnId) + '">Name</label>'
        + '<input class="txe-input" id="txe-name-' + escape(txnId) + '" type="text" data-field="displayName"'
        + ' value="' + escape(draft.displayName) + '" autocomplete="off"' + dis + '>'
        + (errors.displayName && !disabled
          ? '<p class="txe-error">' + escape(errors.displayName) + '</p>' : '')
        + '</div>'
        + '<div class="txe-field"><label class="txe-label" for="txe-cat-' + escape(txnId) + '">Category</label>'
        + '<select class="txe-select" id="txe-cat-' + escape(txnId) + '" data-field="categoryId"' + dis + '>'
        + options + '</select>'
        + (errors.categoryId && !disabled
          ? '<p class="txe-error">' + escape(errors.categoryId) + '</p>' : '')
        + '</div>';
    }
    function editingSection(disabled) {
      return '<div class="txe-section"><h3 class="txe-h">Edit details</h3>'
        + '<fieldset class="txe-fields"' + (disabled ? ' disabled' : '') + '>'
        + fieldsHtml(disabled) + '</fieldset></div>';
    }
    function compareHtml() {
      if (!note) return '';
      const rows = note.intendedChanges.map(change => {
        const current = lastStatus ? lastStatus[change.field] : undefined;
        return '<div class="txe-kv-row txe-kv-stack"><dt>' + escape(change.field === 'categoryId' ? 'Category' : 'Name') + '</dt>'
          + '<dd><span class="txe-cmp"><span class="txe-cmp-k">You tried to save</span> '
          + '<span class="txe-cmp-v">' + escape(displayValue(change.field, change.to)) + '</span></span>'
          + '<span class="txe-cmp"><span class="txe-cmp-k">Current now</span> '
          + '<span class="txe-cmp-v">' + escape(current === undefined ? 'Unavailable — could not be read'
            : displayValue(change.field, current)) + '</span></span></dd></div>';
      }).join('');
      return '<div class="txe-box"><dl class="txe-kv">' + rows + '</dl></div>';
    }

    function html() {
      if (closed) return '';
      const head = '<section class="txe" data-txe data-state="' + escape(state) + '">'
        + '<div class="txe-section"><h3 class="txe-h">Transaction</h3>' + readOnlyBox() + '</div>';
      const tail = '</section>';
      if (state === 'editing') {
        const ready = canPreview();
        return head + noticeHtml() + editingSection(false)
          + '<div class="txe-acts"><button type="button" class="txe-btn txe-btn-primary" data-action="preview"'
          + (ready ? '' : ' disabled') + '>Preview changes</button></div>'
          + (changedFields().length === 0
            ? '<p class="txe-fine">No changes yet — the preview shows the exact changes before anything is saved.</p>' : '')
          + tail;
      }
      if (state === 'preparing') {
        return head + noticeHtml() + editingSection(true)
          + '<div class="txe-acts"><button type="button" class="txe-btn txe-btn-primary" disabled>Preparing…</button></div>' + tail;
      }
      if (state === 'preview' || state === 'applying') {
        const applying = state === 'applying';
        return head + noticeHtml()
          + '<div class="txe-section"><h3 class="txe-h">Confirm changes</h3>'
          + '<div class="txe-box">' + changesList(preview ? preview.changes : []) + '</div>'
          + '<p class="txe-fine">Only these changes will be saved. Nothing else about this transaction changes.</p></div>'
          + '<div class="txe-acts">'
          + '<button type="button" class="txe-btn txe-btn-primary" data-action="apply"'
          + (applying ? ' disabled' : '') + '>' + (applying ? 'Saving…' : 'Apply changes') + '</button>'
          + '<button type="button" class="txe-btn txe-btn-ghost" data-action="back"'
          + (applying ? ' disabled' : '') + '>Back</button></div>' + tail;
      }
      if (state === 'applied') {
        return head
          + '<div class="txe-note txe-note-ok" role="status"><p class="txe-note-title">'
          + '<span class="txe-check" aria-hidden="true">✓</span> Changes saved</p>'
          + '<p class="txe-note-body">The saved values are now the current values below.</p></div>'
          + '<div class="txe-box"><dl class="txe-kv">'
          + fact('Name', baseline.displayName)
          + fact('Category', categoryName(baseline.categoryId))
          + '</dl></div>'
          + '<div class="txe-acts"><button type="button" class="txe-btn txe-btn-ghost" data-action="edit-again">Make another edit</button></div>'
          + tail;
      }
      if (state === 'stale') {
        return head
          + '<div class="txe-note txe-note-warn" role="status"><p class="txe-note-title">This transaction changed since your preview</p>'
          + '<p class="txe-note-body">Nothing from that preview was applied. Your edits are still here — prepare a new preview against the current values to continue.</p></div>'
          + editingSection(true)
          + '<div class="txe-acts"><button type="button" class="txe-btn txe-btn-primary" data-action="reprepare">Prepare a new preview</button></div>'
          + tail;
      }
      if (state === 'rejected') {
        return head
          + '<div class="txe-note txe-note-warn" role="status"><p class="txe-note-title">The change was not saved</p>'
          + '<p class="txe-note-body">' + escape(rejectReason || 'The adapter rejected this change.') + '</p></div>'
          + editingSection(true)
          + '<div class="txe-acts"><button type="button" class="txe-btn txe-btn-ghost" data-action="edit-again">Back to editing</button></div>'
          + tail;
      }
      if (state === 'uncertain') {
        return head
          + '<div class="txe-note txe-note-alert" role="alert"><p class="txe-note-title">We couldn’t confirm whether this change saved</p>'
          + '<p class="txe-note-body">The save was interrupted, so its outcome is unknown — do not assume it saved, and do not assume it didn’t. '
          + 'This preview can’t be submitted again. Checking asks the adapter what it recorded; it never retries the save.</p>'
          + (stillUnknown ? '<p class="txe-note-body">The last check still couldn’t establish the outcome.</p>' : '')
          + '</div>'
          + '<div class="txe-section"><h3 class="txe-h">Changes that were being saved</h3>'
          + '<div class="txe-box">' + changesList(note ? note.intendedChanges.map(c => ({
            ...c, label: c.field === 'categoryId' ? 'Category' : 'Name' })) : []) + '</div></div>'
          + editingSection(true)
          + '<div class="txe-acts"><button type="button" class="txe-btn txe-btn-primary" data-action="recheck"'
          + (verifyBusy ? ' disabled' : '') + '>' + (verifyBusy ? 'Checking…' : 'Check whether it saved') + '</button></div>'
          + tail;
      }
      if (state === 'verify-first' || state === 'locked') {
        const locked = state === 'locked';
        return head
          + '<div class="txe-note txe-note-alert" role="alert"><p class="txe-note-title">'
          + (locked ? 'This transaction is locked for reconciliation' : 'An earlier save couldn’t be confirmed') + '</p>'
          + '<p class="txe-note-body">A previous save of this transaction was interrupted and its outcome is unknown. '
          + 'Editing stays locked until the adapter confirms what happened. Displayed values alone can’t prove whether it saved, so nothing here unlocks by comparison.</p></div>'
          + '<div class="txe-section"><h3 class="txe-h">Earlier change awaiting confirmation</h3>'
          + compareHtml() + '</div>'
          + editingSection(true)
          + '<div class="txe-acts"><button type="button" class="txe-btn txe-btn-primary" data-action="verify"'
          + (verifyBusy ? ' disabled' : '') + '>' + (verifyBusy ? 'Checking…' : locked ? 'Check again' : 'Check the earlier save') + '</button></div>'
          + tail;
      }
      return head + tail;
    }
    function render() { if (el && !closed) el.innerHTML = html(); }
    // Light chrome sync after typing: never re-render mid-edit (focus/caret).
    function syncChrome() {
      if (!el || closed || state !== 'editing') return;
      const button = el.querySelector('[data-action="preview"]');
      if (button) button.disabled = !canPreview();
    }

    /* ---------------------------- behaviour ---------------------------- */
    function settle(result) { if (onSettled) onSettled(result); }

    async function previewChanges() {
      if (!canPreview()) { render(); return null; }
      const changes = {};
      if (trimmedName() !== baseline.displayName) changes.displayName = trimmedName();
      if (draft.categoryId !== baseline.categoryId) changes.categoryId = draft.categoryId;
      state = 'preparing'; notice = null; render();
      let result;
      try {
        result = await adapter.prepare(txnId, changes);
      } catch (error) {
        if (closed) return null;
        state = 'editing';
        notice = { kind: 'warn', title: 'Couldn’t prepare a preview',
          body: 'Nothing was changed. You can try preparing again.' };
        render();
        return null;
      }
      if (closed) return null; // a preview made by a closed form is unusable
      if (!result || result.txnId !== txnId || typeof result.id !== 'string'
        || !Array.isArray(result.changes)) {
        state = 'editing';
        notice = { kind: 'warn', title: 'Couldn’t prepare a preview',
          body: 'The preview was incomplete, so nothing was changed.' };
        render();
        return null;
      }
      preview = result;
      state = 'preview';
      render();
      return preview;
    }

    async function applyChanges() {
      // Single-flight: the first call flips the guard synchronously, so a
      // duplicate click (or a second programmatic call) can never reach
      // adapter.apply for the same preview.
      if (state !== 'preview' || !preview || applyInFlight || closed) return null;
      applyInFlight = true;
      state = 'applying'; render();
      const thisPreview = preview;
      let result;
      try {
        result = await adapter.apply(thisPreview.id);
      } catch (error) {
        applyInFlight = false;
        recordUncertainFrom(thisPreview);
        if (!closed) { state = 'uncertain'; stillUnknown = false; preview = null; render(); }
        settle({ outcome: 'uncertain', txnId, previewId: thisPreview.id });
        return { outcome: 'uncertain' };
      }
      applyInFlight = false;
      if (!result || typeof result.outcome !== 'string') {
        // A resolved-but-meaningless answer is still an unknown outcome.
        recordUncertainFrom(thisPreview);
        if (!closed) { state = 'uncertain'; stillUnknown = false; preview = null; render(); }
        settle({ outcome: 'uncertain', txnId, previewId: thisPreview.id });
        return { outcome: 'uncertain' };
      }
      if (result.outcome === 'applied') {
        for (const change of thisPreview.changes) baseline[change.field] = change.to;
        if (Number.isInteger(result.version)) baseline.version = result.version;
        draft = { displayName: baseline.displayName, categoryId: baseline.categoryId };
        preview = null;
        if (!closed) { state = 'applied'; notice = null; render(); }
        settle({ outcome: 'applied', txnId, version: baseline.version });
        return result;
      }
      if (result.outcome === 'stale') {
        preview = null;
        if (!closed) { state = 'stale'; render(); }
        settle({ outcome: 'stale', txnId });
        return result;
      }
      if (result.outcome === 'rejected') {
        preview = null;
        rejectReason = text(result.reason);
        if (!closed) { state = 'rejected'; render(); }
        settle({ outcome: 'rejected', txnId, reason: rejectReason });
        return result;
      }
      // Unknown outcome vocabulary from the adapter: fail closed.
      recordUncertainFrom(thisPreview);
      if (!closed) { state = 'uncertain'; stillUnknown = false; preview = null; render(); }
      settle({ outcome: 'uncertain', txnId, previewId: thisPreview.id });
      return { outcome: 'uncertain' };
    }
    function recordUncertainFrom(p) {
      note = {
        txnId,
        previewId: p.id,
        baseVersion: p.baseVersion,
        intendedChanges: p.changes.map(c => ({ field: c.field, from: c.from, to: c.to })),
      };
      store.set(txnId, note);
    }

    /* Shared attestation check for the uncertain state (recheck) and the
     * verify-first / locked states (verify). Clearance comes ONLY from
     * adapter.outcome(); the status snapshot supplies the new baseline and
     * the human reconciliation view — never proof. */
    async function resolveNote() {
      const current = store.get(txnId) || note;
      if (!current || verifyBusy || closed) return state;
      verifyBusy = true; render();
      let attested = null;
      try {
        attested = typeof adapter.outcome === 'function' ? await adapter.outcome(current.previewId) : 'unknown';
      } catch (error) { attested = null; }
      let snap = null;
      try {
        snap = await adapter.status(txnId);
        if (validSnapshot(snap, txnId)) lastStatus = clone(snap);
      } catch (error) { snap = null; }
      verifyBusy = false;
      if (closed) return state;
      if ((attested === 'applied' || attested === 'not-applied') && validSnapshot(snap, txnId)) {
        store.clear(txnId);
        note = null;
        lastStatus = clone(snap);
        baseline = { displayName: snap.displayName, categoryId: snap.categoryId, version: snap.version };
        draft = { displayName: baseline.displayName, categoryId: baseline.categoryId };
        preview = null;
        stillUnknown = false;
        if (attested === 'applied') {
          const matchesIntent = current.intendedChanges.every(c => snap[c.field] === c.to);
          notice = { kind: 'ok', title: 'Your earlier change did save',
            body: matchesIntent
              ? 'It is the current value now — there is nothing to submit again.'
              : 'The values have changed since then, so you are looking at the current values. There is nothing to submit again.' };
        } else {
          notice = { kind: 'info', title: 'Your earlier change did not save',
            body: 'The adapter confirmed the save never happened. You can make the edit again — it will need a fresh preview before it can be applied.' };
        }
        state = 'editing';
        render();
        return state;
      }
      // Not established: values (matching or not) never clear the lock.
      stillUnknown = true;
      if (state !== 'uncertain') state = 'locked';
      render();
      return state;
    }

    async function reprepare() {
      if (state !== 'stale' || closed) return null;
      let snap = null;
      try { snap = await adapter.status(txnId); } catch (error) { snap = null; }
      if (closed) return null;
      if (!validSnapshot(snap, txnId)) {
        notice = { kind: 'warn', title: 'Couldn’t read the current values',
          body: 'The preview was not prepared. You can try again.' };
        render();
        return null;
      }
      baseline = { displayName: snap.displayName, categoryId: snap.categoryId, version: snap.version };
      state = 'editing';
      notice = null;
      render();
      return previewChanges();
    }

    function close() {
      // Destroys this form's state, including any live preview. The
      // pending-verification note, if one exists, is NOT cleared — it
      // belongs to the transaction, not to this form instance. An apply
      // still in flight settles through onSettled only; a reopened form
      // never assumes its result.
      closed = true;
      preview = null;
      if (el) { el.innerHTML = ''; el = null; }
    }

    function mount(element) {
      el = element;
      el.innerHTML = html();
      el.addEventListener('input', event => {
        const field = event.target && event.target.dataset ? event.target.dataset.field : null;
        if (field === 'displayName') { draft.displayName = String(event.target.value); syncChrome(); }
      });
      el.addEventListener('change', event => {
        const field = event.target && event.target.dataset ? event.target.dataset.field : null;
        if (field === 'categoryId') { draft.categoryId = String(event.target.value); syncChrome(); }
      });
      el.addEventListener('click', event => {
        const button = event.target && event.target.closest
          ? event.target.closest('[data-action]') : null;
        if (!button || button.disabled) return;
        const action = button.dataset.action;
        if (action === 'preview') previewChanges();
        else if (action === 'apply') applyChanges();
        else if (action === 'back') { preview = null; state = 'editing'; render(); }
        else if (action === 'reprepare') reprepare();
        else if (action === 'recheck') resolveNote();
        else if (action === 'verify') resolveNote();
        else if (action === 'edit-again') { state = 'editing'; notice = null; render(); }
      });
      return api;
    }

    const api = {
      html, mount, close,
      state: () => state,
      isClosed: () => closed,
      baseline: () => ({ ...baseline }),
      draft: () => ({ ...draft }),
      note: () => (note ? clone(note) : null),
      canPreview,
      setName(value) { if (state === 'editing' && !closed) { draft.displayName = String(value); render(); } },
      setCategory(id) { if (state === 'editing' && !closed) { draft.categoryId = String(id); render(); } },
      preview: previewChanges,
      apply: applyChanges,
      reprepare,
      recheck: resolveNote,
      verify: resolveNote,
      back() { if (state === 'preview' && !applyInFlight) { preview = null; state = 'editing'; render(); } },
      editAgain() { if (state === 'applied' || state === 'rejected') { state = 'editing'; notice = null; render(); } },
    };
    return api;
  }

  /* --------------------- synthetic mock adapter ---------------------
   * DEMO / TEST ONLY — in-memory reference implementation of the adapter
   * contract with synthetic transactions. Never a production write path.
   *
   * - prepare() never mutates; it diffs against current values.
   * - apply() mutates only on success and is idempotent per previewId: a
   *   second apply of the same preview returns the recorded outcome
   *   without mutating again.
   * - Every apply attempt's true fate is recorded per previewId and is
   *   what outcome() attests: including scripted throws —
   *   'throw-after-mutate' attests 'applied', 'throw-before-mutate'
   *   attests 'not-applied'. With script.outcomeUnavailable set, outcome()
   *   attests 'unknown' regardless (the adapter cannot establish fates).
   * - script.nextApply: one-shot — 'throw' | 'throw-before-mutate' |
   *   'throw-after-mutate' | 'stale' | 'reject'.
   * - script.statusError / script.outcomeError make those calls throw.
   * - mutateExternally(txnId, changes) simulates another actor editing
   *   the transaction afterwards (bumps the version).
   */
  function createMockAdapter(seedTransactions, script) {
    const cfg = script || {};
    const store = new Map();
    (Array.isArray(seedTransactions) ? seedTransactions : []).forEach(t => {
      if (t && typeof t.id === 'string') store.set(t.id, clone(t));
    });
    const previews = new Map();
    let seq = 0;
    const calls = { prepare: 0, apply: 0, status: 0, outcome: 0 };

    function snapshot(txnId) {
      const found = store.get(txnId);
      return found ? clone(found) : null;
    }
    async function prepare(txnId, changes) {
      calls.prepare += 1;
      const current = store.get(txnId);
      if (!current) throw new Error('Unknown transaction: ' + txnId);
      const diff = [];
      for (const { field, label } of EDITABLE) {
        if (changes && Object.prototype.hasOwnProperty.call(changes, field)
          && changes[field] !== current[field]) {
          diff.push({ field, label, from: current[field], to: changes[field] });
        }
      }
      const record = {
        id: 'preview-' + (++seq), txnId, baseVersion: current.version,
        changes: diff, fate: null, result: null,
      };
      previews.set(record.id, record);
      return clone({ id: record.id, txnId, baseVersion: record.baseVersion, changes: diff });
    }
    async function apply(previewId) {
      calls.apply += 1;
      const record = previews.get(previewId);
      if (!record) throw new Error('Unknown preview: ' + previewId);
      if (record.result) return clone(record.result); // idempotent replay
      const current = store.get(record.txnId);
      const mode = cfg.nextApply || null;
      cfg.nextApply = null; // one-shot
      const mutate = () => {
        for (const change of record.changes) current[change.field] = change.to;
        current.version += 1;
      };
      if (mode === 'throw-after-mutate') {
        mutate();
        record.fate = 'applied';
        record.result = { outcome: 'applied', version: current.version };
        throw new Error('Synthetic transport failure after the write');
      }
      if (mode === 'throw' || mode === 'throw-before-mutate') {
        record.fate = 'not-applied';
        throw new Error('Synthetic transport failure before the write');
      }
      if (mode === 'stale' || record.baseVersion !== current.version) {
        record.fate = 'not-applied';
        record.result = { outcome: 'stale' };
        return clone(record.result);
      }
      if (mode === 'reject') {
        record.fate = 'not-applied';
        record.result = { outcome: 'rejected', reason: 'Synthetic adapter rejection — the change was refused.' };
        return clone(record.result);
      }
      mutate();
      record.fate = 'applied';
      record.result = { outcome: 'applied', version: current.version };
      return clone(record.result);
    }
    async function status(txnId) {
      calls.status += 1;
      if (cfg.statusError) throw new Error('Synthetic status failure');
      const snap = snapshot(txnId);
      if (!snap) throw new Error('Unknown transaction: ' + txnId);
      return snap;
    }
    async function outcome(previewId) {
      calls.outcome += 1;
      if (cfg.outcomeError) throw new Error('Synthetic outcome failure');
      if (cfg.outcomeUnavailable) return 'unknown';
      const record = previews.get(previewId);
      return record && record.fate ? record.fate : 'unknown';
    }
    function mutateExternally(txnId, changes) {
      const current = store.get(txnId);
      if (!current) throw new Error('Unknown transaction: ' + txnId);
      for (const { field } of EDITABLE) {
        if (changes && Object.prototype.hasOwnProperty.call(changes, field)) {
          current[field] = changes[field];
        }
      }
      current.version += 1;
      return snapshot(txnId);
    }
    return { prepare, apply, status, outcome, mutateExternally, snapshot, calls, script: cfg };
  }

  return { createForm, createMockAdapter, pendingNotes, setPendingStore, MAX_NAME_LENGTH };
});
