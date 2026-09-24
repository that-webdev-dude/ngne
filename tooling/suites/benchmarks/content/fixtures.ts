import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

/** Deterministic, independently decoded PNG payloads; no game schema or consumer inputs. */
export function imageBytes(index: number): Buffer {
    const chunk = (type: string, data: Buffer) => {
        const body = Buffer.concat([Buffer.from(type), data]);
        let crc = 0xffffffff;
        for (const byte of body) {
            crc ^= byte;
            for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
        const length = Buffer.alloc(4),
            checksum = Buffer.alloc(4);
        length.writeUInt32BE(data.length);
        checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
        return Buffer.concat([length, body, checksum]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(64, 0);
    header.writeUInt32BE(64, 4);
    header[8] = 8;
    header[9] = 6;
    const pixels = Buffer.alloc(64 * (1 + 64 * 4));
    for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) {
            const offset = y * 257 + 1 + x * 4;
            pixels.set(
                [(index * 31 + x) % 256, (index * 53 + y) % 256, (index * 71 + x + y) % 256, 255],
                offset,
            );
        }
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk("IHDR", header),
        chunk("IDAT", deflateSync(pixels)),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

export function generate(repository: string, output: string): void {
    mkdirSync(output); // Never modify a previous fixture.
    cpSync(join(repository, "tooling/fixtures/content-engine"), output, { recursive: true });
    cpSync(
        join(repository, "tooling/suites/benchmarks/content/accounting.ts"),
        join(output, "accounting.ts"),
    );
    cpSync(
        join(repository, "tooling/fixtures/installed-engine/tone.wav"),
        join(output, "tone.wav"),
    );
    mkdirSync(join(output, "public/images"), { recursive: true });
    for (let index = 0; index < 13; index++)
        writeFileSync(join(output, `public/images/${index}.png`), imageBytes(index));
}
