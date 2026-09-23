import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export interface Surface {
    id: string;
    kind: string;
    path: string;
    label: string;
}
export interface Mapping {
    id: string;
    owner: string;
    destination: string;
    action: string;
    reason: string;
}
export interface Retirement {
    id: string;
    decision: string;
    gate: string;
    proof: { path: string; sha256: string } | null;
    remainingUsers: string[];
}
interface Header {
    format: string;
    documentType: string;
    schemaVersion: number;
    runId: string;
}
export interface Inventory extends Header {
    baseline: { revision: string; workflows: { path: string; sha256: string }[] };
    frozen: Surface[];
    surfaces: Surface[];
    assertions: Surface[];
    frozenAssertions: Surface[];
    workloads: Surface[];
}
export interface Coverage extends Header {
    surfaces: Mapping[];
    assertions: Mapping[];
    workloads: Mapping[];
}
export interface Retirements extends Header {
    rows: Retirement[];
}

export const hash = (value: string | Buffer): string =>
    createHash("sha256").update(value).digest("hex");
const git = (root: string, args: string[]): string =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const inScope = (path: string): boolean =>
    /^(tests|benchmarks|tooling|\.github\/workflows)\//.test(path) ||
    (!path.includes("/") &&
        (/config\.(json|[cm]?[jt]s)$/.test(path) ||
            /^tsconfig.*\.json$/.test(path) ||
            ["package.json", "package-lock.json", ".prettierrc.json", ".gitignore"].includes(
                path,
            )));

/** Includes untracked, nonignored additions so a forgotten git add cannot hide a surface. */
export function repositoryFiles(root: string, revision?: string): Map<string, string> {
    const paths = (
        revision
            ? git(root, ["ls-tree", "-r", "--name-only", "-z", revision])
            : git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    )
        .split("\0")
        .filter(inScope);
    return new Map(
        [...new Set(paths)]
            .sort()
            .filter((path) => revision || existsSync(resolve(root, path)))
            .map((path) => [
                path,
                /\.(gz|png|jpg|wav|mp3|woff2?)$/.test(path)
                    ? "[binary]"
                    : revision
                      ? git(root, ["show", `${revision}:${path}`])
                      : readFileSync(resolve(root, path), "utf8"),
            ]),
    );
}

/** CI lines are conservative surfaces: nested steps, conditions, env and multiline scripts all count. */
export function discover(files: ReadonlyMap<string, string>): {
    surfaces: Surface[];
    assertions: Surface[];
} {
    const surfaces: Surface[] = [],
        assertions: Surface[] = [];
    for (const [path, source] of files) {
        surfaces.push({ id: `file:${path}`, kind: "file", path, label: path });
        if (path === "tests/fixtures/town-dungeon.json") {
            for (const [name, digest] of Object.entries(record(record(JSON.parse(source)).files))) {
                if (!safeRelative(name)) throw Error(`Unsafe archived consumer path: ${name}`);
                surfaces.push({
                    id: `consumer-snapshot:${path}:${name}`,
                    kind: "consumer-snapshot",
                    path,
                    label: `${name} SHA256 ${string(digest)}`,
                });
            }
        }
        if (path === "package.json") {
            const scripts = record(record(JSON.parse(source)).scripts);
            for (const [name, command] of Object.entries(scripts))
                surfaces.push({
                    id: `command:${name}`,
                    kind: "command",
                    path,
                    label: string(command),
                });
        }
        if (path.startsWith(".github/workflows/")) {
            const seen = new Map<string, number>();
            for (const line of source
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line && !line.startsWith("#"))) {
                const digest = hash(line).slice(0, 16),
                    occurrence = (seen.get(digest) ?? 0) + 1;
                seen.set(digest, occurrence);
                surfaces.push({
                    id: `ci:${path}:${digest}:${occurrence}`,
                    kind: "ci",
                    path,
                    label: line,
                });
            }
        }
        if (!/\.[cm]?[jt]s$|\.ps1$/.test(path)) continue;
        const options = new Set([
            ...Array.from(
                source.matchAll(/\b(?:NGNE_[A-Z0-9_]+|CHROME_BIN|GITHUB_STEP_SUMMARY)\b/g),
                (m) => m[0],
            ),
            ...Array.from(source.matchAll(/["'`](-{1,2}[a-zA-Z][a-zA-Z0-9-]*)\b/g), (m) => m[1]),
        ]);
        if (path.endsWith(".ps1")) {
            const parameters = source.slice(0, source.indexOf("Set-StrictMode"));
            for (const m of parameters.matchAll(/\[(?:string|int|switch)\]\$(\w+)/g))
                options.add(`-${m[1]}`);
        }
        for (const option of [...options].sort())
            surfaces.push({ id: `option:${path}:${option}`, kind: "option", path, label: option });
        if (path.endsWith(".ps1")) continue;
        const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
        const seen = new Set<string>();
        const visit = (node: ts.Node): void => {
            if (ts.isCallExpression(node)) {
                const callee = node.expression.getText(ast);
                const selected = path.endsWith(".test.ts")
                    ? /^(test|it)(\.(skip|todo))?$/.test(callee)
                    : /^(check|verify|assert)(\.[A-Za-z]+)?$/.test(callee) ||
                      callee === "passed.push";
                if (selected) {
                    const literals = node.arguments.filter(
                        (arg) => ts.isStringLiteralLike(arg) || ts.isTemplateExpression(arg),
                    );
                    const label =
                        (path.endsWith(".test.ts") ? literals[0] : literals.at(-1))?.getText(ast) ??
                        node.getText(ast);
                    const normalized = label.replace(/\s+/g, " ");
                    const id = `assertion:${path}:${hash(normalized).slice(0, 16)}`;
                    // A loop or repeated label is one scenario, not an invented runtime assertion count.
                    if (!seen.has(id))
                        assertions.push({ id, kind: "assertion", path, label: normalized });
                    seen.add(id);
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(ast);
    }
    const sort = (a: Surface, b: Surface) => a.id.localeCompare(b.id, "en");
    return { surfaces: surfaces.sort(sort), assertions: assertions.sort(sort) };
}

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Expected object");
    return value as Record<string, unknown>;
}
function string(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) throw Error("Expected nonempty string");
    return value;
}
function array<T>(value: unknown, parse: (value: unknown) => T): T[] {
    if (!Array.isArray(value)) throw Error("Expected array");
    return value.map(parse);
}
function header(value: Record<string, unknown>, type: string): Header {
    if (value.format !== "ngne-tooling" || value.schemaVersion !== 1 || value.documentType !== type)
        throw Error(`Unsupported migration document; expected ${type} v1`);
    return {
        format: value.format,
        schemaVersion: value.schemaVersion,
        documentType: type,
        runId: string(value.runId),
    };
}
function surface(value: unknown): Surface {
    const v = record(value);
    return { id: string(v.id), kind: string(v.kind), path: string(v.path), label: string(v.label) };
}
function mapping(value: unknown): Mapping {
    const v = record(value);
    return {
        id: string(v.id),
        owner: string(v.owner),
        destination: string(v.destination),
        action: string(v.action),
        reason: string(v.reason),
    };
}
export function parseInventory(value: unknown): Inventory {
    const v = record(value),
        baseline = record(v.baseline);
    return {
        ...header(v, "migration-inventory"),
        baseline: {
            revision: string(baseline.revision),
            workflows: array(baseline.workflows, (value) => {
                const item = record(value);
                return { path: string(item.path), sha256: string(item.sha256) };
            }),
        },
        frozen: array(v.frozen, surface),
        surfaces: array(v.surfaces, surface),
        assertions: array(v.assertions, surface),
        frozenAssertions: array(v.frozenAssertions, surface),
        workloads: array(v.workloads, surface),
    };
}
export function parseCoverage(value: unknown): Coverage {
    const v = record(value);
    return {
        ...header(v, "migration-coverage"),
        surfaces: array(v.surfaces, mapping),
        assertions: array(v.assertions, mapping),
        workloads: array(v.workloads, mapping),
    };
}
export function parseRetirements(value: unknown): Retirements {
    const v = record(value);
    return {
        ...header(v, "migration-retirement"),
        rows: array(v.rows, (value) => {
            const row = record(value),
                proof = row.proof === null ? null : record(row.proof);
            return {
                id: string(row.id),
                decision: string(row.decision),
                gate: string(row.gate),
                proof: proof && { path: string(proof.path), sha256: string(proof.sha256) },
                remainingUsers: array(row.remainingUsers, string),
            };
        }),
    };
}
function unique<T extends { id: string }>(rows: T[], label: string): Map<string, T> {
    const result = new Map<string, T>();
    for (const row of rows) {
        if (result.has(row.id)) throw Error(`Duplicate ${label}: ${row.id}`);
        result.set(row.id, row);
    }
    return result;
}
function equalIds(actual: Iterable<string>, expected: Iterable<string>, label: string): void {
    const a = new Set(actual),
        b = new Set(expected);
    const missing = [...b].filter((id) => !a.has(id)),
        extra = [...a].filter((id) => !b.has(id));
    if (missing.length || extra.length)
        throw Error(`${label}: missing [${missing.join(", ")}]; extra [${extra.join(", ")}]`);
}
function safeRelative(path: string): boolean {
    return (
        !!path &&
        !isAbsolute(path) &&
        !path.includes("\\") &&
        !path.includes(":") &&
        !path.split("/").some((part) => !part || part === "." || part === "..")
    );
}
function validateMapping(row: Mapping): void {
    const roots: Record<string, string[]> = {
        engine: ["tests/", "tooling/fixtures/installed-engine/", "tooling/suites/verification/"],
        consumer: ["consumer:"],
        infrastructure: [
            "tooling/",
            ".github/",
            "package.json",
            "package-lock.json",
            "tsconfig",
            "vite.config",
            ".prettier",
            ".gitignore",
        ],
        benchmark: [
            "tooling/suites/benchmarks/",
            "tooling/fixtures/rendering/",
            "tooling/profiles/",
        ],
        showcase: ["demo/", "examples/", "tests/"],
        historical: ["docs/evidence/"],
    };
    if (!roots[row.owner]?.some((prefix) => row.destination.startsWith(prefix)))
        throw Error(`Invalid owner/destination: ${row.id}`);
    const destination = row.destination.replace(/^consumer:/, "");
    if (!safeRelative(destination)) throw Error(`Unsafe destination: ${row.id}`);
    if (!["retain", "migrate", "remove", "exclude"].includes(row.action))
        throw Error(`Invalid action: ${row.id}`);
    if (row.action === "exclude" && row.owner !== "historical")
        throw Error(`Only historical evidence may be excluded: ${row.id}`);
    if (!row.reason.trim()) throw Error(`Missing classification reason: ${row.id}`);
}

/** Missing proof is allowed while sources remain; deletion is fail-closed. No files are deleted here. */
export function validate(
    root: string,
    inventory: Inventory,
    coverage: Coverage,
    retirements: Retirements,
    discovered = discover(repositoryFiles(root)),
): { discovered: number; mapped: number; excluded: number; blocked: number } {
    if (new Set([inventory.runId, coverage.runId, retirements.runId]).size !== 1)
        throw Error("Planning run IDs differ");
    const current = unique(inventory.surfaces, "surface"),
        currentAssertions = unique(inventory.assertions, "assertion");
    for (const [label, actual, recorded] of [
        ["surface inventory", discovered.surfaces, inventory.surfaces],
        ["assertion inventory", discovered.assertions, inventory.assertions],
    ] as const) {
        equalIds(
            actual.map((row) => row.id),
            recorded.map((row) => row.id),
            label,
        );
        const byId = unique(recorded, label);
        for (const row of actual)
            if (JSON.stringify(row) !== JSON.stringify(byId.get(row.id)))
                throw Error(`Changed ${label}: ${row.id}`);
    }
    const all = new Map([
        ...unique(inventory.frozen, "frozen surface"),
        ...current,
        ...unique(inventory.frozenAssertions, "frozen assertion"),
        ...currentAssertions,
        ...unique(inventory.workloads, "workload"),
    ]);
    const mappings = unique(
        [...coverage.surfaces, ...coverage.assertions, ...coverage.workloads],
        "mapping",
    );
    for (const [rows, expected, label] of [
        [coverage.surfaces, [...inventory.frozen, ...inventory.surfaces], "surface coverage"],
        [
            coverage.assertions,
            [...inventory.frozenAssertions, ...inventory.assertions],
            "assertion coverage",
        ],
        [coverage.workloads, inventory.workloads, "workload coverage"],
    ] as const)
        equalIds(
            rows.map((row) => row.id),
            expected.map((row) => row.id),
            label,
        );
    for (const row of mappings.values()) validateMapping(row);
    for (const row of all.values())
        if (!safeRelative(row.path)) throw Error(`Unsafe source path: ${row.id}`);
    const retirement = unique(retirements.rows, "retirement");
    equalIds(
        retirement.keys(),
        [...mappings.values()]
            .filter((row) => ["migrate", "remove"].includes(row.action))
            .map((row) => row.id),
        "retirement coverage",
    );
    const present = new Set([
        ...current.keys(),
        ...currentAssertions.keys(),
        ...inventory.workloads
            .filter((row) => existsSync(resolve(root, row.path)))
            .map((row) => row.id),
    ]);
    let blocked = 0;
    for (const row of retirement.values()) {
        if (!["blocked", "approved"].includes(row.decision) || !row.gate.trim())
            throw Error(`Invalid retirement gate: ${row.id}`);
        if (row.decision === "blocked") blocked++;
        if (row.decision === "approved") {
            if (!row.proof || row.remainingUsers.length)
                throw Error(`Retirement needs proof and zero remaining users: ${row.id}`);
            if (!safeRelative(row.proof.path) || !/^[a-f0-9]{64}$/.test(row.proof.sha256))
                throw Error(`Invalid proof: ${row.id}`);
            const proof = realpathSync(resolve(root, row.proof.path)),
                rel = relative(realpathSync(root), proof);
            if (
                isAbsolute(rel) ||
                rel === ".." ||
                rel.startsWith(`..${sep}`) ||
                hash(readFileSync(proof)) !== row.proof.sha256
            )
                throw Error(`Proof escaped or changed: ${row.id}`);
            const attestation = record(JSON.parse(readFileSync(proof, "utf8")));
            header(attestation, "migration-replacement-proof");
            if (
                attestation.status !== "passed" ||
                !array(attestation.coverageIds, string).includes(row.id) ||
                attestation.destination !== mappings.get(row.id)?.destination
            )
                throw Error(`Proof does not establish replacement: ${row.id}`);
            string(attestation.reviewedBy);
            string(attestation.evidence);
        }
        if (!present.has(row.id) && row.decision !== "approved")
            throw Error(`Deletion blocked; replacement proof unknown: ${row.id}`);
    }
    for (const row of mappings.values())
        if (!present.has(row.id) && !retirement.has(row.id))
            throw Error(`Retained/excluded surface disappeared: ${row.id}`);
    return {
        discovered: current.size,
        mapped: coverage.surfaces.length,
        excluded: coverage.surfaces.filter((row) => row.action === "exclude").length,
        blocked,
    };
}

export function verifyBaseline(root: string, inventory: Inventory): void {
    if (!/^[a-f0-9]{40}$/.test(inventory.baseline.revision))
        throw Error("Baseline requires full revision");
    const files = repositoryFiles(root, inventory.baseline.revision),
        frozen = discover(files);
    for (const [actual, expected, label] of [
        [frozen.surfaces, inventory.frozen, "frozen surfaces"],
        [frozen.assertions, inventory.frozenAssertions, "frozen assertions"],
    ] as const) {
        unique(expected, label);
        if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error(`Changed ${label}`);
    }
    const workflows = [...files.keys()].filter((path) => path.startsWith(".github/workflows/"));
    equalIds(
        inventory.baseline.workflows.map((row) => row.path),
        workflows,
        "frozen workflows",
    );
    if (new Set(inventory.baseline.workflows.map((row) => row.path)).size !== workflows.length)
        throw Error("Duplicate frozen workflow");
    for (const workflow of inventory.baseline.workflows) {
        const bytes = execFileSync(
            "git",
            ["show", `${inventory.baseline.revision}:${workflow.path}`],
            { cwd: root },
        );
        if (hash(bytes) !== workflow.sha256)
            throw Error(`Frozen workflow hash mismatch: ${workflow.path}`);
    }
}

export function renderCoverage(inventory: Inventory, coverage: Coverage): string {
    const sources = new Map(
        [
            ...inventory.frozen,
            ...inventory.surfaces,
            ...inventory.frozenAssertions,
            ...inventory.assertions,
            ...inventory.workloads,
        ].map((row) => [row.id, row]),
    );
    const escape = (text: string) =>
        text
            .replaceAll("&", "&amp;")
            .replaceAll("\\", "&#92;")
            .replaceAll("|", "&#124;")
            .replaceAll("*", "&#42;")
            .replaceAll("_", "&#95;")
            .replaceAll("`", "&#96;")
            .replaceAll("[", "&#91;")
            .replaceAll("]", "&#93;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll("\n", " ");
    const lines = [
        "# Coverage ownership",
        "",
        "Generated from coverage-map.json and surface-inventory.json. IDs describe source scenarios, not runtime assertion counts. Replacement proof is tracked separately in retirement-map.json.",
        "",
    ];
    for (const [title, rows] of [
        ["Surfaces", coverage.surfaces],
        ["Assertions and test scenarios", coverage.assertions],
        ["Workloads", coverage.workloads],
    ] as const) {
        lines.push(
            `## ${title}`,
            "",
            "| ID | Source / scenario | Owner | Destination | Action | Reason |",
            "| --- | --- | --- | --- | --- | --- |",
        );
        for (const row of rows)
            lines.push(
                `| ${[row.id, sources.get(row.id)?.label ?? "MISSING", row.owner, row.destination, row.action, row.reason].map(escape).join(" | ")} |`,
            );
        lines.push("");
    }
    return lines.join("\n");
}

export function check(root: string): ReturnType<typeof validate> {
    const read = (name: string): unknown =>
        JSON.parse(readFileSync(resolve(root, "plans/tooling", name), "utf8"));
    const inventory = parseInventory(read("surface-inventory.json")),
        coverage = parseCoverage(read("coverage-map.json")),
        retirement = parseRetirements(read("retirement-map.json"));
    verifyBaseline(root, inventory);
    const result = validate(root, inventory, coverage, retirement);
    // Formatting is checked separately; ignore Markdown padding inserted by Prettier.
    const normalize = (text: string) =>
        text
            .replace(/\r/g, "")
            .split("\n")
            .map((line) =>
                line
                    .replace(/ +/g, " ")
                    .replace(/\| :?-+:? /g, "| --- ")
                    .trim(),
            )
            .join("\n")
            .trim();
    if (
        normalize(readFileSync(resolve(root, "plans/tooling/coverage-map.md"), "utf8")) !==
        normalize(renderCoverage(inventory, coverage))
    )
        throw Error("Rendered coverage table is stale");
    return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        if (process.argv.length !== 2)
            throw Error("Usage: npm run check:migration (from repository root)");
        console.log(JSON.stringify(check(process.cwd())));
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
