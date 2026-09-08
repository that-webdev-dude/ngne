import assert from "node:assert/strict";
import { test } from "node:test";

import { component, emptyInput, FixedStep, Frame, Game } from "../src/index.js";
import type { Asset, GameInspection, SceneDefinition } from "../src/index.js";

const Value = component("value", () => ({ n: 0 }));

test("all selected schedules precede world, event, freeze, state and FIFO stack commits", async (t) => {
    const trace: string[] = [];
    const game = new Game<string[], string>({
        seed: "commit-order",
        state: [],
        transition: (state, command) => {
            trace.push(`state:${command}`);
            assert.deepEqual(
                game.scenes.map((s) => s.freezeRemaining),
                [2, 2, 2],
            );
            assert.deepEqual(state, ["bottom", "middle", "top"].slice(0, state.length));
            return [...state, command];
        },
    });
    t.after(() => game.dispose());
    const definition = (id: string): SceneDefinition<string[], string> => ({
        id,
        setup(scene) {
            const resource = scene.resource("counter", { n: 0 });
            const old = scene.world.spawn(Value.of());
            const query = scene.world.query(Value);
            const state = scene.state();
            scene.system((ctx) => {
                if (ctx.simulationTick !== 1) return;
                trace.push(`write:${id}`);
                resource.n++;
                query.each((entity, value) => {
                    value.n++;
                    ctx.world.despawn(entity);
                });
                const born = ctx.world.spawn(Value.of({ n: 9 }));
                assert.equal(ctx.world.has(born), false);
                ctx.emit({ type: id });
                scene.freeze(1);
                scene.freeze(2);
                state.dispatch(id);
            });
            scene.system((ctx) => {
                if (ctx.simulationTick !== 1) return;
                trace.push(`read:${id}`);
                assert.equal(resource.n, 1);
                assert.equal(ctx.world.get(old, Value)?.n, 1);
                assert.equal(query.size, 1);
                assert.deepEqual(ctx.events, []);
                assert.deepEqual(state.read(), []);
                assert.deepEqual(
                    game.scenes.map((s) => s.freezeRemaining),
                    [0, 0, 0],
                );
            });
            scene.resetInterpolation(() => {
                if (game.simulationTick !== 1) return;
                trace.push(`freeze:${id}`);
                assert.equal(scene.world.has(old), false);
                const values: number[] = [];
                query.each((_entity, value) => values.push(value.n));
                assert.deepEqual(values, [9]);
                // All worlds and inboxes publish before the first freeze reset.
                for (const snapshot of game.enumerate().scenes) {
                    assert.deepEqual(snapshot.inbox, [{ type: snapshot.definition }]);
                    assert.deepEqual(snapshot.outbox, []);
                    assert.ok(snapshot.world && typeof snapshot.world === "object");
                    assert.deepEqual(snapshot.world.entities, [
                        {
                            index: 1,
                            generation: 0,
                            components: [{ name: "value", value: { n: 9 } }],
                        },
                    ]);
                }
                assert.deepEqual(state.read(), []);
            });
            scene.defer(() => trace.push(`dispose:${id}`));
        },
    });
    await game.start(await game.prepare(definition("bottom"), { key: "bottom" }));
    game.push(await game.prepare(definition("middle"), { key: "middle" }));
    game.push(await game.prepare(definition("top"), { key: "top" }));
    game.tick();
    const mounted = (id: string): SceneDefinition<string[], string> => ({
        id,
        setup(scene) {
            trace.push(`mount:${id}`);
            assert.deepEqual(scene.state().read(), ["bottom", "middle", "top"]);
            scene.system(() => trace.push(`unexpected-update:${id}`));
            scene.defer(() => trace.push(`dispose:${id}`));
        },
    });
    game.push(await game.prepare(mounted("temporary"), { key: "temporary" }));
    game.pop();
    game.set(await game.prepare(mounted("replacement"), { key: "replacement" }));
    game.push(await game.prepare(mounted("overlay"), { key: "overlay" }));
    game.tick();
    assert.deepEqual(trace, [
        "write:bottom",
        "read:bottom",
        "write:middle",
        "read:middle",
        "write:top",
        "read:top",
        "freeze:bottom",
        "freeze:middle",
        "freeze:top",
        "state:bottom",
        "state:middle",
        "state:top",
        "mount:temporary",
        "dispose:temporary",
        "mount:replacement",
        "dispose:top",
        "dispose:middle",
        "dispose:bottom",
        "mount:overlay",
    ]);
    assert.deepEqual(
        game.scenes.map((s) => s.definition),
        ["replacement", "overlay"],
    );
});

test("suspension pauses freeze and retains broadcast inboxes for exactly one ordinary update", async (t) => {
    const game = new Game({ seed: "inboxes", state: {}, transition: (s) => s });
    t.after(() => game.dispose());
    const seen: string[] = [];
    const continuing: number[] = [];
    const bottom: SceneDefinition = {
        id: "bottom",
        setup(scene) {
            for (const observer of ["a", "b"])
                scene.system((ctx) => {
                    for (const event of ctx.events)
                        seen.push(`${observer}:${ctx.simulationTick}:${event.type}`);
                    if (observer === "a" && ctx.simulationTick === 0) {
                        ctx.emit({ type: "hit" });
                        scene.freeze(2);
                    }
                });
            scene.system((ctx) => continuing.push(ctx.simulationTick), { runsDuringFreeze: true });
        },
    };
    await game.start(await game.prepare(bottom, { key: "bottom" }));
    game.push(
        await game.prepare({ id: "modal", blocksUpdateBelow: true, setup() {} }, { key: "modal" }),
    );
    game.tick(); // Publish the inbox and freeze, then suspend the lower scene.
    const held = game.enumerate().scenes[0];
    game.tick();
    game.pop();
    game.tick(); // Selection is fixed before the pop, so the lower scene is still suspended.
    assert.deepEqual(game.enumerate().scenes[0], held);
    assert.deepEqual(continuing, [0]);
    for (const remaining of [1, 0]) {
        game.tick();
        assert.equal(game.scenes[0].freezeRemaining, remaining);
        assert.deepEqual(game.enumerate().scenes[0].inbox, [{ type: "hit" }]);
        assert.deepEqual(seen, []);
    }
    game.tick();
    game.tick();
    assert.deepEqual(seen, ["a:5:hit", "b:5:hit"]);
    assert.deepEqual(continuing, [0, 3, 4, 5, 6]);
    assert.deepEqual(game.enumerate().scenes[0].inbox, []);
});

for (const command of ["push", "set"] as const)
    for (const position of [0, 1, 2]) {
        test(`${command} mount failure at command ${position + 1} preserves preceding commits and discards the suffix`, async (t) => {
            const errors: unknown[] = [];
            const mounts: string[] = [];
            const cleanup: string[] = [];
            const failure = new Error("deliberate private mount failure");
            const game = new Game<number, number>({
                seed: "failure",
                state: 0,
                transition: (s, c) => s + c,
                diagnostic: (error) => errors.push(error),
            });
            t.after(() => game.dispose());
            const initial: SceneDefinition<number, number> = {
                id: "initial",
                setup(scene) {
                    const state = scene.state();
                    scene.system((ctx) => {
                        ctx.world.spawn(Value.of({ n: 7 }));
                        ctx.emit({ type: "committed" });
                        scene.freeze(2);
                        state.dispatch(5);
                    });
                },
            };
            await game.start(await game.prepare(initial, { key: "initial" }));
            let atFailure: GameInspection | undefined;
            for (const index of [0, 1, 2]) {
                const candidate = await game.prepare(
                    {
                        id: `scene-${index}`,
                        setup(scene) {
                            mounts.push(`scene-${index}`);
                            assert.equal(scene.state().read(), 5);
                            if (index === position) {
                                atFailure = game.enumerate();
                                scene.defer(() => cleanup.push("first"));
                                scene.defer(() => cleanup.push("second"));
                                throw failure;
                            }
                        },
                    },
                    { key: `scene-${index}` },
                );
                if (index === position) game[command](candidate);
                else game.push(candidate);
            }
            const later = await game.prepare(
                {
                    id: "later",
                    setup() {
                        mounts.push("later");
                    },
                },
                { key: "later" },
            );
            game.pop();
            game.set(later);
            game.tick();
            assert.equal(game.lifecycle, "Running");
            assert.equal(game.simulationTick, 1);
            assert.equal(game.state, 5);
            assert.deepEqual(errors, [failure]);
            assert.deepEqual(cleanup, ["second", "first"]);
            assert.deepEqual(
                mounts,
                Array.from({ length: position + 1 }, (_, i) => `scene-${i}`),
            );
            assert.deepEqual(
                game.scenes.map((s) => s.definition),
                ["initial", ...Array.from({ length: position }, (_, i) => `scene-${i}`)],
            );
            assert.ok(atFailure);
            assert.deepEqual(game.enumerate().scenes, atFailure.scenes);
            assert.equal(atFailure.scenes[0].entityCount, 1);
            assert.equal(atFailure.scenes[0].freezeRemaining, 2);
            assert.deepEqual(atFailure.scenes[0].inbox, [{ type: "committed" }]);
            assert.deepEqual(atFailure.scenes[0].outbox, []);
            game.tick(); // No discarded command can reappear on the next boundary.
            assert.deepEqual(
                game.scenes.map((s) => s.definition),
                atFailure.scenes.map((s) => s.definition),
            );
            game.set(later); // Discarded candidates were released, not merely dequeued.
            game.tick();
            assert.equal(errors.length, 2);
            assert.ok(errors[1] instanceof Error);
            assert.match(errors[1].message, /stale, consumed, or foreign/);
            assert.equal(mounts.includes("later"), false);
        });
    }

test("owned state agrees at every tick across presentation cadence and preparation completion order", async () => {
    const regular = await runTimingScenario([1], false);
    const mixed = await runTimingScenario([0, 0.25, 0.75, 0, 3, 2], true);
    const batched = await runTimingScenario([4, 0, 2], false);
    assert.deepEqual(mixed.snapshots, regular.snapshots);
    assert.deepEqual(batched.snapshots, regular.snapshots);
    assert.notEqual(mixed.renders, regular.renders);
    assert.notEqual(batched.renders, regular.renders);
    assert.ok(mixed.tickCounts.includes(0));
    assert.ok(mixed.tickCounts.includes(3));
    assert.ok(batched.tickCounts.includes(4));
    assert.deepEqual(regular.completed, ["room", "modal"]);
    assert.deepEqual(mixed.completed, ["modal", "room"]);
    assert.equal(regular.snapshots.length, 24);
    assert.deepEqual(
        regular.snapshots[3].scenes.map((s) => s.definition),
        ["base", "room"],
    );
    assert.deepEqual(
        regular.snapshots[4].scenes.map((s) => s.definition),
        ["base", "room", "modal"],
    );
    assert.deepEqual(
        regular.snapshots[9].scenes.map((s) => s.definition),
        ["base", "room"],
    );
});

async function runTimingScenario(cadence: readonly number[], reverse: boolean) {
    const game = new Game<number, number>({
        seed: "timing",
        state: 0,
        dt: 0.125,
        transition: (s, c) => s + c,
    });
    const snapshots: GameInspection[] = [];
    const completed: string[] = [];
    const tickCounts: number[] = [];
    let renders = 0;
    const definition = (id: string, asset?: Asset<number>): SceneDefinition<number, number> => ({
        id,
        blocksUpdateBelow: id === "modal",
        assets: asset ? [asset] : [],
        setup(scene) {
            const state = scene.state();
            const resource = scene.resource("simulation", { updates: 0, events: 0, input: 0 });
            const motion = scene.random("motion");
            const effects = scene.random("effects");
            const query = scene.world.query(Value);
            scene.world.spawn(Value.of({ n: asset ? Number(scene.assets.get(asset.id)) : 0 }));
            scene.system((ctx) => {
                resource.updates++;
                resource.events += ctx.events.length;
                resource.input += ctx.input.axes[0] ?? 0;
                query.each((entity, value) => {
                    value.n += motion.next() + resource.input;
                    if (resource.updates % 3 === 0) ctx.world.despawn(entity);
                });
                if (resource.updates % 3 === 0) ctx.world.spawn(Value.of({ n: effects.next() }));
                scene.camera.x += resource.input;
                ctx.emit({ type: "step", update: resource.updates });
                if (resource.updates % 4 === 0) scene.freeze(2);
                state.dispatch(resource.updates);
            });
            scene.render((frame, alpha) => {
                renders++;
                query.each((_entity, value) => frame.rect(value.n + alpha, 0, 2, 2, 0xffffff));
            });
        },
    });
    try {
        await game.start(await game.prepare(definition("base"), { key: "base-key" }));
        const roomLoad = Promise.withResolvers<number>();
        const modalLoad = Promise.withResolvers<number>();
        const roomPromise = game.prepare(
            definition("room", { id: "room-data", load: () => roomLoad.promise }),
            { key: "room-key" },
        );
        const modalPromise = game.prepare(
            definition("modal", { id: "modal-data", load: () => modalLoad.promise }),
            { key: "modal-key" },
        );
        const step = new FixedStep(game.dt);
        const frame = new Frame();
        const render = (alpha: number) => {
            const before = game.enumerate();
            frame.reset();
            game.render(frame, alpha);
            assert.ok(frame.count > 0);
            assert.deepEqual(
                game.enumerate(),
                before,
                "frame preparation cannot mutate owned simulation state",
            );
        };
        const tick = () => {
            const input = Object.freeze({
                ...emptyInput(),
                axes: Object.freeze([(game.simulationTick % 3) - 1]),
            });
            game.tick(input);
            // Public inspection already omits world-owner symbols from ECS handles.
            // Compare everything it exposes, including allocator, camera, events and RNG.
            snapshots.push(game.enumerate());
        };
        tick(); // Active simulation proceeds while both loads are pending.
        if (reverse) {
            modalLoad.resolve(20);
            await modalPromise;
            completed.push("modal");
        } else {
            roomLoad.resolve(10);
            await roomPromise;
            completed.push("room");
        }
        render(0.25);
        tick();
        if (reverse) {
            roomLoad.resolve(10);
            await roomPromise;
            completed.push("room");
        } else {
            modalLoad.resolve(20);
            await modalPromise;
            completed.push("modal");
        }
        if (reverse) render(0.75);
        tick();
        const room = await roomPromise;
        const modal = await modalPromise;
        assert.deepEqual(
            game.scenes.map((s) => s.definition),
            ["base"],
        );
        let frameIndex = 0;
        while (game.simulationTick < 24) {
            const ticksLeft = 24 - game.simulationTick;
            const seconds = Math.min(cadence[frameIndex++ % cadence.length], ticksLeft) * game.dt;
            const result = step.advance(seconds, () => {
                if (game.simulationTick === 3) game.push(room);
                if (game.simulationTick === 4) game.push(modal);
                if (game.simulationTick === 9) game.pop();
                tick();
            });
            assert.equal(result.dropped, 0);
            tickCounts.push(result.ticks);
            render(result.alpha);
        }
        return { snapshots, renders, tickCounts, completed };
    } finally {
        game.dispose();
    }
}
