import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { validate, validateBounds, stageSize } from "../preview/model.js";
import { Playback } from "../preview/playback.js";
import { Inspection } from "../preview/inspection.js";
import { loadAdapter, startPreview } from "../preview/host.js";
import { previewBrowserFlags } from "../suites/verification/preview.js";

test("preview respects the headed override without changing rendering flags", (t) => {
    for (const platform of ["linux", "win32"] as const) {
        const headed = previewBrowserFlags("0", platform);
        assert.ok(!headed.some((flag) => flag.startsWith("--headless")));
        assert.ok(headed.includes("--use-webgpu-adapter=swiftshader"));
        assert.ok(headed.includes("--window-size=1100,850"));
        assert.equal(headed.includes("--use-vulkan=swiftshader"), platform === "linux");
        for (const value of ["1", "", "false"]) {
            const headless = previewBrowserFlags(value, platform);
            assert.ok(headless.includes("--headless=new"));
            assert.deepEqual(
                headless.filter((flag) => flag !== "--headless=new"),
                headed,
            );
        }
    }
    const original = process.env.NGNE_BROWSER_HEADLESS;
    t.after(() => {
        if (original === undefined) delete process.env.NGNE_BROWSER_HEADLESS;
        else process.env.NGNE_BROWSER_HEADLESS = original;
    });
    delete process.env.NGNE_BROWSER_HEADLESS;
    assert.ok(previewBrowserFlags().includes("--headless=new"));
    process.env.NGNE_BROWSER_HEADLESS = "0";
    assert.ok(!previewBrowserFlags().includes("--headless=new"));
    process.env.NGNE_BROWSER_HEADLESS = "1";
    assert.ok(previewBrowserFlags().includes("--headless=new"));
});

function input() {
    return {
        images: [{ id: "sheet", src: "file:///image.png" }],
        frames: ["A", "B", "solo"].map((id) => ({
            id,
            image: "sheet",
            x: 3,
            y: 2,
            width: 9,
            height: 7,
            destinationWidth: 4.5,
            destinationHeight: 3.5,
        })),
        animations: [
            {
                id: "unequal",
                playback: "loop",
                entries: [
                    { frame: "A", ms: 80 },
                    { frame: "B", ms: 120 },
                    { frame: "A", ms: 200 },
                ],
            },
        ],
        display: { density: 2, scale: 3, pixelSnap: true },
    };
}
test("preview validates normalized shapes, independent IDs and decoded bounds", () => {
    const value = validate(input());
    assert.deepEqual(stageSize(value), { width: 12, height: 10 });
    validateBounds(value, new Map([["sheet", { width: 12, height: 9 }]]));
    assert.throws(
        () => validateBounds(value, new Map([["sheet", { width: 11, height: 9 }]])),
        /frame A.*outside/,
    );
    assert.throws(() => validateBounds(value, new Map()), /image sheet/);
    assert.equal(validate({ ...input(), animations: [] }).animations.length, 0);
});
const bad: [string, (v: ReturnType<typeof input>) => unknown, RegExp][] = [
    ["missing container", () => null, /adapter/],
    ["malformed frames", (v) => ({ ...v, frames: {} }), /frames/],
    ["empty frames", (v) => ({ ...v, frames: [] }), /frames/],
    [
        "image duplicate",
        (v) => {
            v.images.push(v.images[0]);
            return v;
        },
        /image sheet.*duplicate/,
    ],
    [
        "frame duplicate",
        (v) => {
            v.frames.push(v.frames[0]);
            return v;
        },
        /frame A.*duplicate/,
    ],
    [
        "animation duplicate",
        (v) => {
            v.animations.push(v.animations[0]);
            return v;
        },
        /animation unequal.*duplicate/,
    ],
    [
        "image reference",
        (v) => {
            v.frames[0].image = "missing";
            return v;
        },
        /frame A.image/,
    ],
    [
        "frame reference",
        (v) => {
            v.animations[0].entries[1].frame = "missing";
            return v;
        },
        /entry 1.frame/,
    ],
    [
        "empty sequence",
        (v) => {
            v.animations[0].entries = [];
            return v;
        },
        /empty sequence/,
    ],
    [
        "negative crop",
        (v) => {
            v.frames[0].x = -1;
            return v;
        },
        /frame A.x/,
    ],
    [
        "fractional crop",
        (v) => {
            v.frames[0].width = 0.5;
            return v;
        },
        /frame A.width/,
    ],
    [
        "zero crop",
        (v) => {
            v.frames[0].height = 0;
            return v;
        },
        /frame A.height/,
    ],
    [
        "destination NaN",
        (v) => {
            v.frames[0].destinationWidth = NaN;
            return v;
        },
        /destinationWidth/,
    ],
    [
        "derived overflow",
        (v) => {
            v.display.density = Number.MAX_VALUE;
            return v;
        },
        /derived width/,
    ],
    [
        "derived underflow",
        (v) => {
            v.display.density = Number.MIN_VALUE;
            return v;
        },
        /derived width/,
    ],
    [
        "CSS overflow",
        (v) => {
            v.display.scale = Number.MAX_VALUE;
            return v;
        },
        /CSS width/,
    ],
    [
        "zero timing",
        (v) => {
            v.animations[0].entries[0].ms = 0;
            return v;
        },
        /entry 0.ms/,
    ],
    [
        "infinite timing",
        (v) => {
            v.animations[0].entries[0].ms = Infinity;
            return v;
        },
        /entry 0.ms/,
    ],
    [
        "timing overflow",
        (v) => {
            v.animations[0].entries.forEach((e) => (e.ms = Number.MAX_VALUE));
            return v;
        },
        /total duration/,
    ],
    [
        "timing precision",
        (v) => {
            v.animations[0].entries[0].ms = 1e30;
            return v;
        },
        /lost precision/,
    ],
    [
        "playback mode",
        (v) => {
            v.animations[0].playback = "guess";
            return v;
        },
        /playback/,
    ],
    [
        "pixel snap type",
        (v) => ({ ...v, display: { ...v.display, pixelSnap: "yes" } }),
        /pixelSnap/,
    ],
];
for (const [name, change, message] of bad)
    test(`preview rejects ${name}`, () => assert.throws(() => validate(change(input())), message));
test("elapsed playback preserves unequal and repeated entries at exact boundaries and long skips", () => {
    const player = new Playback(validate(input()).animations[0]);
    assert.equal(player.index, 0);
    assert.equal(player.playing, false);
    player.play(1000);
    for (const [elapsed, index] of [
        [79, 0],
        [80, 1],
        [199, 1],
        [200, 2],
        [399, 2],
        [400, 0],
        [1280, 1],
    ]) {
        player.advance(1000 + elapsed);
        assert.equal(player.index, index);
    }
    assert.equal(player.elapsed, 80);
});
test("pause/resume and visibility suspension exclude hidden time; once holds then restarts", () => {
    const animation = validate(input()).animations[0];
    animation.playback = "once";
    const player = new Playback(animation);
    player.play(0);
    player.pause(110);
    assert.equal(player.elapsed, 110);
    assert.equal(player.index, 1);
    player.advance(10000);
    assert.equal(player.elapsed, 110);
    player.play(10000);
    player.advance(10089);
    assert.equal(player.index, 1);
    player.advance(10090);
    assert.equal(player.index, 2);
    player.advance(10290);
    assert.equal(player.elapsed, 400);
    assert.equal(player.playing, false);
    player.play(20000);
    assert.equal(player.index, 0);
    assert.equal(player.elapsed, 0);
});
for (const mode of ["loop", "once"] as const)
    test(`paused stepping clamps, resets elapsed and preserves repeated entries (${mode})`, () => {
        const animation = validate(input()).animations[0];
        animation.playback = mode;
        const player = new Playback(animation);
        player.play(0);
        player.pause(45);
        player.step(-1);
        assert.equal(player.elapsed, 0);
        player.step(1);
        assert.equal(player.index, 1);
        assert.equal(player.elapsed, 80);
        player.play(1000);
        player.step(1); // Playing ignores steps, just as the controls are disabled.
        assert.equal(player.elapsed, 80);
        player.advance(1119);
        assert.equal(player.index, 1);
        player.advance(1120);
        assert.equal(player.index, 2);
        player.pause(1150);
        player.step(1); // Last entry clamps and resets even in a loop.
        assert.equal(player.elapsed, 200);
        assert.equal(player.index, 2);
        assert.equal(animation.entries[player.index].frame, "A");
        assert.equal(player.playing, false);
        player.play(2000);
        player.advance(2199);
        assert.equal(player.index, 2);
        player.advance(2200);
        assert.equal(player.elapsed, mode === "once" ? 400 : 0);
        if (mode === "once") {
            player.step(1);
            assert.equal(player.elapsed, 200); // Replay the final entry for its full duration.
            player.play(3000);
            player.advance(3199);
            assert.equal(player.index, 2);
            player.pause(3199);
        } else player.pause(2200);
        player.step(-1);
        assert.equal(player.elapsed, mode === "once" ? 80 : 0);
    });
test("single-entry stepping resets a completed once animation without changing its frame", () => {
    const player = new Playback({
        id: "single",
        playback: "once",
        entries: [{ frame: "A", ms: 80 }],
    });
    player.play(0);
    player.advance(80);
    player.step(-1);
    assert.equal(player.elapsed, 0);
    player.step(1);
    assert.equal(player.index, 0);
    assert.equal(player.elapsed, 0);
    assert.equal(player.playing, false);
});
test("host serves only registered snapshots and packaged modules; local adapter diagnostics", async (t) => {
    const root = mkdtempSync(join(tmpdir(), "ngne-preview-test-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    for (const dir of ["dist/preview", "dist/engine"])
        mkdirSync(join(root, dir), { recursive: true });
    for (const name of ["browser.js", "model.js", "playback.js", "inspection.js", "index.html"])
        writeFileSync(join(root, "dist/preview", name), name);
    writeFileSync(join(root, "dist/engine/index.js"), "export const marker = 1;");
    writeFileSync(join(root, "secret.txt"), "not registered");
    writeFileSync(join(root, "image.png"), "registered image bytes");
    const value = input();
    value.images[0].src = pathToFileURL(join(root, "image.png")).href;
    const config = join(root, "preview.mjs");
    writeFileSync(config, `export default ${JSON.stringify(value)}`);
    const server = await startPreview(config, root);
    t.after(() => server.close());
    assert.equal(await (await fetch(server.url + "images/0")).text(), "registered image bytes");
    assert.equal(
        await (await fetch(server.url + "engine/index.js")).text(),
        "export const marker = 1;",
    );
    const data = await (await fetch(server.url + "config")).text();
    assert.ok(!data.includes(root));
    assert.ok(data.includes("/images/0"));
    for (const path of [
        "secret.txt",
        "preview.mjs",
        "engine/../../secret.txt",
        "engine/%2e%2e/secret.txt",
        "images/0?file=secret.txt",
        "host.js",
    ])
        assert.equal((await fetch(server.url + path)).status, 404);
    assert.equal(
        (await fetch(server.url, { headers: { Origin: "https://example.org" } })).status,
        403,
    );
    assert.equal((await fetch(server.url, { method: "POST" })).status, 405);
    await assert.rejects(loadAdapter(join(root, "preview.ts")), /explicit .mjs/);
    value.images[0].src = "https://example.org/image.png";
    writeFileSync(join(root, "remote.mjs"), `export default ${JSON.stringify(value)}`);
    await assert.rejects(loadAdapter(join(root, "remote.mjs")), /image sheet.src/);
    value.images[0].src = pathToFileURL(join(root, "missing.png")).href;
    writeFileSync(join(root, "missing.mjs"), `export default ${JSON.stringify(value)}`);
    await assert.rejects(loadAdapter(join(root, "missing.mjs")), /image sheet.src/);
});

test("inspection retains the same canvas point at viewport center across zoom changes", () => {
    const view = new Inspection(482, 130);
    view.pan(27, -19);
    for (const zoom of [2, 4, 8, 4, 1]) {
        view.zoom = zoom;
        assert.equal(view.width / 2 - view.x, 214);
        assert.equal(view.height / 2 - view.y, 84);
    }
    view.zoom = 8;
    view.pan(80, -40);
    assert.deepEqual([view.x, view.y], [37, -24]);
    view.reset();
    assert.deepEqual([view.x, view.y, view.zoom], [0, 0, 1]);
});

test("inspection can reach all canvas edges without losing the canvas", () => {
    const view = new Inspection(40, 48);
    for (const zoom of [1, 2, 4, 8]) {
        view.zoom = zoom;
        view.pan(1e8, -1e8);
        assert.deepEqual([view.x, view.y], [20, -24]);
        view.pan(-1e8, 1e8);
        assert.deepEqual([view.x, view.y], [-20, 24]);
    }
});
