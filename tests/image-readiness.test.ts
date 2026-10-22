import assert from "node:assert/strict";
import { test } from "node:test";

import { Assets, type ImageAsset, type Lease } from "../src/assets.js";
import { Frame } from "../src/renderer.js";
import { Game, PREPARE_ASSET } from "../src/scene.js";
import { WebGpuRuntime } from "../src/webgpu-runtime.js";
import { deferred, fakeBitmap, fakePlatform } from "./gpu-fixture.js";

test("manual release removes only its resources, is idempotent and permits corrected frames and reuse", async () => {
    const platform = fakePlatform(),
        snapshots: ReturnType<typeof fakeBitmap>[] = [],
        diagnostics: unknown[] = [],
        caller = fakeBitmap(),
        leased = fakeBitmap();
    let leaseReleases = 0;
    const runtime = await WebGpuRuntime.create(
        platform.canvas,
        64,
        64,
        (e) => diagnostics.push(e),
        {
            ...platform,
            snapshot: async () => {
                const bitmap = fakeBitmap();
                snapshots.push(bitmap);
                return bitmap.image;
            },
        },
    );
    const releaseLease = await runtime.acquire(
        { id: "leased", kind: "image", load: async () => leased.image },
        {
            id: "leased",
            value: leased.image,
            release: () => {
                leaseReleases++;
            },
        },
        new AbortController().signal,
    );
    await runtime.texture("manual", caller.image);
    await runtime.texture("survivor", caller.image);
    const before = runtime.inspect(),
        device = platform.devices[0],
        frame = new Frame();
    frame.sprite({ x: 1, y: 1, width: 1, height: 1, texture: "manual" });
    runtime.render(frame, 0);
    const submissions = device.submissions;
    assert.equal(runtime.stats?.bindings, 4);
    runtime.releaseTexture("manual");
    runtime.releaseTexture("manual");
    runtime.releaseTexture("absent");
    assert.equal(runtime.stats?.bindings, 3);
    assert.equal(snapshots[0].closes, 1);
    assert.equal(snapshots[1].closes, 0);
    assert.equal(device.textures[2].destroyed, 1);
    assert.deepEqual(runtime.inspect(), {
        ...before,
        sources: 2,
        manualSources: 1,
        consumers: 2,
        textures: 3,
        estimatedSourceBytes: 32,
        estimatedTextureBytes: 36,
        entries: before.entries.filter((entry) => entry.id !== "manual"),
    });
    // A detached inspection does not change when ownership does.
    assert.equal(before.sources, 3);
    for (const id of ["", "leased"])
        assert.throws(() => runtime.releaseTexture(id), /reserved or leased/);
    assert.equal(leaseReleases, 0);
    runtime.render(frame, 0);
    runtime.render(frame, 0);
    assert.equal(device.submissions, submissions);
    assert.equal(diagnostics.length, 1);
    for (const texture of ["survivor", "leased"]) {
        frame.textures[0] = texture;
        runtime.render(frame, 0);
        assert.equal(runtime.drawCalls, 1);
    }
    frame.textures[0] = "manual";
    runtime.render(frame, 0);
    assert.equal(diagnostics.length, 2);
    await runtime.texture("manual", caller.image);
    runtime.render(frame, 0);
    assert.equal(runtime.drawCalls, 1);
    releaseLease();
    runtime.dispose();
    runtime.dispose();
    assert.equal(leaseReleases, 1);
    assert.equal(caller.closes, 0);
    assert.ok(snapshots.every((bitmap) => bitmap.closes === 1));
    assert.ok(device.textures.every((texture) => texture.destroyed === 1));
    assert.equal(runtime.inspect().sources, 0);
    assert.equal(runtime.inspect().textures, 0);
    assert.throws(() => runtime.releaseTexture("manual"), /disposed/);
    assert.throws(() => runtime.releaseTexture("absent"), /disposed/);
});

for (const stage of ["snapshot", "upload"] as const)
    for (const replacing of [false, true])
        for (const oldFirst of [false, true])
            test(`release during ${replacing ? "replacement" : "first"} ${stage}, old finishes ${oldFirst ? "first" : "last"}`, async () => {
                const platform = fakePlatform(),
                    snapshots: ReturnType<typeof fakeBitmap>[] = [],
                    snapshotGate = deferred<ImageBitmap>(),
                    uploadGate = deferred<GPUError | null>();
                let holdSnapshot = false;
                const runtime = await WebGpuRuntime.create(platform.canvas, 64, 64, () => {}, {
                    ...platform,
                    snapshot: () => {
                        const bitmap = fakeBitmap();
                        snapshots.push(bitmap);
                        return holdSnapshot ? snapshotGate.promise : Promise.resolve(bitmap.image);
                    },
                });
                const device = platform.devices[0];
                if (replacing) await runtime.texture("id", fakeBitmap().image);
                holdSnapshot = stage === "snapshot";
                if (stage === "upload") device.scopeWait = uploadGate.promise;
                const old = runtime.texture("id", fakeBitmap().image),
                    rejected = assert.rejects(old, /superseded/);
                await new Promise((resolve) => setImmediate(resolve));
                const oldSnapshot = snapshots.at(-1)!;
                runtime.releaseTexture("id");
                assert.equal(runtime.inspect().manualReplacements, 0);
                assert.equal(runtime.inspect().sources, 0);
                holdSnapshot = false;
                device.scopeWait = undefined;
                // Hold the new upload at validation when old work must finish first.
                const newUploadGate = deferred<GPUError | null>();
                if (oldFirst) device.scopeWait = newUploadGate.promise;
                const reused = runtime.texture("id", fakeBitmap().image);
                await new Promise((resolve) => setImmediate(resolve));
                device.scopeWait = undefined;
                if (!oldFirst) await reused;
                snapshotGate.resolve(oldSnapshot.image);
                uploadGate.resolve(null);
                await rejected;
                assert.equal(oldSnapshot.closes, 1);
                if (oldFirst) {
                    assert.equal(runtime.inspect().manualReplacements, 1);
                    newUploadGate.resolve(null);
                    await reused;
                }
                const frame = new Frame();
                frame.sprite({ x: 1, y: 1, width: 1, height: 1, texture: "id" });
                runtime.render(frame, 0);
                assert.equal(runtime.drawCalls, 1);
                assert.equal(runtime.inspect().manualSources, 1);
                assert.equal(runtime.inspect().textures, 2);
                assert.equal(runtime.inspect().manualReplacements, 0);
                runtime.dispose();
                assert.ok(snapshots.every((bitmap) => bitmap.closes === 1));
                assert.ok(device.textures.every((texture) => texture.destroyed === 1));
            });

test("manual release cannot cancel an asset-leased first upload", async () => {
    const platform = fakePlatform(),
        assets = new Assets(),
        bitmap = fakeBitmap();
    const runtime = await WebGpuRuntime.create(platform.canvas, 64, 64, () => {}, platform);
    const gate = deferred<GPUError | null>();
    platform.devices[0].scopeWait = gate.promise;
    const definition: ImageAsset = { id: "leased", kind: "image", load: async () => bitmap.image };
    const acquired = runtime.acquire(
        definition,
        await assets.acquire(definition),
        new AbortController().signal,
    );
    assert.throws(() => runtime.releaseTexture("leased"), /reserved or leased/);
    gate.resolve(null);
    const release = await acquired;
    assert.equal(runtime.inspect().leasedSources, 1);
    release();
    runtime.dispose();
    assets.dispose();
});

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
