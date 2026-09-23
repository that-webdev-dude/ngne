import { object } from "./schema.js";

/** Explicit format selection only. Actual data validation remains with the existing readers. */
export function legacyFormat(
    family: string,
    manifest: unknown,
): "content-legacy" | "benchmark-legacy" {
    const m = object(manifest);
    const unsupported = () => {
        throw Error(
            "Unsupported legacy format: select content-legacy or benchmark-legacy with a documented fixture variant; remeasure new/unknown formats",
        );
    };
    if (m.format !== undefined || m.documentType !== undefined) return unsupported();
    if (
        family === "content-legacy" &&
        m.schemaVersion === undefined &&
        ["policy", "os", "package", "installed", "build", "source", "harness"].every((k) => k in m)
    )
        return family;
    if (
        family === "benchmark-legacy" &&
        [1, 2].includes(Number(m.schemaVersion)) &&
        typeof m.schemaVersion === "number" &&
        Array.isArray(m.stages) &&
        m.parameters &&
        m.environment
    )
        return family;
    return unsupported();
}
