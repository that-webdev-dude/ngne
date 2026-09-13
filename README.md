![NGNE — TypeScript sprite engine](docs/assets/ngne.svg)

A TypeScript engine for 2D sprite games. Fixed-step simulation, scene-owned ECS worlds and instanced WebGPU rendering, with a temporary WebGL 2 bridge. **Zero runtime dependencies.**

[Play Starfall '89](https://that-webdev-dude.github.io/ngne/) · [Engine guide](docs/guide.md) · [First scene](https://that-webdev-dude.github.io/ngne/examples/hello/) · [MIT license](LICENSE)

![Starfall '89 gameplay](docs/assets/starfall.png)

**Early release · 0.1.0.** The engine exports independently from the showcase. Its API may change as more games exercise it. Hello uses WebGPU; Starfall and the platformer still require WebGL 2. The initial WebGPU target is desktop Chromium with hardware acceleration on a secure origin (localhost or HTTPS); see the [tested hardware and limits](docs/verification.md#ngne-21--12-september-2026).

## Run locally

Use Node.js 24 or newer.

```sh
git clone https://github.com/that-webdev-dude/ngne.git
cd ngne
npm ci
npm run dev
```

Open the URL printed by Vite. Select **Start Flight** for a three-minute survival run. Open `/examples/hello/` for the minimal engine example or `/examples/platformer/` for the [two-level platformer](examples/platformer/README.md).

| Control                            | Action                              |
| ---------------------------------- | ----------------------------------- |
| WASD / arrows / gamepad left stick | Move                                |
| Hold mouse / gamepad right stick   | Aim manually; otherwise auto-target |
| Space / gamepad A                  | Nova blast, 15-second recharge      |
| P / Escape / gamepad Start         | Pause                               |
| M                                  | Toggle sound                        |

Small screens offer touch controls. **Chaos Lab** adds 6,000 persistent particles and invulnerability for stress testing. Scores persist across scenes within the running game and reset on reload.

## Build a game

Create components, spawn entities during scene setup, register update systems and prepare draw commands. NGNE owns the fixed-step loop and scene cleanup.

```ts
import { component, f64, type SceneDefinition } from "ngne";

const Position = component("position", { x: f64(40), y: f64(100) });

const scene: SceneDefinition = {
    id: "hello",
    setup(scene) {
        scene.world.spawn(Position.of());
        const points = scene.world.query(Position);
        scene.system(({ dt }) => {
            points.eachChunk((chunk) => {
                const position = chunk.views.position;
                for (let row = 0; row < chunk.count; row++) position.x[row] += 40 * dt;
            });
        });
        scene.render((frame) => {
            points.eachChunk((chunk) => {
                const position = chunk.views.position;
                for (let row = 0; row < chunk.count; row++)
                    frame.rect(position.x[row], position.y[row], 16, 16, 0x83e8e1);
            });
        });
    },
};
```

Positions are sprite centers in logical pixels; `dt` is seconds. See the [runnable first scene](examples/hello/main.ts) for browser startup and smooth interpolation, then the [engine guide](docs/guide.md) for lifecycle, committed state, resources, interpolation, assets, audio and diagnostics. The [implementation contract](docs/contracts/NGNE.md) defines exact semantics and migration notes.

NGNE is not published to npm. Build this checkout to obtain ESM modules and declarations in `dist/engine/`; the entry point is `dist/engine/index.js`. The demo and hello example consume that same package entry point, and the build checks forbidden API usage against the emitted declarations.

## Verify

```sh
npm run format:check
npm test
npm run typecheck
npm run build
npm run preview
```

`npm run format` applies Prettier; `.editorconfig` and `.gitattributes` keep 4-space indentation and LF line endings on every platform.

During development, `/validation.html` exercises real WebGPU and WebGL pixels, batching, controlled device/context loss, image readiness and browser lifecycle. This page is excluded from the production build. `npm run bench` measures CPU workloads, not GPU time or universal frame-rate guarantees; `npx tsx tests/browser-baseline.ts` drives sustained game runs or the fixed renderer fixture in a visible Chromium. Recorded results and reproduction commands live in [verification](docs/verification.md).

GitHub Actions runs the format check, tests, typechecking and the build on pull requests and pushes to `main`. Successful main builds deploy the showcase to GitHub Pages. See [verification evidence and hardware limits](docs/verification.md).

## Documentation

| Document                                          | Purpose                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| [Engine guide](docs/guide.md)                     | Authoring examples and lifecycle rules                           |
| [Architecture](docs/architecture.md)              | Authoritative ownership, runtime model and required capabilities |
| [Implementation contract](docs/contracts/NGNE.md) | Precise implemented semantics and migration notes                |
| [Decisions](docs/decisions.md)                    | Design rationale                                                 |
| [Roadmap](docs/roadmap.md)                        | Status, direction and deferred work                              |
| [Verification](docs/verification.md)              | Dated evidence and hardware limits                               |
| [Showcase design](demo/DESIGN.md)                 | Starfall '89 art direction                                       |
| [Platformer](examples/platformer/README.md)       | Controls, demonstrated capabilities and authoring findings       |

## Contribute

Change `src/` for the engine, `demo/` for Starfall and `tests/` for regression coverage. Run the checks above; use browser validation for rendering or browser lifecycle changes. Update the owning document (contract for semantics, guide for usage) when behavior changes. Keep fixes small and report reproduction steps in issues.

Historical prototype: the frozen `prototypes/ngne/v00` snapshot was removed in NGNE-18 and lives in Git history. Recover it with `git checkout 1c8a76b -- prototypes/` or inspect a file with `git show 1c8a76b:prototypes/ngne/v00/AUDIT.md`.

## License

[MIT](LICENSE), including the engine and original showcase assets.
