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
    // Snapped odd widths place the corner on a whole pixel: round(9999 - 0.5) + 0.5.
    assert.equal(centerX(frame, 9999), 9999.5);
    frame.sort();
    frame.reset();
    frame.rect(7, 9, 1, 1, 0xffffff);
    frame.sort();
    assert.deepEqual(frame.order, [0]);
    assert.equal(frame.textures.length, 1);
    assert.equal(centerX(frame), 7.5);
    frame.reset();
    frame.sort();
    assert.equal(frame.order.length, 0);
});

/** The pre-snap-corner packing: round the composed centre, then convert to the affine corner. */
function legacyGeometry(x: number, y: number, w: number, h: number, angle: number, snap: boolean) {
    if (snap) {
        x = Math.round(x);
        y = Math.round(y);
    }
    const c = Math.cos(angle),
        s = Math.sin(angle);
    const ix = c * w,
        iy = s * w,
        jx = -s * h,
        jy = c * h;
    return new Float32Array([x - (ix + jx) / 2, y - (iy + jy) / 2, ix, iy, jx, jy]);
}

/** Fixed-seed dyadic positions (multiples of 1/64), so `position - size / 2` is exact. */
function snapPositions(): number[] {
    const fixed = [-1000.5, -2.5, -0.5, -0.25, -0, 0, 0.25, 0.5, 2.5, 3.75, 123.625, 4096.5];
    let seed = 0x5eed;
    for (let i = 0; i < 24; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        fixed.push(((seed % 64001) - 32000) / 64);
    }
    return fixed;
}

function snapCameras(): { camera: Camera; alpha: number }[] {
    const still = new Camera();
    const moving = new Camera();
    moving.cut(3.25, -2.125);
    moving.beginTick();
    moving.x = -7.625;
    moving.y = 5.375;
    moving.shakeX = 0.125;
    moving.shakeY = -0.375;
    return [
        { camera: still, alpha: 1 },
        { camera: moving, alpha: 0 },
        { camera: moving, alpha: 0.25 },
        { camera: moving, alpha: 0.7 },
    ];
}

/** One reused frame: reset() keeps the backing array, so each case packs at offset 0. */
const snapFrame = new Frame();
function packOne(
    camera: Camera,
    alpha: number,
    sprite: Parameters<Frame["sprite"]>[0],
): { frame: Frame; x: number; y: number } {
    const frame = snapFrame;
    frame.reset();
    frame.scene(camera, alpha);
    frame.sprite(sprite);
    const view = camera.view(alpha);
    return {
        frame,
        x: sprite.screen ? sprite.x : sprite.x - view.x,
        y: sprite.screen ? sprite.y : sprite.y - view.y,
    };
}

const bytes = (values: Float32Array) =>
    new Uint8Array(values.buffer, values.byteOffset, values.byteLength);

test("pixel snap places unrotated odd, even and flipped quads on whole-pixel corners", () => {
    const sizes = [1, 3, 17, -1, -3, -17, 2, 16, -16];
    for (const { camera, alpha } of snapCameras())
        for (const x of snapPositions())
            for (const width of sizes)
                for (const height of [3, -5, 4])
                    for (const screen of [false, true]) {
                        const sprite = { x, y: -x / 2 - 0.375, width, height, screen };
                        const packed = packOne(camera, alpha, sprite);
                        const [tx, ty, ix, iy, jx, jy] = packed.frame.data;
                        assert.ok(Number.isInteger(tx) && Number.isInteger(ty));
                        // `+ 0` folds -0 into 0: zero's sign is not a position.
                        assert.equal(tx + 0, Math.round(packed.x - width / 2) + 0);
                        assert.equal(ty + 0, Math.round(packed.y - height / 2) + 0);
                        assert.ok(ix === width && iy === 0 && jx === 0 && jy === height);
                        // Covered pixels are |size| whole pixels, independent of the flip sign.
                        assert.equal(
                            Math.min(tx, tx + ix) + 0,
                            Math.round(packed.x - Math.abs(width) / 2) + 0,
                        );
                        assert.equal(
                            Math.min(ty, ty + jy) + 0,
                            Math.round(packed.y - Math.abs(height) / 2) + 0,
                        );
                        assert.ok(Math.abs(tx + ix / 2 - packed.x) <= 0.5);
                        assert.ok(Math.abs(ty + jy / 2 - packed.y) <= 0.5);
                    }
});

test("pixel snap leaves even-sized unrotated packed instances byte-identical", () => {
    const sizes = [-64, -16, -2, -0, 0, 2, 16, 64];
    const positions = [...snapPositions(), 0.49999999999999994, -0.5000000000000001, 1e6 + 0.3];
    for (const { camera, alpha } of snapCameras())
        for (const x of positions)
            for (const width of sizes)
                for (const height of sizes)
                    for (const rotation of [undefined, 0])
                        for (const screen of [false, true]) {
                            const sprite = {
                                x,
                                y: 0.375 - x,
                                width,
                                height,
                                rotation,
                                screen,
                                u: 0.125,
                                v: 0.25,
                                uw: 0.375,
                                vh: 0.625,
                                color: 0x1256ab,
                                alpha: 0.375,
                            };
                            const packed = packOne(camera, alpha, sprite);
                            const expected = new Float32Array(14);
                            expected.set(
                                legacyGeometry(packed.x, packed.y, width, height, 0, true),
                            );
                            expected.set(
                                [
                                    0.125,
                                    0.25,
                                    0.375,
                                    0.625,
                                    0x12 / 255,
                                    0x56 / 255,
                                    0xab / 255,
                                    0.375,
                                ],
                                6,
                            );
                            assert.deepEqual(
                                bytes(packed.frame.data.slice(0, 14)),
                                bytes(expected),
                            );
                        }
});

test("pixelSnap false packs every size and rotation byte-identically to centre packing", () => {
    const sizes = [-17, -11.5, -3, -0, 0, 1, 2.25, 4, 17];
    for (const { camera, alpha } of snapCameras()) {
        camera.pixelSnap = false;
        for (const x of snapPositions())
            for (const width of sizes)
                for (const height of sizes)
                    for (const rotation of [0, Math.PI / 2, Math.PI, 0.731, -2.4])
                        for (const screen of [false, true]) {
                            const sprite = { x, y: x * 0.3 - 1, width, height, rotation, screen };
                            const packed = packOne(camera, alpha, sprite);
                            const expected = legacyGeometry(
                                packed.x,
                                packed.y,
                                width,
                                height,
                                rotation,
                                false,
                            );
                            assert.deepEqual(bytes(packed.frame.data.slice(0, 6)), bytes(expected));
                        }
        camera.pixelSnap = true;
    }
});

test("pixel snap rounds the rotated translation corner and keeps the linear part", () => {
    const quarterTurns = [Math.PI / 2, Math.PI, -Math.PI / 2, (3 * Math.PI) / 2];
    for (const { camera, alpha } of snapCameras())
        for (const x of snapPositions())
            for (const width of [3, -5, 4])
                for (const height of [7, -2])
                    for (const rotation of [...quarterTurns, 0.731, -2.4]) {
                        const sprite = { x, y: 11.375 - x, width, height, rotation };
                        const packed = packOne(camera, alpha, sprite);
                        const [tx, ty, ix, iy, jx, jy] = packed.frame.data;
                        assert.ok(Number.isInteger(tx) && Number.isInteger(ty));
                        const unsnapped = legacyGeometry(0, 0, width, height, rotation, false);
                        assert.deepEqual(
                            bytes(packed.frame.data.slice(2, 6)),
                            bytes(unsnapped.slice(2)),
                        );
                        // The centre moves at most half a pixel per axis.
                        assert.ok(Math.abs(tx + (ix + jx) / 2 - packed.x) <= 0.5 + 1e-6);
                        assert.ok(Math.abs(ty + (iy + jy) / 2 - packed.y) <= 0.5 + 1e-6);
                        const turn = quarterTurns.indexOf(rotation);
                        if (turn < 0) continue;
                        // Quarter turns of integer sizes cover whole pixels at every corner,
                        // the same pixels as the axis-aligned quad, even at half-pixel ties.
                        const xs: number[] = [],
                            ys: number[] = [];
                        for (const [a, b] of [
                            [0, 0],
                            [1, 0],
                            [0, 1],
                            [1, 1],
                        ]) {
                            const cx = tx + a * ix + b * jx,
                                cy = ty + a * iy + b * jy;
                            assert.ok(Math.abs(cx - Math.round(cx)) < 1e-6);
                            assert.ok(Math.abs(cy - Math.round(cy)) < 1e-6);
                            xs.push(Math.round(cx));
                            ys.push(Math.round(cy));
                        }
                        const [spanX, spanY] =
                            turn === 1 ? [width, height] : [height, width].map(Math.abs);
                        assert.equal(
                            Math.min(...xs) + 0,
                            Math.round(packed.x - Math.abs(spanX) / 2) + 0,
                        );
                        assert.equal(
                            Math.min(...ys) + 0,
                            Math.round(packed.y - Math.abs(spanY) / 2) + 0,
                        );
                    }
});

test("pixel snap places quarter-turn quads consistently at exact half-pixel ties", () => {
    const camera = new Camera();
    for (const x of [-3.5, -0.5, 0.5, 7.5, 100.5])
        for (const [width, height] of [
            [16, 16],
            [16, 8],
            [5, 3],
            [-4, 7],
        ])
            for (const rotation of [Math.PI / 2, Math.PI, -Math.PI / 2, (3 * Math.PI) / 2]) {
                const quarter = Math.abs(Math.round(rotation / (Math.PI / 2))) % 2 === 1;
                const [spanX, spanY] = quarter ? [height, width] : [width, height];
                const frame = new Frame();
                frame.scene(camera, 1);
                frame.sprite({ x, y: x, width, height, rotation });
                const [tx, ty, ix, iy, jx, jy] = frame.data;
                const left = Math.round(Math.min(tx, tx + ix, tx + jx, tx + ix + jx));
                const top = Math.round(Math.min(ty, ty + iy, ty + jy, ty + iy + jy));
                assert.equal(left + 0, Math.round(x - Math.abs(spanX) / 2) + 0);
                assert.equal(top + 0, Math.round(x - Math.abs(spanY) / 2) + 0);
            }
});
