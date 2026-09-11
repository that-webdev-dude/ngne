# NGNE-20 plan review log

This file is append-only.

## Run configuration — 10 September 2026

- Scope: NGNE-20 typed-array SoA planning and independent plan review.
- Authorization: planning/review only; build, commit, push, Jira mutation, and publication are not authorized.
- Host/planner/coordinator: Codex.
- Reviewer: Claude.
- Proposed builder: Codex.
- Required final inspector after an authorized build: fresh Claude session.
- Mode: full.
- Plan: `plans/PLAN.md`.
- Log: `plans/PLAN-REVIEW-LOG.md`.
- Research: repository and local CE2 reference; no web or deep research.
- Maximum plan-review rounds: 5.
- Maximum build-fix rounds: 2.
- Maximum inspection rounds: 2.
- Inspection: on.
- Requested reviewer model/effort: none; use Claude CLI configuration and report observed information if available.
- Runner: `C:/Users/jfabi/.agents/skills/claudex-loop/scripts/runner.py`.
- Python: 3.13.14 at `C:/Users/jfabi/AppData/Local/Programs/Python/Python313/python.exe`.
- Claude CLI: 2.1.267 at `C:/Users/jfabi/AppData/Roaming/npm/claude.cmd`.
- Baseline revision: `a906f3a47990c0c2f7007994b1ecf8c14e9280ee` on `main`; clean before plan artifacts.

## Recon — 10 September 2026

- Live Jira: NGNE-20 is To Do; NGNE-19 and NGNE-26 blockers are Done; NGNE-20 blocks NGNE-27.
- Live Jira NGNE-27 explicitly reserves Starfall/platformer migration and final removal work for the integration ticket.
- Baseline `npm.cmd test`: 95 passed, 0 failed.
- Baseline `npm.cmd run typecheck`: passed.
- Baseline `npm.cmd run format:check`: passed.
- Current public API and all consumers use factory-created object components, object-returning sparse access, and callback iteration.
- `tsconfig.json` and Vite build include Starfall, hello, platformer, and the API fixture, so NGNE-20 needs a temporary compatibility path to remain independently deliverable.
- CE2 provides useful schema/chunk/query/reference designs but conflicts with NGNE identity and ordering: CE2 uses monotonic IDs and lexicographic archetypes; NGNE must retain generation-safe reused slots and archetype creation order.
- Settled recommendation: an isolated deprecated legacy path remains only through NGNE-27; schema entities use typed chunks and cannot mix with legacy components.

## Round 1

- First launch: failed before reviewer start; not counted as a completed round.
- Plan SHA256: `ed36cc35e4ed6596a4b3c8500a0b270e4b123fd3b91070e243cf12e230e0dfde`.
- Artifact directory: `C:/Users/jfabi/AppData/Local/Temp/claudex-np9jbmuu`.
- Cause: the runner rejected the npm `claude.cmd` shim and requires the native Claude executable on Windows.
- Disposition: retry the same plan/provider/model configuration with the verified native executable; do not weaken reviewer safety flags.
- Retry artifact directory: `C:/Users/jfabi/AppData/Local/Temp/claudex-qybwbyup`.
- Validated result: `C:/Users/jfabi/AppData/Local/Temp/claudex-qybwbyup/result.json`.
- Session: `bbc543b0-f253-40ca-be4c-58fdfbe73a03`.
- Claude CLI: 2.1.267; requested model/effort: none; observed model: CLI default unresolved.
- Provider exit code: 0. The outer runner process later exited 1 while printing Unicode `→` through the Windows console; the completed validated `result.json` was inspected directly.
- Verdict: **REVISE**.

### Reviewer response

Summary: the plan is well-scoped, correctly identifies the legacy bridge, and preserves the right identity/order/commit contracts. It needs concrete treatment of zero-argument queries, size/capacity accounting, entity-reference representation and JSON inspection, stale reference reads, conditional inspection shape, schema query safety, public facades, Random migration, lazy query refresh, tail bounds, and nominal schema types. The design direction is sound and no blocking safety issue was found.

1. **F1 — high — zero-component ambiguity.** `world.query()` currently matches every archetype and `world.spawn()` creates a real empty-composition entity. A split storage implementation could silently omit schema entities. Fix: either reject both or define an all-mode surface and test it.
2. **F2 — medium — size/capacity accounting.** `World.size`, `World.capacity`, `SceneInspection`, `Query.size`, and benchmark output depend on existing semantics. Fix: explicitly sum schema chunk counts while retaining slot-array capacity; test across a chunk boundary and assert the benchmark entity count.
3. **F3 — medium — BigInt allocation.** `BigUint64Array` entity-reference reads can materialize BigInt values in hot loops, conflicting with allocation-free iteration and the churn measurement. Fix: use paired `Uint32Array` columns or a safe numeric encoding.
4. **F4 — medium — JSON inspection.** BigInt reference inspection would break the repository's `JSON.stringify(enumerate())` determinism comparisons. Fix: inspect references as plain JSON-safe numbers/records and test stringify with an entity-reference scene.
5. **F5 — medium — exact legacy inspection shape.** Adding chunk fields to all slots conflicts with the exact legacy deep-equality assertion and current migration note. Fix: preserve legacy slot records or explicitly update the test/contract when shape changes.
6. **F6 — medium — schema query scope.** Raw chunk loops would lose the existing commit-during-iteration guard, and retained descriptors could silently read swapped rows. Fix: use a version-checked/scoped query surface, align the contract, and test stale descriptor use.
7. **F7 — medium — stale stored reference semantics.** The plan did not distinguish an invalid subject read, null reference, live target, and dead target. Fix: return `undefined` only for an invalid subject, `null` for null, and a same-world stored-generation handle for live/stale references; test all cases and decide stale-reference writes.
8. **F8 — low — public facade forwarding.** The frozen `World.access` literal must forward new read/write methods, while public query types must expose the schema traversal without exposing runtime mutation. Fix: list and test the facade explicitly in the API fixture.
9. **F9 — low — Random migration consistency.** `tests/engine.test.ts` reads `.state`, and constructor coercion would differ from strict restore validation. Fix: deliberately update the test, choose one constructor/restore policy, document it, and add a compile-time assignment rejection.
10. **F10 — low — retained query cost.** Eagerly refreshing every retained query per commit would create unbounded work. Fix: bump structural version only for archetype/chunk topology and rebuild query matches lazily.
11. **F11 — low — count versus capacity.** Full typed arrays expose stale tail cells and invite iteration to capacity. Fix: document count as the only live bound, test it, and consider clearing the vacated tail on despawn.
12. **F12 — low — nominal component separation.** If schema definitions remain assignable to legacy `Component<T>`, `get(entity, SchemaComponent)` can compile but fail at runtime. Fix: distinct branded schema types plus compile-time and runtime rejection.

Coverage reported by the reviewer:

- Read fully: plan/log, ECS/scene/primitives/index/inspection, hello, API fixture, benchmark, and package scripts.
- Read partially: initial engine/ownership tests and relevant contract/roadmap/verification sections.
- Traced public world facade, size/capacity, Random state, inspection/stringification, and all query/get/spawn consumers.
- Confirmed all proof script names exist and build checks emitted declarations.

Limitations reported by the reviewer:

- Reviewer could not run tests/typecheck/benchmarks.
- CE2 and live Jira were outside the reviewer sandbox and were not independently inspected.
- Several large tests, game/example files, and non-ECS modules were not read fully; more exact assertion conflicts may exist.
- BigInt allocation concern was based on V8 semantics rather than this repository's measurements.

### Host dispositions

- F1: accept; preserve empty spawn and define zero-argument query as a cross-mode all-entities compatibility query.
- F2: accept.
- F3: accept; use paired `Uint32Array` reference columns.
- F4: accept; use `null` or `{ index, generation }` in inspection.
- F5: accept; preserve legacy records exactly and add schema-only fields conditionally.
- F6: accept in principle with a scoped `eachChunk()` design. Descriptor/view lookup checks expire outside the callback; already-obtained raw typed arrays cannot be revoked without defeating direct typed-array access, so retention is explicitly unsupported rather than falsely claimed to be enforceable.
- F7: accept; reconstruct a frozen stored-generation handle for sparse reads, and accept stale same-world reference writes.
- F8: accept.
- F9: accept with preserved constructor coercion; `restore()` uses the same `>>> 0` normalization.
- F10: accept.
- F11: accept; clear tails and retain `count` as the only live bound.
- F12: accept.
- Revised plan: `plans/PLAN.md`; all dispositions are reflected there.
- Resume feedback: `plans/ROUND-1-FEEDBACK.md`.

## Round 2

- Input plan SHA256: `7d6f28a2529389cd42f65e5d891c0733f2a9599a9265b27c7cde61f42d6748eb`.
- Resume source: `C:/Users/jfabi/AppData/Local/Temp/claudex-qybwbyup/result.json`.
- Feedback: `plans/ROUND-1-FEEDBACK.md`.
- Artifact directory: `C:/Users/jfabi/AppData/Local/Temp/claudex-tinyfp9q`.
- Validated result: `C:/Users/jfabi/AppData/Local/Temp/claudex-tinyfp9q/result.json`.
- Session: `bbc543b0-f253-40ca-be4c-58fdfbe73a03` (same reviewer session).
- Claude CLI: 2.1.267; requested model/effort: none; observed model: CLI default unresolved.
- Provider exit code: 0. The outer runner again exited 1 only while printing Unicode `→`; the completed validated result was inspected directly.
- Verdict: **REVISE**.

### Reviewer response

Summary: all twelve Round 1 findings are genuinely resolved and none were relitigated. The scoped `eachChunk()` contract is honest about raw typed arrays and enforceable at its stated descriptor/read-scope level. Two material gaps remained: nested/throwing traversal lifecycle and lack of a supported replacement for Starfall's deferred collision-grid borrowing pattern. Five smaller gaps covered empty-chunk visitation, `entityAt()` bounds, schema-only reference overflow, zero-query overload resolution, and inspected row meaning. No high-severity defect or storage-model redesign was found.

1. **R1 — medium — scope lifecycle.** Boolean descriptor activation can break nested same/cross-query traversals, and failure to unwind in `finally` can strand the world in read mode after an authored exception. Fix: depth-counted, exception-safe scope handling and tests for same-query nesting, cross-query nesting, and throwing visitors.
2. **R2 — medium — deferred/cross-query workload.** Starfall's sanctioned collision-grid resource retains borrowed entity/position/body references and probes them inside another query. Callback-only schema borrows offered no supported efficient migration path. Fix: validate a test-only spatial-index workload in NGNE-20 and add a supported locator/within-commit primitive if necessary; otherwise explicitly revise the deferred contract/handoff.
3. **R3 — low — empty chunks.** Retained empty chunks had no defined visitor behavior. Fix: skip them and test exact invocation count.
4. **R4 — low — `entityAt()` bounds.** Invalid row behavior was unspecified and could leak null into APIs typed as `Entity`. Fix: throw clearly for negative, non-integer, or `row >= count`.
5. **R5 — low — reference overflow scope.** New uint32 ceilings must not add failure paths to legacy-only worlds. Fix: reject only when lowering/writing schema entity references and test it.
6. **R6 — low — zero-query overload.** Both variadic overloads accept an empty tuple, so declaration order could infer the schema surface and break `world.query().each`. Fix: a dedicated leading zero-argument overload plus API type assertions.
7. **R7 — low — inspected row meaning.** Legacy rows are archetype-relative while schema rows are chunk-relative. Fix: document the distinction, always include chunk for live schema slots, and test equal row values across chunks are distinguishable.

Coverage reported by the reviewer:

- Re-read the full revised plan and checked all F1-F12 dispositions; all were addressed.
- Re-examined ECS/scene query, commit, slot, inspection, and failure paths.
- Traced Starfall's collision grid and platformer query consumers plus the contract clause sanctioning borrowed references.
- Confirmed current consumers do not nest query traversals, so nesting is a new schema correctness concern rather than an existing regression.
- Rechecked relevant contract, ownership, engine, benchmark, and API fixture lines.

Limitations reported by the reviewer:

- Reviewer could not execute tests/typecheck/benchmarks.
- CE2 and live Jira remained outside the reviewer sandbox.
- The feedback file was supplied through the resume request rather than read from the untracked worktree.
- Large unrelated tests/modules/docs were not re-read fully; R2 was based on the real Starfall grid path and owning contract.

### Host dispositions

- R1: accept the correctness issue. Use depth-counted `try/finally` read scopes. Callback-only token expiry is superseded by the R2 solution: descriptors are valid for a world commit epoch, so nested traversals share the same epoch without expiring outer access.
- R2: accept. Column/row borrows are supported until the next commit/disposal, and NGNE-20 gains a test-only cross-query spatial-index fixture mirroring Starfall's build/probe/clear/rebuild pattern.
- R3: accept; skip empty chunks.
- R4: accept.
- R5: accept; overflow checks exist only at schema entity-reference lowering/write boundaries.
- R6: accept; use a dedicated leading overload.
- R7: accept; document and test schema chunk-relative rows.
- Revised plan: `plans/PLAN.md`; all dispositions are reflected there.
- Resume feedback: `plans/ROUND-2-FEEDBACK.md`.

## Round 3

- Input plan SHA256: `88ab810d25e820606ce33d8a74ab6582ab8aa77760dc11f642dfe329b24710b9`.
- Resume source: `C:/Users/jfabi/AppData/Local/Temp/claudex-tinyfp9q/result.json`.
- Feedback: `plans/ROUND-2-FEEDBACK.md`.
- Artifact directory: `C:/Users/jfabi/AppData/Local/Temp/claudex-nluw0t3p`.
- Validated result: `C:/Users/jfabi/AppData/Local/Temp/claudex-nluw0t3p/result.json`.
- Session: `bbc543b0-f253-40ca-be4c-58fdfbe73a03` (same reviewer session).
- Claude CLI: 2.1.267; requested model/effort: none; observed model: CLI default unresolved.
- Provider exit code: 0. The outer runner again exited 1 only while printing Unicode `→`; the completed validated result was inspected directly.
- Verdict: **REVISE**.

### Reviewer response

Summary: all seven Round 2 findings are resolved. The commit-epoch model is the right minimal capability and is sound because all NGNE structural mutation is buffered to commit, so `(descriptor,row)` remains stable within an epoch. Three issues remained: resource inspection of expired/large borrowed views, whether the spatial fixture tests probe cost rather than compilation only, and wording that prohibited the same raw-column hoist used by the supported example. None requires abandoning the epoch model.

1. **S1 — high — resource inspection.** Starfall's collision grid is a scene resource; generic inspection runs after tick/commit and walks enumerable getters/properties. An expired descriptor getter could throw, while a typed array could expand into hundreds of indexed fields, breaking bounded deterministic inspection. Fix: make runtime borrowed descriptors/views inspection-inert and test a resource-held schema spatial index through post-commit `Game.enumerate()`/`JSON.stringify()`.
2. **S2 — medium — spatial probe cost.** A fixture that merely compiles may hide expensive guarded property access in Starfall's innermost collision loop. Fix: record the borrow shape, add a deterministic probe microbenchmark, and decide in NGNE-20 whether to hoist columns or revise the primitive.
3. **S3 — medium — temporal raw-column rule.** The plan's example hoists raw columns while later wording prohibited retaining them. The actual invariant is temporal: raw columns are valid for the same commit epoch and invalid afterward, though runtime expiry is enforceable only for descriptors/views. Fix: state that rule and allow `{ columns, row }` index entries.

Coverage reported by the reviewer:

- Re-read the full plan and confirmed all R1-R7 dispositions were resolved.
- Verified the commit-epoch invariant against all ECS structural mutation and scene commit sites, including suspended-scene behavior.
- Traced scene resource inspection and every relevant deterministic stringify consumer.
- Traced the real Starfall collision-grid resource/build/probe path.

Limitations reported by the reviewer:

- Reviewer could not execute tests/typecheck/benchmarks.
- CE2 and live Jira remained outside the reviewer sandbox.
- S2 is a reasoned cost concern rather than a measurement, hence the requested fixture benchmark.
- Large unrelated tests/modules/docs were not re-read fully.

### Host dispositions

- S1: accept. Runtime borrowed descriptors, component views, and typed fields use non-enumerable properties and inspect as opaque empty records. The spatial fixture is a scene resource and must enumerate/stringify safely after the commit expires its borrows without expanding columns.
- S2: accept. Add equivalent deterministic legacy/schema collision-grid probe measurements to the existing benchmark. A regression is material only if schema exceeds legacy by both 20% and 0.1 ms median in both consecutive runs; crossing it requires primitive revision inside NGNE-20.
- S3: accept. Component views/raw columns are supported within the same commit epoch; only post-commit/disposal use violates borrowing, with enforcement limited to descriptor acquisition/count/entityAt.
- Revised plan: `plans/PLAN.md`; all dispositions are reflected there.
- Resume feedback: `plans/ROUND-3-FEEDBACK.md`.

## Round 4

- Input plan SHA256: `804b3e2192b35a6420ca38fcd213f611900050737e3d061955f67e7c1b0fe8a9`.
- Resume source: `C:/Users/jfabi/AppData/Local/Temp/claudex-nluw0t3p/result.json`.
- Feedback: `plans/ROUND-3-FEEDBACK.md`.
- First attempt artifact: `C:/Users/jfabi/AppData/Local/Temp/claudex-vtzgfnq3`.
- First attempt status: interrupted before the runner produced a validated result; `result.json` remained `running`, no reviewer session/result was recorded, and no native reviewer process remained. Not counted as a completed round.
- Restart artifact: `C:/Users/jfabi/AppData/Local/Temp/claudex-qd0ryf92`.
- Restart validated result: `C:/Users/jfabi/AppData/Local/Temp/claudex-qd0ryf92/result.json`.
- Session: `bbc543b0-f253-40ca-be4c-58fdfbe73a03` (same reviewer session).
- Claude CLI: 2.1.267; requested model/effort: none; observed model: CLI default unresolved.
- Provider exit code: 0. The outer runner again exited 1 only while printing Unicode `→`; the completed validated result was inspected directly.
- Verdict: **REVISE**.

### Reviewer response

Summary: S1-S3 are resolved and the non-enumerable inspection mechanism, temporal borrow wording, and commit-epoch design are sound. Five remaining issues concern the evidence apparatus and wording, not storage design: the 0.1 ms benchmark floor can hide large relative probe regressions, the synthetic fixture cannot prove real Starfall parity, the new fixture must run after the NGNE-26-comparable sections, raw columns in authored resources bypass opaque views, and the exact epoch-guarded accessors were not named.

1. **T1 — medium — benchmark discrimination.** Fixture counts were unspecified and a 0.1 ms absolute floor can exceed the real collision probe's entire cost, allowing a multiple regression to pass. Fix: pin workload counts, report nanoseconds per candidate check, and tie measurement validity to timer resolution rather than total elapsed milliseconds.
2. **T2 — medium — synthetic versus Starfall claim.** The plan called the fixture non-Starfall evidence while asking it to prove NGNE-27 migration cost. Fix: limit it to expressibility/inherent synthetic overhead and retain real-game measurement as NGNE-27 residual risk.
3. **T3 — medium — harness ordering.** Adding a third workload before existing measurements can change JIT/heap state and undermine NGNE-26 comparability. Fix: run it last and document the additional final section.
4. **T4 — low — raw columns in resources.** An authored plain resource entry containing `position.x` bypasses the non-enumerable component-view container and expands typed-array indices during inspection. Fix: permit opaque component views in inspected resources, prohibit raw columns there, and test the boundary.
5. **T5 — low — guarded lookup detail.** The plan named guarded `count`/`entityAt()` but not `chunk.views` and `views.position`. Fix: guard both lookup stages once per chunk, leaving only already-hoisted component views/raw arrays unenforced.

Coverage reported by the reviewer:

- Re-read the full plan and confirmed S1-S3 and all earlier findings remained resolved.
- Verified non-enumerable behavior against `inspectValue`/`JSON.stringify` and the stability of fixed chunk views within an epoch.
- Anchored benchmark concerns against NGNE-26 distributions, the real Starfall grid/probe shape, and current benchmark section ordering.

Limitations reported by the reviewer:

- Reviewer could not execute tests/typecheck/benchmarks.
- The Starfall-sized probe cost is inferred, hence the need for normalized measured evidence.
- CE2/live Jira remained outside reviewer reach and large unrelated surfaces were not reread.

### Host dispositions

- T1: accept. Pin 260 cells, 256 targets, 512 probes, 64 batches/sample, 100 warmups, and 300 samples/arm; report candidate checks and ns/check. Require median samples at least 100 times measured timer resolution, then use a repeatable >20% ns/check threshold with no fixed 0.1 ms floor.
- T2: accept. The fixture proves only equivalent synthetic expressibility/overhead; NGNE-27 retains real Starfall/NGNE-26 measurement risk.
- T3: accept; run the fixture after ECS and Chaos and document the changed final section.
- T4: accept; inspected resources may hold opaque component views, not detached raw columns. Add positive and negative inspection cases.
- T5: accept; guard descriptor `views` and per-component lookup, while an already-hoisted component view/array remains the explicit unenforced epoch borrow.
- Revised plan: `plans/PLAN.md`; all dispositions are reflected there.
- Resume feedback: `plans/ROUND-4-FEEDBACK.md`.

## Round 5

- Input plan SHA256: `c9d049b924df4892d544b0d7e65a9586a6875fc595a8092c6310e8fd837a1529`.
- Resume source: `C:/Users/jfabi/AppData/Local/Temp/claudex-qd0ryf92/result.json`.
- Feedback: `plans/ROUND-4-FEEDBACK.md`.
- Artifact directory: `C:/Users/jfabi/AppData/Local/Temp/claudex-edbvczed`.
- Validated approval: `C:/Users/jfabi/AppData/Local/Temp/claudex-edbvczed/result.json`.
- Session: `bbc543b0-f253-40ca-be4c-58fdfbe73a03` (same reviewer session).
- Claude CLI: 2.1.267.
- Requested model/effort: none.
- Observed model: `claude-opus-5`.
- Provider/runner exit code: 0.
- Usage reported by provider: 21,332 cache-creation input tokens, 587,065 cache-read input tokens, 7,025 output tokens including 3,826 thinking tokens; reported cost USD 0.6825075.
- Verdict: **APPROVED**.

### Reviewer response

Summary: no material unresolved defect remains. All 27 findings from the four prior rounds (F1-F12, R1-R7, S1-S3, T1-T5) are addressed. The reviewer independently verified the Round 4 changes: fixed fixture counts and normalized measurement; synthetic/real-Starfall claim separation; fixture-last ordering; positive/negative resource-inspection boundaries; and the exact epoch-guarded lookup set. It reconfirmed that non-enumerable accessors keep expired views and typed columns out of `inspectValue`, and that commit-only structural mutation makes `(chunk,row)` stable within an epoch. It also checked that incrementing the compatibility string has no literal dependents. Approval covers the plan, not implementation.

Findings: none.

Coverage reported by the reviewer:

- Re-read the full plan at `c9d049b9...` and verified all 27 prior findings were addressed without new evidence to reopen them.
- Verified guarded non-enumerable accessors remain inspection-inert and that `JSON.stringify` follows the same enumerable-own-property boundary.
- Reconfirmed buffered birth/death and commit-only row movement, fixed non-resizing chunks, and commit-epoch stability.
- Sanity-checked the fixed fixture magnitude against the real 3x3 Starfall probe and NGNE-26 environment; the plan self-invalidates if timer resolution is insufficient.
- Verified the new benchmark executes after the existing ECS and Chaos sections.
- Traced the compatibility-string increment and confirmed no test/doc/example hardcodes `NGNE/1`; existing determinism checks compare equally versioned instances.
- Carried forward traced coverage of the WorldAccess facade, sizes/capacities, Random state, inspection/stringify consumers, zero-argument query, and Starfall resource-held collision grid.

Limitations reported by the reviewer:

- Reviewer did not run tests, typecheck, build, or benchmark; approval is for the plan only.
- Three plan stop conditions remain evidence-dependent: expressible/bounded spatial fixture, valid repeated ns/check result below the 20% threshold, and an isolated legacy bridge.
- The fixture magnitude estimate assumes a roughly uniform 3x3 scan; if implemented differently, the timer-resolution gate must decide validity.
- CE2 remained outside the reviewer working directory and was not inspected by Claude; Codex inspected it during recon.
- Live Jira was unavailable to Claude; Codex verified NGNE-20/26/27 live during recon.
- Feedback files are untracked; the reviewer received their content through resume requests.
- Several large unrelated modules/tests/docs were not read in full; full-suite execution and complete changed-file inspection remain the implementation controls.

### Approval boundary

- Approved plan path: `plans/PLAN.md`.
- Approved SHA256: `c9d049b924df4892d544b0d7e65a9586a6875fc595a8092c6310e8fd837a1529`.
- Completed plan-review rounds: 5 of 5. The interrupted/failed launch attempts did not count.
- Build authorization remains absent. Do not implement, commit, push, change Jira, or publish without a new explicit request.

## Final approval check — 10 September 2026

- Runner result: `Approval matches the current plan.`
- Current approved plan SHA256: `c9d049b924df4892d544b0d7e65a9586a6875fc595a8092c6310e8fd837a1529`.
- `npm.cmd run format:check`: passed.
- `git diff --check`: passed.
- Worktree changes: untracked planning artifacts under `plans/` only.
- Status: planning complete; awaiting explicit implementation authorization.

## Implementation inspection — 11 September 2026

- Builder/coordinator: Codex; fresh inspector: Claude.
- Base revision: `a906f3a47990c0c2f7007994b1ecf8c14e9280ee`.
- Plan SHA256: `c9d049b924df4892d544b0d7e65a9586a6875fc595a8092c6310e8fd837a1529`.
- Extra inspection artifact: `C:/Users/jfabi/AppData/Local/Temp/claudex-cq6tlwdj/result.json`.
- Session: `34d9bef4-6ad2-41a1-b605-d2e87ef1c703`; Claude CLI 2.1.267; observed models `claude-opus-5` and `claude-haiku-4-5-20251001`.
- Verdict: **REVISE**.

### Host dispositions

- Q1: accepted. Legacy, all-entity, and schema query runtimes now keep world, match,
  descriptor, version, type, and epoch state in true private fields; the focused test
  verifies opaque query objects and no reflected world escape.
- B1: accepted. The schema collision-grid build now buckets through
  `position.x[row]`, matching the legacy arm's value read. Two corrected samples remain
  valid and below the 1.20 stop threshold at median ratios 1.114 and 1.110.
- E1: accepted but externally blocked. The production preview ran, but browser discovery
  returned no connected browser. The roadmap now marks NGNE-20 pending validation and
  verification retains the visible-browser proof as an explicit open limit.
- R1: accepted. Reference reads only reuse a cached handle with the encoded generation,
  and authored current-generation references to a free slot are rejected.
- A1: accepted. `WorldAccess` exposes bound non-enumerable own methods on a frozen
  instance and frozen prototype; retained methods preserve their former call behavior.
- L1: accepted. Duplicate and conflicting-identity registration remains schema-only;
  legacy queries retain exact-identity and repeated-argument behavior.
- D1: accepted. `entityRef()` takes no default argument and always defaults to `null`.
- U1: accepted. Explicit `undefined` schema values use the declared default.
- T1: accepted. Tests now cover cloned/frozen descriptors, legacy allocation after a
  rejected overflow, retained component lookup expiry, separated positive/negative
  inspection resources, query opacity, facade binding, and the reference/default edges.

### Local proof after fixes

- `npm.cmd test`: 108 passed, 0 failed.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run build`: passed, including declarations and all production bundles.
- `npm.cmd run format:check`: passed.
- `git diff --check`: passed.
- Fresh final Claude inspection: pending.

### Final fresh inspection

- This section supersedes the pending marker above.
- Artifact: `C:/Users/jfabi/AppData/Local/Temp/claudex-6rz5h7zc/result.json`.
- Snapshot SHA256: `2875a5b7ecd3ca2c90afa280f3fb2c506b2cfd68d7a7f833c52e4805dc9e15b9`.
- Session: `3e0189ee-d1de-4fb6-b1d5-fb65a67ca3e4`; Claude CLI 2.1.267;
  observed models `claude-opus-5` and `claude-haiku-4-5-20251001`.
- Verdict: **REVISE**.
- Material finding V1: the visible-browser hello proof remains open because no connected
  browser was available. The roadmap and verification record it as pending; completion
  requires a connected visible browser or an explicit owner waiver.
- Low finding D2: accepted and fixed after inspection. Schema construction normalizes
  validated descriptor defaults and rejects every non-null entity-reference default;
  focused forged-descriptor tests were added.
- Low finding R3: accepted and fixed after inspection. The roadmap again lists the
  implemented legacy object-component ECS while the schema path remains pending browser
  validation.
- Post-fix local proof: 108 tests passed; typecheck, production build, format check, and
  `git diff --check` passed. The two low fixes were not independently reinspected because
  the configured inspection budget is exhausted.
