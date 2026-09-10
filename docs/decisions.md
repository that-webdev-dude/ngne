# Architecture Decisions

This document keeps alternatives and reasoning that would distract from the current rules in `architecture.md`.

## Game-owned committed state

**Status:** Accepted

### Decision

Each `Game` owns one game-authored state host. Authorized systems read one committed snapshot and enqueue typed commands. The engine applies those commands in dispatch order after scene updates and before scene-stack commands.

### Rationale

- Game lifetime lets progression survive scene replacement without a process-global singleton.
- One snapshot per tick prevents order-dependent reads across scenes.
- Committing before stack changes lets a newly mounted scene read the latest durable facts.
- The engine can control timing without understanding gameplay meaning.

### Alternatives not selected

| Alternative                            | Reason                                                          |
| -------------------------------------- | --------------------------------------------------------------- |
| Global mutable state                   | Has no `Game`-scoped lifetime and bypasses commit timing.       |
| Persistent state in every tick context | Hides dependencies and exposes it to every system.              |
| Transfer entities between scenes       | Crosses world ownership and creates competing sources of truth. |

### Consequences

- Changes are visible only after commit.
- Scene setup may read state but cannot enqueue changes.
- Durable scene results require explicit commands.
- Serialization remains deferred.

## Scene-owned resources with immediate mutation

**Status:** Accepted

### Decision

Non-entity scene data belongs to typed resources owned by one scene instance. Bindings are fixed during mounting. Their contents use the same immediate, registration-ordered visibility as component values.

### Rationale

- Grids, boards, and indexes keep their natural representation.
- Immediate mutation supports sequential algorithms without another command buffer.
- Explicit injection exposes dependencies and scene ownership guarantees cleanup.

### Alternatives not selected

| Alternative                                  | Reason                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| Model every value as an entity               | Adds unnecessary ECS and query overhead.                                  |
| Buffer every resource write                  | Makes sequential algorithms awkward and creates a second visibility rule. |
| Universal resource bag                       | Hides dependencies and gives every system broad access.                   |
| Store all scene data in committed game state | Gives temporary data the wrong lifetime.                                  |

### Consequences

- System order governs resource dependencies.
- State that must survive unmount is committed deliberately.
- Authoritative contents must be enumerable, but no snapshot registration API is required yet.

## Bounded fixed-step catch-up

**Status:** Accepted

### Decision

Each platform frame runs at most a fixed positive number of simulation ticks. When the budget is exhausted, the loop drops complete backlog, keeps only the interpolation remainder, and reports overload outside simulation.

### Rationale

- A finite limit prevents an unbounded catch-up loop.
- Fixed deltas preserve simulation rules.
- Keeping only the remainder allows valid interpolation after recovery.

### Alternatives not selected

| Alternative        | Reason                                                   |
| ------------------ | -------------------------------------------------------- |
| Unlimited catch-up | Can turn overload into a lasting spiral.                 |
| One enlarged tick  | Changes movement, collision, and deterministic behavior. |
| Retain all backlog | Keeps later frames under catch-up pressure.              |

### Consequences

- Simulation temporarily slows relative to wall time under severe overload.
- The default step, budget and overload reporting are pinned in the [contract](contracts/NGNE.md#platform-and-lifecycle).

## Scene-owned named RNG streams

**Status:** Accepted

### Decision

Each `Game` resolves one root seed. A scene instance derives named deterministic streams from that root, its definition identity, and an authored mount seed key. Stream state belongs to the scene and is explicitly injected.

### Rationale

- Scene ownership matches the lifetime of the state affected by the draws.
- Named streams isolate unrelated random decisions.
- Stable authored keys avoid accidental dependence on mount or creation order.
- Private mount ownership prevents failure from advancing active randomness.

### Alternatives not selected

| Alternative                   | Reason                                                           |
| ----------------------------- | ---------------------------------------------------------------- |
| Platform-global randomness    | Is outside simulation ownership and cannot be restored reliably. |
| One game-wide mutable stream  | Couples all scenes and systems to global draw order.             |
| Universal RNG in tick context | Hides dependencies and encourages accidental sharing.            |

### Consequences

- Shared streams remain registration-order dependent by design.
- RNG compatibility is part of replay and snapshot compatibility identity.
- Current stream state, not only its seed, must be enumerable.

## Binary gameplay-freeze gate

**Status:** Accepted

### Decision

Each scene owns one integer-tick gate. Ordinary systems are skipped while it is active; explicitly registered `runsDuringFreeze` systems continue. Requests publish at commit and overlapping requests choose the longest duration.

Gameplay timers that should pause use remaining-duration counters changed only by ordinary systems. The engine does not add a scene gameplay clock.

### Rationale

- One gate provides consistent hitstop without checks in every system.
- Commit-time activation lets the current schedule finish.
- Integer durations fit the fixed-step model.
- Counters avoid a second clock and timing model.

### Alternatives not selected

| Alternative                   | Reason                                                        |
| ----------------------------- | ------------------------------------------------------------- |
| Scene push or pop for hitstop | Uses heavyweight lifecycle machinery for frequent timing.     |
| Zero delta to all systems     | Still runs gameplay and requires every system to handle it.   |
| General time-domain graph     | Adds rules not required by binary hitstop.                    |
| Separate gameplay clock       | Gives authors two timing models when counters are sufficient. |

### Consequences

- Mixed gameplay and presentation behavior may need separate systems or values.
- Input buffering during hitstop opts into `runsDuringFreeze`.
- Fractional and per-entity time control remain deferred.

## Simulation-state snapshot boundary

**Status:** Accepted

### Decision

The architecture preserves one future simulation-state snapshot boundary immediately after a completed tick commit.

- Every authoritative simulation value has an explicit owner and is enumerable.
- Systems and closures cannot be its only owners.
- Stable authored identities exist where reconstruction would need them.
- Future environmental input is outside the boundary.
- No participant registry, capture structure, or restore lifecycle is defined yet.

### Rationale

- The completed commit is already the coherent point for worlds, game state, freeze, events, and the scene stack.
- Explicit ownership prevents later capture work from discovering hidden simulation state.
- Delaying registration and restore machinery avoids designing without a real consumer.

### Alternatives not selected

| Alternative                    | Reason                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| Define full restore now        | Requires compatibility, asset reacquisition, and failure rules without a consumer.         |
| Snapshot only ECS worlds       | Misses game state, resources, RNG, events, freeze, and scene identity.                     |
| Serialize every runtime object | Includes services, caches, closures, and platform resources that are not simulation state. |

### Consequences

- A replay also needs per-tick logical input, initial committed state, seeds, and compatibility identity.
- This decision does not promise restoration of an unmounted scene.
- Capture, restoration, save games, replay control, and rollback remain deferred.

## Fixed entity composition and buffered lifetime

**Status:** Accepted

### Decision

An entity receives its complete component set at spawn and keeps it until despawn. Whole-entity spawn and despawn are the only structural commands during active simulation, and both publish at scene-world commit.

### Rationale

- Fixed composition keeps query membership stable during iteration.
- One boundary gives births and deaths predictable visibility.
- Reusing released slots supports high churn without exposing pooling.

### Alternatives not selected

| Alternative                            | Reason                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------- |
| Runtime component addition and removal | Requires migration and component-lifecycle rules not currently needed. |
| Immediate spawn or despawn             | Can invalidate active iteration.                                       |
| Public object pools                    | Exposes a storage optimization as gameplay policy.                     |

### Consequences

- Optional behavior uses values, flags, or variants.
- A composition change replaces the entity and creates a new identity.
- Queued despawns remain visible unless gameplay first marks them inactive.

## Interpolation through suspension

**Status:** Accepted (NGNE-6)

Suspended scenes and resumed scenes awaiting their first update prepare camera and
sprites with alpha 1. A scene-local presentation flag records whether it has updated
since mounting/resume or the last suspended tick. Current stack policy also applies
on the frame a blocking scene mounts. The flag is not simulation state and is not
enumerated. Freeze alone does not disable interpolation for continuing effects.

Rewriting previous poses during suspension would change state that stop/resume must
preserve, and ordinary reset callbacks do not cover all continuing effects. Reusing
the host alpha instead replays stale motion as the accumulator cycles. Selecting
alpha at frame preparation avoids both problems without adding an authoring API.

## Owner-scoped candidate slots

**Status:** Accepted (NGNE-7)

### Decision

Each `Game` owns named speculative candidate slots scoped to a mounted scene
instance. Hosts declare the candidate definition, authored mount key and bounded
retry count. Taking a ready handle is explicit and single-use; the slot replenishes
while its owner remains mounted. Owner removal, release, stop and disposal cancel
pending work and release ready handles.

### Rationale

- Starfall and the platformer both need repeated pause and replacement candidates.
- Scene-instance ownership makes late completion harmless without a global registry.
- Slots remove duplicated readiness and lease bookkeeping while preserving explicit
  activation and tick-boundary commit order.

### Alternatives not selected

| Alternative                         | Reason                                                               |
| ----------------------------------- | -------------------------------------------------------------------- |
| Automatically activate on readiness | Makes asset timing control simulation and bypasses scene commands.   |
| Reusable prepared handles           | Conflicts with single-use lease transfer into one mounted instance.  |
| General scene router                | Adds addressing and message lifetime rules without another consumer. |

### Consequences

- Candidate readiness remains environmental input and is absent from simulation
  inspection.
- Retry count is explicit; final failure is reported through the Game diagnostic.
- Initial and one-off host transitions continue to use `Game.prepare()` directly.

## Cross-scene transient messaging

**Status:** Deferred

### Decision

Do not add a scene router yet. Current communication uses same-scene data and events, committed game state, scene-stack commands, or gameplay-scene frame preparation.

### Rationale

No current requirement demonstrates two independently mounted worlds exchanging transient messages. Deferring avoids inventing address exchange, bidirectional wiring, queue lifetime, and freeze behavior without a consumer.

### Reconsider when

A concrete message flow cannot use the existing boundaries. That decision must define how addresses are exchanged after mounting, delivery timing, removal behavior, and whether suspended or frozen recipients retain messages.
