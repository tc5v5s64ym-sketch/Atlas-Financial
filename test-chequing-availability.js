'use strict';
/* Owner-requested chequing availability headline.
 *
 * Independent identities prove the headline uses only the two chequing
 * balances plus the incumbent Chequing B overdraft facility. Savings never
 * enters the headline, and overdraft never enters Forecast cash allocation.
 */
const fs = require('fs');
const path = require('path');
const data = require('./data.json');
const C = require('./public/forecast-chequing.js');
const H = require('./public/chequing-headline.js');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const close = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

console.log('=== current canonical chequing identity ===');
{
  const summary = C.chequingAvailability(data.plan, data.revolvingExtra);
  ok(summary.status === 'available', 'canonical chequing capacity is available');
  ok(close(summary.chequingBalance, 629.27 + 309.77),
    'actual chequing balance is Chequing A + Chequing B only',
    String(summary.chequingBalance));
  ok(close(summary.overdraftLimit, 600),
    'overdraft limit comes from the incumbent facility', String(summary.overdraftLimit));
  ok(close(summary.available, 629.27 + 309.77 + 600),
    'headline availability is the two chequing balances plus overdraft limit',
    String(summary.available));
  ok(close(summary.overdraftRemaining, 600),
    'positive Chequing B leaves the full overdraft unused');
  ok(summary.accountBalances.length === 2
      && summary.accountBalances.some(row => row.id === 'chequing-a')
      && summary.accountBalances.some(row => row.id === 'chequing-b')
      && !summary.accountBalances.some(row => row.id === 'savings'),
    'savings is excluded from the household chequing headline');
  ok(!close(summary.available, 629.27 + 309.77 + 0.58 + 600),
    'the savings balance cannot leak into available-in-chequing');
}

console.log('\n=== overdraft already used is not double-counted ===');
{
  const plan = {
    opening: { asOf: '2030-01-15' },
    startingCash: { breakdown: [
      { id: 'chequing-a', value: 1000 },
      { id: 'chequing-b', value: -200 },
      { id: 'savings', value: 9999 },
    ] },
  };
  const extra = [{ id: 'overdraft', cash: 'chequing-b', limit: 600, pending: 0 }];
  const summary = C.chequingAvailability(plan, extra);
  ok(close(summary.chequingBalance, 800),
    'negative Chequing B is already reflected in the combined chequing balance');
  ok(close(summary.overdraftUsed, 200) && close(summary.overdraftRemaining, 400),
    'used and remaining overdraft are separated correctly');
  ok(close(summary.available, 1400),
    'capacity adds the facility limit once, leaving only the unused portion in practice');
}

console.log('\n=== missing authority fails closed ===');
{
  const noFacility = C.chequingAvailability(data.plan, []);
  ok(noFacility.status === 'unavailable' && noFacility.available == null,
    'missing overdraft facility does not invent a $600 limit');
  const noChecking = C.chequingAvailability({ startingCash: { breakdown: [] } }, data.revolvingExtra);
  ok(noChecking.status === 'unavailable' && noChecking.available == null,
    'missing chequing opening does not publish a capacity figure');
}

console.log('\n=== household wording preserves cash-versus-borrowing boundary ===');
{
  const model = H.headlineModel({
    status: 'available', available: 1539.04, chequingBalance: 939.04,
    overdraftLimit: 600, overdraftRemaining: 600, includesBorrowing: true,
    asOf: '2026-08-19',
  });
  ok(model.available === '$1,539.04' && model.chequingBalance === '$939.04',
    'presentation formats authority values without recalculating them');
  const ui = read('public/chequing-headline.js');
  ok(/Available in chequing · Calculated/.test(ui),
    'headline explicitly tags the derived household figure as calculated');
  ok(/Calculated from chequing balances/.test(ui),
    'explanatory note repeats the calculated trust status');
  ok(/Using overdraft is borrowing\./.test(ui), 'borrowed capacity is explicit');
  ok(/never includes the overdraft above/.test(ui) && /not cash and is not LEFT OVER/.test(ui),
    'Forecast cash allocation stays visibly separate from overdraft capacity');
  ok(!/startingCash\.breakdown|revolvingExtra\s*\.\s*reduce|\.reduce\s*\(/.test(ui),
    'presentation does not independently calculate the chequing figure');
}

console.log('\n=== Forecast extension and load order ===');
{
  const engine = read('public/forecast-chequing.js');
  ok(/root\.Forecast\.chequingAvailability\s*=\s*api\.chequingAvailability/.test(engine),
    'derived figure is attached to Forecast authority');
  ok(!/\b600\b/.test(engine),
    'Forecast helper reads the overdraft limit from canonical facility data instead of hardcoding it');
  const html = read('public/index.html');
  const forecastAt = html.indexOf('<script src="/forecast.js"></script>');
  const extensionAt = html.indexOf('<script src="/forecast-chequing.js"></script>');
  const planAt = html.indexOf('<script src="/plan.js"></script>');
  const waterfallAt = html.indexOf('<script src="/cash-waterfall.js"></script>');
  const headlineAt = html.indexOf('<script src="/chequing-headline.js"></script>');
  ok(forecastAt >= 0 && extensionAt > forecastAt && planAt > extensionAt,
    'chequing authority loads after Forecast and before Plan');
  ok(waterfallAt >= 0 && headlineAt > waterfallAt,
    'headline adapter runs after the incumbent waterfall renderer');
}

if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
