import assert from "node:assert/strict";
import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { parse } from "../consumer/verify-engine.js";
import { hash } from "../evidence/identity.js";
import { validateConsumerResponse } from "../evidence/consumer-contract-v1.js";
import { selectConsumer } from "../suites/compatibility.js";

test("portable reference installs actual candidate bytes and retains passing and failing evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "ngne-reference-"));
    try {
        const checkout = join(root, "consumer"),
            packed = join(root, "packed/package");
        mkdirSync(checkout);
        mkdirSync(packed, { recursive: true });
        writeFileSync(
            join(packed, "package.json"),
            JSON.stringify({
                name: "ngne",
                version: "9.0.0-next.1",
                type: "module",
                exports: "./index.js",
            }),
        );
        writeFileSync(join(packed, "index.js"), "export const candidate = 42;\n");
        const tarball = join(root, "caller-chosen-next.tgz");
        execFileSync("tar", ["-czf", tarball, "-C", dirname(packed), "package"]);
        mkdirSync(join(checkout, "vendor"));
        writeFileSync(
            join(checkout, "vendor/ngne-0.1.0.tgz"),
            "original archive is never installed",
        );
        writeFileSync(
            join(checkout, "package.json"),
            JSON.stringify({
                name: "independent-reference-test",
                private: true,
                type: "module",
                dependencies: { ngne: "file:vendor/ngne-0.1.0.tgz" },
                scripts: {
                    "verify:engine": "node verification/consumer/verify-engine.ts",
                    typecheck: "node check.mjs",
                    test: "node check.mjs",
                    build: "node check.mjs",
                    "check:package": "node check.mjs",
                },
            }),
        );
        writeFileSync(
            join(checkout, "package-lock.json"),
            JSON.stringify({
                name: "independent-reference-test",
                lockfileVersion: 3,
                packages: {},
            }),
        );
        writeFileSync(
            join(checkout, "check.mjs"),
            `
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { candidate } from 'ngne';
assert.equal(candidate, 42);
const record = JSON.parse(readFileSync('.ngne-candidate.json', 'utf8'));
assert.equal(record.filename, 'caller-chosen-next.tgz');
assert.equal(record.version, '9.0.0-next.1');
assert.equal(readFileSync('vendor/ngne-0.1.0.tgz', 'utf8'), 'original archive is never installed');
if (process.env.NGNE_REFERENCE_TEST_MODE === 'fail') throw Error('controlled consumer check failure');
if (process.env.NGNE_REFERENCE_TEST_MODE === 'mutate') writeFileSync('node_modules/ngne/index.js', 'export const candidate = 42; // changed');
`,
        );
        // Exactly the recipe's vendored files: runtime has no NGNE checkout dependency.
        for (const file of [
            "consumer/verify-engine.ts",
            "core/cleanup.mjs",
            "core/cleanup.d.mts",
            "evidence/identity.ts",
            "evidence/schema.ts",
        ]) {
            const destination = join(checkout, "verification", file);
            mkdirSync(dirname(destination), { recursive: true });
            cpSync(resolve("tooling", file), destination);
        }
        const git = (...args: string[]) =>
            execFileSync("git", args, {
                cwd: checkout,
                encoding: "utf8",
                windowsHide: true,
            }).trim();
        git("init", "--quiet");
        git("add", ".");
        git(
            "-c",
            "user.name=Reference Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "Reference fixture",
        );
        const consumer = selectConsumer(checkout, git("rev-parse", "HEAD"));
        const digest = hash(readFileSync(tarball));
        const npm = process.env.npm_execpath;
        assert(npm, "Run through npm so its CLI path is available");
        for (const mode of ["pass", "fail", "mutate"]) {
            const output = join(root, mode),
                runId = `reference-${mode}`;
            const args = [
                "--contract-version",
                "1",
                "--engine-tarball",
                tarball,
                "--engine-sha256",
                digest,
                "--output",
                output,
                "--run-id",
                runId,
            ];
            assert.throws(() => parse([...args, "--unknown", "value"]), /Invalid/);
            assert.throws(
                () => parse(args.map((v) => (v === digest ? "0".repeat(64) : v))),
                /hash mismatch/,
            );
            assert(!existsSync(output));
            const child: SpawnSyncReturns<string> = spawnSync(
                process.execPath,
                [npm, "run", "verify:engine", "--", ...args],
                {
                    cwd: checkout,
                    encoding: "utf8",
                    timeout: 120_000,
                    windowsHide: true,
                    env: { ...process.env, NGNE_REFERENCE_TEST_MODE: mode },
                },
            );
            assert.equal(child.status, mode === "pass" ? 0 : 1, child.stdout + child.stderr);
            const response = validateConsumerResponse(
                output,
                { runId, engineSha256: digest, engineFilename: "caller-chosen-next.tgz", consumer },
                child.status!,
            );
            assert.equal(response.accepted, mode === "pass");
            assert.equal(response.result.cleanup, "passed");
            assert(response.result.cleanupRecords.length >= 4);
            if (mode === "fail") {
                assert.equal(response.result.stages.at(-1)?.execution, "failed");
                assert.match(
                    readFileSync(join(output, "evidence/stages/check-1/command.log"), "utf8"),
                    /controlled consumer check failure/,
                );
            }
            if (mode === "mutate")
                assert.match(JSON.stringify(response.result.failures), /Installed package changed/);
            assert.deepEqual(selectConsumer(checkout, consumer.revision), consumer);
            assert.throws(() => parse(args), /Output already exists/);
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
