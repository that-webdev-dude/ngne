// BrowserSession supplies "--remote-debugging-port" and "--user-data-dir"; these launch options remain supported.
import { BrowserSession, browserExecutable } from "../../tooling/core/browser/session.js";
import { execSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

/**
 * Sustained browser measurement in a real headful Chromium, driven over the DevTools
 * protocol so the same warmup, duration and sampling can be repeated later.
 *
 * Usage: `npx tsx benchmarks/browser/browser-baseline.ts` against a running `npm run preview`.
 * The renderer fixture uses `/benchmarks/browser/index.html?workload=renderer-webgpu` from the
 * browser-mode build instead of the production preview.
 * Environment: NGNE_BROWSER (Chromium executable), NGNE_URL (default preview origin),
 * NGNE_WARMUP_SECONDS (default 10), NGNE_DURATION_SECONDS (default 60).
 * The browser window must stay visible; hidden tabs throttle requestAnimationFrame.
 *
 * Optional measurement controls (NGNE-12); without them the run and its output fields are unchanged:
 * - NGNE_CDP_PORT: DevTools port (default 9333). Each run gets a fresh profile directory.
 * - NGNE_SERVE_DIR: export root whose `vite preview` the run starts on the NGNE_URL port with
 *   `--strictPort` and NGNE_SERVE_OUT_DIR (default `dist`), and terminates afterwards.
 * - NGNE_EXPECTED_BUILD: build directory the served HTML, JS and CSS must match byte for byte
 *   before warmup (defaults to the served directory with NGNE_SERVE_DIR); a mismatch aborts.
 * - NGNE_EXPECTED_BACKEND: `webgl2` or `webgpu`; the page canvas context must match, and a
 *   software renderer or fallback adapter aborts.
 * - NGNE_ALLOCATION_SAMPLING=1: DevTools allocation sampling over the sample window in game modes
 *   (the renderer fixture always samples).
 * - NGNE_CYCLES=N (multiple of 10): scene and asset cycle mode instead of a timed sample; forced GC
 *   and retained heap every N/10 cycles, heap snapshots after the first and last checkpoints.
 * - NGNE_SNAPSHOTS=1: heap snapshots after the forced GC at sample start and end.
 * - NGNE_TRACE=1: browser trace over the sample window (GPU process, frames and V8 GC).
 * - NGNE_RETAINED_EVERY_SECONDS=S: forced-GC retained-heap checkpoints during the sample.
 * - NGNE_ARTIFACT_DIR: directory for profiles, snapshots and traces (default: a retained temporary artifact directory).
 * - NGNE_BROWSER_HEADLESS=1: explicit headless capability smoke; never a visible performance baseline.
 * Every artifact must parse as JSON with a non-zero node or event count, or the run aborts.
 */
const BROWSER = browserExecutable(),
    URL_UNDER_TEST = process.env.NGNE_URL ?? "http://127.0.0.1:4173/",
    WARMUP_SECONDS = Number(process.env.NGNE_WARMUP_SECONDS ?? 10),
    DURATION_SECONDS = Number(process.env.NGNE_DURATION_SECONDS ?? 60),
    DEBUG_PORT = Number(process.env.NGNE_CDP_PORT ?? 9333),
    SERVE_DIR = process.env.NGNE_SERVE_DIR,
    SERVE_OUT_DIR = process.env.NGNE_SERVE_OUT_DIR ?? "dist",
    EXPECTED_BUILD =
        process.env.NGNE_EXPECTED_BUILD ?? (SERVE_DIR ? join(SERVE_DIR, SERVE_OUT_DIR) : undefined),
    EXPECTED_BACKEND = process.env.NGNE_EXPECTED_BACKEND,
    SAMPLES_ALLOCATIONS = process.env.NGNE_ALLOCATION_SAMPLING === "1",
    CYCLES = Number(process.env.NGNE_CYCLES ?? 0),
    TAKES_SNAPSHOTS = process.env.NGNE_SNAPSHOTS === "1",
    RECORDS_TRACE = process.env.NGNE_TRACE === "1",
    RETAINED_EVERY_SECONDS = Number(process.env.NGNE_RETAINED_EVERY_SECONDS ?? 0),
    ORACLE_TIMEOUT_MS = 20_000,
    SAMPLING_INTERVAL_BYTES = 32768,
    CDP_TIMEOUT_MS = 180_000;
const WORKLOAD = new URL(URL_UNDER_TEST).searchParams.get("workload");
const IS_PLATFORMER = new URL(URL_UNDER_TEST).pathname.includes("/examples/platformer/");
const IS_RENDERER = WORKLOAD === "renderer-webgpu";
const SOFTWARE_RENDERER = /SwiftShader|WARP|llvmpipe|Basic Render/i;
// Chrome 152 categories proven to align GPU-process events with rAF frames (NGNE-12 phase 0).
const TRACE_CATEGORIES = [
    "devtools.timeline",
    "gpu",
    "gpu.angle",
    "disabled-by-default-gpu.dawn",
    "disabled-by-default-devtools.timeline.frame",
    "v8",
    "disabled-by-default-v8.gc",
];
if (EXPECTED_BACKEND && EXPECTED_BACKEND !== "webgl2" && EXPECTED_BACKEND !== "webgpu")
    throw new Error(`Unknown NGNE_EXPECTED_BACKEND ${EXPECTED_BACKEND}`);
if (WORKLOAD && !IS_RENDERER) throw new Error(`Unknown browser benchmark workload ${WORKLOAD}`);
if (CYCLES && (IS_RENDERER || CYCLES % 10 !== 0 || RETAINED_EVERY_SECONDS))
    throw new Error("NGNE_CYCLES needs a game page, a multiple of 10 and no retained interval");
const HOOK = `(() => {
    const raw = window.requestAnimationFrame.bind(window);
    const b = (window.__ngneBaseline = { frames: [], heap: [], longTasks: 0, longTaskStarts: [], visibility: [] });
    window.requestAnimationFrame = (callback) =>
        raw((timestamp) => {
            const start = performance.now();
            try {
                callback(timestamp);
            } finally {
                b.frames.push(timestamp, start, performance.now() - start);
            }
        });
    new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
            b.longTasks++;
            b.longTaskStarts.push(entry.startTime);
        }
    }).observe({ entryTypes: ["longtask"] });
    document.addEventListener("visibilitychange", () =>
        b.visibility.push([performance.now(), document.visibilityState]),
    );
    setInterval(() => {
        const m = performance.memory;
        b.heap.push(performance.now(), m.usedJSHeapSize, m.totalJSHeapSize);
    }, 250);
})();`;
const SUMMARY = `(async (startMs, endMs) => {
    const b = window.__ngneBaseline;
    const summarize = (values) => {
        const s = [...values].sort((a, b) => a - b);
        const at = (f) => s[Math.min(s.length - 1, Math.floor(s.length * f))];
        return {
            count: s.length,
            min: s[0],
            p50: at(0.5),
            p90: at(0.9),
            p95: at(0.95),
            p99: at(0.99),
            max: s[s.length - 1],
            mean: s.reduce((sum, v) => sum + v, 0) / s.length,
        };
    };
    const callbackMs = [], intervalMs = [];
    let previous;
    for (let i = 0; i < b.frames.length; i += 3) {
        const timestamp = b.frames[i], start = b.frames[i + 1], duration = b.frames[i + 2];
        if (start < startMs || start >= endMs) continue;
        callbackMs.push(duration);
        if (previous !== undefined) intervalMs.push(timestamp - previous);
        previous = timestamp;
    }
    const heap = [];
    for (let i = 0; i < b.heap.length; i += 3)
        if (b.heap[i] >= startMs && b.heap[i] < endMs) heap.push([b.heap[i + 1], b.heap[i + 2]]);
    let reclaimed = 0, collections = 0;
    for (let i = 1; i < heap.length; i++)
        if (heap[i][0] < heap[i - 1][0]) {
            collections++;
            reclaimed += heap[i - 1][0] - heap[i][0];
        }
    const used = heap.map((h) => h[0]);
    const adapter = await navigator.gpu?.requestAdapter();
    return {
        browser: navigator.userAgent,
        gpu: adapter
            ? {
                  vendor: adapter.info.vendor,
                  architecture: adapter.info.architecture,
                  device: adapter.info.device,
                  description: adapter.info.description,
                  isFallbackAdapter: adapter.info.isFallbackAdapter,
              }
            : null,
        devicePixelRatio: devicePixelRatio,
        viewport: [innerWidth, innerHeight],
        frameCallbackMs: summarize(callbackMs),
        frameIntervalMs: summarize(intervalMs),
        intervalsOver25Ms: intervalMs.filter((v) => v > 25).length,
        intervalsOver50Ms: intervalMs.filter((v) => v > 50).length,
        longTasks: b.longTasks,
        longTasksInSample: b.longTaskStarts.filter((t) => t >= startMs && t < endMs).length,
        visibilityChanges: b.visibility,
        heapUsedMiB: {
            samples: used.length,
            min: Math.min(...used) / 2 ** 20,
            max: Math.max(...used) / 2 ** 20,
            last: used[used.length - 1] / 2 ** 20,
        },
        heapTotalMiBMax: Math.max(...heap.map((h) => h[1])) / 2 ** 20,
        collections,
        reclaimedMiB: reclaimed / 2 ** 20,
        reclaimedMiBPerSecond: reclaimed / 2 ** 20 / ((endMs - startMs) / 1000),
    };
})`;
const READ_UI = `({
    status: document.getElementById("engine-status")?.textContent ?? document.getElementById("game")?.dataset.droppedTicks ?? "0",
    flight: document.getElementById("flight-state")?.textContent ?? [document.getElementById("progress")?.textContent, document.getElementById("status")?.textContent].filter(Boolean).join(" · "),
    sprites: document.getElementById("sprites")?.textContent ?? document.getElementById("game")?.dataset.sprites ?? "",
    fps: document.getElementById("fps")?.textContent ?? document.getElementById("game")?.dataset.fps ?? "",
    error: document.getElementById("error")?.textContent ?? "",
    visibility: document.visibilityState,
    now: performance.now(),
})`;
// Reads the page canvas's existing context type (getContext with the other type returns null and
// creates nothing), a probe canvas WebGL renderer string and the WebGPU adapter.
const READ_BACKEND = `(async () => {
    const canvas = document.getElementById("game") ?? document.querySelector("canvas");
    const pageContext = !canvas ? "none" : canvas.getContext("webgpu") ? "webgpu" : canvas.getContext("webgl2") ? "webgl2" : "none";
    const probe = document.createElement("canvas").getContext("webgl2");
    const extension = probe?.getExtension("WEBGL_debug_renderer_info");
    const webglRenderer = extension ? probe.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null;
    probe?.getExtension("WEBGL_lose_context")?.loseContext();
    const adapter = await navigator.gpu?.requestAdapter();
    return {
        pageContext,
        webglRenderer,
        adapter: adapter ? {
            vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device,
            description: adapter.info.description, isFallbackAdapter: adapter.info.isFallbackAdapter,
            features: [...adapter.features].sort(),
        } : null,
    };
})()`;
const STATUS = `document.getElementById("status")?.textContent`;
const FLIGHT = `document.getElementById("flight-state")?.textContent`;
const DEATHS = `Number(/Deaths (\\d+)/.exec(document.getElementById("progress")?.textContent ?? "")?.[1])`;
interface UiSnapshot {
    status: string;
    flight: string;
    sprites: string;
    fps: string;
    error: string;
    visibility: string;
    now: number;
}
interface Page {
    send(method: string, params?: object): Promise<unknown>;
    evaluate<T>(expression: string): Promise<T>;
    on(event: string, handler: (params: unknown) => void): () => void;
    once(event: string): Promise<unknown>;
    close(): void;
}
interface Backend {
    pageContext: string;
    webglRenderer: string | null;
    adapter: { description: string; isFallbackAdapter: boolean } | null;
}
interface CycleStep {
    action: string;
    run(page: Page): Promise<void>;
    oracle(): string;
    dwellMs: number;
}
interface Artifact {
    path: string;
    bytes: number;
    sha256: string;
    count: number;
}
const artifactDir =
    process.env.NGNE_ARTIFACT_DIR ?? mkdtempSync(join(tmpdir(), "ngne-baseline-artifacts-"));
mkdirSync(artifactDir, { recursive: true });
const session = new BrowserSession();
const browserFlags = [
    "--no-first-run",
    "--no-default-browser-check",
    "--enable-precise-memory-info",
    "--window-size=1280,900",
    ...(process.env.NGNE_BROWSER_HEADLESS === "1" ? ["--headless=new"] : []),
];
let preview: ChildProcess | undefined;
let browser: ChildProcess | undefined;
let page: Page | undefined;
let output: Record<string, unknown> | undefined;
try {
    if (SERVE_DIR) preview = await startPreview(SERVE_DIR);
    const servedBuild = EXPECTED_BUILD ? await checkServedBuild(EXPECTED_BUILD) : undefined;
    page = await session.start({
        executable: BROWSER,
        port: DEBUG_PORT,
        flags: browserFlags,
        transport: { requestTimeoutMs: CDP_TIMEOUT_MS },
        log: join(artifactDir, "browser.log"),
    });
    browser = session.browser!;
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("HeapProfiler.enable");
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK });
    await page.send("Page.navigate", { url: URL_UNDER_TEST });
    await page.send("Page.bringToFront");
    const observedBrowser = await page.send("Browser.getVersion");
    if (IS_RENDERER) {
        await waitFor(
            page,
            `document.body?.dataset.rendererBenchmarkReady === "true" || document.body?.dataset.rendererBenchmarkError !== undefined`,
        );
        const startupError = await page.evaluate<string | undefined>(
            "document.body?.dataset.rendererBenchmarkError",
        );
        if (startupError) throw new Error(`Renderer benchmark failed to start: ${startupError}`);
    } else if (IS_PLATFORMER) {
        await waitFor(page, `document.getElementById("start")?.textContent === "Start level 1"`);
        await click(page, "start");
        await waitFor(page, `document.getElementById("status")?.textContent !== "Ready"`);
        if (CYCLES) await waitFor(page, `${STATUS} === "Reach the blue gate"`);
    } else {
        await waitFor(page, `document.getElementById("play")?.textContent === "START FLIGHT"`);
        // Cycle mode starts from attract; its first step launches Chaos Lab.
        if (!CYCLES) {
            await click(page, "chaos");
            await waitFor(
                page,
                `document.getElementById("flight-state")?.textContent.includes("CHAOS")`,
            );
        }
    }
    const backend = await page.evaluate<Backend>(READ_BACKEND);
    if (EXPECTED_BACKEND) assertBackend(backend, EXPECTED_BACKEND);
    await sleep(WARMUP_SECONDS * 1000);
    await page.send("HeapProfiler.collectGarbage");
    const afterWarmup = await page.evaluate<number>("performance.memory.usedJSHeapSize");
    const snapshots: Record<string, Artifact> = {};
    if (TAKES_SNAPSHOTS) snapshots.sampleStart = await takeSnapshot(page, "sample-start");
    if (IS_RENDERER || SAMPLES_ALLOCATIONS)
        await page.send("HeapProfiler.startSampling", {
            samplingInterval: SAMPLING_INTERVAL_BYTES,
            includeObjectsCollectedByMajorGC: true,
            includeObjectsCollectedByMinorGC: true,
        });
    const trace = RECORDS_TRACE ? await startTrace() : undefined;
    const begin = await page.evaluate<UiSnapshot>(READ_UI);
    progress("sample started");
    const cycles = CYCLES ? await runCycles(page, snapshots) : undefined;
    const retainedCheckpoints = CYCLES ? undefined : await sampleWindow(page);
    const end = await page.evaluate<UiSnapshot>(READ_UI);
    progress("sample ended");
    const traceEvidence = trace ? await stopTrace(trace) : undefined;
    const summary = await page.evaluate<Record<string, unknown>>(
        `${SUMMARY}(${begin.now}, ${end.now})`,
    );
    progress("summary read");
    let rendererEvidence: unknown;
    let allocationEvidence: unknown;
    if (IS_RENDERER || SAMPLES_ALLOCATIONS) {
        const allocation = (await page.send("HeapProfiler.stopSampling")) as {
            profile: SamplingProfile;
        };
        progress("allocation sampling stopped");
        const allocationPath = join(artifactDir, "allocation-profile.json");
        const text = JSON.stringify(allocation);
        writeFileSync(allocationPath, text);
        allocationEvidence = summarizeAllocation(
            allocationPath,
            text,
            allocation.profile,
            (end.now - begin.now) / 1000,
        );
        if (IS_RENDERER) {
            const renderer = await page.evaluate<Record<string, unknown>>(`(() => {
            const b = window.__ngneRendererBenchmark;
            const prepare = [], submit = [], total = [];
            for (let i = 0; i < b.count; i++) {
                const offset = i * 3, time = b.samples[offset];
                if (time < ${begin.now} || time >= ${end.now}) continue;
                prepare.push(b.samples[offset + 1]); submit.push(b.samples[offset + 2]);
                total.push(b.samples[offset + 1] + b.samples[offset + 2]);
            }
            const summarize = values => {
                values.sort((a,b) => a-b);
                return { count: values.length, p50: values[Math.floor(values.length*.5)],
                    p95: values[Math.floor(values.length*.95)], p99: values[Math.floor(values.length*.99)] };
            };
            return { metadata:b.metadata, metrics:b.metrics, error:b.error,
                cpuPreparationMs:summarize(prepare),cpuSubmissionMs:summarize(submit),cpuTotalMs:summarize(total) };
        })()`);
            if (typeof renderer.error === "string" && renderer.error)
                throw new Error(`Renderer benchmark failed: ${renderer.error}`);
            rendererEvidence = {
                ...renderer,
                allocationPath,
                sampledAllocationSites: allocationSites(allocation.profile.head),
                timingBoundary:
                    "CPU preparation and submission only; no per-frame GPU completion wait",
            };
        }
    }
    await page.send("HeapProfiler.collectGarbage");
    const afterRun = await page.evaluate<number>("performance.memory.usedJSHeapSize");
    if (TAKES_SNAPSHOTS) snapshots.sampleEnd = await takeSnapshot(page, "sample-end");
    output = {
        revision: revision(),
        observedBrowser,
        url: URL_UNDER_TEST,
        workload: IS_RENDERER
            ? "Fixed 10,000-sprite renderer fixture; reused authoring inputs"
            : IS_PLATFORMER
              ? CYCLES
                  ? "Platformer level 1 cycles (pit death and respawn, pause, resume)"
                  : "Platformer level 1 (idle player, active patrols, seed NGNE-15)"
              : CYCLES
                ? "Starfall cycles (Chaos Lab launch, pause, resume, normal flight launch)"
                : "Starfall Chaos Lab (stress arena, seed STARFALL-1989)",
        warmupSeconds: WARMUP_SECONDS,
        sampledSeconds: (end.now - begin.now) / 1000,
        ...summary,
        rendererEvidence,
        droppedTicks: {
            atStart: droppedTicks(begin.status),
            atEnd: droppedTicks(end.status),
            duringSample: droppedTicks(end.status) - droppedTicks(begin.status),
        },
        sprites: { atStart: begin.sprites, atEnd: end.sprites },
        smoothedFps: { atStart: begin.fps, atEnd: end.fps },
        flightState: { atStart: begin.flight, atEnd: end.flight },
        pageError: end.error,
        // A page hidden from the start fires no visibilitychange event.
        visibilityState: { atStart: begin.visibility, atEnd: end.visibility },
        retainedHeapMiBAfterForcedGc: {
            afterWarmup: afterWarmup / 2 ** 20,
            afterRun: afterRun / 2 ** 20,
        },
        backend,
        allocation: allocationEvidence,
        retainedCheckpoints,
        cycles,
        snapshots: TAKES_SNAPSHOTS || CYCLES ? snapshots : undefined,
        trace: traceEvidence,
        run: {
            cdpPort: DEBUG_PORT,
            browserFlags,
            profileDir: session.profile,
            artifactDir,
            browserPid: browser.pid,
            previewPid: preview?.pid,
            servedBuild,
        },
    };
} catch (error) {
    const failures: unknown[] = [error];
    try {
        await session.screenshot(join(artifactDir, "failure.png"));
    } catch (diagnostic) {
        failures.push(diagnostic);
    }
    try {
        await session.stop();
    } catch (cleanup) {
        failures.push(cleanup);
    }
    writeFileSync(
        join(artifactDir, "failure.json"),
        JSON.stringify({ failures: failures.map(String), cleanup: session.records }, null, 2),
    );
    throw new AggregateError(failures, "Browser benchmark failed");
} finally {
    if (output) {
        try {
            await session.stop();
        } catch (error) {
            writeFileSync(
                join(artifactDir, "failure.json"),
                JSON.stringify(
                    { failures: [String(error)], cleanup: session.records, observations: output },
                    null,
                    2,
                ),
            );
            throw error;
        }
    }
}
if (output) {
    (output.run as Record<string, unknown>).survivingOwnedProcesses = [];
    (output.run as Record<string, unknown>).cleanup = session.records;
    console.log(JSON.stringify(output, null, 2));
}

interface SamplingProfile {
    head: SamplingNode;
}
interface SamplingNode {
    callFrame: { functionName: string; url: string; lineNumber: number; columnNumber?: number };
    selfSize: number;
    children: SamplingNode[];
}
function allocationSites(
    root: SamplingNode,
): { functionName: string; url: string; lineNumber: number; sampledBytes: number }[] {
    const sites = new Map<
        string,
        { functionName: string; url: string; lineNumber: number; sampledBytes: number }
    >();
    const visit = (node: SamplingNode) => {
        if (
            node.selfSize &&
            /\/src\/(renderer|quad-renderer|webgpu-runtime)\.ts/.test(node.callFrame.url)
        ) {
            const { functionName, url, lineNumber } = node.callFrame;
            const key = `${url}:${lineNumber}:${functionName}`;
            const site = sites.get(key) ?? { functionName, url, lineNumber, sampledBytes: 0 };
            site.sampledBytes += node.selfSize;
            sites.set(key, site);
        }
        for (const child of node.children) visit(child);
    };
    visit(root);
    return [...sites.values()].sort((a, b) => b.sampledBytes - a.sampledBytes);
}
/** Unfiltered sampled bytes and top sites; bundle positions are 0-based line and column. */
function summarizeAllocation(path: string, text: string, root: SamplingProfile, seconds: number) {
    const sites = new Map<string, number>();
    let sampledBytes = 0,
        nodes = 0;
    const visit = (node: SamplingNode) => {
        nodes++;
        if (node.selfSize) {
            sampledBytes += node.selfSize;
            const { functionName, url, lineNumber, columnNumber } = node.callFrame;
            const key = `${functionName || "(anonymous)"} ${url}:${lineNumber}:${columnNumber ?? -1}`;
            sites.set(key, (sites.get(key) ?? 0) + node.selfSize);
        }
        for (const child of node.children) visit(child);
    };
    visit(root.head);
    if (!nodes) throw new Error(`Allocation profile has no nodes: ${path}`);
    return {
        path,
        bytes: text.length,
        sha256: sha256(text),
        count: nodes,
        samplingIntervalBytes: SAMPLING_INTERVAL_BYTES,
        sampledBytes,
        sampledBytesPerSecond: sampledBytes / seconds,
        topSites: [...sites.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 25)
            .map(([site, bytes]) => ({ site, bytes })),
    };
}
async function sampleWindow(page: Page) {
    if (!RETAINED_EVERY_SECONDS) {
        await sleep(DURATION_SECONDS * 1000);
        return undefined;
    }
    const checkpoints: { atSecond: number; retainedMiB: number }[] = [];
    for (
        let second = RETAINED_EVERY_SECONDS;
        second <= DURATION_SECONDS;
        second += RETAINED_EVERY_SECONDS
    ) {
        await sleep(RETAINED_EVERY_SECONDS * 1000);
        await page.send("HeapProfiler.collectGarbage");
        const used = await page.evaluate<number>("performance.memory.usedJSHeapSize");
        checkpoints.push({ atSecond: second, retainedMiB: used / 2 ** 20 });
    }
    return checkpoints;
}
async function runCycles(page: Page, snapshots: Record<string, Artifact>) {
    let deathsBefore = 0;
    const steps: CycleStep[] = IS_PLATFORMER
        ? [
              {
                  action: "keyDown ArrowRight",
                  run: async (p) => {
                      deathsBefore = await p.evaluate<number>(DEATHS);
                      await key(p, "keyDown");
                  },
                  oracle: () => `${STATUS} === "Returning to checkpoint…"`,
                  dwellMs: 0,
              },
              {
                  action: "keyUp ArrowRight",
                  run: (p) => key(p, "keyUp"),
                  oracle: () =>
                      `${STATUS} === "Reach the blue gate" && ${DEATHS} === ${deathsBefore + 1}`,
                  dwellMs: 1000,
              },
              {
                  action: "click #pause",
                  run: (p) => click(p, "pause"),
                  oracle: () =>
                      `${STATUS} === "Paused" && document.getElementById("overlay-title")?.textContent === "Paused"`,
                  dwellMs: 1000,
              },
              {
                  action: "click #pause",
                  run: (p) => click(p, "pause"),
                  oracle: () =>
                      `${STATUS} === "Reach the blue gate" && document.getElementById("overlay").hidden`,
                  dwellMs: 1000,
              },
          ]
        : [
              {
                  action: "click #chaos",
                  run: (p) => click(p, "chaos"),
                  oracle: () => `${FLIGHT} === "CHAOS LAB / INVULNERABLE"`,
                  dwellMs: 5000,
              },
              {
                  action: "click #pause",
                  run: (p) => click(p, "pause"),
                  oracle: () =>
                      `${FLIGHT} === "FLIGHT PAUSED" && document.getElementById("overlay-title")?.textContent === "TAKE A BREATH."`,
                  dwellMs: 1000,
              },
              {
                  action: "click #pause",
                  run: (p) => click(p, "pause"),
                  oracle: () =>
                      `${FLIGHT} === "CHAOS LAB / INVULNERABLE" && document.getElementById("overlay").hidden`,
                  dwellMs: 2000,
              },
              {
                  action: "click #play",
                  run: (p) => click(p, "play"),
                  oracle: () => `${FLIGHT} === "FLIGHT IN PROGRESS"`,
                  dwellMs: 3000,
              },
          ];
    const interval = CYCLES / 10;
    const cycleMs: number[] = [];
    const oraclesPassed: number[] = steps.map(() => 0);
    const checkpoints: { cycle: number; atMs: number; retainedMiB: number; sprites: string }[] = [];
    for (let cycle = 1; cycle <= CYCLES; cycle++) {
        const start = await page.evaluate<number>("performance.now()");
        for (const [index, step] of steps.entries()) {
            await step.run(page);
            await waitFor(page, step.oracle(), ORACLE_TIMEOUT_MS, 50);
            oraclesPassed[index]++;
            await sleep(step.dwellMs);
        }
        // A hidden page stops requestAnimationFrame, so later oracles and timings are invalid.
        const visibility = await page.evaluate<string>("document.visibilityState");
        if (visibility !== "visible")
            throw new Error(`Page became ${visibility} in cycle ${cycle}`);
        progress(`cycle ${cycle} done`);
        cycleMs.push((await page.evaluate<number>("performance.now()")) - start);
        if (cycle % interval) continue;
        await page.send("HeapProfiler.collectGarbage");
        const ui = await page.evaluate<UiSnapshot>(READ_UI);
        const used = await page.evaluate<number>("performance.memory.usedJSHeapSize");
        checkpoints.push({ cycle, atMs: ui.now, retainedMiB: used / 2 ** 20, sprites: ui.sprites });
        if (cycle === interval)
            snapshots.firstCheckpoint = await takeSnapshot(page, `cycle-${cycle}`);
        if (cycle === CYCLES) snapshots.lastCheckpoint = await takeSnapshot(page, `cycle-${cycle}`);
    }
    return {
        cycles: CYCLES,
        steps: steps.map((step, index) => ({
            action: step.action,
            dwellMs: step.dwellMs,
            oraclesPassed: oraclesPassed[index],
        })),
        cycleMs: {
            min: Math.min(...cycleMs),
            max: Math.max(...cycleMs),
            mean: cycleMs.reduce((s, v) => s + v, 0) / cycleMs.length,
        },
        checkpoints,
    };
}
function assertBackend(backend: Backend, expected: string): void {
    const failures: string[] = [];
    if (backend.pageContext !== expected)
        failures.push(`page context ${backend.pageContext}, expected ${expected}`);
    if (!backend.webglRenderer || SOFTWARE_RENDERER.test(backend.webglRenderer))
        failures.push(`WebGL renderer ${backend.webglRenderer}`);
    if (expected === "webgpu" && (!backend.adapter || backend.adapter.isFallbackAdapter))
        failures.push("WebGPU adapter missing or fallback");
    if (backend.adapter && SOFTWARE_RENDERER.test(backend.adapter.description))
        failures.push(`WebGPU adapter ${backend.adapter.description}`);
    if (failures.length) throw new Error(`Backend assertion failed: ${failures.join("; ")}`);
}
async function startPreview(root: string): Promise<ChildProcess> {
    const origin = new URL(URL_UNDER_TEST);
    const { child, owner } = session.ownProcess(
        process.execPath,
        [
            join(root, "node_modules/vite/bin/vite.js"),
            "preview",
            "--host",
            origin.hostname,
            "--port",
            origin.port,
            "--strictPort",
            "--outDir",
            SERVE_OUT_DIR,
        ],
        "preview",
        { cwd: root },
    );
    let log = "";
    child.stdout?.on("data", (chunk) => (log += chunk));
    child.stderr?.on("data", (chunk) => (log += chunk));
    for (let attempt = 0; attempt < 100; attempt++) {
        owner.check();
        if (child.exitCode !== null) throw new Error(`Preview exited ${child.exitCode}: ${log}`);
        // Vite colours its banner; strip ANSI escapes before matching the bound address.
        const plain = log.replace(/\x1b\[[0-9;]*m/g, "");
        if (plain.includes(`Local:`) && plain.includes(`:${origin.port}/`)) {
            await sleep(300);
            if (child.exitCode !== null)
                throw new Error(`Preview exited ${child.exitCode}: ${log}`);
            return child;
        }
        await sleep(100);
    }
    throw new Error(`Preview did not report port ${origin.port}: ${log}`);
}
async function checkServedBuild(root: string) {
    const origin = new URL(URL_UNDER_TEST).origin;
    const files = listFiles(root)
        .map((file) => relative(root, file).replaceAll("\\", "/"))
        .filter((file) => /\.(html|js|css)$/.test(file) && !file.startsWith("engine/"))
        .sort();
    if (!files.length) throw new Error(`No build files under ${root}`);
    const entries: string[] = [];
    const mismatches: string[] = [];
    for (const file of files) {
        const expected = sha256(readFileSync(join(root, file)));
        const response = await fetch(`${origin}/${file}`);
        const served = sha256(Buffer.from(await response.arrayBuffer()));
        entries.push(`${expected}  ${file}`);
        if (!response.ok || served !== expected) mismatches.push(file);
    }
    if (mismatches.length)
        throw new Error(`Served build does not match ${root}: ${mismatches.join(", ")}`);
    return { root, files: files.length, servedBuildHash: sha256(entries.join("\n")) };
}
async function takeSnapshot(page: Page, label: string): Promise<Artifact> {
    const chunks: string[] = [];
    const off = page.on("HeapProfiler.addHeapSnapshotChunk", (params) =>
        chunks.push((params as { chunk: string }).chunk),
    );
    await page.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
    off();
    const text = chunks.join("");
    const path = join(artifactDir, `${label}.heapsnapshot`);
    writeFileSync(path, text);
    const snapshot = JSON.parse(text) as { snapshot: { node_count: number } };
    if (!snapshot.snapshot.node_count) throw new Error(`Heap snapshot has no nodes: ${path}`);
    return { path, bytes: text.length, sha256: sha256(text), count: snapshot.snapshot.node_count };
}
function browserSessionConnection() {
    return session.browserConnection();
}
async function startTrace() {
    const session = await browserSessionConnection();
    const { categories } = (await session.send("Tracing.getCategories")) as {
        categories: string[];
    };
    const included = TRACE_CATEGORIES.filter((category) => categories.includes(category));
    const complete = session.once("Tracing.tracingComplete");
    complete.catch(() => {});
    await session.send("Tracing.start", {
        transferMode: "ReturnAsStream",
        traceConfig: { recordMode: "recordAsMuchAsPossible", includedCategories: included },
    });
    return { session, complete, included };
}
async function stopTrace(trace: Awaited<ReturnType<typeof startTrace>>) {
    await trace.session.send("Tracing.end");
    const { stream, dataLossOccurred } = (await trace.complete) as {
        stream: string;
        dataLossOccurred: boolean;
    };
    const chunks: string[] = [];
    for (;;) {
        const chunk = (await trace.session.send("IO.read", { handle: stream, size: 1 << 20 })) as {
            data: string;
            eof: boolean;
            base64Encoded?: boolean;
        };
        chunks.push(
            chunk.base64Encoded ? Buffer.from(chunk.data, "base64").toString("utf8") : chunk.data,
        );
        if (chunk.eof) break;
    }
    await trace.session.send("IO.close", { handle: stream });
    await trace.session.close();
    const text = chunks.join("");
    const path = join(artifactDir, "trace.json");
    writeFileSync(path, text);
    const events = (JSON.parse(text) as { traceEvents?: { name: string }[] }).traceEvents ?? [];
    if (!events.length) throw new Error(`Trace has no events: ${path}`);
    if (dataLossOccurred) throw new Error(`Trace lost data: ${path}`);
    return {
        path,
        bytes: text.length,
        sha256: sha256(text),
        count: events.length,
        categories: trace.included,
        fireAnimationFrames: events.filter((event) => event.name === "FireAnimationFrame").length,
        label: "GPU-process CPU time; not GPU execution time",
    };
}
async function waitFor(
    page: Page,
    condition: string,
    timeoutMs = 30_000,
    pollMs = 200,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            if (await page.evaluate<boolean>(`!!(${condition})`)) return;
        } catch {
            // The document is still navigating or its execution context was replaced.
        }
        await sleep(pollMs);
    }
    const state = await page.evaluate<UiSnapshot>(READ_UI);
    throw new Error(`Timed out waiting for ${condition}; page state ${JSON.stringify(state)}`);
}
/** Preserve the user-gesture boundary required by audio unlock. */
async function click(page: Page, id: string): Promise<void> {
    await page.send("Runtime.evaluate", {
        expression: `document.getElementById(${JSON.stringify(id)}).click()`,
        userGesture: true,
    });
}
async function key(page: Page, type: "keyDown" | "keyUp"): Promise<void> {
    await page.send("Input.dispatchKeyEvent", {
        type,
        code: "ArrowRight",
        key: "ArrowRight",
        windowsVirtualKeyCode: 39,
        nativeVirtualKeyCode: 39,
    });
}
function listFiles(directory: string): string[] {
    return readdirSync(directory).flatMap((name) => {
        const path = join(directory, name);
        return statSync(path).isDirectory() ? listFiles(path) : [path];
    });
}
function sha256(data: string | Buffer): string {
    return createHash("sha256").update(data).digest("hex");
}
function droppedTicks(status: string): number {
    return Number(/(\d+) TICKS DROPPED/.exec(status)?.[1] ?? (/^\d+$/.test(status) ? status : 0));
}
function revision(): string {
    try {
        return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    } catch {
        return "unknown";
    }
}
/** Stage marker on stderr; stdout carries only the JSON result. */
function progress(stage: string): void {
    console.error(`[browser-baseline ${new Date().toISOString()}] ${stage}`);
}
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
