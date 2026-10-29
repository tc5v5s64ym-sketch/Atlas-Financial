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
// Mode notes (published #770 contract, "Keep fully paid goals from
// blocking the funding schedule", merge 9764226621; asserted by
// test/test-savings-paid-goal-lifecycle.js "scheduler: fully Paid goal
// keeps the current funding schedule ... ready"): with qualified evidence
// Forecast qualifies goal A's full relief (link effective 2026-10-05, on or
// before the packet observation asOf 2026-10-07), emits no fabricated zero
// cash event, keeps the schedule ready and publishes A's funding gap as a
// real zero. So in 'evidence' Still to fund is numeric for every goal: A
// $0.00 (relieved need 0), B $0.00 (relieved need 80 - 20 = 60, backed 60
// of the 119 pool), C $1.00 (need 60, backed by the remaining 59). That
// $0.00 is a published fact, not an invented zero. Unknown is preserved
// where the evidence genuinely does not support a figure: 'uncertain' (B's
// link carries a reversal, so Forecast withholds the whole schedule) and
// every noncurrent (historical / projected) period, which withholds the
// current gap. In 'absent' the schedule is ready and publishes the funding
// gap even though Paid itself is unconfigured and Unknown.
//
// Two dates, never conflated: OBSERVATION_AS_OF is the packet's
// meta.asOf (2026-10-07, via the roster -> daily-consumer fixture chain)
// that the schedule/commitmentCost join keys on; LINK_EFFECTIVE is the
// payment link's own effectiveDate / asOf (2026-10-05) that pins when the
// relief took effect. Both are hand-pinned below and checked against the
// fixture before any page loads.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const crypto = require('node:crypto'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { data: fixture, GOALS, GAP_GOALS } = require('./fixtures/savings-goal-paid-progress-data');
const root = path.resolve(__dirname, '..'), assets = path.join(root, 'public');
const out = process.env.ATLAS_PAID_PROGRESS_PROOF || path.join(require('node:os').tmpdir(), 'atlas-goal-paid-progress');
fs.mkdirSync(out, { recursive: true });
const ORIGIN = 'http://savings-goal-paid.test';
const served = {}, cases = [], errors = [], external = [], writes = [];
const OBSERVATION_AS_OF = '2026-10-07', LINK_EFFECTIVE = '2026-10-05';
const near = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) <= 0.02, `${message}: expected ≈${expected}, got ${actual}`);

// Hand oracle per mode: printed Paid, printed Still to fund, block state,
// row-bar segment ratios (of the published original cost), and the
// visible-face bar fill ratio / band where the paid geometry publishes.
const EXPECT = {
  evidence: {
    'goal-a': { paid: '$40.00', stf: '$0.00', state: 'paid', paidRatio: 1, faceBand: 'is-paid', faceRatio: 1 },
    'goal-b': { paid: '$20.00', stf: '$0.00', state: 'funding', paidRatio: 0.25, savedRatio: 0.75, faceRatio: 1 },
    'goal-c': { paid: '$0.00', stf: '$1.00', state: 'funding', savedRatio: 59 / 60, faceRatio: 59 / 60 },
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

// Date pins, checked against the invented fixture (not the renderer):
// the observation asOf and the link effective date are distinct facts.
for (const mode of ['evidence', 'uncertain', 'gap']) {
  const d = fixture(mode);
  assert.equal(d.meta.asOf, OBSERVATION_AS_OF, `${mode}: packet meta.asOf is the observation date`);
  for (const c of d.settlementEvidence.commitments) for (const l of c.links) {
    assert.equal(l.effectiveDate, LINK_EFFECTIVE, `${mode} ${c.goalId}: link effectiveDate`);
    assert.equal(l.asOf, LINK_EFFECTIVE, `${mode} ${c.goalId}: link asOf`);
  }
}
assert.notEqual(OBSERVATION_AS_OF, LINK_EFFECTIVE, 'observation asOf and link effective date are distinct');
assert.ok(LINK_EFFECTIVE <= OBSERVATION_AS_OF, 'relief is effective on or before the observation asOf');
assert.equal(fixture('absent').meta.asOf, OBSERVATION_AS_OF, 'absent: packet meta.asOf');
const rows = { A3: [], A4: [], A9: [] };

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
        else {
          // A published zero must carry its own stamp; Number(null) === 0
          // would otherwise let a missing stamp pass as a zero gap.
          assert.notEqual(f.stfStamp, null, `${where}: still-to-fund stamp present for a published figure`);
          assert.equal(Number(f.stfStamp), Number(e.stf.replace(/[$,]/g, '')), `${where}: still-to-fund stamp matches print`);
        }
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
        // A9 no false retirement / no false green: only a goal whose hand
        // oracle state is paid may render the paid band or paid state.
        if (e.state !== 'paid') {
          assert.notEqual(fb.band, 'is-paid', `${where}: no paid face band without qualified full relief`);
          assert.notEqual(f.state, 'paid', `${where}: not retired as paid`);
        }
        if (e.state === 'unknown') assert.ok(!f.paidWidth && !f.savedWidth, `${where}: unknown draws no fill`);
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
      if (mode === 'gap' || mode === 'evidence') {
        // Period-context cases (Atlas re-review 6483658593): the funding
        // schedule joined above is the live/current publication, fetched
        // without a selected period. A historical or projected packet
        // withholds the goal facts but retains the same goal ids and the
        // same observation asOf, so an asOf-only join prints today's
        // numeric gap beside that period's Unknown Paid. Matching asOf is
        // not matching period/context: outside the current context the
        // gap must be withheld (Unknown, no stamp, face included), and
        // returning to the current period must restore the numeric gap.
        // Wheel items outside the visible slot are not pointer-visible,
        // so selection dispatches the item's own click through the app's
        // delegated wheel handler — the same selection path a tap takes.
        const selectPeriod = async index => {
          const marker = await page.evaluate(() =>
            document.querySelector('[data-calendar-waterfalls]')?.getAttribute('data-selected-pay-period'));
          await page.evaluate(i => {
            document.querySelector(`[data-budget-wheel="period"] [data-wheel-index="${i}"]`).click();
          }, index);
          await page.waitForFunction(prev =>
            document.querySelector('[data-calendar-waterfalls]')?.getAttribute('data-selected-pay-period') !== prev,
            marker, { timeout: 10000 });
          await page.waitForTimeout(300);
        };
        const wheel = await page.evaluate(() => {
          const items = [...document.querySelectorAll('[data-budget-wheel="period"] [data-wheel-index]')];
          return { count: items.length, current: items.findIndex(b => b.hasAttribute('aria-current')) };
        });
        assert.ok(wheel.current > 0 && wheel.current + 2 < wheel.count,
          'gap: historical and projected periods are selectable');
        const factsById = async () => {
          const out = {};
          for (const g of goals) {
            const row = tile.locator(`[data-budget-savings-goal="${g.key}"]`);
            if (await row.count()) out[g.id] = await goalFacts(row);
          }
          return out;
        };
        // Hand oracle per mode: goals whose Paid / gap the noncurrent packet
        // must withhold, and today's printed gaps that must not leak there.
        // Retirement (#770 contract; lifecycle "selected future publications
        // omit actual Paid goals"): a projected packet starts after the
        // observation asOf, so the goal fully paid by then (A) has no
        // remaining obligation there and is retired from the projected
        // rows; the historical packet still lists it, withheld. Goals with
        // a remaining obligation (B, C) stay listed and withheld everywhere.
        const WITHHELD = mode === 'gap'
          ? { ids: ['goal-d', 'goal-e'], gaps: ['$30.00', '$50.00'], retiredProjected: [] }
          : { ids: ['goal-a', 'goal-b', 'goal-c'], gaps: ['$0.00', '$1.00'], retiredProjected: ['goal-a'] };
        const expectWithheld = async (factsNow, tag) => {
          const projected = !tag.endsWith('historical');
          for (const id of WITHHELD.ids) {
            if (projected && WITHHELD.retiredProjected.includes(id)) {
              assert.equal(factsNow[id], undefined, `${tag}: ${id} fully paid goal retired from the projected period`);
              continue;
            }
            assert.ok(factsNow[id], `${tag}: ${id} row present`);
            assert.equal(factsNow[id].paid, 'Unknown', `${tag}: ${id} Paid withheld by the noncurrent packet`);
            assert.equal(factsNow[id].stf, 'Unknown', `${tag}: ${id} Still to fund must not borrow today's gap`);
            assert.equal(factsNow[id].stfStamp, null, `${tag}: ${id} no still-to-fund stamp when withheld`);
            assert.notEqual(factsNow[id].state, 'paid', `${tag}: ${id} not shown retired as paid outside the current period`);
          }
          const text = await tile.locator('[data-blend-goals]').evaluate(n => n.textContent.replace(/\s+/g, ' '));
          for (const gap of WITHHELD.gaps) assert.ok(!text.includes('Still to fund ' + gap), `${tag}: face does not print today's ${gap} gap`);
        };
        await selectPeriod(wheel.current - 1);
        await expectWithheld(await factsById(), `${mode} ${width} historical`);
        await selectPeriod(wheel.current + 1);
        await expectWithheld(await factsById(), `${mode} ${width} projected-next`);
        await selectPeriod(wheel.current + 2);
        await expectWithheld(await factsById(), `${mode} ${width} projected-future`);
        await selectPeriod(wheel.current);
        const restored = await factsById();
        for (const goal of goals) {
          assert.equal(restored[goal.id].stf, expect[goal.id].stf, `${mode} ${width} current restored: ${goal.id} gap`);
          assert.equal(restored[goal.id].state, expect[goal.id].state, `${mode} ${width} current restored: ${goal.id} state`);
        }
        rows.A9.push(`${mode} ${width}: historical withholds ${WITHHELD.ids.join(',')}; projected-next/future withhold ${WITHHELD.ids.filter(id => !WITHHELD.retiredProjected.includes(id)).join(',')}${WITHHELD.retiredProjected.length ? ' and retire ' + WITHHELD.retiredProjected.join(',') : ''} (Unknown, no stamp, no paid state); current restored`);
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
      if (mode === 'evidence' || mode === 'gap') rows.A3.push(`${mode} ${width}: partial Paid + Saved join (${mode === 'evidence' ? 'B paid 0.25 + saved 0.75, STF $0.00' : 'D paid 0.25 + saved 0.375, STF $30.00'})`);
      if (mode === 'evidence') rows.A4.push(`${width}: A fully paid row fill 1.0 ${facts['goal-a'].paidColor}; face ${face[keys.indexOf('commitment:goal-a')].band} ratio ${face[keys.indexOf('commitment:goal-a')].ratio} ${face[keys.indexOf('commitment:goal-a')].fill}; STF $0.00`);
      if (mode === 'absent' || mode === 'uncertain') rows.A9.push(`${mode} ${width}: ${goals.map(g => g.id + ' ' + facts[g.id].paid + '/' + facts[g.id].stf + '/' + facts[g.id].state).join('; ')}`);
      cases.push({ width, mode, keys, facts });
      console.log('PASS ' + mode + ' ' + width);
      await page.close();
    }
  } finally { await browser.close(); }
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(writes, []);
  const head = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  // A4 requires the 390px face/bar observation specifically.
  assert.ok(rows.A4.some(r => r.startsWith('390:')), 'A4: 390px fully paid face/bar observed');
  fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify({ head, synthetic: true, observationAsOf: OBSERVATION_AS_OF, linkEffective: LINK_EFFECTIVE, rows, served, cases, errors, external, writes }, null, 2) + '\n');
  for (const [row, list] of Object.entries(rows)) for (const r of list) console.log(`ROW ${row} PASS ${r}`);
  console.log('PASS all ' + cases.length + ' cases');
})().catch(e => { console.error(e); process.exitCode = 1; });
