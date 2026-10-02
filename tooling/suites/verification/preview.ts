import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Run } from "../../core/run.js";
import { command, npmPath } from "../../core/process.js";
import { verifyPrepared } from "../../core/preparation.js";
import { BrowserSession } from "../../core/browser/session.js";
import { hash, identities, verifyIdentities } from "../../evidence/identity.js";
import type { DevTools } from "../../core/browser/devtools.mjs";
import { previewConsumerIdentity, verifyPreviewConsumer } from "./preview-consumer.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(client: DevTools, expression: string): Promise<void> {
    const end = Date.now() + 20000;
    while (!(await client.evaluate<boolean>(expression))) {
        if (Date.now() > end)
            throw Error(
                `Browser deadline: ${expression}; ${await client.evaluate("document.body.innerText")}`,
            );
        await delay(50);
    }
}

/** Installed slice verification using the existing evidence and process/browser owners. */
export async function verifyPreview(
    repository: string,
    manifestPath: string,
    suppliedFixture?: string,
): Promise<Run> {
    const run = new Run(repository, "preview");
    const session = new BrowserSession();
    run.cleanup.push(["browser and preview process trees", () => session.stop()]);
    let client: DevTools | undefined;
    await run.execute(
        async () => {
            const manifest = verifyPrepared(manifestPath),
                pkg = manifest.prepared!.package;
            run.manifest.provenance = manifest.provenance;
            run.manifest.harness = Object.fromEntries(
                ["tooling/preview", "tooling/suites/verification"].flatMap((dir) =>
                    Object.entries(identities(join(repository, dir))).map(([path, digest]) => [
                        `${dir}/${path}`,
                        digest,
                    ]),
                ),
            );
            run.manifest.policy = {
                packageSHA256: pkg.sha256,
                packageFilename: pkg.filename,
                preparationManifestSHA256: hash(readFileSync(manifestPath)),
                scope: suppliedFixture ? "external adapter snapshot" : "generic diagnostic fixture",
                manualArtApproval: "not evaluated",
                physicalGPU: "not evaluated",
                browserZoom: "100% in fresh profile; page scale 1",
            };
            const installation = join(run.root, "work/consumer");
            const fixture = suppliedFixture ?? join(repository, "tooling/fixtures/preview");
            const fixtureIdentity = identities(fixture);
            let consumerIdentity: ReturnType<typeof previewConsumerIdentity>;
            await run.stage("install", async () => {
                mkdirSync(installation, { recursive: true });
                cpSync(fixture, installation, { recursive: true });
                cpSync(
                    join(dirname(dirname(manifestPath)), pkg.path),
                    join(installation, pkg.filename),
                );
                writeFileSync(
                    join(installation, "package.json"),
                    JSON.stringify(
                        {
                            name: "ngne-preview-review",
                            private: true,
                            type: "module",
                            scripts: { "preview:assets": "ngne-preview ./preview.config.mjs" },
                            dependencies: { ngne: `file:./${pkg.filename}` },
                        },
                        null,
                        2,
                    ),
                );
                for (const [stage, args] of [
                    ["lock", ["install", "--package-lock-only"]],
                    ["install", ["ci"]],
                ] as const)
                    await command(
                        run,
                        stage,
                        process.execPath,
                        [
                            npmPath(),
                            ...args,
                            "--offline",
                            "--ignore-scripts",
                            "--no-audit",
                            "--no-fund",
                            "--cache",
                            join(run.root, "work/cache"),
                        ],
                        installation,
                    );
                verifyIdentities(join(installation, "node_modules/ngne"), pkg.files);
                consumerIdentity = previewConsumerIdentity(installation);
                run.record("install", "observations", {
                    version: JSON.parse(
                        readFileSync(join(installation, "node_modules/ngne/package.json"), "utf8"),
                    ).version,
                    tarballSHA256: pkg.sha256,
                    fixture: fixtureIdentity,
                    consumer: consumerIdentity,
                    npmScript: "npm.cmd run preview:assets",
                });
                run.manifest.preparation = "prepared";
            });
            const launch = async (config: string, label: string) => {
                verifyPreviewConsumer(installation, consumerIdentity);
                // The installed npm shim runs Node with reads restricted to this independent consumer.
                // No source checkout, Vite, tsx, adapter transpiler or global renderer is accessible.
                const executable =
                    process.platform === "win32"
                        ? "cmd.exe"
                        : join(installation, "node_modules/.bin/ngne-preview");
                const args =
                    process.platform === "win32"
                        ? ["/d", "/c", `node_modules\\.bin\\ngne-preview.cmd ${config}`]
                        : [config];
                const nodeOptions = `--permission --allow-fs-read=${JSON.stringify(installation)}`;
                const { child, owner } = session.ownProcess(
                    executable,
                    args,
                    label,
                    {
                        cwd: installation,
                        env: { ...process.env, NODE_OPTIONS: nodeOptions },
                    },
                    join(run.evidence, `${label}.log`),
                );
                let stdout = "",
                    url = "";
                child.stdout?.on("data", (bytes: Buffer) => {
                    stdout += bytes.toString();
                });
                const end = Date.now() + 15000;
                while (!url) {
                    owner.check();
                    url = stdout.match(/NGNE preview: (http:\/\/127\.0\.0\.1:\d+\/)/)?.[1] ?? "";
                    if (Date.now() > end) throw Error("Installed command startup deadline");
                    await delay(50);
                }
                run.record(label, "observations", {
                    executable,
                    args,
                    nodeOptions,
                    url,
                });
                return url;
            };
            let url = "";
            await run.stage("installed-command", async () => {
                url = await launch("preview.config.mjs", "installed-command");
                const served: Record<string, string> = {};
                for (const [path, digest] of Object.entries(pkg.files)) {
                    if (!path.startsWith("dist/engine/") || !path.endsWith(".js")) continue;
                    const response = await fetch(url + path.replace("dist/engine/", "engine/"));
                    assert.equal(response.status, 200);
                    const actual = hash(Buffer.from(await response.arrayBuffer()));
                    assert.equal(actual, digest, path);
                    served[path] = actual;
                }
                assert.equal((await fetch(url + "host.js")).status, 404);
                assert.equal((await fetch(url + "package.json")).status, 404);
                run.record("served-modules", "observations", {
                    installedInventoryMatches: true,
                    modules: served,
                });
            });
            const flags = [
                "--headless=new",
                "--no-first-run",
                "--disable-default-apps",
                "--window-size=1100,850",
                "--force-device-scale-factor=1",
                "--use-webgpu-adapter=swiftshader",
                "--enable-unsafe-webgpu",
                "--enable-unsafe-swiftshader",
            ];
            if (process.platform === "linux")
                flags.push(
                    "--no-sandbox",
                    "--enable-features=Vulkan",
                    "--use-angle=vulkan",
                    "--use-vulkan=swiftshader",
                    "--disable-vulkan-surface",
                );
            await run.stage("browser", async () => {
                client = await session.start({
                    flags,
                    profileParent: join(run.root, "work"),
                    log: join(run.evidence, "browser.log"),
                });
                await client.send("Page.enable");
                await client.send("Runtime.enable");
                await client.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
                await client.send("Page.navigate", { url });
                await until(
                    client,
                    "document.querySelector('#status')?.textContent.startsWith('Ready') || document.querySelector('#error')?.textContent.length > 0",
                );
                assert.equal(
                    await client.evaluate("document.querySelector('#error').textContent"),
                    "",
                );
                const environment =
                    await client.evaluate(`(async () => { const adapter = await navigator.gpu.requestAdapter(); const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return {
                userAgent: navigator.userAgent, gpu: adapter && {vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device, description: adapter.info.description},
                viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, canvas: [c.width, c.height], css: [r.width, r.height], details: document.querySelector('#details').textContent }; })()`);
                run.record("browser", "observations", {
                    environment,
                    flags,
                    version: await client.send("Browser.getVersion"),
                });
                await session.screenshot(join(run.evidence, "initial.png"));
                if (!suppliedFixture) {
                    assert.deepEqual(
                        await client.evaluate(
                            "[document.querySelector('canvas').width, document.querySelector('canvas').height]",
                        ),
                        [20, 24],
                    );
                    assert.deepEqual(
                        await client.evaluate(
                            "[document.querySelector('canvas').getBoundingClientRect().width, document.querySelector('canvas').getBoundingClientRect().height]",
                        ),
                        [40, 48],
                    );
                    await client.evaluate(
                        "document.querySelector('#frames').value = 'kite'; document.querySelector('#frames').dispatchEvent(new Event('change'))",
                    );
                    await until(
                        client,
                        "document.querySelector('#details').textContent.startsWith('Frame kite')",
                    );
                    assert.deepEqual(
                        await client.evaluate(
                            "['selection-name', 'playback-state', 'selection-summary', 'sprite-size'].map(id => document.getElementById(id).textContent)",
                        ),
                        ["kite", "Still", "Standalone frame", "20 × 44 CSS px at 1×"],
                    );
                    await session.screenshot(join(run.evidence, "different-size.png"));
                    await client.evaluate(
                        "document.querySelector('#frames').value = 'badge'; document.querySelector('#frames').dispatchEvent(new Event('change'))",
                    );
                    await until(
                        client,
                        "document.querySelector('#details').textContent.startsWith('Frame badge')",
                    );
                    assert.equal(
                        await client.evaluate("document.querySelector('#play').disabled"),
                        true,
                    );
                    await session.screenshot(join(run.evidence, "standalone.png"));
                }
            });
            const page = client!;
            await run.stage("stepping", async () => {
                await page.evaluate(
                    "{ const s = document.querySelector('#animations'); s.selectedIndex = 1; s.dispatchEvent(new Event('change')); }",
                );
                await until(page, "!document.querySelector('#next').disabled");
                if (!suppliedFixture)
                    assert.deepEqual(
                        await page.evaluate(
                            "['selection-name', 'playback-state', 'selection-summary', 'sprite-size'].map(id => document.getElementById(id).textContent)",
                        ),
                        [
                            "signal-loop",
                            "Paused",
                            "Entry 1/3 · 80 ms · Loop",
                            "36 × 28 CSS px at 1×",
                        ],
                    );
                const count = await page.evaluate<number>(
                    "parseInt(document.querySelector('#entry').textContent.split('entry 1/')[1], 10)",
                );
                const labels: string[] = [];
                for (const button of [
                    "previous",
                    ...Array<string>(count + 1).fill("next"),
                    ...Array<string>(count + 1).fill("previous"),
                ]) {
                    await page.evaluate(`document.querySelector('#${button}').click()`);
                    await page.evaluate(
                        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
                    );
                    labels.push(
                        await page.evaluate<string>("document.querySelector('#entry').textContent"),
                    );
                }
                assert.ok(labels[0].includes("entry 1/") && labels[0].includes("elapsed 0.0/"));
                assert.equal(labels[count - 1], labels[count]);
                assert.equal(labels[count], labels[count + 1]);
                assert.equal(labels.at(-1), labels[0]);
                assert.ok(labels.every((label) => label.includes("paused")));
                if (!suppliedFixture) {
                    assert.ok(
                        labels[1].includes("entry 2/3") && labels[1].includes("elapsed 80.0/400"),
                    );
                    assert.ok(
                        labels[2].includes("entry 3/3") && labels[2].includes("elapsed 200.0/400"),
                    );
                }
                await page.evaluate("document.querySelector('#play').click()");
                await until(
                    page,
                    "document.querySelector('#next').disabled && document.querySelector('#previous').disabled",
                );
                await page.evaluate("document.querySelector('#play').click()");
                await until(page, "!document.querySelector('#next').disabled");
                await page.evaluate(
                    "document.querySelector('#frames').dispatchEvent(new Event('change'))",
                );
                await until(
                    page,
                    "document.querySelector('#next').disabled && document.querySelector('#previous').disabled",
                );
                run.record("stepping", "observations", {
                    labels,
                    playingAndStandaloneDisabled: true,
                });
            });
            await run.stage("magnification", async () => {
                if (!suppliedFixture) {
                    await page.evaluate(
                        "{ const s = document.querySelector('#frames'); s.value = 'detail-loss'; s.dispatchEvent(new Event('change')); }",
                    );
                    await until(
                        page,
                        "document.querySelector('#details').textContent.startsWith('Frame detail-loss')",
                    );
                }
                const geometry = () =>
                    page.evaluate<{ backing: number[]; css: number[]; details: string }>(
                        "{ const c = document.querySelector('canvas'), r = c.getBoundingClientRect(); ({ backing: [c.width, c.height], css: [r.width, r.height], details: document.querySelector('#details').textContent }); }",
                    );
                const capture = async (name: string) => {
                    const clip = await page.evaluate<{
                        x: number;
                        y: number;
                        width: number;
                        height: number;
                        scale: number;
                    }>(
                        "{ const r = document.querySelector('canvas').getBoundingClientRect(); ({ x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height, scale: 1 }); }",
                    );
                    const shot = (await page.send("Page.captureScreenshot", {
                        format: "png",
                        clip,
                    })) as { data: string };
                    writeFileSync(join(run.evidence, name), Buffer.from(shot.data, "base64"));
                    // Decode only the test screenshot; the product still renders exclusively with WebGPU.
                    return page.evaluate<{ width: number; height: number; pixels: number[] }>(
                        `(async () => { const b = await createImageBitmap(await (await fetch('data:image/png;base64,${shot.data}')).blob()); const c = new OffscreenCanvas(b.width, b.height), ctx = c.getContext('2d'); ctx.drawImage(b, 0, 0); const result = { width: b.width, height: b.height, pixels: Array.from(ctx.getImageData(0, 0, b.width, b.height).data) }; b.close(); return result; })()`,
                    );
                };
                const original = await geometry();
                const baselinePixels = !suppliedFixture
                    ? await capture("detail-baseline.png")
                    : undefined;
                const observations = [original];
                for (const zoom of [2, 4, 8]) {
                    await page.evaluate(
                        `{ const s = document.querySelector('#magnification'); s.value = '${zoom}'; s.dispatchEvent(new Event('change')); }`,
                    );
                    await until(
                        page,
                        `document.querySelector('#details').textContent.includes('magnification: ${zoom}×')`,
                    );
                    const magnified = await geometry();
                    assert.deepEqual(magnified.backing, original.backing);
                    assert.deepEqual(
                        magnified.css,
                        original.css.map((value) => value * zoom),
                    );
                    observations.push(magnified);
                    if (zoom === 4 && baselinePixels) {
                        const enlarged = await capture("detail-magnified.png");
                        assert.equal(enlarged.width, baselinePixels.width * zoom);
                        assert.equal(enlarged.height, baselinePixels.height * zoom);
                        for (let y = 0; y < enlarged.height; y++)
                            for (let x = 0; x < enlarged.width; x++)
                                for (let channel = 0; channel < 4; channel++)
                                    assert.equal(
                                        enlarged.pixels[(y * enlarged.width + x) * 4 + channel],
                                        baselinePixels.pixels[
                                            (Math.floor(y / zoom) * baselinePixels.width +
                                                Math.floor(x / zoom)) *
                                                4 +
                                                channel
                                        ],
                                        `magnified pixel ${x},${y},${channel}`,
                                    );
                        const colors = new Set<string>();
                        for (let i = 0; i < baselinePixels.pixels.length; i += 4)
                            colors.add(baselinePixels.pixels.slice(i, i + 3).join(","));
                        // The source has both colors. Half-size nearest sampling discards one stripe color.
                        assert.notEqual(colors.has("255,0,0"), colors.has("0,255,0"));
                        run.record("detail-loss", "observations", {
                            source: "8x4 alternating red/green stripes",
                            render: "4x2",
                            baselineColors: [...colors],
                            magnifiedPixelsExactlyReplicateBaseline: true,
                            zoom,
                        });
                    }
                }
                await page.evaluate(
                    "{ document.querySelector('#stage').scrollLeft = 400; document.querySelector('#baseline').click(); }",
                );
                await until(
                    page,
                    "document.querySelector('#details').textContent.includes('magnification: 1× (baseline)')",
                );
                assert.deepEqual(await geometry(), original);
                assert.equal(await page.evaluate("document.querySelector('#stage').scrollLeft"), 0);
                assert.equal(
                    await page.evaluate("document.querySelector('#magnification').value"),
                    "1",
                );
                run.record("magnification", "observations", {
                    observations,
                    baselineRestored: true,
                });
            });
            await run.stage("inspection-viewport", async () => {
                const settle = () =>
                    page.evaluate(
                        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
                    );
                const measure = () =>
                    page.evaluate<{
                        center: number[];
                        backing: number[];
                        viewport: number[];
                        canvas: number[];
                        document: number[];
                        controlsVisible: boolean;
                        captured: boolean;
                    }>(`(() => {
                    const s = document.querySelector('#stage'), c = document.querySelector('canvas');
                    const r = s.getBoundingClientRect(), b = c.getBoundingClientRect();
                    const zoom = Number(document.querySelector('#magnification').value);
                    const controls = [...document.querySelectorAll('#controls button, #controls select')].map(e => e.getBoundingClientRect());
                    return { center: [(r.x + s.clientLeft + s.clientWidth / 2 - b.x) / zoom, (r.y + s.clientTop + s.clientHeight / 2 - b.y) / zoom],
                        backing: [c.width, c.height], viewport: [r.x, r.y, r.width, r.height], canvas: [b.x, b.y, b.width, b.height],
                        document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight, innerWidth, innerHeight],
                        controlsVisible: controls.every(b => b.x >= 0 && b.y >= 0 && b.right <= innerWidth && b.bottom <= r.y),
                        captured: s.classList.contains('dragging') };
                })()`);
                const zoomTo = async (zoom: number) => {
                    await page.evaluate(
                        `{ const s = document.querySelector('#magnification'); s.value = '${zoom}'; s.dispatchEvent(new Event('change')); }`,
                    );
                    await settle();
                };
                const key = async (key: string) => {
                    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key });
                    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key });
                    await settle();
                };
                const baseline = await measure();
                await zoomTo(8);
                const rect = (await measure()).viewport;
                const x = rect[0] + rect[2] / 2,
                    y = rect[1] + rect[3] / 2;
                await page.send("Input.dispatchMouseEvent", {
                    type: "mousePressed",
                    x,
                    y,
                    button: "left",
                    clickCount: 1,
                });
                await page.send("Input.dispatchMouseEvent", {
                    type: "mouseMoved",
                    x: x + 48,
                    y: y + 32,
                    button: "left",
                    buttons: 1,
                });
                await settle();
                const dragged = await measure();
                assert.ok(dragged.captured);
                assert.ok(Math.abs(dragged.center[0] - baseline.center[0] + 6) < 0.6);
                assert.ok(Math.abs(dragged.center[1] - baseline.center[1] + 4) < 0.6);
                // Real captured release outside the viewport must terminate panning.
                await page.send("Input.dispatchMouseEvent", {
                    type: "mouseReleased",
                    x,
                    y: 4,
                    button: "left",
                    clickCount: 1,
                });
                await settle();
                assert.equal((await measure()).captured, false);
                await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x + 80, y });
                await settle();
                assert.deepEqual((await measure()).center, dragged.center);
                const observations = [];
                for (const zoom of [4, 2, 1, 8]) {
                    await zoomTo(zoom);
                    const current = await measure();
                    current.center.forEach((v, i) =>
                        assert.ok(
                            Math.abs(v - dragged.center[i]) <= 1,
                            "retained inspection center",
                        ),
                    );
                    assert.deepEqual(current.backing, baseline.backing);
                    assert.deepEqual(current.document.slice(0, 2), current.document.slice(2));
                    assert.ok(current.controlsVisible);
                    observations.push({ zoom, ...current });
                }
                const wheelZooms = [];
                for (const [deltaY, expected] of [
                    [120, 4],
                    [120, 2],
                    [120, 1],
                    [120, 1],
                    [-120, 2],
                    [-120, 4],
                    [-120, 8],
                    [-120, 8],
                    [0, 8],
                ]) {
                    await page.send("Input.dispatchMouseEvent", {
                        type: "mouseWheel",
                        x,
                        y,
                        deltaX: 16,
                        deltaY,
                    });
                    await settle();
                    const actual = await page.evaluate<number>(
                        "Number(document.querySelector('#magnification').value)",
                    );
                    assert.equal(actual, expected);
                    const current = await measure();
                    current.center.forEach((v, i) =>
                        assert.ok(
                            Math.abs(v - dragged.center[i]) <= 1,
                            "wheel keeps inspection center",
                        ),
                    );
                    assert.deepEqual(current.backing, baseline.backing);
                    wheelZooms.push(actual);
                }
                await key("ArrowRight");
                assert.ok((await measure()).center[0] > dragged.center[0]);
                // Captured left-button dragging can reach every edge even beyond the viewport.
                for (const sign of [-1, 1]) {
                    await page.send("Input.dispatchMouseEvent", {
                        type: "mousePressed",
                        x,
                        y,
                        button: "left",
                        clickCount: 1,
                    });
                    await page.send("Input.dispatchMouseEvent", {
                        type: "mouseMoved",
                        x: x + sign * 100000,
                        y: y + sign * 100000,
                        button: "left",
                        buttons: 1,
                    });
                    await page.send("Input.dispatchMouseEvent", {
                        type: "mouseReleased",
                        x: x + sign * 100000,
                        y: y + sign * 100000,
                        button: "left",
                        clickCount: 1,
                    });
                    await settle();
                    const edge = await measure();
                    edge.center.forEach((v, i) =>
                        assert.ok(Math.abs(v - (sign > 0 ? 0 : baseline.canvas[i + 2])) <= 1),
                    );
                }
                await page.evaluate("document.querySelector('#baseline').click()");
                await settle();
                const restored = await measure();
                assert.deepEqual(restored.center, baseline.center);
                assert.deepEqual(restored.canvas, baseline.canvas);
                const layouts = [];
                for (const [width, height] of [
                    [640, 640],
                    [390, 640],
                    [1280, 720],
                ]) {
                    await page.send("Emulation.setDeviceMetricsOverride", {
                        width,
                        height,
                        deviceScaleFactor: 1,
                        mobile: false,
                    });
                    await zoomTo(8);
                    const layout = await measure();
                    assert.deepEqual(layout.document, [width, height, width, height]);
                    assert.ok(layout.controlsVisible);
                    assert.ok(
                        layout.viewport[3] >= 96 &&
                            layout.viewport[1] + layout.viewport[3] <= height,
                    );
                    layout.center.forEach((v, i) =>
                        assert.ok(Math.abs(v - baseline.center[i]) <= 1),
                    );
                    layouts.push(layout);
                }
                await session.screenshot(join(run.evidence, "inspection-8x.png"));
                await page.send("Emulation.clearDeviceMetricsOverride");
                await page.evaluate("document.querySelector('#baseline').click()");
                await settle();
                run.record("inspection-viewport", "observations", {
                    observations,
                    layouts,
                    pointerCaptureReleaseOutside: true,
                    wheelZooms,
                    dragAndKeyboardPan: true,
                    edgesReachable: true,
                    baselineRestored: true,
                });
            });
            await run.stage("playback", async () => {
                await page.evaluate(
                    "{ const select = document.querySelector('#animations'); select.selectedIndex = 1; select.dispatchEvent(new Event('change')); }",
                );
                await until(
                    page,
                    "document.querySelector('#entry').textContent.includes('entry 1/') && document.querySelector('#entry').textContent.includes('paused')",
                );
                const selected = await page.evaluate(
                    "document.querySelector('#entry').textContent",
                );
                await page.evaluate("document.querySelector('#play').click()");
                await until(
                    page,
                    "document.querySelector('#entry').textContent.includes('playing') && !document.querySelector('#entry').textContent.includes('entry 1/')",
                );
                assert.equal(
                    await page.evaluate("document.querySelector('#playback-state').textContent"),
                    "Playing",
                );
                const moving = await page.evaluate("document.querySelector('#entry').textContent");
                await session.screenshot(join(run.evidence, "playing.png"));
                await page.evaluate("document.querySelector('#play').click()");
                await until(
                    page,
                    "document.querySelector('#entry').textContent.includes('paused')",
                );
                const paused = await page.evaluate<string>(
                    "document.querySelector('#entry').textContent",
                );
                await delay(160);
                assert.equal(
                    await page.evaluate("document.querySelector('#entry').textContent"),
                    paused,
                );
                await page.evaluate("document.querySelector('#play').click()");
                const browser = await session.browserConnection();
                const { targetInfo } = (await page.send("Target.getTargetInfo")) as {
                    targetInfo: { targetId: string };
                };
                const { targetId } = (await browser.send("Target.createTarget", {
                    url: "about:blank",
                })) as { targetId: string };
                try {
                    await browser.send("Target.activateTarget", { targetId });
                    await until(page, "document.hidden");
                    await delay(250);
                    await browser.send("Target.activateTarget", { targetId: targetInfo.targetId });
                    await until(
                        page,
                        "!document.hidden && document.querySelector('#entry').textContent.includes('paused')",
                    );
                    const returned = await page.evaluate<string>(
                        "document.querySelector('#entry').textContent",
                    );
                    await delay(160);
                    assert.equal(
                        await page.evaluate("document.querySelector('#entry').textContent"),
                        returned,
                    );
                    run.record("playback", "observations", {
                        selected,
                        moving,
                        paused,
                        returned,
                        realTabVisibility: true,
                    });
                } finally {
                    await browser.send("Target.closeTarget", { targetId });
                }
                if (!suppliedFixture) {
                    await page.evaluate(
                        "{ const select = document.querySelector('#animations'); select.value = 'signal-once'; select.dispatchEvent(new Event('change')); document.querySelector('#play').click(); }",
                    );
                    await until(
                        page,
                        "document.querySelector('#entry').textContent.includes('400.0/400 ms') && document.querySelector('#entry').textContent.includes('paused')",
                    );
                }
            });
            await run.stage("teardown", async () => {
                await page.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide'))");
                assert.equal(
                    await page.evaluate("document.querySelector('#status').textContent"),
                    "Preview disposed",
                );
                const text = await page.evaluate("document.querySelector('#entry').textContent");
                await delay(150);
                assert.equal(
                    await page.evaluate("document.querySelector('#entry').textContent"),
                    text,
                );
                run.record("teardown", "observations", {
                    pagehide: "disposed; playback labels stopped",
                });
            });
            if (!suppliedFixture)
                await run.stage("visible-diagnostics", async () => {
                    // Invalid consumer inputs leave the installed tool and renderer untouched.
                    writeFileSync(join(installation, "broken.png"), "not an image");
                    consumerIdentity.files["broken.png"] = hash("not an image");
                    for (const [name, mutation, expected] of [
                        [
                            "image",
                            "config.images[0].src = new URL('./broken.png', import.meta.url);",
                            "image prism",
                        ],
                        ["bounds", "config.frames[0].x = 999;", "frame flag"],
                    ]) {
                        const config = `diagnostic-${name}.mjs`;
                        const contents = `import config from './preview.config.mjs'; ${mutation} export default config;`;
                        writeFileSync(join(installation, config), contents);
                        consumerIdentity.files[config] = hash(contents);
                        const diagnosticUrl = await launch(config, `diagnostic-${name}-host`);
                        await page.send("Page.navigate", { url: diagnosticUrl });
                        await until(
                            page,
                            "document.querySelector('#error')?.textContent.length > 0",
                        );
                        const message = await page.evaluate<string>(
                            "document.querySelector('#error').textContent",
                        );
                        assert.ok(message.includes(expected), message);
                        assert.equal(
                            await page.evaluate("document.querySelector('#controls').disabled"),
                            true,
                        );
                        run.record(`diagnostic-${name}`, "observations", {
                            message,
                            adapterSHA256: hash(readFileSync(join(installation, config))),
                        });
                        await session.screenshot(join(run.evidence, `diagnostic-${name}.png`));
                    }
                    await page.send("Page.navigate", { url });
                    await until(
                        page,
                        "document.querySelector('#status')?.textContent.startsWith('Ready')",
                    );
                    // Invalidate the public canvas; exercise the real renderer diagnostic callback.
                    await page.evaluate("document.querySelector('canvas').width = 0");
                    await until(page, "document.querySelector('#error')?.textContent.length > 0");
                    const message = await page.evaluate<string>(
                        "document.querySelector('#error').textContent",
                    );
                    assert.ok(message.includes("WebGPU"), message);
                    assert.equal(
                        await page.evaluate("document.querySelector('#controls').disabled"),
                        true,
                    );
                    run.record("diagnostic-renderer", "observations", {
                        message,
                        fault: "public canvas width changed to zero after readiness",
                    });
                    await session.screenshot(join(run.evidence, "diagnostic-renderer.png"));
                });
            await run.stage("signal-shutdown", async () => {
                const preload =
                    "data:text/javascript," +
                    encodeURIComponent(
                        "const timer = setInterval(() => { if (process.listenerCount('SIGINT')) { clearInterval(timer); process.emit('SIGINT'); } }, 25);",
                    );
                const output = await command(
                    run,
                    "signal-shutdown",
                    process.execPath,
                    [
                        "--permission",
                        `--allow-fs-read=${installation}`,
                        "--import",
                        preload,
                        "node_modules/ngne/dist/preview/cli.js",
                        "preview.config.mjs",
                    ],
                    installation,
                );
                const stoppedUrl = output.match(/NGNE preview: (http:\/\/127\.0\.0\.1:\d+\/)/)?.[1];
                assert.ok(stoppedUrl, output);
                await assert.rejects(fetch(stoppedUrl, { signal: AbortSignal.timeout(1000) }));
                run.record("signal-shutdown", "observations", {
                    stoppedUrl,
                    exit: 0,
                    serverReachable: false,
                    signal: "Node SIGINT event; physical keyboard delivery not established",
                });
            });
            await run.stage("integrity", async () => {
                verifyPrepared(manifestPath);
                verifyIdentities(join(installation, "node_modules/ngne"), pkg.files);
                verifyIdentities(fixture, fixtureIdentity);
                verifyPreviewConsumer(installation, consumerIdentity);
                run.record("integrity", "observations", {
                    preparedPackageUnchanged: true,
                    installedPackageUnchanged: true,
                    fixtureUnchanged: true,
                    consumerAndLauncherUnchanged: true,
                });
            });
        },
        async () => {
            await session.screenshot(join(run.evidence, "failure.png"));
        },
    );
    return run;
}
