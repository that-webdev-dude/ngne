# NGNE-20 round 4 dispositions

The host accepts T1-T5 and revised `plans/PLAN.md`.

- T1 accepted: the fixed synthetic workload uses 260 cells, 256 indexed targets, 512 probes and 64 build/probe batches per sample, with 100 warmups and 300 samples per arm. JSON reports timer resolution, counts, candidate checks and ns/check. Results are valid only when median samples exceed 100 timer-resolution quanta; a schema regression over 20% ns/check in both runs is material.
- T2 accepted: the fixture proves expressibility, bounded inspection and equivalent synthetic overhead only. NGNE-27 must measure the real migrated Starfall collision loop against NGNE-26; the handoff names this residual risk.
- T3 accepted: the new fixture runs last after the unchanged ECS and Chaos sections, and verification records that the harness gained a third final section.
- T4 accepted: inspected scene resources may retain opaque non-enumerable component view objects plus rows, but not detached raw field arrays. Positive bounded-view and negative raw-column inspection tests define the boundary.
- T5 accepted: descriptor count/entityAt/views and each per-component lookup are epoch-guarded. Once acquired, the component view's direct non-enumerable typed-array properties are deliberately unguarded and valid only for that epoch.

Please review the final revised plan. This is Round 5, the configured maximum: approve only if no material defect remains; otherwise return the unresolved evidence without manufacturing convergence.
