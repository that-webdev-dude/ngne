import type { Frame } from "../../../../src/renderer.js";

export const TILE = 16;
export const ATLAS = 256;
export const TILESETS = ["tilemap:a", "tilemap:b"] as const;

/** One layer's cells of one tileset, in emission order. */
export interface TileGroup {
    layer: number;
    texture: (typeof TILESETS)[number];
    cells: Uint32Array;
    tiles: Uint8Array;
    /** 0: plain; 1–7: flips as negative size and quarter turns as rotation. */
    variants: Uint8Array;
}

export interface TilemapPlan {
    layers: number;
    columns: number;
    rows: number;
    count: number;
    groups: TileGroup[];
}

const hash = (column: number, row: number, layer: number) =>
    (Math.imul(column, 73856093) ^ Math.imul(row, 19349663) ^ Math.imul(layer, 83492791)) >>> 0;

/**
 * Every cell filled on every layer, like a dense multi-layer tilemap: 25% of cells use the
 * second tileset and 12.5% are flipped or rotated. Deterministic; no randomness.
 */
export function tilemapPlan(count: number, columns: number, layers = 8): TilemapPlan {
    if (
        ![count, columns, layers].every(Number.isSafeInteger) ||
        columns < 1 ||
        layers < 1 ||
        count < 1 ||
        count % (columns * layers) !== 0
    )
        throw Error("Tilemap count must be a positive multiple of columns × layers");
    const rows = count / (columns * layers);
    const groups: TileGroup[] = [];
    for (let layer = 0; layer < layers; layer++) {
        const buckets = TILESETS.map(() => ({
            cells: [] as number[],
            tiles: [] as number[],
            variants: [] as number[],
        }));
        for (let row = 0; row < rows; row++)
            for (let column = 0; column < columns; column++) {
                const h = hash(column, row, layer);
                const bucket = buckets[h % 4 === 0 ? 1 : 0];
                bucket.cells.push(row * columns + column);
                bucket.tiles.push((h >>> 8) & 255);
                bucket.variants.push(((h >>> 2) & 7) === 0 ? 1 + ((h >>> 5) % 7) : 0);
            }
        // Grouped by tileset inside a layer so consecutive quads share a texture.
        buckets.forEach((bucket, set) =>
            groups.push({
                layer,
                texture: TILESETS[set],
                cells: Uint32Array.from(bucket.cells),
                tiles: Uint8Array.from(bucket.tiles),
                variants: Uint8Array.from(bucket.variants),
            }),
        );
    }
    return { layers, columns, rows, count, groups };
}

// [flipX, flipY, quarter turns] per variant.
const VARIANTS: readonly (readonly [boolean, boolean, number])[] = [
    [false, false, 0],
    [true, false, 0],
    [false, true, 0],
    [true, true, 0],
    [false, false, 1],
    [false, false, 2],
    [false, false, 3],
    [true, false, 1],
];

/**
 * Authors one sprite per cell, layer by layer, one depth per layer and the top layer at 75%
 * opacity: the emission pattern a tilemap editor's live tier uses through the public API.
 */
export function emitTilemap(frame: Frame, plan: TilemapPlan): void {
    const columns = plan.columns,
        span = TILE / ATLAS,
        perRow = ATLAS / TILE;
    for (const group of plan.groups) {
        const { cells, tiles, variants, texture, layer } = group;
        const alpha = layer === plan.layers - 1 ? 0.75 : 1;
        for (let k = 0; k < cells.length; k++) {
            const cell = cells[k],
                column = cell % columns,
                row = (cell - column) / columns,
                tile = tiles[k],
                [flipX, flipY, turns] = VARIANTS[variants[k]];
            frame.sprite({
                x: column * TILE + TILE / 2,
                y: row * TILE + TILE / 2,
                width: flipX ? -TILE : TILE,
                height: flipY ? -TILE : TILE,
                rotation: (turns * Math.PI) / 2,
                texture,
                u: (tile % perRow) * span,
                v: Math.floor(tile / perRow) * span,
                uw: span,
                vh: span,
                alpha,
                layer: 0,
                depth: layer,
            });
        }
    }
}

/** Zoom that fits the whole map in the viewport (the zoomed-out, fitted view). */
export function fittedZoom(plan: TilemapPlan, width: number, height: number): number {
    return Math.min(width / (plan.columns * TILE), height / (plan.rows * TILE));
}
