'use strict';
// #742 (ATLAS-074) Budget release-reopen acceptance — TEST ONLY.
// Atlas cross-seam audit on #742 (comment 6483144704) named one missing bounded
// case: with a real settlement assignment dispatched and its confirm response
// withheld, the served release changes and the page is suspended/resumed.
// The release notice must not remount views, fetch /data.json or any financial
// route, or change the pending marker, storage or session. Cancelling the
// reload keeps the pending marker. Accepting the reload keeps the original
// session/marker and either recovers the original outcome or stays fenced,
// with exactly one confirm request, at most one effect and no replay.
//
// NODE_PATH=<Playwright packages> CHROME_PATH=<Chromium> node test/browser-budget-release-reopen.js
// Optional: ATLAS_RELEASE_REOPEN_PROOF=<path> writes the recorded rows as JSON.
//
// Harness: the real loopback app from test/test-settlement-evidence-http.js
// (invented base, synthetic credential, in-memory synthetic storage). The only
// interception is the served shell's build label (`Running build unavailable`
// is replaced by an invented commit so the incumbent watcher is armed), the
// withheld /settlement/confirm response, and aborting every non-loopback
// origin. No live site, provider, credential or household evidence is used.
//
// Resume paths: (a) Chromium page freeze/resume (CDP Page.setWebLifecycleState)
// followed by pageshow{persisted:true}, the Safari/home-screen bfcache shape;
// (b) visibilitychange hidden -> visible. Widths 390 and 1440.
//
// Stated limitations, recorded and NOT asserted as failures:
//  1. While the Budget detail sheet (modal <dialog>) is open, the notice is
//     appended under the top layer and cannot be operated; the test records
//     that, closes the sheet with Escape (marker kept), then uses the notice.
//  2. public/app.js confirm text says pending work "will be cleared"; a
//     dispatched assignment's marker deliberately survives. Wording untouched.
//  3. Headless Chromium only. WebKit and physical Safari/home-screen resume are
//     not proven here; this does not close #742.
//
// Rows are recorded (not thrown at first failure); exit 1 if any row FAILS.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { startWorld, env } = require('./test-settlement-evidence-http');

const KEY = 'atlas-settlement-pending-v1';
const OLD = '1111111', NEW = '2222222';
const root = path.join(__dirname, '..');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const WIDTHS = [390, 1440];
const RESUMES = ['freeze-pageshow-persisted', 'visibility-hidden-visible'];
const rows = [];
const record = (scenario, name, ok, detail) => {
  const row = { scenario, name, result: ok === null ? 'OBSERVATION' : ok ? 'PASS' : 'FAIL', detail };
  rows.push(row);
  console.log(`${row.result} ${scenario} ${name} ${JSON.stringify(detail)}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function scenario(browser, width, resume) {
  const id = `${width}|${resume}`;
  const w = await startWorld(true);
  let release = OLD;
  const requests = [], errors = [], external = [];
  let releaseConfirm = () => {};
  const context = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => {
      const u = new URL(r.url());
      if (u.origin === w.origin) requests.push({ method: r.method(), path: u.pathname });
    });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== w.origin) { external.push(url.origin); return route.abort(); }
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const response = await route.fetch();
        const body = await response.text();
        return route.fulfill({ response, body: body.replace('Running build unavailable', `Running commit ${release}`) });
      }
      return route.continue();
    });
    await page.goto(w.origin + '/login');
    await page.getByLabel('Password', { exact: true }).fill(env.SITE_PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForFunction(() => typeof App !== 'undefined' && App.data !== null);
    // The post-login redirect is not routed by Playwright; one ordinary load arms the label.
    await page.goto(w.origin + '/');
    await page.waitForFunction(() => typeof App !== 'undefined' && App.data !== null);
    const label0 = (await page.locator('.running-build').innerText()).trim();
    record(id, 'PRE loaded-release-label', label0 === `Running commit ${OLD}`, { label: label0 });
    const cookies = async () => (await context.cookies()).map(c => `${c.name}=${c.value}`).sort();
    const storage = () => page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
    const marker = () => page.evaluate(k => localStorage.getItem(k), KEY);
    const cookies0 = await cookies();

    // A real assignment through the Budget sheet; the confirm response is withheld.
    const tile = page.locator('[data-budget-savings-goals]');
    await tile.waitFor();
    await tile.locator('[data-budget-funding-inventory]').focus();
    await page.keyboard.press('Enter');
    const dialog = page.locator('[data-budget-detail-sheet]');
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('button', { name: 'Assign a recorded payment', exact: true }).click();
    await dialog.getByLabel('Amount to assign (CAD)', { exact: true }).fill('25.00');
    await dialog.getByRole('button', { name: 'Preview assignment', exact: true }).click();
    await dialog.getByRole('button', { name: 'Confirm assignment', exact: true }).waitFor();
    let reached;
    const seen = new Promise(r => { reached = r; });
    const gate = new Promise(r => { releaseConfirm = r; });
    await page.route('**/settlement/confirm', async route => {
      const response = await route.fetch(); // the server performs the confirm
      reached();
      await gate; // the browser does not see the response yet
      await route.fulfill({ response }).catch(() => {});
    });
    await dialog.getByRole('button', { name: 'Confirm assignment', exact: true }).click();
    await seen;
    const marker0 = await marker();
    let phase = null;
    try { phase = JSON.parse(marker0).phase; } catch { /* recorded below */ }
    record(id, 'PRE dispatched-marker-with-response-withheld', phase === 'dispatched', { phase });
    const storage0 = await storage();
    const surface0 = await page.locator('#operating-surface').innerText().catch(() => null);
    await page.evaluate(() => {
      window.__releaseReopenMounted = {
        sheet: document.querySelector('[data-budget-detail-sheet]'),
        tile: document.querySelector('[data-budget-savings-goals]'),
        main: document.querySelector('main'),
      };
      window.__releaseReopenFocus = document.activeElement;
    });
    const n0 = requests.length;

    // Served release changes, then the page is suspended and resumed.
    release = NEW;
    if (resume === 'freeze-pageshow-persisted') {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
      await new Promise(r => setTimeout(r, 300));
      await cdp.send('Page.setWebLifecycleState', { state: 'active' });
      await cdp.detach();
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    } else {
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
    }
    await page.locator('[data-app-release]').waitFor({ state: 'attached' });
    await page.waitForTimeout(250);
    const during = requests.slice(n0);
    record(id, 'NOTICE changed-release-detected', await page.locator('[data-app-release]').count() === 1, { notices: await page.locator('[data-app-release]').count() });
    const label1 = (await page.locator('.running-build').innerText()).trim();
    record(id, 'NOTICE loaded-identity-retained', label1 === `Running commit ${OLD}`, { label: label1 });
    const mounted = await page.evaluate(() => {
      const m = window.__releaseReopenMounted;
      return { sheet: m.sheet === document.querySelector('[data-budget-detail-sheet]') && m.sheet.isConnected && m.sheet.open,
        tile: m.tile === document.querySelector('[data-budget-savings-goals]') && m.tile.isConnected,
        main: m.main === document.querySelector('main'), focus: window.__releaseReopenFocus === document.activeElement };
    });
    record(id, 'NOTICE no-view-remount', mounted.sheet && mounted.tile && mounted.main, mounted);
    record(id, 'NOTICE focus-not-moved', mounted.focus, mounted);
    const surface1 = surface0 === null ? null : await page.locator('#operating-surface').innerText();
    record(id, 'NOTICE operating-surface-unchanged', surface0 === surface1, { present: surface0 !== null });
    record(id, 'NOTICE only-shell-html-requested', during.length >= 1 && during.every(r => r.method === 'GET' && r.path === '/index.html'), { during });
    record(id, 'NOTICE no-data-json-or-financial-fetch', !during.some(r => r.path === '/data.json' || r.path.startsWith('/settlement/') || r.path.startsWith('/api/')), { during });
    record(id, 'NOTICE marker-unchanged', await marker() === marker0, {});
    record(id, 'NOTICE local-and-session-storage-unchanged', same(await storage(), storage0), {});
    record(id, 'NOTICE session-cookie-unchanged', same(await cookies(), cookies0), { cookies: cookies0.length });
    record(id, 'NOTICE confirm-still-withheld', requests.filter(r => r.method === 'POST' && r.path === '/settlement/confirm').length === 1 && w.calls.commit <= 1, { commits: w.calls.commit });

    // Limitation 1: the notice sits under the modal sheet (top layer).
    const operable = await page.getByRole('button', { name: 'Reload Atlas' })
      .click({ trial: true, timeout: 2000 }).then(() => true, () => false);
    record(id, 'LIMITATION notice-operable-while-modal-sheet-open', null, { operable });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    record(id, 'CANCEL closing-sheet-keeps-marker', await marker() === marker0, {});

    // Cancel the reload: pending state preserved, page not reloaded.
    await page.evaluate(() => { window.__releaseReopenSameDocument = true; });
    let cancelMessage = null;
    page.once('dialog', d => { cancelMessage = d.message(); d.dismiss(); });
    await page.getByRole('button', { name: 'Reload Atlas' }).click();
    await page.waitForTimeout(250);
    record(id, 'CANCEL confirm-prompt-shown', typeof cancelMessage === 'string', {});
    record(id, 'LIMITATION confirm-wording', null, { says_will_be_cleared: /will be cleared/.test(cancelMessage || '') });
    record(id, 'CANCEL same-document', await page.evaluate(() => window.__releaseReopenSameDocument === true), {});
    record(id, 'CANCEL marker-preserved', await marker() === marker0, {});
    record(id, 'CANCEL storage-and-session-preserved', same(await storage(), storage0) && same(await cookies(), cookies0), {});
    record(id, 'CANCEL notice-still-present', await page.locator('[data-app-release]').count() === 1, {});

    // Accept the reload while the original response is still withheld.
    const n1 = requests.length;
    page.once('dialog', d => d.accept());
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Reload Atlas' }).click()]);
    releaseConfirm(); // the original page is gone; its response can no longer land
    await page.waitForFunction(k => typeof App !== 'undefined'
      && ((App.data?.settlementEvidenceStatus?.status === 'qualified' && localStorage.getItem(k) === null)
        || document.body.innerText.includes('Assignment outcome needs reconciliation.')), KEY);
    await page.waitForTimeout(500);
    const after = requests.slice(n1);
    const recovered = await marker() === null;
    const label2 = (await page.locator('.running-build').innerText()).trim();
    record(id, 'ACCEPT reloaded-into-new-release', label2 === `Running commit ${NEW}`, { label: label2 });
    record(id, 'ACCEPT original-session-retained', same(await cookies(), cookies0), {});
    record(id, 'ACCEPT original-outcome-recovered-or-fenced-on-original-marker', recovered || await marker() === marker0, { outcome: recovered ? 'recovered' : 'fenced' });
    const confirms = requests.filter(r => r.method === 'POST' && r.path === '/settlement/confirm').length;
    record(id, 'ACCEPT exactly-one-confirm-request', confirms === 1, { confirms });
    record(id, 'ACCEPT no-confirm-replay-after-reload', !after.some(r => r.path === '/settlement/confirm'), { settlementAfterReload: after.filter(r => r.path.startsWith('/settlement/')) });
    record(id, 'ACCEPT exactly-one-effect', recovered ? w.calls.commit === 1 : w.calls.commit <= 1, { commits: w.calls.commit, outcome: recovered ? 'recovered' : 'fenced' });
    record(id, 'GLOBAL zero-page-errors', errors.length === 0, { errors });
    record(id, 'GLOBAL zero-external-requests', external.length === 0, { external });
  } catch (e) {
    record(id, 'HARNESS scenario-completed', false, { error: String(e && e.stack || e).split('\n').slice(0, 3).join(' | ') });
  } finally {
    releaseConfirm();
    await context.close().catch(() => {});
    await w.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  try {
    for (const width of WIDTHS) for (const resume of RESUMES) await scenario(browser, width, resume);
    const pass = rows.filter(r => r.result === 'PASS').length, fail = rows.filter(r => r.result === 'FAIL').length;
    const obs = rows.filter(r => r.result === 'OBSERVATION').length;
    console.log(`head ${head} browser ${browser.version()} scenarios ${WIDTHS.length * RESUMES.length} rows ${pass + fail} pass ${pass} fail ${fail} observations ${obs}`);
    if (process.env.ATLAS_RELEASE_REOPEN_PROOF) fs.writeFileSync(process.env.ATLAS_RELEASE_REOPEN_PROOF, JSON.stringify({ head, browser: browser.version(), rows }, null, 2));
    process.exitCode = fail ? 1 : 0;
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
