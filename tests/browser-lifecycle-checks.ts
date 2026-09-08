import { BrowserGame, type FrameScheduler } from "../src/index.js";

export async function checkBrowserLifecycle(check: (value: unknown, message: string) => void): Promise<void> {
    const create = () => {
        const callbacks: FrameRequestCallback[] = [];
        let failRequest = false;
        let failCancel = false;
        const scheduler: FrameScheduler = {
            request(callback) {
                callbacks.push(callback);
                if (failRequest) throw new Error("request failed");
                return callbacks.length;
            },
            cancel() { if (failCancel) throw new Error("cancel failed"); },
        };
        const app = new BrowserGame({
            canvas: document.createElement("canvas"), seed: 1,
            state: { score: 0 }, transition: (state) => ({ score: state.score + 1 }),
            scheduler,
        });
        const prepare = () => app.game.prepare({
            id: "lifecycle",
            setup(scene) {
                const resource = scene.resource("counter", { value: 0 });
                const random = scene.random("test");
                const state = scene.state<{ score: number }, undefined>();
                scene.system(() => {
                    resource.value++;
                    random.next();
                    state.dispatch(undefined);
                    scene.freeze(3);
                });
            },
        }, { key: "lifecycle" });
        return { app, callbacks, prepare, failRequest: () => { failRequest = true; }, failCancel: () => { failCancel = true; } };
    };

    {
        const { app, callbacks, prepare } = create();
        const starting = app.start(await prepare());
        await rejects(app.start(), "already pending");
        await starting;
        app.game.tick();
        const before = app.game.enumerate();
        await app.stop();
        check(JSON.stringify(app.game.enumerate()) === JSON.stringify(before), "stop preserves scene identity, resources, RNG, freeze and committed state");
        const old = callbacks[0];
        const resume = Promise.withResolvers<void>();
        app.audio.resume = () => resume.promise;
        const pending = app.start();
        await rejects(app.start(), "already pending");
        await rejects(app.stop(), "already pending");
        resume.resolve();
        await pending;
        const count = callbacks.length;
        old(100);
        old(117);
        check(callbacks.length === count && JSON.stringify(app.game.enumerate()) === JSON.stringify(before), "repeated start and stop during resume reject without corruption; old callbacks stay invalid after restart");
        const suspend = Promise.withResolvers<void>();
        app.audio.suspend = () => suspend.promise;
        const stopping = app.stop();
        await rejects(app.start(), "already pending");
        await rejects(app.stop(), "already pending");
        suspend.resolve();
        await stopping;
        check(app.game.lifecycle === "Stopped", "start and repeated stop during suspension reject without corrupting stop");
        await app.dispose();
    }

    for (const rejectResume of [false, true]) {
        const { app, callbacks, prepare } = create();
        await app.start(await prepare());
        await app.stop();
        const resume = Promise.withResolvers<void>();
        app.audio.resume = () => resume.promise;
        const pending = app.start();
        const rejected = rejects(pending, rejectResume ? "resume failed" : "cancelled");
        const close = Promise.withResolvers<void>();
        app.audio.dispose = () => close.promise;
        const disposal = app.dispose();
        check(app.game.lifecycle === "Disposed" && app.game.scenes.length === 0 && disposal === app.dispose(), "disposal tears down synchronously and repeated calls share completion");
        if (rejectResume) resume.reject(new Error("resume failed"));
        else resume.resolve();
        await rejected;
        callbacks[0](100);
        await rejects(app.start(), "disposed");
        await rejects(app.stop(), "disposed");
        close.resolve();
        await disposal;
        check(app.game.lifecycle === "Disposed" && callbacks.length === 1, `late resume ${rejectResume ? "failure" : "success"} cannot resurrect a disposed host`);
    }

    {
        const { app, callbacks, prepare } = create();
        const starting = app.start(await prepare());
        const rejected = rejects(starting, "cancelled");
        await app.dispose();
        await rejected;
        callbacks[0](100);
        check(app.game.lifecycle === "Disposed" && callbacks.length === 1, "dispose during cold startup completion never enables frames");
    }

    {
        const { app, prepare } = create();
        await app.start(await prepare());
        await app.stop();
        const before = JSON.stringify(app.game.enumerate());
        app.audio.resume = () => Promise.reject(new Error("resume failed"));
        await rejects(app.start(), "resume failed");
        check(app.game.lifecycle === "Failed" && JSON.stringify(app.game.enumerate()) === before, "audio resume failure preserves mounted state for disposal");
        await app.dispose();
    }

    for (const incomplete of [false, true]) {
        const fixture = create();
        fixture.failRequest();
        if (incomplete) fixture.failCancel();
        await rejects(fixture.app.start(await fixture.prepare()));
        check(fixture.app.game.lifecycle === (incomplete ? "Failed" : "Stopped") && fixture.app.game.scenes.length === 0, `cold startup ${incomplete ? "incomplete" : "complete"} rollback retains its failure semantics`);
        await fixture.app.dispose().catch((error: unknown) => { if (!incomplete) throw error; });
    }

    {
        const fixture = create();
        await fixture.app.start(await fixture.prepare());
        await fixture.app.stop();
        const id = fixture.app.game.scenes[0].id;
        fixture.failRequest();
        await rejects(fixture.app.start());
        check(fixture.app.game.lifecycle === "Failed" && fixture.app.game.scenes[0].id === id, "resume scheduler failure preserves mounted scene");
        await fixture.app.dispose();
    }

    {
        const { app, prepare } = create();
        await app.start(await prepare());
        const suspend = Promise.withResolvers<void>();
        app.audio.suspend = () => suspend.promise;
        const stopping = rejects(app.stop(), "Stop failed");
        await app.dispose();
        suspend.reject(new Error("suspend failed"));
        await stopping;
        check(app.game.lifecycle === "Disposed", "late stop failure cannot overwrite terminal disposal");
    }

    {
        const fixture = create();
        await fixture.app.start(await fixture.prepare());
        const attempted: string[] = [];
        fixture.failCancel();
        fixture.app.audio.dispose = async () => { attempted.push("audio"); throw new Error("audio failed"); };
        const renderer = fixture.app.renderer;
        if (!renderer) throw new Error("Renderer missing");
        const disposeRenderer = renderer.dispose.bind(renderer);
        renderer.dispose = () => { attempted.push("renderer"); disposeRenderer(); throw new Error("renderer failed"); };
        const disposeInput = fixture.app.input.dispose.bind(fixture.app.input);
        fixture.app.input.dispose = () => { attempted.push("input"); disposeInput(); throw new Error("input failed"); };
        try {
            await fixture.app.dispose();
            throw new Error("Expected disposal rejection");
        } catch (error) {
            check(error instanceof AggregateError && error.errors.length === 4 && attempted.join() === "audio,renderer,input" && fixture.app.game.lifecycle === "Disposed", "all independent teardown actions run and aggregate original failures");
        }
    }
}

async function rejects(promise: Promise<unknown>, message?: string): Promise<void> {
    try { await promise; } catch (error) {
        if (!message || (error instanceof Error && error.message.includes(message))) return;
        throw error;
    }
    throw new Error("Expected lifecycle rejection");
}
