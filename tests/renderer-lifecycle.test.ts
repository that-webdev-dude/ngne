import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { BrowserGame, Frame, WebGPURenderer, type RendererLifecycleEvent } from "../src/index.js";
import { deferred, fakeBitmap, fakePlatform } from "./gpu-fixture.js";

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function platformFor(t: TestContext) {
    const platform = fakePlatform();
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "gpu");
    Object.defineProperty(navigator, "gpu", { configurable: true, value: platform.gpu });
    t.after(() => {
        if (descriptor) Object.defineProperty(navigator, "gpu", descriptor);
        else Reflect.deleteProperty(navigator, "gpu");
    });
    return platform;
}
function snapshotFor(t: TestContext, image: ImageBitmap): void {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
    Object.defineProperty(globalThis, "createImageBitmap", {
        configurable: true,
        value: async () => image,
    });
    t.after(() => {
        if (descriptor) Object.defineProperty(globalThis, "createImageBitmap", descriptor);
        else Reflect.deleteProperty(globalThis, "createImageBitmap");
    });
}

test("creation preserves logical dimensions above the texture limit with independent backing dimensions", async (t) => {
    const platform = platformFor(t);
    for (const [width, height] of [
        [16384, 64],
        [64, 16384],
    ]) {
        const renderer = await WebGPURenderer.create(platform.canvas, width, height),
            device = platform.devices.at(-1)!,
            frame = new Frame();
        try {
            assert.ok(Math.max(width, height) > device.limits.maxTextureDimension2D);
            assert.deepEqual(
                [renderer.width, renderer.height, platform.canvas.width, platform.canvas.height],
                [width, height, 64, 64],
            );
            frame.rect(width / 2, height / 2, width, height, 0xffffff);
            renderer.render(frame);
            assert.equal(device.submissions, 1);
            assert.equal(renderer.sprites, 1);
            assert.deepEqual(device.writes.at(-2)?.prefix.slice(0, 2), [width, height]);
            assert.throws(() => renderer.resize(width, height), /dimensions|limit/);
            assert.deepEqual(
                [renderer.width, renderer.height, platform.canvas.width, platform.canvas.height],
                [width, height, 64, 64],
            );
        } finally {
            renderer.dispose();
        }
    }
});

test("public resize exposes current readonly dimensions and preserves create backing-size compatibility", async (t) => {
    const platform = platformFor(t);
    platform.canvas.width = 128;
    const renderer = await WebGPURenderer.create(platform.canvas, 64, 64);
    t.after(() => renderer.dispose());
    assert.deepEqual([renderer.width, renderer.height, platform.canvas.width], [64, 64, 128]);
    renderer.resize(96, 80);
    assert.deepEqual(
        [renderer.width, renderer.height, platform.canvas.width, platform.canvas.height],
        [96, 80, 96, 80],
    );
    assert.throws(() => renderer.resize(100, 0), /dimensions/);
    assert.deepEqual(
        [renderer.width, renderer.height, platform.canvas.width, platform.canvas.height],
        [96, 80, 96, 80],
    );
    assert.equal(Reflect.set(renderer, "width", 100), false);
    assert.equal(Reflect.set(renderer, "height", 100), false);
    renderer.render(new Frame());
    assert.equal(platform.devices[0].submissions, 1);
});

for (const stage of ["adapter", "device", "pipeline"] as const)
    test(
        `public creation aborts promptly during ${stage}; late cleanup preserves a new owner`,
        { timeout: 3000 },
        async (t) => {
            const platform = platformFor(t),
                gate = deferred<void>(),
                abort = new AbortController();
            if (stage === "adapter") platform.delayAdapter(gate.promise);
            if (stage === "device") platform.delayDevice(gate.promise);
            if (stage === "pipeline")
                platform.configureDevice((device) => {
                    device.pipelineWait = gate.promise;
                });
            const old = WebGPURenderer.create(platform.canvas, 64, 64, undefined, abort.signal);
            await turn();
            await assert.rejects(
                WebGPURenderer.create(platform.canvas, 64, 64),
                /already has a renderer owner/,
            );
            const reason = new Error("cancel creation");
            const rejected = assert.rejects(old, (error) => error === reason);
            abort.abort(reason);
            await rejected; // Gate remains closed: cancellation must not wait for the browser.
            platform.delayAdapter(Promise.resolve());
            platform.delayDevice(Promise.resolve());
            platform.configureDevice(() => {});
            const renderer = await WebGPURenderer.create(platform.canvas, 64, 64);
            t.after(() => renderer.dispose());
            const unconfigured = platform.surface.unconfigureCalls;
            gate.resolve();
            await turn();
            assert.equal(platform.surface.unconfigureCalls, unconfigured);
            const frame = new Frame();
            frame.rect(1, 1, 1, 1, 0xffffff);
            renderer.render(frame);
            assert.equal(renderer.drawCalls, 1);
            renderer.dispose();
            for (const device of platform.devices) {
                assert.equal(device.destroyed, 1);
                assert.ok(device.buffers.every((buffer) => buffer.destroyed === 1));
            }
        },
    );

test("creation-only cancellation, rejected conflicts and independent canvases", async (t) => {
    const platform = platformFor(t),
        abort = new AbortController();
    abort.abort();
    await assert.rejects(WebGPURenderer.create(platform.canvas, 64, 64, undefined, abort.signal), {
        name: "AbortError",
    });
    assert.equal(platform.devices.length, 0);
    const creation = new AbortController();
    const renderer = await WebGPURenderer.create(
        platform.canvas,
        64,
        64,
        undefined,
        creation.signal,
    );
    t.after(() => renderer.dispose());
    creation.abort();
    await renderer.ready();
    assert.equal(renderer.status, "ready");
    await assert.rejects(
        WebGPURenderer.create(platform.canvas, 64, 64),
        /already has a renderer owner/,
    );
    const other = fakePlatform();
    const second = await WebGPURenderer.create(other.canvas, 64, 64);
    second.dispose();
    assert.equal(renderer.status, "ready");
    renderer.dispose();
    const replacement = await WebGPURenderer.create(platform.canvas, 64, 64);
    replacement.dispose();
});

test("a conflicting BrowserGame cannot resize an existing canvas owner", async (t) => {
    const platform = platformFor(t);
    const renderer = await WebGPURenderer.create(platform.canvas, 64, 64);
    t.after(() => renderer.dispose());
    const host = new BrowserGame({
        canvas: platform.canvas,
        width: 128,
        height: 96,
        seed: 1,
        state: {},
        transition: (state) => state,
        diagnostic() {},
        scheduler: {
            request() {
                throw new Error("Conflicting host must not schedule frames");
            },
            cancel() {},
        },
    });
    t.after(() => host.dispose());
    const image = { id: "conflict", kind: "image" as const, load: async () => fakeBitmap().image };
    await assert.rejects(
        host.game.prepare({ id: "conflict", assets: [image], setup() {} }, { key: "conflict" }),
    );
    assert.deepEqual([platform.canvas.width, platform.canvas.height], [64, 64]);
    assert.equal(platform.surface.unconfigureCalls, 0);
});

test("failed creation releases canvas ownership and failed disposal still attempts device cleanup", async (t) => {
    const platform = platformFor(t);
    platform.configureDevice((device) => {
        device.pipelineWait = Promise.reject(new Error("pipeline failure"));
    });
    await assert.rejects(WebGPURenderer.create(platform.canvas, 64, 64), /pipeline failure/);
    assert.equal(platform.devices[0].destroyed, 1);
    platform.configureDevice(() => {});
    const diagnostics: unknown[] = [];
    const renderer = await WebGPURenderer.create(platform.canvas, 64, 64, (error) =>
        diagnostics.push(error),
    );
    t.mock.method(platform.surface, "unconfigure", () => {
        throw new Error("unconfigure failure");
    });
    assert.throws(() => renderer.dispose(), /WebGPU disposal failed/);
    assert.equal(renderer.status, "disposed");
    assert.equal(platform.devices[1].destroyed, 1);
    assert.equal(diagnostics.length, 1);
    renderer.dispose();
    t.mock.restoreAll();
    const replacement = await WebGPURenderer.create(platform.canvas, 64, 64);
    replacement.dispose();
});

test("future transitions precede waiters, restore retained images and repeat without polling", async (t) => {
    const platform = platformFor(t),
        errors: unknown[] = [];
    const renderer = await WebGPURenderer.create(platform.canvas, 64, 64, (error) =>
        errors.push(error),
    );
    t.after(() => renderer.dispose());
    const snapshot = fakeBitmap();
    snapshotFor(t, snapshot.image);
    await renderer.texture("image", snapshot.image);
    const frame = new Frame();
    frame.sprite({ x: 1, y: 1, width: 1, height: 1, texture: "image" });
    const order: string[] = [];
    renderer.onLifecycle((event) => {
        assert.equal(renderer.status, event.status);
        order.push(event.status);
        if (event.status === "ready") {
            assert.equal(platform.devices.at(-1)?.copies, 1);
            renderer.render(frame);
            assert.equal(renderer.drawCalls, 1);
        }
    });
    await renderer.ready();
    assert.deepEqual(order, []); // Subscription does not replay current state.
    for (let round = 0; round < 2; round++) {
        const gate = deferred<GPUError | null>();
        platform.configureDevice((device) => {
            const copy = device.queue.copyExternalImageToTexture;
            device.queue.copyExternalImageToTexture = () => {
                copy();
                device.scopeWait = gate.promise;
            };
        });
        platform.devices.at(-1)!.destroy();
        await turn();
        assert.equal(renderer.status, "recovering");
        const cancel = new AbortController(),
            reason = new Error("cancel this wait");
        const rejected = assert.rejects(renderer.ready(cancel.signal), (error) => error === reason);
        const one = renderer.ready().then(() => order.push("waiter1"));
        const two = renderer.ready().then(() => order.push("waiter2"));
        cancel.abort(reason);
        await rejected;
        assert.equal(renderer.status, "recovering");
        assert.equal(order.at(-1), "recovering");
        gate.resolve(null);
        await Promise.all([one, two]);
    }
    assert.deepEqual(order, [
        "recovering",
        "ready",
        "waiter1",
        "waiter2",
        "recovering",
        "ready",
        "waiter1",
        "waiter2",
    ]);
    assert.deepEqual(errors, []);
});

for (const mode of ["adapter", "upload"] as const)
    test(`terminal ${mode} failure publishes the same error to observers and waiters`, async (t) => {
        const platform = platformFor(t),
            errors: unknown[] = [],
            events: RendererLifecycleEvent[] = [];
        const renderer = await WebGPURenderer.create(platform.canvas, 64, 64, (error) =>
            errors.push(error),
        );
        t.after(() => renderer.dispose());
        const snapshot = fakeBitmap();
        snapshotFor(t, snapshot.image);
        await renderer.texture("image", snapshot.image);
        const gate = deferred<void>();
        platform.delayAdapter(gate.promise);
        renderer.onLifecycle((event) => events.push(event));
        platform.devices[0].destroy();
        await turn();
        if (mode === "adapter") platform.denyAdapter();
        else
            platform.configureDevice((device) => {
                device.failCopy = true;
            });
        const one = renderer.ready(),
            two = renderer.ready();
        const rejected = Promise.all([
            assert.rejects(one, (error) => error === errors[0]),
            assert.rejects(two, (error) => error === errors[0]),
        ]);
        gate.resolve();
        await rejected;
        assert.deepEqual(
            events.map((event) => event.status),
            ["recovering", "failed"],
        );
        assert.equal(events[1].status === "failed" && events[1].error, errors[0]);
        assert.equal(errors.length, 1);
        await assert.rejects(renderer.ready(), (error) => error === errors[0]);
        await assert.rejects(
            WebGPURenderer.create(platform.canvas, 64, 64),
            /already has a renderer owner/,
        );
    });

test("observer exceptions, registration and unsubscription cannot disrupt recovery", async (t) => {
    const platform = platformFor(t),
        errors: unknown[] = [],
        order: string[] = [];
    const renderer = await WebGPURenderer.create(platform.canvas, 64, 64, (error) => {
        errors.push(error);
        throw new Error("diagnostic throws");
    });
    t.after(() => renderer.dispose());
    const fault = new Error("observer throws");
    let unsubscribe = () => {};
    renderer.onLifecycle((event) => {
        order.push("first:" + event.status);
        if (event.status === "recovering") {
            unsubscribe();
            renderer.onLifecycle((next) => order.push("added:" + next.status));
        }
        throw fault;
    });
    unsubscribe = renderer.onLifecycle(() => order.push("removed"));
    const duplicate = (event: RendererLifecycleEvent) => order.push("duplicate:" + event.status);
    const removeDuplicate = renderer.onLifecycle(duplicate);
    renderer.onLifecycle(duplicate);
    removeDuplicate();
    removeDuplicate();
    platform.devices[0].destroy();
    await turn();
    await renderer.ready();
    assert.deepEqual(order, [
        "first:recovering",
        "duplicate:recovering",
        "first:ready",
        "duplicate:ready",
        "added:ready",
    ]);
    assert.deepEqual(errors, [fault, fault]);
});

test(
    "async observer failures preserve delivery, rendering and terminal failure reporting",
    { timeout: 3000 },
    async (t) => {
        const platform = platformFor(t),
            diagnostics: unknown[] = [],
            order: string[] = [];
        const renderer = await WebGPURenderer.create(platform.canvas, 64, 64, (error) => {
            diagnostics.push(error);
            throw new Error("diagnostic throws");
        });
        t.after(() => renderer.dispose());
        const fault = new Error("async observer failed");
        renderer.onLifecycle(async (event) => {
            order.push("first:" + event.status);
            // Awaiting readiness from a restoration callback must not deadlock dispatch.
            if (event.status === "ready") await renderer.ready();
            throw fault;
        });
        let terminal: Error | undefined;
        renderer.onLifecycle((event) => {
            order.push("second:" + event.status);
            if (event.status === "failed") terminal = event.error;
        });
        platform.devices[0].destroy();
        await turn();
        await renderer.ready();
        await turn();
        assert.deepEqual(order, [
            "first:recovering",
            "second:recovering",
            "first:ready",
            "second:ready",
        ]);
        assert.deepEqual(diagnostics, [fault, fault]);
        const frame = new Frame();
        frame.rect(1, 1, 1, 1, 0xffffff);
        renderer.render(frame);
        assert.equal(renderer.drawCalls, 1);
        platform.denyAdapter();
        platform.devices.at(-1)!.destroy();
        await turn();
        await assert.rejects(renderer.ready(), (error) => error === terminal);
        assert.deepEqual(order.slice(4), [
            "first:recovering",
            "second:recovering",
            "first:failed",
            "second:failed",
        ]);
        assert.equal(diagnostics.filter((error) => error === fault).length, 4);
        assert.equal(diagnostics.filter((error) => error === terminal).length, 1);
        assert.equal(renderer.status, "failed");
    },
);

test(
    "pending observer promises do not block readiness and late rejections survive disposal safely",
    { timeout: 3000 },
    async (t) => {
        const platform = platformFor(t),
            diagnostics: unknown[] = [],
            order: string[] = [];
        const renderer = await WebGPURenderer.create(platform.canvas, 64, 64, (error) =>
            diagnostics.push(error),
        );
        t.after(() => renderer.dispose());
        const gate = deferred<void>();
        const unsubscribe = renderer.onLifecycle(async (event) => {
            order.push("first:" + event.status);
            await gate.promise;
        });
        renderer.onLifecycle((event) => order.push("second:" + event.status));
        platform.devices[0].destroy();
        await turn();
        await renderer.ready();
        assert.deepEqual(order, [
            "first:recovering",
            "second:recovering",
            "first:ready",
            "second:ready",
        ]);
        assert.deepEqual(diagnostics, []);
        unsubscribe();
        renderer.dispose();
        const fault = new Error("observer rejected after disposal");
        gate.reject(fault);
        await turn();
        assert.deepEqual(diagnostics, [fault, fault]);
        assert.equal(order.length, 4);
        assert.equal(renderer.status, "disposed");
    },
);

test(
    "disposal during delivery clears observers and promptly settles gated waiters",
    { timeout: 3000 },
    async (t) => {
        const platform = platformFor(t);
        const renderer = await WebGPURenderer.create(platform.canvas, 64, 64);
        const gate = deferred<void>();
        platform.delayDevice(gate.promise);
        const order: string[] = [],
            waits: Promise<unknown>[] = [];
        renderer.onLifecycle(() => {
            order.push("first");
            waits.push(assert.rejects(renderer.ready(), /disposed/));
            renderer.dispose();
        });
        renderer.onLifecycle(() => order.push("late"));
        platform.devices[0].destroy();
        await turn();
        await Promise.all(waits);
        await assert.rejects(renderer.ready(), /disposed/);
        const cancel = new AbortController();
        cancel.abort();
        await assert.rejects(renderer.ready(cancel.signal), { name: "AbortError" });
        const remove = renderer.onLifecycle(() => order.push("after-dispose"));
        remove();
        platform.delayDevice(Promise.resolve());
        const current = await WebGPURenderer.create(platform.canvas, 64, 64);
        t.after(() => current.dispose());
        const unconfigured = platform.surface.unconfigureCalls;
        gate.resolve();
        await turn();
        assert.equal(platform.surface.unconfigureCalls, unconfigured);
        assert.deepEqual(order, ["first"]);
        assert.equal(renderer.status, "disposed");
    },
);
