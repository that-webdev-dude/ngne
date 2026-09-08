import { BrowserGame, component, lerp, type SceneDefinition } from "ngne";

const Position = component("position", () => ({ x: 40, previousX: 40 }));
const scene: SceneDefinition = {
    id: "hello",
    setup(scene) {
        scene.world.spawn(Position.of());
        const points = scene.world.query(Position);
        scene.system(({ dt }) => {
            points.each((_, p) => {
                p.previousX = p.x;
                p.x += 40 * dt;
                if (p.x > 640) p.previousX = p.x = 0;
            });
        });
        scene.resetInterpolation(() => {
            points.each((_, p) => { p.previousX = p.x; });
        });
        scene.render((frame, alpha) => {
            points.each((_, p) => {
                frame.rect(lerp(p.previousX, p.x, alpha), 100, 16, 16, 0x83e8e1);
            });
        });
    },
};

const app = new BrowserGame({
    canvas: document.querySelector("canvas")!,
    width: 640,
    height: 240,
    seed: "hello",
    state: {},
    transition: state => state,
});
await app.start(await app.game.prepare(scene, { key: "first-room" }));
