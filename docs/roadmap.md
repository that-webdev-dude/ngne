# Roadmap

NGNE 0.1 is an early engine baseline with a playable showcase. The public API may change while more games exercise it. This document records status and direction only: the [implementation contract](contracts/NGNE.md) defines current behaviour, [decisions](decisions.md) hold the reasoning and [verification](verification.md) holds dated evidence.

## Implemented

- Dense archetype ECS with buffered entity lifetime.
- Per-scene worlds, resources, seeded RNG, events, hitstop and scene stacks.
- Committed game state, asynchronous asset preparation and owned cleanup.
- Fixed-step browser host, input, cameras and interpolation.
- Instanced WebGL 2 sprites, texture batching and context restoration.
- Scoped audio, synthesized effects and decoded clips.
- Starfall '89 and its Chaos Lab stress mode.

| Ticket | Outcome                                                                                   | Regression coverage                                                                   |
| ------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| NGNE-1 | Restricted public runtime access, read-only lifecycle/tick, frozen summaries, enumeration | `tests/api-misuse.ts` compile-time fixture                                            |
| NGNE-2 | Browser lifecycle overlap rejection, terminal disposal, run-specific callbacks            | `tests/lifecycle.test.ts`, `tests/browser-lifecycle-checks.ts` via `/validation.html` |
| NGNE-3 | Typed, deeply read-only committed state with validated plain-data commands                | `tests/state.test.ts`, `tests/api-misuse.ts`                                          |
| NGNE-4 | Combined multi-scene commit order, suspension retention and mount-failure isolation       | `tests/simulation.contract.test.ts`                                                   |
| NGNE-5 | Simulation-state ownership inventory; enumeration adds `dt` and archetype order           | `tests/ownership.test.ts`                                                             |
| NGNE-6 | Alpha 1 through suspension and host resume; continuing hitstop effects interpolate        | `tests/interpolation.test.ts`, `tests/browser-interpolation-checks.ts`                |

## Direction

- A second game on the current engine (epic NGNE-17): the two-level platformer (NGNE-15) exercises the authoring API before it expands.
- Typed-array SoA component storage (NGNE-20), a WebGPU renderer (NGNE-21) and an owned simulation worker boundary (NGNE-22) are grouped under the SoA and WebGPU migration epic (NGNE-23). Their contracts are written when each lands; nothing about them is a requirement yet.

## Next validation

- Exercise the authoring API in another small game before expanding it.
- Validate physical touch and gamepad controls and additional browsers.
- Add focused regression tests when those checks reveal defects.

## Deferred

Snapshot capture/restore, replay controllers, networking, editors, multiple views, local multiplayer, fractional time scaling, cross-scene messaging and multithreading remain deferred until a concrete game requires them. Enumeration is an inspection boundary, not a save format.

Explicitly not required by the current [capabilities](architecture.md#required-capabilities):

- Progression: disk storage, save workflows and an engine-defined gameplay schema.
- Snapshots: capture, restoration, compatibility policy, storage formats, rollback and a snapshot-registration scheme for mutable resources.
- Scene state: board, tilemap, collision and hitbox schemas.
- Entity lifetime: public pooling, fixed capacity, allocation-free spawning and a final performance target.
- Randomness: a complete replay controller, a final RNG algorithm and cross-version migration.
- Cameras: multiple views and engine-authored camera behaviour.
- Freeze: fractional slow motion, named time domains, per-entity scaling and zero-delta updates.
- Preparation: a room graph, prediction manager, background scene simulation and mandatory eviction policy.
- Cross-world transient messaging: a general router is designed only when a concrete pair of independently mounted worlds needs it; that use case must establish addressing, timing and recipient-lifetime rules. Direct foreign-world access remains prohibited.
- Local multiplayer input is out of scope: the engine exposes one logical-player snapshot. Indexed players, controller assignment, hot-plug ownership and local co-op or versus routing require a scope change.
