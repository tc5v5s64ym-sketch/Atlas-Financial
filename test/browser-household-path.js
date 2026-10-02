'use strict';
// Optional real-browser companion to test-household-path.js. Reuses #473's
// authenticated server and #471's native disclosure/navigation interaction.
// NODE_PATH=<Playwright packages> CHROME_PATH=<Chromium> node test/browser-household-path.js
// Expected DOM cents come only from household-path-data's supplied ledger.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { withServer } = require('./test-savings-evidence-integration');
const { fixture, variant, ledger } = require('./fixtures/household-path-data');
const shots = process.env.ATLAS_HOUSEHOLD_SCREENSHOTS || path.join(os.tmpdir(), 'atlas-household-path');
const money = n => '$' + n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function session(server, width, steps, extras = true) {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  const errors = [], external = [], writes = [];
  let page;
  try {
    const context = await browser.newContext({ viewport: { width, height: 900 },
      isMobile: width < 400, hasTouch: width < 400, reducedMotion: 'reduce',
      colorScheme: width === 320 ? 'dark' : 'light' });
    const split = server.cookie.indexOf('=');
    await context.addCookies([{ name: server.cookie.slice(0, split), value: server.cookie.slice(split + 1),
      url: server.base, httpOnly: true, sameSite: 'Lax' }]);
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin !== server.base) {
        external.push(route.request().url()); return route.abort();
      }
      if (route.request().method() !== 'GET') writes.push(route.request().method());
      return route.continue();
    });
    page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const tap = locator => width < 400 ? locator.tap() : locator.click();
    const root = () => page.locator('[data-pay-period-swipe]');
    const proposal = () => root().locator('[data-from-today-proposal]');
    const waterfall = () => root().locator('[data-calendar-waterfall]');
    const open = async details => {
      if (!(await details.evaluate(el => el.open))) await tap(details.locator(':scope > summary'));
    };
    const load = async input => {
      server.write(input);
      if (page.url().startsWith(server.base)) await page.reload(); else await page.goto(server.base);
      await proposal().waitFor();
      await page.waitForFunction(() => !!document.querySelector('[data-pay-period-swipe] [data-atlas-bill-row]'));
    };
    async function check(e) {
      assert.equal(await page.evaluate(() => App.data.liveOverlay.applied), true);
      assert.equal(await page.evaluate(() => App.data.meta.asOf), e.date);
      assert.equal(await page.locator('[data-live-current-balance-amount]').first().innerText(), money(e.a),
        'Current Balance is Bills-only; From today uses both chequing accounts');
      for (const [key, value] of [['02', 1000], ['04', 120], ['05', 880], ['06', e.budgetHold], ['07', e.periodResult]]) {
        const step = waterfall().locator(`[data-operating-question="${key}"]`);
        assert.equal(await step.locator(':scope > details > summary .budget-step-value').innerText(), money(value), key);
        await open(step.locator(':scope > details'));
      }
      const income = waterfall().locator('[data-period-income="payroll"]');
      assert.equal(await income.count(), 1);
      assert.equal(await income.getAttribute('data-income-status'), 'received');
      const bill = waterfall().locator('[data-period-bill="shaw"]');
      assert.equal(await bill.getAttribute('data-bill-status'), e.billPaid ? 'PAID' : 'still due');
      await open(bill.locator('..'));
      const evidence = await bill.locator('..').locator('.bill-detail-body').innerText();
      if (e.billPaid) {
        assert.match(evidence, /2026-08-16/); assert.match(evidence, /\$120\.00 \(debit\)/);
        assert.match(evidence, /Synthetic Bills/); assert.match(evidence, /Posted/);
      } else assert.match(evidence, /Transaction evidence is unavailable/);
      assert.doesNotMatch(evidence, /9100|providerTransactionId|Shaw Cable synthetic/);
      for (const [id, planned, spent] of [['groceries', 300, e.groceries], ['restaurants', 100, e.dining]]) {
        const category = waterfall().locator(`[data-budget-category="${id}"]`);
        const metrics = await category.locator('.household-budget-metric').allTextContents();
        assert.ok(metrics.some(t => t.includes('Planned') && t.includes(money(planned))));
        assert.ok(metrics.some(t => t.includes('Remaining') && t.includes(money(planned - spent))));
        const detail = category.locator('[data-budget-spent]');
        if (spent) {
          assert.equal(await detail.locator(':scope > summary .household-budget-spent-amount').innerText(), money(spent));
          await open(detail);
          assert.equal(await detail.locator('[data-budget-spent-total]').innerText(), money(spent));
          const amounts = await detail.locator('.household-budget-tx-amount').allTextContents();
          const cents = amounts.map(s => Math.round(Number(s.replace(/[^\d.-]/g, '')) * 100));
          assert.equal(cents.reduce((a, b) => a + b, 0), spent * 100, 'visible expanded rows sum to supplied ledger');
          if (id === 'groceries') assert.equal(amounts.length,
            e.key === 'purchases' || e.key === 'settlement' || e.key === 'refund-transfer' ? 2 : 3);
          assert.doesNotMatch(await detail.innerText(), /REFUND|TFR-|Shaw Cable/);
        } else assert.ok(metrics.some(t => t.includes('Spent') && t.includes('$0.00')));
      }
      assert.equal(await waterfall().locator('[data-household-budget-total-amount]').innerText(), money(e.budgetHold));
      if (e.other) {
        const other = waterfall().locator('[data-other-spending]');
        await open(other.locator('[data-budget-spent]'));
        assert.equal(await other.locator('[data-budget-spent-total]').innerText(), '$35.00');
        assert.equal(await other.locator('.household-budget-tx-amount').count(), 1);
      }
      assert.equal(await proposal().locator(':scope > details > summary .budget-step-value').innerText(), e.hold ? 'Unavailable' : '$420.00');
      await open(proposal().locator(':scope > details'));
      const text = await proposal().innerText();
      if (e.hold) {
        assert.equal(await proposal().locator('[data-savings-evidence-reason="pending-possible-replacement"]').count(), 1);
        assert.match(text, /one purchase or two/); assert.match(text, /Synthetic card.*Groceries.*2026-08-20/s);
        assert.doesNotMatch(text, /\$/);
      } else {
        for (const [label, amount] of [['Current chequing cash', e.cash], ['Remaining bills and debt payments', e.operatingBills],
          ['Remaining household needs', e.remainingHousehold], ['Capacity for proposed funding now', e.availableNow],
          ['Proposed to set aside now', 420], ['Chequing left after this proposal', e.cash - 420]]) {
          const line = proposal().locator('.operating-line').filter({ has: page.locator('span').filter({ hasText: new RegExp('^' + label + '$') }) });
          assert.equal(await line.locator('span').last().innerText(), money(amount), label);
        }
        assert.match(text, /Actual saved and destination account: unknown/);
        const forward = proposal().locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Forward proposals through/ }) }).last();
        await open(forward);
        const next = proposal().locator('[data-from-today-period="2026-08-28"]');
        await open(next);
        assert.match(await next.innerText(), /\$480\.00 proposed/);
        assert.match(await next.innerText(), /\$900\.00 \/ \$900\.00/);
        assert.match(await next.innerText(), /Proposed funds still held after scheduled payments: \$0\.00/);
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), width + 'px overflow');
    }
    for (const e of steps) {
      await load(fixture(e.key)); await check(e);
      if (e.key === 'resolved' || e.hold) {
        await proposal().screenshot({ path: path.join(shots, `${e.key}-${width}.png`) });
        if (e.key === 'resolved') await waterfall().locator('[data-operating-question="06"]').screenshot({ path: path.join(shots, `spending-${width}.png`) });
      }
      console.log(`PASS browser ${width}px ${e.key}: ${e.sees}`);
    }
    if (extras) {
      const last = ledger[ledger.length - 1];
      // Same packet reload plus reordered observation: no carried UI state.
      const reordered = fixture('resolved');
      reordered.payload.transactions.reverse(); reordered.payload.accounts.reverse(); reordered.map.mappings.reverse();
      await load(reordered); await check(last);
      const move = async key => {
        await page.locator('[data-budget-wheel="period"] [aria-current="true"]').focus();
        await page.keyboard.press(key);
      };
      await move('ArrowRight');
      await page.waitForFunction(() => !document.querySelector('[data-pay-period-swipe] [data-from-today-proposal]'));
      await open(waterfall().locator('[data-operating-question="04"] > details'));
      const futureBill = waterfall().locator('[data-period-bill="shaw"]');
      assert.equal(await futureBill.getAttribute('data-bill-date'), '2026-08-30');
      await open(futureBill.locator('..'));
      assert.doesNotMatch(await futureBill.locator('..').innerText(), /Transaction date|2026-08-16/);
      await move('ArrowLeft'); await proposal().waitFor(); await check(last);
      // Actual Forecast route shows the remaining window, not Budget's full cycle.
      await tap(page.locator('a[data-nav="forecast"]'));
      await page.waitForURL('**/planning.html');
      await tap(page.locator('button[data-trajectory-funding-granularity="pay-period"]').first());
      const road = page.locator('[data-road-waterfall-granularity="pay-period"]');
      await road.waitFor();
      assert.match(await page.locator('[data-road-timeline-granularity="pay-period"]').innerText(), /Aug 21.*Aug 27.*remaining/s);
      assert.match(await road.locator('[data-planning-road-wf-row="income-total"]').innerText(), /\$0\.00/);
      await tap(page.locator('a[data-nav="budget"]')); await page.waitForURL(server.base + '/');
      await proposal().waitFor(); await check(last);
      for (const mode of ['missing', 'stale', 'floor']) {
        await load(variant(mode)); await open(proposal().locator(':scope > details'));
        const text = await proposal().innerText();
        if (mode === 'floor') {
          assert.match(text, /\$110\.00 short/); assert.match(text, /Proposed to set aside now\s+\$0\.00/);
          assert.doesNotMatch(text, /\$420\.00|\$480\.00/);
        } else {
          assert.doesNotMatch(text, /\$/);
          assert.match(text, mode === 'missing' ? /Synthetic Weekly/ : /Coverage supplied: 2026-08-13 through 2026-08-20/);
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      }
      await load(fixture('resolved')); await check(last);
    }
    assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(writes, []);
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(shots, `failure-${width}.png`), fullPage: true });
    console.error('Browser diagnostics:', JSON.stringify({ errors, external, writes,
      body: page ? (await page.locator('body').innerText()).slice(0, 1800) : '' }));
    throw error;
  } finally { await browser.close(); }
}
async function main() {
  fs.mkdirSync(shots, { recursive: true });
  await withServer(fixture(), async server => {
    for (const width of [1440, 390, 320]) await session(server, width, ledger);
  });
  await withServer(fixture('resolved'), server => session(server, 390, [ledger[ledger.length - 1]], false));
  console.log('PASS household browser: authenticated full path, supplied ledger, refresh, process/browser restart, reorder, navigation, 1440/390/320px; screenshots ' + shots);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
