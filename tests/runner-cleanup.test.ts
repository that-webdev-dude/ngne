import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { runWithCleanup, ownProcess, shutdownProcessTree } from "./tooling/cleanup.mjs";

test("workload, screenshot and cleanup failures remain visible and later cleanup runs", async () => {
    const visited: string[] = [],
        records: object[] = [];
    const failures = await runWithCleanup(
        async () => {
            throw new Error("original validation failure");
        },
        async () => {
            throw new Error("screenshot failed");
        },
        [
            [
                "browser PID 123 terminate",
                () => {
                    throw new Error("surviving PID 123");
                },
            ],
            ["preview", () => visited.push("preview")],
            ["profile", () => visited.push("profile")],
        ],
        records,
    );
    assert.deepEqual(visited, ["preview", "profile"]);
    assert.equal(failures.length, 3);
    assert.match(
        failures.join(";"),
        /original validation failure.*screenshot failed.*browser PID 123 terminate.*surviving PID 123/,
    );
    assert.equal(records.length, 3);
});

test("successful validation is rejected when cleanup fails", async () => {
    let diagnosed = false;
    const failures = await runWithCleanup(
        async () => {},
        async () => {
            diagnosed = true;
        },
        [
            [
                "profile remove",
                () => {
                    throw new Error("locked");
                },
            ],
        ],
    );
    assert.equal(diagnosed, false);
    assert.deepEqual(failures, ["profile remove: locked"]);
});

test("partial startup still runs every applicable cleanup step", async () => {
    let preview = false,
        profile = false;
    const failures = await runWithCleanup(
        async () => {
            throw new Error("browser spawn ENOENT");
        },
        undefined,
        [
            ["unopened socket", () => {}],
            [
                "preview",
                () => {
                    preview = true;
                },
            ],
            [
                "profile",
                () => {
                    profile = true;
                },
            ],
        ],
    );
    assert.equal(preview && profile, true);
    assert.deepEqual(failures, ["browser spawn ENOENT"]);
});

test("shutdown escalates, verifies survivors, and records failed actions", async () => {
    let now = 0,
        alive = true;
    const actions: string[] = [];
    const result = await shutdownProcessTree({
        resource: "fixture",
        survivors: async () => (alive ? [42] : []),
        signal: async (action: string) => {
            actions.push(action);
            if (action === "force") alive = false;
            else throw new Error("ignored TERM");
        },
        graceMs: 200,
        forceMs: 200,
        now: () => now,
        delay: async (ms: number) => {
            now += ms;
        },
    });
    assert.deepEqual(actions, ["terminate", "force"]);
    assert.deepEqual(result.survivors, []);
    assert.match(result.attempts[0], /ignored TERM/);
    await assert.rejects(
        shutdownProcessTree({
            resource: "fixture",
            survivors: async () => [42],
            signal: async () => {},
            graceMs: 200,
            forceMs: 200,
            now: () => now,
            delay: async (ms: number) => {
                now += ms;
            },
        }),
        /fixture.*terminate, force.*surviving PID\(s\): 42/,
    );
});

test(
    "owned process tree exits while an unrelated process remains alive",
    { timeout: 60_000 },
    async () => {
        const options = {
            detached: process.platform !== "win32",
            stdio: ["ignore", "pipe", "pipe"] as const,
            windowsHide: true,
        };
        const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], options);
        const unrelatedOwner = ownProcess(unrelated, "unrelated fixture");
        const child = spawn(
            process.execPath,
            [
                "-e",
                `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log(child.pid); setInterval(()=>{},1000);`,
            ],
            options,
        );
        const owner = ownProcess(child, "tree fixture");
        try {
            const [data] = await once(child.stdout!, "data");
            const grandchild = Number(String(data).trim());
            assert(grandchild > 0);
            const result = await owner.stop();
            assert.deepEqual(result.survivors, []);
            assert.throws(() => process.kill(grandchild, 0));
            assert.equal(process.kill(unrelated.pid!, 0), true);
            assert.deepEqual(await owner.stop(), result);
        } finally {
            await owner.stop();
            await unrelatedOwner.stop();
        }
    },
);

test("failed spawn has no process to terminate", async () => {
    const child = spawn("ngne-deliberately-missing-executable", [], { windowsHide: true });
    const owner = ownProcess(child, "missing browser");
    await new Promise((resolve) => child.once("close", resolve));
    assert.throws(() => owner.check(), /spawn failed/);
    assert.deepEqual((await owner.stop()).survivors, []);
});
