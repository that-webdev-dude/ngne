import assert from "node:assert/strict";
import { test } from "node:test";

import { Assets, type ImageAsset, type Lease } from "../src/assets.js";
import { Frame } from "../src/renderer.js";
import { Game, PREPARE_ASSET } from "../src/scene.js";
import { WebGpuRuntime } from "../src/webgpu-runtime.js";
import { deferred, fakeBitmap, fakePlatform } from "./gpu-fixture.js";

test("image consumers share upload, cancel independently and release GPU before decoded cache disposal", async () => {
    const platform = fakePlatform(),
        bitmap = fakeBitmap(),
        assets = new Assets();
    let loads = 0;
    const definition: ImageAsset = {
        kind: "image",
        id: "shared",
        async load() {
            loads++;
            return bitmap.image;
        },
        dispose(value) {
            value.close();
        },
    };
    const runtime = await WebGpuRuntime.create(platform.canvas, 64, 64, () => {}, platform);
    const first = new AbortController(),
        second = new AbortController();
    const sourceA = await assets.acquire(definition),
        sourceB = await assets.acquire(definition);
    const a = runtime.acquire(definition, sourceA, first.signal);
    const b = runtime.acquire(definition, sourceB, second.signal);
    first.abort();
    await assert.rejects(a);
    const release = await b;
    assert.equal(loads, 1);
    assert.equal(platform.devices[0].copies, 1);
    assert.equal(bitmap.closes, 0);
    const frame = new Frame();
    frame.sprite({ x: 32, y: 32, width: 2, height: 2, texture: "shared" });
    runtime.render(frame, 0);
    assert.equal(runtime.drawCalls, 1);
    release();
    release();
    runtime.render(frame, 0);
    assert.equal(runtime.drawCalls, 0);
    assert.equal(bitmap.closes, 0);
    runtime.dispose();
    assets.dispose();
    assert.equal(bitmap.closes, 1);
});

test("synchronous copy failures balance scopes and manual replacements preserve the prior texture", async () => {
    const platform = fakePlatform();
    const snapshots: ReturnType<typeof fakeBitmap>[] = [];
    const runtime = await WebGpuRuntime.create(platform.canvas, 64, 64, () => {}, {
        ...platform,
        snapshot: async () => {
            const bitmap = fakeBitmap();
            snapshots.push(bitmap);
            return bitmap.image;
        },
    });
    const source = fakeBitmap();
    await runtime.texture("manual", source.image);
    const device = platform.devices[0];
    device.failCopy = true;
    await assert.rejects(runtime.texture("manual", source.image));
    assert.equal(device.scopeDepth, 0);
    assert.equal(snapshots[0].closes, 0);
    assert.equal(snapshots[1].closes, 1);
    const frame = new Frame();
    frame.sprite({ x: 1, y: 1, width: 1, height: 1, texture: "manual" });
    runtime.render(frame, 0);
    assert.equal(runtime.drawCalls, 1);
    device.failCopy = false;
    await runtime.texture("manual", source.image);
    assert.equal(snapshots[0].closes, 1);
    runtime.dispose();
    runtime.dispose();
    assert.equal(snapshots[2].closes, 1);
    assert.equal(source.closes, 0);
});

test("leased and manual image identity conflicts reject without replacing the live image", async () => {
    const platform = fakePlatform(),
        assets = new Assets(),
        bitmap = fakeBitmap();
    const runtime = await WebGpuRuntime.create(platform.canvas, 64, 64, () => {}, platform);
    const definition: ImageAsset = { id: "owned", kind: "image", load: async () => bitmap.image };
    const release = await runtime.acquire(
        definition,
        await assets.acquire(definition),
        new AbortController().signal,
    );
    await assert.rejects(runtime.texture("owned", bitmap.image), /reserved or leased/);
    let released = 0;
    await assert.rejects(
        runtime.acquire(
            { ...definition },
            {
                id: "owned",
                value: bitmap.image,
                release() {
                    released++;
                },
            },
            new AbortController().signal,
        ),
        /Conflicting image identity/,
    );
    assert.equal(released, 1);
    const frame = new Frame();
    frame.sprite({ x: 1, y: 1, width: 1, height: 1, texture: "owned" });
    runtime.render(frame, 0);
    assert.equal(runtime.drawCalls, 1);
    assert.equal(platform.devices[0].copies, 1);
    release();
    runtime.dispose();
    assets.dispose();
});

test("manual cancellation after validation leaves the old binding and closes the rejected snapshot once", async () => {
    const platform = fakePlatform(),
        snapshots: ReturnType<typeof fakeBitmap>[] = [];
    const runtime = await WebGpuRuntime.create(platform.canvas, 64, 64, () => {}, {
        ...platform,
        snapshot: async () => {
            const bitmap = fakeBitmap();
            snapshots.push(bitmap);
            return bitmap.image;
        },
    });
    await runtime.texture("id", fakeBitmap().image);
    const barrier = deferred<GPUError | null>();
    platform.devices[0].scopeWait = barrier.promise;
    const abort = new AbortController();
    const replacement = runtime.texture("id", fakeBitmap().image, abort.signal);
    await new Promise((resolve) => setImmediate(resolve));
    abort.abort();
    barrier.resolve(null);
    await assert.rejects(replacement);
    assert.equal(snapshots[0].closes, 0);
    assert.equal(snapshots[1].closes, 1);
    const frame = new Frame();
    frame.sprite({ x: 1, y: 1, width: 1, height: 1, texture: "id" });
    runtime.render(frame, 0);
    assert.equal(runtime.drawCalls, 1);
    runtime.dispose();
});

test("headless preparation releases late GPU cleanup synchronously without publishing a candidate", async () => {
    const game = new Game({ seed: 1, state: {}, transition: (s) => s });
    const late = deferred<() => void>();
    let releases = 0;
    game[PREPARE_ASSET] = () => late.promise;
    const preparation = game.prepare(
        { id: "late", assets: [{ id: "value", load: async () => 42 }], setup() {} },
        { key: "late" },
    );
    await new Promise((resolve) => setImmediate(resolve));
    game.stop();
    late.resolve(() => {
        releases++;
    });
    await assert.rejects(preparation);
    assert.equal(releases, 1);
    assert.equal(game.scenes.length, 0);
    game.dispose();
    assert.equal(releases, 1);
});

test("a failed shared load is evicted before an immediate retry and old releases cannot erase it", async () => {
    const assets = new Assets();
    let loads = 0;
    const failure = deferred<number>();
    const definition = {
        id: "retry",
        load: () => (++loads === 1 ? failure.promise : Promise.resolve(42)),
    };
    const consumer = new AbortController();
    let immediateRetry: Promise<Lease<number>> | undefined;
    const detach = consumer.signal.removeEventListener.bind(consumer.signal);
    consumer.signal.removeEventListener = (...args) => {
        // First consumer's finally runs before the other consumer's release continuation.
        immediateRetry = assets.acquire(definition);
        detach(...args);
    };
    const first = assets.acquire(definition, consumer.signal),
        second = assets.acquire(definition);
    const firstHandled = first.catch(() => undefined),
        secondHandled = second.catch(() => undefined);
    failure.reject(new Error("first failed"));
    await firstHandled;
    const result = await immediateRetry;
    await secondHandled;
    assert.ok(result);
    assert.equal(result.value, 42);
    assert.equal(loads, 2);
    const shared = await assets.acquire(definition);
    assert.equal(loads, 2);
    result.release();
    shared.release();
    assets.dispose();
});

for (const stage of ["adapter", "device", "pipeline", "snapshot", "upload"] as const)
    test(`disposal at ${stage} await rejects late publication and destroys acquired resources`, async () => {
        const platform = fakePlatform(),
            abort = new AbortController(),
            wait = deferred<void>();
        const snapshot = deferred<ImageBitmap>(),
            bitmap = fakeBitmap();
        if (stage === "adapter") platform.delayAdapter(wait.promise);
        if (stage === "device") platform.delayDevice(wait.promise);
        if (stage === "pipeline")
            platform.configureDevice((device) => {
                device.pipelineWait = wait.promise;
            });
        const creation = WebGpuRuntime.create(platform.canvas, 64, 64, () => {}, {
            ...platform,
            signal: abort.signal,
            snapshot: () => snapshot.promise,
        });
        const handled = creation.catch((error) => error);
        if (["adapter", "device", "pipeline"].includes(stage)) {
            await new Promise((resolve) => setImmediate(resolve));
            abort.abort();
            wait.resolve();
            assert.ok((await handled) instanceof Error);
        } else {
            const runtime = await creation;
            if (stage === "upload") {
                const scope = deferred<GPUError | null>();
                platform.devices[0].scopeWait = scope.promise;
                snapshot.resolve(bitmap.image);
                const upload = runtime.texture("id", bitmap.image);
                const rejected = assert.rejects(upload);
                await new Promise((resolve) => setImmediate(resolve));
                runtime.dispose();
                scope.resolve(null);
                await rejected;
            } else {
                const upload = runtime.texture("id", bitmap.image);
                const rejected = assert.rejects(upload);
                runtime.dispose();
                snapshot.resolve(bitmap.image);
                await rejected;
            }
            assert.equal(bitmap.closes, 1);
        }
        for (const device of platform.devices) {
            assert.equal(device.destroyed, 1);
            assert.ok(device.buffers.every((buffer) => buffer.destroyed === 1));
        }
    });
