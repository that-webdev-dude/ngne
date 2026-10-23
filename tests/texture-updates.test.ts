import assert from "node:assert/strict";
import { test } from "node:test";
import { WebGpuRuntime } from "../src/webgpu-runtime.js";
import type { TextureRegion } from "../src/index.js";
import { deferred, fakeBitmap, fakePlatform } from "./gpu-fixture.js";

const region: TextureRegion = {
    sourceX: 0,
    sourceY: 0,
    width: 1,
    height: 1,
    destinationX: 0,
    destinationY: 0,
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function fixture(afterRead: () => void = () => {}) {
    const platform = fakePlatform();
    const reads: TextureRegion[] = [];
    let readGate: Promise<void> | undefined;
    let value = 1;
    const runtime = await WebGpuRuntime.create(platform.canvas, 64, 64, () => {}, {
        ...platform,
        snapshot: async () => fakeBitmap().image,
        readRegion: async (_source, rect) => {
            reads.push(rect);
            const captured = value;
            await readGate;
            afterRead();
            return new Uint8Array(rect.width * rect.height * 4).fill(captured);
        },
    });
    return {
        ...platform,
        runtime,
        reads,
        source: fakeBitmap().image,
        gate: (wait?: Promise<void>) => {
            readGate = wait;
        },
        value: (next: number) => {
            value = next;
        },
    };
}

test("mutable initialization is transparent, fixed-size, validated and reuses storage and binding for region writes", async () => {
    const f = await fixture();
    try {
        await f.runtime.createTexture("edit", 4, 3);
        const device = f.devices[0],
            textures = [...device.textures],
            bindings = [...device.bindings];
        assert.equal(
            device.textureWrites[1].data.every((byte) => byte === 0),
            true,
        );
        const inspection = f.runtime.inspect();
        assert.equal(inspection.estimatedSourceBytes, 48);
        assert.equal(inspection.estimatedTextureBytes, 52);
        for (let i = 0; i < 20; i++) {
            f.value(i);
            await f.runtime.updateTexture("edit", f.source, {
                ...region,
                sourceX: 1,
                destinationX: 3,
                destinationY: 2,
            });
        }
        assert.deepEqual(device.textures, textures);
        assert.deepEqual(device.bindings, bindings);
        assert.equal(device.textureWrites.length, 22);
        assert.equal(device.textureWrites.at(-1)?.data.byteLength, 4);
        assert.deepEqual(device.textureWrites.at(-1)?.destination.origin, [3, 2]);
        assert.deepEqual(device.textureWrites.at(-1)?.size, [1, 1]);
        assert.equal(device.scopeDepth, 0);
        assert.deepEqual(f.runtime.inspect(), inspection);
        assert.equal(f.reads.length, 20);
    } finally {
        f.runtime.dispose();
    }
    assert.ok(f.devices[0].textures.every((texture) => texture.destroyed === 1));
});

test("invalid dimensions, rectangles, unsupported IDs and full update queues reject before copying", async () => {
    const f = await fixture();
    try {
        for (const invalid of [0, -1, 1.5, Infinity, NaN, 8193])
            await assert.rejects(f.runtime.createTexture("invalid", invalid, 2));
        await assert.rejects(f.runtime.createTexture("", 2, 2));
        await f.runtime.createTexture("edit", 2, 2);
        await assert.rejects(f.runtime.createTexture("edit", 3, 3));
        await f.runtime.texture("static", f.source);
        const release = await f.runtime.acquire(
            { id: "leased", kind: "image", load: async () => f.source },
            { id: "leased", value: f.source, release() {} },
            new AbortController().signal,
        );
        for (const id of ["", "absent", "static", "leased"])
            await assert.rejects(f.runtime.updateTexture(id, f.source, region), /createTexture/);
        for (const key of Object.keys(region) as (keyof TextureRegion)[])
            for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])
                await assert.rejects(
                    f.runtime.updateTexture("edit", f.source, { ...region, [key]: value }),
                    /region/,
                );
        for (const key of ["width", "height"])
            await assert.rejects(
                f.runtime.updateTexture("edit", f.source, { ...region, [key]: 0 }),
                /region/,
            );
        assert.equal(f.reads.length, 0);
        const gate = deferred<void>();
        f.gate(gate.promise);
        const pending = Array.from({ length: 32 }, () =>
            f.runtime.updateTexture("edit", f.source, region),
        );
        await assert.rejects(f.runtime.updateTexture("edit", f.source, region), /queue is full/);
        gate.resolve();
        await Promise.all(pending);
        release();
    } finally {
        f.runtime.dispose();
    }
});

test("overlapping and disjoint patches commit in call order; recovery contains exactly the accepted rows", async () => {
    const f = await fixture();
    try {
        await f.runtime.createTexture("edit", 3, 2);
        const gate = deferred<void>();
        f.gate(gate.promise);
        f.value(10);
        const coordinates = { ...region, width: 2 };
        const first = f.runtime.updateTexture("edit", f.source, coordinates);
        await tick();
        coordinates.destinationY = 1; // The already queued rectangle is detached.
        f.value(20);
        const second = f.runtime.updateTexture("edit", f.source, { ...region, destinationX: 1 });
        const third = f.runtime.updateTexture("edit", f.source, {
            ...region,
            destinationX: 2,
            destinationY: 1,
        });
        assert.equal(f.reads.length, 1);
        gate.resolve();
        await Promise.all([first, second, third]);
        f.devices[0].destroy();
        await f.devices[0].lost;
        await f.runtime.ready();
        assert.deepEqual(Array.from(f.devices[1].textureWrites[1].data), [
            ...Array(4).fill(10),
            ...Array(4).fill(20),
            ...Array(12).fill(0),
            ...Array(4).fill(20),
        ]);
    } finally {
        f.runtime.dispose();
    }
});

for (const stage of ["queued", "read", "submitted"] as const)
    test(`cancellation at ${stage} preserves pre-submit content and finishes submitted validation`, async () => {
        const f = await fixture();
        try {
            await f.runtime.createTexture("edit", 2, 2);
            const abort = new AbortController(),
                gate = deferred<void>(),
                scopes = deferred<GPUError | null>();
            if (stage !== "submitted") f.gate(gate.promise);
            let blocker: Promise<void> | undefined;
            if (stage === "queued") {
                blocker = f.runtime.updateTexture("edit", f.source, { ...region, destinationX: 1 });
                await tick();
            }
            if (stage === "submitted") f.devices[0].scopeWait = scopes.promise;
            const work = f.runtime.updateTexture("edit", f.source, region, abort.signal);
            const result = work.then(
                () => "accepted",
                () => "cancelled",
            );
            await tick();
            abort.abort();
            gate.resolve();
            scopes.resolve(null);
            assert.equal(await result, stage === "submitted" ? "accepted" : "cancelled");
            await blocker;
            f.devices[0].destroy();
            await f.devices[0].lost;
            await f.runtime.ready();
            assert.equal(f.devices[1].textureWrites[1].data[0], stage === "submitted" ? 1 : 0);
        } finally {
            f.runtime.dispose();
        }
    });

for (const reason of ["release", "replace", "dispose", "loss"] as const)
    test(`${reason} during submitted validation cannot publish stale CPU content or overwrite explicit ID reuse`, async () => {
        const f = await fixture();
        try {
            await f.runtime.createTexture("edit", 2, 2);
            await f.runtime.updateTexture("edit", f.source, region);
            const gate = deferred<GPUError | null>();
            f.devices[0].scopeWait = gate.promise;
            f.value(42);
            const old = f.runtime.updateTexture("edit", f.source, region);
            const rejected = assert.rejects(old);
            await tick();
            f.devices[0].scopeWait = undefined;
            if (reason === "dispose") f.runtime.dispose();
            else if (reason === "replace") await f.runtime.texture("edit", f.source);
            else if (reason === "release") {
                f.runtime.releaseTexture("edit");
                await f.runtime.createTexture("edit", 2, 2);
                f.value(7);
                await f.runtime.updateTexture("edit", f.source, region);
            } else {
                f.devices[0].destroy();
                await f.devices[0].lost;
                await f.runtime.ready();
                assert.equal(f.devices[1].textureWrites[1].data[0], 1);
                // A later edit waits for the invalidated old operation to settle.
            }
            gate.resolve(null);
            await rejected;
            if (reason === "release") {
                f.devices[0].destroy();
                await f.devices[0].lost;
                await f.runtime.ready();
                assert.equal(f.devices[1].textureWrites[1].data[0], 7);
            }
            if (reason === "replace") assert.equal(f.runtime.inspect().manualSources, 1);
            if (reason === "loss") {
                f.value(9);
                await f.runtime.updateTexture("edit", f.source, region);
                assert.equal(f.devices[1].textureWrites.at(-1)?.data[0], 9);
            }
        } finally {
            f.runtime.dispose();
        }
    });

for (const failure of ["copy", "validation"] as const)
    test(`${failure} after submission invalidates the uncertain registration and rejects queued work`, async () => {
        const f = await fixture();
        try {
            await f.runtime.createTexture("edit", 2, 2);
            if (failure === "copy") f.devices[0].failCopy = true;
            else
                f.devices[0].scopeWait = Promise.resolve({
                    message: "Controlled validation failure",
                });
            const first = f.runtime.updateTexture("edit", f.source, region);
            const second = f.runtime.updateTexture("edit", f.source, region);
            await Promise.all([assert.rejects(first), assert.rejects(second)]);
            assert.equal(f.runtime.inspect().manualSources, 0);
            assert.equal(f.devices[0].scopeDepth, 0);
            f.devices[0].failCopy = false;
            f.devices[0].scopeWait = undefined;
            await f.runtime.createTexture("edit", 2, 2);
            await f.runtime.updateTexture("edit", f.source, region);
        } finally {
            f.runtime.dispose();
        }
    });

test("snapshot failure and failed transactional replacement preserve accepted editable content", async () => {
    const f = await fixture();
    try {
        await f.runtime.createTexture("edit", 2, 2);
        await f.runtime.updateTexture("edit", f.source, region);
        f.gate(Promise.reject(new Error("Read failed")));
        await assert.rejects(f.runtime.updateTexture("edit", f.source, region), /Read failed/);
        f.gate();
        f.devices[0].failCopy = true;
        await assert.rejects(f.runtime.texture("edit", f.source));
        f.devices[0].failCopy = false;
        await f.runtime.updateTexture("edit", f.source, { ...region, destinationX: 1 });
        assert.equal(f.runtime.inspect().manualSources, 1);
    } finally {
        f.runtime.dispose();
    }
});

for (const action of ["abort", "release", "replace", "dispose", "validation"] as const)
    test(`editable initialization ${action} before publication cleans its owned image and GPU allocations`, async () => {
        const f = await fixture();
        try {
            const device = f.devices[0],
                gate = deferred<GPUError | null>(),
                abort = new AbortController();
            device.scopeWait = gate.promise;
            const creation = f.runtime.createTexture("edit", 2, 2, abort.signal);
            const rejected = assert.rejects(creation);
            await tick();
            device.scopeWait = undefined;
            if (action === "abort") abort.abort();
            if (action === "release") f.runtime.releaseTexture("edit");
            if (action === "replace") await f.runtime.texture("edit", f.source);
            if (action === "dispose") f.runtime.dispose();
            gate.resolve(
                action === "validation" ? { message: "Controlled initialization failure" } : null,
            );
            await rejected;
            assert.equal(f.runtime.inspect().manualSources, action === "replace" ? 1 : 0);
            assert.equal(f.runtime.inspect().manualReplacements, 0);
            assert.equal(device.textures[1].destroyed, 1);
            assert.equal(device.scopeDepth, 0);
        } finally {
            f.runtime.dispose();
        }
    });

for (const action of ["release", "replace", "dispose"] as const)
    test(`${action} while source capture is pending cancels queued edits before GPU submission`, async () => {
        const f = await fixture();
        try {
            await f.runtime.createTexture("edit", 2, 2);
            const gate = deferred<void>();
            f.gate(gate.promise);
            const old = f.runtime.updateTexture("edit", f.source, region);
            const queued = f.runtime.updateTexture("edit", f.source, region);
            const rejected = [assert.rejects(old), assert.rejects(queued)];
            await tick();
            if (action === "release") {
                f.runtime.releaseTexture("edit");
                await f.runtime.createTexture("edit", 2, 2);
            } else if (action === "replace") await f.runtime.texture("edit", f.source);
            else f.runtime.dispose();
            const writes = f.devices[0].textureWrites.length;
            gate.resolve();
            await Promise.all(rejected);
            assert.equal(f.devices[0].textureWrites.length, writes);
            assert.equal(f.reads.length, 1);
        } finally {
            f.runtime.dispose();
        }
    });

test("unsubmitted edit joins recovery and commits only after a complete restored image is ready", async () => {
    const f = await fixture();
    try {
        await f.runtime.createTexture("edit", 2, 2);
        await f.runtime.updateTexture("edit", f.source, region);
        const gate = deferred<void>();
        f.delayDevice(gate.promise);
        f.devices[0].destroy();
        await f.devices[0].lost;
        f.value(12);
        const patch = f.runtime.updateTexture("edit", f.source, region);
        await tick();
        assert.equal(f.devices.length, 1);
        gate.resolve();
        await patch;
        assert.equal(f.devices[1].textureWrites[1].data[0], 1);
        assert.equal(f.devices[1].textureWrites[2].data[0], 12);
    } finally {
        f.runtime.dispose();
    }
});

test("loss in the readiness continuation gap preserves captured edits and their call order", async () => {
    let lose = () => {};
    const f = await fixture(() => lose());
    const gate = deferred<void>();
    try {
        await f.runtime.createTexture("edit", 2, 2);
        const device = f.devices[0];
        f.delayDevice(gate.promise);
        lose = () => {
            lose = () => {};
            queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => device.destroy())));
        };
        f.value(7);
        const coordinates = { ...region };
        const first = f.runtime.updateTexture("edit", f.source, coordinates);
        let settled = false;
        const outcome = first.finally(() => (settled = true));
        void outcome.catch(() => {});
        coordinates.destinationX = 1;
        const second = f.runtime.updateTexture("edit", f.source, region);
        void second.catch(() => {});
        await tick();
        assert.equal(f.runtime.status, "recovering");
        assert.equal(settled, false);
        assert.equal(device.textureWrites.length, 2); // White and initialization only.
        assert.equal(f.reads.length, 1);
        f.value(9);
        gate.resolve();
        await Promise.all([outcome, second]);
        assert.equal(f.reads.length, 2); // The first patch was captured exactly once.
        assert.deepEqual(
            f.devices[1].textureWrites.map((write) => write.data[0]),
            [255, 0, 7, 9],
        );
        assert.deepEqual(f.devices[1].textureWrites[2].destination.origin, [0, 0]);
        f.devices[1].destroy();
        await f.devices[1].lost;
        await f.runtime.ready();
        assert.equal(f.devices[2].textureWrites[1].data[0], 9);
        assert.equal(f.runtime.inspect().manualSources, 1);
    } finally {
        gate.resolve();
        f.runtime.dispose();
    }
    assert.ok(f.devices.every((device) => device.textures.every((t) => t.destroyed === 1)));
});

test("editable initialization rejoins loss in the readiness continuation gap before publication", async () => {
    const f = await fixture();
    const gate = deferred<void>();
    try {
        const device = f.devices[0];
        f.delayDevice(gate.promise);
        const creation = f.runtime.createTexture("edit", 2, 2);
        let settled = false;
        const outcome = creation.finally(() => (settled = true));
        void outcome.catch(() => {});
        queueMicrotask(() => device.destroy());
        await tick();
        assert.equal(f.runtime.status, "recovering");
        assert.equal(settled, false);
        assert.equal(device.textureWrites.length, 1);
        assert.equal(f.runtime.inspect().manualSources, 0);
        assert.equal(f.runtime.inspect().manualReplacements, 1);
        gate.resolve();
        await outcome;
        assert.equal(f.runtime.inspect().manualSources, 1);
        assert.equal(f.runtime.inspect().manualReplacements, 0);
        assert.equal(f.devices[1].textureWrites.length, 2);
        assert.ok(f.devices[1].textureWrites[1].data.every((byte) => byte === 0));
        await f.runtime.updateTexture("edit", f.source, region);
    } finally {
        gate.resolve();
        f.runtime.dispose();
    }
    assert.ok(f.devices.every((device) => device.textures.every((t) => t.destroyed === 1)));
});

for (const operation of ["create", "update"] as const)
    for (const action of ["abort", "release", "reuse", "dispose", "failure"] as const)
        test(`${operation} waiting after readiness gap respects ${action} and cannot affect ID reuse`, async () => {
            let lose = () => {};
            const f = await fixture(() => lose());
            const gate = deferred<void>();
            try {
                if (operation === "update") await f.runtime.createTexture("edit", 2, 2);
                const device = f.devices[0],
                    abort = new AbortController();
                f.delayDevice(gate.promise);
                lose = () => {
                    lose = () => {};
                    queueMicrotask(() =>
                        queueMicrotask(() => queueMicrotask(() => device.destroy())),
                    );
                };
                const work =
                    operation === "create"
                        ? f.runtime.createTexture("edit", 2, 2, abort.signal)
                        : f.runtime.updateTexture("edit", f.source, region, abort.signal);
                const rejected = assert.rejects(work);
                if (operation === "create") queueMicrotask(() => device.destroy());
                await tick();
                assert.equal(f.runtime.status, "recovering");
                if (action === "abort") abort.abort();
                if (action === "release" || action === "reuse") f.runtime.releaseTexture("edit");
                const replacement =
                    action === "reuse" ? f.runtime.texture("edit", f.source) : undefined;
                if (action === "dispose") f.runtime.dispose();
                if (action === "failure") gate.reject(new Error("Replacement device unavailable"));
                else gate.resolve();
                await Promise.all([rejected, replacement]);
                if (action === "dispose" || action === "failure") {
                    assert.equal(f.runtime.status, action === "dispose" ? "disposed" : "failed");
                } else {
                    await f.runtime.ready();
                    assert.equal(f.runtime.inspect().manualReplacements, 0);
                    if (action === "reuse") {
                        await assert.rejects(
                            f.runtime.updateTexture("edit", f.source, region),
                            /createTexture/,
                        );
                        f.runtime.releaseTexture("edit");
                    } else if (operation === "update" && action === "abort") {
                        assert.equal(f.devices[1].textureWrites[1].data[0], 0);
                        f.runtime.releaseTexture("edit");
                    }
                    await f.runtime.createTexture("edit", 2, 2);
                    await f.runtime.updateTexture("edit", f.source, region);
                    assert.equal(f.runtime.inspect().manualSources, 1);
                }
            } finally {
                gate.resolve();
                f.runtime.dispose();
            }
            assert.ok(f.devices.every((d) => d.textures.every((t) => t.destroyed === 1)));
        });

test("initialization after a readiness gap validates the replacement device dimensions", async () => {
    const f = await fixture();
    const gate = deferred<void>();
    try {
        const device = f.devices[0];
        f.configureDevice((replacement) => (replacement.limits.maxTextureDimension2D = 1));
        f.delayDevice(gate.promise);
        const creation = f.runtime.createTexture("edit", 2, 2);
        const rejected = assert.rejects(creation, /device limit/);
        queueMicrotask(() => device.destroy());
        await tick();
        gate.resolve();
        await rejected;
        assert.equal(f.runtime.inspect().manualSources, 0);
        assert.equal(f.runtime.inspect().manualReplacements, 0);
        assert.equal(f.devices[1].textureWrites.length, 1);
    } finally {
        gate.resolve();
        f.runtime.dispose();
    }
});

test("update rejection preserves validation and cleanup errors while releasing every owned resource", async () => {
    const f = await fixture();
    const device = f.devices[0];
    try {
        await f.runtime.createTexture("edit", 2, 2);
        const cleanup = new Error("Controlled texture destruction failure");
        device.textureDestroyError = cleanup;
        device.scopeWait = Promise.resolve({ message: "Controlled update validation failure" });
        await assert.rejects(
            f.runtime.updateTexture("edit", f.source, region),
            (error: unknown) => {
                assert(error instanceof AggregateError);
                assert.equal(error.message, "Texture update cleanup failed");
                assert(error.errors[0] instanceof AggregateError);
                assert.match(error.errors[0].errors[0].message, /update validation failure/);
                assert(error.errors[1] instanceof AggregateError);
                assert.equal(error.errors[1].errors[0], cleanup);
                return true;
            },
        );
        assert.equal(f.runtime.inspect().sources, 0);
        assert.equal(f.runtime.inspect().textures, 1); // Only the built-in white texture remains.
    } finally {
        device.textureDestroyError = undefined;
        f.runtime.dispose();
    }
});
