import assert from "node:assert/strict";
import { test } from "node:test";

import { Frame } from "../src/renderer.js";
import { createGpuContext } from "../src/gpu-context.js";
import { createResourceRegistry } from "../src/resource-registry.js";
import { WebGpuRuntime } from "../src/webgpu-runtime.js";
import { deferred, fakePlatform } from "./gpu-fixture.js";

test("a cancelled late device cannot unconfigure a newer owner of the same canvas", async () => {
    const platform = fakePlatform(),
        pending = deferred<void>(),
        abort = new AbortController();
    platform.delayDevice(pending.promise);
    const old = createGpuContext(
        platform.canvas,
        abort.signal,
        () => {},
        () => {},
        platform.gpu,
    );
    const rejected = assert.rejects(old);
    await Promise.resolve();
    await Promise.resolve();
    abort.abort();
    platform.delayDevice(Promise.resolve());
    const current = await createGpuContext(
        platform.canvas,
        new AbortController().signal,
        () => {},
        () => {},
        platform.gpu,
    );
    pending.resolve();
    await rejected;
    assert.equal(platform.surface.configureCalls, 1);
    assert.equal(platform.surface.unconfigureCalls, 0);
    current.acquire();
    current.dispose();
    assert.equal(platform.surface.unconfigureCalls, 1);
    assert.ok(platform.devices.every((device) => device.destroyed === 1));
});

test("frame faults skip submission, suppress repeated diagnostics and accept corrected frames", async () => {
    const platform = fakePlatform(),
        diagnostics: unknown[] = [];
    const runtime = await WebGpuRuntime.create(
        platform.canvas,
        64,
        64,
        (error) => {
            diagnostics.push(error);
            throw new Error("diagnostic throws");
        },
        platform,
    );
    const frame = new Frame();
    frame.sprite({ x: 1, y: 1, width: 1, height: 1, texture: "missing" });
    runtime.render(frame, 0);
    runtime.render(frame, 0);
    assert.equal(diagnostics.length, 1);
    assert.equal(platform.surface.acquisitions, 0);
    frame.reset();
    frame.rect(1, 1, 1, 1, 0xffffff);
    runtime.render(frame, 0);
    assert.equal(runtime.drawCalls, 1);
    frame.textures[0] = "missing";
    runtime.render(frame, 0);
    assert.equal(diagnostics.length, 2);
    frame.textures[0] = undefined;
    for (const failure of ["dimensions", "count", "acquire", "encode", "submit"]) {
        const device = platform.devices[0],
            originalCount = frame.count;
        if (failure === "dimensions") platform.canvas.width = 0;
        if (failure === "count") frame.count = Number.MAX_SAFE_INTEGER;
        if (failure === "acquire") platform.surface.failAcquire = true;
        if (failure === "encode") device.failEncode = true;
        if (failure === "submit") device.failSubmit = true;
        const before = device.submissions,
            reported = diagnostics.length;
        runtime.render(frame, 0);
        runtime.render(frame, 0);
        assert.equal(device.submissions, before, failure);
        assert.equal(runtime.drawCalls, 0);
        assert.equal(diagnostics.length, reported + 1);
        assert.equal(device.passes, device.endedPasses);
        platform.canvas.width = 64;
        frame.count = originalCount;
        platform.surface.failAcquire = false;
        device.failEncode = false;
        device.failSubmit = false;
        runtime.render(frame, 0);
        assert.equal(runtime.drawCalls, 1, failure);
    }
    runtime.dispose();
});

test("growth is bounded by the actual device limit and replaced buffers are destroyed", async () => {
    const platform = fakePlatform();
    platform.configureDevice((device) => {
        device.limits.maxBufferSize = 56 * 10000;
    });
    const runtime = await WebGpuRuntime.create(platform.canvas, 64, 64, () => {}, platform),
        frame = new Frame();
    for (let i = 0; i < 10000; i++) frame.rect(1, 1, 1, 1, 0xffffff);
    runtime.render(frame, 0);
    assert.equal(runtime.sprites, 10000);
    const device = platform.devices[0];
    assert.ok(device.buffers.every((buffer) => buffer.size <= 56 * 10000));
    assert.ok(device.buffers.some((buffer) => buffer.destroyed === 1));
    frame.rect(1, 1, 1, 1, 0xffffff);
    runtime.render(frame, 0);
    assert.equal(runtime.sprites, 0);
    frame.reset();
    frame.rect(1, 1, 1, 1, 0xffffff);
    runtime.render(frame, 0);
    assert.equal(runtime.sprites, 1);
    assert.equal(device.writes.at(-1)?.size, 14);
    runtime.dispose();
    assert.ok(device.buffers.every((buffer) => buffer.destroyed === 1));
});

test("failed growth allocation shrinks later attempts and device errors report once", async () => {
    const platform = fakePlatform(),
        diagnostics: unknown[] = [];
    const runtime = await WebGpuRuntime.create(
        platform.canvas,
        64,
        64,
        (error) => diagnostics.push(error),
        platform,
    );
    const device = platform.devices[0],
        frame = new Frame();
    const uncaptured = () =>
        device.dispatchEvent(
            Object.assign(new Event("uncapturederror"), { error: { message: "Invalid buffer" } }),
        );
    const draw = async (count: number) => {
        frame.reset();
        for (let i = 0; i < count; i++) frame.rect(1, 1, 1, 1, 0xffffff);
        runtime.render(frame, 0);
        await new Promise((resolve) => setImmediate(resolve));
    };
    device.scopeWait = Promise.resolve({ message: "Out of memory" } as GPUError);
    await draw(100); // grows to 128; the scope reports out-of-memory afterwards
    uncaptured();
    uncaptured();
    assert.equal(diagnostics.length, 1);
    await draw(100); // retries at exactly 100, below the failed 128
    assert.equal(device.buffers.at(-1)?.size, 56 * 100);
    const reported = diagnostics.length;
    await draw(100);
    await draw(100);
    assert.equal(diagnostics.length, reported + 1);
    assert.equal(runtime.sprites, 0);
    device.scopeWait = undefined;
    await draw(50);
    assert.equal(runtime.sprites, 50);
    assert.equal(device.buffers.at(-1)?.size, 56 * 50);
    runtime.dispose();
    assert.ok(device.buffers.every((buffer) => buffer.destroyed === 1));
});

test("generation-local registry exceeds the prototype 16-bit limit and keeps released handles stale", () => {
    const registry = createResourceRegistry<object>();
    const initial = registry.register({});
    registry.release(initial);
    let last = 0;
    for (let index = 0; index < 65538; index++) {
        last = registry.register({});
        registry.release(last);
    }
    assert.ok(last > 65535);
    assert.throws(() => registry.get(initial));
    assert.equal(registry.size, 0);
    const object = {};
    const handle = registry.register(object);
    assert.throws(() => registry.register(object));
    registry.replace(handle, {});
    registry.clear();
    assert.throws(() => registry.get(handle));
});
