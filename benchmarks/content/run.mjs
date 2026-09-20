import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import {
    mkdirSync,
    cpSync,
    readFileSync,
    writeFileSync,
    appendFileSync,
    mkdtempSync,
    existsSync,
} from "node:fs";
import { resolve, join, extname } from "node:path";
import { tmpdir, release, platform, arch } from "node:os";
import { createServer } from "node:http";
import { hash, identities, generateChurn } from "./fixtures.mjs";
import { assertMounted, assertDisposed } from "../../tests/content-accounting.mjs";

const args = process.argv.slice(2),
    exploratory = args.includes("--explore");
const consumer = resolve(
    args.includes("--consumer") ? args[args.indexOf("--consumer") + 1] : "../ngne-town-dungeon",
);
const policy = JSON.parse(readFileSync(new URL("./policy.json", import.meta.url)));
const expectedEnvironment = JSON.parse(
    readFileSync(new URL("./environment.json", import.meta.url)),
);
const root = resolve(".test-output/content", new Date().toISOString().replaceAll(":", "-"));
mkdirSync(root, { recursive: true });
const save = (name, value) => writeFileSync(join(root, name), JSON.stringify(value, null, 2));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const revision = (cwd) =>
    execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
const manifest = {
    exploratory,
    policy,
    engine: revision(process.cwd()),
    consumer: revision(consumer),
    package: hash(readFileSync(join(consumer, "vendor/ngne-0.1.0.tgz"))),
    installed: identities(join(consumer, "node_modules/ngne")),
    build: identities(join(consumer, "dist")),
    source: identities(join(consumer, "src")),
    harness: identities(resolve("benchmarks/content")),
    os: { platform: platform(), release: release(), arch: arch() },
    node: process.version,
};
save("manifest.json", manifest);
save("policy.json", policy);
const production = join(root, "production"),
    churn = join(root, "churn");
cpSync(join(consumer, "dist"), production, { recursive: true });
cpSync(production, churn, { recursive: true });
generateChurn(churn, policy.distinctRooms);
save("fixtures.json", { production: identities(production), churn: identities(churn) });
let served = production;
const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const path = resolve(served, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!path.startsWith(served + "\\") && !path.startsWith(served + "/")) {
        res.writeHead(403).end();
        return;
    }
    if (!existsSync(path)) {
        res.writeHead(404).end();
        return;
    }
    const mime = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".png": "image/png",
        ".wav": "audio/wav",
    };
    res.writeHead(200, {
        "Content-Type": mime[extname(path)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
    });
    res.end(readFileSync(path));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}/`;
const runs = [];
async function connect(port) {
    let page;
    for (let attempt = 0; attempt < 100; attempt++) {
        try {
            page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(
                (p) => p.type === "page",
            );
        } catch {}
        if (page) break;
        await delay(100);
    }
    assert(page, "browser target available");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        ws.addEventListener("open", resolve, { once: true });
        ws.addEventListener("error", reject, { once: true });
    });
    let id = 0;
    const pending = new Map();
    ws.addEventListener("message", (event) => {
        const msg = JSON.parse(String(event.data));
        if (!msg.id) {
            appendFileSync(join(root, "browser-events.jsonl"), JSON.stringify(msg) + "\n");
            return;
        }
        const p = pending.get(msg.id);
        if (!p) return;
        clearTimeout(p.timer);
        pending.delete(msg.id);
        if (msg.error) p.reject(Error(msg.error.message));
        else p.resolve(msg.result);
    });
    const send = (method, params = {}) =>
        new Promise((resolve, reject) => {
            const call = ++id,
                timer = setTimeout(() => {
                    pending.delete(call);
                    reject(Error(method + " timed out"));
                }, 30000);
            pending.set(call, { resolve, reject, timer });
            ws.send(JSON.stringify({ id: call, method, params }));
        });
    const evaluate = async (expression) => {
        const value = await send("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
            userGesture: true,
        });
        if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails));
        return value.result.value;
    };
    return { send, evaluate, close: () => ws.close() };
}
function metrics(samples, checkpoints) {
    const values = samples.map((s) => s.ms).sort((a, b) => a - b);
    const first = checkpoints[0],
        last = checkpoints.at(-1);
    const xs = checkpoints.map((p) => p.transition),
        ys = checkpoints.map((p) => p.heap.usedSize);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length,
        my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const slope =
        xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) /
        xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    return {
        count: values.length,
        p50: values[Math.floor(values.length * 0.5)],
        p95: values[Math.ceil(values.length * 0.95) - 1],
        max: values.at(-1),
        heapGrowth: last.heap.usedSize - first.heap.usedSize,
        heapSlope: slope,
    };
}
try {
    for (let repetition = 0; repetition < (exploratory ? 1 : policy.repetitions); repetition++) {
        const port = 9450 + repetition,
            profile = mkdtempSync(join(tmpdir(), "ngne-content-"));
        const flags = [
            `--remote-debugging-port=${port}`,
            `--user-data-dir=${profile}`,
            "--no-first-run",
            "--disable-default-apps",
            "--disable-backgrounding-occluded-windows",
            "--window-size=1280,900",
            "about:blank",
        ];
        const executable =
            process.env.NGNE_BROWSER ??
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
        const child = spawn(executable, flags, { stdio: ["ignore", "pipe", "pipe"] });
        child.stdout.on("data", (bytes) =>
            appendFileSync(join(root, `browser-${repetition}.log`), bytes),
        );
        child.stderr.on("data", (bytes) =>
            appendFileSync(join(root, `browser-${repetition}.log`), bytes),
        );
        let cdp;
        try {
            cdp = await connect(port);
            await cdp.send("Page.enable");
            await cdp.send("Runtime.enable");
            await cdp.send("Emulation.setDeviceMetricsOverride", {
                width: policy.viewport[0],
                height: policy.viewport[1],
                deviceScaleFactor: 1,
                mobile: false,
            });
            await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
                source: readFileSync(new URL("./observe.js", import.meta.url), "utf8"),
            });
            const wait = async (expression) => {
                for (let i = 0; i < 200; i++) {
                    if (await cdp.evaluate(expression)) return;
                    await delay(50);
                }
                const state = await cdp.evaluate(
                    "({body:document.body?.innerText, visibility:document.visibilityState, observation: window.__contentMeasurement?.sample?.()})",
                );
                save("timeout-state.json", state);
                throw Error("Timeout: " + expression);
            };
            for (const workload of ["roundTrips", "churn"]) {
                served = workload === "churn" ? churn : production;
                const run = {
                    repetition,
                    workload,
                    status: "running",
                    samples: [],
                    checkpoints: [],
                    cancellations: [],
                    browser: await cdp.send("Browser.getVersion"),
                    flags: flags.filter((flag) => !flag.startsWith("--user-data-dir=")),
                };
                runs.push(run);
                await cdp.send("Page.navigate", { url: origin });
                await cdp.send("Page.bringToFront");
                await wait("document.querySelector('#room')?.textContent === 'Town courtyard'");
                await cdp.evaluate("document.querySelector('#audio').click()");
                await wait("window.__contentMeasurement.voices === 1");
                run.environment = await cdp.evaluate(
                    "({ gpu: window.__contentMeasurement.gpu, viewport: [innerWidth, innerHeight], userAgent: navigator.userAgent, dpr: devicePixelRatio })",
                );
                assert.equal(run.environment.gpu.length, 1);
                if (!exploratory) {
                    assert.deepEqual(
                        manifest.os,
                        expectedEnvironment.os,
                        "CHECK COMPARABILITY: OS",
                    );
                    assert.deepEqual(
                        run.browser,
                        expectedEnvironment.browser,
                        "CHECK COMPARABILITY: browser",
                    );
                    assert.deepEqual(
                        run.environment,
                        expectedEnvironment.environment,
                        "CHECK COMPARABILITY: GPU/viewport",
                    );
                }
                assert.equal(run.environment.gpu[0].isFallbackAdapter, false);
                assert(
                    !/swiftshader|warp|llvmpipe|basic render/i.test(
                        JSON.stringify(run.environment.gpu),
                    ),
                );
                const travel = async () => {
                    const sample = await cdp.evaluate("window.__contentMeasurement.travel()");
                    await delay(policy.settleMs);
                    sample.resources = await cdp.evaluate("window.__contentMeasurement.sample()");
                    run.lastObservation = sample;
                    assertMounted(sample.resources);
                    const expected =
                        workload === "roundTrips"
                            ? sample.from === "Town courtyard"
                                ? "Dungeon threshold"
                                : "Town courtyard"
                            : sample.from === "Town courtyard"
                              ? "churn-0"
                              : `churn-${(Number(sample.from.slice(6)) + 1) % policy.distinctRooms}`;
                    assert.equal(sample.to, expected);
                    return sample;
                };
                // Warm every bounded churn identity before measuring retained growth.
                const warm =
                    workload === "churn"
                        ? policy.warmupChurnVisits + 1
                        : policy.warmupRoundTrips * 2;
                for (let i = 0; i < warm; i++) await travel();
                const checkpoint = async (transition) => {
                    const sample = await cdp.evaluate("window.__contentMeasurement.sample()");
                    sample.transition = transition;
                    run.checkpoints.push(sample);
                    save("runs.json", runs);
                    assertMounted(sample);
                    await cdp.send("HeapProfiler.collectGarbage");
                    sample.heap = await cdp.send("Runtime.getHeapUsage");
                };
                await checkpoint(0);
                const count = exploratory
                    ? 20
                    : workload === "churn"
                      ? policy.churnVisits
                      : policy.roundTrips * 2;
                for (let i = 1; i <= count; i++) {
                    run.samples.push(await travel());
                    if (
                        i %
                            (workload === "churn"
                                ? policy.checkpointEvery
                                : policy.checkpointEvery * 2) ===
                        0
                    )
                        await checkpoint(i);
                }
                run.metrics = metrics(run.samples, run.checkpoints);
                if (workload === "churn") {
                    const distinct = new Map(
                        run.samples.map((s) => [
                            s.to,
                            s.resources.diagnostics.assets.audioBytes +
                                s.resources.diagnostics.assets.imageBytes,
                        ]),
                    );
                    assert.equal(distinct.size, policy.distinctRooms);
                    // Subtract the shared player bitmap from each room's total.
                    const sharedBytes = run.samples[0].resources.diagnostics.assets.entries.find(
                        (e) => e.id.endsWith("/player.png"),
                    ).estimatedBytes;
                    run.distinctDecodedBytes = [...distinct.values()].reduce(
                        (sum, bytes) => sum + bytes - sharedBytes,
                        0,
                    );
                    assert(run.distinctDecodedBytes > policy.retention.maxBytes);
                    assert(
                        run.samples.at(-1).resources.decodes - run.samples[0].resources.decodes >=
                            count - 1,
                        "evicted environments decode again on revisits",
                    );
                }
                // Controlled late decode cancellation outside latency/heap acceptance windows.
                for (let trial = 0; trial < 3; trial++) {
                    const before = await cdp.evaluate("window.__contentMeasurement.sample()");
                    await cdp.evaluate(
                        "window.__contentMeasurement.hold = true; document.querySelector('#travel').click()",
                    );
                    await wait("window.__contentMeasurement.waiting");
                    const pending = await cdp.evaluate("window.__contentMeasurement.sample()");
                    await cdp.evaluate("document.querySelector('#cancel').click()");
                    await cdp.evaluate("window.__contentMeasurement.release()");
                    await delay(250);
                    const after = await cdp.evaluate("window.__contentMeasurement.sample()");
                    run.cancellations.push({ before, pending, after });
                    save("runs.json", runs);
                    assertMounted(after);
                    assert.equal(after.room, before.room);
                    assert.equal(after.closed, before.closed + 1);
                    await travel();
                }
                await cdp.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide'))");
                await delay(250);
                run.disposal = await cdp.evaluate("window.__contentMeasurement.sample()");
                assertDisposed(run.disposal);
                run.visibilityChanges = await cdp.evaluate(
                    "window.__contentMeasurement.visibility",
                );
                assert(!run.visibilityChanges.includes("hidden"));
                const m = run.metrics,
                    b = policy.budgets;
                run.budgetPass =
                    m.p95 <= b.transitionP95Ms &&
                    m.max <= b.transitionMaxMs &&
                    m.heapGrowth <= b.retainedHeapGrowthBytes &&
                    m.heapSlope <= b.retainedHeapSlopeBytesPerTransition;
                assert(run.budgetPass, "predefined latency and retained heap criteria");
                run.status = "passed";
                save("runs.json", runs);
                console.log(JSON.stringify({ repetition, workload, ...run.metrics }));
            }
        } finally {
            if (cdp) {
                try {
                    await cdp.send("Browser.close");
                } catch {}
                cdp.close();
            }
            child.kill();
        }
    }
    save("result.json", {
        status: exploratory ? "exploratory" : "passed",
        root,
        runs: runs.length,
    });
} catch (error) {
    save("failure.json", { message: error.message, stack: error.stack });
    save("runs.json", runs);
    save("result.json", { status: "failed", root });
    console.error(error);
    process.exitCode = 1;
} finally {
    server.close();
    console.log(root);
}
