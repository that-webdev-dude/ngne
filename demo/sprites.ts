import type { Frame } from "@that-webdev-dude/ngne";
import art from "./assets/starfall.json";

export type SpriteName = keyof typeof art.frames;
export const bodySprites: readonly SpriteName[] = [
    "player",
    "chaser",
    "gunship",
    "player-bolt",
    "enemy-round",
    "boss",
    "repair",
];

/** Atlas data is immutable demo data; decoded images stay in asset leases. */
export function drawSprite(
    frame: Frame,
    name: SpriteName,
    x: number,
    y: number,
    rotation = 0,
    layer = 3,
    alpha = 1,
) {
    const rect = art.frames[name];
    const dx = (0.5 - rect.pivot[0]) * rect.w;
    const dy = (0.5 - rect.pivot[1]) * rect.h;
    const cos = Math.cos(rotation),
        sin = Math.sin(rotation);
    frame.sprite({
        x: x + dx * cos - dy * sin,
        y: y + dx * sin + dy * cos,
        width: rect.w,
        height: rect.h,
        texture: "ships",
        u: rect.x / art.width,
        v: rect.y / art.height,
        uw: rect.w / art.width,
        vh: rect.h / art.height,
        rotation,
        layer,
        alpha,
    });
}

export function animationFrame(
    name: keyof typeof art.animations,
    ageMs: number,
): SpriteName | undefined {
    const animation = art.animations[name];
    const index = Math.floor(Math.max(0, ageMs) / animation.frameMs);
    const selected = animation.frames[animation.loop ? index % animation.frames.length : index];
    if (selected === undefined) return undefined;
    if (!isSprite(selected)) throw new Error(`Unknown Starfall frame: ${selected}`);
    return selected;
}

function isSprite(name: string): name is SpriteName {
    return Object.hasOwn(art.frames, name);
}

export interface ArtEffect {
    kind: "explosion" | "impact";
    x: number;
    y: number;
    born: number;
}

/** Scene-owned presentation clock: advances on updates, never on renders or wall time. */
export function createEffects() {
    const active: ArtEffect[] = [];
    let ticks = 0;
    return {
        active,
        get timeMs() {
            return (ticks * 1000) / 60;
        },
        add(kind: ArtEffect["kind"], x: number, y: number) {
            // Nova/Chaos bursts cannot create unbounded presentation work.
            if (active.length < 128) active.push({ kind, x, y, born: ticks });
        },
        step() {
            ticks++;
            let write = 0;
            for (const effect of active) {
                const age = ((ticks - effect.born) * 1000) / 60;
                if (effect.kind === "impact" ? age < 80 : animationFrame("explosion", age))
                    active[write++] = effect;
            }
            active.length = write;
        },
        render(frame: Frame, reducedMotion = false) {
            for (const effect of active) {
                const age = ((ticks - effect.born) * 1000) / 60;
                const name =
                    effect.kind === "impact" || reducedMotion
                        ? "impact"
                        : animationFrame("explosion", age);
                if (name)
                    drawSprite(frame, name, effect.x, effect.y, 0, 2, reducedMotion ? 0.6 : 0.85);
            }
        },
        clear() {
            active.length = 0;
            ticks = 0;
        },
    };
}
