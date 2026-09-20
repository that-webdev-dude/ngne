// Installed before the production entry point. Counters never retain resource objects.
(() => {
    const state = (window.__contentMeasurement = {
        voices: 0,
        contexts: 0,
        bitmaps: 0,
        textures: 0,
        decodes: 0,
        closed: 0,
        visibility: [],
        gpu: [],
        hold: false,
        waiting: false,
    });
    document.addEventListener("visibilitychange", () =>
        state.visibility.push(document.visibilityState),
    );
    const decode = window.createImageBitmap;
    window.createImageBitmap = async (...args) => {
        const bitmap = await decode(...args);
        state.bitmaps++;
        state.decodes++;
        const close = bitmap.close.bind(bitmap);
        let closed = false;
        bitmap.close = () => {
            if (!closed) {
                state.bitmaps--;
                state.closed++;
                closed = true;
            }
            return close();
        };
        if (state.hold) {
            state.hold = false;
            state.waiting = true;
            await new Promise((resolve) => {
                state.release = () => {
                    state.waiting = false;
                    state.release = undefined;
                    resolve();
                };
            });
        }
        return bitmap;
    };
    const source = AudioContext.prototype.createBufferSource;
    const contexts = new WeakSet();
    AudioContext.prototype.createBufferSource = function () {
        if (!contexts.has(this)) {
            contexts.add(this);
            state.contexts++;
            const close = this.close.bind(this);
            this.close = async () => {
                const result = await close();
                if (contexts.delete(this)) state.contexts--;
                return result;
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
            const result = start(...args);
            active = true;
            state.voices++;
            return result;
        };
        voice.stop = (...args) => {
            const result = stop(...args);
            finish();
            return result;
        };
        voice.addEventListener("ended", finish, { once: true });
        return voice;
    };
    const request = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (...args) {
        const device = await request.apply(this, args),
            info = device.adapterInfo;
        state.gpu.push({
            vendor: info.vendor,
            architecture: info.architecture,
            device: info.device,
            description: info.description,
            isFallbackAdapter: info.isFallbackAdapter,
        });
        const create = device.createTexture.bind(device);
        device.createTexture = (...args) => {
            const texture = create(...args),
                destroy = texture.destroy.bind(texture);
            state.textures++;
            let destroyed = false;
            texture.destroy = () => {
                if (!destroyed) {
                    state.textures--;
                    destroyed = true;
                }
                return destroy();
            };
            return texture;
        };
        return device;
    };
    state.sample = () => {
        document.querySelector("#inspect").click();
        return {
            diagnostics: JSON.parse(document.querySelector("#diagnostics").textContent),
            voices: state.voices,
            contexts: state.contexts,
            bitmaps: state.bitmaps,
            textures: state.textures,
            decodes: state.decodes,
            closed: state.closed,
            visibility: document.visibilityState,
            room: document.querySelector("#room").textContent,
            error: document.querySelector("[role=alert]").textContent,
        };
    };
    state.travel = () =>
        new Promise((resolve, reject) => {
            const label = document.querySelector("#room"),
                before = label.textContent,
                start = performance.now();
            const timer = setTimeout(() => {
                observer.disconnect();
                reject(Error("Transition timeout"));
            }, 10000);
            const observer = new MutationObserver(() => {
                if (label.textContent === before) return;
                observer.disconnect();
                clearTimeout(timer);
                resolve({ ms: performance.now() - start, from: before, to: label.textContent });
            });
            observer.observe(label, { childList: true });
            document.querySelector("#travel").click();
        });
})();
