import { Camera, Frame, WebGPURenderer } from "../src/index.js";

/** Real WebGPU pixels; platform instrumentation observes allocation without replacing GPU work. */
export async function checkBrowserResize(
    check: (condition: unknown, message: string) => void,
): Promise<void> {
    const real = navigator.gpu,
        descriptor = Object.getOwnPropertyDescriptor(navigator, "gpu"),
        devices: GPUDevice[] = [],
        diagnostics: unknown[] = [];
    const allocations = { pipelines: 0, textures: 0, buffers: 0, bindings: 0, uploads: 0 };
    const gpu = new Proxy(real, {
        get(target, key) {
            if (key === "requestAdapter")
                return async (options?: GPURequestAdapterOptions) => {
                    const adapter = await target.requestAdapter(options);
                    if (!adapter) return null;
                    return new Proxy(adapter, {
                        get(target, key) {
                            if (key === "requestDevice")
                                return async (options?: GPUDeviceDescriptor) => {
                                    const device = await target.requestDevice(options);
                                    devices.push(device);
                                    const pipeline = device.createRenderPipelineAsync.bind(device),
                                        texture = device.createTexture.bind(device),
                                        buffer = device.createBuffer.bind(device),
                                        binding = device.createBindGroup.bind(device),
                                        upload = device.queue.copyExternalImageToTexture.bind(
                                            device.queue,
                                        );
                                    device.createRenderPipelineAsync = (descriptor) => {
                                        allocations.pipelines++;
                                        return pipeline(descriptor);
                                    };
                                    device.createTexture = (descriptor) => {
                                        allocations.textures++;
                                        return texture(descriptor);
                                    };
                                    device.createBuffer = (descriptor) => {
                                        allocations.buffers++;
                                        return buffer(descriptor);
                                    };
                                    device.createBindGroup = (descriptor) => {
                                        allocations.bindings++;
                                        return binding(descriptor);
                                    };
                                    device.queue.copyExternalImageToTexture = (...args) => {
                                        allocations.uploads++;
                                        return upload(...args);
                                    };
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
    const canvas = document.createElement("canvas"),
        capture = document.createElement("canvas"),
        source = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    source.width = source.height = 2;
    const paint = source.getContext("2d"),
        reader = capture.getContext("2d", { willReadFrequently: true });
    if (!paint || !reader) throw new Error("Canvas 2D unavailable");
    paint.putImageData(
        new ImageData(
            new Uint8ClampedArray([
                255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
            ]),
            2,
            2,
        ),
        0,
        0,
    );
    let renderer: WebGPURenderer | undefined;
    try {
        Object.defineProperty(navigator, "gpu", { configurable: true, value: gpu });
        renderer = await WebGPURenderer.create(canvas, 64, 64, (error) => diagnostics.push(error));
        await renderer.texture("pattern", source);
        // A later source edit must never replace the retained snapshot, including after loss.
        paint.clearRect(0, 0, 2, 2);
        const camera = new Camera();
        camera.cut(100, 50);
        const draw = (width: number, height: number) => {
            if (!renderer) throw new Error("Renderer missing");
            const frame = new Frame();
            frame.scene(camera, 1);
            frame.sprite({ x: 112, y: 62, width: 16, height: 16, texture: "pattern" });
            // Insert in reverse depth/layer order to detect changes to sorting and alpha.
            frame.sprite({
                x: 30,
                y: 12,
                width: 8,
                height: 8,
                color: 0xff0000,
                alpha: 0.5,
                layer: 2,
                depth: 5,
                screen: true,
            });
            frame.sprite({
                x: 30,
                y: 12,
                width: 8,
                height: 8,
                texture: "pattern",
                u: 0.5,
                v: 0,
                uw: 0.5,
                vh: 0.5,
                layer: 1,
                screen: true,
            });
            frame.sprite({
                x: 30,
                y: 12,
                width: 8,
                height: 8,
                color: 0x0000ff,
                alpha: 0.5,
                layer: 2,
                depth: 1,
                screen: true,
            });
            frame.rect(width - 4, height - 4, 4, 4, 0x2040e0, 1, 3, true);
            renderer.render(frame, 0x102030);
            capture.width = width;
            capture.height = height;
            reader.drawImage(canvas, 0, 0);
            const pixel = (x: number, y: number) =>
                Array.from(reader.getImageData(x, y, 1, 1).data);
            check(
                renderer.width === width &&
                    renderer.height === height &&
                    canvas.width === width &&
                    canvas.height === height &&
                    renderer.sprites === 5 &&
                    pixel(6, 6).join() === "255,0,0,255" &&
                    pixel(18, 6).join() === "0,255,0,255" &&
                    pixel(6, 18).join() === "0,0,255,255" &&
                    pixel(18, 18).join() === "255,255,255,255" &&
                    pixel(width - 4, height - 4).join() === "32,64,224,255" &&
                    pixel(width - 1, height - 1).join() === "16,32,48,255" &&
                    pixel(0, 0).join() === "16,32,48,255" &&
                    pixel(30, 12).every(
                        (value, channel) => Math.abs(value - [128, 64, 64, 255][channel]) <= 1,
                    ),
                `direct resize ${width}x${height} preserves projection, full clear, UVs, camera, screen space, ordering and alpha`,
            );
        };
        for (let generation = 0; generation < 2; generation++) {
            const allocated = JSON.stringify(allocations),
                inspection = JSON.stringify(renderer.inspect()),
                device = devices[generation];
            for (const [width, height] of [
                [96, 80],
                [40, 32],
                [40, 32],
                [128, 96],
                [64, 48],
            ]) {
                renderer.resize(width, height);
                draw(width, height);
            }
            check(
                devices.length === generation + 1 &&
                    devices[generation] === device &&
                    JSON.stringify(allocations) === allocated &&
                    JSON.stringify(renderer.inspect()) === inspection,
                `ordinary resizes in generation ${generation} retain device, pipeline, buffers, bindings, textures and sources without uploads`,
            );
            if (generation === 0) {
                device.destroy();
                await device.lost;
                check(
                    renderer.status === "recovering",
                    "resize scene enters controlled device-loss recovery",
                );
                let rejected = false;
                try {
                    renderer.resize(80, 60);
                } catch {
                    rejected = true;
                }
                check(
                    rejected &&
                        renderer.width === 64 &&
                        renderer.height === 48 &&
                        canvas.width === 64 &&
                        canvas.height === 48,
                    "recovery-time resize throws without changing the latest accepted dimensions",
                );
                await renderer.ready();
                check(
                    devices.length === 2 &&
                        allocations.uploads === 2 &&
                        renderer.width === 64 &&
                        renderer.height === 48,
                    "replacement restores the latest accepted viewport and uploads the retained image once",
                );
                draw(64, 48);
            }
        }
        await devices[1].queue.onSubmittedWorkDone();
        const large = devices[1].limits.maxTextureDimension2D * 2;
        renderer.dispose();
        for (const [width, height] of [
            [large, 64],
            [64, large],
        ]) {
            canvas.width = canvas.height = 64;
            renderer = await WebGPURenderer.create(canvas, width, height, (error) =>
                diagnostics.push(error),
            );
            paint.fillStyle = "#2040e0";
            paint.fillRect(0, 0, 2, 2);
            await renderer.texture("independent", source);
            paint.clearRect(0, 0, 2, 2);
            const frame = new Frame();
            frame.sprite({
                x: width / 2,
                y: height / 2,
                width: width / 2,
                height: height / 2,
                texture: "independent",
            });
            const drawIndependent = () => {
                if (!renderer) throw new Error("Renderer missing");
                renderer.render(frame, 0);
                capture.width = capture.height = 64;
                reader.drawImage(canvas, 0, 0);
                check(
                    renderer.width === width &&
                        renderer.height === height &&
                        canvas.width === 64 &&
                        canvas.height === 64 &&
                        renderer.sprites === 1 &&
                        Array.from(reader.getImageData(32, 32, 1, 1).data).join() ===
                            "32,64,224,255" &&
                        Array.from(reader.getImageData(2, 2, 1, 1).data).join() === "0,0,0,255",
                    `logical projection ${width}x${height} above the texture limit renders into an independent 64x64 backing canvas`,
                );
            };
            drawIndependent();
            let rejected = false;
            try {
                renderer.resize(width, height);
            } catch {
                rejected = true;
            }
            check(
                rejected,
                "oversized logical projection remains invalid as a resize backing-size request",
            );
            const original = devices.at(-1)!,
                uploads = allocations.uploads,
                inspection = JSON.stringify(renderer.inspect());
            original.destroy();
            await original.lost;
            await renderer.ready();
            drawIndependent();
            await devices.at(-1)!.queue.onSubmittedWorkDone();
            check(
                allocations.uploads === uploads + 1 &&
                    JSON.stringify(renderer.inspect()) === inspection,
                "recovery preserves independent logical dimensions and restores the retained image after a rejected resize",
            );
            renderer.dispose();
        }
        check(diagnostics.length === 0, "resize and recovery complete without WebGPU diagnostics");
    } finally {
        renderer?.dispose();
        if (descriptor) Object.defineProperty(navigator, "gpu", descriptor);
        else Reflect.deleteProperty(navigator, "gpu");
    }
}
