![NGNE — TypeScript sprite engine](docs/assets/ngne.svg)

A TypeScript engine for 2D sprite games. Fixed-step simulation, scene-owned ECS worlds and instanced WebGL 2 rendering. **Zero runtime dependencies.**

[Play Starfall '89](https://that-webdev-dude.github.io/ngne/) · [Engine guide](docs/guide.md) · [First scene](https://that-webdev-dude.github.io/ngne/examples/hello/) · [MIT license](LICENSE)

![Starfall '89 gameplay](docs/assets/starfall.png)

**Early release · 0.1.0.** The engine exports independently from the showcase. Its API may change as more games exercise it. WebGL 2 is required; no editor, accounts or external game assets are needed.

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
import { component, type SceneDefinition } from "ngne";

const Position = component("position", () => ({ x: 40, y: 100 }));

const scene: SceneDefinition = {
    id: "hello",
    setup(scene) {
        scene.world.spawn(Position.of());
        const points = scene.world.query(Position);
        scene.system(({ dt }) => {
            points.each((_, p) => {
                p.x += 40 * dt;
            });
        });
        scene.render((frame) => {
            points.each((_, p) => frame.rect(p.x, p.y, 16, 16, 0x83e8e1));
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

During development, `/validation.html` exercises real WebGL pixels, batching, context loss/restoration and browser lifecycle. This page is excluded from the production build. `npm run bench` measures CPU workloads, not GPU time or universal frame-rate guarantees; `npx tsx tests/browser-baseline.ts` drives a sustained Chaos Lab run in a real Chromium against `npm run preview` and reports frame-time, dropped-tick and heap distributions. Recorded results live in [verification](docs/verification.md).

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
