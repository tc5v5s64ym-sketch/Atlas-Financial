'use strict';
/* Bills — "What recurring household bills does the household carry?"
 *
 * Every row comes from Forecast.householdBills on the served /data.json the
 * shared core fetched. Cadence, next date, monthly-equivalent and the page
 * total are Forecast's. This file formats those outputs. It never annualises
 * a bill, never relabels quarterly or biweekly as monthly, never invents a
 * next date from the clock, never infers paid/unpaid because a date passed,
 * and never totals page constants.
 *
 * An unknown fact stays "Unknown". It is never printed as $0 or as a monthly
 * bill merely for presentation. */

const BILLS_CONFIDENCE_CHIP = { verified: 'v', confirmed: 'v', calculated: 'e', estimated: 'w' };

function billsConfidenceChip(confidence) {
  const value = confidence || 'unknown';
  const cls = BILLS_CONFIDENCE_CHIP[value] || 'c';
  return `<span class="chip ${cls}">${value.toUpperCase()}</span>`;
}

function billsUnknown() {
  return '<span class="bills-unknown">Unknown</span>';
}

function billsMoney(amount, confidence) {
  if (amount == null || !isFinite(Number(amount))) return billsUnknown();
  const estimated = confidence === 'estimated';
  return `${estimated ? '≈ ' : ''}${money2(amount)}`;
}

function billsCadence(row) {
  const label = row.frequencyLabel || null;
  const note = row.cadenceNote ? `<small>${row.cadenceNote}</small>` : '';
  if (!label) return `${billsUnknown()}${note}`;
  return `${label}${note}`;
}

function billsNextDate(row) {
  if (!row.nextDate) return billsUnknown();
  return fmtDateFull(row.nextDate);
}

function billsMonthlyEquivalent(row) {
  if (row.monthlyEquivalent == null || !isFinite(Number(row.monthlyEquivalent))) {
    return billsUnknown();
  }
  return money2(row.monthlyEquivalent);
}

function billsRowHtml(row) {
  return `<tr data-bill-id="${row.id}" data-bill-frequency="${row.frequency || 'unknown'}">
    <td>
      <span class="bills-name">${row.label}</span>
      ${billsConfidenceChip(row.confidence)}
    </td>
    <td class="num" data-bills-fact="amount">${billsMoney(row.amount, row.confidence)}</td>
    <td data-bills-fact="cadence">${billsCadence(row)}</td>
    <td data-bills-fact="next">${billsNextDate(row)}</td>
    <td class="num" data-bills-fact="monthly">${billsMonthlyEquivalent(row)}</td>
  </tr>`;
}

function billsTableHtml(view) {
  const rows = Array.isArray(view.bills) ? view.bills : [];
  if (!rows.length) {
    return '<p class="lede">No household bills are on this opening.</p>';
  }
  return `<div class="scroll bills-wrap">
    <table>
      <thead>
        <tr>
          <th>Bill</th>
          <th class="num">Amount</th>
          <th>Cadence</th>
          <th>Next</th>
          <th class="num">Monthly equivalent</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(billsRowHtml).join('')}
      </tbody>
    </table>
  </div>`;
}

function billsTotalHtml(view) {
  const total = view.monthlyEquivalentTotal;
  if (total == null || !isFinite(Number(total))) {
    return `<div data-bills-total="unknown">
      <span>Total monthly equivalent</span>
      <b>${billsUnknown()}</b>
    </div>
    <p class="bills-total-note">No bill on this page has a cadence Atlas can convert to a monthly equivalent.</p>`;
  }
  const excluded = Number(view.monthlyEquivalentExcludedCount) || 0;
  const excludedNote = excluded
    ? ` ${excluded} bill${excluded === 1 ? '' : 's'} with an unknown or one-time cadence ${excluded === 1 ? 'is' : 'are'} listed above and ${excluded === 1 ? 'is' : 'are'} not in this total.`
    : '';
  return `<div data-bills-total="known">
      <span>Total monthly equivalent</span>
      <b>${money2(total)}</b>
    </div>
    <p class="bills-total-note">Comparison figure from bills with a known recurring cadence. It is not the amount that will leave the account every month.${excludedNote}</p>`;
}

function billsPageHtml(view) {
  const rows = Array.isArray(view.bills) ? view.bills : [];
  const asOf = view.asOf ? fmtDateFull(view.asOf) : 'this opening';
  return {
    lede: rows.length
      ? `${rows.length} household bill${rows.length === 1 ? '' : 's'} on the ${asOf} opening. Cadence is the plan frequency. Monthly equivalent is only shown when Forecast can derive it from that cadence.`
      : '',
    list: billsTableHtml(view),
    total: billsTotalHtml(view),
    note: 'Rows are Forecast.householdBills from the served plan. Subscriptions and memberships are a separate list and are not here. A dated due whose recurring cadence is not on the plan stays a dated due. A passed date is not treated as paid. Nothing here ranks bills or moves money.',
  };
}

function renderBills(d) {
  const view = Forecast.householdBills(d.plan, d.meta.asOf);
  const html = billsPageHtml(view);
  $('bills-lede').textContent = html.lede;
  $('bills-list').innerHTML = html.list;
  $('bills-total').innerHTML = html.total;
  $('bills-note').textContent = html.note;
}

App.register(renderBills);
App.boot();
