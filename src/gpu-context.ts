// Adapted from cluster-renderer .versions/v03/gpu/GpuContext.ts at
// 34458a987f03b00894e98a40d39fc0ae666194f6. BrowserGame owns backing dimensions.
export interface GpuContext {
    readonly device: GPUDevice;
    readonly format: GPUTextureFormat;
    assertReady(): void;
    acquire(): GPUTextureView;
    submit(encoder: GPUCommandEncoder): void;
    dispose(): void;
}

export async function createGpuContext(
    canvas: HTMLCanvasElement,
    signal: AbortSignal,
    onLost: (message: string) => void,
    onError: (error: unknown) => void,
    gpu: GPU | undefined = navigator.gpu,
): Promise<GpuContext> {
    signal.throwIfAborted();
    if (!gpu)
        throw new Error(
            "NGNE requires WebGPU. Use a supported browser with hardware acceleration enabled",
        );
    const context = canvas.getContext("webgpu");
    if (!context) throw new Error("Cannot acquire a WebGPU canvas context");
    const adapter = await gpu.requestAdapter();
    signal.throwIfAborted();
    if (!adapter)
        throw new Error("WebGPU adapter unavailable. Enable browser hardware acceleration");
    const device = await adapter.requestDevice();
    let disposed = false;
    let configured = false;
    let lost = false;
    const format = gpu.getPreferredCanvasFormat();
    const assertReady = () => {
        signal.throwIfAborted();
        if (disposed || lost) throw new Error("WebGPU device is no longer available");
    };
    const uncaptured = (event: GPUUncapturedErrorEvent) => {
        if (!disposed && !signal.aborted) onError(event.error);
    };
    device.addEventListener("uncapturederror", uncaptured);
    void device.lost
        .then((info) => {
            lost = true;
            if (!disposed && !signal.aborted) onLost(info.message);
        })
        .catch(onError);
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        device.removeEventListener("uncapturederror", uncaptured);
        const errors: unknown[] = [];
        if (configured) {
            configured = false;
            try {
                context.unconfigure();
            } catch (error) {
                errors.push(error);
            }
        }
        try {
            device.destroy();
        } catch (error) {
            errors.push(error);
        }
        if (errors.length) throw new AggregateError(errors, "WebGPU context disposal failed");
    };
    try {
        assertReady();
        context.configure({ device, format, alphaMode: "premultiplied" });
        configured = true;
        // Observe an already-resolved lost promise before publishing acquisition.
        await Promise.resolve();
        assertReady();
    } catch (error) {
        try {
            dispose();
        } catch (cleanup) {
            throw new AggregateError([error, cleanup], "WebGPU acquisition failed");
        }
        throw error;
    }
    return {
        device,
        format,
        assertReady,
        acquire() {
            assertReady();
            const { width, height } = canvas;
            if (
                !Number.isSafeInteger(width) ||
                !Number.isSafeInteger(height) ||
                width <= 0 ||
                height <= 0 ||
                width > device.limits.maxTextureDimension2D ||
                height > device.limits.maxTextureDimension2D
            )
                throw new Error("Invalid WebGPU canvas dimensions");
            return context.getCurrentTexture().createView();
        },
        submit(encoder) {
            assertReady();
            device.queue.submit([encoder.finish()]);
        },
        dispose,
    };
}

/** No await while scopes are on the shared device stack, including on synchronous failure. */
export async function validateGpuOperation<T>(device: GPUDevice, operation: () => T): Promise<T> {
    device.pushErrorScope("out-of-memory");
    device.pushErrorScope("validation");
    let value: T | undefined;
    const errors: unknown[] = [];
    const scopes: Promise<GPUError | null>[] = [];
    try {
        value = operation();
    } catch (error) {
        errors.push(error);
    } finally {
        for (let i = 0; i < 2; i++) {
            try {
                scopes.push(device.popErrorScope());
            } catch (error) {
                errors.push(error);
            }
        }
    }
    const results = await Promise.allSettled(scopes);
    for (const result of results) {
        if (result.status === "rejected") errors.push(result.reason);
        else if (result.value) errors.push(new Error(result.value.message));
    }
    if (errors.length) throw new AggregateError(errors, "WebGPU resource validation failed");
    // operation completed synchronously without throwing; T may itself be undefined.
    return value as T;
}
