export const WORLD_SIZE_X = 64;
export const WORLD_HEIGHT = 48;
export const WORLD_SIZE_Z = 64;
export const CHUNK_SIZE = 16;
export const CHUNKS_X = WORLD_SIZE_X / CHUNK_SIZE;
export const CHUNKS_Z = WORLD_SIZE_Z / CHUNK_SIZE;
export const SEA_LEVEL = 14;

export const BLOCK_IDS = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  WOOD: 4,
  PLANKS: 5,
  LEAVES: 6,
  SAND: 7,
  WATER: 8,
  BRICK: 9,
  GLASS: 10,
  GLOW: 11,
  DIAMOND: 12,
  GOLD: 13,
  OBSIDIAN: 14,
  PORTAL: 15,
};

export const BLOCKS = [
  { id: 0, key: "air", name: "Aire", solid: false, opaque: false, liquid: false, emissive: false, tiles: {} },
  { id: 1, key: "grass", name: "Pasto", solid: true, opaque: true, liquid: false, emissive: false, color: "#57aa42", tiles: { top: 0, side: 1, bottom: 2 } },
  { id: 2, key: "dirt", name: "Tierra", solid: true, opaque: true, liquid: false, emissive: false, color: "#8a5a32", tiles: { all: 2 } },
  { id: 3, key: "stone", name: "Piedra", solid: true, opaque: true, liquid: false, emissive: false, color: "#7f858d", tiles: { all: 3 } },
  { id: 4, key: "wood", name: "Tronco", solid: true, opaque: true, liquid: false, emissive: false, color: "#6d4827", tiles: { top: 5, bottom: 5, side: 4 } },
  { id: 5, key: "planks", name: "Tablas", solid: true, opaque: true, liquid: false, emissive: false, color: "#c29254", tiles: { all: 6 } },
  { id: 6, key: "leaves", name: "Hojas", solid: true, opaque: true, liquid: false, emissive: false, color: "#3d8b35", tiles: { all: 7 } },
  { id: 7, key: "sand", name: "Arena", solid: true, opaque: true, liquid: false, emissive: false, color: "#e4d292", tiles: { all: 8 } },
  { id: 8, key: "water", name: "Agua", solid: false, opaque: false, liquid: true, emissive: false, color: "#2b82de", tiles: { all: 9 } },
  { id: 9, key: "brick", name: "Ladrillo", solid: true, opaque: true, liquid: false, emissive: false, color: "#b64b3b", tiles: { all: 10 } },
  { id: 10, key: "glass", name: "Cristal", solid: true, opaque: false, liquid: false, emissive: false, color: "#a5e8ff", tiles: { all: 11 } },
  { id: 11, key: "glow", name: "Luz Neón", solid: true, opaque: true, liquid: false, emissive: true, color: "#ffdf68", tiles: { all: 12 } },
  { id: 12, key: "diamond", name: "Diamante", solid: true, opaque: true, liquid: false, emissive: true, color: "#44f2ea", tiles: { all: 13 } },
  { id: 13, key: "gold", name: "Oro", solid: true, opaque: true, liquid: false, emissive: false, color: "#f6c92d", tiles: { all: 14 } },
  { id: 14, key: "obsidian", name: "Obsidiana", solid: true, opaque: true, liquid: false, emissive: false, color: "#2d1f44", tiles: { all: 15 } },
  { id: 15, key: "portal", name: "Portal", solid: false, opaque: false, liquid: false, emissive: true, color: "#b05bff", tiles: { all: 16 } },
];

export const HOTBAR_DEFAULTS = [1, 2, 3, 5, 9, 10, 11, 12, 13];
export const BUILDABLE_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

export function getBlockDef(id) {
  return BLOCKS[id] || BLOCKS[0];
}

export function isSolidBlock(id) {
  return Boolean(BLOCKS[id]?.solid);
}

export function isOpaqueBlock(id) {
  return Boolean(BLOCKS[id]?.opaque);
}

export function inBounds(x, y, z) {
  return x >= 0 && x < WORLD_SIZE_X && y >= 0 && y < WORLD_HEIGHT && z >= 0 && z < WORLD_SIZE_Z;
}

export function blockIndex(x, y, z) {
  return (y * WORLD_SIZE_Z + z) * WORLD_SIZE_X + x;
}

export function blockKey(x, y, z) {
  return `${x},${y},${z}`;
}

export function mulberry32(seed) {
  let a = (Number(seed) || 1337) >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2D(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothNoise2D(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2D(ix, iz, seed);
  const b = hash2D(ix + 1, iz, seed);
  const c = hash2D(ix, iz + 1, seed);
  const d = hash2D(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

function fbm2D(x, z, seed) {
  let sum = 0;
  let amp = 0.55;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < 4; i++) {
    sum += smoothNoise2D(x * freq, z * freq, seed + i * 97) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.02;
  }
  return sum / norm;
}

export function generateBaseWorld(seed = 2026) {
  const s = (Number(seed) || 2026) >>> 0;
  const world = new Uint8Array(WORLD_SIZE_X * WORLD_HEIGHT * WORLD_SIZE_Z);
  const heights = new Uint8Array(WORLD_SIZE_X * WORLD_SIZE_Z);

  const set = (x, y, z, id) => {
    if (inBounds(x, y, z)) {
      world[blockIndex(x, y, z)] = id;
    }
  };
  const get = (x, y, z) => (inBounds(x, y, z) ? world[blockIndex(x, y, z)] : 0);

  const cx = Math.floor(WORLD_SIZE_X / 2);
  const cz = Math.floor(WORLD_SIZE_Z / 2);
  const lakeX = 46;
  const lakeZ = 20;

  for (let z = 0; z < WORLD_SIZE_Z; z++) {
    for (let x = 0; x < WORLD_SIZE_X; x++) {
      const n = fbm2D(x * 0.055, z * 0.055, s);
      const ridge = fbm2D(x * 0.11 + 19.3, z * 0.11 - 7.1, s + 401);
      let h = Math.round(13 + n * 11 + (ridge - 0.5) * 4);

      // Gentle lake basin
      const dlake = Math.hypot(x - lakeX, z - lakeZ);
      if (dlake < 10.5) {
        h = Math.min(h, Math.round(SEA_LEVEL - 3 + (dlake / 10.5) * 3.2));
      }

      // Flatten starter plaza smoothly around center (32, 32)
      const dcenter = Math.hypot(x - cx, z - cz);
      if (dcenter < 7.5) {
        const blend = Math.max(0, Math.min(1, (dcenter - 3.5) / 4));
        h = Math.round(17 * (1 - blend) + h * blend);
      }

      h = Math.max(3, Math.min(28, h));
      heights[z * WORLD_SIZE_X + x] = h;

      for (let y = 0; y <= Math.max(h, SEA_LEVEL); y++) {
        if (y === 0) {
          set(x, y, z, BLOCK_IDS.OBSIDIAN);
        } else if (y < h - 3) {
          const oreHash = hash2D(x * 13 + y * 7, z * 17 + y * 11, s + 999);
          if (y <= 7 && oreHash > 0.965) {
            set(x, y, z, BLOCK_IDS.DIAMOND);
          } else if (y <= 11 && oreHash > 0.935) {
            set(x, y, z, BLOCK_IDS.GOLD);
          } else {
            set(x, y, z, BLOCK_IDS.STONE);
          }
        } else if (y < h) {
          set(x, y, z, h <= SEA_LEVEL + 1 ? BLOCK_IDS.SAND : BLOCK_IDS.DIRT);
        } else if (y === h) {
          if (h <= SEA_LEVEL + 1) {
            set(x, y, z, BLOCK_IDS.SAND);
          } else {
            set(x, y, z, BLOCK_IDS.GRASS);
          }
        } else if (y <= SEA_LEVEL) {
          set(x, y, z, BLOCK_IDS.WATER);
        }
      }
    }
  }

  // Starter Ariadna Plaza + Glow Beacons at (32, 32)
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const px = cx + dx;
      const pz = cz + dz;
      const border = Math.abs(dx) === 2 || Math.abs(dz) === 2;
      set(px, 17, pz, border ? BLOCK_IDS.STONE : BLOCK_IDS.PLANKS);
      for (let clearY = 18; clearY <= 26; clearY++) {
        set(px, clearY, pz, BLOCK_IDS.AIR);
      }
    }
  }
  // Corner lantern posts on plaza
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    set(cx + dx, 18, cz + dz, BLOCK_IDS.WOOD);
    set(cx + dx, 19, cz + dz, BLOCK_IDS.GLOW);
  }
  // Small Ariadna Crystal Portal arch nearby at (cx + 6, 18..22, cz - 3)
  const archX = cx + 6;
  const archZ = cz - 3;
  const archBase = heights[archZ * WORLD_SIZE_X + archX];
  for (let dy = 0; dy <= 3; dy++) {
    set(archX, archBase + 1 + dy, archZ - 1, BLOCK_IDS.OBSIDIAN);
    set(archX, archBase + 1 + dy, archZ + 2, BLOCK_IDS.OBSIDIAN);
  }
  for (let dz = -1; dz <= 2; dz++) {
    set(archX, archBase + 4, archZ + dz, BLOCK_IDS.OBSIDIAN);
    if (dz === 0 || dz === 1) {
      for (let dy = 1; dy <= 2; dy++) {
        set(archX, archBase + dy, archZ + dz, BLOCK_IDS.PORTAL);
      }
    }
  }

  // Deterministic procedural oak trees
  const rand = mulberry32(s + 77);
  for (let i = 0; i < 42; i++) {
    const tx = 4 + Math.floor(rand() * (WORLD_SIZE_X - 8));
    const tz = 4 + Math.floor(rand() * (WORLD_SIZE_Z - 8));
    if (Math.hypot(tx - cx, tz - cz) < 9) continue;
    const ty = heights[tz * WORLD_SIZE_X + tx];
    if (ty <= SEA_LEVEL + 1 || ty > 25) continue;
    if (get(tx, ty, tz) !== BLOCK_IDS.GRASS) continue;

    const trunkH = 4 + Math.floor(rand() * 2);
    for (let y = 1; y <= trunkH; y++) {
      set(tx, ty + y, tz, BLOCK_IDS.WOOD);
    }
    const crownBase = ty + trunkH - 1;
    for (let dy = 0; dy <= 2; dy++) {
      const r = dy === 2 ? 1 : 2;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dy < 2 && Math.abs(dx) === r && Math.abs(dz) === r && rand() > 0.45) continue;
          if (dx === 0 && dz === 0 && dy < 2) continue;
          if (get(tx + dx, crownBase + dy, tz + dz) === BLOCK_IDS.AIR) {
            set(tx + dx, crownBase + dy, tz + dz, BLOCK_IDS.LEAVES);
          }
        }
      }
    }
    set(tx, crownBase + 3, tz, BLOCK_IDS.LEAVES);
  }

  return world;
}

export function getSurfaceY(world, x, z) {
  const ix = Math.max(0, Math.min(WORLD_SIZE_X - 1, Math.floor(x)));
  const iz = Math.max(0, Math.min(WORLD_SIZE_Z - 1, Math.floor(z)));
  for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
    const id = world[blockIndex(ix, y, iz)];
    if (id !== 0) return y;
  }
  return 1;
}

export function getSpawnPoint(world) {
  const sx = Math.floor(WORLD_SIZE_X / 2);
  const sz = Math.floor(WORLD_SIZE_Z / 2);
  const topY = getSurfaceY(world, sx, sz);
  return { x: sx + 0.5, y: topY + 1.05, z: sz + 0.5 };
}
