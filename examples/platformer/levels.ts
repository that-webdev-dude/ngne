export const TILE = 16;

export interface Tile {
    readonly x: number;
    readonly y: number;
}

export interface LevelData {
    readonly widthTiles: number;
    readonly heightTiles: number;
    /** Authored bytes are read-only by convention; each scene copies them. */
    readonly tiles: Uint8Array;
    readonly start: Tile;
    readonly checkpoints: readonly Tile[];
    readonly exit: Tile;
    readonly patrols: readonly Tile[];
}

export function parseLevel(rows: readonly string[]): LevelData {
    const widthTiles = rows[0]?.length ?? 0;
    if (!widthTiles) throw new Error("Empty level at row 1, column 1");
    for (const [y, row] of rows.entries())
        if (row.length !== widthTiles)
            throw new Error(`Nonrectangular level at row ${y + 1}, column ${row.length + 1}`);
    const tiles = new Uint8Array(widthTiles * rows.length);
    const checkpoints: Tile[] = [];
    const patrols: Tile[] = [];
    let start: Tile | undefined;
    let exit: Tile | undefined;
    for (const [y, row] of rows.entries()) {
        for (let x = 0; x < widthTiles; x++) {
            const symbol = row[x];
            const location = `row ${y + 1}, column ${x + 1}`;
            if (!"#-^.PECG".includes(symbol)) throw new Error(`Unknown tile at ${location}`);
            tiles[y * widthTiles + x] =
                symbol === "#" ? 1 : symbol === "-" ? 2 : symbol === "^" ? 3 : 0;
            if (!"PECG".includes(symbol)) continue;
            const support = rows[y + 1]?.[x];
            if (support !== "#" && support !== "-")
                throw new Error(`Unsupported marker at ${location}`);
            const tile = Object.freeze({ x, y });
            if (symbol === "P") {
                if (start) throw new Error(`Duplicate start at ${location}`);
                start = tile;
            } else if (symbol === "E") {
                if (exit) throw new Error(`Duplicate exit at ${location}`);
                exit = tile;
            } else if (symbol === "C") checkpoints.push(tile);
            else patrols.push(tile);
        }
    }
    if (!start || !exit) throw new Error("Missing start or exit at row 1, column 1");
    checkpoints.sort((a, b) => a.x - b.x || a.y - b.y);
    return Object.freeze({
        widthTiles,
        heightTiles: rows.length,
        tiles,
        start,
        exit,
        checkpoints: Object.freeze(checkpoints),
        patrols: Object.freeze(patrols),
    });
}

export const LEVEL_ONE = parseLevel([
    ...Array<string>(12).fill(".".repeat(100)),
    ".".repeat(100),
    ".".repeat(18) + "####" + ".".repeat(78),
    "..P" + ".".repeat(43) + "C" + ".".repeat(48) + "E....",
    "#".repeat(28) + "...." + "#".repeat(30) + "....." + "#".repeat(33),
    "#".repeat(28) + "...." + "#".repeat(30) + "....." + "#".repeat(33),
]);

export const LEVEL_TWO = parseLevel([
    "............................................................................................................................................",
    "............................................................................................................................................",
    "............................................................................................................................................",
    "............................................................................................................................................",
    "............................................................................................................................................",
    "............................................................................................................................................",
    "............................................................................................................................................",
    "............................................................................................................................................",
    "............................................................................................................................................",
    "............................................................................................................................................",
    "............................................................................................................................................",
    "............................................................................................................................................",
    "..............................--------......................................................................--------........................",
    "........................................................-----------..................................................----------.............",
    "..P...............G...............^^..........C...........................^^......G...........C..........G.....^^.......................E...",
    "###########################################################.....#######################################################.....################",
    "###########################################################.....#######################################################.....################",
]);
