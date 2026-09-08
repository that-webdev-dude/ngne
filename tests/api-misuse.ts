import { component, Game, type PreparedScene, type SceneSetup, type SystemContext } from "ngne";
import * as engine from "ngne";

// Compiled against source during typecheck and emitted declarations during build.
function authoringBoundary(game: Game, setup: SceneSetup, ctx: SystemContext, candidate: PreparedScene): void {
    const Position = component("position", () => ({ x: 0 }));
    const entity = ctx.world.spawn(Position.of());
    ctx.world.get(entity, Position);
    ctx.world.query(Position).each((_, position) => { position.x++; });
    ctx.world.despawn(entity);
    setup.resource("counter", { value: 0 });
    candidate.release();
    game.scenes.map(scene => scene.id);
    game.enumerate();

    // @ts-expect-error Lifecycle is runtime-owned.
    game.lifecycle = "Running";
    // @ts-expect-error Tick counter is runtime-owned.
    game.simulationTick++;
    // @ts-expect-error Inspection never grants foreign world access.
    game.scenes[0].world.spawn();
    // @ts-expect-error Inspection never exposes resource bindings.
    game.scenes[0].resources.set("counter", {});
    // @ts-expect-error Summaries are read-only.
    game.scenes[0].freezeRemaining = 0;
    // @ts-expect-error Stack inspection is read-only.
    game.scenes.pop();
    // @ts-expect-error Enumeration cannot mutate a scene.
    game.enumerate().scenes[0].freezePending = 0;
    // @ts-expect-error Setup world cannot commit.
    setup.world.commit();
    // @ts-expect-error System world cannot commit.
    ctx.world.commit();
    // @ts-expect-error System world cannot enumerate.
    ctx.world.enumerate();
    // @ts-expect-error Query membership is runtime-owned.
    ctx.world.query(Position).add({});
    // @ts-expect-error Candidates cannot be consumed by authors.
    candidate.consume(Symbol());
    // @ts-expect-error Candidate ownership is hidden.
    candidate.owner;
    // @ts-expect-error Candidates have no public constructor.
    new engine.PreparedScene();
    // @ts-expect-error Scene runtime is internal.
    new engine.SceneInstance();
    // @ts-expect-error World runtime is internal.
    new engine.World();
    // @ts-expect-error Query runtime is internal.
    new engine.Query();
    // @ts-expect-error Cleanup is internal.
    new engine.Cleanup();
    // @ts-expect-error Platform failure capability is internal.
    engine.FAIL_GAME;
}
void authoringBoundary;
