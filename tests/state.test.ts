import assert from "node:assert/strict";
import { test } from "node:test";

import { Game, type DeepReadonly, type SceneDefinition, type StateAccess } from "../src/index.js";

interface Progress {
    scores: number[];
    nested: { best: number };
}
interface Command {
    values: number[];
}

test("initial and transition snapshots copy and deeply freeze shallow-frozen containers", async () => {
    const initial = Object.freeze({ scores: [1], nested: Object.freeze({ best: 1 }) });
    const next = Object.freeze({ scores: [2], nested: { best: 2 } });
    const game = new Game<Progress, undefined>({ seed: 1, state: initial, transition: () => next });
    const old = game.state;
    initial.scores.push(10);
    assert.deepEqual(old.scores, [1]);
    assert.ok(Object.isFrozen(old.scores));
    assert.equal(Reflect.set(old.nested, "best", 99), false);
    await game.start(
        await game.prepare(
            {
                id: "writer",
                setup(s) {
                    const state = s.state();
                    s.system(() => state.dispatch(undefined));
                },
            },
            { key: "writer" },
        ),
    );
    game.tick();
    assert.notEqual(game.state, next);
    assert.ok(Object.isFrozen(game.state.scores));
    assert.ok(Object.isFrozen(game.state.nested));
    assert.equal(Reflect.set(game.state.scores, "0", 99), false);
    next.scores.push(20);
    next.nested.best = 20;
    assert.deepEqual(game.state, { scores: [2], nested: { best: 2 } });
    assert.deepEqual(old, { scores: [1], nested: { best: 1 } });
    game.dispose();
});

test("plain data preserves cycles, aliases, sparse arrays and primitive values", () => {
    interface Node {
        children: Node[];
        value: unknown;
        self?: Node;
    }
    const root: Node = {
        children: [],
        value: { absent: undefined, nil: null, big: 2n, nan: NaN, infinity: Infinity },
    };
    root.self = root;
    root.children = [root, root];
    root.children.length = 4;
    Object.freeze(root);
    const game = new Game({ seed: 1, state: root, transition: (s) => s });
    assert.notEqual(game.state, root);
    assert.equal(game.state.self, game.state);
    assert.equal(game.state.children[0], game.state);
    assert.equal(game.state.children[1], game.state);
    assert.equal(game.state.children.length, 4);
    assert.equal(2 in game.state.children, false);
    assert.deepEqual(game.state.value, root.value);
    assert.ok(Object.isFrozen(game.state.children));
    const nullRecord: Record<string, unknown> = Object.create(null);
    Object.defineProperty(nullRecord, "__proto__", { value: { safe: true }, enumerable: true });
    const other = new Game({ seed: 1, state: nullRecord, transition: (s) => s });
    assert.equal(Object.getPrototypeOf(other.state), null);
    assert.ok(Object.isFrozen(other.state.__proto__));
    game.dispose();
    other.dispose();
});

test("all durable boundaries reject unsupported values even inside frozen objects and arrays", async () => {
    class Custom {
        value = 1;
    }
    const unsupported: unknown[] = [
        new Map(),
        new Set(),
        new Date(),
        /x/,
        new Uint8Array(),
        new ArrayBuffer(0),
        new Custom(),
        () => 1,
        Symbol("value"),
        Object.defineProperty({}, "hidden", { value: 1 }),
        { [Symbol("key")]: 1 },
        {
            get value() {
                throw new Error("Getter must never run");
            },
        },
        {
            get then() {
                throw new Error("Getter must never run");
            },
        },
    ];
    for (const value of unsupported) {
        const payload = Object.freeze({ nested: Object.freeze([value]) });
        assert.throws(
            () => new Game({ seed: 1, state: payload, transition: (s) => s }),
            /plain data|plain objects|data properties/,
        );
        const game = new Game<unknown, unknown>({ seed: 1, state: {}, transition: () => payload });
        await game.start(
            await game.prepare(
                {
                    id: "writer",
                    setup(s) {
                        const state = s.state();
                        s.system(() => {
                            assert.throws(
                                () => state.dispatch(payload),
                                /plain data|plain objects|data properties/,
                            );
                            state.dispatch(undefined);
                        });
                    },
                },
                { key: "writer" },
            ),
        );
        assert.throws(() => game.tick(), /plain data|plain objects|data properties/);
        assert.deepEqual(game.state, {});
        assert.equal(game.lifecycle, "Failed");
        game.dispose();
    }
});

test("commands are copied on dispatch, frozen for transitions and applied in order", async () => {
    const payload: Command = { values: [1] };
    const commands: DeepReadonly<Command>[] = [];
    const snapshots: DeepReadonly<Progress>[] = [];
    const game = new Game<Progress, Command>({
        seed: 1,
        state: { scores: [], nested: { best: 0 } },
        transition(state, command) {
            commands.push(command);
            assert.ok(Object.isFrozen(command));
            assert.ok(Object.isFrozen(command.values));
            assert.equal(Reflect.set(command.values, "0", 99), false);
            return { scores: [...state.scores, ...command.values], nested: state.nested };
        },
    });
    const scene: SceneDefinition<Progress, Command> = {
        id: "writer",
        setup(s) {
            const state = s.state();
            s.system(() => {
                snapshots.push(state.read());
                state.dispatch(payload);
                payload.values[0] = 2;
                state.dispatch(payload);
                payload.values.push(3);
            });
            s.system(() => snapshots.push(state.read()));
        },
    };
    await game.start(await game.prepare(scene, { key: "one" }));
    const before = game.state;
    game.tick();
    assert.deepEqual(game.state.scores, [1, 2]);
    assert.deepEqual(commands, [{ values: [1] }, { values: [2] }]);
    assert.notEqual(commands[0], payload);
    assert.deepEqual(payload.values, [2, 3]);
    assert.equal(snapshots[0], before);
    assert.equal(snapshots[1], before);
    game.dispose();
});

test("selected scenes share the tick snapshot and replacement setup reads committed results", async () => {
    const reads: DeepReadonly<{ value: number }>[] = [];
    const game = new Game({
        seed: 1,
        state: { value: 0 },
        transition: (s, c: number) => ({ value: s.value * 10 + c }),
    });
    const writer = (id: string, value: number): SceneDefinition<{ value: number }, number> => ({
        id,
        setup(s) {
            const state = s.state();
            assert.throws(() => state.dispatch(9), /active system update/);
            s.system(() => {
                reads.push(state.read());
                state.dispatch(value);
            });
        },
    });
    await game.start(await game.prepare(writer("one", 1), { key: "one" }));
    game.push(await game.prepare(writer("two", 2), { key: "two" }));
    game.tick();
    reads.length = 0;
    const before = game.state;
    const replacement = await game.prepare(
        {
            id: "replacement",
            setup(s) {
                assert.equal(s.state().read().value, 112);
                assert.throws(() => s.state().dispatch(9), /active system update/);
            },
        },
        { key: "replacement" },
    );
    game.set(replacement);
    game.tick();
    assert.equal(reads.length, 2);
    assert.equal(reads[0], before);
    assert.equal(reads[1], before);
    assert.equal(game.state.value, 112);
    assert.equal(game.scenes[0].definition, "replacement");
    game.dispose();
});

test("retained state access cannot dispatch outside its owning system update", async () => {
    let access: StateAccess<{ value: number }, number> | undefined;
    const rejectDispatch = () => {
        const state = access;
        if (!state) throw new Error("Missing state capability");
        assert.throws(() => state.dispatch(9), /active system update/);
    };
    const game = new Game({
        seed: 1,
        state: { value: 0 },
        transition: (s, c: number) => {
            rejectDispatch();
            return { value: s.value + c };
        },
    });
    await game.start(
        await game.prepare(
            {
                id: "writer",
                setup(s) {
                    const state = s.state();
                    access = state;
                    s.system(() => state.dispatch(1));
                    s.defer(rejectDispatch);
                },
            },
            { key: "writer" },
        ),
    );
    rejectDispatch();
    game.tick();
    game.stop();
    rejectDispatch();
    await game.start();
    game.pop();
    game.tick();
    rejectDispatch();
    game.dispose();
    rejectDispatch();
});

test("asynchronous transition results fail without publishing or leaving an unhandled rejection", async () => {
    const errors: unknown[] = [];
    const failure = new Error("late transition failure");
    const game = new Game<unknown, undefined>({
        seed: 1,
        state: {},
        transition: () => Promise.reject(failure),
        diagnostic: (error) => errors.push(error),
    });
    await game.start(
        await game.prepare(
            {
                id: "writer",
                setup(s) {
                    const state = s.state();
                    s.system(() => state.dispatch(undefined));
                },
            },
            { key: "writer" },
        ),
    );
    assert.throws(() => game.tick(), /transitions must be synchronous/);
    await Promise.resolve();
    assert.ok(errors.includes(failure));
    assert.deepEqual(game.state, {});
    assert.equal(game.lifecycle, "Failed");
    game.dispose();
});

test("events use the same plain-data validation and retain an owned frozen payload", async () => {
    const payload = { scores: [1] };
    const game = new Game({ seed: 1, state: {}, transition: (s) => s });
    await game.start(
        await game.prepare(
            {
                id: "events",
                setup(s) {
                    s.system((ctx) => {
                        if (ctx.simulationTick === 0) {
                            assert.throws(
                                () =>
                                    ctx.emit({
                                        type: "bad",
                                        nested: Object.freeze({ map: new Map() }),
                                    }),
                                /plain objects/,
                            );
                            ctx.emit({ type: "ok", payload });
                            payload.scores.push(2);
                        } else {
                            assert.deepEqual(ctx.events, [
                                { type: "ok", payload: { scores: [1] } },
                            ]);
                            assert.ok(Object.isFrozen(ctx.events[0].payload));
                        }
                    });
                },
            },
            { key: "events" },
        ),
    );
    game.tick();
    game.tick();
    game.dispose();
});

test("a later invalid transition preserves earlier committed commands and fails the Game", async () => {
    const game = new Game<unknown, number>({
        seed: 1,
        state: 0,
        transition: (_, command) => (command === 1 ? 1 : Object.freeze({ nested: new Set() })),
    });
    await game.start(
        await game.prepare(
            {
                id: "writer",
                setup(s) {
                    const state = s.state();
                    s.system(() => {
                        state.dispatch(1);
                        state.dispatch(2);
                        state.dispatch(3);
                    });
                },
            },
            { key: "writer" },
        ),
    );
    assert.throws(() => game.tick(), /plain objects/);
    assert.equal(game.state, 1);
    assert.equal(game.lifecycle, "Failed");
    assert.equal(game.simulationTick, 0);
    game.dispose();
});
