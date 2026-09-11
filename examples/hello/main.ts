import { BrowserGame } from "ngne";

import { helloScene } from "./scene.js";

const app = new BrowserGame({
    canvas: document.querySelector("canvas")!,
    width: 640,
    height: 240,
    seed: "hello",
    state: {},
    transition: (state) => state,
});
await app.start(await app.game.prepare(helloScene, { key: "first-room" }));
