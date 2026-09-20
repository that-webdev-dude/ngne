import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function identities(root) {
    const files = {};
    function walk(dir) {
        for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
            a.name.localeCompare(b.name),
        )) {
            const path = join(dir, item.name);
            if (item.isDirectory()) walk(path);
            else files[relative(root, path).replaceAll("\\", "/")] = hash(readFileSync(path));
        }
    }
    walk(root);
    return files;
}
function chunk(type, bytes) {
    const input = Buffer.concat([Buffer.from(type), bytes]);
    let crc = 0xffffffff;
    for (const byte of input) {
        crc ^= byte;
        for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const output = Buffer.alloc(bytes.length + 12);
    output.writeUInt32BE(bytes.length);
    input.copy(output, 4);
    output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, output.length - 4);
    return output;
}
export function generateChurn(root, count) {
    const dir = join(root, "content");
    const town = JSON.parse(readFileSync(join(dir, "town.json")));
    const atlas = JSON.parse(readFileSync(join(dir, "town-atlas.json")));
    for (let i = 0; i < count; i++) {
        const stem = `churn-${i}`;
        const pixels = Buffer.alloc((24 * 4 + 1) * 8);
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 24; x++)
                pixels.set(
                    [(i * 19 + x * 3) % 256, (80 + i * 11 + y * 7) % 256, 140, 255],
                    y * 97 + 1 + x * 4,
                );
        const header = Buffer.alloc(13);
        header.writeUInt32BE(24);
        header.writeUInt32BE(8, 4);
        header[8] = 8;
        header[9] = 6;
        writeFileSync(
            join(dir, stem + ".png"),
            Buffer.concat([
                Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
                chunk("IHDR", header),
                chunk("IDAT", deflateSync(pixels)),
                chunk("IEND", Buffer.alloc(0)),
            ]),
        );
        const wav = Buffer.alloc(44 + 22050 * 2);
        wav.write("RIFF");
        wav.writeUInt32LE(wav.length - 8, 4);
        wav.write("WAVEfmt ", 8);
        wav.writeUInt32LE(16, 16);
        wav.writeUInt16LE(1, 20);
        wav.writeUInt16LE(1, 22);
        wav.writeUInt32LE(22050, 24);
        wav.writeUInt32LE(44100, 28);
        wav.writeUInt16LE(2, 32);
        wav.writeUInt16LE(16, 34);
        wav.write("data", 36);
        wav.writeUInt32LE(wav.length - 44, 40);
        for (let n = 0; n < 22050; n++)
            wav.writeInt16LE(
                Math.round(2500 * Math.sin((2 * Math.PI * (220 + i * 25) * n) / 22050)),
                44 + n * 2,
            );
        writeFileSync(join(dir, stem + ".wav"), wav);
        writeFileSync(
            join(dir, stem + "-atlas.json"),
            JSON.stringify({ ...atlas, image: stem + ".png" }),
        );
        writeFileSync(
            join(dir, stem + ".json"),
            JSON.stringify({
                ...town,
                name: stem,
                environment: stem + "-atlas.json",
                audio: stem + ".wav",
                destination: `churn-${(i + 1) % count}.json`,
            }),
        );
    }
    writeFileSync(join(dir, "town.json"), JSON.stringify({ ...town, destination: "churn-0.json" }));
}
