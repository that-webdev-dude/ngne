import { spawn, execFileSync } from "node:child_process";
import {
    appendFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { cpus, totalmem } from "node:os";
import { randomUUID } from "node:crypto";
import { ownProcess } from "../../../tests/tooling/cleanup.mjs";
import { Run } from "../../core/run.js";
import { npmPath } from "../../core/process.js";
import { hash, identities, verifyIdentities } from "../../evidence/identity.js";
import type { BenchmarkOptions } from "./options.js";
import { compactRun } from "./compact.js";
import { validateResult } from "../../evidence/run-results.mjs";

const managed = [
    "NGNE_URL",
    "NGNE_WARMUP_SECONDS",
    "NGNE_DURATION_SECONDS",
    "NGNE_CDP_PORT",
    "NGNE_SERVE_DIR",
    "NGNE_SERVE_OUT_DIR",
    "NGNE_EXPECTED_BUILD",
    "NGNE_EXPECTED_BACKEND",
    "NGNE_ALLOCATION_SAMPLING",
    "NGNE_CYCLES",
    "NGNE_SNAPSHOTS",
    "NGNE_TRACE",
    "NGNE_RETAINED_EVERY_SECONDS",
    "NGNE_ARTIFACT_DIR",
];

export async function allBenchmarks(repository: string, options: BenchmarkOptions): Promise<Run> {
    const run = new Run(
        repository,
        "benchmarks",
        join(
            options.outputRoot,
            `${new Date().toISOString().replaceAll(":", "-")}-benchmarks-${randomUUID()}`,
        ),
    );
    const results = join(repository, "tooling/evidence/run-results.mjs");
    const diagnostics = (name: string) => join(run.evidence, "stages", name, "diagnostics");
    const source = Object.fromEntries(
        ["src", "demo", "examples", "tooling/suites/benchmarks/rendering/browser"].flatMap((p) =>
            Object.entries(identities(join(repository, p))).map(([name, sha]) => [
                `${p}/${name}`,
                sha,
            ]),
        ),
    );
    source["index.html"] = hash(readFileSync(join(repository, "index.html")));
    run.manifest.policy = {
        mode: "exploratory",
        parameters: options,
        target: "internal-source-microbenchmarks",
        source,
        reason: "CPU and renderer probes exercise private World and WebGpuRuntime implementation; showcase probes measure repository-owned demo workloads. Installed package evidence is the separate content-engine suite.",
        units: "milliseconds, bytes, counts; metric-specific boundaries in raw results",
        budgets: "not established; 60 Hz tick counts are descriptive, not acceptance budgets",
        retention: { mode: "full", compactRequested: options.compact },
        hardware: { cpu: cpus().map((c) => c.model), totalMemory: totalmem() },
        manualVisual: "not evaluated",
        manualAudible: "not evaluated",
    };
    run.manifest.harness = Object.fromEntries(
        ["tooling/core", "tooling/evidence", "tooling/suites/benchmarks", "tests/tooling"].flatMap(
            (p) =>
                Object.entries(identities(join(repository, p))).map(([name, sha]) => [
                    `${p}/${name}`,
                    sha,
                ]),
        ),
    );
    for (const path of [
        "package-lock.json",
        "package.json",
        "vite.config.ts",
        "tooling/evidence/run-results.mjs",
        "tooling/commands/benchmark-all.ts",
        "node_modules/typescript/package.json",
        "node_modules/tsx/package.json",
        "node_modules/vite/package.json",
        "node_modules/esbuild/package.json",
    ])
        run.manifest.harness[path] = hash(readFileSync(join(repository, path)));
    run.manifest.provenance = {
        revision: execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: repository,
            encoding: "utf8",
            windowsHide: true,
        }).trim(),
        changes: execFileSync("git", ["status", "--porcelain"], {
            cwd: repository,
            encoding: "utf8",
            windowsHide: true,
        }).trim(),
    };
    const verifySource = () => {
        for (const [path, sha] of Object.entries({ ...source, ...run.manifest.harness }))
            if (hash(readFileSync(join(repository, path))) !== sha)
                throw Error(`Changed measured source: ${path}`);
    };
    const invoke = async (name: string, args: string[], values: Record<string, string> = {}) => {
        const logs = join(run.evidence, "stages", name, "logs");
        mkdirSync(logs, { recursive: true });
        const env = { ...process.env };
        for (const key of managed) delete env[key];
        Object.assign(env, values);
        const child = spawn(process.execPath, args, {
            cwd: repository,
            env,
            windowsHide: true,
            detached: process.platform !== "win32",
            stdio: ["ignore", "pipe", "pipe"],
        });
        const owner = ownProcess(child, name);
        run.cleanup.push([`${name} terminate/verify`, () => owner.stop()]);
        let stdout = "",
            stderr = "";
        child.stdout.on("data", (b: Buffer) => {
            stdout += b.toString();
            appendFileSync(join(logs, "stdout.log"), b);
        });
        child.stderr.on("data", (b: Buffer) => {
            stderr += b.toString();
            appendFileSync(join(logs, "stderr.log"), b);
        });
        let failure: unknown;
        try {
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(
                    () => reject(Error(`${name}: command deadline`)),
                    Math.max(
                        120000,
                        (options.warmupSeconds + options.durationSeconds + 180) * 1000,
                    ),
                );
                child.once("error", (e) => {
                    clearTimeout(timer);
                    reject(e);
                });
                child.once("close", (code, signal) => {
                    clearTimeout(timer);
                    code === 0 ? resolve() : reject(Error(`${name}: exit ${code ?? signal}`));
                });
            });
        } catch (error) {
            failure = error;
        }
        try {
            await owner.stop();
        } catch (error) {
            failure = new AggregateError(
                failure ? [failure, error] : [error],
                `${name}: process cleanup failed`,
            );
        }
        if (failure) throw failure;
        return { stdout, stderr };
    };
    const stage = async (
        name: string,
        kind: "command" | "benchmark",
        args: string[],
        values: Record<string, string> = {},
        mode?: string,
    ) => {
        const directory = diagnostics(name);
        mkdirSync(directory, { recursive: true });
        let failure: unknown;
        try {
            await run.stage(name, async () => {
                verifySource();
                const { stdout, stderr } = await invoke(name, args, values);
                if (kind === "benchmark") {
                    if (mode) {
                        if (stderr) throw Error(`${name}: churn emitted stderr`);
                        const parsed = join(directory, "gc-parsed.json");
                        if (mode === "gc")
                            await invoke(`${name}-parse`, [
                                join(
                                    repository,
                                    "tooling/suites/benchmarks/cpu/churn-gc-parse.mjs",
                                ),
                                join(run.evidence, "stages", name, "logs/stdout.log"),
                                join(directory, "result.json"),
                                parsed,
                            ]);
                        await invoke(`${name}-validate`, [
                            results,
                            "validate-churn",
                            join(directory, "result.json"),
                            mode,
                            parsed,
                        ]);
                    } else writeFileSync(join(directory, "result.json"), stdout);
                    const raw: unknown = JSON.parse(
                        readFileSync(join(directory, "result.json"), "utf8"),
                    );
                    validateResult(name, raw);
                    run.record(name, "measurements", {
                        target: "internal-source-microbenchmark",
                        raw,
                    });
                    unlinkSync(join(directory, "result.json"));
                    if (!mode && existsSync(join(run.evidence, "stages", name, "logs/stdout.log")))
                        unlinkSync(join(run.evidence, "stages", name, "logs/stdout.log"));
                }
                verifySource();
            });
        } catch (error) {
            failure = error;
        }
        // Independent workloads still execute; acceptance remains failed.
        if (failure)
            run.result.failures.push({ kind: "scenario", message: `${name}: ${String(failure)}` });
        return !failure;
    };
    await run.execute(async () => {
        try {
            if (options.workload === "all") {
                if (options.skipBuild) {
                    if (
                        !existsSync(join(repository, "dist/index.html")) ||
                        !existsSync(
                            join(
                                repository,
                                "dist-browser/tooling/suites/benchmarks/rendering/browser/index.html",
                            ),
                        )
                    )
                        throw Error("SkipBuild requires production and browser builds");
                } else {
                    for (const [name, script] of [
                        ["build-production", "build"],
                        ["build-browser", "build:browser"],
                    ])
                        if (!(await stage(name, "command", [npmPath(), "run", script])))
                            throw Error(`${name} failed`);
                }
                run.manifest.policy.builds = {
                    production: identities(join(repository, "dist")),
                    browser: identities(join(repository, "dist-browser")),
                };
                await stage("cpu", "benchmark", [
                    "--import",
                    "tsx",
                    join(repository, "tooling/suites/benchmarks/cpu/benchmark.ts"),
                ]);
            }
            for (const mode of options.diagnostics ? ["timed", "alloc", "gc"] : ["timed"]) {
                const name = mode === "timed" ? "churn" : `churn-${mode}`,
                    directory = diagnostics(name);
                const args = [
                    ...(mode === "alloc" ? ["--expose-gc"] : mode === "gc" ? ["--trace-gc"] : []),
                    "--import",
                    "tsx",
                    join(repository, "tooling/suites/benchmarks/cpu/churn-schema.ts"),
                    mode,
                    "--out",
                    join(directory, "result.json"),
                    ...(mode === "alloc"
                        ? ["--profile", join(directory, "allocation.heapprofile")]
                        : []),
                ];
                await stage(name, "benchmark", args, {}, mode);
            }
            if (options.workload === "all") {
                const selections = [
                    [
                        "renderer-webgpu",
                        "/tooling/suites/benchmarks/rendering/browser/index.html?workload=renderer-webgpu",
                        "dist-browser",
                    ],
                    [
                        "renderer-webgpu-alternating",
                        "/tooling/suites/benchmarks/rendering/browser/index.html?workload=renderer-webgpu&alternating=1",
                        "dist-browser",
                    ],
                    ["starfall-chaos", "/", "dist"],
                    ["platformer", "/examples/platformer/?baseline", "dist"],
                ];
                for (const [index, [name, path, build]] of selections.entries()) {
                    const buildFiles = identities(join(repository, build));
                    await stage(
                        name,
                        "benchmark",
                        [
                            "--import",
                            "tsx",
                            join(
                                repository,
                                "tooling/suites/benchmarks/rendering/browser-baseline.ts",
                            ),
                        ],
                        {
                            NGNE_URL: options.baseUrl + path,
                            NGNE_WARMUP_SECONDS: String(options.warmupSeconds),
                            NGNE_DURATION_SECONDS: String(options.durationSeconds),
                            NGNE_CDP_PORT: String(options.baseCdpPort + index),
                            NGNE_SERVE_DIR: repository,
                            NGNE_SERVE_OUT_DIR: build,
                            NGNE_EXPECTED_BUILD: join(repository, build),
                            NGNE_EXPECTED_BACKEND: "webgpu",
                            NGNE_ARTIFACT_DIR: diagnostics(name),
                            ...(options.diagnostics
                                ? {
                                      NGNE_ALLOCATION_SAMPLING: "1",
                                      NGNE_SNAPSHOTS: "1",
                                      NGNE_TRACE: "1",
                                  }
                                : {}),
                        },
                    );
                    verifyIdentities(join(repository, build), buildFiles);
                }
            }
            run.manifest.preparation = "prepared";
        } finally {
            if (
                options.compact &&
                run.manifest.preparation === "prepared" &&
                !run.result.failures.length
            )
                run.cleanup.push([
                    "benchmark diagnostics compaction",
                    () => {
                        if (run.result.cleanupRecords.some((record) => record.status === "failed"))
                            return;
                        compactRun(run);
                    },
                ]);
        }
    });
    return run;
}
