import assert from "node:assert/strict";
import { test } from "node:test";

import { Camera } from "../src/primitives.js";
import { Frame, type Sprite } from "../src/renderer.js";
import type { ClipRect } from "../src/sprite-clip.js";
import { WebGpuRuntime } from "../src/webgpu-runtime.js";
import { fakeBitmap, fakePlatform, type FakeDevice } from "./gpu-fixture.js";

async function setup(prepare?: (device: FakeDevice) => void) {
    const platform = fakePlatform(),
        diagnostics: unknown[] = [];
    if (prepare) platform.configureDevice(prepare);
    const runtime = await WebGpuRuntime.create(
        platform.canvas,
        64,
        64,
        (e) => diagnostics.push(e),
        { ...platform, snapshot: async () => fakeBitmap().image },
    );
    return { platform, diagnostics, runtime };
}

const quad = (clip?: ClipRect, extra: Partial<Sprite> = {}): Sprite => ({
    x: 8,
    y: 8,
    width: 4,
    height: 4,
    clip,
    ...extra,
});

/** Renders `sprites` and returns the scissor and draw commands its pass encoded. */
function encoded(runtime: WebGpuRuntime, device: FakeDevice, frame: Frame) {
    const before = device.commands.length;
    runtime.render(frame, 0);
    return device.commands.slice(before);
}

function frameOf(sprites: readonly Sprite[]) {
    const frame = new Frame();
    for (const sprite of sprites) frame.sprite(sprite);
    return frame;
}

test("omitted clips encode no scissor and keep draws and upload bytes", async () => {
    const { platform, runtime, diagnostics } = await setup();
    try {
        const device = platform.devices[0];
        const sprites = [quad(), quad(undefined, { x: 20 }), quad(undefined, { x: 30 })];
        const plain = frameOf(sprites.map(({ clip: _clip, ...rest }) => rest));
        assert.deepEqual(encoded(runtime, device, plain), ["draw 3"]);
        const plainUpload = device.writes.at(-1);
        assert.deepEqual(encoded(runtime, device, frameOf(sprites)), ["draw 3"]);
        assert.deepEqual(device.writes.at(-1), plainUpload);
        // A clip covering the whole target is the full-target scissor and batches with others.
        const covering = frameOf([quad({ x: -4, y: 0, width: 100, height: 64 }), quad()]);
        assert.deepEqual(encoded(runtime, device, covering), ["draw 2"]);
        assert.equal(runtime.drawCalls, 1);
        assert.equal(diagnostics.length, 0);
    } finally {
        runtime.dispose();
    }
});

test("equal clips batch by value, changes split and unclipped draws restore the target", async () => {
    const { platform, runtime, diagnostics } = await setup();
    try {
        const device = platform.devices[0];
        await runtime.texture("t", fakeBitmap().image);
        const frame = frameOf([
            quad({ x: 1, y: 2, width: 10, height: 10 }),
            quad({ x: 1, y: 2, width: 10, height: 10 }),
            quad({ x: 5, y: 5, width: 4, height: 4 }),
            quad({ x: 5, y: 5, width: 4, height: 4 }, { texture: "t" }),
            quad(),
            quad(),
        ]);
        frame.rect(0, 0, 4, 4, 0xffffff);
        assert.deepEqual(encoded(runtime, device, frame), [
            "scissor 1,2,10,10",
            "draw 2",
            "scissor 5,5,4,4",
            "draw 1",
            "draw 1",
            "scissor 0,0,64,64",
            "draw 3",
        ]);
        assert.equal(runtime.drawCalls, 4);
        assert.equal(runtime.sprites, 7);
        assert.equal(diagnostics.length, 0);
    } finally {
        runtime.dispose();
    }
});

test("clips intersect the target and empty intersections draw nothing", async () => {
    const { platform, runtime, diagnostics } = await setup();
    try {
        const device = platform.devices[0];
        const submissions = device.submissions;
        const frame = frameOf([
            quad({ x: -5, y: -3, width: 10, height: 10 }),
            quad({ x: 60, y: 62, width: 10, height: 10 }),
            quad({ x: 64, y: 0, width: 5, height: 5 }),
            quad({ x: 10, y: 10, width: 0, height: 5 }),
            quad({ x: -20, y: -20, width: 5, height: 5 }),
            quad({ x: 10, y: 10, width: 5, height: 0 }),
            quad(),
        ]);
        assert.deepEqual(encoded(runtime, device, frame), [
            "scissor 0,0,5,7",
            "draw 1",
            "scissor 60,62,4,2",
            "draw 1",
            "scissor 0,0,64,64",
            "draw 1",
        ]);
        assert.equal(runtime.drawCalls, 3);
        assert.equal(runtime.sprites, 7);
        assert.equal(device.submissions, submissions + 1);
        // Instance upload still covers every sprite, drawn or not.
        assert.equal(device.writes.at(-1)?.size, 7 * 14);
        assert.equal(diagnostics.length, 0);
    } finally {
        runtime.dispose();
    }
});

test("invalid clips skip the submission before sorting and corrected frames render", async () => {
    const { platform, runtime, diagnostics } = await setup();
    try {
        const device = platform.devices[0];
        const invalid: unknown[] = [
            { x: 0.5, y: 0, width: 4, height: 4 },
            { x: 0, y: Number.NaN, width: 4, height: 4 },
            { x: 0, y: 0, width: Infinity, height: 4 },
            { x: 0, y: 0, width: 4, height: -1 },
            { x: 2 ** 53, y: 0, width: 4, height: 4 },
            { x: Number.MAX_SAFE_INTEGER, y: 0, width: 1, height: 4 },
            { x: "3", y: 0, width: 4, height: 4 },
            { x: 0, y: 0, width: 4 },
            null,
            7,
        ];
        for (const clip of invalid) {
            const frame = new Frame();
            frame.sprite(quad(undefined, { layer: 1 }));
            frame.sprite(quad(clip as ClipRect, { layer: 0 }));
            const submissions = device.submissions;
            assert.deepEqual(encoded(runtime, device, frame), [], String(clip));
            assert.equal(device.submissions, submissions);
            // Validation precedes sorting: insertion order is untouched.
            assert.deepEqual(frame.order, [0, 1]);
            assert.match(String(diagnostics.at(-1)), /RangeError: Invalid sprite clip/);
            const corrected = frameOf([quad({ x: 0, y: 0, width: 4, height: 4 })]);
            assert.deepEqual(encoded(runtime, device, corrected), ["scissor 0,0,4,4", "draw 1"]);
            assert.equal(device.submissions, submissions + 1);
        }
        assert.equal(diagnostics.length, invalid.length);
        // A fully clipped sprite still needs a ready texture.
        const hidden = frameOf([
            quad({ x: 100, y: 100, width: 1, height: 1 }, { texture: "missing" }),
        ]);
        assert.deepEqual(encoded(runtime, device, hidden), []);
        assert.match(String(diagnostics.at(-1)), /Texture is not ready: missing/);
    } finally {
        runtime.dispose();
    }
});

test("clip snapshots survive caller mutation, frame growth and reset", async () => {
    const { platform, runtime, diagnostics } = await setup((device) => {
        device.limits.maxBufferSize = 56 * 65536;
    });
    try {
        const device = platform.devices[0];
        const rect = { x: 1, y: 1, width: 4, height: 4 };
        const frame = frameOf([quad(rect), quad(rect)]);
        rect.x = 30;
        rect.width = 1;
        assert.deepEqual(encoded(runtime, device, frame), ["scissor 1,1,4,4", "draw 2"]);
        // Reuse: stale clips at the same indices do not leak into the next frame.
        frame.reset();
        frame.sprite(quad());
        frame.sprite(quad());
        assert.deepEqual(encoded(runtime, device, frame), ["draw 2"]);
        frame.reset();
        frame.sprite(quad());
        frame.sprite(quad(rect));
        assert.deepEqual(encoded(runtime, device, frame), ["draw 1", "scissor 30,1,1,4", "draw 1"]);
        // The first clip after thousands of unclipped sprites, across Frame and clip growth.
        frame.reset();
        for (let i = 0; i < 3000; i++) frame.sprite(quad());
        for (let i = 0; i < 3000; i++) frame.sprite(quad({ x: 2, y: 3, width: 4, height: 5 }));
        frame.sprite(quad());
        assert.deepEqual(encoded(runtime, device, frame), [
            "draw 3000",
            "scissor 2,3,4,5",
            "draw 3000",
            "scissor 0,0,64,64",
            "draw 1",
        ]);
        assert.equal(diagnostics.length, 0);
    } finally {
        runtime.dispose();
    }
});

test("clips stay attached through comparator sorting and the layer fast path", async () => {
    const { platform, runtime, diagnostics } = await setup((device) => {
        device.limits.maxBufferSize = 56 * 65536;
    });
    try {
        const device = platform.devices[0];
        const sorted = frameOf([
            quad({ x: 0, y: 0, width: 8, height: 8 }, { layer: 2 }),
            quad({ x: 1, y: 1, width: 2, height: 2 }, { layer: 1, depth: 5 }),
            quad(undefined, { layer: 1, depth: -5 }),
        ]);
        assert.deepEqual(encoded(runtime, device, sorted), [
            "draw 1",
            "scissor 1,1,2,2",
            "draw 1",
            "scissor 0,0,8,8",
            "draw 1",
        ]);
        assert.deepEqual(sorted.order, [2, 1, 0]);
        // Interleaved layers with one scene and depth take the counting sort.
        const large = new Frame();
        large.scene(new Camera(), 1);
        for (let i = 0; i < 32768; i++)
            large.sprite(
                quad(i % 2 ? { x: 3, y: 4, width: 5, height: 6 } : undefined, { layer: i % 2 }),
            );
        assert.deepEqual(encoded(runtime, device, large), [
            "draw 16384",
            "scissor 3,4,5,6",
            "draw 16384",
        ]);
        assert.ok(Reflect.get(large, "sortIndices") instanceof Uint32Array);
        assert.equal(diagnostics.length, 0);
    } finally {
        runtime.dispose();
    }
});

test("camera, shake, zoom and snapping move sprites but never the clip", async () => {
    const { platform, runtime, diagnostics } = await setup();
    try {
        const device = platform.devices[0];
        const clip = { x: 4, y: 6, width: 20, height: 10 };
        const author = (camera: Camera) => {
            const frame = new Frame();
            frame.scene(camera, 0.5);
            frame.sprite(quad(clip));
            frame.sprite(quad(clip, { screen: true }));
            return frame;
        };
        const still = author(new Camera());
        const moving = new Camera();
        moving.cut(10, 5, 2);
        moving.x = 13.3;
        moving.zoom = 2.5;
        moving.shakeX = 1.7;
        moving.pixelSnap = false;
        const moved = author(moving);
        assert.notDeepEqual(moved.data.slice(0, 6), still.data.slice(0, 6));
        assert.deepEqual(encoded(runtime, device, still), ["scissor 4,6,20,10", "draw 2"]);
        assert.deepEqual(encoded(runtime, device, moved), ["scissor 4,6,20,10", "draw 2"]);
        assert.equal(diagnostics.length, 0);
    } finally {
        runtime.dispose();
    }
});

test("backing pixels govern clips across independent sizes, resize and recovery", async () => {
    const { platform, runtime, diagnostics } = await setup();
    try {
        // Creation leaves backing size to the caller: logical 64×64 over a 100×40 canvas.
        platform.canvas.width = 100;
        platform.canvas.height = 40;
        const frame = frameOf([quad({ x: 90, y: 30, width: 50, height: 50 }), quad()]);
        assert.deepEqual(encoded(runtime, platform.devices[0], frame), [
            "scissor 90,30,10,10",
            "draw 1",
            "scissor 0,0,100,40",
            "draw 1",
        ]);
        runtime.resize(32, 48);
        const resized = frameOf([quad({ x: 20, y: 40, width: 50, height: 50 }), quad()]);
        const expected = ["scissor 20,40,12,8", "draw 1", "scissor 0,0,32,48", "draw 1"];
        assert.deepEqual(encoded(runtime, platform.devices[0], resized), expected);
        for (let generation = 0; generation < 2; generation++) {
            platform.devices[generation].destroy();
            await platform.devices[generation].lost;
            await runtime.ready();
            assert.deepEqual(encoded(runtime, platform.devices[generation + 1], resized), expected);
        }
        assert.equal(diagnostics.length, 0);
    } finally {
        runtime.dispose();
    }
});
