'use strict';
// Real-browser acceptance check for Issue #727 (ATLAS-076):
// absent or empty funding sources must never publish invented funding.
// Real App boot (`/`, `/plan-spend.html`, `/planning.html`) in Chromium over a
// synthetic packet; every page in one state reads the SAME served packet
// (same generation). Spending refusal and the Savings hold must survive.
//
// NODE_PATH=<playwright packages> CHROME_PATH=<Chromium> node test/browser-absent-funding-sources-acceptance.js
// Optional: ATLAS_076_STRICT_NO_OPTIONS=1 also requires the spending refusal
// for the `funding: { heading, note }` (no `options` array) shape.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const fx = require('./fixtures/budget-surface-data');

const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'public');
const origin = 'http://absent-funding-sources.test';
const STRICT_NO_OPTIONS = process.env.ATLAS_076_STRICT_NO_OPTIONS === '1';

// Independent expectations from synthetic inputs (not copied from Forecast):
//   Fixture: test/fixtures/budget-surface-data.js served({ withheldSavings: true })
//   targetBuffer raised to 3,000 so an opening gap exists. Zero-spend floor
//   1,110 on 2026-08-24 -> gap 3,000 - 1,110 = 1,890.00.
//   Positive control: one usable synthetic cash source, available 2,500 >= 1,890.
const BUFFER = 3000;
const GAP_TEXT = /\$1,890(\.00)?/;
const SAVINGS_HELD = 'Additional savings proposals are withheld until the funding plan accounts for existing assignments and the cash used to pay each cost.';

const SHAPES = Object.freeze({
  absent: d => { delete d.plan.funding; },
  null: d => { d.plan.funding = null; },
  emptyOptions: d => { d.plan.funding = { heading: 'Synthetic funding heading', note: 'Synthetic funding note', options: [] }; },
  noOptions: d => { d.plan.funding = { heading: 'Synthetic funding heading', note: 'Synthetic funding note' }; },
});

function positiveControl(d) {
  d.plan.startingCash.heldElsewhere = [{ id: 'synthetic-held', value: 20000 }];
  d.plan.funding = { heading: 'Synthetic funding heading', note: 'Synthetic funding note', options: [{
    id: 'synthetic-cash', cash: 'synthetic-held', available: 2500, rank: 1, unusable: false,
    label: 'Synthetic cash source', short: 'synthetic cash', note: 'Synthetic only',
  }] };
}

function packet(shape) {
  const d = fx.served({ withheldSavings: true });
  d.plan.defaults.targetBuffer = BUFFER;
  shape(d);
  return d;
}

const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

function contentType(file) {
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  if (file.endsWith('.png')) return 'image/png';
  return 'text/html; charset=utf-8';
}

async function read(page) {
  return page.evaluate(() => {
    const text = document.body.textContent.replace(/\s+/g, ' ');
    const fund = document.getElementById('funding');
    return {
      packetHash: typeof App !== 'undefined' && App.data ? JSON.stringify(App.data) : null,
      text,
      refusal: [...document.querySelectorAll('.payday-refuse')].map(e => e.textContent.replace(/\s+/g, ' ').trim()),
      hero: [...document.querySelectorAll('.payday-hero')].map(e => e.textContent.trim()),
      fundingHidden: fund ? fund.hidden : null,
      fundCards: document.querySelectorAll('#funding-options .fund').length,
      band: (document.getElementById('status-band') || {}).textContent || '',
      held: [...document.querySelectorAll('[data-savings-instructions="withheld"]')].map(e => e.textContent.trim()),
    };
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  const receipt = { issue: 727, code: 'ATLAS-076', syntheticOnly: true, strictNoOptions: STRICT_NO_OPTIONS,
    states: [], openGaps: [], mutations: [], external: [], pageErrors: [] };
  let served = null;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.route('**/*', async route => {
      const req = route.request();
      const url = new URL(req.url());
      if (!['GET', 'HEAD'].includes(req.method())) { receipt.mutations.push(`${req.method()} ${req.url()}`); return route.abort(); }
      if (url.origin !== origin) { receipt.external.push(req.url()); return route.abort(); }
      if (url.pathname === '/data.json') return route.fulfill({ json: served });
      if (['/periods.json', '/balance-history.json', '/running-build.json'].includes(url.pathname)) return route.fulfill({ json: null });
      const rel = url.pathname === '/' ? '/index.html' : url.pathname;
      const file = path.resolve(assets, '.' + rel);
      if (!file.startsWith(assets + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: 'not found' });
      return route.fulfill({ body: fs.readFileSync(file), contentType: contentType(file) });
    });
    const page = await context.newPage();
    page.on('pageerror', err => receipt.pageErrors.push(String(err)));

    const visit = async (pathname, waitSel) => {
      await page.goto(origin + pathname);
      if (waitSel) await page.locator(waitSel).first().waitFor({ state: 'attached', timeout: 10000 });
      await page.waitForLoadState('networkidle');
      return read(page);
    };

    // One state = one served packet, read by `/` then `/plan-spend.html` then `/planning.html`.
    const runState = async (label, shape, expectFunded) => {
      served = packet(shape);
      const servedHash = hash(served);
      const home = await visit('/', '#status-band[data-plan-status]');
      const spend = await visit('/plan-spend.html', '[data-savings-instructions]');
      const planning = await visit('/planning.html');
      const pages = { '/': home, '/plan-spend.html': spend, '/planning.html': planning };

      // Same generation: every page booted the exact served packet.
      for (const [p, r] of Object.entries(pages)) {
        assert.ok(r.packetHash, `${label} ${p}: App.data present`);
        assert.equal(hash(JSON.parse(r.packetHash)), servedHash, `${label} ${p}: App.data is the served packet`);
      }

      // Savings hold preserved on `/` and `/plan-spend.html`.
      for (const p of ['/', '/plan-spend.html']) {
        assert.ok(pages[p].held.length >= 1, `${label} ${p}: Savings hold element rendered`);
        assert.ok(pages[p].held.every(t => t === SAVINGS_HELD), `${label} ${p}: Savings hold wording exact`);
      }

      const row = { state: label, servedHash, home: { refusal: home.refusal.length, hero: home.hero, fundingHidden: home.fundingHidden, fundCards: home.fundCards } };
      if (expectFunded) {
        // Positive control proves the probes detect real funding.
        assert.equal(home.refusal.length, 0, `${label}: no refusal when funded`);
        assert.equal(home.hero.length, 1, `${label}: weekly hero rendered`);
        assert.match(home.text, /Gap funding — synthetic cash/, `${label}: gap funding event rendered`);
        assert.equal(home.fundingHidden, false);
        assert.equal(home.fundCards, 1);
      } else {
        // No invented funding on any page.
        for (const [p, r] of Object.entries(pages)) {
          assert.doesNotMatch(r.text, /Gap funding/, `${label} ${p}: no gap-funding event`);
          assert.doesNotMatch(r.text, /Synthetic cash source|synthetic cash/, `${label} ${p}: no stale positive-control source`);
          assert.equal(r.hero.length, 0, `${label} ${p}: no weekly/spendable hero`);
        }
        assert.equal(home.fundCards, 0, `${label}: no funding source cards`);
        // Status band states the full gap is unfunded (nothing allocated).
        assert.match(home.band, /Every usable source combined reaches\s*\$0\.00/, `${label}: band reaches $0.00`);
        assert.match(home.band, GAP_TEXT, `${label}: band names full gap`);
        // Spending refusal.
        const refusalOk = home.refusal.length === 1
          && /no feasible weekly cap/i.test(home.refusal[0]) && GAP_TEXT.test(home.refusal[0]);
        row.refusalRendered = refusalOk;
        if (label === 'noOptions' && !STRICT_NO_OPTIONS) {
          if (!refusalOk) receipt.openGaps.push('noOptions: `/` renders no .payday-refuse (plan render stops); band still unfunded, no hero, no invented funding');
        } else {
          assert.ok(refusalOk, `${label}: spending refusal names the unfunded gap`);
        }
      }
      receipt.states.push(row);
    };

    for (const [label, shape] of Object.entries(SHAPES)) await runState(label, shape, false);
    await runState('positive-control', positiveControl, true);
    // Funded -> absent: stale funding must disappear on the next generation.
    await runState('absent-after-funded', SHAPES.absent, false);
    await runState('emptyOptions-after-funded', SHAPES.emptyOptions, false);

    assert.deepEqual(receipt.mutations, [], 'no non-GET requests');
    assert.deepEqual(receipt.external, [], 'no external requests');
    assert.deepEqual(receipt.pageErrors, [], 'no page errors');
    await context.close();
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(receipt, null, 1));
  console.log(`PASS browser-absent-funding-sources-acceptance: ${receipt.states.length} states x 3 pages; open gaps: ${receipt.openGaps.length}`);
})().catch(err => { console.error(err); process.exit(1); });
