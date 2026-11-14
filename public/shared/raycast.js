import { inBounds, blockIndex, BLOCK_IDS } from "./blocks.js";

/**
 * Pure Amanatides & Woo 3D DDA voxel raycaster.
 * Skips AIR and (by default) WATER so players can interact cleanly near lakes.
 */
export function raycastVoxels(world, origin, dir, maxDist = 7.0, options = {}) {
  const ignoreWater = options.ignoreWater !== false;
  let ox = origin.x;
  let oy = origin.y;
  let oz = origin.z;

  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (!len || !Number.isFinite(len)) return null;
  const dx = dir.x / len;
  const dy = dir.y / len;
  const dz = dir.z / len;

  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;

  let tMaxX = stepX > 0 ? (x + 1 - ox) * tDeltaX : stepX < 0 ? (ox - x) * tDeltaX : Infinity;
  let tMaxY = stepY > 0 ? (y + 1 - oy) * tDeltaY : stepY < 0 ? (oy - y) * tDeltaY : Infinity;
  let tMaxZ = stepZ > 0 ? (z + 1 - oz) * tDeltaZ : stepZ < 0 ? (oz - z) * tDeltaZ : Infinity;

  let nx = 0;
  let ny = 0;
  let nz = 0;
  let t = 0;

  for (let steps = 0; steps < 256; steps++) {
    if (t > maxDist) return null;

    if (inBounds(x, y, z)) {
      const id = world[blockIndex(x, y, z)];
      if (id !== BLOCK_IDS.AIR && !(ignoreWater && id === BLOCK_IDS.WATER)) {
        return { x, y, z, nx, ny, nz, block: id, distance: t };
      }
    }

    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        t = tMaxX;
        tMaxX += tDeltaX;
        x += stepX;
        nx = -stepX;
        ny = 0;
        nz = 0;
      } else {
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        z += stepZ;
        nx = 0;
        ny = 0;
        nz = -stepZ;
      }
    } else {
      if (tMaxY < tMaxZ) {
        t = tMaxY;
        tMaxY += tDeltaY;
        y += stepY;
        nx = 0;
        ny = -stepY;
        nz = 0;
      } else {
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        z += stepZ;
        nx = 0;
        ny = 0;
        nz = -stepZ;
      }
    }
  }

  return null;
}
