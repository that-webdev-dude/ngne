/** Pure resource oracle shared by the installed browser fixture and Node regression tests. */
export interface Sample {
    assets: {
        loaded: number;
        loading: number;
        leased: number;
        unleased: number;
        estimatedBytes: number;
        cleanupFailures: number;
        unknownSizes: number;
        protectedOverBudget: boolean;
        claims: { external: number; scene: number; dependency: number; renderer: number };
    };
    renderer: {
        sources: number;
        consumers: number;
        textures: number;
        uploads: number;
        manualReplacements: number;
    };
    voices: number;
    contexts: number;
    bitmaps: number;
    textures: number;
    visibility: string;
    errors: string[];
}
function equal(actual: unknown, expected: unknown, field: string): void {
    if (actual !== expected) throw Error(`${field}: expected ${expected}, received ${actual}`);
}
export function assertMounted(s: Sample): void {
    for (const field of ["loaded", "leased"] as const) equal(s.assets[field], 4, `assets.${field}`);
    for (const field of ["loading", "unleased", "cleanupFailures"] as const)
        equal(s.assets[field], 0, `assets.${field}`);
    for (const [field, count] of Object.entries({
        external: 0,
        scene: 4,
        dependency: 0,
        renderer: 2,
    }))
        equal(s.assets.claims[field as keyof Sample["assets"]["claims"]], count, `claims.${field}`);
    equal(s.assets.unknownSizes, 1, "unknownSizes");
    equal(s.assets.protectedOverBudget, true, "protectedOverBudget");
    for (const [field, count] of Object.entries({
        sources: 2,
        consumers: 2,
        textures: 3,
        uploads: 0,
        manualReplacements: 0,
    }))
        equal(s.renderer[field as keyof Sample["renderer"]], count, `renderer.${field}`);
    equal(s.voices, 1, "voices");
    equal(s.contexts, 1, "contexts");
    equal(s.bitmaps, 2, "bitmaps");
    equal(s.textures, 3, "textures");
    equal(s.visibility, "visible", "visibility");
    equal(s.errors.length, 0, "errors");
}
export function assertDisposed(s: Sample): void {
    equal(s.errors.length, 0, "errors");
    for (const field of [
        "loaded",
        "loading",
        "leased",
        "unleased",
        "estimatedBytes",
        "cleanupFailures",
    ] as const)
        equal(s.assets[field], 0, `assets.${field}`);
    for (const [field, value] of Object.entries(s.assets.claims))
        equal(value, 0, `claims.${field}`);
    for (const field of ["sources", "consumers", "textures", "uploads"] as const)
        equal(s.renderer[field], 0, `renderer.${field}`);
    for (const field of ["voices", "contexts", "bitmaps", "textures"] as const)
        equal(s[field], 0, field);
}

export function readSample(value: unknown): Sample {
    function object(v: unknown): Record<string, unknown> {
        if (!v || typeof v !== "object" || Array.isArray(v)) throw Error("Invalid resource object");
        return v as Record<string, unknown>;
    }
    const s = object(value),
        a = object(s.assets),
        r = object(s.renderer),
        claims = object(a.claims);
    for (const [record, keys] of [
        [s, ["voices", "contexts", "bitmaps", "textures"]],
        [
            a,
            [
                "loaded",
                "loading",
                "leased",
                "unleased",
                "estimatedBytes",
                "cleanupFailures",
                "unknownSizes",
            ],
        ],
        [r, ["sources", "consumers", "textures", "uploads", "manualReplacements"]],
        [claims, ["external", "scene", "dependency", "renderer"]],
    ] as const)
        for (const key of keys)
            if (
                typeof record[key] !== "number" ||
                !Number.isFinite(record[key]) ||
                Number(record[key]) < 0
            )
                throw Error(`Invalid resource counter ${key}`);
    if (
        typeof a.protectedOverBudget !== "boolean" ||
        typeof s.visibility !== "string" ||
        !Array.isArray(s.errors) ||
        !s.errors.every((e) => typeof e === "string")
    )
        throw Error("Invalid resource flags");
    return s as unknown as Sample;
}
