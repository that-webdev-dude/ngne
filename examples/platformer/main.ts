import { BrowserGame } from "ngne";

import { createProgress, HEIGHT, transition, WIDTH } from "./game.js";
import type { Progress, ProgressCommand, Run } from "./game.js";
import { LEVEL_ONE } from "./levels.js";
import { createTransitionRegistry, levelKey } from "./transitions.js";

const canvas = document.getElementById("game");
const start = document.getElementById("start");
if (!(canvas instanceof HTMLCanvasElement) || !(start instanceof HTMLButtonElement))
    throw new Error("Platformer canvas or start button is missing");
const gameCanvas = canvas;
const startButton = start;
const registry = createTransitionRegistry({
    levels: [LEVEL_ONE],
    onView: updateView,
    onError: showError,
});
const app = new BrowserGame<Progress, ProgressCommand>({
    canvas: gameCanvas,
    width: WIDTH,
    height: HEIGHT,
    clear: 0x20362d,
    seed: "NGNE-15",
    state: createProgress(),
    transition,
    afterFrame: () => registry.reconcile(app.game),
    diagnostic: (error) => {
        if (error instanceof Error) showError(error);
    },
});

startButton.addEventListener("click", () => {
    void launch();
});
window.addEventListener("keydown", (event) => {
    if (event.code === "Enter" && !startButton.disabled) {
        event.preventDefault();
        void launch();
    }
});
document.addEventListener("visibilitychange", () => {
    if (document.hidden) registry.request("pause");
});
window.addEventListener(
    "pagehide",
    () => {
        registry.dispose();
        void app.dispose().catch(showError);
    },
    { once: true },
);

async function launch(): Promise<void> {
    if (startButton.disabled) return;
    startButton.disabled = true;
    startButton.textContent = "Starting…";
    try {
        await app.start(
            await app.game.prepare(registry.createLevelDefinition(0), { key: levelKey(0, 0) }),
        );
        startButton.hidden = true;
        gameCanvas.focus();
    } catch (error) {
        showError(error);
    }
}

function updateView(view: Readonly<Run>): void {
    element("progress").textContent =
        `Level ${view.levelIndex + 1} · Attempt ${view.attempt + 1} · ${view.checkpoint ? `Checkpoint ${view.checkpoint}` : "Start"}`;
    element("status").textContent =
        view.phase === "dying"
            ? "Returning to checkpoint…"
            : view.phase === "exiting"
              ? "Level 1 complete"
              : "Reach the blue gate";
    if (view.phase === "exiting") {
        element("overlay").hidden = false;
        element("overlay-title").textContent = "Level 1 complete";
        element("overlay-copy").textContent =
            "You reached the end of this playable slice. Level 2 follows in the next round.";
        element("reload").hidden = false;
    }
}

function showError(error: unknown): void {
    element("error").hidden = false;
    element("error").textContent =
        `Unable to continue: ${error instanceof Error ? error.message : String(error)}. Reload to try again.`;
    element("reload").hidden = false;
}

function element(id: string): HTMLElement {
    const found = document.getElementById(id);
    if (!found) throw new Error(`Missing platformer element ${id}`);
    return found;
}
