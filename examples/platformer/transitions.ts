import type { Audio, Game, SceneDefinition } from "ngne";

import { createLevel } from "./game.js";
import type { OverlayOptions, Progress, ProgressCommand, Run } from "./game.js";
import type { LevelData } from "./levels.js";

type Purpose = "respawn" | "next" | "complete" | "restart" | "pause";
type Intent = "pause" | "resume" | "restart";
type Definition = SceneDefinition<Progress, ProgressCommand>;
interface CandidateSpec {
    readonly purpose: Purpose;
    readonly key: string;
    readonly definition: Definition;
}

export interface RegistryOptions {
    readonly levels: readonly LevelData[];
    readonly audio?: Pick<Audio, "scene">;
    readonly onView?: (view: Readonly<Run>) => void;
    readonly onOverlayView?: OverlayOptions["onView"];
    readonly overlay?: (kind: "pause" | "complete", options: OverlayOptions) => Definition;
}

export interface TransitionRegistry {
    createLevelDefinition(level: number): Definition;
    request(intent: Intent): void;
    reconcile(game: Game<Progress, ProgressCommand>): void;
    dispose(): void;
}

export function levelKey(level: number, attempt: number): string {
    return `level-${level}-attempt-${attempt}`;
}

export function createTransitionRegistry(options: RegistryOptions): TransitionRegistry {
    const intents = { pause: false, resume: false, restart: false };
    const specs = new Map<Purpose, CandidateSpec>();
    let game: Game<Progress, ProgressCommand> | undefined;
    let ownerId: number | undefined;
    let disposed = false;
    const takeIntent = (intent: Intent): boolean => {
        const requested = intents[intent];
        intents[intent] = false;
        return requested;
    };
    const take = (purpose: Purpose) => {
        if (disposed || !game || ownerId === undefined) return;
        return game.candidates.take(ownerId, purpose);
    };
    const createLevelDefinition = (index: number): Definition => {
        const data = options.levels[index];
        if (!data) throw new Error(`Missing level ${index}`);
        return createLevel({
            index,
            data,
            audio: options.audio,
            onView: options.onView,
            respawn: () => take("respawn"),
            next: () => take("next") ?? take("complete"),
            pause: () => take("pause"),
            takePauseIntent: () => takeIntent("pause"),
        });
    };
    const overlayOptions: OverlayOptions = {
        restart: () => take("restart"),
        takeIntent,
        onView: options.onOverlayView,
    };
    const add = (purpose: Purpose, key: string, create: () => Definition): void => {
        specs.set(purpose, { purpose, key, definition: create() });
    };
    const clear = (): void => {
        if (game && ownerId !== undefined) game.candidates.release(ownerId);
        specs.clear();
        intents.pause = intents.resume = intents.restart = false;
    };
    const configure = (ownerKey: string): void => {
        if (ownerKey === "complete") {
            add("restart", levelKey(0, 0), () => createLevelDefinition(0));
            return;
        }
        const match = /^level-(\d+)-attempt-(\d+)$/.exec(ownerKey);
        if (!match) throw new Error(`Invalid platformer mount key ${ownerKey}`);
        const level = Number(match[1]);
        const attempt = Number(match[2]);
        add("respawn", levelKey(level, attempt + 1), () => createLevelDefinition(level));
        if (level + 1 < 2 && options.levels[level + 1])
            add("next", levelKey(level + 1, 0), () => createLevelDefinition(level + 1));
        const overlay = options.overlay;
        if (!overlay) return;
        if (level + 1 === 2) add("complete", "complete", () => overlay("complete", overlayOptions));
        add("pause", "pause", () => overlay("pause", overlayOptions));
    };
    return {
        createLevelDefinition,
        request(intent) {
            if (!disposed) intents[intent] = true;
        },
        reconcile(nextGame) {
            if (disposed) return;
            if (game && game !== nextGame) clear();
            game = nextGame;
            if (game.lifecycle !== "Running") {
                clear();
                ownerId = undefined;
                return;
            }
            const owner = game.scenes[0];
            if (owner?.id !== ownerId) {
                clear();
                ownerId = owner?.id;
                if (owner) configure(owner.key);
            }
            if (!owner) return;
            for (const spec of specs.values())
                game.candidates.ensure(owner.id, spec.purpose, spec.definition, {
                    key: spec.key,
                    retries: 1,
                });
        },
        dispose() {
            disposed = true;
            clear();
            ownerId = undefined;
            game = undefined;
        },
    };
}
