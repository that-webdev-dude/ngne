import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join, relative, dirname } from "node:path";
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
        ["tooling/evidence/compare-content.mjs", fixture("content-valid"), fixture(name)],
        { encoding: "utf8" },
    );
}
function benchmark(name: string) {
    legacyFormat("benchmark-legacy", manifest(name));
    // Execute the unchanged JS reader under Node; do not duplicate its validation in fixtures.
    const reader = pathToFileURL(resolve("tooling/evidence/run-results.mjs")).href;
    const comparator = pathToFileURL(resolve("tooling/evidence/compare-runs.mjs")).href;
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

test("relocated advisory CLI preserves dispatch, relative paths, reports and exit codes", () => {
    const output = resolve(".test-output/comparator-cli");
    mkdirSync(output, { recursive: true });
    const cwd = mkdtempSync(join(output, "run-"));
    cpSync(fixture("benchmark-per-stage"), join(cwd, "baseline"), { recursive: true });
    cpSync(fixture("benchmark-compact"), join(cwd, "candidate"), { recursive: true });
    const command = resolve("tooling/evidence/compare-runs.mjs");
    const invoke = (...args: string[]) =>
        spawnSync(process.execPath, [command, ...args], { cwd, encoding: "utf8" });
    assert.equal(invoke("--help").status, 0);
    assert.equal(invoke("-h").status, 0);
    for (const args of [[], ["--unknown"], ["--output"], ["--attention-percent", "0"]])
        assert.equal(invoke(...args).status, 1);
    const run = invoke("baseline", "candidate", "--output", "reports with spaces");
    assert.equal(run.status, 0, run.stderr);
    const directory = join(cwd, "reports with spaces");
    const result = JSON.parse(readFileSync(join(directory, "comparison.json"), "utf8"));
    assert.equal(result.scanResult, "CHECK COMPARABILITY");
    assert.equal(result.attentionPercent, 10);
    assert.match(readFileSync(join(directory, "report.md"), "utf8"), /\.\.\/baseline\/summary\.md/);
    // Unique run basename prevents the preserved timestamp default from reusing an old output.
    const defaults = invoke(".", ".");
    assert.equal(defaults.status, 1); // Missing manifest remains an error.
    cpSync(fixture("benchmark-per-stage"), cwd, { recursive: true });
    const defaultRun = invoke(".", ".", "--attention-percent", "25");
    assert.equal(defaultRun.status, 0, defaultRun.stderr);
    const json = defaultRun.stdout.match(/^JSON: (.+)$/m)?.[1];
    assert.ok(json);
    assert.equal(dirname(dirname(json)), resolve(".test-output/comparisons"));
    assert.equal(JSON.parse(readFileSync(json, "utf8")).attentionPercent, 25);
    assert.equal(invoke(relative(cwd, fixture("benchmark-missing-analysis")), ".").status, 1);
});

test("advisory CLI retains scan precedence and metric directions", () => {
    const output = resolve(".test-output/comparator-scans");
    mkdirSync(output, { recursive: true });
    const cwd = mkdtempSync(join(output, "run-"));
    cpSync(fixture("benchmark-per-stage"), join(cwd, "baseline"), { recursive: true });
    cpSync(fixture("benchmark-per-stage"), join(cwd, "candidate"), { recursive: true });
    const path = join(cwd, "candidate/churn/result.json");
    const result = JSON.parse(readFileSync(path, "utf8"));
    result.batchMs.p50 *= 1.1;
    result.batchMs.p95 *= 0.9;
    writeFileSync(path, JSON.stringify(result));
    const manifestPath = join(cwd, "candidate/manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const expected of ["REVIEW REGRESSIONS", "CHECK COMPARABILITY", "NEEDS ATTENTION"]) {
        if (expected === "CHECK COMPARABILITY") manifest.environment.machine = "different";
        if (expected === "NEEDS ATTENTION") manifest.status = "failed";
        writeFileSync(manifestPath, JSON.stringify(manifest));
        const run = spawnSync(
            process.execPath,
            [
                resolve("tooling/evidence/compare-runs.mjs"),
                "baseline",
                "candidate",
                "--output",
                expected,
            ],
            { cwd, encoding: "utf8" },
        );
        assert.equal(run.status, 0, run.stderr);
        const comparison = JSON.parse(readFileSync(join(cwd, expected, "comparison.json"), "utf8"));
        assert.equal(comparison.scanResult, expected);
        assert.equal(comparison.summary.regressions, 1);
        assert.equal(comparison.summary.improvements, 1);
    }
});
