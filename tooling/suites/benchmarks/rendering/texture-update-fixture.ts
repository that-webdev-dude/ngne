import { WebGPURenderer } from "../../../../src/index.js";

/** One bounded, serial editor-like workload. No budget or GPU-completion claim. */
export async function startTextureUpdateBenchmark(): Promise<void> {
    const size = 512,
        patch = 16,
        edits = 40,
        repetitions = 6;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("Missing WebGPU adapter");
    const counters = {
        allocations: 0,
        bindings: 0,
        copies: 0,
        transferredPixels: 0,
        snapshots: 0,
        snapshotPixels: 0,
    };
    const devices: GPUAdapterInfo[] = [];
    const observed = new WeakSet<GPUDevice>();
    const rawTexture = GPUDevice.prototype.createTexture;
    const rawBinding = GPUDevice.prototype.createBindGroup;
    const rawCopy = GPUQueue.prototype.copyExternalImageToTexture;
    const rawWrite = GPUQueue.prototype.writeTexture;
    const rawSnapshot = globalThis.createImageBitmap;
    function snapshot(image: ImageBitmapSource, options?: ImageBitmapOptions): Promise<ImageBitmap>;
    function snapshot(
        image: ImageBitmapSource,
        sx: number,
        sy: number,
        sw: number,
        sh: number,
        options?: ImageBitmapOptions,
    ): Promise<ImageBitmap>;
    function snapshot(
        image: ImageBitmapSource,
        second?: ImageBitmapOptions | number,
        sy?: number,
        sw?: number,
        sh?: number,
        options?: ImageBitmapOptions,
    ): Promise<ImageBitmap> {
        counters.snapshots++;
        if (
            typeof second === "number" &&
            sy !== undefined &&
            sw !== undefined &&
            sh !== undefined
        ) {
            counters.snapshotPixels += sw * sh;
            return rawSnapshot(image, second, sy, sw, sh, options);
        }
        if (
            typeof second === "number" ||
            !("width" in image) ||
            !("height" in image) ||
            typeof image.width !== "number" ||
            typeof image.height !== "number"
        )
            throw new Error("Unexpected snapshot input");
        counters.snapshotPixels += image.width * image.height;
        return rawSnapshot(image, second);
    }
    globalThis.createImageBitmap = snapshot;
    GPUDevice.prototype.createTexture = function (descriptor) {
        if (!observed.has(this)) {
            observed.add(this);
            devices.push(this.adapterInfo);
        }
        counters.allocations++;
        return rawTexture.call(this, descriptor);
    };
    GPUDevice.prototype.createBindGroup = function (descriptor) {
        counters.bindings++;
        return rawBinding.call(this, descriptor);
    };
    const count = (extent: GPUExtent3D) => {
        counters.copies++;
        if (Array.isArray(extent))
            counters.transferredPixels += Number(extent[0]) * Number(extent[1] ?? 1);
        else if ("width" in extent)
            counters.transferredPixels += extent.width * (extent.height ?? 1);
        else throw new Error("Unexpected copy extent");
    };
    GPUQueue.prototype.copyExternalImageToTexture = function (source, destination, extent) {
        count(extent);
        rawCopy.call(this, source, destination, extent);
    };
    GPUQueue.prototype.writeTexture = function (destination, bytes, layout, extent) {
        count(extent);
        rawWrite.call(this, destination, bytes, layout, extent);
    };
    const samples: {
        repetition: number;
        method: string;
        initializationMs: number;
        readinessMs: number[];
        totalMs: number;
        counters: typeof counters;
    }[] = [];
    const diagnostics: string[] = [];
    try {
        for (let repetition = 0; repetition < repetitions; repetition++) {
            // Alternate pair order; retain every repetition without outlier filtering.
            for (const method of repetition % 2
                ? ["patch", "replacement"]
                : ["replacement", "patch"]) {
                const source = document.createElement("canvas");
                source.width = source.height = size;
                const context = source.getContext("2d")!;
                const canvas = document.createElement("canvas");
                canvas.width = canvas.height = size;
                document.body.append(canvas);
                const renderer = await WebGPURenderer.create(canvas, size, size, (error) =>
                    diagnostics.push(String(error)),
                );
                try {
                    const start = performance.now();
                    if (method === "patch") await renderer.createTexture("edit", size, size);
                    else await renderer.texture("edit", source);
                    const initializationMs = performance.now() - start;
                    const before = { ...counters },
                        readinessMs: number[] = [];
                    const begin = performance.now();
                    for (let edit = 0; edit < edits; edit++) {
                        const x = (edit * 37) % (size - patch + 1),
                            y = (edit * 61) % (size - patch + 1);
                        context.fillStyle = edit % 2 ? "#40c080" : "rgba(240, 64, 128, 0.5)";
                        context.clearRect(x, y, patch, patch);
                        context.fillRect(x, y, patch, patch);
                        const at = performance.now();
                        if (method === "patch")
                            await renderer.updateTexture("edit", source, {
                                sourceX: x,
                                sourceY: y,
                                width: patch,
                                height: patch,
                                destinationX: x,
                                destinationY: y,
                            });
                        else await renderer.texture("edit", source);
                        readinessMs.push(performance.now() - at);
                    }
                    samples.push({
                        repetition,
                        method,
                        initializationMs,
                        readinessMs,
                        totalMs: performance.now() - begin,
                        counters: {
                            allocations: counters.allocations - before.allocations,
                            bindings: counters.bindings - before.bindings,
                            copies: counters.copies - before.copies,
                            transferredPixels:
                                counters.transferredPixels - before.transferredPixels,
                            snapshots: counters.snapshots - before.snapshots,
                            snapshotPixels: counters.snapshotPixels - before.snapshotPixels,
                        },
                    });
                } finally {
                    renderer.dispose();
                    canvas.remove();
                }
            }
        }
        if (diagnostics.length) throw new Error(diagnostics.join("; "));
        const info = adapter.info;
        window.__ngneTextureUpdateBenchmark = {
            size,
            patch,
            edits,
            repetitions,
            samples,
            userAgent: navigator.userAgent,
            hardwareConcurrency: navigator.hardwareConcurrency,
            visibility: document.visibilityState,
            adapter: {
                vendor: info.vendor,
                architecture: info.architecture,
                device: info.device,
                description: info.description,
                isFallbackAdapter: info.isFallbackAdapter,
            },
            renderingDevices: devices.map((device) => ({
                vendor: device.vendor,
                architecture: device.architecture,
                description: device.description,
                isFallbackAdapter: device.isFallbackAdapter,
            })),
            limits: "Instrumented API-to-validated-readiness latency; excludes GPU completion and visible presentation. Serial synthetic edits, one texture size. Counters cover GPU API calls and requested transfer areas, not driver allocations or CPU snapshot cost. Initialization is separate; no warmup repetitions or outlier removal. No cross-device or consumer budget claim.",
        };
        document.getElementById("results")!.textContent = JSON.stringify(
            window.__ngneTextureUpdateBenchmark,
            null,
            2,
        );
    } finally {
        GPUDevice.prototype.createTexture = rawTexture;
        GPUDevice.prototype.createBindGroup = rawBinding;
        GPUQueue.prototype.copyExternalImageToTexture = rawCopy;
        GPUQueue.prototype.writeTexture = rawWrite;
        globalThis.createImageBitmap = rawSnapshot;
    }
}

declare global {
    interface Window {
        __ngneTextureUpdateBenchmark?: Record<string, unknown>;
    }
}
