import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Driver {
    send(method: string, params?: object): Promise<unknown>;
    evaluate<T>(expression: string, userGesture?: boolean): Promise<T>;
}

/** Optional installed-consumer production checks. All injection stays in this engine harness. */
export async function checkInstalledContent(
    cdp: Driver,
    origin: string,
    directory: string,
    passed: string[],
    recordRecoveryDevices: () => Promise<void>,
): Promise<void> {
    const hook = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `(() => {
            const state = window.__contentHarness = { devices: [], callbacks: new Map(), next: 0, now: 1000, imageWaiting: false };
            const request = GPUAdapter.prototype.requestDevice;
            GPUAdapter.prototype.requestDevice = async function (...args) {
                const device = await request.apply(this, args); state.devices.push(device); return device;
            };
            window.requestAnimationFrame = fn => { const id = ++state.next; state.callbacks.set(id, fn); return id; };
            window.cancelAnimationFrame = id => state.callbacks.delete(id);
            state.step = count => { for (let i = 0; i < count; i++) { const callbacks = [...state.callbacks.values()]; state.callbacks.clear(); state.now += 1000 / 60; for (const cb of callbacks) cb(state.now); } };
            const decode = window.createImageBitmap;
            window.createImageBitmap = async (...args) => {
                const bitmap = await decode(...args); state.imageWaiting = true;
                await new Promise(resolve => state.releaseImage = resolve); return bitmap;
            };
            state.snapshot = () => JSON.parse(document.querySelector('#actors').textContent);
            state.pixels = () => { state.step(1); const actor = state.snapshot().actors[0], canvas = document.querySelector('canvas'), read = document.createElement('canvas'); read.width = canvas.width; read.height = canvas.height; const ctx = read.getContext('2d'); ctx.drawImage(canvas, 0, 0); return Array.from(ctx.getImageData(actor.x, actor.y - 3, 1, 1).data); };
        })();`,
    });
    const townPath = join(directory, "content/town.json");
    const destinationPath = join(directory, "content/dungeon.json");
    const originalTown = readFileSync(townPath, "utf8");
    const originalDestination = readFileSync(destinationPath, "utf8");
    const check = (condition: unknown, message: string) => {
        assert(condition, message);
        passed.push(`Installed content: ${message}`);
    };
    async function wait(expression: string): Promise<void> {
        const deadline = Date.now() + 20_000;
        while (!(await cdp.evaluate<boolean>(expression))) {
            if (Date.now() > deadline) throw new Error(`Content timeout: ${expression}`);
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }
    async function start(): Promise<void> {
        await cdp.send("Page.navigate", { url: origin });
        await wait("window.__contentHarness?.imageWaiting === true");
        check(
            await cdp.evaluate<boolean>(
                "document.querySelector('#room').textContent === 'No active room' && document.querySelector('#loading').textContent.includes('Loading')",
            ),
            "delayed image decode prevents initial activation and shows loading",
        );
        await cdp.evaluate("window.__contentHarness.releaseImage()");
        await wait("window.__contentHarness.callbacks.size > 0");
        await cdp.evaluate("window.__contentHarness.step(2)");
    }
    try {
        await start();
        check(
            await cdp.evaluate<boolean>(
                "document.querySelector('#room').textContent === 'Town courtyard'",
            ),
            "initial production scene activates after image readiness",
        );
        const before = await cdp.evaluate<number[]>("window.__contentHarness.pixels()");
        check(
            before[3] === 255 && before[1] > before[0],
            "exported atlas presents opaque green player texels",
        );
        const actors = await cdp.evaluate<{
            actors: { playback: { frame: number; elapsed: number } }[];
        }>("window.__contentHarness.snapshot()");
        check(
            JSON.stringify(actors.actors[0].playback) !== JSON.stringify(actors.actors[1].playback),
            "shared animation has independent actor playback",
        );
        await cdp.evaluate(
            "document.querySelector('canvas').focus(); document.querySelector('canvas').dispatchEvent(new KeyboardEvent('keydown', {code:'KeyD', bubbles:true})); window.__contentHarness.step(12); window.dispatchEvent(new KeyboardEvent('keyup', {code:'KeyD', bubbles:true})); window.__contentHarness.step(1)",
        );
        check(
            await cdp.evaluate<boolean>("window.__contentHarness.snapshot().actors[0].x > 80"),
            "focused movement advances simulation-owned position",
        );
        await cdp.evaluate(
            "document.querySelector('canvas').dispatchEvent(new KeyboardEvent('keydown', {code:'KeyD', bubbles:true})); window.__contentHarness.step(100); window.dispatchEvent(new KeyboardEvent('keyup', {code:'KeyD', bubbles:true})); window.__contentHarness.step(1)",
        );
        check(
            await cdp.evaluate<boolean>("window.__contentHarness.snapshot().actors[0].x <= 228"),
            "consumer wall collision stops the player",
        );
        const snapshot = await cdp.evaluate<string>(
            "document.querySelector('#actors').textContent",
        );
        await cdp.evaluate("window.__contentHarness.devices[0].destroy()");
        await wait("window.__contentHarness.devices.length === 2");
        await cdp.evaluate("window.__contentHarness.devices[1].queue.onSubmittedWorkDone()");
        // Let replacement publication finish without simulation frames.
        await wait(
            "window.__ngneRenderingDevices.at(-1).canvasConfigurations > 0 && window.__contentHarness.devices.length === 2",
        );
        check(
            (await cdp.evaluate<string>("document.querySelector('#actors').textContent")) ===
                snapshot,
            "controlled loss does not mutate actor state without a tick",
        );
        await cdp.evaluate("window.__contentHarness.step(1)");
        check(
            await cdp.evaluate<boolean>(
                "window.__ngneRenderingDevices.length >= 2 && window.__ngneRenderingDevices.at(-1).submissions > 0",
            ),
            "installed production slice submits through replacement device",
        );
        assert.deepEqual(
            await cdp.evaluate<number[]>("window.__contentHarness.pixels()"),
            before,
            "exported player texels survive recovery",
        );
        passed.push("Installed content: exported player texels survive controlled recovery");
        check(
            await cdp.evaluate<boolean>(
                "document.querySelector('[role=alert]').textContent === ''",
            ),
            "controlled recovery produces no consumer error",
        );

        await recordRecoveryDevices();
        writeFileSync(destinationPath, "{invalid");
        await cdp.evaluate("document.querySelector('#travel').click()");
        await wait("document.querySelector('[role=alert]').textContent.includes('invalid JSON')");
        check(
            await cdp.evaluate<boolean>(
                "document.querySelector('#room').textContent === 'Town courtyard' && !document.querySelector('#retry').disabled",
            ),
            "failed destination preserves room and exposes deliberate retry",
        );
        const oldX = await cdp.evaluate<number>("window.__contentHarness.snapshot().actors[0].x");
        await cdp.evaluate(
            "document.querySelector('canvas').dispatchEvent(new KeyboardEvent('keydown', {code:'KeyA', bubbles:true})); window.__contentHarness.step(4); window.dispatchEvent(new KeyboardEvent('keyup', {code:'KeyA', bubbles:true})); window.__contentHarness.step(1)",
        );
        check(
            (await cdp.evaluate<number>("window.__contentHarness.snapshot().actors[0].x")) < oldX,
            "surviving room remains playable during failure",
        );
        writeFileSync(destinationPath, originalDestination);
        await cdp.evaluate("document.querySelector('#retry').click()");
        await wait("document.querySelector('#loading').textContent.includes('Activating')");
        await cdp.evaluate("window.__contentHarness.step(2)");
        check(
            await cdp.evaluate<boolean>(
                "document.querySelector('#room').textContent === 'Dungeon threshold'",
            ),
            "corrected destination retry activates at simulation commit",
        );
        await cdp.evaluate("window.__contentHarness.step(60)");
        check(
            await cdp.evaluate<boolean>(
                "window.__contentHarness.snapshot().actors[1].playback.completed === true",
            ),
            "non-loop companion completes in production simulation",
        );
        await cdp.evaluate("document.querySelector('#travel').click()");
        await wait("document.querySelector('#loading').textContent.includes('Activating')");
        await cdp.evaluate("window.__contentHarness.step(2)");
        check(
            await cdp.evaluate<boolean>(
                "document.querySelector('#room').textContent === 'Town courtyard'",
            ),
            "return transition keeps shared images usable",
        );

        writeFileSync(townPath, "{invalid");
        await cdp.send("Page.navigate", { url: origin });
        await wait("document.querySelector('[role=alert]')?.textContent.includes('invalid JSON')");
        check(
            await cdp.evaluate<boolean>(
                "document.querySelector('#room').textContent === 'No active room' && !document.querySelector('#retry').disabled",
            ),
            "initial invalid JSON publishes no partial scene and allows retry",
        );
        writeFileSync(townPath, originalTown);
        await cdp.evaluate("document.querySelector('#retry').click()");
        await wait("window.__contentHarness.imageWaiting === true");
        await cdp.evaluate(
            "document.querySelector('#cancel').click(); window.__contentHarness.releaseImage()",
        );
        check(
            await cdp.evaluate<boolean>(
                "document.querySelector('#room').textContent === 'No active room'",
            ),
            "initial cancellation does not activate stale preparation",
        );
        await cdp.evaluate(
            "window.__contentHarness.imageWaiting = false; document.querySelector('#retry').click()",
        );
        await wait(
            "window.__contentHarness.imageWaiting === true || window.__contentHarness.callbacks.size > 0",
        );
        await cdp.evaluate("window.__contentHarness.releaseImage?.()");
        await wait("window.__contentHarness.callbacks.size > 0");
        await cdp.evaluate("window.__contentHarness.step(2)");
        check(
            await cdp.evaluate<boolean>(
                "document.querySelector('#room').textContent === 'Town courtyard' && document.querySelector('[role=alert]').textContent === ''",
            ),
            "corrected initial content retries successfully after cancellation",
        );
    } finally {
        writeFileSync(townPath, originalTown);
        writeFileSync(destinationPath, originalDestination);
        if (hook && typeof hook === "object" && "identifier" in hook)
            await cdp.send("Page.removeScriptToEvaluateOnNewDocument", {
                identifier: hook.identifier,
            });
    }
}
