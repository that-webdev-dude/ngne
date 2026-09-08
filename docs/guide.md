# Engine guide

Examples assume a TypeScript browser app with a canvas. Use the runnable [first scene](../examples/hello/index.html) in this checkout, or adapt the imports to your project. NGNE is not published to npm.

## Your first scene

```ts
import {
    BrowserGame,
    component,
    lerp,
    type SceneDefinition,
} from "ngne";

const Position = component("position", () => ({ x: 40, previousX: 40 }));
const scene: SceneDefinition = {
    id: "hello",
    setup(scene) {
        scene.world.spawn(Position.of());
        const points = scene.world.query(Position);

        scene.system(({ dt }) => {
            points.each((entity, position) => {
                position.previousX = position.x;
                position.x += 40 * dt;
            });
        });
        scene.resetInterpolation(() => {
            points.each((_, p) => {
                p.previousX = p.x;
            });
        });
        scene.render((frame, alpha) => {
            points.each((_, p) => {
                frame.rect(
                    lerp(p.previousX, p.x, alpha),
                    100,
                    16,
                    16,
                    0x83e8e1,
                );
            });
        });
    },
};

const app = new BrowserGame({
    canvas: document.querySelector("canvas")!,
    width: 640,
    height: 400,
    seed: "my-game",
    state: {},
    transition: (state) => state,
});
await app.start(await app.game.prepare(scene, { key: "first-room" }));
// await app.stop(); await app.start(); // preserve the mounted scene
// await app.dispose();                 // terminal; releases all owned services
```

Rectangles and sprites use **center coordinates**. Distances are logical canvas pixels; `dt` is seconds. Composition is fixed when an entity spawns. A query callback receives its entity and correctly inferred component values, with no casts or component lookups in the hot loop.

## Scene authoring

```ts
type Progress = { best: number };
type ProgressCommand = { type: 'score'; value: number };
const arena: SceneDefinition<Progress, ProgressCommand> = {
 id: 'arena',
 setup(scene) {
  const board = scene.resource('board', new Uint8Array(20 * 12));
  const waves = scene.random('waves');
  const score = scene.state();

  scene.system(ctx => {
    // All three are explicitly injected; there is no global resource registry.
    board[0] = waves.int(0, 4);
    if (ctx.input.pressed.includes('Space')) {
      scene.freeze(4);
      ctx.emit({ type: 'blast' });
      score.dispatch({ type: 'score', value: 100 });
    }
  });
  scene.system(ctx => {
    // Separate effects continue through hitstop.
  }, { runsDuringFreeze: true });
 }
};
```

Use the same state/command types on `SceneDefinition<S,C>` and `Game<S,C>`; `prepare()` checks compatibility and `scene.state()` infers access. Unparameterized definitions remain portable but cannot dispatch. State reads and transition inputs are deeply read-only. Initial state, dispatch payloads and transition results are copied and deeply frozen, so later changes to caller-owned data cannot change queued commands. Transitions must be synchronous and return plain data. Setup can read; only the owning scene's system update can dispatch. Plain objects, arrays, primitives and cycles are supported; built-ins, functions, accessors and symbol keys are rejected. See the [data contract](contracts/NGNE.md#committed-state-typing-and-ownership) for exact rules. Resources and RNG streams bind once during setup. Register cleanup immediately with `scene.defer()` or a resource cleanup argument.

Prepare scene candidates asynchronously using `game.prepare(definition, { key, signal })`. Preparation acquires assets but does not create a world. Use `ctx.scenes.push(candidate)`, `.set(candidate)`, or `.pop()` to request a boundary transition. A candidate belongs to one Game, is single-use, and can be abandoned with `.release()`. `blocksUpdateBelow: true` makes a pause/menu scene suspend lower simulation while preserving its rendered world.

## Assets, sprites and audio

`imageAsset(id, url)` and `audioAsset(id, url)` return definitions for shared decoded data. List definitions in a scene's `assets`; setup receives a map of leased values keyed by stable IDs. `game.assets.acquire(definition)` gives a manually managed lease for platform setup. Release it when finished. Renderer textures use the same stable authored IDs:

```ts
const lease = await app.game.assets.acquire(imageAsset("ships", "/ships.png"));
app.renderer!.texture(lease.id, lease.value); // upload after app.start()
lease.release();

// In frame preparation: normalized UV coordinates, radians, center position.
frame.sprite({
    x: 100,
    y: 100,
    width: 24,
    height: 24,
    texture: "ships",
    u: 0,
    v: 0,
    uw: 0.125,
    vh: 1,
    layer: 2,
});
```

Call `await app.audio.unlock()` from a user gesture. Create an audio scope during scene setup with `app.audio.scene('room')`, immediately register its `.dispose`, and enqueue `scope.play({ frequency: 440, duration: .15 })` or `scope.play({ buffer, loop: true, volume: .2 })` from systems. Requests flush after commit, never from render callbacks. Scopes have independent volume controls; `audio.duck(.25)` lowers the overall mix and `audio.duck(1)` restores it. Voice count and pending requests are bounded. The showcase includes synthesized effects and a tick-driven bass sequence.


## Entity lifetime and update order

Create queries once in setup and reuse them. Query callbacks receive the entity followed by component values in the requested order. Mutating a component value is immediate. Spawning and despawning are buffered: query membership changes only at the engine-owned commit after scheduled systems return. Entity composition is fixed at spawn; stale or foreign handles cannot address a different entity.

Systems receive `WorldAccess`, not commit or enumeration authority. For headless use,
create a `Game`, prepare/start a scene, then call `game.tick()`; the runtime owns world
commits. Direct `World` construction is internal. Queries expose only `size` and `each`.

For diagnostics, `game.scenes` returns frozen summaries with instance IDs, definition
ID strings, entity counts/capacities and freeze ticks. Compare instance IDs across
reads. `game.enumerate()` copies enumerable simulation data into a detached frozen
inspection result; it does not expose mutable resources or foreign worlds. Use
explicitly injected capabilities for gameplay writes. See the
[inspection contract and migration](contracts/NGNE.md#public-api-and-inspection).

Each tick runs selected scene systems, commits worlds, advances ordinary events, commits freeze and game-state commands, then applies scene commands in FIFO order. Events emitted now become visible on the next ordinary update. Frozen ordinary simulation retains events; systems marked `runsDuringFreeze` can continue presentation effects.

## Lifecycle and ownership

| Operation | Meaning |
| --- | --- |
| `game.prepare(definition, { key, signal })` | Acquire scene assets asynchronously; does not publish a world |
| `app.start(candidate)` | Start the browser host with its initial scene |
| `ctx.scenes.set(candidate)` | Replace the entire scene stack at a tick boundary |
| `ctx.scenes.push(candidate)` / `.pop()` | Change the scene stack at a tick boundary |
| `candidate.release()` | Abandon an unused prepared candidate |
| `app.stop()` / `app.start()` | Suspend and resume while preserving the mounted scene |
| `app.dispose()` | Terminal cleanup of owned services and scenes |

Bind resources, RNG streams and systems synchronously during setup. Register cleanup immediately with `scene.defer(() => service.dispose())`; the private mount owns rollback when setup fails. Do not add an alternative mount path or manually commit a scene world. Prepared candidates are single-use and belong to their preparing Game; stop invalidates unused candidates.

A `blocksUpdateBelow` scene suspends lower updates while retaining their rendering. Hitstop freezes ordinary systems for whole ticks; interpolation reset callbacks prevent rendering a stale in-between pose. Render callbacks prepare presentation from committed state and must not drive gameplay, consume simulation RNG or enqueue sound.

`Game` supports headless simulation; `BrowserGame` adds input, rendering, audio and frame scheduling. A failed simulation enters `Failed`, where only disposal is supported. See the [contract](contracts/NGNE.md) for the distinct rollback behavior of scene-command and startup failures.

Await `app.start()` and `app.stop()` before issuing another start/stop call. Those
overlaps reject before changing the active operation. `app.dispose()` can interrupt
either operation; a pending start then rejects and cannot enable frames. Repeated
disposal returns the same completion promise. Use the browser host's lifecycle
methods when it owns the Game. Calling `game.stop()` while already stopped also
cancels pending preparation and releases unused candidates.

## Audio example

After unlocking audio from a click or other user gesture, register a scope inside the scene's setup:

```ts
const sound = app.audio.scene("room");
scene.defer(() => sound.dispose());
scene.system(({ input }) => {
    if (input.pressed.includes("Space")) {
        sound.play({ frequency: 440, duration: 0.15 });
    }
});
```

The browser host flushes requests after simulation commit. Disposing the scene removes its queued and active voices. For a complete asset-free game using these APIs, read [Starfall](../demo/game.ts) and its [browser entry](../demo/main.ts).
