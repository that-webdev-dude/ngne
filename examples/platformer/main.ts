import { BrowserGame } from "ngne";

import { createOverlay, createProgress, HEIGHT, transition, WIDTH } from "./game.js";
import type { Progress, ProgressCommand, Run } from "./game.js";
import { LEVEL_ONE, LEVEL_TWO } from "./levels.js";
import { createTransitionRegistry, levelKey } from "./transitions.js";

const canvas = document.getElementById("game");
const start = document.getElementById("start");
const pause = document.getElementById("pause");
if (
    !(canvas instanceof HTMLCanvasElement) ||
    !(start instanceof HTMLButtonElement) ||
    !(pause instanceof HTMLButtonElement)
)
    throw new Error("Platformer canvas or controls are missing");
const gameCanvas = canvas;
const startButton = start;
const pauseButton = pause;
// Presentation only. Scene resources and committed state own every gameplay decision.
let presentation: Run["phase"] | "ready" | "paused" | "complete" | "error" = "ready";
let errorMessage: string | undefined;
const app = new BrowserGame<Progress, ProgressCommand>({
    canvas: gameCanvas,
    width: WIDTH,
    height: HEIGHT,
    clear: 0x20362d,
    seed: "NGNE-15",
    state: createProgress(),
    transition,
    afterFrame: () => {
        registry.reconcile(app.game);
        updateHud();
    },
    diagnostic: (error) => {
        if (error instanceof Error) showError(error);
    },
});
app.audio.muted = true;
const registry = createTransitionRegistry({
    levels: [LEVEL_ONE, LEVEL_TWO],
    audio: app.audio,
    overlay: createOverlay,
    onView: (view) => {
        presentation = view.phase;
    },
    onOverlayView: (phase) => {
        presentation = phase;
    },
    onError: showError,
});

startButton.addEventListener("click", () => {
    if (presentation === "complete") {
        registry.request("restart");
        gameCanvas.focus();
    } else void launch();
});
pauseButton.addEventListener("click", () => {
    registry.request(presentation === "paused" ? "resume" : "pause");
    gameCanvas.focus();
});
window.addEventListener("keydown", (event) => {
    if (event.code !== "Enter") return;
    if (presentation === "ready" && !startButton.disabled) {
        event.preventDefault();
        void launch();
    } else if (presentation === "complete") {
        event.preventDefault();
        registry.request("restart");
    }
});
document.addEventListener("visibilitychange", () => {
    if (document.hidden && app.game.lifecycle === "Running") registry.request("pause");
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
    if (startButton.disabled || app.game.lifecycle !== "Stopped") return;
    startButton.disabled = true;
    startButton.textContent = "Starting…";
    try {
        await app.audio.unlock();
        app.audio.muted = false;
        await app.start(
            await app.game.prepare(registry.createLevelDefinition(0), { key: levelKey(0, 0) }),
        );
        gameCanvas.focus();
    } catch (error) {
        showError(error);
    }
}

function updateHud(): void {
    if (errorMessage) presentation = "error";
    const state = app.game.state;
    element("progress").textContent =
        `Level ${Math.min(2, state.level + 1)} · Attempt ${state.attempt + 1} · ${state.checkpoint ? `Checkpoint ${state.checkpoint}` : "Start"} · Deaths ${state.deaths} · Runs ${state.runs}`;
    pauseButton.disabled = presentation !== "playing" && presentation !== "paused";
    pauseButton.textContent = presentation === "paused" ? "Resume" : "Pause";
    startButton.hidden = presentation !== "complete" && presentation !== "ready";
    if (presentation === "complete") {
        startButton.disabled = false;
        startButton.textContent = "Play again";
    }
    const messages: Partial<Record<typeof presentation, readonly [string, string]>> = {
        paused: ["Paused", "Press P or Escape, or choose Resume."],
        exiting: ["Level complete", "Preparing the next level…"],
        complete: [
            "Game complete",
            `Both gates reached. ${state.deaths} deaths · ${state.runs} restarted runs. Press Enter or Play again.`,
        ],
        error: ["Unable to continue", errorMessage ?? "Reload to try again."],
    };
    const message = messages[presentation];
    element("overlay").hidden = !message;
    element("overlay-title").textContent = message?.[0] ?? "";
    element("overlay-copy").textContent = message?.[1] ?? "";
    element("status").textContent =
        message?.[0] ??
        (presentation === "dying" ? "Returning to checkpoint…" : "Reach the blue gate");
}

function showError(error: unknown): void {
    errorMessage = `${error instanceof Error ? error.message : String(error)}. Reload to try again.`;
    element("error").hidden = false;
    element("error").textContent = errorMessage;
    element("reload").hidden = false;
    presentation = "error";
    if (app.game.lifecycle !== "Disposed") updateHud();
}

function element(id: string): HTMLElement {
    const found = document.getElementById(id);
    if (!found) throw new Error(`Missing platformer element ${id}`);
    return found;
}
