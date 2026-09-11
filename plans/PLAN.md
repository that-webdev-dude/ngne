# NGNE-20 typed-array SoA implementation plan

## Status and authorization

- Plan artifact: `plans/PLAN.md`; append-only review log: `plans/PLAN-REVIEW-LOG.md`.
- Scope: plan NGNE-20 and obtain independent plan approval.
- Build authorization: not granted. Stop after the approved plan and present it for implementation approval.
- Coordinator and proposed builder: Codex.
- Independent plan reviewer and eventual inspector: Claude, with inspection in a fresh session.
- Baseline revision: `a906f3a47990c0c2f7007994b1ecf8c14e9280ee` on `main`; the worktree was clean before these planning artifacts were added.

## Goal

Introduce schema-defined typed-array structure-of-arrays component storage and allocation-free bulk query iteration without weakening NGNE's scene ownership, generation-safe entity identity, buffered lifetime, deterministic iteration, interpolation, or inspection contracts.

NGNE-20 proves the new authoring path through `examples/hello`, API fixtures, focused tests, and the ECS benchmark. Starfall and the platformer remain on a deliberately isolated legacy object-component bridge until NGNE-27 migrates the real games and removes that bridge.

## Observable acceptance criteria

- Schema component numeric fields are stored in their declared typed-array columns and typed queries expose those columns through one callback per chunk, without per-row objects or callbacks.
- `f32`, `f64`, `i32`, `u32`, `u8`, boolean, and same-world entity-reference fields have explicit defaults, validation, physical representations, and TypeScript inference.
- Complete composition, buffered spawn/despawn, immediate value writes, world-scoped slot/generation handles, stale/foreign-handle safety, empty-archetype retention, free-stack reuse, and deterministic creation/row ordering remain covered.
- `World.size` counts all live legacy and schema rows, `World.capacity` remains the slot-array length, and every query's `size` counts its live matches across chunks.
- Chunk-capacity boundaries, retained empty chunks, row swaps, later-created archetypes, lazy query refresh, nested/throwing traversal, commit-epoch borrowing, and invalidation have focused regression coverage.
- `examples/hello`, `tests/api-misuse.ts`, emitted declarations, and the ECS microbenchmark use the supported schema API. Starfall and the platformer continue compiling and behaving through the legacy bridge without source migration.
- Equal seeds and inputs produce identical completed-commit inspections under the same typed representation. Expected `f32` rounding is tested explicitly; interpolation-critical hello positions use `f64`.
- `Random.state` is no longer writable. `snapshot()` returns the current uint32 state and `restore()` normalizes input exactly like the existing constructor; scene inspection uses `snapshot()`.
- The owning contract, decision record, guide/README examples, roadmap status, and dated verification evidence agree with the implementation and clearly identify the temporary NGNE-27 bridge.
- All required automated, benchmark, declaration, and browser checks pass, with environmental limits and any changed exact numeric expectations recorded.

## Assumptions ledger

| Assumption                                                                                                                                       | Evidence                                                                                                                                                       | Treatment                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| NGNE-20 is unblocked and NGNE-27 owns Starfall/platformer migration.                                                                             | Live Jira NGNE-20/NGNE-27; both NGNE-19 and NGNE-26 are Done.                                                                                                  | Keep real-game source unchanged here and make compatibility removal an explicit NGNE-27 handoff.                                                  |
| Current ECS behavior is a public contract, not an implementation detail.                                                                         | `src/ecs.ts`; `docs/contracts/NGNE.md` ECS and ownership sections; `tests/engine.test.ts`, `tests/ownership.test.ts`, and `tests/simulation.contract.test.ts`. | Preserve ownership, visibility, identity, and order unless this plan explicitly changes the authoring API.                                        |
| The repository must remain buildable before NGNE-27.                                                                                             | `tsconfig.json` includes `demo`, `examples`, and API misuse; Vite bundles Starfall, hello, and platformer.                                                     | Retain an isolated legacy path instead of excluding consumers or partially migrating the games.                                                   |
| CE2 is design evidence, not code to transplant wholesale.                                                                                        | `C:/Users/jfabi/Documents/Projects/ce2/src/ecs/storage.ts` and `docs/contracts/ECS-STORAGE.md`.                                                                | Reuse schema/chunk/query concepts; retain NGNE slot generations, free stack, archetype creation order, `WorldAccess`, and scene commit authority. |
| The NGNE-26 ECS harness is directly comparable after migrating its ECS half; the unchanged game/browser workloads are controls, not SoA results. | `docs/verification.md#ngne-26--9-september-2026`; `tests/benchmark.ts`; `tests/browser-baseline.ts`.                                                           | Report typed ECS results separately from legacy-game control runs and defer full migrated-game conclusions to NGNE-12/27.                         |
| No new runtime dependency is necessary.                                                                                                          | Current engine and CE2 reference use platform typed arrays and local TypeScript.                                                                               | Keep zero runtime dependencies.                                                                                                                   |

## Decisions

### Migration boundary

- Overload `component(name, schema)` for the new supported path and retain `component(name, factory)` as a deprecated legacy definition until NGNE-27.
- A spawn and a query may contain only schema components or only legacy components. Reject mixed-mode composition/query definitions with a clear authored-boundary error. No current consumer mixes the modes, and forbidding it avoids a dual-layout archetype.
- Preserve `spawn()` with no values as the shared empty legacy archetype. Preserve `query()` as an all-entities compatibility query whose `each(entity)` traversal spans empty, legacy, and schema archetypes in NGNE creation/chunk/row order; its `size` counts all live entities. It exposes no component values or schema chunk views. Test both cases explicitly.
- Give `query()` an explicit zero-argument overload declared before the legacy and schema variadic overloads. Its return type exposes `each(entity)` and not `eachChunk()`; lock that distinction in `tests/api-misuse.ts`.
- Keep legacy storage behavior and `Query.each()`/object-returning `get()` isolated. Do not optimize, expand, or document it as the preferred path.
- NGNE-27 must migrate Starfall/platformer and then delete the factory overload, legacy object columns, `each()`, and legacy `get()` surface. If implementation reveals that the bridge cannot remain isolated, stop and revise this plan rather than silently migrating the games.

### Schema and public API

The target authoring shape is:

```ts
const Position = component("position", {
    x: f64(40),
    previousX: f64(40),
});
const Velocity = component("velocity", { x: f32(0), y: f32(0) });

const movers = scene.world.query(Position, Velocity);
movers.eachChunk((chunk) => {
    const position = chunk.views.position;
    const velocity = chunk.views.velocity;
    for (let row = 0; row < chunk.count; row++) {
        position.previousX[row] = position.x[row];
        position.x[row] += velocity.x[row] * dt;
    }
});
```

- Preserve `.of(partial)` and `world.spawn(...componentValues)` so spawn call sites retain complete-composition semantics and authored data can be validated/lowered before commit.
- The factory overload retains the existing nominal `Component<T>` legacy type. The schema overload returns a distinct branded `SchemaComponent<Name, Fields>` that is not assignable to `Component<T>`; schema values and queries likewise have distinct types. TypeScript rejects `get(entity, SchemaComponent)`, while runtime checks defend JavaScript/unchecked callers.
- Schema component and field names are literal types. Component definitions and cloned field descriptors are immutable.
- Expose field-level `world.read(entity, component, field)` and `world.write(entity, component, field, value)` for sparse access. Schema components do not use object-returning `get()`.
- `read()` returns `undefined` when its subject entity is stale, pending, foreign, or lacks the requested schema component/field. `write()` is a no-op for those invalid subject states, matching current benign handle behavior; unknown fields, wrong value kinds, and foreign entity-reference values throw at the authored boundary.
- An entity-reference field read returns `null` for its null encoding, a frozen same-world `{ index, generation, owner }` handle for a stored live or stale reference, or `undefined` only when the subject read is invalid. Reconstructing a non-current/stale reference may allocate; `world.has()` determines whether the returned handle is live. Entity-reference writes accept same-world live, pending, or stale handles and reject foreign handles.
- Schema queries expose `eachChunk(visit)`. Nonempty chunks expose `count`, allocation-only `capacity`, `entityAt(row)`, and component field views. `count` is the only valid live-row bound; retained empty chunks are skipped. `entityAt()` returns the world's canonical current handle without per-call allocation and throws a clear boundary error unless `row` is an integer in `[0, count)`.
- Add `read`, `write`, and schema-query forwarding to the frozen `World.access` facade, and keep `commit`, enumeration, query membership mutation, and runtime constructors absent from public access.
- Query views intentionally expose writable typed arrays. Direct numeric writes follow JavaScript typed-array coercion; trusted hot loops own range correctness. Spawn and sparse `write()` validate logical values before lowering.

### Field representations

| Logical kind     | Physical column                               | Authored/sparse value                                                    |
| ---------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| `f32`            | `Float32Array`                                | finite number, rounded by storage                                        |
| `f64`            | `Float64Array`                                | finite number                                                            |
| `i32`            | `Int32Array`                                  | integer in signed 32-bit range                                           |
| `u32`            | `Uint32Array`                                 | integer in unsigned 32-bit range                                         |
| `u8`             | `Uint8Array`                                  | integer from 0 through 255                                               |
| boolean          | `Uint8Array`                                  | boolean; physical 0/1                                                    |
| entity reference | paired `Uint32Array` index/generation columns | same-world `Entity` or `null`; index stores `index + 1`, with 0 for null |

- Use the field helpers `f32`, `f64`, `i32`, `u32`, `u8`, `bool`, and `entityRef`.
- No strings, arbitrary objects, arrays, DOM/GPU values, variable-width blobs, custom codecs, field plugins, or additional numeric widths in NGNE-20. Store stable numeric IDs in `u32`/`u8` fields and keep lookup data in scene resources.
- Entity-reference query fields expose one immutable per-chunk view object containing `index: Uint32Array` and `generation: Uint32Array`; reads stay on number paths without per-row BigInt allocation. Reject `index + 1` or generation above `0xffffffff` only when lowering/writing a schema `entityRef`; legacy-only allocation, despawn, and commit gain no new overflow failure. Hot views expose local representation only and do not confer foreign-world ownership.

### Storage and ordering

- Retain NGNE's slot array, generation counter, free stack, frozen handle shape, definition identity checks, pending births/deaths, and scene-owned `commit()` call.
- Extend slot locations to `(archetype, chunk, row)`. Use fixed-capacity 512-row chunks with one typed array per schema field and a dense handle array beside them.
- Retain empty archetypes and allocated chunks until world disposal. Reuse the lowest-created chunk with capacity; do not add trimming, defragmentation, migration, or public pooling.
- Swap-remove within the affected chunk, repair the moved slot, and retain chunk creation order. Do not move rows between chunks merely to fill holes.
- After swap removal, clear the vacated typed-array tail cells and handle entry to zero/null. Rows in `[count, capacity)` are never live or supported iteration input regardless of their cleared contents.
- Preserve NGNE iteration order: archetype creation order, then chunk creation order, then dense row order. Do not adopt CE2's lexicographic archetype ordering.
- Validate and lower schema spawn values when `spawn()` is called so caller-owned partial objects are not retained. Structural publication remains buffered and FIFO-equivalent to current birth/death semantics.
- `World.size` sums live rows across both storage modes; `World.capacity` remains `slots.length`. Legacy, schema, and zero-argument query sizes sum their current matching rows, including all schema chunks. The benchmark asserts its schema world contains exactly `ECS_ENTITIES` before timing/reporting.

### Query borrowing and invalidation

- A schema query records the world's structural version. The version changes only when a schema/legacy archetype or schema chunk is created and on disposal, not on ordinary row churn. At `size`/`eachChunk()` entry, a stale query lazily rebuilds its cached deterministic match list. Commit work is independent of retained query count.
- `eachChunk()` increments the world's depth-counted read scope before traversal and decrements it in `finally`, so same-query/cross-query nesting works and visitor exceptions cannot strand the world in a reading state. Commit inside any nested visitor fails exactly as it does during legacy `each()`.
- `eachChunk()` skips chunks whose `count` is zero. It invokes the authored callback once per nonempty matching chunk and performs no per-row callback, cursor, component object, or allocation.
- A descriptor acquired during `eachChunk()`, its component views, raw field arrays, and `(chunk,row)` meanings are borrowed for the current world commit epoch: they may be retained and used by later query traversals in the same update, but become invalid when the next allowed commit begins or the world is disposed.
- Descriptor `count`, `entityAt()`, `views`, and each per-component lookup such as `views.position` compare the captured epoch and fail after expiry. A component view returned by that guarded lookup uses direct non-enumerable data properties for its typed-array fields, so hot code can hoist `const position = chunk.views.position` once and later perform unguarded `position.x[row]` access in the same epoch. Runtime cannot revoke an already-hoisted component view or raw typed array without proxies or buffer detachment; using either after the next commit/disposal is a borrowing violation that the contract prohibits but does not claim to detect.
- Runtime-owned descriptors, component views, and entity-reference subviews are inspection-inert: their accessors/data properties are non-enumerable, so `inspectValue` neither executes an expired getter nor reaches their typed columns. They inspect as empty opaque records; they are derived borrows, not authoritative resource state. Raw typed arrays remain ordinarily enumerable if authors detach them from the opaque component view.
- This within-epoch rule supports a spatial index that stores `{ componentView, row }` entries during one query and probes their direct columns during another query before commit. Add a test-only schema spatial-index scene resource mirroring Starfall's `collision-grid` use: build, cross-query probe, commit, allow `Game.enumerate()`/`JSON.stringify()` with the expired derived cache, then clear/rebuild before the next probe. Assert inspection stays bounded and contains no expanded typed-column indices. If this cannot be expressed without unsupported access or per-probe object reconstruction, stop and revise the public primitive before approval/build rather than deferring the discovery to NGNE-27.
- The public contract continues to prohibit commit during either supported query callback form, defines nested and exception behavior, and explains the narrower enforcement limit for retained raw typed arrays.

### Inspection and compatibility

- Build detached per-row diagnostic records only when `enumerate()` is called. Do not route simulation, rendering, or telemetry hot loops through record reconstruction.
- Preserve top-level world allocator/archetype facts and add ordered schema metadata, chunk capacity/count/order, field kind/default/order, entity references as JSON-safe `null` or `{ index, generation }` records, and enough location/free-stack state to explain future order. Inspection never emits BigInt values.
- Legacy rows retain their current inspected object values during the bridge. Schema rows use ordered component records with ordered field records rather than pretending typed columns are ordinary component objects.
- Preserve the exact legacy archetype and slot record shapes. Only a live schema slot adds its chunk index; schema archetype records own chunk placement/reuse facts. Update `tests/ownership.test.ts` only where new schema-specific inspection is asserted, and extend the contract migration paragraph for the conditional schema fields.
- Define inspected `row` explicitly: it is archetype-relative for legacy slots and chunk-relative for schema slots. Every live schema slot includes `chunk`, and the inspection test proves entities at row zero in different chunks remain distinguishable.
- Add a schema scene containing a null, live, and stale entity reference and prove `JSON.stringify(game.enumerate())` succeeds and equal histories stringify identically.
- Document that runtime borrowed ECS descriptors/views are deliberately opaque to generic resource inspection. A derived spatial index may expose its own bounded enumerable facts such as entry count/entity identities, but its retained column borrows are not duplicated into diagnostics and do not satisfy ownership for authoritative resource state.
- Inspected scene resources may retain the opaque component view object plus a row, but must not retain a raw field array such as `position.x`; doing so bypasses the inspection-inert container and expands the typed array under the existing `InspectionValue` rules. Add a negative inspection test that demonstrates this unsupported raw-column shape is enumerable, alongside the positive bounded component-view resource fixture.
- Increment the engine compatibility string to identify the changed ECS representation while retaining `mulberry32/1`. Document that inspection remains diagnostic and is not a restore format.

### Random state

- Replace the public writable field with a private uint32 field.
- Add `snapshot(): number` and `restore(state: number): void`; preserve the constructor's existing `>>> 0` normalization and apply the same normalization in `restore()` rather than introducing a new validation policy.
- Keep Mulberry32 version 1 and draw results unchanged. Scene enumeration calls `snapshot()`; `tests/engine.test.ts` deliberately changes its public-state comparison to `snapshot()`, and `tests/api-misuse.ts` proves direct assignment fails at compile time. Snapshot/restore tests repeat a sequence and cover constructor-equivalent normalization.

## Implementation phases

### Phase 1 — Schema and compatibility surface

- Add immutable field descriptors, distinct nominal schema component/value/query types, the component overload, exported helpers/types, and authored-boundary validation.
- Separate schema and legacy definitions internally; reject same-name conflicting schemas and mixed-mode spawn/query use while preserving empty spawn and all-entities zero-argument query semantics through its dedicated overload.
- Update the `WorldAccess` facade and public query interfaces. Add API misuse/type-inference coverage for facade read/write/chunk traversal, zero-query `each()`/no-`eachChunk()` typing, valid fields, invalid values, schema `get()` rejection, direct runtime constructors, wrong field names/types, query membership mutation, and read-only definitions.
- Update the contract's public API inventory and migration section in the same phase; label the legacy bridge temporary and deprecated.
- Check: focused typecheck/API fixture plus existing tests unchanged.

### Phase 2 — Chunked storage and structural lifetime

- Implement schema archetypes, retained 512-row chunks, typed columns, slot chunk locations, validation/lowering, buffered publication, swap removal/tail clearing, read/write, paired entity-reference columns, disposal, and explicit size/capacity accounting.
- Add `tests/ecs-soa.test.ts` cases for every field representation/default, 512/513 boundaries, `entityAt()` bounds, world/query size, empty spawn/all query, multiple archetypes, churn, retained-but-skipped empty chunks, swap repair/cleared tail, pending birth/death, stale/foreign handles, schema-only reference overflow, null/live/stale entity references, disposal, and invalid inputs.
- Preserve legacy implementation tests as regression coverage rather than rewriting them to schema APIs.
- Check: focused ECS tests, `npm test`, and `npm run typecheck`.

### Phase 3 — Typed queries, ordering, inspection, and RNG

- Add scoped typed chunk query views, structural-version lazy refresh, canonical bounds-checked `entityAt()`, direct visibility between queries, depth-counted exception-safe commit protection, commit-epoch descriptor checks, and documented raw-array borrowing limits.
- Update world/game enumeration and compatibility identity; retain legacy inspection shapes and empty-archetype/free-stack determinism, add JSON-safe schema records, and avoid hot-path reconstruction.
- Privatize Random state and add snapshot/restore; update scene inspection and deterministic tests.
- Extend focused tests for zero per-row API objects/callbacks by construction, query order, skipped empty chunks, lazy refresh independent of retained query count, same/cross-query nesting, visitor exceptions followed by a successful commit, commit rejection inside traversal, descriptor rejection after commit, direct component-view borrows within an epoch, the resource-held cross-query spatial-index pattern plus bounded post-commit inspection, equal-history JSON inspection, `f32` rounding, `f64` interpolation values, and RNG sequence restoration.
- Check: focused ECS/ownership/interpolation tests, then full tests and typecheck.

### Phase 4 — Supported consumer migration

- Migrate `examples/hello/main.ts`, README/guide hello snippets, `tests/api-misuse.ts`, and the ECS half of `tests/benchmark.ts` to schema components and scoped chunk views. Assert `world.size === ECS_ENTITIES` before benchmark sampling.
- Add a deterministic synthetic collision-grid probe workload to `tests/benchmark.ts` **after** the existing ECS and Chaos measurements and before final JSON output, so it cannot perturb the two NGNE-26-comparable sections. Use 260 cells, 256 indexed targets, 512 spatial probes, and 64 build/probe batches per timed sample; run 100 warmups and 300 samples for each legacy-object and schema `{ componentView, row }` arm. Count candidate checks deterministically and report constants, sample distributions, timer resolution, candidate checks, and nanoseconds per candidate check for each arm.
- The synthetic fixture proves that the migration shape is expressible, inspection-safe when held as a scene resource, and not inherently slower under that fixed equivalent workload. It is not proof that the real Starfall migration is cost-neutral or that overall game performance improves.
- Do not edit Starfall or platformer component/query code. Keep their object path passing as an explicit compatibility control.
- Update exported declarations and migration guidance. Record any unavoidable exact-value changes caused by declared widths.
- Check: `npm test`, `npm run typecheck`, `npm run build`, and `npm run format:check`.

### Phase 5 — Performance and browser evidence

- Run two otherwise-idle `npm run bench` samples with the NGNE-26 workload and record the full distributions. Compare the typed 20,000-entity ECS pass with the NGNE-26 object baseline; label Chaos as a legacy control.
- For the synthetic collision-grid fixture, first require each arm's median timed sample to be at least 100 times the harness's measured minimum positive `performance.now()` delta; otherwise the result is inconclusive and the harness/plan must be revised before drawing a conclusion. When valid, treat schema as materially slower if its median nanoseconds per candidate check exceeds legacy by more than 20% in both consecutive runs. Use the supported hoisted component-view columns; if that shape crosses the threshold, stop and revise the NGNE-20 primitive/contract.
- Record that the benchmark harness now has a third final section relative to NGNE-26. The earlier ECS and Chaos sections, order, seeds, warmups, and sample counts remain unchanged and execute before it.
- Run the production hello page in a visible browser, verify motion/wrap and absence of page/console errors, and record browser/environment limits.
- Repeat the NGNE-26 visible-browser Starfall and platformer samples twice when practical. Label them unchanged-legacy controls; do not claim they measure SoA. If the full 60-second controls are not run, record that limit and defer the migrated-game comparison to NGNE-12/27 rather than substituting shortened numbers.
- Update `docs/decisions.md`, `docs/guide.md`, `README.md`, `docs/roadmap.md`, and `docs/verification.md` in their owning roles. State the CE2 reference path in the handoff.
- Run final checks and inspect the complete diff before independent code inspection.

Each phase is an implementation/review checkpoint, not permission to merge an incomplete public transition. The final NGNE-20 change must leave all repository consumers compiling and all committed contracts internally consistent.

## Verification contract

### Automated proof

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run format:check
npm.cmd run bench
npm.cmd run bench
```

Expected results:

- All tests pass, including the new SoA boundary/churn/order/view/RNG cases and unchanged Starfall/platformer suites.
- Typecheck and emitted declaration/API misuse checks reject unsupported access while inferring typed columns and sparse field values.
- Production build emits the engine and bundles Starfall, hello, and platformer.
- Benchmark JSON identifies the revision/environment and reports two complete samples. Comparisons state workload and noise limits.

### Browser proof

1. Serve the production build with `npm.cmd run preview` in a controlled background process.
2. Open `/examples/hello/` in a visible browser; verify the schema-backed entity moves, interpolates, wraps, and produces no console/page errors.
3. Run the existing visible-browser baseline driver twice for `/` and twice for `/examples/platformer/?baseline` using the NGNE-26 warmup/duration and a fresh profile per run.
4. Record browser version, GPU, viewport/DPR, visibility, warmup, duration, frame/callback/heap results, and whether exact comparability was achieved.
5. Stop the preview/browser processes and confirm the worktree contains only intended changes.

### Final review proof

- Inspect every changed file and `git diff --check`.
- Verify each Jira acceptance criterion against a test, declaration check, document section, or dated measurement.
- Have Claude inspect the implementation in a fresh `inspect` session from the captured pre-build commit. Apply accepted fixes, rerun affected proof, and reinspect within the two-round limit.

## Risks and stop conditions

- **Bridge leakage:** if schema entities require legacy objects in their storage/query hot path, stop and redesign; the bridge must remain an isolated compatibility path.
- **Unplanned real-game migration:** if keeping Starfall/platformer buildable requires source migration, stop and ask whether to expand NGNE-20 or revise NGNE-27.
- **Deferred-access mismatch:** the resource-held schema spatial-index fixture must prove that commit-epoch component-view/row borrows are expressible, bounded under post-commit inspection, and not inherently slower than an equivalent legacy synthetic probe. It cannot prove real Starfall parity. If the fixed fixture fails, redesign the primitive during NGNE-20 or explicitly revise the existing collision-grid contract and NGNE-27 before locking the API.
- **Identity/order drift:** any change to generation reuse, free-stack order, archetype creation order, empty retention, commit visibility, or scene authority requires explicit contract revision and reviewer approval.
- **Numeric drift:** do not silently update assertions. Explain every changed exact result by field width/coercion and keep interpolation-critical data `f64` unless evidence supports a deliberate change.
- **Misleading performance claims:** legacy-game controls do not prove SoA gains. Do not compare different warmups, durations, visibility states, browsers, GPUs, or workloads as equivalent.
- **Scope expansion:** no worker scheduler, shared memory, WebGPU work, snapshot restoration, component add/remove, general codecs, string columns, custom allocators, or new dependency.

## Handoff requirements

- Changed paths grouped by phase and ownership.
- Exact commands and results, benchmark/browser environment, and unverified limits.
- Claude review verdict, findings/dispositions, rounds used, approved plan hash, and later inspection coverage.
- Explicit confirmation that Starfall/platformer were not migrated and that NGNE-27 owns bridge removal.
- Residual risk: NGNE-27 must measure the migrated real Starfall collision loop against the NGNE-26 Chaos baseline; passing NGNE-20's synthetic fixture is not a cost-neutrality claim for the game.
- CE2 reference used: `C:/Users/jfabi/Documents/Projects/ce2/src/ecs/storage.ts` and `C:/Users/jfabi/Documents/Projects/ce2/docs/contracts/ECS-STORAGE.md`.
- No commit, push, Jira transition, or publication without separate authorization.
