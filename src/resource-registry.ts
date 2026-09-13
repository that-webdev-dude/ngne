// Adapted from v03/gpu/createResourceRegistry.ts at
// cluster-renderer 34458a987f03b00894e98a40d39fc0ae666194f6.
/** Device-generation-local handles. A released handle is never reused. */
export interface ResourceRegistry<T extends object> {
    register(resource: T): number;
    replace(handle: number, resource: T): void;
    release(handle: number): void;
    get(handle: number): T;
    clear(): void;
    readonly size: number;
}

export function createResourceRegistry<T extends object>(): ResourceRegistry<T> {
    const byHandle = new Map<number, T>();
    const values = new Set<T>();
    let nextHandle = 0;
    return {
        register(resource: T): number {
            if (values.has(resource)) throw new Error("Resource is already registered");
            if (!Number.isSafeInteger(nextHandle))
                throw new Error("Resource handle budget exhausted");
            const handle = nextHandle++;
            byHandle.set(handle, resource);
            values.add(resource);
            return handle;
        },
        replace(handle: number, resource: T): void {
            const previous = byHandle.get(handle);
            if (!previous) throw new Error("Resource is not registered: " + handle);
            if (previous === resource) return;
            if (values.has(resource)) throw new Error("Resource is already registered");
            byHandle.set(handle, resource);
            values.delete(previous);
            values.add(resource);
        },
        release(handle: number): void {
            const resource = byHandle.get(handle);
            if (!resource) return;
            byHandle.delete(handle);
            values.delete(resource);
        },
        get(handle: number): T {
            const resource = byHandle.get(handle);
            if (!resource) throw new Error("Resource is not registered: " + handle);
            return resource;
        },
        clear(): void {
            byHandle.clear();
            values.clear();
        },
        get size(): number {
            return byHandle.size;
        },
    };
}
