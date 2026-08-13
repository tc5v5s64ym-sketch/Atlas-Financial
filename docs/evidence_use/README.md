# Evidence-Use Register

**Owner of:** whether an *explicitly identified* supplied evidence item has been
routed to an incumbent authority or deliberately parked.

**Not the owner of:** financial values, trust labels, engine results, household
policy, or whether a routed figure is correct.

The live register is [`register.json`](register.json).

## CONSUMED is routing, not correctness

A `CONSUMED` row means: this evidence item has been pointed at a named
incumbent that exists.

It does **not** mean the incumbent’s figure is financially correct, current,
independently verified, or correctly labelled. Pointer existence is not a
green financial proof. Correctness stays with the incumbent, independent
evidence, and the normal figure / review gates.

## Coverage is explicit IDs only

CI proves disposition coverage for IDs declared in `evidence-ids` fences. It
does not read Markdown and decide what is material.

To govern a new item, add its ID to an `evidence-ids` fence in a committed
source file (a fenced block whose info string is exactly `evidence-ids`, one
ID per line) and add a register row. A missing row fails `npm test`.

IDs match `^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-[0-9]{3}$`.
Do not put example IDs inside a real `evidence-ids` fence; CI would treat them
as governed.

This folder is an index over existing authorities. It is not a sixth
architectural layer, a fact store, or a second roadmap.
