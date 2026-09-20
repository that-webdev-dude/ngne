export interface Asset<T = unknown> {
    readonly id: string;
    readonly kind?: "image" | "audio";
    /** Decoded payload estimate; absent/undefined means unknown. */
    estimateBytes?(value: T): number | undefined;
    load(signal: AbortSignal): Promise<T>;
    dispose?(value: T): void;
}
export interface Lease<T = unknown> {
    readonly id: string;
    readonly value: T;
    release(): void;
}
export interface ImageAsset extends Asset<ImageBitmap> {
    readonly kind: "image";
}
export function imageAsset(id: string, url: string): ImageAsset {
    return {
        id,
        kind: "image",
        estimateBytes: (bitmap) => bitmap.width * bitmap.height * 4,
        async load(signal) {
            const response = await fetch(url, { signal });
            if (!response.ok) throw new Error(`Image load failed: ${response.status}`);
            return createImageBitmap(await response.blob(), {
                premultiplyAlpha: "none",
                colorSpaceConversion: "none",
            });
        },
        dispose: (bitmap) => bitmap.close(),
    };
}
type Entry = {
    // Private heterogeneous registry: identity is checked before the typed acquire returns.
    definition: Asset<any>;
    controller: AbortController;
    promise: Promise<any>;
    refs: number;
    value?: any;
    loaded: boolean;
    bytes?: number;
    order: number;
    claims: Record<AssetClaim, number>;
};
export type AssetClaim = "external" | "scene" | "dependency" | "renderer";
export interface AssetRetention {
    readonly maxEntries?: number;
    readonly maxBytes?: number;
}
export interface AssetsOptions {
    readonly retention?: AssetRetention;
    readonly diagnostic?: (error: unknown) => void;
}
export interface AssetEntryInspection {
    readonly id: string;
    readonly loaded: boolean;
    readonly estimatedBytes: number | undefined;
    readonly claims: Readonly<Record<AssetClaim, number>>;
}
export interface AssetInspection {
    readonly loaded: number;
    readonly loading: number;
    readonly leased: number;
    readonly unleased: number;
    readonly claims: Readonly<Record<AssetClaim, number>>;
    readonly estimatedBytes: number;
    readonly imageBytes: number;
    readonly audioBytes: number;
    readonly unknownSizes: number;
    readonly overBudget: boolean;
    readonly protectedOverBudget: boolean;
    readonly cleanupFailures: number;
    readonly entries: readonly AssetEntryInspection[];
    readonly truncated: boolean;
}
function claims(): Record<AssetClaim, number> {
    return { external: 0, scene: 0, dependency: 0, renderer: 0 };
}
/** Shared decoded data; GPU uploads belong to the renderer. */
export class Assets {
    private entries = new Map<string, Entry>();
    private disposed = false;
    private order = 0;
    private cleanupFailures = 0;
    private trimming = false;
    private readonly maxEntries: number;
    private readonly maxBytes: number;
    private readonly diagnostic?: (error: unknown) => void;
    constructor(options: AssetsOptions = {}) {
        const limit = (value: number | undefined) => {
            if (value === undefined) return Infinity;
            if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid asset budget");
            return value;
        };
        this.maxEntries = limit(options.retention?.maxEntries);
        this.maxBytes = limit(options.retention?.maxBytes);
        this.diagnostic = options.diagnostic;
    }
    async acquire<T>(
        definition: Asset<T>,
        signal?: AbortSignal,
        claim: AssetClaim = "external",
    ): Promise<Lease<T>> {
        if (this.disposed || signal?.aborted) throw new Error("Asset acquisition cancelled");
        if (!Object.hasOwn(claims(), claim)) throw new Error("Invalid asset claim");
        let entry = this.entries.get(definition.id);
        if (entry && entry.definition !== definition)
            throw new Error(`Conflicting asset identity: ${definition.id}`);
        if (!entry) {
            const controller = new AbortController();
            entry = {
                definition,
                controller,
                refs: 0,
                loaded: false,
                order: 0,
                claims: claims(),
                promise: Promise.resolve().then(() => definition.load(controller.signal)),
            };
            const owned = entry;
            entry.promise = entry.promise
                .then((value) => {
                    if (controller.signal.aborted || this.disposed) {
                        try {
                            definition.dispose?.(value);
                        } catch (error) {
                            this.cleanupFailures++;
                            this.report(error);
                        }
                        throw new Error("Asset load cancelled");
                    }
                    owned.value = value;
                    owned.loaded = true;
                    const bytes = definition.estimateBytes?.(value);
                    if (bytes !== undefined && (!Number.isSafeInteger(bytes) || bytes < 0))
                        throw new Error("Invalid asset byte estimate: " + definition.id);
                    owned.bytes = bytes;
                    this.autoTrim();
                    return value;
                })
                .catch((error: unknown) => {
                    if (this.entries.get(definition.id) === owned)
                        this.entries.delete(definition.id);
                    if (owned.loaded) {
                        owned.loaded = false;
                        try {
                            definition.dispose?.(owned.value);
                        } catch (cleanup) {
                            this.cleanupFailures++;
                            throw new AggregateError([error, cleanup], "Asset load cleanup failed");
                        } finally {
                            owned.value = undefined;
                        }
                    }
                    throw error;
                });
            this.entries.set(definition.id, entry);
        }
        entry.refs++;
        entry.claims[claim]++;
        entry.order = ++this.order;
        const owned = entry;
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            owned.refs--;
            owned.claims[claim]--;
            if (!owned.refs && !owned.loaded) {
                owned.controller.abort();
                if (this.entries.get(definition.id) === owned) this.entries.delete(definition.id);
            }
            this.autoTrim();
        };
        let abort!: () => void;
        const cancelled = new Promise<never>((_, reject) => {
            abort = () => {
                release();
                reject(new Error("Asset acquisition cancelled"));
            };
            signal?.addEventListener("abort", abort, { once: true });
        });
        try {
            const value = await Promise.race([entry.promise, cancelled]);
            if (signal?.aborted || this.disposed || owned.controller.signal.aborted)
                throw new Error("Asset acquisition cancelled");
            return { id: definition.id, value, release };
        } catch (e) {
            release();
            throw e;
        } finally {
            signal?.removeEventListener("abort", abort);
        }
    }
    private autoTrim(): void {
        try {
            this.trim();
        } catch (error) {
            this.report(error);
        }
    }
    private report(error: unknown): void {
        try {
            this.diagnostic?.(error);
        } catch {
            /* Observation cannot interrupt release. */
        }
    }
    private remove(entry: Entry): void {
        if (this.entries.get(entry.definition.id) === entry)
            this.entries.delete(entry.definition.id);
        entry.controller.abort();
        if (!entry.loaded) return;
        entry.loaded = false;
        const value = entry.value;
        entry.value = undefined;
        try {
            entry.definition.dispose?.(value);
        } catch (error) {
            this.cleanupFailures++;
            throw error;
        }
    }
    trim(): void {
        if (this.trimming || (this.maxEntries === Infinity && this.maxBytes === Infinity)) return;
        this.trimming = true;
        const errors: unknown[] = [];
        try {
            for (;;) {
                let count = 0,
                    bytes = 0;
                const eligible: Entry[] = [];
                for (const entry of this.entries.values())
                    if (entry.loaded) {
                        count++;
                        bytes += entry.bytes ?? 0;
                        if (!entry.refs) eligible.push(entry);
                    }
                eligible.sort((a, b) => a.order - b.order);
                const selected: Entry[] = [];
                for (const entry of eligible) {
                    if (count <= this.maxEntries && bytes <= this.maxBytes) break;
                    // A disposer may release other leases or reenter this service.
                    if (this.entries.get(entry.definition.id) !== entry || entry.refs) continue;
                    count--;
                    bytes -= entry.bytes ?? 0;
                    selected.push(entry);
                }
                if (!selected.length) break;
                // End registry membership for the complete eviction batch before invoking user cleanup.
                for (const entry of selected) this.entries.delete(entry.definition.id);
                for (const entry of selected)
                    try {
                        this.remove(entry);
                    } catch (error) {
                        errors.push(error);
                    }
                // Cleanup may release another dependency; account for those newly eligible entries too.
            }
        } finally {
            this.trimming = false;
        }
        if (errors.length) throw new AggregateError(errors, "Asset trim failed");
    }
    evict(id: string): boolean {
        const entry = this.entries.get(id);
        if (!entry?.loaded || entry.refs) return false;
        try {
            this.remove(entry);
        } catch (error) {
            throw new AggregateError([error], "Asset eviction failed");
        }
        return true;
    }
    inspect(limit = 100): AssetInspection {
        if (!Number.isSafeInteger(limit) || limit < 0 || limit > 1000)
            throw new Error("Invalid asset inspection limit");
        let loaded = 0,
            loading = 0,
            leased = 0,
            unleased = 0,
            estimatedBytes = 0;
        let imageBytes = 0,
            audioBytes = 0,
            unknownSizes = 0,
            protectedCount = 0,
            protectedBytes = 0;
        const totals = claims(),
            entries: AssetEntryInspection[] = [];
        for (const [id, entry] of this.entries) {
            if (entry.refs) leased++;
            else unleased++;
            for (const key of Object.keys(totals) as AssetClaim[]) totals[key] += entry.claims[key];
            if (entry.loaded) {
                loaded++;
                estimatedBytes += entry.bytes ?? 0;
                if (entry.bytes === undefined) unknownSizes++;
                if (entry.definition.kind === "image") imageBytes += entry.bytes ?? 0;
                if (entry.definition.kind === "audio") audioBytes += entry.bytes ?? 0;
                if (entry.refs) {
                    protectedCount++;
                    protectedBytes += entry.bytes ?? 0;
                }
            } else loading++;
            if (entries.length < limit)
                entries.push(
                    Object.freeze({
                        id,
                        loaded: entry.loaded,
                        estimatedBytes: entry.bytes,
                        claims: Object.freeze({ ...entry.claims }),
                    }),
                );
        }
        return Object.freeze({
            loaded,
            loading,
            leased,
            unleased,
            claims: Object.freeze(totals),
            estimatedBytes,
            imageBytes,
            audioBytes,
            unknownSizes,
            overBudget: loaded > this.maxEntries || estimatedBytes > this.maxBytes,
            protectedOverBudget: protectedCount > this.maxEntries || protectedBytes > this.maxBytes,
            cleanupFailures: this.cleanupFailures,
            entries: Object.freeze(entries),
            truncated: this.entries.size > entries.length,
        });
    }
    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        const errors: unknown[] = [];
        const entries = [...this.entries.values()];
        this.entries.clear();
        for (const e of entries) {
            try {
                this.remove(e);
            } catch (error) {
                errors.push(error);
            }
        }
        if (errors.length) throw new AggregateError(errors, "Asset disposal failed");
    }
}
