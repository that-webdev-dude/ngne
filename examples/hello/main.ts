import { BrowserGame, imageAsset } from "ngne";

import { createHelloScene } from "./scene.js";

const errorOutput = document.createElement("pre");
errorOutput.setAttribute("role", "alert");
document.body.append(errorOutput);
// Errors accumulate so a later report cannot hide a terminal failure. Game diagnostics
// also carry non-error notices, such as dropped-tick overload records; skip them.
function showError(error: unknown): void {
    if (!(error instanceof Error)) return;
    const message = describeError(error);
    if (errorOutput.textContent.includes(message)) return;
    errorOutput.textContent += (errorOutput.textContent ? "\n" : "") + message;
}
function describeError(error: unknown): string {
    if (error instanceof AggregateError)
        return [error.message, ...error.errors.map(describeError)].join("\n");
    if (error instanceof Error)
        return error.message + (error.cause ? "\n" + describeError(error.cause) : "");
    return String(error);
}
const canvas = document.querySelector("canvas");
if (!canvas) throw new Error("Hello canvas missing");

const app = new BrowserGame({
    canvas,
    diagnostic: showError,
    width: 640,
    height: 240,
    seed: "hello",
    state: {},
    transition: (state) => state,
});
const image = imageAsset("hello-spark", new URL("./spark.png", import.meta.url).href);
try {
    await app.start(await app.game.prepare(createHelloScene(image), { key: "first-room" }));
} catch (error) {
    showError(error);
}
window.addEventListener(
    "pagehide",
    () => {
        void app.dispose().catch(showError);
    },
    { once: true },
);
