export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export function seedOf(...parts: (string | number)[]) {
    let h = 2166136261;
    for (const char of JSON.stringify(parts)) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
    return h >>> 0;
}
/** Mulberry32, version 1. State is owned and enumerable by the mounted scene. */
export class Random {
    constructor(public state: number) {
        this.state >>>= 0;
    }
    next() {
        let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    range(min: number, max: number) {
        return min + this.next() * (max - min);
    }
    int(min: number, max: number) {
        return Math.floor(this.range(min, max));
    }
}
export class Cleanup {
    private actions: (() => void)[] = [];
    defer(action: () => void) {
        this.actions.push(action);
    }
    dispose() {
        const errors: unknown[] = [];
        for (const action of this.actions.splice(0).reverse()) {
            try {
                action();
            } catch (e) {
                errors.push(e);
            }
        }
        if (errors.length) throw new AggregateError(errors, "Cleanup failed");
    }
}
export class Camera {
    x = 0;
    y = 0;
    previousX = 0;
    previousY = 0;
    shakeX = 0;
    shakeY = 0;
    pixelSnap = true;
    beginTick() {
        this.previousX = this.x;
        this.previousY = this.y;
    }
    cut(x = this.x, y = this.y) {
        this.x = this.previousX = x;
        this.y = this.previousY = y;
    }
    view(alpha: number) {
        return {
            x: lerp(this.previousX, this.x, alpha) + this.shakeX,
            y: lerp(this.previousY, this.y, alpha) + this.shakeY,
        };
    }
}
export class FixedStep {
    private accumulator = 0;
    constructor(
        readonly dt = 1 / 60,
        readonly maxTicks = 5,
    ) {
        if (!(Number.isFinite(dt) && dt > 0 && Number.isSafeInteger(maxTicks) && maxTicks > 0))
            throw new Error("Invalid fixed-step configuration");
    }
    reset() {
        this.accumulator = 0;
    }
    advance(seconds: number, tick: () => void) {
        if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Invalid frame duration");
        this.accumulator += seconds;
        let ticks = 0;
        while (this.accumulator + 1e-12 >= this.dt && ticks < this.maxTicks) {
            tick();
            this.accumulator = Math.max(0, this.accumulator - this.dt);
            ticks++;
        }
        const dropped = Math.floor((this.accumulator + 1e-12) / this.dt);
        this.accumulator = Math.max(0, this.accumulator - dropped * this.dt);
        return { ticks, dropped, alpha: this.accumulator / this.dt };
    }
}
/** Recursive read-only view of supported plain data, including arrays and tuples. */
export type DeepReadonly<T> = T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

/** Validate and copy plain data before freezing; caller-owned values stay untouched. */
export function immutable<T>(value: T | DeepReadonly<T>): DeepReadonly<T> {
    // Traversal preserves supported fields and rejects values outside the data domain.
    return copyImmutable(value, new Map()) as DeepReadonly<T>;
}

function copyImmutable(value: unknown, copies: Map<object, object>): unknown {
    if (
        value === null ||
        value === undefined ||
        typeof value === "string" ||
        typeof value === "boolean" ||
        typeof value === "number" ||
        typeof value === "bigint"
    )
        return value;
    if (typeof value !== "object")
        throw new Error("Committed state, commands and events require plain data");
    const existing = copies.get(value);
    if (existing) return existing;
    const prototype = Object.getPrototypeOf(value);
    if (
        prototype !== Object.prototype &&
        prototype !== null &&
        !(Array.isArray(value) && prototype === Array.prototype)
    )
        throw new Error(
            "Committed state, commands and events require plain objects, arrays and primitives",
        );
    const copy: object = Array.isArray(value) ? new Array(value.length) : Object.create(prototype);
    copies.set(value, copy);
    for (const key of Reflect.ownKeys(value)) {
        if (Array.isArray(value) && key === "length") continue;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (typeof key !== "string" || !descriptor?.enumerable || !("value" in descriptor))
            throw new Error("Plain data requires enumerable string-keyed data properties");
        Object.defineProperty(copy, key, {
            value: copyImmutable(descriptor.value, copies),
            enumerable: true,
        });
    }
    return Object.freeze(copy);
}
