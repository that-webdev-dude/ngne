import { WebGpuRuntime } from "../src/webgpu-runtime.js";

export async function checkBrowserRecovery(
    check: (condition: unknown, message: string) => void,
): Promise<void> {
    const real = navigator.gpu,
        devices: GPUDevice[] = [],
        diagnostics: unknown[] = [];
    let deviceWait: Promise<void> | undefined;
    const gpu = {
        wgslLanguageFeatures: real.wgslLanguageFeatures,
        getPreferredCanvasFormat: () => real.getPreferredCanvasFormat(),
        async requestAdapter(options?: GPURequestAdapterOptions) {
            const adapter = await real.requestAdapter(options);
            if (!adapter) return null;
            return new Proxy(adapter, {
                get(target, key) {
                    if (key === "requestDevice")
                        return async (descriptor?: GPUDeviceDescriptor) => {
                            await deviceWait;
                            const device = await target.requestDevice(descriptor);
                            devices.push(device);
                            return device;
                        };
                    const value = Reflect.get(target, key, target);
                    return typeof value === "function" ? value.bind(target) : value;
                },
            });
        },
    } as GPU;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    canvas.setAttribute("aria-label", "WebGPU controlled recovery canvas");
    document.body.append(canvas);
    const runtime = await WebGpuRuntime.create(canvas, 64, 64, (error) => diagnostics.push(error), {
        gpu,
    });
    const source = document.createElement("canvas");
    source.width = source.height = 2;
    const paint = source.getContext("2d");
    if (!paint) throw new Error("Canvas 2D unavailable");
    paint.fillStyle = "#c04080";
    paint.fillRect(0, 0, 2, 2);
    const bitmap = await createImageBitmap(source, {
        premultiplyAlpha: "none",
        colorSpaceConversion: "none",
    });
    let released = 0;
    await runtime.acquire(
        { id: "leased", kind: "image", load: async () => bitmap },
        {
            id: "leased",
            value: bitmap,
            release() {
                released++;
            },
        },
        new AbortController().signal,
    );
    await runtime.texture("manual", source);
    await runtime.texture("survivor", source);
    paint.fillStyle = "blue";
    paint.fillRect(0, 0, 2, 2);
    const { Frame } = await import("../src/renderer.js");
    const frame = new Frame();
    frame.sprite({ x: 16, y: 32, width: 32, height: 64, texture: "leased" });
    frame.sprite({ x: 48, y: 32, width: 32, height: 64, texture: "manual" });
    const read = document.createElement("canvas");
    read.width = read.height = 64;
    const reader = read.getContext("2d");
    if (!reader) throw new Error("Canvas readback unavailable");
    const pixels = () => {
        runtime.render(frame, 0);
        reader.drawImage(canvas, 0, 0);
        return [
            Array.from(reader.getImageData(16, 32, 1, 1).data).join(),
            Array.from(reader.getImageData(48, 32, 1, 1).data).join(),
        ];
    };
    try {
        const before = pixels();
        check(
            before.every((value) => value === "192,64,128,255"),
            "real WebGPU canvas renders leased and snapshotted source pixels before loss",
        );
        devices[0].destroy();
        await devices[0].lost;
        check(
            runtime.status === "recovering",
            "controlled device.destroy enters recovery on the selected WebGPU adapter",
        );
        runtime.render(frame, 0);
        check(
            runtime.drawCalls === 0,
            "controlled loss skips submission while replacement is pending",
        );
        await runtime.ready();
        const after = pixels();
        check(
            devices.length === 2 && runtime.status === "ready" && after.join() === before.join(),
            "controlled device loss rebuilds both image routes and restores exact canvas pixels",
        );
        check(
            diagnostics.length === 0 && released === 0,
            "successful device replacement preserves source consumers without validation errors",
        );
        runtime.releaseTexture("manual");
        runtime.releaseTexture("manual");
        let inspection = runtime.inspect();
        check(
            inspection.sources === 2 &&
                inspection.textures === 3 &&
                inspection.manualSources === 1 &&
                inspection.entries.every((entry) => entry.id !== "manual"),
            "manual release removes registration and ownership estimates while keeping leased and other manual sources",
        );
        frame.textures[1] = "survivor";
        check(
            pixels().join() === before.join(),
            "leased and other manual texture pixels survive manual release",
        );
        await runtime.texture("manual", source); // source is now blue, unlike its original snapshot
        frame.textures[1] = "manual";
        check(
            pixels().join() === "192,64,128,255,0,0,255,255",
            "released manual ID accepts a new source and draws its exact pixels",
        );
        let resume!: () => void;
        deviceWait = new Promise<void>((resolve) => {
            resume = resolve;
        });
        devices[1].destroy();
        await devices[1].lost;
        check(
            runtime.status === "recovering",
            "second controlled loss pauses replacement for manual release",
        );
        runtime.releaseTexture("manual");
        paint.fillStyle = "#40c080";
        paint.fillRect(0, 0, 2, 2);
        const reused = runtime.texture("manual", source);
        resume();
        await runtime.ready();
        await reused;
        inspection = runtime.inspect();
        check(
            devices.length === 3 &&
                inspection.sources === 3 &&
                inspection.textures === 4 &&
                inspection.leasedSources === 1 &&
                inspection.manualSources === 2 &&
                pixels().join() === "192,64,128,255,64,192,128,255",
            "release and ID reuse during controlled recovery publish only the new manual pixels",
        );
        check(
            diagnostics.length === 0 && released === 0,
            "manual release and reuse across device generations preserve leased ownership without validation errors",
        );
    } finally {
        runtime.dispose();
        bitmap.close();
        canvas.remove();
    }
    check(released === 1, "recovered renderer releases its retained source once at disposal");
}
