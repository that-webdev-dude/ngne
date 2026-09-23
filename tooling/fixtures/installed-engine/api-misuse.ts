import { BrowserGame, component, f32, type PreparedScene } from "ngne";
declare const host: BrowserGame<unknown, never>;
declare const prepared: PreparedScene;
// @ts-expect-error Prepared handles expose no mutable engine world.
prepared.world;
// @ts-expect-error Preparation requires an authored identity.
host.game.prepare({ id: "invalid", setup() {} }, {});
// @ts-expect-error Field descriptors, not numbers, define component storage.
component("invalid", { x: 1 });
component("position", { x: f32() });
