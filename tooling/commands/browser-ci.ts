// NGNE_BROWSER and CHROME_BIN executable selection is delegated to BrowserSession.
// BrowserSession supplies "--remote-debugging-port" and "--user-data-dir"; these launch options remain supported.
import { BrowserSession } from "../core/browser/session.js";
import { isNavigationError } from "../core/browser/devtools.mjs";
import { runWithCleanup, ownProcess, type CleanupRecord } from "../core/cleanup.mjs";
import { type ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface ValidationState {
    status: "idle" | "running" | "passed" | "failed";
    passed: string[];
    skipped: string[];
    failures: string[];
}

interface AdapterEnvironment {
    userAgent: string;
    secureContext: boolean;
    adapter: {
        vendor: string;
        architecture: string;
        device: string;
        description: string;
        isFallbackAdapter: boolean;
    };
}

interface BrowserResult {
    status: "passed" | "failed";
    renderer: "software" | "hardware" | "unknown";
    environment?: AdapterEnvironment;
    passed: string[];
    skippedAsUnsupported: string[];
    failures: string[];
    console: string[];
    recordedAt: string;
    browserVersion?: unknown;
    browserFlags: string[];
    cleanup: { resource: string; status: string; error?: string }[];
    renderingDevices: { page: string; devices: RenderingDevice[] }[];
}

interface RenderingDevice {
    vendor: string;
    architecture: string;
    device: string;
    description: string;
    isFallbackAdapter: boolean;
    submissions: number;
    canvasConfigurations: number;
}

interface Cdp {
    send(method: string, params?: object): Promise<unknown>;
    evaluate<T>(expression: string, userGesture?: boolean): Promise<T>;
    on(method: string, handler: (params: unknown) => void): void;
    close(): Promise<void>;
}

const session = new BrowserSession();
const root = process.cwd();
const origin = process.env.NGNE_BROWSER_URL ?? "http://127.0.0.1:4173";
const debugPort = Number(process.env.NGNE_CDP_PORT ?? 9334);
const timeoutMs = Number(process.env.NGNE_BROWSER_TIMEOUT_MS ?? 240_000);
const artifactDirectory = join(
    root,
    process.env.NGNE_BROWSER_ARTIFACT_DIR ?? ".test-output/browser",
);
const consoleMessages: string[] = [];
const failures: string[] = [];
const passed: string[] = [];
const skippedAsUnsupported: string[] = [];
let environment: AdapterEnvironment | undefined;
let renderer: BrowserResult["renderer"] = "unknown";
let preview: ChildProcess | undefined;
let cdp: Cdp | undefined;
const cleanup: CleanupRecord[] = [];
let previewOwner: ReturnType<typeof ownProcess> | undefined;
let browserVersion: unknown;
let browserFlags: string[] = [];
const renderingDevices: BrowserResult["renderingDevices"] = [];

mkdirSync(artifactDirectory, { recursive: true });

failures.push(
    ...(await runWithCleanup(
        async () => {
            preview = startPreview();
            await waitForPreview(15_000);
            cdp = await startBrowser();
            await cdp.send("Runtime.enable");
            await cdp.send("Page.enable");
            await cdp.send("Log.enable");
            browserVersion = await cdp.send("Browser.getVersion");
            await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
                // Observe acquired devices and actual submission/presentation use without selecting adapters.
                source: `(() => {
            const records = window.__ngneRenderingDevices = [];
            if (!window.GPUAdapter || !window.GPUCanvasContext || !window.GPUQueue) return;
            const queues = new WeakMap();
            function observe(device) {
                if (!queues.has(device.queue)) {
                    const info = device.adapterInfo;
                    const record = {
                        vendor: info.vendor, architecture: info.architecture,
                        device: info.device, description: info.description,
                        isFallbackAdapter: info.isFallbackAdapter, submissions: 0, canvasConfigurations: 0
                    };
                    queues.set(device.queue, record);
                    records.push(record);
                }
                return queues.get(device.queue);
            }
            const requestDevice = GPUAdapter.prototype.requestDevice;
            GPUAdapter.prototype.requestDevice = async function (...args) {
                const device = await requestDevice.apply(this, args);
                observe(device);
                return device;
            };
            const configure = GPUCanvasContext.prototype.configure;
            GPUCanvasContext.prototype.configure = function (descriptor) {
                const result = configure.call(this, descriptor);
                observe(descriptor.device).canvasConfigurations++;
                return result;
            };
            const submit = GPUQueue.prototype.submit;
            GPUQueue.prototype.submit = function (...args) {
                const result = submit.apply(this, args);
                const record = queues.get(this);
                if (record) record.submissions++;
                return result;
            };
        })();`,
            });
            await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
            captureBrowserLogs(cdp);

            await navigate(
                `${origin}/validation.html${process.env.NGNE_BROWSER_INJECT_FAILURE ? "?injectFailure" : ""}`,
            );
            await click("document.getElementById('start-validation')?.click()");
            const validation = await waitForValidation();
            passed.push(...validation.passed.map((message) => message.replace(/^PASS /, "")));
            failures.push(...validation.failures);
            if (validation.status !== "passed") throw new Error(validation.failures.join("; "));

            environment = await readEnvironment();
            await recordRenderingDevices("validation");
            renderer = isSoftware(environment) ? "software" : "hardware";
            if (renderer === "software")
                skippedAsUnsupported.push("hardware-backed WebGPU execution evidence");
            await checkStarfall();
            await recordRenderingDevices("Starfall");
            await checkPlatformer();
            await recordRenderingDevices("platformer");
            if (consoleMessages.some((message) => /^(error|exception):/i.test(message)))
                throw new Error("Browser console reported an error or uncaught exception");
        },
        captureScreenshot,
        [
            ["browser session", () => session.stop()],
            [
                "controlled cleanup failure",
                () => {
                    if (process.env.NGNE_BROWSER_INJECT_CLEANUP_FAILURE)
                        throw new Error("intentional CI cleanup failure after resource release");
                },
            ],
        ],
        cleanup,
    )),
);
writeResult(failures.length ? "failed" : "passed");
printSummary();
if (failures.length) process.exitCode = 1;

function startPreview(): ChildProcess {
    const url = new URL(origin);
    const { child, owner } = session.ownProcess(
        process.execPath,
        [
            join(root, "node_modules/vite/bin/vite.js"),
            "preview",
            "--host",
            url.hostname,
            "--port",
            url.port,
            "--strictPort",
            "--outDir",
            "dist-browser",
        ],
        "preview",
        { cwd: root },
    );
    previewOwner = owner;
    pipeLog(child, "preview.log");
    return child;
}

async function startBrowser(): Promise<Cdp> {
    const requestedAdapter = process.env.NGNE_WEBGPU_ADAPTER;
    const flags = [
        "--no-first-run",
        "--disable-default-apps",
        "--disable-dev-shm-usage",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
    ];
    if (process.env.NGNE_BROWSER_HEADLESS !== "0") flags.push("--headless=new");
    else flags.push("--window-size=1280,720");
    if (requestedAdapter) flags.push(`--use-webgpu-adapter=${requestedAdapter}`);
    if (process.env.NGNE_FORCE_HIGH_PERFORMANCE_GPU === "1")
        flags.push("--force-high-performance-gpu");
    if (requestedAdapter === "swiftshader") {
        flags.push("--enable-unsafe-webgpu", "--enable-unsafe-swiftshader");
        if (process.platform === "linux")
            flags.push(
                "--enable-features=Vulkan",
                "--use-angle=vulkan",
                "--use-vulkan=swiftshader",
                "--disable-vulkan-surface",
            );
    }
    if (process.platform === "linux") flags.push("--no-sandbox");
    browserFlags = flags;
    return session.start({
        flags,
        port: debugPort,
        log: join(artifactDirectory, "browser-process.log"),
    });
}

function captureBrowserLogs(client: Cdp): void {
    client.on("Runtime.consoleAPICalled", (value) => {
        const event = value as { type: string; args: { value?: unknown; description?: string }[] };
        consoleMessages.push(
            `${event.type}: ${event.args.map((argument) => String(argument.value ?? argument.description ?? "")).join(" ")}`,
        );
    });
    client.on("Runtime.exceptionThrown", (value) => {
        const event = value as {
            exceptionDetails: { text: string; exception?: { description?: string } };
        };
        consoleMessages.push(
            `exception: ${event.exceptionDetails.exception?.description ?? event.exceptionDetails.text}`,
        );
    });
    client.on("Log.entryAdded", (value) => {
        const event = value as { entry: { level: string; text: string } };
        consoleMessages.push(`log-${event.entry.level}: ${event.entry.text}`);
    });
}

async function navigate(url: string): Promise<void> {
    await cdp!.send("Page.navigate", { url });
    await waitFor("document.readyState === 'complete'", 20_000, `load ${url}`);
}

async function click(expression: string): Promise<void> {
    await cdp!.evaluate(expression, true);
}

async function waitForValidation(): Promise<ValidationState> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const fixtureNeedsClick = await cdp!.evaluate<boolean>(
            "document.querySelector('iframe')?.contentDocument?.documentElement?.dataset.ngneFixtureReady === 'true' && !!document.querySelector('iframe')?.contentDocument?.getElementById('start')",
        );
        if (fixtureNeedsClick)
            await click(
                "document.querySelector('iframe')?.contentDocument?.getElementById('start')?.click()",
            );
        const state = await cdp!.evaluate<ValidationState | undefined>("window.__ngneValidation");
        if (state?.status === "passed" || state?.status === "failed") return state;
        await sleep(100);
    }
    throw new Error(`Browser validation timed out after ${timeoutMs} ms`);
}

async function readEnvironment(): Promise<AdapterEnvironment> {
    const text = await cdp!.evaluate<string>(
        "document.getElementById('webgpu-environment')?.textContent ?? ''",
    );
    try {
        return JSON.parse(text) as AdapterEnvironment;
    } catch {
        throw new Error(`WebGPU environment was not machine-readable: ${text}`);
    }
}

async function recordRenderingDevices(page: string): Promise<void> {
    const devices = await cdp!.evaluate<RenderingDevice[]>("window.__ngneRenderingDevices");
    renderingDevices.push({ page, devices });
    if (!devices?.some((device) => device.submissions > 0 && device.canvasConfigurations > 0))
        throw new Error(`${page}: no submissions on an observed presentation device`);
    const expected = process.env.NGNE_EXPECT_GPU_VENDOR?.toLowerCase();
    if (expected) {
        if (
            devices.some(
                (device) =>
                    device.vendor.toLowerCase() !== expected || device.isFallbackAdapter !== false,
            )
        )
            throw new Error(`${page}: expected physical ${expected} rendering devices`);
        passed.push(`${page} submits using the expected physical ${expected} adapter`);
    }
}

async function checkStarfall(): Promise<void> {
    await navigate(`${origin}/`);
    await waitFor(
        "document.getElementById('play')?.textContent === 'START FLIGHT' && !document.getElementById('play').disabled",
        30_000,
        "Starfall readiness",
    );
    await waitFor(
        "document.getElementById('engine-status')?.textContent === 'RUNNING'",
        10_000,
        "Starfall WebGPU attract frames",
    );
    passed.push("Starfall built path launches WebGPU attract mode");
    await click("document.getElementById('play').click()");
    await waitFor(
        "document.getElementById('flight-state')?.textContent === 'FLIGHT IN PROGRESS'",
        30_000,
        "Starfall launch",
    );
    passed.push("Starfall built path starts a flight");
    await click("document.getElementById('pause').click()");
    await waitFor(
        "document.getElementById('flight-state')?.textContent === 'FLIGHT PAUSED'",
        10_000,
        "Starfall pause",
    );
    passed.push("Starfall built path pauses");
    await click("document.getElementById('pause').click()");
    await waitFor(
        "document.getElementById('flight-state')?.textContent === 'FLIGHT IN PROGRESS'",
        10_000,
        "Starfall resume",
    );
    await pass(
        "Starfall built path resumes without an error",
        "document.getElementById('error')?.hidden === true",
    );
}

async function checkPlatformer(): Promise<void> {
    await navigate(`${origin}/examples/platformer/`);
    await waitFor(
        "document.getElementById('start')?.textContent === 'Start level 1'",
        20_000,
        "platformer readiness",
    );
    await click("document.getElementById('start').click()");
    await waitFor(
        "document.getElementById('status')?.textContent === 'Reach the blue gate'",
        30_000,
        "platformer launch",
    );
    passed.push("Platformer built path launches level 1");
    await click("document.getElementById('pause').click()");
    await waitFor(
        "document.getElementById('overlay-title')?.textContent === 'Paused'",
        10_000,
        "platformer pause",
    );
    passed.push("Platformer built path pauses");
    await click("document.getElementById('pause').click()");
    await waitFor(
        "document.getElementById('status')?.textContent === 'Reach the blue gate' && document.getElementById('overlay')?.hidden",
        10_000,
        "platformer resume",
    );
    await pass(
        "Platformer built path resumes without an error",
        "document.getElementById('error')?.hidden === true",
    );
}

async function pass(message: string, condition: string): Promise<void> {
    if (!(await cdp!.evaluate<boolean>(`!!(${condition})`))) throw new Error(message);
    passed.push(message);
}

async function waitFor(condition: string, limitMs: number, label: string): Promise<void> {
    const deadline = Date.now() + limitMs;
    while (Date.now() < deadline) {
        try {
            if (await cdp!.evaluate<boolean>(`!!(${condition})`)) return;
        } catch (error) {
            if (!isNavigationError(error)) throw error;
            // Navigation may replace the execution context while polling.
        }
        await sleep(100);
    }
    throw new Error(`Timed out waiting for ${label}`);
}

async function waitForPreview(limitMs: number): Promise<void> {
    const deadline = Date.now() + limitMs;
    const expected = readFileSync(join(root, "dist-browser/validation.html"), "utf8");
    while (Date.now() < deadline) {
        previewOwner?.check();
        if (preview?.exitCode !== null) throw new Error(`Preview exited ${preview?.exitCode}`);
        try {
            const response = await fetch(`${origin}/validation.html`, {
                signal: AbortSignal.timeout(1_000),
            });
            if (response.ok && (await response.text()) === expected) {
                await sleep(100);
                if (preview?.exitCode !== null)
                    throw new Error(`Preview exited ${preview?.exitCode}`);
                return;
            }
        } catch {
            // Preview is still starting.
        }
        await sleep(100);
    }
    throw new Error("Preview did not serve the current dist-browser/validation.html");
}

function isSoftware(value: AdapterEnvironment): boolean {
    const adapter = value.adapter;
    return (
        adapter.isFallbackAdapter ||
        /swiftshader|software|llvmpipe|lavapipe/i.test(
            [adapter.vendor, adapter.architecture, adapter.device, adapter.description].join(" "),
        )
    );
}

async function captureScreenshot(): Promise<void> {
    if (!cdp) return;
    const result = (await cdp.send(
        process.env.NGNE_BROWSER_INJECT_SCREENSHOT_FAILURE
            ? "NGNE.invalidScreenshotCommand"
            : "Page.captureScreenshot",
        {
            format: "png",
            captureBeyondViewport: true,
        },
    )) as { data: string };
    writeFileSync(join(artifactDirectory, "failure.png"), Buffer.from(result.data, "base64"));
}

function writeResult(status: BrowserResult["status"]): void {
    const result: BrowserResult = {
        status,
        renderer,
        environment,
        passed,
        skippedAsUnsupported,
        failures: [...new Set(failures.filter(Boolean))],
        console: consoleMessages,
        recordedAt: new Date().toISOString(),
        browserVersion,
        browserFlags,
        renderingDevices,
        cleanup,
    };
    writeFileSync(join(artifactDirectory, "results.json"), JSON.stringify(result, null, 2));
    writeFileSync(join(artifactDirectory, "browser.log"), consoleMessages.join("\n"));
}

function printSummary(): void {
    const uniqueFailures = [...new Set(failures.filter(Boolean))];
    const lines = [
        "## NGNE browser integration",
        "",
        `Renderer: **${renderer}**`,
        "",
        `### Passed (${passed.length})`,
        "",
        ...passed.map((message) => `- ${message}`),
        "",
        `### Skipped as unsupported (${skippedAsUnsupported.length})`,
        "",
        ...(skippedAsUnsupported.length
            ? skippedAsUnsupported.map((message) => `- ${message}`)
            : ["- None"]),
        "",
        `### Failed (${uniqueFailures.length})`,
        "",
        ...(uniqueFailures.length ? uniqueFailures.map((message) => `- ${message}`) : ["- None"]),
        "",
    ];
    const summary = lines.join("\n");
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

function pipeLog(child: ChildProcess, filename: string): void {
    const chunks: Buffer[] = [];
    const record = (chunk: Buffer) => chunks.push(Buffer.from(chunk));
    child.stdout?.on("data", record);
    child.stderr?.on("data", record);
    child.on("error", (error) => consoleMessages.push(`process-error: ${error.message}`));
    child.on("close", () =>
        writeFileSync(join(artifactDirectory, filename), Buffer.concat(chunks)),
    );
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
