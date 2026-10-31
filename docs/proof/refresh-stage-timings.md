# Refresh stage timing

The existing `live-refresh-lifecycle` log retains its schema. A companion
`live-refresh-stages` record is emitted once when that same job's worker exits
(or a worker constructor fails). It diagnoses latency; it does not reduce it.

The exact permitted fields are `type`, `source`, `outcome`, `qualified`,
`workerComplete`, `providerAcquireMs`, `normalizeMs`, `overlayMs`, `forecastMs`,
`sourceReplayMs`, and `publicationMs`. Source is `provider` or `memory`; outcome
uses the existing closed lifecycle outcomes. Qualification is boolean when a
worker verdict arrived, otherwise null. No financial input, provider response,
identifier, key, credential, exception or error text enters this record.

- `providerAcquireMs`: credential resolution and the existing provider GET
  acquisition, including transport wait. Null for retained-evidence replay.
- `normalizeMs`: observer evaluation, including normalization, identity loading
  and reconciliation. Fresh qualified acquisition evaluates the original and
  projected source, so this sums both existing observer calls.
- `overlayMs`: overlay and trust projection, including fallback, **inclusive of
  Forecast**. It sums existing overlay calls, not additional evaluations.
- `forecastMs`: actual `Forecast.recommend` calls made by the operating-answer
  projector. An existing exact-input evaluation hit does not call Forecast or
  add a second Forecast measurement. Other Forecast helpers inside observer or
  overlay remain in those enclosing stages.
- `sourceReplayMs`: source projection; on fresh qualification it also includes
  the incumbent re-observation, replay overlay and complete-output equality
  check. These nested stages overlap the observer/overlay/Forecast fields.
- `publicationMs`: main-thread result handling, including context/qualification
  checks, retained-evidence publication and waiter cloning/settlement. It does
  not include HTTP response serialization or worker-to-parent transfer time.

Durations use monotonic `performance.now()`, are finite and nonnegative, and
sum repeated completed stage spans. **Do not add nested fields together.** The
existing lifecycle startup/run/cleanup timings also include work outside these
measured spans. Null means no completed span was received, not zero latency.

Timing context is local to one worker execution through AsyncLocalStorage. Its
progress messages contain only fixed boolean/numeric/null fields; the parent
rejects malformed/extra-field snapshots and never copies a worker object into
logs. Snapshot sink failures are ignored. Cancellation and termination retain
only completed received spans, with `workerComplete: false` when the worker
did not finish. Completion and provider qualification remain separate facts.
No timer, admission rule, cancellation signal, retention condition, cache key,
financial input or returned payload is changed.

`node test/test-refresh-stage-timing.js` exercises the real worker and localhost
provider with invented inputs. It verifies exact schema, invalid durations,
privacy canaries, unchanged complete data/receipt controls, actual Forecast and
observer call counts, retained replay, provider failure, worker error/exit,
cancellation and timeout. No live provider, private file or provider write is
needed. The existing lifecycle and refresh suites remain separate regression
checks; focused tests do not stand in for the full CI suite.
