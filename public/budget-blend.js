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

  // The hero term slot is painted into the same step value the income line
  // copies. It is not a printed income status. Leave that slot on the hero.
  function printedStep(node) {
    if (!node) return '';
    const clone = node.cloneNode(true);
    clone.querySelectorAll('.blend-term').forEach(term => term.remove());
    return text(clone);
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
      const active = document.activeElement;
      header.classList.add('blend-toolbar');
      bento.insertBefore(header, bento.firstChild);
      if (active && active !== document.body && header.contains(active) && document.activeElement !== active) {
        active.focus({ preventScroll: true });
      }
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

  function tileGlyph(kind) {
    const paths = {
      income: '<path d="M12 4v12m0 0-5-5m5 5 5-5M5 20h14"/>',
      payday: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M9.5 3h5"/>',
      bills: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>',
      house: '<path d="M5 9h14l-1.2 9.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z"/><path d="M9 9V7a3 3 0 0 1 6 0v2"/>',
      cards: '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 10h19M6 15h4"/>',
      goals: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8" fill="currentColor" stroke="none"/>',
    };
    const holder = document.createElement('span');
    holder.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (paths[kind] || paths.cards) + '</svg>';
    return holder.firstChild;
  }

  function tileIcon(kind) {
    const ico = document.createElement('span');
    ico.className = 'blend-tile-ico';
    ico.appendChild(tileGlyph(kind));
    return ico;
  }

  function paintPayday(progress) {
    if (!progress || progress.querySelector('.blend-pay-face')) return;
    if (!progress.querySelector('.blend-tile-head')) {
      const head = document.createElement('span');
      head.className = 'blend-tile-head';
      const title = document.createElement('span');
      title.className = 'blend-tile-title';
      title.textContent = 'Payday';
      head.append(tileIcon('payday'), title);
      progress.prepend(head);
    }
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
    const current = selectedPeriodIsCurrent(progress.closest('[data-budget-bento]') || document);
    if (current) {
      const num = document.createElement('span');
      num.className = 'blend-pay-num' + (days ? '' : ' is-word');
      num.textContent = days ? days[1] : 'Unavailable';
      const unit = document.createElement('span');
      unit.className = 'blend-pay-unit';
      unit.textContent = days ? 'days' : '';
      face.append(num, unit);
    }
    progress.querySelector('p')?.classList.add('blend-clip');
    progress.appendChild(face);
    if (published && !/^unavailable$/i.test(published)) {
      const date = document.createElement('span');
      date.className = 'blend-pay-date';
      date.textContent = published;
      progress.appendChild(date);
    }
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
    const body = panelBody(panel);
    const info = hero.querySelector('.budget-period-info');
    if (info && info.parentElement !== body) body.appendChild(info);
    parkBadTerms(hero, body);
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
    const afterBills = hero.querySelector('[data-operating-question="05"]');
    if (savings) savings.classList.add('blend-hero-pill');
    [afterBills, closing, savings].forEach(node => {
      if (node && node.parentElement !== foot) foot.appendChild(node);
    });
    if (afterBills) afterBills.classList.remove('blend-clip');
    clip(closing && closing.querySelector('details > summary'));
    hero.querySelectorAll('.budget-bills-closing > .operating-note').forEach(node => {
      if (/Latest recorded Bills balance/i.test(text(node))) {
        node.classList.add('blend-panel-note');
        if (node.parentElement !== body) body.appendChild(node);
      } else clip(node);
    });
    const notice = hero.querySelector('.budget-cash-notice');
    if (notice && notice.parentElement !== body) {
      notice.classList.add('blend-panel-note');
      body.appendChild(notice);
    }
    hero.classList.toggle('is-other-period', !selectedPeriodIsCurrent(hero));
    paintHeroTop(hero);
    joinResultLabel(hero);
    paintTermSlots(hero);
    markResultClosed(hero);
    splitPrintedCents(hero.querySelector('[data-blend-term="balanceAfterDeductions"]'));
  }

  function paintHeroTop(hero) {
    if (hero.querySelector('.blend-hero-top')) return;
    const top = document.createElement('div');
    top.className = 'blend-hero-top';
    const id = document.createElement('div');
    id.className = 'blend-hero-id';
    const range = document.querySelector('[data-budget-window-range]');
    if (range) {
      range.classList.add('blend-hero-range');
      id.appendChild(range);
    }
    if (selectedPeriodIsCurrent(hero)) {
      const now = document.createElement('span');
      now.className = 'blend-now';
      now.textContent = 'Now';
      id.appendChild(now);
    }
    top.appendChild(id);
    const cash = hero.querySelector('.budget-today-cash');
    if (cash) top.appendChild(cash);
    const sky = hero.querySelector('.blend-sky');
    if (sky && sky.parentElement === hero) sky.after(top);
    else hero.prepend(top);
  }

  function splitPrintedCents(value) {
    if (!value || value.classList.contains('is-fail-closed') || value.classList.contains('is-unavailable') || value.querySelector('.blend-cents')) return;
    const nodes = [];
    const walker = document.createTreeWalker(value, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement && node.parentElement.closest('.budget-cash-sr, .est, .blend-clip')) continue;
      if (/\$[\d,]+\.\d{2}/.test(node.textContent)) nodes.push(node);
    }
    nodes.forEach(textNode => {
      const parts = textNode.textContent.match(/^(.*?)(-?\$[\d,]+)(\.\d{2})(.*)$/);
      if (!parts) return;
      const frag = document.createDocumentFragment();
      if (parts[1]) {
        const prefix = document.createElement('span');
        prefix.className = 'blend-term-prefix';
        prefix.textContent = parts[1];
        frag.appendChild(prefix);
      }
      const dollars = document.createElement('span');
      dollars.className = 'blend-dollars';
      dollars.textContent = parts[2];
      const cents = document.createElement('sup');
      cents.className = 'blend-cents';
      cents.textContent = parts[3];
      frag.append(dollars, cents, document.createTextNode(parts[4]));
      textNode.replaceWith(frag);
    });
  }

  function selectedPeriodIsCurrent(hero) {
    const root = hero.closest('[data-budget-bento]') || document;
    const sub = text(root.querySelector('.budget-cash-sub'));
    if (/not the selected period opening/i.test(sub)) return false;
    const line = text(root.querySelector('[data-budget-window-progress]'));
    if (/Next payday/i.test(line)) return true;
    if (/Upcoming|Completed pay period|Selected pay period/i.test(line)) return false;
    return true;
  }

  // Face slots copy Forecast's printed Balance After Deductions terms.
  // The long labels stay in the published block. No arithmetic.
  const TERM_SOURCES = [
    ['02', 'periodIncome'],
    ['04', 'assignedBills'],
    ['06', 'householdBudgetHold'],
  ];

  function badTermsBlock(hero) {
    const root = hero.closest('[data-budget-bento]') || document;
    return root.querySelector('[data-bad-terms]');
  }

  function parkBadTerms(hero, body) {
    const block = badTermsBlock(hero);
    if (block && body && block.parentElement !== body) body.appendChild(block);
  }

  function selectedPeriodIsPast(root) {
    return /Completed pay period/i.test(text((root || document).querySelector('[data-budget-window-progress]')));
  }

  // Path A: a printed [data-bad-term-amount] is the bare amount, plus an
  // est. chip only when that row's trust is estimated.
  // Path B: no amount span — the value text is copied verbatim, including
  // "≈ estimated" when that is what was printed, and no chip is added.
  function termDisplay(row, blockStatus) {
    const trust = row ? (row.getAttribute('data-bad-term-trust') || '') : '';
    if (blockStatus !== 'published' || !row || trust === 'unavailable') {
      return { text: 'Unavailable', chip: false, unavailable: true };
    }
    const amount = row.querySelector('[data-bad-term-amount]');
    if (amount) return { text: text(amount), chip: trust === 'estimated', unavailable: false };
    const value = row.querySelector('[data-bad-term-value]');
    return { text: text(value) || 'Unavailable', chip: false, unavailable: !text(value) };
  }

  function paintTermFace(parent, name, display, className) {
    if (!parent || parent.querySelector('[data-blend-term="' + name + '"]')) return null;
    const slot = document.createElement('span');
    slot.className = className;
    slot.setAttribute('data-blend-term', name);
    slot.textContent = display.text;
    slot.classList.toggle('is-unavailable', !!display.unavailable);
    parent.appendChild(slot);
    if (display.chip) {
      const pill = document.createElement('span');
      pill.className = 'blend-est';
      pill.textContent = 'est.';
      slot.after(pill);
    }
    return slot;
  }

  function paintTermSlots(hero) {
    const block = badTermsBlock(hero);
    const status = block ? (block.getAttribute('data-bad-terms-status') || 'unavailable') : 'unavailable';
    TERM_SOURCES.forEach(([number, name]) => {
      const value = hero.querySelector('[data-operating-question="' + number + '"] .budget-step-value');
      const row = block && block.querySelector('[data-bad-term="' + name + '"]');
      paintTermFace(value, name, termDisplay(row, status), 'blend-term');
    });
    const result = hero.querySelector('[data-operating-question="07"] .budget-step-value');
    if (result && !result.querySelector('[data-blend-term="balanceAfterDeductions"]')) {
      if (!result.querySelector(':scope > .blend-clip')) {
        const hidden = document.createElement('span');
        hidden.className = 'blend-clip';
        while (result.firstChild) hidden.appendChild(result.firstChild);
        result.appendChild(hidden);
      }
      const row = block && block.querySelector('[data-bad-term="balanceAfterDeductions"]');
      paintTermFace(result, 'balanceAfterDeductions', termDisplay(row, status), 'blend-bad');
    }
  }

  function markResultClosed(hero) {
    const value = hero.querySelector('[data-operating-question="07"] .budget-step-value');
    if (!value) return;
    const shown = value.querySelector('[data-blend-term="balanceAfterDeductions"]');
    const root = hero.closest('[data-budget-bento]') || document;
    const closed = !!root.querySelector('[data-operating-plan="unavailable"]')
      || !shown
      || shown.classList.contains('is-unavailable')
      || !moneyToken(text(shown));
    value.classList.toggle('is-fail-closed', closed);
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
    const body = document.createElement('div');
    body.className = 'blend-hero-panel-body';
    panel.append(summary, body);
    hero.appendChild(panel);
    return panel;
  }

  function panelBody(panel) {
    return panel.querySelector('.blend-hero-panel-body') || panel;
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
    const received = moneyToken(text(step && step.querySelector('[data-budget-ratio="income"] [data-budget-ratio-actual]')));
    const head = document.createElement('span');
    head.className = 'blend-tile-head';
    const title = document.createElement('span');
    title.className = 'blend-tile-title';
    title.textContent = 'Income';
    const meta = document.createElement('span');
    meta.className = 'blend-income-in';
    if (received) meta.textContent = received + ' in';
    head.append(tileIcon('income'), title, meta);
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
    rail.className = 'blend-deps';
    const line = document.createElement('i');
    line.className = 'blend-dep-line';
    line.setAttribute('aria-hidden', 'true');
    rail.appendChild(line);
    const rows = depositRows(step || bento);
    let seenWaiting = false;
    const todayMarked = !!document.querySelector('.budget-window-days .is-today, [data-budget-window-progress] .is-today');
    rows.forEach(row => {
      const receivedRow = depositReceived(row);
      if (todayMarked && !seenWaiting && !receivedRow && rail.querySelector('.blend-dep')) {
        const tick = document.createElement('i');
        tick.className = 'blend-dep-today';
        tick.setAttribute('aria-hidden', 'true');
        rail.appendChild(tick);
        seenWaiting = true;
      }
      if (!receivedRow) seenWaiting = true;
      const item = document.createElement('span');
      item.className = 'blend-dep' + (receivedRow ? ' is-got' : ' is-wait');
      const mark = document.createElement('i');
      mark.className = receivedRow ? 'is-got' : 'is-wait';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = receivedRow ? '✓' : '';
      const caption = document.createElement('span');
      const when = depositDate(row);
      const name = depositName(row);
      caption.textContent = [depositAmount(row), name].filter(Boolean).join(' ') + (when ? ' · ' + when : '');
      item.append(mark, caption);
      rail.appendChild(item);
    });
    if (todayMarked && !rail.querySelector('.blend-dep-today') && rows.length) {
      const tick = document.createElement('i');
      tick.className = 'blend-dep-today';
      tick.setAttribute('aria-hidden', 'true');
      const waiting = rail.querySelector('.blend-dep.is-wait');
      if (waiting) rail.insertBefore(tick, waiting);
      else rail.appendChild(tick);
    }
    const muted = document.createElement('span');
    muted.className = 'blend-muted';
    const value = step && step.querySelector('.budget-step-value');
    muted.textContent = printedStep(value);
    if (received && muted.textContent) muted.classList.add('blend-clip');
    button.append(head, figure, rail);
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
    if (/\boverdue\b/i.test(state)) return 'overdue';
    if (!state || /status unavailable|unknown|unavailable|not observed/i.test(state)) return 'unknown';
    if (/paid/i.test(state) && !/not paid|unpaid|not confirmed/i.test(state)) return 'paid';
    if (/confirm|needs a date/i.test(state)) return 'confirm';
    if (/pending/i.test(state)) return 'pending';
    if (/not paid|^due\b|planned/i.test(state)) return 'due';
    return 'unknown';
  }

  function printedOverdueCount(section) {
    const named = section.querySelector('[data-budget-overdue-count], [data-budget-bills-overdue]');
    if (named) {
      const found = text(named).match(/\d+/);
      return found ? Number(found[0]) : 0;
    }
    const label = [...section.querySelectorAll('h3, .budget-browse-pill, p')].find(node => /^Overdue\s+\d+\b/i.test(text(node)));
    if (!label) return null;
    const found = text(label).match(/\d+/);
    return found ? Number(found[0]) : null;
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
    head.appendChild(tileIcon('bills'));
    const rows = [...section.querySelectorAll('.budget-bill-row')];
    const confirmRows = rows.filter(row => billState(row) === 'confirm');
    const overdueCount = printedOverdueCount(section);
    const past = selectedPeriodIsPast(bento);
    let remain = null;
    if (!past) {
      remain = document.createElement('span');
      remain.className = 'blend-bills-of';
      const leftRaw = text(section.querySelector('[data-budget-browse-bills-remaining]'));
      const planRaw = text(section.querySelector('[data-budget-ratio="bills"] [data-budget-ratio-plan]'));
      const billsStatus = text(section.querySelector('[data-budget-ratio="bills"]'));
      const leftMoney = moneyToken(leftRaw);
      const planMoney = moneyToken(planRaw);
      const statusUnavailable = !planMoney && /unknown|unavailable/i.test(billsStatus + ' ' + leftRaw);
      if (statusUnavailable) {
        remain.textContent = 'Unavailable';
      } else if (!rows.length) {
        remain.textContent = 'No bills assigned';
        remain.classList.add('is-empty');
      } else if (leftMoney && planMoney) {
        const est = /estimated|≈/.test(leftRaw + ' ' + planRaw) ? ' est.' : '';
        remain.textContent = leftMoney + ' left of ' + planMoney + est;
      } else {
        remain.textContent = 'Unavailable';
      }
    }
    head.appendChild(title);
    if (confirmRows.length > 0) {
      const flag = document.createElement('span');
      flag.className = 'blend-flag';
      flag.textContent = 'To confirm ' + confirmRows.length;
      head.appendChild(flag);
    }
    if (overdueCount > 0) {
      const overdue = document.createElement('span');
      overdue.className = 'blend-flag is-overdue';
      overdue.textContent = 'Overdue ' + overdueCount;
      head.appendChild(overdue);
    }
    if (remain) head.appendChild(remain);
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
          const state = remain.textContent === 'Unavailable' ? 'unknown' : billState(hits[0]);
          if (state === 'overdue') day.classList.add('is-overdue');
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
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'blend-panel-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', panel.id);
    toggle.setAttribute('aria-label', 'Bills detail');
    toggle.textContent = 'Details ›';
    const openPanel = () => {
      panel.classList.add('is-open');
      toggle.setAttribute('aria-expanded', 'true');
    };
    toggle.addEventListener('click', () => {
      const open = panel.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    panel.addEventListener('focusin', openPanel);
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
      button.setAttribute('data-blend-opened', '1');
      row.click();
      if (!sheet || !sheet.open) button.removeAttribute('data-blend-opened');
    });
    if (sheet && sheet.dataset.blendRingClose !== '1') {
      sheet.dataset.blendRingClose = '1';
      sheet.addEventListener('close', () => {
        const opened = document.querySelector('[data-blend-opened="1"]');
        document.querySelectorAll('.blend-ring[aria-expanded="true"], .blend-other[aria-expanded="true"]').forEach(node => {
          node.setAttribute('aria-expanded', 'false');
        });
        if (opened) {
          opened.removeAttribute('data-blend-opened');
          queueMicrotask(() => {
            if (opened.isConnected) opened.focus({ preventScroll: true });
          });
          return;
        }
        queueMicrotask(() => {
          const current = document.activeElement;
          if (!current || current === document.body || !current.getBoundingClientRect) return;
          const dock = document.querySelector('.sitenav-household');
          const limit = dock && getComputedStyle(dock).position === 'fixed'
            ? dock.getBoundingClientRect().top : window.innerHeight;
          const box = current.getBoundingClientRect();
          if (box.height < 1 || box.top < 0 || box.bottom > limit - 4) {
            current.scrollIntoView({ block: 'center', inline: 'nearest' });
          }
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
    const titleWrap = header && (header.querySelector('h2')?.parentElement || header);
    if (titleWrap && !header.querySelector('.blend-tile-ico')) {
      titleWrap.prepend(tileIcon('house'));
      const chev = document.createElement('span');
      chev.className = 'blend-house-chev';
      chev.setAttribute('aria-hidden', 'true');
      chev.textContent = '›';
      header.querySelector('h2')?.after(chev);
    }
    if (header && facts) {
      facts.classList.add('blend-house-facts');
      header.appendChild(facts);
    }
    if (counts) counts.classList.add('blend-house-status');
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
      word.className = 'blend-other-state';
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
    const body = document.createElement('div');
    body.className = 'blend-house-body';
    if (counts) body.appendChild(counts);
    const remainBlock = section.querySelector('[data-budget-browse-remaining]')?.parentElement;
    if (remainBlock) remainBlock.classList.add('blend-house-remain');
    [remainBlock?.querySelector(':scope > span'), remainBlock?.querySelector('small'), section.querySelector('.budget-browse-cycle')]
      .forEach(node => { if (node) body.appendChild(node); });
    more.appendChild(body);
    (section.querySelector('.blend-other') || rings).after(more);
    section.querySelectorAll('.budget-category-list, .budget-pace-key').forEach(node => {
      node.classList.add('blend-in-panel');
    });
    clip(section.querySelector('footer'));
    section.querySelectorAll('.budget-browse-eyebrow, .budget-browse-sub').forEach(clip);
  }

  function paintCards(bento) {
    const heading = bento.querySelector('.card-movement-heading');
    if (heading && !heading.querySelector('.blend-tile-ico')) heading.prepend(tileIcon('cards'));
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
      const goalAmount = label => {
        const node = [...row.querySelectorAll('.budget-goal-amounts > span')].find(span => new RegExp('^' + label + '$', 'i').test(text(span.querySelector('small'))));
        return node ? node.querySelector('.budget-goal-amount') : null;
      };
      const visibleAmount = node => {
        if (!node) return '';
        const clone = node.cloneNode(true);
        clone.querySelectorAll('.budget-cash-sr').forEach(hidden => hidden.remove());
        return text(clone);
      };
      const appendPrintedAmount = (line, amountNode) => {
        const walk = node => {
          node.childNodes.forEach(child => {
            if (child.nodeType === 3) {
              const value = child.textContent.replace(/\s+/g, ' ');
              if (!value) return;
              value.split('≈').forEach((part, index) => {
                if (index > 0) {
                  const mark = document.createElement('span');
                  mark.className = 'budget-v3-est';
                  mark.textContent = '≈';
                  line.appendChild(mark);
                }
                if (part) line.appendChild(document.createTextNode(part));
              });
              return;
            }
            if (child.nodeType === 1 && !child.classList.contains('budget-cash-sr')) walk(child);
          });
        };
        walk(amountNode);
      };
      const savedNode = goalAmount('Saved');
      const neededNode = goalAmount('Needed');
      const savedAmount = visibleAmount(savedNode);
      const neededAmount = visibleAmount(neededNode);
      const printedMoney = value => /\$[\d,]/.test(value || '');
      detail.textContent = status || (/Unavailable/i.test(amounts) ? 'Unavailable' : /Unknown/i.test(amounts) ? 'Unknown' : '');
      const stack = document.createElement('span');
      stack.className = 'blend-goal-status';
      stack.appendChild(detail);
      if (printedMoney(savedAmount)) {
        const saved = document.createElement('span');
        saved.className = 'blend-goal-saved';
        saved.appendChild(document.createTextNode('Saved '));
        appendPrintedAmount(saved, savedNode);
        stack.appendChild(saved);
      }
      if (printedMoney(neededAmount)) {
        const needed = document.createElement('span');
        needed.className = 'blend-goal-needed';
        needed.appendChild(document.createTextNode('Needed '));
        appendPrintedAmount(needed, neededNode);
        stack.appendChild(needed);
      }
      item.append(name, stack);
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
    title.className = 'blend-tile-head';
    const name = document.createElement('span');
    name.className = 'blend-tile-title';
    name.textContent = text(card.querySelector('h3')) || 'Saving for';
    title.append(tileIcon('goals'), name);
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
