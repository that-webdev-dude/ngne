import "./style.css";
import { audioAsset, BrowserGame, type ImageAsset, type Stats } from "ngne";
import { arena, overlay, W, H, type Progress, type ProgressCommand, type RunView } from "./game.js";
import { makeAtlas, titleArt } from "./art.js";
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
el("game-title").innerHTML = titleArt("STARFALL '89");
const canvas = el<HTMLCanvasElement>("game"),
    play = el<HTMLButtonElement>("play"),
    pause = el<HTMLButtonElement>("pause"),
    chaos = el<HTMLButtonElement>("chaos");
// Preparation decodes the generated atlas; the WebGPU renderer uploads it before the scene mounts.
const atlas: ImageAsset = {
    id: "ships",
    kind: "image",
    load: () =>
        createImageBitmap(makeAtlas(), { premultiplyAlpha: "none", colorSpaceConversion: "none" }),
    dispose: (bitmap) => bitmap.close(),
};
const music = audioAsset(
    "starfall-music",
    "data:audio/wav;base64,UklGRmQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YUAAAACAhYuQlJeam5ybmpeUkIuFgHt1cGxpZmVkZWZpbHB1e4CFi5CUl5qbnJual5SQi4WAe3VwbGlmZWRlZmlscHV7",
);
let view: RunView = {
    phase: "attract",
    score: 0,
    wave: 1,
    seconds: 0,
    hp: 5,
    bomb: 0,
    combo: 1,
    stress: false,
};
let presentation: "paused" | "result" | undefined;
let ready = false,
    previousPhase = "",
    metricTime = 0;
const times: number[] = [];
const app = new BrowserGame<Progress, ProgressCommand>({
    canvas,
    width: W,
    height: H,
    seed: "STARFALL-1989",
    state: { best: 0, runs: 0, victories: 0, lastScore: 0 },
    transition: (state, command) => ({
        ...state,
        best: Math.max(state.best, command.score),
        lastScore: command.score,
        runs: state.runs + 1,
        victories: state.victories + (command.won ? 1 : 0),
    }),
    diagnostic: showError,
    afterFrame: (stats) => {
        reconcileCandidates();
        updateUI(stats);
    },
});
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const pauseDefinition = overlay("pause", (phase) => {
    presentation = phase;
});
const resultDefinition = overlay("result", (phase) => {
    presentation = phase;
});
function options(attract = false, stress = false) {
    return {
        attract,
        stress,
        audio: app.audio,
        atlas,
        music,
        reducedMotion,
        onView: (next: RunView) => {
            view = next;
            presentation = undefined;
        },
        pause: () => {
            if (attract) return;
            return takeCandidate("pause");
        },
        result: () => takeCandidate("result"),
    };
}
function takeCandidate(purpose: "pause" | "result") {
    const owner = app.game.scenes[0];
    return owner ? app.game.candidates.take(owner.id, purpose) : undefined;
}
function reconcileCandidates() {
    const owner = app.game.scenes[0];
    if (app.game.lifecycle !== "Running" || owner?.definition !== "starfall-arena") return;
    app.game.candidates.ensure(owner.id, "pause", pauseDefinition, { key: "pause", retries: 1 });
    app.game.candidates.ensure(owner.id, "result", resultDefinition, { key: "result", retries: 1 });
}
async function launch(stress = false) {
    if (!ready) return;
    ready = false;
    play.disabled = chaos.disabled = true;
    try {
        await app.audio.unlock();
        app.audio.muted = el("sound").getAttribute("aria-pressed") !== "true";
        const candidate = await app.game.prepare(arena(options(false, stress)), {
            key: `run-${app.game.state.runs}-${stress ? "chaos" : "normal"}`,
        });
        app.game.set(candidate);
        canvas.focus();
    } catch (error) {
        showError(error instanceof Error ? error : new Error(String(error)));
    } finally {
        ready = true;
        play.disabled = chaos.disabled = false;
    }
}
function updateUI(stats: Readonly<Stats>) {
    const phase = presentation === "paused" ? "paused" : view.phase;
    el("score").textContent = String(view.score).padStart(6, "0");
    el("best").textContent = String(app.game.state.best).padStart(6, "0");
    const remaining = Math.max(0, 180 - Math.floor(view.seconds));
    el("timer").textContent = `${Math.floor(remaining / 60)
        .toString()
        .padStart(2, "0")}:${(remaining % 60).toString().padStart(2, "0")}`;
    el("wave-label").textContent = `SECTOR ${String(view.wave).padStart(2, "0")}`;
    [...el("hull").children].forEach((node, i) => node.classList.toggle("empty", i >= view.hp));
    el("hull").setAttribute("aria-label", `${view.hp} of 5 hull points`);
    el("charge").style.width = `${(1 - view.bomb / 900) * 100}%`;
    el("nova-state").textContent = view.bomb ? `${Math.ceil(view.bomb / 60)} SEC` : "READY";
    el("combo").textContent =
        view.combo > 1 ? `${view.combo}× CHAIN / KEEP IT GOING` : "AUTO-FIRE / ONLINE";
    el("flight-state").textContent =
        phase === "attract"
            ? "ATTRACT MODE"
            : phase === "paused"
              ? "FLIGHT PAUSED"
              : view.stress
                ? "CHAOS LAB / INVULNERABLE"
                : phase === "playing"
                  ? "FLIGHT IN PROGRESS"
                  : "FLIGHT COMPLETE";
    pause.disabled = phase === "attract" || phase === "dead" || phase === "won";
    pause.innerHTML = phase === "paused" ? "Resume <kbd>P</kbd>" : "Pause <kbd>P</kbd>";
    el("wave-banner").textContent =
        phase === "playing" && view.seconds % 15 < 2 && view.wave > 1
            ? `SECTOR ${view.wave} / ${view.wave % 3 === 0 ? "DREADNOUGHT INBOUND" : "SWARM APPROACHING"}`
            : "";
    if (phase !== previousPhase) {
        app.audio.duck(phase === "paused" ? 0.25 : 1);
        el("overlay").hidden = phase === "playing";
        const copy: Record<string, [string, string, string, string]> = {
            attract: [
                "THE SKY IS YOURS.",
                "Survive three minutes of beautiful chaos.<br>Keep moving. Your weapons do the talking.",
                "START FLIGHT",
                "WASD TO MOVE · AUTO-FIRE IS ON",
            ],
            paused: [
                "TAKE A BREATH.",
                "Your flight is right where you left it.",
                "RESUME FLIGHT",
                "PRESS P OR ESC TO RESUME",
            ],
            dead: [
                "SIGNAL LOST.",
                `You held the line for ${Math.floor(view.seconds)} seconds.<br>${view.score.toLocaleString()} points. There is always another flight.`,
                "FLY AGAIN",
                "SAME PILOT. ANOTHER CHANCE.",
            ],
            won: [
                "SKY SECURED.",
                `Three minutes. One survivor.<br>${view.score.toLocaleString()} points. Welcome home, pilot.`,
                "FLY AGAIN",
                "MISSION COMPLETE",
            ],
        };
        const c = copy[phase];
        if (c) {
            el("overlay-title").textContent = c[0];
            el("overlay-copy").innerHTML = c[1];
            play.textContent = c[2];
            el("overlay-hint").textContent = c[3];
        }
        previousPhase = phase;
    }
    if (performance.now() - metricTime > 200) {
        metricTime = performance.now();
        el("fps").textContent = String(Math.round(stats.fps));
        el("sprites").textContent = stats.sprites.toLocaleString();
        el("frame-time").textContent = stats.frameMs.toFixed(2);
        el("draws").textContent = String(stats.drawCalls);
        el("engine-status").textContent = stats.droppedTicks
            ? `${stats.droppedTicks} TICKS DROPPED`
            : "RUNNING";
        times.push(stats.frameMs);
        if (times.length > 70) times.shift();
        el("graph-path").setAttribute(
            "d",
            times.map((v, i) => `${i ? "L" : "M"}${i * 2} ${29 - Math.min(28, v * 2)}`).join(" "),
        );
    }
}
play.addEventListener("click", () => {
    if (presentation === "paused") {
        app.game.pop();
        canvas.focus();
    } else void launch();
});
pause.addEventListener("click", () => {
    if (presentation === "paused") app.game.pop();
    else {
        const candidate = takeCandidate("pause");
        if (candidate) app.game.push(candidate);
    }
    canvas.focus();
});
chaos.addEventListener("click", () => void launch(true));
el("sound").addEventListener("click", async () => {
    try {
        await app.audio.unlock();
        app.audio.muted = !app.audio.muted;
        el("sound").setAttribute("aria-pressed", String(!app.audio.muted));
        el("sound").textContent = app.audio.muted ? "Sound off" : "Sound on";
    } catch (error) {
        showError(new Error("Audio unavailable", { cause: error }));
    }
});
document.querySelectorAll<HTMLButtonElement>("[data-key]").forEach((button) => {
    const key = button.dataset.key!;
    button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        app.input.set(key, true);
    });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
        button.addEventListener(event, () => app.input.set(key, false));
});
window.addEventListener("keydown", (event) => {
    if (event.code === "Enter" && view.phase === "attract") void launch();
    if (event.code === "KeyM") el("sound").click();
});
document.addEventListener("visibilitychange", () => {
    if (document.hidden && view.phase === "playing" && !presentation) {
        const candidate = takeCandidate("pause");
        if (candidate) app.game.push(candidate);
    }
});
// Errors accumulate so a later report cannot hide a terminal failure. Game diagnostics also carry
// non-error notices, such as dropped-tick overload records; skip them.
function showError(error: unknown): void {
    if (!(error instanceof Error)) return;
    const output = el("error");
    const message = describeError(error);
    if (!output.textContent.includes(message))
        output.textContent += (output.textContent ? "\n" : "") + message;
    output.hidden = false;
}
function describeError(error: unknown): string {
    if (error instanceof AggregateError)
        return [error.message, ...error.errors.map(describeError)].join("\n");
    if (error instanceof Error)
        return error.message + (error.cause ? "\n" + describeError(error.cause) : "");
    return String(error);
}
async function boot() {
    try {
        // Image preparation creates the WebGPU renderer, so an unsupported browser fails here.
        const initial = await app.game.prepare(arena(options(true)), {
            key: "attract",
        });
        await app.start(initial);
        app.audio.muted = true;
        ready = true;
        play.disabled = chaos.disabled = false;
        play.textContent = "START FLIGHT";
    } catch (error) {
        showError(
            new Error("Unable to start Starfall. It requires WebGPU with hardware acceleration", {
                cause: error,
            }),
        );
        play.textContent = "UNABLE TO START";
    }
}
window.addEventListener(
    "pagehide",
    () => {
        void app.dispose().catch(showError);
    },
    { once: true },
);
void boot();
