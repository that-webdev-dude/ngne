export interface InputSnapshot {
    readonly held: readonly string[];
    readonly pressed: readonly string[];
    readonly released: readonly string[];
    readonly pointer: Readonly<{
        x: number;
        y: number;
        active: boolean;
        dx: number;
        dy: number;
    }>;
    readonly wheel: number;
    readonly axes: readonly number[];
}
export const emptyInput = (): InputSnapshot =>
    Object.freeze({
        held: Object.freeze([]),
        pressed: Object.freeze([]),
        released: Object.freeze([]),
        pointer: Object.freeze({ x: 0, y: 0, active: false, dx: 0, dy: 0 }),
        wheel: 0,
        axes: Object.freeze([0, 0, 0, 0]),
    });
export const down = (i: InputSnapshot, key: string) => i.held.includes(key);
export const pressed = (i: InputSnapshot, key: string) => i.pressed.includes(key);
export class Input {
    private held = new Set<string>();
    private presses = new Set<string>();
    private releases = new Set<string>();
    private x = 0;
    private y = 0;
    private dx = 0;
    private dy = 0;
    private active = false;
    private wheel = 0;
    private cleanups: (() => void)[] = [];
    private padHeld = new Set<string>();
    set(key: string, value: boolean) {
        if (value && !this.held.has(key)) {
            this.held.add(key);
            this.presses.add(key);
        }
        if (!value && this.held.delete(key)) this.releases.add(key);
    }
    attach(canvas: HTMLCanvasElement, width: number, height: number) {
        const on = (target: EventTarget, name: string, fn: EventListener) => {
            target.addEventListener(name, fn, { passive: false });
            this.cleanups.push(() => target.removeEventListener(name, fn));
        };
        on(window, "keydown", (e) => {
            const k = e as KeyboardEvent;
            if ((k.target as HTMLElement)?.matches("input,textarea,select")) return;
            if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(k.code))
                k.preventDefault();
            this.set(k.code, true);
        });
        on(window, "keyup", (e) => this.set((e as KeyboardEvent).code, false));
        on(window, "blur", () => this.clear());
        const pointer = (e: PointerEvent) => {
            const r = canvas.getBoundingClientRect();
            const x = ((e.clientX - r.left) * width) / r.width,
                y = ((e.clientY - r.top) * height) / r.height;
            this.dx += x - this.x;
            this.dy += y - this.y;
            this.x = x;
            this.y = y;
            this.active = true;
        };
        on(canvas, "pointermove", (e) => pointer(e as PointerEvent));
        on(canvas, "pointerdown", (e) => {
            const p = e as PointerEvent;
            p.preventDefault();
            canvas.focus();
            pointer(p);
            canvas.setPointerCapture(p.pointerId);
            this.set("Pointer" + p.button, true);
        });
        on(canvas, "pointerup", (e) => this.set("Pointer" + (e as PointerEvent).button, false));
        on(canvas, "pointercancel", () => {
            this.set("Pointer0", false);
            this.set("Pointer2", false);
        });
        on(canvas, "contextmenu", (e) => e.preventDefault());
        on(canvas, "wheel", (e) => {
            e.preventDefault();
            this.wheel += (e as WheelEvent).deltaY;
        });
    }
    consume(): InputSnapshot {
        let axes = [0, 0, 0, 0];
        const pad =
            typeof navigator !== "undefined"
                ? navigator.getGamepads?.().find((p) => p?.connected)
                : undefined;
        const current = new Set<string>();
        if (pad) {
            axes = axes.map((_, i) => (Math.abs(pad.axes[i] ?? 0) > 0.15 ? pad.axes[i] : 0));
            pad.buttons.forEach((b, i) => {
                if (b.pressed) current.add("Pad" + i);
            });
        }
        for (const key of current) if (!this.padHeld.has(key)) this.presses.add(key);
        for (const key of this.padHeld) if (!current.has(key)) this.releases.add(key);
        this.padHeld = current;
        const result = Object.freeze({
            held: Object.freeze([...this.held, ...current]),
            pressed: Object.freeze([...this.presses]),
            released: Object.freeze([...this.releases]),
            pointer: Object.freeze({
                x: this.x,
                y: this.y,
                active: this.active,
                dx: this.dx,
                dy: this.dy,
            }),
            wheel: this.wheel,
            axes: Object.freeze(axes),
        });
        this.presses.clear();
        this.releases.clear();
        this.dx = this.dy = this.wheel = 0;
        return result;
    }
    clear() {
        for (const key of this.held) this.releases.add(key);
        this.held.clear();
        this.presses.clear();
        this.padHeld.clear();
    }
    dispose() {
        this.cleanups
            .splice(0)
            .reverse()
            .forEach((f) => f());
        this.clear();
    }
}
