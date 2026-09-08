# Engine Capabilities

This document states what the architecture must accommodate. It does not prescribe APIs or storage formats.

| Capability | Status |
| --- | --- |
| Persistent progression | Required |
| Simulation snapshot readiness | Required |
| Grid, tilemap, and non-entity scene state | Required |
| Entity lifetime and structural churn | Required |
| Deterministic randomness | Required |
| Camera interpolation and pixel snapping | Required |
| Gameplay-local freeze | Required |
| Speculative scene preparation | Required |
| Cross-world transient messaging | Deferred |
| Fractional and selective time scaling | Deferred |
| Local multiplayer input | Out of scope |

## Persistent progression

Game-authored facts must survive scene replacement, suspension, and stop/resume for the lifetime of one `Game`.

- Scenes reconstruct entities from current persistent facts rather than transferring entities between worlds.
- Stable authored identities can represent room history such as opened chests or defeated bosses.
- Separate `Game` instances remain isolated.
- Newly mounted and already active authorized scenes can read the latest committed facts.

Disk storage, save workflows, and an engine-defined gameplay schema are not required yet.

## Simulation snapshot readiness

One completed tick must expose a coherent simulation-state boundary.

- Every authoritative simulation value has an explicit owner and is enumerable.
- Systems and closures are not the only owners of authoritative state.
- Stable definition identities, mount seed keys, and asset handles exist where reconstruction would need them.
- Future environmental input is outside the snapshot boundary.

Capture, restoration, compatibility policy, storage formats, and rollback are not required yet. Mutable resources do not need a formal snapshot-registration scheme until a real consumer exists.

## Grid, tilemap, and non-entity scene state

Scene-local data may use its natural representation instead of becoming ECS entities.

- Dense boards may use arrays or grids.
- Static definitions may remain immutable asset data.
- Mutable overlays, collision indexes, and similar structures have scene-instance lifetime.
- Separate mounts remain isolated; suspension preserves them and unmount releases them.
- Selected durable results can be committed without making all local data persistent.

The engine does not define board, tilemap, collision, or hitbox schemas.

## Entity lifetime and structural churn

The engine must support frequent whole-entity creation and destruction with deterministic visibility.

- Pending spawns are invisible until commit.
- Queued despawns remain visible for the current update.
- Stale handles cannot silently target reused storage.
- Storage growth follows live or peak demand, not cumulative spawn count.

Public pooling, fixed capacity, allocation-free spawning, and a final performance target are not required.

## Deterministic randomness and replay input

Gameplay randomness must be reproducible and isolated from platform timing.

- Stable root, mount, and stream seeds reproduce the same draws under compatible simulation rules.
- Adding draws to one named stream does not advance another.
- RNG state survives suspension and stop/resume and is enumerable for snapshots.
- Rendering, wall-clock time, platform entropy, and asynchronous completion cannot affect simulation draws.
- Replay input is a recorded logical snapshot for every simulation tick, not a recording of platform events.
- Replay prerequisites include initial committed game state and compatibility identity for the engine, RNG, game, and authored asset data.

A complete replay controller, final RNG algorithm, and cross-version migration are not required yet.

## Camera interpolation and pixel snapping

Fixed-step movement and the base camera must interpolate together without relative judder.

- Mounting, teleporting, camera cuts, and freeze activation can reset interpolation cleanly.
- A scene may snap composed output to its target pixel grid after interpolation.
- Interpolation and snapping never mutate simulation state.
- Frozen ordinary gameplay poses remain exact. Continuing presentation effects own separate values.

Multiple views and engine-authored camera behavior are deferred.

## Gameplay-local freeze

The engine must support deterministic integer-tick hitstop without scene-stack changes or checks in every ordinary system.

- Requests take effect after the current schedule and overlapping requests choose the longest duration.
- Ordinary gameplay pauses while selected input buffering or presentation systems may continue.
- Suspension pauses the freeze countdown.
- Gameplay timers use counters changed only by ordinary systems; no second gameplay clock is required.
- Gameplay events wait until ordinary gameplay resumes.
- Freeze state survives stop/resume and is enumerable.

Fractional slow motion, named time domains, per-entity scaling, and zero-delta updates are not required.

## Speculative scene preparation

A game may prepare a likely scene without mounting or activating it.

- The current stack remains active during asynchronous preparation.
- Completion order never changes simulation automatically.
- A prepared result activates only through a later command at a tick boundary.
- Cancellation or release safely gives up unused leases.

A room graph, prediction manager, background scene simulation, and mandatory eviction policy are not required.

## Cross-world transient messaging

**Status:** Deferred

Current needs are covered by same-scene state and events, committed durable state, scene-stack commands, and gameplay-scene frame preparation. A general router will be designed only when a concrete pair of independently mounted worlds needs transient communication; that use case must establish addressing, timing, and recipient-lifetime rules.

Direct foreign-world access remains prohibited.

## Local multiplayer input

**Status:** Out of scope

The current target exposes one logical-player input snapshot. Indexed players, controller assignment, hot-plug ownership, and local co-op or versus routing require a future scope change.
