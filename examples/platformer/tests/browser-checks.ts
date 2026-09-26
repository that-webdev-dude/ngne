import { withFixture, waitFor } from "../../../tooling/suites/verification/browser/page-fixture.js";
type Check = (condition: unknown, message: string) => void;
const PLATFORMER_UNSUPPORTED = "WebGPU adapter unavailable. Enable browser hardware acceleration";
const CLICK_TIMEOUT_MS = 120_000;
/**
 * Start unlocks audio before starting the host, so the platformer fixture needs trusted input
 * inside the iframe: the page shows a prompt and waits for the operator to click Start level 1.
 */
export async function checkPlatformerUnsupported(check: Check): Promise<void> {
    await withFixture(
        "/examples/platformer/index.html",
        "Platformer unsupported WebGPU fixture",
        "Click Start level 1 in the platformer fixture below to continue.",
        async (doc) => {
            await waitFor(
                () => doc()?.documentElement.dataset.ngneFixtureReady === "true",
                10_000,
                "Platformer fixture did not become ready",
            );
            await waitFor(
                () => doc()?.getElementById("error")?.hidden === false,
                CLICK_TIMEOUT_MS,
                "Platformer fixture Start was not clicked or reported no error",
            );
            await new Promise((resolve) => setTimeout(resolve, 500));
            const error = doc()?.getElementById("error");
            // Elements belong to the iframe realm, so parent-realm instanceof checks cannot be used.
            const start = doc()?.getElementById("start") as HTMLButtonElement | null | undefined;
            check(
                error?.hidden === false && error.textContent?.includes(PLATFORMER_UNSUPPORTED),
                `platformer persistently reports the exact unsupported message: ${PLATFORMER_UNSUPPORTED}`,
            );
            check(
                start?.tagName === "BUTTON" &&
                    (start.hidden || start.disabled) &&
                    doc()?.getElementById("overlay-title")?.textContent === "Unable to continue",
                "platformer unsupported start leaves Start unavailable and shows the error presentation",
            );
        },
    );
}
