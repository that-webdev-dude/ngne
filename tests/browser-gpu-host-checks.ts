import { BrowserGame, WebGPURenderer, type ImageAsset } from "../src/index.js";

/** Real GPU with controlled acquisition gates; no physical driver failure is claimed. */
export async function checkBrowserGpuHost(
    check: (condition: unknown, message: string) => void,
): Promise<void> {
    const real = navigator.gpu;
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "gpu");
    let gate: Promise<void> = Promise.resolve();
    let entered = Promise.withResolvers<void>();
    const devices: GPUDevice[] = [];
    const gpu = new Proxy(real, {
        get(target, key) {
            if (key === "requestAdapter")
                return async (options?: GPURequestAdapterOptions) => {
                    const wait = gate;
                    entered.resolve();
                    await wait;
                    const adapter = await target.requestAdapter(options);
                    if (!adapter) return null;
                    return new Proxy(adapter, {
                        get(target, key) {
                            if (key === "requestDevice")
                                return async (options?: GPUDeviceDescriptor) => {
                                    const device = await target.requestDevice(options);
                                    devices.push(device);
                                    return device;
                                };
                            const value = Reflect.get(target, key, target);
                            return typeof value === "function" ? value.bind(target) : value;
                        },
                    });
                };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
    Object.defineProperty(navigator, "gpu", { configurable: true, value: gpu });
    let callback: FrameRequestCallback = () => {};
    let scheduled = 0,
        failFrame = false;
    const diagnostics: unknown[] = [];
    const app = new BrowserGame({
        canvas: document.createElement("canvas"),
        renderer: "webgpu",
        width: 64,
        height: 64,
        seed: 21,
        state: {},
        transition: (state) => state,
        diagnostic: (error) => diagnostics.push(error),
        scheduler: {
            request(fn) {
                callback = fn;
                return ++scheduled;
            },
            cancel() {},
        },
        afterFrame() {
            if (failFrame) throw new Error("Injected terminal host frame failure");
        },
    });
    const source = document.createElement("canvas");
    source.width = source.height = 2;
    const image: ImageAsset = {
        id: "host-gate",
        kind: "image",
        load: () => createImageBitmap(source),
        dispose: (bitmap) => bitmap.close(),
    };
    const scene = { id: "host-gate", assets: [image], setup() {} };
    try {
        const firstGate = Promise.withResolvers<void>();
        gate = firstGate.promise;
        const old = app.game.prepare(scene, { key: "old" });
        const rejected = rejects(old);
        await entered.promise;
        await app.stop();
        gate = Promise.resolve();
        const fresh = await app.game.prepare(scene, { key: "fresh" });
        const current = app.renderer;
        firstGate.resolve();
        await rejected;
        await app.start(fresh);
        callback(100);
        check(
            app.renderer === current &&
                app.renderer?.sprites === 0 &&
                scheduled === 2 &&
                diagnostics.length === 0,
            "stop cancels pending acquisition; fresh preparation survives late old completion",
        );

        await app.stop();
        const before = JSON.stringify(app.game.enumerate());
        const recoveryGate = Promise.withResolvers<void>();
        gate = recoveryGate.promise;
        entered = Promise.withResolvers<void>();
        devices[0].destroy();
        await entered.promise;
        const priorScheduled = scheduled;
        const pending = app.start();
        await Promise.resolve();
        await Promise.resolve();
        check(
            scheduled === priorScheduled,
            "resume schedules nothing while real-device recovery is pending",
        );
        recoveryGate.resolve();
        await pending;
        check(
            scheduled === priorScheduled + 1 && JSON.stringify(app.game.enumerate()) === before,
            "resume waits for replacement readiness and preserves mounted simulation state",
        );
        failFrame = true;
        callback(10000);
        check(
            app.game.lifecycle === "Failed" &&
                app.renderer instanceof WebGPURenderer &&
                app.renderer.status === "disposed" &&
                diagnostics.length === 1,
            "terminal host frame failure tears down the WebGPU owner",
        );
    } finally {
        await app.dispose();
        if (descriptor) Object.defineProperty(navigator, "gpu", descriptor);
        else Reflect.deleteProperty(navigator, "gpu");
    }
    const stopApp = new BrowserGame({
        canvas: document.createElement("canvas"),
        renderer: "webgpu",
        seed: 21,
        state: {},
        transition: (state) => state,
        scheduler: {
            request() {
                return 1;
            },
            cancel() {},
        },
    });
    try {
        await stopApp.start(
            await stopApp.game.prepare({ id: "stop-failure", setup() {} }, { key: "stop" }),
        );
        stopApp.audio.suspend = async () => {
            throw new Error("Injected suspend failure");
        };
        await rejects(stopApp.stop());
        check(
            stopApp.game.lifecycle === "Failed" &&
                stopApp.renderer instanceof WebGPURenderer &&
                stopApp.renderer.status === "disposed",
            "terminal stop failure tears down the WebGPU owner",
        );
    } finally {
        await stopApp.dispose();
    }
}

async function rejects(work: Promise<unknown>): Promise<void> {
    try {
        await work;
    } catch {
        return;
    }
    throw new Error("Expected cancelled preparation rejection");
}
