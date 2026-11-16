import assert from "node:assert/strict";
import { test } from "node:test";

import { Camera, emptyInput, Frame, Game, pressed } from "../src/index.js";
import type { SceneDefinition } from "../src/index.js";
import { centerX, centerY } from "./frame-values.js";

const bytes = (values: Float32Array) =>
    new Uint8Array(values.buffer, values.byteOffset, values.byteLength);

/** Fixed-seed dyadic positions (multiples of 1/64), so scaled values stay exact. */
function positions(): number[] {
    const fixed = [-1000.5, -2.5, -0.5, -0.25, -0, 0, 0.25, 0.5, 2.5, 3.75, 123.625, 4096.5];
    let seed = 0x200e;
    for (let i = 0; i < 16; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        fixed.push(((seed % 64001) - 32000) / 64);
    }
    return fixed;
}

function movingCamera(zoom: number, previousZoom = zoom): Camera {
    const camera = new Camera();
    camera.cut(3.25, -2.125, previousZoom);
    camera.beginTick();
    camera.x = -7.625;
    camera.y = 5.375;
    camera.zoom = zoom;
    camera.shakeX = 0.125;
    camera.shakeY = -0.375;
    return camera;
}

const frame = new Frame();
function pack(camera: Camera, alpha: number, sprite: Parameters<Frame["sprite"]>[0]) {
    frame.reset();
    frame.scene(camera, alpha);
    frame.sprite(sprite);
    return frame.data.slice(0, 14);
}

test("camera zoom 1 packs world quads byte-identically to unzoomed camera subtraction", () => {
    const cameras: [Camera, number][] = [
        [new Camera(), 1],
        [movingCamera(1), 0],
        [movingCamera(1), 0.25],
        [movingCamera(1), 0.7],
        [movingCamera(1), 1],
    ];
    const sizes = [-17, -11.5, -2, -0, 0, 1, 2.25, 3, 16];
    for (const [camera, alpha] of cameras)
        for (const snap of [true, false]) {
            camera.pixelSnap = snap;
            const view = camera.view(alpha);
            assert.equal(view.zoom, 1);
            for (const x of positions())
                for (const width of sizes)
                    for (const rotation of [0, Math.PI / 2, 0.731])
                        for (const screen of [false, true]) {
                            const sprite = {
                                x,
                                y: 0.375 - x,
                                width,
                                height: -width / 2 + 1,
                                rotation,
                                screen,
                                u: 0.125,
                                v: 0.25,
                                uw: 0.375,
                                vh: 0.625,
                                color: 0x1256ab,
                                alpha: 0.375,
                            };
                            // The screen-space path never reads the camera: feeding it the
                            // pre-subtracted position reproduces the unzoomed world packing.
                            const unzoomed = pack(camera, alpha, {
                                ...sprite,
                                x: screen ? x : x - view.x,
                                y: screen ? sprite.y : sprite.y - view.y,
                                screen: true,
                            });
                            assert.deepEqual(bytes(pack(camera, alpha, sprite)), bytes(unzoomed));
                        }
        }
});

test("camera zoom scales world quads about the viewport top-left and leaves screen quads alone", () => {
    for (const zoom of [0.5, 1.75, 2, 3])
        for (const alpha of [0, 0.4, 1]) {
            const camera = movingCamera(zoom);
            camera.pixelSnap = false;
            const unzoomedScreen = new Camera();
            unzoomedScreen.pixelSnap = false;
            const view = camera.view(alpha);
            assert.equal(view.zoom, zoom);
            for (const x of positions())
                for (const rotation of [0, Math.PI / 2, 0.731]) {
                    const sprite = { x, y: 11.375 - x, width: 6, height: -3, rotation };
                    const world = pack(camera, alpha, sprite);
                    const c = Math.cos(rotation),
                        s = Math.sin(rotation);
                    const expectedX = (sprite.x - view.x) * zoom,
                        expectedY = (sprite.y - view.y) * zoom;
                    // Packed values are float32: allow a few units in the last place.
                    const near = (actual: number, expected: number) =>
                        Math.abs(actual - expected) <= 1e-6 + Math.abs(expected) * 2 ** -20;
                    assert.ok(near(centerX(frame), expectedX));
                    assert.ok(near(centerY(frame), expectedY));
                    const w = 6 * zoom,
                        h = -3 * zoom;
                    assert.deepEqual(
                        bytes(world.slice(2, 6)),
                        bytes(new Float32Array([c * w, s * w, -s * h, c * h])),
                    );
                    const screen = { ...sprite, screen: true };
                    assert.deepEqual(
                        bytes(pack(camera, alpha, screen)),
                        bytes(pack(unzoomedScreen, 1, screen)),
                        "screen-space quads ignore camera zoom",
                    );
                }
            // The world point at camera x/y stays at the viewport's top-left corner.
            pack(camera, alpha, { x: view.x + 2, y: view.y + 1, width: 4, height: 2 });
            assert.ok(Math.abs(frame.data[0]) <= 1e-3 && Math.abs(frame.data[1]) <= 1e-3);
            assert.ok(Math.abs(frame.data[2] - 4 * zoom) <= 1e-6);
        }
});

test("camera zoom interpolates with alpha and resets through beginTick and cut", () => {
    const camera = new Camera();
    camera.pixelSnap = false;
    assert.equal(camera.zoom, 1);
    assert.equal(camera.previousZoom, 1);
    camera.zoom = 3;
    assert.deepEqual(
        [0, 0.25, 0.5, 1].map((alpha) => camera.view(alpha).zoom),
        [1, 1.5, 2, 3],
    );
    camera.beginTick();
    assert.equal(camera.previousZoom, 3);
    camera.zoom = 2;
    camera.cut();
    assert.deepEqual([camera.previousZoom, camera.zoom, camera.x, camera.previousX], [2, 2, 0, 0]);
    camera.zoom = 4;
    camera.cut(10, 20);
    assert.deepEqual([camera.previousZoom, camera.zoom], [4, 4], "cut(x, y) keeps the zoom");
    camera.cut(5, 6, 0.5);
    assert.deepEqual(
        [camera.x, camera.previousX, camera.y, camera.previousY, camera.zoom, camera.previousZoom],
        [5, 5, 6, 6, 0.5, 0.5],
    );
    // Shake offsets the camera in world units, so zoom scales it like the base position.
    camera.cut(0, 0, 2);
    camera.shakeX = 1;
    camera.shakeY = -0.5;
    pack(camera, 1, { x: 10, y: 10, width: 2, height: 2 });
    assert.equal(centerX(frame), 18);
    assert.equal(centerY(frame), 21);
});

test("snapped integer camera zoom maps every texel to whole pixels", () => {
    for (const zoom of [2, 3, 4])
        for (const alpha of [0, 0.25, 0.7, 1]) {
            const camera = movingCamera(zoom);
            const view = camera.view(alpha);
            for (const x of positions())
                for (const width of [1, 3, 5, -3, 2, 16])
                    for (const height of [3, -5, 4])
                        for (const rotation of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
                            const sprite = { x, y: -x / 2 - 0.375, width, height, rotation };
                            const [tx, ty, ix, iy, jx, jy] = pack(camera, alpha, sprite);
                            assert.ok(Number.isInteger(tx) && Number.isInteger(ty));
                            // Texel edges sit at tx + k * zoom on both axes.
                            for (const value of [ix, iy, jx, jy]) {
                                assert.ok(Math.abs(value - Math.round(value)) < 1e-6);
                                assert.equal(Math.abs(Math.round(value) % zoom), 0);
                            }
                            const screenX = (x - view.x) * zoom,
                                screenY = (sprite.y - view.y) * zoom;
                            assert.ok(Math.abs(tx + (ix + jx) / 2 - screenX) <= 0.5 + 1e-6);
                            assert.ok(Math.abs(ty + (iy + jy) / 2 - screenY) <= 0.5 + 1e-6);
                        }
        }
});

test("invalid camera zoom throws RangeError at cut and frame preparation without partial writes", () => {
    for (const invalid of [0, -0, -1, Number.NaN, Infinity, -Infinity]) {
        const camera = new Camera();
        camera.cut(3, 4, 2);
        assert.throws(() => camera.cut(9, 9, invalid), RangeError);
        assert.deepEqual(
            [camera.x, camera.y, camera.zoom, camera.previousZoom],
            [3, 4, 2, 2],
            "a rejected cut leaves the camera unchanged",
        );
        for (const field of ["zoom", "previousZoom"] as const) {
            const bad = new Camera();
            bad[field] = invalid;
            bad.pixelSnap = false;
            assert.throws(() => bad.view(0.5), RangeError);
            // The latched camera and snap mode of the previous scene survive a rejected scene.
            const latched = new Camera();
            latched.cut(10.25, 0, 2);
            const prepared = new Frame();
            prepared.scene(latched, 1);
            assert.throws(() => prepared.scene(bad, 1), RangeError);
            prepared.rect(20, 4, 3, 2, 0xffffff);
            assert.deepEqual(Array.from(prepared.data.slice(0, 3)), [
                Math.round((20 - 10.25) * 2 - 3),
                Math.round(4 * 2 - 2),
                6,
            ]);
            // An engine cut of an assigned invalid zoom never throws; preparation does.
            // Cutting copies zoom over previousZoom, so only an invalid zoom still fails.
            bad.cut();
            assert.equal(Object.is(bad.zoom, bad.previousZoom), true);
            if (field === "zoom") assert.throws(() => bad.view(1), RangeError);
            else assert.equal(bad.view(1).zoom, 1);
        }
    }
    for (const valid of [Number.MIN_VALUE, 1e-3, 1e6]) {
        const camera = new Camera();
        camera.cut(0, 0, valid);
        assert.equal(camera.view(0.5).zoom, valid);
    }
});

test("an invalid zoom set before freeze activation commits the tick and fails at frame preparation", async () => {
    const game = new Game({ seed: 9, state: {}, transition: (state) => state });
    let resets = 0;
    const definition: SceneDefinition = {
        id: "zoom-freeze",
        setup(scene) {
            const marker = scene.resource("marker", { value: 0 });
            scene.resetInterpolation(() => resets++);
            scene.system(() => {
                marker.value++;
                scene.camera.zoom = 0;
                scene.freeze(2);
            });
            scene.render((frame) => frame.rect(10, 10, 2, 2, 0xffffff));
        },
    };
    try {
        await game.start(await game.prepare(definition, { key: "room" }));
        const mountResets = resets;
        game.tick();
        assert.equal(game.lifecycle, "Running");
        const scene = game.enumerate().scenes[0];
        assert.deepEqual(scene.resources, { marker: { value: 1 } });
        assert.deepEqual(
            [(scene.camera as Record<string, unknown>).previousZoom, resets - mountResets],
            [0, 1],
            "freeze activation completes its camera cut and reset callbacks",
        );
        assert.throws(() => game.render(new Frame(), 1), RangeError);
    } finally {
        game.dispose();
    }
});

test("mount, freeze activation and suspension apply the camera contract to zoom", async () => {
    const game = new Game({ seed: 9, state: {}, transition: (state) => state });
    const definition: SceneDefinition = {
        id: "zoom",
        setup(scene) {
            scene.camera.pixelSnap = false;
            scene.camera.zoom = 2;
            scene.system(({ input, camera }) => {
                camera.zoom += 1;
                if (pressed(input, "freeze")) scene.freeze(2);
                if (pressed(input, "invalid")) camera.zoom = 0;
            });
            scene.render((frame) => frame.rect(10, 10, 2, 2, 0xffffff));
        },
    };
    const input = (key: string) => ({ ...emptyInput(), pressed: [key] });
    const camera = () => game.enumerate().scenes[0].camera as Record<string, unknown>;
    const rendered = (alpha: number) => {
        const frame = new Frame();
        game.render(frame, alpha);
        return frame.data[2];
    };
    try {
        await game.start(await game.prepare(definition, { key: "room" }));
        assert.equal(camera().zoom, 2);
        assert.equal(camera().previousZoom, 2, "mount cuts zoom with the base camera");
        assert.deepEqual([rendered(0), rendered(1)], [4, 4]);
        game.tick();
        assert.deepEqual([camera().previousZoom, camera().zoom], [2, 3]);
        assert.deepEqual([rendered(0), rendered(0.5), rendered(1)], [4, 5, 6]);
        game.tick(input("freeze"));
        assert.deepEqual(
            [camera().previousZoom, camera().zoom],
            [4, 4],
            "freeze activation cuts zoom",
        );
        assert.deepEqual([rendered(0), rendered(1)], [8, 8]);
        game.tick();
        game.tick();
        assert.deepEqual([camera().previousZoom, camera().zoom], [4, 4], "frozen zoom holds");
        game.tick();
        assert.deepEqual(
            [camera().previousZoom, camera().zoom],
            [4, 5],
            "zoom resumes interpolating after freeze",
        );
        assert.deepEqual([rendered(0), rendered(1)], [8, 10]);
        const modal = await game.prepare(
            { id: "modal", blocksUpdateBelow: true, setup() {} },
            { key: "pause" },
        );
        game.push(modal);
        game.tick();
        assert.deepEqual(
            [rendered(0), rendered(1)],
            [12, 12],
            "suspended scenes render the current zoom at alpha 1",
        );
        game.pop();
        game.tick();
        game.tick(input("invalid"));
        assert.equal(camera().zoom, 0);
        assert.throws(() => rendered(1), RangeError);
    } finally {
        game.dispose();
    }
});
