import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
    appendFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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
}

interface Cdp {
    send(method: string, params?: object): Promise<unknown>;
    evaluate<T>(expression: string, userGesture?: boolean): Promise<T>;
    on(method: string, handler: (params: unknown) => void): void;
    close(): void;
}

const root = process.cwd();
const origin = process.env.NGNE_BROWSER_URL ?? "http://127.0.0.1:4173";
const debugPort = Number(process.env.NGNE_CDP_PORT ?? 9334);
const timeoutMs = Number(process.env.NGNE_BROWSER_TIMEOUT_MS ?? 240_000);
const artifactDirectory = join(
    root,
    process.env.NGNE_BROWSER_ARTIFACT_DIR ?? ".test-output/browser",
);
const profileDirectory = mkdtempSync(join(tmpdir(), "ngne-browser-ci-"));
const consoleMessages: string[] = [];
const failures: string[] = [];
const passed: string[] = [];
const skippedAsUnsupported: string[] = [];
let environment: AdapterEnvironment | undefined;
let renderer: BrowserResult["renderer"] = "unknown";
let preview: ChildProcess | undefined;
let browser: ChildProcess | undefined;
let cdp: Cdp | undefined;
let failed = false;

mkdirSync(artifactDirectory, { recursive: true });

try {
    preview = startPreview();
    await waitForPreview(15_000);
    browser = startBrowser();
    cdp = await connectToPage();
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Log.enable");
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
    renderer = isSoftware(environment) ? "software" : "hardware";
    if (renderer === "software")
        skippedAsUnsupported.push("hardware-backed WebGPU execution evidence");
    await checkStarfall();
    await checkPlatformer();
    if (consoleMessages.some((message) => /^(error|exception):/i.test(message)))
        throw new Error("Browser console reported an error or uncaught exception");

    writeResult("passed");
    printSummary();
} catch (error) {
    failed = true;
    failures.push(error instanceof Error ? error.message : String(error));
    await captureScreenshot();
    writeResult("failed");
    printSummary();
} finally {
    cdp?.close();
    await stop(browser);
    await stop(preview);
    rmSync(profileDirectory, { recursive: true, force: true });
}
if (failed) process.exitCode = 1;

function startPreview(): ChildProcess {
    const url = new URL(origin);
    const child = spawn(
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
        {
            cwd: root,
            detached: process.platform !== "win32",
            stdio: ["ignore", "pipe", "pipe"],
        },
    );
    pipeLog(child, "preview.log");
    return child;
}

function startBrowser(): ChildProcess {
    const executable = browserExecutable();
    const requestedAdapter = process.env.NGNE_WEBGPU_ADAPTER;
    const flags = [
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${profileDirectory}`,
        "--headless=new",
        "--no-first-run",
        "--disable-default-apps",
        "--disable-dev-shm-usage",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--autoplay-policy=no-user-gesture-required",
    ];
    if (requestedAdapter) flags.push(`--use-webgpu-adapter=${requestedAdapter}`);
    if (requestedAdapter === "swiftshader") flags.push("--enable-unsafe-webgpu");
    if (process.platform === "linux") flags.push("--no-sandbox");
    flags.push("about:blank");
    const child = spawn(executable, flags, {
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
    });
    pipeLog(child, "browser-process.log");
    return child;
}

function browserExecutable(): string {
    if (process.env.NGNE_BROWSER) return process.env.NGNE_BROWSER;
    if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
    const windows = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    return process.platform === "win32" && existsSync(windows) ? windows : "google-chrome";
}

async function connectToPage(): Promise<Cdp> {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
            const targets = (await response.json()) as {
                type: string;
                webSocketDebuggerUrl: string;
            }[];
            const page = targets.find((target) => target.type === "page");
            if (page) return connect(page.webSocketDebuggerUrl);
        } catch {
            // Chrome is still starting.
        }
        await sleep(100);
    }
    throw new Error("Chrome DevTools target did not start within 20 seconds");
}

async function connect(url: string): Promise<Cdp> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("DevTools WebSocket timed out")), 10_000);
        socket.addEventListener("open", () => {
            clearTimeout(timer);
            resolve();
        });
        socket.addEventListener("error", () => reject(new Error("DevTools WebSocket failed")));
    });
    let id = 0;
    const pending = new Map<
        number,
        {
            resolve(value: unknown): void;
            reject(error: Error): void;
            timer: ReturnType<typeof setTimeout>;
        }
    >();
    const listeners = new Map<string, Set<(params: unknown) => void>>();
    socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data)) as {
            id?: number;
            method?: string;
            params?: unknown;
            result?: unknown;
            error?: { message: string };
        };
        if (message.id === undefined) {
            for (const handler of listeners.get(message.method ?? "") ?? [])
                handler(message.params);
            return;
        }
        const call = pending.get(message.id);
        if (!call) return;
        clearTimeout(call.timer);
        pending.delete(message.id);
        if (message.error) call.reject(new Error(message.error.message));
        else call.resolve(message.result);
    });
    const client: Cdp = {
        send(method, params = {}) {
            return new Promise((resolve, reject) => {
                const callId = ++id;
                const timer = setTimeout(() => {
                    pending.delete(callId);
                    reject(new Error(`DevTools ${method} timed out`));
                }, 30_000);
                pending.set(callId, { resolve, reject, timer });
                socket.send(JSON.stringify({ id: callId, method, params }));
            });
        },
        async evaluate<T>(expression: string, userGesture = false): Promise<T> {
            const reply = (await client.send("Runtime.evaluate", {
                expression,
                awaitPromise: true,
                returnByValue: true,
                userGesture,
            })) as {
                result: { value: T };
                exceptionDetails?: { text: string; exception?: { description?: string } };
            };
            if (reply.exceptionDetails)
                throw new Error(
                    reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text,
                );
            return reply.result.value;
        },
        on(method, handler) {
            const handlers = listeners.get(method) ?? new Set();
            handlers.add(handler);
            listeners.set(method, handlers);
        },
        close() {
            socket.close();
        },
    };
    return client;
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
            "!!document.querySelector('iframe')?.contentDocument?.getElementById('start')",
        );
        if (fixtureNeedsClick)
            await click(
                "document.querySelector('iframe').contentDocument.getElementById('start').click()",
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
        } catch {
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
        if (preview?.exitCode !== null) throw new Error(`Preview exited ${preview?.exitCode}`);
        try {
            const response = await fetch(`${origin}/validation.html`);
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
    try {
        const result = (await cdp.send("Page.captureScreenshot", {
            format: "png",
            captureBeyondViewport: true,
        })) as { data: string };
        writeFileSync(join(artifactDirectory, "failure.png"), Buffer.from(result.data, "base64"));
    } catch (error) {
        consoleMessages.push(`screenshot: ${String(error)}`);
    }
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

async function stop(child: ChildProcess | undefined): Promise<void> {
    if (!child?.pid) return;
    if (process.platform === "win32") {
        if (child.exitCode === null)
            spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        return;
    }
    try {
        process.kill(-child.pid, "SIGTERM");
    } catch {
        return;
    }
    await Promise.race([
        new Promise<void>((resolve) => child.once("close", () => resolve())),
        sleep(5_000),
    ]);
    if (process.platform !== "win32") {
        try {
            process.kill(-child.pid, "SIGKILL");
        } catch {
            // The owned process group already exited.
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
