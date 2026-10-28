'use strict';
// ATLAS-024: Savings goal Paid / Saved / Still to fund rows with a progress
// fill, read-only from Forecast's published commitmentCost facts. Real
// App.boot and the real Budget renderer; only intercepted invented GETs, no
// external requests, no writes. The expected figures and order come from the
// hand-written fixture oracle (GOALS), not from the renderer or Forecast.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const crypto = require('node:crypto'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { data: fixture, GOALS } = require('./fixtures/savings-goal-paid-progress-data');
const root = path.resolve(__dirname, '..'), assets = path.join(root, 'public');
const out = process.env.ATLAS_PAID_PROGRESS_PROOF || path.join(require('node:os').tmpdir(), 'atlas-goal-paid-progress');
fs.mkdirSync(out, { recursive: true });
const ORIGIN = 'http://savings-goal-paid.test';
const served = {}, cases = [], errors = [], external = [], writes = [];
const money = cents => '$' + (cents / 100).toFixed(2);
const near = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) <= 0.02, `${message}: expected ≈${expected}, got ${actual}`);

async function goalFacts(row) {
  return row.evaluate(li => {
    const box = n => n ? n.getBoundingClientRect().width : null;
    const block = li.querySelector('[data-budget-goal-paid-progress]');
    const track = li.querySelector('[data-budget-goal-bar]');
    const paidFill = li.querySelector('[data-budget-goal-bar-paid]');
    const savedFill = li.querySelector('[data-budget-goal-bar-saved]');
    const figures = li.querySelector('[data-budget-goal-paid-figures]');
    return {
      state: block ? block.getAttribute('data-budget-goal-paid-progress') : null,
      paid: li.querySelector('[data-budget-goal-paid]')?.textContent.trim() ?? null,
      unpaid: li.querySelector('[data-budget-goal-unpaid]')?.textContent.trim() ?? null,
      paidLabel: li.querySelector('[data-budget-goal-paid]')?.parentElement?.textContent ?? '',
      saved: li.getAttribute('data-budget-goal-saved-amount'),
      track: box(track), paidWidth: box(paidFill), savedWidth: box(savedFill),
      paidColor: paidFill ? getComputedStyle(paidFill).backgroundColor : null,
      figuresOverflow: figures ? figures.scrollWidth > figures.clientWidth + 1 : null,
    };
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH
    || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    for (const width of [1440, 390]) for (const mode of ['evidence', 'absent', 'uncertain']) {
      const data = fixture(mode);
      const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
      page.setDefaultTimeout(10000);
      await page.addInitScript(() => localStorage.setItem('hfd-plan-knobs-v1', JSON.stringify({ weeklyVariable: 0 })));
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== ORIGIN) { external.push(url.origin); return route.abort(); }
        if (route.request().method() !== 'GET') { writes.push(route.request().method()); return route.abort(); }
        if (url.pathname === '/data.json') return route.fulfill({ json: data });
        if (['/periods.json', '/balance-history.json', '/running-build.json'].includes(url.pathname)) return route.fulfill({ json: null });
        const file = path.resolve(assets, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
        if (!file.startsWith(assets + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
        const body = fs.readFileSync(file);
        served[path.relative(root, file).replaceAll('\\', '/')] = crypto.createHash('sha256').update(body).digest('hex');
        return route.fulfill({ body, contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
      });
      await page.goto(ORIGIN + '/');
      const tile = page.locator('[data-budget-savings-goals]'); await tile.waitFor();
      const before = await page.evaluate(() => JSON.stringify(App.data));
      const keys = await tile.locator('[data-budget-savings-goal]').evaluateAll(rows =>
        rows.map(row => row.getAttribute('data-budget-savings-goal')));
      // Never hidden: every invented goal keeps its row in every mode.
      assert.deepEqual([...keys].sort(), GOALS.map(g => g.key).sort(), `${mode} ${width}: every goal row present`);
      // Chronological order as published; this page never reorders. With
      // qualified or absent evidence the published order is the invented
      // date order. (The uncertain packet is held unresolved by Forecast and
      // its own order is not re-sorted here.)
      if (mode !== 'uncertain') assert.deepEqual(keys, GOALS.map(g => g.key), `${mode} ${width}: chronological order`);
      const facts = {};
      for (const goal of GOALS) {
        const f = await goalFacts(tile.locator(`[data-budget-savings-goal="${goal.key}"]`));
        facts[goal.id] = f;
        const where = `${mode} ${width} ${goal.label}`;
        assert.ok(f.state, `${where}: paid progress block rendered`);
        assert.ok(f.track > 0, `${where}: progress track has width`);
        assert.equal(f.figuresOverflow, false, `${where}: figures fit their row`);
        assert.match(f.paidLabel, /Paid/, `${where}: Paid label`);
        const known = mode === 'evidence' || mode === 'uncertain' && goal.id !== 'goal-b';
        if (!known) {
          // Absent / uncertain facts are unknown — never 0, never hidden.
          assert.equal(f.state, 'unknown', `${where}: unknown progress`);
          assert.equal(f.paid, 'Unknown', `${where}: Paid Unknown`);
          assert.equal(f.unpaid, 'Unknown', `${where}: Still to fund Unknown`);
          assert.ok(!f.paidWidth, `${where}: no paid fill without a paid fact`);
          assert.ok(!f.savedWidth, `${where}: no saved fill without a paid fact`);
          continue;
        }
        const unpaidCents = goal.amount * 100 - goal.linkedCents;
        assert.equal(f.paid, money(goal.linkedCents), `${where}: Paid from published confirmedLinkedPaid`);
        assert.equal(f.unpaid, money(unpaidCents), `${where}: Still to fund from published unpaidCost`);
        if (unpaidCents === 0) {
          assert.equal(f.state, 'paid', `${where}: fully paid state`);
          near(f.paidWidth / f.track, 1, `${where}: full fill`);
          assert.match(f.paidColor, /^rgb/, `${where}: paid fill painted`);
          assert.notEqual(f.paidColor, 'rgba(0, 0, 0, 0)', `${where}: paid fill not transparent`);
        } else {
          assert.equal(f.state, 'funding', `${where}: partial funding state`);
          near((f.paidWidth || 0) / f.track, goal.linkedCents / (goal.amount * 100), `${where}: paid fill ratio`);
          if (mode === 'evidence') {
            assert.ok(f.saved != null, `${where}: published saved stamp`);
            near((f.savedWidth || 0) / f.track, Math.min(1, Number(f.saved) / goal.amount), `${where}: saved fill ratio`);
            assert.ok((f.paidWidth || 0) + (f.savedWidth || 0) < f.track + 1, `${where}: fill stays in track`);
          }
        }
      }
      if (mode === 'evidence') {
        // The fully paid row must read as fully paid, the partly paid as partial.
        assert.ok(facts['goal-a'].paidWidth > facts['goal-b'].paidWidth, 'paid fill orders A over B');
      }
      // Household-facing face (budget-blend.js paintGoals) carries the same
      // printed Paid / Still to fund text as each plan.js row, verbatim.
      const faceText = await tile.locator('[data-blend-goals]').evaluate(n => n.textContent.replace(/\s+/g, ' '));
      for (const goal of GOALS) {
        const f = facts[goal.id];
        assert.ok(faceText.includes('Paid ' + f.paid), `${mode} ${width} ${goal.label}: face prints Paid ${f.paid}`);
        assert.ok(faceText.includes('Still to fund ' + f.unpaid), `${mode} ${width} ${goal.label}: face prints Still to fund ${f.unpaid}`);
      }
      assert.equal(await page.evaluate(() => JSON.stringify(App.data)), before, `${mode} ${width}: App.data unchanged`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${mode} ${width}: no horizontal overflow`);
      await tile.screenshot({ path: path.join(out, `${mode}-${width}.png`), animations: 'disabled' });
      cases.push({ width, mode, keys, facts, faceShowsPaid: /\bPaid\b/.test(faceText) });
      console.log('PASS ' + mode + ' ' + width);
      await page.close();
    }
  } finally { await browser.close(); }
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(writes, []);
  const head = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify({ head, synthetic: true, served, cases, errors, external, writes }, null, 2) + '\n');
  console.log('PASS all ' + cases.length + ' cases');
})().catch(e => { console.error(e); process.exitCode = 1; });
