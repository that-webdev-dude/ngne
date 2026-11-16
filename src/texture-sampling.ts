import type { TextureSampling } from "./assets.js";

/** Validated, frozen sampling fixed for one texture registration's lifetime. */
export interface Sampling {
    readonly filter: "nearest" | "linear";
    readonly address: "clamp" | "repeat";
}

export const DEFAULT_SAMPLING: Sampling = Object.freeze({ filter: "nearest", address: "clamp" });

/** Reads caller fields once; rejects unknown keys and values so typos cannot fall back silently. */
export function normalizeSampling(sampling: TextureSampling | undefined): Sampling {
    if (sampling === undefined) return DEFAULT_SAMPLING;
    if (typeof sampling !== "object" || sampling === null || Array.isArray(sampling))
        throw new Error("Invalid texture sampling");
    for (const key of Object.keys(sampling))
        if (key !== "filter" && key !== "address") throw new Error("Invalid texture sampling");
    const { filter = "nearest", address = "clamp" } = sampling;
    if (
        (filter !== "nearest" && filter !== "linear") ||
        (address !== "clamp" && address !== "repeat")
    )
        throw new Error("Invalid texture sampling");
    return filter === "nearest" && address === "clamp"
        ? DEFAULT_SAMPLING
        : Object.freeze({ filter, address });
}
