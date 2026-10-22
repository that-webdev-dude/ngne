import { BrowserGame, component, f32, type PreparedScene, type WebGPURenderer } from "@ngne/core";
declare const host: BrowserGame<unknown, never>;
declare const prepared: PreparedScene;
// @ts-expect-error Prepared handles expose no mutable engine world.
prepared.world;
// @ts-expect-error Preparation requires an authored identity.
host.game.prepare({ id: "invalid", setup() {} }, {});
// @ts-expect-error Field descriptors, not numbers, define component storage.
component("invalid", { x: 1 });
component("position", { x: f32() });
declare const renderer: WebGPURenderer;
const released: void = renderer.releaseTexture("manual");
void released;
// @ts-expect-error Manual texture release requires a string ID.
renderer.releaseTexture(42);
