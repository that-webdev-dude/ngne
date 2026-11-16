/// <reference types="@webgpu/types" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Camera } from "../../src/primitives.js";
import { Frame } from "../../src/renderer.js";
import { auditOrder, sortFastPathGuard } from "../suites/benchmarks/rendering/order-audit.js";
import {
    TILESETS,
    emitTilemap,
    tilemapPlan,
} from "../suites/benchmarks/rendering/tilemap-fixture.js";
import { instrumentPreparation } from "../suites/benchmarks/rendering/preparation-transform.js";

test("order audit observes negative layers and active prefixes without changing submissions", () => {
    const frame = new Frame();
    frame.scene(new Camera(), 1);
    for (const layer of [2, -2, 2, 0]) frame.rect(0, 0, 1, 1, 0xffffff, 1, layer);
    const before = [...frame.order];
    const observation = auditOrder(frame);
    assert.equal(observation.identity, true);
    assert.equal(observation.layerRange, 5);
    assert.deepEqual(observation.keys, { "0/2/0": 2, "0/-2/0": 1, "0/0/0": 1 });
    assert.deepEqual(frame.order, before);
    frame.sort();
    assert.equal(auditOrder(frame).identity, false);
    frame.reset();
    frame.scene(new Camera(), 1);
    frame.rect(0, 0, 1, 1, 0xffffff);
    assert.deepEqual(auditOrder(frame).keys, { "0/0/0": 1 });
    frame.reset();
    assert.equal(auditOrder(frame).eligible4096x64, false);
});

test("eligibility observations reject unsupported keys and public input-order mutation", () => {
    const make = (layer = -2, depth = 0) => {
        const frame = new Frame();
        frame.scene(new Camera(), 1);
        for (let i = 0; i < 4096; i++)
            frame.sprite({ x: 0, y: 0, width: 1, height: 1, layer, depth });
        return frame;
    };
    assert.equal(auditOrder(make()).eligible4096x64, true);
    for (const [layer, depth] of [
        [0.5, 0],
        [Infinity, 0],
        [0, NaN],
        [0, Infinity],
    ])
        assert.equal(auditOrder(make(layer, depth)).eligible4096x64, false);
    const frame = make();
    frame.order.reverse();
    assert.equal(auditOrder(frame).eligible4096x64, false);
    frame.order.reverse();
    frame.scene(new Camera(), 1);
    frame.rect(0, 0, 1, 1, 0xffffff);
    assert.equal(auditOrder(frame).singleScene, false);
    const wide = make();
    wide.sprite({ x: 0, y: 0, width: 1, height: 1, layer: 100 });
    assert.equal(auditOrder(wide).eligible4096x64, false);
});

test("boundary instrumentation fails closed when source anchors drift", () => {
    const source = readFileSync(new URL("../../src/quad-renderer.ts", import.meta.url), "utf8");
    const transformed = instrumentPreparation(source, "./preparation-diagnostics.js");
    assert.match(
        transformed,
        /preparationStages\.gather = performance\.now\(\) - diagnosticGather/,
    );
    assert.match(
        transformed,
        /preparationStages\.upload = performance\.now\(\) - diagnosticUpload/,
    );
    assert.equal((transformed.match(/device\.queue\.writeBuffer\(instances/g) ?? []).length, 1);
    assert.equal((transformed.match(/frame\.sort\(\)/g) ?? []).length, 1);
    assert.throws(() => instrumentPreparation(transformed, "./diagnostics.js"), /anchor changed/);
    assert.throws(
        () =>
            instrumentPreparation(
                source.replace("frame.sort();", "frame.sort(1);"),
                "./diagnostics.js",
            ),
        /anchor changed/,
    );
});

/** Sorts like the renderer does and reports whether the comparator fallback ran. */
function observedSort(frame: Frame) {
    let comparator = false;
    Object.defineProperty(frame.order, "sort", {
        configurable: true,
        value(this: number[], compare: (a: number, b: number) => number) {
            comparator = true;
            return Array.prototype.sort.call(this, compare);
        },
    });
    frame.sort();
    return comparator;
}

test("tilemap plan authors dense layer-ordered tiles grouped by tileset", () => {
    const plan = tilemapPlan(66560, 130);
    assert.equal(plan.rows, 64);
    assert.deepEqual(
        plan.groups.map((group) => [group.layer, group.texture]),
        Array.from({ length: 8 }, (_, layer) => TILESETS.map((id) => [layer, id])).flat(),
    );
    const sizes = plan.groups.map((group) => group.cells.length);
    assert.equal(
        sizes.reduce((a, b) => a + b, 0),
        66560,
    );
    const second = plan.groups.filter((group) => group.texture === TILESETS[1]);
    const share = second.reduce((sum, group) => sum + group.cells.length, 0) / 66560;
    assert.ok(share > 0.2 && share < 0.3, `second tileset share ${share}`);
    const transformed =
        plan.groups.reduce((sum, group) => sum + group.variants.filter(Boolean).length, 0) / 66560;
    assert.ok(transformed > 0.1 && transformed < 0.15, `transformed share ${transformed}`);
    assert.deepEqual(tilemapPlan(66560, 130), plan);
    assert.throws(() => tilemapPlan(66561, 130), /multiple/);

    const frame = new Frame();
    frame.scene(new Camera(), 1);
    emitTilemap(frame, plan);
    assert.equal(frame.count, 66560);
    let runs = 1;
    for (let i = 1; i < frame.count; i++) if (frame.textures[i] !== frame.textures[i - 1]) runs++;
    assert.equal(runs, 16);
    assert.deepEqual(Object.keys(auditOrder(frame).keys), [
        "0/0/0",
        "0/0/1",
        "0/0/2",
        "0/0/3",
        "0/0/4",
        "0/0/5",
        "0/0/6",
        "0/0/7",
    ]);
});

test("tilemap frames take the fast path at 66,560 quads and the comparator at 524,288", () => {
    const live = new Frame();
    live.scene(new Camera(), 1);
    emitTilemap(live, tilemapPlan(66560, 130));
    assert.deepEqual(sortFastPathGuard(live), { eligible: true, failingGuard: null });
    assert.equal(observedSort(live), false);
    assert.ok(live.order.every((index, position) => index === position));

    const fitted = new Frame();
    fitted.scene(new Camera(), 1);
    emitTilemap(fitted, tilemapPlan(524288, 256));
    assert.deepEqual(sortFastPathGuard(fitted), {
        eligible: false,
        failingGuard: "count above 262,144 (1 MiB index scratch cap)",
    });
    assert.equal(observedSort(fitted), true);
    assert.ok(fitted.order.every((index, position) => index === position));
});

test("fast-path guard mirror agrees with the observed sort path", () => {
    const cases: [string, (frame: Frame, i: number) => void, string | null][] = [
        ["ordered layers", (f, i) => f.rect(0, 0, 1, 1, 0, 1, i >> 13), null],
        ["interleaved layers", (f, i) => f.rect(0, 0, 1, 1, 0, 1, i & 3), null],
        ["wide layers", (f, i) => f.rect(0, 0, 1, 1, 0, 1, (i & 3) * 32), "layer span above 64"],
        [
            "fractional layer",
            (f, i) => f.rect(0, 0, 1, 1, 0, 1, i === 9 ? 0.5 : 0),
            "non-integer layer",
        ],
        [
            "depth inversion",
            (f, i) => f.sprite({ x: 0, y: 0, width: 1, height: 1, depth: i === 40959 ? -1 : 0 }),
            "mixed depths not already in layer → depth order",
        ],
        [
            "depth after interleaving",
            (f, i) =>
                f.sprite({
                    x: 0,
                    y: 0,
                    width: 1,
                    height: 1,
                    layer: i & 1,
                    depth: i > 40000 ? 1 : 0,
                }),
            "mixed depths with out-of-order layers",
        ],
        [
            "two scenes",
            (f, i) => {
                if (i === 20000) f.scene(new Camera(), 1);
                f.rect(0, 0, 1, 1, 0);
            },
            "more than one scene",
        ],
    ];
    for (const [name, author, failingGuard] of cases) {
        const frame = new Frame();
        frame.scene(new Camera(), 1);
        for (let i = 0; i < 40960; i++) author(frame, i);
        const guard = sortFastPathGuard(frame);
        assert.equal(guard.failingGuard, failingGuard, name);
        assert.equal(observedSort(frame), !guard.eligible, name);
    }
    const small = new Frame();
    small.scene(new Camera(), 1);
    small.rect(0, 0, 1, 1, 0);
    assert.equal(sortFastPathGuard(small).failingGuard, "count below 32,768");
    assert.equal(observedSort(small), true);
});
