import { clamp, component, down, lerp, pressed } from "ngne";
import type { Audio, DeepReadonly, PreparedScene, SceneDefinition } from "ngne";

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
const Position = component("position", () => ({ x: 0, y: 0, px: 0, py: 0 }));
const Body = component("body", () => ({
    vx: 0,
    vy: 0,
    w: 12,
    h: 14,
    grounded: false,
    coyoteTicks: 0,
    jumpBufferTicks: 0,
    previousBottom: 0,
}));
const Actor = component("actor", () => ({ kind: 0 as 0 | 1, facing: 1 }));

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
        setup(scene) {
            const sound = options.audio?.scene("platformer");
            if (sound) scene.defer(() => sound.dispose());
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
            const playerPosition = Position.of({
                x: spawn.x * TILE + 2,
                y: (spawn.y + 1) * TILE - 14,
            });
            const playerBody = Body.of({ grounded: true, previousBottom: (spawn.y + 1) * TILE });
            scene.resource("player", scene.world.spawn(playerPosition, playerBody, Actor.of()));
            const position = playerPosition.value;
            const body = playerBody.value;
            const actors = scene.world.query(Position, Body, Actor);
            for (const tile of data.patrols)
                scene.world.spawn(
                    Position.of({ x: tile.x * TILE + 2, y: (tile.y + 1) * TILE - 14 }),
                    Body.of(),
                    Actor.of({ kind: 1 }),
                );
            scene.camera.x = clamp(
                position.x + body.w / 2 - WIDTH / 2,
                0,
                Math.max(0, data.widthTiles * TILE - WIDTH),
            );
            scene.camera.y = clamp(
                position.y + body.h / 2 - HEIGHT / 2,
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
                position.px = position.x;
                position.py = position.y;
                body.previousBottom = position.y + body.h;
                const wasGrounded = body.grounded;
                if (body.grounded) body.coyoteTicks = COYOTE_TICKS;
                if (intent.jumpPressed) body.jumpBufferTicks = BUFFER_TICKS;
                const target = intent.move * SPEED;
                const acceleration = (intent.move ? 1400 : 1800) * dt;
                body.vx += clamp(target - body.vx, -acceleration, acceleration);
                if (body.jumpBufferTicks > 0 && (body.grounded || body.coyoteTicks > 0))
                    jump(body, sound);
                if (!intent.jumpDown && body.vy < -140) body.vy = -140;
                body.vy = Math.min(FALL_SPEED, body.vy + GRAVITY * dt);
                motion.box.x = position.x;
                motion.box.y = position.y;
                const horizontal = moveX(grid, motion.box, body.vx * dt);
                if (horizontal & CONTACT.wall) body.vx = 0;
                const vertical = moveY(grid, motion.box, body.vy * dt, body.previousBottom);
                body.grounded = !!(vertical & CONTACT.floor);
                if (vertical & (CONTACT.floor | CONTACT.ceiling)) body.vy = 0;
                position.x = motion.box.x;
                position.y = motion.box.y;
                motion.contacts = horizontal | vertical;
                // A buffered press is valid on the press tick and the next five ticks.
                if (body.grounded && body.jumpBufferTicks > 0) jump(body, sound);
                if (!body.grounded && !wasGrounded)
                    body.coyoteTicks = Math.max(0, body.coyoteTicks - 1);
                body.jumpBufferTicks = Math.max(0, body.jumpBufferTicks - 1);
            });
            scene.system(({ dt }) => {
                actors.each((_, p, b, actor) => {
                    if (actor.kind !== 1) {
                        if (b.vx) actor.facing = Math.sign(b.vx);
                        return;
                    }
                    p.px = p.x;
                    p.py = p.y;
                    const ahead = Math.floor((actor.facing > 0 ? p.x + b.w + 1 : p.x - 1) / TILE);
                    const support = tileAt(grid, ahead, Math.floor((p.y + b.h + 1) / TILE));
                    if (support !== 1 && support !== 2) actor.facing *= -1;
                    motion.box.x = p.x;
                    motion.box.y = p.y;
                    b.vx = actor.facing * 45;
                    if (moveX(grid, motion.box, b.vx * dt) & CONTACT.wall) actor.facing *= -1;
                    p.x = motion.box.x;
                });
            });
            scene.system(() => {
                if (run.phase !== "playing") return;
                motion.box.x = position.x;
                motion.box.y = position.y;
                run.contacts.fatal = !!(motion.contacts & (CONTACT.hazard | CONTACT.fell));
                run.contacts.exit = touchesTile(motion.box, data.exit);
                for (const [index, tile] of data.checkpoints.entries())
                    if (touchesTile(motion.box, tile)) run.contacts.checkpoint = index + 1;
                actors.each((_, p, b, actor) => {
                    if (
                        actor.kind === 1 &&
                        position.x < p.x + b.w &&
                        position.x + body.w > p.x &&
                        position.y < p.y + b.h &&
                        position.y + body.h > p.y
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
                const center = position.x + body.w / 2;
                const offset = center - scene.camera.x;
                if (offset < WIDTH * 0.4) scene.camera.x = center - WIDTH * 0.4;
                else if (offset > WIDTH * 0.6) scene.camera.x = center - WIDTH * 0.6;
                scene.camera.x = clamp(
                    scene.camera.x,
                    0,
                    Math.max(0, data.widthTiles * TILE - WIDTH),
                );
                scene.camera.y = clamp(
                    lerp(scene.camera.y, position.y + body.h / 2 - HEIGHT / 2, 0.1),
                    0,
                    Math.max(0, data.heightTiles * TILE - HEIGHT),
                );
            });
            scene.resetInterpolation(() =>
                actors.each((_, p) => {
                    p.px = p.x;
                    p.py = p.y;
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
                actors.each((_, p, b, actor) => {
                    if (actor.kind === 0 && run.phase === "dying") return;
                    frame.rect(
                        lerp(p.px, p.x, alpha) + b.w / 2,
                        lerp(p.py, p.y, alpha) + b.h / 2,
                        b.w,
                        b.h,
                        actor.kind === 0 ? 0xf5cf72 : 0xe87760,
                    );
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

function jump(body: ReturnType<typeof Body.create>, sound?: ReturnType<Audio["scene"]>): void {
    body.vy = -JUMP_SPEED;
    body.grounded = false;
    body.coyoteTicks = body.jumpBufferTicks = 0;
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
