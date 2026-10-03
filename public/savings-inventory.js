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
  function html(inventory) {
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
