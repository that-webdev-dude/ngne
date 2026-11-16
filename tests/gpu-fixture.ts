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
            return { width: canvas.width, height: canvas.height, createView: () => ({}) };
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
    textureDestroyError?: Error;
    failSubmit = false;
    failEncode = false;
    readonly buffers: { size: number; destroyed: number }[] = [];
    readonly textures: { destroyed: number }[] = [];
    readonly pipelines: object[] = [];
    readonly bindings: object[] = [];
    readonly samplers: GPUSamplerDescriptor[] = [];
    /** Sampler descriptor bound by each bind group, in creation order with `bindings`. */
    readonly bindingSamplers = new Map<object, GPUSamplerDescriptor | undefined>();
    readonly usedPipelines: object[] = [];
    readonly usedBindings: object[] = [];
    /** Encoded pass commands in order: `scissor x,y,w,h` and `draw <instances>`. */
    readonly commands: string[] = [];
    readonly writes: { size: number | undefined; dataLength: number; prefix: number[] }[] = [];
    readonly textureWrites: {
        destination: GPUImageCopyTexture;
        data: Uint8Array;
        size: GPUExtent3D;
    }[] = [];
    readonly queue = {
        writeBuffer: (
            _buffer: unknown,
            _offset: number,
            data: Float32Array,
            _dataOffset?: number,
            size?: number,
        ) => {
            this.writes.push({
                size,
                dataLength: data.length,
                prefix: Array.from(data.slice(0, 12)),
            });
        },
        writeTexture: (
            destination: GPUImageCopyTexture,
            data: Uint8Array,
            _layout: GPUImageDataLayout,
            size: GPUExtent3D,
        ) => {
            this.textureWrites.push({ destination, data: data.slice(), size });
            if (this.failCopy) throw new Error("Injected texture write failure");
        },
        copyExternalImageToTexture: () => {
            this.copies++;
            if (this.failCopy) throw new Error("Injected texture copy failure");
        },
        submit: () => {
            if (this.failSubmit) throw new Error("Injected submit failure");
            this.submissions++;
        },
        /** Settles when `completeWork` reaches the submissions made before this call. */
        onSubmittedWorkDone: () => {
            this.workDoneQueries++;
            const target = this.submissions;
            if (target <= this.completed) return Promise.resolve(undefined);
            const wait = deferred<undefined>();
            this.workWaiters.push({ target, ...wait });
            return wait.promise;
        },
    };
    /** Simulated GPU progress; destroy and loss deliberately leave queue waits pending. */
    completed = 0;
    workDoneQueries = 0;
    readonly workWaiters: {
        target: number;
        resolve: (value: undefined) => void;
        reject: (error: unknown) => void;
    }[] = [];
    completeWork(count = this.submissions) {
        this.completed = count;
        const done = this.workWaiters.filter((waiter) => waiter.target <= count);
        const waiting = this.workWaiters.filter((waiter) => waiter.target > count);
        this.workWaiters.splice(0, this.workWaiters.length, ...waiting);
        for (const waiter of done) waiter.resolve(undefined);
    }
    failWork(error: Error) {
        for (const waiter of this.workWaiters.splice(0)) waiter.reject(error);
    }
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
    createTexture(descriptor?: { size: number[] }) {
        const record = { destroyed: 0 };
        this.textures.push(record);
        const [width = 64, height = 64] = descriptor?.size ?? [];
        return {
            width,
            height,
            createView: () => ({}),
            destroy: () => {
                record.destroyed++;
                if (this.textureDestroyError) throw this.textureDestroyError;
            },
        };
    }
    createBindGroupLayout() {
        return {};
    }
    createPipelineLayout() {
        return {};
    }
    createSampler(descriptor: GPUSamplerDescriptor) {
        this.samplers.push(descriptor);
        return { descriptor };
    }
    createShaderModule() {
        return {};
    }
    async createRenderPipelineAsync() {
        await this.pipelineWait;
        const pipeline = {};
        this.pipelines.push(pipeline);
        return pipeline;
    }
    createBindGroup(descriptor: { entries: Iterable<{ resource: unknown }> }) {
        const binding = {};
        this.bindings.push(binding);
        const sampler = [...descriptor.entries]
            .map(({ resource }) => resource)
            .find((resource): resource is { descriptor: GPUSamplerDescriptor } =>
                Boolean(resource && typeof resource === "object" && "descriptor" in resource),
            );
        this.bindingSamplers.set(binding, sampler?.descriptor);
        return binding;
    }
    createCommandEncoder() {
        return {
            beginRenderPass: () => {
                this.passes++;
                return {
                    setPipeline: (pipeline: object) => {
                        this.usedPipelines.push(pipeline);
                    },
                    setVertexBuffer() {},
                    setIndexBuffer() {},
                    setBindGroup: (_index: number, binding: object) => {
                        this.usedBindings.push(binding);
                    },
                    setScissorRect: (x: number, y: number, width: number, height: number) => {
                        this.commands.push(`scissor ${x},${y},${width},${height}`);
                    },
                    drawIndexed: (_indices: number, instances: number) => {
                        if (this.failEncode) throw new Error("Injected encode failure");
                        this.commands.push(`draw ${instances}`);
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
