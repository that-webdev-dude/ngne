import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { cpus, totalmem } from "node:os";
import { fileURLToPath } from "node:url";
import { build, version as viteVersion } from "vite";
import { Run } from "../../../core/run.js";
import { serve } from "../../../core/server.js";
import { BrowserSession } from "../../../core/browser/session.js";
import { hash, identities } from "../../../evidence/identity.js";
import { summarizeFrames, visibleWindow, type FrameMeasurements } from "./investigation-summary.js";
import { investigationCase } from "./investigation-case.js";
import { instrumentPreparation } from "./preparation-transform.js";

// Explicit fixture selection: engine fixtures never discover or import a consumer.
const [rootArg, entry, casesArg = "count=64000", repeatsArg = "5"] = process.argv.slice(2);
if (!rootArg || !entry)
    throw Error("Usage: investigate.ts <root> <html-entry> <query;query> [repeats]");
const root = resolve(rootArg),
    repeats = Number(repeatsArg);
const warmup = Number(process.env.NGNE_WARMUP_SECONDS ?? 10);
const duration = Number(process.env.NGNE_DURATION_SECONDS ?? 20);
const profile = process.env.NGNE_DIAGNOSTICS === "1";
const preventBackgrounding = process.env.NGNE_NO_BACKGROUNDING === "1";
const stages = process.env.NGNE_PREPARATION_STAGES === "1";
const minify = process.env.NGNE_MINIFY === "1";
// Compare an exact retained renderer source without mutating the working tree.
const frameSourcePath = process.env.NGNE_FRAME_SOURCE;
const frameSource = frameSourcePath ? readFileSync(resolve(frameSourcePath), "utf8") : undefined;
if (
    ![repeats, warmup, duration].every(Number.isFinite) ||
    !Number.isInteger(repeats) ||
    repeats < 1 ||
    warmup < 0 ||
    duration <= 0
)
    throw Error("Invalid measurement settings");
const cases = casesArg.split(";");
const run = new Run(process.cwd(), "performance-investigation");
console.log(run.root);
const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
run.manifest.provenance = {
    revision,
    changes: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
};
run.manifest.harness = identities(dirname(fileURLToPath(import.meta.url)));
run.manifest.policy = {
    branch: execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim(),
    root,
    entry,
    cases,
    repeats,
    warmup,
    duration,
    profile,
    preventBackgrounding,
    stages,
    minify,
    diagnosticPatch: execFileSync("git", ["diff", "--no-ext-diff"], { encoding: "utf8" }),
    cpu: cpus()[0]?.model,
    memory: totalmem(),
    purpose:
        "controlled source comparison; run acceptance validates evidence, not candidate success",
    comparisonLabel: process.env.NGNE_COMPARISON_LABEL ?? null,
    frameSourcePath: frameSourcePath ?? null,
    frameSourceSha256: frameSource === undefined ? null : hash(frameSource),
    gpuExecution: "not measured",
    viteVersion,
    bundlerLockSha256: hash(readFileSync(join(process.cwd(), "package-lock.json"))),
};
const result = await run.execute(async () => {
    const output = join(run.root, "build");
    const modules: Record<string, string> = {};
    await run.stage("build", async () => {
        await build({
            root,
            configFile: false,
            logLevel: "warn",
            plugins: [
                {
                    name: "measurement-identities",
                    enforce: "pre",
                    transform(code, id) {
                        const replaceFrame =
                            frameSource !== undefined &&
                            id.replaceAll("\\", "/").endsWith("/src/renderer.ts");
                        if (replaceFrame) code = frameSource;
                        if (!id.startsWith("\0") && !id.includes("?"))
                            modules[id.replaceAll("\\", "/")] = hash(code);
                        if (stages && id.replaceAll("\\", "/").endsWith("/src/quad-renderer.ts")) {
                            const transformed = instrumentPreparation(
                                code,
                                join(
                                    dirname(fileURLToPath(import.meta.url)),
                                    "preparation-diagnostics.ts",
                                ).replaceAll("\\", "/"),
                            );
                            run.record("build-instrumentation", "observations", {
                                source: code,
                                transformed,
                                sourceSha256: hash(code),
                                transformedSha256: hash(transformed),
                                purpose: "Boundary timers only; unchanged baseline algorithms",
                            });
                            return { code: transformed, map: null };
                        }
                        if (replaceFrame) return { code, map: null };
                    },
                },
            ],
            resolve:
                root === resolve(process.cwd())
                    ? { alias: { "@ngne/core": resolve(root, "src/index.ts") } }
                    : undefined,
            build: {
                outDir: output,
                emptyOutDir: false,
                minify,
                sourcemap: true,
                rollupOptions: { input: resolve(root, entry) },
            },
        });
        run.record("build", "observations", {
            modules,
            rendererSource: frameSource ?? readFileSync(join(root, "src/renderer.ts"), "utf8"),
            build: identities(output),
            lockSha256: hash(readFileSync(join(root, "package-lock.json"))),
            harnessSources: Object.fromEntries(
                Object.keys(run.manifest.harness)
                    .filter((path) => /\.(ts|html|json)$/.test(path))
                    .map((path) => [
                        path,
                        readFileSync(join(dirname(fileURLToPath(import.meta.url)), path), "utf8"),
                    ]),
            ),
        });
        run.manifest.preparation = "prepared";
    });
    const origin = await serve(run, output, "/");
    for (let repeat = 0; repeat < repeats; repeat++) {
        for (const query of repeat % 2 ? [...cases].reverse() : cases) {
            const id = `r${repeat + 1}-c${cases.indexOf(query) + 1}`;
            const folder = join(run.evidence, "stages", id);
            mkdirSync(folder, { recursive: true });
            const session = new BrowserSession();
            let payload: Record<string, unknown> | undefined;
            const errors: unknown[] = [];
            const passed = await investigationCase(
                run,
                id,
                session,
                async () => {
                    const page = await session.start({
                        flags: [
                            "--no-first-run",
                            "--no-default-browser-check",
                            "--window-size=1500,1100",
                            "--enable-precise-memory-info",
                            ...(preventBackgrounding
                                ? [
                                      "--disable-background-timer-throttling",
                                      "--disable-renderer-backgrounding",
                                      "--disable-backgrounding-occluded-windows",
                                  ]
                                : []),
                        ],
                        log: join(folder, "browser.log"),
                    });
                    page.on("Runtime.exceptionThrown", (event) => errors.push(event));
                    await page.send("Page.enable");
                    await page.send("Runtime.enable");
                    await page.send("Page.navigate", { url: `${origin}${entry}?${query}` });
                    await page.send("Page.bringToFront");
                    const deadline = Date.now() + 60000;
                    while (!(await page.evaluate<boolean>("!!window.__investigation?.ready"))) {
                        const error = await page.evaluate<string | undefined>(
                            "window.__investigation?.error || document.body?.dataset.rendererBenchmarkError",
                        );
                        if (error || errors.length || Date.now() > deadline)
                            throw Error(`Fixture startup: ${error ?? JSON.stringify(errors)}`);
                        await new Promise((resolve) => setTimeout(resolve, 200));
                    }
                    const browser = await session.browserConnection();
                    session.cleanup.unshift([
                        "browser graceful close",
                        async () => {
                            await browser.send("Browser.close");
                        },
                    ]);
                    const gpu = await browser.send("SystemInfo.getInfo");
                    const version = await browser.send("Browser.getVersion");
                    const adapter = await page.evaluate<{
                        description: string;
                        isFallbackAdapter: boolean;
                    }>(`(async () => {
                        const adapter = await navigator.gpu.requestAdapter();
                        if (!adapter) throw Error('No adapter');
                        const info = adapter.info;
                        return { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description, isFallbackAdapter: info.isFallbackAdapter, dpr: devicePixelRatio, viewport: [innerWidth, innerHeight] };
                    })()`);
                    if (
                        adapter.isFallbackAdapter ||
                        /SwiftShader|WARP|llvmpipe|Basic Render/i.test(adapter.description)
                    )
                        throw Error("Software GPU is not a performance baseline");
                    const finiteReplay = new URLSearchParams(query).get("workload") === "chaos";
                    if (finiteReplay && profile)
                        throw Error("Chaos finite replay does not support sampled profiles");
                    if (!finiteReplay)
                        await new Promise((resolve) => setTimeout(resolve, warmup * 1000));
                    if (profile) {
                        await page.send("Performance.enable");
                        await page.send("HeapProfiler.enable");
                        await page.send("HeapProfiler.startSampling", {
                            samplingInterval: 16384,
                            includeObjectsCollectedByMajorGC: true,
                            includeObjectsCollectedByMinorGC: true,
                        });
                        await page.send("Profiler.enable");
                        await page.send("Profiler.setSamplingInterval", { interval: 1000 });
                        await page.send("Profiler.start");
                    }
                    const begin = await page.evaluate<number>("performance.now()");
                    const performanceBegin = profile
                        ? await page.send("Performance.getMetrics")
                        : undefined;
                    console.log(
                        `${id} ${query}: sampling ${duration}s${profile ? " (profiled)" : ""}`,
                    );
                    if (finiteReplay) {
                        const replayDeadline = Date.now() + 120000;
                        while (!(await page.evaluate<boolean>("window.__investigation.done"))) {
                            if (Date.now() > replayDeadline || errors.length)
                                throw Error("Chaos replay failed or timed out");
                            await new Promise((resolve) => setTimeout(resolve, 250));
                        }
                    } else await new Promise((resolve) => setTimeout(resolve, duration * 1000));
                    const end = await page.evaluate<number>("performance.now()");
                    const performanceEnd = profile
                        ? await page.send("Performance.getMetrics")
                        : undefined;
                    if (profile) {
                        writeFileSync(
                            join(folder, "cpu-profile.json"),
                            JSON.stringify(await page.send("Profiler.stop")),
                        );
                        writeFileSync(
                            join(folder, "allocation-profile.json"),
                            JSON.stringify(await page.send("HeapProfiler.stopSampling")),
                        );
                    }
                    const snapshot = await page.evaluate<
                        Pick<FrameMeasurements, "columns" | "samples"> & Record<string, unknown>
                    >("window.__investigation");
                    const sampleWindow = finiteReplay
                        ? await page.evaluate<{ begin: number; end: number }>(
                              "({begin: window.__investigation.sampleBegin, end: window.__investigation.sampleEnd})",
                          )
                        : { begin, end };
                    payload = {
                        ...snapshot,
                        ...sampleWindow,
                        query,
                        repeat: repeat + 1,
                        profile,
                        gpu,
                        version,
                        adapter,
                        performanceBegin,
                        performanceEnd,
                        summary: summarizeFrames({ ...snapshot, ...sampleWindow }),
                    };
                    const visibility = await page.evaluate<string>("document.visibilityState");
                    const measuredVisibility = visibleWindow(
                        snapshot.visibilityEvents,
                        sampleWindow.begin,
                        sampleWindow.end,
                    );
                    payload.measuredVisibility = measuredVisibility;
                    if (
                        visibility !== "visible" ||
                        (measuredVisibility === null ? payload.hidden : !measuredVisibility) ||
                        payload.error ||
                        errors.length
                    )
                        throw Error(
                            `Invalid sample: ${JSON.stringify({ visibility, hidden: payload.hidden, error: payload.error, errors })}`,
                        );
                    await session.screenshot(join(folder, "frame.png"));
                },
                () => ({ ...payload, errors }),
            );
            if (!passed) return;
        }
    }
});
console.log(
    JSON.stringify({
        evidence: run.evidence,
        accepted: result.accepted,
        failures: result.failures,
    }),
);
if (!result.accepted) process.exitCode = 1;
