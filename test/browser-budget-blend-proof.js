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
  let heroTerms = null;
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
            .filter(row => !row.closest('.blend-clip'))
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
            progress: (document.querySelector('[data-budget-window-progress]')?.getAttribute('aria-label')
              || document.querySelector('[data-budget-window-progress]')?.textContent || '').replace(/\s+/g, ' '),
            cash: text('[data-budget-cash-hero]'),
            motion: matchMedia('(prefers-reduced-motion: reduce)').matches,
            face: (() => {
              const hero = document.querySelector('.blend-hero');
              const hb = hero.getBoundingClientRect();
              const box = el => el ? el.getBoundingClientRect() : null;
              const overlaps = (a, b) => !!(a && b && a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1);
              const termKey = { '02': 'periodIncome', '04': 'assignedBills', '06': 'householdBudgetHold' };
              const terms = ['02', '04', '06'].map(id => {
                const prompt = document.querySelector(`[data-operating-question="${id}"] .operating-prompt`);
                const painted = document.querySelector(`[data-operating-question="${id}"] .blend-term`);
                const row = document.querySelector(`[data-bad-term="${termKey[id]}"]`);
                const pb = box(prompt), vb = box(painted);
                const style = painted ? getComputedStyle(painted) : null;
                return {
                  id,
                  label: (prompt?.textContent || '').trim(),
                  shown: (painted?.textContent || '').replace(/\s+/g, ' ').trim(),
                  printed: (row?.querySelector('[data-bad-term-value]')?.textContent || '').replace(/\s+/g, ' ').trim(),
                  trust: row?.getAttribute('data-bad-term-trust') || '',
                  hasAmount: !!row?.querySelector('[data-bad-term-amount]'),
                  chip: !!(painted && painted.nextElementSibling && painted.nextElementSibling.classList.contains('blend-est')),
                  hook: painted?.getAttribute('data-blend-term') || '',
                  font: style ? parseFloat(style.fontSize) : 0,
                  ink: style ? style.color : '',
                  clipped: !pb || pb.top < hb.top - 1 || pb.bottom > hb.bottom + 1 || prompt.scrollHeight > prompt.clientHeight + 2,
                  valueClipped: !vb || vb.top < hb.top - 1 || painted.scrollWidth > painted.clientWidth + 2,
                  wrap: style ? style.overflowWrap : '',
                  break: style ? style.wordBreak : '',
                  rects: painted ? painted.getClientRects().length : 0,
                };
              });
              const badRow = document.querySelector('[data-bad-term="balanceAfterDeductions"]');
              const badShown = document.querySelector('[data-blend-term="balanceAfterDeductions"]');
              const badBlock = document.querySelector('[data-bad-terms]');
              const heroText = (hero.innerText || '').replace(/\s+/g, ' ');
              const big = {
                shown: (badShown?.textContent || '').replace(/\s+/g, ' ').trim(),
                printed: (badRow?.querySelector('[data-bad-term-value]')?.textContent || '').replace(/\s+/g, ' ').trim(),
                chip: !!(badShown && badShown.nextElementSibling && badShown.nextElementSibling.classList.contains('blend-est')),
                cents: (badShown?.querySelector('.blend-cents')?.textContent || ''),
                prefix: badShown?.querySelector('.blend-term-prefix')?.textContent || '',
                parked: !!(badBlock && badBlock.closest('.blend-hero-panel-body')),
                hidden: !badBlock || badBlock.getBoundingClientRect().height < 2,
                longOnFace: /Assigned bills \(incl|greater of plan or spent|Forecast's published terms/.test(heroText),
              };
              const values = terms.map(row => {
                const painted = document.querySelector(`[data-operating-question="${row.id}"] .blend-term`);
                return painted.getBoundingClientRect();
              });
              const minuses = [...document.querySelectorAll('.blend-minus')].map(el => el.getBoundingClientRect());
              const between = minuses.length === 2 && minuses.every((m, i) => {
                const left = values[i], right = values[i + 1];
                const mid = (m.top + m.bottom) / 2;
                const num = (left.top + left.bottom) / 2;
                return m.left >= left.right - 8 && m.right <= right.left + 8 && Math.abs(mid - num) < 16 && m.height > 10;
              });
              const pill = box(document.querySelector('.budget-today-cash'));
              const house = box(document.querySelector('[data-operating-question="06"] .operating-prompt'));
              const result = document.querySelector('[data-operating-question="07"] .budget-step-summary');
              const lines = (result?.innerText || '').split(/\n/).map(line => line.trim()).filter(Boolean);
              const foot = [...document.querySelectorAll('.blend-hero-foot > *')].map(el => el.getAttribute('data-operating-question') || el.getAttribute('data-bills-closing') || el.className);
              const savingsPill = document.querySelector('.blend-hero-foot [data-operating-question="savings"], .blend-hero-foot [data-budget-savings-stock]');
              const savingsBox = box(savingsPill);
              const savingsStyle = savingsPill ? getComputedStyle(savingsPill) : null;
              const flags = [...document.querySelectorAll('.blend-flag')].map(el => (el.textContent || '').trim());
              const caption = document.querySelector('.blend-ring-l');
              const captionStyle = caption ? getComputedStyle(caption) : null;
              const payDate = document.querySelector('.blend-pay-date');
              const payFace = document.querySelector('.blend-pay-face');
              const incomeBig = document.querySelector('.blend-income .blend-big');
              const incomeEst = document.querySelector('.blend-income .blend-est');
              const oneLine = values.length === 3 && Math.max(...values.map(v => v.top)) - Math.min(...values.map(v => v.top)) < 4;
              const incomeValue = document.querySelector('[data-operating-question="02"] .budget-step-value');
              const incomeClone = incomeValue ? incomeValue.cloneNode(true) : null;
              incomeClone?.querySelectorAll('.blend-term').forEach(node => node.remove());
              const incomePrinted = (incomeClone?.textContent || '').replace(/\s+/g, ' ').trim();
              const incomeShown = (document.querySelector('.blend-income .blend-muted')?.textContent || '').replace(/\s+/g, ' ').trim();
              const pills = [...document.querySelectorAll('.blend-hero-foot > *')].filter(el => {
                const box = el.getBoundingClientRect();
                return getComputedStyle(el).display !== 'none' && box.height > 1 && box.width > 1;
              }).map(el => {
                const b = el.getBoundingClientRect();
                return {
                  id: el.getAttribute('data-operating-question') || (el.hasAttribute('data-bills-closing') ? 'closing' : 'pill'),
                  top: Math.round(b.top),
                  width: Math.round(b.width),
                  height: Math.round(b.height),
                  text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80),
                  inside: b.left >= hb.left - 1 && b.right <= hb.right + 1,
                  fits: el.scrollWidth <= el.clientWidth + 1,
                };
              });
              const footBox = document.querySelector('.blend-hero-foot')?.getBoundingClientRect();
              const billsHead = document.querySelector('.blend-bills-head');
              const billsTitle = billsHead && billsHead.querySelector('.blend-tile-title');
              const billsOf = billsHead && billsHead.querySelector('.blend-bills-of');
              const billsToggle = billsHead && billsHead.querySelector('.blend-panel-toggle');
              const titleBox = box(billsTitle);
              const ofBox = box(billsOf);
              const toggleBox = box(billsToggle);
              const bills = billsHead && titleBox && ofBox && toggleBox ? {
                oneLine: billsOf.scrollWidth <= billsOf.clientWidth + 1 && billsOf.getClientRects().length === 1,
                row: ofBox.top >= titleBox.bottom - 2 && Math.abs(titleBox.top - toggleBox.top) < 8,
                crowded: ofBox.top < titleBox.bottom - 2,
              } : null;
              const pillHeights = pills.length ? {
                spread: Math.max(...pills.map(row => row.height || 0)) - Math.min(...pills.map(row => row.height || 0)),
              } : null;
              const baselines = [...document.querySelectorAll('.blend-hero-foot > *')].filter(el => getComputedStyle(el).display !== 'none').map(el => {
                const label = el.querySelector('.operating-prompt, h2');
                const value = el.querySelector('.budget-step-value, .budget-bills-closing-value');
                const a = label && label.getClientRects()[0];
                const b = value && value.getClientRects()[0];
                return { delta: a && b ? Math.abs(a.bottom - b.bottom) : 0 };
              });
              const savedLines = [...document.querySelectorAll('.blend-goal-saved, .blend-goal-needed')].map(el => (el.textContent || '').trim());
              const otherName = document.querySelector('.blend-other-name');
              const otherState = document.querySelector('.blend-other-state');
              const otherStyle = otherName ? getComputedStyle(otherName) : null;
              const other = otherName ? {
                ellipsis: otherStyle.textOverflow === 'ellipsis' || (otherState && getComputedStyle(otherState).textOverflow === 'ellipsis'),
                nameLine: otherName.scrollWidth <= otherName.clientWidth + 1 && otherName.getClientRects().length === 1,
                stateBelow: !otherState || otherState.getBoundingClientRect().top >= otherName.getBoundingClientRect().bottom - 2,
              } : null;
              const qualifier = document.querySelector('.card-movement-qualifier');
              const qualifierStyle = qualifier ? getComputedStyle(qualifier) : null;
              const cardQualifier = qualifier ? {
                ellipsis: qualifierStyle.textOverflow === 'ellipsis' || qualifierStyle.whiteSpace === 'nowrap',
                clipped: qualifier.scrollWidth > qualifier.clientWidth + 1,
              } : null;
              return {
                terms, big, between,
                pillOverlapsHouse: overlaps(pill, house),
                strayLine: lines.some(line => /^[=—−\-]$/.test(line)),
                resultLine: lines.find(line => /Balance After Deductions/.test(line)) || '',
                foot,
                savingsPad: savingsStyle ? parseFloat(savingsStyle.paddingLeft) : 0,
                savingsInside: !!(savingsBox && savingsPill && savingsPill.scrollWidth <= savingsPill.clientWidth + 1),
                flags,
                captionWrap: captionStyle ? captionStyle.whiteSpace : '',
                captionEllipsis: captionStyle ? captionStyle.textOverflow : '',
                dateOverlapsRing: overlaps(box(payDate), box(payFace)),
                dateOneLine: !!(payDate && payDate.scrollWidth <= payDate.clientWidth + 1),
                estOverlapsIncome: overlaps(box(incomeBig), box(incomeEst)),
                oneLine,
                incomeShown,
                incomePrinted,
                pills,
                footWidth: footBox ? Math.round(footBox.width) : 0,
                bills,
                pillHeights,
                baselines,
                savedLines,
                other,
                cardQualifier,
              };
            })(),
            shown: ['[data-budget-browse-hold]',
              '.blend-income .blend-big',
              ...(document.querySelector('.card-movement-heading') ? ['.card-movement-heading .blend-card-posted'] : [])
            ].map(sel => {
              const el = document.querySelector(sel);
              if (!el) return sel + ':missing';
              const box = el.getBoundingClientRect();
              const style = getComputedStyle(el);
              const visible = box.width > 8 && box.height > 8 && style.visibility !== 'hidden'
                && style.display !== 'none' && style.position !== 'absolute';
              return visible ? '' : sel;
            }).filter(Boolean),
          };
        });
        if (facts.cards !== 1 || facts.today !== 'static' || !facts.scroll || facts.tracks !== 0 || facts.escaped.length || facts.shown.length) {
          errors.push(`${width}/${theme} geometry ${JSON.stringify({ cards: facts.cards, today: facts.today, scroll: facts.scroll, tracks: facts.tracks, escaped: facts.escaped.slice(0, 4), shown: facts.shown })}`);
        }
        if (width === 390) {
          const quiet = page.locator('.blend-quiet');
          if (await quiet.count()) {
            await quiet.scrollIntoViewIfNeeded();
            await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
          }
          const dock = await page.evaluate(() => {
            const nav = document.querySelector('.sitenav-household');
            const last = document.querySelector('.blend-quiet');
            if (!nav || !last) return { missing: true };
            const navTop = nav.getBoundingClientRect().top;
            const lastBottom = last.getBoundingClientRect().bottom;
            return { navTop, lastBottom, gap: navTop - lastBottom, scrollY: window.scrollY };
          });
          if (dock.missing || dock.scrollY < 1 || dock.gap < -1) errors.push(`${width}/${theme} dock covers content ${JSON.stringify(dock)}`);
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
        const face = facts.face || {};
        const minFont = width >= 1000 ? 20 : width <= 360 ? 13 : 15;
        (face.terms || []).forEach(term => {
                if (term.clipped || term.valueClipped || term.font < minFont || term.wrap !== 'normal' || term.break !== 'normal' || term.rects !== 1) {
            errors.push(`${width}/${theme} equation ${JSON.stringify(term)}`);
          }
        });
        if (width >= 1000 && !face.between) errors.push(`${width}/${theme} minus signs are not between the terms`);
        if (face.pillOverlapsHouse) errors.push(`${width}/${theme} Bills account pill overlaps Household budget`);
        if (face.strayLine || !/^=\s*Balance After Deductions/.test(face.resultLine || '')) {
          errors.push(`${width}/${theme} result label ${JSON.stringify(face.resultLine)} stray ${face.strayLine}`);
        }
        const hooks = { '02': 'periodIncome', '04': 'assignedBills', '06': 'householdBudgetHold' };
        (face.terms || []).forEach(term => {
          if (term.hook !== hooks[term.id] || term.shown !== term.printed || term.chip !== (term.hasAmount && term.trust === 'estimated')) {
            errors.push(`${width}/${theme} term slot ${JSON.stringify(term)}`);
          }
        });
        const big = face.big || {};
        if (big.shown !== big.printed || big.chip || !big.parked || !big.hidden || big.longOnFace) {
          errors.push(`${width}/${theme} bad number ${JSON.stringify(big)}`);
        }
        if (big.printed && big.printed !== 'Unavailable' && /\$[\d,]+\.\d{2}/.test(big.printed) && !big.cents) {
          errors.push(`${width}/${theme} cents were not split from the displayed string ${JSON.stringify(big)}`);
        }
        if (width === 1440 && theme === 'light') heroTerms = face.terms.map(term => term.shown).concat(big.shown);
        if ((face.terms || []).find(term => term.id === '06')?.label !== 'Household budget') {
          errors.push(`${width}/${theme} household label ${JSON.stringify(face.terms)}`);
        }
        if (width >= 1000 && !face.oneLine) errors.push(`${width}/${theme} equation is not one line`);
        if (face.foot?.[0] !== '05' || !/closing/.test(String(face.foot?.[1] || '')) || !/savings/.test(String(face.foot?.[2] || ''))) {
          errors.push(`${width}/${theme} pill order ${JSON.stringify(face.foot)}`);
        }
        if (face.savingsPad < 8 || !face.savingsInside) {
          errors.push(`${width}/${theme} savings pill pad ${face.savingsPad} inside ${face.savingsInside}`);
        }
        if (face.incomeShown !== face.incomePrinted) {
          errors.push(`${width}/${theme} income line ${JSON.stringify(face.incomeShown)} printed ${JSON.stringify(face.incomePrinted)}`);
        }
        const overflow = (face.pills || []).filter(pill => !pill.inside || !pill.fits);
        if (overflow.length) errors.push(`${width}/${theme} pill overflow ${JSON.stringify({ foot: face.footWidth, pills: face.pills })}`);
        if (width >= 1000) {
          const tops = (face.pills || []).map(pill => pill.top);
          const oneRow = tops.length > 1 && Math.max(...tops) - Math.min(...tops) < 4;
          if (!oneRow) errors.push(`${width}/${theme} pills not one line ${JSON.stringify({ foot: face.footWidth, pills: face.pills })}`);
        }
        if ((face.flags || []).some(flag => /^(To confirm|Overdue) 0$/.test(flag))) {
          errors.push(`${width}/${theme} zero pill ${JSON.stringify(face.flags)}`);
        }
        if (face.captionWrap === 'nowrap' || face.captionEllipsis === 'ellipsis') {
          errors.push(`${width}/${theme} caption ${face.captionWrap} ${face.captionEllipsis}`);
        }
        if (width <= 390 && (face.dateOverlapsRing || !face.dateOneLine || face.estOverlapsIncome)) {
          errors.push(`${width}/${theme} overlap date ${face.dateOverlapsRing} line ${face.dateOneLine} est ${face.estOverlapsIncome}`);
        }
        if (width <= 480 && face.bills && (!face.bills.oneLine || !face.bills.row || face.bills.crowded)) {
          errors.push(`${width}/${theme} bills head ${JSON.stringify(face.bills)}`);
        }
        if (width <= 390 && face.pillHeights && face.pillHeights.spread > 14) {
          errors.push(`${width}/${theme} pill heights ${JSON.stringify(face.pillHeights)}`);
        }
        if (width >= 1000 && face.baselines && face.baselines.some(row => row.delta > 3)) {
          errors.push(`${width}/${theme} pill baseline ${JSON.stringify(face.baselines)}`);
        }
        if ((face.savedLines || []).some(line => /Saved Unavailable/.test(line))) {
          errors.push(`${width}/${theme} saved unavailable ${JSON.stringify(face.savedLines)}`);
        }
        if (width <= 390 && face.other && (face.other.ellipsis || !face.other.nameLine || !face.other.stateBelow)) {
          errors.push(`${width}/${theme} other row ${JSON.stringify(face.other)}`);
        }
        if (width <= 390 && face.cardQualifier && (face.cardQualifier.ellipsis || face.cardQualifier.clipped)) {
          errors.push(`${width}/${theme} card subtitle ${JSON.stringify(face.cardQualifier)}`);
        }
        const layout = await page.evaluate(() => {
          const box = el => el ? el.getBoundingClientRect() : null;
          const hits = (a, b) => !!(a && b && a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1);
          const centsEl = document.querySelector('.blend-cents');
          const estEl = document.querySelector('[data-operating-question="07"] .budget-step-value > .blend-est');
          const cents = box(centsEl);
          const est = box(estEl);
          const top = box(document.querySelector('.blend-hero-top'));
          const cash = document.querySelector('.blend-hero-top .budget-today-cash');
          const cashBox = box(cash);
          const cashShown = !!(cash && getComputedStyle(cash).display !== 'none' && cashBox && cashBox.width > 8);
          const income = box(document.querySelector('.blend-income'));
          const pay = box(document.querySelector('.blend-pay'));
          const meta = document.querySelector('.blend-income-in');
          const metaBox = box(meta);
          const deps = [...document.querySelectorAll('.blend-dep')].map(box);
          let depOverlap = false;
          for (let i = 0; i < deps.length; i++) {
            for (let j = i + 1; j < deps.length; j++) if (hits(deps[i], deps[j])) depOverlap = true;
          }
          const rings = [...document.querySelectorAll('[data-budget-browse="spending"] .blend-ring')].slice(0, 3).map(box);
          const ringTops = rings.map(row => row.top);
          const cardHead = document.querySelector('.card-movement-heading');
          const cardIcon = box(cardHead && cardHead.querySelector('.blend-tile-ico'));
          const cardTitle = box(cardHead && cardHead.querySelector('h2'));
          const houseHead = document.querySelector('[data-budget-browse="spending"] > header');
          const houseIcon = box(houseHead && houseHead.querySelector('.blend-tile-ico'));
          const houseTitle = box(houseHead && houseHead.querySelector('h2'));
          const paired = (icon, title) => !!(icon && title && title.left >= icon.left && title.left - icon.right < 24 && Math.abs(title.top - icon.top) < 24);
          return {
            estChip: !!(estEl && !estEl.closest('.blend-clip') && getComputedStyle(estEl).display !== 'none' && est && est.width > 8),
            estBeside: !!(cents && est && estEl && !estEl.closest('.blend-clip') && est.left >= cents.right - 2 && est.left - cents.right < 40 && Math.abs(est.top - cents.top) < 28),
            pillRight: !!(cashShown && top && top.right - cashBox.right < 24 && cashBox.top >= top.top - 2 && cashBox.bottom <= top.bottom + 2),
            incomeInside: !(metaBox && income) || (metaBox.right <= income.right + 1 && metaBox.left >= income.left - 1 && metaBox.bottom <= income.bottom + 1),
            stacked: !!(income && pay && income.bottom <= pay.top + 6 && Math.abs(income.left - pay.left) < 12),
            separate: !hits(income, pay),
            depOverlap,
            ringsAcross: rings.length < 3 || Math.max(...ringTops) - Math.min(...ringTops) < 12,
            cardPair: paired(cardIcon, cardTitle),
            housePair: paired(houseIcon, houseTitle),
            ringInside: (() => {
              const ring = document.querySelector('.blend-pay-ring');
              const tile = document.querySelector('.blend-pay');
              if (!ring || !tile) return false;
              const a = ring.getBoundingClientRect();
              const b = tile.getBoundingClientRect();
              return a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
            })(),
          };
        });
        if (layout.estChip && !layout.estBeside) errors.push(`${width}/${theme} est chip is not beside the cents`);
        if (!layout.pillRight) errors.push(`${width}/${theme} Bills account pill is not at the right of the hero top`);
        if (!layout.incomeInside) errors.push(`${width}/${theme} received amount leaves the Income tile`);
        if (!layout.separate || layout.depOverlap) errors.push(`${width}/${theme} income track overlap ${JSON.stringify(layout)}`);
        if (width <= 480 && !layout.stacked) errors.push(`${width}/${theme} income and payday are not stacked`);
        if (width <= 360 && !layout.ringsAcross) errors.push(`${width}/${theme} household rings are not one row`);
        if (!layout.cardPair || !layout.housePair) errors.push(`${width}/${theme} header alignment ${JSON.stringify(layout)}`);
        if (width >= 1000 && !layout.ringInside) errors.push(`${width}/${theme} payday ring leaves the tile`);
        if (width === 1440 && theme === 'dark') {
          const toggle = await page.evaluate(() => {
            const buttons = [...document.querySelectorAll('.blend-toolbar .budget-granularity-btn')];
            return buttons.map(el => ({
              text: (el.textContent || '').trim(),
              pressed: el.getAttribute('aria-pressed'),
              bg: getComputedStyle(el).backgroundColor,
              fg: getComputedStyle(el).color,
            }));
          });
          const on = toggle.find(row => row.pressed === 'true');
          const off = toggle.find(row => row.pressed === 'false');
          if (!on || !off || on.text !== 'Pay period' || on.bg === off.bg || on.fg === off.fg) {
            errors.push(`dark toggle ${JSON.stringify(toggle)}`);
          }
        }
        if (width === 320) {
          await page.evaluate(() => {
            const section = document.querySelector('[data-budget-browse="spending"]');
            const row = [...section.querySelectorAll('.budget-category-row')]
              .find(item => item.getAttribute('data-budget-category-open') !== 'other-spending');
            row.classList.add('is-over');
            row.querySelector('.budget-category-status').textContent = '$295.14 over';
            const bento = document.querySelector('[data-budget-bento]');
            const panel = bento.querySelector('.blend-house-panel');
            const counts = panel && panel.querySelector('.budget-browse-counts');
            if (counts) section.appendChild(counts);
            bento.removeAttribute('data-blend-ready');
            bento.querySelector('[data-blend-rings]')?.remove();
            bento.querySelector('.blend-other')?.remove();
            panel?.remove();
            document.getElementById('operating-surface-body').appendChild(document.createTextNode(''));
          });
          await page.locator('.blend-over-pill').waitFor();
          const narrow = await page.evaluate(() => {
            const tiles = [...document.querySelectorAll('.blend-hero, .blend-income, .blend-pay, [data-budget-browse="bills"], [data-budget-browse="spending"], .budget-blend-card-movements, [data-budget-savings-goals]')];
            const bad = [];
            const skip = '.blend-clip, .budget-cash-sr, .blend-hero-panel-body, .blend-house-body, .blend-sky, svg, svg *';
            tiles.forEach(tile => {
              tile.querySelectorAll('*').forEach(el => {
                if (el.closest(skip) || el.matches('svg, svg *')) return;
                const style = getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') return;
                const box = el.getBoundingClientRect();
                if (box.width < 8 || box.height < 8) return;
                const own = [...el.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent).join('');
                const sample = (own || (el.children.length ? '' : el.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 70);
                const label = ((el.className && el.className.baseVal) || el.className || el.tagName || '').toString().slice(0, 80);
                if (/\$/.test(sample) && el.scrollWidth > el.clientWidth + 1) bad.push({ kind: 'scroll', label, sample, sw: el.scrollWidth, cw: el.clientWidth });
                if (/\$/.test(sample) && style.textOverflow === 'ellipsis') bad.push({ kind: 'ellipsis', label, sample });
              });
            });
            const pill = document.querySelector('.blend-over-pill');
            const state = document.querySelector('.blend-other-state');
            const plan = document.querySelector('.blend-other .blend-of-plan');
            const hits = (a, b) => !!(a && b && a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1);
            return {
              bad: bad.slice(0, 6),
              pill: (pill?.textContent || '').replace(/\s+/g, ' ').trim(),
              pillEllipsis: pill ? getComputedStyle(pill).textOverflow : '',
              otherOverlap: hits(state && state.getBoundingClientRect(), plan && plan.getBoundingClientRect()),
            };
          });
          if (narrow.bad.length || narrow.pill !== '$295.14 over' || narrow.pillEllipsis === 'ellipsis' || narrow.otherOverlap) {
            errors.push(`${width}/${theme} narrow overflow ${JSON.stringify(narrow)}`);
          }
        }
        const file = `budget-blend-${width}-${theme}.png`;
        await page.screenshot({ path: path.join(outDir, file), fullPage: true, animations: 'disabled' });
        shots.push(file);
        if (width === 1440) {
          for (const [sel, name] of [
            ['[data-budget-window-range]', `${theme} period range`],
            ['[data-budget-window-progress] .blend-pay-date', `${theme} payday date`],
            ['[data-budget-window-progress] .blend-pay-num', `${theme} day count`],
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

    const house = await open(1440, 'light');
    const prepared = await house.evaluate(() => {
      const section = document.querySelector('[data-budget-browse="spending"]');
      const rows = [...section.querySelectorAll('.budget-category-row')]
        .filter(row => row.getAttribute('data-budget-category-open') !== 'other-spending');
      const sample = rows.slice(0, 2);
      const marked = ['$80.00 over', '$12.00 over'];
      sample.forEach((row, index) => {
        row.classList.add('is-over');
        row.querySelector('.budget-category-status').textContent = marked[index];
      });
      const printed = (section.querySelector('.budget-browse-counts')?.textContent || '').replace(/\s+/g, ' ').trim();
      const hold = (section.querySelector('[data-budget-browse-hold]')?.textContent || '').replace(/\s+/g, ' ').trim();
      const bento = document.querySelector('[data-budget-bento]');
      const panel = bento.querySelector('.blend-house-panel');
      const counts = panel && panel.querySelector('.budget-browse-counts');
      if (counts) section.appendChild(counts);
      bento.removeAttribute('data-blend-ready');
      bento.querySelector('[data-blend-rings]')?.remove();
      bento.querySelector('.blend-other')?.remove();
      panel?.remove();
      document.getElementById('operating-surface-body').appendChild(document.createTextNode(''));
      return { printed, hold, marked: sample.map((_, index) => marked[index]) };
    });
    await house.locator('.blend-house-panel').waitFor();
    const household = await house.evaluate(() => {
      const section = document.querySelector('[data-budget-browse="spending"]');
      const header = section.querySelector(':scope > header');
      const panel = section.querySelector('.blend-house-panel');
      const counts = section.querySelector('.budget-browse-counts');
      const hold = header && header.querySelector('[data-budget-browse-hold]');
      const visible = el => {
        if (!el) return false;
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return box.width > 8 && box.height > 8 && style.visibility !== 'hidden' && style.display !== 'none' && style.position !== 'absolute';
      };
      const rows = [...section.querySelectorAll('.budget-category-row')]
        .filter(row => row.getAttribute('data-budget-category-open') !== 'other-spending');
      const rings = [...section.querySelectorAll('.blend-ring')];
      const overs = rows.map((row, index) => {
        const ring = rings[index];
        const pill = ring && ring.querySelector('.blend-over-pill');
        return {
          status: (row.querySelector('.budget-category-status')?.textContent || '').trim(),
          over: row.classList.contains('is-over'),
          pill: pill ? (pill.textContent || '').trim() : '',
          onFace: !!(pill && visible(pill) && !pill.closest('.blend-house-panel')),
        };
      }).filter(row => row.over);
      return {
        open: !!(panel && panel.open),
        countText: (counts?.textContent || '').replace(/\s+/g, ' ').trim(),
        countOnFace: !!(counts && visible(counts) && !counts.closest('.blend-house-panel')),
        countInHeader: !!(header && header.contains(counts)),
        countInPanel: !!(panel && counts && panel.contains(counts)),
        countVisible: visible(counts),
        countHidden: counts ? counts.getAttribute('aria-hidden') : 'missing',
        clipped: !!(counts && counts.closest('.blend-clip, [aria-hidden="true"]')),
        holdText: (hold?.textContent || '').replace(/\s+/g, ' ').trim(),
        holdOnFace: visible(hold),
        overs,
      };
    });
    const overOk = prepared.marked.length >= 1
      && household.overs.length === prepared.marked.length
      && prepared.marked.every(status => household.overs.some(row => row.status === status && row.pill === status && row.onFace));
    if (!overOk || household.countText !== prepared.printed
      || !/known categories over plan/.test(household.countText)
      || household.countOnFace || household.countInHeader || !household.countInPanel
      || household.countVisible || household.countHidden || household.clipped
      || household.holdText !== prepared.hold || !household.holdOnFace || !/\$/.test(household.holdText)) {
      errors.push(`household count ${JSON.stringify({ prepared, household })}`);
    }
    const summary = house.locator('.blend-house-panel > summary');
    await summary.focus();
    const summaryFocus = await summary.evaluate(el => el === document.activeElement);
    await house.keyboard.press('Enter');
    const openedCount = await house.evaluate(() => {
      const panel = document.querySelector('.blend-house-panel');
      const counts = panel && panel.querySelector('.budget-browse-counts');
      const box = counts ? counts.getBoundingClientRect() : { width: 0, height: 0 };
      const style = counts ? getComputedStyle(counts) : null;
      return {
        open: !!(panel && panel.open),
        text: (counts?.textContent || '').replace(/\s+/g, ' ').trim(),
        visible: !!(counts && box.width > 8 && box.height > 8 && style.display !== 'none' && style.visibility !== 'hidden'),
        hidden: counts ? counts.getAttribute('aria-hidden') : 'missing',
        clipped: !!(counts && counts.closest('.blend-clip')),
      };
    });
    if (!summaryFocus || !openedCount.open || !openedCount.visible || openedCount.hidden || openedCount.clipped
      || openedCount.text !== prepared.printed) {
      errors.push(`household detail ${JSON.stringify({ summaryFocus, openedCount, printed: prepared.printed })}`);
    }
    await house.close();

    const next = await open(1440, 'light');
    const before = await next.locator('[data-budget-window-range]').innerText();
    await next.locator('[data-budget-window-step="1"]').click();
    await next.waitForFunction(prev => (document.querySelector('[data-budget-window-range]')?.textContent || '') !== prev, before);
    const paydayFit = await next.evaluate(() => {
      const pay = document.querySelector('.blend-pay');
      const face = pay && pay.querySelector('.blend-pay-face');
      const num = pay && pay.querySelector('.blend-pay-num');
      const unit = pay && pay.querySelector('.blend-pay-unit');
      if (!pay || !face) return { missing: true };
      const a = pay.getBoundingClientRect(), b = face.getBoundingClientRect();
      return {
        countdown: !!(num || unit),
        text: num ? (num.textContent || '').trim() : '',
        faceInside: b.left >= a.left - 1 && b.right <= a.right + 1 && b.top >= a.top - 1 && b.bottom <= a.bottom + 1,
      };
    });
    if (paydayFit.missing || paydayFit.countdown || !paydayFit.faceInside) {
      errors.push(`future payday ${JSON.stringify(paydayFit)}`);
    }
    const otherPeriod = await next.evaluate(() => {
      const shown = el => !!(el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 1);
      const date = document.querySelector('.blend-pay-date');
      const face = document.querySelector('.blend-pay-face');
      const ringWord = (document.querySelector('.blend-pay-num')?.textContent || '').trim();
      const a = date && date.getBoundingClientRect();
      const b = face && face.getBoundingClientRect();
      const overlap = !!(a && b && a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1);
      const billsSection = document.querySelector('[data-budget-browse="bills"]');
      const billRows = billsSection ? billsSection.querySelectorAll('.budget-bill-row').length : -1;
      const billsFace = (document.querySelector('.blend-bills-of')?.textContent || '').trim();
      const billsDom = (billsSection?.textContent || '').replace(/\s+/g, ' ');
      const incomeValue = document.querySelector('[data-operating-question="02"] .budget-step-value');
      const incomeClone = incomeValue ? incomeValue.cloneNode(true) : null;
      incomeClone?.querySelectorAll('.blend-term').forEach(node => node.remove());
      const incomePrinted = (incomeClone?.textContent || '').replace(/\s+/g, ' ').trim();
      const incomeShown = (document.querySelector('.blend-income .blend-muted')?.textContent || '').replace(/\s+/g, ' ').trim();
      return {
        cash: shown(document.querySelector('.budget-today-cash')),
        closing: shown(document.querySelector('[data-bills-closing]')),
        overlap,
        dateLine: !date || date.scrollWidth <= date.clientWidth + 1,
        dateText: date ? (date.textContent || '').trim() : '',
        ringWord,
        billRows,
        billsFace,
        billsDom,
        incomeShown,
        incomePrinted,
      };
    });
    if (otherPeriod.cash || otherPeriod.closing || otherPeriod.overlap || !otherPeriod.dateLine) {
      errors.push(`other period pills ${JSON.stringify(otherPeriod)}`);
    }
    if (/^unavailable$/i.test(otherPeriod.dateText) || (otherPeriod.ringWord === 'Unavailable' && otherPeriod.dateText === 'Unavailable')) {
      errors.push(`duplicate payday unavailable ${JSON.stringify(otherPeriod)}`);
    }
    if (otherPeriod.billRows === 0 && otherPeriod.billsFace !== 'No bills assigned') {
      errors.push(`empty bills face ${JSON.stringify(otherPeriod.billsFace)}`);
    }
    if (otherPeriod.billRows === 0 && !/\$0\.00/.test(otherPeriod.billsDom || '')) {
      errors.push('empty bills period dropped the printed zero');
    }
    if (otherPeriod.incomeShown !== otherPeriod.incomePrinted) {
      errors.push(`other period income ${JSON.stringify(otherPeriod.incomeShown)} printed ${JSON.stringify(otherPeriod.incomePrinted)}`);
    }
    await next.screenshot({ path: path.join(outDir, 'budget-blend-1440-light-next.png'), fullPage: true, animations: 'disabled' });
    shots.push('budget-blend-1440-light-next.png');
    const rings = await next.evaluate(() => {
      const mount = document.getElementById('operating-surface-body');
      const bento = document.querySelector('[data-budget-bento]');
      const row = document.querySelector('[data-budget-category-open="groceries"][data-budget-browse-origin="spending"]');
      row.classList.add('is-over');
      row.querySelector('.budget-category-status').textContent = '$80.00 over';
      bento.removeAttribute('data-blend-ready');
      bento.querySelector('[data-blend-rings]')?.remove();
      bento.querySelector('.blend-other')?.remove();
      const panel = bento.querySelector('.blend-house-panel');
      const counts = panel && panel.querySelector('.budget-browse-counts');
      if (counts) document.querySelector('[data-budget-browse="spending"]').appendChild(counts);
      panel?.remove();
      mount.appendChild(document.createTextNode(''));
      return new Promise(resolve => requestAnimationFrame(() => resolve(true)));
    });
    if (!rings) errors.push('ring repaint did not run');
    await next.locator('.blend-ring.is-over').waitFor();
    const marked = await next.evaluate(() => {
      const ring = document.querySelector('.blend-ring.is-over');
      const pill = ring && ring.querySelector('.blend-over-pill');
      const sheet = document.querySelector('[data-budget-detail-sheet]');
      return {
        word: pill ? pill.textContent : '',
        visible: !!(pill && pill.getBoundingClientRect().width > 8 && pill.getBoundingClientRect().height > 8),
        popup: ring && ring.getAttribute('aria-haspopup'),
        controls: ring && ring.getAttribute('aria-controls'),
        sheetLabel: sheet && sheet.getAttribute('aria-labelledby'),
        expanded: ring && ring.getAttribute('aria-expanded'),
      };
    });
    if (marked.word !== '$80.00 over' || !marked.visible || marked.popup !== 'dialog'
      || marked.controls !== 'budget-detail-sheet' || marked.sheetLabel !== 'budget-detail-title') {
      errors.push(`over ring ${JSON.stringify(marked)}`);
    }
    const ring = next.locator('.blend-ring.is-over');
    await ring.focus();
    const focusRing = await ring.evaluate(el => {
      const s = getComputedStyle(el);
      return { outline: s.outlineStyle, width: parseFloat(s.outlineWidth), active: el === document.activeElement };
    });
    if (!focusRing.active || focusRing.outline === 'none' || focusRing.width < 2) {
      errors.push(`ring focus ${JSON.stringify(focusRing)}`);
    }
    await next.keyboard.press('Enter');
    await next.locator('[data-budget-detail-sheet]').waitFor({ state: 'visible' });
    const opened = await next.evaluate(() => {
      const dialog = document.querySelector('[data-budget-detail-sheet]');
      const title = document.getElementById('budget-detail-title');
      return {
        open: !!(dialog && dialog.open),
        name: title ? title.textContent : '',
        expanded: document.querySelector('.blend-ring.is-over')?.getAttribute('aria-expanded'),
      };
    });
    if (!opened.open || !opened.name || opened.expanded !== 'true') errors.push(`ring sheet ${JSON.stringify(opened)}`);
    await next.keyboard.press('Escape');
    const returned = await next.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('blend-ring')).then(() => true).catch(() => false);
    if (!returned) errors.push('ring focus did not return to the ring');
    await next.close();

    const pastData = fx.served({ fundingHistory: 'paid' });
    const assertPast = async (page, label) => {
      const before = await page.locator('[data-budget-window-range]').innerText();
      const consoleErrors = [];
      page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
      page.on('pageerror', err => consoleErrors.push(err.message));
      await page.locator('[data-budget-window-step="-1"]').click();
      await page.waitForFunction(prev => (document.querySelector('[data-budget-window-range]')?.textContent || '') !== prev, before);
      const pastFace = await page.evaluate(() => {
        const progress = (document.querySelector('[data-budget-window-progress]')?.textContent || '').replace(/\s+/g, ' ');
        const tile = sel => !!document.querySelector(sel);
        const centres = [...document.querySelectorAll('.blend-ring-v')].map(el => {
          const style = getComputedStyle(el);
          const well = el.closest('.blend-ring-g');
          const wellBox = well ? well.getBoundingClientRect() : null;
          const range = document.createRange();
          if (el.firstChild) range.selectNodeContents(el);
          const lines = el.firstChild ? [...range.getClientRects()] : [];
          const cx = wellBox ? wellBox.left + wellBox.width / 2 : 0;
          const cy = wellBox ? wellBox.top + wellBox.height / 2 : 0;
          const inner = wellBox ? (47.5 / 104) * Math.min(wellBox.width, wellBox.height) : 0;
          const outside = !wellBox || lines.some(rect => {
            const corners = [[rect.left, rect.top], [rect.right, rect.top], [rect.left, rect.bottom], [rect.right, rect.bottom]];
            return corners.some(([x, y]) => ((x - cx) ** 2) + ((y - cy) ** 2) > (inner + 1) ** 2);
          });
          return {
            text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
            ellipsis: style.textOverflow === 'ellipsis' || style.whiteSpace === 'nowrap'
              || (el.textContent || '').includes('…') || (el.textContent || '').includes('...'),
            clipped: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
            outside,
            lines: lines.length,
          };
        });
        const head = document.querySelector('.blend-bills-head');
        const toggle = head && head.querySelector('.blend-panel-toggle');
        const flag = head && head.querySelector('.blend-flag');
        const headBox = head ? head.getBoundingClientRect() : null;
        const toggleBox = toggle ? toggle.getBoundingClientRect() : null;
        const flagBox = flag ? flag.getBoundingClientRect() : null;
        return {
          progress,
          countdown: !!document.querySelector('.blend-pay-num, .blend-pay-unit'),
          remaining: !!document.querySelector('.blend-bills-of'),
          billRows: document.querySelectorAll('[data-budget-browse="bills"] .budget-bill-row').length,
          bills: tile('[data-budget-browse="bills"] [data-blend-cal]'),
          house: tile('[data-budget-browse="spending"] [data-blend-rings]'),
          cards: tile('.card-movement-heading .blend-tile-ico'),
          goals: tile('[data-budget-savings-goals] .blend-tile-head'),
          income: tile('.blend-income .blend-tile-head'),
          payday: tile('.blend-pay-face'),
          hero: document.querySelector('[data-budget-bento]')?.getAttribute('data-blend-ready') === '1',
          centres,
          detailsPinned: !!(headBox && toggleBox && headBox.right - toggleBox.right <= 4 && toggleBox.width > 8),
          detailsClear: !flagBox || !toggleBox || toggleBox.left - flagBox.right > 16,
        };
      });
      const badCentres = (pastFace.centres || []).filter(row => row.ellipsis || row.clipped || row.outside || !row.text || row.lines < 1);
      if (!/Completed pay period/i.test(pastFace.progress) || pastFace.countdown || pastFace.remaining
        || pastFace.billRows < 1 || !pastFace.bills || !pastFace.house || !pastFace.cards
        || !pastFace.goals || !pastFace.income || !pastFace.payday || !pastFace.hero || consoleErrors.length
        || !pastFace.centres.length || badCentres.length || !pastFace.detailsPinned || !pastFace.detailsClear) {
        errors.push(`${label} past period ${JSON.stringify({ pastFace, badCentres, consoleErrors })}`);
      }
    };
    const past = await open(1440, 'light', { data: pastData });
    await assertPast(past, '1440');
    await past.screenshot({ path: path.join(outDir, 'budget-blend-1440-light-past.png'), fullPage: true, animations: 'disabled' });
    shots.push('budget-blend-1440-light-past.png');
    await past.close();
    const pastMid = await open(390, 'light', { data: pastData });
    await assertPast(pastMid, '390');
    await pastMid.screenshot({ path: path.join(outDir, 'budget-blend-390-light-past.png'), fullPage: true, animations: 'disabled' });
    shots.push('budget-blend-390-light-past.png');
    await pastMid.close();
    const pastNarrow = await open(320, 'light', { data: pastData });
    await assertPast(pastNarrow, '320');
    await pastNarrow.screenshot({ path: path.join(outDir, 'budget-blend-320-light-past.png'), fullPage: true, animations: 'disabled' });
    shots.push('budget-blend-320-light-past.png');
    await pastNarrow.close();

    const termsPage = await open(1440, 'light');
    const repaintTerms = async () => {
      await termsPage.evaluate(() => {
        const bento = document.querySelector('[data-budget-bento]');
        bento.querySelectorAll('.blend-term, .blend-bad').forEach(node => node.remove());
        bento.querySelectorAll('.budget-step-value > .blend-est').forEach(node => node.remove());
        const value = bento.querySelector('[data-operating-question="07"] .budget-step-value');
        if (value) value.classList.remove('is-fail-closed');
        bento.removeAttribute('data-blend-ready');
        document.getElementById('operating-surface-body').appendChild(document.createTextNode(''));
      });
      await termsPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    const readTerms = () => termsPage.evaluate(() => {
      const read = key => {
        const slot = document.querySelector(`[data-blend-term="${key}"]`);
        const chip = slot && slot.nextElementSibling && slot.nextElementSibling.classList.contains('blend-est')
          ? (slot.nextElementSibling.textContent || '').trim() : '';
        const style = slot ? getComputedStyle(slot) : null;
        return {
          shown: (slot?.textContent || '').replace(/\s+/g, ' ').trim(),
          chip,
          muted: !!(slot && slot.classList.contains('is-unavailable')),
          ink: style ? style.color : '',
        };
      };
      return {
        periodIncome: read('periodIncome'),
        assignedBills: read('assignedBills'),
        householdBudgetHold: read('householdBudgetHold'),
        balanceAfterDeductions: read('balanceAfterDeductions'),
      };
    });
    await termsPage.evaluate(() => {
      const row = document.querySelector('[data-bad-term="periodIncome"]');
      row.setAttribute('data-bad-term-trust', 'estimated');
      const amount = document.createElement('span');
      amount.setAttribute('data-bad-term-amount', '');
      amount.textContent = '$9.00';
      row.querySelector('[data-bad-term-value]').appendChild(amount);
      const big = document.querySelector('[data-bad-term="balanceAfterDeductions"]');
      big.setAttribute('data-bad-term-trust', 'estimated');
      const bigAmount = document.createElement('span');
      bigAmount.setAttribute('data-bad-term-amount', '');
      bigAmount.textContent = '$1,632.01';
      big.querySelector('[data-bad-term-value]').appendChild(bigAmount);
    });
    await repaintTerms();
    const amountPath = await readTerms();
    const beside = await termsPage.evaluate(() => {
      const cents = document.querySelector('[data-blend-term="balanceAfterDeductions"] .blend-cents');
      const chip = document.querySelector('[data-operating-question="07"] .budget-step-value > .blend-est');
      if (!cents || !chip || chip.closest('.blend-clip')) return { missing: true };
      const a = cents.getBoundingClientRect(), b = chip.getBoundingClientRect();
      return { gap: b.left - a.right, tops: Math.abs(b.top - a.top), text: (chip.textContent || '').trim() };
    });
    if (amountPath.periodIncome.shown !== '$9.00' || amountPath.periodIncome.chip !== 'est.'
      || amountPath.balanceAfterDeductions.shown !== '$1,632.01' || amountPath.balanceAfterDeductions.chip !== 'est.'
      || /estimated|≈/.test(amountPath.periodIncome.shown + amountPath.balanceAfterDeductions.shown)
      || beside.missing || beside.text !== 'est.' || beside.gap < -2 || beside.gap > 40 || beside.tops > 28) {
      errors.push(`amount est path ${JSON.stringify({ amountPath, beside })}`);
    }
    await termsPage.evaluate(() => {
      document.querySelector('[data-bad-term="periodIncome"] [data-bad-term-amount]')?.remove();
      document.querySelector('[data-bad-term="balanceAfterDeductions"] [data-bad-term-amount]')?.remove();
      document.querySelector('[data-bad-terms]').setAttribute('data-bad-terms-status', 'unavailable');
    });
    await repaintTerms();
    const blocked = await readTerms();
    const blockedBad = Object.values(blocked).some(row => row.shown !== 'Unavailable' || row.chip || !row.muted);
    if (blockedBad) errors.push(`unavailable block ${JSON.stringify(blocked)}`);
    await termsPage.evaluate(() => {
      const block = document.querySelector('[data-bad-terms]');
      block.setAttribute('data-bad-terms-status', 'published');
      block.querySelector('[data-bad-term="assignedBills"]').setAttribute('data-bad-term-trust', 'unavailable');
    });
    await repaintTerms();
    const one = await readTerms();
    if (one.assignedBills.shown !== 'Unavailable' || one.assignedBills.chip || !one.assignedBills.muted
      || one.householdBudgetHold.shown === 'Unavailable' || one.householdBudgetHold.muted
      || !/≈ estimated/.test(one.periodIncome.shown) || one.periodIncome.chip) {
      errors.push(`one unavailable term ${JSON.stringify(one)}`);
    }
    await termsPage.close();

    const otherPlan = await open(1440, 'light');
    const readPlan = async html => {
      await otherPlan.evaluate(source => {
        const row = document.querySelector('[data-budget-category-open="other-spending"][data-budget-browse-origin="spending"]');
        row.querySelector('.budget-category-meta').innerHTML = source;
        const mount = document.getElementById('operating-surface-body');
        const bento = document.querySelector('[data-budget-bento]');
        bento.removeAttribute('data-blend-ready');
        bento.querySelector('[data-blend-rings]')?.remove();
        bento.querySelector('.blend-other')?.remove();
        const panel = bento.querySelector('.blend-house-panel');
        const counts = panel && panel.querySelector('.budget-browse-counts');
        if (counts) document.querySelector('[data-budget-browse="spending"]').appendChild(counts);
        panel?.remove();
        mount.appendChild(document.createTextNode(''));
      }, html);
      await otherPlan.locator('.blend-other .blend-of-plan').waitFor();
      return otherPlan.locator('.blend-other .blend-of-plan').innerText();
    };
    const plainPlan = await readPlan('<span class="budget-cash-sr">Spent </span>$22.99<span aria-hidden="true"> / </span><span class="budget-cash-sr"> of planned </span>$450.00');
    const estimatedPlan = await readPlan('<span class="budget-cash-sr">Spent </span>$22.99<span aria-hidden="true"> / </span><span class="budget-cash-sr"> of planned </span><span class="est"><span aria-hidden="true">≈</span><span class="budget-cash-sr">estimated </span></span>$450.00');
    if (plainPlan !== 'of planned $450.00') errors.push(`other plan face ${plainPlan}`);
    if (!/of planned\s+≈estimated \$450\.00/.test(estimatedPlan || '')) errors.push(`future other plan ${estimatedPlan}`);
    await otherPlan.close();

    const goalPage = await open(1440, 'light');
    const goalFace = await goalPage.evaluate(() => {
      const card = document.querySelector('[data-budget-savings-goals]');
      const rows = [...card.querySelectorAll('[data-budget-savings-goal]')];
      const row = rows[0];
      row.querySelector('.budget-goal-amounts').innerHTML = '<span><span class="budget-goal-amount">Unavailable</span><small>Saved</small></span><span aria-hidden="true">/</span><span><span class="budget-goal-amount">≈ $745.75</span><small>Needed</small></span>';
      const both = rows[1] || row.cloneNode(true);
      if (!rows[1]) row.after(both);
      both.querySelector('.budget-goal-amounts').innerHTML = '<span><span class="budget-goal-amount"><span class="budget-v3-est">≈<span class="budget-cash-sr"> estimated</span></span> $100.00</span><small>Saved</small></span><span aria-hidden="true">/</span><span><span class="budget-goal-amount"><span class="budget-v3-est">≈<span class="budget-cash-sr"> estimated</span></span> $3,300.00</span><small>Needed</small></span>';
      card.querySelector('[data-blend-goals]')?.remove();
      card.querySelectorAll(':scope > .blend-tile-title').forEach(node => node.remove());
      card.querySelectorAll('.blend-goals-source').forEach(node => node.classList.remove('blend-goals-source'));
      document.querySelector('[data-budget-bento]').removeAttribute('data-blend-ready');
      document.getElementById('operating-surface-body').appendChild(document.createTextNode(''));
      return new Promise(resolve => requestAnimationFrame(() => {
        const legend = [...document.querySelectorAll('.blend-goal-legend li')].map(el => (el.innerText || '').replace(/\s+/g, ' ').trim());
        const lines = [...document.querySelectorAll('.blend-goal-legend li')];
        const bothLine = lines[1] || lines[0];
        const savedLine = bothLine.querySelector('.blend-goal-saved');
        const neededLine = bothLine.querySelector('.blend-goal-needed');
        const savedStyle = savedLine ? getComputedStyle(savedLine) : null;
        const neededStyle = neededLine ? getComputedStyle(neededLine) : null;
        const mark = neededLine && neededLine.querySelector('.budget-v3-est');
        const probe = document.createElement('span');
        probe.className = 'budget-v3-est';
        probe.textContent = '≈';
        document.body.appendChild(probe);
        const markStyle = mark ? getComputedStyle(mark) : null;
        const probeStyle = getComputedStyle(probe);
        const markColor = markStyle ? markStyle.color : '';
        const lineColor = neededStyle ? neededStyle.color : '';
        const probeColor = probeStyle.color;
        probe.remove();
        resolve({
          legend,
          kept: /≈ \$745\.75/.test(card.textContent || '') && /Unavailable/.test(card.textContent || ''),
          bothText: bothLine ? (bothLine.innerText || '').replace(/\s+/g, ' ').trim() : '',
          savedText: savedLine ? (savedLine.innerText || '').replace(/\s+/g, ' ').trim() : '',
          neededText: neededLine ? (neededLine.innerText || '').replace(/\s+/g, ' ').trim() : '',
          order: !!(savedLine && neededLine && (savedLine.compareDocumentPosition(neededLine) & Node.DOCUMENT_POSITION_FOLLOWING)),
          sameSize: !!(savedStyle && neededStyle && savedStyle.fontSize === neededStyle.fontSize && savedStyle.fontWeight === neededStyle.fontWeight),
          sameColor: !!(savedStyle && neededStyle && savedStyle.color === neededStyle.color),
          estTone: !!(markColor && markColor === probeColor && lineColor && markColor !== lineColor),
          markColor,
          lineColor,
          probeColor,
          estSize: !!(markStyle && neededStyle && markStyle.fontSize === neededStyle.fontSize),
          hiddenEstimate: !/estimated|calculated/.test((legend[0] || '') + ' ' + (savedLine ? savedLine.textContent : '') + ' ' + (neededLine ? neededLine.textContent : '')),
        });
      }));
    });
    const firstGoal = goalFace.legend[0] || '';
    if (!/Needed ≈ \$745\.75/.test(firstGoal) || /Saved Unavailable/.test(firstGoal) || goalFace.legend.some(line => /Saved Unavailable/.test(line)) || !goalFace.kept) {
      errors.push(`goal needed line ${JSON.stringify(goalFace)}`);
    }
    if (goalFace.savedText !== 'Saved ≈ $100.00' || goalFace.neededText !== 'Needed ≈ $3,300.00' || !goalFace.order || !goalFace.sameSize || !goalFace.sameColor || !goalFace.estTone || !goalFace.estSize || !goalFace.hiddenEstimate) {
      errors.push(`goal line style ${JSON.stringify(goalFace)}`);
    }
    await goalPage.close();

    const unavailable = await open(1440, 'light', { unavailablePlan: true });
    const unavailableDark = await open(390, 'dark', { unavailablePlan: true });
    for (const [page, file, theme] of [
      [unavailable, 'budget-blend-1440-light-unavailable.png', 'light'],
      [unavailableDark, 'budget-blend-390-dark-unavailable.png', 'dark'],
    ]) {
      const text = await page.locator('[data-budget-surface="unavailable"]').innerText();
      if (!/unavailable/i.test(text)) errors.push(`${file} hid the fail-closed wording`);
      if (!/Notes behind these numbers/.test(text) || !/Attention needed/.test(text) || !/Current plan unavailable/.test(text)) {
        errors.push(`${file} dropped fail-closed copy`);
      }
      const shell = await page.evaluate(() => {
        const head = document.querySelector('.site-head-inner');
        const nav = document.querySelector('.sitenav');
        const themeBtn = document.querySelector('[data-blend-theme]');
        const trust = document.querySelector('.refresh-trust');
        const card = document.querySelector('.budget-surface-unavailable');
        const brand = document.querySelector('.blend-brand');
        const navBox = nav.getBoundingClientRect();
        const themeBox = themeBtn.getBoundingClientRect();
        const brandBox = brand.getBoundingClientRect();
        const dock = getComputedStyle(nav).position === 'fixed';
        return {
          flex: getComputedStyle(head).display,
          sameRow: dock ? Math.abs(brandBox.top - themeBox.top) < 14 : Math.abs(navBox.top - themeBox.top) < 14,
          buildHidden: getComputedStyle(document.querySelector('.running-build')).display === 'none',
          trustRadius: parseFloat(getComputedStyle(trust).borderRadius),
          trustShown: trust.getBoundingClientRect().height > 20,
          cardRadius: parseFloat(getComputedStyle(card).borderRadius),
        };
      });
      if (shell.flex !== 'flex' || !shell.sameRow || !shell.buildHidden || shell.trustRadius < 16 || !shell.trustShown || shell.cardRadius < 24) {
        errors.push(`${file} shell ${JSON.stringify(shell)}`);
      }
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
      const posted = await page.evaluate(() => {
        const el = document.querySelector('.card-movement-heading .blend-card-posted');
        if (!el) return 'missing';
        const box = el.getBoundingClientRect();
        return box.width > 8 && box.height > 8 ? '' : 'hidden';
      });
      if (posted) errors.push(`card posted note ${file} ${posted}`);
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
      heroTerms,
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
