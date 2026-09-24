import { createConnection } from "node:net";
import { createHash, randomBytes } from "node:crypto";

/** Adapted from the browser benchmark's large-frame RFC 6455 client. No extensions. */
export class DevToolsSocket {
    readyState = 0;
    private listeners = new Map<string, Set<(event: { data?: string }) => void>>();
    private socket: ReturnType<typeof createConnection>;
    constructor(address: string) {
        const url = new URL(address);
        if (url.protocol !== "ws:") throw Error("DevTools requires ws:");
        const key = randomBytes(16).toString("base64");
        const accept = createHash("sha1")
            .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
            .digest("base64");
        const socket = (this.socket = createConnection({
            host: url.hostname,
            port: Number(url.port || 80),
        }));
        let buffer: Buffer = Buffer.alloc(0),
            fragments: Buffer[] = [],
            fragmented = false;
        const decoder = new TextDecoder("utf-8", { fatal: true });
        socket.on("error", () => this.emit("error"));
        socket.on("close", () => {
            this.readyState = 3;
            this.emit("close");
        });
        socket.once("connect", () =>
            socket.write(
                `GET ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
            ),
        );
        socket.on("data", (data: Buffer) => {
            try {
                buffer = Buffer.concat([buffer, data]);
                if (this.readyState === 0) {
                    const end = buffer.indexOf("\r\n\r\n");
                    if (end < 0) {
                        if (buffer.length > 16384) throw Error("Oversized upgrade");
                        return;
                    }
                    const head = buffer.subarray(0, end).toString();
                    const headers = new Map(
                        head
                            .split("\r\n")
                            .slice(1)
                            .map((line) => {
                                const colon = line.indexOf(":");
                                return [
                                    line.slice(0, colon).toLowerCase(),
                                    line.slice(colon + 1).trim(),
                                ];
                            }),
                    );
                    if (
                        !/^HTTP\/1\.1 101\b/.test(head) ||
                        headers.get("sec-websocket-accept") !== accept ||
                        headers.get("upgrade")?.toLowerCase() !== "websocket" ||
                        !headers
                            .get("connection")
                            ?.toLowerCase()
                            .split(/,\s*/)
                            .includes("upgrade") ||
                        headers.has("sec-websocket-extensions")
                    )
                        throw Error("Invalid upgrade");
                    buffer = buffer.subarray(end + 4);
                    this.readyState = 1;
                    this.emit("open");
                }
                while (this.readyState === 1 && buffer.length >= 2) {
                    const final = !!(buffer[0] & 128),
                        opcode = buffer[0] & 15;
                    if (buffer[0] & 112 || buffer[1] & 128) throw Error("Invalid server frame");
                    let length = buffer[1] & 127,
                        offset = 2;
                    if (length === 126) {
                        if (buffer.length < 4) return;
                        length = buffer.readUInt16BE(2);
                        offset = 4;
                    } else if (length === 127) {
                        if (buffer.length < 10) return;
                        const n = buffer.readBigUInt64BE(2);
                        if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw Error("Invalid length");
                        length = Number(n);
                        offset = 10;
                    }
                    if (opcode >= 8 && (!final || length > 125))
                        throw Error("Invalid control frame");
                    if (buffer.length < offset + length) return;
                    const payload = Buffer.from(buffer.subarray(offset, offset + length));
                    buffer = buffer.subarray(offset + length);
                    if (opcode === 8) {
                        this.close();
                        return;
                    }
                    if (opcode === 9) {
                        this.frame(10, payload);
                        continue;
                    }
                    if (opcode === 10) continue;
                    if ((opcode !== 0 && opcode !== 1) || (opcode === 0) !== fragmented)
                        throw Error("Invalid fragmentation");
                    fragments.push(payload);
                    fragmented = !final;
                    if (final) {
                        const text = decoder.decode(Buffer.concat(fragments));
                        fragments = [];
                        this.emit("message", { data: text });
                    }
                }
            } catch (error) {
                this.emit("error", { data: String(error) });
                this.close();
            }
        });
    }
    addEventListener(name: string, listener: (event: { data?: string }) => void) {
        const set = this.listeners.get(name) ?? new Set();
        set.add(listener);
        this.listeners.set(name, set);
    }
    removeEventListener(name: string, listener: (event: { data?: string }) => void) {
        this.listeners.get(name)?.delete(listener);
    }
    private emit(name: string, event: { data?: string } = {}) {
        for (const listener of this.listeners.get(name) ?? []) listener(event);
    }
    private frame(opcode: number, payload: Buffer) {
        const mask = randomBytes(4);
        const header = Buffer.alloc(payload.length < 126 ? 2 : payload.length < 65536 ? 4 : 10);
        header[0] = 128 | opcode;
        header[1] = 128 | (header.length === 2 ? payload.length : header.length === 4 ? 126 : 127);
        if (header.length === 4) header.writeUInt16BE(payload.length, 2);
        if (header.length === 10) header.writeBigUInt64BE(BigInt(payload.length), 2);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        this.socket.write(Buffer.concat([header, mask, payload]));
    }
    send(text: string) {
        if (this.readyState !== 1) throw Error("DevTools socket is not open");
        this.frame(1, Buffer.from(text));
    }
    close() {
        if (this.readyState === 3) return;
        this.readyState = 2;
        this.socket.destroy();
    }
}
