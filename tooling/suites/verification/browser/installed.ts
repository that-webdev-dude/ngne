import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ownProcess } from "../../../../tests/tooling/cleanup.mjs";
import { connectDevTools, type DevTools } from "../../../../tests/tooling/devtools.mjs";
import { Run } from "../../../core/run.js";
import { copyPreparedBuild, prepare, verifyPrepared } from "../../../core/preparation.js";
import { serve } from "../../../core/server.js";
import { hash, identities } from "../../../evidence/identity.js";

export function readObservation(value: unknown): {
    status: string;
    passed: string[];
    failures: string[];
    environment: Record<string, unknown>;
    samples: Record<string, unknown>;
} {
    if (!value || typeof value !== "object") throw Error("Missing browser observation");
    const v = value as Record<string, unknown>;
    if (
        !["passed", "failed"].includes(String(v.status)) ||
        !Array.isArray(v.passed) ||
        !v.passed.every((x) => typeof x === "string") ||
        !Array.isArray(v.failures) ||
        !v.failures.every((x) => typeof x === "string") ||
        !v.environment ||
        typeof v.environment !== "object" ||
        !v.samples ||
        typeof v.samples !== "object"
    )
        throw Error("Invalid browser observation");
    if (v.status === "passed" && (!v.passed.length || v.failures.length))
        throw Error("Contradictory browser success");
    return v as ReturnType<typeof readObservation>;
}

/** Suite orchestration only. Uses existing wire transport and process-tree owner pending session consolidation. */
export async function installed(
    repository: string,
    suppliedManifest?: string,
    output?: string,
): Promise<Run> {
    const run = new Run(repository, "installed", output);
    let cdp: DevTools | undefined;
    await run.execute(
        async () => {
            let manifestPath = suppliedManifest;
            await run.stage("preparation", async () => {
                if (!manifestPath) {
                    const preparation = await prepare(repository, join(run.root, "preparation"));
                    if (!preparation.result.accepted)
                        throw Error(
                            `Package preparation failed: ${JSON.stringify(preparation.result.failures)}`,
                        );
                    manifestPath = join(preparation.evidence, "manifest.json");
                }
                verifyPrepared(manifestPath);
            });
            if (!manifestPath) throw Error("Missing prepared manifest");
            const preparedPath = manifestPath;
            const manifest = verifyPrepared(manifestPath);
            run.manifest.preparation = "prepared";
            run.manifest.provenance = manifest.provenance;
            run.manifest.policy = {
                preparationRunId: manifest.runId,
                preparationManifestSHA256: hash(readFileSync(manifestPath)),
                packageSHA256: manifest.prepared!.package.sha256,
                bases: ["/", "/nested/"],
                manualVisual: "not evaluated",
                manualAudible: "not evaluated",
            };
            run.manifest.harness = {
                ...manifest.harness,
                ...Object.fromEntries(
                    ["tooling/core", "tooling/evidence", "tooling/commands"].flatMap((directory) =>
                        Object.entries(identities(join(repository, directory))).map(
                            ([path, digest]) => [`${directory}/${path}`, digest],
                        ),
                    ),
                ),
                ...Object.fromEntries(
                    Object.entries(
                        identities(join(repository, "tooling/suites/verification/browser")),
                    ).map(([p, h]) => [`tooling/suites/verification/browser/${p}`, h]),
                ),
                "tests/tooling/devtools.mjs": hash(
                    readFileSync(join(repository, "tests/tooling/devtools.mjs")),
                ),
                "tests/tooling/cleanup.mjs": hash(
                    readFileSync(join(repository, "tests/tooling/cleanup.mjs")),
                ),
            };
            const profile = join(run.root, "work/profile");
            mkdirSync(profile, { recursive: true });
            const flags = [
                "--remote-debugging-port=0",
                `--user-data-dir=${profile}`,
                "--no-first-run",
                "--disable-default-apps",
                "--disable-dev-shm-usage",
                "--disable-background-timer-throttling",
                "--disable-renderer-backgrounding",
                "--window-size=800,600",
            ];
            if (process.env.NGNE_BROWSER_HEADLESS !== "0") flags.push("--headless=new");
            if (process.env.NGNE_WEBGPU_ADAPTER === "swiftshader") {
                flags.push(
                    "--use-webgpu-adapter=swiftshader",
                    "--enable-unsafe-webgpu",
                    "--enable-unsafe-swiftshader",
                );
                if (process.platform === "linux")
                    flags.push(
                        "--enable-features=Vulkan",
                        "--use-angle=vulkan",
                        "--use-vulkan=swiftshader",
                        "--disable-vulkan-surface",
                    );
            }
            if (process.platform === "linux") flags.push("--no-sandbox");
            const executable =
                process.env.NGNE_BROWSER ??
                process.env.CHROME_BIN ??
                (process.platform === "win32"
                    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
                    : "google-chrome");
            run.manifest.policy.browserFlags = flags.filter(
                (x) => !x.startsWith("--user-data-dir="),
            );
            const browser = spawn(executable, [...flags, "about:blank"], {
                windowsHide: true,
                detached: process.platform !== "win32",
                stdio: ["ignore", "pipe", "pipe"],
            });
            const owner = ownProcess(browser, "installed browser");
            run.cleanup.unshift(["browser terminate/verify", () => owner.stop()]);
            for (const stream of [browser.stdout, browser.stderr])
                stream.on("data", (bytes) =>
                    appendFileSync(join(run.evidence, "browser.log"), bytes),
                );
            await run.stage("browser-start", async () => {
                const deadline = Date.now() + 20000;
                while (!cdp) {
                    owner.check();
                    if (Date.now() > deadline) throw Error("Browser startup deadline");
                    const portFile = join(profile, "DevToolsActivePort");
                    if (existsSync(portFile)) {
                        const port = Number(readFileSync(portFile, "utf8").split(/\r?\n/)[0]);
                        const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
                            signal: AbortSignal.timeout(1000),
                        });
                        const targets: unknown = await response.json();
                        if (Array.isArray(targets)) {
                            const page = targets.find(
                                (v: unknown): v is { type: string; webSocketDebuggerUrl: string } =>
                                    !!v &&
                                    typeof v === "object" &&
                                    "type" in v &&
                                    v.type === "page" &&
                                    "webSocketDebuggerUrl" in v &&
                                    typeof v.webSocketDebuggerUrl === "string",
                            );
                            if (page)
                                cdp = await connectDevTools(page.webSocketDebuggerUrl, {
                                    requestTimeoutMs: 120000,
                                });
                        }
                    }
                    if (!cdp) await new Promise((resolve) => setTimeout(resolve, 100));
                }
                const client = cdp;
                run.cleanup.unshift(["DevTools close", () => client.close()]);
                await client.send("Runtime.enable");
                await client.send("Page.enable");
                client.on("Runtime.exceptionThrown", (value) =>
                    appendFileSync(
                        join(run.evidence, "exceptions.log"),
                        JSON.stringify(value) + "\n",
                    ),
                );
                run.manifest.policy.browserVersion = await client.send("Browser.getVersion");
            });
            for (const base of ["root", "nested"] as const)
                await run.stage(base, async () => {
                    const client = cdp!;
                    const build = join(run.root, `work/${base}`);
                    copyPreparedBuild(preparedPath, base, build);
                    const url = await serve(run, build, base === "root" ? "/" : "/nested/");
                    await client.send("Page.navigate", { url });
                    const end = Date.now() + 20000;
                    while (!(await client.evaluate<boolean>("Boolean(window.installedEngine)"))) {
                        if (Date.now() > end) throw Error("Installed fixture readiness deadline");
                        await new Promise((resolve) => setTimeout(resolve, 100));
                    }
                    const raw = await client.evaluate("window.installedEngine.run()", true);
                    run.record(base, "observations", { raw });
                    const result = readObservation(raw);
                    run.record(base, "observations", result);
                    if (result.status !== "passed" || result.failures.length)
                        throw Error(`${base}: ${result.failures.join("; ")}`);
                    // Check identities again after execution: the prepared inputs must remain immutable.
                    verifyPrepared(preparedPath);
                });
        },
        async () => {
            if (!cdp) return;
            const reply = (await cdp.send("Page.captureScreenshot")) as { data: string };
            writeFileSync(join(run.evidence, "failure.png"), Buffer.from(reply.data, "base64"));
        },
    );
    return run;
}
