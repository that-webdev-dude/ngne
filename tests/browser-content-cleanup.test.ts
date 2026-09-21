import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkInstalledContent } from "./browser-content-checks.js";
import { failureText } from "./tooling/cleanup.mjs";

test("installed checks preserve workload and restore failures while attempting remaining cleanup", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ngne-content-cleanup-"));
    const content = join(directory, "content");
    mkdirSync(content);
    const town = join(content, "town.json"),
        dungeon = join(content, "dungeon.json");
    writeFileSync(town, "original town");
    writeFileSync(dungeon, "original dungeon");
    const commands: string[] = [];
    try {
        await assert.rejects(
            checkInstalledContent(
                {
                    async send(method) {
                        commands.push(method);
                        if (method === "Page.removeScriptToEvaluateOnNewDocument")
                            throw new Error("script cleanup failure");
                        return { identifier: "fixture" };
                    },
                    async evaluate<T>(): Promise<T> {
                        rmSync(town);
                        mkdirSync(town);
                        writeFileSync(dungeon, "mutated dungeon");
                        throw new Error("original workload failure");
                    },
                },
                "http://fixture/",
                directory,
                [],
                async () => {},
            ),
            (error: unknown) => {
                const message = failureText(error);
                assert.match(message, /original workload failure/);
                assert.match(message, /restore .*town.json/);
                assert.match(message, /script cleanup failure/);
                return true;
            },
        );
        assert.equal(readFileSync(dungeon, "utf8"), "original dungeon");
        assert.equal(commands.at(-1), "Page.removeScriptToEvaluateOnNewDocument");
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
