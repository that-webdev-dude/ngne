import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Frame, WebGPURenderer } from "../src/index.js";
import { deferred, fakePlatform } from "./gpu-fixture.js";

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function platformFor(t: TestContext) {
    const platform = fakePlatform();
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "gpu");
    Object.defineProperty(navigator, "gpu", { configurable: true, value: platform.gpu });
    t.after(() => {
        if (descriptor) Object.defineProperty(navigator, "gpu", descriptor);
        else Reflect.deleteProperty(navigator, "gpu");
    });
    return platform;
}
/** Observes settlement without consuming a rejection twice. */
function track(work: Promise<void>) {
    const record: { state: "pending" | "resolved" | "rejected"; error?: unknown } = {
        state: "pending",
    };
    void work.then(
        () => {
            record.state = "resolved";
        },
        (error: unknown) => {
            record.state = "rejected";
            record.error = error;
        },
    );
    return record;
}
function drawable() {
    const frame = new Frame();
    frame.rect(1, 1, 4, 4, 0xffffff);
    return frame;
}

test("submittedWorkDone settles when the GPU completes work submitted before the call", async (t) => {
    const platform = platformFor(t);
    const renderer = await WebGPURenderer.create(platform.canvas, 64, 64, () => {});
    try {
        const device = platform.devices[0],
            frame = drawable();
        device.completeWork();
        // Unused, the feature adds no queue query or tracking to render().
        for (let i = 0; i < 4; i++) renderer.render(frame);
        assert.equal(device.workDoneQueries, 0);
        assert.equal(device.workWaiters.length, 0);

        const first = track(renderer.submittedWorkDone());
        renderer.render(frame);
        const second = track(renderer.submittedWorkDone());
        assert.equal(device.workDoneQueries, 2);
        await turn();
        assert.deepEqual([first.state, second.state], ["pending", "pending"]);
        device.completeWork(device.submissions - 1);
        await turn();
        assert.deepEqual([first.state, second.state], ["resolved", "pending"]);
        device.completeWork();
        await turn();
        assert.equal(second.state, "resolved");
        // Already-complete work still resolves asynchronously.
        const idle = track(renderer.submittedWorkDone());
        assert.equal(idle.state, "pending");
        await turn();
        assert.equal(idle.state, "resolved");
    } finally {
        renderer.dispose();
    }
});

test("submittedWorkDone excludes frames that skipped submission", async (t) => {
    const platform = platformFor(t);
    const renderer = await WebGPURenderer.create(platform.canvas, 64, 64, () => {});
    try {
        const device = platform.devices[0],
            faulted = new Frame();
        faulted.sprite({ x: 4, y: 4, width: 4, height: 4, texture: "missing" });
        renderer.render(drawable());
        device.completeWork();
        const submitted = device.submissions;
        renderer.render(faulted);
        platform.surface.failAcquire = true;
        renderer.render(drawable());
        platform.surface.failAcquire = false;
        assert.equal(device.submissions, submitted);
        const wait = track(renderer.submittedWorkDone());
        await turn();
        assert.equal(wait.state, "resolved");
    } finally {
        renderer.dispose();
    }
});

test("cancelling one submittedWorkDone wait rejects with its reason and leaves others", async (t) => {
    const platform = platformFor(t);
    const renderer = await WebGPURenderer.create(platform.canvas, 64, 64, () => {});
    try {
        const device = platform.devices[0];
        renderer.render(drawable());
        const abort = new AbortController(),
            reason = new Error("host cancelled"),
            cancelled = track(renderer.submittedWorkDone(abort.signal)),
            other = track(renderer.submittedWorkDone());
        abort.abort(reason);
        await turn();
        assert.equal(cancelled.state, "rejected");
        assert.equal(cancelled.error, reason);
        assert.equal(other.state, "pending");
        const queries = device.workDoneQueries;
        await assert.rejects(renderer.submittedWorkDone(abort.signal), (error) => error === reason);
        assert.equal(device.workDoneQueries, queries);
        device.completeWork();
        await turn();
        assert.equal(other.state, "resolved");
        assert.equal(renderer.status, "ready");
        await renderer.ready();
    } finally {
        renderer.dispose();
    }
});

test("device loss resolves pending waits and recovery starts a fresh count", async (t) => {
    const platform = platformFor(t);
    const renderer = await WebGPURenderer.create(platform.canvas, 64, 64, () => {});
    try {
        const lost = platform.devices[0],
            gate = deferred<void>();
        platform.delayDevice(gate.promise);
        renderer.render(drawable());
        const pending = track(renderer.submittedWorkDone());
        // The lost device never completes its queue: the wait must not depend on it.
        lost.loss.resolve({ reason: "unknown", message: "Controlled loss" });
        await turn();
        assert.equal(renderer.status, "recovering");
        assert.equal(pending.state, "resolved");
        assert.equal(lost.workWaiters.length, 1);

        // A wait during recovery resolves: render() skips and nothing is in flight.
        renderer.render(drawable());
        const during = track(renderer.submittedWorkDone());
        await turn();
        assert.equal(during.state, "resolved");
        assert.equal(lost.workDoneQueries, 1);
        gate.resolve();
        await renderer.ready();
        const replacement = platform.devices[1];
        assert.equal(replacement.workDoneQueries, 0);
        renderer.render(drawable());
        const fresh = track(renderer.submittedWorkDone());
        await turn();
        assert.equal(fresh.state, "pending");
        // Only the replacement's own submissions count.
        replacement.completeWork(1);
        assert.equal(replacement.submissions, 1);
        await turn();
        assert.equal(fresh.state, "resolved");
    } finally {
        renderer.dispose();
    }
});

test("submittedWorkDone rejects after terminal recovery failure", async (t) => {
    const platform = platformFor(t);
    const renderer = await WebGPURenderer.create(platform.canvas, 64, 64, () => {});
    try {
        renderer.render(drawable());
        const pending = track(renderer.submittedWorkDone());
        platform.denyAdapter();
        platform.devices[0].loss.resolve({ reason: "unknown", message: "Controlled loss" });
        await assert.rejects(renderer.ready(), /WebGPU recovery failed/);
        assert.equal(renderer.status, "failed");
        assert.equal(pending.state, "resolved");
        await assert.rejects(renderer.submittedWorkDone(), /WebGPU recovery failed/);
    } finally {
        renderer.dispose();
    }
});

test("disposal rejects pending and later submittedWorkDone waits", async (t) => {
    const platform = platformFor(t);
    const renderer = await WebGPURenderer.create(platform.canvas, 64, 64, () => {});
    renderer.render(drawable());
    const abort = new AbortController(),
        pending = track(renderer.submittedWorkDone()),
        cancellable = track(renderer.submittedWorkDone(abort.signal));
    renderer.dispose();
    await turn();
    for (const wait of [pending, cancellable]) {
        assert.equal(wait.state, "rejected");
        assert.match(String(wait.error), /disposed/);
    }
    abort.abort(new Error("late cancel"));
    await turn();
    assert.match(String(cancellable.error), /disposed/);
    await assert.rejects(renderer.submittedWorkDone(), /disposed/);
});

test("a queue failure rejects only the affected waits", async (t) => {
    const platform = platformFor(t);
    const renderer = await WebGPURenderer.create(platform.canvas, 64, 64, () => {});
    try {
        const device = platform.devices[0],
            failure = new Error("Injected queue failure");
        renderer.render(drawable());
        const wait = track(renderer.submittedWorkDone());
        device.failWork(failure);
        await turn();
        assert.equal(wait.state, "rejected");
        assert.equal(wait.error, failure);
        assert.equal(renderer.status, "ready");
        renderer.render(drawable());
        const next = track(renderer.submittedWorkDone());
        device.completeWork();
        await turn();
        assert.equal(next.state, "resolved");
    } finally {
        renderer.dispose();
    }
});
