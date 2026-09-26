import assert from "node:assert/strict";
import { test } from "node:test";
import {
    connectDevTools,
    ProtocolError,
    TransportError,
    isNavigationError,
} from "../core/browser/devtools.mjs";

class Clock {
    next = 0;
    timers = new Map<number, () => void>();
    setTimeout = (fn: () => void) => {
        this.timers.set(++this.next, fn);
        return this.next;
    };
    clearTimeout = (id: number) => {
        this.timers.delete(id);
    };
    expire() {
        for (const [id, fn] of [...this.timers]) {
            this.timers.delete(id);
            fn();
        }
    }
}
class Socket {
    listeners = new Map<string, Set<(event: object) => void>>();
    sent: { id: number; method: string; params: Record<string, unknown> }[] = [];
    closes = 0;
    readyState = 0;
    addEventListener(name: string, fn: (event: object) => void) {
        const set = this.listeners.get(name) ?? new Set();
        set.add(fn);
        this.listeners.set(name, set);
    }
    removeEventListener(name: string, fn: (event: object) => void) {
        this.listeners.get(name)?.delete(fn);
    }
    emit(name: string, event = {}) {
        for (const fn of this.listeners.get(name) ?? []) fn(event);
    }
    reply(value: object) {
        this.emit("message", { data: JSON.stringify(value) });
    }
    send(value: string) {
        this.sent.push(JSON.parse(value));
    }
    close() {
        this.closes++;
        this.readyState = 3;
        this.emit("close");
    }
    get listenerCount() {
        return [...this.listeners.values()].reduce((n, set) => n + set.size, 0);
    }
}
function fixture(options = {}) {
    const socket = new Socket(),
        clock = new Clock();
    const connection = connectDevTools("fixture", {
        socketFactory: () => socket,
        clock,
        ...options,
    });
    return { socket, clock, connection };
}

test("DevTools correlates out-of-order replies, protocol failures and complete events", async () => {
    const events: unknown[] = [],
        params: unknown[] = [];
    const { socket, clock, connection } = fixture({
        onEvent: (event: unknown) => events.push(event),
    });
    socket.emit("open");
    const cdp = await connection;
    cdp.on("Runtime.consoleAPICalled", (value: unknown) => params.push(value));
    const first = cdp.send("one"),
        second = cdp.send("two");
    const rejected = assert.rejects(
        second,
        (error: unknown) => error instanceof ProtocolError && error.detail.code === -1,
    );
    socket.reply({ id: 2, error: { code: -1, message: "invalid command", data: "detail" } });
    socket.reply({ id: 1, result: { ok: true } });
    assert.deepEqual(await first, { ok: true });
    await rejected;
    const event = {
        method: "Runtime.consoleAPICalled",
        params: { type: "log" },
        sessionId: "session",
    };
    socket.reply(event);
    assert.deepEqual(events, [event]);
    assert.deepEqual(params, [event.params]);
    cdp.close();
    assert.equal(clock.timers.size, 0);
    assert.equal(socket.listenerCount, 0);
});

test("timeout does not replay or close; diagnostics work and late replies are ignored", async () => {
    const { socket, clock, connection } = fixture();
    socket.emit("open");
    const cdp = await connection;
    const timed = cdp.send("Page.navigate");
    const rejected = assert.rejects(timed, /may still execute/);
    clock.expire();
    await rejected;
    assert.equal(socket.closes, 0);
    const diagnostic = cdp.send("Page.captureScreenshot");
    socket.reply({ id: 1, result: { stale: true } });
    socket.reply({ id: 2, result: { data: "png" } });
    assert.deepEqual(await diagnostic, { data: "png" });
    assert.equal(socket.sent.length, 2);
    cdp.close();
    assert.equal(clock.timers.size, 0);
});

for (const event of ["error", "close", "timeout"])
    test(`opening ${event} releases all listeners and timers`, async () => {
        const { socket, clock, connection } = fixture();
        const rejected = assert.rejects(connection, TransportError);
        if (event === "timeout") clock.expire();
        else socket.emit(event);
        await rejected;
        assert.equal(clock.timers.size, 0);
        assert.equal(socket.listenerCount, 0);
        assert.equal(socket.closes, 1);
    });

for (const event of ["error", "close", "explicit"])
    test(`${event} settles pending requests once and repeated close is harmless`, async () => {
        const { socket, clock, connection } = fixture();
        socket.emit("open");
        const cdp = await connection;
        const a = assert.rejects(cdp.send("one"), TransportError),
            b = assert.rejects(cdp.send("two"), TransportError);
        if (event === "explicit") cdp.close();
        else socket.emit(event);
        await Promise.all([a, b]);
        cdp.close();
        cdp.close();
        socket.reply({ id: 1, result: "late" });
        await assert.rejects(cdp.send("three"), TransportError);
        assert.equal(socket.sent.length, 2);
        assert.equal(clock.timers.size, 0);
        assert.equal(socket.listenerCount, 0);
        assert.equal(socket.closes, 1);
    });

test("evaluation preserves each runner's gesture default and explicit overrides", async () => {
    for (const userGesture of [false, true]) {
        const { socket, connection } = fixture({ userGesture });
        socket.emit("open");
        const cdp = await connection;
        const first = cdp.evaluate("1");
        assert.deepEqual(socket.sent[0].params, {
            expression: "1",
            awaitPromise: true,
            returnByValue: true,
            userGesture,
        });
        socket.reply({ id: 1, result: { result: { value: 1 } } });
        assert.equal(await first, 1);
        const second = cdp.evaluate("throw 1", !userGesture);
        assert.equal(socket.sent[1].params.userGesture, !userGesture);
        const rejected = assert.rejects(second, /page exception/);
        socket.reply({ id: 2, result: { exceptionDetails: { text: "page exception" } } });
        await rejected;
        cdp.close();
    }
});

test("only navigation-context protocol errors are recoverable", () => {
    assert.equal(
        isNavigationError(
            new ProtocolError("Runtime.evaluate", { message: "Execution context was destroyed." }),
        ),
        true,
    );
    assert.equal(isNavigationError(new TransportError("Execution context was destroyed.")), false);
    assert.equal(isNavigationError(new Error("request timed out")), false);
    assert.equal(
        isNavigationError(new ProtocolError("Runtime.evaluate", { message: "bad expression" })),
        false,
    );
});

test("synchronous send failure settles every pending request", async () => {
    const { socket, clock, connection } = fixture();
    socket.emit("open");
    const cdp = await connection;
    const first = assert.rejects(cdp.send("one"), TransportError);
    socket.send = () => {
        throw new Error("broken socket");
    };
    await assert.rejects(cdp.send("two"), /broken socket/);
    await first;
    assert.equal(clock.timers.size, 0);
    assert.equal(socket.listenerCount, 0);
});

test("socket shutdown has a deadline and clears its final listener", async () => {
    const { socket, clock, connection } = fixture();
    socket.emit("open");
    const cdp = await connection;
    socket.close = () => {
        socket.closes++;
    };
    const pending = assert.rejects(cdp.send("pending"), TransportError);
    const close = cdp.close();
    const rejected = assert.rejects(close, /shutdown timed out/);
    await pending;
    assert.equal(clock.timers.size, 1);
    clock.expire();
    await rejected;
    assert.equal(socket.listenerCount, 0);
    assert.equal(clock.timers.size, 0);
    assert.equal(cdp.close(), close);
    assert.equal(socket.closes, 1);
});

test("malformed messages fail the transport and settle pending requests", async () => {
    const { socket, clock, connection } = fixture();
    socket.emit("open");
    const cdp = await connection;
    const rejected = assert.rejects(cdp.send("pending"), /message handling failed/);
    socket.emit("message", { data: "{invalid" });
    await rejected;
    await cdp.close();
    assert.equal(socket.listenerCount, 0);
    assert.equal(clock.timers.size, 0);
});
