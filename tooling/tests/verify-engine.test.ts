import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { verifyEngine } from "../commands/verify-engine.js";

test("Verification composition requires every command, retains failure logs and uses one exact preparation", async () => {
    const parent = resolve(".test-output/verification-composition");
    mkdirSync(parent, { recursive: true });
    const root = mkdtempSync(join(parent, "fixture-"));
    const fakeNpm = join(root, "npm.cjs");
    const originalNpm = process.env.npm_execpath;
    const originalArtifacts = process.env.NGNE_BROWSER_ARTIFACT_DIR;
    process.env.npm_execpath = fakeNpm;
    try {
        writeFileSync(fakeNpm, `console.log(JSON.stringify(process.argv.slice(2)));`);
        const passed = await verifyEngine(root);
        assert.equal(passed.result.accepted, true);
        assert.deepEqual(
            passed.result.stages.map((s) => s.id),
            [
                "format",
                "tests",
                "tooling-types",
                "migration",
                "types",
                "build",
                "browser-build",
                "prepare",
                "prepared",
                "transport",
                "installed",
                "browser",
            ],
        );
        const log = (id: string) =>
            readFileSync(join(passed.evidence, "stages", id, "logs/command.log"), "utf8");
        const manifest = join(passed.root, "preparation/evidence/manifest.json");
        assert(log("prepared").includes(JSON.stringify(manifest)));
        assert(log("installed").includes(JSON.stringify(manifest)));
        assert(log("prepare").includes(JSON.stringify(join(passed.root, "preparation"))));
        writeFileSync(fakeNpm, `console.error("required stage failed"); process.exitCode = 1;`);
        const failed = await verifyEngine(root);
        assert.notEqual(failed.root, passed.root);
        assert.equal(failed.result.accepted, false);
        assert.equal(failed.result.stages.length, 1);
        assert.equal(failed.result.stages[0].correctness, "failed");
        assert.equal(failed.result.cleanup, "passed");
        assert.match(
            readFileSync(join(failed.evidence, "stages/format/logs/command.log"), "utf8"),
            /required stage failed/,
        );
        process.env.npm_execpath = join(root, "missing.cjs");
        const missing = await verifyEngine(root);
        assert.equal(missing.result.accepted, false);
        assert.equal(missing.result.stages.length, 1);
        assert.equal(process.env.NGNE_BROWSER_ARTIFACT_DIR, originalArtifacts);
    } finally {
        if (originalNpm === undefined) delete process.env.npm_execpath;
        else process.env.npm_execpath = originalNpm;
    }
});
