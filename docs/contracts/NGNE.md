# NGNE implementation contracts

These contracts pin the previously deferred API and storage choices. The high-level architecture remains authoritative.

## Public API and inspection

The package entry point is the supported boundary. Runtime modules are internal;
the package export map exposes no subpaths. The NGNE-1 consumer inventory is:

| Category | Public symbols | Consumers and ownership |
| --- | --- | --- |
| Authoring | `component`; types `Component`, `ComponentValue`, `Entity`, `Query`, `WorldAccess`; `SceneDefinition`, `SceneSetup`, `SystemContext`, `SceneCommands`, `SceneEvent`, `StateAccess`, `DeepReadonly`, `PreparedScene` | Starfall, hello and authoring tests. Setup injects scene capabilities; systems cannot commit, enumerate, or change query membership. Candidates expose only idempotent `release()`; the owning Game validates handle identity and consumes them. |
| Authoring and presentation | `Camera`, `Random`, `clamp`, `lerp`, `seedOf`, `down`, `pressed`, `imageAsset`, `audioAsset`; types `Asset`, `Lease`, `Sprite`, `Sound`, `Clip` | Scene authors use explicitly acquired/injected values. Constructors operate on caller-owned values; inspection never returns a live camera or RNG. |
| Platform integration | `Game`, `BrowserGame`, `Assets`, `Input`, `Frame`, `Renderer`, `Audio`, `FixedStep`, `emptyInput`; types `GameOptions`, `BrowserOptions`, `FrameScheduler`, `DisplaySnapshot`, `InputSnapshot`, `Stats` | Browser host, headless runners, renderer/audio/asset tests and benchmarks. Host lifecycle, tick, render and service operations remain intentional integration APIs. |
| Inspection | `Lifecycle`, `SceneInspection`, `SceneStateInspection`, `GameInspection`, `InspectionValue` | Tests, benchmark capacity reporting and diagnostics. No mutable foreign world or resource binding is returned. |
| Internal only | `World`, query runtime, `SceneInstance`, candidate runtime, `Cleanup`, `immutable`, browser failure capability | Runtime modules; direct ECS tests and benchmark import their internal modules deliberately. No public runtime constructor for scenes, queries or prepared candidates. |

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

Migration: replace `scene.definition.id` with `scene.definition`,
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

| State / classification | Owner and inspection / reconstruction considerations |
| --- | --- |
| Global simulation state | `Game`: tick, root seed, committed state, next instance ID; `enumerate()` includes these plus fixed `dt` in seconds and engine/RNG/authored compatibility string. |
| Mounted scene state | Stack order, instance ID, definition ID, key, resolved seed and blocking policy; scene summaries preserve these. Resources are keyed by unique nonempty names within each mount. |
| ECS values and identity | World owns component columns and immutable index/generation/world handles. Component names identify composition; conflicting definition objects with the same name are rejected on spawn. Names are world-local, not a global schema registry. |
| Allocator and iteration history | World owns slot generations, row positions, pending flags, free-stack order, archetype creation order and dense row order. Inspection includes `archetypes` with ordered component names and entity indices, **including empty archetypes**; `entities` retains values in archetype/row order. Empty archetypes cannot be reconstructed from live entities alone. |
| Scene simulation state | Named RNG current uint32 states, resources, event inbox/outbox, pending/remaining freeze and camera fields. Suspension and stop/resume preserve mounted state; unmount releases it. Camera state must be treated as authoritative when gameplay reads it. |
| Tick-local work | Game owns selected update plan, current updating scene, state/scene command queues and busy flag; worlds own pending births/deaths. Ordinary local variables such as aim search, collision iteration and spawn temporaries do not persist across updates. Queues normally drain at completed commit; suspended event inboxes intentionally persist. |
| Starfall durable facts | Game state owns `best`, `runs`, `victories`, `lastScore`; finish commands capture score/win before transition. |
| Starfall gameplay | `run` owns phase, score, wave, seconds/ticks, hp, bomb, combo/countdown, stress, spawn/shot timers, invulnerability, boss-wave and finished flag. `player` resource owns its handle. `position` and `body` own poses, velocity, radius, hp, active/kind, age and cooldown. `waves` RNG owns spawn/drop randomness. |
| Starfall derived cache | `collision-grid` resource stores borrowed entity/position/body references. Every continuing ordinary gameplay update clears and rebuilds it before collision reads. At commit it can retain references to removed entities; it is not an additional authority or a list of current entities. Query match/column caches are likewise derived from definitions and archetypes, preserving their order. |
| Starfall presentation within simulation | `visual`, previous poses, `particle` values, `effects` RNG, `run.shake/flash`, camera shake and `stars` are scene-owned and inspectable. Particle updates continue through freeze and share ECS allocation with gameplay: their lifetime cannot be omitted when reproducing allocator identity. Stars are generated once using `waves`, so mount-time draws are part of deterministic setup. |
| Immutable authoring | Component factories/names, scene setup/ID/policy, ordered systems and freeze flags, reset/render callbacks, transition function, arena attract/stress/reduced-motion options, dimensions, sprite/atlas definitions and texture key `ships`. These are code/configuration, not serialized values. Treat supplied definitions/options as fixed; readonly typing does not deep-freeze arbitrary authored objects or callback captures. |
| Host intent and preparation | Game owns candidate handles/status/leases, pending abort controllers and queued host scene commands. Demo host owns pause/result candidate references, preparation/ready guards and launch intent. These are external activation inputs, not hidden gameplay progression. Availability and authored activation tick/key must also match for repeatability; input snapshots alone do not record DOM launch/pause/visibility commands. |
| Platform input / timing | `Input` owns held/edge/pointer/gamepad state pending consumption; BrowserGame owns display, scheduler/run token, lifecycle guards, clock, FixedStep accumulator/budget and telemetry. These control future environmental input and platform frames, outside simulation-state inspection. A game reading display data needs the same supplied display values too. |
| Assets and presentation services | Assets owns definitions, loads, decoded cache and refcounts; scene cleanup owns leases. Renderer owns texture sources/GPU objects/context state; Frame owns reusable draw buffers and sorting. Audio owns requests, voices, scope identity/disposal, buses/mute/ducking and device. These are rebuilt or resumed through their services, not simulation capture. |
| Demo UI and hello | DOM `view`/`presentation`, prior phase, metrics/times and UI readiness are host/presentation state. View copies do not grant gameplay mutation. Hello's moving/previous X values are components; its query/callbacks contain no mutable gameplay counters. Art generation has only call-local drawing work. |

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

Migration: inspection adds `dt` and `world.archetypes`; existing fields retain their
meaning. Diagnostic readers should accept these additive fields and never rebuild
iteration order from only `world.entities`.

## ECS

`component(name, factory)` creates a stable typed definition; `.of(overrides)` creates a value. Names must be nonempty and unambiguous within a world. Complete component values are supplied to `spawn`. Queries are cached and match archetypes created later. Query membership does not change before commit. Value changes are immediate. `despawn` is idempotent; pending births can also be despawned at the same boundary.

Storage: dense entity/column arrays per fixed composition, a generation-bearing slot allocator, a free stack, and swap removal. Storage follows peak demand. Handles contain world identity, slot and generation. Systems receive `WorldAccess`, which excludes commit/enumeration. The private scene runtime commits after all selected schedules finish. No runtime component changes or public pools exist.

Query callbacks may enqueue lifetime changes, but cannot commit during iteration. Disposal empties existing query storage. Component definitions, query plans and callbacks are code; authoritative values and allocator state are inspectable through `Game.enumerate()`. The internal world enumeration is runtime-owned.

## Scenes and state

Definitions contain identity, assets, policy and synchronous setup. Candidates are asynchronous leased intent, owned by exactly one Game, consumed once. `key` is authored, not allocated from timing or load order. Explicit scene seeds are uint32. Stop/dispose cancels pending preparation and releases unconsumed candidates. Shared loads remain available to other live consumers.

Private mounting owns a reverse cleanup stack before setup runs. Setup binds resources and named RNG, registers the immutable system schedule, initial entities and frame preparation. Setup failures dispose everything acquired, report aggregated cleanup errors, and never publish the partial world. `set` mounts first, then unmounts old scenes. Cleanup failures never republish a torn-down scene.

Tick order is selected scene updates, world commits, ordinary event advances, freeze commits, authored state commands, then FIFO scene commands. A failing scene command preserves all preceding commits and successful commands, discards later commands and leaves the Game Running. Arbitrary system/transition faults enter Failed. Only disposal is then supported.

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

RNG: FNV-1a over JSON-encoded seed parts, followed by Mulberry32 streams. Root input is hashed; scene seed derives from root/definition/key, and stream seed derives from scene seed/name. Explicit scene seed bypasses scene derivation. These algorithms have compatibility version 1. Rendering uses no simulation stream.

## Platform and lifecycle

Browser lifecycle overlaps:

| Call while another operation is pending | Result |
| --- | --- |
| `start()` or `stop()` during start/resume or stop | Reject before side effects; the original operation continues. Await it before retrying. |
| `dispose()` during start/resume | Immediately disable frames and begin all teardown; late start success rejects as cancelled, and late failure retains its original error. Neither changes terminal lifecycle. |
| `dispose()` during stop | Begin teardown immediately. Stop may settle successfully or reject its own failures; it cannot replace `Disposed` with `Failed`. |
| Repeated `dispose()` | Return the same promise, including its aggregated rejection; cleanup is attempted once. |
| Start/stop after disposal begins | Reject without recreating services. |

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

Default step: 1/60 second; budget: five ticks per platform frame. Excess whole ticks are dropped and reported, fractional remainder retained. No variable simulation delta. Display dimensions are fixed logical pixels; the backing canvas matches them and CSS scales presentation. Each frame latches display once. Each consuming tick receives one frozen input snapshot shared by every selected scene; pending edges survive frames without ticks. Native key codes, `Pointer0`, `Pad0` etc. identify inputs; a snapshot exposes held/pressed/released arrays, normalized gamepad axes, logical pointer coordinates/deltas and wheel delta. Hot-plug ownership/local multiplayer are not implemented.

## Renderer

`Frame` packs 13 float32 values per sprite: centered XY/size, normalized UV rectangle, RGBA, rotation radians. Sorting uses scene, layer, depth and insertion. Contiguous texture runs batch safely without texture-driven reordering. One drawArraysInstanced call per run. Reusable CPU/GPU buffers grow geometrically. There is no per-entity GPU object. Renderer sees no ECS or scene runtime.

Camera base and gameplay poses share interpolation; snapping happens after composing camera and pose, without simulation writes. Shake is a separate offset. Authors own previous/current component fields and register resets. Presentation systems that continue during freeze own separate particle values. Mounting initializes previous/current together.

### Interpolation and discontinuities

| Boundary | Responsibility and rendered result |
| --- | --- |
| Mount | Authors initialize all previous/current poses together, including effects and later spawns. After setup/world commit, NGNE cuts the camera and invokes ordinary reset callbacks before publication. |
| Ordinary update | NGNE calls `camera.beginTick()` before the schedule. Authors copy ordinary previous poses before moving them. Camera and sprite preparation use the same scene alpha. |
| Teleport / cut | Authors assign previous/current together for the affected actor and call `camera.cut(x, y)` for a camera cut. These are independent operations; cutting one does not reset the other. |
| Freeze activation | After world commit and the full schedule, NGNE cuts the base camera and invokes ordinary reset callbacks. Ordinary poses are exact even at alpha 0. |
| Frozen update / final countdown tick | Ordinary poses stay fixed. Separate continuing effects update previous/current and interpolate with the frame alpha, including the tick whose countdown reaches zero. Do not force the entire scene to alpha 1 for hitstop. |
| First ordinary update after freeze | Previous poses start at the frozen current pose; movement and camera resume with the same alpha. |
| Blocking scene publication / suspension | Lower scenes render with alpha 1 immediately, including on the push commit frame. All their systems and freeze countdown remain suspended. |
| Uncovered scene / host resume | Use alpha 1 until that scene next updates, then use the shared frame alpha. Preserved component/camera values are not rewritten. Stopped games perform no render work. |

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

WebGL 2 is required. Transparent straight-alpha sprites use nearest sampling, source-alpha blending, no depth and no MSAA. The renderer owns texture uploads and retains decoded sources for context restoration. Shared asset cache retains decoded data until disposal. Device loss skips submission and restoration recreates shaders, buffers, VAO and textures.

## Assets and audio

Asset identity must map to one definition object per service. Leases release once; loaded cache entries remain until disposal. Cancelling one consumer does not abort a load still needed by another. The last cancelled pending consumer aborts the loader. Late completion after cancellation disposes its returned value and cannot activate a scene.

Audio is an explicit roadmap addition. The playback device is optional until unlocked by a user gesture. Named scopes are internally instance-isolated, even with the same authored name. Effects use oscillator envelopes; clips use decoded AudioBuffers, optionally looping. Scope buses support independent gain; the master supports mute and ducking. Requests flush after simulation commit, and unmount removes queued/active scope voices. Limits: 128 pending requests and 32 active voices; excess is dropped. Audio presentation state is outside simulation enumeration.

The engine provides no entity collision schema. Starfall owns a spatial grid resource and collision rules. Snapshot capture, restore, replay, editors and other deferred domains remain absent deliberately.
