import { test } from "node:test";
import assert from "node:assert/strict";
import {
  World,
  component,
  Game,
  FixedStep,
  Random,
  seedOf,
  Input,
  Camera,
  Frame,
  Cleanup,
  Assets,
  type SceneDefinition,
  type SceneSetup,
  type PreparedScene,
} from "../src/index.js";
const Position = component("position", () => ({ x: 0, y: 0 }));
const Velocity = component("velocity", () => ({ x: 0, y: 0 }));
const game = (diagnostic?: (error: unknown) => void) =>
  new Game({
    seed: 123,
    state: { score: 0 },
    transition: (s, c: number) => ({ score: s.score + c }),
    diagnostic,
  });
async function boot(setup: (s: SceneSetup) => void, g = game()) {
  await g.start(await g.prepare({ id: "test", setup }, { key: "test" }));
  return g;
}

test("pending lifetime, stable query membership, stale and foreign handles, slot reuse", () => {
  const w = new World(),
    other = new World(),
    q = w.query(Position, Velocity);
  const e = w.spawn(Position.of({ x: 1 }), Velocity.of({ x: 2 }));
  assert.equal(q.size, 0);
  assert.equal(w.has(e), false);
  w.commit();
  assert.equal(q.size, 1);
  q.each((entity, p, v) => {
    p.x += v.x;
    w.despawn(entity);
    assert.equal(w.has(entity), true);
    assert.throws(() => w.commit());
  });
  assert.equal(w.get(e, Position)?.x, 3);
  w.commit();
  assert.equal(q.size, 0);
  const fresh = w.spawn(Position.of(), Velocity.of());
  w.commit();
  assert.equal(fresh.index, e.index);
  assert.notEqual(fresh.generation, e.generation);
  w.despawn(e);
  w.commit();
  assert.equal(w.has(fresh), true);
  assert.equal(other.get(fresh, Position), undefined);
  for (let i = 0; i < 1000; i++) {
    w.despawn(fresh);
    const id = w.spawn(Position.of());
    w.commit();
    w.despawn(id);
    w.commit();
  }
  assert.ok(w.capacity <= 3);
});
test("cached queries include new archetypes; despawn swap preserves row lookup", () => {
  const w = new World(),
    q = w.query(Position);
  const a = w.spawn(Position.of({ x: 1 })),
    b = w.spawn(Position.of({ x: 2 }));
  w.commit();
  w.despawn(a);
  w.commit();
  assert.equal(w.get(b, Position)?.x, 2);
  w.spawn(Position.of(), Velocity.of());
  w.commit();
  assert.equal(q.size, 2);
});
test("fixed loop caps ticks, retains fraction and rejects invalid budgets", () => {
  const f = new FixedStep(0.1, 3);
  let ticks = 0;
  assert.deepEqual(
    f.advance(0.05, () => ticks++),
    { ticks: 0, dropped: 0, alpha: 0.5 },
  );
  const r = f.advance(0.82, () => ticks++);
  assert.equal(ticks, 3);
  assert.equal(r.dropped, 5);
  assert.ok(Math.abs(r.alpha - 0.7) < 1e-9);
  assert.throws(() => new FixedStep(0));
  assert.throws(() => new FixedStep(0.1, Infinity));
});
test("input holds edges until consumption and never repeats them on catch-up", () => {
  const i = new Input();
  i.set("KeyW", true);
  const a = i.consume(),
    b = i.consume();
  assert.deepEqual(a.pressed, ["KeyW"]);
  assert.deepEqual(b.pressed, []);
  assert.deepEqual(b.held, ["KeyW"]);
  i.set("KeyW", false);
  assert.deepEqual(i.consume().released, ["KeyW"]);
  assert.throws(() => {
    (a.held as string[]).push("evil");
  });
});
test("RNG stream seeds are order independent and state is repeatable", () => {
  const a = new Random(seedOf(1, "scene", "room", "ai")),
    b = new Random(seedOf(1, "scene", "room", "ai"));
  const fx = new Random(seedOf(1, "scene", "room", "fx"));
  for (let i = 0; i < 100; i++) {
    fx.next();
    assert.equal(a.next(), b.next());
  }
  assert.notEqual(a.state, fx.state);
});
test("systems see immediate values and committed state stays stable for whole tick", async () => {
  const seen: number[] = [];
  const g = await boot((s) => {
    const r = s.resource("r", { n: 0 });
    const state = s.state<{ score: number }, number>();
    s.system(() => {
      r.n++;
      state.dispatch(2);
      seen.push(state.read().score);
    });
    s.system(() => {
      assert.equal(r.n, 1);
      seen.push(state.read().score);
    });
  });
  g.tick();
  assert.deepEqual(seen, [0, 0]);
  assert.equal(g.state.score, 2);
  assert.throws(() => {
    (g.state as any).score = 20;
  });
  g.dispose();
});
test("freeze publishes at commit, longest wins, events wait, continuation runs", async () => {
  let normal = 0,
    fx = 0;
  const seen: unknown[][] = [];
  const g = await boot((s) => {
    s.system((ctx) => {
      normal++;
      seen.push([...ctx.events]);
      if (normal === 1) {
        ctx.emit({ type: "hit" });
        s.freeze(2);
        s.freeze(3);
      }
    });
    s.system(() => fx++, { runsDuringFreeze: true });
  });
  g.tick();
  assert.equal(normal, 1);
  assert.equal(g.scenes[0].freezeRemaining, 3);
  g.tick();
  g.tick();
  g.tick();
  assert.equal(normal, 1);
  assert.equal(fx, 4);
  g.tick();
  assert.equal(normal, 2);
  assert.equal(seen[1][0]?.type, "hit");
  g.dispose();
});
test("blocking scene suspends lower freeze countdown but both render", async () => {
  let lower = 0;
  const g = await boot((s) => {
    s.system(() => {
      lower++;
      s.freeze(3);
    });
  });
  const modal = await g.prepare(
    { id: "modal", blocksUpdateBelow: true, setup() {} },
    { key: "modal" },
  );
  g.push(modal);
  g.tick();
  g.tick();
  assert.equal(lower, 1);
  assert.equal(g.scenes[0].freezeRemaining, 3);
  g.pop();
  g.tick();
  assert.equal(g.scenes.length, 1);
  g.tick();
  assert.equal(g.scenes[0].freezeRemaining, 2);
  g.dispose();
});
test("FIFO scene failure keeps earlier commands and commits state; later commands discarded", async () => {
  const errors: unknown[] = [];
  const g = await boot(
    (s) => {
      const state = s.state<{ score: number }, number>();
      s.system(() => state.dispatch(1));
    },
    game((e) => errors.push(e)),
  );
  const good = await g.prepare({ id: "good", setup() {} }, { key: "good" }),
    bad = await g.prepare(
      {
        id: "bad",
        setup() {
          throw Error("mount");
        },
      },
      { key: "bad" },
    ),
    later = await g.prepare({ id: "later", setup() {} }, { key: "later" });
  g.push(good);
  g.set(bad);
  g.set(later);
  g.tick();
  assert.deepEqual(
    g.scenes.map((s) => s.definition.id),
    ["test", "good"],
  );
  assert.equal(g.state.score, 1);
  assert.equal(g.lifecycle, "Running");
  assert.equal(g.simulationTick, 1);
  assert.equal(errors.length, 1);
  g.set(later);
  g.tick();
  assert.equal(errors.length, 2);
  g.dispose();
});
test("private mount rolls back in reverse order, failed replacement preserves original", async () => {
  const cleanup: string[] = [];
  const g = await boot(() => {});
  const bad = await g.prepare(
    {
      id: "bad",
      setup(s) {
        s.defer(() => cleanup.push("first"));
        s.resource("r", {}, () => cleanup.push("second"));
        s.defer(() => {
          cleanup.push("third");
          throw Error("cleanup");
        });
        throw Error("setup");
      },
    },
    { key: "bad" },
  );
  g.set(bad);
  g.tick();
  assert.deepEqual(cleanup, ["third", "second", "first"]);
  assert.equal(g.scenes[0].definition.id, "test");
  g.dispose();
});
test("scene setup cannot dispatch and saved setup capabilities cannot rebind", async () => {
  let setup!: SceneSetup;
  const g = await boot((s) => {
    setup = s;
    const state = s.state<{ score: number }, number>();
    assert.throws(() => state.dispatch(5));
  });
  assert.throws(() => setup.resource("late", {}));
  assert.throws(() => setup.random("late"));
  assert.throws(() => setup.system(() => {}));
  assert.throws(() => setup.freeze(1));
  g.dispose();
});
test("stop/resume preserves state, scene instance, resources and RNG; dispose is terminal", async () => {
  const g = await boot((s) => {
    s.resource("counter", { n: 1 });
    s.random("rng");
  });
  const scene = g.scenes[0];
  g.tick();
  const snap = g.enumerate();
  g.stop();
  g.tick();
  assert.equal(g.simulationTick, 1);
  await g.start();
  assert.equal(g.scenes[0], scene);
  assert.deepEqual(g.enumerate(), snap);
  g.dispose();
  g.dispose();
  assert.equal(g.lifecycle, "Disposed");
  await assert.rejects(() => g.start());
});
test("first mount failure allows retry; cleanup failure enters Failed", async () => {
  const g = game();
  const candidate = await g.prepare(
    {
      id: "bad",
      setup() {
        throw Error("x");
      },
    },
    { key: "x" },
  );
  await assert.rejects(() => g.start(candidate));
  assert.equal(g.lifecycle, "Stopped");
  await boot(() => {}, g);
  g.dispose();
  const h = game();
  await assert.rejects(() =>
    boot((s) => {
      s.defer(() => {
        throw Error("cleanup");
      });
      throw Error("setup");
    }, h),
  );
  assert.equal(h.lifecycle, "Failed");
  h.dispose();
});
test("dispose attempts all cleanup and remains terminal after errors", async () => {
  const calls: string[] = [];
  const g = await boot((s) => {
    s.defer(() => calls.push("a"));
    s.defer(() => {
      calls.push("b");
      throw Error("b");
    });
  });
  assert.throws(() => g.dispose(), AggregateError);
  assert.deepEqual(calls, ["b", "a"]);
  assert.equal(g.lifecycle, "Disposed");
});
test("preparation cancellation releases leases and cannot activate; successful loads share cache", async () => {
  let resolve!: (v: object) => void,
    loads = 0,
    disposed = 0;
  const asset = {
    id: "a",
    load: () => {
      loads++;
      return new Promise<object>((r) => (resolve = r));
    },
    dispose: () => disposed++,
  };
  const assets = new Assets(),
    cancel = new AbortController();
  const a = assets.acquire(asset, cancel.signal),
    b = assets.acquire(asset);
  await Promise.resolve();
  cancel.abort();
  await assert.rejects(a);
  resolve({ pixels: 1 });
  const lease = await b;
  assert.equal(loads, 1);
  lease.release();
  const cached = await assets.acquire(asset);
  assert.equal(loads, 1);
  cached.release();
  assets.dispose();
  assert.equal(disposed, 1);
});
test("stop invalidates candidates; foreign candidates cannot be mounted", async () => {
  const a = await boot(() => {}),
    b = game();
  const c = await a.prepare({ id: "other", setup() {} }, { key: "other" });
  await assert.rejects(() => b.start(c));
  a.stop();
  await a.start();
  a.set(c);
  a.tick();
  assert.equal(a.scenes[0].definition.id, "test");
  a.dispose();
  b.dispose();
});
test("camera interpolation, snapping and frame sorting do not mutate simulation", () => {
  const camera = new Camera();
  camera.x = 10;
  camera.previousX = 0;
  const f = new Frame();
  f.scene(camera, 0.5);
  f.rect(20.3, 0, 2, 2, 0xffffff, 1, 4);
  f.rect(10, 0, 2, 2, 0xffffff, 1, 1);
  const c = new Camera();
  f.scene(c, 1);
  f.rect(0, 0, 2, 2, 0xffffff, 1, -100);
  f.sort();
  assert.deepEqual(f.order, [1, 0, 2]);
  assert.equal(f.data[0], 15);
  assert.equal(camera.x, 10);
  camera.cut();
  assert.equal(camera.previousX, 10);
});
test("cleanup is best effort and exactly once", () => {
  const c = new Cleanup(),
    calls: number[] = [];
  c.defer(() => calls.push(1));
  c.defer(() => {
    calls.push(2);
    throw Error();
  });
  assert.throws(() => c.dispose());
  c.dispose();
  assert.deepEqual(calls, [2, 1]);
});
test("loop startup failure rolls back cold mount; resume failure preserves it for disposal", async () => {
  const g = game();
  let cleaned = 0,
    stopped = 0;
  const def = {
    id: "first",
    setup(s: SceneSetup) {
      s.defer(() => cleaned++);
    },
  };
  const failing = {
    start() {
      throw Error("loop");
    },
    stop() {
      stopped++;
    },
  };
  const awaitCandidate = await g.prepare(def, { key: "first" });
  await assert.rejects(() => g.start(awaitCandidate, failing));
  assert.equal(g.lifecycle, "Stopped");
  assert.equal(cleaned, 1);
  assert.equal(stopped, 1);
  assert.equal(g.scenes.length, 0);
  await g.start(await g.prepare(def, { key: "first" }));
  const scene = g.scenes[0];
  g.stop();
  await assert.rejects(() => g.start(undefined, failing));
  assert.equal(g.lifecycle, "Failed");
  assert.equal(g.scenes[0], scene);
  assert.equal(cleaned, 1);
  g.dispose();
  assert.equal(cleaned, 2);
});
test("state cannot smuggle mutable built-ins through Object.freeze", () => {
  assert.throws(
    () =>
      new Game({ seed: 1, state: { bad: new Map() }, transition: (s) => s }),
  );
});
test("same definition mounts own independent resources and named RNG", async () => {
  const g = game();
  const def = {
    id: "room",
    setup(s: SceneSetup) {
      const r = s.resource("counter", { n: 0 });
      const random = s.random("ai");
      s.system(() => {
        r.n++;
        random.next();
      });
    },
  };
  await g.start(await g.prepare(def, { key: "same" }));
  g.push(await g.prepare(def, { key: "same" }));
  g.tick();
  g.tick();
  const [a, b] = g.scenes;
  assert.notEqual(a.resources.get("counter"), b.resources.get("counter"));
  assert.deepEqual(a.resources.get("counter"), { n: 2 });
  assert.deepEqual(b.resources.get("counter"), { n: 1 });
  g.dispose();
});
test("cancelled speculative preparation never publishes after its loader finishes", async () => {
  const g = await boot(() => {});
  let complete!: (value: object) => void;
  let released = 0;
  const loading = g.prepare(
    {
      id: "slow",
      assets: [
        {
          id: "slow-asset",
          load: () => new Promise<object>((r) => (complete = r)),
          dispose: () => released++,
        },
      ],
      setup() {},
    },
    { key: "slow" },
  );
  await Promise.resolve();
  g.stop();
  await assert.rejects(loading);
  complete({});
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(released, 1);
  assert.equal(g.scenes.length, 1);
  g.dispose();
});
