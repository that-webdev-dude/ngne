import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Camera, Frame } from "../src/index.js";
import {
    BYTES_PER_QUAD,
    QUAD_FIELDS,
    QUAD_STRIDE,
    QUAD_INSTANCE_BUFFER_LAYOUT,
    QUAD_CORNER_BUFFER_LAYOUT,
} from "../src/quad-layout.js";
import { FRAME_UNIFORM_BYTES, getQuadShaderSource } from "../src/quad-shader.js";
import { centerX, centerY } from "./frame-values.js";

test("packed affine fields, attributes and WGSL independently describe the same 56-byte instance", () => {
    assert.deepEqual(QUAD_FIELDS, {
        tx: 0,
        ty: 1,
        ix: 2,
        iy: 3,
        jx: 4,
        jy: 5,
        u0: 6,
        v0: 7,
        du: 8,
        dv: 9,
        r: 10,
        g: 11,
        b: 12,
        a: 13,
    });
    assert.equal(QUAD_STRIDE, 14);
    assert.equal(BYTES_PER_QUAD, 56);
    assert.equal(FRAME_UNIFORM_BYTES, 48);
    assert.equal(QUAD_INSTANCE_BUFFER_LAYOUT.arrayStride, 56);
    assert.equal(QUAD_CORNER_BUFFER_LAYOUT.arrayStride, 8);
    assert.deepEqual(Array.from(QUAD_INSTANCE_BUFFER_LAYOUT.attributes), [
        { shaderLocation: 0, offset: 0, format: "float32x2" },
        { shaderLocation: 1, offset: 8, format: "float32x4" },
        { shaderLocation: 2, offset: 24, format: "float32x4" },
        { shaderLocation: 3, offset: 40, format: "float32x4" },
    ]);
    const shader = getQuadShaderSource();
    for (const [location, field, size] of [
        [0, "translation", 2],
        [1, "linear", 4],
        [2, "uv", 4],
        [3, "tint", 4],
        [4, "corner", 2],
    ])
        assert.ok(shader.includes(`@location(${location}) ${field}: vec${size}<f32>`));
    assert.match(shader, /straight\.rgb \* straight\.a/);
});

test("affine conversion preserves centered rotation, signed sizes, UV and tint after camera snapping", () => {
    for (const rotation of [0, Math.PI / 2, 0.731])
        for (const width of [-17, 0, 17]) {
            const camera = new Camera();
            camera.pixelSnap = false;
            camera.cut(3.25, -2.125);
            const frame = new Frame();
            frame.scene(camera, 0.25);
            const sprite = Object.freeze({
                x: 123.625,
                y: 87.375,
                width,
                height: -11.5,
                rotation,
                u: 0.125,
                v: 0.25,
                uw: 0.375,
                vh: 0.625,
                color: 0x1256ab,
                alpha: 0.375,
            });
            frame.sprite(sprite);
            const c = Math.cos(rotation),
                s = Math.sin(rotation);
            const expected = new Float32Array([
                120.375 - (c * width - s * -11.5) / 2,
                89.5 - (s * width + c * -11.5) / 2,
                c * width,
                s * width,
                -s * -11.5,
                c * -11.5,
                0.125,
                0.25,
                0.375,
                0.625,
                0x12 / 255,
                0x56 / 255,
                0xab / 255,
                0.375,
            ]);
            assert.deepEqual(frame.data.slice(0, 14), expected);
            assert.ok(Math.abs(centerX(frame) - 120.375) < 1e-4);
            assert.ok(Math.abs(centerY(frame) - 89.5) < 1e-4);
        }
});

test("WebGPU packing and sorted repacking contain no per-sprite subviews or wrappers", () => {
    const source = readFileSync(new URL("../src/quad-renderer.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /\.subarray\(|\.forEach\(/);
    const frame = new Frame();
    for (let i = 0; i < 10000; i++) frame.rect(i, -i, 1, 2, 0xffffff);
    assert.equal(frame.count, 10000);
    assert.ok(frame.data.length >= 140000);
    assert.equal(centerX(frame, 9999), 9999);
    frame.sort();
    frame.reset();
    frame.rect(7, 9, 1, 1, 0xffffff);
    frame.sort();
    assert.deepEqual(frame.order, [0]);
    assert.equal(frame.textures.length, 1);
    assert.equal(centerX(frame), 7);
    frame.reset();
    frame.sort();
    assert.equal(frame.order.length, 0);
});
