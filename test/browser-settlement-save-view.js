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
  assert.deepEqual(Object.keys(stored).sort(), ['operationId', 'phase']); assert.equal(stored.phase, 'preview');
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
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  try {
    const run = async (name, action, active = true, width = 390, options = {}) => {
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
      await page.reload(); await page.waitForFunction(() => typeof App !== 'undefined' && App.data !== null);
      assert.equal(await page.evaluate(KEY => localStorage.getItem(KEY), KEY), null);
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
    await run('deterministically expired preview refuses real confirm and keeps dispatched uncertainty', async (w, { page, requests }) => {
      const dialog = await preview(page);
      previewClock += require('../scripts/planned-obligation-settlement-contract').TTL_MS;
      const response = page.waitForResponse(r => r.url().endsWith('/settlement/confirm'));
      await dialog.getByRole('button', { name: 'Confirm assignment', exact: true }).click();
      assert.deepEqual(await (await response).json(), { status: 'rejected', reason: 'preview-expired' });
      await dialog.getByText('Assignment outcome needs reconciliation.', { exact: false }).waitFor();
      assert.equal(w.calls.commit, 0); assert.equal(w.calls.journal, 0);
      const marker = await page.evaluate(KEY => localStorage.getItem(KEY), KEY);
      assert.equal(JSON.parse(marker).phase, 'dispatched');
      await page.reload();
      await page.getByText('Assignment outcome needs reconciliation. Figures remain unavailable.', { exact: false }).waitFor();
      assert.equal(await page.evaluate(KEY => localStorage.getItem(KEY), KEY), marker);
      assert.equal(await page.evaluate(() => App.data), null);
      assert.equal(requests.filter(x => x.path === '/settlement/confirm').length, 1);
    }, true, 390, { now: () => previewClock });
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
  fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify({ synthetic: true,
    head: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'],
      { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }).trim(),
    repositorySources: Object.fromEntries(['server.js', 'public/app.js', 'public/plan.js', 'public/budget-blend.js',
      'scripts/settlement-evidence-http.js', 'scripts/settlement-evidence-resolver.js',
      'scripts/settlement-evidence-serving.js', 'test/test-settlement-evidence-http.js',
      'test/browser-settlement-save-view.js'].map(file => [file,
      require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', file))).digest('hex')])),
    actualHttpAndBrowser: true, results }, null, 2) + '\n');
  console.log('Proof: ' + out);
  if (results.some(result => result.status !== 'PASS')) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
