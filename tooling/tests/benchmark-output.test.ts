import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync, symlinkSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { evidenceFixture, measured, measurement } from "./fixtures/benchmark-evidence.js";
import { loadBenchmarkRun } from "../evidence/benchmark-results.js";
import { compareRuns } from "../evidence/compare-runs.mjs";
import { readJson } from "../evidence/run-results.mjs";
import { hash } from "../evidence/identity.js";

function reseal(directory: string, path: string) {
    const inventory = readJson(join(directory, "artifacts.json"));
    const file = inventory.files.find((f: { path: string }) => f.path === path);
    const bytes = readFileSync(join(directory, path));
    file.bytes = bytes.length;
    file.sha256 = hash(bytes);
    writeFileSync(join(directory, "artifacts.json"), JSON.stringify(inventory));
}

test("current workload set retires Starfall while historical full runs still require it", async () => {
    for (const workloadSet of [undefined, "engine-examples-v1", "unknown"]) {
        const run = evidenceFixture();
        run.manifest.policy.parameters = { workload: "all", diagnostics: false, workloadSet };
        await run.execute(async () => {
            for (const id of [
                "cpu",
                "churn",
                "renderer-webgpu",
                "renderer-webgpu-alternating",
                "platformer",
            ]) {
                await run.stage(id, async () => {
                    run.record(id, "measurements", {
                        target: "internal-source-microbenchmark",
                        raw:
                            id === "churn"
                                ? measurement()
                                : id === "cpu"
                                  ? {
                                        workload: "ecs-grid-epoch-v1",
                                        collisionGrid: { valid: true },
                                    }
                                  : { visibilityState: { atStart: "visible", atEnd: "visible" } },
                    });
                });
            }
            run.manifest.preparation = "prepared";
        });
        if (workloadSet === "engine-examples-v1")
            assert.equal(loadBenchmarkRun(run.root, "candidate").results.size, 5);
        else
            assert.throws(
                () => loadBenchmarkRun(run.root, "candidate"),
                workloadSet === undefined
                    ? /Missing expected workload: starfall-chaos/
                    : /Unknown benchmark workload set/,
            );
    }
});

test("changed CPU identities omit timing comparisons but preserve historical CPU comparisons", async () => {
    const run = evidenceFixture();
    await run.execute(() => measured(run));
    const original = loadBenchmarkRun(run.root, "baseline");
    const historical = {
        ...original,
        results: new Map([
            [
                "cpu",
                {
                    path: "historical",
                    value: {
                        collisionGrid: { valid: true },
                        ecs: { ms: { p50: 1, p95: 2, p99: 3 } },
                        chaos: { simulationAndPreparationMs: { p50: 4, p95: 5, p99: 6 } },
                    },
                },
            ],
        ]),
    };
    const current = {
        ...historical,
        results: new Map([
            [
                "cpu",
                {
                    path: "current",
                    value: {
                        ...historical.results.get("cpu")!.value,
                        workload: "ecs-grid-epoch-v1",
                    },
                },
            ],
        ]),
    };
    const comparison = compareRuns(historical, current);
    assert.equal(comparison.workloads.length, 0);
    assert.ok(
        comparison.compatibilityWarnings.some((w) =>
            /CPU workload identity changed/.test(w.message),
        ),
    );
    assert.ok(
        compareRuns(historical, historical).workloads[0].metrics.some(
            (m) => m?.label === "Chaos CPU p50",
        ),
    );
    assert.ok(compareRuns(current, current).workloads[0].metrics.length > 0);
});

test("current reader rejects unlisted linked directories", async () => {
    const run = evidenceFixture();
    await run.execute(() => measured(run));
    symlinkSync(join(run.evidence, "stages/churn"), join(run.evidence, "linked"), "junction");
    assert.throws(() => loadBenchmarkRun(run.root, "candidate"), /Linked inventory entry/);
});

test("current run roots and evidence paths share canonical measurements; historical metrics match", async () => {
    const run = evidenceFixture();
    await run.execute(() => measured(run));
    const current = loadBenchmarkRun(run.root, "candidate");
    assert.deepEqual(current.results, loadBenchmarkRun(run.evidence, "candidate").results);
    assert.equal(existsSync(join(run.evidence, "legacy")), false);
    const old = loadBenchmarkRun(
        "tooling/tests/fixtures/legacy/benchmark-consolidated",
        "baseline",
    );
    const metrics = (a: typeof old, b: typeof old) =>
        compareRuns(a, b).workloads.map((w) => w.metrics);
    assert.deepEqual(metrics(old, current), metrics(old, old));
});

test("comparison CLI links canonical reports and rejects tampered current evidence", async () => {
    const run = evidenceFixture();
    await run.execute(() => measured(run));
    const output = join(dirname(run.root), "comparison with spaces");
    const args = [
        "--import",
        "tsx",
        resolve("tooling/commands/compare-benchmarks.ts"),
        run.root,
        run.root,
        "--output",
        output,
    ];
    execFileSync(process.execPath, args, { windowsHide: true });
    const report = readFileSync(join(output, "report.md"), "utf8");
    assert.match(report, /\.\.\/run\/evidence\/report\.md/);
    assert.doesNotMatch(report, /summary\.md/);
    writeFileSync(join(run.evidence, "stages/churn/measurements.json"), "{}");
    assert.throws(
        () => execFileSync(process.execPath, args, { windowsHide: true, stdio: "pipe" }),
        /Changed artifact/,
    );
});

for (const path of ["extra.txt", "stages/churn/diagnostics/extra.txt"]) {
    test(`current reader rejects an unrelated unlisted file: ${path}`, async () => {
        const run = evidenceFixture();
        await run.execute(() => measured(run));
        assert.doesNotThrow(() => loadBenchmarkRun(run.root, "candidate"));
        writeFileSync(join(run.evidence, path), "unlisted payload");
        assert.throws(() => loadBenchmarkRun(run.root, "candidate"), /Changed evidence inventory/);
    });
}

test("current reader rejects corrupt, missing, unlisted and cross-run evidence", async () => {
    for (const kind of [
        "corrupt",
        "missing",
        "unlisted",
        "identity",
        "version",
        "workload",
        "partial",
        "acceptance",
        "traversal",
    ]) {
        const run = evidenceFixture();
        await run.execute(() => measured(run));
        const path = "stages/churn/measurements.json";
        if (kind === "missing") unlinkSync(join(run.evidence, path));
        else if (kind === "unlisted" || kind === "traversal") {
            const p = join(run.evidence, "artifacts.json"),
                inventory = readJson(p);
            if (kind === "unlisted")
                inventory.files = inventory.files.filter((f: { path: string }) => f.path !== path);
            else inventory.files[0].path = "../escape";
            writeFileSync(p, JSON.stringify(inventory));
        } else if (kind === "partial" || kind === "acceptance") {
            const p = "result.json",
                data = readJson(join(run.evidence, p));
            if (kind === "partial") {
                data.evidence = "partial";
                data.accepted = false;
            } else data.cleanup = "failed";
            writeFileSync(join(run.evidence, p), JSON.stringify(data));
            reseal(run.evidence, p);
        } else {
            const data = readJson(join(run.evidence, path));
            if (kind === "identity") data.runId = "another-run";
            else if (kind === "version") data.schemaVersion = 99;
            else data.raw.rawBatchMs.pop();
            writeFileSync(join(run.evidence, path), JSON.stringify(data));
            if (kind !== "corrupt") reseal(run.evidence, path);
        }
        assert.throws(() => loadBenchmarkRun(run.root, "candidate"), kind);
    }
});

test("failed workloads and cleanup failures remain visible for either comparison role", async () => {
    const good = evidenceFixture();
    await good.execute(() => measured(good));
    for (const kind of ["workload", "cleanup"]) {
        const run = evidenceFixture();
        if (kind === "cleanup")
            run.cleanup.push([
                "injected cleanup",
                () => {
                    throw Error("cleanup failed");
                },
            ]);
        await run.execute(async () => {
            await measured(run);
            if (kind === "workload") throw Error("workload failed");
        });
        const failed = loadBenchmarkRun(run.root, "candidate"),
            passed = loadBenchmarkRun(good.root, "baseline");
        assert.equal(failed.manifest.status, "failed");
        assert.ok(compareRuns(passed, failed).problems.length);
        assert.ok(compareRuns(failed, passed).problems.length);
    }
});
