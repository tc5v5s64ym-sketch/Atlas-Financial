'use strict';
// Actual loopback application, real login and mounted POSTs. Only authority,
// storage, context and complete base inputs are synthetic. No intercepted data
// responses on successful journeys. Edge runs the repository's actual scripts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { startWorld, env } = require('./test-settlement-evidence-http');
const KEY = 'atlas-settlement-pending-v1';
const out = process.env.ATLAS_SETTLEMENT_BROWSER_PROOF || path.join(os.tmpdir(), 'atlas-settlement-browser-proof');
const results = [];
async function openPage(browser, w, width = 390, marker) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const errors = [], external = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/settlement/')) requests.push({ method: request.method(), path: url.pathname });
  });
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== w.origin) { external.push(new URL(route.request().url()).origin); return route.abort(); }
    return route.continue();
  });
  // An observing once-hook, registered before the page's own once-hooks, proves
  // whether any initial DATA ever reached them. This does not replace a hook,
  // data acquisition, renderer, Forecast call or application route.
  await page.route('**/plan.js', async route => {
    try {
      const response = await route.fetch();
      await route.fulfill({ response, body: 'App.once(data => { window.__settlementOnce = (window.__settlementOnce || 0) + 1; });\n' + await response.text() });
    } catch (error) {
      if (!/disposed|closed|cancelled/i.test(error.message)) throw error;
    }
  });
  await page.goto(w.origin + '/login');
  await page.getByLabel('Password', { exact: true }).fill(env.SITE_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForFunction(() => typeof App !== 'undefined' && App.data !== null);
  if (marker) {
    await page.evaluate(({ KEY, marker }) => localStorage.setItem(KEY, JSON.stringify(marker)), { KEY, marker });
    await page.reload();
  }
  return { page, context, errors, external, requests };
}
async function sheet(page) {
  const tile = page.locator('[data-budget-savings-goals]'); await tile.waitFor();
  const open = tile.locator('[data-budget-funding-inventory]');
  await open.focus(); await page.keyboard.press('Enter');
  const dialog = page.locator('[data-budget-detail-sheet]'); await dialog.waitFor({ state: 'visible' });
  return dialog;
}
async function preview(page) {
  const dialog = await sheet(page);
  await dialog.getByRole('button', { name: 'Assign a recorded payment', exact: true }).click();
  await dialog.getByLabel('Amount to assign (CAD)', { exact: true }).fill('25.00');
  await dialog.getByRole('button', { name: 'Preview assignment', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm assignment', exact: true }).waitFor();
  assert.match(await dialog.locator('[data-settlement-assignment]').innerText(), /\$25\.00 CAD.*2026-10-03.*Invented first club cost.*Preview expires/);
  const stored = await page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)), KEY);
  assert.deepEqual(Object.keys(stored).sort(), ['generation', 'operationId', 'phase']); assert.equal(stored.phase, 'preview');
  assert.match(stored.generation, /^generation-[a-f0-9]{32}$/);
  return dialog;
}
async function facts(page) {
  return page.evaluate(() => {
    const d = App.data;
    const row = Forecast.savingsInventory(d.plan, d.meta.asOf,
      { settlementEvidence: d.settlementEvidence }).pools[0].plannedGoals[0];
    return { original: row.target, paid: row.linkedPaid, remaining: row.remaining };
  });
}
async function complete(page, dialog) {
  await Promise.all([page.waitForEvent('load'), dialog.getByRole('button', { name: 'Confirm assignment', exact: true }).dblclick()]);
  await page.waitForFunction(() => typeof App !== 'undefined' && App.data?.settlementEvidenceStatus?.status === 'qualified');
  await page.waitForFunction(KEY => localStorage.getItem(KEY) === null, KEY);
}
async function refuseStorageReads(context) {
  await context.addInitScript(() => {
    Storage.prototype.getItem = function () { throw new DOMException('synthetic storage read refusal', 'SecurityError'); };
  });
}
function bootTraffic(page) {
  const traffic = { ordinary: 0, classification: 0 };
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path === '/data.json') traffic.ordinary++;
    if (path === '/settlement/capability' && request.headers()['x-atlas-settlement'] === 'same-origin') traffic.classification++;
  });
  return traffic;
}
async function reconciliationBoot(page) {
  await page.getByText('Assignment outcome needs reconciliation. Figures remain unavailable.', { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => App.data), null);
  assert.equal(await page.evaluate(() => window.__settlementOnce || 0), 0);
}
function observeMarkerMutations() {
  const key = 'atlas-settlement-pending-v1';
  let locked = false;
  window.__markerLockHeld = false;
  window.__markerMutations = [];
  const request = navigator.locks.request.bind(navigator.locks);
  navigator.locks.request = (name, options, callback) => request(name, options, async lock => {
    if (name === key && options.mode === 'exclusive') { locked = true; window.__markerLockHeld = true; }
    try { return await callback(lock); } finally { locked = false; window.__markerLockHeld = false; }
  });
  for (const method of ['setItem', 'removeItem']) {
    const original = Storage.prototype[method];
    Storage.prototype[method] = function (name, ...args) {
      if (name === key) window.__markerMutations.push({ method, locked });
      return original.call(this, name, ...args);
    };
  }
}
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const browserVersion = browser.version();
  try {
    const run = async (name, action, active = true, width = 390, options = {}) => {
      if (process.env.ATLAS_SETTLEMENT_BROWSER_CASE && name !== process.env.ATLAS_SETTLEMENT_BROWSER_CASE) return;
      const w = await startWorld(active, options); let fixture;
      try {
        fixture = await openPage(browser, w, width);
        await action(w, fixture);
        assert.deepEqual(fixture.external, [], 'zero external network requests');
        assert.deepEqual(fixture.errors, [], 'zero page errors');
        results.push({ name, width, status: 'PASS', commits: w.calls.commit, journalWrites: w.calls.journal,
          requests: fixture.requests, details: fixture.details }); console.log('PASS ' + name);
      } catch (error) {
        // Independent cases still execute, but any failure makes the command
        // fail. Preserve the actual trace instead of manufacturing a green run.
        const screenshot = 'failure-' + results.length + '.png';
        if (fixture && !fixture.page.isClosed()) await fixture.page.screenshot({ path: path.join(out, screenshot) }).catch(() => {});
        results.push({ name, width, status: 'FAIL', failure: error.message.slice(0, 6000),
          screenshot, details: fixture?.details, commits: w.calls.commit, journalWrites: w.calls.journal,
          requests: fixture?.requests || [] });
        console.error('FAIL ' + name + ': ' + error.message.split('\n')[0]);
      } finally { await fixture?.context.close(); await w.close(); }
    };
    await run('default inactive controls and zero storage', async (w, { page }) => {
      const dialog = await sheet(page);
      await page.waitForResponse(r => r.url().endsWith('/settlement/capability')).catch(() => {});
      assert.equal(await dialog.getByRole('button', { name: 'Assign a recorded payment' }).count(), 0);
      assert.equal(w.calls.storage, 0); assert.equal(w.calls.acquire, 0);
    }, false);
    await run('raw storage refusal boots ordinary data only with real sealed preactivation attestation', async (w, fixture) => {
      const { page, context } = fixture;
      await refuseStorageReads(context); const traffic = bootTraffic(page);
      const classified = page.waitForResponse(response => response.url().endsWith('/settlement/capability')
        && response.request().headers()['x-atlas-settlement'] === 'same-origin');
      await page.reload();
      assert.deepEqual(await (await classified).json(), { status: 'inactive', bootClassification: 'preactivation-only' });
      await page.waitForFunction(() => typeof App !== 'undefined' && App.data !== null && window.__settlementOnce === 1);
      const dialog = await sheet(page);
      assert.equal(await dialog.getByRole('button', { name: 'Assign a recorded payment', exact: true }).count(), 0);
      assert.deepEqual(traffic, { ordinary: 1, classification: 1 });
      assert.deepEqual(w.calls, { storage: 0, journal: 0, commit: 0, acquire: 0, base: 0 });
      fixture.details = { traffic, once: 1, trustedDeploymentAssertionOnly: true };
    }, false, 390, { preactivationOnly: true });
    for (const active of [false, true]) {
      await run('raw storage refusal with ' + (active ? 'active' : 'history-unknown inactive') + ' construction stays fenced', async (w, fixture) => {
        const { page, context } = fixture;
        const before = { ...w.calls };
        await refuseStorageReads(context); const traffic = bootTraffic(page);
        await page.reload(); await reconciliationBoot(page);
        assert.deepEqual(traffic, { ordinary: 0, classification: 1 });
        assert.deepEqual(w.calls, before);
        fixture.details = { traffic, once: 0, active };
      }, active);
    }
    for (const failure of ['unauthorized', 'unavailable', 'malformed-json', 'unknown-classification', 'extra-field', 'network']) {
      await run('raw storage refusal with ' + failure + ' classification never initializes figures', async (w, fixture) => {
        const { page, context } = fixture;
        await refuseStorageReads(context); const traffic = bootTraffic(page);
        await page.route('**/settlement/capability', async route => {
          if (route.request().headers()['x-atlas-settlement'] !== 'same-origin') return route.continue();
          if (failure === 'unauthorized') {
            const response = await route.fetch({ headers: { ...route.request().headers(), Cookie: 'hfd_session=synthetic-invalid' } });
            assert.equal(response.status(), 401); return route.fulfill({ response });
          }
          if (failure === 'network') return route.abort();
          return route.fulfill({ status: failure === 'unavailable' ? 503 : 200, contentType: 'application/json',
            body: failure === 'malformed-json' ? '{' : JSON.stringify(failure === 'extra-field'
              ? { status: 'inactive', bootClassification: 'preactivation-only', extra: true }
              : { status: 'inactive', bootClassification: 'unknown' }) });
        });
        await page.reload(); await reconciliationBoot(page);
        assert.deepEqual(traffic, { ordinary: 0, classification: 1 });
        assert.equal(w.calls.storage, 0); assert.equal(w.calls.commit, 0);
        fixture.details = { traffic, failure, deliberateClassificationFault: true };
      }, false, 390, { preactivationOnly: true });
    }
    await run('raw storage refusal with timed-out classification stays fenced under deterministic browser clock', async (w, fixture) => {
      const { page, context } = fixture;
      await refuseStorageReads(context); const traffic = bootTraffic(page);
      await page.clock.install();
      let received, release;
      const seen = new Promise(resolve => { received = resolve; });
      const held = new Promise(resolve => { release = resolve; });
      await page.route('**/settlement/capability', async route => {
        if (route.request().headers()['x-atlas-settlement'] !== 'same-origin') return route.continue();
        const response = await route.fetch(); received(); await held;
        await route.fulfill({ response }).catch(() => {});
      });
      try {
        const navigation = page.reload({ waitUntil: 'domcontentloaded' });
        await seen; await page.clock.fastForward(20001); await navigation;
        await reconciliationBoot(page);
        assert.deepEqual(traffic, { ordinary: 0, classification: 1 });
        assert.equal(w.calls.storage, 0); assert.equal(w.calls.commit, 0);
        fixture.details = { traffic, heldActualClassificationReply: true, advancedMs: 20001 };
      } finally { release(); }
    }, false, 390, { preactivationOnly: true });
    await run('readable malformed markers never request preactivation exception even when sealed', async (w, fixture) => {
      const { page } = fixture; const traffic = bootTraffic(page);
      for (const value of ['{', 'x'.repeat(161), JSON.stringify({ operationId: 'invalid', phase: 'preview' }),
        JSON.stringify({ operationId: 'operation-' + 'a'.repeat(32), phase: 'dispatched', extra: true }),
        ...[null, {}, 'invalid'].map(generation => JSON.stringify({ operationId: 'operation-' + 'a'.repeat(32), phase: 'dispatched', generation }))]) {
        await page.evaluate(({ KEY, value }) => localStorage.setItem(KEY, value), { KEY, value });
        await page.reload(); await reconciliationBoot(page);
        assert.equal(await page.evaluate(KEY => localStorage.getItem(KEY), KEY), value);
      }
      assert.deepEqual(traffic, { ordinary: 0, classification: 0 });
      assert.equal(w.calls.storage, 0); assert.equal(w.calls.commit, 0);
      fixture.details = { traffic, readableMalformedCases: 4 };
    }, false, 390, { preactivationOnly: true });
    await run('readable dispatched marker never bypasses recovery even when sealed', async (w, fixture) => {
      const { page, requests } = fixture; const traffic = bootTraffic(page);
      const marker = { operationId: 'operation-' + 'a'.repeat(32), phase: 'dispatched' };
      await page.evaluate(({ KEY, marker }) => localStorage.setItem(KEY, JSON.stringify(marker)), { KEY, marker });
      await page.reload(); await reconciliationBoot(page);
      assert.deepEqual(await page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)), KEY), marker);
      assert.deepEqual(traffic, { ordinary: 0, classification: 0 });
      assert.equal(requests.filter(request => request.path === '/settlement/outcome').length, 1);
      assert.equal(requests.filter(request => request.path === '/settlement/confirm').length, 0);
      assert.equal(w.calls.storage, 0); fixture.details = { traffic, retainedDispatched: true };
    }, false, 390, { preactivationOnly: true });
    await run('real Savings sheet preview, confirm, full reload and independent 60/25/35', async (w, { page, requests }) => {
      const dialog = await preview(page); assert.equal(w.calls.commit, 0); assert.equal(w.calls.journal, 0);
      // The sheet moves the original source, including this live form.
      assert.equal(await dialog.locator('[data-budget-funding-savings] [data-settlement-assignment]').count(), 1);
      await dialog.screenshot({ path: path.join(out, 'preview-390.png') });
      await complete(page, dialog);
      assert.deepEqual(await facts(page), { original: 60, paid: 25, remaining: 35 });
      const after = await sheet(page);
      await after.screenshot({ path: path.join(out, 'saved-390.png') });
      const first = await after.innerText();
      assert.match(first, /\$25\.00/); assert.match(first, /\$35\.00/);
      await page.keyboard.press('Escape');
      const original = await page.locator('[data-budget-savings-goals]').innerText();
      await page.evaluate(() => App.rerender());
      assert.equal(await page.locator('[data-budget-savings-goals]').innerText(), original);
      const step = async key => {
        const start = await page.locator('[data-budget-window-progress]').getAttribute('data-start');
        await page.locator('.river').focus(); await page.keyboard.press(key);
        await page.waitForFunction(start => document.querySelector('[data-budget-window-progress]')?.dataset.start !== start, start);
      };
      await step('ArrowRight'); const next = await page.locator('[data-budget-savings-goals]').innerText();
      await step('ArrowLeft'); assert.equal(await page.locator('[data-budget-savings-goals]').innerText(), original);
      await step('ArrowRight'); assert.equal(await page.locator('[data-budget-savings-goals]').innerText(), next);
      assert.equal(w.calls.commit, 1);
      assert.equal(requests.filter(x => x.path === '/settlement/confirm').length, 1);
      assert.equal(requests.filter(x => x.path === '/settlement/publication').length, 1);
      await page.reload();
      await page.waitForFunction(() => typeof App !== 'undefined' && App.data?.settlementEvidenceStatus?.status === 'qualified');
      assert.deepEqual(await facts(page), { original: 60, paid: 25, remaining: 35 });
      await step('ArrowRight'); assert.equal(await page.locator('[data-budget-savings-goals]').innerText(), next);
    });
    await run('restart before dispatch abandons only the never-sent preview', async (w, { page, requests }) => {
      await preview(page); await page.reload();
      await page.waitForFunction(() => App.data !== null);
      assert.equal(w.calls.commit, 0);
      assert.equal(await page.evaluate(KEY => localStorage.getItem(KEY), KEY), null);
      assert.equal(requests.filter(x => x.path === '/settlement/outcome').length, 0);
      await preview(page); assert.equal(w.calls.commit, 0);
    });
    await run('two-tab stale preview boot cannot erase a dispatched reconciliation marker', async (w, fixture) => {
      const { page, context, requests } = fixture;
      const dialog = await preview(page);
      const operationId = await page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)).operationId, KEY);
      const generation = await page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)).generation, KEY);
      const second = await context.newPage(); second.setDefaultTimeout(15000);
      const secondRequests = [];
      second.on('pageerror', error => fixture.errors.push(error.message));
      second.on('request', request => secondRequests.push(new URL(request.url()).pathname));
      let releaseBoot, readBoot;
      const bootGate = new Promise(resolve => { releaseBoot = resolve; });
      const bootRead = new Promise(resolve => { readBoot = resolve; });
      await second.exposeBinding('__settlementBootPause', async (_, marker) => {
        readBoot(marker); await bootGate;
      });
      await second.route('**/*', route => {
        if (new URL(route.request().url()).origin !== w.origin) {
          fixture.external.push(new URL(route.request().url()).origin); return route.abort();
        }
        return route.continue();
      });
      await second.route('**/app.js', async route => {
        const response = await route.fetch(), source = await response.text();
        const anchor = 'try { marker = parsePending(raw); } catch';
        assert.equal(source.split(anchor).length, 2, 'one initial marker-read observation point');
        // Deliberate scheduling only: pause B after its real shared-storage
        // read. A still uses the actual script and actual mounted confirm.
        await route.fulfill({ response, body: source.replace(anchor,
          'try { marker = parsePending(raw); await window.__settlementBootPause(marker); } catch') });
      });
      await second.route('**/plan.js', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: 'App.once(() => { window.__settlementOnce = (window.__settlementOnce || 0) + 1; });\n' + await response.text() });
      });
      try {
        const navigation = second.goto(w.origin + '/');
        assert.deepEqual(await bootRead, { operationId, phase: 'preview', generation });
        await page.route('**/settlement/confirm', async route => { await route.fetch(); return route.abort(); });
        await dialog.getByRole('button', { name: 'Confirm assignment', exact: true }).click();
        await dialog.getByText('Assignment outcome needs reconciliation.', { exact: false }).waitFor();
        assert.equal(w.calls.commit, 1);
        const receiptDocument = Buffer.from(w.durable.doc);
        assert.equal(await page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)).phase, KEY), 'dispatched');
        w.readFailure = true; releaseBoot(); await navigation;
        await second.waitForFunction(() => typeof App !== 'undefined' && App.data !== null);
        const marker = await second.evaluate(KEY => localStorage.getItem(KEY), KEY);
        fixture.details = { realSharedContext: true, pausedBootPhase: 'preview',
          responseDroppedAfterCommit: true, secondRequests, retainedDispatched: marker !== null };
        assert.ok(marker, 'B must not erase A\'s now-dispatched marker using its stale preview read');
        assert.deepEqual(JSON.parse(marker), { operationId, phase: 'dispatched', generation });
        assert.equal(secondRequests.filter(path => path === '/data.json').length, 0, 'B cannot fall through to ordinary data');
        assert.equal(secondRequests.filter(path => path === '/settlement/outcome').length, 1);
        assert.equal(secondRequests.filter(path => path === '/settlement/publication').length, 1);
        await second.locator('[data-settlement-recovery]').waitFor();
        assert.equal(await second.evaluate(() => App.data.settlementEvidenceStatus.status), 'unavailable');
        assert.equal(await second.evaluate(() => window.__settlementOnce), 1);
        w.readFailure = false; await page.reload();
        await page.waitForFunction(() => typeof App !== 'undefined' && App.data?.settlementEvidenceStatus?.status === 'qualified');
        await page.waitForFunction(KEY => localStorage.getItem(KEY) === null, KEY);
        assert.deepEqual(await facts(page), { original: 60, paid: 25, remaining: 35 });
        assert.equal(w.calls.commit, 1); assert.ok(w.durable.doc.equals(receiptDocument));
        assert.equal(requests.filter(request => request.path === '/settlement/confirm').length, 1);
      } finally { releaseBoot(); await second.close(); }
    });
    await run('all marker mutations are locked and a stale prepared tab cannot overwrite dispatch', async (w, fixture) => {
      const { page, context, requests } = fixture;
      await context.addInitScript(observeMarkerMutations);
      await page.evaluate(observeMarkerMutations);
      const second = await context.newPage(); second.setDefaultTimeout(15000);
      second.on('pageerror', error => fixture.errors.push(error.message));
      await second.route('**/*', route => {
        if (new URL(route.request().url()).origin !== w.origin) {
          fixture.external.push(new URL(route.request().url()).origin); return route.abort();
        }
        return route.continue();
      });
      let releasePrepare, prepared;
      const gate = new Promise(resolve => { releasePrepare = resolve; });
      const seen = new Promise(resolve => { prepared = resolve; });
      await second.route('**/settlement/prepare', async route => {
        const response = await route.fetch(); prepared(); await gate;
        await route.fulfill({ response });
      });
      try {
        await second.goto(w.origin + '/');
        await second.waitForFunction(() => typeof App !== 'undefined' && App.data !== null);
        const otherDialog = await sheet(second);
        await otherDialog.getByRole('button', { name: 'Assign a recorded payment', exact: true }).click();
        await otherDialog.getByLabel('Amount to assign (CAD)', { exact: true }).fill('25.00');
        await otherDialog.getByRole('button', { name: 'Preview assignment', exact: true }).click();
        await seen;
        const dialog = await preview(page);
        await page.route('**/settlement/confirm', async route => { await route.fetch(); return route.abort(); });
        await dialog.getByRole('button', { name: 'Confirm assignment', exact: true }).click();
        await dialog.getByText('Assignment outcome needs reconciliation.', { exact: false }).waitFor();
        const dispatched = await page.evaluate(KEY => localStorage.getItem(KEY), KEY);
        releasePrepare();
        await otherDialog.getByText('Preview unavailable. No confirmation was sent.', { exact: false }).waitFor();
        assert.equal(await second.evaluate(KEY => localStorage.getItem(KEY), KEY), dispatched);
        assert.equal(await otherDialog.getByRole('button', { name: 'Confirm assignment', exact: true }).count(), 0);
        const before = await page.evaluate(() => window.__markerMutations);
        assert.deepEqual(before, [{ method: 'setItem', locked: true }, { method: 'setItem', locked: true }]);
        assert.deepEqual(await second.evaluate(() => window.__markerMutations), []);
        await page.reload();
        await page.waitForFunction(KEY => typeof App !== 'undefined' && App.data?.settlementEvidenceStatus?.status === 'qualified'
          && localStorage.getItem(KEY) === null, KEY);
        const after = await page.evaluate(() => window.__markerMutations);
        assert.deepEqual(after, [{ method: 'removeItem', locked: true }]);
        assert.equal(w.calls.commit, 1);
        assert.equal(requests.filter(request => request.path === '/settlement/confirm').length, 1);
        fixture.details = { before, after, stalePreparedResponseRefused: true, sharedContext: true };
      } finally { releasePrepare(); await second.close(); }
    });
    await run('missing cross-tab lock support refuses active controls without dispatch', async (w, { page, context, requests }) => {
      await context.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true }));
      await page.reload();
      await page.waitForFunction(() => typeof App !== 'undefined' && App.data !== null);
      const dialog = await sheet(page);
      await dialog.getByText('Assignment controls unavailable.', { exact: true }).waitFor();
      assert.equal(await dialog.getByRole('button', { name: 'Assign a recorded payment', exact: true }).count(), 0);
      assert.equal(requests.filter(request => ['/settlement/prepare', '/settlement/confirm'].includes(request.path)).length, 0);
      assert.equal(w.calls.commit, 0);
    });
    await run('lost commit response, recreated controller, same original receipt, no second commit', async (w, { page, requests }) => {
      const dialog = await preview(page);
      await page.route('**/settlement/confirm', async route => { await route.fetch(); return route.abort(); });
      await dialog.getByRole('button', { name: 'Confirm assignment', exact: true }).click();
      await dialog.getByText('Assignment outcome needs reconciliation.', { exact: false }).waitFor();
      assert.equal(w.calls.commit, 1); const original = Buffer.from(w.durable.doc);
      w.recreate(); await page.unroute('**/settlement/confirm'); await page.reload();
      await page.waitForFunction(() => typeof App !== 'undefined' && App.data?.settlementEvidenceStatus?.status === 'qualified');
      assert.deepEqual(await facts(page), { original: 60, paid: 25, remaining: 35 });
      assert.ok(w.durable.doc.equals(original)); assert.equal(w.calls.commit, 1);
      assert.equal(requests.filter(x => x.path === '/settlement/confirm').length, 1);
      assert.equal(await page.evaluate(() => window.__settlementOnce), 1);
    });
    await run('active lost response then disabled composition retains uncertainty and recovers without new confirm', async (w, fixture) => {
      const { page, requests } = fixture;
      const dialog = await preview(page);
      await page.route('**/settlement/confirm', async route => { await route.fetch(); return route.abort(); });
      await dialog.getByRole('button', { name: 'Confirm assignment', exact: true }).click();
      await dialog.getByText('Assignment outcome needs reconciliation.', { exact: false }).waitFor();
      const marker = await page.evaluate(KEY => localStorage.getItem(KEY), KEY);
      const document = Buffer.from(w.durable.doc), before = { ...w.calls };
      w.recreate('disabled'); const traffic = bootTraffic(page);
      await page.reload(); await reconciliationBoot(page);
      assert.equal(await page.evaluate(KEY => localStorage.getItem(KEY), KEY), marker);
      assert.deepEqual(traffic, { ordinary: 0, classification: 0 });
      assert.deepEqual(w.calls, before); assert.ok(w.durable.doc.equals(document));
      assert.equal(requests.filter(request => request.path === '/settlement/confirm').length, 1);
      w.recreate('active'); await page.unroute('**/settlement/confirm'); await page.reload();
      await page.waitForFunction(KEY => typeof App !== 'undefined' && App.data?.settlementEvidenceStatus?.status === 'qualified'
        && localStorage.getItem(KEY) === null, KEY);
      assert.deepEqual(await facts(page), { original: 60, paid: 25, remaining: 35 });
      assert.equal(w.calls.commit, 1); assert.ok(w.durable.doc.equals(document));
      assert.equal(requests.filter(request => request.path === '/settlement/confirm').length, 1);
      fixture.details = { traffic, disabledRetainedUncertainty: true, sameReceipt: true };
    });
    await run('saved view unavailable boots withheld object and recovers by whole reload', async (w, { page }) => {
      const dialog = await preview(page);
      w.readFailure = true;
      await Promise.all([page.waitForEvent('load'), dialog.getByRole('button', { name: 'Confirm assignment', exact: true }).click()]);
      await page.locator('[data-settlement-recovery]').waitFor();
      assert.match(await page.locator('[data-settlement-recovery]').innerText(), /Saved; view unavailable/);
      assert.equal(await page.evaluate(() => App.data.settlementEvidenceStatus.status), 'unavailable');
      assert.equal(await page.evaluate(() => Object.hasOwn(App.data, 'settlementEvidence')), false);
      assert.equal(await page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)).phase, KEY), 'dispatched');
      assert.equal(await page.evaluate(() => window.__settlementOnce), 1);
      w.readFailure = false;
      await page.getByRole('button', { name: 'Check saved view', exact: true }).click();
      await page.waitForFunction(() => typeof App !== 'undefined' && App.data?.settlementEvidenceStatus?.status === 'qualified');
      assert.deepEqual(await facts(page), { original: 60, paid: 25, remaining: 35 }); assert.equal(w.calls.commit, 1);
    });
    await run('unknown dispatched restart never loads stale ordinary data or once-hooks', async (w, { page, requests }) => {
      const dialog = await preview(page);
      await page.route('**/settlement/confirm', route => route.abort());
      await dialog.getByRole('button', { name: 'Confirm assignment', exact: true }).click();
      await dialog.getByText('Assignment outcome needs reconciliation.', { exact: false }).waitFor();
      assert.equal(w.calls.commit, 0);
      let ordinary = 0; page.on('request', r => { if (new URL(r.url()).pathname === '/data.json') ordinary++; });
      await page.reload(); await page.getByText('Assignment outcome needs reconciliation. Figures remain unavailable.', { exact: false }).waitFor();
      assert.equal(await page.evaluate(() => App.data), null);
      assert.equal(await page.evaluate(() => window.__settlementOnce || 0), 0); assert.equal(ordinary, 0);
      assert.equal(requests.filter(x => x.path === '/settlement/confirm').length, 1);
    });
    await run('persistence failure prevents confirm dispatch', async (w, { page, requests }) => {
      const dialog = await preview(page);
      const traffic = bootTraffic(page);
      await page.evaluate(KEY => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (key === KEY && JSON.parse(value).phase === 'dispatched') throw new Error('synthetic storage refusal');
          return original.call(this, key, value);
        };
      }, KEY);
      await dialog.getByRole('button', { name: 'Confirm assignment', exact: true }).click();
      await dialog.getByText('Confirmation was not sent:', { exact: false }).waitFor();
      assert.equal(w.calls.commit, 0);
      assert.equal(requests.filter(x => x.path === '/settlement/confirm').length, 0);
      assert.equal(traffic.classification, 0, 'persistence failure cannot request the boot exception');
      await page.reload(); await page.waitForFunction(() => typeof App !== 'undefined' && App.data !== null);
      assert.equal(await page.evaluate(KEY => localStorage.getItem(KEY), KEY), null);
      assert.equal(traffic.classification, 0);
    });
    await run('new signed login cannot recover an old session receipt or clear uncertainty', async (w, { page, requests }) => {
      const dialog = await preview(page);
      await page.route('**/settlement/confirm', async route => { await route.fetch(); return route.abort(); });
      await dialog.getByRole('button', { name: 'Confirm assignment', exact: true }).click();
      await dialog.getByText('Assignment outcome needs reconciliation.', { exact: false }).waitFor();
      const marker = await page.evaluate(KEY => localStorage.getItem(KEY), KEY);
      await page.context().clearCookies();
      await page.goto(w.origin + '/login');
      await page.getByLabel('Password', { exact: true }).fill(env.SITE_PASSWORD);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByText('Assignment outcome needs reconciliation. Figures remain unavailable.', { exact: false }).waitFor();
      assert.equal(await page.evaluate(() => App.data), null);
      assert.equal(await page.evaluate(() => window.__settlementOnce || 0), 0);
      assert.equal(await page.evaluate(KEY => localStorage.getItem(KEY), KEY), marker);
      assert.equal(requests.filter(x => x.path === '/settlement/confirm').length, 1); assert.equal(w.calls.commit, 1);
    });
    await run('malformed publication fails before DATA/once-hooks then whole reload recovers', async (w, { page }) => {
      const dialog = await preview(page);
      await page.route('**/settlement/publication', async route => {
        await route.fetch();
        return route.fulfill({ json: { status: 'committed', publication: 'included', data: { plan: {}, meta: {}, settlementEvidenceStatus: { status: 'qualified' }, settlementEvidence: {} } } });
      });
      await Promise.all([page.waitForEvent('load'), dialog.getByRole('button', { name: 'Confirm assignment', exact: true }).click()]);
      await page.getByText('Assignment outcome needs reconciliation. Figures remain unavailable.', { exact: false }).waitFor();
      assert.equal(await page.evaluate(() => App.data), null); assert.equal(await page.evaluate(() => window.__settlementOnce || 0), 0);
      assert.equal(await page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)).phase, KEY), 'dispatched');
      await page.unroute('**/settlement/publication'); await page.reload();
      await page.waitForFunction(() => typeof App !== 'undefined' && App.data?.settlementEvidenceStatus?.status === 'qualified');
      assert.deepEqual(await facts(page), { original: 60, paid: 25, remaining: 35 }); assert.equal(w.calls.commit, 1);
    });
    await run('desktop actual sheet controls and single-effect double click', async (w, { page }) => {
      const dialog = await preview(page); await complete(page, dialog);
      assert.deepEqual(await facts(page), { original: 60, paid: 25, remaining: 35 });
      assert.equal(w.calls.commit, 1); assert.equal(w.calls.journal, 1);
      await (await sheet(page)).screenshot({ path: path.join(out, 'saved-1440.png') });
    }, true, 1440);
    await run('successful purchase assignment leaves unrelated card-coverage holds unresolved', async (w, { page }) => {
      w.base.liveOverlay.currentPeriodActuals.cardCoverageRequired = true;
      w.acquisition.packet.cardCoverageRequired = true;
      await page.reload();
      await page.waitForFunction(() => typeof App !== 'undefined' && App.data?.liveOverlay?.currentPeriodActuals.cardCoverageRequired === true);
      const coverage = () => page.evaluate(() => {
        const d = App.data;
        return Forecast.recommend(d.plan, d.meta.asOf, { ...d.liveOverlay, debts: d.debts,
          weeklyVariable: 0, settlementEvidence: d.settlementEvidence }).cardPurchaseCoverage;
      });
      const before = await coverage(); assert.equal(before.status, 'unavailable'); assert.equal(before.reservedCash, null);
      await complete(page, await preview(page));
      assert.deepEqual(await facts(page), { original: 60, paid: 25, remaining: 35 });
      assert.deepEqual(await coverage(), before); assert.equal(w.calls.commit, 1);
    });
    await run('pending boot actual mounted HTTP401 keeps marker and never loads ordinary data or once-hooks', async (w, { page, requests }) => {
      const dialog = await preview(page);
      await page.route('**/settlement/confirm', async route => { await route.fetch(); return route.abort(); });
      await dialog.getByRole('button', { name: 'Confirm assignment', exact: true }).click();
      await dialog.getByText('Assignment outcome needs reconciliation.', { exact: false }).waitFor();
      const marker = await page.evaluate(KEY => localStorage.getItem(KEY), KEY);
      // Deliberate request fault: the upstream mounted outcome route receives
      // an invalid cookie and actually returns 401. No fabricated data/body.
      await page.route('**/settlement/outcome', async route => {
        const response = await route.fetch({ headers: { ...route.request().headers(), cookie: 'hfd_session=synthetic-invalid-cookie' } });
        assert.equal(response.status(), 401);
        return route.fulfill({ response });
      });
      let ordinary = 0; page.on('request', r => { if (new URL(r.url()).pathname === '/data.json') ordinary++; });
      const unauthorized = page.waitForResponse(r => r.url().endsWith('/settlement/outcome') && r.status() === 401);
      await page.reload(); await unauthorized;
      await page.getByText('Assignment outcome needs reconciliation. Figures remain unavailable.', { exact: false }).waitFor();
      assert.equal(await page.evaluate(() => App.data), null);
      assert.equal(await page.evaluate(() => window.__settlementOnce || 0), 0);
      assert.equal(ordinary, 0); assert.equal(await page.evaluate(KEY => localStorage.getItem(KEY), KEY), marker);
      assert.equal(requests.filter(x => x.path === '/settlement/confirm').length, 1); assert.equal(w.calls.commit, 1);
    });
    for (const dismissal of ['close button', 'Escape cancellation']) {
      await run(dismissal + ' during dispatched confirm preserves marker and cannot confirm twice', async (w, { page, requests }) => {
        const dialog = await preview(page);
        let reached, release;
        const entered = new Promise(resolve => { reached = resolve; });
        const gate = new Promise(resolve => { release = resolve; });
        await page.route('**/settlement/confirm', async route => {
          const response = await route.fetch(); // real application commits once
          reached(); await gate; // deliberately hold only its response
          return route.fulfill({ response });
        });
        try {
          await dialog.getByRole('button', { name: 'Confirm assignment', exact: true }).click();
          await entered;
          const marker = await page.evaluate(KEY => localStorage.getItem(KEY), KEY);
          assert.equal(JSON.parse(marker).phase, 'dispatched'); assert.equal(w.calls.commit, 1);
          if (dismissal === 'close button') await dialog.locator('[data-budget-detail-close]').click();
          else await page.keyboard.press('Escape');
          await dialog.waitFor({ state: 'hidden' });
          assert.equal(await page.evaluate(KEY => localStorage.getItem(KEY), KEY), marker);
          const reopened = await sheet(page);
          assert.equal(await reopened.getByRole('button', { name: 'Confirm assignment', exact: true }).isEnabled(), false);
          assert.equal(requests.filter(x => x.path === '/settlement/confirm').length, 1);
          const loaded = page.waitForEvent('load'); release(); await loaded;
          await page.waitForFunction(() => typeof App !== 'undefined' && App.data?.settlementEvidenceStatus?.status === 'qualified');
          assert.deepEqual(await facts(page), { original: 60, paid: 25, remaining: 35 });
          assert.equal(w.calls.commit, 1); assert.equal(w.calls.journal, 1);
        } finally { release(); }
      });
    }
    let previewClock = Date.now();
    await run('deterministically expired preview returns bound no-effect proof and permits explicit reload', async (w, { page, requests }) => {
      const dialog = await preview(page);
      const marker = await page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)), KEY);
      previewClock += require('../scripts/planned-obligation-settlement-contract').TTL_MS;
      const response = page.waitForResponse(r => r.url().endsWith('/settlement/confirm'));
      await dialog.getByRole('button', { name: 'Confirm assignment', exact: true }).click();
      const ack = await (await response).json();
      assert.equal(ack.status, 'not-applied'); assert.equal(ack.operationId, marker.operationId);
      assert.equal(ack.generation, marker.generation); assert.match(ack.previewToken, /^[a-f0-9]{64}$/);
      await dialog.getByText('Not saved.', { exact: false }).waitFor();
      assert.equal(w.calls.commit, 0); assert.equal(w.calls.journal, 0);
      assert.equal(await page.evaluate(KEY => localStorage.getItem(KEY), KEY), null);
      assert.equal(requests.filter(x => x.path === '/settlement/outcome').length, 0);
      await Promise.all([page.waitForEvent('load'), dialog.getByRole('button', { name: 'Reload current view', exact: true }).click()]);
      await page.waitForFunction(() => typeof App !== 'undefined' && App.data !== null);
      assert.deepEqual(await facts(page), { original: 60, paid: 0, remaining: 60 });
      assert.equal(requests.filter(x => x.path === '/settlement/confirm').length, 1);
    }, true, 390, { now: () => previewClock });
    for (const refusal of ['selection-change', 'admission-refused']) {
      await run('received terminal proof for ' + refusal + ' clears only its marker', async (w, { page, requests }) => {
        await page.evaluate(observeMarkerMutations);
        await page.evaluate(() => {
          const original = window.fetch;
          window.__networkWhileMarkerLocked = false;
          window.fetch = (...args) => { window.__networkWhileMarkerLocked ||= window.__markerLockHeld; return original(...args); };
        });
        const dialog = await preview(page);
        if (refusal === 'selection-change') w.acquisition.packet.observationAsOf = '2026-10-06';
        else w.hooks.admission = async () => { w.cell.revision++; };
        await dialog.getByRole('button', { name: 'Confirm assignment', exact: true }).click();
        await dialog.getByText('Not saved.', { exact: false }).waitFor();
        assert.equal(await page.evaluate(KEY => localStorage.getItem(KEY), KEY), null);
        assert.equal(await page.evaluate(() => window.__networkWhileMarkerLocked), false);
        assert.ok((await page.evaluate(() => window.__markerMutations)).every(m => m.locked));
        assert.equal(w.calls.journal, 0); assert.equal(requests.filter(x => x.path === '/settlement/confirm').length, 1);
      });
    }
    for (const fault of ['wrong-operation', 'wrong-generation', 'wrong-token', 'extra-field', 'lost-reply', 'cleanup-storage', 'cleanup-lock']) {
      let clock = Date.now();
      await run('terminal proof ' + fault + ' preserves uncertainty without replay', async (w, { page, requests }) => {
        const dialog = await preview(page); clock += require('../scripts/planned-obligation-settlement-contract').TTL_MS;
        await page.route('**/settlement/confirm', async route => {
          const response = await route.fetch(); const ack = await response.json(); assert.equal(ack.status, 'not-applied');
          if (fault === 'lost-reply') return route.abort('failed');
          if (fault === 'wrong-operation') ack.operationId = 'operation-' + 'f'.repeat(32);
          if (fault === 'wrong-generation') ack.generation = 'generation-' + 'f'.repeat(32);
          if (fault === 'wrong-token') ack.previewToken = 'f'.repeat(64);
          if (fault === 'extra-field') ack.untrusted = true;
          if (fault === 'cleanup-storage') await page.evaluate(() => { Storage.prototype.removeItem = () => { throw new Error('synthetic cleanup refusal'); }; });
          if (fault === 'cleanup-lock') await page.evaluate(() => { navigator.locks.request = () => Promise.reject(new Error('synthetic lock refusal')); });
          return route.fulfill({ response, json: ack });
        });
        await dialog.getByRole('button', { name: 'Confirm assignment', exact: true }).click();
        await dialog.getByText('Assignment outcome needs reconciliation.', { exact: false }).waitFor();
        const marker = await page.evaluate(KEY => localStorage.getItem(KEY), KEY);
        assert.equal(JSON.parse(marker).phase, 'dispatched');
        await page.reload(); await reconciliationBoot(page);
        assert.equal(await page.evaluate(KEY => localStorage.getItem(KEY), KEY), marker);
        assert.equal(requests.filter(x => x.path === '/settlement/confirm').length, 1);
        assert.equal(w.calls.commit, 0); assert.equal(w.calls.journal, 0);
      }, true, 390, { now: () => clock });
    }
    let restartClock = Date.now();
    await run('delayed terminal ack cannot clear same-operation replacement after controller restart', async (w, fixture) => {
      const { page, requests } = fixture; const dialog = await preview(page);
      const first = await page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)), KEY);
      restartClock += require('../scripts/planned-obligation-settlement-contract').TTL_MS;
      let reached, release; const seen = new Promise(r => { reached = r; }), gate = new Promise(r => { release = r; });
      let confirms = 0;
      await page.route('**/settlement/confirm', async route => {
        const response = await route.fetch();
        if (++confirms === 1) {
          assert.equal((await response.json()).status, 'not-applied'); reached(); await gate;
          await route.fulfill({ response });
        } else { assert.equal((await response.json()).status, 'committed'); await route.abort('failed'); }
      });
      try {
        await dialog.getByRole('button', { name: 'Confirm assignment', exact: true }).click(); await seen;
        w.recreate();
        // Deliberate lifecycle fault: reuse the old operation via real routes,
        // then install that new generation under the real origin-wide lock.
        // The supported UI itself always mints a fresh operationId.
        const next = await page.evaluate(async operationId => {
          const post = async (path, body) => (await fetch('/settlement/' + path, { method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Atlas-Settlement': 'same-origin' }, body: JSON.stringify(body) })).json();
          const c = await post('selections', {});
          return post('prepare', { operationId, assignedCents: 2500,
            selection: { transaction: c.transactions[0].handle, commitment: c.commitments[0].handle } });
        }, first.operationId);
        assert.equal(next.status, 'prepared'); assert.notEqual(next.generation, first.generation);
        const replacement = { operationId: next.operationId, phase: 'dispatched', generation: next.generation };
        await page.evaluate(async ({ KEY, replacement, next }) => {
          await navigator.locks.request(KEY, { mode: 'exclusive' }, () => localStorage.setItem(KEY, JSON.stringify(replacement)));
          await fetch('/settlement/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json',
            'X-Atlas-Settlement': 'same-origin' }, body: JSON.stringify({ operationId: next.operationId,
            previewToken: next.previewToken, generation: next.generation, confirmed: true }) }).catch(() => {});
        }, { KEY, replacement, next });
        assert.equal(w.calls.commit, 1); release();
        await dialog.getByText('Assignment outcome needs reconciliation.', { exact: false }).waitFor();
        assert.deepEqual(await page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)), KEY), replacement);
        await page.reload();
        await page.waitForFunction(KEY => typeof App !== 'undefined' && App.data?.settlementEvidenceStatus?.status === 'qualified'
          && localStorage.getItem(KEY) === null, KEY);
        assert.deepEqual(await facts(page), { original: 60, paid: 25, remaining: 35 });
        assert.equal(w.calls.commit, 1); assert.equal(requests.filter(r => r.path === '/settlement/confirm').length, 2);
        fixture.details = { realRestart: true, deliberatelyReusedOperation: true, distinctGeneration: true, oldAckRetainedReplacement: true };
      } finally { release(); }
    }, true, 390, { now: () => restartClock });
    for (const interruption of ['legacy-marker', 'timeout', 'tab-close-before-cleanup']) {
      let clock = Date.now();
      await run('terminal proof ' + interruption + ' retains receipt-only recovery fence', async (w, fixture) => {
        const { page, context, requests } = fixture; const dialog = await preview(page);
        clock += require('../scripts/planned-obligation-settlement-contract').TTL_MS;
        if (interruption === 'timeout') await page.clock.install();
        let reached, release; const seen = new Promise(r => { reached = r; }), gate = new Promise(r => { release = r; });
        await page.route('**/settlement/confirm', async route => {
          const response = await route.fetch(); assert.equal((await response.json()).status, 'not-applied');
          reached(); await gate;
          await route.fulfill({ response }).catch(() => {}); // request may already be aborted/closed by this explicit fault.
        });
        try {
          await dialog.getByRole('button', { name: 'Confirm assignment', exact: true }).click(); await seen;
          let marker = await page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)), KEY);
          if (interruption === 'legacy-marker') {
            delete marker.generation;
            await page.evaluate(async ({ KEY, marker }) => navigator.locks.request(KEY, { mode: 'exclusive' },
              () => localStorage.setItem(KEY, JSON.stringify(marker))), { KEY, marker }); release();
            await dialog.getByText('Assignment outcome needs reconciliation.', { exact: false }).waitFor();
          } else if (interruption === 'timeout') {
            await page.clock.fastForward(20001);
            await dialog.getByText('Assignment outcome needs reconciliation.', { exact: false }).waitFor(); release();
          } else {
            await page.close(); release();
            const second = await context.newPage(); second.setDefaultTimeout(15000);
            second.on('pageerror', error => fixture.errors.push(error.message));
            await second.goto(w.origin + '/'); await reconciliationBoot(second);
            assert.deepEqual(await second.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)), KEY), marker);
            await second.close(); return;
          }
          assert.deepEqual(await page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)), KEY), marker);
          await page.reload(); await reconciliationBoot(page);
          assert.deepEqual(await page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)), KEY), marker);
          assert.equal(requests.filter(r => r.path === '/settlement/confirm').length, 1);
          assert.equal(w.calls.commit, 0); assert.equal(w.calls.journal, 0);
        } finally { release(); }
      }, true, 390, { now: () => clock });
    }
    await run('legacy dispatched marker still recovers an original committed receipt', async (w, { page }) => {
      const dialog = await preview(page);
      await page.route('**/settlement/confirm', async route => { await route.fetch(); await route.abort('failed'); });
      await dialog.getByRole('button', { name: 'Confirm assignment', exact: true }).click();
      await dialog.getByText('Assignment outcome needs reconciliation.', { exact: false }).waitFor();
      await page.evaluate(async KEY => navigator.locks.request(KEY, { mode: 'exclusive' }, () => {
        const marker = JSON.parse(localStorage.getItem(KEY)); delete marker.generation;
        localStorage.setItem(KEY, JSON.stringify(marker));
      }), KEY);
      await page.reload();
      await page.waitForFunction(KEY => typeof App !== 'undefined' && App.data?.settlementEvidenceStatus?.status === 'qualified'
        && localStorage.getItem(KEY) === null, KEY);
      assert.deepEqual(await facts(page), { original: 60, paid: 25, remaining: 35 }); assert.equal(w.calls.commit, 1);
    });
    await run('dispatch cannot advance a replaced generation of the same operation', async (w, { page, requests }) => {
      const dialog = await preview(page);
      const marker = await page.evaluate(async KEY => navigator.locks.request(KEY, { mode: 'exclusive' }, () => {
        const marker = JSON.parse(localStorage.getItem(KEY)); marker.generation = 'generation-' + 'f'.repeat(32);
        localStorage.setItem(KEY, JSON.stringify(marker)); return marker;
      }), KEY);
      await dialog.getByRole('button', { name: 'Confirm assignment', exact: true }).click();
      await dialog.getByText('Confirmation was not sent:', { exact: false }).waitFor();
      assert.deepEqual(await page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)), KEY), marker);
      assert.equal(requests.filter(r => r.path === '/settlement/confirm').length, 0); assert.equal(w.calls.commit, 0);
    });
    await run('stale preview abandonment cannot erase same-operation replacement generation', async (w, fixture) => {
      const { page, context } = fixture; await preview(page);
      const first = await page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)), KEY);
      const second = await context.newPage(); second.setDefaultTimeout(15000);
      second.on('pageerror', error => fixture.errors.push(error.message));
      let reached, release; const seen = new Promise(r => { reached = r; }), gate = new Promise(r => { release = r; });
      await second.exposeBinding('__pauseGenerationBoot', async () => { reached(); await gate; });
      await second.route('**/app.js', async route => {
        const response = await route.fetch(), source = await response.text();
        const anchor = 'try { marker = parsePending(raw); } catch';
        assert.equal(source.split(anchor).length, 2);
        await route.fulfill({ response, body: source.replace(anchor,
          'try { marker = parsePending(raw); await window.__pauseGenerationBoot(); } catch') });
      });
      try {
        const navigation = second.goto(w.origin + '/'); await seen;
        // Deliberate shared-storage replacement, under the real marker lock.
        const replacement = { ...first, generation: 'generation-' + 'f'.repeat(32) };
        await page.evaluate(async ({ KEY, replacement }) => navigator.locks.request(KEY, { mode: 'exclusive' },
          () => localStorage.setItem(KEY, JSON.stringify(replacement))), { KEY, replacement });
        release(); await navigation; await reconciliationBoot(second);
        assert.deepEqual(await second.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)), KEY), replacement);
        assert.equal(w.calls.commit, 0);
        await second.unroute('**/app.js'); await second.reload();
        await second.waitForFunction(KEY => typeof App !== 'undefined' && App.data !== null && localStorage.getItem(KEY) === null, KEY);
        fixture.details = { staleGenerationRetained: true, replacementFaultInjected: true };
      } finally { release(); await second.close(); }
    });
    for (const width of [390, 1440]) {
      await run('direct pointer Accounts & evidence and original source lifecycle ' + width, async (w, fixture) => {
        const { page } = fixture;
        fixture.details = [];
        const cycle = async (view, branch) => {
          const tile = page.locator('[data-budget-savings-goals]');
          const opener = tile.locator('[data-budget-funding-inventory]');
          const source = await tile.locator('[data-budget-funding-savings]').elementHandle();
          assert.ok(source, view + ': original Savings source exists');
          const parent = await source.evaluateHandle(node => node.parentNode);
          const before = await source.evaluate(node => ({ hidden: node.hidden, inert: node.inert,
            clipped: node.classList.contains('blend-goals-source'), maxHeight: getComputedStyle(node).maxHeight }));
          assert.equal(before.clipped, true, view + ': evidence source remains clipped while closed');
          if (branch === 'fallback') assert.equal(await tile.locator('.budget-goal-notice').count(), 1);
          else assert.equal(await tile.locator('.budget-goal-notice').count(), 0);
          if (branch === 'projected') assert.equal(await tile.locator('[data-budget-savings-forecast-stock]').count(), 1);
          const geometry = await opener.evaluate(node => ({ height: node.getBoundingClientRect().height,
            clipped: node.classList.contains('blend-goals-source') }));
          assert.ok(geometry.height > 0, view + ': original opener has pointer area');
          assert.equal(geometry.clipped, false, view + ': interactive opener is excluded from source clipping');
          const dialog = page.locator('[data-budget-detail-sheet]');
          const originalIsInDialog = () => source.evaluate(node =>
            node.parentNode === document.querySelector('[data-budget-detail-body]')
            && document.querySelector('[data-budget-detail-sheet]').contains(node)
            && document.querySelector('[data-budget-detail-sheet] [data-budget-funding-savings]') === node);
          const restored = async () => {
            assert.equal(await source.evaluate((node, originalParent) => node.parentNode === originalParent, parent), true,
              view + ': close restores the identical source to its original parent');
            assert.deepEqual(await source.evaluate(node => ({ hidden: node.hidden, inert: node.inert,
              clipped: node.classList.contains('blend-goals-source'), maxHeight: getComputedStyle(node).maxHeight })), before,
            view + ': close restores original hidden/inert/clipping state');
          };
          try {
            await opener.click({ timeout: 5000 }); // genuine unforced pointer; never evaluate/force-click
            await dialog.waitFor({ state: 'visible' });
            assert.equal(await originalIsInDialog(), true, view + ': sheet holds that exact original node');
            assert.equal(await dialog.locator('[data-budget-funding-savings]').count(), 1);
            await dialog.getByRole('button', { name: 'Assign a recorded payment', exact: true }).waitFor();
            await dialog.locator('[data-budget-detail-close]').click();
            await dialog.waitFor({ state: 'hidden' }); await restored();
            await opener.click({ timeout: 5000 });
            await dialog.waitFor({ state: 'visible' });
            assert.equal(await originalIsInDialog(), true, view + ': pointer reopen moves the same node again');
            await page.keyboard.press('Escape');
            await dialog.waitFor({ state: 'hidden' }); await restored();
            fixture.details.push({ view, branch, geometry, originalNodeIdentity: true, restoredState: before });
          } finally { await parent.dispose(); await source.dispose(); }
        };
        const step = async key => {
          const start = await page.locator('[data-budget-window-progress]').getAttribute('data-start');
          await page.locator('.river').focus(); await page.keyboard.press(key);
          await page.waitForFunction(start => document.querySelector('[data-budget-window-progress]')?.dataset.start !== start, start);
        };
        await cycle('daily current', 'daily');
        await step('ArrowRight'); await cycle('daily projected after period change', 'projected');
        await page.evaluate(() => App.rerender()); await cycle('daily projected after rerender', 'projected');
        await step('ArrowLeft'); await cycle('daily current after return', 'daily');
        // Both real markup branches: without the optional policy, the next
        // period consumes Forecast's incumbent fallback publication.
        delete w.base.plan.savingsEarmarks.allocationPolicy;
        delete w.acquisition.plan.savingsEarmarks.allocationPolicy;
        await page.reload();
        await page.waitForFunction(() => typeof App !== 'undefined' && App.data !== null
          && App.data.plan.savingsEarmarks.allocationPolicy == null);
        await step('ArrowRight'); await cycle('fallback next period', 'fallback');
        await page.evaluate(() => App.rerender()); await cycle('fallback after rerender', 'fallback');
        await step('ArrowLeft'); await step('ArrowRight'); await cycle('fallback after period return', 'fallback');
        assert.equal(w.calls.commit, 0); assert.equal(w.calls.journal, 0);
      }, true, width);
    }
  } finally { await browser.close(); }
  assert.ok(results.length, 'at least one browser case must run');
  fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify({ synthetic: true,
    browserVersion, nodeVersion: process.version,
    head: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'],
      { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }).trim(),
    repositorySources: Object.fromEntries(['server.js', 'public/app.js', 'public/plan.js', 'public/budget-blend.js',
      'scripts/settlement-evidence-http.js', 'scripts/settlement-evidence-confirmation.js', 'scripts/settlement-evidence-resolver.js',
      'scripts/settlement-evidence-serving.js', 'test/test-settlement-evidence-http.js',
      'test/test-settlement-evidence-confirmation.js', 'test/browser-settlement-save-view.js'].map(file => [file,
      require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', file))).digest('hex')])),
    actualHttpAndBrowser: true, results }, null, 2) + '\n');
  console.log('Proof: ' + out);
  if (results.some(result => result.status !== 'PASS')) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
