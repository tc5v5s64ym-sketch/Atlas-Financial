'use strict';
// Independent invented bank arithmetic; no canonical or provider payload reads.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const appRoot = process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..');
const F = require(path.join(appRoot, 'public/forecast')), Live = require(path.join(appRoot, 'scripts/live-plan'));
const { fixture, clone } = require('./fixtures/payday-bank-eod-anchor');
const independent = 70 + (34 - 4 - 7) + 20 - 7; // 106, not original113 or blanket102.
function run(i = fixture()) {
  const before = JSON.stringify(i);
  const live = Live.fromObservation({data:i.data, payload:i.payload, accountMap:i.accountMap});
  const advice = F.recommend(live.data.plan, i.asOf,
    {...i.x.opts, weeklyVariable:0, debts:[], ...live.data.liveOverlay});
  assert.equal(JSON.stringify(i), before, 'original inputs and source rows stay byte-equivalent');
  return {live, advice, snapshot:live.data.plan.opening.paydaySnapshot};
}
test('bank EOD anchor skips both included opening-day debits and reconciles the complete later walk', () => {
  const {live, advice, snapshot} = run();
  assert.equal(snapshot.opening, independent);
  assert.equal(F.startingCashAmount(live.data.plan), independent);
  assert.equal(advice.savingsFunding.period.status, 'ready', advice.savingsFunding.period.reason);
  assert.equal(advice.savingsFunding.period.currentCash, independent);
  assert.equal(advice.savingsFunding.moneyMovementPermission, 'not-granted');
  assert.notEqual(independent, 70 + 30 + 20 - 7, 'partial original opening is not reused');
  assert.notEqual(independent, 70 + 30 - 4 - 7 + 20 - 7, 'opening-day inclusion is not blanket-flipped');
});
test('same verified basis supports future Savings publication without inventing an actual saving or draw', () => {
  const {advice} = run();
  for (const start of ['2026-10-16','2026-10-30','2026-11-13']) {
    const v = advice.savingsFunding.periodViews.find(v => v.start === start);
    assert.ok(v, start);
    const p = F.savingsFundingPublication(advice.savingsFunding,
      {asOf:'2026-10-07', advice, periodId:v.id}).forecastClosing;
    assert.equal(p.status, 'ready', p.reason);
    assert.equal(p.stock + p.operatingCash, 119 + independent + (start === '2026-10-16' ? 1000 : 2000));
    assert.equal(p.actualSaved, null);
    assert.equal(p.moneyMovementPermission, 'not-granted');
  }
});
test('anchor absent leaves the incumbent mismatch hold unchanged', () => {
  const i=fixture(); delete i.data.plan.opening.cashReconstructionAnchor;
  const {advice,snapshot}=run(i);
  assert.equal(snapshot.opening,113);
  assert.equal(advice.savingsFunding.period.reason,
    'The original payday opening and posted operating legs do not reconcile to current cash.');
});
const invalid = [
  ['not owner approved',a=>{a.ownerApproved=false;}],
  ['truthy approval',a=>{a.ownerApproved='true';}],
  ['approval reference missing',a=>{delete a.approvalRef;}],
  ['blank approval reference',a=>{a.approvalRef=' ';}],
  ['provider observation is not a bank EOD receipt',a=>{a.source='lunchmoney';}],
  ['boundary missing',a=>{delete a.includedThrough;}],
  ['intraday boundary',a=>{a.includedThrough='intraday';}],
  ['wrong timezone',a=>{a.timezone='UTC';}],
  ['wrong currency',a=>{a.currency='USD';}],
  ['different opening date',a=>{a.asOf='2026-09-28';}],
  ['timestamp instead of household date',a=>{a.asOf='2026-09-29T23:59:00-07:00';}],
  ['missing account',a=>{a.accounts.pop();}],
  ['duplicate account',a=>{a.accounts[1].id='chequing-a';}],
  ['reserve is not operating cash',a=>{a.accounts[1].id='savings';}],
  ['extra reserve account',a=>{a.accounts.push({id:'savings',value:100,statementRef:'invented'});}],
  ['missing statement reference',a=>{delete a.accounts[1].statementRef;}],
  ['blank statement reference',a=>{a.accounts[1].statementRef=' ';}],
  ['explicitly unknown bank balance',a=>{a.accounts[1].unknown=true;}],
  ...[null,'',false,NaN,Infinity,{},'23',23.001,Number.MAX_SAFE_INTEGER].map(v=>
    ['invalid or inexact bank amount '+String(v),a=>{a.accounts[1].value=v;}]),
];
for (const [name,mutate] of invalid) test('explicit invalid anchor holds: '+name, () => {
  const i=fixture();mutate(i.data.plan.opening.cashReconstructionAnchor);
  assert.equal(run(i).snapshot,undefined,'no fallback to the partial original opening');
});
test('explicit null anchor does not fall back to the original', () => {
  const i=fixture();i.data.plan.opening.cashReconstructionAnchor=null;
  assert.equal(run(i).snapshot,undefined);
});
test('an EOD anchor is not a morning snapshot of its own date', () => {
  const i=fixture();
  assert.equal(F.establishPaydaySnapshot(i.data.plan,'2026-09-29',{
    paydayGapCash:{complete:true,coverageStart:'2026-09-29',coverageThrough:'2026-09-29',movements:[]}}),null);
});
test('a valid frozen payday snapshot still wins over reconstruction', () => {
  const i=fixture();i.data.plan.opening.cashReconstructionAnchor=null;
  i.data.plan.opening.paydaySnapshot={periodStart:'2026-10-02',asOf:'2026-10-02',opening:independent};
  assert.equal(run(i).snapshot.opening,independent);
});
test('complete EOD receipt never substitutes for incomplete later cash coverage', () => {
  const i=fixture();i.payload.transactionWindow.complete=false;i.payload.transactionWindow.truncated=true;
  assert.equal(run(i).snapshot,undefined);
});
test('an incorrect bank basis still fails the current cash reconciliation guard', () => {
  const i=fixture();i.data.plan.opening.cashReconstructionAnchor.accounts[1].value=24;
  assert.equal(run(i).advice.savingsFunding.period.reason,
    'The original payday opening and posted operating legs do not reconcile to current cash.');
});
test('repeated refreshes reconstruct once and preserve original historical values and receipt', () => {
  const i=fixture(),before=clone(i.data);
  const a=run(i),b=run(i);
  assert.deepEqual(i.data,before);
  assert.deepEqual(a.snapshot,b.snapshot);
  assert.equal(i.data.plan.startingCash.breakdown.find(r=>r.id==='chequing-b').value,30);
  assert.equal(i.data.plan.opening.asOf,'2026-09-29');
});
test('known zero and overdrawn bank balances stay signed, never replaced by credit capacity', () => {
  for (const value of [0,-5]) {
    const i=fixture();i.data.plan.opening.cashReconstructionAnchor.accounts[1].value=value;
    i.payload.accounts.find(a=>a.id==='9102').balance=value;
    assert.equal(run(i).snapshot.opening,70+value+20-7);
  }
});
test('pending gap cash and duplicate original identities remain held', () => {
  const pending=fixture();pending.payload.transactions[2].is_pending=true;
  assert.equal(run(pending).snapshot,undefined);
  for (const id of ['chequing-a','chequing-b']) {
    const i=fixture();i.data.plan.startingCash.breakdown.push(
      clone(i.data.plan.startingCash.breakdown.find(r=>r.id===id)));
    assert.equal(run(i).snapshot,undefined);
  }
});
