import assert from "node:assert/strict";
import { test } from "node:test";

import type { ImageAsset } from "../src/assets.js";
import { Frame } from "../src/renderer.js";
import { WebGpuRuntime } from "../src/webgpu-runtime.js";
import { deferred, fakeBitmap, fakePlatform } from "./gpu-fixture.js";

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test("recovery preserves logical dimensions above the texture limit with independent backing dimensions", async () => {
    for (const [width, height] of [
        [16384, 64],
        [64, 16384],
    ]) {
        const platform = fakePlatform(),
            source = fakeBitmap(),
            diagnostics: unknown[] = [];
        const runtime = await WebGpuRuntime.create(
            platform.canvas,
            width,
            height,
            (e) => diagnostics.push(e),
            {
                ...platform,
                snapshot: async () => source.image,
            },
        );
        try {
            await runtime.texture("retained", source.image);
            const frame = new Frame();
            frame.sprite({ x: width / 2, y: height / 2, width, height, texture: "retained" });
            runtime.render(frame, 0);
            const inspection = runtime.inspect();
            // A rejected resize must not opt this legacy projection into resize recovery bounds.
            assert.throws(() => runtime.resize(width, height), /dimensions|limit/);
            platform.devices[0].loss.resolve({
                reason: "unknown",
                message: "Independent dimensions",
            });
            await turn();
            await runtime.ready();
            const replacement = platform.devices[1];
            assert.equal(runtime.status, "ready");
            assert.ok(Math.max(width, height) > replacement.limits.maxTextureDimension2D);
            assert.deepEqual(
                [runtime.width, runtime.height, platform.canvas.width, platform.canvas.height],
                [width, height, 64, 64],
            );
            runtime.render(frame, 0);
            assert.equal(replacement.submissions, 1);
            assert.equal(runtime.sprites, 1);
            assert.deepEqual(replacement.writes.at(-2)?.prefix.slice(0, 2), [width, height]);
            assert.equal(replacement.copies, 1);
            assert.deepEqual(runtime.inspect(), inspection);
            assert.equal(source.closes, 0);
            assert.equal(diagnostics.length, 0);
        } finally {
            runtime.dispose();
        }
        assert.equal(source.closes, 1);
    }
});

test("resize rejects throughout recovery and the latest accepted dimensions survive repeated replacement", async () => {
    const platform = fakePlatform(),
        source = fakeBitmap(),
        diagnostics: unknown[] = [];
    const runtime = await WebGpuRuntime.create(
        platform.canvas,
        64,
        64,
        (e) => diagnostics.push(e),
        {
            ...platform,
            snapshot: async () => source.image,
        },
    );
    try {
        await runtime.texture("retained", source.image);
        const frame = new Frame();
        frame.sprite({ x: 8, y: 8, width: 8, height: 8, texture: "retained" });
        for (const [width, height] of [
            [160, 96],
            [32, 24],
        ]) {
            runtime.resize(width, height);
            const gate = deferred<void>();
            platform.delayDevice(gate.promise);
            platform.devices
                .at(-1)!
                .loss.resolve({ reason: "unknown", message: "Resize recovery" });
            await turn();
            assert.equal(runtime.status, "recovering");
            const snapshot = runtime.inspect();
            assert.throws(() => runtime.resize(20, 20), /ready/);
            assert.throws(() => runtime.resize(width, height), /ready/);
            assert.deepEqual(runtime.inspect(), snapshot);
            assert.deepEqual(
                [runtime.width, runtime.height, platform.canvas.width, platform.canvas.height],
                [width, height, width, height],
            );
            gate.resolve();
            await runtime.ready();
            runtime.render(frame, 0);
            const replacement = platform.devices.at(-1)!;
            assert.equal(runtime.sprites, 1);
            assert.deepEqual(replacement.writes.at(-2)?.prefix.slice(0, 2), [width, height]);
            assert.equal(replacement.copies, 1);
            assert.equal(source.closes, 0);
        }
        assert.equal(platform.devices.length, 3);
        assert.equal(diagnostics.length, 0);
    } finally {
        runtime.dispose();
    }
    assert.equal(source.closes, 1);
});

test("a replacement with a smaller viewport limit fails without mutating accepted dimensions", async () => {
    const platform = fakePlatform(),
        diagnostics: unknown[] = [];
    const runtime = await WebGpuRuntime.create(
        platform.canvas,
        64,
        64,
        (e) => diagnostics.push(e),
        platform,
    );
    runtime.resize(128, 96);
    platform.configureDevice((device) => {
        device.limits.maxTextureDimension2D = 64;
    });
    platform.devices[0].loss.resolve({ reason: "unknown", message: "Smaller replacement limit" });
    await turn();
    await assert.rejects(runtime.ready(), /recovery failed/);
    assert.equal(runtime.status, "failed");
    assert.equal(platform.devices[1].destroyed, 1);
    assert.equal(platform.devices[1].pipelines.length, 0);
    assert.equal(diagnostics.length, 1);
    assert.throws(() => runtime.resize(32, 32), /recovery failed/);
    assert.deepEqual(
        [runtime.width, runtime.height, platform.canvas.width, platform.canvas.height],
        [128, 96, 128, 96],
    );
    runtime.dispose();
});
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

test("a lost-generation upload completing after release and ID reuse cannot affect the new registration", async () => {
    const platform = fakePlatform(),
        snapshots: ReturnType<typeof fakeBitmap>[] = [],
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
    const uploadGate = deferred<GPUError | null>(),
        recoveryGate = deferred<void>(),
        original = platform.devices[0];
    original.scopeWait = uploadGate.promise;
    const oldUpload = runtime.texture("id", fakeBitmap().image),
        rejected = assert.rejects(oldUpload, /superseded/);
    await turn();
    assert.equal(original.copies, 1);
    const oldTexture = original.textures[1];
    assert.equal(oldTexture.destroyed, 0);
    assert.equal(runtime.inspect().manualReplacements, 1);

    // Hold both the old upload's validation and the replacement device independently.
    platform.delayDevice(recoveryGate.promise);
    original.loss.resolve({ reason: "unknown", message: "Controlled in-flight upload loss" });
    await turn();
    assert.equal(runtime.status, "recovering");
    runtime.releaseTexture("id");
    const reused = runtime.texture("id", fakeBitmap().image);
    recoveryGate.resolve();
    await runtime.ready();
    await reused;
    assert.equal(platform.devices.length, 2);
    assert.equal(snapshots[0].closes, 0); // The old upload still owns its unsettled snapshot.
    assert.equal(snapshots[1].closes, 0);
    const replacement = platform.devices[1],
        newTexture = replacement.textures[1],
        live = runtime.inspect(),
        frame = new Frame();
    assert.equal(live.manualSources, 1);
    assert.equal(live.textures, 2); // White plus the explicitly reused ID.
    assert.equal(live.manualReplacements, 0);
    assert.equal(oldTexture.destroyed, 0);
    frame.sprite({ x: 1, y: 1, width: 1, height: 1, texture: "id" });
    runtime.render(frame, 0);
    assert.equal(runtime.drawCalls, 1);

    // Finish the old device's work only after the new registration has drawn.
    uploadGate.resolve(null);
    await rejected;
    assert.equal(snapshots[0].closes, 1);
    assert.equal(oldTexture.destroyed, 1);
    assert.equal(snapshots[1].closes, 0);
    assert.equal(newTexture.destroyed, 0);
    assert.deepEqual(runtime.inspect(), live);
    runtime.render(frame, 0);
    assert.equal(runtime.drawCalls, 1);
    assert.equal(runtime.status, "ready");
    assert.equal(replacement.copies, 1);
    assert.equal(diagnostics.length, 0);
    runtime.dispose();
    runtime.dispose();
    assert.ok(snapshots.every((bitmap) => bitmap.closes === 1));
    for (const device of platform.devices) {
        assert.equal(device.destroyed, 1);
        assert.ok(device.textures.every((texture) => texture.destroyed === 1));
    }
});
