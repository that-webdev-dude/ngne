import { test } from "node:test";
import assert from "node:assert/strict";
import { Input, emptyInput, type InputSnapshot } from "../src/input.js";

// Exercise the public input boundary; native capture is checked by the browser suite.
test("pointer completion preserves ordered click coordinates and rejects interruptions", () => {
    const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const host = new EventTarget();
    const surface = Object.assign(new EventTarget(), {
        focus() {
            surface.dispatchEvent(new Event("focus"));
        },
        setPointerCapture() {},
        getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 100 }),
    });
    Object.defineProperty(globalThis, "window", { configurable: true, value: host });
    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: { activeElement: surface },
    });
    const input = new Input();
    input.attach(surface as unknown as HTMLCanvasElement, 100, 50);
    const event = (type: string, x = 25, y = 25, pointerId = 1) =>
        surface.dispatchEvent(
            Object.assign(new Event(type), {
                pointerId,
                button: 0,
                clientX: 10 + x * 2,
                clientY: 20 + y * 2,
            }),
        );
    const count = (snapshot: InputSnapshot) =>
        snapshot.pointer.completed.filter(
            (c) =>
                c.button === 0 &&
                c.startX >= 20 &&
                c.startX <= 30 &&
                c.x >= 20 &&
                c.x <= 30 &&
                c.startY >= 20 &&
                c.startY <= 30 &&
                c.y >= 20 &&
                c.y <= 30,
        ).length;
    try {
        assert.deepEqual(emptyInput().pointer.completed, []);
        for (const fast of [false, true]) {
            event("pointerdown");
            if (!fast) input.consume();
            event("pointerup");
            event("lostpointercapture");
            const snapshot = input.consume();
            assert.equal(count(snapshot), 1);
            assert.deepEqual(snapshot.pointer.completed, [
                { button: 0, startX: 25, startY: 25, x: 25, y: 25 },
            ]);
            assert.ok(Object.isFrozen(snapshot.pointer.completed));
            assert.ok(Object.isFrozen(snapshot.pointer.completed[0]));
            assert.equal(count(input.consume()), 0);
            event("pointerup");
            event("lostpointercapture");
            assert.equal(count(input.consume()), 0);
        }
        for (const consumed of [false, true]) {
            for (const interrupt of [
                () => event("pointercancel"),
                () => event("lostpointercapture"),
                () => surface.dispatchEvent(new Event("blur")),
                () => host.dispatchEvent(new Event("blur")),
                () => input.clear(),
            ]) {
                event("pointerdown");
                if (consumed) input.consume();
                interrupt();
                event("pointerup");
                event("lostpointercapture");
                const snapshot = input.consume();
                assert.equal(count(snapshot), 0);
                assert.deepEqual(snapshot.held, []);
                event("pointerdown");
                event("pointerup");
                assert.equal(count(input.consume()), 1);
            }
        }
        event("pointerdown");
        event("pointerup", 60);
        event("pointermove", 25);
        assert.equal(count(input.consume()), 0, "release position survives later hover");
        event("pointerdown", 60);
        event("pointerup", 25);
        assert.equal(count(input.consume()), 0, "press outside cannot activate");
        event("pointerdown");
        event("pointerup");
        event("pointerdown");
        event("pointercancel");
        assert.equal(count(input.consume()), 1, "later cancellation preserves an earlier click");
        event("pointerdown");
        event("pointerup");
        event("pointerdown");
        event("pointerup");
        assert.equal(count(input.consume()), 2, "repeated transitions remain separate");
        event("pointerdown");
        event("pointerup", 25, 25, 2);
        assert.equal(count(input.consume()), 0, "unmatched up does not complete");
        event("pointerup");
        assert.equal(count(input.consume()), 1);
        event("pointerdown");
        event("pointerup");
        input.clear();
        assert.equal(count(input.consume()), 0, "clear discards pending activation");
        event("pointerdown");
        input.dispose();
        event("pointerup");
        assert.equal(count(input.consume()), 0);
        assert.deepEqual(input.consume().held, []);
    } finally {
        input.dispose();
        if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
        else Reflect.deleteProperty(globalThis, "window");
        if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument);
        else Reflect.deleteProperty(globalThis, "document");
    }
});
