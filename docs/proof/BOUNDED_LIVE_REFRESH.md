# Bounded live refresh availability

Source: parent-authorized availability repair after the UI/UX audit and independent
read-only reproduction on main b69dfa4f5929b2ad628ec592101475bd554c4cc6.

Current-main provider transport already has an eight-second socket inactivity
timeout. It has no overall refresh deadline. A provider sending bytes periodically
can keep /data.json pending beyond that timeout, and disconnecting the browser
does not cancel the provider work. The browser shared boot waits before rendering
and previously had no timeout/error transition for a request that stayed pending.

## One outcome

Authenticated server live refreshes have a fixed 15-second technical budget,
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

The shared browser boot has a 20-second load budget, shows loading/error state,
and offers Retry. HTTP unavailable responses never enter financial rendering.
Session credentials and 401 login redirection are preserved. No live-data cache,
cross-user data sharing, last-good approval, canonical mutation or provider write
is introduced. Forecast remains the sole financial calculation authority.

## Independent verification

Synthetic IPv4 loopback tests cover idle timeout, periodic response bytes,
cumulative sequential reads, pre-cancelled/active cancellation, closed provider
sockets, bounded synchronous work, responsive health, browser disconnect, unchanged
session/assistant auth and whole qualified normal-flow payload conservation.
Controlled browser tests prove no data/render hooks on pending, timed-out or HTTP
unavailable responses, then successful retry with the original financial date.
Canonical bytes are checked unchanged. Existing production-overlay and shared
consumer suites supplement these controls.

Local phase profiling before the repair measured 6-12 ms for synthetic provider
reads, roughly 2.1-2.3 seconds for the live overlay, and another roughly 2.3 seconds
for packet construction. These are workload-specific local results, not deployed
latency guarantees. The separate approximately 100-second authenticated live
packet reads included substantial time after overlay completion. Packet-building
and browser Forecast calculation remain existing synchronous operations outside
the refresh worker. This PR does not claim to fix that broader performance issue.

Full-suite validation and independent exact-head Systems Review remain merge
requirements; a focused test run is not a substitute for either.
