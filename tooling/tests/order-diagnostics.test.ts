/// <reference types="@webgpu/types" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Camera } from "../../src/primitives.js";
import { Frame } from "../../src/renderer.js";
import { auditOrder } from "../suites/benchmarks/rendering/order-audit.js";
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
