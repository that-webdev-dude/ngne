import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    renameSync,
    writeFileSync,
    existsSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import {
    atomic,
    createAtomicWriter,
    EvidenceWriteError,
    type AtomicWriter,
} from "../core/atomic.js";
import { Run } from "../core/run.js";
import { failureText } from "../core/cleanup.mjs";
import { hash, verifyArtifactInventory } from "../evidence/identity.js";
import { readArtifacts, readResult } from "../evidence/schema.js";
import { loadBenchmarkRun } from "../evidence/benchmark-results.js";
import { measured } from "./fixtures/benchmark-evidence.js";

// Retained, isolated fixtures also provide inspectable fault-injection evidence.
function directory() {
    const parent = resolve(".test-output/evidence-writer");
    mkdirSync(parent, { recursive: true });
    return mkdtempSync(join(parent, "case-"));
}
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const fault = (code: string) => Object.assign(new Error(`Injected ${code}`), { code });
const temporaryFiles = (path: string) => readdirSync(path).filter((name) => name.endsWith(".tmp"));
const delays = [20, 40, 80, 160, 200];

for (const code of ["EPERM", "EBUSY"]) {
    test(`Windows ${code} replacement recovers using one temporary file`, () => {
        const root = directory(),
            destination = join(root, "result.json");
        writeFileSync(destination, '{"old":true}');
        const waits: number[] = [],
            sources: string[] = [];
        const writer = createAtomicWriter({
            platform: "win32",
            wait: (ms) => {
                waits.push(ms);
            },
            rename: (source, target) => {
                sources.push(String(source));
                assert.deepEqual(read(destination), { old: true });
                if (sources.length < 6) throw fault(code);
                renameSync(source, target);
            },
        });
        writer(destination, { new: true });
        assert.deepEqual(waits, delays);
        assert.equal(new Set(sources).size, 1);
        assert.deepEqual(read(destination), { new: true });
        assert.deepEqual(temporaryFiles(root), []);
    });
}

for (const [platform, code, attempts] of [
    ["win32", "EPERM", 6],
    ["win32", "EBUSY", 6],
    ["win32", "ENOENT", 1],
    ["win32", "ENOSPC", 1],
    ["win32", "EACCES", 1],
    ["linux", "EPERM", 1],
] as const) {
    test(`${platform} persistent ${code} stops after ${attempts} rename attempts`, () => {
        const root = directory(),
            destination = join(root, "result.json");
        writeFileSync(destination, '{"old":true}');
        let calls = 0;
        const waits: number[] = [];
        const cause = fault(code);
        const writer = createAtomicWriter({
            platform,
            wait: (ms) => {
                waits.push(ms);
            },
            rename: () => {
                calls++;
                throw cause;
            },
        });
        assert.throws(
            () => writer(destination, { replacement: true }),
            (error) => {
                assert(error instanceof EvidenceWriteError);
                assert.equal(error.cause, cause);
                assert.match(error.message, /Evidence rename failed/);
                assert(error.message.includes(destination));
                assert(error.message.includes(`code=${code}; rename attempts=${attempts}`));
                return true;
            },
        );
        assert.equal(calls, attempts);
        assert.deepEqual(waits, attempts === 6 ? delays : []);
        assert.deepEqual(read(destination), { old: true });
        assert.deepEqual(temporaryFiles(root), []);
    });
}

test("partial write failure closes and removes its temporary file without retrying", () => {
    const root = directory(),
        destination = join(root, "result.json");
    writeFileSync(destination, '{"old":true}');
    let writes = 0;
    const writer = createAtomicWriter({
        write: (file) => {
            writes++;
            writeFileSync(file, "partial");
            throw fault("ENOSPC");
        },
        rename: () => assert.fail("Must not rename a partial write"),
        wait: () => assert.fail("Must not retry writes"),
    });
    assert.throws(() => writer(destination, {}), /Evidence write failed.*ENOSPC/);
    assert.equal(writes, 1);
    assert.deepEqual(read(destination), { old: true });
    assert.deepEqual(temporaryFiles(root), []);
});

test("serialization and exclusive-create failures never delete an unowned path", () => {
    const destination = join(directory(), "result.json");
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const writer = createAtomicWriter({
        open: () => {
            throw fault("EEXIST");
        },
        unlink: () => assert.fail("No owned temporary file"),
        wait: () => assert.fail("No eligible rename"),
    });
    assert.throws(() => writer(destination, circular), /Evidence serialize failed/);
    assert.throws(() => writer(destination, {}), /Evidence create failed.*EEXIST/);
});

test("recovered publication commits acceptance last with exact artifact hashes and no temporary files", async () => {
    const root = directory(),
        waits: number[] = [],
        targets: string[] = [];
    let injected = false;
    const writer = createAtomicWriter({
        platform: "win32",
        wait: (ms) => {
            waits.push(ms);
        },
        rename: (source, target) => {
            targets.push(basename(String(target)));
            const next = read(String(source));
            if (next.documentType === "result" && next.accepted) {
                assert.equal(read(String(target)).accepted, false);
                assert(existsSync(join(root, "run/evidence/artifacts.json")));
                if (!injected) {
                    injected = true;
                    throw fault("EPERM");
                }
            }
            renameSync(source, target);
        },
    });
    const run = new Run(root, "writer-test", join(root, "run"), writer);
    await run.execute(() =>
        run.stage("sample", async () => {
            run.record("sample", "measurements", { samples: [1, 2, 3] });
        }),
    );
    assert.equal(run.result.accepted, true);
    assert.equal(readResult(read(join(run.evidence, "result.json"))).accepted, true);
    assert.deepEqual(waits, [20]);
    assert.equal(targets.at(-1), "result.json");
    const inventory = readArtifacts(read(join(run.evidence, "artifacts.json")));
    verifyArtifactInventory(
        run.evidence,
        inventory.files.map((f) => f.path),
    );
    for (const file of inventory.files) {
        const bytes = readFileSync(join(run.evidence, file.path));
        assert.equal(file.bytes, bytes.length);
        assert.equal(file.sha256, hash(bytes));
        assert(!file.path.endsWith(".tmp"));
    }
});

for (const phase of [
    "initial",
    "stage-start",
    "record",
    "stage-end",
    "pre-final",
    "manifest",
    "inventory",
    "acceptance",
] as const) {
    test(`persistent ${phase} publication failure cannot be accepted or reused`, async () => {
        const root = directory();
        let armed = phase === "initial",
            resultWrites = 0,
            manifestWrites = 0;
        let cleanup = false,
            action = false;
        const writer: AtomicWriter = (path, value) => {
            const name = basename(path);
            if (name === "result.json") resultWrites++;
            if (name === "manifest.json") manifestWrites++;
            const fail =
                armed &&
                (phase === "initial" ||
                    phase === "stage-start" ||
                    phase === "stage-end" ||
                    (phase === "record" && name === "measurements.json") ||
                    (phase === "pre-final" && resultWrites === 4) ||
                    (phase === "manifest" && manifestWrites === 5) ||
                    (phase === "inventory" && name === "artifacts.json") ||
                    (phase === "acceptance" &&
                        typeof value === "object" &&
                        value !== null &&
                        "accepted" in value &&
                        value.accepted === true));
            if (fail) throw fault("ENOSPC");
            atomic(path, value);
        };
        if (phase === "initial") {
            assert.throws(
                () => new Run(root, "writer-test", join(root, "run"), writer),
                /Evidence publication failed.*ENOSPC/,
            );
            assert(!existsSync(join(root, "run/evidence/artifacts.json")));
            return;
        }
        const run = new Run(root, "writer-test", join(root, "run"), writer);
        run.cleanup.push([
            "owned fixture",
            () => {
                cleanup = true;
            },
        ]);
        const execute = run.execute(() => {
            if (phase === "stage-start") armed = true;
            return run.stage("sample", async () => {
                action = true;
                if (phase === "record") {
                    armed = true;
                    run.record("sample", "measurements", {});
                }
                if (phase === "stage-end") armed = true;
                if (["pre-final", "manifest", "inventory", "acceptance"].includes(phase))
                    armed = true;
            });
        });
        if (["stage-start", "stage-end"].includes(phase)) await assert.rejects(execute);
        else if (phase === "record") await execute;
        else await assert.rejects(execute);
        assert.equal(cleanup, true);
        assert.equal(action, phase !== "stage-start");
        assert.equal(run.result.accepted, false);
        assert.equal(run.result.evidence, "partial");
        assert(run.result.failures.some((f) => f.kind === "evidence"));
        assert.equal(readResult(read(join(run.evidence, "result.json"))).accepted, false);
        await assert.rejects(
            run.execute(async () => {}),
            /already finalized/,
        );
    });
}

test("scenario, diagnostic, cleanup, publication and fallback failures all survive", async () => {
    const root = directory();
    let armed = false,
        finalCleanup = false;
    const run = new Run(root, "writer-test", join(root, "run"), (path, value) => {
        if (armed) throw Error(`Injected publication ${basename(path)}`);
        atomic(path, value);
    });
    run.cleanup.push(
        [
            "broken cleanup",
            () => {
                throw Error("original cleanup");
            },
        ],
        [
            "last cleanup",
            () => {
                finalCleanup = true;
            },
        ],
    );
    await assert.rejects(
        run.execute(
            () =>
                run.stage("sample", async () => {
                    armed = true;
                    throw Error("original scenario");
                }),
            async () => {
                throw Error("original diagnostic");
            },
        ),
        (error) => {
            const text = failureText(error);
            for (const message of [
                "original scenario",
                "original diagnostic",
                "original cleanup",
                "publication manifest.json",
                "publication result.json",
            ])
                assert(text.includes(message), text);
            return true;
        },
    );
    assert(finalCleanup);
    assert.equal(run.result.cleanup, "failed");
    assert.equal(run.result.evidence, "partial");
    assert.equal(run.result.accepted, false);
    assert(
        run.result.failures.some((f) => f.kind === "scenario" && f.message === "original scenario"),
    );
});

test("the benchmark reader accepts intact evidence and rejects failed final publication and fallback", async () => {
    for (const failure of ["none", "replacement", "fallback", "temporary-cleanup"]) {
        const root = directory();
        let publicationFailed = false;
        const writer = createAtomicWriter({
            platform: "win32",
            wait: () => {},
            rename: (source, target) => {
                if (basename(String(target)) === "result.json") {
                    if (failure !== "none" && read(String(source)).accepted) {
                        publicationFailed = true;
                        throw fault("EPERM");
                    }
                    if (failure === "fallback" && publicationFailed) throw fault("EPERM");
                }
                renameSync(source, target);
            },
            ...(failure === "temporary-cleanup"
                ? {
                      unlink: () => {
                          throw fault("EACCES");
                      },
                  }
                : {}),
        });
        const run = new Run(root, "benchmarks", join(root, "run"), writer);
        run.manifest.policy = {
            parameters: { workload: "churn", diagnostics: false },
            hardware: { cpu: ["fixture"] },
            retention: { mode: "full" },
        };
        const execution = run.execute(() => measured(run));
        if (failure === "none") {
            await execution;
            assert.equal(loadBenchmarkRun(run.root, "candidate").manifest.status, "passed");
        } else {
            await assert.rejects(execution, /Evidence publication failed/);
            assert.equal(run.result.accepted, false);
            assert.equal(readResult(read(join(run.evidence, "result.json"))).accepted, false);
            assert.throws(
                () => loadBenchmarkRun(run.root, "candidate"),
                /Changed artifact|Incomplete benchmark evidence|Changed evidence inventory/,
            );
            assert.equal(temporaryFiles(run.evidence).length > 0, failure === "temporary-cleanup");
            if (failure === "temporary-cleanup") assert.equal(run.result.cleanup, "failed");
        }
    }
});

test("initial publication failure retains a readable failed result when fallback succeeds", () => {
    const root = directory();
    let first = true;
    const writer: AtomicWriter = (path, value) => {
        if (first) {
            first = false;
            throw fault("ENOSPC");
        }
        atomic(path, value);
    };
    assert.throws(
        () => new Run(root, "writer-test", join(root, "run"), writer),
        /Evidence publication failed/,
    );
    const result = readResult(read(join(root, "run/evidence/result.json")));
    assert.equal(result.execution, "failed");
    assert.equal(result.evidence, "partial");
    assert.equal(result.accepted, false);
    assert.equal(result.cleanup, "pending");
    assert.equal(result.failures[0].kind, "evidence");
});

test("unrelated and empty scenario aggregates retain their original context", async () => {
    for (const causes of [[], [Error("inner cause")]]) {
        const run = new Run(directory(), "writer-test");
        await run.execute(() =>
            run.stage("sample", async () => {
                throw new AggregateError(causes, "original aggregate");
            }),
        );
        assert.equal(run.result.execution, "failed");
        assert.equal(run.result.failures.length, 1);
        assert.match(run.result.failures[0].message, /original aggregate/);
    }
});

for (const progressFails of [false, true])
    test(`caller aggregate retains context around an evidence error; progress failure=${progressFails}`, async () => {
        const root = directory();
        let failProgress = false;
        let original: AggregateError | undefined;
        const run = new Run(root, "writer-test", join(root, "run"), (path, value) => {
            if (basename(path) === "measurements.json") throw fault("ENOSPC");
            if (failProgress && basename(path) === "manifest.json") {
                failProgress = false;
                throw Error("additional progress write failure");
            }
            atomic(path, value);
        });
        await run.execute(() =>
            run.stage("sample", async () => {
                try {
                    run.record("sample", "measurements", {});
                } catch (error) {
                    failProgress = progressFails;
                    original = new AggregateError(
                        [error],
                        "Original workload failed; measurement capture also failed",
                    );
                    throw original;
                }
            }),
        );
        assert(original);
        const scenarios = run.result.failures.filter((f) => f.kind === "scenario");
        assert.deepEqual(scenarios, [{ kind: "scenario", message: failureText(original) }]);
        assert.equal(
            run.result.failures.filter((f) => f.kind === "evidence").length,
            progressFails ? 2 : 1,
        );
        const persisted = readResult(read(join(run.evidence, "result.json")));
        assert.deepEqual(persisted.failures, run.result.failures);
        assert.equal(persisted.execution, "failed");
        assert.equal(persisted.evidence, "partial");
        assert.equal(persisted.accepted, false);
    });

for (const priorStage of [false, true])
    for (const destination of ["manifest.json", "result.json"])
        test(`stage-start failure leaves correctness unevaluated; prior stage=${priorStage}, destination=${destination}`, async () => {
            const root = directory();
            let failStart = false,
                invoked = false,
                cleaned = false;
            const run = new Run(root, "writer-test", join(root, "run"), (path, value) => {
                if (failStart && basename(path) === destination) {
                    failStart = false;
                    throw fault("ENOSPC");
                }
                atomic(path, value);
            });
            run.cleanup.push([
                "owned fixture",
                () => {
                    cleaned = true;
                },
            ]);
            await run.execute(async () => {
                if (priorStage) await run.stage("previous", async () => {});
                failStart = true;
                await run.stage("skipped", async () => {
                    invoked = true;
                });
            });
            assert.equal(invoked, false);
            assert.equal(cleaned, true);
            const persisted = readResult(read(join(run.evidence, "result.json")));
            assert.equal(persisted.stages.at(-1)?.execution, "failed");
            assert.equal(persisted.stages.at(-1)?.correctness, "not evaluated");
            assert.equal(persisted.correctness, "not evaluated");
            assert.equal(persisted.execution, "failed");
            assert.equal(persisted.cleanup, "passed");
            assert.equal(persisted.evidence, "partial");
            assert.equal(persisted.accepted, false);
            assert.deepEqual(
                persisted.failures.map((f) => f.kind),
                ["evidence"],
            );
        });

test("a caught stage failure preserves independent run execution and correctness", async () => {
    const run = new Run(directory(), "writer-test");
    await run.execute(async () => {
        await assert.rejects(
            run.stage("sample", async () => {
                throw Error("handled scenario");
            }),
        );
    });
    assert.equal(run.result.execution, "completed");
    assert.equal(run.result.correctness, "failed");
    assert.equal(run.result.accepted, false);
});

test("temporary cleanup failure stays visible even when the caller catches the write error", async () => {
    const root = directory();
    let armed = false;
    const writer = createAtomicWriter({
        rename: (source, target) => {
            if (armed) throw fault("ENOENT");
            renameSync(source, target);
        },
        unlink: () => {
            throw Error("temporary removal denied");
        },
    });
    const run = new Run(root, "writer-test", join(root, "run"), writer);
    await run.execute(() =>
        run.stage("sample", async () => {
            armed = true;
            assert.throws(() => run.record("sample", "measurements", {}), /Evidence rename failed/);
            armed = false;
        }),
    );
    assert.equal(run.result.accepted, false);
    assert.equal(run.result.cleanup, "failed");
    assert.equal(run.result.evidence, "partial");
    assert(
        run.result.cleanupRecords.some(
            (f) => f.status === "failed" && f.error?.includes("temporary removal denied"),
        ),
    );
    assert.equal(readResult(read(join(run.evidence, "result.json"))).cleanup, "failed");
});

test(
    "Windows deny-delete handle demonstrates bounded native replacement recovery",
    { skip: process.platform !== "win32", timeout: 20_000 },
    async () => {
        const root = directory(),
            destination = join(root, "result.json"),
            release = join(root, "release");
        writeFileSync(destination, '{"old":true}');
        const child = spawn(
            "powershell.exe",
            [
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "$stream = [IO.File]::Open($env:NGNE_WRITER_LOCK_PATH, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite); try { [Console]::WriteLine('ready'); $end = [DateTime]::UtcNow.AddSeconds(10); while (![IO.File]::Exists($env:NGNE_WRITER_RELEASE_PATH) -and [DateTime]::UtcNow -lt $end) { Start-Sleep -Milliseconds 5 } } finally { $stream.Dispose() }",
            ],
            {
                windowsHide: true,
                env: {
                    ...process.env,
                    NGNE_WRITER_LOCK_PATH: destination,
                    NGNE_WRITER_RELEASE_PATH: release,
                },
                stdio: ["ignore", "pipe", "pipe"],
            },
        );
        const closed = once(child, "close");
        const errors: Buffer[] = [];
        child.stderr.on("data", (data) => errors.push(data));
        const codes: string[] = [],
            waits: number[] = [];
        try {
            const [ready] = await Promise.race([
                once(child.stdout, "data"),
                closed.then(() => {
                    throw Error(`Lock holder exited: ${Buffer.concat(errors)}`);
                }),
            ]);
            assert.equal(String(ready).trim(), "ready");
            const writer = createAtomicWriter({
                rename: (source, target) => {
                    try {
                        renameSync(source, target);
                    } catch (error) {
                        if (error instanceof Error && "code" in error)
                            codes.push(String(error.code));
                        throw error;
                    }
                },
                wait: (ms) => {
                    waits.push(ms);
                    writeFileSync(release, "release");
                    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
                },
            });
            writer(destination, { recovered: true });
            assert(codes.length > 0);
            assert(codes.every((code) => ["EPERM", "EBUSY"].includes(code)));
            assert(waits.reduce((a, b) => a + b, 0) <= 500);
            assert.deepEqual(read(destination), { recovered: true });
            assert.deepEqual(temporaryFiles(root), []);
            console.log(
                JSON.stringify({
                    nativeReplacement: {
                        platform: process.platform,
                        node: process.version,
                        codes,
                        waits,
                    },
                }),
            );
        } finally {
            writeFileSync(release, "release");
            const [exit] = await closed;
            assert.equal(exit, 0, Buffer.concat(errors).toString());
        }
    },
);
