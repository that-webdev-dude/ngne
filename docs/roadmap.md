# Roadmap

NGNE 0.1 is an early engine baseline with a playable showcase. The public API may change while more games exercise it.

## Implemented

- Dense archetype ECS with buffered entity lifetime.
- Per-scene worlds, resources, seeded RNG, events, hitstop and scene stacks.
- Committed game state, asynchronous asset preparation and owned cleanup.
- Fixed-step browser host, input, cameras and interpolation.
- Instanced WebGL 2 sprites, texture batching and context restoration.
- Scoped audio, synthesized effects and decoded clips.
- Starfall '89 and its Chaos Lab stress mode.
- NGNE-1: restricted public runtime access, read-only lifecycle/tick values,
  frozen scene summaries, detached enumeration and compile-time API misuse coverage.

See [verification](verification.md) for measured evidence and its limits.

## Next validation

- Exercise the authoring API in another small game before expanding it.
- Validate physical touch and gamepad controls and additional browsers.
- Add focused regression tests when those checks reveal defects.

## Deferred

Snapshot capture/restore, replay controllers, networking, editors, multiple views, local multiplayer, fractional time scaling, cross-scene messaging and multithreading remain deferred until a concrete game requires them. Enumeration is an inspection boundary, not a save format.

The [architecture](architecture.md), [capabilities](capabilities.md) and [decisions](decisions.md) retain the design rationale. The current [implementation contract](contracts/NGNE.md) defines the implemented choices. The [v00 audit](../prototypes/ngne/v00/AUDIT.md) preserves the original integrated promotion history; its prototype is not maintained alongside production.
