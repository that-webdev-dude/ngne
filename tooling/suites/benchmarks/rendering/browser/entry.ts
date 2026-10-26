import { startRendererBenchmark } from "../renderer-fixture.js";
import { startOrderInvestigation } from "../order-fixture.js";
import { startTextureUpdateBenchmark } from "../texture-update-fixture.js";

const workload = new URLSearchParams(location.search).get("workload");

void start().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    document.body.dataset.rendererBenchmarkError = message;
    const output = document.getElementById("results");
    if (output) output.textContent = message;
    console.error(error);
});

async function start(): Promise<void> {
    if (workload === "texture-updates") return startTextureUpdateBenchmark();
    if (workload === "chaos") throw new Error("Starfall Chaos replay is retired");
    if (workload === "ordering") return startOrderInvestigation();
    if (workload !== "renderer-webgpu")
        throw new Error(`Unknown browser benchmark workload: ${workload ?? "none"}`);
    await startRendererBenchmark("webgpu");
}
