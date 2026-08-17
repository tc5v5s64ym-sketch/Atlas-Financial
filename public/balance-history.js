'use strict';
/* Display-only assembly of dated balance snapshots.
 *
 * Reads already-written historical observations, orders them, and formats
 * deltas. Does not decide Forecast policy, does not invent missing points,
 * and does not treat credit as cash. The page holds the HTML only.
 */
(function (root) {
  const money2 = n => {
    const v = Number(n);
    const abs = Math.abs(v).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (v < 0 ? '−$' : '$') + abs;
  };
  const fmtDate = iso => {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-CA', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const round2 = v => Math.round(Number(v) * 100) / 100;

  function snapshotsOf(history) {
    return ((history && history.snapshots) || [])
      .filter(s => s && typeof s.asOf === 'string' && Array.isArray(s.accounts))
      .slice()
      .sort((a, b) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0));
  }

  function accountIds(history) {
    const ids = new Set();
    for (const snap of snapshotsOf(history)) {
      for (const acc of snap.accounts) {
        if (acc && acc.id) ids.add(acc.id);
      }
    }
    return [...ids].sort();
  }

  function seriesFor(history, id) {
    const pts = [];
    for (const snap of snapshotsOf(history)) {
      const acc = snap.accounts.find(a => a.id === id);
      if (!acc || !Number.isFinite(Number(acc.balance))) continue;
      pts.push({
        asOf: snap.asOf,
        id: acc.id,
        label: acc.label,
        collection: acc.collection,
        side: acc.side,
        currency: acc.currency || 'CAD',
        balance: Number(acc.balance),
        pending: acc.pendingUnknown ? null : (acc.pending == null ? null : Number(acc.pending)),
        pendingUnknown: acc.pendingUnknown === true,
        pot: acc.pot || null,
      });
    }
    return pts;
  }

  function displayMove(points) {
    if (!points || points.length === 0) {
      return { sufficient: false, current: null, prior: null, delta: null, direction: null };
    }
    const current = points[points.length - 1];
    if (points.length < 2) {
      return { sufficient: false, current, prior: null, delta: null, direction: null };
    }
    const prior = points[points.length - 2];
    const delta = round2(current.balance - prior.balance);
    const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'unchanged';
    return { sufficient: true, current, prior, delta, direction };
  }

  function movementWord(move, label) {
    const name = label || (move.current && move.current.label) || 'This account';
    if (!move.sufficient) {
      if (move.current) {
        return `${name} has one dated opening (${fmtDate(move.current.asOf)}). Not enough history yet for a trend.`;
      }
      return `${name} has no dated opening yet.`;
    }
    if (move.direction === 'unchanged') {
      return `Between ${fmtDate(move.prior.asOf)} and ${fmtDate(move.current.asOf)} the ${name} balance was unchanged.`;
    }
    const verb = move.direction === 'down' ? 'fell' : 'rose';
    return `Between ${fmtDate(move.prior.asOf)} and ${fmtDate(move.current.asOf)} the ${name} balance ${verb} ${money2(Math.abs(move.delta))}.`;
  }

  function spendableSeries(history) {
    const pts = [];
    for (const snap of snapshotsOf(history)) {
      const rows = snap.accounts.filter(a =>
        a && a.collection === 'cash' && a.pot === 'spendable' && Number.isFinite(Number(a.balance)));
      if (!rows.length) continue;
      pts.push({
        asOf: snap.asOf,
        id: 'spendable-cash',
        label: 'Spendable household cash',
        collection: 'cash',
        side: 'asset',
        ids: rows.map(r => r.id).sort(),
        balance: round2(rows.reduce((s, r) => s + Number(r.balance), 0)),
      });
    }
    return pts;
  }

  function comparableSpendable(points) {
    if (!points || points.length < 2) return points || [];
    const last = points[points.length - 1];
    const key = last.ids.join(',');
    return points.filter(p => p.ids.join(',') === key);
  }

  function accountRows(history) {
    const rows = [];
    const spendable = comparableSpendable(spendableSeries(history));
    if (spendable.length) {
      rows.push({ kind: 'aggregate', id: 'spendable-cash', label: 'Spendable household cash', side: 'asset', move: displayMove(spendable), points: spendable });
    }
    for (const id of accountIds(history)) {
      const points = seriesFor(history, id);
      if (!points.length) continue;
      const head = points[points.length - 1];
      rows.push({
        kind: 'account',
        id,
        label: head.label,
        side: head.side,
        collection: head.collection,
        move: displayMove(points),
        points,
      });
    }
    return rows;
  }

  function signedMoney(n) {
    const v = round2(n);
    if (v === 0) return money2(0);
    return (v > 0 ? '+' : '−') + money2(Math.abs(v)).slice(1);
  }

  function render(history) {
    const rows = accountRows(history);
    if (!rows.length) {
      return '<p class="lede" id="balance-history-empty">No dated account openings have been stored yet.</p>';
    }
    const heloc = rows.find(r => r.id === 'heloc');
    const helocLine = heloc ? `<p class="lede" id="balance-history-heloc">${movementWord(heloc.move, 'HELOC')}</p>` : '';
    const body = rows.map(r => {
      const move = r.move;
      const current = move.current ? money2(move.current.balance) : '—';
      const prior = move.prior ? money2(move.prior.balance) : '—';
      const delta = move.sufficient ? signedMoney(move.delta) : '—';
      const dates = move.sufficient
        ? `${fmtDate(move.prior.asOf)} → ${fmtDate(move.current.asOf)}`
        : (move.current ? fmtDate(move.current.asOf) : '—');
      const note = move.sufficient ? movementWord(move, r.label) : 'Not enough dated openings yet for a trend.';
      return `<tr>
        <td>${r.label}${r.kind === 'aggregate' ? ' <span class="chip">sum</span>' : ''}</td>
        <td>${r.side === 'liability' ? 'Liability' : 'Asset'}</td>
        <td class="num">${current}</td>
        <td class="num">${prior}</td>
        <td class="num">${delta}</td>
        <td>${dates}</td>
        <td>${note}</td>
      </tr>`;
    }).join('');
    return `${helocLine}
      <div class="card scroll">
        <table>
          <thead><tr>
            <th>Account</th><th>Side</th><th class="num">Latest</th><th class="num">Prior</th>
            <th class="num">Movement</th><th>Dates</th><th>Reading</th>
          </tr></thead>
          <tbody id="balance-history-rows">${body}</tbody>
        </table>
      </div>`;
  }

  const BalanceHistory = {
    snapshotsOf,
    accountIds,
    seriesFor,
    displayMove,
    movementWord,
    spendableSeries,
    comparableSpendable,
    accountRows,
    signedMoney,
    render,
    money2,
    fmtDate,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BalanceHistory;
  else root.BalanceHistory = BalanceHistory;
})(typeof window !== 'undefined' ? window : globalThis);
