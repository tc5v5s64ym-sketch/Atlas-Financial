'use strict';
/* Visual layer for the Budget bento. Copies text the page already rendered.
   Does not read Forecast, total money, or invent a figure. */
(function blendBudget() {
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  let categoryFocusReturn = null;

  function clip(node) {
    if (node) node.classList.add('blend-clip');
  }

  function text(node) {
    return (node && node.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // Join the printed node's own pieces with spaces. Skip chips this skin
  // added. Do not trim inside a piece, and do not drop "≈" or "estimated".
  function separatedText(node) {
    if (!node) return '';
    const bits = [];
    const walk = el => {
      if (!el) return;
      if (el.nodeType === 3) {
        const raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (raw) bits.push(raw);
        return;
      }
      if (el.nodeType !== 1) return;
      if (el.classList.contains('blend-est') || el.classList.contains('blend-term')) return;
      for (const child of el.childNodes) walk(child);
    };
    walk(node);
    return bits.join(' ');
  }

  function printedMagnitude(value) {
    const match = String(value || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const number = Number(match[0]);
    return Number.isFinite(number) ? Math.abs(number) : null;
  }

  function moneyToken(value) {
    const found = String(value || '').match(/-?\$[\d,]+(?:\.\d{2})?/);
    return found ? found[0] : '';
  }

  function place(bento) {
    const hero = bento.querySelector('.budget-blend-hero-layout');
    if (!hero) return;
    hero.classList.add('blend-hero', 'blend-tilt', 'tile', 't-hero');
    bento.classList.add('atlas-g');
    if (!document.querySelector('.blend-ambient')) {
      const ambient = document.createElement('div');
      ambient.className = 'blend-ambient';
      ambient.setAttribute('aria-hidden', 'true');
      ambient.innerHTML = '<i class="a1"></i><i class="a2"></i><i class="a3"></i>';
      document.body.prepend(ambient);
    }
    if (!hero.dataset.blendOpen) {
      hero.dataset.blendOpen = '1';
      hero.addEventListener('click', event => {
        if (event.target.closest('a, button, input, .blend-hero-pill, .blend-hero-foot')) return;
        if (event.target.closest('summary')) return;
        hero.querySelector('[data-operating-question="07"] .budget-step-summary')?.click();
      });
    }
    if (!hero.querySelector('.blend-sky')) {
      const sky = document.createElement('div');
      sky.className = 'blend-sky';
      sky.setAttribute('aria-hidden', 'true');
      sky.innerHTML = '<i class="b1"></i><i class="b2"></i><i class="b3"></i>';
      hero.prepend(sky);
    }
    if (!hero.querySelector('.blend-aurora')) {
      const canvas = document.createElement('canvas');
      canvas.className = 'blend-aurora';
      canvas.setAttribute('data-aurora', '');
      canvas.setAttribute('aria-hidden', 'true');
      hero.prepend(canvas);
    }
    if (globalThis.Aurora && hero.dataset.auroraOn !== '1') {
      hero.dataset.auroraOn = '1';
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      globalThis.Aurora.init(hero.querySelector('.blend-aurora'), { reduce: reduce });
      globalThis.Aurora.set('healthy');
      const theme = document.documentElement.getAttribute('data-theme');
      const dark = theme === 'dark' || (!theme && matchMedia('(prefers-color-scheme: dark)').matches);
      globalThis.Aurora.setLight(dark ? 1.15 : 1.5);
    }
    const tight = hero.querySelector('[data-operating-question="07"] [data-sign="negative"]')
      || hero.querySelector('.budget-cash-notice.has-gap');
    hero.classList.toggle('is-tight', !!tight);
    const progress = bento.querySelector('[data-budget-window-progress]');
    if (progress && progress.parentElement !== bento) {
      progress.classList.add('blend-pay', 'blend-tilt', 'tile', 't-pay');
      bento.appendChild(progress);
    }
    const header = bento.querySelector('[data-budget-window-header]');
    const granularityFocus = header?.contains(document.activeElement)
      && document.activeElement.hasAttribute('data-budget-granularity');
    // Retain the native selection handlers and printed date identity as an
    // internal source. The river is the period control; no alternate chooser.
    if (header) header.hidden = true;
    const guard = (label, fn) => {
      try { fn(); }
      catch (error) { console.error('Budget blend stopped on ' + label, error); }
    };
    guard('payday', () => paintPayday(progress));
    guard('hero', () => paintHero(hero));
    // Income remains in the hero equation and its original native evidence.
    // The owner removed the separate tile from the approved face.
    bento.querySelector('.blend-income')?.remove();
    guard('bills', () => paintBills(bento));
    guard('household', () => paintHouse(bento));
    guard('cards', () => paintCards(bento));
    guard('goals', () => paintGoals(bento));
    guard('funding', () => parkFunding(bento));
    guard('badges', () => paintFaceBadges(bento));
    guard('quiet', () => paintQuiet(bento));
    guard('river', () => paintRiver(bento));
    guard('lift', () => liftFace(bento));
    // Native Month/drilldown remounts focus the Pay period toggle before
    // this adapter moves it into the disclosure. Restore a visible opener.
    if (granularityFocus) hero.querySelector('[data-blend-figures-open]')?.focus({ preventScroll: true });
    bento.querySelectorAll('[data-budget-browse="bills"], [data-budget-browse="spending"], .budget-blend-card-movements, [data-budget-savings-goals]')
      .forEach(node => node.classList.add('blend-tilt'));
  }

  function liftFace(bento) {
    const active = document.activeElement;
    const restoreFocus = active && active !== document.body && bento.contains(active);
    const header = bento.querySelector('[data-budget-window-header]');
    const river = bento.querySelector('.g-river-wrap');
    const quiet = bento.querySelector('.blend-quiet');
    if (header) bento.appendChild(header);
    if (river) bento.appendChild(river);
    stackBoard(bento);
    if (quiet) bento.appendChild(quiet);
    const cards = bento.querySelector('.budget-blend-card-movements');
    const browse = bento.querySelector(':scope > .budget-browse-grid');
    if (cards && browse) cards.after(browse);
    bento.querySelectorAll(':scope > .budget-surface-grid, :scope > .budget-browse-grid').forEach(node => {
      node.classList.add('g-source');
    });
    if (restoreFocus && active.isConnected && document.activeElement !== active) active.focus({ preventScroll: true });
  }

  // Two independent columns with fixed membership. On phones, move the
  // same tiles into the approved reading order so keyboard order follows
  // the visible stack. Payday stays in the tree, off the face.
  function stackBoard(bento) {
    let board = bento.querySelector(':scope > .blend-board');
    if (!board) {
      board = document.createElement('div');
      board.className = 'blend-board';
      const left = document.createElement('div');
      left.className = 'blend-col blend-col-main';
      const right = document.createElement('div');
      right.className = 'blend-col blend-col-side';
      board.append(left, right);
    }
    bento.appendChild(board);
    const left = board.querySelector('.blend-col-main');
    const right = board.querySelector('.blend-col-side');
    const find = selector => bento.querySelector(selector);
    const hero = find('.budget-blend-hero-layout');
    const house = find('[data-budget-browse="spending"]');
    const bills = find('[data-budget-browse="bills"]');
    const cards = find('.budget-blend-card-movements');
    const goals = find('[data-budget-savings-goals]');
    const pay = find('.blend-pay');
    const placeTiles = () => {
      const active = document.activeElement;
      const restoreFocus = active && board.contains(active);
      if (pay) {
        pay.classList.add('blend-sr');
        bento.appendChild(pay);
      }
      const phone = window.matchMedia('(max-width: 759px)').matches;
      if (phone) {
        [hero, bills, house, cards, goals].filter(Boolean).forEach(node => board.appendChild(node));
      } else {
        [hero, bills, cards].filter(Boolean).forEach(node => left.appendChild(node));
        [house, goals].filter(Boolean).forEach(node => right.appendChild(node));
      }
      if (restoreFocus && document.activeElement !== active) active.focus({ preventScroll: true });
    };
    placeTiles();
    if (!bento.dataset.blendStacked) {
      bento.dataset.blendStacked = '1';
      let frame = 0;
      window.addEventListener('resize', () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(placeTiles);
      });
    }
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
    if (!progress || progress.querySelector('.blend-pay-face, .blend-pay-main')) return;
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
    const printedDate = /^[A-Z][a-z]{2}\s+\d{1,2}$/.test(published) ? published : '';
    const marks = [...progress.querySelectorAll('.budget-window-days > span')];
    const current = selectedPeriodIsCurrent(progress.closest('[data-budget-bento]') || document);
    progress.querySelector('p')?.classList.add('blend-clip');
    if (current) {
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
      progress.appendChild(face);
      if (printedDate) {
        const date = document.createElement('span');
        date.className = 'blend-pay-date';
        date.textContent = printedDate;
        progress.appendChild(date);
      }
    } else {
      const statusText = text(progress.querySelector('p > span'));
      const shown = printedDate || statusText;
      const main = document.createElement('span');
      main.className = 'blend-pay-main' + (shown ? '' : ' is-unavailable');
      main.textContent = shown || 'Unavailable';
      progress.appendChild(main);
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
    if (savings) {
      savings.classList.add('blend-hero-pill');
      savings.querySelector('.operating-number')?.classList.add('blend-clip');
      const summary = savings.querySelector('summary') || savings;
      if (!summary.querySelector('.blend-save-ico')) {
        const ico = document.createElement('span');
        ico.className = 'blend-save-ico';
        ico.setAttribute('aria-hidden', 'true');
        ico.appendChild(tileGlyph('goals'));
        summary.prepend(ico);
      }
    }
    [afterBills, closing].forEach(node => {
      if (node && node.parentElement !== body) body.appendChild(node);
    });
    if (savings && savings.parentElement !== foot) foot.appendChild(savings);
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
    paintAfterFunding(hero);
    paintFinalResult(hero.closest('[data-budget-bento]') || document);
    paintIncomeLongLabel(hero);
    paintPlanStatus(hero);
    paintSplit(hero, foot);
    wirePeriodFigures(hero, body);
  }

  function wirePeriodFigures(hero, body) {
    const result = hero.querySelector('[data-operating-question="07"]');
    const trigger = result?.querySelector('.budget-step-summary');
    const figures = document.querySelector('[data-budget-period-info-body]');
    const sheet = document.querySelector('[data-budget-detail-sheet]')?.budgetSheet;
    if (!trigger || !figures || !sheet) return;
    const granularity = document.querySelector('[data-budget-window-header] .budget-granularity');
    if (granularity && !figures.contains(granularity)) figures.prepend(granularity);
    // Preserve every original qualifier and evidence node. The visible result
    // is the keyboard opener; no financial text or values are regenerated.
    const resultBody = result.querySelector('.budget-step-body');
    if (resultBody && !figures.contains(resultBody)) figures.appendChild(resultBody);
    [...body.children].forEach(node => {
      if (!node.classList.contains('budget-period-info') && node !== figures && !node.contains(figures))
        figures.appendChild(node);
    });
    if (!figures.id) figures.id = 'budget-period-figures';
    trigger.setAttribute('aria-controls', figures.id);
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', String(!!figures.closest('dialog[open]')));
    if (trigger.hasAttribute('data-blend-figures-open')) return;
    trigger.setAttribute('data-blend-figures-open', '');
    trigger.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      sheet.open(figures, trigger, 'Period figures');
    }, true);
  }

  function paintPlanStatus(hero) {
    // Forecast's status describes the whole planning window. A verdict beside
    // these dates requires a qualified selected-period publication from Forecast.
    // Keep the native status band and its identity hook; clear only face additions.
    hero.querySelector('.blend-plan-chip')?.remove();
    hero.querySelector('.blend-plan-note')?.remove();
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

  // Path A: a non-empty [data-bad-term-amount] is the bare amount. An est.
  // chip is added only when that row's trust is estimated. Only the span's
  // own text is read, so the ≈ mark in the value is not copied again.
  // An empty or whitespace-only amount span is absent.
  // Unavailable trust is decided before the span is read.
  // Path B: no usable amount span — the value text is copied verbatim,
  // including "≈ estimated" when that is what was printed, and no chip is added.
  function termDisplay(row, blockStatus) {
    const trust = row ? (row.getAttribute('data-bad-term-trust') || '') : '';
    if (blockStatus !== 'published' || !row || trust === 'unavailable') {
      return { text: 'Unavailable', chip: false, unavailable: true };
    }
    const bare = text(row.querySelector('[data-bad-term-amount]'));
    if (bare) return { text: bare, chip: trust === 'estimated', unavailable: false };
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

  // Concatenate each printed node's textContent. Do not trim an inner node:
  // the space before "$" is the leading character of that text node.
  function copiedPrintedText(node) {
    let copied = '';
    for (const child of node.childNodes) {
      if (child.nodeType === 3 || child.nodeType === 1) copied += child.textContent;
    }
    return copied;
  }

  // The printed prompt beside the Q07 value. A colon is dropped only when
  // that colon is its own node. The caller keeps this text, verbatim.
  function printedQ07Prompt(value) {
    const row = value && value.closest('[data-operating-question="07"][data-budget-period-result]');
    const prompt = row && row.querySelector('.budget-step-summary .operating-prompt');
    let copied = '';
    if (!prompt) return '';
    for (const node of prompt.childNodes) {
      const raw = node.textContent || '';
      if (raw.trim() === ':') continue;
      copied += raw;
    }
    return copied;
  }

  function appendAfterLine(line, value, valueText) {
    const printed = printedQ07Prompt(value);
    if (printed) {
      const hidden = document.createElement('span');
      hidden.className = 'blend-after-label budget-cash-sr';
      hidden.textContent = printed;
      line.appendChild(hidden);
    }
    const name = document.createElement('span');
    name.className = 'blend-after-visible';
    name.textContent = 'After proposed savings';
    line.appendChild(name);
    const shown = document.createElement('span');
    shown.className = 'blend-after-value';
    shown.textContent = valueText;
    line.appendChild(shown);
    return shown;
  }

  // On an after-proposed-funding period the '=' slot stays the pre-funding
  // Balance After Deductions figure. The printed note says those terms are
  // before proposed savings funding. The printed Q07 value is the after
  // figure and is shown, not left in the clip. Nothing here is calculated.
  function paintSplit(hero, foot) {
    if (!foot || foot.querySelector('.blend-split')) return;
    const read = selector => printedMagnitude(text(hero.querySelector(selector)));
    const parts = [
      ['s-bills', read('[data-operating-question="04"] .blend-term')],
      ['s-house', read('[data-operating-question="06"] .blend-term')],
      ['s-bad', read('[data-blend-term="balanceAfterDeductions"]')],
    ];
    const split = document.createElement('span');
    split.className = 'blend-split';
    split.setAttribute('aria-hidden', 'true');
    const total = parts.reduce((sum, part) => sum + (part[1] > 0 ? part[1] : 0), 0);
    if (!total) {
      split.classList.add('is-untracked');
      const mark = document.createElement('b');
      mark.className = 'blend-untracked-mark';
      mark.textContent = '—';
      split.appendChild(mark);
    } else {
      parts.forEach(([name, amount]) => {
        const segment = document.createElement('i');
        segment.className = name;
        if (amount == null) segment.classList.add('is-untracked');
        else segment.style.setProperty('--w', (amount / total * 100).toFixed(2) + '%');
        split.appendChild(segment);
      });
    }
    foot.appendChild(split);
  }

  // Text only. Number('') is 0, so an empty span must never become $0.00.
  function resultAmountDecision(trust, raw) {
    const bare = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    if (trust === 'unavailable' || bare.length === 0) return 'Unavailable';
    return bare;
  }

  function budgetResultHook(hero) {
    const host = hero.querySelector('[data-operating-question="07"][data-budget-result-trust]')
      || hero.querySelector('[data-budget-period-result][data-budget-result-trust]');
    if (!host) return null;
    const amount = host.querySelector('[data-budget-result-amount]');
    if (!amount) return null;
    const trust = host.getAttribute('data-budget-result-trust') || '';
    const shown = resultAmountDecision(trust, amount.textContent);
    return { trust: trust, shown: shown, closed: shown === 'Unavailable' };
  }

  function paintFinalResult(root) {
    root.querySelectorAll('.budget-period-result[data-budget-result-trust]').forEach(host => {
      const span = host.querySelector('[data-budget-result-amount]');
      const value = host.querySelector('.budget-period-result-value');
      if (!span || !value) return;
      const trust = host.getAttribute('data-budget-result-trust') || '';
      const decision = resultAmountDecision(trust, span.textContent);
      if (decision !== 'Unavailable') return;
      const current = (value.textContent || '').replace(/\s+/g, ' ').trim();
      if (current === 'Unavailable') return;
      const kept = document.createElement('span');
      kept.setAttribute('data-budget-result-amount', '');
      value.replaceChildren(document.createTextNode('Unavailable'), kept);
    });
  }

  function paintAfterFunding(hero) {
    const block = badTermsBlock(hero);
    if (!block || block.getAttribute('data-bad-terms-face') !== 'after-proposed-funding') return;
    const note = text(block.querySelector('.operating-note'));
    const copied = (note.match(/before proposed savings funding/) || [])[0];
    const prompt = hero.querySelector('[data-operating-question="07"] .operating-prompt');
    if (copied && prompt && !prompt.parentElement.querySelector('.blend-bad-qualifier')) {
      const qualifier = document.createElement('span');
      qualifier.className = 'blend-bad-qualifier';
      qualifier.textContent = ' · ' + copied;
      prompt.after(qualifier);
    }
    const value = hero.querySelector('[data-operating-question="07"] .budget-step-value');
    const clip = value && value.querySelector(':scope > .blend-clip');
    const bad = value && value.querySelector('.blend-bad');
    if (!clip || !bad || bad.querySelector('.blend-after-funding') || !clip.childNodes.length) return;
    const line = document.createElement('p');
    line.className = 'blend-after-funding';
    const hook = budgetResultHook(hero);
    if (hook) {
      appendAfterLine(line, value, hook.shown);
      if (!hook.closed && hook.trust === 'estimated') {
        const pill = document.createElement('span');
        pill.className = 'blend-est';
        pill.textContent = 'est.';
        line.appendChild(pill);
      }
      clip.remove();
      const dollars = bad.querySelector('.blend-dollars');
      const cents = bad.querySelector('.blend-cents');
      if (dollars && !dollars.parentElement.classList.contains('blend-dollar-group')) {
        const group = document.createElement('span');
        group.className = 'blend-dollar-group';
        dollars.before(group);
        group.appendChild(dollars);
        if (cents) group.appendChild(cents);
      }
      bad.appendChild(line);
      return;
    }
    const amount = [...clip.querySelectorAll('[data-bad-term-amount]')].find(node => !node.closest('[data-bad-terms]')) || null;
    const bare = text(amount);
    const trustHost = amount && amount.closest('[data-bad-term]');
    const trust = trustHost ? (trustHost.getAttribute('data-bad-term-trust') || '') : '';
    if (amount && trust === 'unavailable') {
      appendAfterLine(line, value, 'Unavailable');
      clip.remove();
    } else if (bare) {
      appendAfterLine(line, value, bare);
      if (trust === 'estimated') {
        const pill = document.createElement('span');
        pill.className = 'blend-est';
        pill.textContent = 'est.';
        line.appendChild(pill);
      }
      clip.remove();
    } else {
      appendAfterLine(line, value, copiedPrintedText(clip));
      clip.remove();
    }
    const dollars = bad.querySelector('.blend-dollars');
    const cents = bad.querySelector('.blend-cents');
    if (dollars && !dollars.parentElement.classList.contains('blend-dollar-group')) {
      const group = document.createElement('span');
      group.className = 'blend-dollar-group';
      dollars.before(group);
      group.appendChild(dollars);
      if (cents) group.appendChild(cents);
    }
    bad.appendChild(line);
  }

  function paintIncomeLongLabel(hero) {
    const body = panelBody(heroPanel(hero));
    if (!body || body.querySelector('.blend-income-long')) return;
    const note = document.createElement('p');
    note.className = 'blend-income-long budget-cash-sr';
    note.textContent = 'Period income, counted in Balance After Deductions';
    body.appendChild(note);
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
    summary.className = 'blend-clip';
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

  function checkGlyph() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M5 12.5 10 17.5 19 7');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#fff');
    path.setAttribute('stroke-width', '3');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return svg;
  }

  function billIcon(label) {
    const s = String(label || '').toLowerCase();
    const name = !s ? 'card'
      : /rent|mortgage|house|property|home/.test(s) ? 'house'
      : /\bcar\b|auto|vehicle/.test(s) ? 'car'
      : /hydro|electric|power|bolt/.test(s) ? 'bolt'
      : /wifi|internet|shaw|telus|rogers|phone/.test(s) ? 'wifi'
      : /card|visa|mastercard|mbna|amex|credit/.test(s) ? 'card'
      : 'card';
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
    section.classList.add('tile', 't-bills');
    const progress = document.querySelector('[data-budget-window-progress]');
    const start = progress && progress.getAttribute('data-start');
    const end = progress && progress.getAttribute('data-end');
    const asOf = progress && progress.getAttribute('data-as-of');
    const head = document.createElement('div');
    head.className = 'blend-bills-head';
    const title = document.createElement('span');
    title.className = 'blend-tile-title';
    title.textContent = 'Bills';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'blend-bills-open';
    toggle.setAttribute('data-blend-bills-open', '');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Bills detail');
    toggle.append(tileIcon('bills'), title);
    head.appendChild(toggle);
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
        remain.classList.add('is-unavailable');
      } else if (!rows.length) {
        remain.textContent = 'No bills assigned';
        remain.classList.add('is-empty');
      } else if (leftMoney && planMoney) {
        remain.appendChild(document.createTextNode(leftMoney + ' left of ' + planMoney));
        if (/estimated|≈/.test(leftRaw + ' ' + planRaw)) {
          const est = document.createElement('span');
          est.className = 'blend-est';
          est.textContent = 'est.';
          remain.appendChild(est);
        }
      } else {
        remain.textContent = 'Unavailable';
        remain.classList.add('is-unavailable');
      }
    }
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
    cal.className = 'blend-cal cal';
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
        day.className = 'blend-day day' + (iso === asOf ? ' is-today' : '');
        const n = document.createElement('span');
        n.className = 'blend-day-n day-n';
        n.textContent = String(date.getDate());
        day.appendChild(n);
        const hits = byDay.get(iso) || [];
        if (hits.length) {
          day.classList.add('has');
          const mark = document.createElement('button');
          mark.type = 'button';
          mark.className = 'blend-day-hit day-g';
          mark.setAttribute('aria-label', hits.map(row => separatedText(row)).join('; '));
          mark.setAttribute('aria-haspopup', 'dialog');
          const state = remain && remain.textContent === 'Unavailable' ? 'unknown' : billState(hits[0]);
          if (state === 'overdue') day.classList.add('is-overdue');
          mark.dataset.s = state;
          const printedLabel = text(hits[0].querySelector('.budget-bill-label strong'));
          mark.appendChild(billIcon(printedLabel));
          // Count only. One bill is ~20% of --bills (0.32 × 62%). Extra
          // bills step up and stay under the hot threshold. Amounts are not read.
          const heat = hits.length <= 1 ? 0.32 : hits.length === 2 ? 0.42 : 0.50;
          day.style.setProperty('--heat', heat.toFixed(2));
          if (state !== 'unknown') {
            const badge = document.createElement('i');
            badge.className = 'blend-state day-s' + (state === 'confirm' ? ' blend-pulse' : '');
            badge.dataset.s = state;
            badge.setAttribute('aria-hidden', 'true');
            if (state === 'paid') badge.appendChild(checkGlyph());
            day.appendChild(badge);
          }
          mark.setAttribute('data-blend-bill', (hits[0].getAttribute('data-budget-bill-open') || '') + ':' + iso);
          markSheet(mark, hits[0]);
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
    panel.setAttribute('data-blend-bills-panel', '');
    toggle.setAttribute('aria-controls', panel.id);
    const sheet = document.querySelector('[data-budget-detail-sheet]');
    const native = typeof sheet?.budgetSheet?.open === 'function';
    if (native) {
      panel.hidden = true;
      toggle.setAttribute('aria-haspopup', 'dialog');
    }
    toggle.addEventListener('click', () => {
      if (native) {
        sheet.budgetSheet.open(panel, toggle, 'Bills');
        return;
      }
      const open = panel.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
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
    const categoryId = button.getAttribute('data-blend-cat');
    const attribute = categoryId ? 'data-blend-cat' : 'data-blend-bill';
    const id = button.getAttribute(attribute);
    const kind = button.classList.contains('blend-day-hit') ? '.blend-day-hit'
      : button.classList.contains('blend-other') ? '.blend-other' : '.blend-ring';
    if (sheet && !sheet.id) sheet.id = 'budget-detail-sheet';
    button.setAttribute('aria-haspopup', 'dialog');
    if (sheet) button.setAttribute('aria-controls', sheet.id);
    button.setAttribute('aria-expanded', 'false');
    if (sheet?.open && id && categoryFocusReturn?.id === id
      && (!categoryId || sheet.querySelector('[data-budget-category="' + CSS.escape(categoryId) + '"]'))) {
      categoryFocusReturn.node = button;
      button.setAttribute('aria-expanded', 'true');
      button.setAttribute('data-blend-opened', '1');
    }
    button.addEventListener('click', () => {
      button.setAttribute('aria-expanded', 'true');
      button.setAttribute('data-blend-opened', '1');
      categoryFocusReturn = { node: button, id, kind, attribute };
      if (window.BudgetSheetMotion?.from) window.BudgetSheetMotion.from(button, () => row.click());
      else row.click();
      if (!sheet || !sheet.open) {
        button.removeAttribute('data-blend-opened');
        button.setAttribute('aria-expanded', 'false');
        if (categoryFocusReturn?.node === button) categoryFocusReturn = null;
      }
    });
    if (sheet && sheet.dataset.blendRingClose !== '1') {
      sheet.dataset.blendRingClose = '1';
      sheet.addEventListener('close', () => {
        // A remount may already have restored this native dialog. Keep its
        // return identity until that dialog actually closes.
        if (document.querySelector('[data-budget-detail-sheet]')?.open) return;
        const opened = document.querySelector('[data-blend-opened="1"]');
        const returnTo = categoryFocusReturn || (opened ? {
          node: opened, id: opened.getAttribute('data-blend-cat') || opened.getAttribute('data-blend-bill'),
          attribute: opened.hasAttribute('data-blend-cat') ? 'data-blend-cat' : 'data-blend-bill',
          kind: opened.classList.contains('blend-day-hit') ? '.blend-day-hit'
            : opened.classList.contains('blend-other') ? '.blend-other' : '.blend-ring',
        } : null);
        document.querySelectorAll('[data-blend-opened="1"]').forEach(node => {
          node.setAttribute('aria-expanded', 'false');
        });
        document.querySelectorAll('[data-blend-opened="1"]').forEach(node => node.removeAttribute('data-blend-opened'));
        if (returnTo) {
          categoryFocusReturn = returnTo;
          const restore = attempt => {
            if (categoryFocusReturn !== returnTo || document.querySelector('[data-budget-detail-sheet]')?.open) return;
            const visible = node => node?.isConnected && node.getClientRects().length
              && getComputedStyle(node).visibility !== 'hidden';
            const target = visible(returnTo.node) ? returnTo.node : returnTo.id
              ? [...document.querySelectorAll(returnTo.kind + '[' + (returnTo.attribute || 'data-blend-cat') + '="' + CSS.escape(returnTo.id) + '"]')].find(visible) : null;
            if (target) {
              target.focus({ preventScroll: true });
              if (document.activeElement === target) {
                target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                categoryFocusReturn = null;
                return;
              }
            }
            if (attempt === 0) requestAnimationFrame(() => restore(1));
            else categoryFocusReturn = null;
          };
          // Wait for native modal teardown and responsive DOM placement;
          // the incumbent close path may first try its hidden source row.
          requestAnimationFrame(() => restore(0));
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

  function categoryArc(share) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'blend-arc-ring');
    svg.setAttribute('aria-hidden', 'true');
    const ns = 'http://www.w3.org/2000/svg';
    const circle = (cls, extra) => {
      const node = document.createElementNS(ns, 'circle');
      node.setAttribute('cx', '50');
      node.setAttribute('cy', '50');
      node.setAttribute('r', '44');
      node.setAttribute('fill', 'none');
      node.setAttribute('class', cls);
      if (extra) Object.entries(extra).forEach(([key, value]) => node.setAttribute(key, value));
      svg.appendChild(node);
      return node;
    };
    const track = circle(share == null ? 'rg-track is-dotted' : 'rg-track');
    if (share > 0) {
      const circ = 2 * Math.PI * 44;
      const drawn = Math.max(0, Math.min(1, share)) * circ;
      circle('rg-arc', {
        stroke: 'currentColor',
        'stroke-width': '7',
        'stroke-linecap': 'round',
        transform: 'rotate(-90 50 50)',
        'stroke-dasharray': drawn.toFixed(2) + ' ' + circ.toFixed(2),
      });
    }
    const glass = document.createElementNS(ns, 'circle');
    glass.setAttribute('cx', '50');
    glass.setAttribute('cy', '50');
    glass.setAttribute('r', '38');
    glass.setAttribute('class', 'rg-glass');
    svg.appendChild(glass);
    track.setAttribute('stroke-width', '7');
    return svg;
  }

  // Decorative liquid requires the same known spent/plan geometry as the
  // arc. Its level is existing --left; no financial state is derived.
  let categoryLiquidSequence = 0;
  function categoryLiquid(share) {
    if (typeof share !== 'number' || !Number.isFinite(share) || share < 0 || share > 1) return null;
    const ns = 'http://www.w3.org/2000/svg';
    const liquid = document.createElementNS(ns, 'svg');
    liquid.setAttribute('class', 'blend-ring-liquid' + (share === 1 ? ' is-drained' : ''));
    liquid.setAttribute('viewBox', '0 0 100 100');
    liquid.setAttribute('aria-hidden', 'true');
    // Keep decorative waves in phase when native publication remounts a tile.
    liquid.style.setProperty('--blend-wave-phase', (-performance.now() / 1000).toFixed(3) + 's');
    const defs = document.createElementNS(ns, 'defs');
    const clip = document.createElementNS(ns, 'clipPath');
    const clipId = 'blend-liquid-' + (++categoryLiquidSequence);
    clip.id = clipId;
    const glass = document.createElementNS(ns, 'circle');
    glass.setAttribute('cx', '50'); glass.setAttribute('cy', '50'); glass.setAttribute('r', '38');
    clip.appendChild(glass); defs.appendChild(clip);
    const masked = document.createElementNS(ns, 'g');
    masked.setAttribute('clip-path', 'url(#' + clipId + ')');
    const water = document.createElementNS(ns, 'g');
    water.setAttribute('class', 'blend-ring-water');
    // Reuse the prototype's decorative wave path, never its financial ringState.
    let wavePath = 'M0 12';
    for (let x = 0; x < 200; x += 19) wavePath += ' Q' + (x + 9.5) + ' ' + (x / 19 % 2 ? 15.5 : 8.5) + ' ' + (x + 19) + ' 12';
    wavePath += ' V110 H0 Z';
    ['blend-ring-wave w2', 'blend-ring-wave'].forEach(className => {
      const wave = document.createElementNS(ns, 'path');
      wave.setAttribute('class', className); wave.setAttribute('d', wavePath);
      water.appendChild(wave);
    });
    masked.appendChild(water); liquid.append(defs, masked);
    return liquid;
  }

  function ringCentre(status) {
    const raw = String(status || '').replace(/\s+/g, ' ').trim();
    const wrap = document.createElement('span');
    wrap.className = 'blend-ring-v';
    const parts = raw.match(/^(-?\$[\d,]+)(\.\d{2})(?:\s+(\S+))?/);
    if (!parts) {
      wrap.textContent = raw || '—';
      if (!/\$[\d,]/.test(raw) || raw.length > 14) wrap.classList.add('is-word');
      return wrap;
    }
    const amt = document.createElement('span');
    amt.className = 'blend-ring-amt';
    amt.appendChild(document.createTextNode(parts[1]));
    const cents = document.createElement('span');
    cents.className = 'blend-cents';
    cents.textContent = parts[2];
    amt.appendChild(cents);
    wrap.appendChild(amt);
    if (parts[3]) {
      const gap = document.createElement('span');
      gap.className = 'budget-cash-sr';
      gap.textContent = ' ';
      const unit = document.createElement('span');
      unit.className = 'blend-ring-u';
      unit.textContent = parts[3];
      wrap.append(gap, unit);
    }
    return wrap;
  }

  // Geometry for the ring arc. The bar width is preferred. When that width
  // is missing, a printed spent amount and a printed plan amount
  // are the same kind of share the split bar already uses. Nothing here is
  // written back as a figure.
  function printedSpentPlanShare(row) {
    const meta = row.querySelector('.budget-category-meta');
    if (!meta) return null;
    const clone = meta.cloneNode(true);
    clone.querySelectorAll('.budget-cash-sr').forEach(node => node.remove());
    const shown = text(clone);
    const amounts = [...shown.matchAll(/-?\$[\d,]+\.\d{2}/g)].map(match => printedMagnitude(match[0]));
    if (amounts.length < 2 || amounts[0] == null || amounts[1] == null || !(amounts[1] > 0)) return null;
    return Math.max(0, Math.min(1, amounts[0] / amounts[1]));
  }

  function paintHouse(bento) {
    const section = bento.querySelector('[data-budget-browse="spending"]');
    if (!section || section.querySelector('[data-blend-rings]')) return;
    section.classList.add('tile', 't-house');
    const rings = document.createElement('div');
    rings.className = 'blend-rings';
    rings.setAttribute('data-blend-rings', '');
    const rows = [...section.querySelectorAll('.budget-category-row')];
    const other = rows.filter(row => row.getAttribute('data-budget-category-open') === 'other-spending');
    const main = rows.filter(row => !other.includes(row));
    const bridges = [];
    rows.forEach(row => row.classList.remove('blend-category-projected'));
    const spentPrinted = row => {
      const meta = row.querySelector('.budget-category-meta');
      if (!meta) return false;
      const clone = meta.cloneNode(true);
      clone.querySelectorAll('.budget-cash-sr').forEach(node => node.remove());
      const head = text(clone).split('/')[0] || '';
      if (/\$[\d,]/.test(head)) return true;
      return /\$[\d,]/.test(text(row.querySelector('.budget-category-status')));
    };
    main.forEach(row => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'blend-ring';
      const categoryId = row.getAttribute('data-budget-category-open');
      if (categoryId) button.setAttribute('data-blend-cat', categoryId);
      const bar = row.querySelector('.budget-category-bar');
      const scale = bar && bar.getAttribute('data-budget-category-scale');
      const fill = row.querySelector('.budget-category-fill');
      const width = fill && fill.style.width ? parseFloat(fill.style.width) : NaN;
      const known = scale === 'numeric' && Number.isFinite(width) && width >= 0;
      let share = known ? Math.max(0, Math.min(1, width / 100)) : null;
      if (share == null) {
        const printed = printedSpentPlanShare(row);
        if (printed != null) share = printed;
      }
      const hasSpend = spentPrinted(row);
      if (!hasSpend) share = null;
      const status = text(row.querySelector('.budget-category-status')) || 'Unavailable';
      // Numeric spent/plan geometry cannot qualify remaining. Only mirror
      // the incumbent's explicit remaining/over/used publication.
      const amountStatus = /^(?:≈\s*)?(?:estimated\s+)?-?\$[\d,]+(?:\.\d{2})?\s+(left|over|remaining)$/i.exec(status);
      const remainingPublished = amountStatus
        ? row.classList.contains(amountStatus[1].toLowerCase() === 'left' ? 'is-left' : 'is-over')
        : row.classList.contains('is-used') && /^All used$/i.test(status);
      const remainingGeometry = remainingPublished ? share : null;
      if (remainingGeometry != null) {
        button.classList.add('is-known');
        if (remainingGeometry < 1) button.classList.add('has-arc');
        button.style.setProperty('--left', String(Math.max(0, Math.min(1, 1 - remainingGeometry))));
        button.style.setProperty('--pct', remainingGeometry.toFixed(4));
      } else button.classList.add('is-unknown');
      const meta = text(row.querySelector('.budget-category-meta'));
      const planned = (meta.match(/of planned\s+(.+)$/i) || [])[1];
      const name = text(row.querySelector('.budget-category-name')) || 'Category';
      const nothingPrinted = !hasSpend || (!(share > 0) && !/\$[\d,]/.test(status) && /not observed|unavailable|unknown|^$/i.test(status));
      const well = document.createElement('span');
      well.className = 'blend-ring-g' + (nothingPrinted ? ' is-empty' : '');
      const value = ringCentre(status);
      // The arc and liquid show the same remaining fraction. The selected
      // share is spent / plan geometry; all monetary labels stay copied.
      well.appendChild(categoryArc(remainingGeometry != null ? 1 - remainingGeometry : null));
      const liquid = categoryLiquid(remainingGeometry);
      if (liquid) well.appendChild(liquid);
      well.appendChild(value);
      const label = document.createElement('span');
      label.className = 'blend-ring-l';
      const categoryName = document.createElement('span');
      categoryName.className = 'blend-ring-name';
      categoryName.textContent = name;
      label.appendChild(categoryName);
      if (planned) {
        const categoryPlan = document.createElement('span');
        categoryPlan.className = 'blend-ring-plan';
        categoryPlan.textContent = 'of ' + planned.trim();
        label.append(document.createTextNode(' '), categoryPlan);
      }
      button.append(well, label);
      if (row.classList.contains('is-over')) {
        button.classList.add('is-over');
        const pill = document.createElement('span');
        pill.className = 'blend-over-pill';
        const amount = document.createElement('span');
        amount.className = 'budget-cash-sr';
        amount.textContent = status;
        const word = document.createElement('span');
        word.textContent = 'Over plan';
        pill.append(amount, word);
        button.appendChild(pill);
      }
      markSheet(button, row);
      rings.appendChild(button);
      bridges.push([row, button]);
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
      foot.className = 'blend-other other-chip';
      const otherId = other[0].getAttribute('data-budget-category-open');
      if (otherId) foot.setAttribute('data-blend-cat', otherId);
      const status = text(other[0].querySelector('.budget-category-status'))
        || text(other[0].querySelector('.budget-category-meta'))
        || 'Unavailable';
      const dot = document.createElement('i');
      dot.className = 'blend-amber';
      dot.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span');
      name.className = 'blend-other-name';
      name.textContent = text(other[0].querySelector('.budget-category-name')) || 'Other spending';
      const rawOther = text(other[0]);
      const attention = otherId
        ? text(document.querySelector('[data-budget-browse="attention"] [data-budget-category-open="' + CSS.escape(otherId) + '"] strong'))
        : '';
      const needsCategory = /needs a category/i.test(rawOther) || /needs a category/i.test(attention);
      foot.append(dot, name);
      if (needsCategory) {
        const badge = document.createElement('span');
        badge.className = 'blend-need-badge';
        badge.textContent = 'needs a category';
        foot.appendChild(badge);
      }
      const amount = moneyToken(status) || moneyToken(rawOther);
      if (amount) {
        const shown = document.createElement('span');
        shown.className = 'blend-other-amt';
        shown.textContent = amount;
        foot.appendChild(shown);
      } else if (!needsCategory) {
        const word = document.createElement('span');
        word.className = 'blend-other-state';
        const counted = rawOther.match(/\d+\s+to sort/i);
        word.textContent = counted ? counted[0] : status;
        foot.appendChild(word);
      }
      markSheet(foot, other[0]);
      rings.after(foot);
      bridges.push([other[0], foot]);
    }
    const sourceRoot = bento.closest('[data-budget-surface]') || bento;
    const sheet = sourceRoot.querySelector('[data-budget-detail-sheet]');
    const body = document.createElement('div');
    body.className = 'blend-house-body';
    if (counts) body.appendChild(counts);
    const remainBlock = section.querySelector('[data-budget-browse-remaining]')?.parentElement;
    if (remainBlock) remainBlock.classList.add('blend-house-remain');
    const cycle = section.querySelector('.budget-browse-cycle');
    if (cycle) body.appendChild(cycle);
    section.querySelectorAll('footer > p').forEach(node => body.appendChild(node));
    const sourceIdentity = `[data-operating-question="${CSS.escape('06')}"] .budget-step-body`;
    const evidenceBody = sheet?.budgetSheet?.sourceForIdentity?.(sourceIdentity)
      || sourceRoot.querySelector(sourceIdentity);
    if (evidenceBody) evidenceBody.appendChild(body);
    else {
      // A missing native disclosure must not discard counts or qualifiers.
      const more = document.createElement('details');
      more.className = 'blend-house-panel';
      const summary = document.createElement('summary');
      summary.textContent = 'Household detail';
      more.append(summary, body);
      (section.querySelector('.blend-other') || rings).after(more);
    }
    // Only a complete, connected bridge may replace its source row on the
    // face. Keep the full printed status and amounts in its accessible name.
    // Unrepresented rows (including extra Other rows) remain visible.
    bridges.forEach(([row, button]) => {
      const label = separatedText(row);
      if (label) button.setAttribute('aria-label', label);
      const id = row.getAttribute('data-budget-category-open');
      const source = id && sourceRoot.querySelector('[data-budget-category="' + CSS.escape(id) + '"]');
      if (label && source && button.isConnected && typeof sheet?.budgetSheet?.open === 'function') {
        row.classList.add('blend-category-projected');
      }
    });
    section.querySelectorAll('.budget-category-list').forEach(node => node.classList.remove('blend-in-panel'));
    section.querySelectorAll('.budget-pace-key').forEach(node => {
      node.classList.add('blend-in-panel');
    });
    // Reuse the native evidence action on the visible title. Its delegated
    // handler and publication remain unchanged; keyboard users need not find
    // a control clipped inside the source footer.
    const evidence = section.querySelector('footer [data-budget-browse-evidence]');
    const heading = section.querySelector('header h2');
    if (evidence && heading) {
      const headingText = text(heading);
      const chevron = section.querySelector('.blend-house-chev');
      evidence.classList.add('blend-house-open');
      evidence.textContent = headingText;
      if (chevron) evidence.appendChild(chevron);
      heading.setAttribute('aria-label', headingText);
      heading.replaceChildren(evidence);
    }
    clip(section.querySelector('footer'));
    section.querySelectorAll('.budget-browse-eyebrow, .budget-browse-sub').forEach(clip);
  }

  function paintCards(bento) {
    const heading = bento.querySelector('.card-movement-heading');
    if (!heading || heading.dataset.blendCards === '1') return;
    heading.dataset.blendCards = '1';
    heading.closest('.budget-blend-card-movements')?.classList.add('tile', 't-cards');
    if (!heading.querySelector('.blend-tile-ico')) heading.prepend(tileIcon('cards'));
    const h2 = heading.querySelector('h2');
    if (h2 && !heading.querySelector('.blend-tile-title')) {
      const title = document.createElement('span');
      title.className = 'blend-tile-title';
      title.textContent = 'Cards this pay period';
      h2.classList.add('blend-clip');
      h2.after(title);
    }
    const panels = [...bento.querySelectorAll('.card-movement-panel')];
    const note = heading.querySelector('p');
    if (note && /Opening balance unavailable|Future period not observed|activity not observed|Posted through/i.test(text(note))) {
      note.classList.add('blend-card-posted', 'blend-card-aside');
      if (panels[0]) panels[0].prepend(note);
    }
    bento.querySelectorAll('.card-movement-trigger').forEach(button => {
      const name = text(button.querySelector('.card-movement-title')) || text(button);
      if (!button.querySelector('.blend-cc-chip')) {
        const chip = document.createElement('span');
        chip.className = 'blend-cc-chip cc-chip';
        const net = /visa/i.test(name) ? 'visa' : /mastercard|\bmc\b/i.test(name) ? 'mc' : /\bflex\b/i.test(name) ? 'flex' : '';
        if (net) chip.setAttribute('data-net', net);
        const hue = /emerald/i.test(name) ? '150'
          : /travel/i.test(name) ? '220'
          : /cash/i.test(name) ? '160'
          : /triangle/i.test(name) ? '0'
          : /amazon|mbna/i.test(name) ? '30'
          : '220';
        chip.style.setProperty('--h', hue);
        button.prepend(chip);
      }
      const qualifier = button.querySelector('.card-movement-qualifier');
      if (qualifier && /Opening balance unavailable|Future period not observed|not observed|unavailable/i.test(text(qualifier))) {
        qualifier.classList.add('blend-card-aside');
      }
      const delta = button.querySelector('.card-movement-delta');
      const money = moneyToken(text(delta));
      if (!money && delta && !button.querySelector('.blend-cc-dash')) {
        const dash = document.createElement('span');
        dash.className = 'blend-cc-dash cc-chg is-unavailable';
        dash.textContent = 'Unavailable';
        delta.classList.add('blend-clip');
        delta.after(dash);
        const line = document.createElement('i');
        line.className = 'blend-cc-untracked cc-spark';
        line.setAttribute('aria-hidden', 'true');
        button.appendChild(line);
      }
    });
    if (!heading.querySelector('.blend-cc-net')) {
      const meta = document.createElement('span');
      meta.className = 'blend-cc-net';
      // Individual card movements do not publish an aggregate strip total.
      meta.textContent = 'Net Unavailable';
      heading.appendChild(meta);
    }
  }

  function paintGoals(bento) {
    const card = bento.querySelector('[data-budget-savings-goals]');
    if (!card || card.querySelector('[data-blend-goals]')) return;
    card.classList.add('tile', 't-goals');
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
      const bar = document.createElement('span');
      bar.className = 'blend-g-bar';
      bar.setAttribute('aria-hidden', 'true');
      const savedN = printedMagnitude(savedAmount);
      const neededN = printedMagnitude(neededAmount);
      if (savedN != null && neededN != null && savedN + neededN > 0) {
        bar.style.setProperty('--w', Math.max(0, Math.min(1, savedN / (savedN + neededN))).toFixed(4));
      } else {
        bar.classList.add('is-untracked');
      }
      item.append(name, stack, bar);
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
    const progressed = goals.some(row => {
      const amounts = [...row.querySelectorAll('.budget-goal-amounts > span')];
      const read = label => {
        const node = amounts.find(span => new RegExp('^' + label + '$', 'i').test(text(span.querySelector('small'))));
        return printedMagnitude(text(node && node.querySelector('.budget-goal-amount')));
      };
      const savedN = read('Saved');
      const neededN = read('Needed');
      return savedN != null && neededN != null && savedN + neededN > 0;
    });
    if (progressed && svg.childNodes.length) face.appendChild(svg);
    else face.classList.add('is-plain');
    face.appendChild(list);
    const title = document.createElement('button');
    title.type = 'button';
    title.className = 'blend-tile-head';
    const name = document.createElement('span');
    name.className = 'blend-tile-title';
    name.textContent = 'Savings goals';
    title.append(tileIcon('goals'), name);
    card.querySelector('h3')?.before(title);
    card.querySelector('h3')?.before(face);
    card.querySelectorAll(':scope > ul, :scope > .budget-surface-link, :scope > .budget-goal-notice, :scope > .budget-surface-eyebrow, :scope > [data-budget-funding-savings], :scope > h3').forEach(node => {
      node.classList.add('blend-goals-source');
    });
  }

  function parkFunding(bento) {
    const card = bento.querySelector('[data-budget-savings-goals]');
    const section = document.querySelector('[data-budget-funding-section]');
    if (!card || !section || section.closest('.blend-goals-panel')) return;
    let panel = card.querySelector('.blend-goals-panel');
    if (!panel) {
      panel = document.createElement('details');
      panel.className = 'blend-goals-panel';
      panel.id = 'blend-savings-detail';
      const summary = document.createElement('summary');
      summary.className = 'blend-clip';
      summary.textContent = 'Savings detail';
      panel.appendChild(summary);
      card.appendChild(panel);
      const head = card.querySelector('.blend-tile-head');
      head?.setAttribute('aria-controls', panel.id);
      head?.setAttribute('aria-expanded', 'false');
      head?.addEventListener('click', event => {
        event.preventDefault();
        panel.open = !panel.open;
        head.setAttribute('aria-expanded', String(panel.open));
      });
      panel.addEventListener('toggle', () => head?.setAttribute('aria-expanded', String(panel.open)));
      panel.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || !panel.open) return;
        event.preventDefault();
        event.stopPropagation();
        panel.open = false;
        head?.setAttribute('aria-expanded', 'false');
        head?.focus();
      });
    }
    section.classList.add('blend-goals-costs');
    panel.appendChild(section);
  }

  function paintFaceBadges(bento) {
    const section = document.querySelector('[data-budget-browse="attention"]');
    if (!section || section.dataset.blendBadges === '1') return;
    section.dataset.blendBadges = '1';
    section.classList.add('blend-offstage');
    section.querySelectorAll('.budget-attention-item').forEach(item => {
      const label = text(item.querySelector('strong')) || text(item);
      if (!label) return;
      const cat = item.getAttribute('data-budget-category-open');
      const bill = item.getAttribute('data-budget-bill-open');
      const host = cat
        ? bento.querySelector('[data-blend-cat="' + CSS.escape(cat) + '"]')
        : bill
          ? bento.querySelector('#blend-bills-more')
          : null;
      const key = cat || bill || label;
      if (!host || host.classList.contains('blend-other') || host.classList.contains('is-over') || host.querySelector('.blend-over-pill') || host.querySelector('[data-blend-badge="' + CSS.escape(key) + '"]')) return;
      const badge = document.createElement('span');
      badge.className = 'blend-face-badge';
      badge.setAttribute('data-blend-badge', key);
      badge.textContent = label;
      host.appendChild(badge);
    });
  }

  // Fritsch–Carlson monotone cubic slopes. Geometry of already chosen points.
  function monotoneSlopes(xs, ys) {
    const n = xs.length;
    const slope = new Array(n).fill(0);
    if (n < 2) return slope;
    const delta = [];
    for (let i = 0; i < n - 1; i++) delta.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i] || 1));
    slope[0] = delta[0];
    slope[n - 1] = delta[n - 2];
    for (let i = 1; i < n - 1; i++) {
      slope[i] = delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2;
    }
    for (let i = 0; i < n - 1; i++) {
      if (delta[i] === 0) { slope[i] = slope[i + 1] = 0; continue; }
      const a = slope[i] / delta[i];
      const b = slope[i + 1] / delta[i];
      const sum = a * a + b * b;
      if (sum > 9) {
        const scale = 3 / Math.sqrt(sum);
        slope[i] = scale * a * delta[i];
        slope[i + 1] = scale * b * delta[i];
      }
    }
    return slope;
  }

  // Geometry only. Empty text is not zero. Number('') must never become a height.
  function timelineGeometry(displayed) {
    const raw = String(displayed == null ? '' : displayed).replace(/\u2212/g, '-').trim();
    // The publisher uses money2: a signed currency string with two cents.
    // Keep the sign before '$'; never extract a number from other prose.
    if (!/^-?\$(?:\d{1,3}(?:,\d{3})*|\d+)\.\d{2}$/.test(raw)) return null;
    const number = Number(raw.replace(/[,$]/g, ''));
    return Number.isFinite(number) ? number : null;
  }

  const RIVER_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function riverMonth(node) {
    if (!node) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(node.start)) {
      const month = Number(node.start.slice(5, 7)) - 1;
      if (month < 0 || month > 11) return null;
      return { key: node.start.slice(0, 7), name: RIVER_MONTHS[month], year: node.start.slice(0, 4) };
    }
    const named = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.exec(node.range || '');
    if (!named) return null;
    const year = /\b((?:19|20)\d{2})\b/.exec(node.range || '');
    return { key: (year ? year[1] + '-' : '') + named[1], name: named[1], year: year ? year[1] : '' };
  }

  // Every published period date stays selectable, irrespective of financial
  // coverage. Missing date identity cannot invent a navigation destination.
  function keepPastTimelineNode(li) {
    return !!li.getAttribute('data-bad-timeline-start') && !!li.getAttribute('data-bad-timeline-end');
  }

  // Reads ol[data-bad-timeline] only. The amount is the span text.
  // Native Forecast evidence qualifies historical BAD. Preserve its printed
  // trust and amount; Household coverage never removes period dates.
  // Unavailable or empty spans have no height at any date.
  // Absent list: the same neutral dashes, still focusable, and not a navigator.
  function readBadTimeline(doc) {
    const list = doc.querySelector('ol[data-bad-timeline]');
    if (!list) return { present: false, nodes: [] };
    const rows = [...list.children].filter(node => node.tagName === 'LI');
    const nodes = rows.filter(node => keepPastTimelineNode(node)).map((li, index) => {
      const trust = li.getAttribute('data-bad-term-trust') || '';
      const span = li.querySelector('[data-bad-term-amount]');
      const amount = span ? String(span.textContent == null ? '' : span.textContent).replace(/\s+/g, ' ').trim() : '';
      // The native producer owns qualification. The adapter cannot promote
      // missing trust or an empty amount, or suppress a qualified past value.
      const closed = !['calculated', 'estimated'].includes(trust) || amount.length === 0;
      const negative = !closed && li.getAttribute('data-sign') === 'negative';
      return {
        index: index,
        sourceIndex: rows.indexOf(li),
        start: li.getAttribute('data-bad-timeline-start') || '',
        end: li.getAttribute('data-bad-timeline-end') || '',
        role: li.getAttribute('data-bad-timeline-role') || '',
        range: li.getAttribute('data-bad-timeline-range-label') || '',
        trust: trust,
        face: li.getAttribute('data-bad-terms-face') || '',
        amount: amount,
        label: closed ? 'Unavailable' : amount,
        unavailable: closed,
        estimated: !closed && trust === 'estimated',
        negative: negative,
        tone: closed ? 'muted' : (negative ? 'short' : 'income'),
        magnitude: closed ? null : timelineGeometry(amount),
      };
    });
    return { present: true, nodes: nodes };
  }

  // A line may join only adjacent published, known amounts. Retain breaks
  // for missing amounts and for source rows removed from the visible strip.
  function knownTimelineRuns(nodes) {
    const runs = [];
    nodes.forEach((node, index) => {
      if (!Number.isFinite(node.magnitude)) return;
      const previous = index > 0 ? nodes[index - 1] : null;
      const adjacent = previous && Number.isFinite(previous.magnitude)
        && Number.isInteger(previous.sourceIndex) && Number.isInteger(node.sourceIndex)
        && node.sourceIndex === previous.sourceIndex + 1;
      if (!adjacent) runs.push([]);
      runs[runs.length - 1].push(index);
    });
    return runs;
  }

  // Decorative position spring adapted from the owner's g-blend/js/river.js.
  // Its state is a period position, never an interpolated financial amount.
  class RiverSpring {
    constructor(value) { this.x = this.target = value; this.v = 0; }
    set(value) { this.x = this.target = value; this.v = 0; }
    step(seconds) {
      const dt = Math.max(0, Math.min(0.05, Number.isFinite(seconds) ? seconds : 0));
      const n = Math.max(1, Math.ceil(dt / 0.008));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        this.v += (-190 * (this.x - this.target) - 27 * this.v) * h;
        this.x += this.v * h;
      }
      if (Math.abs(this.v) < 0.001 && Math.abs(this.x - this.target) < 0.001) this.set(this.target);
      return this.x;
    }
    get settled() { return this.x === this.target && this.v === 0; }
  }

  function riverKeyTarget(key, current, count) {
    if (current < 0 || count < 1) return null;
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 6, PageDown: -6 }[key];
    return step ? Math.max(0, Math.min(count - 1, current + step)) : null;
  }

  function riverFlingTarget(target, velocity, spacing, count, pan, reduced) {
    const fling = !reduced && spacing > 0 && Number.isFinite(velocity)
      ? Math.max(-4, Math.min(4, (pan ? -velocity : velocity) * 140 / spacing)) : 0;
    return Math.round(Math.max(0, Math.min(count - 1, target + fling)));
  }

  function displayedTimelineIndex(nodes) {
    const progress = document.querySelector('[data-budget-window-progress]');
    const start = progress ? (progress.getAttribute('data-start') || '') : '';
    if (start) {
      const byStart = nodes.findIndex(node => node.start && node.start === start);
      if (byStart >= 0) return byStart;
    }
    const range = text(document.querySelector('[data-budget-window-range]'));
    if (range) {
      const byRange = nodes.findIndex(node => node.range && (range === node.range || range.indexOf(node.range) === 0));
      if (byRange >= 0) return byRange;
    }
    const eyebrow = text(document.querySelector('.budget-window-eyebrow'));
    if (/\bCurrent\b/.test(eyebrow)) {
      const byRole = nodes.findIndex(node => node.role === 'current');
      if (byRole >= 0) return byRole;
    }
    return -1;
  }

  function chooseBadTimeline(index, model) {
    if (!model || !model.present) return;
    const eyebrow = text(document.querySelector('.budget-window-eyebrow'));
    if (/^Calendar month/.test(eyebrow)) return;
    const target = model.nodes[index];
    if (!target || !target.start) return;
    const current = displayedTimelineIndex(model.nodes);
    if (current < 0 || current === index) return;
    // Native Previous/Next follows the unfiltered printed period order.
    // Visible-strip indices can skip past rows and must not count its steps.
    const from = model.nodes[current].sourceIndex;
    const to = target.sourceIndex;
    if (!Number.isInteger(from) || !Number.isInteger(to)) return;
    // The native wheel and timeline printer share the same unfiltered rows.
    // Prefer one native selection; retain steps for minimal/older mounts.
    const nativeChoice = document.querySelector('[data-budget-wheel="period"] [data-wheel-index="' + to + '"]');
    if (nativeChoice && !nativeChoice.disabled && nativeChoice.getAttribute('aria-disabled') !== 'true') {
      nativeChoice.click();
      return;
    }
    const dir = to > from ? '1' : '-1';
    const steps = Math.abs(to - from);
    for (let i = 0; i < steps; i++) {
      const button = document.querySelector('[data-budget-window-step="' + dir + '"]');
      if (!button || button.getAttribute('aria-disabled') === 'true') return;
      button.click();
    }
  }

  let activeRiver = null;
  let riverMotionSession = null;

  function cleanupDetachedRiver() {
    if (!activeRiver || activeRiver.wrap.isConnected) return;
    activeRiver.dispose();
    activeRiver = null;
  }

  function paintRiver(bento) {
    cleanupDetachedRiver();
    if (bento.querySelector('.g-river-wrap')) return;
    const model = readBadTimeline(document);
    const absent = !model.present || !model.nodes.length;
    const nodes = absent
      ? Array.from({ length: 12 }, (_, index) => ({
        index: index, start: '', end: '', role: '', range: '', trust: '', face: '',
        amount: '', label: '—', unavailable: true, estimated: false, negative: false,
        tone: 'muted', magnitude: null,
      }))
      : model.nodes;
    if (!nodes.length) return;
    const selected = absent ? Math.floor((nodes.length - 1) / 2) : displayedTimelineIndex(nodes);
    const selectedNode = selected >= 0 ? nodes[selected] : null;
    const selectedKnown = !!selectedNode && Number.isFinite(selectedNode.magnitude);
    const canNavigate = !absent && selected >= 0 && !/^Calendar month/.test(text(document.querySelector('.budget-window-eyebrow')));
    const sessionKey = absent ? '' : nodes.map(node => node.sourceIndex + ':' + node.start).join('|');
    const remembered = sessionKey && riverMotionSession?.key === sessionKey ? riverMotionSession : null;
    const clampPosition = value => Math.max(0, Math.min(nodes.length - 1, value));
    const head = new RiverSpring(remembered ? clampPosition(remembered.x) : Math.max(0, selected));
    head.v = remembered && Number.isFinite(remembered.v) ? remembered.v : 0;
    head.target = Math.max(0, selected);
    let previewIndex = selected;
    let restoreFocus = !!remembered?.focus;
    let reveal = absent || remembered || reduceMotion() ? 1 : 0;
    let frame = null;
    let lastFrame = 0;
    let disposed = false;
    let visible = true;
    let drag = null;
    let suppressClickUntil = 0;
    const listeners = [];
    const listen = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      listeners.push(() => target.removeEventListener(type, handler, options));
    };
    const rememberMotion = focus => {
      if (sessionKey) riverMotionSession = { key: sessionKey, x: head.x, v: head.v,
        focus: focus == null ? !!(riverMotionSession?.key === sessionKey && riverMotionSession.focus) : !!focus };
    };
    const wrap = document.createElement('div');
    wrap.className = 'g-river-wrap';
    const nav = document.createElement('nav');
    nav.className = 'tile t-river';
    nav.setAttribute('data-bad-river', absent ? 'absent' : 'printed');
    const riverState = !selectedNode || selectedNode.tone === 'muted' ? 'neutral' : selectedNode.tone;
    nav.setAttribute('data-state', riverState);
    nav.setAttribute('aria-label', 'Pay periods');
    const river = document.createElement('div');
    river.className = 'river';
    river.tabIndex = 0;
    river.setAttribute('role', 'group');
    river.setAttribute('aria-label', absent
      ? 'Pay periods. Balance After Deductions timeline unavailable.'
      : 'Pay periods. Balance After Deductions.');
    if (selected >= 0 && !absent) river.setAttribute('aria-activedescendant', 'bad-river-' + selected);
    const canvas = document.createElement('canvas');
    canvas.className = 'river-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    const slide = document.createElement('div');
    slide.className = 'river-slide';
    const vals = document.createElement('div');
    vals.className = 'river-vals';
    const months = document.createElement('div');
    months.className = 'months';
    slide.append(vals, months);
    const play = document.createElement('div');
    play.className = 'playhead';
    const pill = document.createElement('div');
    pill.className = 'playhead-pill';
    pill.setAttribute('aria-hidden', 'true');
    if (selected < 0) {
      // Show the native range without implying a selected timeline point.
      play.style.transform = 'translate3d(8px,0,0)';
      pill.style.transform = 'none';
    }
    const rangeEl = document.createElement('span');
    rangeEl.setAttribute('data-ph-range', '');
    rangeEl.textContent = (selectedNode && selectedNode.range)
      || text(document.querySelector('[data-budget-window-range]'))
      || 'Pay period';
    const valueEl = document.createElement('b');
    valueEl.className = 'num' + (selectedNode && selectedNode.tone === 'short' ? ' is-short' : '')
      + (selectedNode && selectedNode.estimated ? ' is-est' : '');
    valueEl.setAttribute('data-ph-value', '');
    valueEl.textContent = selectedNode ? selectedNode.label : '—';
    pill.append(rangeEl, valueEl);
    const beam = document.createElement('span');
    beam.className = 'playhead-beam';
    beam.setAttribute('aria-hidden', 'true');
    beam.hidden = !selectedKnown;
    const orb = document.createElement('span');
    orb.className = 'playhead-orb';
    orb.setAttribute('aria-hidden', 'true');
    orb.hidden = !selectedKnown;
    play.append(pill, beam, orb);
    if (!absent) {
      const marks = nodes.map(riverMonth);
      let yearShown = false;
      marks.forEach((mark, i) => {
        if (!mark) return;
        const prev = i ? marks[i - 1] : null;
        const boundary = !prev || prev.key !== mark.key;
        if (!boundary) return;
        const label = document.createElement('span');
        label.dataset.i = String(i);
        label.appendChild(document.createTextNode(mark.name));
        if (mark.year && (mark.name === 'Jan' || !yearShown)) {
          const year = document.createElement('b');
          year.textContent = ' ' + mark.year;
          label.appendChild(year);
          yearShown = true;
        }
        months.appendChild(label);
      });
    }
    nodes.forEach(node => {
      if (absent) {
        const mark = document.createElement('span');
        mark.className = 'rv is-muted';
        mark.setAttribute('aria-hidden', 'true');
        mark.textContent = '—';
        vals.appendChild(mark);
        return;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.tabIndex = -1;
      button.id = 'bad-river-' + node.index;
      button.className = 'rv is-' + node.tone
        + (node.estimated ? ' is-est' : '')
        + (node.role === 'past' ? ' is-past' : '')
        + (node.index === selected ? ' is-sel' : '');
      button.textContent = node.label;
      button.setAttribute('aria-label', (node.unavailable ? 'Unavailable' : node.label)
        + (node.estimated ? ', estimated' : '') + ', ' + (node.range || ('pay period ' + (node.index + 1))));
      button.addEventListener('click', event => {
        event.stopPropagation();
        if (drag || performance.now() < suppressClickUntil) return;
        commitSelection(node.index, river.contains(document.activeElement));
      });
      vals.appendChild(button);
    });
    river.append(canvas, slide, play);
    nav.appendChild(river);
    wrap.appendChild(nav);
    bento.prepend(wrap);
    const layout = { off: 0, xs: [], spacing: 1, pan: false, width: 0 };
    const markPreview = index => {
      previewIndex = index;
      const node = nodes[index];
      if (!node) return;
      [...vals.children].forEach((value, i) => value.classList.toggle('is-sel', i === index));
      rangeEl.textContent = node.range || text(document.querySelector('[data-budget-window-range]')) || 'Pay period';
      valueEl.textContent = node.label;
      valueEl.classList.toggle('is-short', node.tone === 'short');
      valueEl.classList.toggle('is-est', node.estimated);
      nav.setAttribute('data-state', node.tone === 'muted' ? 'neutral' : node.tone);
      if (!absent) river.setAttribute('aria-activedescendant', 'bad-river-' + index);
      river.toggleAttribute('data-river-preview', index !== selected);
    };
    const requestDraw = () => {
      if (frame != null || disposed || document.hidden || !visible) return;
      frame = requestAnimationFrame(now => { frame = null; draw(now); });
    };
    const commitSelection = (index, focus) => {
      if (!canNavigate || !Number.isInteger(index) || !nodes[index]) return;
      const current = displayedTimelineIndex(model.nodes);
      head.target = index;
      markPreview(index);
      if (reduceMotion()) head.set(index);
      rememberMotion(false);
      requestDraw();
      if (index === current) return;
      chooseBadTimeline(index, model);
      // The internal native wheel must not retain focus in its hidden source.
      const nativeFocus = document.activeElement;
      if (nativeFocus?.closest('[data-budget-wheel="period"], [data-budget-window-step]')) nativeFocus.blur();
      const remounted = !bento.isConnected;
      rememberMotion(remounted && focus);
      if (!remounted) {
        head.target = current;
        markPreview(current);
        if (reduceMotion()) head.set(current);
      }
    };
    const positionAt = clientX => {
      const rect = river.getBoundingClientRect();
      return clampPosition((clientX - rect.left + layout.off - (layout.xs[0] || 0)) / layout.spacing);
    };
    listen(river, 'keydown', event => {
      if (!canNavigate || drag || event.altKey || event.ctrlKey || event.metaKey) return;
      const next = riverKeyTarget(event.key, displayedTimelineIndex(model.nodes), nodes.length);
      if (next == null) return;
      event.preventDefault();
      event.stopPropagation();
      commitSelection(next, true);
    });
    listen(river, 'click', event => {
      if (!canNavigate || drag || event.target.closest('.rv') || performance.now() < suppressClickUntil) return;
      commitSelection(Math.round(positionAt(event.clientX)), river.contains(document.activeElement));
    });
    listen(river, 'pointerdown', event => {
      if (!canNavigate || drag || event.isPrimary === false || event.button !== 0
        || event.target.closest('button, a, input, select, textarea')) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, head: head.x,
        lastX: event.clientX, lastT: performance.now(), velocity: 0, moved: false };
    });
    listen(river, 'pointermove', event => {
      if (!drag || drag.cancelled || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved) {
        if (Math.abs(dy) > 5 && Math.abs(dy) > Math.abs(dx)) {
          drag.cancelled = true;
          return;
        }
        if (Math.abs(dx) <= 5) return;
        drag.moved = true;
        river.classList.add('is-dragging');
        try { river.setPointerCapture(event.pointerId); } catch (error) { /* detached pointer */ }
      }
      if (event.cancelable) event.preventDefault();
      const now = performance.now();
      drag.velocity = 0.75 * drag.velocity + 0.25 * (event.clientX - drag.lastX) / Math.max(1, now - drag.lastT);
      drag.lastX = event.clientX;
      drag.lastT = now;
      head.target = layout.pan ? clampPosition(drag.head - dx / layout.spacing) : positionAt(event.clientX);
      markPreview(Math.round(head.target));
      if (reduceMotion()) head.set(head.target);
      requestDraw();
    });
    const finishPointer = (event, cancelled) => {
      if (!drag || event.pointerId !== drag.id) return;
      const ended = drag;
      drag = null;
      river.classList.remove('is-dragging');
      if (river.hasPointerCapture?.(ended.id)) river.releasePointerCapture(ended.id);
      if (ended.cancelled) { suppressClickUntil = performance.now() + 400; return; }
      if (!ended.moved) return;
      suppressClickUntil = performance.now() + 400;
      if (cancelled) {
        head.target = Math.max(0, selected);
        markPreview(selected);
        if (reduceMotion()) head.set(head.target);
        requestDraw();
        return;
      }
      const fresh = performance.now() - ended.lastT < 80 && Math.abs(ended.velocity) > 0.6;
      const index = riverFlingTarget(head.target, fresh ? ended.velocity : 0,
        layout.spacing, nodes.length, layout.pan, reduceMotion());
      commitSelection(index, river.contains(document.activeElement));
    };
    listen(window, 'pointerup', event => finishPointer(event, false));
    listen(window, 'pointercancel', event => finishPointer(event, true));
    listen(river, 'lostpointercapture', event => finishPointer(event, true));
    let wheelDelta = 0;
    let wheelTime = 0;
    listen(river, 'wheel', event => {
      if (!canNavigate || event.ctrlKey || event.metaKey || event.altKey || drag) return;
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey;
      if (!horizontal && document.activeElement !== river) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? layout.width : 1;
      const delta = (horizontal && event.deltaX ? event.deltaX : event.deltaY) * unit;
      const current = displayedTimelineIndex(model.nodes);
      if (!delta || current < 0 || (current === 0 && delta < 0) || (current === nodes.length - 1 && delta > 0)) return;
      event.preventDefault();
      const now = performance.now();
      if (now - wheelTime > 400) wheelDelta = 0;
      wheelTime = now;
      wheelDelta += delta;
      if (Math.abs(wheelDelta) > 60) {
        const next = Math.max(0, Math.min(nodes.length - 1, current + Math.sign(wheelDelta)));
        wheelDelta = 0;
        commitSelection(next, document.activeElement === river);
      }
    }, { passive: false });
    listen(river, 'pointermove', event => {
      if (drag || event.pointerType === 'touch' || absent) return;
      const hovered = Math.round(positionAt(event.clientX));
      [...vals.children].forEach((value, i) => value.classList.toggle('is-hover', i === hovered));
    });
    listen(river, 'pointerleave', () => [...vals.children].forEach(value => value.classList.remove('is-hover')));
    const draw = now => {
      if (!wrap.isConnected) { cleanupDetachedRiver(); return; }
      if (disposed || document.hidden || !visible) return;
      const dt = lastFrame ? Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000)) : 0.016;
      lastFrame = now;
      if (reduceMotion()) { head.set(head.target); reveal = 1; }
      else { head.step(dt); reveal = Math.min(1, reveal + dt / 1.6); }
      const rect = river.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height || 178;
      if (!width) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
      if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const n = nodes.length;
      const mobile = width < 640;
      const pad = mobile ? 26 : 36;
      const minSp = mobile ? 56 : 88;
      const fit = n <= 1 ? 0 : (width - pad * 2) / Math.max(1, n - 1);
      const sp = n <= 1 ? 0 : Math.max(fit, minSp);
      const contentW = n <= 1 ? width : pad * 2 + sp * (n - 1);
      const xs = nodes.map((_, i) => n === 1 ? width / 2 : pad + i * sp);
      const known = nodes.map(node => node.magnitude).filter(value => value != null && Number.isFinite(value));
      const flat = !known.length;
      let ymin = 0;
      let ymax = 1;
      if (!flat) {
        ymin = Math.min.apply(null, known.concat([0]));
        ymax = Math.max.apply(null, known.concat([0]));
        if (ymax === ymin) ymax = ymin + 1;
      }
      const yOfValue = value => botSafe - (value - ymin) / (ymax - ymin) * (botSafe - top);
      const top = 52;
      const botSafe = height - (mobile ? 62 : 66);
      const y0 = flat ? (top + botSafe) / 2 : yOfValue(0);
      const ys = nodes.map(node => node.magnitude == null || !Number.isFinite(node.magnitude) ? null : yOfValue(node.magnitude));
      const sel = previewIndex < 0 ? -1 : Math.max(0, Math.min(n - 1, previewIndex));
      let off = 0;
      if (contentW > width + 1 && sel >= 0) {
        off = Math.max(0, Math.min(contentW - width, pad + head.x * sp - width / 2));
      }
      layout.off = off;
      layout.xs = xs;
      layout.spacing = sp || 1;
      layout.pan = contentW > width + 1;
      layout.width = width;
      slide.style.right = 'auto';
      slide.style.width = contentW + 'px';
      slide.style.transform = 'translate3d(' + (-off).toFixed(1) + 'px,0,0)';
      const dark = document.documentElement.getAttribute('data-theme') === 'dark'
        || (!document.documentElement.getAttribute('data-theme') && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      const income = dark ? [92, 242, 176] : [10, 168, 112];
      const amber = dark ? [255, 190, 92] : [236, 146, 18];
      const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
      const ink = dark ? '255,255,255' : '16,18,27';
      const knownIdx = [];
      ys.forEach((y, i) => { if (y != null) knownIdx.push(i); });
      ctx.save();
      ctx.translate(-off, 0);
      // Prototype reveal is a viewport clip, not a change to any amount.
      ctx.beginPath();
      ctx.rect(off - 20, 0, (width + 40) * (1 - Math.pow(1 - reveal, 3)), height);
      ctx.clip();
      ctx.setLineDash([2, 6]);
      ctx.strokeStyle = 'rgba(' + ink + ',' + (dark ? 0.22 : 0.2) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xs[0] - 18, y0 + 0.5);
      ctx.lineTo(xs[n - 1] + 18, y0 + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      knownTimelineRuns(nodes).forEach(run => {
        if (run.length < 2) return;
        const kxs = run.map(i => xs[i]);
        const kys = run.map(i => ys[i]);
        const slopes = monotoneSlopes(kxs, kys);
        const path = new Path2D();
        path.moveTo(kxs[0], kys[0]);
        for (let i = 0; i < kxs.length - 1; i++) {
          const h = kxs[i + 1] - kxs[i];
          path.bezierCurveTo(
            kxs[i] + h / 3, kys[i] + slopes[i] * h / 3,
            kxs[i + 1] - h / 3, kys[i + 1] - slopes[i + 1] * h / 3,
            kxs[i + 1], kys[i + 1]
          );
        }
        const area = new Path2D(path);
        area.lineTo(kxs[kxs.length - 1], botSafe + 6);
        area.lineTo(kxs[0], botSafe + 6);
        area.closePath();
        const grad = ctx.createLinearGradient(kxs[0], 0, kxs[kxs.length - 1], 0);
        run.forEach((idx, i) => {
          const t = i / (run.length - 1);
          grad.addColorStop(t, rgba(nodes[idx].negative ? amber : income, 1));
        });
        ctx.save();
        ctx.globalAlpha = dark ? 0.22 : 0.16;
        ctx.fillStyle = grad;
        ctx.fill(area);
        ctx.globalCompositeOperation = 'destination-out';
        const fade = ctx.createLinearGradient(0, top, 0, botSafe + 6);
        fade.addColorStop(0, 'rgba(0,0,0,0)');
        fade.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = fade;
        ctx.fillRect(kxs[0] - 24, top - 40, (kxs[kxs.length - 1] - kxs[0]) + 48, botSafe - top + 56);
        ctx.restore();
        const cur = Math.max(0, nodes.findIndex(node => node.role !== 'past'));
        const xCur = cur <= 0 ? kxs[0] - 30 : (xs[Math.max(0, cur - 1)] + xs[cur]) / 2;
        const pass = alpha => {
          ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
          ctx.strokeStyle = grad;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.globalAlpha = (dark ? 0.07 : 0.08) * alpha;
          ctx.lineWidth = dark ? 16 : 14;
          ctx.stroke(path);
          ctx.globalAlpha = 0.16 * alpha;
          ctx.lineWidth = dark ? 7 : 6;
          ctx.stroke(path);
          ctx.globalAlpha = 0.95 * alpha;
          ctx.lineWidth = dark ? 2 : 2.4;
          ctx.stroke(path);
        };
        ctx.save();
        ctx.beginPath();
        ctx.rect(off - 20, 0, xCur - off + 20, height);
        ctx.clip();
        pass(0.42);
        ctx.restore();
        ctx.save();
        ctx.beginPath();
        ctx.rect(xCur, 0, contentW - xCur + 20, height);
        ctx.clip();
        pass(1);
        ctx.restore();
      });
      ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
      knownIdx.forEach(i => {
        const node = nodes[i];
        const col = node.negative ? amber : income;
        const past = node.role === 'past';
        const alpha = past ? (dark ? 0.5 : 0.55) : 1;
        const x = xs[i];
        const y = ys[i];
        if (node.negative) {
          const radius = 10;
          const halo = ctx.createRadialGradient(x, y, 0, x, y, radius);
          halo.addColorStop(0, rgba(col, (dark ? 0.6 : 0.42) * alpha));
          halo.addColorStop(1, rgba(col, 0));
          ctx.globalAlpha = 1;
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = alpha;
        if (!dark) {
          const radius = node.negative ? 4.4 : 3;
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(x, y, radius + 1.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = rgba(col, 1);
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = rgba(col.map(v => Math.round(v + (255 - v) * 0.4)), 1);
          ctx.beginPath();
          ctx.arc(x, y, node.negative ? 3.6 : 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      // The diamond denotes an explicitly published current period. Never
      // promote the first future row, or an unknown amount, into "today".
      const current = nodes.findIndex(node => node.role === 'current');
      if (current >= 0 && ys[current] != null) {
        const x = xs[current];
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = 'rgb(' + ink + ')';
        ctx.beginPath();
        ctx.moveTo(x, y0 - 5); ctx.lineTo(x + 5, y0); ctx.lineTo(x, y0 + 5); ctx.lineTo(x - 5, y0);
        ctx.closePath(); ctx.fill();
      }
      // A stationary lens may highlight a known publication. No yAt or
      // fractional-height interpolation is used while the head is moving.
      const markerKnown = sel >= 0 && ys[sel] != null && !drag && head.settled && head.x === sel;
      if (markerKnown) {
        const lens = ctx.createRadialGradient(xs[sel], ys[sel], 0, xs[sel], ys[sel], 90);
        lens.addColorStop(0, dark ? 'rgba(255,255,255,.10)' : 'rgba(10,168,112,.08)');
        lens.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
        ctx.globalAlpha = 1;
        ctx.fillStyle = lens;
        ctx.fillRect(xs[sel] - 90, 0, 180, height);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
      const valueEls = [...vals.children];
      valueEls.forEach((el, i) => {
        el.style.left = xs[i].toFixed(1) + 'px';
        el.style.visibility = 'visible';
      });
      const widths = valueEls.map(el => el.offsetWidth || 0);
      const shown = [];
      const overlaps = (a, b) => {
        const gap = 8;
        return xs[a] - widths[a] / 2 < xs[b] + widths[b] / 2 + gap
          && xs[b] - widths[b] / 2 < xs[a] + widths[a] / 2 + gap;
      };
      const order = valueEls.map((_, i) => i).sort((a, b) => (a === sel ? -1 : b === sel ? 1 : xs[a] - xs[b]));
      order.forEach(i => {
        if (!widths[i]) return;
        if (shown.some(j => overlaps(i, j))) {
          valueEls[i].style.visibility = 'hidden';
          return;
        }
        shown.push(i);
      });
      const monthLabels = [...months.children];
      monthLabels.forEach((el, index) => {
        const i = Number(el.dataset.i);
        let x = Math.max(0, xs[i] - (i ? sp / 2 : 0)) + 6;
        const next = monthLabels[index + 1];
        if (next) {
          const nextIndex = Number(next.dataset.i);
          const nextX = Math.max(0, xs[nextIndex] - sp / 2) + 6;
          if (x + el.offsetWidth + 8 > nextX) x = Math.max(6, nextX - el.offsetWidth - 8);
        }
        el.style.left = x.toFixed(1) + 'px';
      });
      if (sel >= 0) {
        const screenX = (n === 1 ? width / 2 : pad + head.x * sp) - off;
        play.hidden = false;
        play.style.transform = 'translate3d(' + screenX.toFixed(1) + 'px,0,0)';
        beam.hidden = orb.hidden = !markerKnown;
        if (markerKnown) play.style.setProperty('--orb-y', ys[sel].toFixed(1) + 'px');
        const pw = pill.offsetWidth || 160;
        const shift = Math.max(-screenX + 8, Math.min(width - screenX - pw - 8, -pw / 2));
        pill.style.transform = 'translate3d(' + shift.toFixed(1) + 'px,0,0)';
      }
      river.setAttribute('data-river-motion', !head.settled || reveal < 1 ? 'moving' : 'settled');
      if (restoreFocus) { restoreFocus = false; river.focus({ preventScroll: true }); rememberMotion(false); }
      else rememberMotion();
      if (!head.settled || reveal < 1) requestDraw();
    };
    listen(window, 'resize', requestDraw);
    listen(document, 'visibilitychange', () => {
      lastFrame = 0;
      if (document.hidden && frame != null) { cancelAnimationFrame(frame); frame = null; }
      else requestDraw();
    });
    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (motionQuery?.addEventListener) listen(motionQuery, 'change', () => {
      if (motionQuery.matches) { head.set(head.target); reveal = 1; }
      requestDraw();
    });
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      visible = !!entries[0]?.isIntersecting;
      lastFrame = 0;
      if (!visible && frame != null) { cancelAnimationFrame(frame); frame = null; }
      else requestDraw();
    }) : null;
    observer?.observe(river);
    activeRiver = { wrap: wrap, dispose: () => {
      disposed = true;
      rememberMotion();
      listeners.forEach(remove => remove());
      observer?.disconnect();
      if (frame != null) cancelAnimationFrame(frame);
      if (drag && river.hasPointerCapture?.(drag.id)) river.releasePointerCapture(drag.id);
      drag = null;
    } };
    requestDraw();
  }

  let provenanceFooter = null;
  function paintQuiet() {
    const footer = provenanceFooter || document.querySelector('.wrap > footer');
    if (!footer) return;
    provenanceFooter = footer;
    const figures = document.querySelector('[data-budget-period-info-body]');
    if (figures) {
      footer.classList.add('blend-provenance');
      figures.appendChild(footer);
    }
    // The Budget is one surface; keep the provenance wording without a
    // page-navigation affordance. Native evidence controls are untouched.
    footer.querySelectorAll('a[href="/records.html"]').forEach(link => link.replaceWith(document.createTextNode(link.textContent)));
    const brand = document.querySelector('.site-head .blend-brand[href="/"]');
    if (brand) {
      brand.removeAttribute('href');
      brand.removeAttribute('aria-label');
    }
  }

  function paint(root) {
    const bento = root.querySelector('[data-budget-bento]');
    if (!bento || bento.getAttribute('data-blend-ready') === '1') return;
    bento.setAttribute('data-blend-ready', '1');
    place(bento);
    paintSheet(root);
    root.querySelector('[data-budget-detail-sheet]')?.budgetSheet?.completeDeferredRestore?.();
  }

  function paintSheet(root) {
    const dialog = root.querySelector('[data-budget-detail-sheet]');
    const header = dialog?.querySelector(':scope > header');
    const title = header?.querySelector('[data-budget-detail-title]');
    if (!dialog || !header || !title) return;
    dialog.classList.add('blend-detail-sheet');
    let titles = header.querySelector('.blend-sheet-titles');
    if (!titles) {
      titles = document.createElement('div');
      titles.className = 'blend-sheet-titles';
      const range = document.createElement('span');
      range.className = 'blend-sheet-kicker';
      range.textContent = text(root.querySelector('[data-budget-window-range]'));
      title.before(titles);
      titles.append(range, title);
    }
    root.querySelectorAll('.budget-bill-row, [data-bill-detail] > summary').forEach(row => {
      if (row.querySelector('.blend-bill-symbol')) return;
      const nativeLabel = row.querySelector('.budget-bill-label strong') || row.querySelector('span');
      const symbol = document.createElement('span');
      symbol.className = 'blend-bill-symbol';
      symbol.setAttribute('aria-hidden', 'true');
      const label = text(nativeLabel).toLowerCase();
      const hue = /hydro|electric|power/.test(label) ? 186 : /internet|wifi|telus|shaw/.test(label) ? 262
        : /\bcar\b|auto|vehicle/.test(label) ? 152 : /phone/.test(label) ? 18
          : /home.*insurance/.test(label) ? 38 : /mortgage|rent|house/.test(label) ? 222 : 230;
      symbol.style.setProperty('--bill-hue', String(hue));
      symbol.appendChild(billIcon(text(nativeLabel)));
      if (row.matches('[data-bill-detail] > summary')) {
        nativeLabel?.classList.add('blend-bill-summary-label');
        row.querySelector(':scope > span:last-child')?.classList.add('blend-bill-summary-amount');
      }
      row.prepend(symbol);
    });
    root.querySelectorAll('[data-bill-detail] .bill-detail-body:not([data-blend-bill-interior])').forEach(body => {
      body.setAttribute('data-blend-bill-interior', '');
      const original = [...body.children];
      const heading = body.querySelector(':scope > h4');
      const facts = body.querySelector(':scope > dl');
      const published = document.createElement('details');
      published.className = 'blend-bill-published';
      const summary = document.createElement('summary');
      summary.textContent = 'Published bill evidence';
      published.appendChild(summary);
      if (heading) published.appendChild(heading);
      if (facts) published.appendChild(facts);
      const matching = document.createElement('section');
      matching.className = 'blend-bill-matching';
      const matchingTitle = document.createElement('h3');
      matchingTitle.textContent = 'Matching payment';
      matching.appendChild(matchingTitle);
      const paymentEvidence = document.createElement('div');
      paymentEvidence.className = 'blend-payment-evidence';
      matching.appendChild(paymentEvidence);
      // Keep the original linked-payment evidence and every warning. No
      // candidate matching, financial calculations or prototype actions.
      original.filter(node => node !== heading && node !== facts).forEach(node => paymentEvidence.appendChild(node));
      const history = document.createElement('section');
      history.className = 'blend-bill-history';
      const historyTitle = document.createElement('h3');
      historyTitle.textContent = 'Last 6 months';
      const unavailable = document.createElement('div');
      unavailable.className = 'blend-history-unavailable';
      unavailable.textContent = 'Unavailable';
      const historyNote = document.createElement('p');
      historyNote.textContent = 'Average: Unavailable · Range: Unavailable. Forecast has not published a qualified six-month bill history. Missing history does not mean zero.';
      history.append(historyTitle, unavailable, historyNote);
      body.append(matching, history, published);
    });
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
    const run = () => {
      cleanupDetachedRiver();
      if (!mount.querySelector('[data-budget-bento]')) globalThis.Aurora?.destroy?.();
      paint(mount);
    };
    run();
    if (typeof MutationObserver === 'function') {
      new MutationObserver(run).observe(mount, { childList: true });
    }
    document.addEventListener('pointermove', tilt);
    document.addEventListener('pointerleave', untilt, true);
    document.querySelector('[data-blend-theme]')?.addEventListener('click', themeCycle);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports.keepPastTimelineNode = keepPastTimelineNode;
    module.exports.readBadTimeline = readBadTimeline;
    module.exports.knownTimelineRuns = knownTimelineRuns;
    module.exports.chooseBadTimeline = chooseBadTimeline;
    module.exports.RiverSpring = RiverSpring;
    module.exports.riverKeyTarget = riverKeyTarget;
    module.exports.riverFlingTarget = riverFlingTarget;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
