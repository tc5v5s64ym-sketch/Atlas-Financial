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

  // The income tile reads the printed ratio, not the hero slot painted into
  // the same step. "of planned" is included only when that phrase is printed.
  function printedIncomeSentence(step) {
    if (!step) return '';
    const ratio = step.querySelector('[data-budget-ratio="income"]');
    if (!ratio) return separatedText(step.querySelector('.budget-step-value'));
    const parts = [];
    const actual = separatedText(ratio.querySelector('[data-budget-ratio-actual]'));
    if (actual) parts.push(actual);
    const ofPlanned = [...ratio.children].find(node => node.classList.contains('budget-cash-sr') && /of planned/i.test(node.textContent || ''));
    if (ofPlanned) {
      const slash = [...ratio.children].find(node => node.getAttribute('aria-hidden') === 'true' && /\//.test(node.textContent || ''));
      if (slash) parts.push(separatedText(slash));
      parts.push(separatedText(ofPlanned));
      const plan = separatedText(ratio.querySelector('[data-budget-ratio-plan]'));
      if (plan) parts.push(plan);
    } else {
      [...ratio.children].forEach(node => {
        if (node.hasAttribute('data-budget-ratio-actual')) return;
        const bit = separatedText(node);
        if (bit) parts.push(bit);
      });
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
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
        const openPanel = hero.querySelector('.blend-hero-panel');
        if (!openPanel) return;
        if (event.target.closest('summary') && !event.target.closest('[data-operating-question="07"]')) return;
        openPanel.open = !openPanel.open;
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
    if (header && !header.classList.contains('blend-toolbar')) {
      const active = document.activeElement;
      header.classList.add('blend-toolbar');
      bento.insertBefore(header, bento.firstChild);
      if (active && active !== document.body && header.contains(active) && document.activeElement !== active) {
        active.focus({ preventScroll: true });
      }
    }
    const guard = (label, fn) => {
      try { fn(); }
      catch (error) { console.error('Budget blend stopped on ' + label, error); }
    };
    guard('payday', () => paintPayday(progress));
    guard('hero', () => paintHero(hero));
    guard('income', () => paintIncome(bento));
    guard('bills', () => paintBills(bento));
    guard('household', () => paintHouse(bento));
    guard('cards', () => paintCards(bento));
    guard('goals', () => paintGoals(bento));
    guard('funding', () => parkFunding(bento));
    guard('badges', () => paintFaceBadges(bento));
    guard('quiet', () => paintQuiet(bento));
    guard('river', () => paintRiver(bento));
    guard('lift', () => liftFace(bento));
    bento.querySelectorAll('[data-budget-browse="bills"], [data-budget-browse="spending"], .budget-blend-card-movements, [data-budget-savings-goals]')
      .forEach(node => node.classList.add('blend-tilt'));
  }

  function liftFace(bento) {
    const ordered = [
      bento.querySelector('.blend-toolbar'),
      bento.querySelector('.g-river-wrap'),
      bento.querySelector('.budget-blend-hero-layout'),
      bento.querySelector('.blend-income'),
      bento.querySelector('.blend-pay'),
      bento.querySelector('[data-budget-browse="bills"]'),
      bento.querySelector('[data-budget-browse="spending"]'),
      bento.querySelector('.budget-blend-card-movements'),
      bento.querySelector('[data-budget-savings-goals]'),
    ];
    ordered.forEach(node => { if (node) bento.appendChild(node); });
    bento.querySelectorAll(':scope > .budget-surface-grid, :scope > .budget-browse-grid').forEach(node => {
      node.classList.add('g-source');
    });
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
  }

  // One row per engine status id. A null word draws no chip.
  // belowBuffer stays null: a null-low defect can print a false Tight.
  // Restore it later by replacing null with ['Tight', 'warn'].
  const PLAN_STATUS = {
    onPlan: ['On plan', 'good'],
    belowBuffer: null,
    negative: ['Short', 'crit'],
    gap: ['Short', 'crit'],
    unfunded: ['Short', 'crit'],
    combination: ['Short', 'crit'],
    overrideBreach: ['Short', 'crit'],
    infeasible: null,
    unavailable: null,
  };

  function paintPlanStatus(hero) {
    if (!selectedPeriodIsCurrent(hero)) {
      hero.querySelector('.blend-plan-chip')?.remove();
      hero.querySelector('.blend-plan-note')?.remove();
      return;
    }
    const panelBodyNode = hero.querySelector('.blend-hero-panel-body');
    if (panelBodyNode && !hero.querySelector('.blend-plan-note')) {
      const note = document.createElement('p');
      note.className = 'blend-plan-note';
      note.textContent = 'Plan status covers the next 13 weeks, not just this pay period.';
      panelBodyNode.appendChild(note);
    }
    const band = document.getElementById('status-band');
    const id = band && band.getAttribute('data-plan-status');
    const mapped = id && Object.prototype.hasOwnProperty.call(PLAN_STATUS, id) ? PLAN_STATUS[id] : null;
    let chip = hero.querySelector('.blend-plan-chip');
    if (!mapped) {
      chip?.remove();
      return;
    }
    if (!chip) {
      chip = document.createElement('span');
      const hidden = document.createElement('span');
      hidden.className = 'budget-cash-sr';
      const word = document.createElement('span');
      word.className = 'blend-plan-word';
      chip.append(hidden, word);
      const row = hero.querySelector('.blend-hero-id') || top;
      row?.appendChild(chip);
    }
    chip.className = 'blend-plan-chip is-' + mapped[1];
    chip.querySelector('.budget-cash-sr').textContent = 'Plan status (13-week window)';
    chip.querySelector('.blend-plan-word').textContent = mapped[0];
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

  function splitFaceCents(node) {
    if (!node) return;
    const raw = node.textContent || '';
    const parts = raw.match(/^(.*?)(-?\$[\d,]+)(\.\d{2})(.*)$/);
    if (!parts) return;
    node.replaceChildren();
    if (parts[1]) node.appendChild(document.createTextNode(parts[1]));
    node.appendChild(document.createTextNode(parts[2]));
    const cents = document.createElement('span');
    cents.className = 'blend-cents';
    cents.textContent = parts[3];
    node.appendChild(cents);
    if (parts[4]) node.appendChild(document.createTextNode(parts[4]));
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

  function paintIncome(bento) {
    if (bento.querySelector('.blend-income')) return;
    const step = bento.querySelector('[data-operating-question="02"]');
    const plan = step && step.querySelector('[data-budget-ratio="income"] [data-budget-ratio-plan]');
    const planText = text(plan);
    const money = moneyToken(planText);
    const estimated = /estimated|≈/.test(planText);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'blend-tile blend-income blend-tilt tile t-income';
    const received = moneyToken(text(step && step.querySelector('[data-budget-ratio="income"] [data-budget-ratio-actual]')));
    const head = document.createElement('span');
    head.className = 'blend-tile-head';
    const title = document.createElement('span');
    title.className = 'blend-tile-title';
    title.textContent = 'Planned income';
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
    splitFaceCents(big);
    figure.appendChild(big);
    if (money && estimated) {
      const pill = document.createElement('span');
      pill.className = 'blend-est';
      pill.textContent = 'est.';
      figure.appendChild(pill);
    }
    const rows = depositRows(step || bento);
    const todayMarked = !!document.querySelector('.budget-window-days .is-today, [data-budget-window-progress] .is-today');
    const muted = document.createElement('span');
    muted.className = 'blend-muted';
    const value = step && step.querySelector('.budget-step-value');
    muted.textContent = printedIncomeSentence(step);
    if (received && muted.textContent) muted.classList.add('blend-clip');
    const pulse = document.createElement('span');
    pulse.className = 'blend-dep-pulse';
    pulse.setAttribute('aria-hidden', 'true');
    const track = document.createElement('i');
    track.className = 'blend-p-track';
    const receivedN = printedMagnitude(received);
    const planN = printedMagnitude(money);
    if (receivedN != null && planN != null && planN > 0) {
      const fill = document.createElement('i');
      fill.className = 'blend-p-fill';
      fill.style.setProperty('--w', Math.max(0, Math.min(100, receivedN / planN * 100)).toFixed(2) + '%');
      track.appendChild(fill);
    } else {
      track.classList.add('is-untracked');
      const mark = document.createElement('b');
      mark.className = 'blend-untracked-mark';
      mark.textContent = '—';
      pulse.appendChild(mark);
    }
    pulse.insertBefore(track, pulse.firstChild);
    let seenWaiting = false;
    rows.forEach((row, index) => {
      const got = depositReceived(row);
      const x = rows.length <= 1 ? 12 : 8 + (index / (rows.length - 1)) * 84;
      if (todayMarked && !seenWaiting && !got) {
        const tick = document.createElement('i');
        tick.className = 'blend-p-today';
        tick.setAttribute('aria-hidden', 'true');
        tick.style.left = x + '%';
        pulse.appendChild(tick);
        seenWaiting = true;
      }
      if (!got) seenWaiting = true;
      const dep = document.createElement('span');
      dep.className = 'blend-p-dep' + (got ? ' is-got' : ' is-wait');
      dep.style.left = x + '%';
      const dot = document.createElement('i');
      dot.className = 'blend-p-dot';
      dot.setAttribute('aria-hidden', 'true');
      if (got) dot.appendChild(checkGlyph());
      const caption = document.createElement('span');
      caption.className = 'blend-p-lbl';
      const when = depositDate(row);
      const name = depositName(row);
      caption.textContent = [depositAmount(row), name].filter(Boolean).join(' ') + (when ? ' · ' + when : '');
      dep.append(dot, caption);
      pulse.appendChild(dep);
    });
    button.append(head, figure, pulse);
    if (muted.textContent) button.appendChild(muted);
    if (step) button.addEventListener('click', () => step.querySelector('summary')?.click());
    bento.appendChild(button);
  }

  function billIcon(label) {
    const s = String(label || '').toLowerCase();
    if (!s) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '12');
      circle.setAttribute('cy', '12');
      circle.setAttribute('r', '6');
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', 'currentColor');
      circle.setAttribute('stroke-width', '1.7');
      svg.appendChild(circle);
      return svg;
    }
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
          mark.tabIndex = -1;
          const state = remain && remain.textContent === 'Unavailable' ? 'unknown' : billState(hits[0]);
          if (state === 'overdue') day.classList.add('is-overdue');
          mark.dataset.s = state;
          const category = hits[0].getAttribute('data-budget-bill-category') || '';
          mark.appendChild(billIcon(category));
          let heatSum = 0;
          let heatKnown = false;
          hits.forEach(row => {
            const amount = printedMagnitude(text(row.querySelector('.budget-bill-amount')));
            if (amount != null) { heatSum += amount; heatKnown = true; }
          });
          if (!heatKnown) day.classList.add('is-untracked');
          else day.dataset.blendHeat = String(heatSum);
          if (state !== 'unknown') {
            const badge = document.createElement('i');
            badge.className = 'blend-state day-s' + (state === 'confirm' ? ' blend-pulse' : '');
            badge.dataset.s = state;
            badge.setAttribute('aria-hidden', 'true');
            if (state === 'paid') badge.appendChild(checkGlyph());
            day.appendChild(badge);
          }
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
      const heated = [...cal.querySelectorAll('[data-blend-heat]')];
      const maxHeat = heated.reduce((max, el) => Math.max(max, Number(el.dataset.blendHeat) || 0), 0);
      heated.forEach(el => {
        const share = maxHeat > 0 ? (Number(el.dataset.blendHeat) || 0) / maxHeat : 0;
        el.style.setProperty('--heat', share.toFixed(4));
        if (share >= 0.66) el.classList.add('is-hot');
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

  function categoryArc(share) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 112 112');
    svg.setAttribute('class', 'blend-arc-ring');
    svg.setAttribute('aria-hidden', 'true');
    const ns = 'http://www.w3.org/2000/svg';
    const circle = (cls, extra) => {
      const node = document.createElementNS(ns, 'circle');
      node.setAttribute('cx', '56');
      node.setAttribute('cy', '56');
      node.setAttribute('r', '44');
      node.setAttribute('fill', 'none');
      node.setAttribute('class', cls);
      if (extra) Object.entries(extra).forEach(([key, value]) => node.setAttribute(key, value));
      svg.appendChild(node);
      return node;
    };
    const track = circle(share == null ? 'rg-track is-dotted' : 'rg-track');
    if (share != null) {
      const circ = 2 * Math.PI * 44;
      const drawn = Math.max(0, Math.min(1, share)) * circ;
      circle('rg-arc', {
        'stroke-linecap': 'round',
        transform: 'rotate(-90 56 56)',
        'stroke-dasharray': drawn.toFixed(2) + ' ' + circ.toFixed(2),
      });
    }
    const glass = document.createElementNS(ns, 'circle');
    glass.setAttribute('cx', '56');
    glass.setAttribute('cy', '56');
    glass.setAttribute('r', '36');
    glass.setAttribute('class', 'rg-glass');
    svg.appendChild(glass);
    track.setAttribute('stroke-width', '7');
    return svg;
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
      const nothingPrinted = !known && !/\$[\d,]/.test(status) && /not observed|unavailable|unknown|^$/i.test(status);
      const well = document.createElement('span');
      well.className = 'blend-ring-g' + (nothingPrinted ? ' is-empty' : '');
      const value = document.createElement('span');
      value.className = 'blend-ring-v';
      value.textContent = nothingPrinted ? '—' : (status || '—');
      if (!nothingPrinted) splitFaceCents(value);
      if (known) {
        const spent = Math.max(0, Math.min(1, Math.max(0, Math.min(100, width)) / 100));
        button.style.setProperty('--pct', spent.toFixed(4));
        button.classList.add('has-arc');
      }
      well.append(categoryArc(known ? Math.max(0, Math.min(1, Math.max(0, Math.min(100, width)) / 100)) : null), value);
      if (known) {
        const wave = document.createElement('span');
        wave.className = 'blend-wave';
        wave.setAttribute('aria-hidden', 'true');
        well.appendChild(wave);
      }
      const label = document.createElement('span');
      label.className = 'blend-ring-l';
      label.textContent = planned ? name + ' · of ' + planned.trim() : name;
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
      const word = document.createElement('span');
      word.className = 'blend-other-state';
      const counted = text(other[0]).match(/\d+\s+to sort/i);
      const rawOther = text(other[0]);
      word.textContent = counted ? counted[0]
        : /needs a category/i.test(rawOther) ? 'needs a category'
        : (/not observed|unavailable|unknown/i.test(status) && !/\$[\d,]/.test(status) ? '—' : status);
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
    let anyMoney = false;
    bento.querySelectorAll('.card-movement-trigger').forEach(button => {
      const name = text(button.querySelector('.card-movement-title')) || text(button);
      if (!button.querySelector('.blend-cc-chip')) {
        const chip = document.createElement('span');
        chip.className = 'blend-cc-chip cc-chip';
        const net = /visa/i.test(name) ? 'visa' : /mastercard|\bmc\b/i.test(name) ? 'mc' : /\bflex\b/i.test(name) ? 'flex' : '';
        if (net) chip.setAttribute('data-net', net);
        const hue = /travel/i.test(name) ? '28' : /cash/i.test(name) ? '210' : /triangle/i.test(name) ? '262' : /amazon|mbna/i.test(name) ? '198' : '220';
        chip.style.setProperty('--h', hue);
        button.prepend(chip);
      }
      const qualifier = button.querySelector('.card-movement-qualifier');
      if (qualifier && /Opening balance unavailable|Future period not observed|not observed|unavailable/i.test(text(qualifier))) {
        qualifier.classList.add('blend-card-aside');
      }
      const delta = button.querySelector('.card-movement-delta');
      const money = moneyToken(text(delta));
      if (money) anyMoney = true;
      else if (delta && !button.querySelector('.blend-cc-dash')) {
        const dash = document.createElement('span');
        dash.className = 'blend-cc-dash cc-chg';
        dash.textContent = '—';
        delta.classList.add('blend-clip');
        delta.after(dash);
        const bal = document.createElement('span');
        bal.className = 'cc-bal';
        bal.textContent = '—';
        dash.after(bal);
        const line = document.createElement('i');
        line.className = 'blend-cc-untracked cc-spark';
        line.setAttribute('aria-hidden', 'true');
        button.appendChild(line);
      }
    });
    if (!heading.querySelector('.blend-cc-net')) {
      const meta = document.createElement('span');
      meta.className = 'blend-cc-net';
      meta.textContent = anyMoney ? '' : 'Net —';
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
        const mark = document.createElement('b');
        mark.className = 'blend-untracked-mark';
        mark.textContent = '—';
        bar.appendChild(mark);
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
    const title = document.createElement('span');
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
      const summary = document.createElement('summary');
      summary.className = 'blend-clip';
      summary.textContent = 'Savings detail';
      panel.appendChild(summary);
      card.appendChild(panel);
      const head = card.querySelector('.blend-tile-head');
      head?.addEventListener('click', event => {
        event.preventDefault();
        panel.open = !panel.open;
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
          ? bento.querySelector('[data-budget-browse="bills"] .blend-bills-head')
          : null;
      const key = cat || bill || label;
      if (!host || host.querySelector('[data-blend-badge="' + CSS.escape(key) + '"]')) return;
      const badge = document.createElement('span');
      badge.className = 'blend-face-badge';
      badge.setAttribute('data-blend-badge', key);
      badge.textContent = label;
      host.appendChild(badge);
    });
  }

  // Geometry only. Empty text is not zero. Number('') must never become a height.
  function timelineGeometry(displayed) {
    const raw = String(displayed == null ? '' : displayed).replace(/[−–]/g, '-').replace(/,/g, '').trim();
    if (!raw) return null;
    const match = raw.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const number = Number(match[0]);
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

  // Reads ol[data-bad-timeline] only. The amount is the span text.
  // trust=unavailable or an empty span is a muted dash with no height.
  // Absent list: the same neutral dashes, still focusable, and not a navigator.
  function readBadTimeline(doc) {
    const list = doc.querySelector('ol[data-bad-timeline]');
    if (!list) return { present: false, nodes: [] };
    const nodes = [...list.children].filter(node => node.tagName === 'LI').map((li, index) => {
      const trust = li.getAttribute('data-bad-term-trust') || '';
      const span = li.querySelector('[data-bad-term-amount]');
      const amount = span ? String(span.textContent == null ? '' : span.textContent).replace(/\s+/g, ' ').trim() : '';
      const closed = trust === 'unavailable' || amount.length === 0;
      const negative = !closed && li.getAttribute('data-sign') === 'negative';
      return {
        index: index,
        start: li.getAttribute('data-bad-timeline-start') || '',
        end: li.getAttribute('data-bad-timeline-end') || '',
        role: li.getAttribute('data-bad-timeline-role') || '',
        range: li.getAttribute('data-bad-timeline-range-label') || '',
        trust: trust,
        face: li.getAttribute('data-bad-terms-face') || '',
        amount: amount,
        label: closed ? '—' : amount,
        unavailable: closed,
        estimated: !closed && trust === 'estimated',
        negative: negative,
        tone: closed ? 'muted' : (negative ? 'short' : 'income'),
        magnitude: closed ? null : timelineGeometry(amount),
      };
    });
    return { present: true, nodes: nodes };
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
    const dir = index > current ? '1' : '-1';
    const steps = Math.abs(index - current);
    for (let i = 0; i < steps; i++) {
      const button = document.querySelector('[data-budget-window-step="' + dir + '"]');
      if (!button || button.getAttribute('aria-disabled') === 'true') return;
      button.click();
    }
  }

  function paintRiver(bento) {
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
    play.setAttribute('aria-hidden', 'true');
    if (selected < 0) play.hidden = true;
    const pill = document.createElement('div');
    pill.className = 'playhead-pill';
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
    const orb = document.createElement('span');
    orb.className = 'playhead-orb';
    play.append(pill, beam, orb);
    if (!absent) {
      const marks = nodes.map(riverMonth);
      const firstChange = marks.findIndex((mark, i) => i && mark && marks[i - 1] && mark.key !== marks[i - 1].key);
      let yearShown = false;
      marks.forEach((mark, i) => {
        if (!mark) return;
        const prev = i ? marks[i - 1] : null;
        const boundary = prev ? prev.key !== mark.key : (firstChange < 0 || firstChange >= 2);
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
      button.setAttribute('aria-label', node.label + ', ' + (node.range || ('pay period ' + (node.index + 1))));
      button.addEventListener('click', () => chooseBadTimeline(node.index, model));
      vals.appendChild(button);
    });
    river.append(canvas, slide, play);
    nav.appendChild(river);
    wrap.appendChild(nav);
    const toolbar = bento.querySelector('.blend-toolbar');
    if (toolbar) toolbar.after(wrap);
    else bento.prepend(wrap);
    const layout = { off: 0, xs: [] };
    river.addEventListener('keydown', event => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      if (absent) return;
      const current = displayedTimelineIndex(model.nodes);
      if (current < 0) return;
      const next = current + (event.key === 'ArrowRight' ? 1 : -1);
      if (next < 0 || next >= model.nodes.length) return;
      chooseBadTimeline(next, model);
    });
    river.addEventListener('click', event => {
      if (absent || event.target.closest('.rv')) return;
      const rect = river.getBoundingClientRect();
      const x = event.clientX - rect.left + layout.off;
      let best = 0;
      let bestDist = Infinity;
      layout.xs.forEach((px, i) => {
        const dist = Math.abs(px - x);
        if (dist < bestDist) { best = i; bestDist = dist; }
      });
      chooseBadTimeline(best, model);
    });
    const draw = () => {
      const rect = river.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height || 178;
      if (!width) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const n = nodes.length;
      const mobile = width < 640;
      const pad = mobile ? 26 : 36;
      const minSp = mobile ? 44 : 52;
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
      const sel = selected < 0 ? -1 : Math.max(0, Math.min(n - 1, selected));
      let off = 0;
      if (contentW > width + 1 && sel >= 0) {
        off = Math.max(0, Math.min(contentW - width, xs[sel] - width / 2));
      }
      layout.off = off;
      layout.xs = xs;
      slide.style.width = contentW + 'px';
      slide.style.transform = 'translate3d(' + (-off).toFixed(1) + 'px,0,0)';
      const dark = document.documentElement.getAttribute('data-theme') === 'dark'
        || (!document.documentElement.getAttribute('data-theme') && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      const palette = dark
        ? { income: 'rgb(92, 242, 176)', short: 'rgb(255, 86, 102)', muted: 'rgba(244,245,247,.45)' }
        : { income: 'rgb(10, 168, 112)', short: 'rgb(228, 52, 80)', muted: 'rgba(16,18,27,.35)' };
      ctx.save();
      ctx.translate(-off, 0);
      ctx.setLineDash([2, 6]);
      ctx.strokeStyle = palette.muted;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xs[0], y0);
      ctx.lineTo(xs[n - 1], y0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      let carry = null;
      for (let i = 0; i < n - 1; i++) {
        const knownSeg = ys[i] != null && ys[i + 1] != null;
        const fromY = ys[i] != null ? ys[i] : (carry != null ? carry : y0);
        const toY = knownSeg ? ys[i + 1] : (ys[i + 1] != null ? ys[i + 1] : fromY);
        ctx.beginPath();
        ctx.moveTo(xs[i], fromY);
        ctx.lineTo(xs[i + 1], toY);
        if (knownSeg) {
          ctx.setLineDash([]);
          ctx.strokeStyle = palette[nodes[i + 1].tone] || palette.income;
          ctx.lineWidth = 2.4;
        } else {
          ctx.setLineDash([2, 6]);
          ctx.strokeStyle = palette.muted;
          ctx.lineWidth = 1.5;
        }
        ctx.stroke();
        if (ys[i + 1] != null) carry = ys[i + 1];
        else if (ys[i] != null) carry = ys[i];
      }
      ctx.setLineDash([]);
      nodes.forEach((node, i) => {
        if (ys[i] == null) return;
        const past = node.role === 'past';
        ctx.globalAlpha = past ? 0.55 : 1;
        const radius = node.tone === 'short' ? 3.6 : 2.6;
        ctx.fillStyle = dark ? 'rgba(255,255,255,.9)' : '#fff';
        ctx.beginPath();
        ctx.arc(xs[i], ys[i], radius + 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = palette[node.tone] || palette.income;
        ctx.beginPath();
        ctx.arc(xs[i], ys[i], radius, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
      [...vals.children].forEach((el, i) => { el.style.left = xs[i].toFixed(1) + 'px'; });
      [...months.children].forEach(el => {
        const i = Number(el.dataset.i);
        const x = Math.max(0, xs[i] - (i ? sp / 2 : 0)) + 6;
        el.style.left = x.toFixed(1) + 'px';
      });
      if (sel >= 0) {
        const screenX = xs[sel] - off;
        const orbY = ys[sel] == null ? y0 : ys[sel];
        play.hidden = false;
        play.style.transform = 'translate3d(' + screenX.toFixed(1) + 'px,0,0)';
        play.style.setProperty('--orb-y', orbY.toFixed(1) + 'px');
        const pw = pill.offsetWidth || 160;
        const shift = Math.max(-screenX + 8, Math.min(width - screenX - pw - 8, -pw / 2));
        pill.style.transform = 'translate3d(' + shift.toFixed(1) + 'px,0,0)';
      }
    };
    requestAnimationFrame(draw);
    window.addEventListener('resize', draw);
  }

  function paintQuiet() {
    if (document.querySelector('.blend-quiet')) return;
    const footer = document.querySelector('.wrap > footer');
    if (!footer) return;
    const quiet = document.createElement('div');
    quiet.className = 'blend-quiet';
    footer.before(quiet);
    quiet.appendChild(footer);
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
