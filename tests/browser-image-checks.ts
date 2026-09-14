import { BrowserGame, WebGPURenderer, type ImageAsset } from "../src/index.js";
import { uploadImage } from "../src/texture-assets.js";

export async function checkBrowserImages(
    check: (condition: unknown, message: string) => void,
): Promise<void> {
    const source = document.createElement("canvas");
    source.width = source.height = 2;
    const paint = source.getContext("2d");
    if (!paint) throw new Error("Missing canvas 2D");
    paint.fillStyle = "#d08040";
    paint.fillRect(0, 0, 2, 2);
    let loads = 0,
        closes = 0;
    const image: ImageAsset = {
        id: "leased-browser-image",
        kind: "image",
        async load() {
            loads++;
            return createImageBitmap(source, {
                premultiplyAlpha: "none",
                colorSpaceConversion: "none",
            });
        },
        dispose(bitmap) {
            closes++;
            bitmap.close();
        },
    };
    let callback: FrameRequestCallback = () => {};
    const diagnostics: unknown[] = [];
    const canvas = document.createElement("canvas");
    const app = new BrowserGame({
        canvas,
        width: 64,
        height: 64,
        seed: 21,
        state: {},
        transition: (s) => s,
        diagnostic: (error) => diagnostics.push(error),
        scheduler: {
            request(fn) {
                callback = fn;
                return 1;
            },
            cancel() {},
        },
    });
    const definition = {
        id: "image-scene",
        assets: [image],
        setup(scene: Parameters<Parameters<typeof app.game.prepare>[0]["setup"]>[0]) {
            check(
                scene.assets.get(image.id) instanceof ImageBitmap,
                "scene setup receives decoded ImageBitmap without GPU identity",
            );
            scene.render((frame) =>
                frame.sprite({ x: 32, y: 32, width: 32, height: 32, texture: image.id }),
            );
        },
    };
    const [first, other] = await Promise.all([
        app.game.prepare(definition, { key: "first" }),
        app.game.prepare(definition, { key: "other" }),
    ]);
    check(
        loads === 1 &&
            app.game.lifecycle === "Stopped" &&
            app.game.scenes.length === 0 &&
            app.renderer instanceof WebGPURenderer &&
            app.renderer.status === "ready",
        "cold image preparation shares decode/readiness without mounting or starting",
    );
    const retained = app.renderer;
    const attach = app.input.attach.bind(app.input);
    app.input.attach = () => {
        throw new Error("Injected input attach failure");
    };
    await expectFailure(app.start(first));
    check(
        app.renderer === retained && app.game.lifecycle === "Stopped",
        "WebGPU complete input rollback retains renderer and unconsumed candidates",
    );
    app.input.attach = attach;
    await app.start(first);
    callback(100);
    other.release();
    check(
        app.renderer?.drawCalls === 1 && diagnostics.length === 0,
        "retrying the same candidate presents its shared image",
    );
    const before = JSON.stringify(app.game.enumerate());
    await app.stop();
    await app.start();
    callback(200);
    check(
        JSON.stringify(app.game.enumerate()) === before &&
            app.renderer === retained &&
            app.renderer?.drawCalls === 1,
        "WebGPU stop/resume preserves scene and image consumer ownership",
    );
    canvas.width = 3;
    canvas.height = 7;
    canvas.style.width = "400px";
    callback(217);
    check(
        canvas.width === 64 && canvas.height === 64 && app.renderer?.drawCalls === 1,
        "host restores fixed backing dimensions after external/CSS resize",
    );
    const teardown: string[] = [];
    if (!app.renderer) throw new Error("Renderer missing");
    const disposeRenderer = app.renderer.dispose.bind(app.renderer),
        disposeAssets = app.game.assets.dispose.bind(app.game.assets);
    app.renderer.dispose = () => {
        teardown.push("renderer");
        disposeRenderer();
    };
    app.game.assets.dispose = () => {
        teardown.push("assets");
        disposeAssets();
    };
    await app.dispose();
    check(
        teardown.join() === "renderer,assets" && closes === 1,
        "renderer becomes terminal before decoded Assets close",
    );

    const retryApp = new BrowserGame({
        canvas: document.createElement("canvas"),
        width: 64,
        height: 64,
        seed: 1,
        state: {},
        transition: (s) => s,
        scheduler: {
            request() {
                return 1;
            },
            cancel() {},
        },
    });
    const spare = await retryApp.game.prepare(definition, { key: "spare" });
    const broken = await retryApp.game.prepare(
        {
            id: "broken",
            assets: [image],
            setup() {
                throw new Error("Injected setup failure");
            },
        },
        { key: "broken" },
    );
    const retryRenderer = retryApp.renderer;
    await expectFailure(retryApp.start(broken));
    const fresh = await retryApp.game.prepare(definition, { key: "fresh" });
    await retryApp.start(fresh);
    spare.release();
    check(
        retryApp.renderer === retryRenderer && retryApp.game.lifecycle === "Running",
        "Game.start rollback permits fresh image preparation while other candidates survive",
    );
    await retryApp.dispose();

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("Missing WebGPU adapter");
    const device = await adapter.requestDevice();
    const bitmap = await createImageBitmap(source, {
        premultiplyAlpha: "none",
        colorSpaceConversion: "none",
    });
    const originalCopy = device.queue.copyExternalImageToTexture.bind(device.queue);
    device.queue.copyExternalImageToTexture = () => {
        throw new Error("Injected synchronous GPU copy failure");
    };
    await expectFailure(uploadImage(device, bitmap));
    device.queue.copyExternalImageToTexture = originalCopy;
    const valid = await uploadImage(device, bitmap);
    valid.destroy();
    bitmap.close();
    device.destroy();
    check(true, "real-device upload scopes recover after a synchronously throwing copy");
    await checkHelloCapability(check, "unsupported");
    await checkHelloCapability(check, "recovery");
}
async function expectFailure(work: Promise<unknown>): Promise<void> {
    let failed = false;
    try {
        await work;
    } catch {
        failed = true;
    }
    if (!failed) throw new Error("Expected failure injection rejection");
}
async function checkHelloCapability(
    check: (condition: unknown, message: string) => void,
    mode: "unsupported" | "recovery",
): Promise<void> {
    const iframe = document.createElement("iframe");
    iframe.title = "Hello unsupported WebGPU capability fixture";
    const complete = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            window.removeEventListener("message", listener);
            reject(new Error("Hello capability fixture timeout"));
        }, 10000);
        const listener = (event: MessageEvent) => {
            if (
                event.source === iframe.contentWindow &&
                event.data === "ngne21-capability-complete"
            ) {
                clearTimeout(timeout);
                window.removeEventListener("message", listener);
                resolve();
            }
        };
        window.addEventListener("message", listener);
    });
    const setup =
        mode === "unsupported"
            ? 'Object.defineProperty(navigator,"gpu",{value:undefined});'
            : `
        const real=navigator.gpu;let requests=0,device;
        Object.defineProperty(navigator,"gpu",{value:{getPreferredCanvasFormat:()=>real.getPreferredCanvasFormat(),
            requestAdapter:async()=>{if(requests++)return null;const adapter=await real.requestAdapter();
                return {requestDevice:async()=>{device=await adapter.requestDevice();return device;}};}}});`;
    const finish =
        mode === "unsupported"
            ? 'parent.postMessage("ngne21-capability-complete",parent.location.origin);'
            : `
        const observer=new MutationObserver(()=>{if(document.querySelector('[role="alert"]')?.textContent.includes("WebGPU recovery failed")){
            observer.disconnect();parent.postMessage("ngne21-capability-complete",parent.location.origin);}});
        observer.observe(document.body,{childList:true,subtree:true,characterData:true});device.destroy();`;
    iframe.srcdoc = `<canvas></canvas><script type="module">${setup}await import("/examples/hello/main.ts");${finish}</script>`;
    document.body.append(iframe);
    try {
        await complete;
        // The game keeps running after terminal renderer failure; later reports must not hide it.
        await new Promise((resolve) => setTimeout(resolve, 500));
        const message = iframe.contentDocument?.querySelector('[role="alert"]')?.textContent;
        const expected =
            mode === "unsupported"
                ? "NGNE requires WebGPU. Use a supported browser with hardware acceleration enabled"
                : "WebGPU recovery failed. Reload to create a new renderer";
        check(
            message?.includes(expected),
            `hello persistently reports the exact ${mode} message: ${expected}`,
        );
    } finally {
        iframe.remove();
    }
}
