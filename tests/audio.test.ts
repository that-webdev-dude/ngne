import { test } from "node:test";
import assert from "node:assert/strict";
import { Audio } from "../src/audio.js";
class Parameter {
    value = 0;
    events: { type: string; value: number; time: number }[] = [];
    failCancel = false;
    cancelScheduledValues(time: number) {
        if (this.failCancel) throw new Error("cancel failed");
        this.events = this.events.filter((event) => event.time < time);
    }
    setValueAtTime(v: number, time = 0) {
        this.value = v;
        this.events.push({ type: "set", value: v, time });
    }
    linearRampToValueAtTime(value: number, time: number) {
        this.events.push({ type: "linear", value, time });
    }
    exponentialRampToValueAtTime(v: number) {
        this.value = v;
    }
}
class Node {
    gain = new Parameter();
    frequency = new Parameter();
    playbackRate = new Parameter();
    stopped = false;
    startCalls = 0;
    stopCalls = 0;
    disconnectCalls = 0;
    failStop = false;
    failDisconnect = false;
    endOnStart = false;
    onended?: (() => void) | null;
    connect() {}
    disconnect() {
        this.disconnectCalls++;
        if (this.failDisconnect) throw new Error("disconnect failed");
    }
    start() {
        this.startCalls++;
        if (this.endOnStart) this.onended?.();
    }
    stop(time?: number) {
        this.stopCalls++;
        if (this.failStop) throw new Error("stop failed");
        if (time === undefined) {
            this.stopped = true;
            this.onended?.();
        }
    }
}
class Context {
    static latest: Context;
    static resumeError: Error | undefined;
    static closeError: Error | undefined;
    static endOnStart = false;
    currentTime = 0;
    state = "running";
    destination = {};
    nodes: Node[] = [];
    gains: Node[] = [];
    closeCalls = 0;
    constructor() {
        Context.latest = this;
    }
    createGain() {
        const n = new Node();
        this.gains.push(n);
        return n;
    }
    createOscillator() {
        const n = new Node();
        n.endOnStart = Context.endOnStart;
        this.nodes.push(n);
        return n;
    }
    createBufferSource() {
        return this.createOscillator();
    }
    async resume() {
        if (Context.resumeError) throw Context.resumeError;
        this.state = "running";
    }
    async suspend() {
        this.state = "suspended";
    }
    async close() {
        this.closeCalls++;
        if (Context.closeError) throw Context.closeError;
        this.state = "closed";
    }
}
test("audio queues until flush, caps voices, isolates equal scene names, mixes and disposes", async () => {
    const original = globalThis.AudioContext;
    Object.assign(globalThis, { AudioContext: Context });
    try {
        const audio = new Audio();
        await audio.unlock();
        const a = audio.scene("room"),
            b = audio.scene("room"),
            ctx = Context.latest;
        a.play({ frequency: 200, duration: 0.2 });
        b.play({ buffer: {} as AudioBuffer, loop: true });
        assert.equal(ctx.nodes.length, 0);
        audio.flush();
        assert.equal(ctx.nodes.length, 2);
        a.dispose();
        assert.equal(ctx.nodes[0].stopped, true);
        assert.equal(ctx.nodes[1].stopped, false);
        audio.duck(0.5);
        assert.equal(ctx.gains[0].gain.value, 0.15);
        audio.muted = true;
        assert.equal(ctx.gains[0].gain.value, 0);
        audio.muted = false;
        const stale = audio.scene("room");
        stale.play({ buffer: {} as AudioBuffer, loop: true });
        stale.dispose();
        for (let i = 0; i < 100; i++) b.play({ frequency: 100, duration: 1 });
        audio.flush();
        assert.equal(ctx.nodes.filter((n) => !n.stopped).length, 32);
        await audio.suspend();
        assert.equal(ctx.state, "suspended");
        await audio.resume();
        assert.equal(ctx.state, "running");
        await audio.dispose();
        assert.equal(ctx.state, "closed");
        assert.ok(ctx.nodes.every((n) => n.stopped));
    } finally {
        Object.assign(globalThis, { AudioContext: original });
    }
});

test("audio drops pending requests beyond its fixed limit", async () => {
    const original = globalThis.AudioContext;
    Object.assign(globalThis, { AudioContext: Context });
    Context.endOnStart = true;
    try {
        const audio = new Audio();
        await audio.unlock();
        const scope = audio.scene("room");
        for (let i = 0; i < 200; i++) scope.play({ buffer: {} as AudioBuffer });
        audio.flush();
        assert.equal(Context.latest.nodes.length, 128);
        scope.dispose();
        await audio.dispose();
    } finally {
        Context.endOnStart = false;
        Object.assign(globalThis, { AudioContext: original });
    }
});

test("scope cleanup is best effort, terminal and reports every failure", async () => {
    const original = globalThis.AudioContext;
    Object.assign(globalThis, { AudioContext: Context });
    try {
        const audio = new Audio();
        await audio.unlock();
        const scope = audio.scene("room");
        scope.play({ buffer: {} as AudioBuffer, loop: true });
        audio.flush();
        const context = Context.latest;
        const source = context.nodes[0];
        const gain = context.gains[1];
        const bus = context.gains[2];
        source.failStop = source.failDisconnect = true;
        gain.failDisconnect = bus.failDisconnect = true;
        assert.throws(
            () => scope.dispose(),
            (error) => error instanceof AggregateError && error.errors.length === 4,
        );
        assert.equal(source.stopCalls, 1);
        assert.equal(source.disconnectCalls, 1);
        assert.equal(gain.disconnectCalls, 1);
        assert.equal(bus.disconnectCalls, 1);
        const created = context.nodes.length;
        scope.play({ frequency: 200, duration: 1 });
        audio.flush();
        assert.equal(context.nodes.length, created);
        await audio.dispose();
    } finally {
        Object.assign(globalThis, { AudioContext: original });
    }
});

test("unlock and close failures stay observable without reviving disposed audio", async () => {
    const original = globalThis.AudioContext;
    Object.assign(globalThis, { AudioContext: Context });
    Context.resumeError = new Error("unlock denied");
    try {
        const audio = new Audio();
        const scope = audio.scene("room");
        await assert.rejects(audio.unlock(), /unlock denied/);
        Context.latest.gains[0].failDisconnect = true;
        Context.closeError = new Error("close failed");
        await assert.rejects(
            audio.dispose(),
            (error) => error instanceof AggregateError && error.errors.length === 2,
        );
        assert.equal(Context.latest.closeCalls, 1);
        scope.play({ frequency: 200, duration: 1 });
        await assert.rejects(audio.unlock(), /Audio is disposed/);
        assert.throws(() => audio.scene("late"), /Audio is disposed/);
    } finally {
        Context.resumeError = Context.closeError = undefined;
        Object.assign(globalThis, { AudioContext: original });
    }
});

test("muted loops start at flush, retain their sources and mix, and drop transients", async () => {
    const original = globalThis.AudioContext;
    Object.assign(globalThis, { AudioContext: Context });
    try {
        const audio = new Audio();
        await audio.unlock();
        const existing = audio.scene("room"),
            silent = audio.scene("room"),
            cancelled = audio.scene("room");
        const ctx = Context.latest,
            buffer = {} as AudioBuffer;
        existing.play({ buffer, loop: true });
        audio.flush();
        audio.duck(0.5);
        audio.muted = true;
        silent.volume(0.4);
        silent.play({ buffer, loop: true });
        silent.play({ buffer });
        silent.play({ frequency: 440, duration: 0.1 });
        cancelled.play({ buffer, loop: true });
        cancelled.dispose();
        assert.equal(ctx.nodes.length, 1, "requests wait for flush");
        audio.flush();
        assert.equal(ctx.nodes.length, 2, "only the new live loop starts while muted");
        assert.equal(ctx.gains[0].gain.value, 0);
        assert.equal(ctx.gains[4].gain.value, 0.4, "silent loop retains its scope volume");
        const sources = [...ctx.nodes];
        for (let i = 0; i < 3; i++) {
            audio.muted = false;
            audio.flush();
            assert.equal(ctx.gains[0].gain.value, 0.15);
            audio.muted = true;
        }
        assert.deepEqual(ctx.nodes, sources);
        assert.ok(sources.every((source) => source.startCalls === 1 && !source.stopped));
        silent.dispose();
        assert.equal(sources[1].stopped, true);
        assert.equal(sources[0].stopped, false, "equal names remain isolated");
        silent.play({ buffer, loop: true });
        audio.muted = false;
        audio.duck(1);
        audio.flush();
        assert.equal(ctx.nodes.length, 2, "unmute cannot revive disposed work or dropped effects");
        assert.equal(ctx.gains[0].gain.value, 0.3);
        await audio.dispose();
        assert.ok(sources.every((source) => source.stopped));
    } finally {
        Object.assign(globalThis, { AudioContext: original });
    }
});

test("silent loops obey voice and pending limits without replaying excess work", async () => {
    const original = globalThis.AudioContext;
    Object.assign(globalThis, { AudioContext: Context });
    try {
        for (const endOnStart of [false, true]) {
            Context.endOnStart = endOnStart;
            const audio = new Audio();
            await audio.unlock();
            audio.muted = true;
            const scope = audio.scene("bounded");
            for (let i = 0; i < 200; i++) scope.play({ buffer: {} as AudioBuffer, loop: true });
            audio.flush();
            const ctx = Context.latest;
            assert.equal(ctx.nodes.length, endOnStart ? 128 : 32);
            scope.dispose();
            audio.muted = false;
            audio.flush();
            assert.equal(ctx.nodes.length, endOnStart ? 128 : 32);
            await audio.dispose();
        }
    } finally {
        Context.endOnStart = false;
        Object.assign(globalThis, { AudioContext: original });
    }
});

test("mute does not retain loops flushed before unlock or during suspension", async () => {
    const original = globalThis.AudioContext;
    Object.assign(globalThis, { AudioContext: Context });
    try {
        const audio = new Audio(),
            scope = audio.scene("room");
        const loop = { buffer: {} as AudioBuffer, loop: true };
        audio.muted = true;
        scope.play(loop);
        audio.flush();
        await audio.unlock();
        audio.flush();
        assert.equal(Context.latest.nodes.length, 0);
        scope.play(loop);
        await audio.suspend();
        await audio.resume();
        audio.flush();
        assert.equal(Context.latest.nodes.length, 0, "suspension clears pending requests");
        await audio.suspend();
        scope.play(loop);
        audio.flush();
        await audio.resume();
        audio.muted = false;
        audio.flush();
        assert.equal(Context.latest.nodes.length, 0, "suspended requests do not replay");
        await audio.dispose();
    } finally {
        Object.assign(globalThis, { AudioContext: original });
    }
});

test("scope fades replace native automation continuously without restarting voices", async () => {
    const original = globalThis.AudioContext;
    Object.assign(globalThis, { AudioContext: Context });
    try {
        const audio = new Audio();
        await audio.unlock();
        const a = audio.scene("room"),
            b = audio.scene("room"),
            ctx = Context.latest;
        a.volume(0);
        a.play({ buffer: {} as AudioBuffer, loop: true });
        b.play({ buffer: {} as AudioBuffer, loop: true });
        audio.flush();
        const gain = ctx.gains[2].gain,
            other = ctx.gains[4].gain;
        const events = (from: number, target: number, start: number, end: number) => [
            { type: "set", value: from, time: start },
            { type: "linear", value: target, time: end },
        ];
        a.fadeTo(1, 4);
        assert.deepEqual(gain.events, events(0, 1, 0, 4));
        ctx.currentTime = 1;
        a.fadeTo(0, 2);
        assert.deepEqual(gain.events, events(0.25, 0, 1, 3));
        ctx.currentTime = 2;
        a.fadeTo(1, 1);
        assert.deepEqual(gain.events, events(0.125, 1, 2, 3));
        ctx.currentTime = 4;
        a.fadeTo(-2, 2);
        assert.deepEqual(gain.events, events(1, 0, 4, 6), "completed fade holds target");
        ctx.currentTime = 5;
        a.volume(0.3);
        assert.deepEqual(gain.events, [{ type: "set", value: 0.3, time: 5 }]);
        a.fadeTo(3, 0);
        assert.deepEqual(gain.events, [{ type: "set", value: 1, time: 5 }]);
        a.fadeTo(0, 1);
        a.fadeTo(0.5, Number.MIN_VALUE);
        assert.deepEqual(gain.events, [{ type: "set", value: 0.5, time: 5 }]);
        for (let i = 0; i < 200; i++) a.fadeTo(i % 2, 1);
        assert.equal(gain.events.length, 2, "retargeting does not accumulate automation");
        assert.deepEqual(other.events, [], "equal scope names stay isolated");
        assert.equal(other.value, 1);
        assert.equal(ctx.nodes.length, 2);
        assert.ok(ctx.nodes.every((node) => node.startCalls === 1 && !node.stopped));
        a.dispose();
        assert.deepEqual(gain.events, []);
        assert.equal(ctx.nodes[0].stopCalls, 1);
        assert.equal(ctx.nodes[1].stopCalls, 0);
        a.volume(NaN);
        a.fadeTo(NaN, -1);
        a.play({ buffer: {} as AudioBuffer, loop: true });
        const fresh = audio.scene("room");
        fresh.play({ buffer: {} as AudioBuffer, loop: true });
        audio.flush();
        assert.equal(ctx.nodes.length, 3);
        assert.equal(ctx.gains[6].gain.value, 1, "new scopes inherit no disposed envelope");
        b.fadeTo(0, 10);
        await audio.dispose();
        assert.deepEqual(other.events, []);
        b.fadeTo(1, 1);
        b.volume(1);
        audio.flush();
        assert.equal(ctx.nodes.length, 3);
        await assert.rejects(audio.unlock(), /disposed/);
    } finally {
        Object.assign(globalThis, { AudioContext: original });
    }
});

test("fades validate before mutation, remember pre-device targets and follow the audio clock", async () => {
    const original = globalThis.AudioContext;
    Object.assign(globalThis, { AudioContext: Context });
    try {
        const previous = Context.latest;
        const audio = new Audio(),
            scope = audio.scene("room");
        scope.fadeTo(0.4, 5);
        assert.equal(Context.latest, previous, "fade does not create or unlock a device");
        for (const invalid of [NaN, Infinity, -Infinity]) {
            assert.throws(() => scope.volume(invalid), /Invalid volume/);
            assert.throws(() => scope.fadeTo(invalid, 1), /Invalid volume/);
        }
        for (const invalid of [NaN, Infinity, -Infinity, -1, undefined])
            assert.throws(() => scope.fadeTo(1, invalid as number), /Invalid fade duration/);
        await audio.unlock();
        const ctx = Context.latest;
        assert.equal(ctx.gains.length, 1, "no deferred fade or bus on unlock");
        ctx.currentTime = 10;
        scope.fadeTo(0, 4);
        const gain = ctx.gains[1].gain;
        assert.deepEqual(gain.events, [
            { type: "set", value: 0.4, time: 10 },
            { type: "linear", value: 0, time: 14 },
        ]);
        ctx.currentTime = 11;
        scope.play({ buffer: {} as AudioBuffer, loop: true });
        audio.flush();
        assert.equal(ctx.gains.length, 3, "first playback reuses the fading bus");
        await audio.suspend();
        const suspended = structuredClone(gain.events);
        await Promise.resolve();
        assert.deepEqual(gain.events, suspended);
        scope.fadeTo(0.9, 2);
        assert.ok(Math.abs(gain.events[0].value - 0.3) < 1e-12);
        assert.equal(gain.events[0].time, 11, "suspended retarget uses frozen audio time");
        audio.muted = true;
        await audio.resume();
        ctx.currentTime = 12;
        scope.fadeTo(0, 2);
        assert.ok(Math.abs(gain.events[0].value - 0.6) < 1e-12, "mute did not pause fade");
        const scheduled = structuredClone(gain.events);
        audio.muted = false;
        audio.duck(0.5);
        assert.deepEqual(gain.events, scheduled);
        assert.throws(() => scope.fadeTo(0.8, -1), /Invalid fade duration/);
        assert.deepEqual(gain.events, scheduled, "invalid calls preserve active fade");
        assert.equal(ctx.nodes.length, 1);
        assert.equal(ctx.nodes[0].startCalls, 1);
        gain.failCancel = true;
        await assert.rejects(audio.dispose(), /Audio disposal failed/);
        assert.equal(
            ctx.gains[1].disconnectCalls,
            1,
            "cancellation failure cannot skip disconnect",
        );
        assert.equal(ctx.state, "closed");
        scope.fadeTo(NaN, NaN);
        assert.equal(ctx.nodes[0].stopCalls, 1);
    } finally {
        Object.assign(globalThis, { AudioContext: original });
    }
});
