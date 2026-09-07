'use strict';
/* Subscriptions — "What recurring subscriptions and memberships does the household carry?"
 *
 * Every row comes from Forecast.householdSubscriptions on the served /data.json
 * the shared core fetched. Cadence, next date, monthly-equivalent and the page
 * total are Forecast's. This file formats those outputs. It never annualises a
 * charge, never relabels yearly or biweekly as monthly, never invents a next
 * date from the clock, never classifies a merchant as a subscription, and
 * never totals page constants.
 *
 * An unknown fact stays "Unknown". It is never printed as $0 or as a monthly
 * charge merely for presentation. */

const SUBSCRIPTIONS_CONFIDENCE_CHIP = { verified: 'v', confirmed: 'v', calculated: 'e', estimated: 'w' };

function subscriptionsConfidenceChip(confidence) {
  const value = confidence || 'unknown';
  const cls = SUBSCRIPTIONS_CONFIDENCE_CHIP[value] || 'c';
  return `<span class="chip ${cls}">${value.toUpperCase()}</span>`;
}

function subscriptionsUnknown() {
  return '<span class="subscriptions-unknown">Unknown</span>';
}

function subscriptionsMoney(amount, confidence) {
  if (amount == null || !isFinite(Number(amount))) return subscriptionsUnknown();
  const estimated = confidence === 'estimated';
  return `${estimated ? '≈ ' : ''}${money2(amount)}`;
}

function subscriptionsCadence(row) {
  const label = row.frequencyLabel || null;
  const note = row.cadenceNote ? `<small>${row.cadenceNote}</small>` : '';
  if (!label) return `${subscriptionsUnknown()}${note}`;
  return `${label}${note}`;
}

function subscriptionsNextDate(row) {
  if (!row.nextDate) return subscriptionsUnknown();
  return fmtDateFull(row.nextDate);
}

function subscriptionsMonthlyEquivalent(row) {
  if (row.monthlyEquivalent == null || !isFinite(Number(row.monthlyEquivalent))) {
    return subscriptionsUnknown();
  }
  return money2(row.monthlyEquivalent);
}

function subscriptionsRowHtml(row) {
  return `<tr data-subscription-id="${row.id}" data-subscription-frequency="${row.frequency || 'unknown'}">
    <td>
      <span class="subscriptions-name">${row.label}</span>
      ${subscriptionsConfidenceChip(row.confidence)}
    </td>
    <td class="num" data-subscriptions-fact="amount">${subscriptionsMoney(row.amount, row.confidence)}</td>
    <td data-subscriptions-fact="cadence">${subscriptionsCadence(row)}</td>
    <td data-subscriptions-fact="next">${subscriptionsNextDate(row)}</td>
    <td class="num" data-subscriptions-fact="monthly">${subscriptionsMonthlyEquivalent(row)}</td>
  </tr>`;
}

function subscriptionsTableHtml(view) {
  const rows = Array.isArray(view.subscriptions) ? view.subscriptions : [];
  if (!rows.length) {
    return '<p class="lede">No subscriptions are on this opening.</p>';
  }
  return `<div class="scroll subscriptions-wrap">
    <table>
      <thead>
        <tr>
          <th>Subscription</th>
          <th class="num">Amount</th>
          <th>Cadence</th>
          <th>Next</th>
          <th class="num">Monthly equivalent</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(subscriptionsRowHtml).join('')}
      </tbody>
    </table>
  </div>`;
}

function subscriptionsTotalHtml(view) {
  const total = view.monthlyEquivalentTotal;
  if (total == null || !isFinite(Number(total))) {
    return `<div data-subscriptions-total="unknown">
      <span>Total monthly equivalent</span>
      <b>${subscriptionsUnknown()}</b>
    </div>
    <p class="subscriptions-total-note">No subscription on this page has a cadence Atlas can convert to a monthly equivalent.</p>`;
  }
  const excluded = Number(view.monthlyEquivalentExcludedCount) || 0;
  const excludedNote = excluded
    ? ` ${excluded} subscription${excluded === 1 ? '' : 's'} with an unknown or one-time cadence ${excluded === 1 ? 'is' : 'are'} listed above and ${excluded === 1 ? 'is' : 'are'} not in this total.`
    : '';
  return `<div data-subscriptions-total="known">
      <span>Total monthly equivalent</span>
      <b>${money2(total)}</b>
    </div>
    <p class="subscriptions-total-note">Monthly equivalent normalizes non-monthly charges. It is not the amount that will leave the account every month.${excludedNote}</p>`;
}

function subscriptionsPageHtml(view) {
  const rows = Array.isArray(view.subscriptions) ? view.subscriptions : [];
  const asOf = view.asOf ? fmtDateFull(view.asOf) : 'this opening';
  return {
    lede: rows.length
      ? `${rows.length} subscription${rows.length === 1 ? '' : 's'} on the ${asOf} opening.`
      : '',
    list: subscriptionsTableHtml(view),
    total: subscriptionsTotalHtml(view),
    note: 'Rows are Forecast.householdSubscriptions from the served plan. Household bills are a separate list. A yearly or biweekly charge keeps that cadence on screen. Unknown facts stay Unknown. Nothing here cancels a service or moves money.',
  };
}

function renderSubscriptions(d) {
  const view = Forecast.householdSubscriptions(d.plan, d.meta.asOf);
  const html = subscriptionsPageHtml(view);
  $('subscriptions-lede').textContent = html.lede;
  $('subscriptions-list').innerHTML = html.list;
  $('subscriptions-total').innerHTML = html.total;
  $('subscriptions-note').textContent = html.note;
}

App.register(renderSubscriptions);
App.boot();
