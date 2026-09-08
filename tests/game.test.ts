import { test } from "node:test";
import assert from "node:assert/strict";
import { Game, Frame, emptyInput } from "../src/index.js";
import { arena, type Progress, type ProgressCommand } from "../demo/game.js";
const create = () =>
  new Game<Progress, ProgressCommand>({
    seed: "test",
    state: { best: 0, lastScore: 0, runs: 0, victories: 0 },
    transition: (s, c) => ({
      ...s,
      best: Math.max(s.best, c.score),
      lastScore: c.score,
      runs: s.runs + 1,
      victories: s.victories + (c.won ? 1 : 0),
    }),
  });
test("showcase runs deterministically with churn and rendered sprites", async () => {
  const a = create(),
    b = create();
  for (const g of [a, b])
    await g.start(await g.prepare(arena({ attract: true }), { key: "test" }));
  for (let i = 0; i < 600; i++) {
    a.tick();
    b.tick();
  }
  assert.equal(JSON.stringify(a.enumerate()), JSON.stringify(b.enumerate()));
  const frame = new Frame();
  a.render(frame, 0.5);
  assert.ok(frame.count > 200);
  assert.ok(a.scenes[0].entityCapacity < 2000);
  a.dispose();
  b.dispose();
});
test("chaos survives a full run, commits victory and high score, uses bounded live storage", async () => {
  const g = create();
  await g.start(await g.prepare(arena({ stress: true }), { key: "chaos" }));
  for (let i = 0; i < 11000; i++) g.tick(emptyInput());
  assert.equal(g.state.runs, 1);
  assert.equal(g.state.victories, 1);
  assert.ok(g.state.best > 0);
  assert.ok(g.scenes[0].entityCapacity < 20000);
  g.dispose();
});
