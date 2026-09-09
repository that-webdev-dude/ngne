import type { Audio, Game, PreparedScene, SceneDefinition } from "ngne";

import { createLevel } from "./game.js";
import type { OverlayOptions, Progress, ProgressCommand, Run } from "./game.js";
import type { LevelData } from "./levels.js";

type Purpose = "respawn" | "next" | "complete" | "restart" | "pause";
type Intent = "pause" | "resume" | "restart";
type Definition = SceneDefinition<Progress, ProgressCommand>;

interface CandidateRecord {
    readonly purpose: Purpose;
    readonly ownerId: number;
    readonly key: string;
    readonly definition: Definition;
    handle: PreparedScene | undefined;
    status: "preparing" | "ready" | "consumed" | "released" | "failed";
    retries: number;
}

export interface RegistryOptions {
    readonly levels: readonly LevelData[];
    readonly audio?: Pick<Audio, "scene">;
    readonly onView?: (view: Readonly<Run>) => void;
    readonly onOverlayView?: OverlayOptions["onView"];
    readonly overlay?: (kind: "pause" | "complete", options: OverlayOptions) => Definition;
    readonly prepare?: (
        game: Game<Progress, ProgressCommand>,
        definition: Definition,
        key: string,
    ) => Promise<PreparedScene>;
    readonly onError: (error: unknown) => void;
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
    const records = new Map<Purpose, CandidateRecord>();
    const intents = { pause: false, resume: false, restart: false };
    let ownerId: number | undefined;
    let disposed = false;
    const takeIntent = (intent: Intent): boolean => {
        const requested = intents[intent];
        intents[intent] = false;
        return requested;
    };
    const take = (purpose: Purpose): PreparedScene | undefined => {
        const record = records.get(purpose);
        if (disposed || record?.ownerId !== ownerId || record?.status !== "ready") return;
        record.status = "consumed";
        const handle = record.handle;
        record.handle = undefined;
        return handle;
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
    const prepare = async (
        game: Game<Progress, ProgressCommand>,
        record: CandidateRecord,
    ): Promise<void> => {
        try {
            const handle = await (options.prepare
                ? options.prepare(game, record.definition, record.key)
                : game.prepare(record.definition, { key: record.key }));
            if (disposed || ownerId !== record.ownerId || record.status === "released") {
                handle.release();
                record.status = "released";
            } else {
                record.handle = handle;
                record.status = "ready";
            }
        } catch (error) {
            if (disposed || ownerId !== record.ownerId || record.status === "released") return;
            record.status = "failed";
            if (record.retries === 1) options.onError(error);
        }
    };
    const ensure = (
        game: Game<Progress, ProgressCommand>,
        purpose: Purpose,
        key: string,
        create: () => Definition,
    ): void => {
        if (ownerId === undefined) return;
        const previous = records.get(purpose);
        if (previous) {
            if (previous.status === "preparing" || previous.status === "ready") return;
            if (previous.status === "failed") {
                if (previous.retries === 1) return;
                previous.retries++;
                previous.status = "preparing";
                void prepare(game, previous);
                return;
            }
            if (purpose !== "pause") return;
        }
        const record: CandidateRecord = {
            purpose,
            ownerId,
            key,
            definition: create(),
            handle: undefined,
            status: "preparing",
            retries: 0,
        };
        records.set(purpose, record);
        void prepare(game, record);
    };
    const clear = (): void => {
        for (const record of records.values()) {
            record.handle?.release();
            record.handle = undefined;
            if (record.status !== "consumed" && record.status !== "failed")
                record.status = "released";
        }
        records.clear();
        intents.pause = intents.resume = intents.restart = false;
    };
    return {
        createLevelDefinition,
        request(intent) {
            if (!disposed) intents[intent] = true;
        },
        reconcile(game) {
            if (disposed) return;
            if (game.lifecycle !== "Running") {
                clear();
                ownerId = undefined;
                return;
            }
            const owner = game.scenes[0];
            if (owner?.id !== ownerId) {
                clear();
                ownerId = owner?.id;
            }
            if (!owner) return;
            if (owner.key === "complete") {
                ensure(game, "restart", levelKey(0, 0), () => createLevelDefinition(0));
                return;
            }
            const match = /^level-(\d+)-attempt-(\d+)$/.exec(owner.key);
            if (!match) throw new Error(`Invalid platformer mount key ${owner.key}`);
            const level = Number(match[1]);
            const attempt = Number(match[2]);
            ensure(game, "respawn", levelKey(level, attempt + 1), () =>
                createLevelDefinition(level),
            );
            if (level + 1 < 2 && options.levels[level + 1])
                ensure(game, "next", levelKey(level + 1, 0), () =>
                    createLevelDefinition(level + 1),
                );
            const overlay = options.overlay;
            if (overlay) {
                if (level + 1 === 2)
                    ensure(game, "complete", "complete", () => overlay("complete", overlayOptions));
                ensure(game, "pause", "pause", () => overlay("pause", overlayOptions));
            }
        },
        dispose() {
            disposed = true;
            clear();
            ownerId = undefined;
        },
    };
}
