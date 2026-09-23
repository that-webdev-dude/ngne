import {
    BrowserGame,
    imageAsset,
    audioAsset,
    type Asset,
    type PreparedScene,
    type SceneDefinition,
} from "ngne";
import { observe } from "./observe.js";

const state = {
    status: "idle",
    passed: [] as string[],
    failures: [] as string[],
    environment: {} as Record<string, unknown>,
    samples: {} as Record<string, unknown>,
};
function check(id: string, value: unknown): void {
    if (!value) throw Error(id);
    state.passed.push(id);
}
async function until(predicate: () => boolean, label: string) {
    const end = performance.now() + 15000;
    while (!predicate()) {
        if (performance.now() > end) throw Error(`Timeout: ${label}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((yes) => {
        resolve = yes;
    });
    return { promise, resolve };
}
async function rejects(action: Promise<unknown>, id: string) {
    let rejected = false;
    try {
        await action;
    } catch {
        rejected = true;
    }
    check(id, rejected);
}
function failure(error: unknown): string {
    return error instanceof AggregateError
        ? `${error.message}: ${error.errors.map(failure).join("; ")}`
        : String(error);
}
async function run() {
    state.status = "running";
    const platform = observe();
    const canvas = document.querySelector("canvas")!;
    const callbacks = new Map<number, FrameRequestCallback>();
    let next = 0,
        now = 1000,
        mounted = 0,
        unmounted = 0;
    const host = new BrowserGame({
        canvas,
        width: 64,
        height: 64,
        seed: 1,
        state: {},
        transition: (state) => state,
        assetRetention: { maxEntries: 0 },
        diagnostic: (error) => state.failures.push(failure(error)),
        scheduler: {
            request(callback) {
                callbacks.set(++next, callback);
                return next;
            },
            cancel(id) {
                callbacks.delete(id);
            },
        },
    });
    const step = () => {
        now += 20;
        const batch = [...callbacks.values()];
        callbacks.clear();
        for (const fn of batch) fn(now);
    };
    const pixel = () => {
        const copy = document.createElement("canvas");
        copy.width = 64;
        copy.height = 64;
        const context = copy.getContext("2d")!;
        context.drawImage(canvas, 0, 0);
        return [...context.getImageData(32, 32, 1, 1).data];
    };
    const image = imageAsset("tile", new URL("./tile.png", import.meta.url).href);
    const audio = audioAsset("tone", new URL("./tone.wav", import.meta.url).href);
    let replacement: PreparedScene | undefined;
    const scene = (id: string): SceneDefinition => ({
        id,
        assets: [image, audio],
        setup(s) {
            mounted++;
            const clip = s.assets.get("tone");
            if (!(clip instanceof AudioBuffer)) throw Error("Expected decoded AudioBuffer");
            check("decoded-audio-buffer", true);
            const scope = host.audio.scene("shared-authored-name");
            s.defer(() => {
                scope.dispose();
                unmounted++;
            });
            let started = false;
            s.system(({ scenes }) => {
                if (!started) {
                    scope.play({ buffer: clip, loop: true });
                    started = true;
                }
                if (replacement) {
                    const candidate = replacement;
                    replacement = undefined;
                    scenes.set(candidate);
                }
            });
            s.render((frame) =>
                frame.sprite({ x: 32, y: 32, width: 48, height: 48, texture: image.id }),
            );
        },
    });
    try {
        const first = await host.game.prepare(scene("first"), { key: "first" });
        check("cold-preparation-does-not-mount-or-schedule", mounted === 0 && callbacks.size === 0);
        check("cold-preparation-does-not-unlock-audio", platform.contexts.length === 0);
        check(
            "image-upload-ready-before-mount",
            host.renderer?.status === "ready" && host.renderer.inspect().sources === 1,
        );
        const overlapping = await host.game.prepare(scene("overlap"), { key: "overlap" });
        check(
            "overlapping-candidates-share-upload",
            host.renderer!.inspect().sources === 1 && host.renderer!.inspect().consumers === 2,
        );
        overlapping.release();
        overlapping.release();
        check("candidate-release-preserves-survivor", host.renderer!.inspect().consumers === 1);
        check(
            "leased-working-set-protected-from-retention",
            host.game.assets.inspect().protectedOverBudget,
        );
        const before = host.game.assets.inspect();
        const missing = imageAsset("missing", new URL("./missing.png", import.meta.url).href);
        await rejects(
            host.game.prepare({ id: "missing", assets: [missing], setup() {} }, { key: "missing" }),
            "failed-asset-preparation-rejects",
        );
        check(
            "failed-preparation-releases-claims",
            host.game.assets.inspect().claims.scene === before.claims.scene,
        );
        let attempts = 0;
        const retry: Asset<number> = {
            id: "retry",
            async load() {
                if (++attempts === 1) throw Error("Controlled load failure");
                return 1;
            },
        };
        const retryScene: SceneDefinition = { id: "retry", assets: [retry], setup() {} };
        await rejects(
            host.game.prepare(retryScene, { key: "retry-failed" }),
            "failed-load-rejects",
        );
        const retried = await host.game.prepare(retryScene, { key: "retry-success" });
        retried.release();
        check("failed-load-can-explicitly-retry", attempts === 2);
        const gate = deferred<number>(),
            entered = deferred<void>();
        let disposed = 0;
        const slow: Asset<number> = {
            id: "slow",
            load() {
                entered.resolve();
                return gate.promise;
            },
            dispose() {
                disposed++;
            },
        };
        const controller = new AbortController();
        const pending = host.game.prepare(
            {
                id: "cancel",
                assets: [slow],
                setup() {
                    throw Error("Cancelled scene mounted");
                },
            },
            { key: "cancel", signal: controller.signal },
        );
        const cancellation = rejects(pending, "cancelled-preparation-rejects");
        await entered.promise;
        controller.abort();
        gate.resolve(1);
        await cancellation;
        await until(() => disposed === 1, "late cancelled disposal");
        check("late-cancelled-load-disposed-once", disposed === 1);
        const decode = deferred<ImageBitmap>(),
            decoding = deferred<void>();
        let closed = 0;
        const heldImage: Asset<ImageBitmap> = {
            id: "held-image",
            kind: "image",
            load() {
                decoding.resolve();
                return decode.promise;
            },
            dispose(bitmap) {
                closed++;
                bitmap.close();
            },
        };
        const heldAbort = new AbortController();
        const held = host.game.prepare(
            {
                id: "held",
                assets: [heldImage],
                setup() {
                    throw Error("Held scene mounted");
                },
            },
            { key: "held", signal: heldAbort.signal },
        );
        const heldResult = rejects(held, "cancelled-image-preparation-rejects");
        await decoding.promise;
        check(
            "delayed-image-cannot-publish-or-mount",
            mounted === 0 && host.renderer!.inspect().sources === 1,
        );
        heldAbort.abort();
        decode.resolve(await createImageBitmap(new ImageData(1, 1)));
        await heldResult;
        await until(() => closed === 1, "late bitmap release");
        check(
            "cancelled-image-never-registers",
            host.renderer!.inspect().sources === 1 && closed === 1,
        );
        await host.audio.unlock();
        await host.start(first);
        step();
        step();
        check(
            "ordinary-browser-frame-submits-sprite",
            platform.submissions > 0 && host.stats.sprites === 1,
        );
        const firstPixel = pixel();
        state.samples.firstPixel = firstPixel;
        check(
            "external-image-texels-present",
            firstPixel[1] > firstPixel[0] && firstPixel[3] === 255,
        );
        await until(() => platform.rms() > 0.001, "first audio output");
        state.samples.firstRms = platform.rms();
        check("decoded-clip-produces-output", platform.voices.length === 1);
        replacement = await host.game.prepare(scene("second"), { key: "second" });
        step();
        step();
        check(
            "replacement-unmounts-old-owner",
            mounted === 2 && unmounted === 1 && platform.voices[0].stops === 1,
        );
        const replacementStartedAt = platform.contexts[0].currentTime;
        await until(
            () =>
                platform.contexts[0].currentTime - replacementStartedAt > 0.1 &&
                platform.rms() > 0.001,
            "fresh replacement audio output beyond analyser window",
        );
        check(
            "replacement-plays-new-scope",
            platform.voices.length === 2 && platform.voices[1].stops === 0,
        );
        state.samples.replacementRms = platform.rms();
        const snapshot = JSON.stringify(host.game.enumerate());
        const old = platform.devices.at(-1)!;
        old.destroy();
        await until(
            () => platform.devices.at(-1) !== old && host.renderer?.status === "ready",
            "ordinary device recovery",
        );
        check("recovery-preserves-simulation", JSON.stringify(host.game.enumerate()) === snapshot);
        check("recovery-restores-live-source", host.renderer!.inspect().sources === 1);
        const count = platform.submissions;
        step();
        check("recovered-frame-submits", platform.submissions > count);
        const recoveredPixel = pixel();
        state.samples.recoveredPixel = recoveredPixel;
        check(
            "recovered-image-texels-present",
            recoveredPixel[1] > recoveredPixel[0] && recoveredPixel[3] === 255,
        );
        await host.stop();
        check(
            "stop-disables-frames-and-audio",
            callbacks.size === 0 &&
                platform.contexts.every((context) => context.state === "suspended"),
        );
        const stoppedDevice = platform.devices.at(-1)!;
        const recoveryGate = platform.holdNextDevice();
        stoppedDevice.destroy();
        await recoveryGate.waiting;
        const recoveryAbort = new AbortController();
        const duringRecovery = host.game.prepare(scene("during-recovery"), {
            key: "during-recovery",
            signal: recoveryAbort.signal,
        });
        const recoveryCancellation = rejects(
            duringRecovery,
            "recovery-preparation-cancellation-rejects",
        );
        recoveryAbort.abort();
        recoveryGate.release();
        await recoveryCancellation;
        await until(
            () => platform.devices.at(-1) !== stoppedDevice && host.renderer?.status === "ready",
            "stopped recovery",
        );
        check("stopped-recovery-does-not-schedule", callbacks.size === 0);
        check(
            "recovery-cancellation-preserves-mounted-owner",
            host.renderer!.inspect().consumers === 1 && mounted === 2,
        );
        await host.start();
        step();
        check("resume-retains-mounted-scene", mounted === 2 && callbacks.size === 1);
        state.environment = {
            userAgent: navigator.userAgent,
            visibility: document.visibilityState,
            pixelRatio: devicePixelRatio,
            viewport: [innerWidth, innerHeight],
            devices: platform.devices.map((device) => ({
                vendor: device.adapterInfo.vendor,
                architecture: device.adapterInfo.architecture,
                device: device.adapterInfo.device,
                description: device.adapterInfo.description,
                isFallbackAdapter: device.adapterInfo.isFallbackAdapter,
            })),
            submissions: platform.submissions,
            manualVisual: "not evaluated",
            manualAudible: "not evaluated",
        };
        await host.dispose();
        await host.dispose();
        check(
            "disposal-releases-all-owners",
            host.game.assets.inspect().loaded === 0 &&
                host.renderer!.inspect().sources === 0 &&
                callbacks.size === 0 &&
                unmounted === 2,
        );
        check(
            "disposal-closes-audio",
            platform.contexts.every((context) => context.state === "closed") &&
                platform.voices.every((voice) => voice.stops === 1),
        );
        await rejects(host.start(), "disposed-host-cannot-restart");
        check("no-unexpected-diagnostics", state.failures.length === 0);
        const disposing = new BrowserGame({
            canvas: document.createElement("canvas"),
            state: {},
            transition: (state) => state,
            seed: 3,
        });
        const heldRecovery = platform.holdNextDevice();
        // Hold cold acquisition, then dispose before the browser returns its device.
        const preparing = disposing.game.prepare(
            { id: "dispose-pending", assets: [image], setup() {} },
            { key: "dispose-pending" },
        );
        const disposedPreparation = rejects(
            preparing,
            "disposal-cancels-pending-image-preparation",
        );
        await heldRecovery.waiting;
        const deviceCount = platform.devices.length;
        await disposing.dispose();
        heldRecovery.release();
        await disposedPreparation;
        await until(() => platform.devices.length > deviceCount, "late device delivery");
        let lateDestroyed = false;
        void platform.devices.at(-1)!.lost.then(() => {
            lateDestroyed = true;
        });
        await until(() => lateDestroyed, "late device destruction");
        check(
            "disposal-destroys-late-device-and-releases-assets",
            lateDestroyed && disposing.game.assets.inspect().loaded === 0,
        );
        const terminalDiagnostics: string[] = [];
        const terminal = new BrowserGame({
            canvas: document.createElement("canvas"),
            state: {},
            transition: (state) => state,
            seed: 2,
            diagnostic: (error) => terminalDiagnostics.push(failure(error)),
        });
        try {
            const candidate = await terminal.game.prepare(
                { id: "terminal", assets: [image], setup() {} },
                { key: "terminal" },
            );
            platform.failReplacement();
            platform.devices.at(-1)!.destroy();
            await until(() => terminal.renderer?.status === "failed", "failed recovery");
            candidate.release();
            check(
                "failed-recovery-is-terminal-and-reported",
                terminalDiagnostics.length === 1 &&
                    terminalDiagnostics[0].includes("recovery failed"),
            );
        } finally {
            await terminal.dispose();
        }
        check(
            "failed-renderer-disposal-releases-sources",
            terminal.game.assets.inspect().loaded === 0,
        );
        const resources = performance
            .getEntriesByType("resource")
            .map((entry) => entry.name)
            .filter((name) => /\.(png|wav)$/.test(name));
        state.samples.externalResources = resources;
        check(
            "external-assets-use-selected-base",
            resources.some((name) => name.endsWith(".wav")) &&
                resources.some((name) => name.includes("tile-")) &&
                resources.every((name) => new URL(name).pathname.startsWith(location.pathname)),
        );
        state.status = "passed";
    } catch (error) {
        state.failures.push(failure(error));
        state.status = "failed";
    } finally {
        try {
            await host.dispose();
        } catch (error) {
            state.failures.push(failure(error));
            state.status = "failed";
        }
        platform.restore();
    }
    return state;
}
Object.assign(window, { installedEngine: { state, run } });
