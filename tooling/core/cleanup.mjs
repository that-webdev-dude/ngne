import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function failureText(error) {
    return error instanceof AggregateError
        ? `${error.message}: ${error.errors.map(failureText).join("; ")}`
        : error instanceof Error
          ? error.message
          : String(error);
}

/** Each runner retains resource ownership and chooses these ordered cleanup steps. */
export async function cleanupSteps(steps, records = []) {
    for (const [resource, action] of steps) {
        try {
            const detail = await action();
            records.push({ resource, status: "passed", detail });
        } catch (error) {
            records.push({ resource, status: "failed", error: failureText(error) });
        }
    }
    return records;
}

export async function runWithCleanup(workload, diagnostics, steps, records = []) {
    const failures = [];
    try {
        await workload();
    } catch (error) {
        failures.push(failureText(error));
        if (diagnostics) {
            try {
                await diagnostics();
            } catch (error) {
                failures.push(`diagnostics: ${failureText(error)}`);
            }
        }
    } finally {
        await cleanupSteps(steps, records);
    }
    failures.push(
        ...records
            .filter((step) => step.status === "failed")
            .map((step) => `${step.resource}: ${step.error}`),
    );
    return failures;
}

export async function shutdownProcessTree({
    resource,
    survivors,
    signal,
    graceMs = 2_000,
    forceMs = 5_000,
    now = Date.now,
    delay = sleep,
}) {
    const attempts = [];
    for (const [action, limit] of [
        ["terminate", graceMs],
        ["force", forceMs],
    ]) {
        let remaining = await survivors();
        if (!remaining.length) return { resource, attempts, survivors: [] };
        try {
            await signal(action, remaining);
            attempts.push(action);
        } catch (error) {
            attempts.push(`${action}: ${failureText(error)}`);
        }
        const end = now() + limit;
        do {
            remaining = await survivors();
            if (!remaining.length) return { resource, attempts, survivors: [] };
            await delay(100);
        } while (now() < end);
    }
    throw new Error(
        `${resource}: shutdown ${attempts.join(", ")}; surviving PID(s): ${(await survivors()).join(", ")}`,
    );
}

async function windowsProcesses() {
    const { stdout } = await execute(
        "powershell.exe",
        [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,@{Name='Born';Expression={$_.CreationDate.ToUniversalTime().ToString('o')}} | ConvertTo-Json -Compress",
        ],
        { windowsHide: true, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 },
    );
    return JSON.parse(stdout);
}

/** Call immediately after spawn, including when spawn may fail. Never select by executable name. */
export function ownProcess(child, label) {
    const started = Date.now();
    let spawnError,
        closed = false,
        stopping;
    child.on("error", (error) => {
        spawnError = error;
    });
    child.once("close", () => {
        closed = true;
    });
    return {
        check() {
            if (spawnError) throw new Error(`${label}: spawn failed: ${spawnError.message}`);
            if (closed)
                throw new Error(
                    `${label}: exited before workload completed (${child.exitCode ?? child.signalCode})`,
                );
        },
        stop() {
            return (stopping ??= (async () => {
                if (!child.pid)
                    return { resource: label, action: "no process spawned", survivors: [] };
                let survivors, signal;
                if (process.platform === "win32") {
                    const processes = await windowsProcesses();
                    const root = processes.find((p) => p.ProcessId === child.pid);
                    // Refuse a reused root PID. Descendants retain ParentProcessId after parent exit.
                    if (root && Date.parse(root.Born) > started + 1_000)
                        throw new Error(
                            `${label}: PID ${child.pid} was reused; refusing termination`,
                        );
                    const owned = new Map();
                    if (root) owned.set(root.ProcessId, root.Born);
                    let changed = true;
                    while (changed) {
                        changed = false;
                        for (const p of processes) {
                            if (
                                !owned.has(p.ProcessId) &&
                                (p.ParentProcessId === child.pid || owned.has(p.ParentProcessId)) &&
                                Date.parse(p.Born) >= started - 1_000
                            ) {
                                owned.set(p.ProcessId, p.Born);
                                changed = true;
                            }
                        }
                    }
                    survivors = async () => {
                        const current = await windowsProcesses();
                        // Include children born during shutdown, including orphaned children.
                        let added = true;
                        while (added) {
                            added = false;
                            for (const p of current) {
                                const parentBirth = owned.get(p.ParentProcessId);
                                const parent = current.find(
                                    (entry) => entry.ProcessId === p.ParentProcessId,
                                );
                                if (
                                    !owned.has(p.ProcessId) &&
                                    parentBirth &&
                                    (!parent || parent.Born === parentBirth) &&
                                    p.Born >= parentBirth
                                ) {
                                    owned.set(p.ProcessId, p.Born);
                                    added = true;
                                }
                            }
                        }
                        return current
                            .filter((p) => owned.get(p.ProcessId) === p.Born)
                            .map((p) => p.ProcessId);
                    };
                    signal = async (action, pids) => {
                        const live = await survivors();
                        const targets = pids.filter((pid) => live.includes(pid));
                        if (!targets.length) return;
                        await execute(
                            "taskkill.exe",
                            [
                                ...targets.flatMap((pid) => ["/PID", String(pid)]),
                                "/T",
                                ...(action === "force" ? ["/F"] : []),
                            ],
                            { windowsHide: true, timeout: 5_000 },
                        );
                    };
                } else {
                    survivors = async () => {
                        try {
                            process.kill(-child.pid, 0);
                            return [child.pid];
                        } catch (error) {
                            if (error.code === "ESRCH") return [];
                            throw error;
                        }
                    };
                    signal = async (action) => {
                        try {
                            process.kill(-child.pid, action === "force" ? "SIGKILL" : "SIGTERM");
                        } catch (error) {
                            if (error.code !== "ESRCH") throw error;
                        }
                    };
                }
                const result = await shutdownProcessTree({
                    resource: `${label} PID ${child.pid}`,
                    survivors,
                    signal,
                });
                // Drain stdio so process logs are complete before result publication.
                const deadline = Date.now() + 5_000;
                while (!closed && Date.now() < deadline) await sleep(25);
                if (!closed)
                    throw new Error(
                        `${label} PID ${child.pid}: tree exited but process close/stdio drain timed out`,
                    );
                return result;
            })().catch((error) => {
                // An explicit cleanup failure must still let the runner publish evidence and exit.
                child.stdout?.destroy();
                child.stderr?.destroy();
                child.unref();
                throw new Error(
                    `${label} PID ${child.pid ?? "not spawned"}: terminate/verify failed: ${failureText(error)}`,
                );
            }));
        },
    };
}

export async function closeServer(server) {
    if (!server.listening) return;
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("HTTP server close timed out")), 5_000);
        server.close((error) => {
            clearTimeout(timer);
            error ? reject(error) : resolve();
        });
        server.closeAllConnections();
    });
}
