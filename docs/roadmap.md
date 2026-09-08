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

NGNE-2 lifecycle hardening is implemented in `src/browser.ts` and `src/scene.ts`:
overlap rejection, terminal disposal, run-specific callbacks and stopped preparation
cancellation. Regression coverage lives in `tests/lifecycle.test.ts` and
`tests/browser-lifecycle-checks.ts`, invoked by `/validation.html`.

NGNE-3 committed-state hardening is implemented in `src/scene.ts` and
`src/primitives.ts`: typed scene/Game compatibility, deeply read-only snapshots,
validated plain-data graphs and dispatch-time command ownership. Regressions live in
`tests/state.test.ts` and the public declaration fixture `tests/api-misuse.ts`.

NGNE-4 combined simulation coverage lives in `tests/simulation.contract.test.ts`:
multi-scene commit order, inbox retention through suspension and freeze,
determinism across presentation/preparation timing, and first/middle/last FIFO
mount failures. All nine added scenarios pass without runtime changes.

NGNE-5 ownership audit is recorded in `docs/contracts/NGNE.md`, covering engine,
Starfall and hello state plus inspection limitations. Enumeration now includes fixed
tick duration and empty/live archetype order. `tests/ownership.test.ts` covers allocator
reuse and showcase render/stop/resume preservation; no snapshot registry was added.

NGNE-6 interpolation discontinuity coverage lives in `tests/interpolation.test.ts`
and the shared `tests/interpolation-scenario.ts`. `/validation.html` adds numeric/GPU
checks and selectable frames through `tests/browser-interpolation-checks.ts`.
`src/scene.ts` prevents stale movement replay during suspension and host resume;
continuing hitstop effects retain interpolation. See verification for local evidence.

## Next validation

- Exercise the authoring API in another small game before expanding it.
- Validate physical touch and gamepad controls and additional browsers.
- Add focused regression tests when those checks reveal defects.

## Deferred

Snapshot capture/restore, replay controllers, networking, editors, multiple views, local multiplayer, fractional time scaling, cross-scene messaging and multithreading remain deferred until a concrete game requires them. Enumeration is an inspection boundary, not a save format.

The [architecture](architecture.md), [capabilities](capabilities.md) and [decisions](decisions.md) retain the design rationale. The current [implementation contract](contracts/NGNE.md) defines the implemented choices. The [v00 audit](../prototypes/ngne/v00/AUDIT.md) preserves the original integrated promotion history; its prototype is not maintained alongside production.
