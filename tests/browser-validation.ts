import { BrowserGame, type FrameScheduler } from "../src/index.js";

export async function checkBrowserHost(
    check: (condition: unknown, message: string) => void,
): Promise<void> {
    const surface = document.createElement("canvas");
    let callback: FrameRequestCallback = () => {};
    let cancelled = 0;
    let failFrame = false;
    const scheduler: FrameScheduler = {
        request: (fn) => {
            callback = fn;
            return 1;
        },
        cancel: () => {
            cancelled++;
        },
    };
    const app = new BrowserGame({
        canvas: surface,
        seed: 1,
        state: {},
        transition: (s) => s,
        scheduler,
        afterFrame: () => {
            if (failFrame) throw new Error("Injected frame failure");
        },
    });
    let updates = 0;
    const candidate = await app.game.prepare(
        {
            id: "test",
            setup(s) {
                s.system(() => updates++);
            },
        },
        { key: "test" },
    );
    await app.start(candidate);
    callback(100);
    callback(117);
    check(updates === 1, "browser host drives fixed simulation");
    const mounted = app.game.scenes[0];
    await app.stop();
    callback(10000);
    check(updates === 1, "late callbacks after stop do no work");
    await app.start();
    callback(20000);
    callback(20017);
    check(
        updates === 2 && app.game.scenes[0].id === mounted.id,
        "resume preserves scene and resets wall-clock accumulator",
    );
    failFrame = true;
    callback(20034);
    check(
        app.game.lifecycle === "Failed",
        "browser frame faults enter Failed through the internal boundary",
    );
    await app.dispose();
    check(app.game.lifecycle === "Disposed" && cancelled >= 2, "browser teardown completes");
}
