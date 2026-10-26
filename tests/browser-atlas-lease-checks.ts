import { BrowserGame, type ImageAsset, type SceneDefinition } from "../src/index.js";

/** Engine-owned generated pixels: no game, artwork, or external checkout dependencies. */
export async function checkBrowserAtlasLeases(
    check: (condition: unknown, message: string) => void,
): Promise<void> {
    const loads: string[] = [],
        closed: string[] = [];
    const image = (id: string, colors: string[]): ImageAsset => ({
        id,
        kind: "image",
        async load() {
            loads.push(id);
            const source = document.createElement("canvas");
            source.width = colors.length * 2;
            source.height = 2;
            const paint = source.getContext("2d");
            if (!paint) throw Error("Missing canvas 2D");
            colors.forEach((color, i) => {
                paint.fillStyle = color;
                paint.fillRect(i * 2, 0, 2, 2);
            });
            return createImageBitmap(source, {
                premultiplyAlpha: "none",
                colorSpaceConversion: "none",
            });
        },
        dispose(bitmap) {
            closed.push(id);
            bitmap.close();
        },
    });
    const atlas = image("lease-atlas", ["#ff0000", "#40c080"]);
    const background = image("lease-background", ["#204060"]);
    let callback: FrameRequestCallback | undefined;
    let now = 1000;
    const canvas = document.createElement("canvas");
    const app = new BrowserGame({
        canvas,
        width: 32,
        height: 32,
        seed: "atlas-leases",
        state: {},
        transition: (s) => s,
        scheduler: {
            request(next) {
                callback = next;
                return 1;
            },
            cancel() {
                callback = undefined;
            },
        },
    });
    const definition: SceneDefinition = {
        id: "atlas-leases",
        assets: [atlas, background],
        setup(scene) {
            check(
                scene.assets.get(atlas.id) instanceof ImageBitmap,
                "atlas setup receives decoded pixels",
            );
            scene.render((frame) => {
                frame.sprite({
                    x: 16,
                    y: 16,
                    width: 32,
                    height: 32,
                    texture: background.id,
                    screen: true,
                });
                frame.sprite({
                    x: 16,
                    y: 16,
                    width: 16,
                    height: 16,
                    texture: atlas.id,
                    u: 0.5,
                    uw: 0.5,
                    layer: 1,
                });
            });
        },
    };
    const read = document.createElement("canvas");
    read.width = read.height = 32;
    const reader = read.getContext("2d", { willReadFrequently: true });
    if (!reader) throw Error("Missing readback");
    const pixels = () => {
        for (let i = 0; i < 3; i++) {
            if (!callback) throw Error("Missing scheduled atlas frame");
            callback((now += 1000 / 60));
        }
        reader.drawImage(canvas, 0, 0);
        return [reader.getImageData(16, 16, 1, 1), reader.getImageData(1, 1, 1, 1)]
            .map((pixel) => Array.from(pixel.data).join())
            .join(";");
    };
    const assertLive = (label: string) => {
        const presented = pixels();
        const claims = app.game.assets.inspect().claims;
        check(
            presented === "64,192,128,255;32,64,96,255" &&
                loads.length === 2 &&
                closed.length === 0 &&
                claims.scene === 2 &&
                claims.renderer === 2,
            `${label}: atlas region and background pixels survive with one scene and one renderer lease per image (${presented}; scene ${claims.scene}, renderer ${claims.renderer})`,
        );
    };
    try {
        await app.start(await app.game.prepare(definition, { key: "first" }));
        assertLive("initial mount");
        for (let i = 1; i <= 3; i++) {
            app.game.set(await app.game.prepare(definition, { key: `replacement-${i}` }));
            assertLive(`replacement ${i}`);
            check(
                app.game.scenes[0].key === `replacement-${i}`,
                "replacement candidate became active",
            );
        }
        let rejected = false;
        try {
            await app.game.prepare(
                {
                    ...definition,
                    assets: [
                        atlas,
                        background,
                        {
                            id: "broken-image",
                            kind: "image",
                            async load() {
                                throw Error("Injected image load failure");
                            },
                        } satisfies ImageAsset,
                    ],
                },
                { key: "failed-load" },
            );
        } catch {
            rejected = true;
        }
        check(rejected, "image preparation failure rejects without replacing the active scene");
        assertLive("failed preparation rollback");
        await app.stop();
        await app.start();
        assertLive("stop/resume");
    } finally {
        await app.dispose();
    }
    await app.dispose();
    const final = app.game.assets.inspect().claims;
    check(
        loads.length === 2 &&
            closed.length === 2 &&
            new Set(closed).size === 2 &&
            final.scene === 0 &&
            final.renderer === 0,
        "terminal host disposal closes each image once and releases all scene and renderer leases",
    );
}
