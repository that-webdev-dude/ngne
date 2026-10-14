import type { BrowserSession } from "../../../core/browser/session.js";
import { failureText } from "../../../core/cleanup.mjs";
import type { Run } from "../../../core/run.js";

/** Close each case before continuing, retaining independent workload, cleanup and evidence outcomes. */
export async function investigationCase(
    run: Run,
    id: string,
    session: BrowserSession,
    workload: () => Promise<void>,
    measurements: () => Record<string, unknown>,
): Promise<boolean> {
    let collected = false;
    const close = async () => {
        const records = await session.close();
        if (!collected) {
            run.result.cleanupRecords.push(
                ...records.map((record) => ({ ...record, resource: `${id} ${record.resource}` })),
            );
            collected = true;
        }
    };
    // Register before startup; the run's fallback reuses the session's idempotent close.
    run.cleanup.push([`${id} browser session`, close]);
    let workloadFailed = false;
    let workloadError: unknown;
    try {
        await run.stage(id, workload);
    } catch (error) {
        workloadFailed = true;
        workloadError = error;
    } finally {
        await close();
    }
    let recorded = true;
    try {
        run.record(id, "measurements", { ...measurements(), cleanup: session.records });
    } catch (error) {
        recorded = false;
        run.result.failures.push({
            kind: "evidence",
            message: `${id} measurements: ${failureText(error)}`,
        });
    }
    if (workloadFailed) throw workloadError;
    return recorded && session.records.every((record) => record.status === "passed");
}
