import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Frame, Game, emptyInput, type Sprite, type ImageAsset } from "../../src/index.js";
import { animationFrame, bodySprites, createEffects, drawSprite } from "../sprites.js";
import art from "../assets/starfall.json";
import { arena, overlay, type Progress, type ProgressCommand } from "../game.js";

class Capture extends Frame {
    sprites: Sprite[] = [];
    override sprite(sprite: Sprite) {
        this.sprites.push(sprite);
        super.sprite(sprite);
    }
}

test("runtime atlas contains only selected frames, inside disjoint rectangles matching the PNG", () => {
    assert.deepEqual(bodySprites, [
        "player",
        "chaser",
        "gunship",
        "player-bolt",
        "enemy-round",
        "boss",
        "repair",
    ]);
    const used = new Set([
        ...bodySprites,
        ...art.animations.thrust.frames,
        ...art.animations.explosion.frames,
        "impact",
    ]);
    assert.deepEqual(Object.keys(art.frames).sort(), [...used].sort());
    const png = readFileSync(new URL("../assets/starfall.png", import.meta.url));
    assert.equal(png.readUInt32BE(16), art.width);
    assert.equal(png.readUInt32BE(20), art.height);
    const frames = Object.values(art.frames);
    frames.forEach((rect, i) => {
        assert.ok(rect.x >= 0 && rect.y >= 0 && rect.w > 0 && rect.h > 0);
        assert.ok(rect.x + rect.w <= art.width && rect.y + rect.h <= art.height);
        for (const other of frames.slice(i + 1))
            assert.ok(
                rect.x + rect.w <= other.x ||
                    other.x + other.w <= rect.x ||
                    rect.y + rect.h <= other.y ||
                    other.y + other.h <= rect.y,
            );
    });
});

test("rectangular frames retain dimensions and UVs; top pivots rotate around the attachment", () => {
    const frame = new Capture();
    for (const name of bodySprites) {
        drawSprite(frame, name, 100, 80);
        const sprite = frame.sprites.at(-1)!;
        const rect = art.frames[name];
        assert.deepEqual(
            [sprite.x, sprite.y, sprite.width, sprite.height],
            [100, 80, rect.w, rect.h],
        );
        assert.deepEqual(
            [sprite.u, sprite.v, sprite.uw, sprite.vh],
            [rect.x / 256, rect.y / 128, rect.w / 256, rect.h / 128],
        );
    }
    drawSprite(frame, "thrust-a", 100, 80);
    assert.equal(frame.sprites.at(-1)!.y, 95);
    drawSprite(frame, "thrust-a", 100, 80, Math.PI / 2);
    assert.equal(frame.sprites.at(-1)!.x, 85);
    assert.equal(frame.sprites.at(-1)!.y, 80);
});

test("animations honor 80 ms boundaries, loop only thrust and expire explosions", () => {
    for (const [time, expected] of [
        [0, "explosion-a"],
        [79.999, "explosion-a"],
        [80, "explosion-b"],
        [160, "explosion-c"],
        [240, "explosion-d"],
        [320, undefined],
    ] as const)
        assert.equal(animationFrame("explosion", time), expected);
    assert.equal(animationFrame("thrust", 239.99), "thrust-c");
    assert.equal(animationFrame("thrust", 240), "thrust-a");
});

test("effects are bounded, update-clocked, render-pure, reduced-motion aware and resettable", () => {
    const effects = createEffects();
    effects.add("impact", 10, 20);
    effects.add("explosion", 30, 40);
    for (let i = 0; i < 5; i++) effects.step();
    assert.equal(effects.active.length, 1);
    const first = new Capture(),
        second = new Capture(),
        reduced = new Capture();
    effects.render(first);
    effects.render(second);
    effects.render(reduced, true);
    assert.deepEqual(first.sprites, second.sprites);
    assert.equal(first.sprites[0].u, art.frames["explosion-b"].x / art.width);
    assert.equal(reduced.sprites[0].width, 16);
    assert.equal(reduced.sprites[0].layer, 2);
    for (let i = 0; i < 15; i++) effects.step();
    assert.equal(effects.active.length, 0);
    for (let i = 0; i < 200; i++) effects.add("explosion", 0, 0);
    assert.equal(effects.active.length, 128);
    effects.clear();
    assert.equal(effects.active.length, 0);
    assert.equal(effects.timeMs, 0);
});

const create = () =>
    new Game<Progress, ProgressCommand>({
        seed: "art-test",
        state: { best: 0, runs: 0, victories: 0, lastScore: 0 },
        transition: (s) => s,
    });

test("pause freezes presentation; resume advances it and replacement starts a fresh clock", async () => {
    const game = create();
    try {
        await game.start(await game.prepare(arena({ attract: true }), { key: "art" }));
        for (let i = 0; i < 180; i++) game.tick();
        game.push(
            await game.prepare(
                overlay("pause", () => {}),
                { key: "pause" },
            ),
        );
        game.tick();
        const first = new Capture();
        game.render(first, 1);
        for (let i = 0; i < 60; i++) game.tick();
        const second = new Capture();
        game.render(second, 1);
        assert.deepEqual(first.sprites, second.sprites);
        game.pop();
        game.tick();
        for (let i = 0; i < 7; i++) game.tick();
        const resumed = new Capture();
        game.render(resumed, 1);
        assert.notDeepEqual(resumed.sprites, second.sprites);
        game.set(await game.prepare(arena({ attract: true }), { key: "replacement" }));
        game.tick(emptyInput());
        const replacement = new Capture();
        game.render(replacement, 1);
        const effects = replacement.sprites.filter((s) => s.layer === 2);
        assert.equal(effects.length, 1, "only the new player's thrust survives replacement");
        assert.equal(effects[0].v, art.frames["thrust-a"].y / art.height);
    } finally {
        game.dispose();
    }
});

test("both images share leases across replacement and dispose once; failed loads reject preparation", async () => {
    const loads: string[] = [],
        closed: string[] = [];
    const asset = (id: string): ImageAsset => ({
        id,
        kind: "image",
        async load() {
            loads.push(id);
            return {} as ImageBitmap;
        },
        dispose() {
            closed.push(id);
        },
    });
    const atlas = asset("ships"),
        background = asset("starfall-background");
    const game = create();
    await game.start(await game.prepare(arena({ atlas, background }), { key: "first" }));
    game.set(await game.prepare(arena({ atlas, background }), { key: "second" }));
    game.tick();
    assert.deepEqual(loads.sort(), ["ships", "starfall-background"]);
    assert.deepEqual(closed, []);
    const frame = new Capture();
    game.render(frame, 1);
    const sky = frame.sprites.filter((s) => s.texture === background.id);
    assert.equal(sky.length, 1);
    assert.equal(sky[0].screen, true);
    assert.deepEqual([sky[0].width, sky[0].height], [640, 400]);
    game.dispose();
    assert.deepEqual(closed.sort(), ["ships", "starfall-background"]);
    const failed = create();
    try {
        await assert.rejects(
            failed.prepare(
                arena({
                    atlas,
                    background: {
                        ...background,
                        async load() {
                            throw new Error("missing background");
                        },
                    },
                }),
                { key: "failed" },
            ),
            (error: unknown) =>
                error instanceof AggregateError &&
                error.errors.some(
                    (cause: unknown) =>
                        cause instanceof Error && cause.message === "missing background",
                ),
        );
    } finally {
        failed.dispose();
    }
});
