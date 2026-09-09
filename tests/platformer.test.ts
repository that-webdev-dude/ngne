import assert from "node:assert/strict";
import { test } from "node:test";

import { CONTACT, moveX, moveY } from "../examples/platformer/collision.js";
import { createProgress, HEIGHT, transition, WIDTH } from "../examples/platformer/game.js";
import type { Progress, ProgressCommand } from "../examples/platformer/game.js";
import { LEVEL_ONE, parseLevel, TILE } from "../examples/platformer/levels.js";
import type { LevelData } from "../examples/platformer/levels.js";
import { createTransitionRegistry, levelKey } from "../examples/platformer/transitions.js";
import type { RegistryOptions } from "../examples/platformer/transitions.js";
import { emptyInput, Frame, Game } from "../src/index.js";
import type { InputSnapshot, InspectionValue } from "../src/index.js";

const DISPLAY = Object.freeze({ width: WIDTH, height: HEIGHT, pixelRatio: 1 });
const FLOOR = parseLevel([
    "................................",
    "................................",
    "................................",
    "..P...........................E.",
    "################################",
]);
const LEDGE = parseLevel([
    ".".repeat(32),
    ".".repeat(32),
    "..P...........................E.",
    "######........................##",
    ...Array<string>(20).fill(".".repeat(32)),
]);
const CEILING = parseLevel([
    "................................",
    "################################",
    "................................",
    "..P...........................E.",
    "################################",
]);
const ONE_WAY = parseLevel([
    "........",
    "........",
    "....-...",
    "........",
    "P......E",
    "########",
]);

interface ScheduledTick {
    readonly input?: InputSnapshot;
    readonly intent?: "pause" | "resume" | "restart";
}

function createInput(held: readonly string[] = [], pressed: readonly string[] = []): InputSnapshot {
    return Object.freeze({
        ...emptyInput(),
        held: Object.freeze([...held]),
        pressed: Object.freeze([...pressed]),
    });
}

async function createHarness(
    fixtureLevels: readonly LevelData[],
    script: ReadonlyMap<number, ScheduledTick> = new Map(),
    progress = createProgress(),
    prepare?: RegistryOptions["prepare"],
) {
    const errors: unknown[] = [];
    const game = new Game<Progress, ProgressCommand>({
        seed: "platformer-test",
        state: progress,
        transition,
        diagnostic: (error) => errors.push(error),
    });
    const registry = createTransitionRegistry({
        levels: fixtureLevels,
        prepare,
        onError: (error) => errors.push(error),
    });
    const output = new Frame();
    await game.start(
        await game.prepare(registry.createLevelDefinition(progress.level), {
            key: levelKey(progress.level, progress.attempt),
        }),
    );
    return {
        game,
        registry,
        output,
        errors,
        async frame(ticks = 1) {
            for (let tick = 0; tick < ticks; tick++) {
                const scheduled = script.get(game.simulationTick);
                if (scheduled?.intent) registry.request(scheduled.intent);
                game.tick(scheduled?.input ?? emptyInput(), DISPLAY);
            }
            output.reset();
            game.render(output, 0.5);
            registry.reconcile(game);
            // One event-loop microtask checkpoint, including nested prepare continuations.
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.deepEqual(errors, []);
        },
        dispose() {
            registry.dispose();
            game.dispose();
        },
    };
}

function record(value: InspectionValue): { readonly [key: string]: InspectionValue } {
    assert.ok(value && typeof value === "object" && !Array.isArray(value));
    return value as { readonly [key: string]: InspectionValue };
}

function player(game: Game<Progress, ProgressCommand>, name: string) {
    const scene = game.enumerate().scenes[0];
    assert.ok(scene);
    const entities = record(scene.world).entities;
    assert.ok(Array.isArray(entities));
    const components = record(entities[0]).components;
    assert.ok(Array.isArray(components));
    const component = components.find((value) => record(value).name === name);
    assert.ok(component);
    return record(record(component).value);
}

function number(value: InspectionValue): number {
    assert.equal(typeof value, "number");
    return value as number;
}

function jumpScript(
    length: number,
    pressTicks: readonly number[],
    releaseTick = length,
): Map<number, ScheduledTick> {
    return new Map(
        Array.from({ length }, (_, tick) => [
            tick,
            {
                input: createInput(
                    tick < releaseTick ? ["Space"] : [],
                    pressTicks.includes(tick) ? ["Space"] : [],
                ),
            },
        ]),
    );
}

test("platformer parser validates authored markers, tiles and dimensions", () => {
    assert.equal(LEVEL_ONE.widthTiles, 100);
    assert.equal(LEVEL_ONE.heightTiles, 17);
    assert.ok(Object.isFrozen(LEVEL_ONE));
    assert.ok(Object.isFrozen(LEVEL_ONE.checkpoints));
    assert.throws(() => parseLevel([]), /row 1, column 1/);
    assert.throws(() => parseLevel(["P.E", "##"]), /row 2, column 3/);
    assert.throws(() => parseLevel(["P?E", "###"]), /row 1, column 2/);
    assert.throws(() => parseLevel(["P.E", "#.."]), /row 1, column 3/);
    assert.throws(() => parseLevel(["PPE", "###"]), /Duplicate start/);
    assert.throws(() => parseLevel(["PEE", "###"]), /Duplicate exit/);
    assert.throws(() => parseLevel(["...", "###"]), /Missing start or exit/);
    const markers = parseLevel(["...C...", "...#...", "PC.E.G.", "#######"]);
    assert.deepEqual(markers.checkpoints, [
        { x: 1, y: 2 },
        { x: 3, y: 0 },
    ]);
    assert.deepEqual(markers.patrols, [{ x: 5, y: 2 }]);
});

test("platformer collision lands without tunnelling at maximum fall speed and across long sweeps", () => {
    const box = { x: 32, y: 0, w: 12, h: 14 };
    let contacts = 0;
    for (let tick = 0; tick < 10 && !(contacts & CONTACT.floor); tick++) {
        const bottom = box.y + box.h;
        contacts = moveY(FLOOR, box, 600 / 60, bottom);
        assert.ok(box.y + box.h <= 64);
    }
    assert.ok(contacts & CONTACT.floor);
    assert.equal(box.y + box.h, 64);
    box.y = 0;
    assert.ok(moveY(FLOOR, box, 200, 14) & CONTACT.floor);
    assert.equal(box.y, 50);
});

test("platformer one-way collision passes upward and lands only when crossing from above", () => {
    const box = { x: 64, y: 50, w: 12, h: 14 };
    assert.equal(moveY(ONE_WAY, box, -40, 64), 0);
    assert.equal(box.y, 10);
    assert.ok(moveY(ONE_WAY, box, 20, 24) & CONTACT.floor);
    assert.equal(box.y + box.h, 32);
    box.y = 25;
    assert.equal(moveY(ONE_WAY, box, 4, 39), 0);
    assert.equal(box.y, 29);
    box.x = 40;
    box.y = 32;
    assert.equal(moveX(ONE_WAY, box, 32), 0);
});

test("platformer collision uses side walls, open top, spikes and a strict fall-out line", () => {
    const box = { x: 2, y: 0, w: 12, h: 14 };
    assert.ok(moveX(FLOOR, box, -100) & CONTACT.wall);
    assert.equal(box.x, 0);
    assert.ok(moveX(FLOOR, box, 1000) & CONTACT.wall);
    assert.equal(box.x + box.w, FLOOR.widthTiles * TILE);
    assert.equal(moveY(FLOOR, box, -100, 14), 0);
    box.y = (FLOOR.heightTiles + 2) * TILE;
    assert.equal(moveY(FLOOR, box, 0, box.y + box.h), 0);
    assert.ok(moveY(FLOOR, box, 1, box.y + box.h) & CONTACT.fell);
    const spikes = parseLevel(["P.^..E", "######"]);
    box.x = 16;
    box.y = 0;
    assert.equal(moveX(spikes, box, 24), CONTACT.hazard);
    assert.equal(box.x, 40);
});

test("platformer solid wall and ceiling sweeps stop at the tile boundary", () => {
    const wall = parseLevel(["...#....", "P..#...E", "########"]);
    const box = { x: 16, y: 16, w: 12, h: 14 };
    assert.ok(moveX(wall, box, 100) & CONTACT.wall);
    assert.equal(box.x + box.w, 48);
    box.x = 80;
    assert.ok(moveX(wall, box, -100) & CONTACT.wall);
    assert.equal(box.x, 64);
    box.x = 32;
    box.y = 50;
    assert.ok(moveY(CEILING, box, -100, 64) & CONTACT.ceiling);
    assert.equal(box.y, 32);
});

test("platformer controller grounds on landing and zeroes upward velocity at a ceiling", async () => {
    const harness = await createHarness([CEILING], jumpScript(60, [0]));
    try {
        let hitCeiling = false;
        let landed = false;
        for (let tick = 0; tick < 60; tick++) {
            await harness.frame();
            const body = player(harness.game, "body");
            const position = player(harness.game, "position");
            if (position.y === 32) {
                assert.equal(body.vy, 0);
                hitCeiling = true;
            }
            if (body.grounded) {
                assert.equal(position.y, 50);
                assert.equal(body.vy, 0);
                landed = true;
                break;
            }
        }
        assert.ok(hitCeiling);
        assert.ok(landed);
    } finally {
        harness.dispose();
    }
});

test("platformer coyote jump works six ticks after leaving a ledge and expires on the seventh", async () => {
    const script = new Map<number, ScheduledTick>(
        Array.from({ length: 80 }, (_, tick) => [tick, { input: createInput(["ArrowRight"]) }]),
    );
    const probe = await createHarness([LEDGE], script);
    let leftTick = -1;
    try {
        for (let tick = 0; tick < 60; tick++) {
            await probe.frame();
            if (!player(probe.game, "body").grounded) {
                leftTick = tick;
                break;
            }
        }
        assert.ok(leftTick > 0);
    } finally {
        probe.dispose();
    }
    for (const delay of [6, 7]) {
        const attempt = new Map(script);
        attempt.set(leftTick + delay, { input: createInput(["ArrowRight", "Space"], ["Space"]) });
        const harness = await createHarness([LEDGE], attempt);
        try {
            for (let tick = 0; tick <= leftTick + delay; tick++) await harness.frame();
            const velocity = number(player(harness.game, "body").vy);
            assert.equal(velocity < 0, delay === 6, `Jump at airborne tick +${delay}`);
        } finally {
            harness.dispose();
        }
    }
});

test("platformer jump buffer fires on the sixth eligible tick and expires before the seventh", async () => {
    const probe = await createHarness([FLOOR], jumpScript(90, [0]));
    let landingTick = -1;
    try {
        for (let tick = 0; tick < 90; tick++) {
            await probe.frame();
            if (player(probe.game, "body").grounded) {
                landingTick = tick;
                break;
            }
        }
        assert.ok(landingTick > 10);
    } finally {
        probe.dispose();
    }
    for (const lead of [5, 6]) {
        const harness = await createHarness([FLOOR], jumpScript(90, [0, landingTick - lead]));
        try {
            for (let tick = 0; tick <= landingTick; tick++) await harness.frame();
            const body = player(harness.game, "body");
            assert.equal(number(body.vy) < 0, lead === 5);
            assert.equal(body.grounded, lead !== 5);
            assert.equal(body.jumpBufferTicks, 0);
        } finally {
            harness.dispose();
        }
    }
});

test("platformer jump cut uses held input and reduces apex height without a released edge", async () => {
    const heights: number[] = [];
    for (const releaseTick of [2, 90]) {
        const harness = await createHarness([FLOOR], jumpScript(90, [0], releaseTick));
        try {
            let apex = 50;
            for (let tick = 0; tick < 90; tick++) {
                await harness.frame();
                apex = Math.min(apex, number(player(harness.game, "position").y));
            }
            heights.push(50 - apex);
        } finally {
            harness.dispose();
        }
    }
    assert.ok(heights[1] > heights[0] + 20);
});

test("platformer pure-input determinism A matches after 600 synchronous ticks", async () => {
    const script = new Map<number, ScheduledTick>(
        Array.from({ length: 600 }, (_, tick) => [
            tick,
            {
                input: createInput(
                    [
                        tick % 120 < 60 ? "ArrowRight" : "ArrowLeft",
                        ...(tick % 60 < 20 ? ["Space"] : []),
                    ],
                    tick % 60 === 0 ? ["Space"] : [],
                ),
            },
        ]),
    );
    const a = await createHarness([FLOOR], script);
    const b = await createHarness([FLOOR], script);
    try {
        // No render or promise delivery between these 600 ticks.
        await a.frame(600);
        await b.frame(600);
        assert.deepEqual(a.game.enumerate(), b.game.enumerate());
        assert.equal(a.game.simulationTick, 600);
        assert.equal(a.game.state.deaths, 0);
        assert.ok(a.output.count > 0);
    } finally {
        a.dispose();
        b.dispose();
    }
});

test("platformer first frame shows start and distant checkpoint at both interpolation endpoints", async () => {
    const distant = parseLevel([
        ...Array<string>(14).fill(".".repeat(100)),
        "..P" + ".".repeat(87) + "C....E....",
        "#".repeat(100),
        "#".repeat(100),
    ]);
    for (const checkpoint of [0, 1]) {
        const harness = await createHarness([distant], new Map(), {
            ...createProgress(),
            checkpoint,
        });
        try {
            const before = harness.game.enumerate();
            const camera = record(before.scenes[0].camera);
            assert.ok(number(camera.x) >= 0 && number(camera.x) <= 1120);
            assert.ok(number(camera.y) >= 0 && number(camera.y) <= 2);
            if (checkpoint) assert.equal(camera.x, 1120);
            assert.equal(camera.previousX, camera.x);
            assert.equal(camera.previousY, camera.y);
            const outputs: number[][] = [];
            for (const alpha of [0, 1]) {
                harness.output.reset();
                harness.game.render(harness.output, alpha);
                const offset = (harness.output.count - 1) * 13;
                const x = harness.output.data[offset];
                const y = harness.output.data[offset + 1];
                assert.ok(x >= 6 && x <= WIDTH - 6);
                assert.ok(y >= 7 && y <= HEIGHT - 7);
                outputs.push(Array.from(harness.output.data.slice(0, harness.output.count * 13)));
            }
            assert.deepEqual(outputs[0], outputs[1]);
            assert.deepEqual(harness.game.enumerate(), before);
        } finally {
            harness.dispose();
        }
    }
});

test("platformer delayed respawn activates on the first tick after the delivery frame", async () => {
    const gate = Promise.withResolvers<void>();
    const script = new Map<number, ScheduledTick>(
        Array.from({ length: 150 }, (_, tick) => [tick, { input: createInput(["ArrowRight"]) }]),
    );
    const preparedKeys: string[] = [];
    const harness = await createHarness(
        [LEDGE],
        script,
        createProgress(),
        async (game, definition, key) => {
            preparedKeys.push(key);
            const handle = await game.prepare(definition, { key });
            await gate.promise;
            return handle;
        },
    );
    try {
        let deathTick = -1;
        for (let tick = 0; tick < 150; tick++) {
            await harness.frame();
            if (harness.game.state.deaths === 1) {
                deathTick = harness.game.simulationTick;
                break;
            }
        }
        assert.ok(deathTick > 0);
        const owner = harness.game.scenes[0].id;
        const frozenPosition = player(harness.game, "position");
        for (let tick = 0; tick < 35; tick++) await harness.frame();
        assert.equal(harness.game.scenes[0].id, owner);
        assert.equal(harness.game.state.deaths, 1);
        assert.deepEqual(player(harness.game, "position"), frozenPosition);
        assert.deepEqual(preparedKeys, ["level-0-attempt-1"]);
        const deliveryTick = harness.game.simulationTick;
        gate.resolve();
        await harness.frame(0); // Frame F delivers the candidate after rendering/reconcile.
        assert.equal(harness.game.simulationTick, deliveryTick);
        assert.equal(harness.game.scenes[0].id, owner);
        await harness.frame(); // First tick of frame F+1 can consume it.
        assert.equal(harness.game.simulationTick, deliveryTick + 1);
        assert.notEqual(harness.game.scenes[0].id, owner);
        assert.equal(harness.game.scenes[0].key, "level-0-attempt-1");
        assert.equal(player(harness.game, "position").x, LEDGE.start.x * TILE + 2);
        assert.deepEqual(preparedKeys, ["level-0-attempt-1", "level-0-attempt-2"]);
    } finally {
        gate.resolve();
        harness.dispose();
    }
});
