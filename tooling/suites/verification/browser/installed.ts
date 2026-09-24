// NGNE_BROWSER and CHROME_BIN executable selection is delegated to BrowserSession.
// BrowserSession supplies "--remote-debugging-port" and "--user-data-dir"; these launch options remain supported.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BrowserSession } from "../../../core/browser/session.js";
import { type DevTools } from "../../../../tests/tooling/devtools.mjs";
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

/** Suite orchestration only. Workload policy stays outside the shared browser session. */
export async function installed(
    repository: string,
    suppliedManifest?: string,
    output?: string,
): Promise<Run> {
    const run = new Run(repository, "installed", output);
    let cdp: DevTools | undefined;
    const session = new BrowserSession();
    run.cleanup.push(["browser session", () => session.stop()]);
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
            const flags = [
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
            run.manifest.policy.browserFlags = flags;
            await run.stage("browser-start", async () => {
                cdp = await session.start({
                    flags,
                    profileParent: join(run.root, "work"),
                    log: join(run.evidence, "browser.log"),
                    transport: { requestTimeoutMs: 120000 },
                });
                const client = cdp;
                await client.send("Runtime.enable");
                await client.send("Page.enable");
                await client.send("Emulation.setFocusEmulationEnabled", { enabled: true });
                run.manifest.policy.focusEmulation = true;
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
            await session.screenshot(join(run.evidence, "failure.png"));
        },
    );
    return run;
}
