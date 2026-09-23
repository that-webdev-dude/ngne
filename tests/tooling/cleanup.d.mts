import type { ChildProcess } from "node:child_process";
import type { Server } from "node:http";

export interface CleanupRecord {
    resource: string;
    status: "passed" | "failed";
    detail?: unknown;
    error?: string;
}
export type CleanupStep = readonly [string, () => unknown | Promise<unknown>];
export function failureText(error: unknown): string;
export function cleanupSteps(
    steps: readonly CleanupStep[],
    records?: CleanupRecord[],
): Promise<CleanupRecord[]>;
export function ownProcess(
    child: ChildProcess,
    label: string,
): {
    check(): void;
    stop(): Promise<unknown>;
};
export function closeServer(server: Server): Promise<void>;
export function runWithCleanup(
    workload: () => Promise<void>,
    diagnostics: (() => Promise<void>) | undefined,
    steps: readonly CleanupStep[],
    records?: CleanupRecord[],
): Promise<string[]>;
