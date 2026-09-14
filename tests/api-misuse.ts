import {
    bool,
    component,
    entityRef,
    f32,
    f64,
    Game,
    i32,
    u32,
    u8,
    type PreparedScene,
    type SceneSetup,
    type SystemContext,
} from "ngne";
import * as engine from "ngne";

// Compiled against source during typecheck and emitted declarations during build.
function authoringBoundary(
    game: Game,
    setup: SceneSetup,
    ctx: SystemContext,
    candidate: PreparedScene,
): void {
    const SchemaPosition = component("schema-position", {
        x: f64(),
        speed: f32(1),
        score: i32(),
        mask: u32(),
        team: u8(),
        active: bool(true),
        target: entityRef(),
    });
    // @ts-expect-error Entity-reference defaults are always null and take no argument.
    entityRef(null);
    // @ts-expect-error Object-component factories were removed; components declare field schemas.
    component("position", () => ({ x: 0 }));
    const entity = ctx.world.spawn();
    const schemaEntity = ctx.world.spawn(SchemaPosition.of({ x: 2, target: entity }));
    const x: number | undefined = ctx.world.read(schemaEntity, SchemaPosition, "x");
    ctx.world.write(schemaEntity, SchemaPosition, "x", x ?? 0);
    ctx.world.query(SchemaPosition).eachChunk((chunk) => {
        const position = chunk.views["schema-position"];
        position.x[0] += position.speed[0];
        const targetIndex: number = position.target.index[0];
        const targetGeneration: number = position.target.generation[0];
        void [targetIndex, targetGeneration, chunk.entityAt(0)];
    });
    ctx.world.query().each(() => {});
    ctx.world.despawn(entity);
    setup.resource("counter", { value: 0 });
    candidate.release();
    game.scenes.map((scene) => scene.id);
    game.enumerate();
    const random = new engine.Random(1);
    random.snapshot();
    random.restore(2);
    // @ts-expect-error RNG state is private; use snapshot and restore.
    random.state = 3;

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
    ctx.world.query(SchemaPosition).add({});
    // @ts-expect-error Zero-argument queries do not expose schema chunks.
    ctx.world.query().eachChunk(() => {});
    // @ts-expect-error Component queries traverse chunks; per-entity each() was removed.
    ctx.world.query(SchemaPosition).each(() => {});
    // @ts-expect-error Object get() was removed; components use field-level sparse reads.
    ctx.world.get(schemaEntity, SchemaPosition);
    // @ts-expect-error Unknown schema field.
    ctx.world.read(schemaEntity, SchemaPosition, "missing");
    // @ts-expect-error Schema field values retain their logical types.
    ctx.world.write(schemaEntity, SchemaPosition, "active", 1);
    // @ts-expect-error Schema values reject unknown fields.
    SchemaPosition.of({ missing: 1 });
    // @ts-expect-error Schema component definitions are read-only.
    SchemaPosition.fields.x = f64();
    // @ts-expect-error The object-component type was removed.
    const removedComponent: engine.Component<object> = SchemaPosition;
    // @ts-expect-error The object-component value type was removed.
    const removedValue: engine.ComponentValue = SchemaPosition.of();
    // @ts-expect-error The object-component query type was removed.
    const removedQuery: engine.Query<[]> = ctx.world.query();
    void [removedComponent, removedValue, removedQuery];
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
    // @ts-expect-error Schema component runtime is internal.
    new engine.SchemaComponent();
    // @ts-expect-error Cleanup is internal.
    new engine.Cleanup();
    // @ts-expect-error Platform failure capability is internal.
    engine.FAIL_GAME;
}
void authoringBoundary;

interface Progress {
    rooms: { scores: number[] };
    best: number;
}
type Command = { type: "score"; payload: { values: number[] } };
function committedStateBoundary(game: Game<Progress, Command>): void {
    const scene: engine.SceneDefinition<Progress, Command> = {
        id: "progress",
        setup(setup) {
            const state = setup.state();
            const best: number = state.read().best;
            state.dispatch({ type: "score", payload: { values: [best] } });
            // @ts-expect-error Scene state types come from the definition.
            setup.state<{ unrelated: string }, string>();
            // @ts-expect-error State schema has no unrelated field.
            state.read().unrelated;
            // @ts-expect-error Command discriminant belongs to the Game contract.
            state.dispatch({ type: "reset" });
            // @ts-expect-error Command payload has numeric values.
            state.dispatch({ type: "score", payload: { values: ["wrong"] } });
            // @ts-expect-error Nested snapshot objects are read-only.
            state.read().rooms.scores = [];
            // @ts-expect-error Snapshot arrays are read-only.
            state.read().rooms.scores.push(1);
        },
    };
    void game.prepare(scene, { key: "valid" });
    game.candidates.ensure(1, "next", scene, { key: "next", retries: 1 });
    game.candidates.take(1, "next")?.release();
    game.candidates.release(1);
    // @ts-expect-error Retry count is numeric.
    game.candidates.ensure(1, "next", scene, { key: "next", retries: "one" });
    const portable: engine.SceneDefinition = { id: "portable", setup() {} };
    void game.prepare(portable, { key: "portable" });
    const wrongState: engine.SceneDefinition<{ best: string }, Command> = {
        id: "wrong",
        setup() {},
    };
    // @ts-expect-error A Game cannot mount a scene expecting unrelated state.
    void game.prepare(wrongState, { key: "wrong" });
    const wrongCommand: engine.SceneDefinition<Progress, { type: "reset" }> = {
        id: "wrong",
        setup() {},
    };
    // @ts-expect-error A Game cannot mount a scene dispatching unsupported commands.
    void game.prepare(wrongCommand, { key: "wrong" });
    // @ts-expect-error Host reads are also deeply read-only.
    game.state.rooms.scores[0] = 9;
    const options: engine.GameOptions<Progress, Command> = {
        seed: 1,
        state: { rooms: { scores: [] }, best: 0 },
        transition(state, command) {
            // @ts-expect-error Transitions cannot mutate the previous snapshot.
            state.rooms.scores.push(1);
            // @ts-expect-error Transitions cannot mutate owned command payloads.
            command.payload.values.push(1);
            return state;
        },
    };
    // @ts-expect-error Transitions must return synchronous data.
    options.transition = async (state) => state;
    const inferred = new Game({
        seed: 1,
        state: { best: 0 },
        transition: (s, c: number) => ({ best: s.best + c }),
    });
    void inferred.prepare(
        {
            id: "inferred",
            setup(s) {
                s.state().dispatch(1);
                // @ts-expect-error Inferred commands remain numeric.
                s.state().dispatch("wrong");
            },
        },
        { key: "inferred" },
    );
}
void committedStateBoundary;

async function webgpuBoundary(canvas: HTMLCanvasElement, bitmap: ImageBitmap): Promise<void> {
    const renderer = await engine.WebGPURenderer.create(canvas, 640, 360);
    const image: engine.ImageAsset = engine.imageAsset("image", "./image.png");
    const upload: Promise<void> = renderer.texture(image.id, bitmap);
    await upload;
    const submitted: void = renderer.render(new engine.Frame());
    const status: engine.RendererStatus = renderer.status;
    void submitted;
    void status;
    // @ts-expect-error Presentation status cannot be overwritten by consumers.
    renderer.status = "ready";
    // @ts-expect-error GPU construction is asynchronous through create().
    new engine.WebGPURenderer(canvas, 640, 360);
    // @ts-expect-error Internal runtime is not a package export.
    engine.WebGpuRuntime;
    // @ts-expect-error Preparation hooks are host-only capabilities.
    engine.PREPARE_ASSET;
    // @ts-expect-error Internal renderer acquisition is not a package export.
    engine.CREATE_RENDERER;
    renderer.dispose();
    new engine.BrowserGame({
        canvas,
        seed: 1,
        state: {},
        transition: (s) => s,
        // @ts-expect-error BrowserGame always uses WebGPU; any renderer option is rejected.
        renderer: "auto",
    });
    // @ts-expect-error The pre-WebGPU Renderer class was removed.
    new engine.Renderer(canvas, 640, 360);
}
void webgpuBoundary;
