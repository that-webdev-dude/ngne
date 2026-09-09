import { execSync, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Sustained Starfall Chaos Lab measurement in a real headful Chromium, driven over the
 * DevTools protocol so the same warmup, duration and sampling can be repeated later.
 *
 * Usage: `npx tsx tests/browser-baseline.ts` against a running `npm run preview`.
 * Environment: NGNE_BROWSER (Chromium executable), NGNE_URL (default preview origin),
 * NGNE_WARMUP_SECONDS (default 10), NGNE_DURATION_SECONDS (default 60).
 * The browser window must stay visible; hidden tabs throttle requestAnimationFrame.
 */
const BROWSER =
        process.env.NGNE_BROWSER ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    URL_UNDER_TEST = process.env.NGNE_URL ?? "http://127.0.0.1:4173/",
    WARMUP_SECONDS = Number(process.env.NGNE_WARMUP_SECONDS ?? 10),
    DURATION_SECONDS = Number(process.env.NGNE_DURATION_SECONDS ?? 60),
    DEBUG_PORT = 9333;
const HOOK = `(() => {
    const raw = window.requestAnimationFrame.bind(window);
    const b = (window.__ngneBaseline = { frames: [], heap: [], longTasks: 0, visibility: [] });
    window.requestAnimationFrame = (callback) =>
        raw((timestamp) => {
            const start = performance.now();
            try {
                callback(timestamp);
            } finally {
                b.frames.push(timestamp, start, performance.now() - start);
            }
        });
    new PerformanceObserver((list) => (b.longTasks += list.getEntries().length)).observe({
        entryTypes: ["longtask"],
    });
    document.addEventListener("visibilitychange", () =>
        b.visibility.push([performance.now(), document.visibilityState]),
    );
    setInterval(() => {
        const m = performance.memory;
        b.heap.push(performance.now(), m.usedJSHeapSize, m.totalJSHeapSize);
    }, 250);
})();`;
const SUMMARY = `((startMs, endMs) => {
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
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl && gl.getExtension("WEBGL_debug_renderer_info");
    return {
        browser: navigator.userAgent,
        gpu: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null,
        devicePixelRatio: devicePixelRatio,
        viewport: [innerWidth, innerHeight],
        frameCallbackMs: summarize(callbackMs),
        frameIntervalMs: summarize(intervalMs),
        intervalsOver25Ms: intervalMs.filter((v) => v > 25).length,
        intervalsOver50Ms: intervalMs.filter((v) => v > 50).length,
        longTasks: b.longTasks,
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
    status: document.getElementById("engine-status").textContent,
    flight: document.getElementById("flight-state").textContent,
    sprites: document.getElementById("sprites").textContent,
    fps: document.getElementById("fps").textContent,
    error: document.getElementById("error").textContent,
    now: performance.now(),
})`;
interface UiSnapshot {
    status: string;
    flight: string;
    sprites: string;
    fps: string;
    error: string;
    now: number;
}
interface Page {
    send(method: string, params?: object): Promise<unknown>;
    evaluate<T>(expression: string): Promise<T>;
}
const profile = mkdtempSync(join(tmpdir(), "ngne-baseline-"));
const browser = spawn(
    BROWSER,
    [
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--enable-precise-memory-info",
        "--window-size=1280,900",
        "about:blank",
    ],
    { stdio: "ignore" },
);
try {
    const page = await connect();
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("HeapProfiler.enable");
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK });
    await page.send("Page.navigate", { url: URL_UNDER_TEST });
    await waitFor(page, `document.getElementById("play").textContent === "START FLIGHT"`);
    await click(page, "chaos");
    await waitFor(page, `document.getElementById("flight-state").textContent.includes("CHAOS")`);
    await sleep(WARMUP_SECONDS * 1000);
    await page.send("HeapProfiler.collectGarbage");
    const afterWarmup = await page.evaluate<number>("performance.memory.usedJSHeapSize");
    const begin = await page.evaluate<UiSnapshot>(READ_UI);
    await sleep(DURATION_SECONDS * 1000);
    const end = await page.evaluate<UiSnapshot>(READ_UI);
    const summary = await page.evaluate<Record<string, unknown>>(
        `${SUMMARY}(${begin.now}, ${end.now})`,
    );
    await page.send("HeapProfiler.collectGarbage");
    const afterRun = await page.evaluate<number>("performance.memory.usedJSHeapSize");
    console.log(
        JSON.stringify(
            {
                revision: revision(),
                url: URL_UNDER_TEST,
                workload: "Starfall Chaos Lab (stress arena, seed STARFALL-1989)",
                warmupSeconds: WARMUP_SECONDS,
                sampledSeconds: (end.now - begin.now) / 1000,
                ...summary,
                droppedTicks: {
                    atStart: droppedTicks(begin.status),
                    atEnd: droppedTicks(end.status),
                    duringSample: droppedTicks(end.status) - droppedTicks(begin.status),
                },
                sprites: { atStart: begin.sprites, atEnd: end.sprites },
                smoothedFps: { atStart: begin.fps, atEnd: end.fps },
                flightState: { atStart: begin.flight, atEnd: end.flight },
                pageError: end.error,
                retainedHeapMiBAfterForcedGc: {
                    afterWarmup: afterWarmup / 2 ** 20,
                    afterRun: afterRun / 2 ** 20,
                },
            },
            null,
            2,
        ),
    );
} finally {
    spawn("taskkill", ["/pid", String(browser.pid), "/T", "/F"], { stdio: "ignore" });
}
async function connect(): Promise<Page> {
    let targets: { type: string; webSocketDebuggerUrl: string }[] = [];
    for (let attempt = 0; attempt < 50 && !targets.length; attempt++) {
        await sleep(200);
        try {
            const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
            targets = ((await response.json()) as typeof targets).filter((t) => t.type === "page");
        } catch {
            // The browser is still starting; keep polling.
        }
    }
    if (!targets.length) throw new Error("No debuggable page target found");
    const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        socket.onerror = () => reject(new Error("DevTools socket failed"));
    });
    const pending = new Map<
        number,
        { resolve(value: unknown): void; reject(error: Error): void }
    >();
    let id = 0;
    socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data));
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message));
        else waiter.resolve(message.result);
    };
    const page: Page = {
        send: (method, params = {}) =>
            new Promise((resolve, reject) => {
                pending.set(++id, { resolve, reject });
                socket.send(JSON.stringify({ id, method, params }));
            }),
        evaluate: async <T>(expression: string) => {
            const result = (await page.send("Runtime.evaluate", {
                expression,
                returnByValue: true,
                awaitPromise: true,
            })) as {
                result: { value: T };
                exceptionDetails?: { text: string; exception?: { description?: string } };
            };
            if (result.exceptionDetails)
                throw new Error(
                    result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
                );
            return result.result.value;
        },
    };
    return page;
}
async function waitFor(page: Page, condition: string): Promise<void> {
    for (let attempt = 0; attempt < 150; attempt++) {
        try {
            if (await page.evaluate<boolean>(`!!(${condition})`)) return;
        } catch {
            // The document is still navigating or its execution context was replaced.
        }
        await sleep(200);
    }
    const state = await page.evaluate<UiSnapshot>(READ_UI);
    throw new Error(`Timed out waiting for ${condition}; page state ${JSON.stringify(state)}`);
}
/** Real input events count as a user gesture, which the audio unlock needs. */
async function click(page: Page, id: string): Promise<void> {
    const [x, y] = await page.evaluate<[number, number]>(
        `(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();
            return [r.x + r.width / 2, r.y + r.height / 2]; })()`,
    );
    for (const type of ["mousePressed", "mouseReleased"])
        await page.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
}
function droppedTicks(status: string): number {
    return Number(/(\d+) TICKS DROPPED/.exec(status)?.[1] ?? 0);
}
function revision(): string {
    try {
        return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    } catch {
        return "unknown";
    }
}
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
