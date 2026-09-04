'use strict';
/*
 * Household Budget -> Other Spending manual category correction.
 *
 * Financial meaning remains outside this file. The server supplies only
 * transactions that Forecast currently classifies as Other Spending and only
 * provider categories that map back to an incumbent Household Budget line.
 * This UI presents those choices, requires an explicit confirmation, waits for
 * Lunch Money to confirm the write, then reloads the page. It never mutates
 * financial totals optimistically.
 */

(function bootOtherSpendingCategoryEditor() {
  const OTHER_SELECTOR = '[data-other-spending]';
  const MOUNT_ATTR = 'data-category-editor-mounted';
  let loading = false;

  function money(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
  }

  function text(doc, tag, className, value) {
    const el = doc.createElement(tag);
    if (className) el.className = className;
    el.textContent = value;
    return el;
  }

  async function readJson(response) {
    try { return await response.json(); }
    catch (_err) { return {}; }
  }

  function showStatus(node, message, kind) {
    if (!node) return;
    node.textContent = message || '';
    node.className = 'other-category-status' + (kind ? ` ${kind}` : '');
  }

  function optionLabel(option) {
    const household = option.householdBudgetLabel || option.householdBudgetId || 'Household Budget';
    const provider = option.lunchMoneyLabel || household;
    return provider === household ? household : `${household} · Lunch Money: ${provider}`;
  }

  async function submit(row, select, button, status) {
    const selected = row.options.find(option => option.categoryHandle === select.value);
    if (!selected) {
      showStatus(status, 'Choose a category.', 'error');
      return;
    }
    const merchant = row.merchant || 'this transaction';
    const destination = selected.householdBudgetLabel || selected.lunchMoneyLabel || 'the selected category';
    const ok = window.confirm(
      `Move ${merchant} ${money(row.amount)} from Other Spending to ${destination}? `
      + 'This will update this transaction’s category in Lunch Money.'
    );
    if (!ok) return;

    button.disabled = true;
    select.disabled = true;
    showStatus(status, 'Updating Lunch Money…', 'working');
    try {
      const response = await fetch('/api/other-spending/category', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          transactionHandle: row.transactionHandle,
          categoryHandle: selected.categoryHandle,
        }),
      });
      const payload = await readJson(response);
      if (!response.ok || payload.updated !== true) {
        throw new Error(payload.message || 'Category update failed. Refresh and try again.');
      }
      showStatus(status, 'Updated in Lunch Money. Refreshing…', 'success');
      window.location.reload();
    } catch (err) {
      showStatus(status, err && err.message ? err.message : 'Category update failed. Refresh and try again.', 'error');
      button.disabled = false;
      select.disabled = false;
    }
  }

  function transactionRow(doc, row) {
    const card = doc.createElement('div');
    card.className = 'other-category-transaction';

    const head = doc.createElement('div');
    head.className = 'other-category-transaction-head';
    const merchant = text(doc, 'strong', 'other-category-merchant', row.merchant || 'Transaction');
    const amount = text(doc, 'span', 'other-category-amount', money(row.amount));
    head.append(merchant, amount);

    const meta = text(
      doc,
      'p',
      'other-category-meta',
      [row.date, row.currentCategory ? `Lunch Money: ${row.currentCategory}` : null]
        .filter(Boolean).join(' · ')
    );

    const controls = doc.createElement('div');
    controls.className = 'other-category-controls';
    const select = doc.createElement('select');
    select.className = 'other-category-select';
    select.setAttribute('aria-label', `Category for ${row.merchant || 'transaction'}`);
    const placeholder = doc.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose category…';
    select.appendChild(placeholder);
    for (const option of row.options || []) {
      const node = doc.createElement('option');
      node.value = option.categoryHandle;
      node.textContent = optionLabel(option);
      select.appendChild(node);
    }
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'preset other-category-move';
    button.textContent = 'Move';
    const status = text(doc, 'p', 'other-category-status', '');
    button.addEventListener('click', () => submit(row, select, button, status));
    controls.append(select, button);
    card.append(head, meta, controls, status);
    return card;
  }

  function render(doc, mount, payload) {
    mount.replaceChildren();
    const transactions = Array.isArray(payload && payload.transactions) ? payload.transactions : [];
    if (!transactions.length) {
      mount.appendChild(text(doc, 'p', 'other-category-empty', 'No editable Other Spending transactions right now.'));
      return;
    }
    const intro = text(
      doc,
      'p',
      'other-category-intro',
      'Move an unassigned transaction to the right Household Budget line. Saving also updates Lunch Money.'
    );
    mount.appendChild(intro);
    for (const row of transactions) mount.appendChild(transactionRow(doc, row));
  }

  async function mountEditor(doc, otherRow) {
    if (!otherRow || otherRow.hasAttribute(MOUNT_ATTR) || loading) return false;
    otherRow.setAttribute(MOUNT_ATTR, 'true');
    const details = doc.createElement('details');
    details.className = 'other-category-editor';
    const summary = doc.createElement('summary');
    summary.textContent = 'Assign Other Spending';
    const mount = doc.createElement('div');
    mount.className = 'other-category-editor-body';
    mount.appendChild(text(doc, 'p', 'other-category-loading', 'Loading editable transactions…'));
    details.append(summary, mount);
    otherRow.appendChild(details);

    loading = true;
    try {
      const response = await fetch('/api/other-spending/categories', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(payload.message || 'Category editing is unavailable right now.');
      render(doc, mount, payload);
    } catch (err) {
      mount.replaceChildren(text(
        doc,
        'p',
        'other-category-status error',
        err && err.message ? err.message : 'Category editing is unavailable right now.'
      ));
    } finally {
      loading = false;
    }
    return true;
  }

  function findAndMount(doc) {
    const other = doc.querySelector(OTHER_SELECTOR);
    if (other) mountEditor(doc, other);
  }

  function boot(doc) {
    findAndMount(doc);
    if (typeof MutationObserver === 'undefined') return null;
    const root = doc.getElementById('operating-surface-body') || doc.body;
    if (!root) return null;
    const observer = new MutationObserver(() => findAndMount(doc));
    observer.observe(root, { childList: true, subtree: true });
    return observer;
  }

  if (typeof document !== 'undefined') boot(document);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { money, optionLabel, boot };
  }
})();
