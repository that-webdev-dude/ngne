import { bool, clamp, component, down, f64, lerp, pressed, u8 } from "ngne";
import type {
    Asset,
    Audio,
    DeepReadonly,
    Entity,
    PreparedScene,
    SceneDefinition,
    SchemaComponentView,
    SchemaQuery,
} from "ngne";

import { CONTACT, moveX, moveY, tileAt } from "./collision.js";
import type { Box } from "./collision.js";
import { TILE } from "./levels.js";
import type { LevelData, Tile } from "./levels.js";

export const WIDTH = 480;
export const HEIGHT = 270;
const SPEED = 150;
const GRAVITY = 1000;
const FALL_SPEED = 600;
const JUMP_SPEED = 340;
const COYOTE_TICKS = 6;
const BUFFER_TICKS = 6;
const PLAYER_WIDTH = 12;
const PLAYER_HEIGHT = 14;
const Position = component("position", { x: f64(), y: f64(), px: f64(), py: f64() });
const Body = component("body", {
    vx: f64(),
    vy: f64(),
    w: f64(PLAYER_WIDTH),
    h: f64(PLAYER_HEIGHT),
    grounded: bool(),
    coyoteTicks: f64(),
    jumpBufferTicks: f64(),
    previousBottom: f64(),
});
/** `kind` 0 is the player, 1 a patrol; `facing` is -1 or 1. */
const Actor = component("actor", { kind: u8(), facing: f64(1) });
type Actors = SchemaQuery<[typeof Position, typeof Body, typeof Actor]>;
type BodyView = SchemaComponentView<typeof Body.fields>;
/** Player views and row, borrowed for the current world commit epoch only. */
interface PlayerRow {
    readonly position: SchemaComponentView<typeof Position.fields>;
    readonly body: BodyView;
    readonly row: number;
}

export interface Progress {
    level: number;
    checkpoint: number;
    attempt: number;
    deaths: number;
    runs: number;
    completed: [boolean, boolean];
}

export type ProgressCommand =
    | { type: "checkpoint"; checkpoint: number }
    | { type: "died" }
    | { type: "exit" }
    | { type: "restart" };

export interface Run {
    phase: "playing" | "dying" | "exiting" | "transitioning";
    ticks: number;
    levelIndex: number;
    attempt: number;
    checkpoint: number;
    deathTimer: number;
    pauseRequested: boolean;
    contacts: { fatal: boolean; exit: boolean; checkpoint: number };
}

/** Host input and candidate delivery are environmental input, not scene state. */
export interface LevelOptions {
    readonly index: number;
    readonly data: LevelData;
    readonly audio?: Pick<Audio, "scene">;
    readonly music?: Asset<AudioBuffer>;
    readonly respawn?: () => PreparedScene | undefined;
    readonly next?: () => PreparedScene | undefined;
    readonly pause?: () => PreparedScene | undefined;
    readonly takePauseIntent?: () => boolean;
    readonly onView?: (view: Readonly<Run>) => void;
}

export interface OverlayOptions {
    readonly restart: () => PreparedScene | undefined;
    readonly takeIntent: (intent: "pause" | "resume" | "restart") => boolean;
    readonly onView?: (phase: "paused" | "complete") => void;
}

export function createProgress(): Progress {
    return { level: 0, checkpoint: 0, attempt: 0, deaths: 0, runs: 0, completed: [false, false] };
}

export function transition(
    state: DeepReadonly<Progress>,
    command: DeepReadonly<ProgressCommand>,
): DeepReadonly<Progress> {
    switch (command.type) {
        case "checkpoint":
            return command.checkpoint > state.checkpoint
                ? { ...state, checkpoint: command.checkpoint }
                : state;
        case "died":
            return { ...state, deaths: state.deaths + 1, attempt: state.attempt + 1 };
        case "restart":
            return { ...createProgress(), runs: state.runs + 1 };
        case "exit": {
            if (state.level >= 2) return state;
            const completed: [boolean, boolean] = [...state.completed];
            completed[state.level] = true;
            return { ...state, completed, level: state.level + 1, checkpoint: 0, attempt: 0 };
        }
    }
}

export function createLevel(options: LevelOptions): SceneDefinition<Progress, ProgressCommand> {
    return {
        id: `platformer-level-${options.index}`,
        assets: options.music ? [options.music] : [],
        setup(scene) {
            const sound = options.audio?.scene("platformer");
            if (sound) {
                scene.defer(() => sound.dispose());
                const music = options.music
                    ? (scene.assets.get(options.music.id) as AudioBuffer)
                    : undefined;
                if (music) sound.play({ buffer: music, loop: true, volume: 0.025 });
            }
            const state = scene.state();
            const progress = state.read();
            const data = options.data;
            const spawn =
                progress.checkpoint === 0 ? data.start : data.checkpoints[progress.checkpoint - 1];
            if (!spawn)
                throw new Error(
                    `Missing checkpoint ${progress.checkpoint} in level ${progress.level}`,
                );
            const tiles = scene.resource("tiles", data.tiles.slice());
            const grid = { widthTiles: data.widthTiles, heightTiles: data.heightTiles, tiles };
            const run = scene.resource<Run>("run", {
                phase: "playing",
                ticks: 0,
                levelIndex: progress.level,
                attempt: progress.attempt,
                checkpoint: progress.checkpoint,
                deathTimer: 0,
                pauseRequested: false,
                contacts: { fatal: false, exit: false, checkpoint: 0 },
            });
            const intent = scene.resource("intent", {
                move: 0,
                jumpDown: false,
                jumpPressed: false,
            });
            const motion = scene.resource("motion", {
                box: { x: 0, y: 0, w: 12, h: 14 },
                contacts: 0,
            });
            const startX = spawn.x * TILE + 2;
            const startY = (spawn.y + 1) * TILE - PLAYER_HEIGHT;
            const player = scene.resource(
                "player",
                scene.world.spawn(
                    Position.of({ x: startX, y: startY }),
                    Body.of({ grounded: true, previousBottom: (spawn.y + 1) * TILE }),
                    Actor.of(),
                ),
            );
            const actors = scene.world.query(Position, Body, Actor);
            for (const tile of data.patrols)
                scene.world.spawn(
                    Position.of({ x: tile.x * TILE + 2, y: (tile.y + 1) * TILE - PLAYER_HEIGHT }),
                    Body.of(),
                    Actor.of({ kind: 1 }),
                );
            // The spawn is pending until mount commits, so setup uses its authored values.
            scene.camera.x = clamp(
                startX + PLAYER_WIDTH / 2 - WIDTH / 2,
                0,
                Math.max(0, data.widthTiles * TILE - WIDTH),
            );
            scene.camera.y = clamp(
                startY + PLAYER_HEIGHT / 2 - HEIGHT / 2,
                0,
                Math.max(0, data.heightTiles * TILE - HEIGHT),
            );

            scene.system(({ input }) => {
                run.ticks++;
                const hostPause = options.takePauseIntent?.() ?? false;
                if (
                    hostPause ||
                    pressed(input, "Escape") ||
                    pressed(input, "KeyP") ||
                    pressed(input, "Pad9")
                )
                    run.pauseRequested = true;
                intent.move = clamp(
                    (down(input, "KeyD") || down(input, "ArrowRight") ? 1 : 0) -
                        (down(input, "KeyA") || down(input, "ArrowLeft") ? 1 : 0) +
                        (input.axes[0] ?? 0),
                    -1,
                    1,
                );
                intent.jumpDown =
                    down(input, "Space") ||
                    down(input, "ArrowUp") ||
                    down(input, "KeyW") ||
                    down(input, "Pad0");
                intent.jumpPressed =
                    pressed(input, "Space") ||
                    pressed(input, "ArrowUp") ||
                    pressed(input, "KeyW") ||
                    pressed(input, "Pad0");
            });
            scene.system(({ dt }) => {
                if (run.phase !== "playing") return;
                const { position, body, row } = findPlayer(actors, player);
                position.px[row] = position.x[row];
                position.py[row] = position.y[row];
                body.previousBottom[row] = position.y[row] + body.h[row];
                const wasGrounded = body.grounded[row] !== 0;
                if (body.grounded[row]) body.coyoteTicks[row] = COYOTE_TICKS;
                if (intent.jumpPressed) body.jumpBufferTicks[row] = BUFFER_TICKS;
                const target = intent.move * SPEED;
                const acceleration = (intent.move ? 1400 : 1800) * dt;
                body.vx[row] += clamp(target - body.vx[row], -acceleration, acceleration);
                if (
                    body.jumpBufferTicks[row] > 0 &&
                    (body.grounded[row] || body.coyoteTicks[row] > 0)
                )
                    jump(body, row, sound);
                if (!intent.jumpDown && body.vy[row] < -140) body.vy[row] = -140;
                body.vy[row] = Math.min(FALL_SPEED, body.vy[row] + GRAVITY * dt);
                motion.box.x = position.x[row];
                motion.box.y = position.y[row];
                const horizontal = moveX(grid, motion.box, body.vx[row] * dt);
                if (horizontal & CONTACT.wall) body.vx[row] = 0;
                const vertical = moveY(
                    grid,
                    motion.box,
                    body.vy[row] * dt,
                    body.previousBottom[row],
                );
                body.grounded[row] = vertical & CONTACT.floor ? 1 : 0;
                if (vertical & (CONTACT.floor | CONTACT.ceiling)) body.vy[row] = 0;
                position.x[row] = motion.box.x;
                position.y[row] = motion.box.y;
                motion.contacts = horizontal | vertical;
                // A buffered press is valid on the press tick and the next five ticks.
                if (body.grounded[row] && body.jumpBufferTicks[row] > 0) jump(body, row, sound);
                if (!body.grounded[row] && !wasGrounded)
                    body.coyoteTicks[row] = Math.max(0, body.coyoteTicks[row] - 1);
                body.jumpBufferTicks[row] = Math.max(0, body.jumpBufferTicks[row] - 1);
            });
            scene.system(({ dt }) => {
                actors.eachChunk((chunk) => {
                    const { position: p, body: b, actor } = chunk.views;
                    for (let row = 0; row < chunk.count; row++) {
                        if (actor.kind[row] !== 1) {
                            if (b.vx[row]) actor.facing[row] = Math.sign(b.vx[row]);
                            continue;
                        }
                        p.px[row] = p.x[row];
                        p.py[row] = p.y[row];
                        const ahead = Math.floor(
                            (actor.facing[row] > 0 ? p.x[row] + b.w[row] + 1 : p.x[row] - 1) / TILE,
                        );
                        const support = tileAt(
                            grid,
                            ahead,
                            Math.floor((p.y[row] + b.h[row] + 1) / TILE),
                        );
                        if (support !== 1 && support !== 2) actor.facing[row] *= -1;
                        motion.box.x = p.x[row];
                        motion.box.y = p.y[row];
                        b.vx[row] = actor.facing[row] * 45;
                        if (moveX(grid, motion.box, b.vx[row] * dt) & CONTACT.wall)
                            actor.facing[row] *= -1;
                        p.x[row] = motion.box.x;
                    }
                });
            });
            scene.system(() => {
                if (run.phase !== "playing") return;
                const { position, body, row: playerRow } = findPlayer(actors, player);
                const x = position.x[playerRow];
                const y = position.y[playerRow];
                motion.box.x = x;
                motion.box.y = y;
                run.contacts.fatal = !!(motion.contacts & (CONTACT.hazard | CONTACT.fell));
                run.contacts.exit = touchesTile(motion.box, data.exit);
                for (const [index, tile] of data.checkpoints.entries())
                    if (touchesTile(motion.box, tile)) run.contacts.checkpoint = index + 1;
                actors.eachChunk((chunk) => {
                    const { position: p, body: b, actor } = chunk.views;
                    for (let row = 0; row < chunk.count; row++)
                        if (
                            actor.kind[row] === 1 &&
                            x < p.x[row] + b.w[row] &&
                            x + body.w[playerRow] > p.x[row] &&
                            y < p.y[row] + b.h[row] &&
                            y + body.h[playerRow] > p.y[row]
                        )
                            run.contacts.fatal = true;
                });
            });
            scene.system(({ scenes }) => {
                const { fatal, exit, checkpoint } = run.contacts;
                run.contacts.fatal = run.contacts.exit = false;
                run.contacts.checkpoint = 0;
                if (run.phase === "transitioning") {
                    run.pauseRequested = false;
                    return;
                }
                if (run.phase === "playing") {
                    if (fatal) {
                        run.phase = "dying";
                        run.deathTimer = 30;
                        run.pauseRequested = false;
                        state.dispatch({ type: "died" });
                        sound?.play({
                            frequency: 150,
                            endFrequency: 45,
                            duration: 0.2,
                            type: "sawtooth",
                            volume: 0.15,
                        });
                        return;
                    }
                    if (exit) {
                        run.phase = "exiting";
                        run.pauseRequested = false;
                    } else {
                        if (checkpoint > run.checkpoint) {
                            state.dispatch({ type: "checkpoint", checkpoint });
                            run.checkpoint = checkpoint;
                            sound?.play({
                                frequency: 520,
                                endFrequency: 880,
                                duration: 0.15,
                                volume: 0.2,
                            });
                        }
                        if (run.pauseRequested) {
                            const candidate = options.pause?.();
                            if (candidate) {
                                scenes.push(candidate);
                                run.pauseRequested = false;
                            }
                        }
                        return;
                    }
                }
                run.pauseRequested = false;
                if (run.phase === "dying") {
                    run.deathTimer = Math.max(0, run.deathTimer - 1);
                    if (run.deathTimer > 0) return;
                    const candidate = options.respawn?.();
                    if (candidate) {
                        scenes.set(candidate);
                        run.phase = "transitioning";
                    }
                } else if (run.phase === "exiting") {
                    const candidate = options.next?.();
                    if (candidate) {
                        state.dispatch({ type: "exit" });
                        scenes.set(candidate);
                        run.phase = "transitioning";
                    }
                }
            });
            scene.system(() => {
                const { position, body, row } = findPlayer(actors, player);
                const center = position.x[row] + body.w[row] / 2;
                const offset = center - scene.camera.x;
                if (offset < WIDTH * 0.4) scene.camera.x = center - WIDTH * 0.4;
                else if (offset > WIDTH * 0.6) scene.camera.x = center - WIDTH * 0.6;
                scene.camera.x = clamp(
                    scene.camera.x,
                    0,
                    Math.max(0, data.widthTiles * TILE - WIDTH),
                );
                scene.camera.y = clamp(
                    lerp(scene.camera.y, position.y[row] + body.h[row] / 2 - HEIGHT / 2, 0.1),
                    0,
                    Math.max(0, data.heightTiles * TILE - HEIGHT),
                );
            });
            scene.resetInterpolation(() =>
                actors.eachChunk((chunk) => {
                    const p = chunk.views.position;
                    for (let row = 0; row < chunk.count; row++) {
                        p.px[row] = p.x[row];
                        p.py[row] = p.y[row];
                    }
                }),
            );
            scene.render((frame, alpha) => {
                const cameraX = lerp(scene.camera.previousX, scene.camera.x, alpha);
                const cameraY = lerp(scene.camera.previousY, scene.camera.y, alpha);
                for (
                    let y = Math.max(0, Math.floor(cameraY / TILE));
                    y < Math.min(data.heightTiles, Math.ceil((cameraY + HEIGHT) / TILE));
                    y++
                )
                    for (
                        let x = Math.max(0, Math.floor(cameraX / TILE));
                        x < Math.min(data.widthTiles, Math.ceil((cameraX + WIDTH) / TILE));
                        x++
                    ) {
                        const tile = tileAt(grid, x, y);
                        if (tile)
                            frame.rect(
                                x * TILE + 8,
                                y * TILE + (tile === 2 ? 2 : 8),
                                TILE,
                                tile === 2 ? 4 : TILE,
                                tile === 1 ? 0x46645a : tile === 2 ? 0x91b49a : 0xe87760,
                            );
                    }
                for (const [index, tile] of data.checkpoints.entries())
                    frame.rect(
                        tile.x * TILE + 8,
                        tile.y * TILE + 8,
                        4,
                        16,
                        index < run.checkpoint ? 0xf5cf72 : 0x829387,
                    );
                frame.rect(data.exit.x * TILE + 8, data.exit.y * TILE + 8, 12, 16, 0x91c6cb);
                actors.eachChunk((chunk) => {
                    const { position: p, body: b, actor } = chunk.views;
                    for (let row = 0; row < chunk.count; row++) {
                        if (actor.kind[row] === 0 && run.phase === "dying") continue;
                        frame.rect(
                            lerp(p.px[row], p.x[row], alpha) + b.w[row] / 2,
                            lerp(p.py[row], p.y[row], alpha) + b.h[row] / 2,
                            b.w[row],
                            b.h[row],
                            actor.kind[row] === 0 ? 0xf5cf72 : 0xe87760,
                        );
                    }
                });
                options.onView?.(
                    Object.freeze({ ...run, contacts: Object.freeze({ ...run.contacts }) }),
                );
            });
        },
    };
}

export function createOverlay(
    kind: "pause" | "complete",
    options: OverlayOptions,
): SceneDefinition<Progress, ProgressCommand> {
    return {
        id: `platformer-${kind}`,
        blocksUpdateBelow: kind === "pause",
        setup(scene) {
            const state = scene.state();
            const run = scene.resource<{ phase: "idle" | "restarting" | "transitioning" }>(
                "overlay",
                { phase: "idle" },
            );
            scene.system(({ input, scenes }) => {
                if (run.phase === "transitioning") return;
                if (kind === "pause") {
                    // Drain both flags even when a key edge wins; hidden-tab pause is already satisfied.
                    options.takeIntent("pause");
                    const resume = options.takeIntent("resume");
                    if (
                        resume ||
                        pressed(input, "Escape") ||
                        pressed(input, "KeyP") ||
                        pressed(input, "Pad9")
                    ) {
                        run.phase = "transitioning";
                        scenes.pop();
                    }
                } else {
                    const restart = options.takeIntent("restart");
                    if (restart || pressed(input, "Enter")) run.phase = "restarting";
                    if (run.phase !== "restarting") return;
                    const candidate = options.restart();
                    if (!candidate) return;
                    state.dispatch({ type: "restart" });
                    scenes.set(candidate);
                    run.phase = "transitioning";
                }
            });
            scene.render((frame) => {
                frame.rect(
                    WIDTH / 2,
                    HEIGHT / 2,
                    WIDTH,
                    HEIGHT,
                    0x172720,
                    kind === "pause" ? 0.55 : 1,
                    10,
                    true,
                );
                options.onView?.(kind === "pause" ? "paused" : "complete");
            });
        },
    };
}

function findPlayer(actors: Actors, player: Entity): PlayerRow {
    // Assigned inside the visitor; no initializer, so TypeScript does not narrow it to undefined.
    let found: PlayerRow | undefined;
    actors.eachChunk((chunk) => {
        for (let row = 0; row < chunk.count && !found; row++)
            if (chunk.entityAt(row) === player)
                found = { position: chunk.views.position, body: chunk.views.body, row };
    });
    if (!found) throw new Error("Platformer player is not mounted");
    return found;
}

function jump(body: BodyView, row: number, sound?: ReturnType<Audio["scene"]>): void {
    body.vy[row] = -JUMP_SPEED;
    body.grounded[row] = 0;
    body.coyoteTicks[row] = body.jumpBufferTicks[row] = 0;
    sound?.play({ frequency: 280, endFrequency: 540, duration: 0.09, volume: 0.15 });
}

function touchesTile(box: Box, tile: Tile): boolean {
    return (
        box.x < (tile.x + 1) * TILE &&
        box.x + box.w > tile.x * TILE &&
        box.y < (tile.y + 1) * TILE &&
        box.y + box.h > tile.y * TILE
    );
}
