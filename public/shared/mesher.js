import {
  BLOCK_IDS,
  CHUNK_SIZE,
  WORLD_HEIGHT,
  WORLD_SIZE_X,
  WORLD_SIZE_Z,
  blockIndex,
  getBlockDef,
  inBounds,
  isOpaqueBlock,
} from "./blocks.js";

const ATLAS_GRID = 8;
const CELL_PX = 32;
const INNER_PX = 16;
const PAD_PX = 8;
const ATLAS_SIZE = ATLAS_GRID * CELL_PX; // 256

function tileUV(tileIdx) {
  const col = tileIdx % ATLAS_GRID;
  const row = Math.floor(tileIdx / ATLAS_GRID);
  const eps = 0.15;
  const u0 = (col * CELL_PX + PAD_PX + eps) / ATLAS_SIZE;
  const u1 = (col * CELL_PX + PAD_PX + INNER_PX - eps) / ATLAS_SIZE;
  // Canvas y=0 maps to OpenGL v=1 with flipY=true
  const vTop = 1 - (row * CELL_PX + PAD_PX + eps) / ATLAS_SIZE;
  const vBot = 1 - (row * CELL_PX + PAD_PX + INNER_PX - eps) / ATLAS_SIZE;
  return { u0, u1, vBot, vTop };
}

const FACES = [
  {
    name: "top",
    dir: [0, 1, 0],
    shade: 1.0,
    verts: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
  },
  {
    name: "bottom",
    dir: [0, -1, 0],
    shade: 0.62,
    verts: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  },
  {
    name: "east",
    dir: [1, 0, 0],
    shade: 0.8,
    verts: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
    ],
  },
  {
    name: "west",
    dir: [-1, 0, 0],
    shade: 0.78,
    verts: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
  },
  {
    name: "south",
    dir: [0, 0, 1],
    shade: 0.88,
    verts: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  {
    name: "north",
    dir: [0, 0, -1],
    shade: 0.86,
    verts: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  },
];

function getTileForFace(def, faceName) {
  const t = def.tiles || {};
  if (faceName === "top" && t.top !== undefined) return t.top;
  if (faceName === "bottom" && t.bottom !== undefined) return t.bottom;
  if (faceName !== "top" && faceName !== "bottom" && t.side !== undefined) return t.side;
  return t.all ?? 0;
}

function makePassBuffers() {
  return {
    positions: [],
    normals: [],
    uvs: [],
    colors: [],
    indices: [],
    vertexCount: 0,
  };
}

function finalizePass(buf) {
  return {
    positions: new Float32Array(buf.positions),
    normals: new Float32Array(buf.normals),
    uvs: new Float32Array(buf.uvs),
    colors: new Float32Array(buf.colors),
    indices: buf.vertexCount > 65535 ? new Uint32Array(buf.indices) : new Uint16Array(buf.indices),
    vertexCount: buf.vertexCount,
  };
}

/**
 * Generates hidden-face-culled chunk geometry for chunk (cx, cz).
 * Produces separate `opaque` and `translucent` mesh buffers.
 */
export function buildChunkMeshData(world, cx, cz) {
  const xStart = cx * CHUNK_SIZE;
  const zStart = cz * CHUNK_SIZE;
  const xEnd = Math.min(WORLD_SIZE_X, xStart + CHUNK_SIZE);
  const zEnd = Math.min(WORLD_SIZE_Z, zStart + CHUNK_SIZE);

  const opaque = makePassBuffers();
  const translucent = makePassBuffers();

  const getAt = (x, y, z) => (inBounds(x, y, z) ? world[blockIndex(x, y, z)] : BLOCK_IDS.AIR);

  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let z = zStart; z < zEnd; z++) {
      for (let x = xStart; x < xEnd; x++) {
        const id = world[blockIndex(x, y, z)];
        if (id === BLOCK_IDS.AIR) continue;

        const def = getBlockDef(id);
        const isOpaque = def.opaque;
        const target = isOpaque ? opaque : translucent;
        const isWater = id === BLOCK_IDS.WATER;

        for (let f = 0; f < FACES.length; f++) {
          const face = FACES[f];
          const nx = x + face.dir[0];
          const ny = y + face.dir[1];
          const nz = z + face.dir[2];

          // Cull outer world floor bottom at y=0
          if (ny < 0) continue;

          const neighbor = getAt(nx, ny, nz);
          if (isOpaque) {
            if (isOpaqueBlock(neighbor)) continue;
          } else {
            // Translucent blocks cull against same block type and against opaque solids
            if (neighbor === id || isOpaqueBlock(neighbor)) continue;
          }

          const tile = getTileForFace(def, face.name);
          const uv = tileUV(tile);
          const shade = def.emissive ? Math.max(face.shade, 0.94) : face.shade;
          const topDrop = isWater && getAt(x, y + 1, z) !== BLOCK_IDS.WATER ? 0.12 : 0;

          const base = target.vertexCount;
          for (let v = 0; v < 4; v++) {
            const p = face.verts[v];
            const py = p[1] === 1 ? y + 1 - topDrop : y;
            target.positions.push(x + p[0], py, z + p[2]);
            target.normals.push(face.dir[0], face.dir[1], face.dir[2]);
            target.colors.push(shade, shade, shade);
          }

          target.uvs.push(
            uv.u0, uv.vBot,
            uv.u1, uv.vBot,
            uv.u1, uv.vTop,
            uv.u0, uv.vTop
          );

          target.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          target.vertexCount += 4;
        }
      }
    }
  }

  return {
    opaque: finalizePass(opaque),
    translucent: finalizePass(translucent),
  };
}
