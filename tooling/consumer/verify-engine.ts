import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
    appendFileSync,
    cpSync,
    existsSync,
    mkdirSync,
    readFileSync,
    realpathSync,
    renameSync,
    writeFileSync,
} from "node:fs";
import { arch, platform, release } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupSteps, failureText, ownProcess, type CleanupStep } from "../core/cleanup.mjs";
import { contained, hash, identities, type Identities } from "../evidence/identity.ts";
import type { Outcome, Result, Stage } from "../evidence/schema.js";

// Consumer-owned choices: edit these and configureCandidate when adopting this file.
const checks = ["typecheck", "test", "build", "check:package"];
const dependencySection = "dependencies";
const packageName = "@ngne/core";
const candidateDirectory = ".ngne-candidate";
const omissions = [
    "No browser, rendering, native input, audible audio, performance or physical-device checks.",
    "work/ retains the isolated installation; evidence alone cannot rebuild it.",
];

interface Input {
    tarball: string;
    digest: string;
    output: string;
    runId: string;
}
interface Candidate {
    filename: string;
    sha256: string;
    version: string;
    dependency: string;
}

/** Adapt vendor identity checks here, in the copy only; never rewrite the baseline checkout. */
function configureCandidate(app: string, candidate: Candidate): void {
    const path = join(app, "package.json");
    const pkg = JSON.parse(readFileSync(path, "utf8"));
    assert(pkg[dependencySection]?.[packageName], `Expected ${dependencySection}.${packageName}`);
    pkg[dependencySection][packageName] = candidate.dependency;
    writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
    // ponytail: a separate candidate record lets vendor checks preserve historical engine evidence.
    writeFileSync(join(app, ".ngne-candidate.json"), JSON.stringify(candidate, null, 2) + "\n");
}

export function parse(args: string[]): Input {
    const keys = [
        "--contract-version",
        "--engine-tarball",
        "--engine-sha256",
        "--output",
        "--run-id",
    ];
    const flags = new Map<string, string>();
    for (let i = 0; i < args.length; i += 2) {
        const key = args[i],
            value = args[i + 1];
        assert(
            keys.includes(key) && !flags.has(key) && value?.trim() && !value.startsWith("--"),
            "Invalid, unknown or duplicate flag",
        );
        flags.set(key, value);
    }
    assert(
        flags.size === 5 && flags.get("--contract-version") === "1",
        "All five v1 flags are required",
    );
    const tarball = flags.get("--engine-tarball")!,
        digest = flags.get("--engine-sha256")!,
        output = flags.get("--output")!,
        runId = flags.get("--run-id")!;
    assert(isAbsolute(tarball) && isAbsolute(output), "Absolute paths required");
    assert(
        /^[^/\\:\x00]+\.tgz$/.test(basename(tarball)) && /^[a-f0-9]{64}$/.test(digest),
        "Invalid package filename or SHA-256",
    );
    assert.equal(
        hash(readFileSync(contained(dirname(tarball), basename(tarball)))),
        digest,
        "Tarball hash mismatch",
    );
    assert(!existsSync(output), "Output already exists");
    return { tarball: resolve(tarball), digest, output: resolve(output), runId };
}

function consumerIdentity(checkout: string) {
    const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: checkout, encoding: "utf8", windowsHide: true });
    assert.equal(
        realpathSync(git("rev-parse", "--show-toplevel").trim()),
        checkout,
        "Checkout root required",
    );
    assert.equal(
        git("status", "--porcelain", "--untracked-files=all").trim(),
        "",
        "Consumer checkout must be clean",
    );
    const paths = git("ls-files", "-z").split("\0").filter(Boolean);
    assert(
        paths.includes("package.json") && paths.includes("package-lock.json"),
        "Tracked package and lock required",
    );
    const entries = paths.map((p) => [p, hash(readFileSync(contained(checkout, p)))]);
    return {
        revision: git("rev-parse", "HEAD").trim(),
        source: Object.fromEntries(entries.filter(([p]) => p !== "package-lock.json")),
        lock: Object.fromEntries(entries.filter(([p]) => p === "package-lock.json")),
    };
}

/** Derived from the independent consumer adapters; no engine runtime or sibling imports. */
export async function verify(input: Input, checkout = process.cwd()): Promise<Result> {
    const { tarball, digest, output, runId } = input;
    checkout = realpathSync(checkout);
    let ancestor = dirname(output);
    while (!existsSync(ancestor)) ancestor = dirname(ancestor);
    const rel = relative(checkout, resolve(realpathSync(ancestor), relative(ancestor, output)));
    assert(
        isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`),
        "Output must be outside checkout",
    );
    const consumer = consumerIdentity(checkout);
    const npm = process.env.npm_execpath;
    assert(npm, "Invoke through npm run verify:engine");
    mkdirSync(dirname(output), { recursive: true });
    mkdirSync(output); // Exclusive allocation, including empty pre-existing outputs.
    const evidence = join(output, "evidence"),
        app = join(output, "work/app");
    mkdirSync(evidence);
    mkdirSync(app, { recursive: true });
    const header = (documentType: string) => ({
        format: "ngne-tooling" as const,
        schemaVersion: 1 as const,
        documentType,
        runId,
    });
    const atomic = (name: string, value: unknown) => {
        const path = join(evidence, name),
            temporary = `${path}.${randomUUID()}.tmp`;
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
        renameSync(temporary, path);
    };
    const pending = (): Outcome => ({
        execution: "pending",
        correctness: "not evaluated",
        budgets: "not evaluated",
        cleanup: "pending",
        evidence: "partial",
    });
    const result: Result = {
        ...header("result"),
        ...pending(),
        stages: [],
        failures: [],
        cleanupRecords: [],
        accepted: false,
    };
    const manifest = {
        ...header("consumer-manifest"),
        contractVersion: 1,
        package: {
            filename: basename(tarball),
            path: `package/${basename(tarball)}`,
            sha256: digest,
        },
        installed: {} as Identities,
        consumer,
        environment: {
            node: process.version,
            platform: platform(),
            release: release(),
            arch: arch(),
        },
        policy: {
            checks,
            dependencySection,
            candidateDirectory,
            install: "offline-lockfile-ci-no-scripts",
            commandTimeoutMs: 120_000,
        },
        omissions,
    };
    const cleanups: CleanupStep[] = [];
    const persist = () => {
        atomic("manifest.json", manifest);
        atomic("result.json", result);
    };
    const record = (stage: string, value: Record<string, unknown>) =>
        atomic(`stages/${stage}/observations.json`, { ...header("observations"), ...value });
    const command = async (id: string, executable: string, args: string[], cwd = app) => {
        const log = join(evidence, `stages/${id}/command.log`);
        mkdirSync(dirname(log), { recursive: true });
        appendFileSync(log, JSON.stringify({ executable, args, cwd }) + "\n");
        const child = spawn(executable, args, {
            cwd,
            windowsHide: true,
            detached: process.platform !== "win32",
            stdio: ["ignore", "pipe", "pipe"],
        });
        const owner = ownProcess(child, id);
        cleanups.push([`${id} terminate/verify`, () => owner.stop()]);
        child.stdout.on("data", (b: Buffer) => appendFileSync(log, b));
        child.stderr.on("data", (b: Buffer) => appendFileSync(log, b));
        let original: unknown;
        try {
            await new Promise<void>((done, reject) => {
                const timer = setTimeout(
                    () => reject(Error(`${id}: timeout; termination required`)),
                    120_000,
                );
                child.once("error", (error) => {
                    clearTimeout(timer);
                    reject(error);
                });
                child.once("close", (code, signal) => {
                    clearTimeout(timer);
                    code === 0
                        ? done()
                        : reject(Error(`${id}: exit ${code ?? signal}; see ${log}`));
                });
            });
        } catch (error) {
            original = error;
        }
        try {
            await owner.stop();
        } catch (error) {
            original ??= error;
        }
        if (original) throw original;
    };
    const stage = async (id: string, action: () => Promise<void>) => {
        const current: Stage = { ...pending(), id, required: true, execution: "running" };
        result.stages.push(current);
        persist();
        try {
            await action();
            current.execution = "completed";
            current.correctness = "passed";
        } catch (error) {
            current.execution = "failed";
            current.correctness = "failed";
            throw error;
        } finally {
            persist();
        }
    };
    result.execution = "running";
    persist();
    try {
        await stage("prepare", async () => {
            for (const p of Object.keys({ ...consumer.source, ...consumer.lock })) {
                mkdirSync(dirname(join(app, p)), { recursive: true });
                cpSync(contained(checkout, p), join(app, p));
            }
            mkdirSync(join(evidence, "package"));
            const retained = join(evidence, manifest.package.path);
            cpSync(tarball, retained);
            assert.equal(hash(readFileSync(retained)), digest, "Retained tarball hash mismatch");
            const expected = join(output, "work/unpacked");
            mkdirSync(expected);
            await command("unpack", "tar", ["-xf", retained, "-C", expected]);
            const packageRoot = join(expected, "package");
            const expectedFiles = identities(packageRoot);
            const pkg = JSON.parse(readFileSync(contained(packageRoot, "package.json"), "utf8"));
            assert.equal(pkg.name, packageName, `Candidate must be ${packageName}`);
            assert.equal(typeof pkg.version, "string", "Candidate version required");
            assert(
                !existsSync(join(app, candidateDirectory)) &&
                    !existsSync(join(app, ".ngne-candidate.json")),
                "Candidate paths must not overwrite source inputs",
            );
            mkdirSync(join(app, candidateDirectory), { recursive: true });
            cpSync(retained, join(app, candidateDirectory, basename(tarball)));
            const candidate: Candidate = {
                filename: basename(tarball),
                sha256: digest,
                version: pkg.version,
                dependency: `file:${candidateDirectory}/${basename(tarball)}`,
            };
            configureCandidate(app, candidate);
            await command("lock", process.execPath, [
                npm,
                "install",
                "--package-lock-only",
                "--offline",
                "--ignore-scripts",
                "--no-audit",
                "--no-fund",
            ]);
            await command("install", process.execPath, [
                npm,
                "ci",
                "--offline",
                "--ignore-scripts",
                "--no-audit",
                "--no-fund",
            ]);
            manifest.installed = identities(contained(app, `node_modules/${packageName}`));
            assert.deepEqual(
                manifest.installed,
                expectedFiles,
                "Installed bytes must equal supplied package",
            );
            record("prepare", {
                candidate,
                installedPackageMatchesTarball: true,
                isolatedPackageSHA256: hash(readFileSync(join(app, "package.json"))),
                isolatedLockSHA256: hash(readFileSync(join(app, "package-lock.json"))),
            });
        });
        for (const [i, script] of checks.entries())
            await stage(`check-${i + 1}`, () =>
                command(`check-${i + 1}`, process.execPath, [npm, "run", script]),
            );
        result.execution = "completed";
        result.correctness = "passed";
    } catch (error) {
        result.execution = "failed";
        result.correctness = "failed";
        result.failures.push({ kind: "scenario", message: failureText(error) });
    } finally {
        await cleanupSteps(cleanups, result.cleanupRecords);
        result.cleanup = result.cleanupRecords.some((r) => r.status === "failed")
            ? "failed"
            : "passed";
        for (const r of result.cleanupRecords.filter((r) => r.status === "failed"))
            result.failures.push({ kind: "cleanup", message: `${r.resource}: ${r.error}` });
        // Run after cleanup and on failure too, so failed checks cannot hide input mutation.
        try {
            assert.deepEqual(
                consumerIdentity(checkout),
                consumer,
                "Original consumer inputs changed",
            );
            assert.equal(hash(readFileSync(tarball)), digest, "Supplied tarball changed");
            if (Object.keys(manifest.installed).length)
                assert.deepEqual(
                    identities(contained(app, `node_modules/${packageName}`)),
                    manifest.installed,
                    "Installed package changed during checks",
                );
            record("integrity", {
                originalConsumerUnchanged: true,
                suppliedTarballUnchanged: true,
                installedPackageUnchanged: Object.keys(manifest.installed).length > 0,
            });
        } catch (error) {
            result.failures.push({ kind: "diagnostic", message: failureText(error) });
        }
        for (const s of result.stages) {
            s.cleanup = result.cleanup;
            s.evidence = "complete";
        }
        persist(); // Nonterminal result remains until report and inventory are safely published.
        try {
            result.evidence = "complete";
            result.accepted =
                result.execution === "completed" &&
                result.cleanup === "passed" &&
                !result.failures.length;
            atomic("manifest.json", manifest);
            writeFileSync(
                join(evidence, "report.md"),
                `# Consumer verification\n\nAccepted: ${result.accepted}\n\nChecks: ${checks.join(", ")}\n\n${result.failures.map((f) => `- ${f.kind}: ${f.message}`).join("\n")}\n\n${omissions.join("\n\n")}\n`,
            );
            const finalResult = JSON.stringify(result, null, 2) + "\n";
            const files = Object.entries(identities(evidence)).map(([path, sha256]) => ({
                path,
                sha256: path === "result.json" ? hash(finalResult) : sha256,
                bytes:
                    path === "result.json"
                        ? Buffer.byteLength(finalResult)
                        : readFileSync(contained(evidence, path)).length,
            }));
            atomic("artifacts.json", { ...header("artifacts"), files });
            atomic("result.json", result); // Commit acceptance last, as in the existing run lifecycle.
        } catch (error) {
            result.accepted = false;
            result.evidence = "partial";
            result.failures.push({ kind: "evidence", message: failureText(error) });
            try {
                atomic("result.json", result);
            } catch {
                /* Earlier partial record remains. */
            }
            throw error;
        }
    }
    return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    let input: Input | undefined;
    try {
        input = parse(process.argv.slice(2));
    } catch (error) {
        console.error(failureText(error));
        process.exitCode = 2;
    }
    if (input)
        try {
            const result = await verify(input);
            console.log(
                JSON.stringify({
                    output: input.output,
                    accepted: result.accepted,
                    failures: result.failures,
                }),
            );
            process.exitCode = result.accepted ? 0 : 1;
        } catch (error) {
            console.error(failureText(error));
            process.exitCode = 1;
        }
}
