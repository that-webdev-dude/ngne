import { centerX, centerY } from "./frame-values.js";
import { QUAD_STRIDE } from "../src/quad-layout.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
    bool,
    component,
    entityRef,
    f32,
    f64,
    i32,
    u32,
    u8,
    World,
    type Entity,
    type SchemaComponentView,
} from "../src/ecs.js";
import { helloScene } from "../examples/hello/scene.js";
import { Frame, Game, type SceneDefinition } from "../src/index.js";

test("schema fields use declared columns, defaults, validation, and sparse access", () => {
    const declaredFloat32 = f32(1 / 3);
    const Values = component("values", {
        float32: declaredFloat32,
        float64: f64(1 / 3),
        signed: i32(-4),
        unsigned: u32(4),
        byte: u8(5),
        enabled: bool(true),
        target: entityRef(),
    });
    const world = new World();
    const target = world.spawn();
    const entity = world.spawn(Values.of({ target }));
    world.commit();

    assert.equal(world.read(entity, Values, "float32"), Math.fround(1 / 3));
    assert.equal(world.read(entity, Values, "float64"), 1 / 3);
    assert.equal(world.read(entity, Values, "signed"), -4);
    assert.equal(world.read(entity, Values, "unsigned"), 4);
    assert.equal(world.read(entity, Values, "byte"), 5);
    assert.equal(world.read(entity, Values, "enabled"), true);
    assert.equal(world.read(entity, Values, "target"), target);

    world.write(entity, Values, "float32", 0.1);
    world.write(entity, Values, "enabled", false);
    assert.equal(world.read(entity, Values, "float32"), Math.fround(0.1));
    assert.equal(world.read(entity, Values, "enabled"), false);

    const query = world.query(Values);
    query.eachChunk((chunk) => {
        const view = chunk.views.values;
        assert.ok(view.float32 instanceof Float32Array);
        assert.ok(view.float64 instanceof Float64Array);
        assert.ok(view.signed instanceof Int32Array);
        assert.ok(view.unsigned instanceof Uint32Array);
        assert.ok(view.byte instanceof Uint8Array);
        assert.ok(view.enabled instanceof Uint8Array);
        assert.ok(view.target.index instanceof Uint32Array);
        assert.ok(view.target.generation instanceof Uint32Array);
    });

    assert.ok(Object.isFrozen(Values));
    assert.ok(Object.isFrozen(Values.fields));
    assert.notEqual(Values.fields.float32, declaredFloat32);
    assert.ok(Object.isFrozen(Values.fields.float32));
    assert.equal(Reflect.set(Values.fields.float32, "default", 0), false);
    const ForgedFloat = component("forged-float", {
        value: { kind: "f32", default: 0.1 } as unknown as ReturnType<typeof f32>,
    });
    assert.equal(ForgedFloat.fields.value.default, Math.fround(0.1));
    assert.throws(
        () =>
            component("forged-reference", {
                target: {
                    kind: "entity",
                    default: target,
                } as unknown as ReturnType<typeof entityRef>,
            }),
        /Entity reference defaults are always null/,
    );
    assert.throws(
        () => Reflect.apply(entityRef, undefined, [null]),
        /Entity reference defaults are always null/,
    );
    const withUndefined = world.spawn(Values.of({ float64: undefined }));
    world.commit();
    assert.equal(world.read(withUndefined, Values, "float64"), 1 / 3);
    const capacityBeforeRejectedSpawns = world.capacity;
    assert.throws(() => f32(1e39));
    assert.throws(() => world.spawn(Values.of({ byte: 256 })));
    assert.throws(() => world.spawn(Values.of({ signed: 1.5 })));
    assert.throws(() => world.spawn(Values.of({ float64: Infinity })));
    assert.throws(() => world.spawn(Values.of({ float32: 1e39 })));
    assert.equal(world.capacity, capacityBeforeRejectedSpawns);
    assert.equal(world.spawn(Values.of()).index, capacityBeforeRejectedSpawns);
    assert.throws(() => world.write(entity, Values, "byte", -1));
    assert.throws(() => world.write(entity, Values, "float32", 1e39));
    assert.throws(() => world.read(entity, Values, "missing" as never));
});

test("schema lowering preserves authored snapshots, field order, and definition identity", () => {
    const Values = component("snapshot-values", { "2": f64(2), "1": f64(1), x: f64(7) });
    const world = new World();
    const authored = { x: 3 };
    const value = Values.of(authored);
    authored.x = 4;
    const first = world.spawn(value);
    authored.x = 9;
    const reads: string[] = [];
    const second = world.spawn(
        Values.of({
            get x() {
                reads.push("x");
                return undefined;
            },
            get 2() {
                reads.push("2");
                return 20;
            },
            get 1() {
                reads.push("1");
                return 10;
            },
        }),
    );
    assert.deepEqual(reads, ["1", "2", "x"]);
    world.commit();
    assert.deepEqual(reads, ["1", "2", "x"]);
    assert.equal(world.read(first, Values, "x"), 4);
    assert.equal(world.read(second, Values, "x"), 7);
    assert.equal(world.read(second, Values, "1"), 10);
    assert.equal(world.read(second, Values, "2"), 20);
    assert.throws(() => world.spawn(Values.of(), Values.of()), /Duplicate component/);
    const Other = component("snapshot-values", { x: f64(99) });
    assert.throws(() => world.spawn(Other.of()), /Conflicting component identity/);
    const otherWorld = new World();
    const other = otherWorld.spawn(Other.of());
    otherWorld.commit();
    assert.equal(otherWorld.read(other, Other, "x"), 99);
    const changed = { x: 1, extra: 2 };
    const unchecked = Values.of({ x: 1 });
    Object.assign(unchecked.value, changed);
    assert.throws(() => world.spawn(unchecked), /Unknown component field/);
    world.dispose();
    otherWorld.dispose();
});

test("mixed columns survive reordered births and clear swapped tails across chunks", () => {
    const Values = component("mixed", {
        a: f32(),
        b: f64(),
        c: i32(),
        d: u32(),
        e: u8(),
        flag: bool(),
        target: entityRef(),
    });
    const Tag = component("tag", { value: f64() });
    const world = new World();
    const staleTarget = world.spawn();
    world.commit();
    world.despawn(staleTarget);
    world.commit();
    const target = world.spawn();
    assert.equal(target.generation, 1);
    const handles = Array.from({ length: 513 }, (_, index) => {
        const values = Values.of({ a: 1.25, b: index + 1, c: -7, d: 8, e: 9, flag: true, target });
        const tag = Tag.of({ value: index + 10 });
        return index % 2 ? world.spawn(tag, values) : world.spawn(values, tag);
    });
    world.commit();
    world.despawn(handles[0]);
    world.despawn(handles[512]);
    world.commit();
    const query = world.query(Values, Tag);
    let visits = 0;
    query.eachChunk((chunk) => {
        visits++;
        assert.equal(chunk.count, 511);
        assert.equal(chunk.entityAt(0), handles[511]);
        const v = chunk.views.mixed;
        assert.deepEqual(
            [v.a[0], v.b[0], v.c[0], v.d[0], v.e[0], v.flag[0]],
            [1.25, 512, -7, 8, 9, 1],
        );
        assert.equal(chunk.views.tag.value[0], 521);
        assert.equal(v.target.index[0], target.index + 1);
        assert.equal(v.target.generation[0], target.generation);
        for (const column of [
            v.a,
            v.b,
            v.c,
            v.d,
            v.e,
            v.flag,
            v.target.index,
            v.target.generation,
            chunk.views.tag.value,
        ])
            assert.equal(column[511], 0);
    });
    assert.equal(visits, 1);
    assert.equal(world.read(handles[511], Values, "target"), target);
    const replacement = world.spawn(Tag.of(), Values.of());
    const pendingDeath = world.spawn(Values.of(), Tag.of());
    assert.equal(replacement.index, handles[512].index);
    assert.equal(pendingDeath.index, handles[0].index);
    world.despawn(pendingDeath);
    world.commit();
    assert.equal(world.has(pendingDeath), false);
    assert.equal(world.read(replacement, Values, "target"), null);
    assert.equal(world.read(replacement, Values, "flag"), false);
    query.eachChunk((chunk) => {
        assert.equal(chunk.count, 512);
        assert.equal(chunk.entityAt(511), replacement);
    });
    world.dispose();
});

test("schema chunks retain 512-row capacity, canonical handles, and deterministic order", () => {
    const Position = component("position", { x: f64() });
    const Velocity = component("velocity", { x: f32() });
    const world = new World();
    const handles = Array.from({ length: 513 }, (_, x) => world.spawn(Position.of({ x })));
    world.spawn(Position.of({ x: 900 }), Velocity.of({ x: 1 }));
    world.commit();

    const positions = world.query(Position);
    const chunks: number[] = [];
    const ordered: number[] = [];
    positions.eachChunk((chunk) => {
        chunks.push(chunk.count);
        assert.equal(chunk.capacity, 512);
        assert.deepEqual(Object.keys(chunk), []);
        for (let row = 0; row < chunk.count; row++) ordered.push(chunk.entityAt(row).index);
        assert.throws(() => chunk.entityAt(-1));
        assert.throws(() => chunk.entityAt(chunk.count));
        assert.throws(() => chunk.entityAt(0.5));
    });
    assert.deepEqual(chunks, [512, 1, 1]);
    assert.deepEqual(ordered, [...handles.map((entity) => entity.index), 513]);
    assert.equal(world.size, 514);
    assert.equal(world.capacity, 514);
    assert.equal(positions.size, 514);
    assert.equal(world.query(Velocity).size, 1);
    assert.equal(world.query().size, 514);
});

test("schema churn repairs swapped rows, clears tails, retains empty chunks, and reuses slots", () => {
    const Position = component("position", { x: f64() });
    const world = new World();
    const handles = Array.from({ length: 513 }, (_, x) => world.spawn(Position.of({ x: x + 1 })));
    world.commit();
    world.despawn(handles[0]);
    world.despawn(handles[512]);
    world.commit();

    const query = world.query(Position);
    let calls = 0;
    query.eachChunk((chunk) => {
        calls++;
        assert.equal(chunk.count, 511);
        assert.equal(chunk.views.position.x[511], 0);
        assert.equal(world.read(handles[511], Position, "x"), 512);
    });
    assert.equal(calls, 1);
    assert.equal(query.size, 511);

    const reused = world.spawn(Position.of({ x: 700 }));
    world.commit();
    assert.equal(reused.index, handles[512].index);
    assert.notEqual(reused.generation, handles[512].generation);
    const inspection = world.enumerate() as {
        archetypes: { chunks: { count: number }[] }[];
    };
    assert.deepEqual(
        inspection.archetypes[0].chunks.map((chunk) => chunk.count),
        [512, 0],
    );
});

test("schema lifetime preserves pending, stale, foreign, and entity-reference rules", () => {
    const Link = component("link", { target: entityRef() });
    const world = new World();
    const other = new World();
    const target = world.spawn();
    const holder = world.spawn(Link.of({ target }));
    const foreignSubject = other.spawn();
    assert.equal(world.read(holder, Link, "target"), undefined);
    assert.equal(world.read(foreignSubject, Link, "target"), undefined);
    assert.doesNotThrow(() => world.write(foreignSubject, Link, "target", null));
    world.commit();
    assert.equal(world.read(holder, Link, "target"), target);
    world.despawn(target);
    world.commit();
    const stale = world.read(holder, Link, "target");
    assert.deepEqual(stale, target);
    assert.equal(world.has(stale!), false);
    world.write(holder, Link, "target", stale!);
    const future = Object.freeze({
        index: target.index,
        generation: target.generation + 1,
        owner: target.owner,
    });
    assert.throws(() => world.write(holder, Link, "target", future), /Unknown entity reference/);
    assert.throws(() => world.write(holder, Link, "target", other.spawn()));
    const malformed = Object.freeze({ index: -1, generation: 0, owner: target.owner }) as Entity;
    assert.throws(() => world.write(holder, Link, "target", malformed));
    const unknown = Object.freeze({ index: 999, generation: 0, owner: target.owner }) as Entity;
    assert.throws(() => world.write(holder, Link, "target", unknown));
    world.despawn(holder);
    world.commit();
    assert.equal(world.read(holder, Link, "target"), undefined);
    world.write(holder, Link, "target", null);
});

test("pending schema deaths, all-query order, and many retained queries preserve structure", () => {
    const Tag = component("ordered-tag", { value: f64(1) });
    const Position = component("ordered-position", { x: f64() });
    const Velocity = component("ordered-velocity", { x: f64() });
    const world = new World();
    const all = world.query();
    const empty = world.spawn();
    const tagged = world.spawn(Tag.of());
    const schema = world.spawn(Position.of());
    const pendingDeath = world.spawn(Velocity.of());
    world.despawn(pendingDeath);
    world.commit();
    const order: number[] = [];
    all.each((entity) => order.push(entity.index));
    assert.deepEqual(order, [empty.index, tagged.index, schema.index]);
    assert.equal(world.has(pendingDeath), false);

    const retained = Array.from({ length: 64 }, () => world.query(Position));
    world.spawn(Position.of(), Velocity.of());
    world.commit();
    assert.ok(retained.every((query) => query.size === 2));
    world.despawn(tagged);
    world.commit();
    order.length = 0;
    all.each((entity) => order.push(entity.index));
    assert.deepEqual(order, [empty.index, schema.index, pendingDeath.index]);
});

test("schema entity references reject uint32 overflow without changing allocation", () => {
    const Plain = component("overflow-plain", { value: f64(1) });
    const Link = component("overflow-link", { target: entityRef() });
    const world = new World();
    const target = world.spawn();
    const holder = world.spawn(Link.of());
    const plain = world.spawn(Plain.of());
    world.commit();
    const slots = Reflect.get(world, "slots") as { generation: number }[];
    slots[target.index].generation = 0x1_0000_0000;
    const overflow = Object.freeze({
        index: target.index,
        generation: 0x1_0000_0000,
        owner: target.owner,
    });
    assert.throws(() => world.write(holder, Link, "target", overflow), /uint32/);
    world.despawn(plain);
    world.commit();
    const reused = world.spawn(Plain.of({ value: 2 }));
    world.commit();
    assert.equal(reused.index, plain.index);
    assert.equal(world.read(reused, Plain, "value"), 2);
});

test("typed query borrows are nested, exception-safe, visible, and invalidated by commit", () => {
    const Position = component("position", { x: f64() });
    const Velocity = component("velocity", { x: f64(2) });
    const world = new World();
    const entity = world.spawn(Position.of({ x: 1 }), Velocity.of());
    world.commit();
    const positions = world.query(Position);
    const movers = world.query(Position, Velocity);
    let retainedChunk: Parameters<Parameters<typeof positions.eachChunk>[0]>[0] | undefined;
    let retainedViews:
        Parameters<Parameters<typeof positions.eachChunk>[0]>[0]["views"] | undefined;
    let retainedView: SchemaComponentView<typeof Position.fields> | undefined;

    positions.eachChunk((chunk) => {
        retainedChunk = chunk;
        retainedViews = chunk.views;
        retainedView = chunk.views.position;
        movers.eachChunk((inner) => {
            inner.views.position.x[0] += inner.views.velocity.x[0];
        });
        assert.equal(chunk.views.position.x[0], 3);
        assert.throws(() => world.commit(), /during query iteration/);
    });
    assert.equal(world.read(entity, Position, "x"), 3);
    assert.throws(
        () =>
            positions.eachChunk(() => {
                throw new Error("visitor");
            }),
        /visitor/,
    );
    world.commit();
    assert.throws(() => retainedChunk!.count, /expired/);
    assert.throws(() => retainedChunk!.views, /expired/);
    assert.throws(() => retainedViews!.position, /expired/);
    assert.equal(retainedView!.x[0], 3); // Raw columns cannot be revoked; retaining them is prohibited.
    positions.eachChunk((chunk) => assert.equal(chunk.views.position.x[0], 3));
});

test("same-query nested traversal visits the chunk cross product in creation, chunk and row order", () => {
    const Position = component("nested-position", { x: f64() });
    const world = new World();
    const handles = Array.from({ length: 600 }, (_, x) => world.spawn(Position.of({ x })));
    world.commit();
    const query = world.query(Position);
    const chunkPairs: [number, number][] = [];
    const outer: number[] = [];
    const inner: number[][] = [];
    query.eachChunk((outerChunk) => {
        for (let row = 0; row < outerChunk.count; row++) outer.push(outerChunk.entityAt(row).index);
        const visited: number[] = [];
        query.eachChunk((innerChunk) => {
            chunkPairs.push([outerChunk.count, innerChunk.count]);
            for (let row = 0; row < innerChunk.count; row++)
                visited.push(innerChunk.views["nested-position"].x[row]);
        });
        inner.push(visited);
    });
    const created = handles.map((entity) => entity.index);
    assert.deepEqual(chunkPairs, [
        [512, 512],
        [512, 88],
        [88, 512],
        [88, 88],
    ]);
    assert.deepEqual(outer, created);
    assert.deepEqual(inner, [created, created]);
});

test("commit inside the inner callback of a same-query nested traversal throws until both return", () => {
    const Position = component("nested-commit-position", { x: f64() });
    const world = new World();
    const entity = world.spawn(Position.of({ x: 1 }));
    world.commit();
    const query = world.query(Position);
    let innerCalls = 0;
    query.eachChunk(() => {
        query.eachChunk(() => {
            innerCalls++;
            assert.throws(() => world.commit(), /during query iteration/);
        });
        assert.throws(() => world.commit(), /during query iteration/);
    });
    assert.equal(innerCalls, 1);
    world.despawn(entity);
    assert.doesNotThrow(() => world.commit());
    assert.equal(world.has(entity), false);
    assert.equal(query.size, 0);
});

test("entityAt returns the canonical spawn handle in both chunks and after committed swap removal", () => {
    const Position = component("canonical-position", { x: f64() });
    const world = new World();
    const handles = Array.from({ length: 600 }, (_, x) => world.spawn(Position.of({ x })));
    world.commit();
    const query = world.query(Position);
    const rows = (): Entity[][] => {
        const chunks: Entity[][] = [];
        query.eachChunk((chunk) =>
            chunks.push(Array.from({ length: chunk.count }, (_, row) => chunk.entityAt(row))),
        );
        return chunks;
    };
    const before = rows();
    assert.deepEqual(
        before.map((chunk) => chunk.length),
        [512, 88],
    );
    before.flat().forEach((entity, index) => assert.equal(entity, handles[index]));
    world.despawn(handles[0]);
    world.despawn(handles[512]);
    world.commit();
    const after = rows();
    assert.deepEqual(
        after.map((chunk) => chunk.length),
        [511, 87],
    );
    assert.equal(after[0][0], handles[511]);
    assert.equal(after[1][0], handles[599]);
    assert.equal(world.read(after[0][0], Position, "x"), 511);
    assert.equal(world.read(after[1][0], Position, "x"), 599);
});

test("typed queries lazily discover later archetypes and skip retained empty chunks", () => {
    const Position = component("position", { x: f64() });
    const Velocity = component("velocity", { x: f64() });
    const world = new World();
    const query = world.query(Position);
    const first = world.spawn(Position.of());
    world.commit();
    world.spawn(Position.of(), Velocity.of());
    world.commit();
    assert.equal(query.size, 2);
    world.despawn(first);
    world.commit();
    let calls = 0;
    query.eachChunk(() => calls++);
    assert.equal(calls, 1);
});

test("schema inspection is JSON-safe, deterministic, and distinguishes chunk-relative rows", () => {
    const Link = component("link", { target: entityRef(), precise: f64(), rounded: f32() });
    const run = (): string => {
        const world = new World();
        const targets = Array.from({ length: 513 }, () => world.spawn());
        const links = targets.map((target, index) =>
            world.spawn(
                Link.of({ target: index === 0 ? null : target, precise: 0.1, rounded: 0.1 }),
            ),
        );
        world.commit();
        world.despawn(targets[1]);
        world.commit();
        assert.equal(world.has(world.read(links[1], Link, "target")!), false);
        const inspection = world.enumerate() as {
            slots: { row: number; chunk?: number }[];
            entities: { components: { fields?: { name: string; value: unknown }[] }[] }[];
        };
        assert.equal(inspection.slots[links[0].index].row, 0);
        assert.equal(inspection.slots[links[0].index].chunk, 0);
        assert.equal(inspection.slots[links[512].index].row, 0);
        assert.equal(inspection.slots[links[512].index].chunk, 1);
        const fields = inspection.entities.find((entry) =>
            entry.components.some((component) => component.fields),
        )?.components[0].fields;
        assert.equal(fields?.find((entry) => entry.name === "target")?.value, null);
        assert.equal(fields?.find((entry) => entry.name === "rounded")?.value, Math.fround(0.1));
        return JSON.stringify(inspection);
    };
    assert.equal(run(), run());
});

test("component-view spatial resources stay inspection-bounded while raw columns remain enumerable", async (t) => {
    const Position = component("position", { x: f64() });
    type PositionView = SchemaComponentView<typeof Position.fields>;
    const game = new Game({ seed: "soa-resource", state: {}, transition: (state) => state });
    t.after(() => game.dispose());
    const scene: SceneDefinition = {
        id: "soa-resource",
        setup(setup) {
            setup.world.spawn(Position.of({ x: 4 }));
            const derived = setup.resource("derived", {
                entries: [] as { view: PositionView; row: number }[],
                probes: 0,
            });
            const raw = setup.resource("raw", {
                column: undefined as Float64Array | undefined,
            });
            const positions = setup.world.query(Position);
            const probes = setup.world.query(Position);
            setup.system(() => {
                derived.entries.length = 0;
                positions.eachChunk((chunk) => {
                    const view = chunk.views.position;
                    raw.column = view.x;
                    for (let row = 0; row < chunk.count; row++) derived.entries.push({ view, row });
                });
                probes.eachChunk(() => {
                    for (const entry of derived.entries) derived.probes += entry.view.x[entry.row];
                });
            });
        },
    };
    await game.start(await game.prepare(scene, { key: "soa-resource" }));
    game.tick();
    const resources = game.enumerate().scenes[0].resources;
    assert.deepEqual(resources.derived.entries, [{ view: {}, row: 0 }]);
    assert.equal(resources.derived.probes, 4);
    assert.doesNotMatch(JSON.stringify(resources.derived), /"0":/);
    assert.equal(Object.keys(resources.raw.column).length, 512);
    assert.doesNotThrow(() => JSON.stringify(game.enumerate()));
    game.tick();
    const rebuilt = game.enumerate().scenes[0].resources;
    assert.deepEqual(rebuilt.derived.entries, [{ view: {}, row: 0 }]);
    assert.equal(rebuilt.derived.probes, 8);
});

test("game inspection stringifies null, live, and stale schema references deterministically", async () => {
    const Link = component("inspection-link", { target: entityRef() });
    const run = async (): Promise<string> => {
        const game = new Game({ seed: "reference-inspection", state: {}, transition: (s) => s });
        const scene: SceneDefinition = {
            id: "reference-inspection",
            setup(setup) {
                const live = setup.world.spawn();
                const stale = setup.world.spawn();
                setup.world.spawn(Link.of({ target: null }));
                setup.world.spawn(Link.of({ target: live }));
                setup.world.spawn(Link.of({ target: stale }));
                setup.world.despawn(stale);
            },
        };
        await game.start(await game.prepare(scene, { key: "reference-inspection" }));
        const json = JSON.stringify(game.enumerate());
        game.dispose();
        return json;
    };
    const first = await run();
    assert.match(first, /"target"/);
    assert.equal(first, await run());
});

test("game inspection records exact null, live and stale reference fields and target slots", async (t) => {
    interface FieldRecord {
        name: string;
        kind: string;
        value: unknown;
    }
    interface WorldRecord {
        slots: object[];
        free: number[];
        entities: { index: number; components: { fields?: FieldRecord[] }[] }[];
    }
    const Link = component("reference-record-link", { target: entityRef() });
    const game = new Game({ seed: "reference-records", state: {}, transition: (state) => state });
    t.after(() => game.dispose());
    const handles: { live?: Entity; stale?: Entity; holders: Entity[] } = { holders: [] };
    const scene: SceneDefinition = {
        id: "reference-records",
        setup(setup) {
            const live = setup.world.spawn();
            const stale = setup.world.spawn();
            handles.live = live;
            handles.stale = stale;
            handles.holders.push(
                setup.world.spawn(Link.of({ target: null })),
                setup.world.spawn(Link.of({ target: live })),
                setup.world.spawn(Link.of({ target: stale })),
            );
            let despawned = false;
            setup.system(() => {
                if (despawned) return;
                despawned = true;
                setup.world.despawn(stale);
            });
        },
    };
    await game.start(await game.prepare(scene, { key: "reference-records" }));
    game.tick();
    const { live, stale, holders } = handles;
    assert.ok(live && stale);
    const world = game.enumerate().scenes[0].world as unknown as WorldRecord;
    const field = (holder: Entity): FieldRecord | undefined =>
        world.entities.find((entry) => entry.index === holder.index)?.components[0].fields?.[0];
    assert.deepStrictEqual(field(holders[0]), { name: "target", kind: "entity", value: null });
    assert.deepStrictEqual(field(holders[1]), {
        name: "target",
        kind: "entity",
        value: { index: live.index, generation: live.generation },
    });
    assert.deepStrictEqual(field(holders[2]), {
        name: "target",
        kind: "entity",
        value: { index: stale.index, generation: stale.generation },
    });
    assert.deepStrictEqual(world.slots[live.index], {
        generation: live.generation,
        row: 0,
        pending: false,
        chunk: 0,
    });
    assert.deepStrictEqual(world.slots[stale.index], {
        generation: stale.generation + 1,
        row: -1,
        pending: false,
    });
    assert.deepStrictEqual(world.free, [stale.index]);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(field(holders[2]))), field(holders[2]));
});

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

test("world access and query runtimes stay opaque and reject unchecked callers", () => {
    const Schema = component("schema", { x: f64() });
    const world = new World();
    const { spawn, query: queryFromAccess } = world.access;
    assert.deepEqual(Object.keys(world.access), []);
    assert.equal(Reflect.get(world.access, "world"), undefined);
    assert.ok(Object.isFrozen(Object.getPrototypeOf(world.access)));
    assert.doesNotThrow(() => spawn());
    assert.equal(queryFromAccess().size, 0);
    assert.equal("commit" in world.access, false);
    assert.equal("enumerate" in world.access, false);
    assert.throws(() => world.queryTypes([Schema, Schema]), /Duplicate component/);
    // Unchecked JavaScript callers cannot reach the removed object-component bridge.
    const factory = (() => ({ x: 0 })) as unknown as Parameters<typeof component>[1];
    assert.throws(() => component("object", factory), /schema object/);
    const objectValue = { component: { name: "object", create: () => ({}) }, value: {} };
    assert.throws(
        () => world.spawnValues([objectValue as unknown as ReturnType<typeof Schema.of>]),
        /Schema component required/,
    );
    assert.throws(
        () => world.queryTypes([objectValue.component as unknown as typeof Schema]),
        /Schema component required/,
    );
    for (const runtimeQuery of [world.query(), world.query(Schema)]) {
        assert.deepEqual(Object.keys(runtimeQuery), []);
        assert.equal(Reflect.get(runtimeQuery, "world"), undefined);
        assert.equal(Reflect.get(runtimeQuery, "matches"), undefined);
        assert.equal(Reflect.get(runtimeQuery, "descriptors"), undefined);
    }
});

test("disposal invalidates queries and chunk borrows", () => {
    const Schema = component("schema", { x: f64() });
    const world = new World();
    const query = world.query(Schema);
    world.spawn(Schema.of());
    world.commit();
    let descriptor: Parameters<Parameters<typeof query.eachChunk>[0]>[0] | undefined;
    query.eachChunk((chunk) => (descriptor = chunk));
    world.dispose();
    assert.equal(query.size, 0);
    assert.throws(() => descriptor!.count, /expired/);
    assert.throws(() => world.spawn(Schema.of()), /disposed/);
    assert.throws(() => world.commit(), /disposed/);
});
