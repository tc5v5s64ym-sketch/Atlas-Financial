'use strict';
/* Current-balance conclusions are Forecast views, not stored plan data.
 *
 * Proves: changing posted/pending on debts or cash updates funding-option
 * available and debtId action status without editing plan.funding.options
 * or plan.actions status. Synthetic fixtures only (L-006).
 */
const F = require('./public/forecast.js');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const clone = x => JSON.parse(JSON.stringify(x));

function fixture() {
  return {
    plan: {
      windowDays: 14,
      defaults: { targetBuffer: 0 },
      startingCash: {
        breakdown: [
          { id: 'chequing-a', value: 400 },
          { id: 'chequing-b', value: 100 },
          { id: 'savings', value: 0 },
        ],
        heldElsewhere: [{ id: 'amanda-debt-payments', value: 800 }],
      },
      opening: { asOf: '2026-08-19', representedEvents: [] },
      funding: {
        options: [
          { id: 'amanda', cash: 'amanda-debt-payments', rank: 1, unusable: false },
          { id: 'heloc', debtId: 'heloc', rank: 2, unusable: false },
          { id: 'overdraft', cash: 'chequing-b', rank: 3, unusable: true },
          { id: 'cards', rank: 4, unusable: true },
        ],
      },
      actions: [
        { what: 'Owner policy transfer', status: 'open', amount: 100, due: '2026-09-01' },
        { what: 'Get the card under its limit', debtId: 'cashback', status: 'open' },
      ],
      income: [], obligations: [], bills: [], commitments: [],
    },
    debts: [
      { id: 'heloc', balance: 900, pending: 0, limit: 1000, secured: true },
      { id: 'cashback', balance: 400, pending: 50, pendingUnknown: false, secured: false, limit: 500 },
      { id: 'triangle', balance: 200, pending: 0, pendingUnknown: false, secured: false, limit: 300 },
    ],
    revolvingExtra: [
      { id: 'overdraft', cash: 'chequing-b', limit: 600, pending: 0 },
    ],
  };
}

function fundingOf(data) {
  return F.resolveFundingSources(
    data.plan.funding.options, data.revolvingExtra, data.plan, data.debts);
}

function actionsOf(data) {
  return F.resolveActions(data.plan, data.debts, data.revolvingExtra);
}

console.log('=== 1. stored funding available is ignored once current state is supplied ===');
{
  const data = fixture();
  data.plan.funding.options.find(o => o.id === 'cards').available = 1;
  data.plan.funding.options.find(o => o.id === 'heloc').available = 1;
  const helocHeadroom = 1000 - 900;
  const triangleHeadroom = 300 - 200;
  const cashbackHeadroom = 500 - 400 - 50;
  const cards = triangleHeadroom + cashbackHeadroom;
  const got = fundingOf(data);
  ok(near(got.find(o => o.id === 'heloc').available, helocHeadroom),
    'HELOC available is limit − posted, not the stored 1',
    String(got.find(o => o.id === 'heloc').available));
  ok(near(got.find(o => o.id === 'cards').available, cards),
    'cards available is residual utilisation (triangle + cashback), not the stored 1',
    String(got.find(o => o.id === 'cards').available));
  ok(near(got.find(o => o.id === 'amanda').available, 0),
    'Amanda held-elsewhere locator is observational, not the raw $800');
  ok(near(got.find(o => o.id === 'overdraft').available, 600),
    'overdraft available is unused limit while Chequing B is positive');
}

console.log('\n=== 2. a posted/pending change updates derived headroom without editing plan data ===');
{
  const before = fixture();
  const after = clone(before);
  after.debts.find(d => d.id === 'triangle').pending = 80;
  after.debts.find(d => d.id === 'heloc').balance = 950;
  const planBefore = JSON.stringify(before.plan.funding.options);
  const fundBefore = fundingOf(before);
  const fundAfter = fundingOf(after);
  const cardsBefore = fundBefore.find(o => o.id === 'cards').available;
  const cardsAfter = fundAfter.find(o => o.id === 'cards').available;
  const helocBefore = fundBefore.find(o => o.id === 'heloc').available;
  const helocAfter = fundAfter.find(o => o.id === 'heloc').available;
  ok(near(cardsBefore - cardsAfter, 80),
    'Triangle pending +80 drops cards available by 80',
    `${cardsBefore} → ${cardsAfter}`);
  ok(near(helocBefore - helocAfter, 50),
    'HELOC posted +50 drops HELOC available by 50',
    `${helocBefore} → ${helocAfter}`);
  ok(JSON.stringify(after.plan.funding.options) === planBefore,
    'plan.funding.options bytes are unchanged');
}

console.log('\n=== 3. unknown pending withholds that facility from published cards headroom ===');
{
  const data = fixture();
  data.debts.find(d => d.id === 'cashback').pendingUnknown = true;
  data.debts.find(d => d.id === 'cashback').pending = null;
  const cards = fundingOf(data).find(o => o.id === 'cards').available;
  ok(near(cards, 100),
    'unknown Cash Back pending contributes no cards headroom; triangle 100 remains',
    String(cards));
}

console.log('\n=== 4. debtId action status follows utilisation, ignoring stored status ===');
{
  const over = fixture();
  over.plan.actions[1].status = 'done';
  over.debts.find(d => d.id === 'cashback').balance = 480;
  over.debts.find(d => d.id === 'cashback').pending = 30;
  const overActions = actionsOf(over);
  ok(overActions[1].status === 'open',
    'over-limit (480+30 vs 500) stays open even if stored status is done');
  ok(overActions[0].status === 'open',
    'owner-policy action without debtId keeps stored status');

  const under = clone(over);
  under.debts.find(d => d.id === 'cashback').pending = 0;
  under.debts.find(d => d.id === 'cashback').balance = 400;
  under.plan.actions[1].status = 'open';
  const underActions = actionsOf(under);
  ok(underActions[1].status === 'done',
    'under-limit with known pending becomes done without editing stored status');

  const unknown = clone(under);
  unknown.debts.find(d => d.id === 'cashback').pendingUnknown = true;
  unknown.debts.find(d => d.id === 'cashback').pending = null;
  unknown.debts.find(d => d.id === 'cashback').balance = 400;
  const unknownActions = actionsOf(unknown);
  ok(unknownActions[1].status === 'open',
    'unknown pending cannot mark the under-limit action done');
}

console.log('\n=== 5. recommend gap allocation uses derived available, not a stale stored figure ===');
{
  const data = fixture();
  data.plan.funding.options.find(o => o.id === 'heloc').available = 9999;
  data.plan.defaults.targetBuffer = 500;
  const rec = F.recommend(data.plan, '2026-08-19', {
    targetBuffer: 500,
    fundingSources: data.plan.funding.options,
    extraFacilities: data.revolvingExtra,
    debts: data.debts,
  });
  const helocSrc = (rec.planOptions.fundingSources || []).find(s => s.id === 'heloc');
  ok(helocSrc && near(helocSrc.available, 100),
    'recommend HELOC available is 100, not the stored 9999',
    helocSrc && String(helocSrc.available));
}

console.log('\n=== 6. a held-elsewhere raw-balance change does not increase household funding capacity (Q25) ===');
{
  const before = fixture();
  const after = clone(before);
  const held = after.plan.startingCash.heldElsewhere.find(h => h.id === 'amanda-debt-payments');
  held.value = 8000;
  const helocHeadroom = 1000 - 900;
  const usable = data => fundingOf(data)
    .filter(o => !o.unusable)
    .reduce((s, o) => s + Number(o.available || 0), 0);
  ok(near(usable(before), helocHeadroom) && near(usable(after), helocHeadroom),
    'usable funding capacity stays HELOC headroom 100, not 800 or 8000',
    `${usable(before)} → ${usable(after)}`);
  ok(near(fundingOf(after).find(o => o.id === 'amanda').available, 0),
    'and Amanda available stays 0 after the held-elsewhere row moves');

  const recOpts = data => ({
    targetBuffer: 700,
    fundingSources: data.plan.funding.options,
    extraFacilities: data.revolvingExtra,
    debts: data.debts,
  });
  const recBefore = F.recommend(before.plan, '2026-08-19', recOpts(before));
  const recAfter = F.recommend(after.plan, '2026-08-19', recOpts(after));
  const take = rec => (rec.funding.parts || []).reduce((s, p) => s + p.amount, 0);
  const amandaTake = rec => (rec.funding.parts || [])
    .filter(p => p.id === 'amanda')
    .reduce((s, p) => s + p.amount, 0);
  ok(near(take(recBefore), take(recAfter)),
    'recommend allocated gap funding is unchanged when only the held-elsewhere raw balance moves',
    `${take(recBefore)} → ${take(recAfter)}`);
  ok(near(amandaTake(recBefore), 0) && near(amandaTake(recAfter), 0),
    'and the opening gap does not consume the held-elsewhere account');
  ok(JSON.stringify(after.plan.funding.options) === JSON.stringify(before.plan.funding.options),
    'plan.funding.options bytes are unchanged');
}

console.log('\n' + (failures ? `${failures} failure(s)` : 'All current-headroom derivation checks passed'));
process.exit(failures ? 1 : 0);
