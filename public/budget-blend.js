'use strict';
/* Visual layer for the Budget bento. Copies text the page already rendered.
   Does not read Forecast, total money, or invent a figure. */
(function blendBudget() {
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function clip(node) {
    if (node) node.classList.add('blend-clip');
  }

  function text(node) {
    return (node && node.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function place(bento) {
    const hero = bento.querySelector('.budget-blend-hero-layout');
    if (!hero) return;
    hero.classList.add('blend-hero', 'blend-tilt');
    if (!hero.querySelector('.blend-sky')) {
      const sky = document.createElement('div');
      sky.className = 'blend-sky';
      sky.setAttribute('aria-hidden', 'true');
      sky.innerHTML = '<i class="b1"></i><i class="b2"></i><i class="b3"></i>';
      hero.prepend(sky);
    }
    const progress = bento.querySelector('[data-budget-window-progress]');
    if (progress && progress.parentElement !== bento) {
      progress.classList.add('blend-pay', 'blend-tilt');
      bento.appendChild(progress);
    }
    paintPayday(progress);
    paintIncome(bento);
    paintBills(bento);
    paintHouse(bento);
    paintGoals(bento);
    paintQuiet(bento);
    bento.querySelectorAll('[data-budget-browse="bills"], [data-budget-browse="spending"], .budget-blend-card-movements, [data-budget-savings-goals]')
      .forEach(node => node.classList.add('blend-tilt'));
  }

  function paintPayday(progress) {
    if (!progress || progress.querySelector('.blend-pay-face')) return;
    const line = text(progress.querySelector('p span:last-child'));
    const days = /in (\d+) days/.exec(line);
    const face = document.createElement('div');
    face.className = 'blend-pay-face';
    face.setAttribute('aria-hidden', 'true');
    const num = document.createElement('span');
    num.className = 'blend-pay-num';
    num.textContent = days ? days[1] : 'Unavailable';
    const unit = document.createElement('span');
    unit.className = 'blend-pay-unit';
    unit.textContent = days ? 'days' : '';
    const date = document.createElement('span');
    date.className = 'blend-pay-date';
    date.textContent = line || text(progress.querySelector('p')) || 'Unavailable';
    face.append(num, unit, date);
    progress.appendChild(face);
    const marks = [...progress.querySelectorAll('.budget-window-days > span')];
    progress.style.setProperty('--pay-n', String(marks.length || 1));
    marks.forEach((mark, index) => mark.style.setProperty('--i', String(index)));
    const next = document.querySelector('[data-budget-cash-next]');
    if (next) progress.addEventListener('click', () => next.click());
  }

  function paintIncome(bento) {
    if (bento.querySelector('.blend-income')) return;
    const step = bento.querySelector('[data-operating-question="02"]');
    const value = step && step.querySelector('.budget-step-value');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'blend-tile blend-income blend-tilt';
    const title = document.createElement('span');
    title.className = 'blend-kicker';
    title.textContent = 'Income';
    const big = document.createElement('span');
    big.className = 'blend-big';
    big.textContent = value ? text(value) : 'Unavailable';
    button.append(title, big);
    if (step) button.addEventListener('click', () => step.querySelector('summary')?.click());
    bento.appendChild(button);
  }

  function paintBills(bento) {
    const section = bento.querySelector('[data-budget-browse="bills"]');
    if (!section || section.querySelector('[data-blend-cal]')) return;
    const progress = document.querySelector('[data-budget-window-progress]');
    const start = progress && progress.getAttribute('data-start');
    const end = progress && progress.getAttribute('data-end');
    const cal = document.createElement('div');
    cal.className = 'blend-cal';
    cal.setAttribute('data-blend-cal', '');
    cal.setAttribute('aria-hidden', 'true');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '')) {
      const missing = document.createElement('p');
      missing.className = 'blend-missing';
      missing.textContent = 'Unavailable';
      cal.appendChild(missing);
    } else {
      const startDate = new Date(start + 'T12:00:00');
      const endDate = new Date(end + 'T12:00:00');
      const cursor = new Date(startDate);
      cursor.setDate(cursor.getDate() - cursor.getDay());
      const dow = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
      dow.forEach(label => {
        const cell = document.createElement('span');
        cell.className = 'blend-dow';
        cell.textContent = label;
        cal.appendChild(cell);
      });
      const byDay = new Map();
      section.querySelectorAll('.budget-bill-row').forEach(row => {
        const date = row.getAttribute('data-budget-bill-date');
        if (!date) return;
        const list = byDay.get(date) || [];
        list.push(row);
        byDay.set(date, list);
      });
      let guard = 0;
      while (cursor <= endDate && guard < 42) {
        const iso = cursor.getFullYear() + '-' + String(cursor.getMonth() + 1).padStart(2, '0') + '-' + String(cursor.getDate()).padStart(2, '0');
        const inPeriod = iso >= start && iso <= end;
        const day = document.createElement('span');
        day.className = 'blend-day' + (inPeriod ? '' : ' is-out');
        if (inPeriod) {
          const n = document.createElement('span');
          n.className = 'blend-day-n';
          n.textContent = String(cursor.getDate());
          day.appendChild(n);
          const rows = byDay.get(iso) || [];
          if (rows.length) {
            day.classList.add('has');
            const mark = document.createElement('button');
            mark.type = 'button';
            mark.className = 'blend-day-hit';
            mark.tabIndex = -1;
            const state = text(rows[0].querySelector('.budget-bill-state'));
            mark.dataset.s = /paid/i.test(state) ? 'paid' : /confirm|needs a date/i.test(state) ? 'confirm' : /pending/i.test(state) ? 'pending' : 'due';
            mark.textContent = text(rows[0].querySelector('strong')).slice(0, 1) || '•';
            mark.addEventListener('click', event => {
              event.stopPropagation();
              rows[0].click();
            });
            day.appendChild(mark);
            if (rows.length > 1) {
              const more = document.createElement('span');
              more.className = 'blend-day-more';
              more.textContent = '+' + (rows.length - 1);
              day.appendChild(more);
            }
          }
        }
        cal.appendChild(day);
        cursor.setDate(cursor.getDate() + 1);
        guard += 1;
      }
    }
    const confirmRows = [...section.querySelectorAll('.budget-bill-row')].filter(row =>
      /confirm|needs a date/i.test(text(row.querySelector('.budget-bill-state'))));
    if (confirmRows.length) {
      const flag = document.createElement('span');
      flag.className = 'blend-flag';
      flag.textContent = 'To confirm ' + confirmRows.length;
      section.querySelector('header')?.appendChild(flag);
    }
    section.querySelector('header')?.after(cal);
    section.querySelectorAll('.budget-bill-group, .budget-bills-figures, .budget-bills-progress-wrapper, .budget-browse-counts').forEach(node => {
      node.classList.add('blend-in-panel');
    });
  }

  function paintHouse(bento) {
    const section = bento.querySelector('[data-budget-browse="spending"]');
    if (!section || section.querySelector('[data-blend-rings]')) return;
    const rings = document.createElement('div');
    rings.className = 'blend-rings';
    rings.setAttribute('data-blend-rings', '');
    const rows = [...section.querySelectorAll('.budget-category-row')];
    const other = rows.filter(row => row.getAttribute('data-budget-category-open') === 'other-spending');
    const main = rows.filter(row => !other.includes(row));
    rings.style.setProperty('--n', String(Math.max(main.length, 1)));
    main.forEach(row => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'blend-ring';
      const fill = row.querySelector('.budget-category-fill');
      const width = fill && fill.style.width ? fill.style.width : '';
      if (width) button.style.setProperty('--lvl', String(Math.max(0, Math.min(100, parseFloat(width))) / 100));
      const status = text(row.querySelector('.budget-category-status')) || 'Unavailable';
      const meta = text(row.querySelector('.budget-category-meta'));
      const name = text(row.querySelector('.budget-category-name'));
      button.innerHTML = '<span class="blend-ring-g" aria-hidden="true"><svg viewBox="0 0 120 120"><circle class="rg-track" cx="60" cy="60" r="46"/><circle class="rg-arc" cx="60" cy="60" r="44"/></svg></span>';
      const value = document.createElement('span');
      value.className = 'blend-ring-v';
      value.textContent = status;
      const of = document.createElement('span');
      of.className = 'blend-ring-of';
      of.textContent = meta || 'Unavailable';
      const label = document.createElement('span');
      label.className = 'blend-ring-l';
      label.textContent = name;
      button.append(value, of, label);
      button.addEventListener('click', () => row.click());
      rings.appendChild(button);
    });
    if (!main.length) {
      const missing = document.createElement('p');
      missing.className = 'blend-missing';
      missing.textContent = 'Unavailable';
      rings.appendChild(missing);
    }
    section.querySelector('header')?.after(rings);
    if (other[0]) {
      const foot = document.createElement('button');
      foot.type = 'button';
      foot.className = 'blend-other';
      foot.textContent = text(other[0].querySelector('.budget-category-name')) + ' · ' + (text(other[0].querySelector('.budget-category-status')) || text(other[0].querySelector('.budget-category-meta')) || 'Unavailable');
      foot.addEventListener('click', () => other[0].click());
      rings.after(foot);
    }
    section.querySelectorAll('.budget-category-list, .budget-browse-stats, .budget-browse-counts, .budget-pace-key').forEach(node => {
      node.classList.add('blend-in-panel');
    });
    section.querySelectorAll('.budget-browse-sub').forEach(node => {
      if (/Tap a category/i.test(text(node))) node.classList.add('blend-clip');
    });
  }

  function paintGoals(bento) {
    const card = bento.querySelector('[data-budget-savings-goals]');
    if (!card || card.querySelector('[data-blend-goals]')) return;
    if (card.parentElement !== bento) bento.appendChild(card);
    const face = document.createElement('div');
    face.className = 'blend-goals';
    face.setAttribute('data-blend-goals', '');
    face.setAttribute('aria-hidden', 'true');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 160 160');
    svg.classList.add('blend-goal-rings');
    const list = document.createElement('ul');
    list.className = 'blend-goal-legend';
    const goals = [...card.querySelectorAll('[data-budget-savings-goal]')];
    goals.forEach((row, index) => {
      const radius = 68 - index * 14;
      if (radius > 16) {
        const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        track.setAttribute('cx', '80');
        track.setAttribute('cy', '80');
        track.setAttribute('r', String(radius));
        track.setAttribute('class', 'gr-track');
        svg.appendChild(track);
      }
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = text(row.querySelector('strong')) || 'Goal';
      const pct = document.createElement('b');
      const raw = text(row);
      const found = raw.match(/(\d+(?:\.\d+)?)\s*%/);
      pct.textContent = found ? found[1] + '%' : 'Unavailable';
      item.append(name, pct);
      list.appendChild(item);
    });
    if (!goals.length) {
      const item = document.createElement('li');
      item.textContent = 'Unavailable';
      list.appendChild(item);
    }
    face.append(svg, list);
    card.querySelector('h3')?.after(face);
  }

  function paintQuiet(bento) {
    if (bento.querySelector('.blend-quiet')) return;
    const details = document.createElement('details');
    details.className = 'blend-quiet';
    const summary = document.createElement('summary');
    summary.textContent = 'More on this page';
    const note = document.createElement('p');
    note.textContent = 'Upcoming costs stay below with the one-pot savings views. Worth a look, Recorded account balances, and Savings accounts & evidence are flagged for an owner removal decision.';
    details.append(summary, note);
    bento.appendChild(details);
    bento.querySelectorAll('.budget-browse-sub, .card-movement-heading p, .budget-browse-bills > footer p').forEach(node => {
      if (/Tap a category|Posted through|activity not observed|The plan deducts/i.test(text(node))) node.classList.add('blend-clip');
    });
  }

  function paint(root) {
    const bento = root.querySelector('[data-budget-bento]');
    if (!bento || bento.getAttribute('data-blend-ready') === '1') return;
    bento.setAttribute('data-blend-ready', '1');
    place(bento);
  }

  function tilt(event) {
    if (reduceMotion()) return;
    const tile = event.target.closest && event.target.closest('.blend-tilt');
    if (!tile) return;
    const box = tile.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const px = (event.clientX - box.left) / box.width - 0.5;
    const py = (event.clientY - box.top) / box.height - 0.5;
    tile.style.setProperty('--ry', (px * 4).toFixed(2) + 'deg');
    tile.style.setProperty('--rx', (-py * 4).toFixed(2) + 'deg');
  }

  function untilt(event) {
    const tile = event.target.closest && event.target.closest('.blend-tilt');
    if (!tile) return;
    tile.style.removeProperty('--rx');
    tile.style.removeProperty('--ry');
  }

  function themeCycle() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : current === 'light' ? 'auto' : 'dark';
    try { localStorage.setItem('hfd-theme', next === 'auto' ? 'auto' : next); } catch (e) {}
    if (next === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', next);
    if (window.App && typeof App.rerender === 'function') App.rerender();
  }

  function boot() {
    const mount = document.getElementById('operating-surface-body');
    if (!mount) return;
    const run = () => paint(mount);
    run();
    if (typeof MutationObserver === 'function') {
      new MutationObserver(run).observe(mount, { childList: true });
    }
    document.addEventListener('pointermove', tilt);
    document.addEventListener('pointerleave', untilt, true);
    document.querySelector('[data-blend-theme]')?.addEventListener('click', themeCycle);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
