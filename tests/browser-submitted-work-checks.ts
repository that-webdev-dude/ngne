import { Frame, WebGPURenderer } from "../src/index.js";

/** Real GPU queue completion; controlled `device.destroy()` is not a physical driver failure. */
export async function checkBrowserSubmittedWork(
    check: (condition: unknown, message: string) => void,
): Promise<void> {
    const real = navigator.gpu;
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "gpu");
    const devices: GPUDevice[] = [];
    const gpu = new Proxy(real, {
        get(target, key) {
            if (key === "requestAdapter")
                return async (options?: GPURequestAdapterOptions) => {
                    const adapter = await target.requestAdapter(options);
                    if (!adapter) return null;
                    return new Proxy(adapter, {
                        get(target, key) {
                            if (key === "requestDevice")
                                return async (options?: GPUDeviceDescriptor) => {
                                    const device = await target.requestDevice(options);
                                    devices.push(device);
                                    return device;
                                };
                            const value = Reflect.get(target, key, target);
                            return typeof value === "function" ? value.bind(target) : value;
                        },
                    });
                };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
    Object.defineProperty(navigator, "gpu", { configurable: true, value: gpu });
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    let renderer: WebGPURenderer | undefined;
    try {
        renderer = await WebGPURenderer.create(canvas, 64, 64, () => {});
        const frame = new Frame();
        frame.rect(8, 8, 32, 32, 0x40c080);

        for (let i = 0; i < 8; i++) renderer.render(frame);
        await settles(renderer.submittedWorkDone());
        check(true, "submitted work completion resolves after real WebGPU frames");

        // A host-side budget of two frames in flight, gated only by completion waits.
        let inFlight = 0,
            peak = 0;
        const waits = new Set<Promise<void>>();
        for (let i = 0; i < 24; i++) {
            while (inFlight >= 2) await Promise.race(waits);
            renderer.render(frame);
            inFlight++;
            peak = Math.max(peak, inFlight);
            const wait = renderer.submittedWorkDone().finally(() => {
                inFlight--;
                waits.delete(wait);
            });
            waits.add(wait);
        }
        await settles(Promise.all(waits));
        check(peak <= 2 && inFlight === 0, "submitted work completion throttles a host budget");

        const abort = new AbortController(),
            reason = new Error("host cancelled");
        renderer.render(frame);
        const cancelled = renderer.submittedWorkDone(abort.signal);
        abort.abort(reason);
        check((await outcome(cancelled)) === reason, "cancelled completion wait rejects");
        check(renderer.status === "ready", "cancelled completion wait leaves renderer ready");

        renderer.render(frame);
        const lost = renderer.submittedWorkDone();
        devices[0]?.destroy();
        check((await outcome(lost)) === undefined, "completion wait resolves on device loss");
        await renderer.ready();
        renderer.render(frame);
        await settles(renderer.submittedWorkDone());
        check(devices.length === 2, "completion wait uses the replacement device after recovery");

        renderer.render(frame);
        const disposed = renderer.submittedWorkDone();
        renderer.dispose();
        check(
            /disposed/.test(messageOf(await outcome(disposed))),
            "disposal rejects a pending completion wait",
        );
        check(
            /disposed/.test(messageOf(await outcome(renderer.submittedWorkDone()))),
            "completion wait rejects after disposal",
        );
    } finally {
        renderer?.dispose();
        if (descriptor) Object.defineProperty(navigator, "gpu", descriptor);
        else Reflect.deleteProperty(navigator, "gpu");
    }
}

/** Fails instead of hanging when GPU work never completes. */
async function settles<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            work,
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error("Submitted work did not complete in 10 s")),
                    10_000,
                );
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}
/** An Error's message; anything else, including resolution, has none. */
function messageOf(reason: unknown): string {
    return reason instanceof Error ? reason.message : "";
}
/** Undefined for resolution, otherwise the rejection reason. */
async function outcome(work: Promise<void>): Promise<unknown> {
    try {
        await settles(work);
        return undefined;
    } catch (error) {
        return error ?? new Error("Rejected without a reason");
    }
}
