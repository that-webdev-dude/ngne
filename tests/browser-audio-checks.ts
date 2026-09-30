import { Assets, Audio, audioAsset } from "../src/index.js";

const LOOP_URL =
    "data:audio/wav;base64,UklGRmQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YUAAAACAhYuQlJeam5ybmpeUkIuFgHt1cGxpZmVkZWZpbHB1e4CFi5CUl5qbnJual5SQi4WAe3VwbGlmZWRlZmlscHV7";

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
