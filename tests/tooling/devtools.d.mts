import type { DevToolsSocket } from "../../tooling/core/browser/socket.js";

/** Typed boundary over the shared transport; implementation remains in devtools.mjs. */
export interface DevTools {
    send(method: string, params?: object, timeoutMs?: number): Promise<unknown>;
    evaluate<T>(expression: string, gesture?: boolean): Promise<T>;
    on(method: string, handler: (value: unknown) => void): () => void;
    once(method: string, timeoutMs?: number): Promise<unknown>;
    close(): Promise<void>;
}
export class TransportError extends Error {}
export class ProtocolError extends Error {
    constructor(method: string, detail: { message: string; code?: number });
    detail: { message: string; code?: number };
}
export function isNavigationError(error: unknown): boolean;
export function connectDevTools<Timer = ReturnType<typeof setTimeout>>(
    url: string,
    options?: {
        socketFactory?: (
            address: string,
        ) => Pick<
            DevToolsSocket,
            "readyState" | "send" | "close" | "addEventListener" | "removeEventListener"
        >;
        clock?: {
            setTimeout: (callback: () => void, ms: number) => Timer;
            clearTimeout: (timer: Timer) => void;
        };
        requestTimeoutMs?: number;
        openTimeoutMs?: number;
        closeTimeoutMs?: number;
        userGesture?: boolean;
        onEvent?: (message: unknown) => void;
    },
): Promise<DevTools>;
