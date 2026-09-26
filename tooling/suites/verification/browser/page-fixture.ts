// Replaces the WebGPU entry point so adapter requests resolve null, before the page entry loads.
const NULL_ADAPTER = `Object.defineProperty(navigator, "gpu", { value: {
    requestAdapter: async () => null,
    getPreferredCanvasFormat: () => "bgra8unorm",
} });`;

/** Loads a real game page in a same-origin iframe whose WebGPU adapter request resolves null. */
export async function withFixture(
    pagePath: string,
    title: string,
    prompt: string | undefined,
    run: (doc: () => Document | null | undefined) => Promise<void>,
): Promise<void> {
    const page = await (await fetch(pagePath)).text();
    const entry = /<script\s+type="module"[^>]*\bsrc="([^"]+)"[^>]*><\/script>/.exec(page);
    if (!entry) throw new Error(`${title}: page entry script not found`);
    const entryModule = new URL(entry[1], new URL(pagePath, location.href)).href;
    const container = document.createElement("section");
    container.setAttribute("aria-label", title);
    container.style.cssText =
        "position:fixed;inset:16px;z-index:10;display:flex;flex-direction:column;gap:8px;" +
        "padding:12px;background:#101727;border:2px solid #f5cf72";
    const iframe = document.createElement("iframe");
    iframe.title = title;
    iframe.style.cssText = "flex:1;width:100%;border:0";
    iframe.srcdoc = page.replace(
        entry[0],
        `<script type="module">${NULL_ADAPTER}await import(${JSON.stringify(entryModule)});document.documentElement.dataset.ngneFixtureReady="true";</script>`,
    );
    if (prompt) {
        const text = document.createElement("p");
        text.textContent = prompt;
        container.append(text);
    }
    container.append(iframe);
    document.body.append(container);
    try {
        await run(() => iframe.contentDocument);
    } finally {
        container.remove();
    }
}

export async function waitFor(condition: () => boolean, timeoutMs: number, failure: string) {
    const deadline = performance.now() + timeoutMs;
    while (!condition()) {
        if (performance.now() > deadline) throw new Error(failure);
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}
