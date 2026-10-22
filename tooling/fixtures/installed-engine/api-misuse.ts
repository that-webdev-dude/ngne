import {
    BrowserGame,
    component,
    f32,
    WebGPURenderer,
    type PreparedScene,
    type RendererLifecycleEvent,
} from "@ngne/core";
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

declare const canvas: HTMLCanvasElement;
const abort = new AbortController();
const creation: Promise<WebGPURenderer> = WebGPURenderer.create(
    canvas,
    64,
    64,
    undefined,
    abort.signal,
);
const readiness: Promise<void> = renderer.ready(abort.signal);
const unsubscribe: () => void = renderer.onLifecycle((event: RendererLifecycleEvent) => {
    if (event.status === "failed") {
        const error: Error = event.error;
        void error;
    }
    // @ts-expect-error Events are readonly.
    event.status = "ready";
});
void creation;
void readiness;
void unsubscribe;
// @ts-expect-error No GPU device access through the public lifecycle.
renderer.device;
// @ts-expect-error A readiness wait requires an AbortSignal.
renderer.ready({});
