import { Assets, Audio, audioAsset } from "../src/index.js";

const LOOP_URL =
    "data:audio/wav;base64,UklGRmQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YUAAAACAhYuQlJeam5ybmpeUkIuFgHt1cGxpZmVkZWZpbHB1e4CFi5CUl5qbnJual5SQi4WAe3VwbGlmZWRlZmlscHV7";

/** Human listening is separate from automated envelope evidence. Invoke from a gesture. */
export async function listenToScopeFades(): Promise<void> {
    const audio = new Audio(),
        scope = audio.scene("listening");
    try {
        await audio.unlock();
        const buffer = new AudioBuffer({ length: 44100, numberOfChannels: 1, sampleRate: 44100 });
        const samples = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++)
            samples[i] = Math.sin((2 * Math.PI * 220 * i) / 44100);
        scope.volume(0);
        scope.play({ buffer, loop: true, volume: 0.3 });
        audio.flush();
        scope.fadeTo(1, 2);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        scope.fadeTo(0, 1);
        await new Promise((resolve) => setTimeout(resolve, 1250));
        scope.fadeTo(1, 1);
        await new Promise((resolve) => setTimeout(resolve, 1250));
        scope.fadeTo(0, 1);
        await new Promise((resolve) => setTimeout(resolve, 1250));
    } finally {
        scope.dispose();
        await audio.dispose();
    }
}

export async function checkBrowserAudio(
    check: (value: unknown, message: string) => void,
): Promise<void> {
    const observation = observeAudio();
    const audio = new Audio();
    const assets = new Assets();
    try {
        await audio.unlock();
        const definition = audioAsset("validation-loop", LOOP_URL);
        const first = await assets.acquire(definition);
        const second = await assets.acquire(definition);
        check(
            first.value instanceof AudioBuffer &&
                first.value.length > 0 &&
                first.value === second.value,
            "audio asset decodes once and shares its leased buffer",
        );

        const a = audio.scene("room");
        const b = audio.scene("room");
        a.volume(0.5);
        a.play({ buffer: first.value, loop: true, volume: 1 });
        audio.flush();
        await observation.measure(check, false, "existing loop output");
        audio.duck(0.5);
        audio.muted = true;
        b.volume(0.5);
        b.play({ buffer: first.value, loop: true, volume: 1 });
        b.play({ buffer: first.value, volume: 1 });
        b.play({ frequency: 330, duration: 1, volume: 1 });
        audio.flush();
        check(observation.voices.length === 2, "muted flush starts only the new looping clip");
        const sources = observation.voices.map((voice) => voice.source);
        await observation.measure(check, true, "existing and newly started loops stay muted");
        a.dispose();
        check(
            observation.voices[0].stops === 1 && observation.voices[1].stops === 0,
            "equal-named scopes dispose independently",
        );
        for (let i = 0; i < 2; i++) {
            audio.muted = false;
            audio.flush();
            await observation.measure(check, false, `unmute ${i + 1} restores the silent loop`);
            audio.muted = true;
            await observation.measure(check, true, `mute ${i + 1} clears output`);
        }
        check(
            observation.voices.length === 2 &&
                observation.voices.every(
                    (voice, i) => voice.source === sources[i] && voice.starts === 1,
                ),
            "mute cycles preserve source identity and single starts without replaying transients",
        );
        b.dispose();
        b.play({ buffer: first.value, loop: true });
        audio.muted = false;
        audio.duck(1);
        audio.flush();
        await observation.measure(check, true, "disposed scopes stay silent after unmute");
        check(
            observation.voices.every((voice) => voice.stops === 1),
            "both loop sources stopped once",
        );
        await audio.suspend();
        await audio.resume();
        first.release();
        second.release();
        check(true, "audio suspends and resumes with scene scopes released");

        // A constant signal makes every output sample an independent gain measurement.
        const buffer = observation
            .context()
            .createBuffer(1, 2048, observation.context().sampleRate);
        buffer.getChannelData(0).fill(0.25);
        const fading = audio.scene("envelope");
        fading.play({ buffer, loop: true, volume: 1 });
        audio.flush();
        const source = observation.voices.at(-1)!.source;
        await observation.measure(check, false, "constant envelope probe is playing");
        await observation.envelope(check, () => fading.fadeTo(0, 1), 1, 0);
        await observation.envelope(check, () => fading.fadeTo(1, 1), 0, 1);
        const rejectSteps = (value: unknown, message: string) => {
            if (!value) throw Error(message);
        };
        await checkRejects(
            observation.envelope(rejectSteps, () => fading.volume(0), 1, 0),
            "envelope regression must reject an immediate change",
        );
        let timer: ReturnType<typeof setInterval> | undefined;
        try {
            await checkRejects(
                observation.envelope(
                    rejectSteps,
                    () => {
                        const start = observation.context().currentTime;
                        timer = setInterval(
                            () => fading.volume(observation.context().currentTime - start),
                            1000 / 60,
                        );
                    },
                    0,
                    1,
                ),
                "envelope regression must reject 60 Hz volume steps",
            );
        } finally {
            clearInterval(timer);
        }
        check(true, "envelope regression rejects immediate changes and 60 Hz volume steps");
        check(
            observation.voices.at(-1)!.source === source && observation.voices.at(-1)!.starts === 1,
            "audio-clock fades preserve the playing source without another flush",
        );
        fading.fadeTo(0, 10);
        fading.dispose();
        fading.fadeTo(1, 0);
        await observation.measure(check, true, "disposed fade cannot revive audio");
    } finally {
        assets.dispose();
        try {
            await audio.dispose();
        } finally {
            observation.restore();
        }
    }
    await checkRejects(audio.unlock(), "disposed audio cannot unlock again");
    check(true, "terminal audio disposal prevents later unlock");
}

async function checkRejects(promise: Promise<unknown>, message: string): Promise<void> {
    try {
        await promise;
    } catch {
        return;
    }
    throw new Error(message);
}

/** Observe native source calls and post-master output without accessing engine internals. */
function observeAudio() {
    const voices: { source: AudioBufferSourceNode; starts: number; stops: number }[] = [];
    let output: AnalyserNode | undefined;
    const create = AudioContext.prototype.createBufferSource;
    const connect = GainNode.prototype.connect;
    AudioContext.prototype.createBufferSource = function () {
        const source = create.call(this),
            voice = { source, starts: 0, stops: 0 };
        const start = source.start.bind(source),
            stop = source.stop.bind(source);
        source.start = (...args) => {
            voice.starts++;
            start(...args);
        };
        source.stop = (...args) => {
            voice.stops++;
            stop(...args);
        };
        voices.push(voice);
        return source;
    };
    GainNode.prototype.connect = function (
        destination: AudioNode | AudioParam,
        channel?: number,
        input?: number,
    ): AudioNode {
        if (destination instanceof AudioParam) {
            connect.call(this, destination, channel);
            return this;
        }
        const result = Reflect.apply(connect, this, [
            destination,
            channel ?? 0,
            input ?? 0,
        ]) as AudioNode;
        if (destination instanceof AudioDestinationNode) {
            output = this.context.createAnalyser();
            output.fftSize = 2048;
            Reflect.apply(connect, this, [output]);
        }
        return result;
    };
    return {
        voices,
        context() {
            if (!output) throw Error("Audio master output was not observed");
            return output.context;
        },
        async envelope(
            check: (value: unknown, message: string) => void,
            start: () => void,
            from: number,
            target: number,
        ) {
            if (!output) throw Error("Audio master output was not observed");
            const context = output.context;
            const begin = context.currentTime;
            start();
            const data = new Float32Array(output.fftSize);
            const samples: { time: number; gain: number; error: number; slopeError: number }[] = [];
            const slope = (0.075 * (target - from)) / context.sampleRate;
            const deadline = performance.now() + 5000;
            while (context.currentTime < begin + 1.15 && performance.now() < deadline) {
                await new Promise((resolve) => setTimeout(resolve, 25));
                const time = context.currentTime - begin;
                if (time < 0.15 || time > 0.85) continue;
                output.getFloatTimeDomainData(data);
                const gain = data.reduce((sum, value) => sum + value, 0) / data.length / 0.075;
                const expected =
                    from + (target - from) * (time - data.length / (2 * context.sampleRate));
                let slopeError = 0;
                for (let i = 1; i < data.length; i++)
                    slopeError = Math.max(slopeError, Math.abs(data[i] - data[i - 1] - slope));
                samples.push({ time, gain, error: Math.abs(gain - expected), slopeError });
            }
            // Interior samples and per-sample slope reject endpoint jumps and tick-sized steps.
            const tolerance = 0.02;
            const slopeTolerance = Math.abs(slope) * 0.1 + 1e-8;
            check(
                samples.length >= 8 &&
                    samples[0].time < 0.3 &&
                    samples.at(-1)!.time > 0.7 &&
                    samples.every(
                        (sample) =>
                            sample.error <= tolerance && sample.slopeError <= slopeTolerance,
                    ),
                `native linear fade ${from}->${target}: gain tolerance=${tolerance}, slope tolerance=${slopeTolerance}, samples=${JSON.stringify(samples)}`,
            );
            output.getFloatTimeDomainData(data);
            check(
                context.currentTime >= begin + 1.15 &&
                    data.every((value) => Math.abs(value / 0.075 - target) <= 0.00001),
                `native fade reaches and holds ${target} without simulation or render updates`,
            );
        },
        async measure(
            check: (value: unknown, message: string) => void,
            silent: boolean,
            label: string,
        ) {
            if (!output) throw Error("Audio master output was not observed");
            // Clear the complete analyser window and allow render-thread gain changes to settle.
            const after = output.context.currentTime + 0.15;
            const deadline = performance.now() + 5000;
            while (output.context.currentTime < after && performance.now() < deadline)
                await new Promise((resolve) => setTimeout(resolve, 25));
            check(
                output.context.currentTime >= after,
                "audio render clock advances beyond analyser window",
            );
            const values = new Float32Array(output.fftSize);
            output.getFloatTimeDomainData(values);
            const rms = Math.sqrt(
                values.reduce((sum, value) => sum + value * value, 0) / values.length,
            );
            check(silent ? rms < 0.000001 : rms > 0.001, `${label}: RMS=${rms}`);
        },
        restore() {
            AudioContext.prototype.createBufferSource = create;
            GainNode.prototype.connect = connect;
            output?.disconnect();
        },
    };
}
