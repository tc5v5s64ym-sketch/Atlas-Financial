# Bounded card-minimum date validation

## Scope and authority

Forecast remains the sole financial authority. This repair memoizes only the boolean result of its private CardMinimumContract strict date validator. The original regex, finite Date.parse check and ISO round-trip predicate remain unchanged on misses. Statement identity, purchase/backfill/minimum intent, issuer satisfaction, cash inclusion, liability calculations, dates and publication semantics are unchanged.

The Map holds at most256 keys, each a string of length10, with FIFO eviction. Non-strings retain immediate false without coercion. Invalid dates retain false; Map.has distinguishes a cached false from a miss. Oversize input cannot grow the cache. This is a pure validation cache; it holds no financial packet, provider observation, statement, amount or plan.

## Independent proof

`node test/test-card-minimum-date-cache.js` tests the private validator in a VM without changing production exports. An independent Gregorian calendar oracle covers year0000/0001/0099, century leap boundaries, invalid months and days. Additional controls cover hostile objects and proxies, symbols, bigint, boxed strings, inherited-property names, true and false hits, FIFO eviction and revalidation, oversize values and the256-entry bound. The same controls run in UTC, America/Los_Angeles and Pacific/Kiritimati.

`node test/proof-card-date-cache-latency.js <private-output.json>` is a manual bounded synthetic diagnostic, not a CI latency threshold. It starts isolated local servers with safe environment allowlists, synthetic credentials, a synthetic account map and the existing synthetic provider fixture at2026-10-07. The baseline-only preload removes memoization in memory while retaining the exact incumbent predicate. Both worker and parent load that baseline for the comparison. No production file is rewritten.

The diagnostic compares complete original/candidate data and assistant packet SHA256 hashes, excluding only fields named generatedAt. It verifies that both fast responses are200, the data overlay applies, and canonical bytes remain unchanged. All server children and provider connections are closed in finally blocks. Only hashes, status codes, phase names and durations are retained; no raw financial payload is written.

The finite-fetch comparison gives each of seven provider responses a finite1800ms delay. This retains the actual15000ms worker cap and8000ms socket inactivity limit. Phase markers establish whether fetching finishes before the worker terminates in ordinary Forecast work. Timings and success/failure are reported as measurements, because machine speed and scheduling affect them. Successful delayed candidate output must match its complete fast payload hash.

## What the evidence can establish

The main3109cd8 diagnostic demonstrated a timeout after provider fetching completed, during normal Forecast recommendation. Private memoization approximately halved normal local refresh and packet work, with conserved payloads. This supports the narrow optimization; it does not identify the exact deployed timeout phase or guarantee deployed reads will complete within15seconds.

The deadline covers startup, credentials, all provider requests, observation and overlay/RefreshTrust calculations. Assistant packet construction occurs afterward on the parent thread. This repair changes none of those lifecycle boundaries, the concurrency limit, network/credential configuration, financial fallback behavior or cache freshness semantics.

No full local suite is duplicated for this narrow repair. Focused financial/authority controls, privacy protection and the published-head CI remain the validation path. Atlas Contract / Systems Review is required before parent-owned merge because Forecast runtime changed. Existing presentation-only #531 is preserved.
