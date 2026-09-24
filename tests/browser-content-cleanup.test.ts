import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWithCleanup } from "./tooling/cleanup.mjs";

test("installed checks preserve workload and restore failures while attempting remaining cleanup", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ngne-content-cleanup-"));
    const content = join(directory, "content");
    mkdirSync(content);
    const first = join(content, "first.json"),
        second = join(content, "second.json");
    writeFileSync(first, "original first");
    writeFileSync(second, "original second");
    const commands: string[] = [];
    try {
        // Exercise the same shared unwinding primitive used by the browser runner.
        // A real filesystem restore fails; later restoration and script cleanup still run.
        const failures = await runWithCleanup(
            async () => {
                rmSync(first);
                mkdirSync(first);
                writeFileSync(second, "mutated second");
                throw new Error("original workload failure");
            },
            undefined,
            [
                [`restore ${first}`, () => writeFileSync(first, "original first")],
                [`restore ${second}`, () => writeFileSync(second, "original second")],
                [
                    "remove injected DevTools script",
                    async () => {
                        commands.push("Page.removeScriptToEvaluateOnNewDocument");
                        throw new Error("script cleanup failure");
                    },
                ],
            ],
        );
        assert.match(failures.join("; "), /original workload failure/);
        assert.match(failures.join("; "), /restore .*first.json/);
        assert.match(failures.join("; "), /script cleanup failure/);
        assert.equal(readFileSync(second, "utf8"), "original second");
        assert.equal(commands.at(-1), "Page.removeScriptToEvaluateOnNewDocument");
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
