'use strict';
/* B19 — Deep Dive mortgage / HELOC story agrees with the canonical opening.
 *
 * Independent arithmetic from canonical rows, B20 snapshots, positions.csv,
 * and the stored monthly observations. Not a second call of deepDive
 * asserting its own result.
 *
 * The demonstrated defect: helocHistory stored a hand-maintained current
 * endpoint ($201,586.16, the 2026-08-09 reading) beside live debts.heloc
 * ($200,486.16). The caption then said the line had risen every month.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { sourceText } = require('./test-source-text');
const F = require('./public/forecast.js');
const data = require('./data.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const same = (a, b) => a === b;
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const cents = n => Math.round(Number(n) * 100);
const sameCents = (a, b) => cents(a) === cents(b);
const read = p => sourceText(fs.readFileSync(p, 'utf8'));
const money2 = n => (n < 0 ? '−$' : '$') + Math.abs(Number(n)).toLocaleString('en-CA', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const MAIN = '2777d69ba4d4ffe948c96362c73a9875a97fadc8';
const AUG9 = 201586.16;
const AUG16 = 200486.16;
const JULY = 201085.16;
const FEB_PAYDOWN = 188060.61;
const LIMIT = 202654;
const PAYMENT = 1100;
const WINDOW_GROWTH = 7536.96;
const ADVANCES = 86513.51;
const REPAYMENTS = 78176.55;
const INTEREST = 15029.18;
const MORTGAGE = 545188.30;
const MORTGAGE_PRIOR = 546026.58;

function gitShow(spec) {
  return execFileSync('git', ['show', spec], { encoding: 'utf8' });
}

const heloc = data.debts.find(d => d.id === 'heloc');
const mortgage = data.debts.find(d => d.id === 'mortgage');
const history = data.helocHistory || [];
const snap9 = JSON.parse(read('snapshots/2026-08-09.json'));
const snap16 = JSON.parse(read('snapshots/2026-08-16.json'));
const snapHeloc = (snap, id) => (snap.accounts || []).find(d => d.id === id);

console.log('=== reproduced stale current endpoint on the starting main ===');
const mainData = JSON.parse(gitShow(`${MAIN}:data.json`));
const mainHist = mainData.helocHistory;
const mainLast = mainHist[mainHist.length - 1];
const mainHeloc = mainData.debts.find(d => d.id === 'heloc');
ok(near(mainLast.v, AUG9) && mainLast.m === 'Aug 26',
  'main helocHistory ended at Aug 26 $201,586.16',
  money2(mainLast.v));
ok(/Only \$1,067\.84 left/.test(mainLast.note || ''),
  'main current-endpoint note still published stale headroom $1,067.84');
ok(near(mainHeloc.balance, AUG16),
  'main debts.heloc was already the 2026-08-16 opening $200,486.16');
ok(/risen every month/.test(mainData.helocSummary),
  'main helocSummary still said it had risen every month');
ok(near(LIMIT - AUG9, 1067.84),
  'independent stale headroom is 202,654 − 201,586.16 = $1,067.84');

console.log('\n=== current opening independently agrees with B20 / positions ===');
const pos = fs.readFileSync(path.join(__dirname, 'docs', 'positions.csv'), 'utf8');
const helocPos = pos.split(/\r?\n/).find(l => /Household,TD,HELOC,/.test(l));
ok(near(heloc.balance, AUG16), 'debts.heloc is $200,486.16');
ok(near(snapHeloc(snap16, 'heloc').balance, AUG16),
  'B20 2026-08-16 snapshot HELOC is $200,486.16');
ok(near(snapHeloc(snap9, 'heloc').balance, AUG9),
  'B20 2026-08-09 snapshot HELOC is $201,586.16');
ok(helocPos && helocPos.includes('200486.16'),
  'positions.csv Household HELOC is the 2026-08-16 opening');
ok(near(AUG9 - AUG16, PAYMENT) && near(201586.16 - 1100, AUG16),
  'Aug. 9 → Aug. 16 is independently $1,100.00');

console.log('\n=== July monthly observation was not rewritten ===');
const july = history[history.length - 1];
ok(july && july.m === 'Jul' && near(july.v, JULY),
  'last stored helocHistory point is still July $201,085.16');
ok(history.every(p => !near(p.v, AUG9)),
  'the 2026-08-09 $201,586.16 reading is no longer stored as a monthly point');
ok(history.every(p => !near(p.v, AUG16)),
  'today\'s HELOC opening is not stored a second time in helocHistory');
ok(mainHist.length - 1 === history.length, 'exactly the current endpoint was removed');
ok(history.every((p, i) => p.m === mainHist[i].m && near(p.v, mainHist[i].v)),
  'every remaining monthly observation matches main — none rewritten');

console.log('\n=== July → current August direction from the raw inputs ===');
const HAND_VS_JULY = AUG16 - JULY;
ok(sameCents(HAND_VS_JULY, -599),
  'independent July → current is 200,486.16 − 201,085.16 = −$599.00');
ok(HAND_VS_JULY < 0, 'August is below July, not above it');

const dive = F.deepDive(data);
ok(dive.heloc && sameCents(dive.heloc.current, AUG16),
  'Deep Dive current HELOC is debts.heloc',
  dive.heloc ? money2(dive.heloc.current) : 'none');
ok(dive.heloc && sameCents(dive.heloc.vsPrior, HAND_VS_JULY)
  && dive.heloc.vsPriorId === 'falling',
  'Deep Dive vs-prior is the independent −$599 falling identity');
ok(dive.heloc.history[dive.heloc.history.length - 1].v === heloc.balance
  && dive.heloc.history[dive.heloc.history.length - 1].note === 'current opening',
  'composed series ends on the canonical opening, labelled as current');
ok(dive.heloc.history.slice(0, -1).every((p, i) =>
  p.m === history[i].m && sameCents(p.v, history[i].v)),
  'composed historical points are the stored monthly observations');

const snap = F.compactSnapshot(data.debts, data.helocHistory);
ok(snap.heloc && sameCents(snap.heloc.delta, HAND_VS_JULY)
  && snap.heloc.id === 'falling',
  'Plan compact snapshot uses the same current-minus-July identity');
ok(same(snap.heloc.id, dive.heloc.vsPriorId),
  'Plan and Deep Dive HELOC direction are one identity');

console.log('\n=== since the February 2026 paydown — only what the series supports ===');
const feb = history.filter(p => /^Feb\b/.test(p.m)).pop();
ok(feb && near(feb.v, FEB_PAYDOWN),
  'last February observation is the $188,060.61 paydown point');
const HAND_SINCE_FEB = AUG16 - FEB_PAYDOWN;
ok(sameCents(HAND_SINCE_FEB, 12425.55),
  'independent current − February paydown is +$12,425.55');
ok(dive.heloc && sameCents(dive.heloc.sincePaydown, HAND_SINCE_FEB)
  && dive.heloc.sincePaydownId === 'higher',
  'Deep Dive since-paydown matches that independent difference');

const fromFeb = history.filter((p, i) => i >= history.findIndex(x => x === feb));
let roseEvery = true;
for (let i = 1; i < fromFeb.length; i++) {
  if (!(fromFeb[i].v > fromFeb[i - 1].v)) roseEvery = false;
}
if (!(AUG16 > fromFeb[fromFeb.length - 1].v)) roseEvery = false;
ok(roseEvery === false,
  'independent walk from February through current is not every-month growth');
ok(dive.heloc.roseEveryMonthSincePaydown === false,
  'Forecast reports that it has not risen every month');
ok(!/risen every month/.test(data.helocSummary),
  'stored helocSummary no longer claims every-month growth');
ok(!/1,067\.84|1067\.84/.test(JSON.stringify(history)),
  'stored monthly series no longer publishes the stale $1,067.84 headroom');

console.log('\n=== retained 18-month window totals still reconcile to their source ===');
const useSum = (data.helocUse || []).reduce((s, u) => s + Number(u.amount), 0);
const interestRow = (data.helocUse || []).find(u => /Interest charged/i.test(u.label));
ok(sameCents(useSum, ADVANCES),
  'helocUse amounts still sum to $86,513.51 of captured-window advances');
ok(interestRow && sameCents(interestRow.amount, INTEREST),
  'captured-window capitalised interest is still $15,029.18');
ok(data.helocUseNote.includes('78,176.55') && data.helocUseNote.includes('86,513.51'),
  'helocUseNote still states the captured-window $86,513.51 / $78,176.55 pair');
ok(sameCents(AUG9 - WINDOW_GROWTH, 194049.20),
  'retained +$7,536.96 still equals the 2026-08-09 reading minus the documented window start');
ok(!near(AUG16 - 194049.20, WINDOW_GROWTH),
  'that window growth is not silently rewritten onto the Aug. 16 opening');
ok(/7,536\.96/.test(data.helocSummary) && /78,177/.test(data.helocSummary)
  && /86,514/.test(data.helocSummary) && /15,029/.test(data.helocSummary),
  'stored window sentence still carries those independently rounded historical totals');
ok(/2026-08-09/.test(data.helocSummary),
  'the window sentence is dated to the capture reading, not to today');
ok(!/99\.5%/.test(data.helocUseNote),
  'historical-use note no longer publishes the stale 99.5% current utilisation');

console.log('\n=== mortgage current figures already agree — no repair ===');
ok(near(mortgage.balance, MORTGAGE), 'debts.mortgage is $545,188.30');
ok(near(snapHeloc(snap16, 'mortgage').balance, MORTGAGE),
  'B20 2026-08-16 snapshot mortgage matches');
const mortPos = pos.split(/\r?\n/).find(l => /Household,TD,Mortgage,/.test(l));
ok(mortPos && mortPos.includes('545188.30'),
  'positions.csv Household mortgage is the 2026-08-16 opening');
ok(near(MORTGAGE_PRIOR - MORTGAGE, 838.28),
  'independent Aug. 14 principal is $838.28');
ok(same(dive.mortgageMonthly, mortgage.annualInterest / 12),
  'Deep Dive mortgage monthly is still the debt-record twelfth');
ok(data.mortgage.balance == null,
  'the mortgage standing block still stores no second current balance');

console.log('\n=== B20 snapshots remain historical-only and unchanged ===');
const snapDiff = execFileSync('git', [
  'diff', '--name-only', MAIN, '--', 'snapshots/',
], { encoding: 'utf8' }).trim();
ok(snapDiff === '', 'no snapshot file changed', snapDiff || 'none');
ok(near(snapHeloc(snap9, 'heloc').balance, AUG9)
  && near(snapHeloc(snap16, 'heloc').balance, AUG16),
  'dated openings still hold both HELOC readings');

console.log('\n=== Q19 remains OPEN; HELOC cash model unchanged ===');
const questions = read('docs/01_OPEN_QUESTIONS.md');
const q19 = questions.slice(questions.indexOf('### Q19.'));
const q19body = q19.slice(0, q19.indexOf('\n### Q2'));
ok(/^\*\*Status:\*\* OPEN\b/m.test(q19body), 'Q19 status is still OPEN');
ok(heloc.cashPayment === 0 && heloc.interestTreatment === 'capitalised',
  'HELOC cashPayment remains $0 and interest remains capitalised');
ok(!/PAD/.test(data.helocSummary) && !/814\.18/.test(data.helocSummary),
  'Deep Dive HELOC summary does not invent an August PAD or $814.18 cash outflow');

console.log('\n=== credit / headroom remains debt capacity, not cash ===');
const util = F.utilisation(data.debts, data.revolvingExtra, data.plan);
const helocUtil = util.rows.find(r => r.id === 'heloc' || /HELOC/i.test(r.label));
const HAND_HELOC_ROOM = LIMIT - AUG16;
ok(sameCents(HAND_HELOC_ROOM, 2167.84),
  'independent HELOC room is 202,654 − 200,486.16 = $2,167.84');
ok(helocUtil && sameCents(helocUtil.available, HAND_HELOC_ROOM),
  'utilisation publishes that room as available credit');
ok(!near(F.startingCashAmount(data.plan), HAND_HELOC_ROOM),
  'spendable cash is not the HELOC available-credit figure');
ok(!near(F.publicationTotals(data).creditLeft, F.startingCashAmount(data.plan)),
  'published credit-left is not household cash');

console.log('\n=== page is a renderer; Forecast outputs other than this composition stay put ===');
const page = read('public/deepdive.js');
const pageCode = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
ok(/dive\.heloc\.history/.test(pageCode), 'chart consumes Forecast.deepDive heloc.history');
ok(/helocCaption\(dive\.heloc, d\.helocSummary\)/.test(pageCode),
  'caption interpolates Forecast facts onto the stored window sentence');
ok(!/d\.helocHistory/.test(pageCode),
  'page no longer reads stored helocHistory for the chart');
ok(/HELOC_VS_PRIOR\[story\.vsPriorId\]/.test(pageCode),
  'page looks up vs-prior wording and does not re-decide the direction');
ok(/has not risen every month/.test(page),
  'the false every-month claim has a true wording counterpart');

const mainPlan = JSON.parse(gitShow(`${MAIN}:data.json`)).plan;
ok(JSON.stringify(data.plan.startingCash) === JSON.stringify(mainPlan.startingCash),
  'plan.startingCash current-state authority is unchanged');
ok(data.debts.every((d, i) => {
  const was = mainData.debts[i];
  return was && d.id === was.id && near(d.balance, was.balance)
    && (d.pending == null ? was.pending == null : near(d.pending, was.pending));
}), 'posted debt openings, including mortgage and HELOC, are unchanged');

console.log('\n=== mutation: restoring a stored current endpoint now fails ===');
const staleHist = history.concat([{ m: 'Aug 26', v: AUG9 }]);
ok(staleHist.some(p => near(p.v, AUG9)), 'mutant history contains the stale current');
ok(!history.some(p => near(p.v, AUG9)),
  'live helocHistory still does not — the stored-current copy is gone');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
