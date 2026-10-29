# Local proof runbook: running the test suite on a builder box

Status: operational note for builders running `test/test.js` locally. It is not
an authority file, a merge gate, or a change to CI. Hosted CI remains the
authoritative check run; nothing here changes what counts as a PASS.

Source basis (issue #765, Assignment 7, all on original target
`4bd44712d4969306f4d6d1e6e02ac12734ec9987`, synthetic fixtures, one local
environment):

- Grok receipt — comment 6503741413
- Grok B92 supplement — comment 6504251213
- Atlas disposition (accepted as a bounded completed diagnosis) — comment 6504294051

This note states only what those three sources establish. Where they disagree,
the Atlas disposition governs.

## 1. Use the real Node binary, not the box wrapper

On the builder box where Assignment 7 ran, `/usr/local/bin/node` is a shell
wrapper that re-sets the trust variable before starting Node:

```sh
: "${NODE_USE_SYSTEM_CA:=1}"; export NODE_USE_SYSTEM_CA; exec /usr/local/lib/nodejs/node "$@"
```

So `env -u NODE_USE_SYSTEM_CA node …` through that wrapper does not remove the
variable. For local proof runs, invoke the real binary directly:

```sh
/usr/local/lib/nodejs/node test/test.js --group standard
```

Check your own box first (`command -v node`, then read the file if it is a
script). The paths above are the ones observed on that one box; another
environment may differ.

## 2. Unset the ambient trust variables before a local proof run

The settlement Postgres connection owner refuses ambient trust variables by
design (`settlement-postgres-connection: environment failed`). That refusal is
correct behaviour, not a defect, and no code repair is indicated. Before a
local proof run, remove all three:

```sh
env -u NODE_EXTRA_CA_CERTS -u SSL_CERT_FILE -u NODE_USE_SYSTEM_CA \
  /usr/local/lib/nodejs/node test/test.js --group standard
```

What Assignment 7 observed when this was not done (wrapper binary, variable
re-set), as failed-test counts per suite:

| Suite | Wrapper: failed tests | Real binary, trust variables unset |
|---|---|---|
| `test-settlement-evidence-authorization-connection.js` | 65 | 0 failed |
| `test-settlement-evidence-postgres-connection.js` | 41 | 0 failed |
| `test-settlement-evidence-postgres-runtime.js` | 47 | 0 failed |
| `test-restore-settlement-evidence.js` | 22 | 0 failed |
| `test-settlement-production-host.js` | 11 | 0 failed |

These are the corrected counts (65/41/47/22/11). Earlier cross-mark totals
reported in the receipt are not failed-test counts and are not adopted.
Running the real binary with `NODE_USE_SYSTEM_CA=1` explicitly restored
reproduced the 41 failures in `test-settlement-evidence-postgres-connection.js`,
which is the connection owner's designed refusal.

## 3. Use per-group caps, not one serial cap

`test/test.js` takes `--group standard|refresh-isolation|all`. Run the two
groups separately, each with its own wall-clock cap, instead of wrapping the
whole serial aggregate in one cap.

- The earlier local serial aggregate was run under one 1500-second cap and
  ended `timeout` exit 124 at that cap, during B92. The full local serial
  aggregate was not observed completing.
- The successful standalone B92 run and the hosted durations below support
  insufficient budget as the explanation for that timeout. No complete local
  aggregate runtime and no universal minimum were measured.
- Local `refresh-isolation` (B92) completed in 1150 seconds, exit 0, on the
  real binary with the trust variables unset: B92 printed `ALL CHECKS PASSED`
  and the runner printed `ALL 1 SUITES PASSED`. One local run.
- Hosted CI on the same commit took about 34 minutes for `standard` and about
  24 minutes for `refresh-isolation`. These are **hosted** durations. They are
  not a measured local minimum, and adding hosted `standard` to local B92 is not
  a measured local aggregate runtime.

Pick each cap with headroom over the observed duration for that group, and
record the cap you used.

```sh
CAP_SECONDS=1800  # choose and record your own cap with headroom
env -u NODE_EXTRA_CA_CERTS -u SSL_CERT_FILE -u NODE_USE_SYSTEM_CA \
  timeout "$CAP_SECONDS" /usr/local/lib/nodejs/node test/test.js --group refresh-isolation
echo "EXIT=$?"
```

Expected FAIL lines inside B92's mutated-fact cases (cash, card, payrollBill,
commitment) are B92's documented blast radius. They do not override B92's
terminal verdict; read the final `ALL CHECKS PASSED` / runner line and the exit
code.

## 4. What is still not proven

- The full serial local aggregate remains **INCOMPLETE** (`timeout` exit 124).
  It is not a PASS, and nothing in this note makes it one.
- The B92 run above completed without hanging. That does not retrospectively
  prove every earlier execution was stall-free.
- Evidence covers synthetic fixtures, one local environment, and the original
  target only. It gives no later-main qualification, no blanket defect-free
  claim, and no acceptance-row movement or activation.
- Hosted runner internals and physical Safari were not tested.

## 5. Recording a local proof run

When you report a local run, state: the commit SHA, the binary path, that the
three trust variables were unset, the group, the cap, the exit code, the
elapsed seconds, and the final runner line. Report only runs you executed.
