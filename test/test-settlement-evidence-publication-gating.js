'use strict';
// ATLAS-080 — configured-unavailable publication gating at the serving
// surfaces (assistant packet, Planning page, Plan page).
//
// The settlement evidence loader returns a tri-state outcome —
// unconfigured / qualified / unavailable(reason) — but Forecast's only
// input channel is the evidence value itself, so before this slice a
// configured-but-unavailable store had no downstream representation:
// it collapsed into the same null that means "never configured", and
// settlement-dependent Savings / funding / transfer-guidance /
// assistant figures were published as though no settlement existed.
//
// These tests pin the surface contract over synthetic served-data
// outcomes (a status carried ALONGSIDE the evidence on the served
// object the surfaces already consume — never inside the evidence):
//   unconfigured  -> behaviour and output identical to no status at all
//   qualified     -> the verified effective evidence reaches every
//                    dependent Forecast call the surface makes
//   unavailable   -> every settlement-dependent claim is withheld with
//                    the loader's reason named; genuinely independent
//                    reported facts stay published; no zero, no stale
//                    fallback, no badge over legacy figures
//   malformed status / qualified-without-evidence / evidence without a
//   qualified status -> fail closed as unavailable
//   ('invalid-configuration'), never as unconfigured.
//
// The three surfaces are exercised the way production loads them:
// the packet through its Node builder, the two browser pages through
// a vm harness that loads the real classic scripts with a recording
// fake DOM (the same globals mechanism index.html uses).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..');
const F = require(path.join(ROOT, 'public/forecast.js'));
const C = require(path.join(ROOT, 'scripts/planned-obligation-settlement-contract.js'));
const Assistant = require(path.join(ROOT, 'scripts/assistant-packet.js'));
const fx = require('./fixtures/savings-daily-allocation-contract');

const householdId = 'household-' + 'a'.repeat(32);
const actorId = 'session-' + 'c'.repeat(64);
const op = n => 'operation-' + n.toString(16).padStart(32, '0');
const tx = n => 'tx-' + n.toString(16).padStart(32, '0');
const T0 = Date.parse('2026-10-04T12:00:00Z');
const REASONS = ['pin-unavailable', 'document-missing', 'digest-mismatch'];

// A real Phase 1 link (25 of a 60-cent assignment) projected through
// the contract's effectiveEvidence — the exact shape the loader
// returns as outcome.evidence on a qualified read.
function linkEvidence(assignedCents = 2500) {
  let body = C.adopt({ householdId });
  const evidence = { accountId: 'acct-main', currency: 'cad', direction: 'debit', date: '2026-10-03', cents: 6000, posted: true };
  const cmd = { version: 1, kind: 'link', goalId: 'commitment:near', txRef: tx(1), evidence, evidenceDigest: C.digest(evidence), assignedCents, asOf: '2026-10-04' };
  const prepared = C.prepare(body, { householdId, actorId, operationId: op(1), command: cmd, now: T0 });
  const confirmed = C.confirmCandidate(body, { householdId, actorId, preview: prepared.preview, confirmationDigest: prepared.confirmationDigest, now: T0 + 1 });
  assert.equal(confirmed.status, 'candidate', 'link recorded through the contract');
  body = confirmed.document;
  const state = JSON.parse(body.toString('utf8'));
  return C.effectiveEvidence({ householdId: state.householdId, revision: state.revision, operations: state.operations });
}

function fixtureInput(commitmentAmount) {
  const x = fx.fixture();
  x.plan.savingsEarmarks.pools[0].goalRefs = [{ kind: 'commitment', id: 'near' }];
  if (commitmentAmount != null) x.plan.commitments[0].amount = commitmentAmount;
  return x;
}

// The served-data object the three surfaces already consume, with the
// settlement outcome fields attached the way the composition point
// will attach them (status alongside, never inside, the evidence).
function servedData(x, settlement) {
  const data = {
    plan: x.plan,
    debts: [],
    revolvingExtra: undefined,
    meta: { asOf: x.asOf },
    liveOverlay: null,
    coverage: [],
  };
  if (settlement) {
    if (settlement.status !== undefined) data.settlementEvidenceStatus = settlement.status;
    if (settlement.evidence !== undefined) data.settlementEvidence = settlement.evidence;
  }
  return data;
}

const periods = () => Assistant.loadPeriods();
const UNCONFIGURED = { status: { status: 'unconfigured' } };
const QUALIFIED = () => ({ status: { status: 'qualified' }, evidence: linkEvidence() });
const UNAVAILABLE = reason => ({ status: { status: 'unavailable', reason } });

function numbersIn(value, out = []) {
  if (typeof value === 'number') out.push(value);
  else if (Array.isArray(value)) value.forEach(v => numbersIn(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => numbersIn(v, out));
  return out;
}

/* ------------------------------------------------ assistant packet */

function buildFor(x, settlement) {
  return Assistant.buildPacket({
    data: servedData(x, settlement),
    periods: periods(),
    questionsMarkdown: '',
    now: '2026-10-05T12:00:00.000Z',
    env: {},
  });
}

function directRecommend(x, eff) {
  const plan = x.plan;
  return F.recommend(plan, x.asOf, {
    fundingSources: plan.funding && plan.funding.options,
    debts: [],
    revolvingExtra: undefined,
    periods: periods(),
    currentPeriodActuals: null,
    operatingPlan: null,
    operatingPlanNote: null,
    ...(eff ? { settlementEvidence: eff } : {}),
  });
}

test('packet: absent status and explicit unconfigured are identical', () => {
  const a = buildFor(fixtureInput(), null);
  const b = buildFor(fixtureInput(), UNCONFIGURED);
  assert.deepEqual(b, a);
  assert.equal(a.metadata.settlementEvidence, undefined,
    'unconfigured packet carries no settlement metadata');
});

test('packet: qualified threads the verified evidence into recommend', () => {
  const x = fixtureInput();
  const packet = buildFor(x, QUALIFIED());
  const expected = directRecommend(fixtureInput(), linkEvidence());
  const baseline = directRecommend(fixtureInput(), null);
  assert.notEqual(expected.weekly, baseline.weekly,
    'fixture sanity: evidence moves the recommendation on this plan');
  assert.equal(packet.forecast.recommendation.weekly, expected.weekly,
    'packet weekly is the with-evidence Forecast recommendation');
  assert.deepEqual(packet.metadata.settlementEvidence, { status: 'qualified', reason: null });
  const major = (packet.forecast.majorPlanFunding.items || [])
    .find(item => item.id === 'near' || /first club/.test(item.label || ''));
  assert.ok(major, 'major plan funding includes the linked commitment');
  assert.equal(major.need, 35, 'funding need is the relieved remaining, not the original cost');
});

test('packet: configured-unavailable withholds the forecast block with the reason named', () => {
  for (const reason of REASONS) {
    const packet = buildFor(fixtureInput(), UNAVAILABLE(reason));
    assert.deepEqual(packet.metadata.settlementEvidence, { status: 'unavailable', reason });
    assert.equal(packet.forecast.status, 'unavailable');
    assert.equal(packet.forecast.reason, reason);
    for (const key of ['recommendation', 'horizon', 'upcomingModeledCommitments',
      'facilityCrossings', 'majorPlanFunding', 'currentPeriodAction', 'budgetCap',
      'paydayAllocation', 'predictedEndingBalance']) {
      assert.deepEqual(packet.forecast[key], { status: 'unavailable', reason },
        `${key} withheld with the settlement reason (${reason})`);
    }
    assert.deepEqual(numbersIn(packet.forecast), [],
      'no figure at all survives inside the withheld forecast block');
    assert.deepEqual(packet.planning.trajectory,
      { status: 'unavailable', source: 'settlement-evidence', reason });
    assert.deepEqual(packet.current.nextSignificantObligations,
      { status: 'unavailable', reason });
    // Independent reported facts stay published, unchanged.
    const baseline = buildFor(fixtureInput(), null);
    assert.deepEqual(packet.current.spendableHouseholdCash, baseline.current.spendableHouseholdCash,
      'spendable cash (startingCashAmount) is evidence-independent and preserved');
    assert.deepEqual(packet.current.pending, baseline.current.pending);
    assert.deepEqual(packet.current.debts, baseline.current.debts);
    assert.deepEqual(packet.actuals.window, baseline.actuals.window,
      'periods.json reported window is preserved');
    assert.deepEqual(packet.actuals.spendingTotal, baseline.actuals.spendingTotal);
    assert.deepEqual(packet.actuals.budgetCategories, { status: 'unavailable', reason });
    assert.deepEqual(packet.actuals.currentPeriodCategories, { status: 'unavailable', reason });
  }
});

test('packet: the three loader reasons produce distinctly withheld packets', () => {
  const packets = REASONS.map(r => buildFor(fixtureInput(), UNAVAILABLE(r)));
  for (let i = 0; i < packets.length; i++) {
    for (let j = i + 1; j < packets.length; j++) {
      assert.notDeepEqual(packets[i], packets[j],
        `${REASONS[i]} output is distinguishable from ${REASONS[j]}`);
    }
  }
});

test('packet: withheld output does not depend on the settlement-dependent figures', () => {
  // Same plan, different commitment cost: under unavailable the packet
  // must be identical — nothing about the withheld figures may leak
  // through aggregates, counts or ordering.
  const a = buildFor(fixtureInput(60), UNAVAILABLE('pin-unavailable'));
  const b = buildFor(fixtureInput(97), UNAVAILABLE('pin-unavailable'));
  assert.deepEqual(b, a);
  // …while unconfigured output DOES move with the cost (control).
  const c = buildFor(fixtureInput(60), null);
  const d = buildFor(fixtureInput(97), null);
  assert.notDeepEqual(d, c, 'control: unconfigured packet tracks the plan');
});

test('packet: malformed status and qualified-without-evidence fail closed', () => {
  const cases = [
    { status: { status: 'bogus' } },
    { status: { status: 'qualified' } },
    { status: { status: 'qualified' }, evidence: null },
    { status: { status: 'qualified' }, evidence: { nope: true } },
    { status: { status: 'unavailable' } },
    { status: { status: 'unavailable' }, },
    { status: { status: 'unavailable', reason: 42 } },
    { status: { status: 'unavailable', reason: 'Not A Reason!' } },
    { status: 'qualified' },
    { status: { status: 'unconfigured' }, evidence: linkEvidence() },
    { evidence: linkEvidence() },
  ];
  for (const settlement of cases) {
    const packet = buildFor(fixtureInput(), settlement);
    assert.deepEqual(packet.metadata.settlementEvidence,
      { status: 'unavailable', reason: 'invalid-configuration' },
      `fails closed: ${JSON.stringify(settlement.status)}`);
    assert.equal(packet.forecast.status, 'unavailable');
    assert.equal(packet.forecast.reason, 'invalid-configuration');
    assert.deepEqual(numbersIn(packet.forecast), [], 'no figures on the fail-closed path');
  }
});

/* ------------------------------------------------------- fake DOM */

function makeFakeDom() {
  const elements = new Map();
  const drawStub = new Proxy({}, {
    get(target, prop) {
      if (prop === 'measureText') return () => ({ width: 0 });
      if (typeof prop === 'symbol') return undefined;
      return (...args) => drawStub;
    },
    set() { return true; },
  });
  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        id, innerHTML: '', textContent: '', className: '', hidden: false,
        dataset: {}, style: {}, attrs: {}, children: [], value: '',
        checked: false, disabled: false, offsetWidth: 120, offsetHeight: 40,
        offsetLeft: 0, offsetTop: 0, scrollWidth: 240, clientWidth: 240, scrollLeft: 0,
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
        removeAttribute(k) { delete this.attrs[k]; },
        addEventListener() {}, removeEventListener() {},
        appendChild(c) { this.children.push(c); return c; },
        append(...kids) { this.children.push(...kids); },
        querySelector() { return element(id + '>q'); },
        querySelectorAll() { return []; },
        closest() { return null; },
        getContext() { return drawStub; },
        getBoundingClientRect() { return { left: 0, top: 0, width: 120, height: 40 }; },
        scrollTo() {}, focus() {}, click() {}, remove() {},
      });
    }
    return elements.get(id);
  }
  const document = {
    getElementById: id => element(id),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: tag => element('created:' + tag),
    // app.js builds chart SVG through document.createElementNS.
    createElementNS: (ns, tag) => element('createdNS:' + tag),
    addEventListener() {},
    body: element('body'),
    documentElement: element('html'),
  };
  return { document, element, elements };
}

function loadBrowserScripts(files) {
  const dom = makeFakeDom();
  const sandbox = {
    console,
    // Inert timers: app.js boot arms long abort timers (60s/180s)
    // around its data fetch; with real timers those would hold the
    // suite's process open long after the tests finish, and no render
    // path in these surfaces waits on a timer callback.
    setTimeout: () => 0, clearTimeout() {},
    setInterval: () => 0, clearInterval() {},
    // app.js boot constructs an AbortController for its (here inert)
    // data fetch; the vm global does not inherit Node's web globals.
    AbortController, AbortSignal,
    getComputedStyle: () => ({
      getPropertyValue: () => '',
      visibility: 'visible',
      borderRadius: '0px',
    }),
    document: dom.document,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    CSS: {
      escape: s => String(s).replace(/"/g, '\\"'),
      // budget-sheet-motion.js probes CSS.supports at load and takes
      // its no-animation fallback when the answer is false; without a
      // supports function the load itself throws in the harness.
      supports: () => false,
    },
    // The App framework (app.js) boots by fetching served data; a fetch
    // that never resolves keeps boot inert so the tests can drive the
    // registered render functions directly with synthetic served data.
    fetch: () => new Promise(() => {}),
    location: { href: 'http://localhost/', search: '', pathname: '/', reload() {} },
    history: { pushState() {}, replaceState() {} },
    navigator: { userAgent: 'node-test' },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    requestAnimationFrame: () => 0,
    addEventListener() {}, removeEventListener() {},
    isSecureContext: false,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
  }
  return { sandbox, dom };
}

function snapshotMounts(dom) {
  const out = {};
  for (const [id, el] of dom.elements) {
    out[id] = {
      innerHTML: el.innerHTML, textContent: el.textContent,
      className: el.className, hidden: el.hidden, attrs: { ...el.attrs },
      planStatus: el.dataset && el.dataset.planStatus,
    };
  }
  return out;
}

/* ---------------------------------------------------- planning page */

function loadPlanning() {
  return loadBrowserScripts([
    'public/app.js',
    'public/forecast-card-period.js',
    'public/forecast.js',
    'public/planning.js',
  ]);
}

test('planning: qualified threads evidence into trajectory and advice calls', () => {
  const { sandbox } = loadPlanning();
  const x = fixtureInput();
  const qualified = sandbox.planningTrajectory(servedData(x, QUALIFIED()), periods());
  assert.equal(qualified.status, 'ready');
  const goal = (qualified.savingsFundingTimeline.goals || [])[0];
  assert.ok(goal, 'trajectory embeds the funding timeline');
  assert.equal(goal.requirement, 35, 'timeline requirement is the relieved remaining');
  const plain = sandbox.planningTrajectory(servedData(fixtureInput(), null), periods());
  assert.equal((plain.savingsFundingTimeline.goals || [])[0].requirement, 60,
    'control: without evidence the full cost is required');
  const advice = sandbox.planningAdvice(servedData(fixtureInput(), QUALIFIED()), periods());
  const seq = (advice.fundingSequence || []).find(e => e.id === 'near');
  assert.ok(seq, 'funding sequence includes the linked commitment');
  assert.equal(seq.need, 35, 'advice funding need is the relieved remaining');
});

test('planning: renderPlanning withholds the Road Ahead under unavailable, distinctly per reason', () => {
  const renders = REASONS.map(reason => {
    const { sandbox, dom } = loadPlanning();
    sandbox.renderPlanning(servedData(fixtureInput(), UNAVAILABLE(reason)), periods());
    return dom.element('planning-road-ahead').innerHTML;
  });
  for (let i = 0; i < renders.length; i++) {
    assert.match(renders[i], /data-settlement-evidence="unavailable"/);
    assert.ok(renders[i].includes(REASONS[i]), `reason ${REASONS[i]} is named in the withheld output`);
    assert.doesNotMatch(renders[i], /planning-road-timeline|data-planning-road-shell="ready"/,
      'no ready Road Ahead shell leaks through');
    for (let j = i + 1; j < renders.length; j++) assert.notEqual(renders[i], renders[j]);
  }
});

test('planning: withheld render does not depend on the settlement-dependent figures', () => {
  const render = amount => {
    const { sandbox, dom } = loadPlanning();
    sandbox.renderPlanning(servedData(fixtureInput(amount), UNAVAILABLE('document-missing')), periods());
    return dom.element('planning-road-ahead').innerHTML;
  };
  assert.equal(render(97), render(60),
    'withheld Road Ahead is identical whatever the withheld figures are');
  const ready = (() => {
    const { sandbox, dom } = loadPlanning();
    sandbox.renderPlanning(servedData(fixtureInput(60), null), periods());
    return dom.element('planning-road-ahead').innerHTML;
  })();
  assert.notEqual(ready, render(60), 'control: unconfigured render publishes the Road Ahead');
});

test('planning: malformed status fails closed in renderPlanning', () => {
  const { sandbox, dom } = loadPlanning();
  sandbox.renderPlanning(servedData(fixtureInput(), { status: { status: 'qualified' } }), periods());
  const html = dom.element('planning-road-ahead').innerHTML;
  assert.match(html, /data-settlement-evidence="unavailable"/);
  assert.ok(html.includes('invalid-configuration'));
});

/* -------------------------------------------------------- plan page */

function loadPlan() {
  return loadBrowserScripts([
    'public/app.js',
    'public/forecast-card-period.js',
    'public/forecast.js',
    'public/forecast-chequing.js',
    'public/balance-history.js',
    'public/bill-detail.js',
    'public/savings-inventory.js',
    'public/budget-surface.js',
    'public/budget-card-movements.js',
    'public/budget-sheet-motion.js',
    'public/transaction-review.js',
    'public/plan.js',
  ]);
}

function renderPlanPage(loaded, x, settlement) {
  const { sandbox } = loaded;
  const data = servedData(x, settlement);
  vm.runInContext(`state.debts = []; state.extraFacilities = undefined;`, sandbox);
  vm.runInContext(`loadKnobs({ scenario: 'expected', targetBuffer: 20, extraDebtMonthly: 0 });`, sandbox);
  sandbox.renderPlan(data, periods(), []);
  return snapshotMounts(loaded.dom);
}

test('plan: absent status and explicit unconfigured render identically', () => {
  const a = renderPlanPage(loadPlan(), fixtureInput(), null);
  const b = renderPlanPage(loadPlan(), fixtureInput(), UNCONFIGURED);
  assert.deepEqual(b, a);
});

test('plan: qualified render differs from unconfigured and shows relieved savings figures', () => {
  const plain = renderPlanPage(loadPlan(), fixtureInput(), null);
  const qualified = renderPlanPage(loadPlan(), fixtureInput(), QUALIFIED());
  assert.notDeepEqual(qualified, plain, 'qualified evidence changes the rendered plan');
  const surface = qualified['operating-surface-body'].innerHTML;
  assert.ok(surface.includes('Invented first club cost'), 'savings section names the commitment');
  // The evidence reaches the operating surface's own Forecast walk
  // (its cash figures move under qualified) even though this
  // fixture's daily-allocation amounts stay Unavailable: the fixture
  // plan carries no allocation policy and no payday snapshot, so the
  // sheet prints no per-goal needed figure in either state. The
  // relieved remaining itself is published by the page's major-plan
  // funding section, which is the settlement-dependent publication
  // this slice gates: $60.00 unrelieved, $35.00 under qualified.
  assert.notEqual(surface, plain['operating-surface-body'].innerHTML,
    'qualified evidence moves the operating surface figures');
  assert.ok(plain['major-plans-list'].innerHTML.includes('$60.00'),
    'control: unconfigured major plans publish the unrelieved cost');
  assert.ok(qualified['major-plans-list'].innerHTML.includes('Invented first club cost'),
    'major plans name the commitment');
  assert.ok(qualified['major-plans-list'].innerHTML.includes('$35.00'),
    'relieved remaining (35) is published under qualified');
  assert.ok(!plain['operating-surface-body'].innerHTML.includes('linked'),
    'control marker: unconfigured surface has no link publication');
});

test('plan: unavailable withholds every settlement-dependent mount, distinctly per reason', () => {
  const renders = REASONS.map(reason => renderPlanPage(loadPlan(), fixtureInput(), UNAVAILABLE(reason)));
  for (let i = 0; i < renders.length; i++) {
    const mounts = renders[i];
    const band = mounts['status-band'];
    assert.equal(band.planStatus, 'unavailable', 'status band carries the unavailable print hook');
    assert.ok(band.innerHTML.includes(REASONS[i]), 'status band names the reason');
    const allHtml = Object.values(mounts).map(m => m.innerHTML + m.textContent).join('\n');
    assert.ok(allHtml.includes('data-settlement-evidence="unavailable"'),
      'the settlement unavailable notice is rendered');
    assert.ok(allHtml.includes(REASONS[i]), 'the reason reaches the page');
    // The debt snapshot tiles are evidence-independent reported stocks:
    assert.ok(mounts['snapshot-tiles'].innerHTML.includes('Consumer debt'),
      'independent debt snapshot stays published');
    for (let j = i + 1; j < renders.length; j++) assert.notDeepEqual(renders[i], renders[j]);
  }
});

test('plan: withheld render does not depend on the settlement-dependent figures', () => {
  const a = renderPlanPage(loadPlan(), fixtureInput(60), UNAVAILABLE('digest-mismatch'));
  const b = renderPlanPage(loadPlan(), fixtureInput(97), UNAVAILABLE('digest-mismatch'));
  assert.deepEqual(b, a,
    'every mount is identical whatever the withheld figures would have been');
});

test('plan: no stale fallback — re-rendering unavailable after unconfigured clears dependent figures', () => {
  const loaded = loadPlan();
  const first = renderPlanPage(loaded, fixtureInput(), null);
  assert.ok(first['operating-surface-body'].innerHTML.length > 0, 'first render published');
  const second = renderPlanPage(loaded, fixtureInput(), UNAVAILABLE('pin-unavailable'));
  const allHtml = Object.values(second).map(m => m.innerHTML + m.textContent).join('\n');
  assert.ok(allHtml.includes('data-settlement-evidence="unavailable"'));
  assert.equal(second['status-band'].planStatus, 'unavailable');
  // The relieved/unrelieved savings figures from the first render must
  // not survive anywhere as stale content.
  assert.ok(!second['operating-surface-body'].innerHTML.includes('Invented first club cost'),
    'operating surface no longer publishes the savings figures');
  assert.ok(!second['savings-inventory'].innerHTML.includes('Invented first club cost'),
    'savings mount no longer publishes the inventory');
});

test('plan: malformed status fails closed', () => {
  const mounts = renderPlanPage(loadPlan(), fixtureInput(), { status: { status: 'unavailable' } });
  assert.equal(mounts['status-band'].planStatus, 'unavailable');
  const allHtml = Object.values(mounts).map(m => m.innerHTML + m.textContent).join('\n');
  assert.ok(allHtml.includes('invalid-configuration'));
});
