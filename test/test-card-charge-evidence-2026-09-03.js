'use strict';
/* 2026-09-03 owner-provided revolving-card evidence intake.
 * `node test/test-card-charge-evidence-2026-09-03.js`
 *
 * Proves the pack is filed with coverage caveats and that plan.bills was
 * not extended from discovery. Independent of Forecast.occurrences:
 * forbidden merchants are checked on the live bills array itself.
 */
const fs = require('fs');
const path = require('path');
const data = require('../data.json');
const { sourceText } = require('./test-source-text');

const ROOT = path.join(__dirname, '..');
const INTAKE = path.join(ROOT, 'docs/source_intake/HOUSEHOLD_CARD_CHARGE_EVIDENCE_2026-09-03.md');
const REGISTER = path.join(ROOT, 'docs/evidence_use/register.json');
const QUESTIONS = path.join(ROOT, 'docs/01_OPEN_QUESTIONS.md');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

const intake = sourceText(fs.readFileSync(INTAKE, 'utf8'));
const questions = sourceText(fs.readFileSync(QUESTIONS, 'utf8'));
const register = JSON.parse(fs.readFileSync(REGISTER, 'utf8'));
const bills = data.plan.bills || [];

function registerRow(id) {
  return (register.items || []).find(row => row.id === id);
}

console.log('=== coverage caveat is recorded, not 18–24 months ===');
{
  ok(/2026-02-02/.test(intake) && /2026-09-03/.test(intake),
    'inclusive card window 2026-02-02 → 2026-09-03 is recorded');
  ok(/~7 months/.test(intake) && /not 18.?24 months/i.test(intake),
    'pack states ~7 months and refuses an 18–24 month claim');
  ok(/travelvisa/.test(intake) && /215/.test(intake),
    'Travel Visa 215 txns recorded');
  ok(/cashback/.test(intake) && /152/.test(intake),
    'Cash Back 152 txns recorded');
  ok(/PERSONAL CREDIT CARD \| 17 \|/.test(intake),
    'Personal Credit Card 17 txns recorded');
  ok(/Amazon MBNA Credit Card \| 7 \|/.test(intake),
    'MBNA 7 txns recorded');
  ok(/Triangle Mastercard \| \*\*ZERO\*\*/.test(intake)
    && /not evidence of absence/.test(intake),
    'Triangle zero is recorded as not evidence of absence');
}

console.log('\n=== Phoenix two hits stay unproven and unplanned ===');
{
  ok(/Phoenix Digital Health/.test(intake) && /PHOENIX DIGITAL HEALTH/.test(intake),
    'exact merchant is recorded');
  ok(/2026-08-05/.test(intake) && /124\.99/.test(intake),
    'first hit 2026-08-05 −$124.99 is recorded');
  ok(/2026-09-03/.test(intake) && /174\.99/.test(intake) && /pending/i.test(intake),
    'second hit 2026-09-03 −$174.99 pending is recorded');
  ok(/Interval 29 days/.test(intake) && /Monthly is UNPROVEN/i.test(intake),
    '29-day interval is not promoted to a proven monthly bill');
  ok(/Two hits[\s\S]{0,40}not a bill/i.test(intake),
    'two hits are not a bill');
  ok(!/phoenix/i.test(questions),
    'this pack does not open a Phoenix purpose question');
}

console.log('\n=== Amazon and Prime are not bills ===');
{
  ok(/36 shopping charges/.test(intake) && /Not a subscription/i.test(intake),
    'Travel Visa Amazon shopping is recorded as not a subscription');
  ok(/Prime-like FLAG ONLY/i.test(intake) && /\$11\.19/.test(intake),
    'Prime-like $11.19 day-19 flag is recorded');
  ok(/not automatically Amanda/i.test(intake) && /2026-07-13/.test(intake),
    'MBNA Amazon is not Amanda by default');
}

console.log('\n=== unplanned card candidates are evidence only ===');
{
  ok(/MAILCHIMP/.test(intake) && /31\.73/.test(intake) && /32\.53/.test(intake),
    'Mailchimp five-hit series is recorded');
  ok(/AICHATAPP\+18888287054/.test(intake) && /44\.99/.test(intake),
    'AICHATAPP merchant and $44.99 cadence are recorded');
  ok(/Not enough to call already planned/i.test(intake),
    'AICHATAPP is not treated as ChatGPT Plus');
  ok(/CALENDLY/.test(intake) && /19\.09/.test(intake),
    'Calendly four-hit series is recorded');
  ok(/INTEREST CHARGE -PURCHASE/.test(intake)
    && /not a new `plan\.bills` row/.test(intake),
    'card interest stays off plan.bills');
}

console.log('\n=== plan.bills was not extended from this discovery ===');
{
  const forbidden = /phoenix|calendly|aichat|amazon.?prime|shopify/i;
  const hits = bills.filter(b => forbidden.test(`${b.id} ${b.label}`));
  ok(hits.length === 0,
    'no forbidden merchant became a plan.bills id or label',
    hits.map(b => b.id).join(','));
  ok(!bills.some(b => /mailchimp/i.test(b.id + ' ' + b.label)),
    'Mailchimp is not a plan.bills row');
  ok(/Canva, Mailchimp, Guitar Tabs monthly, and GitHub annual have no forward recurrence/.test(data.plan.billsNote),
    'Mailchimp remains off forward recurrence in billsNote');

  const dale = bills.find(b => b.id === 'chatgpt-plus-dale');
  ok(dale && dale.amount === 28 && dale.day === 14 && dale.confidence === 'estimated',
    'ChatGPT Plus Dale remains $28 estimated on the 14th, not AICHATAPP $44.99 on the 2nd');
  const amanda = bills.find(b => b.id === 'chatgpt-plus-amanda');
  ok(amanda && amanda.amount === 24.99 && amanda.day === 14,
    'ChatGPT Plus Amanda remains $24.99 on the 14th');

  const bell = bills.find(b => b.id === 'bell');
  ok(bell && bell.amount === 121 && bell.needsDate === true && bell.confidence === 'estimated',
    'Bell remains undated estimated $121');
  ok(/\$250/.test(bell.note) && /\$69\.15/.test(bell.note) && /settlement/i.test(bell.note),
    'Bell $250 / $69.15 stay settlement/route evidence on the existing row');

  const noble = bills.find(b => b.id === 'noble-garbage');
  ok(noble && noble.amount === 95.85 && noble.frequency === 'quarterly',
    'noble-garbage remains the quarterly $95.85 row');

  ok(!bills.some(b => b.id === 'cmaw' || /cmaw/i.test(b.label)),
    'cancelled CMAW was not re-added');
  ok(!bills.some(b => /telus/i.test(b.id + b.label)),
    'closed Telus was not re-added');
  const affirm = bills.find(b => b.id === 'affirm-final');
  ok(affirm && affirm.amount === 32.53 && affirm.date === '2026-09-21' && affirm.frequency === 'once',
    'Affirm remains the one remaining $32.53 once row');
}

console.log('\n=== register routes the declared CARD ids ===');
{
  const ids = [
    'CARD-001', 'CARD-002', 'CARD-003', 'CARD-004', 'CARD-005',
    'CARD-006', 'CARD-007', 'CARD-008', 'CARD-009', 'CARD-010',
  ];
  ok(ids.every(id => intake.includes(id)),
    'intake evidence-ids fence lists CARD-001 through CARD-010');
  for (const id of ids) {
    const row = registerRow(id);
    ok(!!row, `${id} has a register row`);
  }
  ok(registerRow('CARD-002').disposition === 'EXCLUDED',
    'Phoenix is EXCLUDED from plan.bills');
  ok(registerRow('CARD-004').disposition === 'EXCLUDED',
    'unplanned candidates are EXCLUDED from plan.bills');
  ok(registerRow('CARD-006').disposition === 'CONSUMED'
    && registerRow('CARD-006').routed_to
    && /Bell Mobility/.test(registerRow('CARD-006').routed_to.heading),
    'Bell card hits route to the incumbent Bell heading');
  ok(registerRow('CARD-010').disposition === 'CONSUMED'
    && registerRow('CARD-010').routed_to.json_pointer === '/plan/bills',
    'already-planned roster routes to live plan.bills');
}

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll proofs passed.');
