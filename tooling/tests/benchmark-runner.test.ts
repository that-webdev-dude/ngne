import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { benchmarkFixture } from "./fixtures/benchmark-runner.js";
import { allBenchmarks } from "../suites/benchmarks/all.js";
import { benchmarkOptions } from "../suites/benchmarks/options.js";

test("Node benchmark command failure retains diagnostics and refuses requested compaction", async () => {
    const root = benchmarkFixture();
    writeFileSync(
        join(root, "tooling/suites/benchmarks/cpu/churn-schema.ts"),
        `console.error("Injected workload failure"); process.exitCode = 1;`,
    );
    const run = await allBenchmarks(
        root,
        benchmarkOptions(["--workload", "churn", "--compact"], root),
    );
    assert.equal(run.result.accepted, false);
    assert.equal(run.result.execution, "failed");
    assert.equal(run.result.cleanup, "passed");
    assert.equal(run.result.stages[0].correctness, "failed");
    assert.match(
        readFileSync(join(run.evidence, "stages/churn/logs/stderr.log"), "utf8"),
        /Injected workload failure/,
    );
    const legacy = JSON.parse(readFileSync(join(run.evidence, "legacy/manifest.json"), "utf8"));
    assert.equal(legacy.status, "failed");
    assert.equal(legacy.retention.mode, "full");
    assert.equal(legacy.outputDirectory, join(dirname(run.evidence), "evidence/legacy"));
});

test("Node consolidation failure cannot leave a successful legacy manifest or summary", async () => {
    const root = benchmarkFixture();
    writeFileSync(
        join(root, "tooling/suites/benchmarks/cpu/churn-schema.ts"),
        `import {writeFileSync} from 'node:fs'; writeFileSync(process.argv[process.argv.indexOf('--out')+1], '{}');`,
    );
    // Synthetic parser boundary: only consolidation fails after a completed stage.
    writeFileSync(
        join(root, "benchmarks/run-results.mjs"),
        `if (process.argv[2] === 'collect') throw Error('Injected consolidation failure');`,
    );
    const run = await allBenchmarks(
        root,
        benchmarkOptions(["--workload", "churn", "--compact"], root),
    );
    assert.equal(run.result.stages[0].execution, "completed");
    assert.equal(run.result.accepted, false);
    assert.equal(run.result.cleanup, "passed");
    const legacy = JSON.parse(readFileSync(join(run.evidence, "legacy/manifest.json"), "utf8"));
    assert.equal(legacy.status, "failed");
    assert.equal(legacy.retention.mode, "full");
    assert.match(legacy.reportError, /consolidate/);
    assert.match(readFileSync(join(run.evidence, "legacy/summary.md"), "utf8"), /Status: failed/);
    assert.match(
        readFileSync(join(run.evidence, "stages/consolidate/logs/stderr.log"), "utf8"),
        /Injected consolidation failure/,
    );
});
