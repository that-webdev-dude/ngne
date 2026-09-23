import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { consumer, inventory, stub } from "./fixtures/consumer-contract-v1/stub.js";
import { hash } from "../evidence/identity.js";
import { header, object } from "../evidence/schema.js";
import {
    consumerValidatorIdentity,
    validateConsumerResponse,
} from "../evidence/consumer-contract-v1.js";

function fixture(t: { after(fn: () => void): void }) {
    const root = mkdtempSync(join(tmpdir(), "ngne-contract-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const tarball = join(root, "synthetic.tgz"),
        output = join(root, "run"),
        runId = "conformance";
    writeFileSync(tarball, "synthetic package bytes");
    const selected = {
        runId,
        engineSha256: hash(readFileSync(tarball)),
        engineFilename: "synthetic.tgz",
        consumer,
    };
    const args = [
        "--contract-version",
        "1",
        "--engine-tarball",
        tarball,
        "--engine-sha256",
        selected.engineSha256,
        "--output",
        output,
        "--run-id",
        runId,
    ];
    const edit = (name: string, fn: (v: Record<string, unknown>) => void) => {
        const path = join(output, "evidence", name + ".json"),
            v = JSON.parse(readFileSync(path, "utf8"));
        fn(v);
        writeFileSync(path, JSON.stringify(v));
        inventory(join(output, "evidence"), runId);
    };
    return { root, output, runId, selected, args, edit };
}
test("consumer contract accepts valid response and rejects reused output without mutation", (t) => {
    const f = fixture(t);
    assert.equal(stub(f.args), 0);
    assert.equal(validateConsumerResponse(f.output, f.selected, 0).accepted, true);
    const before = readFileSync(join(f.output, "evidence/artifacts.json"));
    assert.equal(stub(f.args), 2);
    assert.deepEqual(readFileSync(join(f.output, "evidence/artifacts.json")), before);
    assert.equal(Object.keys(consumerValidatorIdentity(resolve(".")).files).length, 3);
});
test("consumer contract validates failed responses and exit consistency", (t) => {
    const f = fixture(t);
    assert.equal(stub(f.args, true), 1);
    const response = validateConsumerResponse(f.output, f.selected, 1);
    assert.equal(response.accepted, false);
    assert.equal(response.result.failures.length, 1);
    assert.throws(() => validateConsumerResponse(f.output, f.selected, 0), /Exit/);
    f.edit("manifest", (v) => {
        v.contractVersion = 2;
    });
    assert.throws(() => validateConsumerResponse(f.output, f.selected, 1), /Unsupported/);
});
test("consumer contract rejects unsupported input and mismatched tarball before allocation", (t) => {
    const f = fixture(t);
    const args = [...f.args];
    args[1] = "2";
    assert.equal(stub(args), 2);
    args[1] = "1";
    args[5] = "0".repeat(64);
    assert.equal(stub(args), 2);
    assert.equal(stub(f.args), 0);
});
const cases = object(
    JSON.parse(
        readFileSync(resolve("tooling/tests/fixtures/consumer-contract-v1/cases.json"), "utf8"),
    ),
);
if (!Array.isArray(cases.invalid) || cases.invalid.some((v) => typeof v !== "string"))
    throw Error("Invalid fixture cases");
for (const scenario of cases.invalid) {
    test(`consumer contract rejects ${scenario}`, (t) => {
        const f = fixture(t);
        assert.equal(stub(f.args), 0);
        if (scenario === "hash") f.selected.engineSha256 = "0".repeat(64);
        if (scenario === "version")
            f.edit("manifest", (v) => {
                v.schemaVersion = 2;
            });
        if (scenario === "run-id")
            f.edit("result", (v) => {
                v.runId = "other";
            });
        if (scenario === "incomplete")
            f.edit("result", (v) => {
                v.evidence = "partial";
                v.accepted = false;
            });
        if (scenario === "consumer") f.selected.consumer = { ...consumer, revision: "other" };
        if (scenario === "artifact")
            writeFileSync(join(f.output, "evidence/report.md"), "tampered");
        if (scenario === "escape" || scenario === "size") {
            const p = join(f.output, "evidence/artifacts.json"),
                v = JSON.parse(readFileSync(p, "utf8"));
            if (scenario === "escape") v.files[0].path = "../outside";
            else v.files[0].bytes++;
            writeFileSync(p, JSON.stringify(v));
        }
        if (scenario === "required")
            f.edit("result", (v) => {
                if (!Array.isArray(v.stages)) throw Error("Expected stages");
                object(v.stages[0]).required = false;
            });
        assert.throws(() =>
            validateConsumerResponse(f.output, f.selected, scenario === "exit" ? 1 : 0),
        );
    });
}
test("consumer contract static schema example conforms", () => {
    const output = resolve("tooling/tests/fixtures/consumer-contract-v1/successful-response");
    assert.equal(
        validateConsumerResponse(
            output,
            {
                runId: "conformance-example",
                engineFilename: "synthetic.tgz",
                engineSha256: hash("synthetic package bytes"),
                consumer,
            },
            0,
        ).accepted,
        true,
    );
});
test("consumer contract rejects linked payload directories", (t) => {
    const f = fixture(t);
    assert.equal(stub(f.args), 0);
    symlinkSync(f.root, join(f.output, "evidence/linked"), "junction");
    assert.throws(() => validateConsumerResponse(f.output, f.selected, 0), /Linked/);
});

test("consumer stub CLI runs independently twice and returns invalid-input status on reuse", (t) => {
    for (let i = 0; i < 2; i++) {
        const f = fixture(t);
        const invoke = () =>
            spawnSync(
                process.execPath,
                [
                    "--import",
                    "tsx",
                    "tooling/tests/fixtures/consumer-contract-v1/stub.ts",
                    ...f.args,
                ],
                { encoding: "utf8", timeout: 10000 },
            );
        const first = invoke();
        assert.equal(first.status, 0, first.stderr);
        assert.equal(validateConsumerResponse(f.output, f.selected, 0).accepted, true);
        assert.equal(invoke().status, 2);
    }
});

test("consumer contract checks retained tarball independently of artifact inventory", (t) => {
    const f = fixture(t);
    assert.equal(stub(f.args), 0);
    writeFileSync(join(f.output, "evidence/package/synthetic.tgz"), "different bytes");
    inventory(join(f.output, "evidence"), f.runId);
    assert.throws(() => validateConsumerResponse(f.output, f.selected, 0), /Retained package hash/);
});

test("consumer contract rejects missing required fields and stage document ID drift", (t) => {
    const f = fixture(t);
    assert.equal(stub(f.args), 0);
    f.edit("manifest", (v) => {
        delete v.installed;
    });
    assert.throws(() => validateConsumerResponse(f.output, f.selected, 0), /Expected object/);
    const g = fixture(t);
    assert.equal(stub(g.args), 0);
    g.edit("result", (v) => {
        delete v.cleanupRecords;
    });
    assert.throws(() => validateConsumerResponse(g.output, g.selected, 0), /Expected array/);
    const h = fixture(t);
    assert.equal(stub(h.args), 0);
    mkdirSync(join(h.output, "evidence/stages/example"), { recursive: true });
    writeFileSync(
        join(h.output, "evidence/stages/example/observations.json"),
        JSON.stringify(header("observations", "wrong-run")),
    );
    inventory(join(h.output, "evidence"), h.runId);
    assert.throws(() => validateConsumerResponse(h.output, h.selected, 0), /Stage document run ID/);
});
