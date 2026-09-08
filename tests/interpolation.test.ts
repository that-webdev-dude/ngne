import assert from "node:assert/strict";
import { test } from "node:test";

import { Camera, Frame, lerp } from "../src/index.js";
import { checkInterpolation } from "./interpolation-scenario.js";

test("interpolation remains coherent through mount, cuts, freeze and suspension", async () => {
    await checkInterpolation((condition, message) => assert.ok(condition, message));
});

test("snapping follows camera and shake composition and preserves authored inputs", () => {
    const camera = new Camera();
    camera.cut(0.25, -0.25);
    camera.beginTick();
    camera.x = 0.75;
    camera.y = -0.75;
    camera.shakeX = 0.25;
    camera.shakeY = -0.25;
    const before = { ...camera };
    for (const snap of [false, true]) {
        camera.pixelSnap = snap;
        for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
            for (const x of [-2.5, -0.5, 0, 0.5, 2.5]) {
                for (const screen of [false, true]) {
                    const sprite = Object.freeze({ x, y: -x, width: 2, height: 2, screen });
                    const frame = new Frame();
                    frame.scene(camera, alpha);
                    frame.sprite(sprite);
                    const composed = x - (screen ? 0 : 0.5 + 0.5 * alpha);
                    assert.ok(frame.data[0] === (snap ? Math.round(composed) : composed));
                    assert.ok(frame.data[1] === (snap ? Math.round(-composed) : -composed));
                }
            }
        }
        assert.deepEqual({ ...camera }, { ...before, pixelSnap: snap });
    }
});

test("actor teleport and camera cut reset independently at both interpolation endpoints", () => {
    const camera = new Camera();
    camera.pixelSnap = false;
    camera.cut(10, 20);
    camera.beginTick();
    camera.x = 18;
    const actor = { previousX: 100, x: 100 };
    for (const alpha of [0, 0.5, 1]) {
        const frame = new Frame();
        frame.scene(camera, alpha);
        frame.rect(lerp(actor.previousX, actor.x, alpha), 40, 2, 2, 0xffffff);
        assert.equal(frame.data[0], 90 - 8 * alpha);
    }
    camera.cut(50, -20);
    actor.previousX = 100;
    actor.x = 108;
    for (const alpha of [0, 0.5, 1]) {
        const frame = new Frame();
        frame.scene(camera, alpha);
        frame.rect(lerp(actor.previousX, actor.x, alpha), 40, 2, 2, 0xffffff);
        assert.equal(frame.data[0], 50 + 8 * alpha);
        assert.equal(frame.data[1], 60);
    }
});
