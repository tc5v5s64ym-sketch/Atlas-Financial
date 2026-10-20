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
        // The Plan page's wiring reaches external mounts through
        // mount.ownerDocument (the #budget-attention-bottom move and
        // its remount teardown); the fake document is the registry
        // below, resolved lazily so element creation order is free.
        get ownerDocument() { return document; },
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
        removeAttribute(k) { delete this.attrs[k]; },
        addEventListener() {}, removeEventListener() {},
        dispatchEvent(evt) { (this.events ||= []).push(evt && evt.type); return true; },
        appendChild(c) { this.children.push(c); return c; },
        append(...kids) { this.children.push(...kids); },
        contains(node) { return node != null && this.children.includes(node); },
        // Move/clear semantics for the one externally moved card:
        // adopting an attention slice node removes its HTML from
        // the origin element (a move, not a copy); calling with no
        // nodes clears the mount, as budgetRemount's teardown does.
        replaceChildren(...nodes) {
          for (const node of nodes) {
            if (node && node._attentionSlice && node._origin) {
              node._origin.innerHTML = node._origin.innerHTML.replace(node._attentionSlice, '');
            }
          }
          this.children = nodes.slice();
          this.innerHTML = nodes.map(n => (n && n._attentionSlice) || '').join('');
        },
        querySelector(sel) {
          // The attention card is produced as HTML inside the
          // operating mount; model finding it as a node whose HTML
          // slice can then be moved by replaceChildren above.
          if (sel === '[data-budget-browse="attention"]') {
            const marker = this.innerHTML.indexOf('data-budget-browse="attention"');
            if (marker < 0) return null;
            const start = this.innerHTML.lastIndexOf('<section', marker);
            const close = this.innerHTML.indexOf('</section>', marker);
            if (start < 0 || close < 0) return null;
            const slice = this.innerHTML.slice(start, close + '</section>'.length);
            return {
              _attentionSlice: slice, _origin: this,
              contains: () => false,
              getAttribute: () => null,
              querySelector: () => null, querySelectorAll: () => [],
            };
          }
          return element(id + '>q');
        },
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
    activeElement: null,
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
    // budgetRemount dispatches a real Event on the operating mount.
    Event,
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

/* ------------------------- Systems Review repair round (B1–B3) */
/* Added for the consolidated BLOCKING review of head bf3eb47b
 * (PR #661, comment 6296256340). Each test was first run against
 * that head's production files and failed for the stated reason. */

// B3: the validators must enforce the effective projection's
// structural contract (planned-obligation-settlement-contract.js
// effectiveEvidence): contract-shaped identities, positive safe
// integer cents, real calendar dates, sha256 digests, array
// reversals of contract-shaped records, one entry per goal, unique
// operation identities. Anything Forecast's settlement index would
// silently skip or misread must fail closed at the surface.
test('packet: malformed effective evidence fails closed, contract-shaped evidence stays qualified (B3)', () => {
  const malformed = {
    'link is null': ev => { ev.commitments[0].links = [null]; },
    'link assignedCents is a string': ev => { ev.commitments[0].links[0].assignedCents = '2500'; },
    'link assignedCents is zero': ev => { ev.commitments[0].links[0].assignedCents = 0; },
    'link assignedCents is negative': ev => { ev.commitments[0].links[0].assignedCents = -100; },
    'link assignedCents is fractional': ev => { ev.commitments[0].links[0].assignedCents = 2500.5; },
    'link operationId is not the contract format': ev => { ev.commitments[0].links[0].operationId = 'operation-1'; },
    'link txRef is not the contract format': ev => { ev.commitments[0].links[0].txRef = 'tx-1'; },
    'link evidenceDigest is not a sha256 hex': ev => { ev.commitments[0].links[0].evidenceDigest = 'abc'; },
    'link effectiveDate is not a real date': ev => { ev.commitments[0].links[0].effectiveDate = '2026-13-40'; },
    'link asOf is not a real date': ev => { ev.commitments[0].links[0].asOf = 'yesterday'; },
    'entry goalId has an empty commitment id': ev => { ev.commitments[0].goalId = 'commitment:'; },
    'entry goalId is not a commitment goal': ev => { ev.commitments[0].goalId = 'group:near'; },
    'entry goalId id is not an identifier': ev => { ev.commitments[0].goalId = 'commitment:Near'; },
    'entry links is empty': ev => { ev.commitments[0].links = []; },
    'duplicate goal entry': ev => {
      ev.commitments.push({ goalId: 'commitment:near', links: [{ ...ev.commitments[0].links[0], operationId: op(7) }] });
    },
    'duplicate operation identity across goals': ev => {
      ev.commitments.push({ goalId: 'commitment:far', links: [{ ...ev.commitments[0].links[0] }] });
    },
    'reversals is not an array': ev => { ev.commitments[0].links[0].reversals = {}; },
    'reversal entry is null': ev => { ev.commitments[0].links[0].reversals = [null]; },
    'reversal cents is not positive': ev => {
      ev.commitments[0].links[0].reversals = [{ operationId: op(8), counterTxRef: tx(8), cents: -1, date: '2026-10-04' }];
    },
  };
  for (const [name, mutate] of Object.entries(malformed)) {
    const evidence = linkEvidence();
    mutate(evidence);
    const packet = buildFor(fixtureInput(), { status: { status: 'qualified' }, evidence });
    assert.deepEqual(packet.metadata.settlementEvidence,
      { status: 'unavailable', reason: 'invalid-configuration' }, `fails closed: ${name}`);
    assert.equal(packet.forecast.status, 'unavailable', `forecast withheld: ${name}`);
    assert.equal(packet.forecast.reason, 'invalid-configuration', `reason named: ${name}`);
  }
  // Controls: contract-shaped variations stay qualified.
  const empty = buildFor(fixtureInput(), { status: { status: 'qualified' }, evidence: { commitments: [] } });
  assert.deepEqual(empty.metadata.settlementEvidence, { status: 'qualified', reason: null },
    'a qualified store with no active links is valid evidence');
  const nearEmpty = (empty.forecast.majorPlanFunding.items || []).find(i => i.id === 'near');
  assert.equal(nearEmpty.need, 60, 'no links, no relief — full cost under a qualified label');
  const withReversal = linkEvidence();
  withReversal.commitments[0].links[0].reversals = [
    { operationId: op(2), counterTxRef: tx(2), cents: 500, date: '2026-10-04' },
  ];
  const reversed = buildFor(fixtureInput(), { status: { status: 'qualified' }, evidence: withReversal });
  assert.deepEqual(reversed.metadata.settlementEvidence, { status: 'qualified', reason: null },
    'a contract-shaped reversal record stays qualified (Forecast judges it uncertain)');
  const nearReversed = (reversed.forecast.majorPlanFunding.items || []).find(i => i.id === 'near');
  assert.equal(nearReversed.need, null, 'Forecast withholds the reversed row itself');
  const split = linkEvidence();
  split.commitments.push({
    goalId: 'commitment:far',
    links: [{ ...split.commitments[0].links[0], operationId: op(3), assignedCents: 500 }],
  });
  const splitPacket = buildFor(fixtureInput(), { status: { status: 'qualified' }, evidence: split });
  assert.deepEqual(splitPacket.metadata.settlementEvidence, { status: 'qualified', reason: null },
    'one payment split across two goals (shared txRef, distinct operations) is contract-shaped');
});

// B3 (continued): an explicit null served status is a published
// outcome that is malformed — distinct from an omitted status,
// which is the unconfigured seam. Null must fail closed, never
// read as "never configured".
test('packet: explicit null status fails closed and is not omitted status (B3)', () => {
  const omitted = buildFor(fixtureInput(), null);
  assert.equal(omitted.metadata.settlementEvidence, undefined, 'omitted status stays unconfigured');
  const explicitNull = buildFor(fixtureInput(), { status: null });
  assert.deepEqual(explicitNull.metadata.settlementEvidence,
    { status: 'unavailable', reason: 'invalid-configuration' },
    'explicit null status is malformed, not unconfigured');
  assert.equal(explicitNull.forecast.status, 'unavailable');
  const nullWithEvidence = buildFor(fixtureInput(), { status: null, evidence: linkEvidence() });
  assert.deepEqual(nullWithEvidence.metadata.settlementEvidence,
    { status: 'unavailable', reason: 'invalid-configuration' },
    'null status with evidence also fails closed');
});

test('planning + plan: malformed effective evidence fails closed at the page surfaces (B3)', () => {
  const badEvidence = () => {
    const ev = linkEvidence();
    ev.commitments[0].links = [null];
    return { status: { status: 'qualified' }, evidence: ev };
  };
  const { sandbox, dom } = loadPlanning();
  sandbox.renderPlanning(servedData(fixtureInput(), badEvidence()), periods());
  const road = dom.element('planning-road-ahead').innerHTML;
  assert.match(road, /data-settlement-evidence="unavailable"/, 'planning withholds on malformed evidence');
  assert.ok(road.includes('invalid-configuration'), 'planning names invalid-configuration');
  const mounts = renderPlanPage(loadPlan(), fixtureInput(), badEvidence());
  assert.equal(mounts['status-band'].planStatus, 'unavailable', 'plan withholds on malformed evidence');
  const allHtml = Object.values(mounts).map(m => m.innerHTML + m.textContent).join('\n');
  assert.ok(allHtml.includes('invalid-configuration'), 'plan names invalid-configuration');
  const nullMounts = renderPlanPage(loadPlan(), fixtureInput(), { status: null });
  assert.equal(nullMounts['status-band'].planStatus, 'unavailable',
    'explicit null status fails closed on the plan page too');
});

// B1: the Month trajectory and funding-schedule caches must follow
// the settlement outcome on the SAME page instance. Other inputs —
// including an explicit weekly override — are held constant; the
// expected figures are the fresh Forecast output for each outcome.
test('plan: month caches follow the settlement outcome on the same page instance (B1)', () => {
  const x = fixtureInput();
  const renderMonth = (loaded, settlement) => {
    const { sandbox } = loaded;
    vm.runInContext(`state.debts = []; state.extraFacilities = undefined;`, sandbox);
    vm.runInContext(`loadKnobs({ scenario: 'expected', targetBuffer: 20, extraDebtMonthly: 0 });`, sandbox);
    vm.runInContext(`state.weeklyVariable = 300; budgetGranularity = 'month'; budgetSelectedMonth = '2026-10';`, sandbox);
    sandbox.renderPlan(servedData(x, settlement), periods(), []);
    return snapshotMounts(loaded.dom)['operating-surface-body'].innerHTML;
  };
  const UNRELIEVED = '−$1,205.43'; // October result with no relief
  const RELIEVED = '−$1,180.43';   // October result with the $25.00 link relief
  const freshQualified = renderMonth(loadPlan(), QUALIFIED());
  assert.ok(freshQualified.includes(RELIEVED), 'oracle: fresh qualified month render is relieved');
  // unconfigured -> qualified on one instance
  const pg = loadPlan();
  assert.ok(renderMonth(pg, null).includes(UNRELIEVED), 'prime: unconfigured month render');
  const bSame = renderMonth(pg, QUALIFIED());
  assert.ok(bSame.includes(RELIEVED) && !bSame.includes(UNRELIEVED),
    'same-instance qualified render must not reuse the unconfigured trajectory');
  assert.equal(bSame, freshQualified, 'same-instance qualified render matches fresh Forecast output');
  // qualified -> unconfigured on the same instance
  const back = renderMonth(pg, null);
  assert.ok(back.includes(UNRELIEVED) && !back.includes(RELIEVED),
    'same-instance unconfigured render must not reuse the qualified trajectory');
  // withheld -> qualified (prime, withhold, then qualify)
  const pg2 = loadPlan();
  renderMonth(pg2, null);
  renderMonth(pg2, UNAVAILABLE('pin-unavailable'));
  const afterWithheld = renderMonth(pg2, QUALIFIED());
  assert.ok(afterWithheld.includes(RELIEVED),
    'qualified render after a withheld render uses the qualified trajectory');
  // qualified A -> qualified B with different relief, same instance
  const evA = { status: { status: 'qualified' }, evidence: linkEvidence(1000) };
  const freshA = renderMonth(loadPlan(), evA);
  const pg3 = loadPlan();
  renderMonth(pg3, evA);
  const bAfterA = renderMonth(pg3, QUALIFIED());
  assert.equal(bAfterA, freshQualified, 'qualified B after qualified A matches fresh B output');
  assert.notEqual(bAfterA, freshA, 'qualified B differs from qualified A');
});

// B2: the wired attention card is moved OUT of the operating mount
// into #budget-attention-bottom by the normal render. The
// unavailable transition must tear that external mount down too,
// or its Forecast figures survive under an unavailable page. The
// budget-surface fixture produces a nonempty card; the harness
// models the move with real state (see makeFakeDom).
test('plan: unavailable transition tears down the moved attention card (B2)', () => {
  const bsFixture = require('./fixtures/budget-surface-data');
  const loaded = loadPlan();
  const { sandbox, dom } = loaded;
  const render = data => {
    vm.runInContext(`state.debts = []; state.extraFacilities = undefined;`, sandbox);
    vm.runInContext(`loadKnobs({ scenario: 'expected', targetBuffer: 20, extraDebtMonthly: 0 });`, sandbox);
    sandbox.renderPlan(data, periods(), []);
    return snapshotMounts(dom);
  };
  const first = render(bsFixture.served());
  const bottom = first['budget-attention-bottom'];
  assert.ok(bottom && bottom.innerHTML.includes('Worth a look'),
    'the nonempty attention card was moved into the external mount');
  assert.ok(bottom.innerHTML.includes('budget-attention-item')
    && bottom.innerHTML.includes('to confirm'),
    'the moved card carries its dependent bill/category actions');
  assert.ok(!first['operating-surface-body'].innerHTML.includes('data-budget-browse="attention"'),
    'the card no longer lives inside the operating mount (it was moved, not copied)');
  const second = render({
    ...bsFixture.served(),
    settlementEvidenceStatus: { status: 'unavailable', reason: 'pin-unavailable' },
  });
  assert.equal(second['status-band'].planStatus, 'unavailable');
  const bottomAfter = second['budget-attention-bottom'];
  assert.ok(!bottomAfter || bottomAfter.innerHTML === '',
    'the external attention mount is empty after the unavailable transition');
  assert.ok(!bottomAfter || !bottomAfter.innerHTML.includes('Worth a look'),
    'no stale attention card survives the unavailable transition');
});
