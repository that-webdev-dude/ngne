import { Game, PREPARE_ASSET, type PreparedScene, type SceneDefinition } from "../src/scene.js";
import { Frame } from "../src/renderer.js";
import type { ImageAsset } from "../src/assets.js";
import { WebGpuRuntime } from "../src/webgpu-runtime.js";

export async function checkBrowserRetention(
    check: (condition: unknown, message: string) => void,
): Promise<void> {
    const devices: GPUDevice[] = [],
        errors: unknown[] = [];
    const real = navigator.gpu;
    const gpu = new Proxy(real, {
        get(target, key) {
            if (key === "requestAdapter")
                return async (options?: GPURequestAdapterOptions) => {
                    const adapter = await target.requestAdapter(options);
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
                };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    canvas.setAttribute("aria-label", "Bounded content retention validation");
    document.body.append(canvas);
    const source = document.createElement("canvas");
    source.width = source.height = 2;
    const paint = source.getContext("2d")!;
    paint.fillStyle = "#40c080";
    paint.fillRect(0, 0, 2, 2);
    const read = document.createElement("canvas");
    read.width = read.height = 32;
    const reader = read.getContext("2d")!;
    let loads = 0,
        closes = 0;
    const makeImage = (id: string): ImageAsset => ({
        id,
        kind: "image",
        estimateBytes: (v) => v.width * v.height * 4,
        async load() {
            loads++;
            return createImageBitmap(source, {
                premultiplyAlpha: "none",
                colorSpaceConversion: "none",
            });
        },
        dispose(v) {
            closes++;
            v.close();
        },
    });
    const shared = makeImage("shared"),
        images = Array.from({ length: 13 }, (_, i) => makeImage(`distinct-${i}`));
    const game = new Game({
        seed: 1,
        state: {},
        transition: (s) => s,
        assetRetention: { maxEntries: 2, maxBytes: 32 },
    });
    const runtime = await WebGpuRuntime.create(canvas, 32, 32, (e) => errors.push(e), { gpu });
    game[PREPARE_ASSET] = async (asset, signal) => {
        const image = [shared, ...images].find((i) => i === asset);
        if (!image) return;
        return runtime.acquire(image, await game.assets.acquire(image, signal, "renderer"), signal);
    };
    let next: PreparedScene | undefined;
    const scene = (image: ImageAsset): SceneDefinition<Record<string, never>, never> => ({
        id: image.id,
        assets: [shared, image],
        setup(s) {
            s.system((ctx) => {
                if (next) {
                    ctx.scenes.set(next);
                    next = undefined;
                }
            });
            s.render((frame) =>
                frame.sprite({ x: 16, y: 16, width: 32, height: 32, texture: image.id }),
            );
        },
    });
    const frame = new Frame();
    const pixels = () => {
        frame.reset();
        game.render(frame, 1);
        runtime.render(frame, 0);
        reader.drawImage(canvas, 0, 0);
        return Array.from(reader.getImageData(16, 16, 1, 1).data).join();
    };
    try {
        await game.start(await game.prepare(scene(images[0]), { key: "initial" }));
        const baseline = pixels();
        check(baseline === "64,192,128,255", "retention fixture renders decoded image pixels");
        for (let i = 1; i < images.length; i++) {
            next = await game.prepare(scene(images[i]), { key: String(i) });
            check(
                game.assets.inspect().protectedOverBudget && closes === i - 1,
                `retention window ${i} protects active/shared/candidate sources above budget`,
            );
            if (i === 6) {
                devices[0].destroy();
                await devices[0].lost;
                game.assets.trim();
                await runtime.ready();
                check(
                    devices.length === 2 && pixels() === baseline,
                    "eviction policy preserves active pixels through controlled device loss with pending transition",
                );
            }
            game.tick();
            game.assets.trim();
            const cpu = game.assets.inspect(1),
                gpu = runtime.inspect(1);
            check(
                cpu.loaded === 2 &&
                    cpu.estimatedBytes === 32 &&
                    cpu.claims.scene === 2 &&
                    cpu.claims.renderer === 2 &&
                    !cpu.overBudget &&
                    closes === i &&
                    gpu.sources === 2 &&
                    gpu.textures === 3 &&
                    gpu.estimatedTextureBytes === 36 &&
                    pixels() === baseline,
                `retention window ${i} reclaims distinct content while shared active content presents`,
            );
        }
        next = await game.prepare(scene(images[0]), { key: "reacquired" });
        game.tick();
        check(
            loads === 15 && game.assets.inspect().loaded === 2,
            "evicted image is decoded again on scene reacquisition",
        );
        check(
            errors.length === 0,
            "bounded retention and controlled recovery report no renderer errors",
        );
    } finally {
        runtime.dispose();
        game.dispose();
        canvas.remove();
    }
    check(
        closes === loads && game.assets.inspect().loaded === 0 && runtime.inspect().sources === 0,
        "terminal retention fixture cleanup closes every decoded source once",
    );
}
