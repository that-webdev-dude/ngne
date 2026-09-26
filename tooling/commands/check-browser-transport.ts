import assert from "node:assert/strict";
import { join } from "node:path";
import { BrowserSession } from "../core/browser/session.js";
import { Run } from "../core/run.js";
import { identities, hash } from "../evidence/identity.js";
import { readFileSync } from "node:fs";

// Explicit wire/profiler capability check, not a performance workload or physical-GPU claim.
const run = new Run(process.cwd(), "browser-transport", process.argv[2]);
const session = new BrowserSession();
run.manifest.harness = {
    ...Object.fromEntries(
        Object.entries(identities(join(process.cwd(), "tooling/core/browser"))).map(
            ([path, digest]) => [`tooling/core/browser/${path}`, digest],
        ),
    ),
    ...Object.fromEntries(
        [
            "tooling/core/browser/devtools.mjs",
            "tooling/core/cleanup.mjs",
            "tooling/commands/check-browser-transport.ts",
        ].map((path) => [path, hash(readFileSync(path))]),
    ),
};
run.cleanup.push(["browser session", () => session.stop()]);
await run.execute(
    async () => {
        const page = await session.start({
            flags: [
                "--headless=new",
                "--no-first-run",
                ...(process.platform === "linux" ? ["--no-sandbox"] : []),
            ],
            log: join(run.evidence, "browser.log"),
            transport: { requestTimeoutMs: 120000 },
        });
        run.manifest.policy = {
            environment: process.platform,
            browser: await page.send("Browser.getVersion"),
            kind: "automated protocol capability; no performance or GPU claim",
        };
        await run.stage("large-replies", async () => {
            for (const bytes of [4260000, 5 * 1024 * 1024]) {
                const value = await page.evaluate<string>(`"x".repeat(${bytes})`);
                assert.equal(value.length, bytes);
                assert.equal(value, "x".repeat(bytes));
                run.record(`reply-${bytes}`, "observations", { bytes, matched: true });
            }
        });
        await run.stage("heap-profiler", async () => {
            await page.send("HeapProfiler.enable");
            await page.send("HeapProfiler.startSampling", { samplingInterval: 1024 });
            // Send authored data; browser parsing allocates the retained graph under the real profiler.
            const allocations = Array.from({ length: 100000 }, (_, i) => ({
                i,
                text: "allocation-" + i,
            }));
            await page.evaluate(
                `globalThis.protocolAllocations = ${JSON.stringify(allocations)}; true`,
            );
            const sampling = (await page.send("HeapProfiler.stopSampling")) as {
                profile: { samples: unknown[]; head: unknown };
            };
            assert(sampling.profile.samples.length > 0);
            run.record("sampling", "observations", sampling);
            const chunks: string[] = [];
            const off = page.on("HeapProfiler.addHeapSnapshotChunk", (value) =>
                chunks.push((value as { chunk: string }).chunk),
            );
            try {
                await page.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
            } finally {
                off();
            }
            const text = chunks.join("");
            const snapshot = JSON.parse(text) as { snapshot: { node_count: number } };
            assert(snapshot.snapshot.node_count > 0);
            run.record("snapshot", "observations", {
                chunks: chunks.length,
                bytes: Buffer.byteLength(text),
                sha256: hash(text),
                nodes: snapshot.snapshot.node_count,
            });
        });
        await run.stage("browser-trace", async () => {
            const browser = await session.browserConnection();
            const complete = browser.once("Tracing.tracingComplete", 30000);
            complete.catch(() => {});
            await browser.send("Tracing.start", {
                transferMode: "ReturnAsStream",
                categories: "v8",
            });
            await page.evaluate("1 + 1");
            await browser.send("Tracing.end");
            const { stream } = (await complete) as { stream: string };
            let text = "";
            for (;;) {
                const chunk = (await browser.send("IO.read", { handle: stream })) as {
                    data: string;
                    eof: boolean;
                    base64Encoded?: boolean;
                };
                text += chunk.base64Encoded
                    ? Buffer.from(chunk.data, "base64").toString()
                    : chunk.data;
                if (chunk.eof) break;
            }
            await browser.send("IO.close", { handle: stream });
            const events = (JSON.parse(text) as { traceEvents: unknown[] }).traceEvents.length;
            assert(events > 0);
            run.record("trace", "observations", {
                bytes: Buffer.byteLength(text),
                sha256: hash(text),
                events,
            });
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
