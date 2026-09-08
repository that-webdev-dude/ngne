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
  onended?: () => void;
  connect() {}
  disconnect() {}
  start() {}
  stop(time?: number) {
    if (time === undefined) {
      this.stopped = true;
      this.onended?.();
    }
  }
}
class Context {
  static latest: Context;
  currentTime = 0;
  state = "running";
  destination = {};
  nodes: Node[] = [];
  gains: Node[] = [];
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
    this.nodes.push(n);
    return n;
  }
  createBufferSource() {
    return this.createOscillator();
  }
  async resume() {
    this.state = "running";
  }
  async suspend() {
    this.state = "suspended";
  }
  async close() {
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
