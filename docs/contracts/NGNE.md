# NGNE implementation contracts

These contracts define the supported API and storage semantics. The high-level architecture remains authoritative.

## Contract map

| Contract                                                | Scope                                                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [Ownership and inspection](ownership-and-inspection.md) | Authoritative state, inspection boundaries, reconstruction limits and consumer ownership |
| [Simulation](simulation.md)                             | ECS, scenes, committed state, events, freeze and deterministic randomness                |
| [Browser and presentation](browser-and-presentation.md) | Browser lifecycle, input, rendering, camera interpolation, assets and audio              |

Read this file first for the supported package boundary. Read only the detailed contract that owns the behavior being changed; broad ownership or architecture work may require all three.

## Contract-wide invariants

- `Game` owns simulation lifecycle, scene publication and commit authority.
- Each mounted scene owns its world, resources, RNG streams, events, freeze and camera state.
- `BrowserGame` owns platform input, frame scheduling, rendering and audio integration.
- Inspection is detached diagnostic data, not a save, restore or replay format.
- Rendering and asynchronous platform completion never mutate simulation state.
- Ownership, lifetime, ordering and determinism take precedence over implementation style.

## Public API and inspection

The package entry point is the supported boundary. Runtime modules are internal;
the package export map exposes no subpaths. The consumer inventory is:

### Authoring

Public symbols: `component`, `f32`, `f64`, `i32`, `u32`, `u8`, `bool`,
`entityRef`; types `SchemaComponent`, `SchemaComponentValue`, `SchemaFields`,
`SchemaValues`, `SchemaQuery`, `SchemaChunk`, `SchemaComponentView`,
`SchemaQueryViews`, `FieldDescriptor`, `FieldKind`, `EntityReferenceView`,
`Entity`, `AllQuery`, `WorldAccess`, `SceneDefinition`, `SceneSetup`,
`SystemContext`, `SceneCommands`, `SceneEvent`, `StateAccess`, `DeepReadonly` and
`PreparedScene`.

Hello, Starfall, the platformer and authoring tests consume this surface. Setup
injects scene capabilities; systems cannot commit, enumerate or change query
membership. Prepared handles expose only idempotent `release()`; the owning Game
validates identity and consumes them.

### Authoring and presentation

Public symbols: `Camera`, `Random`, `clamp`, `lerp`, `seedOf`, `down`, `pressed`,
`imageAsset`, `audioAsset`; types `Asset`, `ImageAsset`, `Lease`, `Sprite`, `Sound`
and `Clip`.

Scene authors use explicitly acquired or injected values. Constructors operate on
caller-owned values; inspection never returns a live camera or RNG.

### Platform integration

Public symbols: `Game`, `BrowserGame`, `Assets`, `Input`, `Frame`,
`WebGPURenderer`, `Audio`, `FixedStep`, `emptyInput`; types `GameOptions`,
`SceneCandidates`, `SceneCandidateOptions`, `BrowserOptions`, `FrameScheduler`,
`DisplaySnapshot`, `InputSnapshot`, `Stats`, `RendererStatus`, `AssetRetention`,
`AssetsOptions` and `AssetClaim`.

The browser host, headless runners, renderer/audio/asset tests and benchmarks
consume this surface. Host lifecycle, candidate coordination, tick, render and
service operations are intentional integration APIs.

### Inspection

Public types: `Lifecycle`, `SceneInspection`, `SceneStateInspection`,
`GameInspection`, `InspectionValue`, `AssetInspection`, `AssetEntryInspection`
and `RendererResourceInspection`. `Assets.inspect` and `WebGPURenderer.inspect`
provide bounded resource detail with complete aggregates; `Assets.trim` and
`Assets.evict` apply the retention contract without revoking live leases.

Tests, benchmark capacity reporting and diagnostics consume this surface. It
returns no mutable foreign world or resource binding.

### Internal only

`World`, the query runtime, `SceneInstance`, candidate runtime, `Cleanup`,
`immutable`, browser failure and preparation capabilities, and GPU
runtime/context/quad/registry modules are internal. Runtime modules, direct ECS
tests and the benchmark import them deliberately. There is no public runtime
constructor for scenes, queries or prepared candidates.

- `Game.lifecycle` and `simulationTick` are getter-only values backed by private
  fields. Browser faults use an internal capability, not a writable public field.
- `Game.scenes` returns a fresh frozen array of frozen summaries in stack order:
  instance `id`, definition ID string, authored `key`, seed, blocking policy,
  entity count/capacity and remaining freeze ticks. Compare `id`, not object identity,
  across reads. Old summaries remain unchanged after updates or unmount.
- `Game.enumerate()` returns detached, recursively frozen diagnostic data. Resource
  bindings, component values, camera, RNG, event data and game state cannot be
  mutated through this result. Dynamic values use `InspectionValue` and require
  narrowing. Enumeration copies on demand and is unsuitable for per-frame telemetry.
- Enumeration preserves enumerable string-keyed data and cycles. Arrays remain arrays;
  Maps become entry arrays, Sets become value arrays, and typed arrays become indexed
  records. Symbols become descriptions and functions become `"[Function]"`; prototypes,
  methods, non-enumerable and symbol-keyed properties are omitted. Opaque objects with
  no enumerable data inspect as empty records. This is neither a lossless snapshot nor
  a save/restore format, and it never grants entity ownership.

Components require schema definitions; unchecked JavaScript calls that pass a factory
function or non-schema component value throw. A zero-component `query()` performs
entity-only traversal.
