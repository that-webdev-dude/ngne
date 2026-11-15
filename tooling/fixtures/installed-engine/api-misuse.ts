import {
    BrowserGame,
    component,
    f32,
    WebGPURenderer,
    type PreparedScene,
    type RendererLifecycleEvent,
    type RgbaPixels,
    type TextureRegion,
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

const resized: void = renderer.resize(96, 80);
const dimensions: readonly number[] = [renderer.width, renderer.height];
void resized;
void dimensions;
// @ts-expect-error Renderer dimensions are readonly.
renderer.width = 96;
// @ts-expect-error Renderer dimensions are readonly.
renderer.height = 80;
// @ts-expect-error Resize requires numeric dimensions.
renderer.resize("96", 80);
// @ts-expect-error Resize requires both dimensions.
renderer.resize(96);

const region: TextureRegion = {
    sourceX: 1,
    sourceY: 0,
    width: 1,
    height: 2,
    destinationX: 2,
    destinationY: 1,
};
declare const bitmap: ImageBitmap;
const initialized: Promise<void> = renderer.createTexture("editable", 4, 4, abort.signal);
const canvasEdit: Promise<void> = renderer.updateTexture("editable", canvas, region);
const bitmapEdit: Promise<void> = renderer.updateTexture("editable", bitmap, region, abort.signal);
void initialized;
void canvasEdit;
void bitmapEdit;
// @ts-expect-error Editable texture IDs are strings.
renderer.createTexture(42, 4, 4);
// @ts-expect-error Editable texture dimensions are numbers.
renderer.createTexture("editable", "4", 4);
// @ts-expect-error Editable initialization requires an AbortSignal when supplied.
renderer.createTexture("editable", 4, 4, {});
const pixels: RgbaPixels = { width: 4, height: 4, data: new Uint8Array(64) };
const rawEdit: Promise<void> = renderer.updateTexture("editable", pixels, region);
const imageDataEdit: Promise<void> = renderer.updateTexture(
    "editable",
    new ImageData(4, 4),
    region,
);
void rawEdit;
void imageDataEdit;
// @ts-expect-error Raw sources store RGBA8 bytes, not floats.
renderer.updateTexture("editable", { width: 4, height: 4, data: new Float32Array(64) }, region);
// @ts-expect-error Raw sources require their dimensions.
renderer.updateTexture("editable", { data: new Uint8Array(64) }, region);
// @ts-expect-error Raw source fields are readonly.
pixels.width = 2;
// @ts-expect-error Updates require a bitmap, canvas or raw RGBA8 source.
renderer.updateTexture("editable", new Uint8Array(64), region);
// @ts-expect-error Regions require both origins as well as dimensions.
renderer.updateTexture("editable", canvas, { width: 1, height: 2 });
// @ts-expect-error Region coordinates are numbers.
renderer.updateTexture("editable", canvas, { ...region, destinationX: "2" });
// @ts-expect-error Updates require an AbortSignal when supplied.
renderer.updateTexture("editable", canvas, region, {});
// @ts-expect-error Region fields are readonly.
region.destinationX = 0;
