export interface Asset<T = unknown> {
  readonly id: string;
  load(signal: AbortSignal): Promise<T>;
  dispose?(value: T): void;
}
export interface Lease<T = unknown> {
  readonly id: string;
  readonly value: T;
  release(): void;
}
export function imageAsset(id: string, url: string): Asset<ImageBitmap> {
  return {
    id,
    async load(signal) {
      const response = await fetch(url, { signal });
      if (!response.ok)
        throw new Error(`Image load failed: ${response.status}`);
      return createImageBitmap(await response.blob());
    },
    dispose: (bitmap) => bitmap.close(),
  };
}
type Entry = {
  definition: Asset<any>;
  controller: AbortController;
  promise: Promise<any>;
  refs: number;
  value?: any;
  loaded: boolean;
};
/** Shared decoded data; GPU uploads belong to the renderer. */
export class Assets {
  private entries = new Map<string, Entry>();
  private disposed = false;
  async acquire<T>(
    definition: Asset<T>,
    signal?: AbortSignal,
  ): Promise<Lease<T>> {
    if (this.disposed || signal?.aborted)
      throw new Error("Asset acquisition cancelled");
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
        promise: Promise.resolve().then(() =>
          definition.load(controller.signal),
        ),
      };
      const owned = entry;
      entry.promise = entry.promise.then((value) => {
        if (controller.signal.aborted || this.disposed) {
          definition.dispose?.(value);
          throw new Error("Asset load cancelled");
        }
        owned.value = value;
        owned.loaded = true;
        return value;
      });
      this.entries.set(definition.id, entry);
    }
    entry.refs++;
    const owned = entry;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      owned.refs--;
      if (!owned.refs && !owned.loaded) {
        owned.controller.abort();
        if (this.entries.get(definition.id) === owned)
          this.entries.delete(definition.id);
      }
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
      if (signal?.aborted) throw new Error("Asset acquisition cancelled");
      return { id: definition.id, value, release };
    } catch (e) {
      release();
      throw e;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
  dispose() {
    this.disposed = true;
    const errors: unknown[] = [];
    for (const e of this.entries.values()) {
      e.controller.abort();
      try {
        if (e.loaded) e.definition.dispose?.(e.value);
      } catch (error) {
        errors.push(error);
      }
    }
    this.entries.clear();
    if (errors.length)
      throw new AggregateError(errors, "Asset disposal failed");
  }
}
