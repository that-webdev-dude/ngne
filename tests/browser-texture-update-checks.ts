import { Frame, WebGPURenderer, type TextureRegion } from "../src/index.js";

export async function checkBrowserTextureUpdates(
    check: (condition: unknown, message: string) => void,
): Promise<void> {
    const devices: GPUDevice[] = [];
    const originalRequest = GPUAdapter.prototype.requestDevice;
    let deviceWait: Promise<void> | undefined;
    GPUAdapter.prototype.requestDevice = async function (descriptor) {
        await deviceWait;
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
    let releaseDevice = () => {};
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
        let accepted = draw();
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

        deviceWait = new Promise<void>((resolve) => {
            releaseDevice = resolve;
        });
        devices[1].destroy();
        await devices[1].lost;
        paint.fillStyle = "#123456";
        paint.fillRect(0, 0, 4, 4);
        let settled = 0;
        const waiting = Promise.all([
            renderer.updateTexture("edit", source, { ...rect, width: 1, height: 1 }),
            renderer.createTexture("waiting", 2, 2),
        ]).finally(() => settled++);
        void waiting.catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 0));
        check(
            renderer.status === "recovering" && devices.length === 2 && settled === 0,
            "unsubmitted update and editable initialization wait for gated replacement readiness",
        );
        releaseDevice();
        await waiting;
        const patched = draw();
        check(
            patched.slice(0, 4).join() === "18,52,86,255" &&
                patched.slice(4).join() === accepted.slice(4).join(),
            "unsubmitted update applies once after recovery and preserves neighbouring pixels",
        );
        renderer.releaseTexture("waiting");
        accepted = patched;
        devices[2].destroy();
        await devices[2].lost;
        await renderer.ready();
        check(
            draw().join() === accepted.join(),
            "patch accepted after waiting for recovery survives another device replacement",
        );

        const device = devices.at(-1)!,
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
        releaseDevice();
        releaseScopes();
        renderer?.dispose();
        GPUAdapter.prototype.requestDevice = originalRequest;
    }
    await checkRawTexturePrecision(check);
}

const PATTERN_WIDTH = 256,
    PATTERN_HEIGHT = 254;
/** Straight-alpha sRGB bytes: red 0-255 by column, alpha 1-254 by row, independent green/blue. */
function precisionPattern(): Uint8ClampedArray<ArrayBuffer> {
    const data = new Uint8ClampedArray(PATTERN_WIDTH * PATTERN_HEIGHT * 4);
    for (let y = 0; y < PATTERN_HEIGHT; y++)
        for (let x = 0; x < PATTERN_WIDTH; x++) {
            const i = (y * PATTERN_WIDTH + x) * 4;
            data[i] = x;
            data[i + 1] = (x * 167 + y * 89 + ((x * y) >> 3)) & 255;
            data[i + 2] = ((x * 53) ^ (y * 211)) & 255;
            data[i + 3] = y + 1;
        }
    return data;
}
interface BlendError {
    readonly outside: number;
    readonly maxError: number;
}
/** Compares an opaque composite with the exact straight-alpha blend over a uniform grey. */
function blendError(
    shown: Uint8ClampedArray,
    stride: number,
    originX: number,
    originY: number,
    source: Uint8ClampedArray,
    background: number,
): BlendError {
    let outside = 0,
        maxError = 0;
    for (let y = 0; y < PATTERN_HEIGHT; y++)
        for (let x = 0; x < PATTERN_WIDTH; x++) {
            const s = (y * PATTERN_WIDTH + x) * 4,
                d = ((originY + y) * stride + originX + x) * 4,
                alpha = source[s + 3] / 255;
            let bad = shown[d + 3] !== 255;
            for (let c = 0; c < 3; c++) {
                const error = Math.abs(
                    shown[d + c] - (source[s + c] * alpha + background * (1 - alpha)),
                );
                maxError = Math.max(maxError, error);
                if (error > 1) bad = true;
            }
            if (bad) outside++;
        }
    return { outside, maxError };
}
const describe = (label: string, error: BlendError) =>
    `${label}: ${error.outside} texels outside ±1, max channel error ${error.maxError.toFixed(3)}`;

type Check = (condition: unknown, message: string) => void;
const BACKGROUNDS = [0x3a, 0x4a] as const;
const hex = (background: number) => "0x" + background.toString(16);
// Offset patches land at (5, 4) inside a larger editable texture.
const CANVAS_WIDTH = PATTERN_WIDTH + 6,
    CANVAS_HEIGHT = PATTERN_HEIGHT + 4;
const WHOLE: TextureRegion = {
    sourceX: 0,
    sourceY: 0,
    width: PATTERN_WIDTH,
    height: PATTERN_HEIGHT,
    destinationX: 0,
    destinationY: 0,
};

/** Shared state of one precision run: the renderer, its opaque reader and the input pattern. */
interface PrecisionRun {
    readonly renderer: WebGPURenderer;
    readonly pattern: Uint8ClampedArray<ArrayBuffer>;
    readonly check: Check;
    /** Renders one texture over a uniform grey and reads the whole opaque canvas back. */
    draw(texture: string, background: number, width?: number, height?: number): Uint8ClampedArray;
}

/** Records calls to browser capture APIs until `restore` is called. */
function spyOnCaptures(): { readonly captures: string[]; restore(): void } {
    const captures: string[] = [];
    const restores: (() => void)[] = [];
    const spy = <T extends object>(owner: T, key: keyof T & string, label: string) => {
        const original = owner[key];
        if (typeof original !== "function") return;
        owner[key] = function (this: unknown, ...args: unknown[]) {
            captures.push(label);
            return original.apply(this, args);
        } as T[keyof T & string];
        restores.push(() => (owner[key] = original));
    };
    spy(globalThis, "createImageBitmap", "createImageBitmap");
    spy(OffscreenCanvasRenderingContext2D.prototype, "getImageData", "offscreen getImageData");
    spy(OffscreenCanvasRenderingContext2D.prototype, "drawImage", "offscreen drawImage");
    spy(CanvasRenderingContext2D.prototype, "getImageData", "canvas getImageData");
    spy(CanvasRenderingContext2D.prototype, "drawImage", "canvas drawImage");
    return {
        captures,
        restore() {
            for (const restore of restores.splice(0)) restore();
        },
    };
}

/** True when every texel of the rectangle equals `expected(x, y, channel)`. */
function rectMatches(
    shown: Uint8ClampedArray,
    x0: number,
    y0: number,
    width: number,
    height: number,
    expected: (x: number, y: number, channel: number) => number,
): boolean {
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
            for (let c = 0; c < 4; c++)
                if (shown[((y0 + y) * CANVAS_WIDTH + x0 + x) * 4 + c] !== expected(x, y, c))
                    return false;
    return true;
}

/** True when every texel outside the offset patch shows the opaque background exactly. */
function neighboursExact(shown: Uint8ClampedArray, background: number): boolean {
    const inPatch = (x: number, y: number) =>
        x >= 5 && x < 5 + PATTERN_WIDTH && y >= 4 && y < 4 + PATTERN_HEIGHT;
    for (let y = 0; y < CANVAS_HEIGHT; y++)
        for (let x = 0; x < CANVAS_WIDTH; x++) {
            if (inPatch(x, y)) continue;
            const i = (y * CANVAS_WIDTH + x) * 4;
            const grey = [0, 1, 2].every((c) => shown[i + c] === background);
            if (!grey || shown[i + 3] !== 255) return false;
        }
    return true;
}

/** The pattern placed at (3, 2) inside a larger caller buffer, as an offset raw source. */
function offsetSource(pattern: Uint8ClampedArray) {
    const width = PATTERN_WIDTH + 3;
    const data = new Uint8Array(width * (PATTERN_HEIGHT + 2) * 4).fill(77);
    for (let y = 0; y < PATTERN_HEIGHT; y++)
        data.set(
            pattern.subarray(y * PATTERN_WIDTH * 4, (y + 1) * PATTERN_WIDTH * 4),
            ((y + 2) * width + 3) * 4,
        );
    const region: TextureRegion = {
        ...WHOLE,
        sourceX: 3,
        sourceY: 2,
        destinationX: 5,
        destinationY: 4,
    };
    return { source: { width, height: PATTERN_HEIGHT + 2, data }, region };
}

/** Whole and offset raw uploads: no capture APIs, ±1 of the exact blend, exact neighbours. */
async function checkRawUploads(run: PrecisionRun): Promise<number[][]> {
    const { renderer, pattern, check, draw } = run;
    await renderer.createTexture("raw-whole", PATTERN_WIDTH, PATTERN_HEIGHT);
    await renderer.createTexture("raw-offset", CANVAS_WIDTH, CANVAS_HEIGHT);
    const offset = offsetSource(pattern);
    const spies = spyOnCaptures();
    try {
        const scratch = new Uint8ClampedArray(pattern);
        const wholeUpdate = renderer.updateTexture(
            "raw-whole",
            new ImageData(scratch, PATTERN_WIDTH, PATTERN_HEIGHT),
            WHOLE,
        );
        scratch.fill(0); // Ownership ends when updateTexture returns.
        await wholeUpdate;
        await renderer.updateTexture("raw-offset", offset.source, offset.region);
    } finally {
        spies.restore();
    }
    check(
        spies.captures.length === 0,
        "raw updates invoke no bitmap/canvas capture APIs" +
            (spies.captures.length ? ": " + spies.captures.join(", ") : ""),
    );

    const results: { label: string; error: BlendError }[] = [];
    const rendered: number[][] = [];
    for (const background of BACKGROUNDS) {
        const shownWhole = draw("raw-whole", background, PATTERN_WIDTH, PATTERN_HEIGHT);
        const shownOffset = draw("raw-offset", background);
        results.push(
            {
                label: `raw whole update over ${hex(background)}`,
                error: blendError(shownWhole, CANVAS_WIDTH, 0, 0, pattern, background),
            },
            {
                label: `raw offset update over ${hex(background)}`,
                error: blendError(shownOffset, CANVAS_WIDTH, 5, 4, pattern, background),
            },
        );
        check(
            neighboursExact(shownOffset, background),
            `raw offset update over ${hex(background)} leaves transparent neighbours exact`,
        );
        rendered.push(Array.from(shownWhole), Array.from(shownOffset));
    }
    for (const { label, error } of results)
        check(error.outside === 0 && error.maxError <= 1, describe(label, error));
    return rendered;
}

/** Opaque colours are exact; a transparent patch with nonzero RGB replaces, showing the background. */
async function checkExactPatches(run: PrecisionRun): Promise<number[][]> {
    const { renderer, check, draw } = run;
    const opaque = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < opaque.length; i++) opaque[i] = i % 4 === 3 ? 255 : (i * 59 + 13) & 255;
    const transparent = new Uint8Array(8 * 8 * 4);
    for (let i = 0; i < transparent.length; i++) transparent[i] = i % 4 === 3 ? 0 : 200;
    await renderer.updateTexture(
        "raw-offset",
        { width: 4, height: 4, data: opaque },
        { ...WHOLE, width: 4, height: 4 },
    );
    await renderer.updateTexture(
        "raw-offset",
        { width: 8, height: 8, data: transparent },
        { ...WHOLE, width: 8, height: 8, destinationX: 40, destinationY: 100 },
    );
    const rendered = BACKGROUNDS.map((background) => draw("raw-offset", background));
    const exact = BACKGROUNDS.every(
        (background, index) =>
            rectMatches(rendered[index], 0, 0, 4, 4, (x, y, c) => opaque[(y * 4 + x) * 4 + c]) &&
            rectMatches(rendered[index], 40, 100, 8, 8, (_x, _y, c) =>
                c === 3 ? 255 : background,
            ),
    );
    check(
        exact,
        "opaque raw colours and transparent raw replacement over the background are exact",
    );
    return rendered.map((data) => Array.from(data));
}

/** `texture()` control from the same straight-alpha input; the legacy capture is report-only. */
async function checkControls(run: PrecisionRun): Promise<void> {
    const { renderer, pattern, check, draw } = run;
    const bitmap = await createImageBitmap(
        new ImageData(new Uint8ClampedArray(pattern), PATTERN_WIDTH, PATTERN_HEIGHT),
        { premultiplyAlpha: "none", colorSpaceConversion: "none" },
    );
    try {
        await renderer.texture("control", bitmap);
        await renderer.createTexture("legacy", PATTERN_WIDTH, PATTERN_HEIGHT);
        await renderer.updateTexture("legacy", bitmap, WHOLE);
    } finally {
        bitmap.close();
    }
    const errorOf = (texture: string, background: number) =>
        blendError(
            draw(texture, background, PATTERN_WIDTH, PATTERN_HEIGHT),
            CANVAS_WIDTH,
            0,
            0,
            pattern,
            background,
        );
    for (const background of BACKGROUNDS) {
        const control = errorOf("control", background);
        check(
            control.outside === 0,
            describe(`texture() control over ${hex(background)}`, control),
        );
        const legacy = errorOf("legacy", background);
        check(
            true,
            describe(`legacy bitmap updateTexture over ${hex(background)} (report-only)`, legacy),
        );
    }
}

/** Raw RGBA8 precision, exactness, capture bypass and recovery on the current adapter. */
async function checkRawTexturePrecision(check: Check): Promise<void> {
    const devices: GPUDevice[] = [];
    const originalRequest = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (descriptor) {
        const device = await originalRequest.call(this, descriptor);
        devices.push(device);
        return device;
    };
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    const read = document.createElement("canvas");
    read.width = CANVAS_WIDTH;
    read.height = CANVAS_HEIGHT;
    const reader = read.getContext("2d", { colorSpace: "srgb", willReadFrequently: true })!;
    reader.globalCompositeOperation = "copy";
    const diagnostics: unknown[] = [];
    let renderer: WebGPURenderer | undefined;
    try {
        const created = await WebGPURenderer.create(canvas, CANVAS_WIDTH, CANVAS_HEIGHT, (error) =>
            diagnostics.push(error),
        );
        renderer = created;
        const run: PrecisionRun = {
            renderer: created,
            pattern: precisionPattern(),
            check,
            draw(texture, background, width = CANVAS_WIDTH, height = CANVAS_HEIGHT) {
                const frame = new Frame();
                frame.sprite({ x: width / 2, y: height / 2, width, height, texture });
                created.render(frame, background * 0x010101);
                reader.drawImage(canvas, 0, 0);
                return reader.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT).data;
            },
        };
        const uploaded = await checkRawUploads(run);
        const patched = await checkExactPatches(run);
        await checkControls(run);

        const device = devices.at(-1)!;
        device.destroy();
        await device.lost;
        await created.ready();
        // Whole uploads keep their first image; offset textures show the later exact patches.
        const identical = BACKGROUNDS.every(
            (background, index) =>
                Array.from(
                    run.draw("raw-whole", background, PATTERN_WIDTH, PATTERN_HEIGHT),
                ).join() === uploaded[index * 2].join() &&
                Array.from(run.draw("raw-offset", background)).join() === patched[index].join(),
        );
        check(
            identical,
            "controlled recovery renders whole and offset translucent raw updates identically",
        );
        check(diagnostics.length === 0, "raw precision checks raise no renderer diagnostics");
    } finally {
        renderer?.dispose();
        GPUAdapter.prototype.requestDevice = originalRequest;
    }
}
