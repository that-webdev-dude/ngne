import assert from "node:assert/strict";
import { test } from "node:test";
import { Assets, type Asset } from "../src/assets.js";

test("repeated bounded churn preserves exact survivor claims across cancellation and late completions", async () => {
    const assets = new Assets({ retention: { maxEntries: 3, maxBytes: 12 } });
    const loads = new Map<string, number>(),
        disposals = new Map<string, number>();
    const definitions: Asset<number>[] = Array.from({ length: 12 }, (_, i) => ({
        id: `distinct-${i}`,
        load: async () => {
            loads.set(String(i), (loads.get(String(i)) ?? 0) + 1);
            return 8;
        },
        estimateBytes: (value) => value,
        dispose: () => disposals.set(String(i), (disposals.get(String(i)) ?? 0) + 1),
    }));
    const shared = await assets.acquire(
        { id: "shared", load: async () => 4, estimateBytes: (v) => v },
        undefined,
        "scene",
    );
    let lateDisposals = 0;
    for (let visit = 0; visit < 120; visit++) {
        const lease = await assets.acquire(definitions[visit % 12], undefined, "scene");
        assert.equal(assets.inspect().claims.scene, 2);
        if (visit % 10 === 0) {
            let complete!: (value: number) => void;
            const abort = new AbortController();
            const pending = assets.acquire(
                {
                    id: `late-${visit}`,
                    load: () =>
                        new Promise<number>((resolve) => {
                            complete = resolve;
                        }),
                    estimateBytes: (value) => value,
                    dispose: () => {
                        lateDisposals++;
                    },
                },
                abort.signal,
                "scene",
            );
            const rejected = assert.rejects(pending, /cancelled/);
            await Promise.resolve();
            abort.abort();
            await rejected;
            complete(8);
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.equal(assets.inspect().claims.scene, 2);
            assert.equal(assets.inspect().loading, 0);
        }
        lease.release();
        assets.trim();
        const snapshot = assets.inspect();
        assert.equal(snapshot.claims.scene, 1);
        assert.equal(snapshot.leased, 1);
        assert.equal(snapshot.loaded, 2);
        assert.equal(snapshot.unleased, 1);
        assert.equal(snapshot.estimatedBytes, 12);
        assert.equal(snapshot.overBudget, false);
    }
    assert.equal(lateDisposals, 12);
    for (const count of loads.values()) assert.equal(count, 10);
    shared.release();
    assets.dispose();
    assert.equal(assets.inspect().loaded, 0);
    assert.equal(assets.inspect().claims.scene, 0);
    assert.deepEqual(disposals, loads);
});
