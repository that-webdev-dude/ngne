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

export async function content(
    repository: string,
    options: { manifest?: string; output?: string; smoke?: boolean } = {},
): Promise<Run> {
    const run = new Run(repository, "content-engine", options.output);
    const session = new BrowserSession();
    run.cleanup.push(["browser session", () => session.stop()]);
    await run.execute(
        async () => {
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
                mode: "exploratory",
                workload: "engine-resource-churn-v1",
                method: "prepare-to-mounted-and-rendered-ordinary-frames-v1",
                count,
                repetitions,
                warmup: 12,
                scenes: 12,
                generatedImages: 13,
                retention: { maxEntries: 3, maxBytes: 1048576 },
                budgets: "not established for this new workload",
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
            const verify = () => {
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
            run.manifest.policy.browserVersion = await client.send("Browser.getVersion");
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
                    run.record(`repetition-${repetition}`, "measurements", { raw, base, metrics });
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
