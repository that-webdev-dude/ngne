import { makeAtlas } from "../demo/art.js";
import { arena, H, W, type Progress, type ProgressCommand } from "../demo/game.js";
import { BrowserGame } from "ngne";
import type { Asset, FrameScheduler, ImageAsset, Lease } from "ngne";

type Check = (condition: unknown, message: string) => void;

const PLATFORMER_UNSUPPORTED = "WebGPU adapter unavailable. Enable browser hardware acceleration";
const STARFALL_UNSUPPORTED = [
    "Unable to start Starfall. It requires WebGPU with hardware acceleration",
    "WebGPU adapter unavailable. Enable browser hardware acceleration",
];
const CLICK_TIMEOUT_MS = 120_000;
// Replaces the WebGPU entry point so adapter requests resolve null, before the page entry loads.
const NULL_ADAPTER = `Object.defineProperty(navigator, "gpu", { value: {
    requestAdapter: async () => null,
    getPreferredCanvasFormat: () => "bgra8unorm",
} });`;

/** Migrated-game browser checks for NGNE-27. */
export async function checkBrowserGames(check: Check): Promise<void> {
    await checkStarfallAtlasLifetime(check);
    await checkStarfallUnsupported(check);
    await checkPlatformerUnsupported(check);
}

/**
 * Starfall's arena on a WebGPU host with a counting atlas: the decoded atlas loads once, stays
 * alive through scene replacements, renders atlas texels after each one and is disposed once with
 * the host. Wrapping the instance's public `assets.acquire` separates the scene consumer lease from
 * the host's renderer source lease: each atlas preparation acquires the scene lease first, then the
 * host lease inside image preparation.
 */
async function checkStarfallAtlasLifetime(check: Check): Promise<void> {
    let callback: FrameRequestCallback | undefined;
    const scheduler: FrameScheduler = {
        request: (next) => {
            callback = next;
            return 1;
        },
        cancel: () => {
            callback = undefined;
        },
    };
    const counts = { loads: 0, disposals: 0 };
    const atlas: ImageAsset = {
        id: "ships",
        kind: "image",
        async load() {
            counts.loads++;
            return createImageBitmap(makeAtlas(), {
                premultiplyAlpha: "none",
                colorSpaceConversion: "none",
            });
        },
        dispose(bitmap) {
            counts.disposals++;
            bitmap.close();
        },
    };
    const canvas = document.createElement("canvas");
    const app = new BrowserGame<Progress, ProgressCommand>({
        canvas,
        width: W,
        height: H,
        seed: "ngne27-atlas-lifetime",
        state: { best: 0, runs: 0, victories: 0, lastScore: 0 },
        transition: (state) => state,
        scheduler,
    });
    const leases = {
        scene: { acquired: 0, released: 0 },
        host: { acquired: 0, released: 0 },
    };
    let atlasAcquisitions = 0;
    const assets = app.game.assets;
    const acquire = assets.acquire.bind(assets);
    assets.acquire = async <T>(definition: Asset<T>, signal?: AbortSignal): Promise<Lease<T>> => {
        if ((definition as unknown) !== atlas) return acquire(definition, signal);
        const role = atlasAcquisitions++ % 2 === 0 ? leases.scene : leases.host;
        const lease = await acquire(definition, signal);
        role.acquired++;
        let released = false;
        return {
            id: lease.id,
            value: lease.value,
            release() {
                if (!released) role.released++;
                released = true;
                lease.release();
            },
        };
    };
    const live = () => ({
        scene: leases.scene.acquired - leases.scene.released,
        host: leases.host.acquired - leases.host.released,
    });
    const reader = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const atlasReader = document.createElement("canvas").getContext("2d");
    if (!reader || !atlasReader) throw new Error("Canvas readback unavailable");
    reader.canvas.width = W;
    reader.canvas.height = H;
    atlasReader.canvas.width = 16;
    atlasReader.canvas.height = 32;
    atlasReader.drawImage(makeAtlas(), 0, 0);
    const cell = atlasReader.getImageData(0, 0, 16, 32).data;
    const shipColours = new Set<string>();
    for (let offset = 0; offset < cell.length; offset += 4)
        if (cell[offset + 3] === 255)
            shipColours.add(Array.from(cell.slice(offset, offset + 3)).join());
    let now = 1000;
    // Runs host frames, then reads the player ship's centre texels from the presented canvas.
    const frames = (count: number): number => {
        for (let frame = 0; frame < count; frame++) {
            if (!callback) throw new Error("Atlas host has no scheduled frame");
            callback((now += 1000 / 60));
        }
        reader.drawImage(canvas, 0, 0);
        const pixels = reader.getImageData(W / 2 - 1, H * 0.65 - 1, 3, 3).data;
        let matches = 0;
        for (let offset = 0; offset < pixels.length; offset += 4)
            if (
                pixels[offset + 3] === 255 &&
                shipColours.has(Array.from(pixels.slice(offset, offset + 3)).join())
            )
                matches++;
        return matches;
    };
    try {
        await app.start(await app.game.prepare(arena({ atlas }), { key: "atlas-0" }));
        if (leases.host.acquired !== 1 || leases.scene.acquired !== 1)
            throw new Error(
                `Atlas lease wrapper could not separate scene and host leases: ${JSON.stringify(leases)}`,
            );
        const initialMatches = frames(30);
        check(
            initialMatches >= 5 && counts.loads === 1 && live().scene === 1 && live().host === 1,
            `Starfall atlas renders ship texels with one scene lease and one renderer source lease (${initialMatches}/9 texels)`,
        );
        for (let replacement = 1; replacement <= 3; replacement++) {
            app.game.set(await app.game.prepare(arena({ atlas }), { key: `atlas-${replacement}` }));
            const matches = frames(30);
            const current = live();
            check(
                app.game.scenes[0].key === `atlas-${replacement}` &&
                    matches >= 5 &&
                    counts.loads === 1 &&
                    counts.disposals === 0 &&
                    current.scene === 1 &&
                    current.host === 1,
                `Starfall atlas replacement ${replacement} keeps one load, no disposal, one scene and one source lease, and renders ship texels (${matches}/9; scene ${current.scene}, source ${current.host})`,
            );
        }
    } finally {
        await app.dispose();
    }
    const final = live();
    check(
        counts.loads === 1 && counts.disposals === 1 && final.scene === 0 && final.host === 0,
        `Starfall atlas is disposed exactly once after host disposal with every atlas lease released (${leases.scene.acquired} scene, ${leases.host.acquired} source leases)`,
    );
}

/** Starfall boots by preparing its atlas image, which creates the renderer; no click is needed. */
async function checkStarfallUnsupported(check: Check): Promise<void> {
    await withFixture("/", "Starfall unsupported WebGPU fixture", undefined, async (doc) => {
        await waitFor(
            () => doc()?.getElementById("error")?.hidden === false,
            10_000,
            "Starfall fixture reported no error",
        );
        // The message must persist; a later report or UI update must not hide it.
        await new Promise((resolve) => setTimeout(resolve, 500));
        const error = doc()?.getElementById("error");
        check(
            error?.hidden === false &&
                STARFALL_UNSUPPORTED.every((message) => error.textContent?.includes(message)),
            `Starfall persistently reports the exact unsupported messages: ${STARFALL_UNSUPPORTED.join(" / ")}`,
        );
        check(
            doc()?.getElementById("play")?.textContent === "UNABLE TO START",
            "Starfall unsupported boot shows UNABLE TO START",
        );
    });
}

/**
 * Start unlocks audio before starting the host, so the platformer fixture needs trusted input
 * inside the iframe: the page shows a prompt and waits for the operator to click Start level 1.
 */
async function checkPlatformerUnsupported(check: Check): Promise<void> {
    await withFixture(
        "/examples/platformer/index.html",
        "Platformer unsupported WebGPU fixture",
        "Click Start level 1 in the platformer fixture below to continue.",
        async (doc) => {
            await waitFor(
                () => doc()?.documentElement.dataset.ngneFixtureReady === "true",
                10_000,
                "Platformer fixture did not become ready",
            );
            await waitFor(
                () => doc()?.getElementById("error")?.hidden === false,
                CLICK_TIMEOUT_MS,
                "Platformer fixture Start was not clicked or reported no error",
            );
            await new Promise((resolve) => setTimeout(resolve, 500));
            const error = doc()?.getElementById("error");
            // Elements belong to the iframe realm, so parent-realm instanceof checks cannot be used.
            const start = doc()?.getElementById("start") as HTMLButtonElement | null | undefined;
            check(
                error?.hidden === false && error.textContent?.includes(PLATFORMER_UNSUPPORTED),
                `platformer persistently reports the exact unsupported message: ${PLATFORMER_UNSUPPORTED}`,
            );
            check(
                start?.tagName === "BUTTON" &&
                    (start.hidden || start.disabled) &&
                    doc()?.getElementById("overlay-title")?.textContent === "Unable to continue",
                "platformer unsupported start leaves Start unavailable and shows the error presentation",
            );
        },
    );
}

/** Loads a real game page in a same-origin iframe whose WebGPU adapter request resolves null. */
async function withFixture(
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

async function waitFor(condition: () => boolean, timeoutMs: number, failure: string) {
    const deadline = performance.now() + timeoutMs;
    while (!condition()) {
        if (performance.now() > deadline) throw new Error(failure);
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}
