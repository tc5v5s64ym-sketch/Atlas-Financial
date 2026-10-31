# Bounded live refresh availability

Source: parent-authorized availability repair after the UI/UX audit, followed by
a bounded compatibility proposal using observed successful100–118second reads
before #528 and repeated16–20second deadline failures afterward. These observations
do not independently establish a hosting-plan claim or the deployed timeout phase.

Provider transport retains its eight-second socket inactivity timeout. Before
#528 it had no overall refresh deadline; periodic bytes could keep a request
pending and disconnect did not cancel work. #528 supplied a 15 second worker cap
and 20 second browser cap, but those bounds can reject previously observed normal
workloads. This proposal preserves the bounded lifecycle with longer finite caps.

## One outcome

Authenticated server live refreshes have a fixed 150 second technical budget,
including provider reads, observation and synchronous overlay projection. The
existing LivePlan/Forecast operation runs in a per-request Node worker so the
parent can enforce that elapsed-time budget even during synchronous work. Expiry
or client disconnect terminates the worker and its sockets. Provider transport
also accepts and propagates cancellation through all sequential GETs and pages.
Normal successful and qualified provider-failure payloads retain the incumbent
semantics. The deadline itself returns an unavailable HTTP response without a
stale financial payload. This changes availability, not household policy.
At most two refresh workers run concurrently; excess requests are unavailable.
This bounds resources without sharing or caching another request's financial data.

The shared browser boot has a 180 second load budget, explains the possible wait,
and offers Cancel while pending and Retry after cancellation/failure. Duplicate
retry clicks cannot start simultaneous loads. A response arriving after abort
cannot run financial hooks. HTTP unavailable responses never enter rendering.
Session credentials and 401 login redirection are preserved. No live-data cache,
cross-user data sharing, last-good approval, canonical mutation or provider write
is introduced. Forecast remains the sole financial calculation authority.

## Independent verification

Synthetic IPv4 loopback tests cover idle timeout, periodic response bytes,
cumulative sequential reads, pre-cancelled/active cancellation, closed provider
sockets, bounded synchronous work, responsive health, browser disconnect, unchanged
session/assistant auth and whole qualified normal-flow payload conservation.
Controlled browser tests prove no data/render hooks on pending, timed-out,
cancelled, late-after-cancel or HTTP unavailable responses, then successful retry
with the original financial date. Virtual elapsed time verifies that 118 seconds
can remain pending and then succeed within the 180 second client budget.
Canonical bytes are checked unchanged. Existing production-overlay and shared
consumer suites supplement these controls.

The production 150 second cap is asserted and cannot be raised by callers. Existing
shorter caller budgets keep failure/abort/cleanup proofs bounded; the synthetic
HTTP harness uses a 1500ms caller budget rather than spending150seconds proving a
trickle timeout. Manual finite sequential provider responses near the historical
duration compare the old 15 second caller budget with the candidate cap and conserve
the complete qualified payload. Each response stays inside the 8 second idle limit.

Local phase profiling before the original repair measured6–12ms for synthetic provider
reads, roughly 2.1-2.3 seconds for the live overlay, and another roughly 2.3 seconds
for packet construction. These are workload-specific local results, not deployed
latency guarantees. The separate approximately 100-second authenticated live
packet reads included substantial time after overlay completion. Packet-building
and browser Forecast calculation remain existing synchronous operations outside
the refresh worker. The 150 second server cap covers refresh/overlay, not a new
end-to-end packet deadline. The 180 second browser cap applies to data boot, including
optional period/history reads; browser pages do not await the assistant packet.
Longer caps permit more waiting, not faster work. Host wake-up is a separate phase
before the Atlas shell can run. This proposal changes no hosting resources or
configuration and does not claim to fix wake-up, CPU cost or the deployed root cause.

Full-suite validation and independent exact-head Systems Review remain merge
requirements; a focused test run is not a substitute for either.
