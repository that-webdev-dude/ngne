import { component, f64, lerp, type SceneDefinition } from "ngne";

const Position = component("position", { x: f64(40), previousX: f64(40) });

export const helloScene: SceneDefinition = {
    id: "hello",
    setup(scene) {
        scene.world.spawn(Position.of());
        const points = scene.world.query(Position);
        scene.system(({ dt }) => {
            points.eachChunk((chunk) => {
                const position = chunk.views.position;
                for (let row = 0; row < chunk.count; row++) {
                    position.previousX[row] = position.x[row];
                    position.x[row] += 40 * dt;
                    if (position.x[row] > 640) position.previousX[row] = position.x[row] = 0;
                }
            });
        });
        scene.resetInterpolation(() => {
            points.eachChunk((chunk) => {
                const position = chunk.views.position;
                for (let row = 0; row < chunk.count; row++)
                    position.previousX[row] = position.x[row];
            });
        });
        scene.render((frame, alpha) => {
            points.eachChunk((chunk) => {
                const position = chunk.views.position;
                for (let row = 0; row < chunk.count; row++)
                    frame.rect(
                        lerp(position.previousX[row], position.x[row], alpha),
                        100,
                        16,
                        16,
                        0x83e8e1,
                    );
            });
        });
    },
};
