/** Boundary timers only: keep every validation, sort, allocation, gathering and upload statement intact. */
export function instrumentPreparation(source: string, diagnosticsModule: string): string {
    if (source.includes("diagnosticStart"))
        throw new Error("Diagnostic anchor changed: already instrumented");
    let code = source.replaceAll("\r\n", "\n");
    const insert = (anchor: string, replacement: string) => {
        if (code.split(anchor).length !== 2)
            throw new Error(`Diagnostic anchor changed: ${anchor}`);
        code = code.replace(anchor, replacement);
    };
    insert(
        "prepare(frame: Frame): void {",
        // Upload is timed in encode; reset here so a frame without an upload records 0.
        "prepare(frame: Frame): void {\n                const diagnosticStart = performance.now();\n                preparationStages.upload = 0;",
    );
    insert(
        "                frame.sort();",
        `                preparationStages.validation = performance.now() - diagnosticStart;
                const diagnosticSort = performance.now();
                frame.sort();
                preparationStages.sort = performance.now() - diagnosticSort;
                const diagnosticGrowth = performance.now();`,
    );
    insert(
        "                for (let target = 0; target < count; target++) {",
        `                preparationStages.growth = performance.now() - diagnosticGrowth;
                const diagnosticGather = performance.now();
                for (let target = 0; target < count; target++) {`,
    );
    insert(
        "            },\n            encode(",
        `                preparationStages.gather = performance.now() - diagnosticGather;
            },
            encode(`,
    );
    insert(
        "                    device.queue.writeBuffer(instances, 0, upload, 0, frame.count * QUAD_STRIDE);",
        `                    const diagnosticUpload = performance.now();
                    device.queue.writeBuffer(instances, 0, upload, 0, frame.count * QUAD_STRIDE);
                    preparationStages.upload = performance.now() - diagnosticUpload;`,
    );
    return `import { preparationStages } from ${JSON.stringify(diagnosticsModule)};\npreparationStages.instrumented = true;\n${code}`;
}
