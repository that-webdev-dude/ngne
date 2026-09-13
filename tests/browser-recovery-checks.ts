import { WebGpuRuntime } from "../src/webgpu-runtime.js";

export async function checkBrowserRecovery(
    check: (condition: unknown, message: string) => void,
): Promise<void> {
    const real = navigator.gpu,
        devices: GPUDevice[] = [],
        diagnostics: unknown[] = [];
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
            "controlled device.destroy enters recovery on real hardware",
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
            "controlled hardware-device loss rebuilds both image routes and restores exact canvas pixels",
        );
        check(
            diagnostics.length === 0 && released === 0,
            "successful device replacement preserves source consumers without validation errors",
        );
    } finally {
        runtime.dispose();
        bitmap.close();
        canvas.remove();
    }
    check(released === 1, "recovered renderer releases its retained source once at disposal");
}
