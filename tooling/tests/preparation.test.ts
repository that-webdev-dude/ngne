import assert from "node:assert/strict";
import test from "node:test";
import {
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Run, atomic } from "../core/run.js";
import { cleanEmission } from "../core/package.js";
import { copyPreparedBuild, verifyPrepared } from "../core/preparation.js";
import { hash, identities, contained } from "../evidence/identity.js";
import {
    header,
    readArtifacts,
    readManifest,
    readResult,
    type Prepared,
} from "../evidence/schema.js";

function temporary(t: { after: (fn: () => void) => void }): string {
    const root = mkdtempSync(join(tmpdir(), "ngne-preparation-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return root;
}
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));

async function prepared(root: string): Promise<Run> {
    const run = new Run(root, "test");
    await run.execute(() =>
        run.stage("fixture", async () => {
            const tree = (path: string, filename: string, content: string) => {
                mkdirSync(join(run.root, path), { recursive: true });
                writeFileSync(join(run.root, path, filename), content);
                return { path, files: identities(join(run.root, path)) };
            };
            const installed = tree(
                "work/installation/node_modules/ngne",
                "index.js",
                "export const answer = 42;\n",
            );
            const pkg = tree("evidence/package", "engine.tgz", "controlled package bytes");
            const workload = tree("work/installation/app", "index.ts", "import 'ngne';");
            const dependencies = tree(
                "work/dependencies",
                "package-lock.json",
                '{"lockfileVersion":3}',
            );
            writeFileSync(join(run.root, dependencies.path, "package.json"), '{"private":true}');
            dependencies.files = identities(join(run.root, dependencies.path));
            for (const file of Object.keys(dependencies.files))
                cpSync(
                    join(run.root, dependencies.path, file),
                    join(run.root, "work/installation", file),
                );
            const value: Prepared = {
                package: {
                    path: `${pkg.path}/engine.tgz`,
                    filename: "engine.tgz",
                    sha256: pkg.files["engine.tgz"],
                    files: installed.files,
                },
                installed,
                workload,
                dependencies,
                builds: {
                    root: tree("evidence/builds/root", "index.html", "root"),
                    nested: tree("evidence/builds/nested", "index.html", "nested"),
                },
                toolchain: { node: process.version, npm: "test", typescript: "test" },
                dependencyPolicy: "offline-lockfile-ci-no-scripts",
            };
            run.manifest.prepared = value;
            run.manifest.preparation = "prepared";
        }),
    );
    return run;
}

test("unique runs retain earlier evidence and reject reused explicit destinations", async (t) => {
    const root = temporary(t),
        first = await prepared(root),
        second = await prepared(root);
    assert.notEqual(first.root, second.root);
    assert.notEqual(first.manifest.runId, second.manifest.runId);
    assert.equal(verifyPrepared(join(first.evidence, "manifest.json")).runId, first.manifest.runId);
    assert.equal(
        verifyPrepared(join(second.evidence, "manifest.json")).runId,
        second.manifest.runId,
    );
    assert.throws(() => new Run(root, "test", first.root), /EEXIST/);
});

test("emission cleaning removes stale engine files while preserving showcase and unrelated outputs", (t) => {
    const root = temporary(t);
    mkdirSync(join(root, "dist/engine"), { recursive: true });
    writeFileSync(join(root, "dist/engine/stale.js"), "stale");
    writeFileSync(join(root, "dist/index.html"), "showcase");
    mkdirSync(join(root, "out"));
    writeFileSync(join(root, "out/keep"), "user");
    cleanEmission(root);
    assert.equal(existsSync(join(root, "dist/engine")), false);
    assert.equal(readFileSync(join(root, "dist/index.html"), "utf8"), "showcase");
    assert.equal(readFileSync(join(root, "out/keep"), "utf8"), "user");
});

test("linked emission and escaping or linked payloads are rejected", (t) => {
    const root = temporary(t),
        external = temporary(t);
    mkdirSync(join(root, "dist"));
    symlinkSync(external, join(root, "dist/engine"), "junction");
    assert.throws(() => cleanEmission(root), /Linked/);
    assert.throws(() => contained(root, "../outside"), /Unsafe/);
    assert.throws(() => contained(root, "C:/outside"), /Unsafe/);
    assert.throws(() => contained(root, "dist/engine"), /Linked/);
});

test("extracted identities match legacy content fixtures byte for byte", (t) => {
    const root = temporary(t);
    mkdirSync(join(root, "nested"));
    writeFileSync(join(root, "nested/b.bin"), Buffer.from([0, 1, 128, 255]));
    writeFileSync(join(root, "a.txt"), "content\r\n");
    // Frozen independently computed SHA-256 bytes preserve the original extraction oracle.
    assert.deepEqual(identities(root), {
        "a.txt": "fc06f48221d98ad6106c3845b33a2a41152482ab9e697f736ad26db4853fa657",
        "nested/b.bin": "0ff830e8c68aca18063bce54c3191d5c116a2dfe33249538b252746cb777ef10",
    });
});

test("policy raw samples and cleanup details survive stage recording and finalization", async (t) => {
    const run = new Run(temporary(t), "extraction");
    const policy = {
        version: 1,
        repetitions: 3,
        warmup: 12,
        retention: { maxEntries: 3, maxBytes: 1048576 },
        budgets: { p95Ms: 500 },
    };
    const samples = [
        { ms: 12.5, from: "first", to: "second", resources: { voices: 1 } },
        { ms: 9.25, from: "second", to: "first" },
    ];
    run.manifest.policy = policy;
    run.cleanup.push([
        "owned process",
        () => ({ resource: "test PID 123", attempts: ["graceful"], survivors: [] }),
    ]);
    await run.execute(() =>
        run.stage("sample", async () =>
            run.record("sample", "measurements", { samples, unit: "ms" }),
        ),
    );
    assert.deepEqual(read(join(run.evidence, "stages/sample/measurements.json")).samples, samples);
    assert.deepEqual(readManifest(read(join(run.evidence, "manifest.json"))).policy, policy);
    assert.deepEqual(readResult(read(join(run.evidence, "result.json"))).cleanupRecords[0].detail, {
        resource: "test PID 123",
        attempts: ["graceful"],
        survivors: [],
    });
});

test("scenario diagnostics and cleanup failures remain independent and all cleanup runs", async (t) => {
    const run = new Run(temporary(t), "failure");
    let last = false;
    run.cleanup.push(
        [
            "broken cleanup",
            () => {
                throw Error("cleanup broke");
            },
        ],
        [
            "remaining cleanup",
            () => {
                last = true;
            },
        ],
    );
    await run.execute(
        () =>
            run.stage("scenario", async () => {
                throw Error("scenario broke");
            }),
        async () => {
            throw Error("diagnostic broke");
        },
    );
    assert.equal(last, true);
    assert.deepEqual(
        run.result.failures.map((f) => f.kind),
        ["scenario", "diagnostic", "cleanup"],
    );
    assert.equal(run.result.evidence, "complete");
    assert.equal(run.result.cleanup, "failed");
    assert.equal(run.result.accepted, false);
    assert.match(readFileSync(join(run.evidence, "report.md"), "utf8"), /scenario broke/);
});

test("successful execution with failed cleanup never becomes accepted", async (t) => {
    const run = new Run(temporary(t), "cleanup");
    run.cleanup.push([
        "cleanup",
        () => {
            assert.equal(read(join(run.evidence, "result.json")).accepted, false);
            throw Error("survivor");
        },
    ]);
    await run.execute(() => run.stage("correct", async () => {}));
    assert.equal(run.result.execution, "completed");
    assert.equal(run.result.correctness, "passed");
    assert.equal(run.result.cleanup, "failed");
    assert.equal(run.result.accepted, false);
});

test("budget failure does not erase complete samples or correctness", async (t) => {
    const run = new Run(temporary(t), "budget");
    await run.execute(async () => {
        await run.stage("measurement", async () =>
            run.record("measurement", "measurements", { samples: [1, 2, 3] }),
        );
        run.result.stages[0].budgets = "failed";
    });
    assert.equal(run.result.execution, "completed");
    assert.equal(run.result.correctness, "passed");
    assert.equal(run.result.budgets, "failed");
    assert.equal(run.result.accepted, false);
    assert.deepEqual(
        read(join(run.evidence, "stages/measurement/measurements.json")).samples,
        [1, 2, 3],
    );
});

test("interrupted and early failed preparations retain readable partial provenance", async (t) => {
    const root = temporary(t),
        interrupted = new Run(root, "interrupted");
    assert.equal(readResult(read(join(interrupted.evidence, "result.json"))).evidence, "partial");
    assert.throws(() => verifyPrepared(join(interrupted.evidence, "manifest.json")));
    const run = new Run(root, "early");
    await run.execute(async () => {
        throw Error("no git metadata");
    });
    assert.equal(readManifest(read(join(run.evidence, "manifest.json"))).preparation, "failed");
    assert.equal(readResult(read(join(run.evidence, "result.json"))).execution, "failed");
    assert.equal(existsSync(join(run.evidence, "report.md")), true);
});

test("failed final evidence writing leaves nonaccepted partial results", async (t) => {
    const run = new Run(temporary(t), "write-failure");
    mkdirSync(join(run.evidence, "report.md"));
    await assert.rejects(run.execute(() => run.stage("check", async () => {})));
    const result = readResult(read(join(run.evidence, "result.json")));
    assert.equal(result.evidence, "partial");
    assert.equal(result.accepted, false);
    assert.equal(result.failures[0].kind, "evidence");
});

for (const target of ["package", "installed", "workload", "lock", "root", "nested"]) {
    test(`prepared handoff rejects changed ${target} bytes`, async (t) => {
        const run = await prepared(temporary(t)),
            p = run.manifest.prepared!;
        const paths: Record<string, string> = {
            package: p.package.path,
            installed: `${p.installed.path}/index.js`,
            workload: `${p.workload.path}/index.ts`,
            lock: "work/installation/package-lock.json",
            root: `${p.builds.root.path}/index.html`,
            nested: `${p.builds.nested.path}/index.html`,
        };
        writeFileSync(join(run.root, paths[target]), "tampered");
        assert.throws(() => verifyPrepared(join(run.evidence, "manifest.json")), /Changed/);
    });
}

test("disposable copy verifies identities first and never edits prepared builds", async (t) => {
    const root = temporary(t),
        run = await prepared(root),
        path = join(run.evidence, "manifest.json"),
        destination = join(root, "copy");
    copyPreparedBuild(path, "nested", destination);
    writeFileSync(join(destination, "index.html"), "fault injection");
    verifyPrepared(path);
    assert.throws(() => copyPreparedBuild(path, "root", destination), /EEXIST/);
    assert.throws(() => copyPreparedBuild(path, "root", join(run.root, "mutated")), /outside/);
});

test("added installation files and removed evidence payloads invalidate handoff", async (t) => {
    const run = await prepared(temporary(t)),
        manifest = join(run.evidence, "manifest.json");
    const extra = join(run.root, "work/installation/node_modules/ngne/extra.js");
    writeFileSync(extra, "stale");
    assert.throws(() => verifyPrepared(manifest), /Changed identities/);
    rmSync(extra);
    rmSync(join(run.evidence, "builds/nested/index.html"));
    assert.throws(() => verifyPrepared(manifest), /Changed evidence inventory/);
});

test("required stages not evaluated cannot produce successful acceptance", async (t) => {
    const run = new Run(temporary(t), "required");
    await run.execute(async () => {
        await run.stage("required", async () => {});
        run.result.stages[0].correctness = "not evaluated";
    });
    assert.equal(run.result.accepted, false);
    assert.equal(run.result.correctness, "not evaluated");
    assert.equal(readResult(read(join(run.evidence, "result.json"))).accepted, false);
});

test("runtime schemas reject unsupported versions missing fields and inconsistent success", async (t) => {
    const run = await prepared(temporary(t));
    assert.throws(() => readManifest({ ...run.manifest, schemaVersion: 2 }), /Unsupported/);
    assert.throws(() => readManifest({ ...run.manifest, environment: {} }), /string/);
    assert.throws(() => readResult({ ...run.result, cleanup: "failed" }), /acceptance/);
    assert.throws(
        () =>
            readArtifacts({
                ...header("artifacts", "id"),
                files: [{ path: "../escape", sha256: hash(""), bytes: 0 }],
            }),
        /Unsafe/,
    );
    assert.throws(
        () => readResult({ ...run.result, stages: [...run.result.stages, run.result.stages[0]] }),
        /Duplicate/,
    );
});

test("cross-document run mismatch and incomplete preparation cannot be handed off", async (t) => {
    const run = await prepared(temporary(t));
    atomic(join(run.evidence, "result.json"), { ...run.result, runId: "wrong" });
    assert.throws(() => verifyPrepared(join(run.evidence, "manifest.json")), /run ID/);
    atomic(join(run.evidence, "result.json"), run.result);
    atomic(join(run.evidence, "manifest.json"), { ...run.manifest, preparation: "running" });
    assert.throws(() => verifyPrepared(join(run.evidence, "manifest.json")), /Incomplete/);
});
