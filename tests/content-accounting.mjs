import assert from "node:assert/strict";

// Shared correctness oracle, independent of latency and noisy heap measurements.
export function assertMounted(sample) {
    const { assets: a, renderer: r } = sample.diagnostics;
    assert.equal(a.loaded, 4);
    assert.equal(a.loading, 0);
    assert.equal(a.leased, 4);
    assert.equal(a.unleased, 0);
    assert.deepEqual(a.claims, { external: 0, scene: 4, dependency: 0, renderer: 2 });
    assert.equal(a.cleanupFailures, 0);
    assert.equal(a.protectedOverBudget, true);
    assert.equal(a.unknownSizes, 1);
    assert.equal(r.sources, 2);
    assert.equal(r.consumers, 2);
    assert.equal(r.textures, 3); // Two images and the renderer's white texture.
    assert.equal(r.uploads, 0);
    assert.equal(r.manualReplacements, 0);
    assert.equal(sample.voices, 1);
    assert.equal(sample.contexts, 1);
    assert.equal(sample.bitmaps, 2);
    assert.equal(sample.textures, 3);
    assert.equal(sample.visibility, "visible");
    assert.equal(sample.error, "");
}

export function assertDisposed(sample) {
    const a = sample.diagnostics.assets;
    for (const field of [
        "loaded",
        "loading",
        "leased",
        "unleased",
        "estimatedBytes",
        "cleanupFailures",
    ])
        assert.equal(a[field], 0, field);
    for (const value of Object.values(a.claims)) assert.equal(value, 0);
    if (sample.diagnostics.renderer) {
        for (const field of ["sources", "consumers", "textures", "uploads"])
            assert.equal(sample.diagnostics.renderer[field], 0, field);
    }
    assert.equal(sample.voices, 0);
    assert.equal(sample.contexts, 0);
    assert.equal(sample.bitmaps, 0);
    assert.equal(sample.textures, 0);
}
