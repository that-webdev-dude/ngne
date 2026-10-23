import { Frame, WebGPURenderer, type TextureRegion } from "../src/index.js";

export async function checkBrowserTextureUpdates(
    check: (condition: unknown, message: string) => void,
): Promise<void> {
    const devices: GPUDevice[] = [];
    const originalRequest = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (descriptor) {
        const device = await originalRequest.call(this, descriptor);
        devices.push(device);
        return device;
    };
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 4;
    const source = document.createElement("canvas");
    source.width = source.height = 4;
    const paint = source.getContext("2d")!;
    const read = document.createElement("canvas");
    read.width = read.height = 4;
    const reader = read.getContext("2d")!;
    const diagnostics: unknown[] = [];
    let renderer: WebGPURenderer | undefined;
    let releaseScopes = () => {};
    try {
        renderer = await WebGPURenderer.create(canvas, 4, 4, (error) => diagnostics.push(error));
        await renderer.createTexture("edit", 4, 4);
        const frame = new Frame();
        frame.sprite({ x: 2, y: 2, width: 4, height: 4, texture: "edit" });
        const draw = () => {
            renderer!.render(frame, 0);
            reader.drawImage(canvas, 0, 0);
            return Array.from(reader.getImageData(0, 0, 4, 4).data);
        };
        const rect: TextureRegion = {
            sourceX: 0,
            sourceY: 0,
            width: 4,
            height: 4,
            destinationX: 0,
            destinationY: 0,
        };
        check(
            draw()
                .filter((_, i) => i % 4 !== 3)
                .every((value) => value === 0),
            "new mutable texture is transparent",
        );
        paint.fillStyle = "#4080c0";
        paint.fillRect(0, 0, 4, 4);
        await renderer.updateTexture("edit", source, rect);
        const before = draw();
        check(
            before.slice(0, 4).join() === "64,128,192,255",
            "full initial update preserves sRGB opaque pixels",
        );
        paint.clearRect(0, 0, 4, 4);
        paint.fillStyle = "rgba(255, 0, 0, 0.5)";
        paint.fillRect(1, 1, 1, 1);
        const bitmap = await createImageBitmap(source, {
            premultiplyAlpha: "none",
            colorSpaceConversion: "none",
        });
        try {
            await renderer.updateTexture("edit", bitmap, {
                ...rect,
                sourceX: 1,
                sourceY: 1,
                width: 1,
                height: 1,
                destinationX: 2,
                destinationY: 1,
            });
        } finally {
            bitmap.close();
        }
        paint.fillStyle = "blue";
        paint.fillRect(0, 0, 4, 4);
        const semi = draw();
        const changed = (1 * 4 + 2) * 4;
        check(
            semi.every(
                (value, index) =>
                    (index >= changed && index < changed + 4) || value === before[index],
            ) &&
                Math.abs(semi[changed] - 128) <= 1 &&
                semi[changed + 1] === 0 &&
                semi[changed + 2] === 0,
            "offset semitransparent patch uses straight alpha, leaves neighbours unchanged and survives caller mutation/bitmap closure",
        );
        paint.clearRect(0, 0, 4, 4);
        await renderer.updateTexture("edit", source, { ...rect, width: 1, height: 1 });
        const accepted = draw();
        check(
            accepted.slice(0, 4).join() === "0,0,0,255",
            "transparent patch replaces previous content without source-over compositing",
        );
        devices[0].destroy();
        await devices[0].lost;
        await renderer.ready();
        check(
            draw().join() === accepted.join(),
            "controlled loss restores every accepted opaque, semitransparent and transparent patch exactly",
        );

        const device = devices[1],
            pop = device.popErrorScope.bind(device);
        const gate = new Promise<void>((resolve) => {
            releaseScopes = resolve;
        });
        device.popErrorScope = async () => {
            const result = await pop();
            await gate;
            return result;
        };
        let submitted = () => {};
        const entered = new Promise<void>((resolve) => {
            submitted = resolve;
        });
        const write = device.queue.writeTexture.bind(device.queue);
        device.queue.writeTexture = (...args) => {
            write(...args);
            submitted();
        };
        paint.fillStyle = "lime";
        paint.fillRect(0, 0, 4, 4);
        const pending = renderer.updateTexture("edit", source, { ...rect, width: 1, height: 1 });
        const rejected = pending.then(
            () => false,
            () => true,
        );
        await entered;
        device.destroy();
        await device.lost;
        await renderer.ready();
        check(
            draw().join() === accepted.join(),
            "loss during pending validation restores accepted content before reporting ready",
        );
        releaseScopes();
        check(await rejected, "lost-generation patch rejects without accepting unvalidated bytes");
        await renderer.updateTexture("edit", source, { ...rect, width: 1, height: 1 });
        check(
            draw().slice(0, 4).join() === "0,255,0,255" && diagnostics.length === 0,
            "edits continue after recovery without validation diagnostics",
        );
    } finally {
        releaseScopes();
        renderer?.dispose();
        GPUAdapter.prototype.requestDevice = originalRequest;
    }
}
