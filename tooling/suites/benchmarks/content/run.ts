import { appendFileSync, cpSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { cpus, totalmem } from "node:os";
import { Run } from "../../../core/run.js";
import { prepare, verifyPrepared } from "../../../core/preparation.js";
import { installFixture } from "../../../core/fixture.js";
import { BrowserSession } from "../../../core/browser/session.js";
import { serve } from "../../../core/server.js";
import { hash, identities, verifyIdentities } from "../../../evidence/identity.js";
import { generate } from "./fixtures.js";
import { readMeasurement } from "./measurement.js";
import { environmentMismatches, loadProfile, readBudget } from "./policy.js";
import { object } from "../../../evidence/schema.js";
import { isDeepStrictEqual } from "node:util";

export async function content(
    repository: string,
    options: {
        manifest?: string;
        output?: string;
        smoke?: boolean;
        mode?: "exploratory" | "baseline" | "controlled";
        profile?: string;
        budget?: string;
    } = {},
): Promise<Run> {
    const run = new Run(repository, "content-engine", options.output);
    const session = new BrowserSession();
    run.cleanup.push(["browser session", () => session.stop()]);
    await run.execute(
        async () => {
            const mode = options.mode ?? "exploratory";
            if (
                mode !== "exploratory" &&
                (options.smoke || !options.profile || process.env.NGNE_BROWSER_HEADLESS === "1")
            )
                throw Error(
                    "Baseline/controlled measurement requires a named profile and full headed execution",
                );
            const profile = options.profile ? loadProfile(repository, options.profile) : undefined;
            const budget = options.budget
                ? readBudget(JSON.parse(readFileSync(options.budget, "utf8")))
                : undefined;
            if ((mode === "controlled") !== !!budget || (mode === "exploratory" && profile))
                throw Error("Invalid measurement mode/profile/budget selection");
            if (budget && !isDeepStrictEqual(budget.profile, profile))
                throw Error("Budget profile mismatch");
            let manifestPath = options.manifest;
            await run.stage("preparation", async () => {
                if (!manifestPath) {
                    const prepared = await prepare(repository, join(run.root, "preparation"));
                    if (!prepared.result.accepted)
                        throw Error(
                            `Package preparation failed: ${JSON.stringify(prepared.result.failures)}`,
                        );
                    manifestPath = join(prepared.evidence, "manifest.json");
                }
                verifyPrepared(manifestPath);
            });
            if (!manifestPath) throw Error("Missing preparation");
            const selected = resolve(manifestPath),
                manifest = verifyPrepared(selected),
                pkg = manifest.prepared!.package;
            run.manifest.provenance = manifest.provenance;
            const count = options.smoke ? 12 : 120,
                repetitions = options.smoke ? 1 : 3;
            const flags = [
                "--no-first-run",
                "--disable-default-apps",
                "--disable-dev-shm-usage",
                "--disable-background-timer-throttling",
                "--disable-renderer-backgrounding",
                "--disable-backgrounding-occluded-windows",
                "--window-size=1280,900",
                "--enable-precise-memory-info",
            ];
            if (process.env.NGNE_BROWSER_HEADLESS === "1") flags.push("--headless=new");
            if (process.platform === "linux") flags.push("--no-sandbox");
            run.manifest.policy = {
                mode,
                profile: profile ?? null,
                budget: budget ?? null,
                workload: "engine-resource-churn-v1",
                seed: 1,
                assetGenerator: "deterministic-index-pattern-png-v1",
                method: "prepare-to-mounted-and-rendered-ordinary-frames-v1",
                count,
                repetitions,
                warmup: 12,
                scenes: 12,
                generatedImages: 13,
                retention: { maxEntries: 3, maxBytes: 1048576 },
                budgets: budget
                    ? { p95Ms: budget.p95Ms, sourceSHA256: hash(readFileSync(options.budget!)) }
                    : "not evaluated",
                preparationManifest: selected,
                preparationManifestSHA256: hash(readFileSync(selected)),
                preparationRunId: manifest.runId,
                packageSHA256: pkg.sha256,
                browserFlags: flags,
                smoke: !!options.smoke,
                manualVisual: "not evaluated",
                manualAudible: "not evaluated",
            };
            run.manifest.policy.hardware = {
                cpus: cpus().map((cpu) => ({ model: cpu.model, speed: cpu.speed })),
                totalMemory: totalmem(),
            };
            run.manifest.harness = Object.fromEntries(
                [
                    "tooling/core",
                    "tooling/evidence",
                    "tooling/suites/benchmarks/content",
                    "tooling/fixtures/content-engine",
                ].flatMap((directory) =>
                    Object.entries(identities(join(repository, directory))).map(([p, h]) => [
                        `${directory}/${p}`,
                        h,
                    ]),
                ),
            );
            for (const path of [
                "tests/tooling/cleanup.mjs",
                "tests/tooling/devtools.mjs",
                "tooling/commands/benchmark.ts",
                "package-lock.json",
                "node_modules/vite/package.json",
                "node_modules/esbuild/package.json",
                "tooling/fixtures/installed-engine/api-misuse.ts",
                "tooling/fixtures/installed-engine/tone.wav",
            ])
                run.manifest.harness[path] = hash(readFileSync(join(repository, path)));
            await run.stage("fixture", async () => {
                mkdirSync(join(run.root, "evidence/package"));
                cpSync(join(dirname(dirname(selected)), pkg.path), join(run.root, pkg.path));
                const source = join(run.root, "work/authored");
                mkdirSync(dirname(source), { recursive: true });
                generate(repository, source);
                run.manifest.prepared = await installFixture(run, repository, pkg, {
                    source,
                    files: ["index.ts"],
                });
                run.manifest.preparation = "prepared";
            });
            const prepared = run.manifest.prepared!;
            run.manifest.policy.budgetSignature = hash(
                JSON.stringify({
                    workload: prepared.workload.files,
                    harness: run.manifest.harness,
                    toolchain: prepared.toolchain,
                    count,
                    repetitions,
                    warmup: 12,
                    seed: 1,
                    assetGenerator: run.manifest.policy.assetGenerator,
                    method: run.manifest.policy.method,
                    retention: run.manifest.policy.retention,
                    flags,
                }),
            );
            if (budget && budget.signature !== run.manifest.policy.budgetSignature)
                throw Error(
                    "Budget workload/harness/method/toolchain drift; establish a new measured baseline",
                );
            const verify = () => {
                for (const [path, sha256] of Object.entries(run.manifest.harness))
                    if (hash(readFileSync(join(repository, path))) !== sha256)
                        throw Error(`Changed benchmark harness: ${path}`);
                verifyPrepared(selected);
                if (hash(readFileSync(join(run.root, pkg.path))) !== pkg.sha256)
                    throw Error("Changed benchmark package");
                for (const tree of [
                    prepared.installed,
                    prepared.workload,
                    prepared.dependencies,
                    prepared.builds.root,
                    prepared.builds.nested,
                ])
                    verifyIdentities(join(run.root, tree.path), tree.files);
                for (const file of ["package.json", "package-lock.json"])
                    if (
                        hash(readFileSync(join(run.root, "work/installation", file))) !==
                        prepared.dependencies.files[file]
                    )
                        throw Error(`Changed installation ${file}`);
            };
            verify();
            const client = await session.start({
                flags,
                profileParent: join(run.root, "work"),
                log: join(run.evidence, "browser.log"),
                transport: { requestTimeoutMs: 180000 },
            });
            await client.send("Runtime.enable");
            await client.send("Page.enable");
            await client.send("Emulation.setDeviceMetricsOverride", {
                width: 1280,
                height: 900,
                deviceScaleFactor: 1,
                mobile: false,
            });
            client.on("Runtime.exceptionThrown", (value) =>
                appendFileSync(join(run.evidence, "exceptions.log"), JSON.stringify(value) + "\n"),
            );
            const browser = object(await client.send("Browser.getVersion"));
            run.manifest.policy.browserVersion = browser;
            for (let repetition = 0; repetition < repetitions; repetition++)
                await run.stage(`repetition-${repetition}`, async () => {
                    verify();
                    const base = repetition % 2 ? "nested" : "root",
                        build = join(run.root, `work/build-${repetition}`);
                    cpSync(join(run.root, prepared.builds[base].path), build, { recursive: true });
                    verifyIdentities(build, prepared.builds[base].files);
                    const url = await serve(run, build, base === "root" ? "/" : "/nested/");
                    await client.send("Page.navigate", { url });
                    const end = Date.now() + 20000;
                    while (
                        !(await client.evaluate<boolean>(
                            `location.href === ${JSON.stringify(url)} && document.readyState === 'complete' && Boolean(window.contentEngine)`,
                        ))
                    ) {
                        if (Date.now() > end) throw Error("Workload readiness deadline");
                        await new Promise((resolve) => setTimeout(resolve, 100));
                    }
                    const raw = await client.evaluate(`window.contentEngine.run(${count})`, true);
                    run.record(`repetition-${repetition}`, "measurements", { raw, base });
                    const metrics = readMeasurement(raw, count);
                    const environment = object(object(raw).environment);
                    const observed = {
                        ...run.manifest.environment,
                        cpu: cpus()[0]?.model,
                        logicalCores: cpus().length,
                        totalMemory: totalmem(),
                        browserProduct: browser.product,
                        browserRevision: browser.revision,
                        browserUserAgent: browser.userAgent,
                        flags,
                        headless: flags.includes("--headless=new"),
                        viewport: environment.viewport,
                        dpr: environment.dpr,
                        visibility: environment.visibility,
                        gpu: Array.isArray(environment.gpu) ? environment.gpu[0] : null,
                    };
                    const mismatches = profile ? environmentMismatches(profile, observed) : [];
                    if (profile && Array.isArray(environment.gpu))
                        for (const gpu of environment.gpu)
                            if (!isDeepStrictEqual(gpu, profile.expected.gpu))
                                mismatches.push(
                                    "environment.gpu: adapter changed within repetition",
                                );
                    run.record(`repetition-${repetition}`, "measurements", {
                        raw,
                        base,
                        metrics,
                        observed,
                        environmentMismatches: mismatches,
                        metric: {
                            name: "transition latency",
                            unit: "ms",
                            operation: "prepare through ordinary mounted/rendered frame",
                            warmup: 12,
                            population: count,
                            aggregation: "nearest-rank p50/p95/max",
                            instrumentation:
                                "fixture observer and 10 ms polling; performance.memory estimates",
                        },
                        budget: budget
                            ? { p95Ms: budget.p95Ms, passed: metrics.p95 <= budget.p95Ms }
                            : null,
                    });
                    if (mismatches.length) throw Error(mismatches.join("\n"));
                    if (budget)
                        run.result.stages.find(
                            (stage) => stage.id === `repetition-${repetition}`,
                        )!.budgets = metrics.p95 <= budget.p95Ms ? "passed" : "failed";
                    verify();
                    verifyIdentities(build, prepared.builds[base].files);
                });
        },
        async () => {
            await session.screenshot(join(run.evidence, "failure.png"));
        },
    );
    return run;
}
