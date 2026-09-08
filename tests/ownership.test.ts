import assert from "node:assert/strict";
import { test } from "node:test";

import { component, Frame, Game } from "../src/index.js";
import type { SceneDefinition } from "../src/index.js";
import { arena, type Progress, type ProgressCommand } from "../demo/game.js";

test("completed inspection retains empty archetype order and allocator reuse", async (t) => {
    const A = component("a", () => ({ n: 0 }));
    const B = component("b", () => ({ n: 0 }));
    const game = new Game({ seed: "ownership", dt: 0.02, state: {}, transition: (s) => s });
    t.after(() => game.dispose());
    const scene: SceneDefinition = {
        id: "allocator",
        setup(s) {
            const handles = s.resource("handles", {
                first: s.world.spawn(A.of()),
                second: s.world.spawn(B.of()),
            });
            const order = s.resource("order", [] as number[]);
            const all = s.world.query();
            s.system(({ simulationTick }) => {
                if (simulationTick === 0) {
                    s.world.despawn(handles.first);
                    s.world.despawn(handles.second);
                } else if (simulationTick === 1) {
                    handles.second = s.world.spawn(B.of());
                    handles.first = s.world.spawn(A.of());
                } else all.each((entity) => order.push(entity.index));
            });
        },
    };
    await game.start(await game.prepare(scene, { key: "room" }));
    game.tick();
    const empty = game.enumerate();
    assert.equal(empty.dt, 0.02);
    assert.equal(empty.simulationTick, 1);
    assert.deepEqual(empty.scenes[0].world, {
        archetypes: [
            { components: ["a"], entities: [] },
            { components: ["b"], entities: [] },
        ],
        slots: [
            { generation: 1, row: -1, pending: false },
            { generation: 1, row: -1, pending: false },
        ],
        free: [0, 1],
        entities: [],
    });
    game.stop();
    assert.deepEqual(game.enumerate(), empty);
    await game.start();
    game.tick();
    const populated = game.enumerate().scenes[0].world;
    assert.ok(populated && typeof populated === "object" && !Array.isArray(populated));
    assert.deepEqual(populated.archetypes, [
        { components: ["a"], entities: [0] },
        { components: ["b"], entities: [1] },
    ]);
    assert.deepEqual(populated.free, []);
    assert.equal(Reflect.set(populated.archetypes[0].entities, "0", 999), false);
    game.tick();
    assert.deepEqual(game.enumerate().scenes[0].resources.order, [0, 1]);
    assert.deepEqual(empty.scenes[0].world.entities, []);
});

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
