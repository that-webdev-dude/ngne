import { BrowserGame, type FrameScheduler } from "../src/index.js";
import { checkBrowserAudio } from "./browser-audio-checks.js";
import { checkBrowserGames } from "./browser-game-checks.js";
import { checkBrowserLifecycle } from "./browser-lifecycle-checks.js";
import { checkBrowserInput } from "./browser-input-checks.js";
import { checkBrowserInterpolation } from "./browser-interpolation-checks.js";
import { checkBrowserImages } from "./browser-image-checks.js";
import { checkBrowserRecovery } from "./browser-recovery-checks.js";
import { checkBrowserGpuHost } from "./browser-gpu-host-checks.js";
import { startRendererBenchmark } from "./browser-renderer-benchmark.js";
import { checkWebGPUEnvironment, checkWebGPUCore } from "./browser-webgpu-checks.js";
const rendererBenchmark = new URLSearchParams(location.search).get("rendererBenchmark");
void (
    rendererBenchmark ? startRendererBenchmark(rendererBenchmark) : checkWebGPUEnvironment()
).catch((error: unknown) => {
    const output = document.getElementById("webgpu-environment");
    if (output) output.textContent = String(error);
});
const results: string[] = [];
const validation = (window.__ngneValidation = {
    status: "idle" as "idle" | "running" | "passed" | "failed",
    passed: results,
    skipped: [] as string[],
    failures: [] as string[],
});
const check = (condition: unknown, message: string) => {
    if (!condition) throw new Error(message);
    results.push("PASS " + message);
    document.getElementById("results")!.textContent = results.join("\n");
};
async function main() {
    validation.status = "running";
    if (new URLSearchParams(location.search).has("injectFailure"))
        check(false, "intentional CI assertion failure");
    await checkBrowserAudio(check);
    await checkWebGPUCore(check);
    const surface = document.createElement("canvas");
    let callback: FrameRequestCallback = () => {};
    let cancelled = 0;
    let failFrame = false;
    const scheduler: FrameScheduler = {
        request: (fn) => {
            callback = fn;
            return 1;
        },
        cancel: () => {
            cancelled++;
        },
    };
    const app = new BrowserGame({
        canvas: surface,
        seed: 1,
        state: {},
        transition: (s) => s,
        scheduler,
        afterFrame: () => {
            if (failFrame) throw new Error("Injected frame failure");
        },
    });
    let updates = 0;
    const candidate = await app.game.prepare(
        {
            id: "test",
            setup(s) {
                s.system(() => updates++);
            },
        },
        { key: "test" },
    );
    await app.start(candidate);
    callback(100);
    callback(117);
    check(updates === 1, "browser host drives fixed simulation");
    const mounted = app.game.scenes[0];
    await app.stop();
    callback(10000);
    check(updates === 1, "late callbacks after stop do no work");
    await app.start();
    callback(20000);
    callback(20017);
    check(
        updates === 2 && app.game.scenes[0].id === mounted.id,
        "resume preserves scene and resets wall-clock accumulator",
    );
    failFrame = true;
    callback(20034);
    check(
        app.game.lifecycle === "Failed",
        "browser frame faults enter Failed through the internal boundary",
    );
    await app.dispose();
    check(app.game.lifecycle === "Disposed" && cancelled >= 2, "browser teardown completes");
    await checkBrowserLifecycle((condition, message) => check(condition, "WebGPU " + message));
    await checkBrowserImages(check);
    await checkBrowserGames(check);
    await checkBrowserRecovery(check);
    await checkBrowserGpuHost(check);
    await checkBrowserInput((condition, message) => check(condition, "WebGPU " + message));
    await checkBrowserInterpolation(check);
    validation.status = "passed";
    document.getElementById("results")!.textContent = results.join("\n") + "\n\nALL CHECKS PASSED";
}
document.getElementById("start-validation")!.addEventListener(
    "click",
    () => {
        document.getElementById("results")!.textContent = "Running…";
        void main().catch((error) => {
            validation.status = "failed";
            validation.failures.push(error instanceof Error ? error.message : String(error));
            document.getElementById("results")!.textContent =
                results.join("\n") + "\nFAIL " + error.stack;
            console.error(error);
        });
    },
    { once: true },
);

declare global {
    interface Window {
        __ngneValidation: {
            status: "idle" | "running" | "passed" | "failed";
            passed: string[];
            skipped: string[];
            failures: string[];
        };
    }
}
