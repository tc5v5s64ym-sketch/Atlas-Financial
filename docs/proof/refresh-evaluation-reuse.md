# Reuse identical Forecast input within one refresh

A qualified fresh live read evaluates the source observation and overlay, then
repeats both with projected source inputs before retaining evidence. Each overlay
attaches refresh-trust, which obtains the operating answer from Forecast. On main
`6b4a07ea8450045bfd138da00e9cfee3686e73c2`, identical inputs therefore invoke
`Forecast.recommend` twice before the worker returns.

The live consumer is `Live.applyForServer`. It now creates one operating-answer
evaluation shared only by those two overlays. The evaluation retains at most one
successful advice result and a detached snapshot of every Forecast argument:
plan, effective date and options, including freshly loaded periods, actuals,
observed cash, debts, funding, target buffer and operating-plan qualification.
An exact match returns a detached copy. Changed or uncloneable input, a changed
Forecast implementation, input mutation, an exception or an uncloneable result
falls back to a normal evaluation. No entry is attached to served data or retained
across reads. The helper remains only while the duplicate replay overlay needs it.

Forecast still decides all figures. Both observations and overlays still execute;
qualification and complete replay-result equality still govern evidence retention.
The ordinary operating-answer projector and MCP packet builder remain uncached.
MCP's differing option set is not assumed equivalent. There is no new provider
read, financial write, source-evidence store, completed-response cache or timeout
change. `server-live-refresh.js`, the engine and held PR #620 are untouched.

## Proof

`node --test test/test-refresh-evaluation-reuse.js`

The invented provider fixture drives the real observer, overlay, refresh-trust
and Forecast. The fresh-read regression reaches qualified retained evidence and
observes twice, then requires exactly one Forecast call. Against unchanged main
it fails on **2 versus 1**, independently of the new helper's existence.
Set `ATLAS_TEST_APP_ROOT` to an isolated unchanged source tree to reproduce it.

Controls compare the complete served data and source-check objects against an
uncached evaluation, including zero, negative and failed observations. They cover
unequal replay evidence, changed date/plan/actuals/cash/debt/funding/extra/buffer/
trust/periods, detached results, mutable inputs, unsupported cloning, exceptions,
one-entry replacement, ordinary consumers and concurrent/later independent reads.
Explicit adversarial controls distinguish null from NaN despite identical JSON
text, isolate advice.simOptions references from caller mutation, and require the
separate MCP packet to perform its own Forecast evaluation.
The synthetic Bills stock stays the provider's invented1215; reuse supplies no
new arithmetic or financial authority.

`node test/profile-refresh-evaluation.js`

This optional benchmark runs four cold processes in uncached/cached/cached/
uncached order. It asserts identical complete-output hashes and two/one Forecast
invocations; it reports elapsed times without a timing assertion. It uses only
the invented fixture and blocks HTTP requests. Times vary with machine/runtime;
they establish local compute savings, not deployed or phone load latency.

On Node24.18.0, the first committed-benchmark run measured uncached mean530.81ms
and reused mean354.88ms (33.1% lower). All four complete-output hashes matched.
These measurements are illustrative; invocation counts and complete output
equivalence, rather than a wall-clock threshold, are the regression contract.

Independent local profiling before this repair found Forecast consumed roughly
96% of the synthetic-acquisition worker computation on an approved recorded plan.
Removing its duplicate call reduced cold mean6.42s to3.33s in that diagnostic.
Those protected inputs are not committed or used as test specifications. Live
provider wait and the additional MCP packet computation remain separate costs.
