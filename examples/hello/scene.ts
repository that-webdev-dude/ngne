import { component, f64, lerp, type ImageAsset, type SceneDefinition, type Sprite } from "ngne";

const Position = component("position", { x: f64(40), previousX: f64(40) });

export const helloScene = createHelloScene();

export function createHelloScene(image?: ImageAsset): SceneDefinition {
    return {
        id: "hello",
        assets: image ? [image] : [],
        setup(scene) {
            scene.world.spawn(Position.of());
            const points = scene.world.query(Position);
            const sprite: Sprite = {
                x: 40,
                y: 100,
                width: 16,
                height: 16,
                color: 0x83e8e1,
                texture: image?.id,
            };
            scene.system(({ dt }) => {
                points.eachChunk((chunk) => {
                    const position = chunk.views.position;
                    for (let row = 0, count = chunk.count; row < count; row++) {
                        position.previousX[row] = position.x[row];
                        position.x[row] += 40 * dt;
                        if (position.x[row] > 640) position.previousX[row] = position.x[row] = 0;
                    }
                });
            });
            scene.resetInterpolation(() => {
                points.eachChunk((chunk) => {
                    const position = chunk.views.position;
                    for (let row = 0, count = chunk.count; row < count; row++)
                        position.previousX[row] = position.x[row];
                });
            });
            scene.render((frame, alpha) => {
                points.eachChunk((chunk) => {
                    const position = chunk.views.position;
                    for (let row = 0, count = chunk.count; row < count; row++) {
                        sprite.x = lerp(position.previousX[row], position.x[row], alpha);
                        frame.sprite(sprite);
                    }
                });
                frame.rect(320, 145, 96, 2, 0x83e8e1);
            });
        },
    };
}
