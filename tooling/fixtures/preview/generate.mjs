// Deterministic diagnostic pixels: asymmetric corners, transparent gutters and half alpha.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
const width = 41,
    height = 29;
const pixels = Buffer.alloc(height * (1 + width * 4));
function pixel(x, y, rgba) {
    pixels.set(rgba, y * (1 + width * 4) + 1 + x * 4);
}
for (let y = 5; y < 12; y++)
    for (let x = 3; x < 12; x++) pixel(x, y, [240, 40, 20, x < 7 ? 255 : 128]);
pixel(3, 5, [0, 255, 0, 255]);
pixel(11, 11, [0, 0, 255, 255]);
for (let y = 2; y < 13; y++)
    for (let x = 19; x < 24; x++) pixel(x, y, [20, 80, 240, y < 7 ? 255 : 128]);
pixel(19, 2, [255, 255, 0, 255]);
for (let y = 17; y < 20; y++) for (let x = 28; x < 35; x++) pixel(x, y, [255, 0, 255, 255]);
// Alternating one-pixel stripes lose one color when rendered at half width.
for (let y = 24; y < 28; y++)
    for (let x = 0; x < 8; x++) pixel(x, y, x % 2 ? [0, 255, 0, 255] : [255, 0, 0, 255]);
function crc(bytes) {
    let value = 0xffffffff;
    for (const byte of bytes) {
        value ^= byte;
        for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
    const data = Buffer.concat([Buffer.from(type), bytes]),
        result = Buffer.alloc(bytes.length + 12);
    result.writeUInt32BE(bytes.length);
    data.copy(result, 4);
    result.writeUInt32BE(crc(data), result.length - 4);
    return result;
}
const header = Buffer.alloc(13);
header.writeUInt32BE(width);
header.writeUInt32BE(height, 4);
header[8] = 8;
header[9] = 6;
writeFileSync(
    new URL("./prism.png", import.meta.url),
    Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk("IHDR", header),
        chunk("IDAT", deflateSync(pixels)),
        chunk("IEND", Buffer.alloc(0)),
    ]),
);
