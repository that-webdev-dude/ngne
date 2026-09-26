import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { evidenceFixture, measured } from "./fixtures/benchmark-evidence.js";
import { compactRun } from "../suites/benchmarks/compact.js";
import { loadBenchmarkRun } from "../evidence/benchmark-results.js";
import { compareRuns } from "../evidence/compare-runs.mjs";

const diagnostic = (run: ReturnType<typeof evidenceFixture>) =>
    join(run.evidence, "stages/churn/diagnostics/profile.json");
test("compaction retains canonical measurements and logs with a valid final inventory", async () => {
    const full = evidenceFixture(),
        compact = evidenceFixture();
    await full.execute(() => measured(full));
    await compact.execute(async () => {
        await measured(compact);
        compact.cleanup.push(["compaction", () => compactRun(compact)]);
    });
    assert.equal(compact.result.accepted, true);
    assert.equal(existsSync(diagnostic(compact)), false);
    assert.equal(
        readFileSync(join(compact.evidence, "stages/churn/logs/stderr.log"), "utf8"),
        "diagnostic log",
    );
    const a = loadBenchmarkRun(full.root, "baseline"),
        b = loadBenchmarkRun(compact.root, "candidate");
    assert.deepEqual(
        compareRuns(a, b).workloads.map((w) => w.metrics),
        compareRuns(a, a).workloads.map((w) => w.metrics),
    );
});

test("compaction rejects invalid measurements, failed runs, linked targets and linked ancestors before deletion", async () => {
    for (const kind of ["invalid", "failed", "link", "ancestor"]) {
        const run = evidenceFixture();
        await measured(run);
        if (kind === "invalid")
            writeFileSync(join(run.evidence, "stages/churn/measurements.json"), "{}");
        if (kind === "failed") run.result.failures.push({ kind: "scenario", message: "failed" });
        if (kind === "link" || kind === "ancestor") {
            const outside = evidenceFixture();
            await measured(outside);
            if (kind === "link")
                symlinkSync(
                    outside.evidence,
                    join(run.evidence, "escape"),
                    process.platform === "win32" ? "junction" : "dir",
                );
            else {
                const link = join(outside.root, "linked-run");
                symlinkSync(run.root, link, process.platform === "win32" ? "junction" : "dir");
                const proxy = Object.create(run) as typeof run;
                Object.defineProperty(proxy, "evidence", { value: join(link, "evidence") });
                assert.throws(() => compactRun(proxy));
                assert.ok(existsSync(diagnostic(run)));
                continue;
            }
        }
        assert.throws(() => compactRun(run));
        assert.ok(existsSync(diagnostic(run)));
    }
});

test("compaction failure publishes unsuccessful acceptance and preserves remaining diagnostics", async () => {
    const run = evidenceFixture();
    await run.execute(async () => {
        await measured(run);
        run.cleanup.push([
            "compaction",
            () =>
                compactRun(run, () => {
                    throw Error("Injected deletion failure");
                }),
        ]);
    });
    assert.equal(run.result.accepted, false);
    assert.equal(run.result.cleanup, "failed");
    assert.ok(existsSync(diagnostic(run)));
    assert.equal(loadBenchmarkRun(run.root, "candidate").manifest.status, "failed");
});
