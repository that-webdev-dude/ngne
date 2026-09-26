import { test } from "node:test";
import assert from "node:assert/strict";
import { Game, Frame, emptyInput } from "../../src/index.js";
import type { Asset, Audio, ImageAsset } from "../../src/index.js";
import { arena, type Progress, type ProgressCommand } from "../game.js";
const create = () =>
    new Game<Progress, ProgressCommand>({
        seed: "test",
        state: { best: 0, lastScore: 0, runs: 0, victories: 0 },
        transition: (s, c) => ({
            ...s,
            best: Math.max(s.best, c.score),
            lastScore: c.score,
            runs: s.runs + 1,
            victories: s.victories + (c.won ? 1 : 0),
        }),
    });
test("showcase runs deterministically with churn and rendered sprites", async () => {
    const a = create(),
        b = create();
    for (const g of [a, b])
        await g.start(await g.prepare(arena({ attract: true }), { key: "test" }));
    for (let i = 0; i < 600; i++) {
        a.tick();
        b.tick();
    }
    assert.equal(JSON.stringify(a.enumerate()), JSON.stringify(b.enumerate()));
    const frame = new Frame();
    a.render(frame, 0.5);
    assert.ok(frame.count > 200);
    assert.ok(a.scenes[0].entityCapacity < 2000);
    a.dispose();
    b.dispose();
});
test("chaos survives a full run, commits victory and high score, uses bounded live storage", async () => {
    const g = create();
    await g.start(await g.prepare(arena({ stress: true }), { key: "chaos" }));
    for (let i = 0; i < 11000; i++) g.tick(emptyInput());
    assert.equal(g.state.runs, 1);
    assert.equal(g.state.victories, 1);
    assert.ok(g.state.best > 0);
    assert.ok(g.scenes[0].entityCapacity < 20000);
    g.dispose();
});

test("arena setup receives the decoded atlas unchanged and no component field or resource holds it", async () => {
    const decoded = { decoded: "atlas" } as unknown as ImageBitmap;
    const counts = { loads: 0, disposals: 0 };
    const atlas: ImageAsset = {
        id: "ships",
        kind: "image",
        async load() {
            counts.loads++;
            return decoded;
        },
        dispose(value) {
            assert.equal(value, decoded);
            counts.disposals++;
        },
    };
    const definition = arena({ atlas });
    const received: unknown[] = [];
    const game = create();
    await game.start(
        await game.prepare(
            {
                ...definition,
                setup(scene) {
                    received.push(scene.assets.get(atlas.id));
                    definition.setup(scene);
                },
            },
            { key: "atlas" },
        ),
    );
    for (let tick = 0; tick < 120; tick++) game.tick();
    assert.deepEqual(received, [decoded]);
    assert.equal(received[0], decoded);
    const scene = game.enumerate().scenes[0];
    // Resource names are audited in the contract inventory; none is an asset holder.
    assert.deepEqual(Object.keys(scene.resources), ["run", "stars", "collision-grid", "player"]);
    const world = scene.world as unknown as {
        archetypes: { fields?: { fields: { kind: string }[] }[] }[];
    };
    const kinds = world.archetypes.flatMap((archetype) => {
        assert.ok(archetype.fields, "Starfall archetypes use schema storage");
        return archetype.fields.flatMap((component) => component.fields.map((field) => field.kind));
    });
    assert.ok(kinds.length > 0);
    assert.ok(kinds.every((kind) => ["f64", "u8", "u32", "bool"].includes(kind)));
    assert.equal(counts.loads, 1);
    game.dispose();
    assert.equal(counts.disposals, 1);
});

test("showcase looping music reuses decoded data and releases every replaced scope", async () => {
    const buffer = {} as AudioBuffer;
    let loads = 0;
    let assetDisposals = 0;
    const music: Asset<AudioBuffer> = {
        id: "starfall-music",
        async load() {
            loads++;
            return buffer;
        },
        dispose(value) {
            assert.equal(value, buffer);
            assetDisposals++;
        },
    };
    const scopes: { clips: { buffer: AudioBuffer; loop?: boolean }[]; disposed: boolean }[] = [];
    const audio: Pick<Audio, "scene"> = {
        scene() {
            const scope = {
                clips: [] as { buffer: AudioBuffer; loop?: boolean }[],
                disposed: false,
            };
            scopes.push(scope);
            return {
                play(sound) {
                    if ("buffer" in sound)
                        scope.clips.push({ buffer: sound.buffer, loop: sound.loop });
                },
                volume() {},
                dispose() {
                    scope.disposed = true;
                },
            };
        },
    };
    const game = create();
    await game.start(
        await game.prepare(arena({ audio, music }), {
            key: "run-0",
        }),
    );
    for (let run = 1; run <= 3; run++) {
        game.set(await game.prepare(arena({ audio, music }), { key: `run-${run}` }));
        game.tick();
        assert.ok(scopes.slice(0, -1).every((scope) => scope.disposed));
    }
    assert.equal(loads, 1);
    assert.equal(scopes.length, 4);
    assert.ok(
        scopes.every(
            (scope) =>
                scope.clips.length === 1 &&
                scope.clips[0].buffer === buffer &&
                scope.clips[0].loop === true,
        ),
    );
    game.dispose();
    assert.ok(scopes.every((scope) => scope.disposed));
    assert.equal(assetDisposals, 1);
});
