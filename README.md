# NGNE

A TypeScript 2D sprite engine, with **Starfall '89**, a complete retro survival shooter. Zero runtime dependencies. The engine exports independently from the game.

## Play

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. **Start Flight** begins a three-minute survival run.

- **WASD / arrows:** move. Weapons automatically target the nearest enemy.
- **Hold mouse:** aim manually. Gamepad left/right sticks move/aim.
- **Space / gamepad A:** nova blast, with a 15-second recharge.
- **P / Escape / gamepad Start:** pause. **M:** sound.
- Small screens have touch direction and nova buttons.
- **Chaos Lab:** 6,000 persistent particles, denser swarms and invulnerability. It is a stress demonstration, not the normal difficulty.

Scores and victories persist across scene replacement within the running Game, and reset on page reload. No accounts, external artwork, fonts, or downloaded game assets are needed.

## Build and verify

```sh
npm test
npm run typecheck
npm run build
npm run bench
```

The build produces a static game in `dist/` and ESM engine modules with TypeScript declarations in `dist/engine/`. Serve the game over HTTP. The engine entry point is `src/index.ts` during development, or `dist/engine/index.js` after building. The package export points to the latter. Nothing is published automatically.

While the development server runs, open `/validation.html` for real WebGL pixel, batching, device-loss, and browser lifecycle checks. This development-only page intentionally loses its own graphics context. See [verification evidence](docs/verification.md).

## Your first scene

```ts
import {
    BrowserGame,
    component,
    lerp,
    type SceneDefinition,
} from "./src/index.js";

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
setup(scene) {
  const board = scene.resource('board', new Uint8Array(20 * 12));
  const waves = scene.random('waves');
  const score = scene.state<{ best: number }, { type: 'score'; value: number }>();

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
```

Match `scene.state<S,C>()` to the `Game<S,C>` that mounts the definition. State transitions must be synchronous and return immutable-compatible plain data. Setup can read state; dispatch is allowed only during simulation. Resources and RNG streams bind once during setup. Register cleanup immediately with `scene.defer()` or a resource cleanup argument.

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

## Architecture and scope

The original [architecture](docs/architecture.md) and [capabilities](docs/capabilities.md) remain authoritative. Implementation contracts live in [docs/contracts](docs/contracts/NGNE.md).

Implemented: dense archetype ECS; buffered lifetime; per-scene worlds/resources/RNG; committed progression; scene stack and private mount rollback; events; hitstop; fixed-step browser loop; keyboard, pointer, gamepad and touch input; logical display; cameras and interpolation; shared asset leases; instanced sprites; WebGL restoration; audio; lifecycle and diagnostics.

Deferred as the docs require: save/restore and replay controllers, networking, editor, multiple views, local multiplayer, fractional time scaling and cross-world messaging. `enumerate()` exposes owned simulation data for inspection; it is **not** a serialization or restore format. Component and resource values remain live references. Give the Game an authored `compatibility` string identifying your game rules and assets before collecting replay inputs.

The renderer requires WebGL 2. Pixel art uses a fixed logical resolution scaled by CSS, so browser resizing never changes simulation coordinates. Actual speed depends on hardware and browser; the included measurements are local evidence, not a universal frame-rate guarantee.
