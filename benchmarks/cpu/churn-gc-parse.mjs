// Structural --trace-gc parser for churn gc-mode runs.
// Usage: node churn-gc-parse.mjs <trace-gc.log> <churn result.json> [out.json]
// Trace lines are grouped by isolate (tsx adds a loader worker isolate). The churn script's
// PerformanceObserver attaches after module loading and also reports incremental-marking entries
// (kind 8) that have no trace line; those are dropped. The remaining observer entries match trace
// lines one-to-one at an unknown shift s: the accepted (isolate, shift) is the unique one where
// at least 95% of pairs agree on pause (|trace pause - observer duration| <= max(0.5 ms, 30%)) and
// (trace ms since isolate start) - (observer startTime) changes by at most 5 ms between consecutive
// pairs (the clocks drift a few ms per run and Mark-Compact lines are stamped differently).
// The window is the observer entries whose startTime lies in [windowStartMs, windowEndMs).
import { readFileSync, writeFileSync } from "node:fs";

const [logPath, resultPath, outPath] = process.argv.slice(2);
const LINE =
    /^\[\d+:([0-9A-Fa-fx]+)\]\s+(\d+) ms: ([A-Za-z-]+(?: \([a-z ]+\))?) ([\d.]+) \(([\d.]+)\) -> ([\d.]+) \(([\d.]+)\) MB, (?:pooled: [\d.]+ MB, )?([\d.]+) \/ ([\d.]+) ms/;
const INCREMENTAL_KIND = 8;
const events = [];
let unmatched = 0;
for (const line of readFileSync(logPath, "utf8").split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (m)
        events.push({
            isolate: m[1],
            ms: +m[2],
            type: m[3],
            pauseMs: +m[8],
            beforeMB: +m[4],
            afterMB: +m[6],
        });
    else if (/^\[\d+:[0-9A-Fa-fx]+\]/.test(line)) unmatched++;
}
const result = JSON.parse(readFileSync(resultPath, "utf8"));
const gc = result.gc;
const observed = (gc?.entries ?? []).filter((e) => e.kind !== INCREMENTAL_KIND);
const candidates = [];
for (const isolate of new Set(events.map((e) => e.isolate))) {
    const own = events.filter((e) => e.isolate === isolate);
    for (let s = 0; s + observed.length <= own.length; s++) {
        const offsets = observed.map((e, i) => own[i + s].ms - e.startTime);
        const range = Math.max(...offsets) - Math.min(...offsets);
        const maxStep = Math.max(0, ...offsets.slice(1).map((o, i) => Math.abs(o - offsets[i])));
        if (maxStep > 5) continue;
        const agree = observed.filter(
            (e, i) => Math.abs(own[i + s].pauseMs - e.duration) <= Math.max(0.5, 0.3 * e.duration),
        ).length;
        if (agree >= 0.95 * observed.length)
            candidates.push({
                isolate,
                shift: s,
                offsetRangeMs: range,
                maxOffsetStepMs: maxStep,
                pauseAgreement: agree / observed.length,
                own,
            });
    }
}
const summary = {
    logPath,
    resultPath,
    traceLines: events.length,
    unmatchedTraceLines: unmatched,
    observerEntries: gc?.entries?.length ?? 0,
    observerIncrementalEntriesDropped: (gc?.entries ?? []).length - observed.length,
    qualifying: candidates.map(({ own, ...c }) => c),
    accepted: observed.length > 0 && candidates.length === 1,
};
if (summary.accepted) {
    const { own, shift } = candidates[0];
    const window = [];
    observed.forEach((e, i) => {
        if (e.startTime >= gc.windowStartMs && e.startTime < gc.windowEndMs)
            window.push({ trace: own[i + shift], observer: e });
    });
    const byType = {};
    for (const { trace } of window) {
        byType[trace.type] ??= { count: 0, pauseMs: 0 };
        byType[trace.type].count++;
        byType[trace.type].pauseMs += trace.pauseMs;
    }
    Object.assign(summary, {
        windowMs: gc.windowEndMs - gc.windowStartMs,
        windowCount: window.length,
        windowPauseTotalMs: window.reduce((sum, w) => sum + w.trace.pauseMs, 0),
        windowObserverDurationMs: window.reduce((sum, w) => sum + w.observer.duration, 0),
        byType,
    });
} else
    summary.rejectReason = `${candidates.length} qualifying alignments for ${observed.length} observer entries`;
const text = JSON.stringify(summary, null, 2);
if (outPath) writeFileSync(outPath, text);
console.log(text);
if (!summary.accepted) process.exitCode = 1;
