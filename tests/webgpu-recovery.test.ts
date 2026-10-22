import assert from "node:assert/strict";
import { test } from "node:test";

import type { ImageAsset } from "../src/assets.js";
import { Frame } from "../src/renderer.js";
import { WebGpuRuntime } from "../src/webgpu-runtime.js";
import { deferred, fakeBitmap, fakePlatform } from "./gpu-fixture.js";

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function imageSource(id: string) {
    const bitmap = fakeBitmap();
    let releases = 0;
    const definition: ImageAsset = { id, kind: "image", load: async () => bitmap.image };
    return {
        definition,
        bitmap,
        lease: {
            id,
            value: bitmap.image,
            release() {
                releases++;
            },
        },
        get releases() {
            return releases;
        },
    };
}
test("loss rebuilds stable image IDs with fresh device resources and ignores stale errors", async () => {
    const platform = fakePlatform(),
        source = imageSource("leased"),
        manual = fakeBitmap(),
        diagnostics: unknown[] = [];
    const runtime = await WebGpuRuntime.create(
        platform.canvas,
        64,
        64,
        (e) => diagnostics.push(e),
        { ...platform, snapshot: async () => manual.image },
    );
    const release = await runtime.acquire(
        source.definition,
        source.lease,
        new AbortController().signal,
    );
    await runtime.texture("manual", fakeBitmap().image);
    const frame = new Frame();
    frame.sprite({ x: 1, y: 1, width: 1, height: 1, texture: "leased" });
    frame.sprite({ x: 2, y: 2, width: 1, height: 1, texture: "manual" });
    runtime.render(frame, 0);
    assert.equal(runtime.drawCalls, 2);
    const gate = deferred<void>();
    platform.delayDevice(gate.promise);
    const original = platform.devices[0];
    original.loss.resolve({ reason: "unknown", message: "Injected loss" });
    await turn();
    assert.equal(runtime.status, "recovering");
    runtime.render(frame, 0);
    assert.equal(runtime.drawCalls, 0);
    gate.resolve();
    await runtime.ready();
    assert.equal(platform.devices.length, 2);
    assert.equal(platform.devices[1].copies, 2);
    runtime.render(frame, 0);
    assert.equal(runtime.drawCalls, 2);
    assert.equal(source.releases, 0);
    assert.equal(manual.closes, 0);
    original.dispatchEvent(
        Object.assign(new Event("uncapturederror"), { error: new Error("stale") }),
    );
    assert.equal(diagnostics.length, 0);
    assert.equal(runtime.status, "ready");
    release();
    runtime.dispose();
    assert.equal(source.releases, 1);
    assert.equal(manual.closes, 1);
});

for (const mode of ["adapter-denied", "replacement-lost", "reupload-failed"] as const)
    test(`recovery ${mode} is terminal with one diagnostic and no frame-driven retry`, async () => {
        const platform = fakePlatform(),
            source = imageSource("id"),
            diagnostics: unknown[] = [];
        const runtime = await WebGpuRuntime.create(
            platform.canvas,
            64,
            64,
            (e) => diagnostics.push(e),
            platform,
        );
        const release = await runtime.acquire(
            source.definition,
            source.lease,
            new AbortController().signal,
        );
        if (mode === "adapter-denied") platform.denyAdapter();
        if (mode === "replacement-lost")
            platform.configureDevice((device) =>
                device.loss.resolve({ reason: "unknown", message: "replacement already lost" }),
            );
        if (mode === "reupload-failed")
            platform.configureDevice((device) => {
                device.failCopy = true;
            });
        platform.devices[0].loss.resolve({ reason: "destroyed", message: "Controlled fake loss" });
        await turn();
        await assert.rejects(runtime.ready(), /WebGPU recovery failed/);
        assert.equal(runtime.status, "failed");
        assert.throws(() => runtime.releaseTexture("id"), /WebGPU recovery failed/);
        assert.throws(() => runtime.releaseTexture("absent"), /WebGPU recovery failed/);
        assert.equal(diagnostics.length, 1);
        const devices = platform.devices.length,
            frame = new Frame();
        frame.rect(1, 1, 1, 1, 0xffffff);
        for (let i = 0; i < 10; i++) runtime.render(frame, 0);
        assert.equal(runtime.drawCalls, 0);
        assert.equal(platform.devices.length, devices);
        release();
        runtime.dispose();
        assert.equal(source.releases, 1);
    });

test("an initially lost device rejects creation without starting a replacement loop", async () => {
    const platform = fakePlatform();
    platform.configureDevice((device) =>
        device.loss.resolve({ reason: "unknown", message: "initially lost" }),
    );
    await assert.rejects(WebGpuRuntime.create(platform.canvas, 64, 64, () => {}, platform));
    assert.equal(platform.devices.length, 1);
    assert.equal(platform.devices[0].destroyed, 1);
});

test("recovery reconciles released, cancelled and newly acquired image membership before publication", async () => {
    const platform = fakePlatform(),
        old = imageSource("old"),
        added = imageSource("added"),
        cancelled = imageSource("cancelled");
    const runtime = await WebGpuRuntime.create(platform.canvas, 64, 64, () => {}, platform);
    const release = await runtime.acquire(old.definition, old.lease, new AbortController().signal);
    const gate = deferred<void>();
    platform.delayDevice(gate.promise);
    platform.devices[0].loss.resolve({ reason: "unknown", message: "churn" });
    await turn();
    release();
    const acquired = runtime.acquire(added.definition, added.lease, new AbortController().signal);
    const abort = new AbortController(),
        cancel = runtime.acquire(cancelled.definition, cancelled.lease, abort.signal);
    const rejected = assert.rejects(cancel);
    abort.abort();
    await rejected;
    gate.resolve();
    await runtime.ready();
    const releaseAdded = await acquired;
    assert.equal(platform.devices[1].copies, 1);
    assert.equal(old.releases, 1);
    assert.equal(cancelled.releases, 1);
    const frame = new Frame();
    frame.sprite({ x: 1, y: 1, width: 1, height: 1, texture: "added" });
    runtime.render(frame, 0);
    assert.equal(runtime.drawCalls, 1);
    releaseAdded();
    runtime.dispose();
});

test("disposal during recovery destroys a late replacement and never rereads released sources", async () => {
    const platform = fakePlatform(),
        source = imageSource("id");
    const runtime = await WebGpuRuntime.create(platform.canvas, 64, 64, () => {}, platform);
    await runtime.acquire(source.definition, source.lease, new AbortController().signal);
    const gate = deferred<void>();
    platform.delayDevice(gate.promise);
    platform.devices[0].loss.resolve({ reason: "unknown", message: "dispose race" });
    await turn();
    runtime.dispose();
    gate.resolve();
    await turn();
    assert.equal(runtime.status, "disposed");
    assert.equal(source.releases, 1);
    assert.equal(platform.devices[1].copies, 0);
    assert.equal(platform.devices[1].destroyed, 1);
});

test("release during recovery removes registered and uploading manual images before safe ID reuse", async () => {
    const platform = fakePlatform(),
        snapshots: ReturnType<typeof fakeBitmap>[] = [],
        leased = imageSource("leased"),
        diagnostics: unknown[] = [];
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
    await runtime.texture("registered", fakeBitmap().image);
    await runtime.texture("uploading", fakeBitmap().image);
    const releaseLease = await runtime.acquire(
        leased.definition,
        leased.lease,
        new AbortController().signal,
    );
    const gate = deferred<GPUError | null>();
    platform.configureDevice((device) => {
        const copy = device.queue.copyExternalImageToTexture;
        device.queue.copyExternalImageToTexture = () => {
            copy();
            // Pause the second reupload, after the first has a rebuilding-generation binding.
            if (device.copies === 2) device.scopeWait = gate.promise;
        };
    });
    platform.devices[0].loss.resolve({ reason: "unknown", message: "Controlled release race" });
    await turn();
    assert.equal(runtime.status, "recovering");
    assert.equal(runtime.inspect().textures, 2); // white + first recovered manual image
    assert.equal(runtime.inspect().uploads, 1);
    runtime.releaseTexture("registered");
    runtime.releaseTexture("uploading");
    assert.equal(runtime.inspect().textures, 1);
    assert.equal(runtime.inspect().manualSources, 0);
    assert.equal(snapshots[0].closes, 1);
    assert.equal(snapshots[1].closes, 1);
    const reused = runtime.texture("uploading", fakeBitmap().image);
    platform.devices[1].scopeWait = undefined;
    gate.resolve(null);
    await runtime.ready();
    await reused;
    assert.equal(runtime.status, "ready");
    assert.equal(runtime.inspect().textures, 3);
    assert.deepEqual(
        runtime.inspect().entries.map((entry) => entry.id),
        ["leased", "uploading"],
    );
    const frame = new Frame();
    for (const texture of ["leased", "uploading"])
        frame.sprite({ x: 1, y: 1, width: 1, height: 1, texture });
    runtime.render(frame, 0);
    assert.equal(runtime.drawCalls, 2);
    assert.equal(diagnostics.length, 0);
    assert.equal(leased.releases, 0);
    releaseLease();
    runtime.dispose();
    assert.equal(leased.releases, 1);
    assert.ok(snapshots.every((bitmap) => bitmap.closes === 1));
    for (const device of platform.devices)
        assert.ok(device.textures.every((texture) => texture.destroyed === 1));
});

test("release invalidates a manual upload waiting for recovery readiness", async () => {
    const platform = fakePlatform(),
        snapshot = fakeBitmap();
    const runtime = await WebGpuRuntime.create(platform.canvas, 64, 64, () => {}, {
        ...platform,
        snapshot: async () => snapshot.image,
    });
    const gate = deferred<void>();
    platform.delayDevice(gate.promise);
    platform.devices[0].loss.resolve({ reason: "unknown", message: "Controlled readiness race" });
    await turn();
    const upload = runtime.texture("id", fakeBitmap().image),
        rejected = assert.rejects(upload, /superseded/);
    await turn();
    runtime.releaseTexture("id");
    gate.resolve();
    await runtime.ready();
    await rejected;
    assert.equal(snapshot.closes, 1);
    assert.equal(platform.devices[1].copies, 0);
    assert.equal(runtime.inspect().sources, 0);
    runtime.dispose();
});
