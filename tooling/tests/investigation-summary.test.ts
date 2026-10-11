import assert from "node:assert/strict";
import test from "node:test";
import { summarizeFrames } from "../suites/benchmarks/rendering/investigation-summary.js";

test("investigation uses executed ticks and cumulative-drop differences within the sample window", () => {
    const result = summarizeFrames({
        columns: ["time", "cadence", "cpu", "update", "ticks", "dropped", "sort"],
        begin: 10,
        end: 40,
        samples: [
            [0, 10, 1, 1, 1, 7, -1],
            [10, 10, 1, 0, 0, 7, -1],
            [20, 10, 4, 2, 1, 8, -1],
            [30, 10, 10, 8, 2, 9, -1],
            [40, 10, 100, 90, 3, 99, -1],
        ],
    });
    assert.equal(result.frames, 3);
    assert.equal(result.ticks, 3);
    assert.equal(result.updateMsPerTick, 10 / 3);
    assert.equal(result.droppedTicks, 2);
    assert.equal(result.metrics.cpu.mean, 5);
    assert.equal(result.metrics.sort, undefined);
    assert.equal(result.fps, 100);
});

test("investigation rejects empty windows and reports no per-tick estimate without ticks", () => {
    assert.throws(
        () => summarizeFrames({ columns: ["time"], samples: [], begin: 0, end: 1 }),
        /Missing/,
    );
    const result = summarizeFrames({
        columns: ["time", "update", "ticks"],
        samples: [[0, 0.1, 0]],
        begin: 0,
        end: 1,
    });
    assert.equal(result.updateMsPerTick, null);
});
