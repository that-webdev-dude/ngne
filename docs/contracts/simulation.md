# Simulation contracts

These contracts define ECS storage and traversal, scene lifetime, committed state, events, freeze and deterministic randomness.

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

### Events, freeze and randomness

Events use the same validated plain-data copy/freeze on emit, broadcast on the next ordinary update, and are held through suspension/freeze. Frozen systems cannot emit gameplay events. Freeze requests use positive integer ticks and resolve to maximum duration at commit. Suspension pauses the countdown. Ordinary transform interpolation reset callbacks and camera cuts execute when freeze first activates.

RNG: FNV-1a over JSON-encoded seed parts, followed by Mulberry32 streams. Root input is hashed; scene seed derives from root/definition/key, and stream seed derives from scene seed/name. Explicit scene seed bypasses scene derivation. These algorithms have compatibility version 1. Rendering uses no simulation stream. `Random.snapshot()` returns the current uint32 state; `restore(state)` applies the same `>>> 0` normalization as construction. State is not directly writable, and scene enumeration uses `snapshot()`.
