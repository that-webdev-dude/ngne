import { Assets, Audio, audioAsset } from "../src/index.js";

const LOOP_URL =
    "data:audio/wav;base64,UklGRmQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YUAAAACAhYuQlJeam5ybmpeUkIuFgHt1cGxpZmVkZWZpbHB1e4CFi5CUl5qbnJual5SQi4WAe3VwbGlmZWRlZmlscHV7";

export async function checkBrowserAudio(
    check: (value: unknown, message: string) => void,
): Promise<void> {
    const audio = new Audio();
    const assets = new Assets();
    await audio.unlock();
    try {
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
        a.volume(0.2);
        b.volume(0.4);
        a.play({ buffer: first.value, loop: true, volume: 0.03 });
        b.play({ frequency: 330, duration: 0.03, volume: 0.01 });
        audio.flush();
        a.dispose();
        a.play({ buffer: first.value, loop: true });
        audio.flush();
        check(true, "equal-named scopes play and dispose independently");

        audio.duck(0.25);
        audio.muted = true;
        audio.muted = false;
        audio.duck(1);
        check(true, "mute and ducking update the unlocked audio graph");

        await audio.suspend();
        await audio.resume();
        b.dispose();
        first.release();
        second.release();
        check(true, "audio suspends and resumes with scene scopes released");
    } finally {
        assets.dispose();
        await audio.dispose();
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
