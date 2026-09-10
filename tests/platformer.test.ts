import assert from "node:assert/strict";
import { test } from "node:test";

import { CONTACT, moveX, moveY } from "../examples/platformer/collision.js";
import {
    createOverlay,
    createProgress,
    HEIGHT,
    transition,
    WIDTH,
} from "../examples/platformer/game.js";
import type { Progress, ProgressCommand } from "../examples/platformer/game.js";
import { LEVEL_ONE, LEVEL_TWO, parseLevel, TILE } from "../examples/platformer/levels.js";
import type { LevelData } from "../examples/platformer/levels.js";
import { createTransitionRegistry, levelKey } from "../examples/platformer/transitions.js";
import type { RegistryOptions } from "../examples/platformer/transitions.js";
import { emptyInput, Frame, Game } from "../src/index.js";
import type {
    GameInspection,
    InputSnapshot,
    InspectionValue,
    PreparedScene,
    SceneDefinition,
    SceneSetup,
} from "../src/index.js";

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
type Definition = SceneDefinition<Progress, ProgressCommand>;
type BasePrepare = (definition: Definition, key: string) => Promise<PreparedScene>;
type PrepareOverride = (
    game: Game<Progress, ProgressCommand>,
    definition: Definition,
    key: string,
    prepare: BasePrepare,
) => Promise<PreparedScene>;

function createInput(
    held: readonly string[] = [],
    pressed: readonly string[] = [],
    released: readonly string[] = [],
): InputSnapshot {
    return Object.freeze({
        ...emptyInput(),
        held: Object.freeze([...held]),
        pressed: Object.freeze([...pressed]),
        released: Object.freeze([...released]),
    });
}

async function createHarness(
    fixtureLevels: readonly LevelData[],
    script: ReadonlyMap<number, ScheduledTick> = new Map(),
    progress = createProgress(),
    prepare?: PrepareOverride,
    config: { allowErrors?: boolean; capture?: boolean; audio?: RegistryOptions["audio"] } = {},
) {
    const errors: unknown[] = [];
    const commands: { tick: number; command: ProgressCommand }[] = [];
    const snapshots: GameInspection[] = [];
    const game = new Game<Progress, ProgressCommand>({
        seed: "platformer-test",
        state: progress,
        transition: (state, command) => {
            commands.push({ tick: game.simulationTick, command });
            return transition(state, command);
        },
        diagnostic: (error) => errors.push(error),
    });
    const registry = createTransitionRegistry({
        levels: fixtureLevels,
        prepare,
        overlay: createOverlay,
        audio: config.audio,
        onError: (error) => errors.push(error),
    });
    const output = new Frame();
    await game.start(
        await game.prepare(registry.createLevelDefinition(progress.level), {
            key: levelKey(progress.level, progress.attempt),
        }),
    );
    if (prepare) {
        const basePrepare = game.prepare.bind(game);
        game.prepare = (definition, prepareOptions) =>
            prepare(game, definition, prepareOptions.key, (target, key) =>
                basePrepare(target, { ...prepareOptions, key }),
            );
    }
    return {
        game,
        registry,
        output,
        errors,
        commands,
        snapshots,
        async frame(ticks = 1) {
            for (let tick = 0; tick < ticks; tick++) {
                const scheduled = script.get(game.simulationTick);
                if (scheduled?.intent) registry.request(scheduled.intent);
                game.tick(scheduled?.input ?? emptyInput(), DISPLAY);
                if (config.capture) snapshots.push(game.enumerate());
            }
            output.reset();
            game.render(output, 0.5);
            registry.reconcile(game);
            // One event-loop microtask checkpoint, including nested prepare continuations.
            await new Promise<void>((resolve) => setImmediate(resolve));
            if (!config.allowErrors) assert.deepEqual(errors, []);
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

function player(game: Game<Progress, ProgressCommand>, name: string, index = 0) {
    const scene = game.enumerate().scenes[0];
    assert.ok(scene);
    const entities = record(scene.world).entities;
    assert.ok(Array.isArray(entities));
    const components = record(entities[index]).components;
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
        async (_game, definition, key, prepare) => {
            preparedKeys.push(key);
            const handle = await prepare(definition, key);
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
        assert.deepEqual(
            preparedKeys.filter((key) => key !== "pause"),
            ["level-0-attempt-1"],
        );
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
        assert.deepEqual(
            preparedKeys.filter((key) => key !== "pause"),
            ["level-0-attempt-1", "level-0-attempt-2"],
        );
    } finally {
        gate.resolve();
        harness.dispose();
    }
});

const QUICK = parseLevel(["....", "PE..", "####"]);
const PROGRESSION = parseLevel(["..............", "PC.C...^....E.", "##############"]);
const PATROL_WALL = parseLevel(["..............", "P...G.#.....E.", "##############"]);
const PATROL_LEDGE = parseLevel(["..............", "P...G.......E.", "######......##"]);
type Harness = Awaited<ReturnType<typeof createHarness>>;

function runOf(harness: Harness) {
    return record(record(harness.game.enumerate().scenes[0].resources).run);
}

async function drive(
    harness: Harness,
    script: Map<number, ScheduledTick>,
    input: InputSnapshot,
    until: () => boolean,
    limit = 200,
): Promise<void> {
    for (let tick = 0; tick < limit && !until(); tick++) {
        script.set(harness.game.simulationTick, { input });
        await harness.frame();
    }
    assert.ok(until(), `Condition not reached after ${limit} ticks`);
}

function rendered(harness: Harness, alpha: number, sprites?: number): number[] {
    const frame = new Frame();
    harness.game.render(frame, alpha);
    return Array.from(frame.data.slice(0, (sprites ?? frame.count) * 13));
}

interface Preparation {
    readonly ownerId: number;
    readonly key: string;
    handle?: PreparedScene;
    mounted: boolean;
    failed: boolean;
}

function createPreparationAudit(
    deliver?: (entry: Preparation) => Promise<void>,
    transform?: (
        definition: SceneDefinition<Progress, ProgressCommand>,
        entry: Preparation,
    ) => SceneDefinition<Progress, ProgressCommand>,
) {
    const entries: Preparation[] = [];
    const prepare: PrepareOverride = async (game, definition, key, basePrepare) => {
        const entry: Preparation = {
            ownerId: game.scenes[0].id,
            key,
            mounted: false,
            failed: false,
        };
        entries.push(entry);
        const target = transform?.(definition, entry) ?? definition;
        try {
            entry.handle = await basePrepare(
                {
                    ...target,
                    setup(scene) {
                        entry.mounted = true;
                        target.setup(scene);
                    },
                },
                key,
            );
            await deliver?.(entry);
            return entry.handle;
        } catch (error) {
            entry.failed = true;
            entry.handle?.release();
            throw error;
        }
    };
    return { entries, prepare };
}

/** Probe through the public engine boundary: a released handle must reject activation. */
function assertReleased(harness: Harness, entries: readonly Preparation[]): void {
    for (const entry of entries) {
        if (entry.mounted || entry.failed) continue;
        assert.ok(entry.handle, `Undelivered candidate ${entry.key}`);
        const before = harness.game.scenes.map((scene) => scene.id);
        const errors = harness.errors.length;
        harness.game.set(entry.handle);
        harness.game.tick(emptyInput(), DISPLAY);
        assert.deepEqual(
            harness.game.scenes.map((scene) => scene.id),
            before,
            `${entry.key} must be released`,
        );
        assert.equal(harness.errors.length, errors + 1);
        assert.match(String(harness.errors.at(-1)), /stale|consumed|foreign/);
        harness.errors.pop();
    }
}

/** A fixture trap changes a scene-owned tile before the ordinary controller runs. */
function createTrap(
    definition: SceneDefinition<Progress, ProgressCommand>,
    tile: number,
    triggerTick: number,
): SceneDefinition<Progress, ProgressCommand> {
    return {
        ...definition,
        setup(scene) {
            const fixture = scene.resource<{ ticks: number; tiles?: Uint8Array }>("fixture-trap", {
                ticks: 0,
            });
            scene.system(() => {
                fixture.ticks++;
                if (fixture.ticks === triggerTick && fixture.tiles) fixture.tiles[tile] = 3;
            });
            const resource: SceneSetup<Progress, ProgressCommand>["resource"] = (
                name,
                value,
                cleanup,
            ) => {
                if (name === "tiles" && value instanceof Uint8Array) fixture.tiles = value;
                return scene.resource(name, value, cleanup);
            };
            definition.setup({ ...scene, resource });
        },
    };
}

test("platformer level two has distinct identity, long scroll, hazards, patrols and one-way platforms", async () => {
    assert.equal(LEVEL_TWO.widthTiles, 140);
    assert.equal(LEVEL_TWO.heightTiles, 17);
    assert.ok(LEVEL_TWO.tiles.includes(2) && LEVEL_TWO.tiles.includes(3));
    assert.ok(LEVEL_TWO.patrols.length > 0 && LEVEL_TWO.checkpoints.length > 0);
    const harness = await createHarness([LEVEL_ONE, LEVEL_TWO], new Map(), {
        ...createProgress(),
        level: 1,
    });
    try {
        assert.equal(harness.game.scenes[0].definition, "platformer-level-1");
    } finally {
        harness.dispose();
    }
});

test("platformer patrols turn at walls and ledge edges without leaving support", async () => {
    for (const data of [PATROL_WALL, PATROL_LEDGE]) {
        const harness = await createHarness([data]);
        try {
            let turned = false;
            for (let tick = 0; tick < 50; tick++) {
                await harness.frame();
                assert.ok(number(player(harness.game, "position", 1).x) + 12 <= 96);
                assert.equal(player(harness.game, "position", 1).y, 18);
                if (player(harness.game, "actor", 1).facing === -1) {
                    turned = true;
                    break;
                }
            }
            assert.ok(turned);
        } finally {
            harness.dispose();
        }
    }
});

test("platformer patrol contact kills while patrols keep moving during death", async () => {
    const script = new Map<number, ScheduledTick>();
    const harness = await createHarness([PATROL_WALL], script);
    try {
        await drive(
            harness,
            script,
            createInput(["ArrowRight"]),
            () => harness.game.state.deaths === 1,
        );
        const playerBefore = player(harness.game, "position");
        const patrolBefore = player(harness.game, "position", 1);
        await harness.frame(5);
        assert.deepEqual(player(harness.game, "position"), playerBefore);
        assert.notDeepEqual(player(harness.game, "position", 1), patrolBefore);
        assert.equal(harness.commands.filter((entry) => entry.command.type === "died").length, 1);
        await harness.frame(25);
        assert.equal(harness.game.scenes[0].entityCount, 2);
        assert.equal(player(harness.game, "position", 1).x, PATROL_WALL.patrols[0].x * TILE + 2);
        assert.equal(player(harness.game, "actor", 1).facing, 1);
    } finally {
        harness.dispose();
    }
});

test("platformer checkpoints advance, never regress, and rebuild at the latest marker after death", async () => {
    const script = new Map<number, ScheduledTick>();
    const harness = await createHarness([PROGRESSION], script);
    try {
        await drive(
            harness,
            script,
            createInput(["ArrowRight"]),
            () => harness.game.state.checkpoint === 2,
        );
        await drive(
            harness,
            script,
            createInput(["ArrowLeft"]),
            () => number(player(harness.game, "position").x) < 16,
        );
        assert.equal(harness.game.state.checkpoint, 2);
        assert.deepEqual(
            harness.commands
                .filter((entry) => entry.command.type === "checkpoint")
                .map((entry) => entry.command),
            [
                { type: "checkpoint", checkpoint: 1 },
                { type: "checkpoint", checkpoint: 2 },
            ],
        );
        await drive(
            harness,
            script,
            createInput(["ArrowRight"]),
            () => harness.game.state.deaths === 1,
        );
        const owner = harness.game.scenes[0].id;
        await drive(harness, script, emptyInput(), () => harness.game.scenes[0].id !== owner);
        assert.equal(player(harness.game, "position").x, PROGRESSION.checkpoints[1].x * TILE + 2);
        assert.equal(player(harness.game, "position").y, PROGRESSION.checkpoints[1].y * TILE + 2);
        const fresh = await createHarness([PROGRESSION], new Map(), {
            ...createProgress(),
            checkpoint: 2,
            attempt: 1,
            deaths: 1,
        });
        try {
            assert.equal(harness.game.scenes[0].entityCount, fresh.game.scenes[0].entityCount);
        } finally {
            fresh.dispose();
        }
        assert.equal(harness.commands.filter((entry) => entry.command.type === "died").length, 1);
    } finally {
        harness.dispose();
    }
});

test("platformer death before checkpoint waits thirty ticks for ready respawn and returns to start", async () => {
    const script = new Map<number, ScheduledTick>();
    const harness = await createHarness([LEDGE], script);
    try {
        await drive(
            harness,
            script,
            createInput(["ArrowRight"]),
            () => harness.game.state.deaths === 1,
        );
        const owner = harness.game.scenes[0].id;
        assert.equal(runOf(harness).deathTimer, 30);
        for (let tick = 0; tick < 29; tick++) await harness.frame();
        assert.equal(harness.game.scenes[0].id, owner);
        assert.equal(runOf(harness).deathTimer, 1);
        await harness.frame();
        assert.notEqual(harness.game.scenes[0].id, owner);
        assert.equal(player(harness.game, "position").x, LEDGE.start.x * TILE + 2);
        assert.equal(harness.game.state.checkpoint, 0);
        assert.equal(harness.game.state.attempt, 1);
        assert.equal(harness.commands.filter((entry) => entry.command.type === "died").length, 1);
    } finally {
        harness.dispose();
    }
});

test("platformer fatal contact wins over checkpoint and exit contacts on the same tick", async () => {
    for (const terminal of ["checkpoint", "exit"] as const) {
        const base = parseLevel(["....", "P.CE", "####"]);
        const data = Object.freeze({
            ...base,
            start: terminal === "checkpoint" ? base.checkpoints[0] : base.exit,
        });
        const trapTile = data.start.y * data.widthTiles + data.start.x;
        // Adversarial fixture: overlapping marker and hazard exercise authority precedence.
        const hazard = Object.freeze({ ...data, tiles: data.tiles.slice() });
        hazard.tiles[trapTile] = 3;
        const testHarness = await createHarness([QUICK, hazard], new Map(), {
            ...createProgress(),
            level: 1,
        });
        try {
            await testHarness.frame(0);
            testHarness.registry.request("pause");
            await testHarness.frame();
            assert.equal(testHarness.game.state.deaths, 1);
            assert.equal(testHarness.game.state.checkpoint, 0);
            assert.equal(testHarness.game.state.level, 1);
            assert.equal(testHarness.game.scenes.length, 1);
            assert.equal(runOf(testHarness).pauseRequested, false);
            assert.deepEqual(
                testHarness.commands.map((entry) => entry.command),
                [{ type: "died" }],
            );
        } finally {
            testHarness.dispose();
        }
    }
});

test("platformer exit dispatches once with replacement, finishes level two and waits for restart delivery", async () => {
    const gate = Promise.withResolvers<void>();
    const audit = createPreparationAudit((entry) =>
        entry.key === "level-0-attempt-0" ? gate.promise : Promise.resolve(),
    );
    const script = new Map<number, ScheduledTick>();
    const harness = await createHarness([QUICK, QUICK], script, createProgress(), audit.prepare);
    try {
        await drive(
            harness,
            script,
            createInput(["ArrowRight"]),
            () => harness.game.state.level === 1,
        );
        assert.equal(harness.game.scenes[0].definition, "platformer-level-1");
        assert.equal(runOf(harness).levelIndex, 1);
        await drive(
            harness,
            script,
            createInput(["ArrowRight"]),
            () => harness.game.state.level === 2,
        );
        assert.equal(harness.game.scenes.length, 1);
        assert.equal(harness.game.scenes[0].definition, "platformer-complete");
        assert.deepEqual(harness.game.state.completed, [true, true]);
        const owner = harness.game.scenes[0].id;
        for (let tick = 0; tick < 5; tick++) {
            script.set(harness.game.simulationTick, {
                input: createInput([], ["Enter"]),
                intent: "restart",
            });
            await harness.frame();
        }
        assert.equal(harness.game.scenes[0].id, owner);
        assert.equal(harness.game.state.runs, 0);
        assert.equal(harness.commands.filter((entry) => entry.command.type === "exit").length, 2);
        assert.equal(
            harness.commands.filter((entry) => entry.command.type === "restart").length,
            0,
        );
        gate.resolve();
        await harness.frame(0);
        const deliveryTick = harness.game.simulationTick;
        await harness.frame();
        assert.equal(harness.game.scenes[0].key, "level-0-attempt-0");
        assert.deepEqual(harness.game.state, { ...createProgress(), runs: 1 });
        assert.deepEqual(
            harness.commands.filter((entry) => entry.command.type === "restart"),
            [{ tick: deliveryTick, command: { type: "restart" } }],
        );
        harness.registry.dispose();
        assertReleased(harness, audit.entries);
    } finally {
        gate.resolve();
        harness.dispose();
    }
});

test("platformer pause preserves poses and current rendering through suspension and the pop frame", async () => {
    const script = new Map<number, ScheduledTick>();
    const harness = await createHarness([FLOOR], script);
    try {
        await harness.frame(0);
        script.set(0, { input: createInput(["ArrowRight"]) });
        script.set(1, { input: createInput(["ArrowRight"], ["KeyP"]) });
        await harness.frame(2);
        assert.equal(harness.game.scenes.length, 2);
        const before = harness.game.enumerate().scenes[0];
        const lowerSprites = harness.output.count - 1;
        const current = rendered(harness, 1, lowerSprites);
        await harness.frame(5);
        assert.deepEqual(harness.game.enumerate().scenes[0], before);
        assert.deepEqual(rendered(harness, 0, lowerSprites), current);
        assert.deepEqual(rendered(harness, 0.5, lowerSprites), current);
        script.set(harness.game.simulationTick, {
            input: createInput([], ["KeyP"]),
            intent: "resume",
        });
        await harness.frame();
        assert.equal(harness.game.scenes.length, 1, "DOM and key resume coalesce to one pop");
        assert.deepEqual(harness.game.enumerate().scenes[0], before);
        assert.deepEqual(rendered(harness, 0), current);
        script.set(harness.game.simulationTick, { input: createInput(["ArrowRight"]) });
        await harness.frame();
        assert.notDeepEqual(rendered(harness, 0), rendered(harness, 1));
    } finally {
        harness.dispose();
    }
});

test("platformer jump release consumed during pause still cuts the jump on resume", async () => {
    const script = new Map<number, ScheduledTick>([
        [0, { input: createInput(["Space"], ["Space"]) }],
        [1, { input: createInput(["Space"], ["KeyP"]) }],
        [2, { input: createInput([], [], ["Space"]) }],
        [3, { intent: "resume" }],
    ]);
    const harness = await createHarness([FLOOR], script);
    try {
        await harness.frame(0);
        await harness.frame(2);
        const rising = number(player(harness.game, "body").vy);
        assert.ok(rising < -140);
        await harness.frame(2);
        assert.equal(player(harness.game, "body").vy, rising);
        await harness.frame();
        assert.ok(number(player(harness.game, "body").vy) >= -140);
    } finally {
        harness.dispose();
    }
});

test("platformer catch-up mount then death derives respawn from mounted key rather than advanced state", async () => {
    const script = new Map<number, ScheduledTick>();
    const audit = createPreparationAudit(undefined, (definition, entry) =>
        entry.key === "level-0-attempt-1"
            ? createTrap(definition, LEDGE.start.y * LEDGE.widthTiles + LEDGE.start.x, 2)
            : definition,
    );
    const harness = await createHarness([LEDGE], script, createProgress(), audit.prepare, {
        capture: true,
    });
    try {
        await drive(
            harness,
            script,
            createInput(["ArrowRight"]),
            () => harness.game.state.deaths === 1,
        );
        for (let tick = 0; tick < 29; tick++) await harness.frame();
        const frameStart = harness.game.simulationTick;
        await harness.frame(5);
        const mount = harness.snapshots[frameStart];
        const alive = harness.snapshots[frameStart + 1];
        const death = harness.snapshots[frameStart + 2];
        assert.equal(mount.scenes[0].key, "level-0-attempt-1");
        assert.equal(record(mount.state).attempt, 1);
        assert.equal(record(alive.state).deaths, 1);
        assert.equal(record(death.state).deaths, 2);
        assert.equal(harness.game.state.attempt, 2);
        assert.equal(harness.game.scenes[0].key, "level-0-attempt-1");
        const owned = audit.entries.filter(
            (entry) => entry.ownerId === mount.scenes[0].id && entry.key !== "pause",
        );
        assert.deepEqual(
            owned.map((entry) => entry.key),
            ["level-0-attempt-2"],
        );
    } finally {
        harness.dispose();
    }
});

test("platformer pause preparation is deduplicated and a pending pause edge is retained", async () => {
    const gate = Promise.withResolvers<void>();
    const audit = createPreparationAudit((entry) =>
        entry.key === "pause" ? gate.promise : Promise.resolve(),
    );
    const script = new Map<number, ScheduledTick>();
    const harness = await createHarness([FLOOR], script, createProgress(), audit.prepare);
    try {
        await harness.frame(0);
        script.set(0, { input: createInput([], ["KeyP"]) });
        await harness.frame();
        for (let frame = 0; frame < 5; frame++) await harness.frame();
        assert.equal(harness.game.scenes.length, 1);
        assert.equal(runOf(harness).pauseRequested, true);
        assert.equal(audit.entries.filter((entry) => entry.key === "pause").length, 1);
        gate.resolve();
        await harness.frame(0);
        const deliveredAt = harness.game.simulationTick;
        await harness.frame();
        assert.equal(harness.game.simulationTick, deliveredAt + 1);
        assert.equal(harness.game.scenes.length, 2);
        assert.equal(runOf(harness).pauseRequested, false);
        assert.equal(
            audit.entries.filter((entry) => entry.key === "pause").length,
            2,
            "Exactly one replacement after consumption",
        );
        await harness.frame(0);
        assert.equal(audit.entries.filter((entry) => entry.key === "pause").length, 2);
    } finally {
        gate.resolve();
        harness.dispose();
    }
});

test("platformer pause replenishment gap retains a second pause and ignores hidden-tab pause while already paused", async () => {
    const gate = Promise.withResolvers<void>();
    let pausePreparations = 0;
    const audit = createPreparationAudit((entry) => {
        if (entry.key === "pause" && ++pausePreparations === 2) return gate.promise;
        return Promise.resolve();
    });
    const script = new Map<number, ScheduledTick>();
    const harness = await createHarness([FLOOR], script, createProgress(), audit.prepare);
    try {
        await harness.frame(0);
        script.set(0, { intent: "pause" });
        script.set(1, { intent: "pause" }); // tab hides while already suspended
        script.set(2, { intent: "resume" });
        await harness.frame();
        await harness.frame(2);
        assert.equal(harness.game.scenes.length, 1);
        await harness.frame();
        assert.equal(
            runOf(harness).pauseRequested,
            false,
            "Hidden-tab request must not re-pause on resume",
        );
        script.set(harness.game.simulationTick, { input: createInput([], ["Escape"]) });
        await harness.frame();
        assert.equal(runOf(harness).pauseRequested, true);
        await harness.frame(0);
        await harness.frame(0);
        assert.equal(pausePreparations, 2);
        gate.resolve();
        await harness.frame(0);
        await harness.frame();
        assert.equal(harness.game.scenes.length, 2);
        assert.equal(pausePreparations, 3);
    } finally {
        gate.resolve();
        harness.dispose();
    }
});

test("platformer death and pending exit discard pause requests and freeze player physics", async () => {
    for (const phase of ["dying", "exiting"] as const) {
        const gate = Promise.withResolvers<void>();
        const data = phase === "dying" ? LEDGE : QUICK;
        const audit = createPreparationAudit((entry) =>
            entry.key === "level-1-attempt-0" ? gate.promise : Promise.resolve(),
        );
        const script = new Map<number, ScheduledTick>();
        const harness = await createHarness([data, QUICK], script, createProgress(), audit.prepare);
        try {
            await drive(
                harness,
                script,
                createInput(["ArrowRight"]),
                () => runOf(harness).phase === phase,
            );
            const pose = player(harness.game, "position");
            const body = player(harness.game, "body");
            for (let tick = 0; tick < 5; tick++) {
                script.set(harness.game.simulationTick, {
                    intent: "pause",
                    input: createInput(["ArrowRight", "Space"], ["KeyP", "Space"]),
                });
                await harness.frame();
                assert.equal(harness.game.scenes.length, 1);
                assert.equal(runOf(harness).pauseRequested, false);
            }
            assert.deepEqual(player(harness.game, "position"), pose);
            assert.deepEqual(player(harness.game, "body"), body);
            if (phase === "exiting")
                assert.equal(
                    harness.commands.filter((entry) => entry.command.type === "exit").length,
                    0,
                );
        } finally {
            gate.resolve();
            harness.dispose();
        }
    }
});

test("platformer completion releases previous owners before restart, including late same-key results", async () => {
    const gate = Promise.withResolvers<void>();
    const audit = createPreparationAudit((entry) =>
        entry.ownerId === 1 && entry.key === "level-0-attempt-1" ? gate.promise : Promise.resolve(),
    );
    const script = new Map<number, ScheduledTick>();
    const harness = await createHarness([QUICK, QUICK], script, createProgress(), audit.prepare);
    try {
        const firstOwner = harness.game.scenes[0];
        await drive(
            harness,
            script,
            createInput(["ArrowRight"]),
            () => harness.game.state.level === 1,
        );
        const lastLevel = harness.game.scenes[0].id;
        await drive(
            harness,
            script,
            createInput(["ArrowRight"]),
            () => harness.game.state.level === 2,
        );
        assertReleased(
            harness,
            audit.entries.filter((entry) => entry.ownerId === lastLevel),
        );
        script.set(harness.game.simulationTick, { intent: "restart" });
        await harness.frame();
        assert.equal(harness.game.scenes[0].key, firstOwner.key);
        assert.notEqual(harness.game.scenes[0].id, firstOwner.id);
        gate.resolve();
        await harness.frame(0);
        assertReleased(
            harness,
            audit.entries.filter((entry) => entry.ownerId === firstOwner.id),
        );
        harness.registry.dispose();
        assertReleased(harness, audit.entries);
        assert.ok(audit.entries.some((entry) => entry.mounted && entry.key === "complete"));
        assert.ok(
            audit.entries.some((entry) => entry.mounted && entry.key === "level-0-attempt-0"),
        );
    } finally {
        gate.resolve();
        harness.dispose();
    }
});

test("platformer failed preparations retry once, surface the second error and stay terminal", async () => {
    let attempts = 0;
    const fault = new Error("Injected pause preparation failure");
    const harness = await createHarness(
        [FLOOR],
        new Map(),
        createProgress(),
        async (_game, definition, key, prepare) => {
            if (key === "pause") {
                attempts++;
                throw fault;
            }
            return prepare(definition, key);
        },
        { allowErrors: true },
    );
    try {
        await harness.frame(0);
        assert.equal(attempts, 2);
        assert.deepEqual(harness.errors, [fault]);
        for (let frame = 0; frame < 5; frame++) await harness.frame(0);
        assert.equal(attempts, 2);
        assert.deepEqual(harness.errors, [fault]);
    } finally {
        harness.dispose();
    }
});

test("platformer first preparation failure recovers on the one allowed retry", async () => {
    let attempts = 0;
    const script = new Map<number, ScheduledTick>();
    const harness = await createHarness(
        [FLOOR],
        script,
        createProgress(),
        (_game, definition, key, prepare) => {
            if (key === "pause" && ++attempts === 1) return Promise.reject(new Error("Retry me"));
            return prepare(definition, key);
        },
    );
    try {
        await harness.frame(0);
        await harness.frame(0);
        script.set(0, { intent: "pause" });
        await harness.frame();
        assert.equal(harness.game.scenes.length, 2);
        assert.deepEqual(harness.errors, []);
    } finally {
        harness.dispose();
    }
});

test("platformer registry disposal releases ready handles and late preparations and is idempotent", async () => {
    const gate = Promise.withResolvers<void>();
    const audit = createPreparationAudit((entry) =>
        entry.key === "pause" ? gate.promise : Promise.resolve(),
    );
    const harness = await createHarness([FLOOR, QUICK], new Map(), createProgress(), audit.prepare);
    try {
        await harness.frame(0);
        const count = audit.entries.length;
        harness.registry.dispose();
        harness.registry.dispose();
        gate.resolve();
        await harness.frame(0);
        assert.equal(audit.entries.length, count);
        assertReleased(harness, audit.entries);
    } finally {
        gate.resolve();
        harness.dispose();
    }
});

test("platformer stop reconciliation drops invalidated candidates before resuming the same instance", async () => {
    const audit = createPreparationAudit();
    const harness = await createHarness([FLOOR], new Map(), createProgress(), audit.prepare);
    try {
        await harness.frame(0);
        const original = [...audit.entries];
        const owner = harness.game.scenes[0].id;
        harness.game.stop();
        harness.registry.reconcile(harness.game);
        await harness.game.start();
        await harness.frame(0);
        assert.equal(harness.game.scenes[0].id, owner);
        assert.equal(audit.entries.length, original.length * 2);
        assertReleased(harness, original);
    } finally {
        harness.dispose();
    }
});

test("platformer failed exit and restart mounts leave a terminal authority without repeated commands", async () => {
    for (const command of ["exit", "restart"] as const) {
        const audit = createPreparationAudit(undefined, (definition, entry) =>
            entry.key === (command === "exit" ? "level-1-attempt-0" : "level-0-attempt-0")
                ? {
                      ...definition,
                      setup() {
                          throw new Error("Injected mount failure");
                      },
                  }
                : definition,
        );
        const script = new Map<number, ScheduledTick>();
        const harness = await createHarness(
            [QUICK, QUICK],
            script,
            createProgress(),
            audit.prepare,
            { allowErrors: true },
        );
        try {
            if (command === "exit") {
                await drive(
                    harness,
                    script,
                    createInput(["ArrowRight"]),
                    () => harness.errors.length > 0,
                );
                assert.equal(harness.game.state.level, 1);
                assert.equal(harness.game.scenes[0].key, "level-0-attempt-0");
                assert.equal(runOf(harness).phase, "transitioning");
            } else {
                await drive(
                    harness,
                    script,
                    createInput(["ArrowRight"]),
                    () => harness.game.state.level === 2,
                );
                script.set(harness.game.simulationTick, { intent: "restart" });
                await harness.frame();
                assert.equal(harness.game.state.level, 0);
                assert.equal(harness.game.scenes[0].key, "complete");
            }
            const count = harness.commands.filter((entry) => entry.command.type === command).length;
            for (let tick = 0; tick < 5; tick++) {
                script.set(harness.game.simulationTick, {
                    intent: "restart",
                    input: createInput([], ["Enter"]),
                });
                await harness.frame();
            }
            assert.equal(
                harness.commands.filter((entry) => entry.command.type === command).length,
                count,
            );
            assert.equal(harness.errors.length, 1);
        } finally {
            harness.dispose();
        }
    }
});

test("platformer host-driven determinism B matches every tick through checkpoints, death, exits, pause and restart", async () => {
    const script = new Map<number, ScheduledTick>();
    const first = await createHarness([PROGRESSION, QUICK], script, createProgress(), undefined, {
        capture: true,
    });
    try {
        await drive(
            first,
            script,
            createInput(["ArrowRight"]),
            () => first.game.state.checkpoint === 2,
        );
        await drive(
            first,
            script,
            createInput(["ArrowRight"]),
            () => first.game.state.deaths === 1,
        );
        const owner = first.game.scenes[0].id;
        await drive(first, script, emptyInput(), () => first.game.scenes[0].id !== owner);
        script.set(first.game.simulationTick, { intent: "pause" });
        await first.frame();
        assert.equal(first.game.scenes.length, 2);
        await first.frame();
        script.set(first.game.simulationTick, { intent: "resume" });
        await first.frame();
        await drive(
            first,
            script,
            createInput(["ArrowRight"]),
            () => number(player(first.game, "position").x) >= 82,
        );
        script.set(first.game.simulationTick, {
            input: createInput(["ArrowRight", "Space"], ["Space"]),
        });
        await first.frame();
        await drive(
            first,
            script,
            createInput(["ArrowRight", "Space"]),
            () => first.game.state.level === 1,
        );
        await drive(first, script, createInput(["ArrowRight"]), () => first.game.state.level === 2);
        script.set(first.game.simulationTick, { intent: "restart" });
        await first.frame();
        assert.deepEqual(first.game.state, { ...createProgress(), runs: 1 });
        assert.deepEqual(
            first.commands.map((entry) => entry.command.type),
            ["checkpoint", "checkpoint", "died", "exit", "exit", "restart"],
        );
        const second = await createHarness(
            [PROGRESSION, QUICK],
            script,
            createProgress(),
            undefined,
            { capture: true },
        );
        try {
            for (let tick = 0; tick < first.game.simulationTick; tick++) {
                await second.frame();
                assert.deepEqual(
                    second.snapshots[tick],
                    first.snapshots[tick],
                    `Determinism at tick ${tick + 1}`,
                );
            }
            assert.deepEqual(second.commands, first.commands);
        } finally {
            second.dispose();
        }
    } finally {
        first.dispose();
    }
});

test("platformer audio cues are scene scoped, optional and disposed on death remount", async () => {
    const scopes: { id: string; frequencies: number[]; disposed: boolean }[] = [];
    const audio: NonNullable<RegistryOptions["audio"]> = {
        scene(id) {
            const scope = { id, frequencies: [] as number[], disposed: false };
            scopes.push(scope);
            return {
                play(sound) {
                    if ("frequency" in sound) scope.frequencies.push(sound.frequency);
                },
                volume() {},
                dispose() {
                    scope.disposed = true;
                },
            };
        },
    };
    const script = new Map<number, ScheduledTick>();
    const harness = await createHarness([PROGRESSION], script, createProgress(), undefined, {
        audio,
    });
    try {
        await drive(
            harness,
            script,
            createInput(["ArrowRight"]),
            () => harness.game.state.checkpoint === 2,
        );
        await drive(
            harness,
            script,
            createInput(["ArrowRight"]),
            () => harness.game.state.deaths === 1,
        );
        assert.deepEqual(scopes[0].frequencies, [520, 520, 150]);
        const owner = harness.game.scenes[0].id;
        await drive(harness, script, emptyInput(), () => harness.game.scenes[0].id !== owner);
        assert.equal(scopes[0].disposed, true);
        assert.equal(scopes.length, 2);
        script.set(harness.game.simulationTick, { input: createInput(["Space"], ["Space"]) });
        await harness.frame();
        assert.deepEqual(scopes[1].frequencies, [280]);
        assert.ok(scopes.every((scope) => scope.id === "platformer"));
    } finally {
        harness.dispose();
    }
    assert.ok(scopes.every((scope) => scope.disposed));
});

test("platformer exit beats a simultaneous checkpoint and ready pause request", async () => {
    const data = Object.freeze({
        ...QUICK,
        start: QUICK.exit,
        checkpoints: Object.freeze([QUICK.exit]),
    });
    const harness = await createHarness([data, FLOOR]);
    try {
        await harness.frame(0);
        harness.registry.request("pause");
        await harness.frame();
        assert.equal(harness.game.scenes.length, 1);
        assert.equal(harness.game.state.level, 1);
        assert.equal(harness.game.state.checkpoint, 0);
        assert.deepEqual(
            harness.commands.map((entry) => entry.command),
            [{ type: "exit" }],
        );
    } finally {
        harness.dispose();
    }
});

function walkthroughInput(
    harness: Harness,
    data: LevelData,
    control: { jumpTicks: number },
): InputSnapshot {
    const position = player(harness.game, "position");
    const body = player(harness.game, "body");
    const x = number(position.x);
    const y = number(position.y);
    const right = x + number(body.w);
    const bottom = y + number(body.h);
    const column = Math.floor((right + 6) / TILE);
    const floorRow = Math.floor((bottom + 1) / TILE);
    let gap = true;
    for (let row = floorRow; row < data.heightTiles; row++) {
        const support = data.tiles[row * data.widthTiles + column];
        if (support === 1 || support === 2) gap = false;
    }
    let danger = false;
    for (let tileX = Math.floor(right / TILE); tileX <= Math.floor((right + 22) / TILE); tileX++)
        for (let tileY = Math.floor(y / TILE); tileY <= Math.floor((bottom - 1) / TILE); tileY++)
            if (data.tiles[tileY * data.widthTiles + tileX] === 3) danger = true;
    for (let index = 1; index <= data.patrols.length; index++) {
        const patrol = player(harness.game, "position", index);
        const distance = number(patrol.x) - right;
        if (distance >= -12 && distance <= 36 && Math.abs(number(patrol.y) - y) < TILE)
            danger = true;
    }
    const jump = body.grounded === true && control.jumpTicks === 0 && (gap || danger);
    if (jump) control.jumpTicks = 24;
    const hold = control.jumpTicks > 0;
    if (hold) control.jumpTicks--;
    return createInput(hold ? ["ArrowRight", "Space"] : ["ArrowRight"], jump ? ["Space"] : []);
}

async function runAuthoredWalkthrough() {
    const levels = [LEVEL_ONE, LEVEL_TWO];
    const script = new Map<number, ScheduledTick>();
    const harness = await createHarness(levels, script);
    const control = { jumpTicks: 0 };
    try {
        for (let tick = 0; tick < 4000 && harness.game.state.level < 2; tick++) {
            const data = levels[harness.game.state.level];
            script.set(harness.game.simulationTick, {
                input: walkthroughInput(harness, data, control),
            });
            await harness.frame();
            assert.equal(
                harness.game.state.deaths,
                0,
                `Walkthrough death at tick ${tick + 1}, level ${harness.game.state.level + 1}`,
            );
        }
        assert.equal(harness.game.state.level, 2, "Both authored exits reached within 4000 ticks");
        assert.equal(harness.game.scenes[0].definition, "platformer-complete");
        assert.deepEqual(harness.game.state.completed, [true, true]);
        assert.deepEqual(
            harness.commands.map((entry) => entry.command),
            [
                { type: "checkpoint", checkpoint: 1 },
                { type: "exit" },
                { type: "checkpoint", checkpoint: 1 },
                { type: "checkpoint", checkpoint: 2 },
                { type: "exit" },
            ],
        );
        return harness.game.enumerate();
    } finally {
        harness.dispose();
    }
}

test("platformer deterministic reference walkthrough completes both authored levels without deaths", async (context) => {
    const first = await runAuthoredWalkthrough();
    const second = await runAuthoredWalkthrough();
    assert.deepEqual(second, first);
    context.diagnostic(
        `Authored walkthrough: ${first.simulationTick} ticks, 0 deaths, both exits, identical repeated enumeration`,
    );
});
