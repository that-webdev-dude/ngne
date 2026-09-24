import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { connectDevTools } from "../../tests/tooling/devtools.mjs";
import { BrowserSession } from "../core/browser/session.js";
import { closeServer, runWithCleanup } from "../../tests/tooling/cleanup.mjs";

function frame(text: string | Buffer, opcode = 1, final = true): Buffer {
    const bytes = Buffer.isBuffer(text) ? text : Buffer.from(text);
    const header = Buffer.alloc(bytes.length < 126 ? 2 : bytes.length < 65536 ? 4 : 10);
    header[0] = (final ? 128 : 0) | opcode;
    header[1] = header.length === 2 ? bytes.length : header.length === 4 ? 126 : 127;
    if (header.length === 4) header.writeUInt16BE(bytes.length, 2);
    if (header.length === 10) header.writeBigUInt64BE(BigInt(bytes.length), 2);
    return Buffer.concat([header, bytes]);
}

async function peer(
    run: (url: string) => Promise<void>,
    send: (write: (data: Buffer) => void) => void,
) {
    const server = createServer();
    const sockets = new Set<import("node:stream").Duplex>();
    server.on("upgrade", (request, socket) => {
        sockets.add(socket);
        socket.on("error", () => {});
        socket.on("close", () => sockets.delete(socket));
        const accept = createHash("sha1")
            .update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
            .digest("base64");
        socket.write(
            `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
        );
        socket.once("data", () => send((data) => socket.write(data)));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    try {
        await run(`ws://127.0.0.1:${address.port}/devtools`);
    } finally {
        for (const socket of sockets) socket.destroy();
        await closeServer(server);
    }
}

test("wire transport reassembles a fragmented 5 MiB reply with UTF-8 and interleaved ping", async () => {
    const value = "é" + "x".repeat(5 * 1024 * 1024);
    const bytes = Buffer.from(JSON.stringify({ id: 1, result: { value } }));
    await peer(
        async (url) => {
            const client = await connectDevTools(url);
            try {
                assert.deepEqual(await client.send("large"), { value });
            } finally {
                await client.close();
            }
        },
        (write) => {
            const split = bytes.indexOf(Buffer.from("é")) + 1;
            const first = frame(bytes.subarray(0, split), 1, false);
            write(first.subarray(0, 1));
            write(first.subarray(1));
            write(frame("ping", 9));
            write(frame(bytes.subarray(split), 0));
        },
    );
});

test("wire invalid UTF-8 and invalid continuation reject pending commands and close", async () => {
    for (const bytes of [frame(Buffer.from([0xc3, 0x28])), frame("bad", 0)])
        await peer(
            async (url) => {
                const client = await connectDevTools(url);
                await assert.rejects(client.send("invalid"), /socket failed/);
                await client.close();
            },
            (write) => write(bytes),
        );
});

test("event deadlines, unsubscribe and terminal close are bounded", async () => {
    await peer(
        async (url) => {
            const client = await connectDevTools(url);
            try {
                await assert.rejects(client.once("missing", 10), /timed out/);
                const pending = client.once("pending");
                const rejection = assert.rejects(pending, /explicitly closed/);
                await client.close();
                await rejection;
            } finally {
                await client.close();
            }
        },
        () => {},
    );
});

test("partial startup records cleanup and rejects session reuse", async () => {
    const session = new BrowserSession();
    await assert.rejects(
        session.start({ executable: "ngne-nonexistent-browser-executable", startupMs: 200 }),
        /spawn|ENOENT/,
    );
    const records = await session.stop();
    assert(records.every((record) => record.status === "passed"));
    assert(records.some((record) => record.resource === "temporary profile remove"));
    await assert.rejects(session.start(), /closed/);
});

test("session attempts all cleanup resources and preserves independent failures", async () => {
    const session = new BrowserSession();
    let released = false;
    session.cleanup.push(
        [
            "bad",
            () => {
                throw Error("controlled cleanup failure");
            },
        ],
        [
            "next",
            () => {
                released = true;
            },
        ],
    );
    await assert.rejects(session.stop(), /cleanup failed/);
    assert(released);
    assert.deepEqual(
        session.records.map((record) => record.status),
        ["failed", "passed"],
    );
    assert.equal(await session.close(), session.records);
});

test("partial startup after owned server launch retains scenario and diagnostics and kills the tree", async () => {
    const session = new BrowserSession();
    const failures = await runWithCleanup(
        async () => {
            const { child } = session.ownProcess(
                process.execPath,
                ["-e", "setInterval(() => {}, 1000)"],
                "partial preview",
            );
            await new Promise<void>((resolve, reject) => {
                child.once("spawn", resolve);
                child.once("error", reject);
            });
            throw Error("controlled readiness failure");
        },
        async () => {
            throw Error("controlled diagnostic failure");
        },
        [["session", () => session.stop()]],
    );
    assert.deepEqual(failures, [
        "controlled readiness failure",
        "diagnostics: controlled diagnostic failure",
    ]);
    assert.equal(session.records[0].status, "passed");
    assert.deepEqual((session.records[0].detail as { survivors: number[] }).survivors, []);
});
