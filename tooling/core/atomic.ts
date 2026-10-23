import { randomUUID } from "node:crypto";
import { closeSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";

export type AtomicWriter = (path: string, value: unknown) => void;
export class EvidenceWriteError extends AggregateError {
    constructor(
        message: string,
        error: unknown,
        readonly cleanupFailures: readonly { resource: string; error: unknown }[],
    ) {
        super(
            [error, ...cleanupFailures.map((f) => new AggregateError([f.error], f.resource))],
            message,
            { cause: error },
        );
    }
}

const delays = [20, 40, 80, 160, 200];
const sleeper = new Int32Array(new SharedArrayBuffer(4));
const defaults = {
    platform: process.platform,
    open: openSync,
    write: writeFileSync,
    close: closeSync,
    rename: renameSync,
    unlink: unlinkSync,
    wait: (ms: number) => {
        Atomics.wait(sleeper, 0, 0, ms);
    },
};

function code(error: unknown): string {
    return typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string"
        ? error.code
        : "unknown";
}

/** Tooling-only injection seam; recovery retries the same replacement, never the write. */
export function createAtomicWriter(overrides: Partial<typeof defaults> = {}): AtomicWriter {
    const io = { ...defaults, ...overrides };
    return (path, value) => {
        const temporary = `${path}.${randomUUID()}.tmp`;
        let operation = "serialize",
            attempts = 0,
            owned = false;
        let fd: number | undefined;
        try {
            const bytes = JSON.stringify(value, null, 2) + "\n";
            operation = "create";
            fd = io.open(temporary, "wx");
            owned = true;
            operation = "write";
            io.write(fd, bytes);
            operation = "close";
            io.close(fd);
            fd = undefined;
            operation = "rename";
            for (;;) {
                attempts++;
                try {
                    io.rename(temporary, path);
                    return;
                } catch (error) {
                    if (
                        io.platform !== "win32" ||
                        !["EPERM", "EBUSY"].includes(code(error)) ||
                        attempts > delays.length
                    )
                        throw error;
                    io.wait(delays[attempts - 1]);
                }
            }
        } catch (error) {
            const cleanupFailures: { resource: string; error: unknown }[] = [];
            if (fd !== undefined) {
                try {
                    io.close(fd);
                } catch (cleanup) {
                    cleanupFailures.push({
                        resource: `Temporary close: ${temporary}`,
                        error: cleanup,
                    });
                }
            }
            if (owned) {
                try {
                    io.unlink(temporary);
                } catch (cleanup) {
                    cleanupFailures.push({
                        resource: `Temporary remove: ${temporary}`,
                        error: cleanup,
                    });
                }
            }
            throw new EvidenceWriteError(
                `Evidence ${operation} failed: ${temporary} -> ${path}; code=${code(error)}; rename attempts=${attempts}`,
                error,
                cleanupFailures,
            );
        }
    };
}

export const atomic = createAtomicWriter();
