import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserSession } from "../core/browser/session.js";
import { Run } from "../core/run.js";
import { readResult } from "../evidence/schema.js";
import { investigationCase } from "../suites/benchmarks/rendering/investigation-case.js";

function temporary(t: { after: (fn: () => void) => void }): string {
    const root = mkdtempSync(join(tmpdir(), "ngne-investigation-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return root;
}

for (const workloadFails of [false, true])
    for (const cleanupFails of [false, true])
        for (const recordFails of [false, true])
            test(`investigation preserves outcomes: workload=${workloadFails}, cleanup=${cleanupFails}, record=${recordFails}`, async (t) => {
                class RecordingRun extends Run {
                    override record(...args: Parameters<Run["record"]>) {
                        if (recordFails) throw Error("controlled measurement write cause");
                        super.record(...args);
                    }
                }
                const run = new RecordingRun(temporary(t), "investigation-test");
                const session = new BrowserSession();
                const visited: string[] = [];
                const workloadError = Error("controlled workload cause");
                const samples = [[1, 2, 3]];
                session.cleanup.push(
                    [
                        "browser terminate/verify",
                        () => {
                            visited.push("browser close");
                            if (cleanupFails) throw Error("controlled cleanup cause");
                        },
                    ],
                    [
                        "profile remove",
                        () => {
                            visited.push("profile remove");
                        },
                    ],
                );
                const result = await run.execute(async () => {
                    try {
                        const passed = await investigationCase(
                            run,
                            "r1-c1",
                            session,
                            async () => {
                                visited.push("workload");
                                if (workloadFails) throw workloadError;
                            },
                            () => {
                                visited.push("record");
                                return { samples, errors: [] };
                            },
                        );
                        if (!passed) return;
                        visited.push("next case");
                    } catch (error) {
                        assert.equal(error, workloadError);
                        throw error;
                    }
                });
                assert.deepEqual(visited, [
                    "workload",
                    "browser close",
                    "profile remove",
                    "record",
                    ...(!workloadFails && !cleanupFails && !recordFails ? ["next case"] : []),
                ]);
                // Final run cleanup and explicit repeated close must not repeat ownership effects.
                assert.equal(await session.close(), session.records);
                assert.equal(visited.filter((v) => v === "browser close").length, 1);
                assert.equal(result.execution, workloadFails ? "failed" : "completed");
                assert.equal(result.stages[0].execution, workloadFails ? "failed" : "completed");
                assert.equal(result.correctness, workloadFails ? "failed" : "passed");
                assert.equal(result.cleanup, cleanupFails ? "failed" : "passed");
                assert.equal(result.evidence, recordFails ? "partial" : "complete");
                assert.equal(result.accepted, !workloadFails && !cleanupFails && !recordFails);
                assert.deepEqual(result.failures, [
                    ...(recordFails
                        ? [
                              {
                                  kind: "evidence",
                                  message: "r1-c1 measurements: controlled measurement write cause",
                              },
                          ]
                        : []),
                    ...(workloadFails
                        ? [{ kind: "scenario", message: "controlled workload cause" }]
                        : []),
                    ...(cleanupFails
                        ? [
                              {
                                  kind: "cleanup",
                                  message:
                                      "r1-c1 browser terminate/verify: controlled cleanup cause",
                              },
                          ]
                        : []),
                ]);
                assert.deepEqual(
                    result.cleanupRecords.slice(0, 2),
                    session.records.map((record) => ({
                        ...record,
                        resource: `r1-c1 ${record.resource}`,
                    })),
                );
                assert.deepEqual(
                    readResult(JSON.parse(readFileSync(join(run.evidence, "result.json"), "utf8"))),
                    readResult(result),
                );
                const path = join(run.evidence, "stages/r1-c1/measurements.json");
                assert.equal(existsSync(path), !recordFails);
                if (!recordFails) {
                    const measurements = JSON.parse(readFileSync(path, "utf8"));
                    assert.deepEqual(measurements.samples, samples);
                    assert.deepEqual(
                        measurements.cleanup,
                        JSON.parse(JSON.stringify(session.records)),
                    );
                }
            });

test("a filesystem measurement write failure retains workload and cleanup causes in the final result", async (t) => {
    const run = new Run(temporary(t), "investigation-write-test");
    const session = new BrowserSession();
    session.cleanup.push([
        "browser terminate/verify",
        () => {
            throw Error("cleanup cause");
        },
    ]);
    const result = await run.execute(async () => {
        await investigationCase(
            run,
            "r1-c1",
            session,
            async () => {
                // Block only the measurement destination; final result publication remains available.
                mkdirSync(join(run.evidence, "stages/r1-c1/measurements.json"), {
                    recursive: true,
                });
                throw Error("workload cause");
            },
            () => ({ samples: [[1, 2, 3]] }),
        );
    });
    assert.equal(result.accepted, false);
    assert.equal(result.evidence, "partial");
    assert.equal(result.cleanup, "failed");
    assert.deepEqual(
        result.failures.map((f) => f.kind),
        ["evidence", "scenario", "cleanup"],
    );
    assert.match(result.failures[0].message, /r1-c1 measurements:.*(EPERM|EISDIR|EEXIST)/);
    assert.equal(result.failures[1].message, "workload cause");
    assert.equal(result.failures[2].message, "r1-c1 browser terminate/verify: cleanup cause");
    assert.deepEqual(
        readResult(JSON.parse(readFileSync(join(run.evidence, "result.json"), "utf8"))),
        readResult(result),
    );
});

test("investigation partial startup closes all owned resources exactly once", async (t) => {
    const run = new Run(temporary(t), "investigation-startup-test");
    const session = new BrowserSession();
    let laterCleanup = 0;
    session.cleanup.push([
        "later resource",
        () => {
            laterCleanup++;
        },
    ]);
    const result = await run.execute(async () => {
        await investigationCase(
            run,
            "r1-c1",
            session,
            async () => {
                await session.start({
                    executable: "ngne-nonexistent-investigation-browser",
                    startupMs: 200,
                    profileParent: join(run.root, "profiles"),
                });
            },
            () => ({ errors: [] }),
        );
        assert.fail("next case must not start");
    });
    assert.equal(result.execution, "failed");
    assert.equal(result.cleanup, "passed");
    assert.equal(result.accepted, false);
    assert.match(result.failures[0].message, /spawn|ENOENT/);
    assert(result.cleanupRecords.some((r) => r.resource === "r1-c1 browser terminate/verify"));
    assert(result.cleanupRecords.some((r) => r.resource === "r1-c1 temporary profile remove"));
    assert(session.profile);
    assert.equal(existsSync(session.profile), false);
    await session.close();
    assert.equal(laterCleanup, 1);
});

test("investigation waits for session closure before recording or starting the next case", async (t) => {
    const run = new Run(temporary(t), "investigation-order-test");
    const session = new BrowserSession();
    const visited: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    let closing!: () => void;
    const startedClosing = new Promise<void>((resolve) => {
        closing = resolve;
    });
    session.cleanup.push([
        "blocked close",
        async () => {
            visited.push("closing");
            closing();
            await gate;
            visited.push("closed");
        },
    ]);
    const execution = run.execute(async () => {
        const passed = await investigationCase(
            run,
            "r1-c1",
            session,
            async () => {
                visited.push("workload");
            },
            () => {
                visited.push("record");
                return {};
            },
        );
        if (passed) visited.push("next case");
    });
    await startedClosing;
    try {
        assert.deepEqual(visited, ["workload", "closing"]);
    } finally {
        release();
    }
    assert.equal((await execution).accepted, true);
    assert.deepEqual(visited, ["workload", "closing", "closed", "record", "next case"]);
});
