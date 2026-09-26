import { DevToolsSocket } from "./socket.ts";
export class TransportError extends Error {}
export class ProtocolError extends Error {
    constructor(method, detail) {
        super(`${method}: ${detail.message}`);
        this.detail = detail;
    }
}
export const isNavigationError = (error) =>
    error instanceof ProtocolError &&
    /Execution context was destroyed|Cannot find context with specified id|Inspected target navigated or closed/.test(
        error.message,
    );

/** Internal transport only. A deadline never cancels or replays browser commands. */
export function connectDevTools(
    url,
    {
        socketFactory = (address) => new DevToolsSocket(address),
        openTimeoutMs = 10_000,
        requestTimeoutMs = 30_000,
        closeTimeoutMs = 5_000,
        userGesture = false,
        onEvent = () => {},
        clock = { setTimeout, clearTimeout },
    } = {},
) {
    return new Promise((resolve, reject) => {
        const socket = socketFactory(url);
        const pending = new Map(),
            subscriptions = new Map();
        let nextId = 0,
            terminal,
            closing,
            opened = false,
            openingTimer;
        const detach = () => {
            for (const [event, handler] of Object.entries(handlers))
                socket.removeEventListener(event, handler);
            subscriptions.clear();
        };
        const finish = (error) => {
            if (terminal) return;
            terminal = error;
            clock.clearTimeout(openingTimer);
            detach();
            for (const call of pending.values()) {
                clock.clearTimeout(call.timer);
                call.reject(error);
            }
            pending.clear();
            closing = new Promise((closed, failed) => {
                if (socket.readyState === 3) {
                    closed();
                    return;
                }
                const done = () => {
                    clock.clearTimeout(timer);
                    socket.removeEventListener("close", done);
                    closed();
                };
                const timer = clock.setTimeout(() => {
                    socket.removeEventListener("close", done);
                    failed(new TransportError("DevTools socket shutdown timed out"));
                }, closeTimeoutMs);
                socket.addEventListener("close", done);
                try {
                    socket.close();
                } catch (closeError) {
                    clock.clearTimeout(timer);
                    socket.removeEventListener("close", done);
                    failed(new TransportError(`DevTools socket close failed: ${closeError}`));
                }
            });
            // Terminal events can arrive before the runner reaches its cleanup block.
            closing.catch(() => {});
            if (!opened)
                closing.then(
                    () => reject(error),
                    (closeError) =>
                        reject(
                            new AggregateError(
                                [error, closeError],
                                "DevTools opening/cleanup failed",
                            ),
                        ),
                );
        };
        const client = {
            send(method, params = {}, timeoutMs = requestTimeoutMs) {
                if (terminal) return Promise.reject(terminal);
                return new Promise((resolveCall, rejectCall) => {
                    const id = ++nextId;
                    const timer = clock.setTimeout(() => {
                        pending.delete(id);
                        rejectCall(
                            new Error(
                                `DevTools ${method} timed out after ${timeoutMs} ms (browser command may still execute)`,
                            ),
                        );
                    }, timeoutMs);
                    pending.set(id, { resolve: resolveCall, reject: rejectCall, timer, method });
                    try {
                        socket.send(JSON.stringify({ id, method, params }));
                    } catch (error) {
                        finish(new TransportError(`DevTools send failed: ${error}`));
                    }
                });
            },
            async evaluate(expression, gesture = userGesture) {
                const reply = await client.send("Runtime.evaluate", {
                    expression,
                    awaitPromise: true,
                    returnByValue: true,
                    userGesture: gesture,
                });
                if (reply.exceptionDetails)
                    throw new Error(
                        reply.exceptionDetails.exception?.description ??
                            reply.exceptionDetails.text,
                    );
                return reply.result.value;
            },
            on(method, handler) {
                if (terminal) throw terminal;
                const listeners = subscriptions.get(method) ?? new Set();
                listeners.add(handler);
                subscriptions.set(method, listeners);
                return () => listeners.delete(handler);
            },
            once(method, timeoutMs = requestTimeoutMs) {
                return new Promise((resolveEvent, rejectEvent) => {
                    const id = ++nextId;
                    const off = client.on(method, (value) => {
                        clock.clearTimeout(timer);
                        pending.delete(id);
                        off();
                        resolveEvent(value);
                    });
                    const timer = clock.setTimeout(() => {
                        off();
                        pending.delete(id);
                        rejectEvent(new Error(`DevTools event ${method} timed out`));
                    }, timeoutMs);
                    pending.set(id, {
                        timer,
                        reject: (error) => {
                            off();
                            rejectEvent(error);
                        },
                    });
                });
            },
            close() {
                finish(new TransportError("DevTools connection explicitly closed"));
                return closing;
            },
        };
        const handlers = {
            open() {
                opened = true;
                clock.clearTimeout(openingTimer);
                resolve(client);
            },
            error(event) {
                finish(
                    new TransportError(
                        `DevTools socket failed${event.data ? `: ${event.data}` : ""}`,
                    ),
                );
            },
            close() {
                finish(new TransportError("DevTools socket disconnected"));
            },
            message(event) {
                try {
                    const message = JSON.parse(String(event.data));
                    if (message.id === undefined) {
                        onEvent(message);
                        for (const handler of subscriptions.get(message.method) ?? [])
                            handler(message.params);
                        return;
                    }
                    const call = pending.get(message.id);
                    if (!call) return;
                    pending.delete(message.id);
                    clock.clearTimeout(call.timer);
                    if (message.error) call.reject(new ProtocolError(call.method, message.error));
                    else call.resolve(message.result);
                } catch (error) {
                    finish(new TransportError(`DevTools message handling failed: ${error}`));
                }
            },
        };
        for (const [event, handler] of Object.entries(handlers))
            socket.addEventListener(event, handler);
        openingTimer = clock.setTimeout(
            () => finish(new TransportError("DevTools opening timed out")),
            openTimeoutMs,
        );
    });
}
