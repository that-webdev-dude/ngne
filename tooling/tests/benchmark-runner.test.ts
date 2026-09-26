import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { benchmarkFixture } from "./fixtures/benchmark-runner.js";
import { measurement } from "./fixtures/benchmark-evidence.js";
import { allBenchmarks } from "../suites/benchmarks/all.js";
import { benchmarkOptions } from "../suites/benchmarks/options.js";
import { loadBenchmarkRun } from "../evidence/benchmark-results.js";

test("benchmark command failure retains diagnostics and refuses requested compaction", async () => {
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
    assert.equal(run.result.cleanup, "passed");
    assert.match(
        readFileSync(join(run.evidence, "stages/churn/logs/stderr.log"), "utf8"),
        /Injected workload failure/,
    );
    assert.equal(existsSync(join(run.evidence, "legacy")), false);
    assert.deepEqual(run.manifest.policy.retention, { mode: "full", compactRequested: true });
    assert.equal(loadBenchmarkRun(run.root, "candidate").manifest.status, "failed");
});

test("invalid workload payload cannot publish successful acceptance", async () => {
    const root = benchmarkFixture();
    writeFileSync(
        join(root, "tooling/suites/benchmarks/cpu/churn-schema.ts"),
        `import {writeFileSync} from 'node:fs'; writeFileSync(process.argv[process.argv.indexOf('--out')+1], '{}');`,
    );
    const run = await allBenchmarks(
        root,
        benchmarkOptions(["--workload", "churn", "--compact"], root),
    );
    assert.equal(run.result.stages[0].execution, "failed");
    assert.equal(run.result.accepted, false);
    assert.equal(run.result.cleanup, "passed");
    assert.ok(existsSync(join(run.evidence, "stages/churn/diagnostics/result.json")));
    assert.equal(existsSync(join(run.evidence, "stages/churn/measurements.json")), false);
});

test("successful runner stores one measurement payload and compares full and compact runs", async () => {
    for (const compact of [false, true]) {
        const root = benchmarkFixture();
        writeFileSync(
            join(root, "tooling/suites/benchmarks/cpu/churn-schema.ts"),
            `import {writeFileSync} from 'node:fs'; writeFileSync(process.argv[process.argv.indexOf('--out')+1], ${JSON.stringify(JSON.stringify(measurement()))});`,
        );
        const run = await allBenchmarks(
            root,
            benchmarkOptions(["--workload", "churn", ...(compact ? ["--compact"] : [])], root),
        );
        assert.equal(run.result.accepted, true);
        assert.equal(existsSync(join(run.evidence, "legacy")), false);
        assert.equal(existsSync(join(run.evidence, "stages/churn/diagnostics/result.json")), false);
        assert.deepEqual(
            loadBenchmarkRun(run.root, "candidate").results.get("churn")?.value,
            measurement(),
        );
    }
});
