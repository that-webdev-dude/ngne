import {
    BrowserGame,
    imageAsset,
    audioAsset,
    type Asset,
    type PreparedScene,
    type SceneDefinition,
} from "ngne";
import { observe } from "./observe.js";
import { assertMounted, assertDisposed } from "./accounting.js";

async function until(predicate: () => boolean, label: string): Promise<void> {
    const deadline = performance.now() + 15000;
    while (!predicate()) {
        if (performance.now() > deadline) throw Error(`Timeout: ${label}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((yes) => {
        resolve = yes;
    });
    return { promise, resolve };
}
async function run(count: number) {
    if (!Number.isSafeInteger(count) || count < 12 || count > 120)
        throw Error("Invalid sample count");
    const observer = observe(),
        errors: string[] = [],
        samples = [],
        cancellations = [];
    let mounted = -1,
        rendered = -1,
        pending: PreparedScene | undefined;
    const host = new BrowserGame({
        canvas: document.querySelector("canvas")!,
        width: 64,
        height: 64,
        seed: 1,
        state: {},
        transition: (state) => state,
        assetRetention: { maxEntries: 3, maxBytes: 1048576 },
        diagnostic: (error) => errors.push(String(error)),
    });
    const shared = imageAsset("shared", new URL("images/0.png", location.href).href);
    const images = Array.from({ length: 12 }, (_, i) =>
        imageAsset(`image-${i}`, new URL(`images/${i + 1}.png`, location.href).href),
    );
    const sound = audioAsset("tone", new URL("./tone.wav", import.meta.url).href);
    const opaque: Asset<number> = {
        id: "opaque",
        async load() {
            return 1;
        },
    };
    const scene = (i: number): SceneDefinition => ({
        id: `scene-${i}`,
        assets: [shared, images[i], sound, opaque],
        setup(s) {
            mounted = i;
            const clip = s.assets.get("tone");
            if (!(clip instanceof AudioBuffer)) throw Error("Expected audio buffer");
            const audio = host.audio.scene("workload");
            s.defer(() => audio.dispose());
            let started = false;
            s.system(({ scenes }) => {
                if (!started) {
                    audio.play({ buffer: clip, loop: true });
                    started = true;
                }
                if (pending) {
                    const next = pending;
                    pending = undefined;
                    scenes.set(next);
                }
            });
            s.render((frame) => {
                if (started) rendered = i;
                frame.sprite({ x: 16, y: 32, width: 24, height: 48, texture: shared.id });
                frame.sprite({ x: 48, y: 32, width: 24, height: 48, texture: images[i].id });
            });
        },
    });
    const sample = () => {
        if (!host.renderer) throw Error("Missing renderer");
        return {
            assets: host.game.assets.inspect(),
            renderer: host.renderer.inspect(),
            ...observer.state,
            gpu: [...observer.state.gpu],
            visibility: document.visibilityState,
            errors: [...errors],
        };
    };
    const travel = async (i: number) => {
        const start = performance.now(),
            submissions = observer.state.submissions;
        pending = await host.game.prepare(scene(i), { key: `transition-${i}` });
        await until(
            () =>
                mounted === i &&
                rendered === i &&
                pending === undefined &&
                observer.state.voices === 1 &&
                observer.state.submissions > submissions + 1,
            "transition publication, audio and rendering",
        );
        const ms = performance.now() - start;
        const observed = sample();
        assertMounted(observed);
        const heap =
            "memory" in performance &&
            performance.memory &&
            typeof performance.memory === "object" &&
            "usedJSHeapSize" in performance.memory
                ? performance.memory.usedJSHeapSize
                : null;
        return { index: i, ms, heap, observed };
    };
    let disposed: ReturnType<typeof sample> | undefined;
    const failures: string[] = [];
    try {
        await host.audio.unlock();
        await host.start(await host.game.prepare(scene(0), { key: "initial" }));
        await until(() => observer.state.voices === 1, "audio activation");
        if (!observer.state.gpu.length || observer.state.gpu.some((gpu) => gpu.isFallbackAdapter))
            throw Error("Non-fallback WebGPU adapter required for measurement");
        for (let i = 1; i <= 12; i++) await travel(i % 12);
        for (let i = 1; i <= count; i++) samples.push(await travel(i % 12));
        // Abort after actual external image decode; delivery arrives late and must be disposed.
        for (let trial = 0; trial < 3; trial++) {
            const before = sample(),
                entered = deferred<void>(),
                gate = deferred<void>();
            const image = imageAsset(
                `cancel-${trial}`,
                new URL(`images/${trial + 1}.png`, location.href).href,
            );
            const controlled = {
                ...image,
                async load(signal: AbortSignal) {
                    const value = await image.load(signal);
                    entered.resolve();
                    await gate.promise;
                    return value;
                },
            };
            const controller = new AbortController();
            const preparing = host.game.prepare(
                {
                    id: `cancel-${trial}`,
                    assets: [controlled],
                    setup() {
                        throw Error("Cancelled scene mounted");
                    },
                },
                { key: `cancel-${trial}`, signal: controller.signal },
            );
            const settled = preparing.then(
                (candidate) => {
                    candidate.release();
                    return false;
                },
                () => true,
            );
            try {
                await Promise.race([
                    entered.promise,
                    new Promise<never>((_, reject) => {
                        const timer = setTimeout(
                            () => reject(Error("Decode gate deadline")),
                            15000,
                        );
                        void entered.promise.then(() => clearTimeout(timer));
                    }),
                ]);
                controller.abort();
            } finally {
                gate.resolve();
            }
            if (!(await settled)) throw Error("Cancelled preparation resolved");
            await until(
                () => observer.state.bitmaps === 2 && host.game.assets.inspect().loading === 0,
                "late decoded image release",
            );
            const after = sample();
            assertMounted(after);
            if (mounted !== count % 12 || after.closed <= before.closed)
                throw Error("Cancellation did not preserve mount and close late image");
            cancellations.push({ trial, before, after });
        }
    } catch (error) {
        failures.push(String(error));
    } finally {
        try {
            pending?.release();
            await host.dispose();
            disposed = sample();
            assertDisposed(disposed);
        } catch (error) {
            failures.push(`disposal: ${error}`);
        }
        observer.restore();
    }
    return {
        status: failures.length ? "failed" : "passed",
        failures,
        samplingComplete: samples.length === count,
        warmup: 12,
        samples,
        cancellations,
        disposed,
        environment: {
            gpu: observer.state.gpu,
            userAgent: navigator.userAgent,
            viewport: [innerWidth, innerHeight],
            dpr: devicePixelRatio,
            visibility: document.visibilityState,
            visibilityEvents: observer.visibility,
        },
        method: "prepare-to-mounted-and-rendered-ordinary-frames-v1",
    };
}
Object.assign(window, { contentEngine: { run } });
