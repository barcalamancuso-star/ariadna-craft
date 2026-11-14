import { getBlockDef } from "./shared/blocks.js";

const GRID = 8;
const CELL = 32;
const INNER = 16;
const PAD = 8;
const SIZE = GRID * CELL; // 256

function seededNoise(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function rgb(r, g, b, a = 255) {
  return `rgba(${Math.max(0, Math.min(255, r | 0))},${Math.max(0, Math.min(255, g | 0))},${Math.max(
    0,
    Math.min(255, b | 0)
  )},${(a / 255).toFixed(3)})`;
}

function paint16(tileIdx, pixelFn) {
  const pixels = new Array(256);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      pixels[y * 16 + x] = pixelFn(x, y, seededNoise(x, y, tileIdx + 17));
    }
  }
  return pixels;
}

function buildTiles() {
  const tiles = new Map();

  // 0: Grass top
  tiles.set(0, paint16(0, (x, y, n) => {
    const shade = (n - 0.5) * 28;
    return rgb(84 + shade, 168 + shade, 64 + shade * 0.7);
  }));

  // 1: Grass side (top 4px green grass overhang, rest dirt)
  tiles.set(1, paint16(1, (x, y, n) => {
    const edge = 3 + Math.floor(seededNoise(x, 0, 99) * 2.5);
    const shade = (n - 0.5) * 24;
    if (y <= edge) {
      return rgb(80 + shade, 162 + shade, 60 + shade * 0.6);
    }
    return rgb(138 + shade, 90 + shade * 0.7, 50 + shade * 0.5);
  }));

  // 2: Dirt
  tiles.set(2, paint16(2, (x, y, n) => {
    const shade = (n - 0.5) * 26;
    const pebble = n > 0.88 ? -18 : 0;
    return rgb(138 + shade + pebble, 90 + shade * 0.7 + pebble, 50 + shade * 0.5 + pebble);
  }));

  // 3: Stone
  tiles.set(3, paint16(3, (x, y, n) => {
    const shade = (n - 0.5) * 30;
    const crack = (y % 5 === 0 && x % 4 === 0 && n > 0.5) ? -22 : 0;
    const v = 128 + shade + crack;
    return rgb(v, v + 3, v + 8);
  }));

  // 4: Wood log side
  tiles.set(4, paint16(4, (x, y, n) => {
    const stripe = (x % 3 === 0 ? -16 : 6) + (n - 0.5) * 18;
    return rgb(108 + stripe, 72 + stripe * 0.8, 39 + stripe * 0.5);
  }));

  // 5: Wood log top (rings)
  tiles.set(5, paint16(5, (x, y, n) => {
    const dx = Math.abs(x - 7.5);
    const dy = Math.abs(y - 7.5);
    const ring = Math.max(dx, dy);
    const outer = ring > 6.2;
    if (outer) return rgb(104, 68, 36);
    const rShade = Math.floor(ring) % 2 === 0 ? 12 : -10;
    return rgb(184 + rShade + (n - 0.5) * 14, 140 + rShade, 86 + rShade);
  }));

  // 6: Planks
  tiles.set(6, paint16(6, (x, y, n) => {
    const seamH = y % 4 === 0;
    const seamV = (Math.floor(y / 4) % 2 === 0 ? x === 0 : x === 8);
    if (seamH || seamV) return rgb(128, 90, 48);
    const shade = (n - 0.5) * 18;
    return rgb(196 + shade, 148 + shade * 0.8, 86 + shade * 0.6);
  }));

  // 7: Leaves
  tiles.set(7, paint16(7, (x, y, n) => {
    if (n < 0.22) return rgb(26, 78, 24);
    const shade = (n - 0.5) * 32;
    return rgb(58 + shade, 142 + shade, 48 + shade * 0.7);
  }));

  // 8: Sand
  tiles.set(8, paint16(8, (x, y, n) => {
    const shade = (n - 0.5) * 20;
    return rgb(228 + shade, 210 + shade, 146 + shade);
  }));

  // 9: Water
  tiles.set(9, paint16(9, (x, y, n) => {
    const wave = Math.sin((x + y) * 0.7) * 14 + (n - 0.5) * 14;
    return rgb(38 + wave, 132 + wave, 224 + wave * 0.4, 188);
  }));

  // 10: Brick
  tiles.set(10, paint16(10, (x, y, n) => {
    const mortarH = y % 4 === 0;
    const row = Math.floor(y / 4);
    const mortarV = ((x + (row % 2) * 4) % 8 === 0);
    if (mortarH || mortarV) return rgb(206, 202, 194);
    const shade = (n - 0.5) * 24;
    return rgb(180 + shade, 72 + shade * 0.6, 56 + shade * 0.5);
  }));

  // 11: Glass
  tiles.set(11, paint16(11, (x, y) => {
    const border = x === 0 || y === 0 || x === 15 || y === 15;
    if (border) return rgb(205, 242, 255, 225);
    const glint = (x + y === 6 || x + y === 7 || (x === 3 && y === 4)) ? 210 : 85;
    return rgb(175, 232, 255, glint);
  }));

  // 12: Glowstone / Neon Lantern
  tiles.set(12, paint16(12, (x, y, n) => {
    const border = x === 0 || y === 0 || x === 15 || y === 15;
    if (border) return rgb(185, 130, 42);
    const core = Math.hypot(x - 7.5, y - 7.5) < 5.5;
    if (core) return rgb(255, 245, 185);
    const shade = (n - 0.5) * 26;
    return rgb(250 + shade * 0.2, 206 + shade, 82 + shade);
  }));

  // 13: Diamond block
  tiles.set(13, paint16(13, (x, y, n) => {
    const border = x === 0 || y === 0 || x === 15 || y === 15;
    if (border) return rgb(34, 178, 186);
    const glint = (x - y >= -1 && x - y <= 1 && x > 3 && x < 12) ? 45 : 0;
    const shade = (n - 0.5) * 20;
    return rgb(70 + glint + shade, 238 + glint, 232 + glint);
  }));

  // 14: Gold block
  tiles.set(14, paint16(14, (x, y, n) => {
    const border = x === 0 || y === 0 || x === 15 || y === 15;
    if (border) return rgb(194, 138, 18);
    const glint = (x + y >= 8 && x + y <= 10 && x > 2 && x < 11) ? 35 : 0;
    const shade = (n - 0.5) * 20;
    return rgb(248 + glint, 202 + glint + shade, 46 + glint);
  }));

  // 15: Obsidian
  tiles.set(15, paint16(15, (x, y, n) => {
    const fleck = n > 0.86 ? 38 : 0;
    const shade = (n - 0.5) * 14;
    return rgb(42 + fleck + shade, 28 + fleck * 0.4 + shade, 66 + fleck * 1.3 + shade);
  }));

  // 16: Portal Ariadna
  tiles.set(16, paint16(16, (x, y, n) => {
    const swirl = Math.sin(Math.hypot(x - 7.5, y - 7.5) * 1.1) * 35;
    return rgb(168 + swirl, 78 + (n * 40), 255, 205);
  }));

  return tiles;
}

const BUILT_TILES = buildTiles();

export function createAtlasCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, SIZE, SIZE);

  for (const [tileIdx, pixels] of BUILT_TILES.entries()) {
    const col = tileIdx % GRID;
    const row = Math.floor(tileIdx / GRID);
    const ox = col * CELL;
    const oy = row * CELL;

    // Draw inner 16x16
    for (let y = 0; y < INNER; y++) {
      for (let x = 0; x < INNER; x++) {
        ctx.fillStyle = pixels[y * INNER + x];
        ctx.fillRect(ox + PAD + x, oy + PAD + y, 1, 1);
      }
    }

    // Clamp 8px borders around tile to prevent any UV bleeding
    for (let p = 0; p < PAD; p++) {
      for (let x = 0; x < INNER; x++) {
        ctx.fillStyle = pixels[x];
        ctx.fillRect(ox + PAD + x, oy + p, 1, 1);
        ctx.fillStyle = pixels[(INNER - 1) * INNER + x];
        ctx.fillRect(ox + PAD + x, oy + PAD + INNER + p, 1, 1);
      }
      for (let y = 0; y < INNER; y++) {
        ctx.fillStyle = pixels[y * INNER];
        ctx.fillRect(ox + p, oy + PAD + y, 1, 1);
        ctx.fillStyle = pixels[y * INNER + INNER - 1];
        ctx.fillRect(ox + PAD + INNER + p, oy + PAD + y, 1, 1);
      }
    }
  }

  return canvas;
}

export function drawBlockPreview(canvas, blockId) {
  const def = getBlockDef(blockId);
  const tileIdx = def.tiles?.side ?? def.tiles?.all ?? def.tiles?.top ?? 0;
  const pixels = BUILT_TILES.get(tileIdx);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!pixels) return;
  const scale = canvas.width / 16;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      ctx.fillStyle = pixels[y * 16 + x];
      ctx.fillRect(x * scale, y * scale, Math.ceil(scale), Math.ceil(scale));
    }
  }
}
