/** Platform counters do not retain decoded images, textures or voices. */
export function observe() {
    const visibility: string[] = [document.visibilityState];
    const visibilityChanged = () => visibility.push(document.visibilityState);
    document.addEventListener("visibilitychange", visibilityChanged);
    const state = {
        bitmaps: 0,
        textures: 0,
        voices: 0,
        contexts: 0,
        decodes: 0,
        closed: 0,
        submissions: 0,
        gpu: [] as {
            vendor: string;
            architecture: string;
            device: string;
            description: string;
            isFallbackAdapter: boolean;
        }[],
    };
    const decode = window.createImageBitmap;
    function measured(image: ImageBitmapSource, options?: ImageBitmapOptions): Promise<ImageBitmap>;
    function measured(
        image: ImageBitmapSource,
        sx: number,
        sy: number,
        sw: number,
        sh: number,
        options?: ImageBitmapOptions,
    ): Promise<ImageBitmap>;
    async function measured(
        image: ImageBitmapSource,
        optionsOrX?: ImageBitmapOptions | number,
        sy?: number,
        sw?: number,
        sh?: number,
        options?: ImageBitmapOptions,
    ): Promise<ImageBitmap> {
        let bitmap: ImageBitmap;
        if (typeof optionsOrX === "number") {
            if (sy === undefined || sw === undefined || sh === undefined)
                throw Error("Missing bitmap crop dimensions");
            bitmap = await decode(image, optionsOrX, sy, sw, sh, options);
        } else bitmap = await decode(image, optionsOrX);
        state.bitmaps++;
        state.decodes++;
        const close = bitmap.close.bind(bitmap);
        let closed = false;
        bitmap.close = () => {
            if (!closed) {
                closed = true;
                state.bitmaps--;
                state.closed++;
            }
            close();
        };
        return bitmap;
    }
    window.createImageBitmap = measured;
    const source = AudioContext.prototype.createBufferSource;
    const contexts = new WeakSet<AudioContext>();
    AudioContext.prototype.createBufferSource = function () {
        if (!contexts.has(this)) {
            contexts.add(this);
            state.contexts++;
            const close = this.close.bind(this);
            this.close = async () => {
                await close();
                if (contexts.delete(this)) state.contexts--;
            };
        }
        const voice = source.call(this),
            start = voice.start.bind(voice),
            stop = voice.stop.bind(voice);
        let active = false;
        const finish = () => {
            if (active) {
                active = false;
                state.voices--;
            }
        };
        voice.start = (...args) => {
            start(...args);
            active = true;
            state.voices++;
        };
        voice.stop = (...args) => {
            stop(...args);
            finish();
        };
        voice.addEventListener("ended", finish, { once: true });
        return voice;
    };
    const request = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (descriptor) {
        const device = await request.call(this, descriptor),
            info = device.adapterInfo;
        state.gpu.push({
            vendor: info.vendor,
            architecture: info.architecture,
            device: info.device,
            description: info.description,
            isFallbackAdapter: info.isFallbackAdapter,
        });
        const create = device.createTexture.bind(device),
            submit = device.queue.submit.bind(device.queue);
        device.queue.submit = (buffers) => {
            state.submissions++;
            submit(buffers);
        };
        device.createTexture = (descriptor) => {
            const texture = create(descriptor),
                destroy = texture.destroy.bind(texture);
            let destroyed = false;
            state.textures++;
            texture.destroy = () => {
                if (!destroyed) {
                    destroyed = true;
                    state.textures--;
                }
                destroy();
            };
            return texture;
        };
        return device;
    };
    return {
        state,
        visibility,
        restore() {
            document.removeEventListener("visibilitychange", visibilityChanged);
            window.createImageBitmap = decode;
            AudioContext.prototype.createBufferSource = source;
            GPUAdapter.prototype.requestDevice = request;
        },
    };
}
