import assert from "node:assert/strict";
import { test } from "node:test";

import { imageAsset, type ImageAsset, type TextureSampling } from "../src/assets.js";
import { Frame } from "../src/renderer.js";
import { WebGpuRuntime } from "../src/webgpu-runtime.js";
import { deferred, fakeBitmap, fakePlatform, type FakeDevice } from "./gpu-fixture.js";

const NEAREST_CLAMP = {
    magFilter: "nearest",
    minFilter: "nearest",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
};
const LINEAR_CLAMP = { ...NEAREST_CLAMP, magFilter: "linear", minFilter: "linear" };
const NEAREST_REPEAT = { ...NEAREST_CLAMP, addressModeU: "repeat", addressModeV: "repeat" };
const LINEAR_REPEAT = { ...LINEAR_CLAMP, addressModeU: "repeat", addressModeV: "repeat" };

async function setup() {
    const platform = fakePlatform(),
        diagnostics: unknown[] = [],
        snapshots: ReturnType<typeof fakeBitmap>[] = [];
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
    return { platform, diagnostics, snapshots, runtime };
}

function lease(id: string) {
    const bitmap = fakeBitmap();
    const record = { releases: 0 };
    return {
        record,
        bitmap,
        lease: {
            id,
            value: bitmap.image,
            release() {
                record.releases++;
            },
        },
    };
}

function asset(id: string, sampling?: TextureSampling): ImageAsset {
    return { id, kind: "image", load: async () => fakeBitmap().image, sampling };
}

/** Renders one quad per ID and returns the sampler each draw run bound, in draw order. */
function drawnSamplers(runtime: WebGpuRuntime, device: FakeDevice, ids: readonly string[]) {
    const frame = new Frame();
    for (const id of ids) frame.sprite({ x: 4, y: 4, width: 4, height: 4, texture: id });
    const before = device.usedBindings.length;
    runtime.render(frame, 0);
    return device.usedBindings.slice(before).map((binding) => device.bindingSamplers.get(binding));
}

test("default registrations bind the original nearest clamp sampler on every route", async () => {
    const { platform, runtime, diagnostics } = await setup();
    try {
        const device = platform.devices[0];
        // The first sampler keeps the exact descriptor the renderer always created.
        assert.deepEqual(device.samplers[0], NEAREST_CLAMP);
        const leased = lease("leased");
        await runtime.acquire(asset("leased"), leased.lease, new AbortController().signal);
        await runtime.texture("manual", fakeBitmap().image);
        await runtime.createTexture("editable", 2, 2);
        await runtime.texture("explicit", fakeBitmap().image, undefined, {
            filter: "nearest",
            address: "clamp",
        });
        const drawn = drawnSamplers(runtime, device, [
            "",
            "leased",
            "manual",
            "editable",
            "explicit",
        ]);
        assert.equal(runtime.drawCalls, 5);
        assert.deepEqual(drawn, Array(5).fill(NEAREST_CLAMP));
        // Defaults and explicit defaults share one sampler object.
        assert.equal(new Set(drawn).size, 1);
        assert.equal(imageAsset("plain", "./plain.png").sampling, undefined);
        assert.ok(!("sampling" in imageAsset("plain", "./plain.png")));
        assert.equal(diagnostics.length, 0);
    } finally {
        runtime.dispose();
    }
});

test("texture, createTexture and image assets bind their requested sampling", async () => {
    const { platform, runtime, diagnostics } = await setup();
    try {
        const device = platform.devices[0];
        const leased = lease("tiles");
        await runtime.acquire(
            imageAsset("tiles", "./tiles.png", { address: "repeat" }),
            leased.lease,
            new AbortController().signal,
        );
        await runtime.texture("smooth", fakeBitmap().image, undefined, { filter: "linear" });
        await runtime.createTexture("both", 2, 2, undefined, {
            filter: "linear",
            address: "repeat",
        });
        assert.deepEqual(drawnSamplers(runtime, device, ["tiles", "smooth", "both"]), [
            NEAREST_REPEAT,
            LINEAR_CLAMP,
            LINEAR_REPEAT,
        ]);
        // Replacement with texture() adopts the replacement's sampling.
        await runtime.texture("smooth", fakeBitmap().image);
        assert.deepEqual(drawnSamplers(runtime, device, ["smooth"]), [NEAREST_CLAMP]);
        // Editable updates reuse the registration's binding and sampling.
        const bindings = device.bindings.length;
        await runtime.updateTexture(
            "both",
            { width: 1, height: 1, data: new Uint8Array(4) },
            { sourceX: 0, sourceY: 0, width: 1, height: 1, destinationX: 1, destinationY: 1 },
        );
        assert.equal(device.bindings.length, bindings);
        assert.deepEqual(drawnSamplers(runtime, device, ["both"]), [LINEAR_REPEAT]);
        assert.equal(diagnostics.length, 0);
    } finally {
        runtime.dispose();
    }
});

test("batching and draw calls are unchanged for consecutive quads sharing a sampled texture", async () => {
    const { platform, runtime } = await setup();
    try {
        const device = platform.devices[0];
        await runtime.texture("plain-a", fakeBitmap().image);
        await runtime.texture("plain-b", fakeBitmap().image);
        await runtime.texture("smooth", fakeBitmap().image, undefined, { filter: "linear" });
        await runtime.texture("tiled", fakeBitmap().image, undefined, { address: "repeat" });
        const runs = (a: string, b: string) => [a, a, a, b, b, a, "", ""];
        const plain = drawnSamplers(runtime, device, runs("plain-a", "plain-b"));
        const plainDraws = runtime.drawCalls;
        const sampled = drawnSamplers(runtime, device, runs("smooth", "tiled"));
        assert.equal(plainDraws, 4);
        assert.equal(runtime.drawCalls, plainDraws);
        assert.equal(runtime.sprites, 8);
        assert.deepEqual(plain, Array(4).fill(NEAREST_CLAMP));
        assert.deepEqual(sampled, [LINEAR_CLAMP, NEAREST_REPEAT, LINEAR_CLAMP, NEAREST_CLAMP]);
    } finally {
        runtime.dispose();
    }
});

test("sampling is restored on every route after controlled device loss and recovery", async () => {
    const { platform, runtime, diagnostics } = await setup();
    try {
        const leased = lease("tiles");
        await runtime.acquire(
            asset("tiles", { address: "repeat" }),
            leased.lease,
            new AbortController().signal,
        );
        await runtime.texture("smooth", fakeBitmap().image, undefined, { filter: "linear" });
        await runtime.createTexture("both", 2, 2, undefined, {
            filter: "linear",
            address: "repeat",
        });
        await runtime.texture("plain", fakeBitmap().image);
        const ids = ["tiles", "smooth", "both", "plain", ""];
        const expected = [
            NEAREST_REPEAT,
            LINEAR_CLAMP,
            LINEAR_REPEAT,
            NEAREST_CLAMP,
            NEAREST_CLAMP,
        ];
        assert.deepEqual(drawnSamplers(runtime, platform.devices[0], ids), expected);
        const inspection = runtime.inspect();
        for (let generation = 0; generation < 2; generation++) {
            platform.devices[generation].destroy();
            await platform.devices[generation].lost;
            await runtime.ready();
            const replacement = platform.devices[generation + 1];
            assert.equal(runtime.status, "ready");
            assert.deepEqual(drawnSamplers(runtime, replacement, ids), expected);
            assert.equal(runtime.drawCalls, ids.length);
            assert.deepEqual(runtime.inspect(), inspection);
        }
        assert.equal(leased.record.releases, 0);
        assert.equal(diagnostics.length, 0);
    } finally {
        runtime.dispose();
    }
});

const INVALID: readonly unknown[] = [
    null,
    "linear",
    [],
    { filter: "bilinear" },
    { filter: "LINEAR" },
    { address: "mirror-repeat" },
    { address: "clamp-to-edge" },
    { filter: "linear", wrap: "repeat" },
    { address: 1 },
];

test("invalid sampling rejects at registration without altering existing textures", async () => {
    const { platform, runtime, snapshots, diagnostics } = await setup();
    try {
        const device = platform.devices[0];
        await runtime.texture("smooth", fakeBitmap().image, undefined, { filter: "linear" });
        await runtime.createTexture("editable", 2, 2, undefined, { address: "repeat" });
        const leased = lease("leased");
        await runtime.acquire(
            asset("leased", { filter: "linear", address: "repeat" }),
            leased.lease,
            new AbortController().signal,
        );
        const ids = ["smooth", "editable", "leased"];
        const before = drawnSamplers(runtime, device, ids),
            inspection = runtime.inspect(),
            bindings = device.bindings.length,
            textures = device.textures.length;
        for (const sampling of INVALID) {
            const invalid = sampling as TextureSampling;
            await assert.rejects(
                runtime.texture("smooth", fakeBitmap().image, undefined, invalid),
                /Invalid texture sampling/,
            );
            await assert.rejects(
                runtime.texture("fresh", fakeBitmap().image, undefined, invalid),
                /Invalid texture sampling/,
            );
            await assert.rejects(
                runtime.createTexture("fresh", 2, 2, undefined, invalid),
                /Invalid texture sampling/,
            );
            const rejected = lease("bad");
            await assert.rejects(
                runtime.acquire(
                    asset("bad", invalid),
                    rejected.lease,
                    new AbortController().signal,
                ),
                /Invalid texture sampling/,
            );
            assert.equal(rejected.record.releases, 1);
            assert.throws(
                () => imageAsset("bad", "./bad.png", invalid),
                /Invalid texture sampling/,
            );
        }
        assert.equal(snapshots.length, 1);
        assert.equal(device.bindings.length, bindings);
        assert.equal(device.textures.length, textures);
        assert.deepEqual(runtime.inspect(), inspection);
        assert.deepEqual(drawnSamplers(runtime, device, ids), before);
        // Rejected IDs stay free for a valid registration.
        await runtime.createTexture("fresh", 2, 2, undefined, { filter: "linear" });
        assert.deepEqual(drawnSamplers(runtime, device, ["fresh"]), [LINEAR_CLAMP]);
        assert.equal(diagnostics.length, 0);
    } finally {
        runtime.dispose();
    }
});

test("invalid sampling does not supersede a pending replacement for the same ID", async () => {
    const platform = fakePlatform(),
        snapshot = deferred<ImageBitmap>(),
        pending = fakeBitmap();
    const runtime = await WebGpuRuntime.create(platform.canvas, 64, 64, () => {}, {
        ...platform,
        snapshot: () => snapshot.promise,
    });
    try {
        const replacement = runtime.texture("smooth", pending.image, undefined, {
            filter: "linear",
        });
        await assert.rejects(
            runtime.texture("smooth", pending.image, undefined, {
                filter: "cubic",
            } as unknown as TextureSampling),
            /Invalid texture sampling/,
        );
        snapshot.resolve(pending.image);
        await replacement;
        assert.deepEqual(drawnSamplers(runtime, platform.devices[0], ["smooth"]), [LINEAR_CLAMP]);
    } finally {
        runtime.dispose();
    }
});

test("image asset sampling is validated, copied and frozen at definition time", () => {
    const options: { filter?: "nearest" | "linear"; address?: "clamp" | "repeat" } = {
        filter: "linear",
    };
    const definition = imageAsset("copied", "./copied.png", options);
    options.filter = "nearest";
    options.address = "repeat";
    assert.deepEqual(definition.sampling, { filter: "linear", address: "clamp" });
    assert.ok(Object.isFrozen(definition.sampling));
    let reads = 0;
    const counted = imageAsset("counted", "./counted.png", {
        get filter() {
            reads++;
            return "linear" as const;
        },
    });
    assert.equal(reads, 1);
    assert.deepEqual(counted.sampling, { filter: "linear", address: "clamp" });
});
