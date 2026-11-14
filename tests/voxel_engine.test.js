import test from "node:test";
import assert from "node:assert/strict";
import {
  BLOCK_IDS,
  WORLD_HEIGHT,
  WORLD_SIZE_X,
  WORLD_SIZE_Z,
  blockIndex,
  generateBaseWorld,
  getSpawnPoint,
  isSolidBlock,
} from "../public/shared/blocks.js";
import { raycastVoxels } from "../public/shared/raycast.js";
import { buildChunkMeshData } from "../public/shared/mesher.js";

test("generateBaseWorld is deterministic and spawns safely", () => {
  const a = generateBaseWorld(2026);
  const b = generateBaseWorld(2026);
  const c = generateBaseWorld(9999);

  assert.equal(a.length, WORLD_SIZE_X * WORLD_HEIGHT * WORLD_SIZE_Z);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);

  // Bedrock floor at y=0
  for (let z = 0; z < WORLD_SIZE_Z; z += 7) {
    for (let x = 0; x < WORLD_SIZE_X; x += 7) {
      assert.equal(a[blockIndex(x, 0, z)], BLOCK_IDS.OBSIDIAN);
    }
  }

  const spawn = getSpawnPoint(a);
  const sx = Math.floor(spawn.x);
  const sy = Math.floor(spawn.y);
  const sz = Math.floor(spawn.z);
  assert.ok(isSolidBlock(a[blockIndex(sx, sy - 1, sz)]));
  assert.equal(a[blockIndex(sx, sy, sz)], BLOCK_IDS.AIR);
  assert.equal(a[blockIndex(sx, sy + 1, sz)], BLOCK_IDS.AIR);
});

test("raycastVoxels returns exact hit block and face normal", () => {
  const world = new Uint8Array(WORLD_SIZE_X * WORLD_HEIGHT * WORLD_SIZE_Z);
  world[blockIndex(10, 10, 10)] = BLOCK_IDS.STONE;
  world[blockIndex(10, 10, 12)] = BLOCK_IDS.WATER;

  // Ray from (10.5, 10.5, 15) towards -Z passes through water and hits stone on +Z face
  const hit = raycastVoxels(world, { x: 10.5, y: 10.5, z: 15 }, { x: 0, y: 0, z: -1 }, 8);
  assert.ok(hit);
  assert.equal(hit.x, 10);
  assert.equal(hit.y, 10);
  assert.equal(hit.z, 10);
  assert.equal(hit.nx, 0);
  assert.equal(hit.ny, 0);
  assert.equal(hit.nz, 1);
  assert.equal(hit.block, BLOCK_IDS.STONE);

  // Miss when maxDist is too short
  const miss = raycastVoxels(world, { x: 10.5, y: 10.5, z: 15 }, { x: 0, y: 0, z: -1 }, 2);
  assert.equal(miss, null);

  // Zero direction guard
  assert.equal(raycastVoxels(world, { x: 5, y: 5, z: 5 }, { x: 0, y: 0, z: 0 }, 5), null);
});

test("buildChunkMeshData performs hidden-face culling, separates water, and has outward CCW winding", () => {
  const world = new Uint8Array(WORLD_SIZE_X * WORLD_HEIGHT * WORLD_SIZE_Z);
  // Two adjacent opaque stone blocks at (2, 5, 2) and (3, 5, 2) => 10 exposed faces * 4 verts = 40 verts
  world[blockIndex(2, 5, 2)] = BLOCK_IDS.STONE;
  world[blockIndex(3, 5, 2)] = BLOCK_IDS.STONE;
  // One water block at (5, 5, 5) => 6 translucent faces * 4 verts = 24 verts
  world[blockIndex(5, 5, 5)] = BLOCK_IDS.WATER;

  const mesh = buildChunkMeshData(world, 0, 0);
  assert.equal(mesh.opaque.vertexCount, 40);
  assert.equal(mesh.opaque.indices.length, 60);
  assert.equal(mesh.translucent.vertexCount, 24);
  assert.equal(mesh.translucent.indices.length, 36);

  // Check geometric winding matches vertex normals for every triangle
  const pos = mesh.opaque.positions;
  const nrm = mesh.opaque.normals;
  const idx = mesh.opaque.indices;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3;
    const b = idx[i + 1] * 3;
    const c = idx[i + 2] * 3;
    const abx = pos[b] - pos[a];
    const aby = pos[b + 1] - pos[a + 1];
    const abz = pos[b + 2] - pos[a + 2];
    const acx = pos[c] - pos[a];
    const acy = pos[c + 1] - pos[a + 1];
    const acz = pos[c + 2] - pos[a + 2];
    const cx = aby * acz - abz * acy;
    const cy = abz * acx - abx * acz;
    const cz = abx * acy - aby * acx;
    const dot = cx * nrm[a] + cy * nrm[a + 1] + cz * nrm[a + 2];
    assert.ok(dot > 0, `Triangle ${i} winding inverted (dot=${dot})`);
  }

  // Check UVs are strictly inside [0, 1]
  for (let i = 0; i < mesh.opaque.uvs.length; i++) {
    assert.ok(mesh.opaque.uvs[i] > 0 && mesh.opaque.uvs[i] < 1);
  }
});
