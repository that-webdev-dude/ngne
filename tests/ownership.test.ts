import assert from "node:assert/strict";
import { test } from "node:test";

import { component, f64, Frame, Game } from "../src/index.js";
import type { SceneDefinition } from "../src/index.js";

test("completed inspection retains empty archetype order and allocator reuse", async (t) => {
    const A = component("a", { n: f64() });
    const B = component("b", { n: f64() });
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
        archetypes: ["a", "b"].map((name) => ({
            components: [name],
            entities: [],
            fields: [{ component: name, fields: [{ name: "n", kind: "f64", default: 0 }] }],
            chunks: [{ capacity: 512, count: 0, entities: [] }],
        })),
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
    assert.deepEqual(
        populated.archetypes.map(({ components, entities, chunks }) => ({
            components,
            entities,
            chunks,
        })),
        [
            {
                components: ["a"],
                entities: [0],
                chunks: [{ capacity: 512, count: 1, entities: [0] }],
            },
            {
                components: ["b"],
                entities: [1],
                chunks: [{ capacity: 512, count: 1, entities: [1] }],
            },
        ],
    );
    assert.deepEqual(populated.free, []);
    assert.equal(Reflect.set(populated.archetypes[0].entities, "0", 999), false);
    game.tick();
    assert.deepEqual(game.enumerate().scenes[0].resources.order, [0, 1]);
    assert.deepEqual(empty.scenes[0].world.entities, []);
});
