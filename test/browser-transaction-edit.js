'use strict';
// Isolated transaction-edit browser proof, NOT production wiring.
// The harness page mimics the existing detail panel (the owner-supplied
// g-blend mockup's panel shell: surface, 30px radius, header with close
// affordance) as ordinary in-flow page content, and mounts the form into
// its view area — proving the component is panel CONTENT, not a popup.
// All transactions are synthetic and invented here.
// Run: CHROME_PATH=/usr/bin/chromium node test/browser-transaction-edit.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (error) { ({ chromium } = require('playwright-core')); }
const root = path.join(__dirname, '..');
const proofDir = path.join(root, 'docs', 'proof');

const CATEGORIES = [
  { id: 'cat-groceries', name: 'Groceries' },
  { id: 'cat-dining', name: 'Dining out' },
  { id: 'cat-transport', name: 'Transport' },
];
const TRANSACTIONS = [
  { id: 'syn-main', displayName: 'Corner Grocery',
    originalDescription: 'SQ *CORNER GROCERY 4417 MAPLE RIDGE BC',
    amount: 42.18, date: '2026-09-14', account: 'Synthetic Chequing',
    categoryId: 'cat-groceries', version: 3 },
  { id: 'syn-saved', displayName: 'Harbour Books',
    originalDescription: 'HARBOUR BOOKS #12 VANCOUVER BC',
    amount: 18.75, date: '2026-09-11', account: 'Synthetic Chequing',
    categoryId: 'cat-dining', version: 2 },
  { id: 'syn-locked', displayName: 'Ferry Pass',
    originalDescription: 'FERRY PASS TOPUP 0091 SYNTHETIC',
    amount: 95, date: '2026-09-09', account: 'Synthetic Savings',
    categoryId: 'cat-transport', version: 7 },
  { id: 'syn-pending', displayName: 'Pending Grocery',
    originalDescription: 'PENDING GROCERY 2210 SYNTHETIC',
    amount: 27.4, date: '2026-09-12', account: 'Synthetic Chequing',
    categoryId: 'cat-groceries', version: 1 },
];

function hostPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Synthetic transaction edit proof</title>
    <script>if (new URLSearchParams(location.search).get('theme') === 'dark')
      document.documentElement.setAttribute('data-theme', 'dark');</script>
    <link rel="stylesheet" href="/styles.css">
    <link rel="stylesheet" href="/transaction-edit.css">
    <style>
      /* Harness-only replica of the mockup panel shell (blend.css .panel /
         .panel-head / .icon-btn values), laid out in normal page flow: the
         slide-over chrome belongs to the host, never to this component. */
      .host-panel { position: relative; margin: 16px auto; width: min(500px, calc(100vw - 32px));
        border-radius: 30px; overflow: hidden; background: #ffffff; color: #0b0c10;
        box-shadow: 0 0 0 1px rgba(12,14,22,.055), 0 40px 100px -30px rgba(10,12,20,.45); }
      :root[data-theme="dark"] .host-panel { background: #121216; color: #f5f6f8;
        box-shadow: 0 0 0 1px rgba(255,255,255,.07), 0 40px 100px -30px rgba(0,0,0,.8); }
      .host-head { display: grid; grid-template-columns: 44px 1fr 44px; align-items: center;
        gap: 6px; padding: 14px 14px 6px; }
      .host-titles { text-align: center; min-width: 0; }
      .host-kicker { display: block; font-size: 13px; font-weight: 520; color: #737782; }
      :root[data-theme="dark"] .host-kicker { color: rgba(236,238,245,.52); }
      .host-title { margin: 1px 0 0; font-size: 17px; font-weight: 640; letter-spacing: -0.02em; }
      .host-close { width: 44px; height: 44px; border-radius: 50%; border: 0; cursor: pointer;
        display: grid; place-items: center; background: #f4f5f7; color: #0b0c10; }
      :root[data-theme="dark"] .host-close { background: #1a1a1f; color: #f5f6f8; }
      .host-close svg { width: 21px; height: 21px; fill: none; stroke: currentColor;
        stroke-width: 1.8; stroke-linecap: round; }
      .host-reopen { margin: 0 16px 16px; min-height: 44px; padding: 0 16px; border-radius: 12px;
        border: 0; cursor: pointer; font: inherit; font-weight: 620;
        background: #0b0c10; color: #ffffff; }
      :root[data-theme="dark"] .host-reopen { background: #f5f6f8; color: #0b0c10; }
      @media (max-width: 759px) { .host-panel { width: auto; margin: 0; border-radius: 28px 28px 0 0; } }
    </style></head>
    <body><main id="host"></main>
    <script src="/transaction-edit.js"></script><script src="/fixture.js"></script>
    </body></html>`;
}

function fixtureScript() {
  const data = JSON.stringify({ categories: CATEGORIES, transactions: TRANSACTIONS });
  return `const FIXTURE = ${data};
    const host = document.querySelector('#host');
    const blocks = {};
    function makeBlock(txn, script) {
      const adapter = TransactionEdit.createMockAdapter([txn], script || {});
      const section = document.createElement('section');
      section.className = 'host-panel'; section.id = 'panel-' + txn.id;
      section.innerHTML = '<header class="host-head"><span></span>'
        + '<div class="host-titles"><span class="host-kicker">Transaction</span>'
        + '<h2 class="host-title"></h2></div>'
        + '<button type="button" class="host-close" aria-label="Close">'
        + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>'
        + '</button></header><div class="host-view"></div>'
        + '<button type="button" class="host-reopen" hidden>Reopen transaction</button>';
      section.querySelector('.host-title').textContent = txn.displayName;
      host.appendChild(section);
      const block = { txn, adapter, section, form: null };
      const open = () => {
        block.form = TransactionEdit.createForm({
          transaction: adapter.snapshot(txn.id), categories: FIXTURE.categories, adapter });
        block.form.mount(section.querySelector('.host-view'));
        section.querySelector('.host-reopen').hidden = true;
      };
      section.querySelector('.host-close').addEventListener('click', () => {
        if (block.form) block.form.close();
        block.form = null;
        section.querySelector('.host-reopen').hidden = false;
      });
      section.querySelector('.host-reopen').addEventListener('click', open);
      open();
      blocks[txn.id] = block;
      return block;
    }
    makeBlock(FIXTURE.transactions[0]);
    makeBlock(FIXTURE.transactions[1]);
    makeBlock(FIXTURE.transactions[2]);
    makeBlock(FIXTURE.transactions[3]);
    window.__txe = { blocks, TransactionEdit };
    // Deferred-apply gate for the reopen-during-pending proof: this
    // block's adapter promise stays unresolved until the test releases
    // it, so the panel can be closed and reopened mid-flight.
    const pendingBlock = blocks['syn-pending'];
    const innerApply = pendingBlock.adapter.apply;
    let releaseApply;
    const gate = new Promise(resolve => { releaseApply = resolve; });
    pendingBlock.applyCalls = 0;
    pendingBlock.adapter.apply = async id => {
      pendingBlock.applyCalls += 1;
      await gate;
      return innerApply(id);
    };
    pendingBlock.releaseApply = () => releaseApply();`;
}

async function main() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const files = {
      '/styles.css': 'public/styles.css',
      '/transaction-edit.css': 'public/transaction-edit.css',
      '/transaction-edit.js': 'public/transaction-edit.js',
    };
    res.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); return res.end(hostPage()); }
    if (url.pathname === '/fixture.js') {
      res.setHeader('Content-Type', 'text/javascript'); return res.end(fixtureScript());
    }
    if (files[url.pathname]) {
      res.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css');
      return res.end(fs.readFileSync(path.join(root, files[url.pathname])));
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const errors = [], external = [];
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox'] });
    async function openPage(width, theme) {
      const context = await browser.newContext({ viewport: { width, height: 950 },
        hasTouch: width < 400, isMobile: width < 400 });
      await context.route('**/*', route => {
        if (new URL(route.request().url()).origin !== base) {
          external.push(route.request().url()); return route.abort();
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + (theme === 'dark' ? '/?theme=dark' : '/'));
      return { context, page };
    }
    const panelContentProof = async (page, id) => {
      const proof = await page.evaluate(txnId => {
        const formRoot = document.querySelector('#panel-' + txnId + ' [data-txe]');
        const all = [formRoot, ...formRoot.querySelectorAll('*')];
        return {
          tag: formRoot.tagName,
          fixed: all.filter(el => getComputedStyle(el).position === 'fixed').length,
          dialogs: formRoot.querySelectorAll('dialog').length,
          modalish: all.filter(el => /modal|scrim|backdrop|overlay/i.test(el.className || '')).length,
        };
      }, id);
      assert.equal(proof.tag, 'SECTION', 'the form renders a section fragment');
      assert.equal(proof.fixed, 0, 'no element in the form uses position:fixed');
      assert.equal(proof.dialogs, 0, 'no dialog element');
      assert.equal(proof.modalish, 0, 'no modal/scrim/backdrop classes');
    };

    /* ---- light, phone width: full edit → preview → apply, then stale ---- */
    {
      const { context, page } = await openPage(390, 'light');
      const panel = page.locator('#panel-syn-main');
      await panel.locator('[data-field="displayName"]').waitFor();
      await panelContentProof(page, 'syn-main');
      assert.equal(await page.evaluate(() =>
        document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow at 390px');
      await panel.screenshot({ path: path.join(proofDir, 'transaction-edit-390-light.png') });

      await panel.locator('[data-field="displayName"]').fill('Corner Grocery & Deli');
      await panel.locator('[data-field="categoryId"]').selectOption('cat-dining');
      const previewButton = panel.locator('[data-action="preview"]');
      assert.equal(await previewButton.isEnabled(), true, 'preview enables once edits are valid');
      await previewButton.click();
      const confirm = panel.locator('.txe-changes');
      await confirm.waitFor();
      const confirmText = await confirm.innerText();
      assert.match(confirmText, /Corner Grocery/);
      assert.match(confirmText, /Corner Grocery & Deli/);
      assert.match(confirmText, /Groceries/);
      assert.match(confirmText, /Dining out/);
      await panel.screenshot({ path: path.join(proofDir, 'transaction-edit-preview-390-light.png') });

      await panel.locator('[data-action="apply"]').click();
      await panel.getByText('Changes saved').waitFor();
      assert.equal(await page.evaluate(() =>
        window.__txe.blocks['syn-main'].adapter.snapshot('syn-main').displayName),
        'Corner Grocery & Deli');

      // Stale: edit again, prepare, someone else moves the transaction, apply.
      await panel.locator('[data-action="edit-again"]').click();
      await panel.locator('[data-field="displayName"]').fill('Second Edit');
      await panel.locator('[data-action="preview"]').click();
      await panel.locator('[data-action="apply"]').waitFor();
      await page.evaluate(() => window.__txe.blocks['syn-main'].adapter
        .mutateExternally('syn-main', { displayName: 'Moved By Someone Else' }));
      await panel.locator('[data-action="apply"]').click();
      await panel.getByText('changed since your preview').waitFor();
      assert.equal(await panel.locator('[data-action="apply"]').count(), 0,
        'a stale preview offers no apply action');
      assert.equal(await page.evaluate(() =>
        window.__txe.blocks['syn-main'].adapter.snapshot('syn-main').displayName),
        'Moved By Someone Else', 'the stale preview applied nothing');
      await context.close();
    }

    /* ---- light, desktop width ---- */
    {
      const { context, page } = await openPage(1440, 'light');
      const panel = page.locator('#panel-syn-main');
      await panel.locator('[data-field="displayName"]').waitFor();
      await panelContentProof(page, 'syn-main');
      await panel.screenshot({ path: path.join(proofDir, 'transaction-edit-1440-light.png') });
      await context.close();
    }

    /* ---- light, narrow phone width ---- */
    {
      const { context, page } = await openPage(320, 'light');
      const panel = page.locator('#panel-syn-main');
      await panel.locator('[data-field="displayName"]').waitFor();
      assert.equal(await page.evaluate(() =>
        document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow at 320px');
      await context.close();
    }

    /* ---- dark: editing shot, uncertain → close → reopen → verified saved,
            and uncertain → close → reopen → locked for reconciliation ---- */
    {
      const { context, page } = await openPage(390, 'dark');
      const main = page.locator('#panel-syn-main');
      await main.locator('[data-field="displayName"]').waitFor();
      await main.screenshot({ path: path.join(proofDir, 'transaction-edit-390-dark.png') });

      // Block B: the save lands but the response is lost (throw-after-mutate).
      const saved = page.locator('#panel-syn-saved');
      await page.evaluate(() => {
        window.__txe.blocks['syn-saved'].adapter.script.nextApply = 'throw-after-mutate';
      });
      await saved.locator('[data-field="displayName"]').fill('Harbour Books & Gifts');
      await saved.locator('[data-action="preview"]').click();
      await saved.locator('[data-action="apply"]').click();
      await saved.getByText('couldn’t confirm whether this change saved').waitFor();
      assert.equal(await saved.locator('[data-action="apply"]').count(), 0,
        'an uncertain preview offers no apply action');
      await saved.screenshot({ path: path.join(proofDir, 'transaction-edit-uncertain-390-dark.png') });

      // Host closes and reopens the panel: verify-first, then attested clear.
      await saved.locator('.host-close').click();
      await saved.locator('.host-reopen').click();
      await saved.getByText('An earlier save couldn’t be confirmed').waitFor();
      assert.equal(await saved.locator('[data-field="displayName"]').isDisabled(), true,
        'editing is locked until the earlier save is verified');
      await saved.locator('[data-action="verify"]').click();
      await saved.getByText('Your earlier change did save').waitFor();
      assert.equal(await saved.locator('[data-field="displayName"]').inputValue(), 'Harbour Books & Gifts',
        'the reopened form opens on the saved values as its baseline');
      assert.equal(await saved.locator('[data-field="displayName"]').isEnabled(), true);
      assert.equal(await page.evaluate(() =>
        window.__txe.TransactionEdit.pendingNotes.get('syn-saved')), null,
        'the attested outcome cleared the pending note — no resubmission exists');

      // Block C: values match the intent, but the adapter cannot attest —
      // the reopened form must stay locked for reconciliation.
      const locked = page.locator('#panel-syn-locked');
      await page.evaluate(() => {
        const adapter = window.__txe.blocks['syn-locked'].adapter;
        adapter.script.outcomeUnavailable = true;
        adapter.script.nextApply = 'throw-after-mutate';
      });
      await locked.locator('[data-field="displayName"]').fill('Ferry Pass Monthly');
      await locked.locator('[data-action="preview"]').click();
      await locked.locator('[data-action="apply"]').click();
      await locked.getByText('couldn’t confirm whether this change saved').waitFor();
      await locked.locator('.host-close').click();
      await locked.locator('.host-reopen').click();
      await locked.locator('[data-action="verify"]').click();
      await locked.getByText('locked for reconciliation').waitFor();
      assert.equal(await locked.locator('[data-field="displayName"]').isDisabled(), true,
        'a full value match without attestation stays locked');
      assert.equal(await locked.locator('[data-action="apply"], [data-action="preview"]').count(), 0,
        'no submission path exists while locked');
      assert.ok(await page.evaluate(() =>
        window.__txe.TransactionEdit.pendingNotes.get('syn-locked')),
        'the pending note survives while the outcome is unestablished');
      assert.equal(await page.evaluate(() =>
        window.__txe.blocks['syn-locked'].adapter.calls.apply), 1,
        'exactly one apply attempt ever reached the adapter');
      await context.close();
    }

    /* ---- reopen during a still-pending apply: the pending interval
            itself is locked; settlement + explicit check clears it ---- */
    {
      const { context, page } = await openPage(390, 'light');
      const panel = page.locator('#panel-syn-pending');
      await panel.locator('[data-field="displayName"]').waitFor();
      await panel.locator('[data-field="displayName"]').fill('Pending Grocery Run');
      await panel.locator('[data-action="preview"]').click();
      await panel.locator('[data-action="apply"]').click();
      await panel.getByText('Saving…').waitFor();
      assert.equal(await page.evaluate(() =>
        window.__txe.TransactionEdit.pendingNotes.get('syn-pending').state), 'in-flight',
        'the operation is reserved in the shared registry before dispatch settles');
      // Host closes and reopens the panel while the first apply is
      // still unresolved: the reopened form is locked verify-first.
      await panel.locator('.host-close').click();
      await panel.locator('.host-reopen').click();
      await panel.getByText('An earlier save couldn’t be confirmed').waitFor();
      assert.equal(await panel.locator('[data-field="displayName"]').isDisabled(), true,
        'a reopen during a pending apply is locked');
      assert.equal(await panel.locator('[data-action="apply"], [data-action="preview"]').count(), 0,
        'no submission path exists while the first apply is pending');
      assert.equal(await page.evaluate(() =>
        window.__txe.blocks['syn-pending'].applyCalls), 1,
        'exactly one apply attempt reached the adapter boundary while pending');
      assert.equal(await page.evaluate(() =>
        window.__txe.blocks['syn-pending'].adapter.calls.apply), 0,
        'the gated adapter promise has not executed yet — the write is still in flight');
      // An explicit check cannot clear an in-flight reservation.
      await panel.locator('[data-action="verify"]').click();
      await panel.getByText('locked for reconciliation').waitFor();
      // Release the first apply: its settlement releases its own
      // reservation, and the reopened form's next explicit check
      // unlocks it on the saved values.
      await page.evaluate(() => window.__txe.blocks['syn-pending'].releaseApply());
      await page.waitForFunction(() =>
        window.__txe.TransactionEdit.pendingNotes.get('syn-pending') === null);
      await panel.locator('[data-action="verify"]').click();
      await panel.getByText('Your earlier change did save').waitFor();
      assert.equal(await panel.locator('[data-field="displayName"]').inputValue(), 'Pending Grocery Run',
        'the reopened form opens on the saved values as its baseline');
      assert.equal(await panel.locator('[data-field="displayName"]').isEnabled(), true);
      assert.equal(await page.evaluate(() =>
        window.__txe.blocks['syn-pending'].applyCalls), 1,
        'the pending apply was never duplicated at the adapter boundary');
      assert.equal(await page.evaluate(() =>
        window.__txe.blocks['syn-pending'].adapter.calls.apply), 1,
        'the pending apply executed exactly once after release — never retried');
      await context.close();
    }

    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log('PASS transaction edit browser: panel-content proof (section fragment, no fixed/dialog/modal), 390/320/1440 widths, edit → exact-change preview → applied, stale refusal, uncertain screenshot in dark, reopen verify-first → attested saved clears with saved baseline, value-match-without-attestation stays locked for reconciliation, reopen during a still-pending apply opens locked (in-flight reservation) and clears only after settlement + explicit check');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
