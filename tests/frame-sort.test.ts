import assert from "node:assert/strict";
import { test } from "node:test";
import { Camera, Frame } from "../src/index.js";
import { createQuadRenderer } from "../src/quad-renderer.js";
import { QUAD_STRIDE } from "../src/quad-layout.js";
import { FakeDevice, fakePlatform } from "./gpu-fixture.js";

function keys(frame: Frame, name: string): number[] {
    const value: unknown = Reflect.get(frame, name);
    assert.ok(Array.isArray(value) && value.every((item) => typeof item === "number"));
    return value;
}
function canonical(frame: Frame): number[] {
    const scenes = keys(frame, "scenes"),
        layers = keys(frame, "layers"),
        depths = keys(frame, "depths");
    return frame.order
        .slice(0, frame.count)
        .sort(
            (a, b) =>
                scenes[a] - scenes[b] || layers[a] - layers[b] || depths[a] - depths[b] || a - b,
        );
}
function fill(
    frame: Frame,
    count: number,
    layer: (i: number) => number = (i) => ((i * 17) % 7) - 3,
) {
    frame.reset();
    frame.scene(new Camera(), 1);
    for (let i = 0; i < count; i++)
        frame.sprite({
            x: i % 32,
            y: i % 23,
            width: 4,
            height: 4,
            layer: layer(i),
            depth: -0.25,
            texture: i % 3 ? "a" : "b",
            color: i * 127,
            alpha: 0.5,
        });
}
function verify(frame: Frame) {
    const expected = canonical(frame),
        order = frame.order,
        data = frame.data.slice(),
        textures = frame.textures.slice(0, frame.count);
    frame.sort();
    assert.strictEqual(frame.order, order);
    assert.deepEqual(frame.order, expected);
    assert.deepEqual(frame.data, data);
    assert.deepEqual(frame.textures, textures);
}
function scratch(frame: Frame): Uint32Array | undefined {
    const value: unknown = Reflect.get(frame, "sortIndices");
    assert.ok(value === undefined || value instanceof Uint32Array);
    return value;
}

test("bounded layer sort matches canonical indices at count/span limits and signed layers", () => {
    const frame = new Frame();
    for (const count of [32767, 32768, 32769, 65537, 128000, 262144, 262145]) {
        fill(frame, count);
        verify(frame);
        verify(frame); // Already sorted non-identity input must keep its canonical order.
    }
    for (const [min, span] of [
        [-31, 64],
        [-31, 65],
        [0, 1],
        [Number.MAX_SAFE_INTEGER - 63, 64],
        [Number.MIN_SAFE_INTEGER, 64],
    ]) {
        fill(frame, 32768, (i) => min + (i % span));
        verify(frame);
    }
    assert.equal(scratch(frame)?.byteLength, 1048576);
    const buckets: unknown = Reflect.get(frame, "layerCursors");
    assert.ok(buckets instanceof Uint32Array);
    assert.equal(buckets.byteLength, 256);
});

test("unsupported keys and public order mutations use the exact caller-input comparator", () => {
    const changes: ((frame: Frame) => void)[] = [
        (f) => {
            f.order.reverse();
        },
        (f) => {
            f.order[32767] = 0;
        },
        (f) => {
            delete f.order[32767];
        },
        (f) => {
            f.order[32767] = 999999;
        },
        ...[0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, 65].map(
            (layer) => (f: Frame) => {
                keys(f, "layers")[32767] = layer;
            },
        ),
        ...[0.125, NaN, Infinity, -Infinity].map((depth) => (f: Frame) => {
            keys(f, "depths")[32767] = depth;
        }),
        ...[1, NaN, Infinity].map((scene) => (f: Frame) => {
            keys(f, "scenes")[32767] = scene;
        }),
        (f) => {
            keys(f, "layers")[0] = Number.MIN_SAFE_INTEGER;
            keys(f, "layers")[32767] = Number.MAX_SAFE_INTEGER;
        },
        (f) => {
            keys(f, "depths").fill(NaN);
        },
        (f) => {
            keys(f, "scenes").fill(Infinity);
        },
    ];
    for (const change of changes) {
        const frame = new Frame();
        fill(frame, 32768);
        change(frame);
        verify(frame);
        assert.equal(scratch(frame), undefined, "fallback must not allocate scratch");
    }
});

test("scratch grows geometrically, stays capped and survives reset with no stale tails", () => {
    const frame = new Frame();
    for (const count of [4, 32768, 32769, 40000, 128000, 262144]) {
        fill(frame, count);
        verify(frame);
        assert.equal(
            scratch(frame)?.length ?? 0,
            count < 32768 ? 0 : 2 ** Math.ceil(Math.log2(count)),
        );
    }
    const retained = scratch(frame);
    for (const [count, min, span] of [
        [32768, 20, 2],
        [64000, -60, 64],
        [1, 0, 1],
        [0, 0, 1],
        [32768, -12, 3],
    ]) {
        fill(frame, count, (i) => min + (i % span));
        verify(frame);
        assert.strictEqual(scratch(frame), retained);
    }
});

test("seeded eligible distributions preserve insertion ties", () => {
    let seed = 0x19ae52;
    const frame = new Frame();
    for (const span of [1, 2, 7, 63, 64]) {
        fill(frame, 33000, () => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return (seed % span) - 31;
        });
        verify(frame);
    }
});

test("candidate and comparator produce identical uploaded bytes and adjacent texture batches", async () => {
    fakePlatform();
    const device = new FakeDevice();
    device.limits.maxBufferSize = 56 * 65536;
    const writes: Uint8Array[] = [];
    device.queue.writeBuffer = (_buffer, _offset, data, dataOffset = 0, size = data.length) => {
        writes.push(
            new Uint8Array(
                data.buffer,
                data.byteOffset + dataOffset * data.BYTES_PER_ELEMENT,
                size * data.BYTES_PER_ELEMENT,
            ).slice(),
        );
    };
    const renderer = await createQuadRenderer(device as unknown as GPUDevice, "rgba8unorm");
    await renderer.texture("a", {} as GPUTextureView);
    await renderer.texture("b", {} as GPUTextureView);
    const frame = new Frame();
    fill(frame, 32768);
    const expected = canonical(frame);
    const expectedUpload = new Float32Array(frame.count * QUAD_STRIDE);
    for (let i = 0; i < frame.count; i++)
        for (let j = 0; j < QUAD_STRIDE; j++)
            expectedUpload[i * QUAD_STRIDE + j] = frame.data[expected[i] * QUAD_STRIDE + j];
    const batches =
        1 +
        expected
            .slice(1)
            .filter((source, i) => frame.textures[source] !== frame.textures[expected[i]]).length;
    renderer.prepare(frame);
    const encoder = device.createCommandEncoder();
    renderer.encode(
        encoder as unknown as GPUCommandEncoder,
        {} as GPUTextureView,
        frame,
        64,
        64,
        0,
    );
    assert.deepEqual(writes.at(-1), new Uint8Array(expectedUpload.buffer));
    assert.equal(renderer.stats.drawCalls, batches);
    // Texture validation still happens before sorting and scratch allocation.
    const invalid = new Frame();
    fill(invalid, 32768);
    invalid.textures[32767] = "missing";
    const before = invalid.order.slice();
    assert.throws(() => renderer.prepare(invalid), /Texture is not ready/);
    assert.deepEqual(invalid.order, before);
    assert.equal(scratch(invalid), undefined);
    renderer.dispose();
});
