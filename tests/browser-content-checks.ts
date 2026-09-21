import { cleanupSteps } from "./tooling/cleanup.mjs";
import { isNavigationError } from "./tooling/devtools.mjs";
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
    const townPath = join(directory, "content/town.json");
    const destinationPath = join(directory, "content/dungeon.json");
    const originalTown = readFileSync(townPath, "utf8");
    const originalDestination = readFileSync(destinationPath, "utf8");
    const errors: unknown[] = [];
    let hook: unknown;
    try {
        hook = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
            source: `(() => {
            const state = window.__contentHarness = { devices: [], callbacks: new Map(), next: 0, now: 1000, imageWaiting: false, holdImage: true, voices: [], contexts: [] };
            const connect = AudioNode.prototype.connect;
            AudioNode.prototype.connect = function (destination, ...args) {
                const result = connect.call(this, destination, ...args);
                if (destination instanceof AudioDestinationNode) {
                    const analyser = this.context.createAnalyser(); analyser.fftSize = 2048;
                    connect.call(this, analyser); state.output = analyser;
                }
                return result;
            };
            state.outputRms = () => { const values = new Float32Array(state.output.fftSize); state.output.getFloatTimeDomainData(values); return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length); };
            const createVoice = AudioContext.prototype.createBufferSource;
            AudioContext.prototype.createBufferSource = function () {
                if (!state.contexts.includes(this)) state.contexts.push(this);
                const source = createVoice.call(this), voice = { source, stops: 0 };
                const stop = source.stop.bind(source);
                source.stop = (...args) => { voice.stops++; return stop(...args); };
                state.voices.push(voice); return source;
            };
            state.jsonRead = 0;
            const json = Response.prototype.json;
            Response.prototype.json = async function () { const value = await json.call(this); state.jsonRead++; return value; };
            const request = GPUAdapter.prototype.requestDevice;
            GPUAdapter.prototype.requestDevice = async function (...args) {
                if (state.holdDevice) { state.deviceWaiting = true; await new Promise(resolve => state.releaseDevice = resolve); state.holdDevice = false; state.deviceWaiting = false; }
                if (state.failDevice) throw Error('Controlled replacement acquisition failure');
                const device = await request.apply(this, args); state.devices.push(device); return device;
            };
            window.requestAnimationFrame = fn => { const id = ++state.next; state.callbacks.set(id, fn); return id; };
            window.cancelAnimationFrame = id => state.callbacks.delete(id);
            state.step = count => { for (let i = 0; i < count; i++) { const callbacks = [...state.callbacks.values()]; state.callbacks.clear(); state.now += 1000 / 60; for (const cb of callbacks) cb(state.now); } };
            const decode = window.createImageBitmap;
            window.createImageBitmap = async (...args) => {
                const bitmap = await decode(...args);
                if (state.holdImage) { state.holdImage = false; state.imageWaiting = true;
                    await new Promise(resolve => state.releaseImage = () => { state.imageWaiting = false; resolve(); }); }
                return bitmap;
            };
            state.inspect = () => { document.querySelector('#inspect').click(); return JSON.parse(document.querySelector('#diagnostics').textContent); };
            state.snapshot = () => JSON.parse(document.querySelector('#actors').textContent);
            state.pixels = () => { state.step(1); const actor = state.snapshot().actors[0], canvas = document.querySelector('canvas'), read = document.createElement('canvas'); read.width = canvas.width; read.height = canvas.height; const ctx = read.getContext('2d'); ctx.drawImage(canvas, 0, 0); return Array.from(ctx.getImageData(actor.x, actor.y - 3, 1, 1).data); };
            state.environmentPixel = () => { state.step(1); const canvas = document.querySelector('canvas'), read = document.createElement('canvas'); read.width = canvas.width; read.height = canvas.height; const ctx = read.getContext('2d'); ctx.drawImage(canvas, 0, 0); return Array.from(ctx.getImageData(2, 2, 1, 1).data); };
        })();`,
        });
        const check = (condition: unknown, message: string) => {
            assert(condition, message);
            passed.push(`Installed content: ${message}`);
        };
        async function wait(expression: string): Promise<void> {
            const deadline = Date.now() + 20_000;
            while (true) {
                try {
                    if (await cdp.evaluate<boolean>(expression)) return;
                } catch (error) {
                    if (!isNavigationError(error)) throw error;
                }
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
        await start();
        check(
            await cdp.evaluate<boolean>(
                "document.querySelector('#room').textContent === 'Town courtyard'",
            ),
            "initial production scene activates after image readiness",
        );
        const before = await cdp.evaluate<number[]>("window.__contentHarness.pixels()");
        const townEnvironment = await cdp.evaluate<number[]>(
            "window.__contentHarness.environmentPixel()",
        );
        check(
            before[3] === 255 && before[1] > before[0],
            "exported atlas presents opaque green player texels",
        );
        const actors = await cdp.evaluate<{
            actors: { playback: { frame: number; elapsed: number } }[];
        }>("window.__contentHarness.snapshot()");
        check(
            actors.actors.length === 4,
            "production rooms contain a player and three independently animated companions",
        );
        check(
            JSON.stringify(actors.actors[0].playback) !== JSON.stringify(actors.actors[1].playback),
            "shared animation has independent actor playback",
        );
        check(
            await cdp.evaluate<boolean>(
                "(() => { const d = window.__contentHarness.inspect(); return d.assets.claims.scene === 4 && d.assets.claims.renderer === 2 && d.renderer.sources === 2 && d.renderer.consumers === 2 && d.assets.protectedOverBudget; })()",
            ),
            "active room protects four scene claims and two renderer claims above the three-entry budget",
        );
        await cdp.evaluate("document.querySelector('#audio').click()", true);
        await wait(
            "document.querySelector('#playback').textContent.includes('Playback requested')",
        );
        await cdp.evaluate("window.__contentHarness.step(2)");
        check(
            await cdp.evaluate<boolean>(
                "window.__contentHarness.voices.length === 1 && window.__contentHarness.voices[0].source.loop",
            ),
            "audio unlock starts one looping room track",
        );
        await wait("window.__contentHarness.outputRms() > 0.001");
        passed.push(
            "Installed content: Town music produces a nonzero signal at the destination input",
        );
        await cdp.evaluate("document.querySelector('#audio').click()", true);
        await cdp.evaluate("window.__contentHarness.step(2)");
        check(
            await cdp.evaluate<boolean>("window.__contentHarness.voices.length === 1"),
            "repeated unlock does not duplicate room music",
        );
        await cdp.evaluate("document.querySelector('#pause').click()", true);
        await wait("document.querySelector('#pause').textContent === 'Resume game'");
        const paused = await cdp.evaluate<string>("document.querySelector('#actors').textContent");
        await cdp.evaluate("window.__contentHarness.step(120)");
        check(
            (await cdp.evaluate<string>("document.querySelector('#actors').textContent")) ===
                paused &&
                (await cdp.evaluate<boolean>(
                    "window.__contentHarness.contexts[0].state === 'suspended'",
                )),
            "explicit pause preserves scene state and suspends audio",
        );
        await cdp.evaluate("document.querySelector('#pause').click()", true);
        await wait("document.querySelector('#pause').textContent === 'Pause game'");
        await cdp.evaluate("window.__contentHarness.step(3)");
        check(
            (await cdp.evaluate<string>("document.querySelector('#actors').textContent")) !==
                paused &&
                (await cdp.evaluate<boolean>(
                    "window.__contentHarness.contexts[0].state === 'running' && window.__contentHarness.voices.length === 1",
                )),
            "resume advances retained state and resumes the existing music voice",
        );
        await cdp.evaluate(
            "document.querySelector('canvas').focus(); document.querySelector('canvas').dispatchEvent(new KeyboardEvent('keydown', {code:'KeyD', bubbles:true})); window.__contentHarness.step(12); window.dispatchEvent(new KeyboardEvent('keyup', {code:'KeyD', bubbles:true})); window.__contentHarness.step(1)",
        );
        check(
            await cdp.evaluate<boolean>("window.__contentHarness.snapshot().actors[0].x > 80"),
            "focused movement advances simulation-owned position",
        );
        await cdp.evaluate(
            "document.querySelector('canvas').dispatchEvent(new KeyboardEvent('keydown', {code:'KeyD', bubbles:true})); window.__contentHarness.step(2); document.querySelector('#travel').focus(); window.__contentHarness.blurX = window.__contentHarness.snapshot().actors[0].x; window.__contentHarness.effectBeforeBlur = window.__contentHarness.snapshot().effect.tick; window.__contentHarness.step(4)",
        );
        check(
            await cdp.evaluate<boolean>(
                "window.__contentHarness.snapshot().actors[0].x === window.__contentHarness.blurX && window.__contentHarness.snapshot().effect.tick !== window.__contentHarness.effectBeforeBlur && window.__contentHarness.inspect().lifecycle === 'Running'",
            ),
            "normal focus loss clears held movement while simulation and effect keep running",
        );
        await cdp.evaluate("document.querySelector('canvas').focus()");
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
        // Hold replacement acquisition so transition preparation overlaps real device loss.
        for (const cancel of [true, false]) {
            const count = await cdp.evaluate<number>("window.__contentHarness.devices.length");
            const documents = await cdp.evaluate<number>("window.__contentHarness.jsonRead");
            await cdp.evaluate(
                "window.__contentHarness.holdDevice = true; window.__contentHarness.devices.at(-1).destroy()",
            );
            await wait("window.__contentHarness.deviceWaiting === true");
            await cdp.evaluate("document.querySelector('#travel').click()");
            await wait("document.querySelector('#loading').textContent.includes('Loading')");
            await wait(`window.__contentHarness.jsonRead >= ${documents + 4}`);
            check(
                await cdp.evaluate<boolean>(
                    "document.querySelector('#room').textContent === 'Town courtyard'",
                ),
                "recovery preparation preserves the mounted room",
            );
            if (cancel) await cdp.evaluate("document.querySelector('#cancel').click()");
            await cdp.evaluate("window.__contentHarness.releaseDevice()");
            await wait(
                `window.__contentHarness.devices.length === ${count + 1} && window.__ngneRenderingDevices.at(-1).canvasConfigurations > 0`,
            );
            if (cancel) {
                await cdp.evaluate("window.__contentHarness.step(2)");
                check(
                    await cdp.evaluate<boolean>(
                        "document.querySelector('#room').textContent === 'Town courtyard' && document.querySelector('[role=alert]').textContent === ''",
                    ),
                    "cancelled transition during recovery preserves the surviving consumer",
                );
                await wait("window.__contentHarness.inspect().assets.claims.scene === 4");
                check(
                    await cdp.evaluate<boolean>(
                        "(() => { const d = window.__contentHarness.inspect(); return d.renderer.sources === 2 && d.renderer.consumers === 2; })()",
                    ),
                    "abandoned preparation releases only its own image consumers",
                );
            } else {
                await wait("document.querySelector('#loading').textContent.includes('Activating')");
                check(
                    await cdp.evaluate<boolean>(
                        "(() => { const d = window.__contentHarness.inspect(); return d.assets.claims.scene === 8 && d.renderer.sources === 3 && d.renderer.consumers === 4; })()",
                    ),
                    "ready destination and surviving room own eight scene claims, three unique images and four image consumers",
                );
                await cdp.evaluate("window.__contentHarness.step(2)");
                check(
                    await cdp.evaluate<boolean>(
                        "document.querySelector('#room').textContent === 'Dungeon threshold'",
                    ),
                    "transition prepared during recovery mounts after replacement readiness",
                );
                check(
                    JSON.stringify(
                        await cdp.evaluate<number[]>("window.__contentHarness.environmentPixel()"),
                    ) !== JSON.stringify(townEnvironment),
                    "destination presents distinct external environment atlas pixels",
                );
                check(
                    await cdp.evaluate<boolean>(
                        "(() => { const s = window.__contentHarness, d = s.inspect(); return d.assets.claims.scene === 4 && d.renderer.sources === 2 && d.renderer.consumers === 2 && s.voices[0].stops === 1 && s.voices.at(-1).source.loop && s.voices.at(-1).source.buffer !== s.voices[0].source.buffer; })()",
                    ),
                    "committed destination reclaims old ownership and replaces music exactly once",
                );
                await wait("window.__contentHarness.outputRms() > 0.001");
                passed.push(
                    "Installed content: Dungeon music produces a nonzero signal at the destination input",
                );
                await cdp.evaluate("document.querySelector('#travel').click()");
                await wait("document.querySelector('#loading').textContent.includes('Activating')");
                await cdp.evaluate("window.__contentHarness.step(2)");
            }
        }
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

        await cdp.evaluate("document.querySelector('#travel').click()");
        await wait("document.querySelector('#loading').textContent.includes('Activating')");
        await cdp.evaluate("document.querySelector('#pause').click()", true);
        await wait("document.querySelector('#pause').textContent === 'Resume game'");
        check(
            await cdp.evaluate<boolean>(
                "window.__contentHarness.inspect().assets.claims.scene === 4",
            ),
            "pause abandons a ready destination and keeps only mounted ownership",
        );
        await cdp.evaluate("document.querySelector('#pause').click()", true);
        await wait("document.querySelector('#pause').textContent === 'Pause game'");
        await cdp.evaluate("window.__contentHarness.step(3)");
        check(
            await cdp.evaluate<boolean>(
                "document.querySelector('#room').textContent === 'Town courtyard' && document.querySelector('[role=alert]').textContent === ''",
            ),
            "resume cannot consume the destination revoked by stop",
        );
        await cdp.evaluate("document.querySelector('#retry').click()");
        await wait("document.querySelector('#loading').textContent.includes('Activating')");
        await cdp.evaluate("window.__contentHarness.step(2)");
        check(
            await cdp.evaluate<boolean>(
                "document.querySelector('#room').textContent === 'Dungeon threshold'",
            ),
            "deliberate retry after pause prepares a fresh destination",
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
        await recordRecoveryDevices();
        // Exercise the ordinary first transition without a prior pause/resume or recovery gesture.
        await cdp.evaluate("document.querySelector('#audio').click()", true);
        await wait(
            "document.querySelector('#playback').textContent.includes('Playback requested')",
        );
        await cdp.evaluate("window.__contentHarness.step(2)");
        await wait("window.__contentHarness.outputRms() > 0.001");
        await cdp.evaluate("document.querySelector('#travel').click()");
        await wait("document.querySelector('#loading').textContent.includes('Activating')");
        await cdp.evaluate(
            "window.__contentHarness.step(2); window.__contentHarness.audioAt = window.__contentHarness.contexts[0].currentTime",
        );
        await wait(
            "window.__contentHarness.contexts[0].currentTime > window.__contentHarness.audioAt + 0.15 && window.__contentHarness.outputRms() > 0.001",
        );
        check(
            await cdp.evaluate<boolean>(
                "document.querySelector('#room').textContent === 'Dungeon threshold' && window.__contentHarness.voices.length === 2 && window.__contentHarness.voices[0].stops === 1",
            ),
            "ordinary Town-to-Dungeon transition produces fresh output without another unlock gesture",
        );
        await cdp.evaluate(
            "window.__contentHarness.failDevice = true; window.__contentHarness.devices.at(-1).destroy()",
        );
        await wait("document.querySelector('[role=alert]').textContent.length > 0");
        const terminalDevices = await cdp.evaluate<number>(
            "window.__contentHarness.devices.length",
        );
        await cdp.evaluate("window.__contentHarness.step(60)");
        check(
            await cdp.evaluate<boolean>(
                `window.__contentHarness.devices.length === ${terminalDevices}`,
            ),
            "terminal recovery failure reports an error without frame-driven device retries",
        );
        await start();
        await cdp.evaluate(
            "window.__contentHarness.holdDevice = true; window.__contentHarness.devices.at(-1).destroy()",
        );
        await wait("window.__contentHarness.deviceWaiting === true");
        await cdp.evaluate(
            "window.dispatchEvent(new PageTransitionEvent('pagehide')); window.__contentHarness.releaseDevice()",
        );
        await wait("window.__contentHarness.devices.length === 2");
        await cdp.evaluate("window.__contentHarness.devices.at(-1).lost");
        check(
            await cdp.evaluate<boolean>(
                "window.__contentHarness.callbacks.size === 0 && window.__contentHarness.inspect().assets.claims.scene === 0",
            ),
            "disposal during recovery destroys late replacement and releases all scene ownership",
        );
    } catch (error) {
        errors.push(error);
    } finally {
        const cleanup = await cleanupSteps([
            [`restore ${townPath}`, () => writeFileSync(townPath, originalTown)],
            [
                `restore ${destinationPath}`,
                () => writeFileSync(destinationPath, originalDestination),
            ],
            [
                "remove installed-content DevTools script",
                async () => {
                    if (hook && typeof hook === "object" && "identifier" in hook)
                        await cdp.send("Page.removeScriptToEvaluateOnNewDocument", {
                            identifier: hook.identifier,
                        });
                },
            ],
        ]);
        errors.push(
            ...cleanup
                .filter((step) => step.status === "failed")
                .map((step) => new Error(`${step.resource}: ${step.error}`)),
        );
    }
    if (errors.length) throw new AggregateError(errors, "Installed content checks/cleanup failed");
}
