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
import { summarizeFrames, type FrameMeasurements } from "./investigation-summary.js";

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
    root,
    entry,
    cases,
    repeats,
    warmup,
    duration,
    profile,
    preventBackgrounding,
    cpu: cpus()[0]?.model,
    memory: totalmem(),
    purpose: "exploratory attribution; no optimization or performance acceptance",
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
                    transform(code, id) {
                        if (!id.startsWith("\0") && !id.includes("?"))
                            modules[id.replaceAll("\\", "/")] = hash(code);
                    },
                },
            ],
            build: {
                outDir: output,
                emptyOutDir: false,
                minify: false,
                sourcemap: true,
                rollupOptions: { input: resolve(root, entry) },
            },
        });
        run.record("build", "observations", {
            modules,
            build: identities(output),
            lockSha256: hash(readFileSync(join(root, "package-lock.json"))),
        });
        run.manifest.preparation = "prepared";
    });
    const origin = await serve(run, output, "/");
    for (let repeat = 0; repeat < repeats; repeat++) {
        for (const query of repeat % 2 ? [...cases].reverse() : cases) {
            const id = `r${repeat + 1}-c${cases.indexOf(query) + 1}`;
            await run.stage(id, async () => {
                const folder = join(run.evidence, "stages", id);
                mkdirSync(folder, { recursive: true });
                const session = new BrowserSession();
                let payload: Record<string, unknown> | undefined;
                const errors: unknown[] = [];
                try {
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
                    await new Promise((resolve) => setTimeout(resolve, duration * 1000));
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
                    payload = {
                        ...snapshot,
                        begin,
                        end,
                        query,
                        repeat: repeat + 1,
                        profile,
                        gpu,
                        version,
                        adapter,
                        performanceBegin,
                        performanceEnd,
                        summary: summarizeFrames({ ...snapshot, begin, end }),
                    };
                    const visibility = await page.evaluate<string>("document.visibilityState");
                    if (
                        visibility !== "visible" ||
                        payload.hidden ||
                        payload.error ||
                        errors.length
                    )
                        throw Error(
                            `Invalid sample: ${JSON.stringify({ visibility, hidden: payload.hidden, error: payload.error, errors })}`,
                        );
                    await session.screenshot(join(folder, "frame.png"));
                } finally {
                    const cleanup = await session.close();
                    run.record(id, "measurements", { ...payload, errors, cleanup });
                    if (cleanup.some((record) => record.status === "failed"))
                        throw Error("Browser cleanup failed");
                }
            });
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
