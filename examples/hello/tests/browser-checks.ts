export async function checkHelloCapability(
    check: (condition: unknown, message: string) => void,
    mode: "unsupported" | "recovery",
): Promise<void> {
    const iframe = document.createElement("iframe");
    iframe.title = "Hello unsupported WebGPU capability fixture";
    const complete = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            window.removeEventListener("message", listener);
            reject(new Error("Hello capability fixture timeout"));
        }, 10000);
        const listener = (event: MessageEvent) => {
            if (
                event.source === iframe.contentWindow &&
                event.data === "ngne21-capability-complete"
            ) {
                clearTimeout(timeout);
                window.removeEventListener("message", listener);
                resolve();
            }
        };
        window.addEventListener("message", listener);
    });
    const setup =
        mode === "unsupported"
            ? 'Object.defineProperty(navigator,"gpu",{value:undefined});'
            : `
        const real=navigator.gpu;let requests=0,device;
        Object.defineProperty(navigator,"gpu",{value:{getPreferredCanvasFormat:()=>real.getPreferredCanvasFormat(),
            requestAdapter:async()=>{if(requests++)return null;const adapter=await real.requestAdapter();
                return {requestDevice:async()=>{device=await adapter.requestDevice();return device;}};}}});`;
    const finish =
        mode === "unsupported"
            ? 'parent.postMessage("ngne21-capability-complete",parent.location.origin);'
            : `
        const observer=new MutationObserver(()=>{if(document.querySelector('[role="alert"]')?.textContent.includes("WebGPU recovery failed")){
            observer.disconnect();parent.postMessage("ngne21-capability-complete",parent.location.origin);}});
        observer.observe(document.body,{childList:true,subtree:true,characterData:true});device.destroy();`;
    const pagePath = "/examples/hello/";
    const page = await (await fetch(pagePath)).text();
    const entry = /<script\s+type="module"[^>]*\bsrc="([^"]+)"[^>]*><\/script>/.exec(page);
    if (!entry) throw new Error("Hello capability fixture entry script not found");
    const entryModule = new URL(entry[1], new URL(pagePath, location.href)).href;
    iframe.srcdoc = `<canvas></canvas><script type="module">${setup}await import(${JSON.stringify(entryModule)});${finish}</script>`;
    document.body.append(iframe);
    try {
        await complete;
        // The game keeps running after terminal renderer failure; later reports must not hide it.
        await new Promise((resolve) => setTimeout(resolve, 500));
        const message = iframe.contentDocument?.querySelector('[role="alert"]')?.textContent;
        const expected =
            mode === "unsupported"
                ? "NGNE requires WebGPU. Use a supported browser with hardware acceleration enabled"
                : "WebGPU recovery failed. Reload to create a new renderer";
        check(
            message?.includes(expected),
            `hello persistently reports the exact ${mode} message: ${expected}`,
        );
    } finally {
        iframe.remove();
    }
}
