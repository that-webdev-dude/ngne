import assert from "node:assert/strict";
import { cpus } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Run } from "../core/run.js";
import { serve } from "../core/server.js";
import { BrowserSession } from "../core/browser/session.js";
import { hash } from "../evidence/identity.js";

// Run after npm run build:browser. Uses the existing benchmark page, evidence
// lifecycle, static server, browser owner and transport. Physical WebGPU required.
const run = new Run(process.cwd(), "texture-updates", process.argv[2]);
const session = new BrowserSession();
run.cleanup.push(["browser session", () => session.stop()]);
const flags = [
    "--no-first-run",
    "--window-size=1280,800",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
];
if (process.platform === "linux") flags.push("--no-sandbox");
run.manifest.policy = {
    cpu: cpus()[0]?.model ?? "unknown",
    flags,
    metric: "API-to-validated-readiness; no GPU completion or presentation timing",
    workload:
        "512x512 texture; 40 serial 16x16 edits per repetition; 6 alternating pairs; initialization separate",
};
run.manifest.harness = Object.fromEntries(
    [
        "src/webgpu-runtime.ts",
        "src/texture-assets.ts",
        "src/webgpu-renderer.ts",
        "tooling/commands/texture-updates.ts",
        "tooling/suites/benchmarks/rendering/texture-update-fixture.ts",
    ].map((path) => [path, hash(readFileSync(path))]),
);
run.manifest.provenance = {
    revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    changes: hash(execFileSync("git", ["diff", "--binary"], { encoding: "utf8" })),
};
await run.execute(
    async () => {
        const origin = await serve(run, join(process.cwd(), "dist-browser"), "/");
        const page = await session.start({
            flags,
            log: join(run.evidence, "browser.log"),
            transport: { requestTimeoutMs: 120000 },
        });
        run.manifest.policy.browser = await page.send("Browser.getVersion");
        await page.send("Page.enable");
        const loaded = page.once("Page.loadEventFired", 20000);
        await page.send("Page.navigate", {
            url: `${origin}tooling/suites/benchmarks/rendering/browser/index.html?workload=texture-updates`,
        });
        await loaded;
        await run.stage("repeated-edits", async () => {
            let result: { error?: string; data?: Record<string, unknown> } = {};
            const deadline = Date.now() + 120000;
            do {
                result = await page.evaluate(
                    `({ error: document.body.dataset.rendererBenchmarkError, data: window.__ngneTextureUpdateBenchmark })`,
                );
                if (result.error || result.data) break;
                await new Promise((resolve) => setTimeout(resolve, 250));
            } while (Date.now() < deadline);
            if (result.error) throw new Error(result.error);
            assert(result.data, "Texture comparison timed out");
            run.record("repeated-edits", "measurements", result.data);
            assert.equal(result.data.visibility, "visible");
            const adapter = result.data.adapter as {
                isFallbackAdapter: boolean;
                description: string;
                vendor: string;
            };
            assert(
                !adapter.isFallbackAdapter &&
                    !/swiftshader|software|warp|llvmpipe|basic render/i.test(
                        `${adapter.vendor} ${adapter.description}`,
                    ),
                "Comparison requires hardware WebGPU",
            );
            const renderingDevices = result.data.renderingDevices as (typeof adapter)[];
            assert.equal(renderingDevices.length, 12);
            assert(
                renderingDevices.every(
                    (device) =>
                        !device.isFallbackAdapter &&
                        !/swiftshader|software|warp|llvmpipe|basic render/i.test(
                            `${device.vendor} ${device.description}`,
                        ),
                ),
                "All measured devices must use hardware WebGPU",
            );
            const samples = result.data.samples as {
                method: string;
                readinessMs: number[];
                counters: {
                    allocations: number;
                    bindings: number;
                    copies: number;
                    transferredPixels: number;
                    snapshots: number;
                    snapshotPixels: number;
                };
            }[];
            assert.equal(samples.length, 12);
            for (const sample of samples) {
                assert.equal(sample.readinessMs.length, 40);
                assert(sample.readinessMs.every((ms) => Number.isFinite(ms) && ms >= 0));
                assert.deepEqual(
                    sample.counters,
                    sample.method === "patch"
                        ? {
                              allocations: 0,
                              bindings: 0,
                              copies: 40,
                              transferredPixels: 40 * 16 * 16,
                              snapshots: 40,
                              snapshotPixels: 40 * 16 * 16,
                          }
                        : {
                              allocations: 40,
                              bindings: 40,
                              copies: 40,
                              transferredPixels: 40 * 512 * 512,
                              snapshots: 40,
                              snapshotPixels: 40 * 512 * 512,
                          },
                );
            }
            run.manifest.preparation = "prepared";
        });
    },
    () => session.screenshot(join(run.evidence, "failure.png")),
);
console.log(
    JSON.stringify({
        accepted: run.result.accepted,
        evidence: run.evidence,
        failures: run.result.failures,
    }),
);
if (!run.result.accepted) process.exitCode = 1;
