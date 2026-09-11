# NGNE-20 round 3 dispositions

The host accepts S1-S3 and revised `plans/PLAN.md`.

- S1 accepted: descriptor accessors and component/entity-reference view data properties are non-enumerable. Generic resource inspection neither invokes expired getters nor expands typed arrays. The spatial fixture is held as a scene resource and must enumerate/stringify after commit with bounded opaque borrow records; derived borrows do not satisfy inspection requirements for authoritative resource state.
- S2 accepted: tests/benchmark.ts gains equivalent deterministic legacy-object and schema component-view/row probe workloads with fixed counts, 100 warmups and 300 samples. In both consecutive runs, schema exceeding legacy by both 20% and 0.1 ms median is material and requires an NGNE-20 primitive/contract revision.
- S3 accepted: raw component views and columns share the descriptor's commit-epoch lifetime. Hoisting and storing them for later same-epoch probes is supported; use after commit/disposal is prohibited but cannot be runtime-revoked without proxies/detachment. The plan now states this temporal rule consistently.

Please review the non-enumerable inspection design, temporal borrow wording, and benchmark decision rule. The host continues to reject a locator registry or per-probe wrapper until the measured schema fixture shows the direct component-view/row shape is inadequate.
