'use strict';
// ATLAS-024: Savings goal Paid / Still to fund rows with a progress fill.
// Paid is Forecast's published commitmentCost fact; Still to fund is
// Forecast's funding-schedule publication (planSpendPaydayFunding
// stillToFund, joined by goal id at the matching asOf) — never the
// commitmentCost unpaidCost, which excludes Saved. Real App.boot and the
// real Budget renderer; only intercepted invented GETs, no external
// requests, no writes. Expected figures come from the hand-written
// oracles below, derived from the invented fixture inputs (pool 119
// backing goals chronologically; links per the fixture), not from the
// renderer or Forecast.
//
// Mode notes (this branch's base): with qualified evidence the schedule
// publication is unavailable because the fully paid goal leaves a
// zero-obligation commitment the pre-repair scheduler rejects, so Still
// to fund is honestly Unknown in 'evidence' and 'uncertain'; the paid /
// saved bar geometry does not depend on the schedule and still renders.
// In 'absent' the schedule is ready and publishes the funding gap even
// though Paid itself is unconfigured and Unknown.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const crypto = require('node:crypto'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { data: fixture, GOALS, GAP_GOALS } = require('./fixtures/savings-goal-paid-progress-data');
const root = path.resolve(__dirname, '..'), assets = path.join(root, 'public');
const out = process.env.ATLAS_PAID_PROGRESS_PROOF || path.join(require('node:os').tmpdir(), 'atlas-goal-paid-progress');
fs.mkdirSync(out, { recursive: true });
const ORIGIN = 'http://savings-goal-paid.test';
const served = {}, cases = [], errors = [], external = [], writes = [];
const near = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) <= 0.02, `${message}: expected ≈${expected}, got ${actual}`);

// Hand oracle per mode: printed Paid, printed Still to fund, block state,
// row-bar segment ratios (of the published original cost), and the
// visible-face bar fill ratio / band where the paid geometry publishes.
const EXPECT = {
  evidence: {
    'goal-a': { paid: '$40.00', stf: 'Unknown', state: 'paid', paidRatio: 1, faceBand: 'is-paid', faceRatio: 1 },
    'goal-b': { paid: '$20.00', stf: 'Unknown', state: 'funding', paidRatio: 0.25, savedRatio: 0.75, faceRatio: 1 },
    'goal-c': { paid: '$0.00', stf: 'Unknown', state: 'funding', savedRatio: 59 / 60, faceRatio: 59 / 60 },
  },
  absent: {
    'goal-a': { paid: 'Unknown', stf: '$0.00', state: 'unknown' },
    'goal-b': { paid: 'Unknown', stf: '$1.00', state: 'unknown' },
    'goal-c': { paid: 'Unknown', stf: '$60.00', state: 'unknown' },
  },
  uncertain: {
    'goal-a': { paid: '$40.00', stf: 'Unknown', state: 'paid', paidRatio: 1, faceBand: 'is-paid', faceRatio: 1 },
    'goal-b': { paid: 'Unknown', stf: 'Unknown', state: 'unknown' },
    'goal-c': { paid: '$0.00', stf: 'Unknown', state: 'funding' },
  },
  gap: {
    'goal-f': { paid: '$0.00', stf: '$0.00', state: 'funding', savedRatio: 1, faceRatio: 1 },
    'goal-d': { paid: '$20.00', stf: '$30.00', state: 'funding', paidRatio: 0.25, savedRatio: 0.375, faceRatio: 0.625 },
    'goal-e': { paid: '$0.00', stf: '$50.00', state: 'funding' },
  },
};
const MODE_GOALS = { evidence: GOALS, absent: GOALS, uncertain: GOALS, gap: GAP_GOALS };

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
      stf: li.querySelector('[data-budget-goal-still-to-fund]')?.textContent.trim() ?? null,
      stfStamp: block ? block.getAttribute('data-budget-goal-still-to-fund-amount') : null,
      paidLabel: li.querySelector('[data-budget-goal-paid]')?.parentElement?.textContent ?? '',
      track: box(track), paidWidth: box(paidFill), savedWidth: box(savedFill),
      paidColor: paidFill ? getComputedStyle(paidFill).backgroundColor : null,
      figuresOverflow: figures ? figures.scrollWidth > figures.clientWidth + 1 : null,
    };
  });
}

async function faceFacts(tile) {
  return tile.locator('[data-blend-goals] .blend-goal-legend > li').evaluateAll(items =>
    items.map(li => {
      const bar = li.querySelector('.blend-g-bar');
      if (!bar) return { band: null, ratio: null, fill: null };
      const before = getComputedStyle(bar, '::before');
      return {
        band: [...bar.classList].find(c => c.startsWith('is-')) || null,
        ratio: bar.getBoundingClientRect().width > 0
          ? parseFloat(before.width) / bar.getBoundingClientRect().width : null,
        fill: before.backgroundColor,
      };
    }));
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH
    || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    for (const width of [1440, 390]) for (const mode of ['evidence', 'absent', 'uncertain', 'gap']) {
      const goals = MODE_GOALS[mode], expect = EXPECT[mode];
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
      // Never hidden: every invented goal keeps its row in every mode, in
      // the published chronological order; this page never reorders. (The
      // uncertain packet is held unresolved by Forecast and its own order
      // is not re-sorted here.)
      assert.deepEqual([...keys].sort(), goals.map(g => g.key).sort(), `${mode} ${width}: every goal row present`);
      if (mode !== 'uncertain') assert.deepEqual(keys, goals.map(g => g.key), `${mode} ${width}: chronological order`);
      const face = await faceFacts(tile);
      const facts = {};
      for (const goal of goals) {
        const f = await goalFacts(tile.locator(`[data-budget-savings-goal="${goal.key}"]`));
        facts[goal.id] = f;
        const e = expect[goal.id], where = `${mode} ${width} ${goal.label}`;
        assert.ok(f.state, `${where}: paid progress block rendered`);
        assert.ok(f.track > 0, `${where}: progress track has width`);
        assert.equal(f.figuresOverflow, false, `${where}: figures fit their row`);
        assert.match(f.paidLabel, /Paid/, `${where}: Paid label`);
        assert.equal(f.state, e.state, `${where}: block state`);
        assert.equal(f.paid, e.paid, `${where}: Paid from published confirmedLinkedPaid`);
        // Still to fund is the schedule's funding gap — the assertion the
        // unpaidCost rendering failed (cost 80 / paid 20 / saved 30 must
        // read $30.00, not the $60.00 unpaid cost).
        assert.equal(f.stf, e.stf, `${where}: Still to fund from published schedule stillToFund`);
        if (e.stf === 'Unknown') assert.equal(f.stfStamp, null, `${where}: no still-to-fund stamp when unknown`);
        else assert.equal(Number(f.stfStamp), Number(e.stf.replace(/[$,]/g, '')), `${where}: still-to-fund stamp matches print`);
        if (e.state === 'paid') {
          near(f.paidWidth / f.track, 1, `${where}: full paid fill`);
          assert.match(f.paidColor, /^rgb/, `${where}: paid fill painted`);
          assert.notEqual(f.paidColor, 'rgba(0, 0, 0, 0)', `${where}: paid fill not transparent`);
        } else if (e.state === 'unknown') {
          assert.ok(!f.paidWidth, `${where}: no paid fill without a paid fact`);
          assert.ok(!f.savedWidth, `${where}: no saved fill without paid geometry`);
        } else {
          if (e.paidRatio) near(f.paidWidth / f.track, e.paidRatio, `${where}: paid fill ratio`);
          else assert.ok(!f.paidWidth, `${where}: no paid fill at zero paid`);
          if (e.savedRatio) near(f.savedWidth / f.track, e.savedRatio, `${where}: saved fill ratio`);
          else if (e.savedRatio == null && mode !== 'uncertain') assert.ok(!f.savedWidth, `${where}: no saved fill at zero saved`);
          if (f.paidWidth && f.savedWidth) assert.ok(f.paidWidth + f.savedWidth <= f.track + 1, `${where}: fill stays in track`);
        }
        // Visible face (budget-blend.js paintGoals): a paid goal's bar is
        // full and green (is-paid); other published geometry fills by
        // paid + saved over the published original cost.
        const fb = face[keys.indexOf(goal.key)];
        if (e.faceBand) {
          assert.equal(fb.band, e.faceBand, `${where}: face bar band`);
          near(fb.ratio, e.faceRatio, `${where}: face bar fill ratio`);
          assert.notEqual(fb.fill, 'rgba(0, 0, 0, 0)', `${where}: face bar fill painted`);
        } else if (e.faceRatio != null) {
          near(fb.ratio, e.faceRatio, `${where}: face bar fill ratio (paid + saved)`);
        }
      }
      if (mode === 'evidence') {
        assert.ok(facts['goal-a'].paidWidth > facts['goal-b'].paidWidth, 'paid fill orders A over B');
      }
      if (mode === 'gap') {
        // The headline case, isolated: D's Still to fund is the funding
        // gap 30, and F's fully-saved bar is full without being paid.
        assert.equal(facts['goal-d'].stf, '$30.00', 'gap: D still to fund is the funding gap');
        assert.equal(facts['goal-f'].state, 'funding', 'gap: F fully saved is not paid');
      }
      // Household-facing face carries the same printed Paid / Still to
      // fund text as each plan.js row, verbatim.
      const faceText = await tile.locator('[data-blend-goals]').evaluate(n => n.textContent.replace(/\s+/g, ' '));
      for (const goal of goals) {
        const f = facts[goal.id];
        assert.ok(faceText.includes('Paid ' + f.paid), `${mode} ${width} ${goal.label}: face prints Paid ${f.paid}`);
        assert.ok(faceText.includes('Still to fund ' + f.stf), `${mode} ${width} ${goal.label}: face prints Still to fund ${f.stf}`);
      }
      assert.equal(await page.evaluate(() => JSON.stringify(App.data)), before, `${mode} ${width}: App.data unchanged`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${mode} ${width}: no horizontal overflow`);
      await tile.screenshot({ path: path.join(out, `${mode}-${width}.png`), animations: 'disabled' });
      cases.push({ width, mode, keys, facts });
      console.log('PASS ' + mode + ' ' + width);
      await page.close();
    }
  } finally { await browser.close(); }
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(writes, []);
  const head = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify({ head, synthetic: true, served, cases, errors, external, writes }, null, 2) + '\n');
  console.log('PASS all ' + cases.length + ' cases');
})().catch(e => { console.error(e); process.exitCode = 1; });
