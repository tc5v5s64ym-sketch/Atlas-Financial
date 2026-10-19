'use strict';
// Savings Phase 2 (ATLAS-080) — settlement evidence relief through Forecast.
// Owner rule: a Lunch Money transaction explicitly identified with a Savings
// commitment, recorded through the Phase 1 contract, subtracts its assigned
// amount from the commitment's remaining cost. Original cost, linked paid and
// remaining stay distinct; the linked payment is an observed transaction fact
// and is never deducted a second time. Tests first: the with-evidence cases
// below FAIL on unmodified main 77ee7e79 (Phase 1 is inert — evidence changes
// nothing) and pass once Phase 2 lands. Approved v1 policy (Dale via Atlas,
// 2026-10-19): exact fixed-cost relief only; ranges, over-assignment and
// reversal-bearing evidence are needs-review/uncertain with dependent figures
// withheld — never silently capped, never gross-as-net. Retracted links give
// no relief. Nothing writes settledOn.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..');
const F = require(path.join(ROOT, 'public/forecast'));
const C = require(path.join(ROOT, 'scripts/planned-obligation-settlement-contract'));
const fx = require('./fixtures/savings-daily-allocation-contract');

const householdId = 'household-' + 'a'.repeat(32);
const actorId = 'session-' + 'c'.repeat(64);
const op = n => 'operation-' + n.toString(16).padStart(32, '0');
const tx = n => 'tx-' + n.toString(16).padStart(32, '0');
const T0 = Date.parse('2026-10-04T12:00:00Z');

// Record one ACTIVE link through the real Phase 1 contract and return the
// effectiveEvidence output Forecast consumes at the opts.settlementEvidence
// seam. assignedCents is in cents; the evidence debit is a posted 6000-cent
// transaction dated 2026-10-03 unless overridden.
function evidenceWithLink({ goalId = 'commitment:near', assignedCents = 2500, evidenceDate = '2026-10-03' } = {}) {
  let body = C.adopt({ householdId });
  const evidence = { accountId: 'acct-main', currency: 'cad', direction: 'debit', date: evidenceDate, cents: 6000, posted: true };
  const cmd = { version: 1, kind: 'link', goalId, txRef: tx(1), evidence, evidenceDigest: C.digest(evidence), assignedCents, asOf: '2026-10-04' };
  const prepared = C.prepare(body, { householdId, actorId, operationId: op(1), command: cmd, now: T0 });
  const confirmed = C.confirmCandidate(body, { householdId, actorId, preview: prepared.preview, confirmationDigest: prepared.confirmationDigest, now: T0 + 1 });
  assert.equal(confirmed.status, 'candidate', 'link recorded');
  body = confirmed.document;
  const state = JSON.parse(body.toString('utf8'));
  return C.effectiveEvidence({ householdId: state.householdId, revision: state.revision, operations: state.operations });
}

function input() {
  const x = fx.fixture();
  x.plan.savingsEarmarks.pools[0].goalRefs = [{ kind: 'commitment', id: 'near' }];
  return x;
}

function surfaces(x, opts) {
  const inventory = F.savingsInventory(x.plan, x.asOf, opts);
  const pool = (inventory.pools || []).find(p => p.id === 'club-pool');
  const goal = pool && pool.plannedGoals.find(g => g.key === 'commitment:near');
  const events = F.expandEvents(x.plan, x.asOf, '2026-11-30', opts)
    .filter(e => e.kind === 'commitment' && e.id === 'near');
  const advice = F.recommend(x.plan, x.asOf, { ...x.opts, ...opts, weeklyVariable: 0, debts: [] });
  const seq = (advice.fundingSequence || []).find(e => e.id === 'near');
  return { goal, events, seq };
}

test('control: without settlement evidence the commitment still requires its full cost', () => {
  const { goal, events, seq } = surfaces(input(), {});
  assert.equal(goal.target, 60);
  assert.equal(events.length, 1);
  assert.equal(events[0].amount, -60);
  assert.equal(seq.need, 60);
});

test('partial link: a confirmed 25 assignment against a 60 cost leaves remaining 35 everywhere', () => {
  const eff = evidenceWithLink({});
  const { goal, events, seq } = surfaces(input(), { settlementEvidence: eff });
  assert.equal(goal.target, 60, 'original cost preserved');
  assert.equal(goal.linkedPaid, 25, 'linked paid is its own figure');
  assert.equal(goal.remaining, 35, 'remaining = original - linked paid');
  assert.equal(events.length, 1);
  assert.equal(events[0].amount, -35, 'cash event carries the relieved amount, not the original');
  assert.equal(seq.need, 35, 'funding sequence needs only the remaining');
});

// --- Extended matrix --------------------------------------------------------
// Multi-command evidence built through the same real Phase 1 contract:
// prepare -> digest-pinned confirm per operation, non-decreasing recordedAt.
function buildEvidence(commands) {
  let body = C.adopt({ householdId });
  commands.forEach((command, i) => {
    const at = T0 + i * 10;
    const prepared = C.prepare(body, { householdId, actorId, operationId: op(i + 1), command, now: at });
    const confirmed = C.confirmCandidate(body, { householdId, actorId, preview: prepared.preview, confirmationDigest: prepared.confirmationDigest, now: at + 1 });
    assert.equal(confirmed.status, 'candidate', 'command ' + (i + 1) + ' recorded');
    body = confirmed.document;
  });
  const state = JSON.parse(body.toString('utf8'));
  return C.effectiveEvidence({ householdId: state.householdId, revision: state.revision, operations: state.operations });
}
const linkCmd = ({ goalId = 'commitment:near', txRef = tx(1), assignedCents = 2500, evidenceDate = '2026-10-03', evidenceCents = 6000, asOf = '2026-10-04' } = {}) => {
  const evidence = { accountId: 'acct-main', currency: 'cad', direction: 'debit', date: evidenceDate, cents: evidenceCents, posted: true };
  return { version: 1, kind: 'link', goalId, txRef, evidence, evidenceDigest: C.digest(evidence), assignedCents, asOf };
};
const reverseCmd = (targetOperationId, cents = 500) => {
  const counterEvidence = { accountId: 'acct-main', currency: 'cad', direction: 'credit', date: '2026-10-04', cents: 6000, posted: true };
  return { version: 1, kind: 'reverse', targetOperationId, counterTxRef: tx(9), counterEvidence, counterEvidenceDigest: C.digest(counterEvidence), cents };
};
const retractCmd = targetOperationId => ({ version: 1, kind: 'retract', targetOperationId });

function goalOf(x, opts, key, poolId = 'club-pool') {
  const inventory = F.savingsInventory(x.plan, x.asOf, opts);
  const pool = (inventory.pools || []).find(p => p.id === poolId);
  return pool && pool.plannedGoals.find(g => g.key === key);
}

test('full link: remaining 0, no cash event, and the goal is NOT settled', () => {
  const eff = buildEvidence([linkCmd({ assignedCents: 6000 })]);
  const { goal, events, seq } = surfaces(input(), { settlementEvidence: eff });
  assert.equal(goal.target, 60, 'original cost preserved');
  assert.equal(goal.linkedPaid, 60);
  assert.equal(goal.remaining, 0, 'fully relieved');
  assert.equal(goal.settled, false, 'a link is not settledOn settlement; history is retained');
  assert.equal(events.length, 0, 'no future cash event for a fully relieved commitment');
  assert.equal(seq.need, 0, 'funding sequence requires nothing further');
});

test('absent or null evidence is byte-identical to no evidence at all', () => {
  const x = input();
  const base = { ...x.opts, weeklyVariable: 0, debts: [] };
  // recommend echoes the caller's own opts back in its assumptions record
  // (true on unmodified main for any opt key); delete that echo of the seam
  // key itself, then every computed figure must match byte for byte.
  const stripEcho = value => JSON.parse(JSON.stringify(value, (key, v) => key === 'settlementEvidence' ? undefined : v));
  const plain = F.recommend(x.plan, x.asOf, base);
  const withNull = F.recommend(x.plan, x.asOf, { ...base, settlementEvidence: null });
  const withUndefined = F.recommend(x.plan, x.asOf, { ...base, settlementEvidence: undefined });
  assert.deepEqual(stripEcho(withNull), stripEcho(plain), 'null evidence changes no computed figure');
  assert.deepEqual(stripEcho(withUndefined), stripEcho(plain), 'undefined evidence changes no computed figure');
  const invPlain = F.savingsInventory(x.plan, x.asOf);
  const invNull = F.savingsInventory(x.plan, x.asOf, { settlementEvidence: null });
  assert.equal(JSON.stringify(invNull), JSON.stringify(invPlain), 'inventory is unchanged without evidence');
});

test('future-dated link: effective after asOf gives no relief anywhere', () => {
  const eff = buildEvidence([linkCmd({ evidenceDate: '2026-10-06', asOf: '2026-10-06' })]);
  const { goal, events, seq } = surfaces(input(), { settlementEvidence: eff });
  assert.equal(goal.linkedPaid, 0, 'a link not yet effective pays nothing yet');
  assert.equal(goal.remaining, 60);
  assert.equal(events.length, 1);
  assert.equal(events[0].amount, -60);
  assert.equal(seq.need, 60);
});

test('reversal-bearing link: no relief, remaining uncertain and withheld, never gross-as-net', () => {
  const eff = buildEvidence([linkCmd({}), reverseCmd(op(1))]);
  const { goal, events, seq } = surfaces(input(), { settlementEvidence: eff });
  assert.equal(goal.target, 60, 'original cost still known');
  assert.equal(goal.settlementUncertain, true, 'the reversal makes the remaining figure uncertain');
  assert.equal(goal.remaining, null, 'remaining is withheld, not the gross assignment netted');
  assert.equal(goal.linkedPaid, null, 'gross assigned is not published as paid');
  assert.equal(events.length, 0, 'no cash event is fabricated from uncertain evidence');
  assert.equal(seq.need, null, 'funding sequence withholds the need');
  assert.equal(seq.settlementUncertain, true);
});

test('retracted link: absent from effective evidence, so it relieves nothing', () => {
  const eff = buildEvidence([linkCmd({}), retractCmd(op(1))]);
  assert.deepEqual(eff.commitments, [], 'retraction removes the link from effective evidence');
  const { goal, events, seq } = surfaces(input(), { settlementEvidence: eff });
  assert.equal(goal.linkedPaid, 0);
  assert.equal(goal.remaining, 60);
  assert.equal(events.length, 1);
  assert.equal(events[0].amount, -60);
  assert.equal(seq.need, 60);
});

test('ranged commitment with a link: relief withheld as uncertain in v1, range itself preserved', () => {
  const x = input();
  const row = x.plan.commitments.find(c => c.id === 'near');
  delete row.amount; row.amountMin = 50; row.amountMax = 70;
  const eff = buildEvidence([linkCmd({})]);
  const goal = goalOf(x, { settlementEvidence: eff }, 'commitment:near');
  assert.equal(goal.target, 50, 'range floor stays the published target');
  assert.equal(goal.targetMax, 70, 'range ceiling stays published');
  assert.equal(goal.settlementUncertain, true, 'v1 does not relieve a range');
  assert.equal(goal.remaining, null, 'remaining withheld for a ranged row');
  assert.equal(goal.remainingMax, null);
  const seq = F.fundingSequence(x.plan, x.asOf, { settlementEvidence: eff }).find(e => e.id === 'near');
  assert.equal(seq.settlementUncertain, true, 'funding sequence flags the same uncertainty');
});

test('over-assignment: sum assigned above the row amount is uncertain, never silently capped', () => {
  const eff = buildEvidence([linkCmd({ assignedCents: 7000, evidenceCents: 9000 })]);
  const { goal, events, seq } = surfaces(input(), { settlementEvidence: eff });
  assert.equal(goal.settlementUncertain, true);
  assert.equal(goal.remaining, null, 'withheld — not capped to a fabricated 0 remaining');
  assert.equal(goal.linkedPaid, null, 'the over-assigned gross is not published as paid');
  assert.equal(events.length, 0, 'no cash event from over-assigned evidence');
  assert.equal(seq.need, null);
});

test('group goalRef: relief aggregates per member into the group remaining', () => {
  const x = fx.fixture(); // club-pool refs the whole club group (near 60 + far 170)
  const eff = buildEvidence([linkCmd({})]); // 25 against near only
  const goal = goalOf(x, { settlementEvidence: eff }, 'group:club');
  assert.equal(goal.target, 230, 'group original cost is both members');
  assert.equal(goal.linkedPaid, 25, 'only the linked member contributes paid');
  assert.equal(goal.remaining, 205, 'group remaining is the sum of member remainings');
});

test('two links with different transaction identities sum their assignments', () => {
  const eff = buildEvidence([linkCmd({ txRef: tx(1), assignedCents: 2500 }), linkCmd({ txRef: tx(2), assignedCents: 1000 })]);
  const { goal, events, seq } = surfaces(input(), { settlementEvidence: eff });
  assert.equal(goal.linkedPaid, 35);
  assert.equal(goal.remaining, 25);
  assert.equal(events[0].amount, -25);
  assert.equal(seq.need, 25);
});

test('one transaction split across two commitments relieves each by its own assignment only', () => {
  const x = input();
  x.plan.savingsEarmarks.pools[0].goalRefs = [{ kind: 'commitment', id: 'near' }, { kind: 'commitment', id: 'far' }];
  const eff = buildEvidence([
    linkCmd({ goalId: 'commitment:near', txRef: tx(1), assignedCents: 2500 }),
    linkCmd({ goalId: 'commitment:far', txRef: tx(1), assignedCents: 3500 }),
  ]);
  const near = goalOf(x, { settlementEvidence: eff }, 'commitment:near');
  const far = goalOf(x, { settlementEvidence: eff }, 'commitment:far');
  assert.equal(near.linkedPaid, 25, 'near keeps only its own assignment');
  assert.equal(near.remaining, 35);
  assert.equal(far.linkedPaid, 35, 'far keeps only its own assignment');
  assert.equal(far.remaining, 135);
});

test('fully relieved member flows through the combined backing without becoming unresolved', () => {
  const chrono = require('./fixtures/chronological-savings-data');
  const x = chrono.ledger(); // combined-pool allocation policy, near 60 due 2026-10-21, asOf 2026-10-07
  const eff = buildEvidence([linkCmd({ assignedCents: 6000 })]);
  const advice = F.recommend(x.plan, x.asOf, { ...x.opts, settlementEvidence: eff, weeklyVariable: 0, debts: [] });
  const funding = advice.savingsFunding;
  assert.equal(funding.backing.status, 'ready', 'combined backing stays ready');
  const item = (funding.backing.items || []).find(i => i.id === 'near');
  assert.ok(item, 'the relieved member is still a known item');
  assert.equal(item.needed, 0, 'combined backing needs nothing further for it');
  assert.ok(!(funding.unresolved || []).some(i => i.id === 'near'), 'full relief is not an unresolved requirement');
  assert.ok(!(advice.sim.events || []).some(e => e.kind === 'commitment' && e.id === 'near'),
    'no cash event is walked for the relieved commitment');
  const control = F.recommend(x.plan, x.asOf, { ...x.opts, weeklyVariable: 0, debts: [] });
  const controlItem = (control.savingsFunding.backing.items || []).find(i => i.id === 'near');
  assert.equal(controlItem.needed, 60, 'control: without evidence the full cost is still needed');
});

test('current-period bills: planned stays the original cost while remaining takes the relief', () => {
  const x = input();
  x.plan.commitments.find(c => c.id === 'near').date = '2026-10-14'; // inside the current pay period
  const action = opts => F.currentPeriodAction(x.plan, x.asOf, { ...x.opts, ...opts });
  const billOf = a => (a.bills || []).find(b => b.id === 'near');
  const control = billOf(action({}));
  assert.equal(control.planned, 60, 'control planned is the full cost');
  assert.equal(control.remaining, 60, 'control remaining is the full cost');
  // Link effective 2026-10-04: after the period origin (2026-10-02) but on or
  // before asOf (2026-10-05). The walk-start cutoff inside expandEvents cannot
  // see it; this action list is pinned to asOf and must still relieve.
  const eff = buildEvidence([linkCmd({})]);
  const relieved = billOf(action({ settlementEvidence: eff }));
  assert.equal(relieved.planned, 60, 'planned remains the original cost, not the relieved amount');
  assert.equal(relieved.remaining, 35, 'remaining is relieved at the asOf cutoff');
  assert.equal(relieved.linkedPaid, 25, 'linked paid is published as its own figure');
});

test('original-cost publications keep the stated amounts under relief', () => {
  const x = input();
  const eff = buildEvidence([linkCmd({})]);
  const totals = F.publicationTotals({ plan: x.plan, debts: [], income: [], meta: { asOf: x.asOf } });
  assert.equal(totals.commitmentsTotal, 230, 'publication totals list original plan cost');
  assert.equal(totals.commitmentItems.find(i => i.id === 'near').amount, 60);
  const est = input();
  est.plan.commitments.find(c => c.id === 'near').confidence = 'estimated';
  const advice = F.recommend(est.plan, est.asOf, { ...est.opts, settlementEvidence: eff, weeklyVariable: 0, debts: [] });
  const phases = F.planPhases(est.plan, advice, {}, { ...est.opts, settlementEvidence: eff });
  const risk = (phases.risks || []).find(r => r.id === 'estimatedCommitments');
  assert.ok(risk, 'estimated-commitments risk is published');
  assert.equal(risk.total, 60, 'estimation exposure stays the original stated amount');
});

test('no input or evidence mutation across every relieved surface', () => {
  const x = input();
  const eff = buildEvidence([linkCmd({})]);
  const before = JSON.stringify({ x, eff });
  surfaces(x, { settlementEvidence: eff });
  F.savingsDailyFunding(x.plan, [], x.asOf, { ...x.opts, settlementEvidence: eff });
  F.currentPeriodAction(x.plan, x.asOf, { ...x.opts, settlementEvidence: eff });
  assert.equal(JSON.stringify({ x, eff }), before, 'plan, opts and evidence are read-only inputs');
});

test('backed allocation stays coherent: need and floor move together under relief', () => {
  const x = input();
  x.plan.savingsEarmarks.history = [{ revision: 1, confirmedAt: '2026-10-02', source: 'Invented confirmation', pools: [
    { poolId: 'club-pool', allocations: [{ goalRef: { kind: 'commitment', id: 'near' }, amount: 35 }] },
    { poolId: 'home-pool', allocations: [{ goalRef: { kind: 'yearly-bill', id: 'home-cost' }, amount: 24 }] },
  ] }];
  const eff = buildEvidence([linkCmd({})]); // remaining 35, exactly the backed allocation
  const inventory = F.savingsInventory(x.plan, x.asOf, { settlementEvidence: eff });
  assert.equal(inventory.incrementalInstructions, 'eligible',
    'reserve funding stays ready: relieved need and relieved floor still agree');
  const pool = inventory.pools.find(p => p.id === 'club-pool');
  const entry = pool.allocations.find(a => a.goalKey === 'commitment:near');
  assert.equal(entry.backed, 35, 'the confirmed allocation itself is untouched by relief');
});
