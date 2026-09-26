import { spawn, type SpawnOptions, type ChildProcess } from "node:child_process";
import {
    appendFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupSteps, ownProcess, type CleanupRecord, type CleanupStep } from "../cleanup.mjs";
import { connectDevTools, type DevTools } from "./devtools.mjs";

export function browserExecutable(): string {
    return (
        process.env.NGNE_BROWSER ??
        process.env.CHROME_BIN ??
        (process.platform === "win32"
            ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
            : "google-chrome")
    );
}

/** Resource owner only: callers retain navigation, workload, flags, sampling and acceptance policy. */
export class BrowserSession {
    readonly cleanup: CleanupStep[] = [];
    readonly records: CleanupRecord[] = [];
    profile?: string;
    browser?: ChildProcess;
    page?: DevTools;
    port?: number;
    private closed?: Promise<CleanupRecord[]>;
    private options: Parameters<typeof connectDevTools>[1];
    private assertOpen() {
        if (this.closed) throw Error("Browser session is closed");
    }
    ownProcess(
        executable: string,
        args: string[],
        label: string,
        options: SpawnOptions = {},
        log?: string,
    ) {
        this.assertOpen();
        const child = spawn(executable, args, {
            ...options,
            windowsHide: true,
            detached: process.platform !== "win32",
            stdio: ["ignore", "pipe", "pipe"],
        });
        const owner = ownProcess(child, label);
        this.cleanup.unshift([`${label} terminate/verify`, () => owner.stop()]);
        if (log)
            for (const stream of [child.stdout, child.stderr])
                stream?.on("data", (bytes) => appendFileSync(log, bytes));
        return { child, owner };
    }
    async start(
        options: {
            executable?: string;
            flags?: string[];
            profileParent?: string;
            port?: number;
            log?: string;
            startupMs?: number;
            transport?: Parameters<typeof connectDevTools>[1];
        } = {},
    ): Promise<DevTools> {
        this.assertOpen();
        if (this.profile) throw Error("Browser session already started");
        this.options = options.transport;
        const parent = options.profileParent ?? tmpdir();
        mkdirSync(parent, { recursive: true });
        this.profile = mkdtempSync(join(parent, "ngne-browser-"));
        const profile = this.profile;
        this.cleanup.push([
            "temporary profile remove",
            () => rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
        ]);
        const flags = options.flags ?? [];
        if (flags.some((flag) => /^--(remote-debugging-port|user-data-dir)(=|$)/.test(flag)))
            throw Error("Session owns debug port and profile");
        const { child, owner } = this.ownProcess(
            options.executable ?? browserExecutable(),
            [
                `--remote-debugging-port=${options.port ?? 0}`,
                `--user-data-dir=${profile}`,
                ...flags,
                "about:blank",
            ],
            "browser",
            {},
            options.log,
        );
        this.browser = child;
        const deadline = Date.now() + (options.startupMs ?? 20000);
        let last: unknown;
        while (Date.now() < deadline) {
            owner.check();
            try {
                const file = join(profile, "DevToolsActivePort");
                this.port =
                    options.port ||
                    (existsSync(file)
                        ? Number(readFileSync(file, "utf8").split(/\r?\n/)[0])
                        : undefined);
                if (this.port) {
                    const response = await fetch(`http://127.0.0.1:${this.port}/json/list`, {
                        signal: AbortSignal.timeout(
                            Math.min(1000, Math.max(1, deadline - Date.now())),
                        ),
                    });
                    const targets: unknown = await response.json();
                    if (Array.isArray(targets)) {
                        const target = targets.find(
                            (v: unknown): v is { type: string; webSocketDebuggerUrl: string } =>
                                !!v &&
                                typeof v === "object" &&
                                "type" in v &&
                                v.type === "page" &&
                                "webSocketDebuggerUrl" in v &&
                                typeof v.webSocketDebuggerUrl === "string",
                        );
                        if (target) {
                            this.page = await this.connect(target.webSocketDebuggerUrl);
                            return this.page;
                        }
                    }
                }
            } catch (error) {
                last = error;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw Error(`Browser startup deadline: ${String(last)}`);
    }
    async connect(url: string): Promise<DevTools> {
        this.assertOpen();
        const client = await connectDevTools(url, this.options);
        this.cleanup.unshift(["DevTools close", () => client.close()]);
        return client;
    }
    async browserConnection(): Promise<DevTools> {
        this.assertOpen();
        if (!this.port) throw Error("Browser not started");
        const response = await fetch(`http://127.0.0.1:${this.port}/json/version`, {
            signal: AbortSignal.timeout(1000),
        });
        const value: unknown = await response.json();
        if (
            !value ||
            typeof value !== "object" ||
            !("webSocketDebuggerUrl" in value) ||
            typeof value.webSocketDebuggerUrl !== "string"
        )
            throw Error("No browser target");
        return this.connect(value.webSocketDebuggerUrl);
    }
    async screenshot(path: string) {
        if (!this.page) return;
        const value = (await this.page.send("Page.captureScreenshot")) as { data: string };
        writeFileSync(path, Buffer.from(value.data, "base64"));
    }
    close(): Promise<CleanupRecord[]> {
        return (this.closed ??= cleanupSteps(this.cleanup, this.records));
    }
    async stop() {
        const records = await this.close();
        const failed = records.filter((r) => r.status === "failed");
        if (failed.length)
            throw new AggregateError(
                failed.map((r) => Error(`${r.resource}: ${r.error}`)),
                "Browser session cleanup failed",
            );
        return records;
    }
}
