import assert from "node:assert/strict";
import { test } from "node:test";
import { Assets, imageAsset, type Asset, type ImageAsset } from "../src/assets.js";
import { audioAsset } from "../src/audio.js";
import { Game, PREPARE_ASSET, type PreparedScene } from "../src/scene.js";
import { WebGpuRuntime } from "../src/webgpu-runtime.js";
import { deferred, fakeBitmap, fakePlatform } from "./gpu-fixture.js";

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
test("evicting an unused parent releases dependency edges and reentrant cleanup cannot remove replacement identities", async () => {
    const assets = new Assets({ retention: { maxEntries: 0 } }),
        disposed: string[] = [];
    const dependency = item("dependency", 4, disposed);
    const root: Asset<import("../src/assets.js").Lease<number>> = {
        id: "root",
        load: () => assets.acquire(dependency, undefined, "dependency"),
        dispose: (lease) => lease.release(),
    };
    const first = await assets.acquire(root),
        second = await assets.acquire(root);
    first.release();
    assert.equal(assets.inspect().claims.dependency, 1);
    second.release();
    assert.equal(assets.inspect().loaded, 0);
    assert.deepEqual(disposed, ["dependency"]);
    const defaults = new Assets();
    let replacement: Promise<import("../src/assets.js").Lease<number>> | undefined;
    const next = item("reentrant");
    (
        await defaults.acquire({
            id: "reentrant",
            load: async () => 1,
            dispose: () => {
                replacement = defaults.acquire(next);
                throw Error("cleanup");
            },
        })
    ).release();
    assert.throws(() => defaults.evict("reentrant"), AggregateError);
    assert(replacement);
    const retained = await replacement;
    assert.equal(defaults.inspect().loaded, 1);
    assert.equal(defaults.inspect().cleanupFailures, 1);
    retained.release();
    defaults.dispose();
    assets.dispose();
});
function item(id: string, bytes = 4, disposed: string[] = []): Asset<number> {
    return {
        id,
        load: async () => bytes,
        estimateBytes: (value) => value,
        dispose: () => {
            disposed.push(id);
        },
    };
}
test("retention is opt-in; LRU budgets protect live oversize values and reload evicted identities", async () => {
    const disposed: string[] = [],
        a = item("a", 4, disposed),
        b = item("b", 4, disposed),
        c = item("c", 4, disposed);
    const defaults = new Assets();
    (await defaults.acquire(a)).release();
    assert.equal(defaults.inspect().loaded, 1);
    defaults.dispose();
    disposed.length = 0;
    const assets = new Assets({ retention: { maxEntries: 2, maxBytes: 8 } });
    (await assets.acquire(a)).release();
    (await assets.acquire(b)).release();
    (await assets.acquire(a)).release();
    (await assets.acquire(c)).release();
    assert.deepEqual(disposed, ["b"]);
    assert.deepEqual(
        assets.inspect().entries.map((e) => e.id),
        ["a", "c"],
    );
    const big = await assets.acquire(item("large", 16, disposed));
    assert.deepEqual(disposed, ["b", "a", "c"]);
    assert.equal(assets.inspect().protectedOverBudget, true);
    assert.equal(assets.evict("large"), false);
    big.release();
    big.release();
    assert.equal(assets.inspect().loaded, 0);
    let loads = 0;
    const repeated = { id: "again", load: async () => ++loads };
    (await assets.acquire(repeated)).release();
    assert.equal(assets.evict("again"), true);
    assert.equal((await assets.acquire(repeated)).value, 2);
    assets.dispose();
    for (const value of [-1, NaN, Infinity, 0.5])
        assert.throws(() => new Assets({ retention: { maxBytes: value } }));
});
test("frozen capped diagnostics retain full aggregates and separate claims from unique resources", async () => {
    const assets = new Assets({ retention: { maxEntries: 0, maxBytes: 0 } });
    const definition = item("shared");
    const scene = await assets.acquire(definition, undefined, "scene");
    const renderer = await assets.acquire(definition, undefined, "renderer");
    const dependency = await assets.acquire(definition, undefined, "dependency");
    const unknown = await assets.acquire({ id: "unknown", load: async () => ({}) });
    const gate = deferred<number>();
    const pending = assets.acquire({ id: "pending", load: () => gate.promise });
    const snapshot = assets.inspect(1);
    assert.equal(snapshot.loaded, 2);
    assert.equal(snapshot.loading, 1);
    assert.equal(snapshot.leased, 3);
    assert.equal(snapshot.estimatedBytes, 4);
    assert.equal(snapshot.unknownSizes, 1);
    assert.equal(snapshot.truncated, true);
    assert.deepEqual(snapshot.claims, { external: 2, scene: 1, dependency: 1, renderer: 1 });
    assert(
        Object.isFrozen(snapshot) &&
            Object.isFrozen(snapshot.entries) &&
            Object.isFrozen(snapshot.entries[0].claims),
    );
    scene.release();
    renderer.release();
    dependency.release();
    unknown.release();
    assert.equal(snapshot.loaded, 2);
    gate.resolve(1);
    (await pending).release();
    assert.equal(assets.inspect().loaded, 0);
    assert.equal(assets.inspect().loading, 0);
    assert.throws(() => assets.inspect(1001));
    assets.dispose();
    assert.equal(
        imageAsset("image", "unused").estimateBytes?.({ width: 3, height: 5 } as ImageBitmap),
        60,
    );
    assert.equal(
        audioAsset("audio", "unused").estimateBytes?.({
            length: 100,
            numberOfChannels: 2,
        } as AudioBuffer),
        800,
    );
});
test("cancelled loads cannot delete replacements; invalid estimates clean up; terminal disposal attempts every cleanup", async () => {
    const assets = new Assets({ retention: { maxEntries: 0 } }),
        late = deferred<number>();
    const abort = new AbortController();
    let closed = 0;
    const pending = assets.acquire(
        { id: "same", load: () => late.promise, dispose: () => closed++ },
        abort.signal,
    );
    const rejected = assert.rejects(pending);
    await turn();
    abort.abort();
    await rejected;
    const replacement = await assets.acquire(item("same"));
    late.resolve(4);
    await turn();
    assert.equal(closed, 1);
    assert.equal(assets.inspect().loaded, 1);
    replacement.release();
    await assert.rejects(
        assets.acquire({
            id: "invalid",
            load: async () => 1,
            estimateBytes: () => -1,
            dispose: () => closed++,
        }),
    );
    assert.equal(closed, 2);
    assert.equal(assets.inspect().loaded, 0);
    const failures: unknown[] = [];
    const throwing = new Assets({
        retention: { maxEntries: 0 },
        diagnostic: (e) => {
            failures.push(e);
            throw Error("observer");
        },
    });
    (
        await throwing.acquire({
            id: "auto",
            load: async () => 1,
            dispose: () => {
                throw Error("dispose");
            },
        })
    ).release();
    assert.equal(failures.length, 1);
    assert.equal(throwing.inspect().cleanupFailures, 1);
    assert.equal(throwing.inspect().loaded, 0);
    const terminal = new Assets();
    const attempted: number[] = [];
    for (let i = 0; i < 3; i++)
        await terminal.acquire({
            id: String(i),
            load: async () => i,
            dispose: () => {
                attempted.push(i);
                throw Error(String(i));
            },
        });
    assert.throws(
        () => terminal.dispose(),
        (e: unknown) => e instanceof AggregateError && e.errors.length === 3,
    );
    assert.deepEqual(attempted, [0, 1, 2]);
    assert.equal(terminal.inspect().loaded, 0);
    terminal.dispose();
    assert.deepEqual(attempted, [0, 1, 2]);
    await assert.rejects(terminal.acquire(item("after")));
});
test("flattened distinct content graphs are reclaimable across bounded eviction windows", async () => {
    const game = new Game({
        seed: 1,
        state: {},
        transition: (s) => s,
        assetRetention: { maxEntries: 3, maxBytes: 12 },
    });
    const disposed: string[] = [];
    // Document-resolution edges have ended; each scene explicitly owns its three flattened resources.
    for (let i = 0; i < 20; i++) {
        const candidate = await game.prepare(
            {
                id: `room-${i}`,
                assets: [
                    item(`snapshot-${i}`, 4, disposed),
                    item(`image-${i}`, 4, disposed),
                    item(`audio-${i}`, 4, disposed),
                ],
                setup() {},
            },
            { key: String(i) },
        );
        assert.equal(game.assets.inspect().claims.scene, 3);
        candidate.release();
        assert.equal(game.assets.inspect().loaded, 3);
        assert.equal(game.assets.inspect().unleased, 3);
    }
    assert.equal(disposed.length, 57);
    game.dispose();
    assert.equal(disposed.length, 60);
});
for (const outcome of ["transition", "cancel", "dispose"] as const)
    test(`zero-budget sources survive recovery during ${outcome}`, async () => {
        const game = new Game({
            seed: 1,
            state: {},
            transition: (s) => s,
            assetRetention: { maxEntries: 0, maxBytes: 0 },
        });
        const platform = fakePlatform(),
            runtime = await WebGpuRuntime.create(platform.canvas, 64, 64, () => {}, platform);
        const bitmaps = [fakeBitmap(), fakeBitmap()];
        const images: ImageAsset[] = bitmaps.map((b, i) => ({
            id: `image-${i}`,
            kind: "image",
            load: async () => b.image,
            estimateBytes: (v) => v.width * v.height * 4,
            dispose: (v) => v.close(),
        }));
        game[PREPARE_ASSET] = async (asset, signal) => {
            const image = images.find((i) => i === asset);
            if (!image) return;
            return runtime.acquire(
                image,
                await game.assets.acquire(image, signal, "renderer"),
                signal,
            );
        };
        let next: PreparedScene | undefined;
        await game.start(
            await game.prepare(
                {
                    id: "active",
                    assets: [images[0]],
                    setup: (s) =>
                        s.system((ctx) => {
                            if (next) {
                                ctx.scenes.set(next);
                                next = undefined;
                            }
                        }),
                },
                { key: "active" },
            ),
        );
        assert.deepEqual(game.assets.inspect().claims, {
            external: 0,
            dependency: 0,
            scene: 1,
            renderer: 1,
        });
        const upload = deferred<GPUError | null>();
        platform.devices[0].scopeWait = upload.promise;
        const abort = new AbortController();
        const pending = game.prepare(
            { id: "next", assets: images, setup() {} },
            { key: "next", signal: abort.signal },
        );
        const rejection = outcome === "transition" ? undefined : assert.rejects(pending);
        await turn();
        const replacement = deferred<void>();
        platform.delayDevice(replacement.promise);
        platform.devices[0].loss.resolve({ reason: "unknown", message: "controlled" });
        await turn();
        assert.equal(runtime.status, "recovering");
        game.assets.trim();
        assert.equal(bitmaps[0].closes, 0);
        if (outcome === "cancel") abort.abort();
        if (outcome === "dispose") {
            runtime.dispose();
            game.dispose();
        }
        if (rejection) await rejection;
        replacement.resolve();
        upload.resolve(null);
        if (outcome !== "dispose") {
            await runtime.ready();
            if (outcome === "transition") {
                next = await pending;
                game.tick();
                assert.equal(game.scenes[0].definition, "next");
            } else {
                assert.equal(game.scenes[0].definition, "active");
                assert.equal(bitmaps[1].closes, 1);
            }
            const gpu = runtime.inspect(0);
            assert.equal(gpu.sources, outcome === "transition" ? 2 : 1);
            assert.equal(gpu.estimatedTextureBytes, gpu.sources * 16 + 4);
            assert.equal(gpu.truncated, true);
            assert(Object.isFrozen(gpu.entries));
            assert.equal(bitmaps[0].closes, 0);
            runtime.dispose();
            game.dispose();
        }
        await turn();
        assert(bitmaps.every((b) => b.closes === 1));
        assert.equal(game.assets.inspect().loaded, 0);
        assert.equal(runtime.inspect().sources, 0);
    });
