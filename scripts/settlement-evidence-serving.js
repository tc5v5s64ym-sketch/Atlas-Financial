'use strict';

// Settlement evidence serving bridge (ATLAS-080) — the default-inactive
// server read seam between the persisted settlement evidence store and
// the served data the household surfaces already consume.
//
// The merged publication-gating surfaces (assistant packet, Plan,
// Planning) read a tri-state outcome carried ALONGSIDE the evidence on
// the served object: `settlementEvidenceStatus` plus, only when
// qualified, `settlementEvidence` holding the loader's effective
// evidence projection. This module is the composition point that
// produces those fields: it runs the unchanged settlement evidence
// loader (scripts/settlement-evidence-loader.js) over a
// dependency-injected reader set and projects the loader's normalized
// outcome onto a copy of the served object.
//
// Default-inactive: constructed with no dependency, the serving is
// inactive — `attach` resolves to the served object itself, untouched
// (no fields added, no reads performed), so production output stays
// byte-identical to the pre-seam behaviour until a separately approved
// wiring supplies a real reader dependency. The dependency is fixed at
// construction time (server composition); nothing about a request —
// URL, headers, browser input, or canonical data fields — can select
// readers or supply evidence, and `attach` takes only the served
// object.
//
// `attach` is async because the loader's acquisitions are: a reader
// may return a Promise (the production adapters' read methods do), and
// the loader awaits it. Before any acquisition, the active attach
// snapshots the top-level served object and strips the seam-owned
// settlement fields, so the projection is computed from the input as
// it stood at attach time — a caller's later edit cannot move it, and
// no inherited settlement field can survive acquisition. The snapshot
// is top-level only: nested canonical structures stay shared by
// reference, as they do in the served composition itself, and the seam
// never writes into them.
//
// Fail-closed: a supplied-but-partial or malformed dependency is a
// configured state, never absence. Every classification is delegated
// to the loader (partial configuration, pin/document failures and
// divergence all carry its stable reasons); the projection for any
// non-qualified outcome carries the status and NO evidence, and both
// settlement fields are always owned outright by this projection —
// values already present on the served object are replaced, never
// inherited. The served object is never mutated, and no outcome is
// cached: every `attach` performs a fresh loader acquisition, so
// qualified evidence is never carried across requests or failures.
//
// The bridge performs no writes of any kind: no bootstrap, reconcile,
// quarantine, promotion or provider call exists on this path — the
// loader's read callbacks are the only store contact, and the served
// output contains only the normalized {status, reason} and, when
// qualified, the loader's effective evidence projection — never the
// raw document, its history, household identity beyond what the
// projection itself carries, credentials, reader configuration, or
// raw read errors.

const { loadSettlementEvidence } = require('./settlement-evidence-loader');

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

const invalidConfiguration = () => ({ status: 'unavailable', reason: 'invalid-configuration' });

// Snapshot the top-level served object with both settlement fields
// stripped: the seam owns them, so nothing a previous stage (or a
// hostile canonical field) placed there can survive into the output
// under a new status. Top-level only — nested canonical structures
// stay shared by reference.
function stripServed(served) {
  const source = served && typeof served === 'object' ? served : {};
  const { settlementEvidenceStatus: _priorStatus, settlementEvidence: _priorEvidence, ...rest } = source;
  return rest;
}

// Project one loader outcome onto a stripped served snapshot.
function projectOnto(rest, outcome) {
  if (outcome && outcome.status === 'qualified' && outcome.evidence !== undefined) {
    return {
      ...rest,
      settlementEvidenceStatus: { status: 'qualified' },
      settlementEvidence: outcome.evidence,
    };
  }
  if (outcome && outcome.status === 'unavailable'
    && typeof outcome.reason === 'string' && outcome.reason.length > 0) {
    return {
      ...rest,
      settlementEvidenceStatus: { status: 'unavailable', reason: outcome.reason },
    };
  }
  if (outcome && outcome.status === 'unconfigured') {
    return { ...rest, settlementEvidenceStatus: { status: 'unconfigured' } };
  }
  // Any outcome shape outside the loader's contract fails closed.
  return { ...rest, settlementEvidenceStatus: invalidConfiguration() };
}

function project(served, outcome) {
  return projectOnto(stripServed(served), outcome);
}

function createSettlementEvidenceServing(dependency) {
  // No dependency: the production default. Inactive — attach resolves
  // to the served object itself, so served output is byte-identical
  // and no reader exists to invoke.
  if (dependency === undefined || dependency === null) {
    return Object.freeze({ active: false, attach: async served => served });
  }
  // A supplied dependency that is not a plain record is malformed
  // configuration: fail closed on every serve, never as unconfigured.
  if (!isRecord(dependency)) {
    return Object.freeze({
      active: true,
      attach: async served => project(served, invalidConfiguration()),
    });
  }
  let householdId; let readDocument; let readPin; let pin;
  try {
    ({ householdId, readDocument, readPin, pin } = dependency);
  } catch {
    return Object.freeze({
      active: true,
      attach: async served => project(served, invalidConfiguration()),
    });
  }
  // A record carrying none of the load-bearing pieces is partial
  // configuration, not deliberate absence (the loader would read a
  // wholly empty input as unconfigured; an explicitly supplied empty
  // dependency must not inherit that reading).
  const empty = householdId === undefined && readDocument === undefined
    && readPin === undefined && pin === undefined;
  return Object.freeze({
    active: true,
    async attach(served) {
      // Snapshot and strip BEFORE acquisition: the loader's reads
      // suspend, and the projection must be computed from the served
      // object as it stood at attach time.
      const rest = stripServed(served);
      if (empty) return projectOnto(rest, invalidConfiguration());
      let outcome;
      try {
        outcome = await loadSettlementEvidence({
          config: pin !== undefined ? { householdId, pin } : { householdId },
          readDocument,
          readPin,
        });
      } catch {
        // The loader is total over its inputs; this guard exists so a
        // defect in an injected reader's shape can never break serving
        // itself — the seam withholds instead.
        outcome = invalidConfiguration();
      }
      return projectOnto(rest, outcome);
    },
  });
}

module.exports = { createSettlementEvidenceServing };
