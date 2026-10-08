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

  function moneyToken(value) {
    const found = String(value || '').match(/-?\$[\d,]+(?:\.\d{2})?/);
    return found ? found[0] : '';
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
    const tight = hero.querySelector('[data-operating-question="07"] [data-sign="negative"]')
      || hero.querySelector('.budget-cash-notice.has-gap');
    hero.classList.toggle('is-tight', !!tight);
    const progress = bento.querySelector('[data-budget-window-progress]');
    if (progress && progress.parentElement !== bento) {
      progress.classList.add('blend-pay', 'blend-tilt');
      bento.appendChild(progress);
    }
    const header = bento.querySelector('[data-budget-window-header]');
    if (header && !header.classList.contains('blend-toolbar')) {
      header.classList.add('blend-toolbar');
      bento.insertBefore(header, bento.firstChild);
    }
    paintPayday(progress);
    paintHero(hero);
    paintIncome(bento);
    paintBills(bento);
    paintHouse(bento);
    paintCards(bento);
    paintGoals(bento);
    paintQuiet(bento);
    bento.querySelectorAll('[data-budget-browse="bills"], [data-budget-browse="spending"], .budget-blend-card-movements, [data-budget-savings-goals]')
      .forEach(node => node.classList.add('blend-tilt'));
  }

  function paintPayday(progress) {
    if (!progress || progress.querySelector('.blend-pay-face')) return;
    const sentence = text(progress.querySelector('p'));
    if (sentence) progress.setAttribute('aria-label', sentence);
    const line = text(progress.querySelector('p span:last-child'));
    const days = /in (\d+) days/.exec(line);
    const dates = [...progress.querySelectorAll('p b')];
    const published = dates.length >= 2 ? text(dates[1]) : '';
    const marks = [...progress.querySelectorAll('.budget-window-days > span')];
    const face = document.createElement('div');
    face.className = 'blend-pay-face';
    face.appendChild(payRing(marks));
    const num = document.createElement('span');
    num.className = 'blend-pay-num' + (days ? '' : ' is-word');
    num.textContent = days ? days[1] : 'Unavailable';
    const unit = document.createElement('span');
    unit.className = 'blend-pay-unit';
    unit.textContent = days ? 'days' : '';
    face.append(num, unit);
    const date = document.createElement('span');
    date.className = 'blend-pay-date';
    date.textContent = published || 'Unavailable';
    progress.querySelector('p')?.classList.add('blend-clip');
    progress.append(face, date);
    const next = document.querySelector('[data-budget-cash-next]');
    if (next) progress.addEventListener('click', () => next.click());
  }

  function payRing(marks) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 120 120');
    svg.setAttribute('class', 'blend-pay-ring');
    svg.setAttribute('aria-hidden', 'true');
    const n = marks.length;
    if (!n) return svg;
    const radius = 52;
    const circumference = 2 * Math.PI * radius;
    const gap = circumference * (6 / 360);
    const segment = Math.max(0, circumference / n - gap);
    marks.forEach((mark, index) => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '60');
      circle.setAttribute('cy', '60');
      circle.setAttribute('r', String(radius));
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke-width', '7');
      circle.setAttribute('stroke-linecap', 'butt');
      circle.setAttribute('stroke-dasharray', segment.toFixed(3) + ' ' + (circumference - segment).toFixed(3));
      const turn = -90 + 3 + index * (360 / n);
      circle.setAttribute('transform', 'rotate(' + turn.toFixed(3) + ' 60 60)');
      circle.setAttribute('class', mark.classList.contains('is-today') ? 'is-today'
        : mark.classList.contains('is-past') ? 'is-past' : 'is-left');
      svg.appendChild(circle);
    });
    return svg;
  }

  function paintHero(hero) {
    const cash = hero.querySelector('.budget-today-cash');
    if (cash && !cash.querySelector('.blend-cash-label')) {
      const sub = text(cash.querySelector('.budget-cash-sub'));
      const heading = text(cash.querySelector('h2'));
      const label = document.createElement('span');
      label.className = 'blend-cash-label';
      label.textContent = /^Bills account\b/i.test(sub) ? 'Bills account' : (heading || 'Unavailable');
      cash.querySelector('[data-budget-cash-hero]')?.before(label);
    }
    clip(hero.querySelector('.budget-cash-how'));
    const panel = heroPanel(hero);
    const info = hero.querySelector('.budget-period-info');
    if (info && info.parentElement !== panel) panel.appendChild(info);
    ['04', '06'].forEach(number => {
      const step = hero.querySelector('[data-operating-question="' + number + '"]');
      if (!step || step.previousElementSibling?.classList.contains('blend-minus')) return;
      const sep = document.createElement('span');
      sep.className = 'blend-minus' + (number === '04' ? ' is-bills' : ' is-house');
      sep.setAttribute('aria-hidden', 'true');
      sep.textContent = '−';
      step.before(sep);
    });
    let foot = hero.querySelector('.blend-hero-foot');
    if (!foot) {
      foot = document.createElement('div');
      foot.className = 'blend-hero-foot';
      hero.appendChild(foot);
    }
    const savings = hero.querySelector('[data-operating-question="savings"], [data-budget-savings-stock]');
    const closing = hero.querySelector('[data-bills-closing]');
    if (savings) savings.classList.add('blend-hero-pill');
    if (closing) foot.appendChild(closing);
    clip(closing && closing.querySelector('details > summary'));
    hero.querySelectorAll('.budget-bills-closing > .operating-note').forEach(node => {
      if (/Latest recorded Bills balance/i.test(text(node))) {
        node.classList.add('blend-panel-note');
        if (node.parentElement !== panel) panel.appendChild(node);
      } else clip(node);
    });
    const notice = hero.querySelector('.budget-cash-notice');
    if (notice && notice.parentElement !== panel) {
      notice.classList.add('blend-panel-note');
      panel.appendChild(notice);
    }
    const afterBills = hero.querySelector('[data-operating-question="05"]');
    if (afterBills) afterBills.classList.add('blend-clip');
    joinResultLabel(hero);
  }

  function joinResultLabel(hero) {
    const step = hero.querySelector('[data-operating-question="07"]');
    const number = step && step.querySelector('.operating-number');
    const title = step && step.querySelector('.budget-step-title');
    if (!number || !title || number.parentElement.classList.contains('blend-result-label')) return;
    const wrap = document.createElement('span');
    wrap.className = 'blend-result-label';
    title.before(wrap);
    wrap.append(number, document.createTextNode(' '), title);
  }

  function heroPanel(hero) {
    let panel = hero.querySelector('.blend-hero-panel');
    if (panel) return panel;
    panel = document.createElement('details');
    panel.className = 'blend-hero-panel';
    const summary = document.createElement('summary');
    summary.textContent = 'Period figures';
    panel.appendChild(summary);
    hero.appendChild(panel);
    return panel;
  }

  function depositRows(step) {
    return [...step.querySelectorAll('[data-period-income], .other-income-tx')];
  }

  function depositName(row) {
    if (row.classList.contains('other-income-tx')) {
      const payee = row.querySelector('.other-income-tx-payee');
      if (!payee) return 'Unavailable';
      const clone = payee.cloneNode(true);
      clone.querySelectorAll('.other-income-tx-received, .other-income-tx-pending').forEach(node => node.remove());
      return text(clone) || 'Unavailable';
    }
    const span = row.querySelector('span');
    if (!span) return 'Unavailable';
    const clone = span.cloneNode(true);
    clone.querySelectorAll('time, [data-income-original-plan]').forEach(node => node.remove());
    return text(clone) || 'Unavailable';
  }

  function depositDate(row) {
    const time = row.querySelector('time');
    if (!time) return '';
    const raw = (time.getAttribute('datetime') && text(time)) || text(time);
    const found = raw.match(/[A-Z][a-z]{2}\s+\d{1,2}/);
    return found ? found[0] : raw.split('·')[0].trim();
  }

  function depositAmount(row) {
    const raw = text(row.querySelector('[data-income-line-amount]'));
    if (!raw || raw === '-' || /unavailable|unknown/i.test(raw)) return raw && raw !== '-' ? raw : 'Unavailable';
    if (/[+-]\$/.test(raw)) return raw;
    if (/^\$[\d,]+(?:\.\d{2})?$/.test(raw)) return '+' + raw;
    return raw;
  }

  function depositReceived(row) {
    const status = String(row.getAttribute('data-income-status') || '').toLowerCase();
    return status === 'received' || status === 'already in balance';
  }

  function paintIncome(bento) {
    if (bento.querySelector('.blend-income')) return;
    const step = bento.querySelector('[data-operating-question="02"]');
    const plan = step && step.querySelector('[data-budget-ratio="income"] [data-budget-ratio-plan]');
    const planText = text(plan);
    const money = moneyToken(planText);
    const estimated = /estimated|≈/.test(planText);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'blend-tile blend-income blend-tilt';
    const title = document.createElement('span');
    title.className = 'blend-kicker';
    title.textContent = 'Income';
    const figure = document.createElement('span');
    figure.className = 'blend-figure';
    const big = document.createElement('span');
    big.className = 'blend-big';
    if (money) big.textContent = money;
    else if (/unknown|unavailable/i.test(planText)) big.textContent = /unknown/i.test(planText) ? 'Unknown' : 'Unavailable';
    else big.textContent = planText || 'Unavailable';
    figure.appendChild(big);
    if (money && estimated) {
      const pill = document.createElement('span');
      pill.className = 'blend-est';
      pill.textContent = 'est.';
      figure.appendChild(pill);
    }
    const rail = document.createElement('span');
    rail.className = 'blend-rail';
    depositRows(step || bento).forEach(row => {
      const item = document.createElement('span');
      item.className = 'blend-rail-item';
      const amount = document.createElement('b');
      amount.textContent = depositAmount(row);
      const name = document.createElement('span');
      name.className = 'blend-rail-name';
      name.textContent = depositName(row);
      const when = document.createElement('span');
      when.className = 'blend-rail-when';
      when.textContent = depositDate(row);
      const mark = document.createElement('i');
      mark.className = depositReceived(row) ? 'is-got' : 'is-wait';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = depositReceived(row) ? '✓' : '○';
      item.append(amount, name, mark);
      if (when.textContent) item.appendChild(when);
      rail.appendChild(item);
    });
    const muted = document.createElement('span');
    muted.className = 'blend-muted';
    const value = step && step.querySelector('.budget-step-value');
    muted.textContent = value ? text(value) : '';
    button.append(title, figure, rail);
    if (muted.textContent) button.appendChild(muted);
    if (step) button.addEventListener('click', () => step.querySelector('summary')?.click());
    bento.appendChild(button);
  }

  function billIcon(label) {
    const s = String(label || '').toLowerCase();
    const name = /rent|mortgage|house|property|home/.test(s) ? 'house'
      : /car|auto|vehicle/.test(s) ? 'car'
      : /hydro|electric|power|bolt/.test(s) ? 'bolt'
      : /wifi|internet|shaw|telus|rogers|phone/.test(s) ? 'wifi'
      : /card|visa|mastercard|mbna|amex|credit/.test(s) ? 'card'
      : 'generic';
    const paths = {
      house: 'M4 11.2 12 4l8 7.2V20h-5.2v-5.2H9.2V20H4V11.2Z',
      car: 'M4 16h16v2H4v-2Zm1.2-2 1.6-5h10.4l1.6 5H5.2Z',
      bolt: 'M13 3 6 13h5l-1 8 7-10h-5l1-8Z',
      wifi: 'M12 18.2 12.1 18.1M7.2 14.2a6.8 6.8 0 0 1 9.6 0M4.2 11.2a11 11 0 0 1 15.6 0',
      card: 'M4 7h16v10H4V7Zm0 3h16',
      generic: 'M8 4h8v16H8V4Zm2.2 3h3.6'
    };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', paths[name]);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.7');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);
    return svg;
  }

  function billState(row) {
    const state = text(row.querySelector('.budget-bill-state'));
    if (!state || /status unavailable|unknown|unavailable|not observed/i.test(state)) return 'unknown';
    if (/paid/i.test(state) && !/not paid|unpaid|not confirmed/i.test(state)) return 'paid';
    if (/confirm|needs a date/i.test(state)) return 'confirm';
    if (/pending/i.test(state)) return 'pending';
    if (/not paid|^due\b|planned/i.test(state)) return 'due';
    return 'unknown';
  }

  function paintBills(bento) {
    const section = bento.querySelector('[data-budget-browse="bills"]');
    if (!section || section.querySelector('[data-blend-cal]')) return;
    const progress = document.querySelector('[data-budget-window-progress]');
    const start = progress && progress.getAttribute('data-start');
    const end = progress && progress.getAttribute('data-end');
    const asOf = progress && progress.getAttribute('data-as-of');
    const head = document.createElement('div');
    head.className = 'blend-bills-head';
    const title = document.createElement('span');
    title.className = 'blend-tile-title';
    title.textContent = 'Bills';
    const rows = [...section.querySelectorAll('.budget-bill-row')];
    const confirmRows = rows.filter(row => billState(row) === 'confirm');
    const flag = document.createElement('span');
    flag.className = 'blend-flag';
    flag.textContent = 'To confirm ' + confirmRows.length;
    const remain = document.createElement('span');
    remain.className = 'blend-bills-of';
    const leftRaw = text(section.querySelector('[data-budget-browse-bills-remaining]'));
    const planRaw = text(section.querySelector('[data-budget-ratio="bills"] [data-budget-ratio-plan]'));
    const leftMoney = moneyToken(leftRaw);
    const planMoney = moneyToken(planRaw);
    if (leftMoney && planMoney) {
      const est = /estimated|≈/.test(leftRaw + ' ' + planRaw) ? ' est.' : '';
      remain.textContent = leftMoney + ' left of ' + planMoney + est;
    } else {
      remain.textContent = text(section.querySelector('.budget-browse-sub')) || 'Unavailable';
    }
    head.append(title, flag, remain);
    const cal = document.createElement('div');
    cal.className = 'blend-cal';
    cal.setAttribute('data-blend-cal', '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '')) {
      const missing = document.createElement('p');
      missing.className = 'blend-missing';
      missing.textContent = 'Unavailable';
      cal.appendChild(missing);
    } else {
      const startDate = new Date(start + 'T12:00:00');
      const endDate = new Date(end + 'T12:00:00');
      const days = [];
      const cursor = new Date(startDate);
      while (cursor <= endDate && days.length < 14) {
        days.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
      days.slice(0, Math.min(7, days.length)).forEach(day => {
        const cell = document.createElement('span');
        cell.className = 'blend-dow';
        cell.textContent = day.toLocaleDateString('en-US', { weekday: 'narrow' });
        cal.appendChild(cell);
      });
      const byDay = new Map();
      rows.forEach(row => {
        const date = row.getAttribute('data-budget-bill-date');
        if (!date) return;
        const list = byDay.get(date) || [];
        list.push(row);
        byDay.set(date, list);
      });
      days.forEach(date => {
        const iso = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
        const day = document.createElement('span');
        day.className = 'blend-day' + (iso === asOf ? ' is-today' : '');
        const n = document.createElement('span');
        n.className = 'blend-day-n';
        n.textContent = String(date.getDate());
        day.appendChild(n);
        const hits = byDay.get(iso) || [];
        if (hits.length) {
          day.classList.add('has');
          const mark = document.createElement('button');
          mark.type = 'button';
          mark.className = 'blend-day-hit';
          mark.tabIndex = -1;
          const state = billState(hits[0]);
          mark.dataset.s = state;
          mark.appendChild(billIcon(text(hits[0].querySelector('strong'))));
          const badge = document.createElement('i');
          badge.className = 'blend-state' + (state === 'confirm' ? ' blend-pulse' : '');
          badge.setAttribute('aria-hidden', 'true');
          if (state === 'paid') {
            badge.textContent = '✓';
            day.appendChild(badge);
          } else if (state === 'unknown') {
            badge.classList.add('is-unknown');
            badge.textContent = '–';
            mark.appendChild(badge);
          } else mark.appendChild(badge);
          mark.addEventListener('click', event => {
            event.stopPropagation();
            hits[0].click();
          });
          day.appendChild(mark);
          if (hits.length > 1) {
            const more = document.createElement('span');
            more.className = 'blend-day-more';
            more.textContent = '+' + (hits.length - 1);
            day.appendChild(more);
          }
        }
        cal.appendChild(day);
      });
    }
    const header = section.querySelector('header');
    header?.before(head);
    header?.after(cal);
    const panel = document.createElement('div');
    panel.className = 'blend-face-off';
    panel.id = 'blend-bills-more';
    panel.inert = true;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'blend-panel-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', panel.id);
    toggle.setAttribute('aria-label', 'Bills detail');
    toggle.textContent = 'Details';
    toggle.addEventListener('click', () => {
      const open = panel.classList.toggle('is-open');
      panel.inert = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    head.appendChild(toggle);
    cal.after(panel);
    [...section.children].forEach(node => {
      if (node !== head && node !== cal && node !== panel) panel.appendChild(node);
    });
  }

  function plannedPhrase(row) {
    const meta = row.querySelector('.budget-category-meta');
    const found = text(meta).match(/of planned\s+(.+)$/i);
    if (!found) return null;
    const wrap = document.createElement('span');
    wrap.className = 'blend-of-plan';
    wrap.textContent = 'of planned ' + found[1].trim();
    return wrap;
  }

  function markSheet(button, row) {
    const sheet = document.querySelector('[data-budget-detail-sheet]');
    if (sheet && !sheet.id) sheet.id = 'budget-detail-sheet';
    button.setAttribute('aria-haspopup', 'dialog');
    if (sheet) button.setAttribute('aria-controls', sheet.id);
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', () => {
      button.setAttribute('aria-expanded', 'true');
      row.click();
    });
    if (sheet && sheet.dataset.blendRingClose !== '1') {
      sheet.dataset.blendRingClose = '1';
      sheet.addEventListener('close', () => {
        document.querySelectorAll('.blend-ring[aria-expanded="true"], .blend-other[aria-expanded="true"]').forEach(node => {
          node.setAttribute('aria-expanded', 'false');
        });
      });
    }
  }

  function leftArc(share) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 104 104');
    svg.setAttribute('class', 'blend-left-arc');
    svg.setAttribute('aria-hidden', 'true');
    ['blend-arc-track', 'blend-arc-left'].forEach(name => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '52');
      circle.setAttribute('cy', '52');
      circle.setAttribute('r', '49');
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke-width', '3');
      circle.setAttribute('class', name);
      if (name === 'blend-arc-left') {
        circle.setAttribute('stroke-linecap', 'round');
        circle.setAttribute('pathLength', '100');
        const drawn = share == null ? 0 : Math.max(0, Math.min(100, share * 100));
        circle.setAttribute('stroke-dasharray', drawn.toFixed(2) + ' 100');
      }
      svg.appendChild(circle);
    });
    return svg;
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
    main.forEach(row => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'blend-ring';
      const bar = row.querySelector('.budget-category-bar');
      const scale = bar && bar.getAttribute('data-budget-category-scale');
      const fill = row.querySelector('.budget-category-fill');
      const width = fill && fill.style.width ? parseFloat(fill.style.width) : NaN;
      const known = scale === 'numeric' && Number.isFinite(width);
      if (known) {
        const used = Math.max(0, Math.min(100, width)) / 100;
        button.classList.add('is-known');
        button.style.setProperty('--left', String(Math.max(0, Math.min(1, 1 - used))));
      } else button.classList.add('is-unknown');
      const status = text(row.querySelector('.budget-category-status')) || 'Unavailable';
      const meta = text(row.querySelector('.budget-category-meta'));
      const planned = (meta.match(/of planned\s+(.+)$/i) || [])[1];
      const name = text(row.querySelector('.budget-category-name')) || 'Category';
      const well = document.createElement('span');
      well.className = 'blend-ring-g' + (known ? '' : ' is-hatched');
      well.setAttribute('aria-hidden', 'true');
      const value = document.createElement('span');
      value.className = 'blend-ring-v';
      value.textContent = status;
      if (known) {
        const liquid = document.createElement('span');
        liquid.className = 'blend-liquid';
        const share = Math.max(0, Math.min(1, 1 - Math.max(0, Math.min(100, width)) / 100));
        well.append(liquid, leftArc(share), value);
      } else well.appendChild(value);
      const label = document.createElement('span');
      label.className = 'blend-ring-l';
      label.textContent = planned ? name + ' · of ' + planned.trim() : name;
      button.append(well, label);
      if (row.classList.contains('is-over')) {
        button.classList.add('is-over');
        const pill = document.createElement('span');
        pill.className = 'blend-over-pill';
        pill.textContent = status;
        button.appendChild(pill);
      }
      markSheet(button, row);
      rings.appendChild(button);
    });
    if (!main.length) {
      const missing = document.createElement('p');
      missing.className = 'blend-missing';
      missing.textContent = 'Unavailable';
      rings.appendChild(missing);
    }
    const header = section.querySelector('header');
    header?.after(rings);
    const facts = section.querySelector('.budget-browse-stats');
    const counts = section.querySelector('.budget-browse-counts');
    if (header && facts) {
      facts.classList.add('blend-house-facts');
      header.appendChild(facts);
    }
    if (header && counts) {
      counts.classList.add('blend-house-status');
      header.appendChild(counts);
    }
    if (other[0]) {
      const foot = document.createElement('button');
      foot.type = 'button';
      foot.className = 'blend-other';
      const status = text(other[0].querySelector('.budget-category-status'))
        || text(other[0].querySelector('.budget-category-meta'))
        || 'Unavailable';
      const dot = document.createElement('i');
      dot.className = 'blend-amber';
      dot.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span');
      name.className = 'blend-other-name';
      name.textContent = text(other[0].querySelector('.budget-category-name')) || 'Other spending';
      const word = document.createElement('span');
      const counted = text(other[0]).match(/\d+\s+to sort/i);
      word.textContent = counted ? counted[0] : status;
      const chevron = document.createElement('span');
      chevron.className = 'blend-other-chev';
      chevron.setAttribute('aria-hidden', 'true');
      chevron.textContent = '›';
      const plan = plannedPhrase(other[0]);
      foot.append(dot, name);
      if (plan) foot.appendChild(plan);
      foot.append(word, chevron);
      markSheet(foot, other[0]);
      rings.after(foot);
    }
    const more = document.createElement('details');
    more.className = 'blend-house-panel';
    const summary = document.createElement('summary');
    summary.textContent = 'Household detail';
    more.appendChild(summary);
    const remainBlock = section.querySelector('[data-budget-browse-remaining]')?.parentElement;
    if (remainBlock) remainBlock.classList.add('blend-house-remain');
    [remainBlock?.querySelector(':scope > span'), remainBlock?.querySelector('small'), section.querySelector('.budget-browse-cycle')]
      .forEach(node => { if (node) more.appendChild(node); });
    (section.querySelector('.blend-other') || rings).after(more);
    section.querySelectorAll('.budget-category-list, .budget-pace-key').forEach(node => {
      node.classList.add('blend-in-panel');
    });
    clip(section.querySelector('footer'));
    section.querySelectorAll('.budget-browse-eyebrow, .budget-browse-sub').forEach(clip);
  }

  function paintCards(bento) {
    bento.querySelectorAll('.card-movement-trigger').forEach(button => {
      if (button.querySelector('.blend-card-bar')) return;
      const bar = document.createElement('span');
      bar.className = 'blend-card-bar';
      bar.setAttribute('aria-hidden', 'true');
      button.appendChild(bar);
    });
    const note = bento.querySelector('.card-movement-heading p');
    if (note && !note.dataset.blendPosted && /Posted through|activity not observed/i.test(text(note))) {
      note.dataset.blendPosted = '1';
      note.classList.add('blend-card-posted');
      bento.querySelectorAll('.card-movement-panel').forEach(panel => {
        const copy = note.cloneNode(true);
        copy.classList.add('blend-card-posted');
        panel.prepend(copy);
      });
    }
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
      const detail = document.createElement('b');
      const status = text(row.querySelector('.budget-goal-state'));
      const amounts = [...row.querySelectorAll('.budget-goal-amounts > span')].map(node => {
        const amount = text(node.querySelector('.budget-goal-amount'));
        const label = text(node.querySelector('small'));
        return [amount, label].filter(Boolean).join(' ');
      }).filter(Boolean).join(' · ');
      detail.textContent = status || (/Unavailable/i.test(amounts) ? 'Unavailable' : /Unknown/i.test(amounts) ? 'Unknown' : '');
      item.append(name, detail);
      list.appendChild(item);
    });
    if (!goals.length) {
      const notice = text(card.querySelector('.budget-goal-notice, p'));
      if (notice) {
        const item = document.createElement('li');
        item.textContent = notice;
        list.appendChild(item);
      }
    }
    face.append(svg, list);
    const title = document.createElement('span');
    title.className = 'blend-tile-title';
    title.textContent = text(card.querySelector('h3')) || 'Saving for';
    card.querySelector('h3')?.before(title);
    card.querySelector('h3')?.before(face);
    card.querySelectorAll(':scope > ul, :scope > .budget-surface-link, :scope > .budget-goal-notice, :scope > .budget-surface-eyebrow, :scope > [data-budget-funding-savings], :scope > h3').forEach(node => {
      node.classList.add('blend-goals-source');
    });
  }

  function paintQuiet() {
    if (document.querySelector('.blend-quiet')) return;
    const footer = document.querySelector('.wrap > footer');
    if (!footer) return;
    const details = document.createElement('details');
    details.className = 'blend-quiet';
    const summary = document.createElement('summary');
    summary.textContent = 'More on this page';
    details.appendChild(summary);
    footer.before(details);
    details.appendChild(footer);
    const note = document.createElement('p');
    note.className = 'blend-quiet-note';
    note.textContent = 'Recorded account balances, Savings accounts & evidence, and the snapshot stay available here for an owner removal decision.';
    details.appendChild(note);
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
