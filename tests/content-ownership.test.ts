import assert from "node:assert/strict";
import { test } from "node:test";
import type { Asset, ImageAsset } from "../src/assets.js";
import { Game, PREPARE_ASSET, type PreparedScene } from "../src/scene.js";
import { WebGpuRuntime } from "../src/webgpu-runtime.js";
import { deferred, fakeBitmap, fakePlatform } from "./gpu-fixture.js";

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

async function fixture() {
    const game = new Game({ seed: 1, state: {}, transition: (s) => s });
    const platform = fakePlatform();
    const runtime = await WebGpuRuntime.create(platform.canvas, 64, 64, () => {}, platform);
    const claims: { id: string; releases: number }[] = [];
    const acquire = game.assets.acquire.bind(game.assets);
    game.assets.acquire = async <T>(definition: Asset<T>, signal?: AbortSignal) => {
        const lease = await acquire(definition, signal);
        const record = { id: lease.id, releases: 0 };
        claims.push(record);
        return {
            ...lease,
            release() {
                record.releases++;
                lease.release();
            },
        };
    };
    const bitmaps = [fakeBitmap(), fakeBitmap()];
    const images: ImageAsset[] = bitmaps.map((bitmap, i) => ({
        id: `image-${i}`,
        kind: "image",
        load: async () => bitmap.image,
        dispose: (value) => value.close(),
    }));
    game[PREPARE_ASSET] = async (asset, signal) => {
        const image = images.find((image) => image === asset);
        if (!image) return;
        return runtime.acquire(image, await game.assets.acquire(image, signal), signal);
    };
    const dispose = () => {
        runtime.dispose();
        game.dispose();
    };
    return { game, platform, runtime, claims, images, bitmaps, dispose };
}

test("partial scene acquisition rolls back only its claims and mount transfers surviving claims once", async () => {
    const f = await fixture();
    const { game, images, claims } = f;
    const current = await game.prepare(
        { id: "current", assets: [images[0]], setup() {} },
        { key: "current" },
    );
    await game.start(current);
    const before = game.enumerate();
    const gate = deferred<unknown>();
    const partial = game.prepare(
        {
            id: "partial",
            assets: [images[0], { id: "bad", load: () => gate.promise }],
            setup() {
                assert.fail("partial scene must not be constructed");
            },
        },
        { key: "partial" },
    );
    const rejected = assert.rejects(partial);
    await turn();
    assert.deepEqual(game.enumerate(), before);
    gate.reject(new Error("dependent data malformed"));
    await rejected;
    assert.deepEqual(game.enumerate(), before);
    assert.equal(claims.filter((c) => c.releases === 0).length, 2); // Mounted CPU + retained renderer source.
    current.release(); // Consumed candidate cannot revoke mounted ownership.
    assert.equal(claims.filter((c) => c.releases === 0).length, 2);
    f.dispose();
    assert(claims.every((c) => c.releases === 1));
    assert.equal(f.bitmaps[0].closes, 1);
});

test("final upload cancellation releases acquired claims, rejects stale completion and permits explicit retry", async () => {
    const f = await fixture();
    const gate = deferred<GPUError | null>();
    f.platform.devices[0].scopeWait = gate.promise;
    const abort = new AbortController();
    const scene = { id: "upload", assets: f.images, setup() {} };
    const pending = f.game.prepare(scene, { key: "cancel", signal: abort.signal });
    const rejected = assert.rejects(pending);
    await turn();
    assert.equal(f.platform.devices[0].copies, 1);
    abort.abort();
    await rejected;
    assert(f.claims.every((c) => c.releases === 1));
    gate.resolve(null);
    await turn();
    assert.equal(f.game.scenes.length, 0);
    f.platform.devices[0].scopeWait = undefined;
    const retry = await f.game.prepare(scene, { key: "retry" });
    retry.release();
    retry.release();
    f.dispose();
    assert(f.claims.every((c) => c.releases === 1));
    assert(f.bitmaps.every((b) => b.closes === 1));
});

for (const finish of ["transition", "cancel", "dispose"] as const) {
    test(`recovery during preparation preserves simulation and claim ownership through ${finish}`, async () => {
        const f = await fixture();
        let next: PreparedScene | undefined;
        await f.game.start(
            await f.game.prepare(
                {
                    id: "current",
                    assets: [f.images[0]],
                    setup(scene) {
                        scene.system((ctx) => {
                            if (next) {
                                ctx.scenes.set(next);
                                next = undefined;
                            }
                        });
                    },
                },
                { key: "current" },
            ),
        );
        const before = f.game.enumerate();
        const upload = deferred<GPUError | null>();
        f.platform.devices[0].scopeWait = upload.promise;
        const abort = new AbortController();
        let prepared = false;
        const pending = f.game
            .prepare(
                { id: "destination", assets: f.images, setup() {} },
                { key: "destination", signal: abort.signal },
            )
            .then((candidate) => {
                prepared = true;
                return candidate;
            });
        const rejection = finish === "transition" ? undefined : assert.rejects(pending);
        await turn();
        const replacement = deferred<void>();
        f.platform.delayDevice(replacement.promise);
        f.platform.devices[0].loss.resolve({ reason: "unknown", message: "preparation overlap" });
        await turn();
        assert.equal(f.runtime.status, "recovering");
        assert.equal(prepared, false);
        assert.deepEqual(f.game.enumerate(), before);
        if (finish === "cancel") abort.abort();
        if (finish === "dispose") f.dispose();
        if (rejection) await rejection;
        replacement.resolve();
        upload.resolve(null);
        if (finish === "dispose") {
            await turn();
            assert.equal(f.runtime.status, "disposed");
            assert.equal(f.platform.devices[1].copies, 0);
        } else {
            await f.runtime.ready();
            assert.deepEqual(f.game.enumerate(), before);
            if (finish === "transition") {
                next = await pending;
                assert.equal(f.platform.devices[1].copies, 2);
                f.game.tick();
                assert.equal(f.game.scenes[0].definition, "destination");
            } else {
                assert.equal(f.platform.devices[1].copies, 1);
                assert.equal(f.game.scenes[0].definition, "current");
            }
            f.dispose();
        }
        assert(f.claims.every((c) => c.releases === 1));
        assert(f.bitmaps.every((b) => b.closes === 1));
    });
}
