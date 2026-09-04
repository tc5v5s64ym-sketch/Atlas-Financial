'use strict';
/* 2026-08-18 HELOC Q19 + Bell Q18 evidence closeout.
 * `node test/test-q19-q18-closeout.js`
 *
 * Proves the incumbent cash model is unchanged and the stale August
 * uncertainty is closed. Does not invent a second Forecast or a duplicate
 * HELOC/Bell cash obligation.
 */
const fs = require('fs');
const path = require('path');
const F = require('../public/forecast.js');
const data = require('../data.json');
const { execFileSync } = require('child_process');
const { sourceText } = require('./test-source-text');
const AUG16_REV = '28d08a12a18691f34c32bc839d22cd526fc75111';
const aug16Pinned = JSON.parse(execFileSync('git', ['show', `${AUG16_REV}:data.json`], { encoding: 'utf8' }));

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const money = n => Number(n).toFixed(2);

const questions = sourceText(fs.readFileSync(path.join(__dirname, '..', 'docs/01_OPEN_QUESTIONS.md'), 'utf8'));
const facts = fs.readFileSync(path.join(__dirname, '..', 'docs/ACCOUNT_FACTS.md'), 'utf8');
const aug16 = fs.readFileSync(path.join(__dirname, '..', 'docs/source_intake/HOUSEHOLD_EVIDENCE_2026-08-16.md'), 'utf8');
const aug18 = fs.readFileSync(path.join(__dirname, '..', 'docs/source_intake/HOUSEHOLD_EVIDENCE_2026-08-18.md'), 'utf8');
const plan = data.plan;
const asOf = data.meta.asOf;
const windowEnd = F.addDays(asOf, (plan.windowDays || 91) - 1);

function statusOf(id) {
  const re = new RegExp('### ' + id + '\\.[\\s\\S]*?\\*\\*Status:\\*\\*\\s*([^\\n]+)');
  const m = re.exec(questions);
  return m ? m[1].trim() : null;
}

console.log('=== published opening does not move ===');
{
  ok(aug16Pinned.meta.asOf === '2026-08-16', 'pinned 28d08a12 meta.asOf remains 2026-08-16', aug16Pinned.meta.asOf);
  ok(aug16Pinned.plan.opening && aug16Pinned.plan.opening.asOf === '2026-08-16',
    'pinned plan.opening.asOf remains 2026-08-16', aug16Pinned.plan.opening && aug16Pinned.plan.opening.asOf);
  const heloc = aug16Pinned.debts.find(d => d.id === 'heloc');
  const cash = F.startingCashAmount(aug16Pinned.plan);
  ok(heloc && near(heloc.balance, 200486.16),
    'pinned HELOC balance remains $200,486.16', money(heloc && heloc.balance));
  ok(near(cash, 2252.76),
    'pinned spendable cash remains $2,252.76', money(cash));
  ok(data.meta.asOf === data.plan.opening.asOf,
    'live meta.asOf still agrees with plan.opening.asOf');
}

console.log('\n=== HELOC interest stays nonCash; no duplicate August cash ===');
{
  const heloc = plan.obligations.find(o => o.id === 'heloc');
  const debt = data.debts.find(d => d.id === 'heloc');
  ok(heloc && heloc.nonCash === true && heloc.effect === 'capitalise'
    && near(heloc.amount, 814.18),
    'HELOC obligation remains non-cash $814.18 capitalisation');
  ok(debt && near(debt.cashPayment, 0) && debt.interestTreatment === 'capitalised',
    'cashPayment stays $0; interest is capitalised');
  const events = F.expandEvents(plan, asOf, windowEnd, {});
  const helocEvents = events.filter(e => e.id === 'heloc');
  ok(helocEvents.length > 0 && helocEvents.every(e => e.kind === 'noncash'),
    'Forecast emits HELOC as noncash only');
  ok(!events.some(e => near(Math.abs(e.amount), 814.18) && e.kind !== 'noncash'),
    'no $814.18 August (or later) cash event exists');
  ok(!events.some(e => e.id === 'heloc' && e.date === '2026-08-01'),
    'Aug. 1 PAD is not fabricated as a cash event');
  ok(!events.some(e => e.id === 'heloc' && e.date === '2026-08-21' && e.kind !== 'noncash'),
    'Aug. 21 is not a HELOC chequing outflow');
}

console.log('\n=== Aug. 14 $1,100 is inside the opening and is not replayed ===');
{
  const events = F.expandEvents(plan, asOf, windowEnd, {});
  ok(!events.some(e => near(Math.abs(e.amount), 1100)),
    'Forecast does not replay a $1,100 HELOC payment after 2026-08-16');
  const independent = Math.round((201586.16 - 200486.16) * 100) / 100;
  ok(near(independent, 1100),
    'independent 9 Aug − 16 Aug HELOC identity is still $1,100.00',
    money(independent));
}

console.log('\n=== Q19 recorded ANSWERED with the four-part closeout ===');
{
  ok(/^ANSWERED\b/.test(statusOf('Q19')), 'Q19 status is ANSWERED', statusOf('Q19'));
  const q19 = questions.slice(questions.indexOf('### Q19.'));
  const q19body = q19.slice(0, q19.search(/\n### Q(?!19\.)/));
  ok(/Interest posting/i.test(q19body) && /\$814\.18 posted/i.test(q19body),
    'Q19 distinguishes the July 31 interest posting');
  ok(/non-cash capitalisation/i.test(q19body),
    'Q19 records the posting as non-cash capitalisation');
  ok(/Minimum-payment obligation/i.test(q19body) && /21 August/i.test(q19body),
    'Q19 distinguishes the Aug. 21 statement minimum');
  ok(/Payment satisfaction/i.test(q19body) && /\$1,100/i.test(q19body),
    'Q19 records the Aug. 14 $1,100 as satisfying the minimum');
  ok(/Remaining August cash requirement/i.test(q19body)
    && /\$0 additional/i.test(q19body),
    'Q19 remaining August cash requirement is $0 additional');
  ok(/does \*\*not\*\* state that the Aug\. 1 PAD/i.test(q19body),
    'Q19 does not claim the Aug. 1 PAD occurred');
  ok(/not free/i.test(q19body),
    'Q19 does not treat HELOC interest as free');
}

console.log('\n=== Bell $15 watch line is not a second invented bill ===');
{
  ok((plan.bills || []).some(b => b.id === 'bell' && b.day === 15
        && b.needsDate !== true && near(b.amount, 121)
        && b.payingAccount === 'travelvisa' && b.jointCash === false)
      && !(plan.bills || []).some(b => /watch/i.test(b.id + b.label)),
    'Bell is dated $121 card-paid on the 15th; no invented watch cash bill');
  ok(/^OPEN\b/.test(statusOf('Q18')),
    'Q18 stays OPEN for pending Bell posting residual',
    statusOf('Q18'));
  ok(/\$16\.80/.test(questions) && /no longer UNKNOWN/i.test(aug18),
    'second-account recurring $16.80 is recorded and is no longer UNKNOWN');
  ok(/settlement state/i.test(questions) && /not a telecom-cost question/i.test(questions),
    'Q18 separates Bell settlement-state from telecom-cost');
  ok(/second Bell\/watch account is still\s+active/i.test(questions)
    && /second Bell\/watch account is still\s+active/i.test(facts),
    'Q18 / ACCOUNT_FACTS keep the owner-stated separate Bell/watch account');
  ok(/Do not merge it with the \$15 watch line/i.test(questions + facts),
    'owner confirmation still forbids merging the second account with the $15 line');
  ok(/same Bell account/i.test(questions) && /same Bell account/i.test(facts),
    'watch line is recorded on the same Bell account as the phone service');
  ok(/inferred residual/i.test(facts) && /\$250/.test(facts),
    'the pending $250 / inferred residual remains an open Bell uncertainty');
  ok(/A second Bell\/watch account exists and is still active/i.test(aug16),
    '2026-08-16 owner confirmation of the second Bell/watch account is preserved');
  ok(/does not retract the 2026-08-16 owner confirmation/i.test(aug18),
    '2026-08-18 closeout does not retract the owner-stated second account');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
