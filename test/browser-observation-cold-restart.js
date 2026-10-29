'use strict';
// #725 / ATLAS-069: actual server processes, worker acquisition and browser.
// NODE_PATH=<isolated Playwright>/node_modules CHROME_PATH=<Chromium>
//   node test/browser-observation-cold-restart.js
// Receipts/screenshots go outside git (ATLAS_COLD_RESTART_PROOF_DIR overrides).
// This proves honest cold failure/reacquisition, not durable observation memory,
// physical Safari, real-provider qualification or household acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const Fixture = require('./fixtures/budget-surface-data');
const Helper = require('./test-server-observation-memory');
const ROOT = path.resolve(__dirname, '..');
const SESSION = 'synthetic-cold-restart-session';
const CLOCK_B = '2026-08-21T19:00:00.000Z';
const BALANCE_DATE_B = '2026-08-21T18:55:00.000Z';

function installChildBoundary() {
  // The existing approved preload supplies only the invented canonical input
  // and evidence clock. Supply its matching identity through that same fs seam.
  // Never patch Forecast, observer, LivePlan, memory or a served response.
  const read = fs.readFileSync;
  fs.readFileSync = function(file, ...args) {
    if (typeof file === 'string' && path.resolve(file) === path.join(ROOT, 'docs/connectivity/transaction-identity.json')) {
      const bytes = JSON.stringify(Fixture.identity);
      return typeof args[0] === 'string' || args[0]?.encoding ? bytes : Buffer.from(bytes);
    }
    return Reflect.apply(read, this, [file, ...args]);
  };
  const refuse = () => {
    // Closed marker only: do not print URL, payload, headers, paths or errors.
    process.stdout.write('COLD_RESTART_BOUNDARY_REFUSED\n');
    throw new Error('Synthetic cold-restart boundary refused');
  };
  const allowed = new URL(process.env.ATLAS_LUNCHMONEY_API_BASE);
  const allowedRequest = (input, options = {}) => {
    const url = input instanceof URL ? input : typeof input === 'string' ? new URL(input) : null;
    if (!url || url.origin !== allowed.origin || !url.pathname.startsWith('/v2/')
      || (options.method || 'GET') !== 'GET') refuse();
  };
  for (const module of [http, require('node:https')]) {
    const request = module.request;
    module.request = function(input, options, ...args) {
      allowedRequest(input, typeof options === 'object' ? options : {});
      return Reflect.apply(request, this, [input, options, ...args]);
    };
  }
  const fetch = globalThis.fetch;
  globalThis.fetch = function(input, options) {
    allowedRequest(input, options);
    return fetch(input, options);
  };
  const net = require('node:net'), connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function(...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    if (!first || typeof first !== 'object' || first.host !== '127.0.0.1'
      || String(first.port) !== allowed.port) refuse();
    return Reflect.apply(connect, this, args);
  };
  require('node:dgram').createSocket = refuse;
  // Neither application process nor its workers may persist anything.
  for (const name of ['writeFile', 'appendFile', 'rename', 'unlink', 'rm', 'mkdir', 'truncate', 'copyFile']) {
    fs[name] = fs[name + 'Sync'] = refuse;
    if (fs.promises[name]) fs.promises[name] = refuse;
  }
  fs.createWriteStream = refuse;
}

if (process.env.ATLAS_COLD_RESTART_PRELOAD === '1') {
  installChildBoundary();
} else if (require.main === module) {
  run().catch(error => { console.error(error); process.exitCode = 1; });
}

async function run() {
  const { chromium } = require('playwright');
  const started = performance.now();
  const out = process.env.ATLAS_COLD_RESTART_PROOF_DIR
    || fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-cold-restart-'));
  fs.mkdirSync(out, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  const digest = file => createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');
  const receipt = {
    proof: 'synthetic localhost Chromium; actual server.js and production acquisition/composition',
    base: git('merge-base', 'origin/main', 'HEAD'), head: git('rev-parse', 'HEAD'), node: process.version, platform: process.platform,
    testSha256: digest('test/browser-observation-cold-restart.js'),
    sources: Object.fromEntries(['server.js', 'scripts/server-live-refresh.js', 'scripts/server-observation-memory.js',
      'scripts/live-plan.js', 'scripts/provider-observe.js', 'public/forecast.js', 'public/app.js', 'public/plan.js',
      'test/test-server-observation-memory.js', 'test/fixtures/budget-surface-data.js'].map(file => [file, digest(file)])),
    processes: [], phases: [], assertions: 0, failures: [], result: 'RUNNING',
    limits: 'No physical Safari, real provider, household, deployed acceptance or durable observation-memory retention proof.',
  };
  const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); receipt.assertions++; };
  const truth = (value, label) => { assert.ok(value, label); receipt.assertions++; };
  // Keep correct contract failures red while collecting independent recovery
  // evidence in the same run. Infrastructure/acquisition failures still throw.
  const expect = (actual, expected, label) => {
    receipt.assertions++;
    try { assert.deepEqual(actual, expected, label); }
    catch { receipt.failures.push({ label, expected, actual }); }
  };
  const mock = await Helper.provider();
  const probe = http.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const origin = 'http://127.0.0.1:' + port;
  let browser, app, page;
  const errors = [], browserMutations = [], optionalBlocked = new Set(), externalBlocked = new Set();
  async function start(label, clock) {
    const record = { label, clock, startedAt: new Date().toISOString(), pid: null, exited: false, boundaryRefusals: 0 };
    const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-server-observation-memory.js'),
      '--require', __filename, path.join(ROOT, 'server.js')], {
      cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
        ...Helper.environment(mock.base), ATLAS_LIVE_OVERLAY_NOW: clock,
        PORT: String(port), SITE_PASSWORD: Helper.PASS, SESSION_SECRET: SESSION,
        ATLAS_GIT_SHA: receipt.head,
        ATLAS_SYNTHETIC_OBSERVATION_PRELOAD: '1', ATLAS_COLD_RESTART_PRELOAD: '1',
      },
    });
    record.pid = child.pid; receipt.processes.push(record);
    let spawnError;
    child.once('error', error => { spawnError = error; });
    // Never relay private production stdout/stderr. Retain only closed markers.
    child.stdout.on('data', bytes => {
      record.boundaryRefusals += (String(bytes).match(/COLD_RESTART_BOUNDARY_REFUSED/g) || []).length;
    });
    child.stderr.on('data', () => {});
    const exit = new Promise(resolve => child.once('exit', (code, signal) => {
      record.exited = true; record.exitCode = code; record.signal = signal;
      record.stoppedAt = new Date().toISOString(); resolve();
    }));
    const instance = { record, close: async () => {
      if (!record.exited) child.kill();
      await Promise.race([exit, new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error('Synthetic process exit deadline')), 10000); timer.unref();
      })]);
    } };
    app = instance; // Also clean up a partially started process.
    await Helper.until(async () => {
      if (spawnError || record.exited) throw new Error('Synthetic process startup failed');
      try { return (await fetch(origin + '/login')).status === 200; } catch { return false; }
    }, 'fresh process ' + label);
    return instance;
  }
  async function load(label, action) {
    const before = mock.calls.length;
    const responsePromise = page.waitForResponse(r => new URL(r.url()).pathname === '/data.json');
    await action();
    const response = await responsePromise;
    check(response.status(), 200, label + ': actual session route succeeds');
    const packet = await response.json();
    await page.waitForFunction(() => App.data && !document.querySelector('[data-boot-notice], [data-boot-static]'));
    const phase = { label, process: app.record.label, providerGETs: mock.calls.length - before,
      providerPaths: mock.calls.slice(before), status: response.status(),
      source: response.headers()['x-atlas-observation-source'],
      qualified: response.headers()['x-atlas-observation-qualified'],
      checkedAt: response.headers()['x-atlas-observation-checked-at'] || null,
      fetchedAt: packet.liveOverlay.fetchedAt,
      balanceDates: packet.liveOverlay.overlays.map(row => row.evidenceDate),
    };
    receipt.phases.push(phase);
    truth(response.headers()['cache-control']?.includes('no-store'), label + ': financial response cannot be cached as current');
    check(await page.evaluate(() => App.data), packet, label + ': browser consumes the actual server packet');
    check(await page.locator('.site-head').getAttribute('inert'), null, label + ': shell is accessible');
    phase.buildLabel = await page.locator('.running-build').textContent();
    truth(phase.buildLabel.includes(receipt.head.slice(0, 7)), label + ': actual HTML identifies the checked-out server build');
    return { phase, packet };
  }
  async function statusText() {
    await page.locator('[data-transaction-review-open]').click();
    const status = page.locator('[data-observation-check]');
    await status.scrollIntoViewIfNeeded();
    truth(await status.isVisible(), 'source-check provenance is visibly readable in the review sheet');
    const text = await status.innerText();
    await page.screenshot({ path: path.join(out, receipt.phases.at(-1).label + '-source.png') });
    await page.keyboard.press('Escape');
    return text;
  }
  try {
    await start('A', Helper.CLOCK);
    check(mock.calls.length, 0, 'A startup/login readiness does not prime provider memory');
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
    receipt.chromium = browser.version();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) { externalBlocked.add(url.origin); return route.abort(); }
      if (req.method() !== 'GET') { browserMutations.push(req.method()); return route.abort(); }
      // Optional history is outside this fixture. Abort before it can read any
      // household history; /data.json is always the actual server response.
      if (['/periods.json', '/balance-history.json'].includes(url.pathname)) {
        optionalBlocked.add(url.pathname); return route.abort();
      }
      return route.continue();
    });
    const login = await fetch(origin + '/login', { method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=' + encodeURIComponent(Helper.PASS) });
    check(login.status, 302, 'only synthetic local session authentication POST is used');
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    truth(cookie, 'synthetic session is issued');
    const separator = cookie.indexOf('=');
    await context.addCookies([{ name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: origin }]);
    page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    const first = await load('A-qualified', () => page.goto(origin + '/', { waitUntil: 'domcontentloaded' }));
    check([first.phase.providerGETs, first.phase.source, first.phase.qualified, first.phase.checkedAt],
      [7, 'provider', 'true', Helper.CLOCK], 'A actually acquires qualified local provider evidence');
    check(first.packet.plan.startingCash.breakdown.map(row => row.value), [1215, 160, 0], 'invented live balances are independently known');
    truth(await page.locator('[data-budget-surface="pay-period"]').isVisible(), 'A renders the actual current Budget');
    const groceries = page.locator('[data-budget-category-open="groceries"][data-budget-browse-origin="spending"]');
    truth((await groceries.innerText()).includes('$308.55'), 'visible groceries reconcile independently: 212.40 + 96.15');
    truth((await statusText()).startsWith('Provider checked: Aug 20, 2026, 11:00 a.m. PT.'), 'A displays its actual evidence date');
    await page.evaluate(() => localStorage.setItem('synthetic-restart-context', 'retained'));
    const cookiesBefore = await context.cookies();
    const warm = await load('A-memory', () => page.reload({ waitUntil: 'domcontentloaded' }));
    check([warm.phase.providerGETs, warm.phase.source, warm.phase.qualified, warm.phase.checkedAt],
      [0, 'memory', 'true', Helper.CLOCK], 'A has an actual qualified process-local slot before shutdown');
    await app.close();
    truth(app.record.exited, 'A exits before B is spawned');
    mock.mode('failure');
    const countBeforeB = mock.calls.length;
    await start('B', CLOCK_B);
    truth(receipt.processes[0].pid !== app.record.pid, 'B is a genuinely fresh OS process');
    check(mock.calls.length, countBeforeB, 'B has no successful acquisition before the retained browser reloads');
    check(await context.cookies(), cookiesBefore, 'same browser authentication is retained; B is not logged in again');
    const failed = await load('B-cold-failed', () => page.reload({ waitUntil: 'domcontentloaded' }));
    check([failed.phase.providerGETs, failed.phase.providerPaths], [1, ['/v2/me']], 'first B acquisition reaches the failing real local mock');
    check([failed.phase.source, failed.phase.qualified, failed.phase.checkedAt, failed.phase.fetchedAt],
      ['provider', 'false', null, null], 'A memory and old last-success date are not restored as B evidence');
    check(await page.evaluate(() => localStorage.getItem('synthetic-restart-context')), 'retained', 'browser storage survives the actual server restart');
    check(failed.packet.liveOverlay.applied, false, 'failure cannot apply a current overlay');
    failed.phase.operatingPlan = failed.packet.liveOverlay.operatingPlan;
    check(failed.packet.plan.startingCash.breakdown.map(row => row.value), [15, 604.49, 0], 'independently known baseline cash is preserved, including native zero');
    check(failed.packet.debts[0].balance, 2000, 'dated baseline card balance is preserved');
    const unavailable = page.locator('[data-budget-surface="unavailable"]');
    expect(await unavailable.isVisible(), true, 'B visibly renders the unavailable current plan');
    expect(await page.locator('[data-budget-period-result]').count(), 0,
      'B withholds the dependent Balance After Deductions figure after a cold provider failure');
    // Record only this invented surface, never a production/household packet.
    failed.phase.visibleBudget = await page.locator('[data-budget-surface]').innerText();
    expect(failed.phase.visibleBudget.includes('Current plan unavailable'), true, 'failure stays explicit on the Budget face');
    expect(await page.locator('[data-budget-surface="pay-period"]').count(), 0,
      'B does not label a stale dated period as the current Budget');
    const baseline = page.locator('[data-last-trusted-opening]');
    expect(await baseline.isVisible(), true, 'independently known opening remains visibly labelled as a dated baseline');
    if (await baseline.count()) {
      truth((await baseline.innerText()).includes('$619.49'), 'known opening reconciles independently: 15 + 604.49 + 0');
      truth((await baseline.innerText()).includes('Dated balance - not current'), 'baseline is not represented as current cash');
    }
    const card = page.locator('[data-budget-card-toggle="travelvisa"]');
    truth(await card.isVisible(), 'independently known card remains visible alongside the withheld plan');
    truth((await card.innerText()).includes('$2,000.00'), 'known baseline card is not blanked or zeroed');
    const failedText = await statusText();
    failed.phase.visibleSourceStatus = failedText;
    truth(failedText.includes('Provider check details unavailable.'), 'visible source status does not claim a current qualification');
    expect(failedText.includes('Some financial figures unavailable.'), true, 'source status discloses financial withholding');
    truth(!failedText.includes('Using last successful check:') && !failedText.includes('11:00'), 'A success provenance is absent after restart failure');
    await page.screenshot({ path: path.join(out, 'B-cold-failed.png') });
    // B's later success has new acquisition and account-source timestamps.
    const restored = { ...Fixture.payload(), tags: [] };
    restored.accounts.forEach(row => { row.updated_at = BALANCE_DATE_B; });
    mock.payload(restored); mock.mode('ok');
    const recovered = await load('B-reacquired', () => page.reload({ waitUntil: 'domcontentloaded' }));
    check([recovered.phase.providerGETs, recovered.phase.source, recovered.phase.qualified, recovered.phase.checkedAt],
      [7, 'provider', 'true', CLOCK_B], 'B recovery is a real new seven-GET acquisition, never A memory');
    check(recovered.phase.fetchedAt, CLOCK_B, 'B keeps the actual new acquisition time');
    truth(recovered.phase.balanceDates.length > 0, 'new balance source dates reach the served overlay');
    check([...new Set(recovered.phase.balanceDates)], ['2026-08-21'], 'balance source dates are the actual new account dates');
    check(recovered.packet.liveOverlay.applied, true, 'B earns its qualified live overlay');
    truth(await page.locator('[data-budget-surface="pay-period"]').isVisible(), 'actual current Budget returns after acquisition');
    truth((await groceries.innerText()).includes('$308.55'), 'recovered visible spending still reconciles against invented transactions');
    truth((await statusText()).startsWith('Provider checked: Aug 21, 2026, 12:00 p.m. PT.'), 'B displays its new source check, not A date');
    check(recovered.packet.plan.startingCash.breakdown.map(row => row.value), [1215, 160, 0], 'recovery uses actual local provider balances');
    check(recovered.packet.liveOverlay.observedAsOf, '2026-08-21', 'household observation date is preserved');
    await page.screenshot({ path: path.join(out, 'B-reacquired.png') });
    check(errors, [], 'no browser script errors');
    check(browserMutations, [], 'all browser financial actions remain GET-only');
    receipt.result = receipt.failures.length ? 'FAIL' : 'PASS';
    if (receipt.failures.length) process.exitCode = 1;
  } catch (error) {
    receipt.result = 'FAIL';
    // Only assertion labels are published; screenshots contain invented input.
    receipt.failure = { name: error.name, label: String(error.message).split('\n')[0] };
    if (page) await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser?.close(); await app?.close(); await mock.close();
    receipt.runtimeMs = Math.round(performance.now() - started);
    receipt.optionalHistoryBlocked = [...optionalBlocked].sort();
    receipt.externalBrowserOriginsBlocked = externalBlocked.size;
    const refusals = receipt.processes.reduce((sum, record) => sum + record.boundaryRefusals, 0);
    if (refusals) { receipt.result = 'FAIL'; receipt.failure = { label: 'Child boundary refused an unsafe action' }; process.exitCode = 1; }
    fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log(receipt.result + ' browser observation cold restart: ' + receipt.assertions + ' assertions; ' + receipt.runtimeMs + 'ms');
    for (const failure of receipt.failures) console.log('FAIL ' + failure.label);
    console.log('Synthetic proof directory: ' + out);
  }
}
