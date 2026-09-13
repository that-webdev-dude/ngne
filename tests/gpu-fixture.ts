/** Deliberately simulated GPU. These tests prove control flow, never pixels or hardware support. */
export function deferred<T>() {
    let resolve: (value: T) => void = () => {};
    let reject: (error: unknown) => void = () => {};
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
export function fakeBitmap() {
    let closes = 0;
    const image = {
        width: 2,
        height: 2,
        close() {
            closes++;
        },
    } as ImageBitmap;
    return {
        image,
        get closes() {
            return closes;
        },
    };
}
export function fakePlatform() {
    Object.assign(globalThis, {
        GPUBufferUsage: { COPY_DST: 8, VERTEX: 32, INDEX: 16, UNIFORM: 64 },
        GPUTextureUsage: { COPY_DST: 2, TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 16 },
        GPUShaderStage: { VERTEX: 1, FRAGMENT: 2 },
    });
    const devices: FakeDevice[] = [];
    let denied = false;
    let adapterWait: Promise<void> | undefined;
    let deviceWait: Promise<void> | undefined;
    let prepareDevice: (device: FakeDevice) => void = () => {};
    const surface = {
        configureCalls: 0,
        unconfigureCalls: 0,
        acquisitions: 0,
        failAcquire: false,
        configure() {
            this.configureCalls++;
        },
        unconfigure() {
            this.unconfigureCalls++;
        },
        getCurrentTexture() {
            if (this.failAcquire) throw new Error("Injected acquisition failure");
            this.acquisitions++;
            return { createView: () => ({}) };
        },
    };
    const canvas = { width: 64, height: 64, getContext: () => surface } as HTMLCanvasElement;
    const gpu = {
        wgslLanguageFeatures: new Set<string>(),
        getPreferredCanvasFormat: () => "bgra8unorm",
        async requestAdapter() {
            await adapterWait;
            if (denied) return null;
            return {
                async requestDevice() {
                    await deviceWait;
                    const device = new FakeDevice();
                    prepareDevice(device);
                    devices.push(device);
                    return device;
                },
            };
        },
    } as GPU;
    return {
        gpu,
        canvas,
        surface,
        devices,
        denyAdapter() {
            denied = true;
        },
        delayAdapter(wait: Promise<void>) {
            adapterWait = wait;
        },
        delayDevice(wait: Promise<void>) {
            deviceWait = wait;
        },
        configureDevice(prepare: (device: FakeDevice) => void) {
            prepareDevice = prepare;
        },
    };
}
export class FakeDevice extends EventTarget {
    readonly limits = { maxBufferSize: 56 * 16384, maxTextureDimension2D: 8192 };
    readonly loss = deferred<GPUDeviceLostInfo>();
    readonly lost = this.loss.promise;
    destroyed = 0;
    copies = 0;
    submissions = 0;
    passes = 0;
    endedPasses = 0;
    pipelineWait?: Promise<void>;
    scopeWait?: Promise<GPUError | null>;
    scopeDepth = 0;
    failCopy = false;
    failSubmit = false;
    failEncode = false;
    readonly buffers: { size: number; destroyed: number }[] = [];
    readonly textures: { destroyed: number }[] = [];
    readonly writes: { size: number | undefined; dataLength: number }[] = [];
    readonly queue = {
        writeBuffer: (
            _buffer: unknown,
            _offset: number,
            data: Float32Array,
            _dataOffset?: number,
            size?: number,
        ) => {
            this.writes.push({ size, dataLength: data.length });
        },
        writeTexture() {},
        copyExternalImageToTexture: () => {
            this.copies++;
            if (this.failCopy) throw new Error("Injected texture copy failure");
        },
        submit: () => {
            if (this.failSubmit) throw new Error("Injected submit failure");
            this.submissions++;
        },
    };
    pushErrorScope() {
        this.scopeDepth++;
    }
    popErrorScope(): Promise<GPUError | null> {
        this.scopeDepth--;
        return this.scopeWait ?? Promise.resolve(null);
    }
    createBuffer(descriptor: { size: number }) {
        const record = { size: descriptor.size, destroyed: 0 };
        this.buffers.push(record);
        return {
            destroy() {
                record.destroyed++;
            },
        };
    }
    createTexture() {
        const record = { destroyed: 0 };
        this.textures.push(record);
        return {
            createView: () => ({}),
            destroy() {
                record.destroyed++;
            },
        };
    }
    createBindGroupLayout() {
        return {};
    }
    createPipelineLayout() {
        return {};
    }
    createSampler() {
        return {};
    }
    createShaderModule() {
        return {};
    }
    async createRenderPipelineAsync() {
        await this.pipelineWait;
        return {};
    }
    createBindGroup() {
        return {};
    }
    createCommandEncoder() {
        return {
            beginRenderPass: () => {
                this.passes++;
                return {
                    setPipeline() {},
                    setVertexBuffer() {},
                    setIndexBuffer() {},
                    setBindGroup() {},
                    drawIndexed: () => {
                        if (this.failEncode) throw new Error("Injected encode failure");
                    },
                    end: () => {
                        this.endedPasses++;
                    },
                };
            },
            finish: () => ({}),
        };
    }
    destroy() {
        this.destroyed++;
        this.loss.resolve({ reason: "destroyed", message: "Controlled fake loss" });
    }
}
