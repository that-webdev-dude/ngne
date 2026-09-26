import { checkBrowserGames } from "../../../../demo/tests/browser-checks.js";
import { checkPlatformerUnsupported } from "../../../../examples/platformer/tests/browser-checks.js";
import { checkHelloCapability } from "../../../../examples/hello/tests/browser-checks.js";
import { checkBrowserHost } from "../../../../tests/browser-validation.js";
import { checkBrowserAudio } from "../../../../tests/browser-audio-checks.js";

import { checkBrowserLifecycle } from "../../../../tests/browser-lifecycle-checks.js";
import { checkBrowserInput } from "../../../../tests/browser-input-checks.js";
import { checkBrowserInterpolation } from "../../../../tests/browser-interpolation-checks.js";
import { checkBrowserImages } from "../../../../tests/browser-image-checks.js";
import { checkBrowserRecovery } from "../../../../tests/browser-recovery-checks.js";
import { checkBrowserRetention } from "../../../../tests/browser-retention-checks.js";
import { checkBrowserGpuHost } from "../../../../tests/browser-gpu-host-checks.js";
import {
    checkWebGPUEnvironment,
    checkWebGPUCore,
} from "../../../../tests/browser-webgpu-checks.js";
void checkWebGPUEnvironment().catch((error: unknown) => {
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
    await checkBrowserHost(check);
    await checkBrowserLifecycle((condition, message) => check(condition, "WebGPU " + message));
    await checkBrowserImages(check);
    await checkHelloCapability(check, "unsupported");
    await checkHelloCapability(check, "recovery");
    await checkBrowserGames(check);
    await checkPlatformerUnsupported(check);
    await checkBrowserRecovery(check);
    await checkBrowserRetention(check);
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
