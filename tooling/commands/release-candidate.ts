import { assembleCandidate, bindCandidate } from "../core/release-candidate.ts";

try {
    const [mode, ...args] = process.argv.slice(2);
    if (args.length) throw Error("Usage: release-candidate.ts bind | assemble");
    if (mode === "bind") bindCandidate(process.cwd());
    else if (mode === "assemble") assembleCandidate(process.cwd());
    else throw Error("Usage: release-candidate.ts bind | assemble");
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
