'use strict';
/* PR #582 — source-bound unavailable-state capture (renderer level).
 *
 * Renders the PR's OWN unavailable-publication fixture (the same fixture as
 * test/test-travel-visa-annual-fee.js's bare-identity block) through the
 * pushed tree's real public/plan.js + public/savings-inventory.js +
 * public/forecast.js in real Chromium, styled by the app's real stylesheets,
 * and measures: fee ABSENT from Savings (both canonical identities),
 * the neutral note VISIBLE (computed style + layout box + rendered text),
 * unrelated goals preserved, and the paired Bills section in the same state
 * (no upcoming bucket, no fee entry — the note claims nothing about it).
 *
 * This is a renderer-level capture: it does NOT boot the full app and does
 * NOT exercise the served-data pipeline. The ready/no-fee browser harness
 * (test/browser-travel-visa-annual-fee.js) is a separate claim and does not
 * exercise this fallback.
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const REPO = process.env.CAPTURE_REPO || path.join(__dirname, '..', 'atlas-visa-fee-neutral');
const OUT = __dirname;
const NEUTRAL = 'Travel Visa annual fee is treated as a bill; its funding is unchanged.';

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PR582 unavailable-state capture</title>
<link rel="stylesheet" href="/public/fonts.css">
<link rel="stylesheet" href="/public/styles.css">
<link rel="stylesheet" href="/public/household-view.css">
<link rel="stylesheet" href="/public/budget-polish.css">
<link rel="stylesheet" href="/public/bill-detail.css">
<link rel="stylesheet" href="/public/savings-inventory.css">
<link rel="stylesheet" href="/public/running-build.css">
<link rel="stylesheet" href="/public/budget-surface.css">
<link rel="stylesheet" href="/public/budget-blend.css">
<link rel="stylesheet" href="/public/budget-gface.css">
<link rel="stylesheet" href="/public/budget-sheet-motion.css">
</head><body>
<main class="wrap">
<section id="capture-savings" aria-label="Savings capture"></section>
<section id="capture-bills" aria-label="Bills capture"></section>
</main>
<script src="/public/forecast.js"></script>
<script src="/public/plan.js"></script>
<script src="/public/savings-inventory.js"></script>
<script>
window.__capture = (() => {
  const AS_OF = '2026-10-05';
  const FEE_ID = 'travelvisa-annual-fee-2027';
  // The unit suite's unavailable fixture: no savingsFunding publication;
  // the period funding roster names the fee by its BARE item id, plus an
  // unrelated goal and an unrelated goal carrying the fee's label.
  const period = { id: 'period-1', timelineRole: 'current', start: '2026-10-02', end: '2026-10-15',
    rangeLabel: 'Oct 2 – Oct 15',
    plannedCostFunding: { status: 'ready', items: [
      { id: FEE_ID, label: 'Travel Visa annual fee' },
      { id: 'home-cost', label: 'Home insurance' },
      { id: 'other-annual-fee', label: 'Travel Visa annual fee' },
    ], unscheduled: [] },
    bills: [], creditPayments: [], minimumPayments: [], income: [],
    needNow: null, needNowResidual: null, planSpend: null };
  const src = { plan: {}, debts: [], asOf: AS_OF,
    advice: { savingsFunding: null, payPeriodViews: [period], savingsInventory: null } };
  const savingsHtml = budgetSavingsGoalsHtml(src, period, null);
  const billsHtml = budgetBillsSectionHtml(period, { plan: {}, debts: [], asOf: AS_OF,
    advice: { savingsFunding: null, payPeriodViews: [period],
      savingsSchedule: { status: 'unavailable', source: 'Forecast.planSpendPaydayFunding' } } });
  document.getElementById('capture-savings').innerHTML = savingsHtml;
  document.getElementById('capture-bills').innerHTML = billsHtml;
  return { savingsHtml, billsHtml };
})();
</script>
</body></html>`;

async function main() {
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/capture') {
      res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); return;
    }
    if (req.url.startsWith('/public/')) {
      const file = path.join(REPO, req.url);
      if (!file.startsWith(REPO) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
      const type = file.endsWith('.css') ? 'text/css' : 'text/javascript';
      res.writeHead(200, { 'content-type': type }); res.end(fs.readFileSync(file)); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const exe = process.env.CAPTURE_CHROMIUM || '/home/hatch/.cache/ms-playwright/chromium-1193/chrome-linux/chrome';
  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/capture`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__capture && document.querySelector('[data-budget-savings-annual-bill-note]'));

  const measured = await page.evaluate((NEUTRAL) => {
    const vis = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      let chainVisible = true, n = el;
      while (n) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') { chainVisible = false; break; } n = n.parentElement; }
      return { display: cs.display, visibility: cs.visibility, chainVisible,
        width: Math.round(r.width), height: Math.round(r.height),
        text: el.innerText || el.textContent };
    };
    const note = document.querySelector('#capture-savings [data-budget-savings-annual-bill-note]');
    const goals = [...document.querySelectorAll('#capture-savings [data-budget-savings-goal]')]
      .map(el => el.getAttribute('data-budget-savings-goal'));
    const card = document.querySelector('#capture-savings .tile, #capture-savings section, #capture-savings > *');
    return {
      feeGoalBare: document.querySelectorAll('#capture-savings [data-budget-savings-goal="travelvisa-annual-fee-2027"]').length,
      feeGoalPrefixed: document.querySelectorAll('#capture-savings [data-budget-savings-goal="yearly-bill:travelvisa-annual-fee-2027"]').length,
      goals,
      noteCount: document.querySelectorAll('#capture-savings [data-budget-savings-annual-bill-note]').length,
      note: vis(note),
      noteExactText: note ? note.textContent === NEUTRAL : false,
      cardText: card ? card.innerText : '',
      billsUpcomingBucket: document.querySelectorAll('#capture-bills [data-budget-bill-bucket="upcoming"]').length,
      billsFeeEntry: document.querySelectorAll('#capture-bills [data-budget-annual-bill="travelvisa-annual-fee-2027"]').length,
      savingsHtml: window.__capture.savingsHtml,
      billsHtml: window.__capture.billsHtml,
    };
  }, NEUTRAL);

  const savingsEl = await page.$('#capture-savings');
  await savingsEl.screenshot({ path: path.join(OUT, 'unavailable-savings.png') });
  const billsEl = await page.$('#capture-bills');
  await billsEl.screenshot({ path: path.join(OUT, 'unavailable-bills.png') });
  await page.screenshot({ path: path.join(OUT, 'unavailable-full.png'), fullPage: true });
  await browser.close();
  server.close();

  const checks = {
    feeAbsentBare: measured.feeGoalBare === 0,
    feeAbsentPrefixed: measured.feeGoalPrefixed === 0,
    unrelatedGoalsPreserved: measured.goals.includes('home-cost') && measured.goals.includes('other-annual-fee'),
    notePresent: measured.noteCount >= 1,
    noteExactText: measured.noteExactText,
    noteVisible: !!(measured.note && measured.note.chainVisible && measured.note.width > 0 && measured.note.height > 0),
    billsNoUpcomingBucket: measured.billsUpcomingBucket === 0,
    billsNoFeeEntry: measured.billsFeeEntry === 0,
    noPageErrors: errors.length === 0,
  };
  const result = { kind: 'renderer-level unavailable-state capture', repo: REPO,
    fixture: 'unavailable publication + bare-id roster fallback (unit-suite fixture)',
    checks, measured: { ...measured, savingsHtml: undefined, billsHtml: undefined },
    renderedSavingsText: measured.cardText, pageErrors: errors };
  fs.writeFileSync(path.join(OUT, 'capture.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(OUT, 'unavailable-savings.html'), measured.savingsHtml);
  fs.writeFileSync(path.join(OUT, 'unavailable-bills.html'), measured.billsHtml);
  console.log(JSON.stringify(checks, null, 2));
  if (Object.values(checks).some(v => !v)) { console.error('CAPTURE CHECKS FAILED'); process.exit(1); }
  console.log('CAPTURE OK');
}
main().catch(e => { console.error(e); process.exit(1); });
