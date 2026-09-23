import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyDeclarationResolution } from "../core/fixture.js";
import { installed, readObservation } from "../suites/verification/browser/installed.js";
import { Run } from "../core/run.js";
import { serve } from "../core/server.js";

test("installed declarations reject aliases, inherited configuration and source fallback", (t) => {
    const root = mkdtempSync(join(tmpdir(), "ngne-resolution-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const app = join(root, "app"),
        engine = join(root, "node_modules/ngne");
    mkdirSync(app);
    mkdirSync(join(engine, "dist/engine"), { recursive: true });
    writeFileSync(
        join(engine, "package.json"),
        JSON.stringify({ name: "ngne", types: "dist/engine/index.d.ts" }),
    );
    writeFileSync(join(engine, "dist/engine/index.d.ts"), "export {};");
    const config = (value: object) =>
        writeFileSync(join(app, "tsconfig.json"), JSON.stringify(value));
    config({ compilerOptions: { moduleResolution: "NodeNext" } });
    assert.doesNotThrow(() => verifyDeclarationResolution(app));
    for (const value of [
        { extends: "../../tsconfig.json" },
        { compilerOptions: { paths: { ngne: ["../../src/index.ts"] } } },
        { compilerOptions: { baseUrl: "../../" } },
    ]) {
        config(value);
        assert.throws(() => verifyDeclarationResolution(app), /source aliases/);
    }
    config({ compilerOptions: { moduleResolution: "NodeNext" } });
    writeFileSync(join(engine, "package.json"), JSON.stringify({ types: "source.d.ts" }));
    writeFileSync(join(engine, "source.d.ts"), "export {};");
    assert.throws(() => verifyDeclarationResolution(app), /outside isolated/);
});

test("browser observation retains early failures and rejects malformed reports", () => {
    const failure = {
        status: "failed",
        passed: [],
        failures: ["decode failed"],
        environment: {},
        samples: {},
    };
    assert.deepEqual(readObservation(failure), failure);
    for (const value of [
        null,
        {},
        { ...failure, status: "idle" },
        { ...failure, failures: [42] },
        { ...failure, passed: "success" },
    ])
        assert.throws(() => readObservation(value));
});

test("invalid exact preparation fails before browser startup and retains a terminal result", async (t) => {
    const root = mkdtempSync(join(tmpdir(), "ngne-invalid-prepared-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const run = await installed(root, join(root, "missing/evidence/manifest.json"));
    assert.equal(run.result.accepted, false);
    assert.equal(run.result.execution, "failed");
    assert.equal(run.result.cleanup, "passed");
    assert.deepEqual(
        run.result.stages.map((stage) => stage.id),
        ["preparation"],
    );
    assert.equal(run.result.failures[0].kind, "scenario");
});

test("installed server enforces nested base without source or SPA fallback and closes", async (t) => {
    const root = mkdtempSync(join(tmpdir(), "ngne-server-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const build = join(root, "build");
    mkdirSync(build);
    writeFileSync(join(build, "index.html"), "installed fixture");
    writeFileSync(join(root, "secret.txt"), "outside");
    const run = new Run(root, "server");
    let url = "";
    await run.execute(() =>
        run.stage("serve", async () => {
            url = await serve(run, build, "/nested/");
            assert.equal(await (await fetch(url)).text(), "installed fixture");
            for (const path of ["missing", "../secret.txt", "../", "%2e%2e%2fsecret.txt"])
                assert.equal((await fetch(url + path)).status, 404);
        }),
    );
    assert.equal(run.result.accepted, true);
    assert.equal(run.result.cleanupRecords[0].status, "passed");
    await assert.rejects(fetch(url));
});
