'use strict';
/* Inert Lunch Money recurring-items reader (GET /recurring_items).
 *
 * Synthetic loopback stub only — no production calls, no real data, no
 * real credential (the token below is a literal test string). Fixture rows
 * are literals supplied here and assertions compare the module's output
 * against those literals and the recorded request line — never against
 * values recomputed through the module itself.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

const R = require('../scripts/provider-recurring-items.js');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const clone = (x) => JSON.parse(JSON.stringify(x));

const TOKEN = 'test-token';
let requests = [];
let handler = null;
let port = 0;

function startStub() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
      handler(req, res);
    });
    server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(server); });
  });
}
const base = () => `http://127.0.0.1:${port}/v2`;
const jsonHandler = (payload, status = 200, headers = {}) => (req, res) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(payload));
};
const fetchIt = (opts = {}) => R.fetchRecurringItems({
  token: TOKEN, base: base(), fetchOptions: { allowLoopback: true }, ...opts,
});
async function expectReject(promise, label) {
  try { await promise; ok(false, label, 'did not reject'); }
  catch (err) { ok(true, label, err.message); }
}

function validReviewed() {
  return {
    id: 777001,
    description: 'Synthetic Utility',
    status: 'reviewed',
    transaction_criteria: {
      start_date: '2026-01-15', end_date: null, granularity: 'month', quantity: 1,
      anchor_date: '2026-01-15', payee: 'Synthetic Utility Co', amount: '1250.8400',
      to_base: 1250.84, currency: 'cad', plaid_account_id: 77001, manual_account_id: null,
    },
    overrides: { payee: null, notes: 'synthetic note', category_id: 88001 },
    matches: {
      expected_occurrence_dates: ['2026-09-15', '2026-10-15'],
      found_transactions: [990001],
      missing_transaction_dates: ['2026-10-15'],
    },
    created_by: 'synthetic-user',
    created_at: '2026-01-15T08:00:00.000Z',
    updated_at: '2026-09-20T08:00:00.000Z',
    source: 'manual',
  };
}
function validSuggested() {
  return {
    id: 777002,
    description: null,
    status: 'suggested',
    transaction_criteria: {
      start_date: null, end_date: null, granularity: 'week', quantity: 2,
      anchor_date: '2026-09-01', payee: null, amount: '0.0000',
      to_base: 0, currency: 'usd', plaid_account_id: null, manual_account_id: 77002,
    },
    matches: null,
    created_by: 'synthetic-detector',
    created_at: '2026-09-01T08:00:00.000Z',
    updated_at: '2026-09-01T08:00:00.000Z',
    source: null,
  };
}

async function main() {
  const server = await startStub();
  try {
    console.log('=== A. construction / no consumer wiring ===');
    {
      const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'provider-recurring-items.js'), 'utf8');
      const requires = [...source.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]).sort();
      ok(JSON.stringify(requires) === JSON.stringify(['./provider-observe.js', 'http', 'https']),
        'module requires only node http/https and provider-observe (base guard + LIVE_BASE)', requires.join(','));
      ok(!/require\('[^']*(recurring-audit|assistant|forecast|recommend|server|scheduler|mcp)/i.test(source),
        'module requires no consumer, Forecast, server, scheduler, MCP, or recurring-audit surface');
      ok(typeof R.fetchRecurringItems === 'function' && typeof R.fetchRecurringItemsLive === 'function',
        'exports the async reader and the live entry');
    }

    console.log('=== B. URL contract + requested window + verbatim mapping ===');
    {
      requests = [];
      handler = jsonHandler({ recurring_items: [validReviewed()] });
      const env = await fetchIt({ startDate: '2026-09-01', endDate: '2026-10-31' });
      ok(requests.length === 1 && requests[0].method === 'GET', 'exactly one GET');
      const url = new URL(requests[0].url, 'http://stub');
      ok(url.pathname === '/v2/recurring_items', 'path is /recurring_items', url.pathname);
      ok(url.searchParams.get('start_date') === '2026-09-01' && url.searchParams.get('end_date') === '2026-10-31',
        'start/end dates sent verbatim');
      ok(url.searchParams.get('include_suggested') === 'false', 'include_suggested always sent explicitly (default false)');
      ok(![...url.searchParams.keys()].some((k) => /limit|offset|cursor|page/.test(k)), 'no pagination parameters sent');
      ok(requests[0].authorization === `Bearer ${TOKEN}`, 'Authorization Bearer header sent');
      ok(env.schema === 'atlas-lunchmoney-recurring-items/v1', 'envelope schema id');
      ok(env.matchWindow === 'requested' && env.startDate === '2026-09-01' && env.endDate === '2026-10-31',
        'requested window is distinguishable in the envelope');
      ok(env.complete === true && env.itemCount === 1
        && env.validationCounts.total === 1 && env.validationCounts.complete === 1 && env.validationCounts.incomplete === 0,
        'complete envelope with validation counts');
      const item = env.items[0];
      ok(item.providerRecurringItemId === 777001 && item.description === 'Synthetic Utility' && item.status === 'reviewed',
        'identity, description, status verbatim');
      const c = item.transactionCriteria;
      ok(c.amount === '1250.8400' && c.currency === 'cad', 'amount decimal string and currency verbatim');
      ok(!('toBase' in c) && !JSON.stringify(env).includes('to_base') && !JSON.stringify(env).includes('1250.84,'),
        'to_base omitted entirely from the output');
      ok(c.startDate === '2026-01-15' && c.endDate === null && c.granularity === 'month' && c.quantity === 1
        && c.anchorDate === '2026-01-15' && c.payee === 'Synthetic Utility Co'
        && c.plaidAccountId === 77001 && c.manualAccountId === null,
        'criteria fields verbatim, documented nulls preserved');
      ok(item.overrides && item.overrides.payee === null && item.overrides.notes === 'synthetic note'
        && item.overrides.categoryId === 88001, 'overrides verbatim');
      ok(item.matches && JSON.stringify(item.matches.expectedOccurrenceDates) === '["2026-09-15","2026-10-15"]'
        && JSON.stringify(item.matches.foundTransactionIds) === '[990001]'
        && JSON.stringify(item.matches.missingTransactionDates) === '["2026-10-15"]',
        'reviewed matches preserved verbatim (missing dates kept as data, never relabelled)');
      ok(item.createdBy === 'synthetic-user' && item.createdAt === '2026-01-15T08:00:00.000Z'
        && item.updatedAt === '2026-09-20T08:00:00.000Z' && item.source === 'manual'
        && item.unavailableFields.length === 0, 'provenance verbatim, nothing unavailable');
      ok(/not proof of payment/.test(env.caveat) && /never proves/.test(env.caveat), 'envelope caveat pins evidence semantics');
    }

    console.log('=== C. provider-default window + include_suggested=true + suggested item ===');
    {
      requests = [];
      handler = jsonHandler({ recurring_items: [validSuggested()] });
      const env = await fetchIt({ includeSuggested: true });
      const url = new URL(requests[0].url, 'http://stub');
      ok(url.searchParams.get('include_suggested') === 'true', 'include_suggested=true sent when requested');
      ok(!url.searchParams.has('start_date') && !url.searchParams.has('end_date'), 'no dates sent when none requested');
      ok(env.matchWindow === 'provider-default' && env.startDate === null && env.endDate === null,
        'provider-default window recorded without inventing effective dates');
      const item = env.items[0];
      ok(item.matches === null && item.description === null && item.source === null
        && item.unavailableFields.length === 0,
        'suggested matches null and documented nulls (description, source) are NOT unavailable');
      ok(item.transactionCriteria.amount === '0.0000', 'zero decimal string preserved verbatim');
      ok(env.complete === true, 'suggested-only list can be complete');
    }

    console.log('=== D. empty result is a valid complete read ===');
    {
      handler = jsonHandler({ recurring_items: [] });
      const env = await fetchIt();
      ok(env.complete === true && env.itemCount === 0 && env.items.length === 0, 'empty list, complete=true');
    }

    console.log('=== E. decimal-string amount contract ===');
    {
      for (const amount of ['0', '-12.3']) {
        const row = validReviewed(); row.transaction_criteria.amount = amount;
        handler = jsonHandler({ recurring_items: [row] });
        const env = await fetchIt();
        ok(env.items[0].transactionCriteria.amount === amount && env.complete === true,
          `valid amount ${amount} preserved verbatim`);
      }
      for (const bad of [12.3, '1.23456', 'abc', null, undefined]) {
        const row = validReviewed();
        if (bad === undefined) delete row.transaction_criteria.amount;
        else row.transaction_criteria.amount = bad;
        handler = jsonHandler({ recurring_items: [row] });
        const env = await fetchIt();
        const c = env.items[0].transactionCriteria;
        ok(c.amount && c.amount.unavailable === true && env.complete === false
          && env.items[0].unavailableFields.includes('transactionCriteria.amount'),
          `malformed amount ${JSON.stringify(bad)} is unavailable, never 0`, '');
        ok(c.currency === 'cad' && env.items[0].status === 'reviewed', 'other fields unaffected by one malformed field');
      }
    }

    console.log('=== F. identity failures fail the whole read ===');
    {
      const dup = validSuggested(); dup.id = 777001;
      handler = jsonHandler({ recurring_items: [validReviewed(), dup] });
      await expectReject(fetchIt(), 'duplicate id rejects');
      const noId = validReviewed(); delete noId.id;
      handler = jsonHandler({ recurring_items: [noId] });
      await expectReject(fetchIt(), 'missing id rejects');
      const badId = validReviewed(); badId.id = '777001';
      handler = jsonHandler({ recurring_items: [badId] });
      await expectReject(fetchIt(), 'non-integer id rejects');
      handler = jsonHandler({ recurring_items: [null] });
      await expectReject(fetchIt(), 'non-object item rejects with no partial items');
    }

    console.log('=== G. argument validation makes no request ===');
    {
      requests = [];
      handler = jsonHandler({ recurring_items: [] });
      await expectReject(fetchIt({ startDate: '2026-09-01' }), 'one-sided window (start only) rejects');
      await expectReject(fetchIt({ endDate: '2026-10-31' }), 'one-sided window (end only) rejects');
      await expectReject(fetchIt({ startDate: '2026-02-30', endDate: '2026-03-01' }), 'non-calendar date rejects');
      await expectReject(fetchIt({ startDate: '2026-10-31', endDate: '2026-09-01' }), 'end before start rejects');
      await expectReject(fetchIt({ includeSuggested: 'yes' }), 'non-boolean includeSuggested rejects');
      await expectReject(R.fetchRecurringItems({ base: base(), fetchOptions: { allowLoopback: true } }), 'missing token rejects');
      await expectReject(R.fetchRecurringItems({ token: '  ', base: base(), fetchOptions: { allowLoopback: true } }), 'blank token rejects');
      await expectReject(R.fetchRecurringItems({ token: TOKEN, base: base() }), 'loopback base without explicit allowLoopback rejects');
      await expectReject(R.fetchRecurringItems({ token: TOKEN, base: 'https://example.invalid/v2', fetchOptions: { allowLoopback: true } }),
        'arbitrary non-loopback, non-production base rejects');
      ok(requests.length === 0, 'no request was made for any rejected argument set', `${requests.length} requests`);
    }

    console.log('=== H. malformed envelopes + pagination evidence ===');
    {
      handler = jsonHandler([1, 2, 3]);
      await expectReject(fetchIt(), 'array top-level rejects');
      handler = jsonHandler({});
      await expectReject(fetchIt(), 'missing recurring_items rejects');
      handler = jsonHandler({ recurring_items: {} });
      await expectReject(fetchIt(), 'non-array recurring_items rejects');
      handler = jsonHandler({ recurring_items: [validReviewed()], has_more: false });
      await expectReject(fetchIt(), 'has_more member is pagination evidence and rejects (even when false)');
      handler = jsonHandler({ recurring_items: [validReviewed()], next_cursor: 'x' });
      await expectReject(fetchIt(), 'next_cursor member rejects');
      handler = jsonHandler({ recurring_items: [validReviewed()], provider_request_id: 'synthetic' });
      const env = await fetchIt();
      ok(env.complete === true, 'harmless unknown additive envelope field tolerated');
      const extra = validReviewed(); extra.future_field = { anything: true };
      handler = jsonHandler({ recurring_items: [extra] });
      const env2 = await fetchIt();
      ok(env2.complete === true && !('future_field' in env2.items[0]) && !('futureField' in env2.items[0]),
        'harmless unknown additive item field ignored, not carried');
    }

    console.log('=== I. semantic-field unavailability (per-field, never defaulted) ===');
    {
      const row = validReviewed(); row.status = 'pending-ish'; row.transaction_criteria.granularity = 'fortnight';
      handler = jsonHandler({ recurring_items: [row] });
      const env = await fetchIt();
      const item = env.items[0];
      ok(item.status.unavailable === true && item.transactionCriteria.granularity.unavailable === true
        && item.matches.unavailable === true && env.complete === false,
        'out-of-enum status/granularity unavailable; matches unvalidatable without status');
      const row2 = validReviewed(); delete row2.source;
      handler = jsonHandler({ recurring_items: [row2] });
      const env2 = await fetchIt();
      ok(env2.items[0].source.unavailable === true && env2.complete === false,
        'absent source is unavailable provenance, never invented');
      const row3 = validReviewed(); row3.source = 'carrier-pigeon';
      handler = jsonHandler({ recurring_items: [row3] });
      const env3 = await fetchIt();
      ok(env3.items[0].source.unavailable === true, 'out-of-enum source unavailable');
      const row4 = validReviewed(); row4.transaction_criteria.payee = null;
      row4.transaction_criteria.plaid_account_id = null; row4.description = null;
      handler = jsonHandler({ recurring_items: [row4] });
      const env4 = await fetchIt();
      ok(env4.complete === true && env4.items[0].unavailableFields.length === 0,
        'documented nulls elsewhere (payee, account id, description) stay complete');
    }

    console.log('=== J. matches shape rules ===');
    {
      const s = validSuggested(); s.matches = { expected_occurrence_dates: [], found_transactions: [], missing_transaction_dates: [] };
      handler = jsonHandler({ recurring_items: [s] });
      const env = await fetchIt();
      ok(env.items[0].matches.unavailable === true && env.complete === false,
        'suggested item with non-null matches is unavailable (documented shape is null)');
      const r = validReviewed(); r.matches = null;
      handler = jsonHandler({ recurring_items: [r] });
      const env2 = await fetchIt();
      ok(env2.items[0].matches.unavailable === true, 'reviewed item with null matches is unavailable');
      const r2 = validReviewed(); r2.matches.found_transactions = ['990001'];
      handler = jsonHandler({ recurring_items: [r2] });
      const env3 = await fetchIt();
      ok(env3.items[0].matches.unavailable === true, 'reviewed matches with a non-integer found id is unavailable');
    }

    console.log('=== K. transport safety ===');
    {
      let redirectHits = 0;
      handler = (req, res) => {
        if (req.url.includes('elsewhere')) { redirectHits++; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
        res.writeHead(302, { Location: `${base()}/elsewhere` }); res.end();
      };
      await expectReject(fetchIt(), '3xx redirect is an error, never followed with credentials');
      ok(redirectHits === 0, 'redirect target was never requested');
      handler = jsonHandler({ error: 'synthetic' }, 500);
      try {
        await fetchIt(); ok(false, 'HTTP 500 rejects');
      } catch (err) {
        ok(/HTTP 500/.test(err.message) && !err.message.includes(TOKEN), 'HTTP 500 rejects with a sanitized message (status only, no token)');
      }
      handler = (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(R.MAX_RESPONSE_BYTES + 1) });
        res.end('{}');
      };
      await expectReject(fetchIt(), 'declared oversized body rejects');
      handler = (req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('not json'); };
      await expectReject(fetchIt(), 'non-JSON body rejects');
    }

    console.log('=== L. live entry (env token + incumbent base guard) ===');
    {
      requests = [];
      handler = jsonHandler({ recurring_items: [validReviewed()] });
      const env = await R.fetchRecurringItemsLive({
        env: { LUNCHMONEY_ACCESS_TOKEN: TOKEN, ATLAS_LUNCHMONEY_API_BASE: base() },
      });
      ok(env.complete === true && requests.length === 1, 'live entry reads through the env-configured loopback base');
      requests = [];
      await expectReject(R.fetchRecurringItemsLive({ env: {} }), 'live entry without env token rejects');
      ok(requests.length === 0, 'live entry made no request without a token');
    }
  } finally {
    server.close();
  }
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
