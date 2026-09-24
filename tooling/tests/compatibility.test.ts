import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { Run } from "../core/run.js";
import { identities } from "../evidence/identity.js";
import { compatibility, selectConsumer } from "../suites/compatibility.js";

const repository = resolve(".");
const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
function fixture(
    t: { after(fn: () => void): void },
    mode = "success",
    name = "arbitrary-consumer",
) {
    const root = mkdtempSync(join(tmpdir(), "ngne-compatibility-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const checkout = join(root, name);
    mkdirSync(checkout);
    const loader = pathToFileURL(join(repository, "node_modules/tsx/dist/loader.mjs")).href;
    writeFileSync(
        join(checkout, "package.json"),
        JSON.stringify({
            name,
            private: true,
            type: "module",
            scripts: { "verify:engine": `node --import "${loader}" peer.mjs` },
        }),
    );
    writeFileSync(join(checkout, "package-lock.json"), '{"lockfileVersion":3}');
    writeFileSync(
        join(checkout, "peer.mjs"),
        `
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { consumer, stub, inventory } from ${JSON.stringify(pathToFileURL(join(repository, "tooling/tests/fixtures/consumer-contract-v1/stub.ts")).href)};
const git = (...args) => execFileSync('git', args, {encoding:'utf8'}).trim();
const paths = git('ls-files').split('\\n');
const digest = p => createHash('sha256').update(readFileSync(p)).digest('hex');
consumer.revision = git('rev-parse', 'HEAD');
consumer.source = Object.fromEntries(paths.filter(p => p !== 'package-lock.json').map(p => [p,digest(p)]));
consumer.lock = {'package-lock.json':digest('package-lock.json')};
const args = process.argv.slice(2), mode = ${JSON.stringify(mode)};
if (mode === 'missing') { console.error('original failure before publication'); process.exit(2); }
const code = stub(args, mode === 'failed');
const output = args[args.indexOf('--output')+1], runId = args[args.indexOf('--run-id')+1];
if (mode === 'corrupt') {
  const file = join(output,'evidence/manifest.json');
  const manifest = JSON.parse(readFileSync(file)); manifest.consumer.revision = 'wrong';
  writeFileSync(file,JSON.stringify(manifest)); inventory(join(output,'evidence'),runId);
}
if (mode === 'mutate') writeFileSync('package-lock.json','changed');
process.exitCode = code;
`,
    );
    git(checkout, "init", "--quiet");
    git(checkout, "add", ".");
    git(
        checkout,
        "-c",
        "user.name=Protocol Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "Synthetic consumer",
    );
    return { root, checkout, revision: git(checkout, "rev-parse", "HEAD").trim() };
}

// A valid synthetic preparation tests orchestration, not actual engine installation.
async function preparation(root: string) {
    const run = new Run(root, "synthetic-preparation");
    await run.execute(() =>
        run.stage("synthetic", async () => {
            const tree = (path: string, files: Record<string, string>) => {
                mkdirSync(join(run.root, path), { recursive: true });
                for (const [name, bytes] of Object.entries(files))
                    writeFileSync(join(run.root, path, name), bytes);
                return { path, files: identities(join(run.root, path)) };
            };
            const installed = tree("work/app/node_modules/ngne", { "index.js": "synthetic" });
            const pkg = tree("evidence/package", { "synthetic.tgz": "synthetic package" });
            const dependencies = tree("work/dependencies", {
                "package.json": "{}",
                "package-lock.json": "{}",
            });
            for (const name of Object.keys(dependencies.files))
                cpSync(join(run.root, dependencies.path, name), join(run.root, "work/app", name));
            run.manifest.prepared = {
                package: {
                    path: "evidence/package/synthetic.tgz",
                    filename: "synthetic.tgz",
                    sha256: pkg.files["synthetic.tgz"],
                    files: installed.files,
                },
                installed,
                dependencies,
                workload: tree("work/app/source", { "index.ts": "synthetic" }),
                builds: {
                    root: tree("evidence/builds/root", { "index.html": "root" }),
                    nested: tree("evidence/builds/nested", { "index.html": "nested" }),
                },
                toolchain: { node: process.version, npm: "synthetic", typescript: "synthetic" },
                dependencyPolicy: "offline-lockfile-ci-no-scripts",
            };
            run.manifest.preparation = "prepared";
        }),
    );
    return join(run.evidence, "manifest.json");
}

test("consumer selection rejects missing pins, dirty inputs and nested checkout paths", (t) => {
    const f = fixture(t);
    assert.equal(selectConsumer(f.checkout, f.revision).revision, f.revision);
    assert.throws(() => selectConsumer(f.checkout, "HEAD"), /pinned commit/);
    mkdirSync(join(f.checkout, "nested"));
    assert.throws(() => selectConsumer(join(f.checkout, "nested"), f.revision), /checkout root/);
    writeFileSync(join(f.checkout, "untracked"), "input");
    assert.throws(() => selectConsumer(f.checkout, f.revision), /clean/);
});

test("compatibility selects unrelated synthetic consumers and retains separate successful runs", async (t) => {
    for (const name of ["synthetic-alpha", "synthetic-beta"]) {
        const f = fixture(t, "success", name),
            manifest = await preparation(f.root);
        const run = await compatibility(repository, {
            consumer: f.checkout,
            revision: f.revision,
            manifest,
            output: join(f.root, "run"),
        });
        assert.equal(run.result.accepted, true, JSON.stringify(run.result.failures));
        assert.equal(run.result.cleanup, "passed");
        assert.equal(run.manifest.policy.consumer && typeof run.manifest.policy.consumer, "object");
        assert.ok(run.manifest.harness["tooling/evidence/consumer-contract-v1.ts"]);
        const second = await compatibility(repository, {
            consumer: f.checkout,
            revision: f.revision,
            manifest,
            output: join(f.root, "second"),
        });
        assert.equal(second.result.accepted, true, JSON.stringify(second.result.failures));
        assert.notEqual(second.manifest.policy.childRunId, run.manifest.policy.childRunId);
        await assert.rejects(
            compatibility(repository, {
                consumer: f.checkout,
                revision: f.revision,
                manifest,
                output: run.root,
            }),
            /EEXIST/,
        );
    }
});

test("compatibility preserves nonzero failures and rejects zero-exit identity drift and input mutation", async (t) => {
    for (const mode of ["failed", "missing", "corrupt", "mutate"]) {
        const f = fixture(t, mode),
            manifest = await preparation(f.root);
        const run = await compatibility(repository, {
            consumer: f.checkout,
            revision: f.revision,
            manifest,
            output: join(f.root, "run"),
        });
        assert.equal(run.result.accepted, false);
        assert.equal(run.result.cleanup, "passed");
        const observation = JSON.parse(
            readFileSync(join(run.evidence, "stages/consumer/observations.json"), "utf8"),
        );
        if (mode === "failed") {
            assert.equal(observation.exitCode, 1);
            assert.equal(observation.response.result.accepted, false);
            assert.equal(observation.validationError, null);
        }
        if (mode === "missing") {
            assert.equal(observation.exitCode, 2);
            assert.ok(observation.validationError);
            assert.match(
                readFileSync(join(run.evidence, "consumer-command.log"), "utf8"),
                /original failure/,
            );
        }
        if (mode === "corrupt") {
            assert.equal(observation.exitCode, 0);
            assert.match(observation.validationError, /Selected consumer mismatch/);
        }
        if (mode === "mutate") assert.match(JSON.stringify(observation.failures), /clean/);
    }
});

test("compatibility rejects invalid preparation before consumer execution and checkout-owned outputs", async (t) => {
    const f = fixture(t);
    await assert.rejects(
        compatibility(repository, {
            consumer: f.checkout,
            revision: f.revision,
            output: join(f.checkout, "out"),
        }),
        /outside/,
    );
    const run = await compatibility(repository, {
        consumer: f.checkout,
        revision: f.revision,
        manifest: join(f.root, "missing/evidence/manifest.json"),
        output: join(f.root, "run"),
    });
    assert.equal(run.result.accepted, false);
    assert.deepEqual(
        run.result.stages.map((s) => s.id),
        ["preparation"],
    );
});
