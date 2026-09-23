/** Fixture-owned platform instrumentation; no engine internals or package subpaths. */
export function observe() {
    const devices: GPUDevice[] = [];
    const contexts: AudioContext[] = [];
    const voices: { source: AudioBufferSourceNode; stops: number }[] = [];
    const outputs: AnalyserNode[] = [];
    let submissions = 0;
    let failDevice = false;
    let held: { entered(): void; wait: Promise<void> } | undefined;
    const request = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (descriptor) {
        if (held) {
            const gate = held;
            held = undefined;
            gate.entered();
            await gate.wait;
        }
        if (failDevice) throw Error("Controlled replacement failure");
        const device = await request.call(this, descriptor);
        devices.push(device);
        const submit = device.queue.submit.bind(device.queue);
        device.queue.submit = (buffers) => {
            submissions++;
            submit(buffers);
        };
        return device;
    };
    const create = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
        if (!contexts.includes(this)) contexts.push(this);
        const source = create.call(this),
            voice = { source, stops: 0 };
        const stop = source.stop.bind(source);
        source.stop = (when) => {
            voice.stops++;
            stop(when);
        };
        voices.push(voice);
        return source;
    };
    // Observe the master output via the concrete GainNode overload to preserve native connect semantics.
    const connect = GainNode.prototype.connect;
    GainNode.prototype.connect = function (
        destination: AudioNode | AudioParam,
        output?: number,
        input?: number,
    ): AudioNode {
        if (destination instanceof AudioParam) {
            connect.call(this, destination, output);
            return this;
        }
        const result = Reflect.apply(connect, this, [
            destination,
            output ?? 0,
            input ?? 0,
        ]) as AudioNode;
        if (destination instanceof AudioDestinationNode) {
            const analyser = this.context.createAnalyser();
            analyser.fftSize = 2048;
            Reflect.apply(connect, this, [analyser]);
            outputs.push(analyser);
        }
        return result;
    };
    return {
        devices,
        contexts,
        voices,
        get submissions() {
            return submissions;
        },
        failReplacement() {
            failDevice = true;
        },
        holdNextDevice() {
            let entered!: () => void, release!: () => void;
            const waiting = new Promise<void>((resolve) => {
                entered = resolve;
            });
            const wait = new Promise<void>((resolve) => {
                release = resolve;
            });
            held = { entered, wait };
            return { waiting, release };
        },
        rms() {
            const output = outputs.at(-1);
            if (!output) return 0;
            const values = new Float32Array(output.fftSize);
            output.getFloatTimeDomainData(values);
            return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
        },
        restore() {
            GPUAdapter.prototype.requestDevice = request;
            AudioContext.prototype.createBufferSource = create;
            GainNode.prototype.connect = connect;
        },
    };
}
