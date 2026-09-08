import { emptyInput, Frame, Game, lerp, pressed } from "../src/index.js";
import type { SceneDefinition } from "../src/index.js";

/** Shared numeric scenario; the browser also checks these frames on the GPU. */
export async function checkInterpolation(
    check: (condition: boolean, message: string) => void,
    inspectFrame?: (frame: Frame, label: string, alpha: number) => void,
): Promise<void> {
    const game = new Game({ seed: 6, state: {}, transition: state => state });
    const definition: SceneDefinition = {
        id: "interpolation",
        setup(scene) {
            const actor = scene.resource("actor", { x: 40, previousX: -100 });
            const effect = scene.resource("effect", { x: 80, previousX: 80 });
            scene.camera.x = 8;
            scene.camera.pixelSnap = false;
            scene.resetInterpolation(() => { actor.previousX = actor.x; });
            scene.system(({ input, camera }) => {
                actor.previousX = actor.x;
                actor.x += 8;
                camera.x += 8;
                if (pressed(input, "teleport")) {
                    actor.x = actor.previousX = 120;
                    camera.cut(72);
                }
                if (pressed(input, "freeze")) scene.freeze(2);
            });
            scene.system(() => {
                effect.previousX = effect.x;
                effect.x += 4;
            }, { runsDuringFreeze: true });
            scene.render((frame, alpha) => {
                frame.rect(lerp(actor.previousX, actor.x, alpha), 24, 8, 8, 0x00ff00);
                frame.rect(lerp(effect.previousX, effect.x, alpha), 48, 8, 8, 0x0000ff);
                frame.rect(100, 72, 8, 8, 0xffffff);
            });
        },
    };
    const input = (key: string) => ({
        ...emptyInput(), pressed: [key],
    });
    const sample = (label: string, actorX: number, effectStart: number, effectEnd: number,
        cameraStart: number, cameraEnd: number) => {
        const before = JSON.stringify(game.enumerate());
        for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
            const frame = new Frame();
            game.render(frame, alpha);
            check(frame.data[0] === actorX &&
                frame.data[13] === lerp(effectStart, effectEnd, alpha) &&
                frame.data[26] === 100 - lerp(cameraStart, cameraEnd, alpha),
            `${label}: actor, effect and camera at alpha ${alpha}`);
            inspectFrame?.(frame, label, alpha);
        }
        check(JSON.stringify(game.enumerate()) === before, `${label}: rendering preserves simulation`);
    };
    try {
        await game.start(await game.prepare(definition, { key: "room" }));
        check(JSON.stringify(game.enumerate().scenes[0].resources) === JSON.stringify({
            actor: { x: 40, previousX: 40 }, effect: { x: 80, previousX: 80 },
        }), "Mount invokes ordinary reset callbacks after committing setup");
        sample("Mount", 32, 72, 72, 8, 8);
        game.tick();
        sample("Scrolling", 32, 72, 68, 8, 16);
        game.tick(input("teleport"));
        sample("Teleport and cut", 48, 12, 16, 72, 72);
        game.tick(input("freeze"));
        sample("Freeze activation", 48, 8, 12, 80, 80);
        game.tick();
        sample("Frozen effects", 48, 12, 16, 80, 80);
        game.tick();
        sample("Freeze end boundary", 48, 16, 20, 80, 80);
        game.tick();
        sample("First ordinary tick", 48, 20, 16, 80, 88);
        const modal = await game.prepare({ id: "modal", blocksUpdateBelow: true, setup() {} }, { key: "pause" });
        game.push(modal);
        game.tick();
        sample("Suspension boundary", 48, 12, 12, 96, 96);
        const suspended = JSON.stringify(game.enumerate().scenes[0]);
        game.tick();
        sample("Suspended", 48, 12, 12, 96, 96);
        check(JSON.stringify(game.enumerate().scenes[0]) === suspended, "Suspension preserves all scene state");
        game.pop();
        game.tick();
        sample("Uncovered before update", 48, 12, 12, 96, 96);
        game.tick();
        sample("Scene resumed", 48, 12, 8, 96, 104);
        const stopped = JSON.stringify(game.enumerate());
        game.stop();
        await game.start();
        check(JSON.stringify(game.enumerate()) === stopped, "Stop/resume preserves all simulation state");
        sample("Host resumed before tick", 48, 8, 8, 104, 104);
        game.tick();
        sample("Host resumed after tick", 48, 8, 4, 104, 112);
    } finally {
        game.dispose();
    }
}
