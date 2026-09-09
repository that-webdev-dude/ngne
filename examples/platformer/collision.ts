import { TILE } from "./levels.js";

export const CONTACT = Object.freeze({ wall: 1, floor: 2, ceiling: 4, hazard: 8, fell: 16 });

export interface TileGrid {
    readonly widthTiles: number;
    readonly heightTiles: number;
    readonly tiles: Uint8Array;
}

/** Top-left coordinates and dimensions in logical pixels; sweeps mutate x/y. */
export interface Box {
    x: number;
    y: number;
    readonly w: number;
    readonly h: number;
}

export function moveX(tiles: TileGrid, box: Box, dx: number): number {
    let contacts = 0;
    let remaining = dx;
    do {
        const step = Math.sign(remaining) * Math.min(TILE, Math.abs(remaining));
        box.x += step;
        if (box.x < 0 || box.x + box.w > tiles.widthTiles * TILE) {
            box.x = Math.max(0, Math.min(tiles.widthTiles * TILE - box.w, box.x));
            contacts |= CONTACT.wall;
        }
        const column = Math.floor((step > 0 ? box.x + box.w - 1e-9 : box.x) / TILE);
        for (let row = Math.floor(box.y / TILE); row < Math.ceil((box.y + box.h) / TILE); row++) {
            if (tileAt(tiles, column, row) !== 1 || step === 0) continue;
            box.x = step > 0 ? column * TILE - box.w : (column + 1) * TILE;
            contacts |= CONTACT.wall;
        }
        contacts |= sense(tiles, box);
        remaining -= step;
    } while (Math.abs(remaining) > 1e-9 && !(contacts & CONTACT.wall));
    return contacts;
}

export function moveY(tiles: TileGrid, box: Box, dy: number, previousBottom: number): number {
    let contacts = 0;
    let remaining = dy;
    do {
        const step = Math.sign(remaining) * Math.min(TILE, Math.abs(remaining));
        box.y += step;
        const row = Math.floor((step > 0 ? box.y + box.h - 1e-9 : box.y) / TILE);
        for (
            let column = Math.floor(box.x / TILE);
            column < Math.ceil((box.x + box.w) / TILE);
            column++
        ) {
            const tile = tileAt(tiles, column, row);
            if (
                step === 0 ||
                !(tile === 1 || (tile === 2 && step > 0 && previousBottom <= row * TILE))
            )
                continue;
            box.y = step > 0 ? row * TILE - box.h : (row + 1) * TILE;
            contacts |= step > 0 ? CONTACT.floor : CONTACT.ceiling;
        }
        contacts |= sense(tiles, box);
        remaining -= step;
    } while (Math.abs(remaining) > 1e-9 && !(contacts & (CONTACT.floor | CONTACT.ceiling)));
    return contacts;
}

export function tileAt(tiles: TileGrid, x: number, y: number): number {
    if (x < 0 || x >= tiles.widthTiles) return 1;
    if (y < 0 || y >= tiles.heightTiles) return 0;
    return tiles.tiles[y * tiles.widthTiles + x];
}

function sense(tiles: TileGrid, box: Box): number {
    let contacts = box.y > (tiles.heightTiles + 2) * TILE ? CONTACT.fell : 0;
    for (
        let y = Math.max(0, Math.floor(box.y / TILE));
        y < Math.min(tiles.heightTiles, Math.ceil((box.y + box.h) / TILE));
        y++
    )
        for (
            let x = Math.max(0, Math.floor(box.x / TILE));
            x < Math.min(tiles.widthTiles, Math.ceil((box.x + box.w) / TILE));
            x++
        )
            if (tileAt(tiles, x, y) === 3) contacts |= CONTACT.hazard;
    return contacts;
}
