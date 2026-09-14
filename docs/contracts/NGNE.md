# NGNE implementation contracts

These contracts pin the previously deferred API and storage choices. The high-level architecture remains authoritative.

## Public API and inspection

The package entry point is the supported boundary. Runtime modules are internal;
the package export map exposes no subpaths. The NGNE-1 consumer inventory is:

| Category                   | Public symbols                                                                                                                                                                                                                                                                                                                                                                                                                                            | Consumers and ownership                                                                                                                                                                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authoring                  | `component`, `f32`, `f64`, `i32`, `u32`, `u8`, `bool`, `entityRef`; types `SchemaComponent`, `SchemaComponentValue`, `SchemaFields`, `SchemaValues`, `SchemaQuery`, `SchemaChunk`, `SchemaComponentView`, `SchemaQueryViews`, `FieldDescriptor`, `FieldKind`, `EntityReferenceView`, `Entity`, `AllQuery`, `WorldAccess`; `SceneDefinition`, `SceneSetup`, `SystemContext`, `SceneCommands`, `SceneEvent`, `StateAccess`, `DeepReadonly`, `PreparedScene` | Hello, Starfall, the platformer and authoring tests. Setup injects scene capabilities; systems cannot commit, enumerate, or change query membership. Prepared handles expose only idempotent `release()`; the owning Game validates identity and consumes them. |
| Authoring and presentation | `Camera`, `Random`, `clamp`, `lerp`, `seedOf`, `down`, `pressed`, `imageAsset`, `audioAsset`; types `Asset`, `ImageAsset`, `Lease`, `Sprite`, `Sound`, `Clip`                                                                                                                                                                                                                                                                                             | Scene authors use explicitly acquired/injected values. Constructors operate on caller-owned values; inspection never returns a live camera or RNG.                                                                                                              |
| Platform integration       | `Game`, `BrowserGame`, `Assets`, `Input`, `Frame`, `WebGPURenderer`, `Audio`, `FixedStep`, `emptyInput`; types `GameOptions`, `SceneCandidates`, `SceneCandidateOptions`, `BrowserOptions`, `FrameScheduler`, `DisplaySnapshot`, `InputSnapshot`, `Stats`, `RendererStatus`                                                                                                                                                                               | Browser host, headless runners, renderer/audio/asset tests and benchmarks. Host lifecycle, candidate coordination, tick, render and service operations remain intentional integration APIs.                                                                     |
| Inspection                 | `Lifecycle`, `SceneInspection`, `SceneStateInspection`, `GameInspection`, `InspectionValue`                                                                                                                                                                                                                                                                                                                                                               | Tests, benchmark capacity reporting and diagnostics. No mutable foreign world or resource binding is returned.                                                                                                                                                  |
| Internal only              | `World`, query runtime, `SceneInstance`, candidate runtime, `Cleanup`, `immutable`, browser failure and preparation capabilities, GPU runtime/context/quad/registry modules                                                                                                                                                                                                                                                                               | Runtime modules; direct ECS tests and benchmark import their internal modules deliberately. No public runtime constructor for scenes, queries or prepared candidates.                                                                                           |

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

Migration (NGNE-27): the object-component bridge is removed. Replace
`component(name, factory)` with `component(name, schema)`, `Query.each()` with
`SchemaQuery.eachChunk()`, and object-valued `world.get()` with sparse
`WorldAccess.read()`/`write()`. The `Component`, `ComponentValue` and `Query` types are no
longer exported; passing a factory function or a non-schema component value from unchecked
JavaScript throws. `query()` with no arguments remains an entity-only traversal. The WebGL
`Renderer` export and `BrowserOptions.renderer` are removed; see [Renderer](#renderer).
`Frame` and the `Sprite` type are now named exports with unchanged behaviour.

For earlier API migrations, replace `scene.definition.id` with `scene.definition`,
`scene.world.capacity` with `scene.entityCapacity`, and retained scene object comparisons
with `scene.id` comparisons. Use `game.enumerate()` for detached diagnostic values;
keep gameplay mutation in setup-injected resources and world capabilities. Replace
direct `World` construction in application code with a headless `Game` and scene setup;
the Game owns commits. Create components with `component()` and prepare candidates
with `game.prepare()`. Never assign lifecycle or simulation tick.

## Simulation-state ownership inventory (NGNE-5)

Audited production `src/`, `demo/game.ts`, `demo/main.ts`, `demo/art.ts` and
`examples/hello/main.ts`. This inventory describes the state determining the next
tick **given the same authored code, input/display and host commands**. It is not
a capture schema. No mutable authoritative gameplay value remains solely in a
system closure in these consumers; closures retain injected owners and fixed code.

| State / classification                  | Owner and inspection / reconstruction considerations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Global simulation state                 | `Game`: tick, root seed, committed state, next instance ID; `enumerate()` includes these plus fixed `dt` in seconds and engine/RNG/authored compatibility string.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Mounted scene state                     | Stack order, instance ID, definition ID, key, resolved seed and blocking policy; scene summaries preserve these. Resources are keyed by unique nonempty names within each mount.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ECS values and identity                 | World owns component columns and immutable index/generation/world handles. Component names identify composition; conflicting definition objects with the same name are rejected on spawn. Names are world-local, not a global schema registry. Schema definitions are frozen at creation and hold cloned, frozen field descriptors (`kind`, `default`), so they are immutable authoring, not state. Schema values live in per-chunk typed columns; entity references are encoded index/generation pairs. Query chunk descriptors, `views` and `entityAt()` row meanings are borrowed for the current commit epoch and rebuilt on the first traversal after each commit: derived, never authority.                                                                                                                                                                                                                                                                                                      |
| Allocator and iteration history         | World owns slot generations, row positions, pending flags, free-stack order, archetype creation order and dense row order. Schema archetypes also own chunk creation order and fill: allocation reuses the lowest-created chunk with capacity and empty chunks are retained, so chunk order and counts are history. A live slot's location is its `chunk` index plus chunk-relative `row`; entities spawned without components live in an empty-component archetype with the same chunk layout. Inspection includes `archetypes` with ordered component names and entity indices, **including empty archetypes**, plus `fields` (per component, field `name`/`kind`/`default`) and `chunks` (`capacity`, `count`, ordered entity indices). `entities` retains values in archetype/chunk/row order as field records `fields: [{ name, kind, value }]`, with entity references as `null` or `{ index, generation }`. Empty archetypes and empty chunks cannot be reconstructed from live entities alone. |
| Scene simulation state                  | Named RNG current uint32 states, resources, event inbox/outbox, pending/remaining freeze and camera fields. Suspension and stop/resume preserve mounted state; unmount releases it. Camera state must be treated as authoritative when gameplay reads it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Tick-local work                         | Game owns selected update plan, current updating scene, state/scene command queues and busy flag; worlds own pending births/deaths. Ordinary local variables such as aim search, collision iteration and spawn temporaries do not persist across updates. Queues normally drain at completed commit; suspended event inboxes intentionally persist.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Starfall durable facts                  | Game state owns `best`, `runs`, `victories`, `lastScore`; finish commands capture score/win before transition.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Starfall gameplay                       | `run` owns phase, score, wave, seconds/ticks, hp, bomb, combo/countdown, stress, spawn/shot timers, invulnerability, boss-wave and finished flag. `player` resource owns its handle. Schema components own the rest: `position` (`x`, `y`, `px`, `py`: `f64`) and `body` (`vx`, `vy`, `radius`, `hp`, `age`, `cooldown`: `f64`; `active`: `bool`; `kind`: `u8`). Systems locate the player's row from its handle each update and never retain it. `waves` RNG owns spawn/drop randomness. The decoded `ships` atlas is an `ImageAsset` lease owned by each prepared scene; no component field or resource holds it.                                                                                                                                                                                                                                                                                                                                                                                    |
| Starfall derived cache                  | `collision-grid` resource stores entries of entity handle, borrowed `position` and `body` chunk component views and chunk-relative row. Every continuing ordinary gameplay update clears and rebuilds it before collision reads, so entries are only probed in the commit epoch that created them. After commit the retained entries are expired borrows that may name removed entities or moved rows: they are neither an authority nor a list of current entities, and inspection shows their views as empty records. Query match/column caches are likewise derived from definitions and archetypes, preserving their order.                                                                                                                                                                                                                                                                                                                                                                        |
| Starfall presentation within simulation | `visual` (`sprite`: `u8`; `size`, `angle`: `f64`), previous poses, `particle` (`vx`, `vy`, `life`, `maxLife`, `size`: `f64`; `color`: `u32`), `effects` RNG, `run.shake/flash`, camera shake and `stars` are scene-owned and inspectable. Particle updates continue through freeze and share ECS allocation with gameplay: their lifetime cannot be omitted when reproducing allocator identity. Stars are generated once using `waves`, so mount-time draws are part of deterministic setup.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Immutable authoring                     | Component schemas/names, scene setup/ID/policy, ordered systems and freeze flags, reset/render callbacks, transition function, arena attract/stress/reduced-motion options, dimensions, sprite/atlas definitions and texture key `ships`. These are code/configuration, not serialized values. Treat supplied definitions/options as fixed; readonly typing does not deep-freeze arbitrary authored objects or callback captures.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Host intent and preparation             | Game owns raw candidate handles/status/leases, owner-scoped candidate slots, pending abort controllers and queued host scene commands. Game hosts own authored purposes, definitions and launch intent. These are external activation inputs, not hidden gameplay progression. Availability and authored activation tick/key must also match for repeatability; input snapshots alone do not record DOM launch/pause/visibility commands.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Platform input / timing                 | `Input` owns held/edge/pointer/gamepad state pending consumption; BrowserGame owns display, scheduler/run token, lifecycle guards, clock, FixedStep accumulator/budget and telemetry. These control future environmental input and platform frames, outside simulation-state inspection. A game reading display data needs the same supplied display values too.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Assets and presentation services        | Assets owns definitions, loads, decoded cache and refcounts; scene cleanup owns leases. Renderer owns texture sources/GPU objects/context state; Frame owns reusable draw buffers and sorting. Audio owns requests, voices, scope identity/disposal, buses/mute/ducking and device. These are rebuilt or resumed through their services, not simulation capture.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Demo UI and hello                       | DOM `view`/`presentation`, prior phase, metrics/times and UI readiness are host/presentation state. View copies do not grant gameplay mutation. Hello's moving/previous X values are components; its query/callbacks contain no mutable gameplay counters. Art generation has only call-local drawing work.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### Inspection boundary and limits

- Inspect after successful `tick()` returns and before new host commands or authored
  mutations for a completed commit; after initial `start()` mounting is also committed.
  `enumerate()` is allowed elsewhere but is not an atomic snapshot API. During update,
  setup, cleanup or failure it may expose intermediate/partial state; pending command
  payloads and candidate preparation are not enumerated. Lifecycle is read separately.
- Public `Game.enumerate()` is detached and frozen. Internal `World.enumerate()`
  builds metadata but borrows live component values; it must remain runtime-internal.
  Setup-injected world/resource/RNG/camera capabilities deliberately remain live.
- Inspection copies each category separately: aliases within a copied graph survive,
  but cross-category identity is not preserved. Entity owner symbols become the same
  `"world"` description across worlds; use the enclosing scene identity to interpret
  handles. An inspected handle cannot be passed back as an owned entity.
- The public copy is lossy: enumerable getters may execute, custom iterators may run,
  private fields and non-enumerable state are omitted, and built-ins lose their type
  as described above. Keep authoritative resource data inspectable; opaque closure or
  private-field-only resource state does not satisfy the ownership requirement.
  Inspection of arbitrary authored accessors is not guaranteed side-effect-free.
- Scene IDs, resource names, component names, mount keys and asset IDs are authored
  identities, not reconstruction resolvers. Scene IDs are not globally uniqueness-
  checked; authors must use compatible definitions for each ID. Default
  `unversioned-game` is not compatibility validation. A future consumer must define
  authored schema/version checks, graph/handle reconstruction, service reacquisition
  and external activation recording. Capture, serialization, restoration, replay
  control and a snapshot participant registry remain absent.

Migration: inspection includes `dt` and `world.archetypes`. Every archetype contains
`fields` and `chunks`, every live slot contains `chunk`, and its `row` is chunk-relative.
Since NGNE-27 there are no legacy records: entities spawned without components now inspect
as an archetype with `components: []`, `fields: []` and `chunks`, and their live slots
include `chunk`. Legacy `components: [{ name, value }]` entity records no longer occur.
Diagnostic readers should never rebuild iteration order from only `world.entities`.

## ECS

### Schema definitions and fields

`component(name, schema)` creates an immutable schema definition. Each world registers
schema identities independently, and the schema plus cloned field descriptors retain
their literal component/field names. `.of(partial)` supplies a complete fixed composition
to `spawn`; omitted or explicitly `undefined` fields use their declared defaults. Names
are nonempty and one schema definition identity owns each schema name inside a world.
Conflicting schema identities, non-schema definitions or values, duplicate schema
components, unknown fields, and invalid authored values fail at the authoring boundary.

| Helper        | Logical value                 | Physical column                               | Valid authored or sparse value                                      |
| ------------- | ----------------------------- | --------------------------------------------- | ------------------------------------------------------------------- |
| `f32()`       | number                        | `Float32Array`                                | finite; storage rounds to float32                                   |
| `f64()`       | number                        | `Float64Array`                                | finite                                                              |
| `i32()`       | number                        | `Int32Array`                                  | integer from -2147483648 through 2147483647                         |
| `u32()`       | number                        | `Uint32Array`                                 | integer from 0 through 4294967295                                   |
| `u8()`        | number                        | `Uint8Array`                                  | integer from 0 through 255                                          |
| `bool()`      | boolean                       | `Uint8Array`                                  | boolean; stored as 0 or 1                                           |
| `entityRef()` | same-world `Entity` or `null` | paired `Uint32Array` index/generation columns | live, pending, or stale same-world handle; default is always `null` |

Entity-reference indices store `index + 1`; zero means null. Query views expose the
encoded arrays directly. Sparse `read()` reconstructs a frozen same-world handle,
including stale references, and returns `null` for the null encoding. `has()` determines
whether that handle is live. Sparse `read()` returns `undefined`, and `write()` does
nothing, when the subject is stale, pending, foreign, or lacks the component. Unknown
fields, invalid logical values, and foreign referenced entities throw. Direct numeric
column writes deliberately use native typed-array coercion; trusted hot loops own range
correctness.

### Storage, lifetime, and order

Each schema archetype owns fixed-capacity 512-row chunks, one typed array per field,
and a dense canonical-handle array. Allocation reuses the lowest-created chunk with
capacity. Swap removal repairs the moved slot and clears the vacated handle and column
cells. Empty archetypes and allocated chunks remain until disposal; rows at or above
`count` are never live.

The world retains generation-bearing slots, a LIFO free stack, buffered FIFO-equivalent
birth/death publication, and fixed entity composition. Iteration order is archetype
creation, then chunk creation, then dense row order. `World.size` counts every live
row; `capacity` is the slot-array length. A schema query's `size`
counts all matching live rows. Query match lists refresh lazily after archetype or chunk
creation, so commit cost is independent of retained query count. Immediate field writes
are visible to later systems and queries. `despawn()` is idempotent; pending births may
be despawned at the same commit. Systems receive `WorldAccess`, which excludes commit
and enumeration; the private scene runtime commits after selected schedules finish.
The facade exposes bound, non-enumerable methods, so retaining a method does not widen
authority or require its receiver. Runtime query state is non-enumerable and inaccessible.

### Chunk traversal and borrowing

`SchemaQuery.eachChunk()` invokes one callback per nonempty matching chunk and performs
no per-row object reconstruction or callback. `chunk.count` is the live bound;
`capacity` reports allocation only. `entityAt(row)` returns the world's canonical
current handle and rejects non-integer or out-of-range rows. Nested same-query and
cross-query traversal is supported. A visitor exception releases its read scope, while
commit during any active query callback fails.

Descriptors, `views`, component lookups, and row meanings are borrowed for the current
world commit epoch. A component view plus row may be retained across later traversals
in the same update, allowing a spatial index to build then probe. The descriptor guards
expire when the next allowed commit begins or the world is disposed. Hoisted component
views and raw typed arrays cannot be revoked without proxies or buffer detachment; using
them after expiry is prohibited even though runtime detection is narrower.

Runtime-owned descriptors, component views, and entity-reference subviews expose their
data through non-enumerable properties and therefore inspect as opaque empty records.
This prevents a resource-held derived view/row cache from expanding whole columns during
`Game.enumerate()`. Retaining a raw field array in a resource bypasses that container and
is unsupported; generic inspection will enumerate its indexed values. Derived borrows
do not satisfy ownership for authoritative resource state.

### Inspection and empty entities

Enumeration reconstructs detached schema row records only on demand. It records ordered
schema fields/kinds/defaults, chunk capacity/count/order, chunk-relative row plus chunk
index for live slots, JSON-safe entity references, and allocator/free-stack facts.
Enumeration is diagnostic, not a hot query or restore format. The engine compatibility
prefix is `NGNE/2;mulberry32/1`.

Empty `spawn()` creates an entity in the schema archetype with no components; it uses the
same 512-row chunks, chunk-relative rows and inspection shape (`fields: []`). Zero-argument
`query()` traverses every entity in deterministic creation/chunk/row order and exposes no
component values or chunk views. No runtime component changes or public pools exist.
`spawn()`, `query()`, and `commit()` reject a disposed world; `dispose()` is idempotent.

## Scenes and state

Definitions contain identity, assets, policy and synchronous setup. Candidates are asynchronous leased intent, owned by exactly one Game, consumed once. `key` is authored, not allocated from timing or load order. Explicit scene seeds are uint32. Stop/dispose cancels pending preparation and releases unconsumed candidates. Shared loads remain available to other live consumers.

`Game.candidates.ensure(ownerId, purpose, definition, options)` keeps at most one pending or ready candidate for that mounted scene instance and nonempty purpose. Repeating the same request is idempotent; a changed definition or option replaces and releases the old slot. `options.retries` is a non-negative count of additional attempts, and only the final failure is reported through the Game diagnostic. `take(ownerId, purpose)` returns a ready handle once and schedules replenishment outside the current tick while the owner remains mounted. `release(ownerId, purpose?)` abandons one or all slots. Scene unmount, stop and disposal perform the same cancellation/release automatically. Slots never mount or enqueue scene commands; activation remains an explicit `set`/`push` at commit. Raw `prepare()` remains the path for initial scenes and one-off host transitions.

Private mounting owns a reverse cleanup stack before setup runs. Setup binds resources and named RNG, registers the immutable system schedule, initial entities and frame preparation. Setup failures dispose everything acquired, report aggregated cleanup errors, and never publish the partial world. `set` mounts first, then unmounts old scenes. Cleanup failures never republish a torn-down scene.

Tick commit order and scene-command failure isolation follow the [architecture](../architecture.md#platform-frame-and-tick-commit); scene commands apply FIFO. Arbitrary system/transition faults enter Failed. Only disposal is then supported.

### Committed state typing and ownership

- Declare stateful scenes as `SceneDefinition<State, Command>` for the owning
  `Game<State, Command>` (or `BrowserGame<State, Command>`). Its setup receives
  `SceneSetup<State, Command>`; `scene.state()` infers that contract and accepts
  no caller-selected generics. `Game.prepare()` rejects incompatible scene types.
  An unparameterized scene uses unknown state and no commands, so scenes that do
  not need durable state remain portable. Setup is a function property to preserve
  strict parameter checking. No state capability is added to `SystemContext`.
- `StateAccess.read()`, `Game.state`, transition state and transition commands
  expose `DeepReadonly` values, including nested objects, arrays and tuples.
  TypeScript checks the authored schema; runtime checks enforce the data domain,
  not a game-specific field schema. JavaScript and unchecked casts remain untyped.
- Initial state, each dispatch payload and each transition result are validated,
  copied and recursively frozen. Caller-owned inputs are neither frozen nor retained.
  Later caller mutation cannot alter committed facts or queued command meaning.
  Reusing a command object captures its value separately at each dispatch.
- Supported data: plain objects with Object.prototype or null prototype, ordinary
  arrays (including holes), strings, numbers (including NaN and infinities), booleans,
  bigint, null and undefined. Cycles and shared references are preserved within each
  copied graph. Only enumerable own string-keyed data properties are supported;
  the intrinsic array length is preserved. Symbols, functions, accessors,
  non-enumerable authored properties, class instances, Date, Map, Set, typed arrays,
  buffers and other built-ins are rejected, including inside already-frozen values.
  Getters are not evaluated. This is a data contract, not a serialization format.
- Dispatch is allowed only during the owning scene's system update. Setup may read
  but cannot dispatch; rendering, transitions, cleanup, suspended scenes and retained
  capabilities outside an update cannot enqueue commands. All selected systems read
  the same committed snapshot for the whole tick. Commands transition in dispatch
  order, each receiving the previous result; replacement setup sees the final result.
- Transitions must synchronously return supported data. Invalid results fail the
  Game without publishing that result; earlier successful commands remain committed.
  Rejected native async transition promises are observed for diagnostics. Invalid
  initial state rejects construction; invalid dispatch rejects before enqueueing.
- Validation/copy cost is proportional to the reachable data graph at these
  boundaries. Keep high-frequency mutable data scene-owned. Reads do not copy.

Migration: replace `scene.state<S, C>()` with `scene.state()` and annotate the
containing definition or factory return as `SceneDefinition<S, C>`. Type standalone
setup functions as `SceneSetup<S, C>`. Transitions build new values or return the
read-only input; never mutate nested state or commands. Replace unsupported durable
values with plain facts; typed arrays and other mutable representations can remain
scene resources.

### Events, freeze and randomness

Events use the same validated plain-data copy/freeze on emit, broadcast on the next ordinary update, and are held through suspension/freeze. Frozen systems cannot emit gameplay events. Freeze requests use positive integer ticks and resolve to maximum duration at commit. Suspension pauses the countdown. Ordinary transform interpolation reset callbacks and camera cuts execute when freeze first activates.

RNG: FNV-1a over JSON-encoded seed parts, followed by Mulberry32 streams. Root input is hashed; scene seed derives from root/definition/key, and stream seed derives from scene seed/name. Explicit scene seed bypasses scene derivation. These algorithms have compatibility version 1. Rendering uses no simulation stream. `Random.snapshot()` returns the current uint32 state; `restore(state)` applies the same `>>> 0` normalization as construction. State is not directly writable, and scene enumeration uses `snapshot()`.

## Platform and lifecycle

Browser lifecycle overlaps:

| Call while another operation is pending           | Result                                                                                                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start()` or `stop()` during start/resume or stop | Reject before side effects; the original operation continues. Await it before retrying.                                                                                      |
| `dispose()` during start/resume                   | Immediately disable frames and begin all teardown; late start success rejects as cancelled, and late failure retains its original error. Neither changes terminal lifecycle. |
| `dispose()` during stop                           | Begin teardown immediately. Stop may settle successfully or reject its own failures; it cannot replace `Disposed` with `Failed`.                                             |
| Repeated `dispose()`                              | Return the same promise, including its aggregated rejection; cleanup is attempted once.                                                                                      |
| Start/stop after disposal begins                  | Reject without recreating services.                                                                                                                                          |

The browser operation guard spans audio promises and Game startup completion.
`game.lifecycle` describes simulation lifecycle, so it may already be `Stopped`
while browser audio suspension is pending. Use BrowserGame lifecycle methods for
a browser-owned Game. Frame callbacks belong to one run; callbacks from a previous
run remain invalid even after successful resume.

Disposal initiates each independent cleanup without waiting for audio close before
releasing renderer/input. Its promise settles after all cleanup results and aggregates
all original failures. A superseded start/stop reports its own outcome through its
own promise; callers must handle both promises. Disposal does not wait for an
unsettled resume/suspend promise.

Headless `Game.start()` performs mounting and loop startup synchronously, although
its result is a promise. Invalid lifecycle calls reject. `Game.stop()` also cancels
preparations and unused candidates when already stopped, including before first
start. Cancellation cannot publish a late candidate; a shared asset load stays alive
while another consumer needs it. Cancelled loaders that eventually return data
dispose that data. An external loader that ignores abort may remain pending until
it settles, without retaining permission to activate a scene.

`Game` is headless. `BrowserGame` owns its input, renderer, audio and host frame scheduler. The injected scheduler must follow requestAnimationFrame semantics: asynchronous callbacks, cancellable IDs and monotonic millisecond timestamps. Late callbacks do no work after disabling. Cold loop failure rolls back the initial mounted world. Resume loop failure preserves it for terminal disposal. All independent teardown actions are attempted.

Default step: 1/60 second; budget: five ticks per platform frame. Excess whole ticks are dropped and reported, fractional remainder retained. No variable simulation delta. Display dimensions are fixed logical pixels; the backing canvas matches them and CSS scales presentation. Each frame latches display once. Each consuming tick receives one frozen input snapshot shared by every selected scene; pending edges survive frames without ticks and appear only on the first tick of a multi-tick frame.

The attached canvas is the focused input surface. Keyboard presses are accepted only
when their event targets that focused canvas; key releases remain window-observed so a
focus change cannot latch a key. Buttons, inputs, text areas and selects keep normal
keyboard behavior. Pointer coordinates are recomputed from the canvas's current client
rectangle for every event and mapped to fixed logical display pixels. Pointer cancellation
or capture loss releases every held `PointerN` action and clears pointer activity.

The lowest-index connected gamepad contributes to the same logical player only while
the canvas is focused. Disconnecting or switching pads releases the previous pad's held
buttons. Blur, `Input.clear()`, `BrowserGame.stop()` and disposal cancel held keyboard,
pointer and pad input; the same connected pad must return to neutral before it can be
acquired again. A later reconnect is a fresh pad input source. Native key codes,
`Pointer0`, `Pad0` etc. identify inputs; snapshots expose held/pressed/released arrays,
dead-zone-normalized gamepad axes, logical pointer coordinates/deltas and wheel delta.
Local multiplayer and explicit controller assignment are not implemented.

## Renderer

`WebGPURenderer.create(canvas, width, height, onError?)` asynchronously publishes a
complete renderer. Its synchronous `render(frame, clear?)`, `drawCalls`, `sprites`,
idempotent `dispose()` and readonly presentation `status` are separate from Game
lifecycle. Public-reachable declarations require no ambient WebGPU types; internal
device, encoder, registry and upload modules are not package subpaths.

`BrowserGame` always renders through WebGPU; `BrowserGame.renderer` is a
`WebGPURenderer` once acquired. Unsupported WebGPU rejects with an actionable message and
there is no fallback backend.

Migration (NGNE-27): delete `renderer: "webgpu"` from `BrowserOptions`; the option no longer
exists. The WebGL `Renderer` class is removed, so direct callers use
`WebGPURenderer.create()`. Upload images by listing `ImageAsset` definitions in scene
`assets` instead of calling a renderer texture method after start.

Cold image preparation may initialize the renderer, without attaching input, mounting,
starting audio or scheduling ticks. Startup shares that acquisition. A fully initialized
WebGPU renderer belongs to BrowserGame through stop and complete cold-start rollback;
retrying an unconsumed candidate reuses it. Failed initialization clears the rejected
acquisition for retry. Incomplete rollback/terminal host failure tears down presentation.
Stop invalidates a still-pending acquisition without mounted consumers. A later prepare
can acquire again. Disposal invalidates renderer ownership before Game/Assets close
decoded sources, attempts every independent teardown and aggregates failures.

BrowserGame alone restores its fixed logical backing dimensions before rendering;
CSS resize scales presentation only. Direct renderer callers own canvas dimensions.
Invalid dimensions/count/limits, unavailable image IDs and synchronous frame faults
skip the entire submission and report once per consecutive fault episode. A successful
frame resets suppression. Diagnostics cannot throw into simulation. Uncaptured device
errors report once per message per device. Instance-buffer growth failure is detected
asynchronously: later frames reallocate below the failed capacity, and frames that
still exceed it skip under the same episode suppression. That lowered cap lasts for
the device generation and resets only after device replacement.

Presentation transitions `ready → recovering → ready`, or `failed`; disposal is
terminal from every state. Each live-device loss starts one replacement attempt.
Replacement rebuilds the white texture, pipeline, buffers, bindings and all live image
sources on a fresh adapter/device, reconciling consumer changes before publication.
Old device callbacks and released/cancelled uploads cannot publish into the replacement.
Failed replacement (including a replacement lost before readiness) reports
`WebGPU recovery failed. Reload to create a new renderer` once and requires a new
BrowserGame. A subsequent loss after successful recovery may start another attempt.

Synchronous render skips during recovery. Running simulation may continue unchanged;
no scene, tick, accumulator, RNG, camera or prepared-key mutation follows GPU completion.
Resume waits for readiness before scheduling ticks. Stop never schedules a frame when
recovery completes. Browser diagnostics go to Game.report, with a contained console
fallback when no callback was supplied. Diagnostics also receive non-error notices
such as dropped-tick overload records. Hello appends flattened `Error` reports only,
so later notices or errors cannot hide startup or terminal failures. Use BrowserGame.dispose for a browser-owned Game.

`Frame` packs 14 float32 values (56 bytes) per sprite: `tx, ty, ix, iy, jx, jy,
u0, v0, du, dv, r, g, b, a`. The first six values transform unit-square corners:
`position = translation + corner.x * (ix, iy) + corner.y * (jx, jy)`.
Authoring still uses centered XY, signed size and rotation radians. Camera/shake
subtraction and optional center rounding happen before affine conversion. Sorting
remains scene, layer, depth and insertion. Adjacent texture runs batch without
texture-driven reordering. CPU/GPU buffers grow geometrically; there is no
per-entity GPU object or ECS access from rendering.

Raw-data migration: replace 13-float strides with 14 and reconstruct the center as
`(tx + (ix + jx)/2, ty + (iy + jy)/2)`. Float32 reconstruction can round differently
from the former center storage; bounded interpolation fixtures allow 1e-4 pixels.
NGNE-27 removed the WebGL renderer that also consumed this format.

`Frame.count` defines the active prefix while packing. `reset()` resets logical
contents and retains metadata array capacity; raw readers must not traverse stale
tails. `sort()` trims `order` and `textures` to the active count before ordering.
This avoids repeated backing-array growth for a steady workload.

### Camera coordinates

`camera.x/y` is the world position of the viewport's top-left. No-argument `cut()` copies current coordinates to previous coordinates without moving the camera. `cut(x, y)` assigns both current and previous coordinates to the supplied position. The engine's post-mount cut is the no-argument form, so scene setup must position the camera before returning.

Migration: no API change; documents existing behaviour.

Camera base and gameplay poses share interpolation; snapping happens after composing camera and pose, without simulation writes. Shake is a separate offset. Authors own previous/current component fields and register resets. Presentation systems that continue during freeze own separate particle values. Mounting initializes previous/current together.

### Interpolation and discontinuities

| Boundary                                | Responsibility and rendered result                                                                                                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mount                                   | Authors initialize all previous/current poses together, including effects and later spawns. After setup/world commit, NGNE cuts the camera and invokes ordinary reset callbacks before publication.                         |
| Ordinary update                         | NGNE calls `camera.beginTick()` before the schedule. Authors copy ordinary previous poses before moving them. Camera and sprite preparation use the same scene alpha.                                                       |
| Teleport / cut                          | Authors assign previous/current together for the affected actor and call `camera.cut(x, y)` for a camera cut. These are independent operations; cutting one does not reset the other.                                       |
| Freeze activation                       | After world commit and the full schedule, NGNE cuts the base camera and invokes ordinary reset callbacks. Ordinary poses are exact even at alpha 0.                                                                         |
| Frozen update / final countdown tick    | Ordinary poses stay fixed. Separate continuing effects update previous/current and interpolate with the frame alpha, including the tick whose countdown reaches zero. Do not force the entire scene to alpha 1 for hitstop. |
| First ordinary update after freeze      | Previous poses start at the frozen current pose; movement and camera resume with the same alpha.                                                                                                                            |
| Blocking scene publication / suspension | Lower scenes render with alpha 1 immediately, including on the push commit frame. All their systems and freeze countdown remain suspended.                                                                                  |
| Uncovered scene / host resume           | Use alpha 1 until that scene next updates, then use the shared frame alpha. Preserved component/camera values are not rewritten. Stopped games perform no render work.                                                      |

`SceneInstance.canInterpolate` is presentation eligibility, excluded from simulation
inspection. Stack selection and this flag choose the same alpha for `Frame.scene`
and the authored render callback; it changes no simulation state. Frame preparation
subtracts interpolated camera plus shake before `Math.round` when `pixelSnap` is true.
Screen-space sprites bypass camera/shake but still snap. Packed coordinates are
float32; JavaScript half-pixel rounding applies, including negative coordinates.

Migration: no API signature changes. Use the alpha supplied to the render callback;
do not substitute a host-captured alpha. Suspended/resumed frames now show current
poses instead of replaying stale interpolation. Continuing effects remain separate
from ordinary freeze reset callbacks, as demonstrated in Starfall and the fixture.

WebGPU uses the premultiplied pipeline and retained source ownership described above. The shared asset cache retains decoded data until disposal.

## Assets and audio

`ImageAsset extends Asset<ImageBitmap>` carries readonly `kind: "image"`.
`imageAsset()` uses explicit non-premultiplied, unconverted bitmap decoding; image
bytes are authored as sRGB. Custom image loaders must follow the same convention.
The WebGPU browser host waits for validated texture upload during preparation.
Setup still receives decoded values; no GPU handles enter components, assets,
prepared handles, Game state or enumeration. Headless preparation has no GPU hook.

The internal `PREPARE_ASSET` symbol returns a Promise of an optional synchronous,
idempotent cleanup callback. Game owns the CPU lease before awaiting that hook,
combines cleanup in GPU-before-CPU order and releases late results after cancellation.
All candidate-slot paths use this preparation function. Rejected decoded loads are
identity-evicted immediately, so a retry can begin while older consumers unwind.

WebGPU image entries are keyed by string ID and definition identity. Overlapping
consumers share one upload and one additional retained source lease. Cancellation
releases only its consumer; the final release unregisters bindings before destroying
the texture and releasing that lease. The decoded cache closes sources only on Assets
disposal. Conflicting/manual/leased IDs reject; empty ID is reserved for white.
Validation and out-of-memory scopes finish before readiness is published, including
when the copy throws synchronously. Failed uploads permit explicit retry.

`WebGPURenderer.texture(id, bitmapOrCanvas, signal?)` snapshots the caller's image
and retains its own bitmap until replacement/disposal. The caller can close or change
its original after resolution. Replacement is transactional; cancellation/failure
preserves the old ready binding. Already-premultiplied inputs may have lost precision
before snapshotting; the renderer cannot reconstruct those original bytes.

Asset identity must map to one definition object per service. Leases release once; loaded cache entries remain until disposal. Cancelling one consumer does not abort a load still needed by another. The last cancelled pending consumer aborts the loader. Late completion after cancellation disposes its returned value and cannot activate a scene.

Audio is an explicit roadmap addition. The playback device is optional until unlocked by a user gesture. Named scopes are internally instance-isolated, even with the same authored name. Effects use oscillator envelopes; clips use decoded AudioBuffers, optionally looping. Scope buses support independent gain; the master supports mute and ducking. Requests flush after simulation commit, and unmount removes queued/active scope voices before releasing scene asset leases. Scope and terminal disposal become final before cleanup, attempt every owned voice, gain and bus action, and aggregate failures; a failed cleanup cannot make that scope usable again. Unlock, resume and suspension failures propagate. Suspension clears queued requests before awaiting the device. Limits: 128 pending requests and 32 active voices; excess is dropped. Audio presentation state is outside simulation enumeration.

The engine provides no entity collision schema. Starfall owns a spatial grid resource and collision rules. Snapshot capture, restore, replay, editors and other deferred domains remain absent deliberately.
