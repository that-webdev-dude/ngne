/** Detached diagnostic data, not a serialization or restoration format. */
export type InspectionValue =
    | string
    | number
    | boolean
    | bigint
    | null
    | undefined
    | readonly InspectionValue[]
    | { readonly [key: string]: InspectionValue };

/** Copy enumerable data without exposing object identity, methods or entity ownership. */
export function inspectValue(
    value: unknown,
    seen = new Map<object, InspectionValue>(),
): InspectionValue {
    if (typeof value === "symbol") return value.description;
    if (typeof value === "function") return "[Function]";
    if (
        value === null ||
        value === undefined ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        typeof value === "bigint"
    )
        return value;
    const previous = seen.get(value);
    if (previous !== undefined) return previous;
    if (value instanceof Map || value instanceof Set || Array.isArray(value)) {
        const copy: InspectionValue[] = [];
        seen.set(value, copy);
        for (const item of value) copy.push(inspectValue(item, seen));
        return Object.freeze(copy);
    }
    const copy: Record<string, InspectionValue> = {};
    seen.set(value, copy);
    for (const [key, child] of Object.entries(value))
        Object.defineProperty(copy, key, {
            value: inspectValue(child, seen),
            enumerable: true,
        });
    return Object.freeze(copy);
}
