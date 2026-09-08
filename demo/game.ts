import {
    component,
    clamp,
    lerp,
    down,
    pressed,
    type SceneDefinition,
    type SceneSetup,
    type SceneCommands,
    type PreparedScene,
    type Entity,
    type Frame,
    type Audio,
    type Asset,
} from "ngne";

export const W = 640,
    H = 400;
export const Position = component("position", () => ({
    x: 0,
    y: 0,
    px: 0,
    py: 0,
}));
const Body = component("body", () => ({
    vx: 0,
    vy: 0,
    radius: 6,
    hp: 1,
    active: true,
    kind: 0,
    age: 0,
    cooldown: 0,
}));
const Visual = component("visual", () => ({ sprite: 0, size: 24, angle: 0 }));
const Particle = component("particle", () => ({
    vx: 0,
    vy: 0,
    life: 1,
    maxLife: 1,
    color: 0xffffff,
    size: 2,
}));
export interface Progress {
    best: number;
    runs: number;
    victories: number;
    lastScore: number;
}
export type ProgressCommand = { type: "finish"; score: number; won: boolean };
export interface RunView {
    phase: "attract" | "playing" | "dead" | "won" | "paused";
    score: number;
    wave: number;
    seconds: number;
    hp: number;
    bomb: number;
    combo: number;
    stress: boolean;
}
export interface ShowcaseOptions {
    attract?: boolean;
    stress?: boolean;
    audio?: Audio;
    atlas?: Asset<any>;
    onView?: (view: RunView) => void;
    pause?: () => PreparedScene | undefined;
    result?: () => PreparedScene | undefined;
    reducedMotion?: boolean;
}

export function arena(options: ShowcaseOptions = {}): SceneDefinition<Progress, ProgressCommand> {
    return {
        id: options.attract ? "attract" : "starfall-arena",
        assets: options.atlas ? [options.atlas] : [],
        setup(s) {
            const rng = s.random("waves"),
                fx = s.random("effects");
            const state = s.state();
            const run = s.resource("run", {
                phase: options.attract ? "attract" : "playing",
                score: 0,
                wave: 1,
                seconds: 0,
                ticks: 0,
                hp: 5,
                bomb: 0,
                combo: 1,
                comboTicks: 0,
                stress: !!options.stress,
                spawnTicks: 0,
                shotTicks: 0,
                invulnerable: 0,
                shake: 0,
                flash: 0,
                bossWave: 0,
                finished: false,
            } as RunView & {
                ticks: number;
                spawnTicks: number;
                shotTicks: number;
                comboTicks: number;
                invulnerable: number;
                shake: number;
                flash: number;
                bossWave: number;
                finished: boolean;
            });
            const sound = options.audio?.scene(options.attract ? "attract" : "arena");
            if (sound) s.defer(() => sound.dispose());
            const stars = s.resource(
                "stars",
                Array.from({ length: 180 }, () => ({
                    x: rng.range(0, W),
                    y: rng.range(0, H),
                    size: rng.next() > 0.92 ? 2 : 1,
                    speed: rng.range(1, 9),
                })),
            );
            const grid = s.resource(
                "collision-grid",
                Array.from(
                    { length: 20 * 13 },
                    () =>
                        [] as {
                            e: Entity;
                            p: ReturnType<typeof Position.create>;
                            b: ReturnType<typeof Body.create>;
                        }[],
                ),
            );
            const moving = s.world.query(Position, Body, Visual),
                particles = s.world.query(Position, Particle);
            const spawn = (x: number, y: number, kind: number, vx = 0, vy = 0) =>
                s.world.spawn(
                    Position.of({ x, y, px: x, py: y }),
                    Body.of({
                        kind,
                        vx,
                        vy,
                        radius: kind === 5 ? 22 : kind === 0 ? 5 : 7,
                        hp: kind === 5 ? 160 + run.wave * 10 : kind === 2 ? 3 : 1,
                        cooldown: rng.int(40, 140),
                    }),
                    Visual.of({
                        sprite:
                            kind === 0
                                ? 0
                                : kind === 5
                                  ? 5
                                  : kind === 6
                                    ? 4
                                    : kind === 3 || kind === 4
                                      ? 3
                                      : kind,
                        size: kind === 5 ? 68 : kind === 0 ? 28 : kind >= 3 && kind <= 4 ? 12 : 26,
                    }),
                );
            const player = s.resource("player", spawn(W / 2, H * 0.65, 0));
            // The player handle is immutable; all mutable gameplay data is owned above.
            const burst = (x: number, y: number, color: number, count: number, speed = 95) => {
                for (let i = 0; i < count; i++) {
                    const a = fx.range(0, Math.PI * 2),
                        v = fx.range(10, speed),
                        life = fx.range(0.15, 0.8);
                    s.world.spawn(
                        Position.of({ x, y, px: x, py: y }),
                        Particle.of({
                            vx: Math.cos(a) * v,
                            vy: Math.sin(a) * v,
                            life,
                            maxLife: life,
                            color,
                            size: fx.int(1, 4),
                        }),
                    );
                }
            };
            const enemy = (initial = false) => {
                const x = rng.range(25, W - 25),
                    y = initial ? rng.range(25, H * 0.55) : -20;
                spawn(x, y, rng.next() < 0.22 ? 2 : 1, rng.range(-20, 20), rng.range(15, 35));
            };
            for (let i = 0; i < (run.stress ? 240 : 16); i++) enemy(true);
            if (run.stress)
                for (let i = 0; i < 6000; i++) {
                    const x = fx.range(0, W),
                        y = fx.range(0, H);
                    s.world.spawn(
                        Position.of({ x, y, px: x, py: y }),
                        Particle.of({
                            vx: fx.range(-25, 25),
                            vy: fx.range(5, 40),
                            life: 9999,
                            maxLife: 9999,
                            color: i % 3 === 0 ? 0xffb276 : 0x537696,
                            size: 1,
                        }),
                    );
                }
            s.resetInterpolation(() => {
                moving.each((_, p) => {
                    p.px = p.x;
                    p.py = p.y;
                });
            });
            const finish = (won: boolean, scenes: SceneCommands) => {
                if (run.finished) return;
                run.finished = true;
                run.phase = won ? "won" : "dead";
                state.dispatch({ type: "finish", score: run.score, won });
                const candidate = options.result?.();
                if (candidate) scenes.push(candidate);
            };
            s.system((ctx) => {
                if (
                    pressed(ctx.input, "Escape") ||
                    pressed(ctx.input, "KeyP") ||
                    pressed(ctx.input, "Pad9")
                ) {
                    const candidate = options.pause?.();
                    if (candidate) ctx.scenes.push(candidate);
                }
                if (run.finished) return;
                const playerPosition = s.world.get(player, Position)!;
                const pb = s.world.get(player, Body)!;
                run.ticks++;
                run.seconds = run.ticks / 60;
                run.wave = 1 + Math.floor(run.seconds / 15);
                run.bomb = Math.max(0, run.bomb - 1);
                run.invulnerable = Math.max(0, run.invulnerable - 1);
                if (run.comboTicks > 0) run.comboTicks--;
                else run.combo = 1;
                if (run.seconds >= 180 && !options.attract) {
                    finish(true, ctx.scenes);
                    return;
                }
                let mx =
                    (down(ctx.input, "KeyD") || down(ctx.input, "ArrowRight") ? 1 : 0) -
                    (down(ctx.input, "KeyA") || down(ctx.input, "ArrowLeft") ? 1 : 0) +
                    ctx.input.axes[0];
                let my =
                    (down(ctx.input, "KeyS") || down(ctx.input, "ArrowDown") ? 1 : 0) -
                    (down(ctx.input, "KeyW") || down(ctx.input, "ArrowUp") ? 1 : 0) +
                    ctx.input.axes[1];
                if (options.attract) {
                    mx = Math.cos(run.seconds * 0.7) * 0.8;
                    my = Math.sin(run.seconds * 0.9) * 0.45;
                }
                const length = Math.max(1, Math.hypot(mx, my));
                pb.vx = (mx / length) * 145;
                pb.vy = (my / length) * 145;
                if (down(ctx.input, "TouchMove")) {
                    pb.vx = clamp((ctx.input.pointer.x - playerPosition.x) * 8, -150, 150);
                    pb.vy = clamp((ctx.input.pointer.y - playerPosition.y) * 8, -150, 150);
                }
                if (
                    (pressed(ctx.input, "Space") ||
                        pressed(ctx.input, "Pad0") ||
                        pressed(ctx.input, "KeyB")) &&
                    !run.bomb
                ) {
                    run.bomb = 900;
                    run.flash = 12;
                    run.shake = 12;
                    s.freeze(5);
                    moving.each((e, p, b) => {
                        if (b.kind !== 0 && b.kind !== 3 && b.kind !== 6) {
                            if (b.kind === 5) b.hp -= 60;
                            else {
                                b.active = false;
                                s.world.despawn(e);
                                if (b.kind !== 4) run.score += 25;
                            }
                            burst(p.x, p.y, 0x83e8e1, 8);
                        }
                    });
                    burst(playerPosition.x, playerPosition.y, 0x83e8e1, 180, 250);
                    sound?.play({
                        frequency: 150,
                        endFrequency: 25,
                        duration: 0.7,
                        volume: 0.5,
                        type: "sawtooth",
                    });
                }
                if (--run.spawnTicks <= 0) {
                    run.spawnTicks = Math.max(4, 32 - run.wave * 2);
                    for (let i = 0; i < (run.stress ? 5 : 1); i++) enemy();
                }
                if (run.wave % 3 === 0 && run.bossWave !== run.wave) {
                    run.bossWave = run.wave;
                    spawn(W / 2, 35, 5);
                }
                let aimX = playerPosition.x,
                    aimY = -100,
                    distance = Infinity;
                moving.each((_, p, b) => {
                    if ((b.kind === 1 || b.kind === 2 || b.kind === 5) && b.active) {
                        const d = (p.x - playerPosition!.x) ** 2 + (p.y - playerPosition!.y) ** 2;
                        if (d < distance) {
                            distance = d;
                            aimX = p.x;
                            aimY = p.y;
                        }
                    }
                });
                if (ctx.input.pointer.active && down(ctx.input, "Pointer0")) {
                    aimX = ctx.input.pointer.x;
                    aimY = ctx.input.pointer.y;
                }
                if (Math.hypot(ctx.input.axes[2], ctx.input.axes[3]) > 0.2) {
                    aimX = playerPosition.x + ctx.input.axes[2] * 100;
                    aimY = playerPosition.y + ctx.input.axes[3] * 100;
                }
                const aim = Math.atan2(aimY - playerPosition.y, aimX - playerPosition.x);
                s.world.get(player, Visual)!.angle = aim + Math.PI / 2;
                if (--run.shotTicks <= 0) {
                    run.shotTicks = run.stress ? 3 : 7;
                    const spread = run.wave >= 4 ? 3 : 2;
                    for (let i = 0; i < spread; i++) {
                        const a = aim + (i - (spread - 1) / 2) * 0.12;
                        spawn(
                            playerPosition.x,
                            playerPosition.y,
                            3,
                            Math.cos(a) * 310,
                            Math.sin(a) * 310,
                        );
                    }
                    if (run.ticks % 3 === 0)
                        sound?.play({
                            frequency: 700,
                            endFrequency: 260,
                            duration: 0.07,
                            volume: 0.08,
                        });
                }
                for (const cell of grid) cell.length = 0;
                moving.each((e, p, b, v) => {
                    p.px = p.x;
                    p.py = p.y;
                    b.age++;
                    if (b.kind === 1 || b.kind === 2) {
                        const a = Math.atan2(playerPosition!.y - p.y, playerPosition!.x - p.x);
                        const speed = b.kind === 2 ? 20 : 24 + run.wave * 2;
                        b.vx = Math.cos(a) * speed;
                        b.vy = Math.sin(a) * speed;
                    }
                    if (b.kind === 5) {
                        b.vx = Math.cos(b.age * 0.015) * 40;
                        b.vy = p.y < 65 ? 20 : 0;
                    }
                    if ((b.kind === 2 || b.kind === 5) && --b.cooldown <= 0) {
                        b.cooldown = b.kind === 5 ? 48 : 150;
                        const count = b.kind === 5 ? 24 : 5;
                        for (let i = 0; i < count; i++) {
                            const a = (i / count) * Math.PI * 2 + b.age * 0.025;
                            spawn(p.x, p.y, 4, Math.cos(a) * 65, Math.sin(a) * 65);
                        }
                    }
                    p.x += b.vx * ctx.dt;
                    p.y += b.vy * ctx.dt;
                    if (b.kind === 0) {
                        p.x = clamp(p.x, 14, W - 14);
                        p.y = clamp(p.y, 18, H - 18);
                    }
                    if (b.kind === 3 || b.kind === 4)
                        v.angle = Math.atan2(b.vy, b.vx) + Math.PI / 2;
                    if (
                        p.x < -70 ||
                        p.x > W + 70 ||
                        p.y < -70 ||
                        p.y > H + 70 ||
                        (b.kind === 6 && b.age > 900)
                    ) {
                        b.active = false;
                        s.world.despawn(e);
                    }
                    if (b.kind === 1 || b.kind === 2 || b.kind === 5) {
                        const cx = clamp(Math.floor(p.x / 32), 0, 19),
                            cy = clamp(Math.floor(p.y / 32), 0, 12);
                        grid[cy * 20 + cx].push({ e, p, b });
                    }
                });
                const kill = (
                    e: Entity,
                    p: ReturnType<typeof Position.create>,
                    b: ReturnType<typeof Body.create>,
                ) => {
                    b.active = false;
                    s.world.despawn(e);
                    run.score += (b.kind === 5 ? 2000 : 100) * run.combo;
                    run.combo = Math.min(8, run.combo + 1);
                    run.comboTicks = 120;
                    burst(p.x, p.y, b.kind === 5 ? 0xffb276 : 0xff6d82, b.kind === 5 ? 150 : 18);
                    run.shake = b.kind === 5 ? 10 : 2;
                    ctx.emit({ type: "destroyed", boss: b.kind === 5 });
                    if (b.kind === 5) {
                        s.freeze(7);
                        spawn(p.x, p.y, 6);
                    } else if (rng.next() < 0.045) spawn(p.x, p.y, 6);
                };
                moving.each((e, p, b) => {
                    if (!b.active) return;
                    if (b.kind === 3) {
                        const cx = Math.floor(p.x / 32),
                            cy = Math.floor(p.y / 32);
                        for (
                            let y = Math.max(0, cy - 1);
                            y <= Math.min(12, cy + 1) && b.active;
                            y++
                        )
                            for (
                                let x = Math.max(0, cx - 1);
                                x <= Math.min(19, cx + 1) && b.active;
                                x++
                            )
                                for (const target of grid[y * 20 + x]) {
                                    if (
                                        target.b.active &&
                                        (p.x - target.p.x) ** 2 + (p.y - target.p.y) ** 2 <
                                            (target.b.radius + 5) ** 2
                                    ) {
                                        b.active = false;
                                        s.world.despawn(e);
                                        if (--target.b.hp <= 0) kill(target.e, target.p, target.b);
                                        break;
                                    }
                                }
                    } else if (
                        b.kind !== 0 &&
                        (p.x - playerPosition!.x) ** 2 + (p.y - playerPosition!.y) ** 2 <
                            (b.radius + 5) ** 2
                    ) {
                        if (b.kind === 6) {
                            b.active = false;
                            s.world.despawn(e);
                            run.hp = Math.min(5, run.hp + 1);
                            burst(p.x, p.y, 0xb6e68b, 30);
                            sound?.play({
                                frequency: 400,
                                endFrequency: 1200,
                                duration: 0.2,
                                volume: 0.2,
                            });
                        } else if (!run.invulnerable && !options.attract && !run.stress) {
                            run.hp--;
                            run.invulnerable = 100;
                            run.flash = 6;
                            run.shake = 8;
                            s.freeze(4);
                            burst(playerPosition!.x, playerPosition!.y, 0x83e8e1, 45);
                            sound?.play({
                                frequency: 220,
                                endFrequency: 40,
                                duration: 0.3,
                                volume: 0.4,
                            });
                            if (run.hp <= 0) finish(false, ctx.scenes);
                        }
                    }
                });
                if (run.ticks % 3 === 0)
                    burst(playerPosition.x, playerPosition.y + 8, 0xffb276, 1, 20);
            });
            s.system(
                (ctx) => {
                    run.shake = Math.max(0, run.shake - 0.5);
                    run.flash = Math.max(0, run.flash - 1);
                    s.camera.shakeX = options.reducedMotion
                        ? 0
                        : Math.sin(ctx.simulationTick * 2.3) * run.shake;
                    s.camera.shakeY = options.reducedMotion
                        ? 0
                        : Math.cos(ctx.simulationTick * 1.7) * run.shake;
                    particles.each((e, p, b) => {
                        p.px = p.x;
                        p.py = p.y;
                        p.x += b.vx * ctx.dt;
                        p.y += b.vy * ctx.dt;
                        b.life -= ctx.dt;
                        if (b.maxLife > 100) {
                            p.x = (p.x + W) % W;
                            p.y = (p.y + H) % H;
                        } else if (b.life <= 0) s.world.despawn(e);
                    });
                },
                { runsDuringFreeze: true },
            );
            s.system((ctx) => {
                for (const event of ctx.events)
                    if (event.type === "destroyed")
                        sound?.play({
                            frequency: event.boss ? 100 : 170,
                            endFrequency: 35,
                            duration: event.boss ? 0.5 : 0.12,
                            volume: event.boss ? 0.4 : 0.12,
                            type: "triangle",
                        });
            });
            s.system(() => {
                if (!options.attract && run.ticks % 15 === 0) {
                    const notes = [110, 110, 165, 110, 130.81, 130.81, 196, 146.83];
                    sound?.play({
                        frequency: notes[Math.floor(run.ticks / 15) % notes.length],
                        duration: 0.15,
                        volume: 0.05,
                        type: "triangle",
                    });
                }
            });
            s.render((frame, alpha) => {
                backdrop(frame, stars, run.seconds);
                particles.each((_, p, b) =>
                    frame.rect(
                        lerp(p.px, p.x, alpha),
                        lerp(p.py, p.y, alpha),
                        b.size,
                        b.size,
                        b.color,
                        b.maxLife > 100 ? 0.65 : Math.max(0, b.life / b.maxLife),
                        1,
                    ),
                );
                moving.each((_, p, b, v) => {
                    if (!b.active) return;
                    if (b.kind === 0 && run.invulnerable % 10 > 5) return;
                    frame.sprite({
                        x: lerp(p.px, p.x, alpha),
                        y: lerp(p.py, p.y, alpha),
                        width: v.size,
                        height: v.size,
                        texture: "ships",
                        u: v.sprite / 8,
                        v: 0.25,
                        uw: 1 / 8,
                        vh: 0.5,
                        rotation: v.angle,
                        layer: b.kind === 0 ? 4 : 3,
                        color: b.kind === 4 ? 0xff6d82 : 0xffffff,
                    });
                    if (b.kind === 5) {
                        frame.rect(p.x, p.y - 28, 64, 3, 0x442b43, 1, 5);
                        frame.rect(
                            p.x - 32 + 32 * Math.max(0, b.hp / (160 + run.wave * 10)),
                            p.y - 28,
                            64 * Math.max(0, b.hp / (160 + run.wave * 10)),
                            3,
                            0xff6d82,
                            1,
                            5,
                        );
                    }
                });
                if (run.flash && !options.reducedMotion)
                    frame.rect(W / 2, H / 2, W, H, 0x83e8e1, run.flash * 0.022, 9, true);
                options.onView?.({ ...run });
            });
        },
    };
}
function backdrop(
    frame: Frame,
    stars: { x: number; y: number; size: number; speed: number }[],
    time: number,
) {
    // Layered pixel planet, stars and debris; no simulation RNG is consumed by rendering.
    for (let y = -64; y <= 64; y += 4) {
        const half = Math.floor(Math.sqrt(64 * 64 - y * y) / 4) * 4;
        frame.rect(
            510,
            85 + y,
            half * 2,
            4,
            y < -24 ? 0x28465d : y < 0 ? 0x294e60 : y < 28 ? 0x233d55 : 0x1b2f47,
            1,
            -4,
        );
        if (y % 12 === 0) frame.rect(505, 85 + y, half * 1.5, 4, 0x20384f, 1, -3);
    }
    for (const star of stars)
        frame.rect(
            star.x,
            (star.y + time * star.speed) % H,
            star.size,
            star.size,
            star.size === 2 ? 0xa6b8ba : 0x41536c,
            1,
            -2,
        );
    for (let i = 0; i < 7; i++) {
        const x = (i * 117 + 29) % W,
            y = (i * 73 + time * 5) % H;
        frame.rect(x, y, 9, 5, 0x243045, 1, -1);
        frame.rect(x + 3, y - 3, 5, 3, 0x344157, 1, -1);
    }
}
export function overlay(
    id: "pause" | "result",
    onView: (phase: "paused" | "result") => void,
): SceneDefinition {
    return {
        id,
        blocksUpdateBelow: true,
        setup(s: SceneSetup) {
            s.system((ctx) => {
                if (
                    id === "pause" &&
                    (pressed(ctx.input, "Escape") ||
                        pressed(ctx.input, "KeyP") ||
                        pressed(ctx.input, "Pad9"))
                )
                    ctx.scenes.pop();
            });
            s.render((frame) => {
                frame.rect(W / 2, H / 2, W, H, 0x080c1b, 0.68, 20, true);
                onView(id === "pause" ? "paused" : "result");
            });
        },
    };
}
