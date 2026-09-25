import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

test("content comparison refuses a failed run and incompatible browser environment", () => {
    const root = mkdtempSync(join(tmpdir(), "ngne-content-comparison-"));
    try {
        const manifest = {
            policy: { repetitions: 3 },
            os: "test",
            package: "package",
            installed: {},
            build: {},
            source: {},
            harness: {},
            tooling: { "devtools.mjs": "first" },
        };
        const put = (name: string, value: unknown) =>
            writeFileSync(join(root, name + ".json"), JSON.stringify(value));
        put("manifest", manifest);
        put("fixtures", {});
        put("runs", [
            {
                workload: "roundTrips",
                environment: { userAgent: "browser" },
                visibilityChanges: [],
                metrics: {},
            },
        ]);
        put("result", { status: "passed", cleanupPassed: true });
        const compare = () =>
            spawnSync(process.execPath, ["tooling/evidence/compare-content.mjs", root, root], {
                encoding: "utf8",
            });
        assert.equal(compare().status, 0);
        put("result", { status: "failed" });
        const failed = compare();
        assert.equal(failed.status, 2);
        assert.match(failed.stdout, /CHECK COMPARABILITY/);
        // Two distinct roots differ only by the observed environment.
        put("result", { status: "passed", cleanupPassed: true });
        put("result", { status: "passed", cleanupPassed: false });
        assert.equal(compare().status, 2);
        put("result", { status: "passed", cleanupPassed: true });
        const other = mkdtempSync(join(tmpdir(), "ngne-content-comparison-"));
        try {
            for (const [name, value] of Object.entries({
                manifest,
                fixtures: {},
                result: { status: "passed", cleanupPassed: true },
                runs: [
                    {
                        workload: "roundTrips",
                        environment: { userAgent: "other" },
                        visibilityChanges: [],
                        metrics: {},
                    },
                ],
            }))
                writeFileSync(join(other, name + ".json"), JSON.stringify(value));
            const result = spawnSync(
                process.execPath,
                ["tooling/evidence/compare-content.mjs", root, other],
                { encoding: "utf8" },
            );
            assert.equal(result.status, 2);
            assert.match(result.stdout, /CHECK COMPARABILITY/);
            writeFileSync(join(other, "runs.json"), readFileSync(join(root, "runs.json")));
            writeFileSync(
                join(other, "manifest.json"),
                JSON.stringify({ ...manifest, tooling: { "devtools.mjs": "changed" } }),
            );
            const changed = spawnSync(
                process.execPath,
                ["tooling/evidence/compare-content.mjs", root, other],
                { encoding: "utf8" },
            );
            assert.equal(changed.status, 2);
        } finally {
            rmSync(other, { recursive: true });
        }
    } finally {
        rmSync(root, { recursive: true });
    }
});
