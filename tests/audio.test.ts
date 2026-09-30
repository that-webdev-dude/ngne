import { test } from "node:test";
import assert from "node:assert/strict";
import { Audio } from "../src/audio.js";
class Parameter {
    value = 0;
    setValueAtTime(v: number) {
        this.value = v;
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
