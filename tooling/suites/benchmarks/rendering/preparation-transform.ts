/** Boundary timers only: keep every validation, sort, allocation and gathering statement intact. */
export function instrumentPreparation(source: string, diagnosticsModule: string): string {
    if (source.includes("diagnosticStart"))
        throw Error("Diagnostic anchor changed: already instrumented");
    let code = source.replaceAll("\r\n", "\n");
    const insert = (anchor: string, replacement: string) => {
        if (code.split(anchor).length !== 2) throw Error(`Diagnostic anchor changed: ${anchor}`);
        code = code.replace(anchor, replacement);
    };
    insert(
        "prepare(frame: Frame): void {",
        "prepare(frame: Frame): void {\n                const diagnosticStart = performance.now();",
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
    return `import { preparationStages } from ${JSON.stringify(diagnosticsModule)};\npreparationStages.instrumented = true;\n${code}`;
}
