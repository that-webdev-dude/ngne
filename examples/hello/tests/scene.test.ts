import assert from "node:assert/strict";
import { test } from "node:test";
import { Frame, Game } from "../../../src/index.js";
import { helloScene } from "../scene.js";
import { centerX } from "./frame-values.js";

test("the migrated hello scene interpolates and resets both poses when wrapping", async (t) => {
    const game = new Game({ seed: "hello-test", dt: 1, state: {}, transition: (state) => state });
    t.after(() => game.dispose());
    await game.start(await game.prepare(helloScene, { key: "hello-test" }));
    const frame = new Frame();
    game.render(frame, 0.5);
    assert.equal(centerX(frame), 40);
    game.tick();
    frame.reset();
    game.render(frame, 0.5);
    assert.equal(centerX(frame), 60);
    for (let tick = 1; tick < 16; tick++) game.tick();
    frame.reset();
    game.render(frame, 0.5);
    assert.equal(centerX(frame), 0);
});
