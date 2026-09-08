import {
  Renderer,
  Frame,
  Camera,
  BrowserGame,
  type FrameScheduler,
} from "../src/index.js";
const results: string[] = [];
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
  results.push("PASS " + message);
  document.getElementById("results")!.textContent = results.join("\n");
};
async function main() {
  const canvas = document.getElementById("synthetic") as HTMLCanvasElement;
  const renderer = new Renderer(canvas, 64, 64),
    frame = new Frame(),
    camera = new Camera();
  const gl = canvas.getContext("webgl2")!;
  const pixel = () => {
    const bytes = new Uint8Array(4);
    gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    return [...bytes];
  };
  frame.scene(camera, 1);
  frame.rect(32, 32, 64, 64, 0xff0000, 1, 5);
  frame.rect(32, 32, 32, 32, 0x00ff00, 1, 1);
  renderer.render(frame);
  check(pixel()[0] === 255, "layer order is independent of submission order");
  frame.scene(camera, 1);
  frame.rect(32, 32, 16, 16, 0x0000ff, 1, -100);
  renderer.render(frame);
  check(pixel()[2] === 255, "scene order takes precedence over local layers");
  frame.rect(32, 32, 8, 8, 0xffffff, 0.5, 0);
  renderer.render(frame);
  const blended = pixel();
  check(
    blended[0] >= 127 && blended[0] <= 128 && blended[2] === 255,
    "source alpha compositing",
  );
  const atlas = document.createElement("canvas");
  atlas.width = atlas.height = 2;
  const ctx = atlas.getContext("2d")!;
  ctx.fillStyle = "#00ff00";
  ctx.fillRect(0, 0, 2, 2);
  renderer.texture("test", atlas);
  frame.reset();
  frame.scene(camera, 1);
  frame.sprite({ x: 32, y: 32, width: 64, height: 64, texture: "test" });
  renderer.render(frame);
  check(pixel()[1] === 255, "decoded texture upload and UV sampling");
  frame.reset();
  frame.scene(camera, 1);
  for (let i = 0; i < 10000; i++)
    frame.rect(i % 64, Math.floor(i / 64) % 64, 1, 1, 0xffb276);
  renderer.render(frame);
  check(
    renderer.sprites === 10000 && renderer.drawCalls === 1,
    "10,000 synthetic sprites use one instanced draw",
  );
  check(gl.getError() === gl.NO_ERROR, "no WebGL error after buffer growth");
  const extension = gl.getExtension("WEBGL_lose_context");
  if (extension) {
    const lost = new Promise<void>((resolve) =>
      canvas.addEventListener("webglcontextlost", () => resolve(), {
        once: true,
      }),
    );
    extension.loseContext();
    await lost;
    renderer.render(frame);
    check(renderer.drawCalls === 0, "context loss safely skips GPU submission");
    await new Promise((r) => setTimeout(r, 100));
    const restored = new Promise<void>((resolve) =>
      canvas.addEventListener("webglcontextrestored", () => resolve(), {
        once: true,
      }),
    );
    extension.restoreContext();
    await restored;
    frame.reset();
    frame.scene(camera, 1);
    frame.sprite({ x: 32, y: 32, width: 64, height: 64, texture: "test" });
    renderer.render(frame);
    check(
      pixel()[1] === 255,
      "context restoration rebuilds pipelines and textures",
    );
  } else results.push("SKIP context loss extension unavailable");
  renderer.dispose();
  const surface = document.createElement("canvas");
  let callback: FrameRequestCallback = () => {};
  let cancelled = 0;
  const scheduler: FrameScheduler = {
    request: (fn) => {
      callback = fn;
      return 1;
    },
    cancel: () => {
      cancelled++;
    },
  };
  const app = new BrowserGame({
    canvas: surface,
    seed: 1,
    state: {},
    transition: (s) => s,
    scheduler,
  });
  let updates = 0;
  const candidate = await app.game.prepare(
    {
      id: "test",
      setup(s) {
        s.system(() => updates++);
      },
    },
    { key: "test" },
  );
  await app.start(candidate);
  callback(100);
  callback(117);
  check(updates === 1, "browser host drives fixed simulation");
  const mounted = app.game.scenes[0];
  await app.stop();
  callback(10000);
  check(updates === 1, "late callbacks after stop do no work");
  await app.start();
  callback(20000);
  callback(20017);
  check(
    updates === 2 && app.game.scenes[0] === mounted,
    "resume preserves scene and resets wall-clock accumulator",
  );
  await app.dispose();
  check(
    app.game.lifecycle === "Disposed" && cancelled >= 2,
    "browser teardown completes",
  );
  document.getElementById("results")!.textContent =
    results.join("\n") + "\n\nALL CHECKS PASSED";
}
main().catch((error) => {
  document.getElementById("results")!.textContent =
    results.join("\n") + "\nFAIL " + error.stack;
  console.error(error);
});
