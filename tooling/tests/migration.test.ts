import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
    discover,
    hash,
    parseCoverage,
    parseInventory,
    parseRetirements,
    renderCoverage,
    repositoryFiles,
    validate,
    verifyBaseline,
    type Coverage,
    type Inventory,
    type Retirements,
    type Surface,
} from "../commands/check-migration.js";

const header = (documentType: string) => ({
    format: "ngne-tooling",
    schemaVersion: 1,
    documentType,
    runId: "migration-test",
});
function fixture() {
    const files = new Map([
        ["tests/engine.test.ts", 'test("engine contract", () => {});'],
        ["benchmarks/old.mjs", 'assert(true, "measurement valid");'],
        ["package.json", JSON.stringify({ scripts: { test: "tsx --test tests/*.test.ts" } })],
        [".github/workflows/ci.yml", "jobs:\n  verify:\n    steps:\n      - run: npm test\n"],
    ]);
    const found = discover(files);
    const inventory: Inventory = {
        ...header("migration-inventory"),
        baseline: { revision: "a".repeat(40), workflows: [] },
        frozen: structuredClone(found.surfaces),
        surfaces: found.surfaces,
        frozenAssertions: structuredClone(found.assertions),
        assertions: found.assertions,
        workloads: [],
    };
    const map = (row: Surface) => ({
        id: row.id,
        owner: "infrastructure",
        destination: "tooling/commands/verify.ts",
        action: "migrate",
        reason: "Preserve behavior under shared tooling",
    });
    const coverage: Coverage = {
        ...header("migration-coverage"),
        surfaces: found.surfaces.map(map),
        assertions: found.assertions.map(map),
        workloads: [],
    };
    const retirements: Retirements = {
        ...header("migration-retirement"),
        rows: [...coverage.surfaces, ...coverage.assertions].map((row) => ({
            id: row.id,
            decision: "blocked",
            gate: "Replacement must pass before deletion",
            proof: null,
            remainingUsers: ["existing runner"],
        })),
    };
    return { files, inventory, coverage, retirements };
}
const run = (f: ReturnType<typeof fixture>, root = process.cwd()) =>
    validate(root, f.inventory, f.coverage, f.retirements, discover(f.files));

test("Git discovery detects untracked additions and deleted tracked files; frozen history detects tampering", () => {
    const root = mkdtempSync(join(tmpdir(), "ngne-inventory-"));
    const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    try {
        mkdirSync(join(root, "tests"));
        mkdirSync(join(root, ".github/workflows"), { recursive: true });
        writeFileSync(
            join(root, "package.json"),
            JSON.stringify({ scripts: { test: "node --test" } }),
        );
        writeFileSync(join(root, "tests/old.test.ts"), 'test("frozen", () => {});');
        writeFileSync(
            join(root, ".github/workflows/ci.yml"),
            "jobs:\n  check:\n    steps:\n      - run: npm test\n",
        );
        writeFileSync(join(root, ".gitignore"), "tests/ignored.ts\n");
        git("init", "--quiet");
        git("-c", "core.autocrlf=false", "add", ".");
        git(
            "-c",
            "user.name=Migration fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--quiet",
            "-m",
            "Fixture baseline",
        );
        const revision = git("rev-parse", "HEAD"),
            frozen = discover(repositoryFiles(root, revision));
        const f = fixture();
        f.inventory.baseline = {
            revision,
            workflows: [
                {
                    path: ".github/workflows/ci.yml",
                    sha256: hash(
                        execFileSync("git", ["show", `${revision}:.github/workflows/ci.yml`], {
                            cwd: root,
                        }),
                    ),
                },
            ],
        };
        f.inventory.frozen = frozen.surfaces;
        f.inventory.frozenAssertions = frozen.assertions;
        verifyBaseline(root, f.inventory);
        writeFileSync(join(root, "tests/new.ts"), "export {};");
        writeFileSync(join(root, "tests/ignored.ts"), "export {};");
        rmSync(join(root, "tests/old.test.ts"));
        const files = repositoryFiles(root);
        assert(files.has("tests/new.ts"));
        assert(!files.has("tests/old.test.ts"));
        assert(!files.has("tests/ignored.ts"));
        verifyBaseline(root, f.inventory);
        f.inventory.baseline.workflows[0].sha256 = "0".repeat(64);
        assert.throws(() => verifyBaseline(root, f.inventory), /workflow hash mismatch/);
        f.inventory.frozen.pop();
        assert.throws(() => verifyBaseline(root, f.inventory), /Changed frozen surfaces/);
    } finally {
        assert(relativeToTemporaryDirectory(root));
        rmSync(root, { recursive: true, force: true });
    }
});

function relativeToTemporaryDirectory(path: string): boolean {
    return (
        resolve(path).startsWith(resolve(tmpdir()) + "\\") ||
        resolve(path).startsWith(resolve(tmpdir()) + "/")
    );
}

test("initial ownership completes while unknown replacement evidence blocks retirement", () => {
    const f = fixture(),
        result = run(f);
    assert.equal(result.discovered, f.inventory.surfaces.length);
    assert.equal(result.mapped, f.coverage.surfaces.length);
    assert.equal(result.blocked, f.retirements.rows.length);
});

test("unmapped file, npm command and CI step each fail independently", () => {
    for (const addition of ["file", "command", "ci"]) {
        const f = fixture();
        if (addition === "file") f.files.set("tests/new.test.ts", 'test("new", () => {});');
        if (addition === "command")
            f.files.set(
                "package.json",
                JSON.stringify({
                    scripts: { test: "tsx --test tests/*.test.ts", surprise: "node surprise.mjs" },
                }),
            );
        if (addition === "ci")
            f.files.set(
                ".github/workflows/ci.yml",
                f.files.get(".github/workflows/ci.yml") + "      - run: npm run surprise\n",
            );
        assert.throws(() => run(f), /surface inventory/, addition);
    }
});

test("recording a discovered surface without ownership still fails", () => {
    const f = fixture();
    f.files.set("tests/new.ts", "export {};");
    f.inventory.surfaces = discover(f.files).surfaces;
    assert.throws(() => run(f), /surface coverage/);
});

test("command changes and new options cannot hide behind unchanged paths", () => {
    const f = fixture();
    f.files.set("package.json", JSON.stringify({ scripts: { test: "echo skipped" } }));
    assert.throws(() => run(f), /Changed surface inventory/);
    const g = fixture();
    g.files.set(
        "benchmarks/old.mjs",
        'assert(true, "measurement valid"); process.env.NGNE_NEW_OPTION;',
    );
    assert.throws(() => run(g), /surface inventory/);
});

test("assertion edits are checked separately from path coverage", () => {
    const f = fixture();
    f.files.set("tests/engine.test.ts", 'test("different contract", () => {});');
    assert.throws(() => run(f), /assertion inventory/);
});

test("duplicate, missing and extra mapping rows fail exact equality", () => {
    for (const mutation of ["duplicate", "missing", "extra"]) {
        const f = fixture();
        if (mutation === "duplicate") f.coverage.surfaces.push({ ...f.coverage.surfaces[0] });
        if (mutation === "missing") f.coverage.surfaces.pop();
        if (mutation === "extra")
            f.coverage.surfaces.push({ ...f.coverage.surfaces[0], id: "file:invented.ts" });
        assert.throws(() => run(f), /Duplicate|surface coverage/);
    }
});

test("invalid owners, destinations, exclusion reasons and actions fail", () => {
    for (const mutation of ["owner", "destination", "escape", "action", "exclusion", "reason"]) {
        const f = fixture(),
            row = f.coverage.surfaces[0];
        if (mutation === "owner") row.owner = "someone";
        if (mutation === "destination") row.destination = "src/testing-api.ts";
        if (mutation === "escape") row.destination = "tooling/../../outside";
        if (mutation === "action") row.action = "skip";
        if (mutation === "exclusion") row.action = "exclude";
        if (mutation === "reason") row.reason = "";
        assert.throws(() => run(f), /Invalid|Unsafe|Only historical|Missing classification/);
    }
});

test("explicit historical exclusions are counted and cannot silently disappear", () => {
    const f = fixture(),
        row = f.coverage.surfaces.find((row) => row.id === "file:benchmarks/old.mjs")!;
    Object.assign(row, {
        owner: "historical",
        action: "exclude",
        destination: "docs/evidence/old.json",
        reason: "Original historical bytes retained",
    });
    f.retirements.rows = f.retirements.rows.filter((r) => r.id !== row.id);
    assert.equal(run(f).excluded, 1);
    f.files.delete("benchmarks/old.mjs");
    const current = discover(f.files);
    f.inventory.surfaces = current.surfaces;
    f.inventory.assertions = current.assertions;
    assert.throws(() => run(f), /Deletion blocked|disappeared/);
});

test("deletion remains blocked after refreshing the current inventory", () => {
    const f = fixture();
    f.files.delete("benchmarks/old.mjs");
    const current = discover(f.files);
    f.inventory.surfaces = current.surfaces;
    f.inventory.assertions = current.assertions;
    assert.throws(() => run(f), /Deletion blocked; replacement proof unknown/);
});

test("retirement approval needs proof, correct identity and no remaining users", () => {
    const root = mkdtempSync(join(tmpdir(), "ngne-migration-"));
    try {
        const f = fixture(),
            row = f.retirements.rows[0];
        row.decision = "approved";
        assert.throws(() => run(f, root), /needs proof/);
        row.remainingUsers = [];
        const proof = JSON.stringify({
            ...header("migration-replacement-proof"),
            status: "passed",
            coverageIds: [row.id],
            destination: f.coverage.surfaces[0].destination,
            reviewedBy: "regression fixture",
            evidence: "fixture result",
        });
        writeFileSync(join(root, "proof.json"), proof);
        row.proof = { path: "proof.json", sha256: hash(proof) };
        run(f, root);
        row.proof.path = "../proof.json";
        assert.throws(() => run(f, root), /Invalid proof/);
        row.proof.path = "proof.json";
        writeFileSync(join(root, "proof.json"), proof + " ");
        assert.throws(() => run(f, root), /Proof escaped or changed/);
    } finally {
        // Only the unique directory created by this test is owned here.
        assert.equal(
            resolve(root).startsWith(resolve(tmpdir()) + "\\") ||
                resolve(root).startsWith(resolve(tmpdir()) + "/"),
            true,
        );
        rmSync(root, { recursive: true, force: true });
    }
});

test("missing and duplicate retirement rows cannot waive gates", () => {
    const f = fixture();
    f.retirements.rows.pop();
    assert.throws(() => run(f), /retirement coverage/);
    const g = fixture();
    g.retirements.rows.push({ ...g.retirements.rows[0] });
    assert.throws(() => run(g), /Duplicate retirement/);
});

test("workload coverage is independent of file and assertion counts", () => {
    const f = fixture();
    f.inventory.workloads.push({
        id: "workload:cpu",
        kind: "workload",
        path: "benchmarks/old.mjs",
        label: "CPU sampling",
    });
    assert.throws(() => run(f), /workload coverage/);
});

test("planning documents reject malformed and unsupported schemas", () => {
    const f = fixture();
    assert.deepEqual(parseInventory(f.inventory), f.inventory);
    assert.deepEqual(parseCoverage(f.coverage), f.coverage);
    assert.deepEqual(parseRetirements(f.retirements), f.retirements);
    assert.throws(() => parseInventory({ ...f.inventory, schemaVersion: 99 }), /Unsupported/);
    assert.throws(() => parseCoverage({ ...f.coverage, surfaces: [{}] }), /nonempty/);
    assert.throws(() => parseRetirements({ ...f.retirements, rows: null }), /array/);
    f.coverage.runId = "another-run";
    assert.throws(() => run(f), /run IDs differ/);
});

test("CI discovery covers repeated steps, conditions, env and multiline commands", () => {
    const found = discover(
        new Map([
            [
                ".github/workflows/new.yaml",
                "jobs:\n  test:\n    steps:\n      - run: |\n          npm test\n          npm test\n        if: always()\n        env:\n          REQUIRED: yes\n",
            ],
        ]),
    );
    assert.equal(new Set(found.surfaces.map((row) => row.id)).size, found.surfaces.length);
    assert.equal(found.surfaces.filter((row) => row.label === "npm test").length, 2);
    assert(found.surfaces.some((row) => row.label === "if: always()"));
});

test("scenario IDs survive whitespace changes and rendered ownership includes all subtables", () => {
    const f = fixture(),
        before = discover(f.files).assertions;
    f.files.set("tests/engine.test.ts", '\n test( "engine contract", () => {} );');
    assert.deepEqual(discover(f.files).assertions, before);
    const table = renderCoverage(f.inventory, f.coverage);
    for (const row of [...f.coverage.surfaces, ...f.coverage.assertions])
        assert(table.includes(row.id));
    assert(table.includes("## Workloads"));
});
