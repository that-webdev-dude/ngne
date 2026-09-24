import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    writeFileSync,
    readdirSync,
    symlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { compactRun } from "../suites/benchmarks/compact.js";

const base = resolve(".test-output/node-compaction");
mkdirSync(base, { recursive: true });
const results = resolve("benchmarks/run-results.mjs");
const save = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v));
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
function fixture() {
    const root = mkdtempSync(join(base, "run-"));
    mkdirSync(join(root, "churn"));
    save(join(root, "churn/result.json"), {
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
        sourceHashes: { a: "1".repeat(64), b: "2".repeat(64), c: "3".repeat(64) },
        batchMs: { samples: 1000, p50: 1, p95: 1, p99: 1 },
        rawBatchMs: Array(1000).fill(1),
    });
    writeFileSync(join(root, "churn/run.log"), "diagnostic");
    writeFileSync(join(root, "summary.md"), "fixture\n");
    save(join(root, "manifest.json"), {
        schemaVersion: 2,
        status: "passed",
        revision: "fixture",
        startedAt: "fixture",
        outputDirectory: root,
        parameters: { workload: "churn", diagnostics: false },
        environment: {},
        fatalError: null,
        stages: [{ name: "churn", kind: "benchmark", status: "passed" }],
    });
    execFileSync(process.execPath, [results, "collect", root], { windowsHide: true });
    return root;
}
test("Node compaction preserves validated summaries and raw sample arrays", () => {
    const root = fixture(),
        bytes = readFileSync(join(root, "analysis.json"));
    compactRun(root, results);
    assert.deepEqual(readdirSync(root).sort(), ["analysis.json", "manifest.json", "summary.md"]);
    assert.deepEqual(readFileSync(join(root, "analysis.json")), bytes);
    assert.equal(read(join(root, "manifest.json")).retention.mode, "compact");
    execFileSync(process.execPath, [results, "validate", root], { windowsHide: true });
});
test("Node compaction rejects corrupt, failed, mismatched and linked paths without deleting evidence", () => {
    for (const kind of ["corrupt", "failed", "mismatch", "link", "ancestor"]) {
        const root = fixture();
        let target = root;
        if (kind === "corrupt") writeFileSync(join(root, "analysis.json"), "{}");
        if (kind === "failed" || kind === "mismatch") {
            const m = read(join(root, "manifest.json"));
            if (kind === "failed") m.status = "failed";
            else m.outputDirectory = base;
            save(join(root, "manifest.json"), m);
        }
        if (kind === "link")
            symlinkSync(
                fixture(),
                join(root, "escape"),
                process.platform === "win32" ? "junction" : "dir",
            );
        if (kind === "ancestor") {
            target = join(mkdtempSync(join(base, "link-")), "run");
            symlinkSync(root, target, process.platform === "win32" ? "junction" : "dir");
        }
        assert.throws(() => compactRun(target, results));
        assert.equal(readFileSync(join(root, "churn/run.log"), "utf8"), "diagnostic");
    }
});
test("Node compaction records deletion failure and retains diagnostic bytes", () => {
    const root = fixture();
    assert.throws(
        () =>
            compactRun(root, results, () => {
                throw Error("Injected deletion failure");
            }),
        /Injected/,
    );
    assert.equal(read(join(root, "manifest.json")).retention.mode, "failed");
    assert.equal(readFileSync(join(root, "churn/run.log"), "utf8"), "diagnostic");
});
