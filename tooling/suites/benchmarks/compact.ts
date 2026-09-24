import {
    appendFileSync,
    lstatSync,
    readdirSync,
    readFileSync,
    rmdirSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";

/** Compact only an explicitly supplied legacy projection, never a v1 evidence tree. */
export function compactRun(
    directory: string,
    resultsScript: string,
    removeFile = unlinkSync,
): void {
    const root = resolve(directory);
    const plain = (path: string) => {
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) throw Error(`Compaction refuses links or junctions: ${path}`);
        return stat;
    };
    const ancestors = (path: string) => {
        for (;;) {
            plain(path);
            const parent = dirname(path);
            if (parent === path) break;
            path = parent;
        }
    };
    ancestors(root);
    const keep = new Set(["manifest.json", "analysis.json", "summary.md"]);
    const files: string[] = [],
        directories: string[] = [];
    const visit = (directory: string) => {
        for (const name of readdirSync(directory)) {
            const path = resolve(directory, name),
                rel = relative(root, path);
            if (rel.startsWith(`..${sep}`) || rel === ".." || !rel)
                throw Error("Compaction target escaped run directory");
            if (plain(path).isDirectory()) {
                visit(path);
                directories.push(path);
            } else if (directory !== root || !keep.has(name)) files.push(path);
        }
    };
    visit(root);
    for (const name of keep) {
        const stat = plain(join(root, name));
        if (!stat.isFile() || !stat.size) throw Error(`Missing retained file: ${name}`);
    }
    const manifestPath = join(root, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (
        manifest.format ||
        manifest.status !== "passed" ||
        manifest.fatalError ||
        !Array.isArray(manifest.stages) ||
        manifest.stages.some((s: { status: string }) => s.status !== "passed")
    )
        throw Error("Failed, incomplete or non-legacy run: diagnostics retained");
    if (resolve(manifest.outputDirectory) !== root)
        throw Error("Run directory does not match its manifest");
    execFileSync(process.execPath, [resultsScript, "validate", root], {
        stdio: "pipe",
        windowsHide: true,
    });
    const removed: string[] = [];
    manifest.retention = {
        mode: "compacting",
        removedArtifacts: removed,
        rawEvidenceAvailable: true,
    };
    const save = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    save();
    try {
        for (const path of files) {
            ancestors(path);
            removeFile(path);
            removed.push(relative(root, path).split(sep).join("/"));
        }
        for (const path of directories) {
            ancestors(path);
            rmdirSync(path);
        }
        manifest.retention.mode = "compact";
        manifest.retention.rawEvidenceAvailable = false;
        appendFileSync(
            join(root, "summary.md"),
            "\nOutput: compact; raw artifacts removed. Comparisons use analysis.json.\n",
        );
    } catch (error) {
        manifest.retention.mode = "failed";
        manifest.retention.rawEvidenceAvailable = removed.length === 0;
        manifest.retention.error = String(error);
        throw error;
    } finally {
        save();
    }
}
