import type { Asset } from "./assets.js";
export interface Sound {
  frequency: number;
  endFrequency?: number;
  duration: number;
  volume?: number;
  type?: OscillatorType;
}
export interface Clip {
  buffer: AudioBuffer;
  volume?: number;
  loop?: boolean;
  rate?: number;
}
/** Decode independently of a playback device; scenes lease the resulting buffer. */
export function audioAsset(id: string, url: string): Asset<AudioBuffer> {
  return {
    id,
    async load(signal) {
      const response = await fetch(url, { signal });
      if (!response.ok)
        throw new Error(`Audio load failed: ${response.status}`);
      const bytes = await response.arrayBuffer();
      const decoder = new OfflineAudioContext(1, 1, 44100);
      return decoder.decodeAudioData(bytes);
    },
  };
}
/** Bounded Web Audio voices. Playback requests flush only after committed ticks. */
export class Audio {
  private context?: AudioContext;
  private master?: GainNode;
  private voices = new Map<
    OscillatorNode | AudioBufferSourceNode,
    { gain: GainNode; scope: string }
  >();
  private queue: { scope: string; sound: Sound | Clip }[] = [];
  private volumes = new Map<string, number>();
  private buses = new Map<string, GainNode>();
  private ducking = 1;
  private mutedValue = false;
  private nextScope = 0;
  private disposed = false;
  readonly maxVoices = 32;
  get muted() {
    return this.mutedValue;
  }
  set muted(value: boolean) {
    this.mutedValue = value;
    this.mix();
  }
  private mix() {
    if (this.master)
      this.master.gain.value = this.mutedValue ? 0 : 0.3 * this.ducking;
  }
  async unlock() {
    if (this.disposed) throw new Error("Audio is disposed");
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.mix();
      this.master.connect(this.context.destination);
    }
    await this.context.resume();
  }
  scene(id: string) {
    if (this.disposed) throw new Error("Audio is disposed");
    id = `${id}:${this.nextScope++}`;
    let disposed = false;
    return {
      play: (sound: Sound | Clip) => {
        if (!disposed && !this.disposed && this.queue.length < 128)
          this.queue.push({ scope: id, sound });
      },
      volume: (volume: number) => {
        if (disposed || this.disposed) return;
        if (!Number.isFinite(volume)) throw new Error("Invalid volume");
        const level = Math.max(0, Math.min(1, volume));
        this.volumes.set(id, level);
        const bus = this.buses.get(id);
        if (bus) bus.gain.value = level;
      },
      dispose: () => {
        disposed = true;
        this.release(id);
      },
    };
  }
  duck(level = 0.35) {
    if (!Number.isFinite(level)) throw new Error("Invalid ducking level");
    this.ducking = Math.max(0, Math.min(1, level));
    this.mix();
  }
  private bus(scope: string) {
    let bus = this.buses.get(scope);
    if (!bus) {
      bus = this.context!.createGain();
      bus.gain.value = this.volumes.get(scope) ?? 1;
      bus.connect(this.master!);
      this.buses.set(scope, bus);
    }
    return bus;
  }
  flush() {
    const queue = this.queue.splice(0);
    const ctx = this.context;
    if (!ctx || ctx.state !== "running" || this.muted) return;
    for (const { scope, sound } of queue) {
      if (this.voices.size >= this.maxVoices) break;
      if ("buffer" in sound) {
        if (
          !(
            Number.isFinite(sound.rate ?? 1) &&
            (sound.rate ?? 1) > 0 &&
            Number.isFinite(sound.volume ?? 0.2)
          )
        )
          continue;
        const source = ctx.createBufferSource(),
          gain = ctx.createGain();
        source.buffer = sound.buffer;
        source.loop = !!sound.loop;
        source.playbackRate.value = sound.rate ?? 1;
        gain.gain.value = Math.max(0, sound.volume ?? 0.2);
        source.connect(gain);
        gain.connect(this.bus(scope));
        this.voices.set(source, { gain, scope });
        source.onended = () => {
          source.disconnect();
          gain.disconnect();
          this.voices.delete(source);
        };
        source.start();
        continue;
      }
      if (
        !(
          sound.frequency > 0 &&
          Number.isFinite(sound.frequency) &&
          sound.duration > 0 &&
          Number.isFinite(sound.duration) &&
          Number.isFinite(sound.volume ?? 0.2)
        )
      )
        continue;
      const oscillator = ctx.createOscillator(),
        gain = ctx.createGain();
      oscillator.type = sound.type ?? "square";
      oscillator.frequency.setValueAtTime(sound.frequency, ctx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(1, sound.endFrequency ?? sound.frequency),
        ctx.currentTime + sound.duration,
      );
      gain.gain.setValueAtTime(
        Math.max(0.0001, sound.volume ?? 0.2),
        ctx.currentTime,
      );
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        ctx.currentTime + sound.duration,
      );
      oscillator.connect(gain);
      gain.connect(this.bus(scope));
      this.voices.set(oscillator, { gain, scope });
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
        this.voices.delete(oscillator);
      };
      oscillator.start();
      oscillator.stop(ctx.currentTime + sound.duration);
    }
  }
  private release(scope: string) {
    this.queue = this.queue.filter((s) => s.scope !== scope);
    for (const [o, v] of this.voices)
      if (v.scope === scope) {
        o.stop();
        o.disconnect();
        v.gain.disconnect();
        this.voices.delete(o);
      }
    this.buses.get(scope)?.disconnect();
    this.buses.delete(scope);
    this.volumes.delete(scope);
  }
  suspend() {
    this.queue.length = 0;
    return this.context?.suspend();
  }
  resume() {
    return this.context?.resume();
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.queue.length = 0;
    const errors: unknown[] = [];
    for (const [o, v] of this.voices)
      for (const action of [
        () => o.stop(),
        () => o.disconnect(),
        () => v.gain.disconnect(),
      ]) {
        try {
          action();
        } catch (e) {
          errors.push(e);
        }
      }
    this.voices.clear();
    this.volumes.clear();
    for (const b of this.buses.values()) {
      try {
        b.disconnect();
      } catch (e) {
        errors.push(e);
      }
    }
    this.buses.clear();
    try {
      await this.context?.close();
    } catch (e) {
      errors.push(e);
    }
    this.context = undefined;
    this.master = undefined;
    if (errors.length)
      throw new AggregateError(errors, "Audio disposal failed");
  }
}
