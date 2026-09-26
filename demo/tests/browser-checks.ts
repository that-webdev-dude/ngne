import { makeAtlas } from "../art.js";
import { arena, H, W, type Progress, type ProgressCommand } from "../game.js";
import { BrowserGame } from "ngne";
import type { Asset, FrameScheduler, ImageAsset, Lease } from "ngne";

type Check = (condition: unknown, message: string) => void;

import { withFixture, waitFor } from "../../tooling/suites/verification/browser/page-fixture.js";
const STARFALL_UNSUPPORTED = [
    "Unable to start Starfall. It requires WebGPU with hardware acceleration",
    "WebGPU adapter unavailable. Enable browser hardware acceleration",
];
export async function checkBrowserGames(check: Check): Promise<void> {
    await checkStarfallAtlasLifetime(check);
    await checkStarfallUnsupported(check);
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
