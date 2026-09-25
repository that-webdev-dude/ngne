import assert from "node:assert/strict";
import { test } from "node:test";
import { compactRun } from "../tooling/suites/benchmarks/compact.js";
import { allBenchmarks } from "../tooling/suites/benchmarks/all.js";
import { benchmarkOptions } from "../tooling/suites/benchmarks/options.js";
import { benchmarkFixture } from "../tooling/tests/fixtures/benchmark-runner.js";
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    writeFileSync,
    symlinkSync,
    existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
    collectAnalysis,
    loadRun,
    readJson,
    validateAnalysis,
    validateChurn,
} from "../tooling/evidence/run-results.mjs";
import { compareRuns } from "../tooling/evidence/compare-runs.mjs";

const output = resolve(".test-output/benchmark-output-tests");
mkdirSync(output, { recursive: true });
const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));
function fixture(legacy = false) {
    const directory = mkdtempSync(join(output, "run-"));
    mkdirSync(join(directory, "churn"));
    const result = {
        api: "schema",
        mode: "timed",
        revision: "fixture",
        node: "fixture",
        cpu: "fixture",
        parameters: {
            LIVE: 10000,
            PER_COMMIT: 1000,
            WARMUP_COMMITS: 100,
            SAMPLE_COMMITS: 1000,
            RETAINED_EVERY: 100,
        },
        sourceHashes: {
            "../../src/ecs.ts": "1".repeat(64),
            "../../package-lock.json": "2".repeat(64),
            "./churn-schema.ts": "3".repeat(64),
        },
        batchMs: { samples: 1000, p50: 1, p95: 1, p99: 1 },
        rawBatchMs: Array(1000).fill(1),
    };
    save(join(directory, "churn/result.json"), result);
    writeFileSync(join(directory, "churn/run.log"), "diagnostic");
    save(join(directory, "manifest.json"), {
        schemaVersion: legacy ? 1 : 2,
        status: "passed",
        revision: "fixture",
        startedAt: "fixture",
        outputDirectory: directory,
        parameters: { workload: "churn", diagnostics: false },
        environment: { machine: "fixture" },
        fatalError: null,
        stages: [{ name: "churn", kind: "benchmark", status: "passed" }],
    });
    writeFileSync(join(directory, "summary.md"), "# Benchmark\n");
    if (!legacy) collectAnalysis(directory);
    return directory;
}
function compact(directory: string, injectFailure = false) {
    try {
        compactRun(
            directory,
            resolve("tooling/evidence/run-results.mjs"),
            injectFailure
                ? () => {
                      throw Error("Injected deletion failure");
                  }
                : undefined,
        );
        return { status: 0, stderr: "" };
    } catch (error) {
        return { status: 1, stderr: String(error) };
    }
}

test("full, compact and legacy churn results produce identical metrics", () => {
    const baseline = fixture(),
        candidate = fixture(),
        legacy = fixture(true);
    const metrics = () =>
        compareRuns(loadRun(baseline, "baseline"), loadRun(candidate, "candidate")).workloads.map(
            (w) => w.metrics,
        );
    const before = metrics();
    const result = compact(candidate);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(candidate).sort(), [
        "analysis.json",
        "manifest.json",
        "summary.md",
    ]);
    assert.equal(readJson(join(candidate, "manifest.json")).retention.mode, "compact");
    assert.deepEqual(metrics(), before);
    assert.equal(compact(baseline).status, 0);
    assert.deepEqual(metrics(), before);
    const old = compareRuns(loadRun(legacy, "baseline"), loadRun(candidate, "candidate"));
    assert.deepEqual(
        old.workloads.map((w) => w.metrics),
        before,
    );
    assert.equal(old.problems.length, 0);
});

test("missing or corrupted consolidated analysis prevents cleanup and comparison", () => {
    for (const content of ["{}", "broken"]) {
        const directory = fixture();
        writeFileSync(join(directory, "analysis.json"), content);
        assert.notEqual(compact(directory).status, 0);
        assert.equal(readFileSync(join(directory, "churn/run.log"), "utf8"), "diagnostic");
        assert.throws(() => loadRun(directory, "candidate"));
    }
    const missing = fixture(true);
    const manifest = readJson(join(missing, "manifest.json"));
    manifest.schemaVersion = 2;
    save(join(missing, "manifest.json"), manifest);
    assert.notEqual(compact(missing).status, 0);
    assert.throws(() => loadRun(missing, "candidate"), /Missing consolidated/);
});

test("failed and incomplete runs retain diagnostics", () => {
    const failed = fixture(),
        manifest = readJson(join(failed, "manifest.json"));
    manifest.status = "failed";
    manifest.stages[0].status = "failed";
    save(join(failed, "manifest.json"), manifest);
    collectAnalysis(failed);
    assert.notEqual(compact(failed).status, 0);
    assert.equal(readFileSync(join(failed, "churn/run.log"), "utf8"), "diagnostic");
    const incomplete = fixture(),
        incompleteManifest = readJson(join(incomplete, "manifest.json"));
    incompleteManifest.stages = [];
    save(join(incomplete, "manifest.json"), incompleteManifest);
    assert.throws(() => collectAnalysis(incomplete), /Missing expected/);
    assert.notEqual(compact(incomplete).status, 0);
    assert.equal(readFileSync(join(incomplete, "churn/run.log"), "utf8"), "diagnostic");
});

test("compaction refuses mismatched directories, junctions and linked ancestors", () => {
    const directory = fixture(),
        outside = fixture();
    symlinkSync(
        outside,
        join(directory, "escape"),
        process.platform === "win32" ? "junction" : "dir",
    );
    assert.notEqual(compact(directory).status, 0);
    assert.equal(readFileSync(join(outside, "churn/run.log"), "utf8"), "diagnostic");
    const link = join(mkdtempSync(join(output, "link-")), "run");
    symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    assert.notEqual(compact(link).status, 0);
    const mismatch = fixture(),
        manifest = readJson(join(mismatch, "manifest.json"));
    manifest.outputDirectory = outside;
    save(join(mismatch, "manifest.json"), manifest);
    assert.notEqual(compact(mismatch).status, 0);
    assert.equal(readFileSync(join(mismatch, "churn/run.log"), "utf8"), "diagnostic");
});

test("cleanup failures are recorded instead of reporting compact success", () => {
    const directory = fixture();
    const result = compact(directory, true);
    assert.notEqual(result.status, 0);
    assert.equal(readJson(join(directory, "manifest.json")).retention.mode, "failed");
    assert.equal(readFileSync(join(directory, "churn/run.log"), "utf8"), "diagnostic");
});

test("churn validation rejects incomplete samples and rejected GC traces", () => {
    const directory = fixture(),
        result = readJson(join(directory, "churn/result.json"));
    result.rawBatchMs.pop();
    assert.throws(() => validateChurn(result, "timed"), /timing samples/);
    result.mode = "gc";
    result.gcTrace = { accepted: false, windowCount: 1, windowPauseTotalMs: 1 };
    assert.throws(() => validateChurn(result, "gc"), /not accepted/);
    result.mode = "alloc";
    assert.throws(() => validateChurn(result, "alloc"), /missing allocation/);
    const valid = fixture();
    const changed = readJson(join(valid, "churn/result.json"));
    changed.batchMs.p50 = 2;
    save(join(valid, "churn/result.json"), changed);
    assert.throws(() => validateAnalysis(valid), /Result mismatch/);
});

test("runner failure preserves logs even when compact output was requested", async () => {
    const root = benchmarkFixture();
    writeFileSync(
        join(root, "tooling/suites/benchmarks/cpu/churn-schema.ts"),
        `import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[process.argv.indexOf('--out') + 1], '{}'); console.error('Injected workload failure');`,
    );
    const run = await allBenchmarks(
        root,
        benchmarkOptions(
            ["-Workload", "churn", "-Compact", "-OutputRoot", join(root, "runs")],
            root,
        ),
    );
    assert.equal(run.result.accepted, false);
    assert.equal(run.result.cleanup, "passed");
    const directory = join(run.evidence, "legacy");
    const manifest = readJson(join(directory, "manifest.json"));
    assert.equal(manifest.status, "failed");
    assert.equal(manifest.stages[0].status, "failed");
    assert.equal(manifest.retention.mode, "full");
    assert.ok(existsSync(join(directory, "analysis.json")));
    assert.match(
        readFileSync(join(run.evidence, "stages/churn/logs/stderr.log"), "utf8"),
        /Injected workload failure/,
    );
});
