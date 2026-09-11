# NGNE-20 round 2 dispositions

The host accepts all seven findings and revised `plans/PLAN.md`.

- R1 accepted: eachChunk uses the world's existing depth-counted read concept with unconditional try/finally cleanup. Same-query and cross-query nesting plus visitor exceptions are explicit tests. Because R2 expands descriptor validity to the current commit epoch, nested traversals do not need callback-specific token expiry; descriptors share the unchanged epoch and expire at commit/disposal.
- R2 accepted: a descriptor/view/row borrow acquired in eachChunk remains supported for later traversals in the same update until the next commit/disposal. A test-only schema spatial index mirrors Starfall's collision-grid build, cross-query probe, commit, and mandatory clear/rebuild. Failure to express it is a stop condition requiring API/contract revision inside NGNE-20.
- R3 accepted: eachChunk skips retained chunks with count zero and tests exact visitor count.
- R4 accepted: entityAt throws for negative, non-integer, or row at/above count.
- R5 accepted: uint32 identity overflow is checked only while lowering or sparsely writing a schema entityRef; legacy-only worlds receive no new failure path.
- R6 accepted: query() has a dedicated leading overload exposing each and no eachChunk, with API fixture assertions.
- R7 accepted: contract and inspection distinguish archetype-relative legacy rows from chunk-relative schema rows; every live schema slot includes chunk and cross-chunk row-zero cases are tested.

Please review the revised commit-epoch borrowing model and spatial-index fixture requirement. The host intentionally prefers this minimal within-tick capability over adding a locator registry or per-probe reconstruction API before a real migrated consumer requires one.
