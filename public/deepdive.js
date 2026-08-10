'use strict';
/* Deep Dive — the historical and forensic analysis. This is the original
   dashboard's material, moved off the homepage but preserved whole. */

// Cash is not one thing. Money in a household spending account and money in a
// pass-through account earmarked for someone else are different in kind, and
// adding them together produces a number that is true of nothing.
const CASH_CLASS_LABEL = {
  spendable: 'spendable household cash',
  operational: 'operational / pass-through',
  staging: 'staging',
  'other-liquid': 'other liquid',
  restricted: 'restricted',
};

function renderDeepDive(d) {
  $('coverage-line').textContent = `${d.meta.coverage} · ${d.meta.transactions.toLocaleString('en-CA')} transactions, ${d.meta.statements} statements`;
  $('disclaimer').textContent = d.meta.disclaimer;

  // The cash tile is DERIVED from the plan's cash register, not stored. It used
  // to be a hardcoded "Cash on hand — $3,051.81" that summed six accounts of
  // four different kinds: household spending money, Amanda's pass-through
  // account, a staging account and two US holiday accounts. The Plan page
  // meanwhile said $79.84. Both were describing the same household.
  const cash = d.plan.startingCash;
  const byClass = {};
  for (const h of cash.heldElsewhere || []) {
    (byClass[h.class] = byClass[h.class] || { total: 0, labels: [] });
    byClass[h.class].total += h.value;
    byClass[h.class].labels.push(h.label.replace(/ —.*$/, ''));
  }
  const elsewhere = (cash.heldElsewhere || []).reduce((s, h) => s + h.value, 0);
  const classLine = Object.entries(byClass)
    .map(([k, v]) => `${money(v.total)} ${CASH_CLASS_LABEL[k] || k} (${v.labels.join(', ')})`)
    .join('; ');
  const cashTile = {
    label: 'Spendable household cash',
    value: cash.amount,
    tone: 'alert',
    note: `Chequing A, Chequing B and Savings — the accounts the mortgage, bills and card minimums are actually ` +
      `paid from. A further ${money(elsewhere)} sits elsewhere and is not household spending money: ${classLine}.`,
  };

  $('tiles').innerHTML = [cashTile].concat(d.headline).map(t => `
    <div class="tile ${t.tone === 'plain' ? '' : t.tone}">
      <div class="lab">${t.label}</div>
      <div class="val">${money(t.value)}</div>
      ${t.sub ? `<div class="subval">${money(t.sub.value)} <span>${t.sub.label}</span></div>` : ''}
      <div class="note">${t.note}</div>
    </div>`).join('');

  // Days between the as-of date and a due date, so urgency can be shown
  // relative to the data rather than to whenever the page happens to be opened.
  const asOfDate = new Date(d.meta.asOf + 'T00:00:00');
  const daysUntil = due => Math.round((new Date(due + 'T00:00:00') - asOfDate) / 86400000);
  const dueWord = n => n === 0 ? 'today' : n < 0 ? Math.abs(n) + 'd ago' : 'in ' + n + 'd';

  // Heading derived from the data, not hardcoded to a month.
  const dues = d.upcoming.map(u => u.due).sort();
  $('upcoming-head').textContent =
    `Dated payments, ${fmtDate(dues[0])} – ${fmtDate(dues[dues.length - 1])}`;

  $('upcoming').innerHTML = d.upcoming.map(u => {
    const n = daysUntil(u.due);
    const paid = u.status === 'paid';
    const soon = !paid && n >= 0 && n <= 7;
    const chip = paid ? '<span class="chip v">paid</span>'
      : `<span class="chip ${soon ? 'w' : 'e'}">${dueWord(n)}</span>`;
    // A club fee and a card minimum are both money leaving, but only one of
    // them carries a penalty for being late. Say which is which.
    const kind = u.kind === 'commitment' ? ' <span class="chip">commitment</span>' : '';
    return `
    <tr class="${paid ? 'paid' : soon ? 'soon' : ''}">
      <td>${fmtDate(u.due)} ${chip}</td>
      <td>${u.what}${kind}</td>
      <td class="num">${money2(u.amount)}</td>
      <td class="${paid ? 'pos' : ''}">${paid ? '<strong>Paid</strong> — ' : ''}${u.note || 'Due'}</td>
    </tr>`;
  }).join('');
  $('upcoming-note').textContent = d.upcomingNote;

  // Committed, but beyond the dated window above — the things that arrive as a
  // surprise precisely because they have no due date yet.
  if (d.commitments) {
    const c = d.commitments;
    $('commit-head').textContent = c.heading;
    $('commit-note').textContent = c.note;
    $('commit-list').innerHTML = c.items.map(i => `
      <div class="commit">
        <div class="commit-top">
          <span class="commit-what">${i.what}</span>
          <span class="commit-amt">${money(i.amount)}</span>
        </div>
        <div class="commit-meta">
          <span>${i.when}</span>
          <span class="chip ${i.confidence === 'conditional' ? 'w' : 'e'}">${i.confidence}</span>
        </div>
        <p class="commit-note">${i.note}</p>
      </div>`).join('')
      + (c.schedule ? `
        <div class="commit sched">
          <div class="commit-meta sched-head">When it actually lands</div>
          ${c.schedule.map(s => `
            <div class="sched-row">
              <span>${s.m}</span>
              <span class="sched-bar"><span style="width:${(s.amount / Math.max(...c.schedule.map(x => x.amount))) * 100}%"></span></span>
              <span class="sched-amt">${money(s.amount)}</span>
              <span class="sched-note">${s.note}</span>
            </div>`).join('')}
        </div>` : '')
      + `<div class="commit total">
           <div class="commit-top"><span class="commit-what">Total</span><span class="commit-amt">${money(c.total)}</span></div>
         </div>`;
    $('commit-total-note').textContent = c.totalNote;
    $('commitments').hidden = false;
  }

  const next = d.upcoming
    .filter(u => u.status !== 'paid' && daysUntil(u.due) >= 0)
    .sort((a, b) => a.due < b.due ? -1 : 1)[0];
  const nd = $('next-due');
  if (nd && next) {
    const n = daysUntil(next.due);
    nd.hidden = false;
    nd.innerHTML = `<span class="nd-lab">Next due</span><b>${next.what}</b>` +
      `<span>${money2(next.amount)} on ${fmtDateLong(next.due)}</span>` +
      `<span class="chip ${n <= 7 ? 'w' : 'e'}">${dueWord(n)}</span>`;
  }

  const known = d.debts.filter(x => x.annualInterest != null);
  hbar($('c-debt'), known.map((x, i) => ({
    label: x.label, v: x.annualInterest,
    colour: [css('--s1'), css('--s2'), css('--critical'), css('--critical')][i] || css('--s1'),
    tip: `${money2(x.balance)} at ${pct(x.rate)} · ${x.structure}`,
  })), { rowH: 44, padL: 176 });

  $('debt-table').innerHTML = d.debts.map(x => `
    <tr>
      <td>${x.label}</td>
      <td class="num">${x.balance == null ? '<span class="chip c">unknown</span>' : money2(x.balance)}</td>
      <td class="num ${x.rate >= 20 ? 'neg' : x.rate && x.rate < 5 ? 'pos' : ''}">${x.rate == null ? '—' : pct(x.rate)}</td>
      <td>${x.structure}</td>
      <td class="num">${x.annualInterest == null ? '—' : '~' + money(x.annualInterest)}</td>
    </tr>`).join('');
  if (d.debtsNote) $('debt-note').textContent = d.debtsNote;

  hbar($('c-util'), d.utilisation.map(u => ({
    label: u.label, v: (u.used / u.limit) * 100,
    colour: (u.used / u.limit) > 0.95 ? css('--critical') : css('--serious'),
    // Over the limit is a different fact from merely near it, so say so rather
    // than showing "$0 left" and letting the bar imply it.
    vlabel: u.used > u.limit
      ? money(u.used - u.limit) + ' OVER'
      : money(u.available) + ' left',
    tip: `${money2(u.used)} of a ${money2(u.limit)} limit · ${((u.used / u.limit) * 100).toFixed(1)}% used`,
  })), { rowH: 40, padL: 176 });
  if (d.utilisationNote) $('util-note').textContent = d.utilisationNote;

  lineChart($('c-heloc'), d.helocHistory, d.helocLimit);
  $('heloc-note').textContent = d.helocSummary;

  diverge($('c-flow'), d.cashflow);
  $('flow-note').textContent = d.cashflowNote;

  const grey = css('--muted');

  // Income. The coaching line is gross revenue, so it is coloured as a caution
  // rather than as money the household keeps.
  if (d.income) {
    hbar($('c-income'), d.income.map(i => ({
      label: i.label, v: i.total,
      colour: /REVENUE/i.test(i.stability || '') || /REVENUE/i.test(i.label) ? css('--serious') : css('--s2'),
      tip: `${i.perMonth ? '~' + money(i.perMonth) + '/month · ' : ''}${i.stability || ''}`,
    })), { rowH: 40, padL: 190 });
    $('income-note').textContent =
      `${money2(d.incomeTotal.total)} over 18 months, about ${money(d.incomeTotal.perMonth)}/month. ${d.incomeNote || ''}`;
    if (d.incomeWarning) $('income-warning').textContent = d.incomeWarning;
  }

  $('paypal-table').innerHTML = d.paypal.categories.map(c => `
    <tr><td>${c.label}</td><td class="num">${money2(c.total)}</td><td class="num">~${money(c.perMonth)}</td></tr>`).join('')
    + `<tr><td><strong>Total</strong></td><td class="num"><strong>—</strong></td><td class="num"><strong>~${money(d.paypal.perMonth)}</strong></td></tr>`;
  $('paypal-note').textContent = `${d.paypal.note} Cross-checked against ${money(d.paypal.crossCheck)}/month of bank funding pulls.`;

  hbar($('c-unex'), d.unexplained.map(u => ({
    label: u.label, v: u.amount,
    colour: u.amount > 40000 ? css('--critical') : css('--serious'),
    tip: u.note,
  })), { rowH: 40, padL: 190 });

  // What the HELOC was actually spent on. Interest is coloured apart from the
  // rest: it is the price of the facility, not a thing anyone chose to buy.
  if (d.helocUse) {
    hbar($('c-heloc-use'), d.helocUse.map(u => ({
      label: u.label, v: u.amount,
      colour: /bills, paid direct/i.test(u.label) ? css('--critical')
            : /Interest charged/i.test(u.label) ? grey : css('--s1'),
      tip: `${u.n} transaction${u.n === 1 ? '' : 's'} · ${u.note}`,
    })), { rowH: 40, padL: 210 });
    $('heloc-use-note').textContent = d.helocUseNote;
    $('heloc-chains').textContent = d.helocChains;
  }

  // The Cash Back Visa interest reconciliation. The effective-rate column is
  // the point: it shows at a glance which months fit 26.99% and which do not.
  if (d.interestCheck) {
    const ic = d.interestCheck;
    $('interest-check').innerHTML = ic.rows.map(r => {
      const off = Math.abs(r.eff - 26.99) > 4;
      return `<tr><td>${r.stmt}</td><td class="num">${money2(r.avg)}</td>
        <td class="num">${money2(r.implied)}</td><td class="num">${money2(r.charged)}</td>
        <td class="num ${off ? 'neg' : ''}">${r.eff.toFixed(2)}%</td></tr>`;
    }).join('') + `<tr><td><strong>Five cycles</strong></td><td class="num">—</td>
      <td class="num"><strong>${money2(ic.rows.reduce((s, r) => s + r.implied, 0))}</strong></td>
      <td class="num"><strong>${money2(ic.rows.reduce((s, r) => s + r.charged, 0))}</strong></td>
      <td class="num"><strong>26.99%</strong></td></tr>`;
    $('interest-check-note').textContent = ic.note;
    $('interest-check-cash').textContent = ic.cash;
  }

  // Youth lacrosse. Two charts: what can be seen, and what paid for it.
  if (d.lacrosse) {
    const L = d.lacrosse;
    hbar($('c-lacrosse'), L.sources.map(s => ({
      label: s.label, v: s.amount,
      colour: css('--s1'),
      tip: `${s.n} charge${s.n === 1 ? '' : 's'} · ${s.note}`,
    })), { rowH: 40, padL: 190 });
    $('lacrosse-note').textContent =
      `${money2(L.verified)} verified across ${L.sources.reduce((s, x) => s + x.n, 0)} charges — about ${money(L.perMonth)} a month. ${L.note}`;

    hbar($('c-lacrosse-fund'), L.funding.map(f => ({
      label: f.label, v: f.amount,
      colour: /HELOC/i.test(f.label) ? css('--critical') : css('--s2'),
      tip: f.note || money2(f.amount),
    })), { rowH: 36, padL: 190 });
    $('lacrosse-inferred').textContent = L.inferredNote;
    $('lacrosse-gap').textContent = L.gapNote;
  }

  // E-transfer counterparties, and why the coverage is what it is.
  if (d.counterparties) {
    const c = d.counterparties;
    const pctOf = n => Math.round((n / c.total) * 100) + '%';
    $('cp-stat').innerHTML = [
      { lab: 'Attributed now', val: `${c.attributed} of ${c.total}`, note: pctOf(c.attributed) + ' of all e-transfers', tone: '' },
      { lab: 'Before this pass', val: `${c.previous} of ${c.total}`, note: pctOf(c.previous) + ' — the rest were in the bin', tone: '' },
      { lab: 'Still anonymous', val: `${c.total - c.attributed}`, note: 'no payee, and mostly unrecoverable', tone: 'alert' },
    ].map(t => `
      <div class="tile ${t.tone}">
        <div class="lab">${t.lab}</div><div class="val">${t.val}</div><div class="note">${t.note}</div>
      </div>`).join('');
    $('cp-note').textContent = c.note;
    $('cp-finding').textContent = c.finding;
    $('cp-action').textContent = c.action;
    $('cp-matching').textContent = c.matching;
  }

  // The coaching remittance, traced hop by hop. The last row is the point, so
  // it is marked rather than left for the reader to spot.
  if (d.coachPayment) {
    const c = d.coachPayment;
    $('coach-chain').innerHTML = c.chain.map((h, i) => `
      <tr><td>${h.when}</td><td${i === c.chain.length - 1 ? ' class="neg"' : ''}>${h.what}</td>
      <td class="num">${money2(h.balance)}</td></tr>`).join('');
    $('coach-note').textContent = c.note;
    $('coach-reading').textContent = c.reading;
    $('coach-remaining').textContent = c.remaining;
  }

  if (d.spendingNote) $('spending-detail').textContent = d.spendingNote;

  // Tier 0 means answered — green, not the tier-1 red it would otherwise get.
  $('questions').innerHTML = d.questions.map(q => `
    <div class="qcard ${q.tier === 0 ? 'done' : q.tier === 2 ? 't2' : q.tier === 3 ? 't3' : ''}">
      <h3>${q.q}</h3>
      <p>${q.detail}</p>
      <p class="chg"><strong>What it changes:</strong> ${q.changes} <span class="chip">${q.owner}</span></p>
    </div>`).join('');
}

/* --------------------------------------------------- periods (interactive) */
let CURRENT = 'lastMonth';   // a complete month reads better on first load than
                             // a part-finished one

function renderPeriod(d, periods) {
  if (!periods) return;
  const p = periods.periods[CURRENT];
  const grey = css('--muted');

  [...$('period-bar').children].forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.k === CURRENT)));

  const per = p.months > 1 ? ` · ${money(p.spendingTotal / p.months)}/month across ${p.months} months` : '';
  $('period-summary').innerHTML =
    `<b>${money2(p.spendingTotal)}</b> spending · <b>${money2(p.interestTotal)}</b> interest · ` +
    `<b>${money2(p.feesTotal)}</b> fees${per}`;

  hbar($('c-spend'), p.spending.map(s => ({
    label: s.label, v: s.total,
    colour: s.type === 'essential' ? css('--s1')
          : s.type === 'business' ? css('--s2')
          : s.type === 'unknown' ? grey : css('--serious'),
    tip: `${s.type} · ${money2(s.total)}`,
  })), { rowH: 30, padL: 180 });

  const disc = p.spending.filter(s => s.type === 'discretionary').reduce((a, b) => a + b.total, 0);
  const caveat = (d && d.spendingNote) ? ' ' + d.spendingNote : '';
  $('spend-note').textContent =
    `${p.label}. Blue is essential, orange discretionary, grey unidentified. ` +
    `Discretionary is ${money2(disc)} — ${(disc / (p.spendingTotal || 1) * 100).toFixed(0)}% of the total, ` +
    `and the part that is a decision rather than a fixed cost.` + caveat;

  hbar($('c-interest'), p.interest.map(s => ({
    label: s.label, v: s.total, colour: css('--serious'), tip: money2(s.total),
  })), { rowH: 34, padL: 180 });
  $('interest-note').textContent =
    `${money2(p.interestTotal)} of interest charged in ${p.label.toLowerCase()}. ` +
    `The mortgage adds about $1,620/month on top, inside its payment rather than as a charge.`;

  hbar($('c-fees'), p.fees.map(s => ({
    label: s.label, v: s.total,
    colour: s.type === 'avoidable' ? css('--critical') : css('--s1'),
    tip: `${s.type} · ${money2(s.total)}`,
  })), { rowH: 34, padL: 180 });
  const avoid = p.fees.filter(s => s.type === 'avoidable').reduce((a, b) => a + b.total, 0);
  $('fees-note').textContent = p.feesTotal
    ? `${money2(p.feesTotal)} of fees, of which ${money2(avoid)} was avoidable — red bars. `
      + `Avoidable means it followed from something that happened, not from holding the account.`
    : 'No fees in this period.';

  grouped($('c-trend'), periods.monthly, [
    { key: 'spending', label: 'Spending', colour: css('--s1') },
    { key: 'interest', label: 'Interest', colour: css('--serious') },
    { key: 'fees', label: 'Fees', colour: css('--critical') },
  ]);
  $('trend-note').textContent =
    'Every month captured, on one scale — so interest and fees look small beside spending, which is the '
    + 'honest comparison but hard to read. Hover any month for exact figures. Card spending only begins in '
    + 'August 2025, so earlier months show chequing alone and are lower for that reason rather than because '
    + 'less was spent.';
}

function setupPeriods(d, periods) {
  if (!periods) return;
  const bar = $('period-bar');
  bar.replaceChildren();
  for (const [k, v] of Object.entries(periods.periods)) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'preset'; b.dataset.k = k;
    b.textContent = v.label.replace(/ \(.*\)/, '');
    b.title = v.label;
    b.addEventListener('click', () => { CURRENT = k; renderPeriod(App.data, periods); });
    bar.appendChild(b);
  }
}

App.once(setupPeriods);
App.register(renderDeepDive);
App.register(renderPeriod);
App.boot({ periods: true });
