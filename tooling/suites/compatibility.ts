import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ownProcess, failureText } from "../../tests/tooling/cleanup.mjs";
import { Run } from "../core/run.js";
import { npmPath } from "../core/process.js";
import { prepare, verifyPrepared } from "../core/preparation.js";
import { contained, hash } from "../evidence/identity.js";
import {
    consumerValidatorIdentity,
    validateConsumerResponse,
    type ConsumerManifest,
} from "../evidence/consumer-contract-v1.js";

const git = (cwd: string, args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true });

/** Checkout mode: all tracked files are inputs; npm's tracked lock is recorded separately. */
export function selectConsumer(checkout: string, revision: string): ConsumerManifest["consumer"] {
    const root = realpathSync(checkout);
    if (realpathSync(git(root, ["rev-parse", "--show-toplevel"]).trim()) !== root)
        throw Error("Consumer must be an explicit checkout root");
    if (!/^[a-f0-9]{40,64}$/.test(revision) || git(root, ["rev-parse", "HEAD"]).trim() !== revision)
        throw Error("Consumer revision must match the full pinned commit");
    if (git(root, ["status", "--porcelain", "--untracked-files=all"]).trim())
        throw Error("Consumer checkout must be clean, including nonignored untracked inputs");
    const paths = git(root, ["ls-files", "-z"]).split("\0").filter(Boolean);
    if (!paths.includes("package.json") || !paths.includes("package-lock.json"))
        throw Error("Consumer requires tracked package.json and package-lock.json");
    const entries = paths.map((path) => [path, hash(readFileSync(contained(root, path)))] as const);
    return {
        revision,
        source: Object.fromEntries(entries.filter(([p]) => p !== "package-lock.json")),
        lock: Object.fromEntries(entries.filter(([p]) => p === "package-lock.json")),
    };
}

export interface CompatibilityOptions {
    consumer: string;
    revision: string;
    manifest?: string;
    output?: string;
}

/** Always validates returned evidence, including nonzero exits and interrupted commands. */
export async function compatibility(
    repository: string,
    options: CompatibilityOptions,
): Promise<Run> {
    const checkout = realpathSync(resolve(options.consumer));
    // Validate selection before creating outputs or preparing a package.
    const consumer = selectConsumer(checkout, options.revision);
    const output = resolve(
        options.output ?? join(repository, "out/runs", `compatibility-${randomUUID()}`),
    );
    let ancestor = output;
    while (!existsSync(ancestor)) ancestor = dirname(ancestor);
    const physicalOutput = resolve(realpathSync(ancestor), relative(ancestor, output));
    const rel = relative(checkout, physicalOutput);
    if (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
        throw Error("Compatibility output must be outside the consumer checkout");
    const run = new Run(repository, "compatibility", output);
    await run.execute(async () => {
        run.manifest.policy = { contractVersion: 1, checkout, consumer, timeoutMs: 600_000 };
        run.manifest.provenance = {
            revision: git(repository, ["rev-parse", "HEAD"]).trim(),
            changes: git(repository, ["status", "--porcelain"]),
        };
        const validator = consumerValidatorIdentity(repository);
        run.manifest.harness = Object.fromEntries([
            ...Object.entries(validator.files).map(([p, h]) => [`tooling/evidence/${p}`, h]),
            ...Object.entries(validator.fixtures).map(([p, h]) => [
                `tooling/tests/fixtures/consumer-contract-v1/${p}`,
                h,
            ]),
            ...[
                "tooling/suites/compatibility.ts",
                "tooling/core/run.ts",
                "tests/tooling/cleanup.mjs",
            ].map((p) => [p, hash(readFileSync(join(repository, p)))]),
        ]);
        let manifestPath = options.manifest && resolve(options.manifest);
        await run.stage("preparation", async () => {
            if (!manifestPath) {
                const prepared = await prepare(repository, join(run.root, "preparation"));
                if (!prepared.result.accepted)
                    throw Error("Package preparation failed; see preparation evidence");
                manifestPath = join(prepared.evidence, "manifest.json");
            }
            verifyPrepared(manifestPath);
        });
        if (!manifestPath) throw Error("Missing exact preparation");
        const exactManifest = manifestPath;
        const prepared = verifyPrepared(manifestPath);
        if (!prepared.prepared) throw Error("Missing package identity");
        const pkg = prepared.prepared.package;
        const tarball = contained(dirname(dirname(manifestPath)), pkg.path);
        const childId = randomUUID();
        const childOutput = join(run.root, "consumer");
        const selected = {
            runId: childId,
            engineFilename: pkg.filename,
            engineSha256: pkg.sha256,
            consumer,
        };
        run.manifest.preparation = "prepared";
        run.manifest.policy = {
            contractVersion: 1,
            checkout,
            consumer,
            childRunId: childId,
            childOutput: "consumer",
            preparationManifest: manifestPath,
            preparationRunId: prepared.runId,
            preparationManifestSHA256: hash(readFileSync(manifestPath)),
            packageSHA256: pkg.sha256,
            timeoutMs: 600_000,
        };
        await run.stage("consumer", async () => {
            // Recheck after preparation, immediately before handing control to the consumer.
            if (
                JSON.stringify(selectConsumer(checkout, options.revision)) !==
                JSON.stringify(consumer)
            )
                throw Error("Consumer inputs changed before execution");
            const args = [
                npmPath(),
                "run",
                "verify:engine",
                "--",
                "--contract-version",
                "1",
                "--engine-tarball",
                tarball,
                "--engine-sha256",
                pkg.sha256,
                "--output",
                childOutput,
                "--run-id",
                childId,
            ];
            const log = join(run.evidence, "consumer-command.log");
            appendFileSync(
                log,
                JSON.stringify({ executable: process.execPath, args, cwd: checkout }) + "\n",
            );
            let exitCode = -1;
            const failures: string[] = [];
            try {
                const child = spawn(process.execPath, args, {
                    cwd: checkout,
                    windowsHide: true,
                    detached: process.platform !== "win32",
                    stdio: ["ignore", "pipe", "pipe"],
                });
                const owner = ownProcess(child, "consumer command");
                run.cleanup.push(["consumer command terminate/verify", () => owner.stop()]);
                child.stdout.on("data", (b: Buffer) => appendFileSync(log, b));
                child.stderr.on("data", (b: Buffer) => appendFileSync(log, b));
                try {
                    exitCode = await new Promise<number>((resolveExit, reject) => {
                        const timer = setTimeout(
                            () => reject(Error("Consumer command timeout; termination required")),
                            600_000,
                        );
                        child.once("error", (error) => {
                            clearTimeout(timer);
                            reject(error);
                        });
                        child.once("close", (code, signal) => {
                            clearTimeout(timer);
                            code === null
                                ? reject(Error(`Consumer terminated by ${signal}`))
                                : resolveExit(code);
                        });
                    });
                    if (exitCode !== 0)
                        failures.push(
                            `Consumer command exit ${exitCode}; see consumer-command.log`,
                        );
                } catch (error) {
                    failures.push(failureText(error));
                } finally {
                    // Stop descendants before reading evidence; finalization records the same cleanup outcome.
                    await owner.stop();
                }
            } catch (error) {
                failures.push(failureText(error));
            }
            let response: ReturnType<typeof validateConsumerResponse> | undefined;
            let validationError: string | undefined;
            try {
                response = validateConsumerResponse(childOutput, selected, exitCode);
                if (!response.accepted)
                    failures.push(`Consumer rejected: ${JSON.stringify(response.result.failures)}`);
            } catch (error) {
                validationError = failureText(error);
                failures.push(`Consumer evidence: ${validationError}`);
            }
            try {
                if (
                    JSON.stringify(selectConsumer(checkout, options.revision)) !==
                    JSON.stringify(consumer)
                )
                    throw Error("Consumer inputs changed during execution");
                verifyPrepared(exactManifest);
            } catch (error) {
                failures.push(failureText(error));
            }
            run.record("consumer", "observations", {
                selected,
                exitCode,
                response: response ?? null,
                validationError: validationError ?? null,
                failures,
            });
            if (failures.length) throw Error(failures.join("\n"));
        });
    });
    return run;
}
