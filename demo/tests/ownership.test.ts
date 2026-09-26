import assert from "node:assert/strict";
import { test } from "node:test";

import { Frame, Game } from "../../src/index.js";
import { arena, type Progress, type ProgressCommand } from "../game.js";

test("showcase inspection accounts for owners without render or stop/resume mutation", async (t) => {
    const create = () =>
        new Game<Progress, ProgressCommand>({
            seed: "ownership-showcase",
            state: { best: 0, lastScore: 0, runs: 0, victories: 0 },
            transition: (state, command) => ({ ...state, lastScore: command.score }),
        });
    const a = create(),
        b = create();
    t.after(() => {
        a.dispose();
        b.dispose();
    });
    for (const game of [a, b])
        await game.start(await game.prepare(arena({ attract: true }), { key: "arena" }));
    const frame = new Frame();
    for (let tick = 0; tick < 90; tick++) {
        a.tick();
        b.tick();
        const before = a.enumerate();
        frame.reset();
        a.render(frame, (tick % 10) / 10);
        if (tick === 30) {
            a.stop();
            assert.deepEqual(a.enumerate(), before);
            await a.start();
        }
        assert.deepEqual(a.enumerate(), before);
        assert.deepEqual(a.enumerate(), b.enumerate());
    }
    const scene = a.enumerate().scenes[0];
    assert.deepEqual(Object.keys(scene.resources), ["run", "stars", "collision-grid", "player"]);
    assert.deepEqual(Object.keys(scene.random), ["waves", "effects"]);
    const player = scene.resources.player;
    assert.equal(player.owner, "world"); // Diagnostic description, not a usable owner token.
    assert.ok(
        scene.world.entities.some(
            (entity) => entity.index === player.index && entity.generation === player.generation,
        ),
    );
    assert.equal(scene.freezePending, 0);
    assert.deepEqual(scene.outbox, []);
});
