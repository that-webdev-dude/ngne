import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { legacyFormat } from "../evidence/legacy-format.js";
import { object, string } from "../evidence/schema.js";

const root = resolve("tooling/tests/fixtures/legacy");
const fixture = (name: string) => join(root, name);
const manifest = (name: string): unknown =>
    JSON.parse(readFileSync(join(fixture(name), "manifest.json"), "utf8"));
function content(name: string) {
    legacyFormat("content-legacy", manifest(name));
    return spawnSync(
        process.execPath,
        ["benchmarks/content/compare.mjs", fixture("content-valid"), fixture(name)],
        { encoding: "utf8" },
    );
}
function benchmark(name: string) {
    legacyFormat("benchmark-legacy", manifest(name));
    // Execute the unchanged JS reader under Node; do not duplicate its validation in fixtures.
    const reader = pathToFileURL(resolve("benchmarks/run-results.mjs")).href;
    const comparator = pathToFileURL(resolve("benchmarks/compare-runs.mjs")).href;
    return spawnSync(
        process.execPath,
        [
            "--input-type=module",
            "-e",
            `import {loadRun} from ${JSON.stringify(reader)}; import {compareRuns} from ${JSON.stringify(comparator)}; const a=loadRun(process.argv[1],'baseline'),b=loadRun(process.argv[2],'candidate'); console.log(JSON.stringify(compareRuns(a,b)));`,
            fixture("benchmark-per-stage"),
            fixture(name),
        ],
        { encoding: "utf8" },
    );
}
test("content legacy preserves strict acceptance and missing identity rejection", () => {
    assert.equal(content("content-valid").status, 0);
    for (const name of ["content-cleanup-failed", "content-missing-tooling"]) {
        const result = content(name);
        assert.equal(result.status, 2, result.stderr);
        assert.match(result.stdout, /CHECK COMPARABILITY/);
    }
});
test("benchmark legacy per-stage consolidated and compact variants preserve metrics", () => {
    let expected: unknown;
    for (const name of ["benchmark-per-stage", "benchmark-consolidated", "benchmark-compact"]) {
        const result = benchmark(name);
        assert.equal(result.status, 0, result.stderr);
        const value = JSON.parse(result.stdout);
        assert.equal(value.attentionPercent, 10);
        assert.equal(value.problems.length, 0);
        const metrics = value.workloads.map((w: { metrics: unknown }) => w.metrics);
        if (expected) assert.deepEqual(metrics, expected);
        else expected = metrics;
        assert.equal(
            value.scanResult,
            name === "benchmark-per-stage" ? "NO NOTABLE MOVEMENT" : "CHECK COMPARABILITY",
        );
    }
});
test("benchmark legacy rejects missing and tampered analysis", () => {
    for (const name of ["benchmark-missing-analysis", "benchmark-tampered-analysis"]) {
        const result = benchmark(name);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Missing consolidated analysis|Analysis mismatch/);
    }
});
test("explicit legacy selection rejects named unsupported formats", () => {
    const cases: unknown = JSON.parse(readFileSync(join(root, "unsupported.json"), "utf8"));
    if (!Array.isArray(cases)) throw Error("Expected cases");
    for (const value of cases) {
        const row = object(value);
        assert.throws(
            () => legacyFormat(string(row.family), row.manifest),
            /Unsupported legacy format/,
            string(row.name),
        );
    }
});
