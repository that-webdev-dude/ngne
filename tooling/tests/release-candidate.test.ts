import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { assembleCandidate, bindCandidate } from "../core/release-candidate.js";
import { hash } from "../evidence/identity.js";
import { header, type Manifest, type Result } from "../evidence/schema.js";
import { validateCandidate } from "../commands/publish.js";

const workflow = readFileSync(".github/workflows/release-candidate.yml", "utf8");
const command = resolve("tooling/commands/release-candidate.ts");

function fixture(t: test.TestContext, version = "0.2.2") {
    mkdirSync(".test-output", { recursive: true });
    const root = mkdtempSync(resolve(".test-output/release-candidate-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const git = (...args: string[]) =>
        execFileSync("git", args, {
            cwd: root,
            encoding: "utf8",
            windowsHide: true,
        }).trim();
    git("init", "--quiet");
    git("config", "core.autocrlf", "false");
    git("config", "user.name", "Candidate fixture");
    git("config", "user.email", "candidate@example.invalid");
    git("config", "core.hooksPath", ".git/no-hooks");
    writeFileSync(join(root, ".gitignore"), "out/\n");
    const pkg = {
        name: "@ngne/core",
        version,
        private: false,
        publishConfig: {
            registry: "https://registry.npmjs.org/",
            access: "public",
            tag: version.includes("-") ? "next" : "latest",
        },
    };
    const lock = { name: pkg.name, version, packages: { "": { name: pkg.name, version } } };
    const save = (file: string, value: unknown) =>
        writeFileSync(join(root, file), JSON.stringify(value, null, 2) + "\n");
    const commit = () => {
        save("package.json", pkg);
        save("package-lock.json", lock);
        git("add", ".");
        git("-c", "commit.gpgsign=false", "commit", "--quiet", "--allow-empty", "-m", "fixture");
        return git("rev-parse", "HEAD");
    };
    const revision = commit();
    const env = {
        GITHUB_SHA: revision,
        RELEASE_TAG: `v${version}`,
        PREPARATION_MANIFEST: "out/preparation/evidence/manifest.json",
        GITHUB_STEP_SUMMARY: "out/summary.md",
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "that-webdev-dude/ngne",
        GITHUB_RUN_ID: "123",
        GITHUB_RUN_ATTEMPT: "2",
    };
    const bytes = Buffer.from([0, 255, 1, 2, ...Buffer.from("unchanged synthetic package")]);
    const filename = `ngne-core-${version}.tgz`;
    const tree = { path: "work/fixture", files: { "package.json": hash("fixture") } };
    const manifest: Manifest = {
        ...header("manifest", "synthetic-release"),
        suite: "package",
        startedAt: "2026-10-23T00:00:00Z",
        preparation: "prepared",
        provenance: { revision, changes: "" },
        environment: {
            node: process.version,
            platform: process.platform,
            release: "fixture",
            arch: process.arch,
        },
        harness: {},
        policy: {},
        prepared: {
            package: {
                filename,
                path: `evidence/package/${filename}`,
                sha256: hash(bytes),
                files: { "package.json": hash(JSON.stringify(pkg)) },
            },
            installed: tree,
            workload: tree,
            dependencies: tree,
            builds: { root: tree, nested: tree },
            toolchain: { node: process.version, npm: "fixture", typescript: "fixture" },
            dependencyPolicy: "offline-lockfile-ci-no-scripts",
        },
    };
    const outcome = {
        execution: "completed",
        correctness: "passed",
        budgets: "not evaluated",
        cleanup: "passed",
        evidence: "complete",
    } as const;
    const result: Result = {
        ...header("result", manifest.runId),
        ...outcome,
        stages: [{ ...outcome, id: "fixture", required: true }],
        failures: [],
        cleanupRecords: [],
        accepted: true,
    };
    const prepare = () => {
        mkdirSync(join(root, "out/preparation/evidence/package"), { recursive: true });
        save(env.PREPARATION_MANIFEST, manifest);
        save("out/preparation/evidence/result.json", result);
        writeFileSync(join(root, "out/preparation/evidence/package", filename), bytes);
    };
    const read = (file: string) => readFileSync(join(root, file));
    const bind = () => bindCandidate(root, env);
    const assemble = () => assembleCandidate(root, env);
    const cli = (...args: string[]) =>
        spawnSync(process.execPath, [command, ...args], {
            cwd: root,
            env: { ...process.env, ...env },
            encoding: "utf8",
            windowsHide: true,
        });
    return {
        root,
        git,
        pkg,
        lock,
        commit,
        env,
        bytes,
        filename,
        manifest,
        result,
        save,
        prepare,
        read,
        bind,
        assemble,
        cli,
    };
}

function verifyOutput(f: ReturnType<typeof fixture>) {
    const source = JSON.parse(String(f.read("out/release-source.json")));
    assert.deepEqual(source, {
        name: f.pkg.name,
        version: f.pkg.version,
        publishConfig: f.pkg.publishConfig,
        sourceSHA: f.env.GITHUB_SHA,
        intendedTag: f.env.RELEASE_TAG,
        tagStatus: "not-created",
        workflowRun: "https://github.com/that-webdev-dude/ngne/actions/runs/123",
        runAttempt: "2",
    });
    const candidate = JSON.parse(String(f.read("out/release-candidate/candidate.json")));
    const manifestBytes = f.read(f.env.PREPARATION_MANIFEST);
    assert.deepEqual(candidate, {
        ...source,
        verification: "workflow-checks-passed",
        publicationApproved: false,
        preparationRunId: f.manifest.runId,
        tarball: f.filename,
        tarballSHA256: hash(f.bytes),
        manifestSHA256: hash(manifestBytes),
        evidenceArtifact: "release-diagnostics-123-2",
        limits: "Automated Linux/SwiftShader evidence. Review and final publication approval required. Evidence archive is not a resumable prepared workspace.",
    });
    assert.deepEqual(
        readdirSync(join(f.root, "out/release-candidate")).sort(),
        ["SHA256SUMS", "candidate.json", "manifest.json", f.filename].sort(),
    );
    assert.deepEqual(f.read(`out/release-candidate/${f.filename}`), f.bytes);
    assert.deepEqual(f.read("out/release-candidate/manifest.json"), manifestBytes);
    assert.equal(
        String(f.read("out/release-candidate/SHA256SUMS")),
        [f.filename, "manifest.json", "candidate.json"]
            .map((file) => `${hash(f.read(`out/release-candidate/${file}`))}  ${file}`)
            .join("\n") + "\n",
    );
    assert.match(String(f.read("out/summary.md")), /No publication occurred/);
    // The independent downloaded-candidate boundary accepts the assembled file set.
    const inspected = validateCandidate(join(f.root, "out/release-candidate"), {
        runId: "123",
        runAttempt: "2",
        sourceSHA: f.env.GITHUB_SHA,
        artifactId: "789",
        artifactDigest: `sha256:${"b".repeat(64)}`,
    });
    assert.equal(inspected.sha256, hash(f.bytes));
    assert.equal(f.git("tag", "--list"), "");
    assert.equal(f.git("status", "--porcelain"), "");
}

test("direct candidate preparation preserves complete identity, bytes and inventory for both channels", (t) => {
    for (const version of ["0.2.2", "0.3.0-alpha.1"]) {
        const f = fixture(t, version);
        f.bind();
        f.prepare();
        f.assemble();
        verifyOutput(f);
    }
});

test("native Node command binds before dependencies exist and assembles the same synthetic preparation", (t) => {
    const f = fixture(t);
    assert.equal(existsSync(join(f.root, "node_modules")), false);
    let result = f.cli("bind");
    assert.equal(result.status, 0, result.stderr);
    f.prepare();
    result = f.cli("assemble");
    assert.equal(result.status, 0, result.stderr);
    verifyOutput(f);
    assert.notEqual(f.cli("unknown").status, 0);
    assert.notEqual(f.cli("bind", "extra").status, 0);
});

test("binding rejects package/lock/tag and publication policy disagreements", async (t) => {
    const mutations: Record<string, (f: ReturnType<typeof fixture>) => void> = {
        "old name": (f) => {
            f.pkg.name = "ngne";
        },
        "other scoped name": (f) => {
            f.pkg.name = "@that-webdev-dude/ngne";
        },
        "private package": (f) => {
            f.pkg.private = true;
        },
        "lock name": (f) => {
            f.lock.name = "ngne";
        },
        "lock root name": (f) => {
            f.lock.packages[""].name = "ngne";
        },
        "lock version": (f) => {
            f.lock.version = "0.1.0";
        },
        "lock root version": (f) => {
            f.lock.packages[""].version = "0.1.0";
        },
        "intended tag": (f) => {
            f.env.RELEASE_TAG = "v0.1.0";
        },
        registry: (f) => {
            f.pkg.publishConfig.registry = "https://example.invalid/";
        },
        access: (f) => {
            f.pkg.publishConfig.access = "restricted";
        },
        channel: (f) => {
            f.pkg.publishConfig.tag = "next";
        },
    };
    for (const [name, mutate] of Object.entries(mutations))
        await t.test(name, (t) => {
            const f = fixture(t);
            mutate(f);
            f.env.GITHUB_SHA = f.commit();
            assert.throws(f.bind);
            assert.equal(existsSync(join(f.root, "out/release-source.json")), false);
        });
});

test("binding requires the clean dispatch SHA and rejects conflicting or unreadable tags", async (t) => {
    for (const kind of ["dirty", "sha", "conflict", "unreadable"] as const)
        await t.test(kind, (t) => {
            const f = fixture(t);
            if (kind === "dirty") writeFileSync(join(f.root, "untracked"), "dirty");
            if (kind === "sha") f.env.GITHUB_SHA = "b".repeat(40);
            if (kind === "conflict") {
                f.git("-c", "tag.gpgsign=false", "tag", f.env.RELEASE_TAG);
                f.env.GITHUB_SHA = f.commit();
            }
            if (kind === "unreadable")
                writeFileSync(
                    join(f.root, ".git/refs/tags", f.env.RELEASE_TAG),
                    "b".repeat(40) + "\n",
                );
            assert.throws(
                f.bind,
                kind === "conflict"
                    ? /another commit/
                    : kind === "unreadable"
                      ? /Cannot inspect/
                      : /clean dispatch/,
            );
        });
});

test("binding accepts lightweight and annotated tags that resolve to the dispatch commit", (t) => {
    for (const annotated of [false, true]) {
        const f = fixture(t);
        f.git(
            "-c",
            "tag.gpgsign=false",
            "tag",
            ...(annotated ? ["-a", f.env.RELEASE_TAG, "-m", "fixture"] : [f.env.RELEASE_TAG]),
        );
        assert.equal(
            f.git("cat-file", "-t", `refs/tags/${f.env.RELEASE_TAG}`),
            annotated ? "tag" : "commit",
        );
        assert.equal(f.bind().tagStatus, "matches-source");
        f.prepare();
        f.assemble();
        assert.equal(
            JSON.parse(String(f.read("out/release-candidate/candidate.json"))).tagStatus,
            "matches-source",
        );
    }
});

test("assembly rejects failed, incomplete, mismatched or drifted preparation before output creation", async (t) => {
    const mutations: Record<string, (f: ReturnType<typeof fixture>) => void> = {
        "rejected result": (f) => {
            f.result.accepted = false;
            f.result.correctness = "failed";
        },
        "inconsistent result": (f) => {
            f.result.accepted = false;
        },
        "result run": (f) => {
            f.result.runId = "different";
        },
        "failed preparation": (f) => {
            f.manifest.preparation = "failed";
        },
        "missing package": (f) => {
            f.manifest.prepared = null;
        },
        "missing provenance": (f) => {
            f.manifest.provenance = null;
        },
        "preparation revision": (f) => {
            f.manifest.provenance!.revision = "b".repeat(40);
        },
        "dirty preparation": (f) => {
            f.manifest.provenance!.changes = " M package.json";
        },
        "later revision": (f) => {
            f.commit();
        },
        "later dirty source": (f) => {
            writeFileSync(join(f.root, "untracked"), "dirty");
        },
        filename: (f) => {
            f.manifest.prepared!.package.filename = "ngne-0.2.2.tgz";
        },
        hash: (f) => {
            f.manifest.prepared!.package.sha256 = "0".repeat(64);
        },
        "tarball path": (f) => {
            f.manifest.prepared!.package.path = "../foreign.tgz";
        },
    };
    for (const [name, mutate] of Object.entries(mutations))
        await t.test(name, (t) => {
            const f = fixture(t);
            f.bind();
            mutate(f);
            f.prepare();
            assert.throws(f.assemble);
            assert.equal(existsSync(join(f.root, "out/release-candidate")), false);
        });
});

test("missing or changed preparation files fail and existing output is never overwritten", (t) => {
    const f = fixture(t);
    f.bind();
    assert.throws(f.assemble);
    f.prepare();
    const archive = join(f.root, "out/preparation/evidence/package", f.filename);
    writeFileSync(archive, "changed bytes");
    assert.throws(f.assemble, /identity mismatch/);
    f.prepare();
    rmSync(join(f.root, "out/preparation/evidence/result.json"));
    assert.throws(f.assemble);
    f.prepare();
    f.assemble();
    const previous = f.read("out/release-candidate/candidate.json");
    assert.throws(f.assemble, /EEXIST/);
    assert.deepEqual(f.read("out/release-candidate/candidate.json"), previous);
    assert.throws(f.bind, /EEXIST/);
});

test("command failure returns nonzero without a candidate or successful summary", (t) => {
    const f = fixture(t);
    f.env.GITHUB_SHA = "b".repeat(40);
    assert.notEqual(f.cli("bind").status, 0);
    assert.notEqual(f.cli("assemble").status, 0);
    assert.equal(existsSync(join(f.root, "out/release-candidate")), false);
    assert.equal(existsSync(join(f.root, "out/summary.md")), false);
});

test("assembly I/O failure fails the command and retains diagnostics without overwriting output", (t) => {
    const f = fixture(t);
    f.bind();
    f.prepare();
    f.env.GITHUB_STEP_SUMMARY = "out/missing/summary.md";
    const result = f.cli("assemble");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ENOENT/);
    assert.equal(existsSync(join(f.root, "out/release-source.json")), true);
    assert.equal(existsSync(join(f.root, f.env.PREPARATION_MANIFEST)), true);
    assert.deepEqual(f.read(`out/release-candidate/${f.filename}`), f.bytes);
    assert.throws(f.assemble, /EEXIST/);
});

test("workflow retains bootstrap order, all checks and success-only candidate delivery", () => {
    const ordered = [
        "actions/checkout@v4",
        "ref: ${{ github.sha }}",
        "actions/setup-node@v4",
        "node-version: 24",
        "node tooling/commands/release-candidate.ts bind",
        "run: npm ci",
        "run: npm run format:check",
        "run: npm test",
        "run: npm run typecheck:tooling",
        "run: npm run typecheck\n",
        "run: npm run build\n",
        "run: npm run build:browser",
        "run: npm run prepare:package",
        "run: npm run check:prepared",
        "sudo apt-get update",
        "xvfb-run -a npm run check:browser-transport",
        "xvfb-run -a npm run verify:installed",
        "xvfb-run -a npm run verify:preview",
        "xvfb-run -a npm run test:browser",
        "run: npm run check:prepared",
        "node tooling/commands/release-candidate.ts assemble",
        "if: always()",
        "name: release-diagnostics-${{ github.run_id }}-${{ github.run_attempt }}",
        "if: success()",
        "name: release-candidate-${{ github.run_id }}-${{ github.run_attempt }}",
        "path: out/release-candidate/",
    ];
    let index = -1;
    for (const fragment of ordered) {
        index = workflow.indexOf(fragment, index + 1);
        assert.notEqual(index, -1, `Missing or misordered workflow wiring: ${fragment}`);
    }
    assert.match(workflow, /permissions:\n  contents: read/);
    assert.match(workflow, /persist-credentials: false/);
    assert.match(workflow, /include-hidden-files: true/);
    assert.match(workflow, /if-no-files-found: warn/);
    assert.match(workflow, /if-no-files-found: error/);
    assert.doesNotMatch(workflow, /node <<|npm publish|git tag|id-token: write/);
});
