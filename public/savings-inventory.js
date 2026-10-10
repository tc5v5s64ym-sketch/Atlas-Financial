'use strict';
// Both surfaces print the same Forecast inventory. No totals, allocation,
// backing, freshness or target arithmetic belongs to this renderer.
(function (root) {
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = value => typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(value) : 'Unknown';
  const stateNames = { backed: 'Backed by observed cash', deficit: 'Pool deficit', stale: 'Stale balance',
    'cash-unknown': 'Cash unknown', 'intent-unknown': 'Assignments unknown',
    'pending-evidence': 'Pending evidence', 'goal-unresolved': 'Goal needs reconciliation' };
  const amount = (label, value, trust, attr) => `<div class="savings-inventory-fact"${attr ? ` data-savings-${attr}` : ''}><dt>${label}</dt><dd>${money(value)} <small>${escape(trust || 'unknown')}</small></dd></div>`;
  // Presentation join only, mirroring the Budget savings surfaces: a grouped
  // row's members are already published by Forecast (backing.items, plus
  // unresolved for withheld members) and its this-period components already
  // published in period.cycleAllocations. No figure is computed here: a
  // member prints only when its key matches exactly one published item, and
  // a member allocation prints only when exactly one published allocation
  // names it; otherwise the figure stays unknown and the group-level
  // published value stands. Settled members are absent from the publication
  // and are never reconstructed here. The allocation identity follows the
  // period kind Forecast publishes (current: occurrence key item.key;
  // projected: bare requirement id item.id), must be unique across the
  // published items and allocations, and is never dual-alias matched.
  // Historical packets withhold the group's figures, so member figures
  // withhold identically — names and dates print, today's numbers do not.
  function groupMembers(packet, row) {
    const keys = Array.isArray(row?.members) ? row.members : [];
    if (keys.length < 2) return null;
    const published = [...(packet?.backing?.items || []), ...(packet?.unresolved || [])];
    const byKey = new Map();
    for (const item of published) {
      if (!item?.key) continue;
      byKey.set(item.key, byKey.has(item.key) ? null : item);
    }
    const projected = packet?.period?.kind === 'projected';
    const identityOf = item => projected ? item?.id : item?.key;
    const identityCounts = new Map();
    for (const item of published) {
      const identity = identityOf(item);
      if (typeof identity === 'string' && identity)
        identityCounts.set(identity, (identityCounts.get(identity) || 0) + 1);
    }
    const allocations = new Map();
    for (const part of packet?.period?.cycleAllocations || []) {
      if (typeof part?.id !== 'string') continue;
      allocations.set(part.id, allocations.has(part.id) ? null : part);
    }
    const seen = new Set(), members = [];
    for (const key of keys) {
      if (seen.has(key)) continue;
      seen.add(key);
      const item = byKey.get(key) || null;
      const identity = item ? identityOf(item) : null;
      const allocation = typeof identity === 'string' && identityCounts.get(identity) === 1
        ? allocations.get(identity) : undefined;
      members.push({ key, item, thisPeriod: allocation ? allocation.amount : null });
    }
    const found = members.filter(member => member.item);
    const groupLabels = [...new Set(found.map(member => member.item.groupLabel).filter(Boolean))];
    const groups = [...new Set(found.map(member => member.item.group).filter(Boolean))];
    const title = groupLabels.length === 1 ? groupLabels[0]
      : groups.length === 1 && groups[0] === 'burrards-team-fees' ? 'Burrards team fees' : row.label;
    return { title, members, historical: packet?.period?.kind === 'historical' };
  }
  function memberHtml(packet, row) {
    const group = groupMembers(packet, row);
    if (!group) return { title: row.label, html: '' };
    const members = group.members.map(member => {
      const item = member.item;
      if (group.historical) return `<li data-savings-member="${escape(member.key)}"><b>${escape(item ? item.label : 'Member name unavailable')}</b> <span>${escape(item?.date || 'Date unavailable')}</span><dl>${amount('Currently backed', null, 'unknown', 'member-backed')}${amount('Needed', null, 'unknown', 'member-needed')}${amount('Projected this period', null, 'unknown', 'member-period')}</dl></li>`;
      const needed = item && item.needed == null && item.neededRange
        && (item.trust === 'calculated' || item.trust === 'estimated')
        ? `<div class="savings-inventory-fact" data-savings-member-needed><dt>Needed</dt><dd>${money(item.neededRange.min)} - ${money(item.neededRange.max)} <small>${escape(item.trust || 'unknown')}</small></dd></div>`
        : amount('Needed', item ? item.needed : null, item ? item.trust : 'unknown', 'member-needed');
      return `<li data-savings-member="${escape(member.key)}"><b>${escape(item ? item.label : 'Member name unavailable')}</b> <span>${escape(item?.date || 'Date unavailable')}</span><dl>${amount('Currently backed', item ? item.saved : null, item ? item.trust : 'unknown', 'member-backed')}${needed}${amount('Projected this period', member.thisPeriod, member.thisPeriod == null ? 'unknown' : row.thisPeriodTrust, 'member-period')}</dl></li>`;
    }).join('');
    return { title: group.title, html: `<ul class="savings-inventory-members">${members}</ul>` };
  }
  function html(inventory, context = {}) {
    if (inventory?.source === 'Forecast.savingsDailyFunding' || context.plan?.savingsEarmarks?.allocationPolicy != null) {
      const forecast = root.Forecast || (typeof require === 'function' ? require('./forecast') : null);
      const packet = forecast?.savingsFundingPublication(inventory, context);
      if (!packet) {
        return '<section class="savings-inventory" data-savings-inventory="unavailable"><h2>One savings pot</h2><p>Shared savings evidence is unavailable. No zero saved balance has been assumed.</p></section>';
      }
      if (packet.allocationMode === 'historical-pools' && packet.manualInventory)
        return html(packet.manualInventory);
      const rows = (packet.rows || []).map(row => { const members = memberHtml(packet, row); return `<article data-savings-goal="${escape(row.key)}"><h3>${escape(members.title)}</h3><dl>${amount('Currently backed', row.saved, row.savedTrust, 'backed')}${amount('Needed', row.needed, row.neededTrust, 'needed')}${amount('Projected this period', row.thisPeriod, row.thisPeriodTrust)}</dl>${members.html}</article>`; }).join('');
      const pools = (packet.backing?.pools || []).map(pool => `<li>${escape(pool.label || pool.accountId)}: ${money(pool.observedCash)} <small>${escape(pool.observedAsOf || 'Date unavailable')}</small></li>`).join('');
      return `<section class="savings-inventory" data-savings-inventory="${escape(packet.backing?.status || 'unavailable')}"><h2>One savings pot</h2><p>Observed stock as of ${escape(packet.asOf)}: ${money(packet.stock?.amount)}. Currently backed amounts follow unpaid planning dates across both reserves.</p><p>Calculated backing is separate from manual assignments, actual transfers and future projected top-ups.</p>${packet.backing?.reason ? '<p>'+escape(packet.backing.reason)+'</p>' : ''}${rows}<details><summary>Accounts &amp; evidence</summary><ul>${pools}</ul><p>Physical withdrawal routing and money movement are not authorized by this view.</p></details></section>`;
    }
    const packet = inventory || { status: 'setup-unknown', reason: 'Savings setup is unknown.' };
    const head = '<h2>Savings assigned to goals</h2>';
    if (packet.status !== 'ready') return `<section class="savings-inventory" data-savings-inventory="${escape(packet.status)}">${head}<p>${escape(packet.reason)}</p><p class="operating-note">Starting assignments are unknown. No zero saved balance has been assumed.</p>${packet.instructionReason ? `<p>${escape(packet.instructionReason)}</p>` : ''}</section>`;
    const pools = (packet.pools || []).map(pool => `<article class="savings-inventory-pool" data-savings-pool="${escape(pool.id)}" data-savings-state="${escape(pool.status)}">
      <div class="savings-inventory-heading"><h3>${escape(pool.label)}</h3><span class="chip ${pool.status === 'backed' ? 'v' : 'w'}">${escape(stateNames[pool.status] || 'Unknown')}</span></div>
      <p>${escape(pool.reason)}</p><p class="operating-note">Balance evidence: ${escape(pool.observedAsOf || 'Unknown')} · ${escape(pool.currency)}</p>
      ${pool.purpose ? `<p>${escape(pool.purpose)}</p>` : ''}
      ${!pool.intentKnown && (pool.plannedGoals || []).length ? `<ul>${pool.plannedGoals.map(goal => `<li>${escape(goal.label)} — assignment and backing await confirmation</li>`).join('')}</ul>` : ''}
      <dl>${amount('Observed pool cash', pool.observedCash, pool.observedTrust, 'cash')}${amount('Confirmed assigned', pool.intent, pool.intentTrust, 'intent')}${amount('Unallocated cash', pool.unallocated, pool.unallocatedTrust, 'unallocated')}${pool.deficit > 0 ? amount('Pool deficit', pool.deficit, pool.deficitTrust, 'deficit') : ''}</dl>
      ${pool.intentKnown ? `<p class="operating-note">Confirmed ${escape(pool.confirmedAt)}, revision ${escape(pool.revision)} · ${escape(pool.confirmationSource)}</p>` : ''}
      ${pool.allocations.length ? `<ul class="savings-inventory-allocations">${pool.allocations.map(row => `<li data-savings-allocation="${escape(row.goalKey)}"><b>${escape(row.label)}</b><span>Confirmed: ${money(row.intent)}</span><span>Currently backed: ${money(row.backed)} <small>${escape(row.backedTrust)}</small></span></li>`).join('')}</ul>` : `<p class="operating-note">${pool.intentKnown ? 'No goal assignments in this confirmed snapshot.' : 'Starting goal assignments have not been supplied.'}</p>`}
    </article>`).join('');
    const goals = (packet.goals || []).map(goal => `<article class="savings-inventory-goal" data-savings-goal="${escape(goal.key)}"><h3>${escape(goal.label)}</h3>
      <dl>${amount('Confirmed across pools', goal.intent, 'calculated')}${amount('Currently backed', goal.backed, goal.backedTrust)}${amount('Existing goal requirement', goal.target, goal.targetTrust)}${goal.targetMax != null && goal.targetMax !== goal.target ? amount('Upper requirement', goal.targetMax, goal.targetTrust) : ''}</dl>
      ${goal.settled ? '<p>Goal is settled. Its earmark remains assigned.</p>' : ''}<p class="operating-note">${escape(goal.release)}</p></article>`).join('');
    return `<section class="savings-inventory" data-savings-inventory="ready">${head}<p class="operating-note">These assignments divide the same observed cash. They are not extra cash to add to balances or reserve backing. Deposits remain unallocated; settled withdrawals use that residual first. Silver already in a pool is included once, with no inferred purpose.</p>
      <div class="savings-inventory-pools">${pools}</div>${goals ? `<details class="savings-inventory-goals"><summary>Goal requirements and assignments</summary>${goals}</details>` : ''}
      <p class="operating-note" data-savings-instructions="withheld">${escape(packet.instructionReason)}</p></section>`;
  }
  root.SavingsInventory = { html };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SavingsInventory;
})(typeof window !== 'undefined' ? window : globalThis);
