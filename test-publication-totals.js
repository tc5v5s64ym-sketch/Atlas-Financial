'use strict';
/* Focused proof for Forecast.publicationTotals(). The correctness cases are
 * hand-computed from literal balances, annual-interest figures, asset values,
 * income line totals, commitment items and lacrosse sources — not the
 * function that now produces the answer.
 *
 * Until this move data.json independently stored Deep Dive headline totals,
 * Records net-worth totals, the income footer, the commitments total, the
 * lacrosse verified total, and a second HELOC limit. Those copies had
 * already drifted: the stored "Credit left, everywhere" tile was $1,415.95
 * against Forecast.utilisation's $1,415.98. Adding a balance and forgetting
 * the stored total left npm test green, because the suite reconciled the
 * stored copy against itself.
 */
const fs = require('fs');
const vm = require('vm');
const { sourceText } = require('./test-source-text');
const F = require('./public/forecast.js');
const data = require('./data.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const same = (a, b) => a === b;
const cents = n => Math.round(Number(n) * 100);
const sameCents = (a, b) => cents(a) === cents(b);
const read = p => sourceText(fs.readFileSync(p, 'utf8'));
const money2 = n => (n < 0 ? '−$' : '$') + Math.abs(Number(n)).toLocaleString('en-CA', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

/* Independent fixture. The card is unsecured, so it is in total debt and
 * annual interest, and out of the mortgage-excluded interest only if it is
 * not the mortgage — which it is not. The overdraft is not a debt record;
 * credit-left follows utilisation, which is the incumbent headroom rule.
 *
 *   Mortgage  $100,000   annual $3,600   limit none
 *   HELOC      $50,000   annual $2,400   limit $55,000
 *   Card        $8,000   annual $1,200   limit $10,000, pending $500
 *   Overdraft   used $400 of $600
 *
 *   total debt     = 100,000 + 50,000 + 8,000 = 158,000
 *   annual         = 3,600 + 2,400 + 1,200 = 7,200
 *   annual ex-mtg  = 2,400 + 1,200 = 3,600
 *   assets         = 1,000 + 250 = 1,250
 *   financial      = 1,250 − 158,000 = −156,750
 *   credit left    = HELOC 5,000 + Card 1,500 + overdraft 200 = 6,700
 *   income         = 1,800 + 600 = 2,400 over 18 months → $133/month
 *   commitments    = 800 + 200 = 1,000
 *   lacrosse       = 300 + 50 = 350
 */
const FIX = {
  debts: [
    { id: 'mortgage', balance: 100000, annualInterest: 3600 },
    { id: 'heloc',    balance:  50000, annualInterest: 2400, limit: 55000 },
    { id: 'card',     balance:   8000, annualInterest: 1200, limit: 10000, pending: 500 },
  ],
  revolvingExtra: [{ id: 'overdraft', used: 400, limit: 600, pending: 0 }],
  assets: [
    { label: 'Chequing', value: 1000 },
    { label: 'Savings',  value:  250 },
  ],
  income: [
    { label: 'Pay',     total: 1800 },
    { label: 'Benefit', total:  600 },
  ],
  commitments: { items: [{ amount: 800 }, { amount: 200 }] },
  lacrosse: { sources: [{ amount: 300, n: 2 }, { amount: 50, n: 1 }] },
};
const HAND_DEBT = 100000 + 50000 + 8000;
const HAND_ANNUAL = 3600 + 2400 + 1200;
const HAND_ANNUAL_EX = 2400 + 1200;
const HAND_ASSETS = 1000 + 250;
const HAND_FIN = HAND_ASSETS - HAND_DEBT;
const HAND_CREDIT = (55000 - 50000) + (10000 - (8000 + 500)) + (600 - 400);
const HAND_INCOME = 1800 + 600;
const HAND_INCOME_MONTHS = 18;
const HAND_INCOME_MONTHLY = Math.round(HAND_INCOME / HAND_INCOME_MONTHS);
const HAND_COMMIT = 800 + 200;
const HAND_LAX = 300 + 50;

console.log('=== hand-computed publication totals ===');
ok(HAND_DEBT === 158000, 'total debt is $100,000 + $50,000 + $8,000');
ok(HAND_ANNUAL === 7200 && HAND_ANNUAL_EX === 3600,
  'annual interest is $7,200, of which $3,600 is not the mortgage');
ok(HAND_ASSETS === 1250 && HAND_FIN === -156750,
  'assets $1,250 less total debt is −$156,750');
ok(HAND_CREDIT === 6700,
  'credit left is HELOC $5,000 + card $1,500 + overdraft $200');
ok(HAND_INCOME === 2400 && HAND_INCOME_MONTHLY === 133,
  'income $2,400 over 18 months rounds to $133/month');
ok(HAND_COMMIT === 1000 && HAND_LAX === 350,
  'commitments $800 + $200; lacrosse $300 + $50');

const fixture = F.publicationTotals(FIX);
ok(!!fixture, 'a result is returned');
ok(fixture && same(fixture.totalDebt, HAND_DEBT),
  'fixture total debt is the three posted balances',
  fixture ? String(fixture.totalDebt) : 'none');
ok(fixture && same(fixture.annualInterest, HAND_ANNUAL)
  && same(fixture.annualInterestExMortgage, HAND_ANNUAL_EX),
  'fixture annual interest includes the card and excludes the mortgage from the subtotal');
ok(fixture && same(fixture.monthlyInterest, HAND_ANNUAL / 12)
  && same(fixture.monthlyInterestExMortgage, HAND_ANNUAL_EX / 12),
  'fixture monthly interest is those annuals divided by twelve');
ok(fixture && same(fixture.assets, HAND_ASSETS)
  && same(fixture.financialAccountsOnly, HAND_FIN),
  'fixture net-worth lines are assets and assets minus debts');
ok(fixture && same(fixture.creditLeft, HAND_CREDIT)
  && same(fixture.revolvingFacilityCount, 3),
  'fixture credit left matches utilisation on the same rows',
  fixture ? String(fixture.creditLeft) : 'none');
ok(fixture && same(fixture.incomeTotal, HAND_INCOME)
  && same(fixture.incomePerMonth, HAND_INCOME_MONTHLY)
  && same(fixture.incomeMonths, HAND_INCOME_MONTHS),
  'fixture income total and rounded monthly figure');
ok(fixture && same(fixture.commitmentsTotal, HAND_COMMIT)
  && same(fixture.lacrosseVerified, HAND_LAX)
  && same(fixture.helocLimit, 55000),
  'fixture commitments, lacrosse verified total, and HELOC limit from the debt record');

console.log('\n=== credit-left is utilisation, not a second headroom rule ===');
const utilFix = F.utilisation(FIX.debts, FIX.revolvingExtra);
ok(same(fixture.creditLeft, utilFix.totalAvailable),
  'publication credit-left is Forecast.utilisation.totalAvailable on the same inputs');
ok(same(fixture.revolvingFacilityCount, utilFix.rows.length),
  'and the facility count is utilisation.rows.length');

console.log('\n=== live plan: identity independent of the engine function ===');
/* Posted balances, annual-interest literals and asset values from data.json,
 * added on paper. Not a reduce of the same array the function walks. */
const LIVE_DEBT = 546026.58 + 201586.16 + 13497 + 5612.43 + 7855.12 + 1799.97 + 1078.31;
const LIVE_ANNUAL = 19441 + 9877.72 + 2880 + 1902.6 + 1779.24 + 450 + 215.55;
const LIVE_ANNUAL_EX = LIVE_ANNUAL - 19441;
const LIVE_ASSETS = 2691.85 + 506.98 + (-517.72) + 90.58 + 74.2 + 205.92 + 8847 + 31555.85 + 0;
const LIVE_FIN = LIVE_ASSETS - LIVE_DEBT;
const LIVE_INCOME = 186152.89 + 63129.47 + 54213 + 2764.63 + 500.04;
const LIVE_COMMIT = 800 + 2000;
const LIVE_LAX = 2767.14 + 2822.3 + 140.03;
ok(sameCents(LIVE_DEBT, 777455.57), 'seven posted balances sum to $777,455.57');
ok(LIVE_ANNUAL === 36546.11, 'seven annual-interest literals sum to $36,546.11');
ok(LIVE_ANNUAL_EX === 17105.11, 'excluding the mortgage leaves $17,105.11');
ok(sameCents(LIVE_ASSETS, 43454.66), 'nine asset literals sum to $43,454.66');
ok(sameCents(LIVE_FIN, -734000.91), 'financial-accounts-only is −$734,000.91');
ok(sameCents(LIVE_INCOME, 306760.03), 'five income-line totals sum to $306,760.03');
ok(LIVE_COMMIT === 2800, 'Warriors $800 + Fusion $2,000 = $2,800');
ok(sameCents(LIVE_LAX, 5729.47), 'three lacrosse sources sum to $5,729.47');

const live = F.publicationTotals(data);
ok(live && sameCents(live.totalDebt, LIVE_DEBT),
  'live total debt matches the seven posted balances',
  live ? money2(live.totalDebt) : 'none');
ok(live && same(live.annualInterest, LIVE_ANNUAL)
  && same(live.annualInterestExMortgage, LIVE_ANNUAL_EX),
  'live annual interest matches the seven literals');
ok(live && sameCents(live.assets, LIVE_ASSETS)
  && sameCents(live.financialAccountsOnly, LIVE_FIN),
  'live net-worth lines match the asset and debt literals');
ok(live && sameCents(live.incomeTotal, LIVE_INCOME)
  && same(live.incomePerMonth, 17042)
  && same(live.incomeMonths, 18),
  'live income total is $306,760.03 over 18 months, $17,042/month');
ok(live && same(live.commitmentsTotal, LIVE_COMMIT)
  && sameCents(live.lacrosseVerified, LIVE_LAX),
  'live commitments and lacrosse verified totals match the item literals');

const liveUtil = F.utilisation(data.debts, data.revolvingExtra);
ok(live && same(live.creditLeft, liveUtil.totalAvailable)
  && sameCents(live.creditLeft, 1415.98),
  'live credit left is utilisation $1,415.98, not the retired $1,415.95 store',
  live ? money2(live.creditLeft) : 'none');
ok(live && same(live.helocLimit, 202654),
  'live HELOC limit is the debt record\'s $202,654');
ok(live && same(live.revolvingFacilityCount, 7),
  'seven revolving facilities: six debts with limits plus the overdraft');

const snap = F.compactSnapshot(data.debts, data.helocHistory);
ok(live && snap && same(live.monthlyInterest, snap.monthlyInterest),
  'Deep Dive annual/12 and the Plan compact snapshot are one twelfth');
ok(live && sameCents(live.creditLeft, F.utilisation(data.debts, data.revolvingExtra).totalAvailable),
  'Deep Dive credit-left and the Plan revolving tile are one utilisation figure');

console.log('\n=== stored duplicate authorities are gone ===');
ok(!Object.prototype.hasOwnProperty.call(data, 'headline'),
  'data.json no longer stores a headline totals array');
ok(!Object.prototype.hasOwnProperty.call(data, 'incomeTotal'),
  'data.json no longer stores incomeTotal');
ok(!Object.prototype.hasOwnProperty.call(data, 'helocLimit'),
  'data.json no longer stores a second HELOC limit');
ok(!Object.prototype.hasOwnProperty.call(data.netWorth || {}, 'assets')
  && !Object.prototype.hasOwnProperty.call(data.netWorth || {}, 'debts')
  && !Object.prototype.hasOwnProperty.call(data.netWorth || {}, 'financialAccountsOnly'),
  'netWorth no longer stores assets / debts / financialAccountsOnly');
ok(!!(data.netWorth && data.netWorth.caveat),
  'the net-worth estimate caveat remains stored prose');
ok(data.mortgage.balance == null && data.mortgage.rate == null
  && data.mortgage.paymentBiweekly == null,
  'the mortgage block no longer stores balance, rate, or bi-weekly payment');
ok(data.mortgage.remainingYears != null && data.mortgage.maturity
  && data.mortgage.prepaymentRoom != null,
  'and still holds the renewal standing facts');
ok(data.commitments.total == null,
  'commitments no longer store a separate total');
ok(data.lacrosse.verified == null,
  'lacrosse no longer stores a separate verified total');

console.log('\n=== pages are renderers ===');
const dive = read('public/deepdive.js');
const diveCode = dive.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const records = read('public/records.js');
const recordsCode = records.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const modellers = read('public/modellers.js');
const modellersCode = modellers.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
ok(/Forecast\.publicationTotals\(d\)/.test(dive),
  'Deep Dive reads publication totals from Forecast.publicationTotals');
ok(/Forecast\.publicationTotals\(d\)/.test(records),
  'Records reads net-worth totals from Forecast.publicationTotals');
ok(/forecast\.js/.test(read('public/records.html')),
  'Records loads the engine so those totals are not page arithmetic');
ok(!/d\.headline/.test(diveCode),
  'Deep Dive no longer reads a stored headline array');
ok(!/d\.incomeTotal/.test(diveCode) && !/incomeTotal\.total/.test(diveCode),
  'Deep Dive no longer reads a stored incomeTotal');
ok(!/d\.helocLimit/.test(diveCode),
  'Deep Dive no longer reads a stored helocLimit');
ok(!/c\.total\b/.test(diveCode) || /pub\.commitmentsTotal/.test(diveCode),
  'Deep Dive prints the returned commitments total');
ok(/pub\.lacrosseVerified/.test(diveCode) && !/L\.verified/.test(diveCode),
  'Deep Dive prints the returned lacrosse verified total');
ok(!/netWorth\.assets/.test(recordsCode) && !/netWorth\.debts/.test(recordsCode)
  && !/financialAccountsOnly/.test(recordsCode) || /pub\.financialAccountsOnly/.test(recordsCode),
  'Records no longer reads stored net-worth scalars');
ok(/pub\.assets/.test(recordsCode) && /pub\.totalDebt/.test(recordsCode),
  'Records prints the returned asset and debt totals');
ok(!/\.reduce\(\(s, x\) => s \+ \(x\.balance/.test(diveCode)
  && !/\.reduce\(\(s, a\) => s \+ a\.value/.test(recordsCode),
  'neither page re-sums debt balances or asset values');
ok(/mortgageDebt\.rate/.test(modellersCode) && !/\bm\.rate\b/.test(modellersCode),
  'the renewal slider opens on the debt record\'s rate, not a stored mortgage.rate');

console.log('\n=== mutation: a canonical input moves every consumer ===');
const mutatedDebts = data.debts.map(x =>
  x.id === 'triangle' ? Object.assign({}, x, { balance: x.balance + 100 }) : x);
const afterBalance = F.publicationTotals(Object.assign({}, data, { debts: mutatedDebts }));
ok(sameCents(afterBalance.totalDebt, LIVE_DEBT + 100),
  'raising Triangle\'s posted balance by $100 raises total debt by $100',
  money2(afterBalance.totalDebt));
ok(sameCents(afterBalance.financialAccountsOnly, LIVE_FIN - 100),
  'and financial-accounts-only falls by the same $100');
ok(sameCents(live.totalDebt, LIVE_DEBT),
  'the live engine is unmoved by that fixture');

const withoutCard = F.publicationTotals(Object.assign({}, data, {
  debts: data.debts.filter(x => x.id !== 'tdcc'),
}));
ok(sameCents(withoutCard.totalDebt, LIVE_DEBT - 1799.97)
  && sameCents(withoutCard.annualInterest, LIVE_ANNUAL - 450),
  'removing the TD credit card drops total debt $1,799.97 and annual interest $450');

const extraIncome = (data.income || []).concat([{ label: 'Bonus', total: 1800 }]);
const afterIncome = F.publicationTotals(Object.assign({}, data, { income: extraIncome }));
ok(sameCents(afterIncome.incomeTotal, LIVE_INCOME + 1800)
  && afterIncome.incomePerMonth === Math.round((LIVE_INCOME + 1800) / 18),
  'an extra $1,800 income line moves the footer total and its monthly round');

const extraCommit = {
  commitments: Object.assign({}, data.commitments, {
    items: (data.commitments.items || []).concat([{ amount: 150 }]),
  }),
};
const afterCommit = F.publicationTotals(Object.assign({}, data, extraCommit));
ok(afterCommit.commitmentsTotal === LIVE_COMMIT + 150,
  'an extra $150 commitment item moves the published total');

console.log('\n=== mutation: breaking the engine formula fails ===');
const FORECAST_SRC = read('public/forecast.js');
const FROM = '      totalDebt += debt.balance || 0;';
const TO = '      if (debt.id !== \'mortgage\') totalDebt += debt.balance || 0;';
ok(FORECAST_SRC.split(FROM).length - 1 === 1,
  'the total-debt accumulation appears once, so the mutation is aimed');
const sandbox = { module: { exports: {} } };
try {
  vm.runInNewContext(FORECAST_SRC.replace(FROM, TO), sandbox, { filename: 'forecast-mutant.js' });
} catch (e) {
  ok(false, 'mutant engine loads', e.message);
}
const mutant = sandbox.module.exports;
const broken = mutant && mutant.publicationTotals(data);
ok(mutant && broken && sameCents(broken.totalDebt, LIVE_DEBT - 546026.58)
  && !sameCents(broken.totalDebt, LIVE_DEBT),
  'omitting the mortgage from the sum understates live total debt by $546,026.58',
  broken ? money2(broken.totalDebt) : 'mutant missing');
ok(live && sameCents(live.totalDebt, LIVE_DEBT),
  'the real engine still answers the independent seven-balance total');

console.log('\n=== mutation: reintroducing a stored scalar is detected ===');
ok(!data.headline && !data.incomeTotal && data.helocLimit == null,
  'reintroducing headline, incomeTotal, or helocLimit fails the deletion checks above');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
