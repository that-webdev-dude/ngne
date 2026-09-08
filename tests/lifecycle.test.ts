import assert from "node:assert/strict";
import { test } from "node:test";

import { Game, type Asset, type SceneDefinition } from "../src/index.js";

test("stopping before first start cancels preparation and releases late data", async () => {
    const game = new Game({ seed: 1, state: {}, transition: (s) => s });
    const loading = Promise.withResolvers<object>();
    const released = Promise.withResolvers<void>();
    const definition: SceneDefinition = {
        id: "slow", setup() {},
        assets: [{ id: "slow", load: () => loading.promise, dispose: () => released.resolve() }],
    };
    const pending = game.prepare(definition, { key: "slow" });
    const rejected = assert.rejects(pending, /preparation failed/);
    game.stop();
    await rejected;
    loading.resolve({});
    await released.promise;
    assert.equal(game.lifecycle, "Stopped");
    assert.equal(game.scenes.length, 0);
    game.dispose();
});

test("cancelling one preparation preserves another consumer of its shared load", async () => {
    const game = new Game({ seed: 1, state: {}, transition: (s) => s });
    const loading = Promise.withResolvers<object>();
    const entered = Promise.withResolvers<AbortSignal>();
    let releases = 0;
    const asset: Asset<object> = {
        id: "shared", load(signal) { entered.resolve(signal); return loading.promise; },
        dispose() { releases++; },
    };
    const definition: SceneDefinition = { id: "shared", assets: [asset], setup() {} };
    const cancel = new AbortController();
    const first = game.prepare(definition, { key: "one", signal: cancel.signal });
    const second = game.prepare(definition, { key: "two" });
    const rejected = assert.rejects(first);
    const signal = await entered.promise;
    cancel.abort();
    await rejected;
    assert.equal(signal.aborted, false);
    loading.resolve({});
    await game.start(await second);
    assert.equal(game.scenes[0].key, "two");
    game.dispose();
    assert.equal(releases, 1);
});

test("disposal rejects pending preparation and stays terminal after late resolution or rejection", async () => {
    for (const failLoad of [false, true]) {
        const game = new Game({ seed: 1, state: {}, transition: (s) => s });
        const loading = Promise.withResolvers<object>();
        const settled = Promise.withResolvers<void>();
        const pending = game.prepare({
            id: "late", setup() {}, assets: [{
                id: "late", load: () => loading.promise,
                dispose: () => settled.resolve(),
            }],
        }, { key: "late" });
        const rejected = assert.rejects(pending);
        await Promise.resolve();
        game.dispose();
        await rejected;
        if (failLoad) {
            loading.reject(new Error("late failure"));
            await assert.rejects(loading.promise);
        } else {
            loading.resolve({});
            await settled.promise;
        }
        await assert.rejects(game.start(), /Disposed/);
        await assert.rejects(game.prepare({ id: "new", setup() {} }, { key: "new" }), /Disposed/);
        assert.equal(game.scenes.length, 0);
        assert.equal(game.lifecycle, "Disposed");
    }
});

test("cold rollback attempts scene cleanup despite loop cleanup failure and retains both errors", async () => {
    const game = new Game({ seed: 1, state: {}, transition: (s) => s });
    const startup = new Error("startup");
    const cleanup = new Error("loop cleanup");
    let cleaned = false;
    const scene = await game.prepare({ id: "initial", setup(s) { s.defer(() => { cleaned = true; }); } }, { key: "initial" });
    await assert.rejects(game.start(scene, {
        start() { throw startup; }, stop() { throw cleanup; },
    }), (error: unknown) => error instanceof AggregateError && error.errors[0] === startup && error.errors[1] === cleanup);
    assert.equal(cleaned, true);
    assert.equal(game.lifecycle, "Failed");
    assert.equal(game.scenes.length, 0);
    game.dispose();
});
