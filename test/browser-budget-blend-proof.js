'use strict';
// Fixture-only browser proof for the Budget bento skin.
// No live site, no provider, no new money arithmetic.
// CHROME_PATH=<Chromium> node test/browser-budget-blend-proof.js
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const fx = require('./fixtures/budget-surface-data');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'docs/proof');
fs.mkdirSync(outDir, { recursive: true });

const parseRgb = value => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(value || '');
  if (!m) return null;
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a: m[4] == null ? 1 : Number(m[4]) };
};
const lin = c => c.map(v => {
  const x = v / 255;
  return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
});
const lum = rgb => {
  const [r, g, b] = lin(rgb);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (fg, bg) => {
  const a = lum(fg), b = lum(bg);
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
};
const composite = (fg, bg) => {
  const a = fg.a == null ? 1 : fg.a;
  return fg.rgb.map((v, i) => Math.round(v * a + bg[i] * (1 - a)));
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  const shots = [];
  const external = [];
  const errors = [];
  const contrasts = [];
  const focusWalks = [];
  try {
    const open = async (width, theme, options) => {
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        colorScheme: theme,
        reducedMotion: (options && options.reducedMotion) || 'no-preference',
      });
      await page.addInitScript(chosen => {
        try { localStorage.setItem('hfd-theme', chosen); } catch (e) {}
      }, theme);
      let data = options && options.data ? options.data : fx.served(options || {});
      page.on('pageerror', err => errors.push(`${width}/${theme}: ${err.message}`));
      await page.route('**/*', route => {
        const u = new URL(route.request().url());
        if (u.origin !== 'http://budget.test') {
          external.push(u.origin);
          return route.abort();
        }
        if (u.pathname === '/data.json') return route.fulfill({ json: data });
        if (['/periods.json', '/balance-history.json', '/running-build.json'].includes(u.pathname)) {
          return route.fulfill({ json: null });
        }
        const file = path.join(root, 'public', u.pathname === '/' ? 'index.html' : u.pathname.slice(1));
        if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
        const type = file.endsWith('.css') ? 'text/css'
          : file.endsWith('.js') ? 'application/javascript'
          : file.endsWith('.png') ? 'image/png' : 'text/html';
        return route.fulfill({ body: fs.readFileSync(file), contentType: type });
      });
      await page.goto('http://budget.test/');
      await page.locator('[data-budget-surface]').waitFor();
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      return page;
    };

    const sampleContrast = async (page, selector, name) => {
      const row = await page.evaluate(({ selector, name }) => {
        const el = document.querySelector(selector);
        if (!el) return { name, missing: true };
        const fg = getComputedStyle(el).color;
        let node = el;
        let bg = 'rgba(0, 0, 0, 0)';
        const layers = [];
        while (node && node !== document.documentElement.parentElement) {
          const paint = getComputedStyle(node).backgroundColor;
          layers.push(paint);
          node = node.parentElement;
        }
        const size = parseFloat(getComputedStyle(el).fontSize) || 16;
        const weight = parseInt(getComputedStyle(el).fontWeight, 10) || 400;
        return { name, fg, layers, size, weight, text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 80) };
      }, { selector, name });
      if (row.missing) {
        contrasts.push(row);
        return;
      }
      let bg = [236, 238, 242];
      for (const layer of [...row.layers].reverse()) {
        const parsed = parseRgb(layer);
        if (!parsed || parsed.a === 0) continue;
        bg = parsed.a >= 0.99 ? parsed.rgb : composite(parsed, bg);
      }
      const fg = parseRgb(row.fg);
      const value = fg ? ratio(fg.rgb, bg) : 0;
      const large = row.size >= 24 || (row.size >= 18.66 && row.weight >= 700);
      contrasts.push({
        name, ratio: Math.round(value * 100) / 100, large, pass: value >= (large ? 3 : 4.5),
        text: row.text, fg: row.fg, bg,
      });
    };

    for (const width of [1440, 390, 320]) {
      for (const theme of ['light', 'dark']) {
        const page = await open(width, theme);
        const facts = await page.evaluate(() => {
          const text = sel => (document.querySelector(sel)?.innerText || '').replace(/\s+/g, ' ');
          const tracks = [...document.querySelectorAll('[data-calendar-waterfall] .budget-waterfall-track')]
            .filter(row => getComputedStyle(row).display !== 'none');
          const escaped = [...document.querySelectorAll('.budget-step-summary,.budget-category-row,.budget-bill-row')]
            .flatMap(row => [...row.children].filter(el => {
              const a = el.getBoundingClientRect(), b = row.getBoundingClientRect();
              return a.width && (a.left < b.left - 1 || a.right > b.right + 1 || el.scrollWidth > el.clientWidth + 1);
            }).map(el => el.className));
          return {
            surface: document.querySelector('[data-budget-surface]')?.getAttribute('data-budget-surface'),
            theme: document.documentElement.getAttribute('data-theme'),
            cards: document.querySelectorAll('.budget-surface-grid > .budget-surface-card').length,
            today: getComputedStyle(document.querySelector('.budget-surface-today')).position,
            scroll: document.documentElement.scrollWidth <= innerWidth,
            tracks: tracks.length,
            escaped,
            hero: text('[data-budget-period-result]'),
            income: text('[data-operating-question="02"] > details > summary'),
            bills: text('[data-operating-question="04"] > details > summary'),
            after: (document.querySelector('[data-operating-question="05"] > details > summary')?.textContent || '').replace(/\s+/g, ' '),
            house: text('[data-operating-question="06"] > details > summary'),
            save: text('[data-operating-question="savings"] > details > summary'),
            closing: text('[data-bills-closing]'),
            progress: text('[data-budget-window-progress]'),
            cash: text('[data-budget-cash-hero]'),
            motion: matchMedia('(prefers-reduced-motion: reduce)').matches,
          };
        });
        if (facts.cards !== 1 || facts.today !== 'static' || !facts.scroll || facts.tracks !== 0 || facts.escaped.length) {
          errors.push(`${width}/${theme} geometry ${JSON.stringify({ cards: facts.cards, today: facts.today, scroll: facts.scroll, tracks: facts.tracks, escaped: facts.escaped.slice(0, 4) })}`);
        }
        for (const [key, needle] of [
          ['hero', 'Balance After Deductions'],
          ['income', 'Income'],
          ['bills', 'Bills'],
          ['after', 'Balance after bills'],
          ['house', 'Household budget'],
          ['save', 'Planned Savings'],
          ['closing', 'Expected Bills balance at period end'],
          ['progress', 'Day 7'],
        ]) {
          if (!facts[key] || !facts[key].includes(needle)) errors.push(`${width}/${theme} missing ${key} ${needle}`);
        }
        const file = `budget-blend-${width}-${theme}.png`;
        await page.screenshot({ path: path.join(outDir, file), fullPage: true, animations: 'disabled' });
        shots.push(file);
        if (width === 1440) {
          for (const [sel, name] of [
            ['[data-budget-window-range]', `${theme} period range`],
            ['[data-budget-window-progress] p span:last-child', `${theme} payday line`],
            ['[data-budget-window-progress] p span:first-child', `${theme} day count`],
            ['[data-bills-closing] h2', `${theme} closing label`],
            ['[data-operating-question="07"] .operating-prompt', `${theme} result label`],
            ['[data-operating-question="02"] .operating-prompt', `${theme} income label`],
            ['#budget-spending-heading', `${theme} household heading`],
            ['[data-budget-savings-goals] h3', `${theme} goals heading`],
          ]) await sampleContrast(page, sel, name);
        }
        await page.close();
      }
    }

    const unavailable = await open(1440, 'light', { unavailablePlan: true });
    const unavailableDark = await open(390, 'dark', { unavailablePlan: true });
    for (const [page, file, theme] of [
      [unavailable, 'budget-blend-1440-light-unavailable.png', 'light'],
      [unavailableDark, 'budget-blend-390-dark-unavailable.png', 'dark'],
    ]) {
      const text = await page.locator('[data-budget-surface="unavailable"]').innerText();
      if (!/unavailable/i.test(text)) errors.push(`${file} hid the fail-closed wording`);
      await page.screenshot({ path: path.join(outDir, file), fullPage: true, animations: 'disabled' });
      shots.push(file);
      await sampleContrast(page, '[data-budget-surface="unavailable"] h2, [data-budget-surface="unavailable"] .operating-lead, [data-budget-surface="unavailable"] p', `${theme} unavailable copy`);
    }

    const focusPage = await open(1440, 'light');
    const walk = [];
    for (let i = 0; i < 18; i++) {
      await focusPage.keyboard.press('Tab');
      const step = await focusPage.evaluate(() => {
        const el = document.activeElement;
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          label: el.getAttribute('aria-label') || '',
          text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90),
          outlineStyle: s.outlineStyle,
          outlineWidth: s.outlineWidth,
          outlineColor: s.outlineColor,
          box: [Math.round(r.width), Math.round(r.height)],
        };
      });
      step.pass = step.outlineStyle !== 'none' && parseFloat(step.outlineWidth) >= 2 && step.box[0] > 0;
      walk.push(step);
      if (!step.pass) errors.push(`focus step ${i + 1} not visible: ${JSON.stringify(step)}`);
    }
    focusWalks.push({ viewport: 1440, theme: 'light', steps: walk });
    const focusTargets = [
      ['[data-budget-granularity="month"]', 'budget-blend-focus-granularity.png'],
      ['[data-operating-question="02"] > details > summary', 'budget-blend-focus-income.png'],
      ['[data-operating-question="07"] > details > summary', 'budget-blend-focus-result.png'],
      ['[data-budget-category-open="groceries"]', 'budget-blend-focus-household.png'],
      ['[data-budget-goal-open]', 'budget-blend-focus-goal.png'],
    ];
    for (const [sel, file] of focusTargets) {
      const loc = focusPage.locator(sel).first();
      if (await loc.count()) {
        await loc.focus();
        await loc.scrollIntoViewIfNeeded();
        await focusPage.screenshot({ path: path.join(outDir, file), fullPage: false, animations: 'disabled' });
        shots.push(file);
      } else errors.push(`missing focus target ${sel}`);
    }
    await focusPage.close();
    await unavailable.close();
    await unavailableDark.close();

    const cards = require('./fixtures/card-period-movements-data');
    for (const [width, theme, file] of [
      [1440, 'light', 'budget-blend-cards-1440-light.png'],
      [320, 'dark', 'budget-blend-cards-320-dark.png'],
    ]) {
      const page = await open(width, theme, { data: cards.served() });
      const placement = await page.evaluate(() => {
        const strip = document.querySelector('[data-budget-card-movements]');
        const tile = strip && strip.closest('.budget-blend-card-movements');
        const grid = document.querySelector('.budget-surface-grid');
        const browse = document.querySelector('.budget-browse-grid');
        const style = strip ? getComputedStyle(strip) : null;
        return {
          tile: !!tile,
          after: !!(grid && strip && (grid.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING)),
          before: !!(browse && strip && (strip.compareDocumentPosition(browse) & Node.DOCUMENT_POSITION_FOLLOWING)),
          border: style && style.borderTopWidth,
          background: style && style.backgroundColor,
          label: strip ? strip.getAttribute('aria-label') : '',
        };
      });
      if (!placement.tile || !placement.after || !placement.before
        || placement.border !== '0px' || placement.background !== 'rgba(0, 0, 0, 0)'
        || placement.label !== 'Card movement in selected pay period') {
        errors.push(`card tile ${file} ${JSON.stringify(placement)}`);
      }
      await page.screenshot({ path: path.join(outDir, file), fullPage: true, animations: 'disabled' });
      shots.push(file);
      await page.close();
    }

    const failedContrast = contrasts.filter(row => row.pass === false || row.missing);
    if (failedContrast.length) errors.push(`contrast ${JSON.stringify(failedContrast)}`);
    if (external.length) errors.push(`external requests ${external.join(',')}`);

    const receipt = {
      proof: 'budget-blend-visual',
      fixture: 'test/fixtures/budget-surface-data.js',
      cardMovementFixture: 'test/fixtures/card-period-movements-data.js',
      liveSite: false,
      chrome: process.env.CHROME_PATH || null,
      reducedMotion: false,
      screenshots: shots,
      contrasts,
      focusWalk: focusWalks[0],
      externalRequests: external,
      errors,
      figuresCopiedFromPrototype: false,
    };
    fs.writeFileSync(path.join(outDir, 'budget-blend-browser-receipt.json'), JSON.stringify(receipt, null, 2));
    if (errors.length) {
      console.error(errors.join('\n'));
      process.exit(1);
    }
    console.log(`PASS budget blend proof: ${shots.length} screenshots, ${contrasts.length} contrast samples, ${walk.length} tab stops`);
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
