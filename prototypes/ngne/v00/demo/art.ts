/** Original, code-authored pixel art. The atlas remains decoded asset data. */
export function makeAtlas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 32;
  const ctx = canvas.getContext("2d")!;
  const palettes: Record<string, string> = {
    c: "#83e8e1",
    w: "#fff1ce",
    b: "#426886",
    d: "#19283d",
    r: "#ff6d82",
    o: "#ffb276",
    p: "#8b75b4",
    g: "#b6e68b",
  };
  const shapes = [
    [
      ".......c........",
      "......cwc.......",
      "......cwc.......",
      ".....ccwcc......",
      "..c..cbwbc..c...",
      "..cc.cbwbc.cc...",
      ".cccccwwwccccc..",
      ".cwwwcwwwcwwwc..",
      "ccccccwwwcccccc.",
      "ddddccwwwccdddd.",
      "....ccbbbcc.....",
      "....co...oc.....",
      ".....o...o......",
      ".....w...w......",
    ],
    [
      "....rrrrrr......",
      "...rwwwwwwr.....",
      "..rrrwwwwrrr....",
      ".rprrwwwwrrpr...",
      "rrpprrrrrrpprr..",
      "rrpprrrrrrpprr..",
      ".rrrddrrddrrr...",
      "..rrddrrddrr....",
      "...rrrrrrrr.....",
      "...rrr..rrr.....",
      "..rr......rr....",
    ],
    [
      "......oo........",
      ".....owwo.......",
      "....owwwwo......",
      "...ooppppoo.....",
      "..oopwppwpoo....",
      ".ooppppppppoo...",
      "ooppppppppppoo..",
      "..oooopp oooo...",
      ".....oooo.......",
      "......oo........",
    ],
    [
      "......ww........",
      ".....wccw.......",
      "....wccccw......",
      ".....wccw.......",
      "......ww........",
    ],
    [
      "....gggggg......",
      "...gwwwwwwg.....",
      "..gwggggggwg....",
      "..gwggwwggwg....",
      "..gwggwwggwg....",
      "..gwggggggwg....",
      "...gwwwwwwg.....",
      "....gggggg......",
    ],
    [
      "....pppppp......",
      "..ppprrrrppp....",
      ".pprrrrrrrrpp...",
      "pprrwwrrwwrrpp..",
      "pprrwwrrwwrrpp..",
      "pprrrrrrrrrrpp..",
      ".pppppppppppp...",
      "...pppppppp.....",
      "..pp..pp..pp....",
    ],
  ];
  shapes.forEach((rows, i) =>
    rows.forEach((row, y) =>
      [...row].forEach((pixel, x) => {
        if (palettes[pixel]) {
          ctx.fillStyle = palettes[pixel];
          ctx.fillRect(i * 16 + x, y + 8, 1, 1);
        }
      }),
    ),
  );
  return canvas;
}
const letters: Record<string, string[]> = {
  S: ["11111", "10000", "10000", "11111", "00001", "00001", "11111"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  A: ["01110", "11011", "10001", "11111", "10001", "10001", "10001"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "11110"],
  "'": ["1", "1", "0", "0", "0", "0", "0"],
  " ": ["00", "00", "00", "00", "00", "00", "00"],
};
export function titleArt(text: string) {
  let x = 0,
    paths = "";
  for (const char of text) {
    const glyph = letters[char];
    if (!glyph) continue;
    glyph.forEach((row, y) =>
      [...row].forEach((p, i) => {
        if (p === "1") paths += `M${x + i} ${y}h1v1h-1z`;
      }),
    );
    x += glyph[0].length + 1;
  }
  return `<svg viewBox="0 0 ${x - 1} 7" role="img" aria-label="${text}" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="${paths}"/></svg>`;
}
