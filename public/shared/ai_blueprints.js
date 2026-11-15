import { BLOCK_IDS, BLOCKS, WORLD_HEIGHT, WORLD_SIZE_X, WORLD_SIZE_Z } from "./blocks.js";

export const ALIAS_TO_ID = new Map();
for (const b of BLOCKS) {
  ALIAS_TO_ID.set(b.key, b.id);
  ALIAS_TO_ID.set(b.name.toLowerCase(), b.id);
  ALIAS_TO_ID.set(String(b.id), b.id);
}

// Comprehensive bilingual (Spanish & English) voxel material synonyms
Object.entries({
  // Air / Vacío
  air: BLOCK_IDS.AIR,
  aire: BLOCK_IDS.AIR,
  vacío: BLOCK_IDS.AIR,
  vacio: BLOCK_IDS.AIR,
  void: BLOCK_IDS.AIR,
  hueco: BLOCK_IDS.AIR,

  // Grass / Pasto
  grass: BLOCK_IDS.GRASS,
  cesped: BLOCK_IDS.GRASS,
  césped: BLOCK_IDS.GRASS,
  pasto: BLOCK_IDS.GRASS,
  hierba: BLOCK_IDS.GRASS,
  turf: BLOCK_IDS.GRASS,

  // Dirt / Tierra
  dirt: BLOCK_IDS.DIRT,
  tierra: BLOCK_IDS.DIRT,
  barro: BLOCK_IDS.DIRT,
  mud: BLOCK_IDS.DIRT,
  soil: BLOCK_IDS.DIRT,

  // Stone / Piedra
  stone: BLOCK_IDS.STONE,
  piedra: BLOCK_IDS.STONE,
  roca: BLOCK_IDS.STONE,
  cobble: BLOCK_IDS.STONE,
  cobblestone: BLOCK_IDS.STONE,
  adoquín: BLOCK_IDS.STONE,
  adoquin: BLOCK_IDS.STONE,
  basalto: BLOCK_IDS.STONE,
  pebble: BLOCK_IDS.STONE,

  // Wood / Tronco
  wood: BLOCK_IDS.WOOD,
  tronco: BLOCK_IDS.WOOD,
  log: BLOCK_IDS.WOOD,
  madera_tronco: BLOCK_IDS.WOOD,
  oak_log: BLOCK_IDS.WOOD,
  leño: BLOCK_IDS.WOOD,
  stem: BLOCK_IDS.WOOD,

  // Planks / Tablas
  planks: BLOCK_IDS.PLANKS,
  madera: BLOCK_IDS.PLANKS,
  tablas: BLOCK_IDS.PLANKS,
  wood_planks: BLOCK_IDS.PLANKS,
  tablas_madera: BLOCK_IDS.PLANKS,
  roble: BLOCK_IDS.PLANKS,
  oak: BLOCK_IDS.PLANKS,
  board: BLOCK_IDS.PLANKS,

  // Leaves / Hojas
  leaves: BLOCK_IDS.LEAVES,
  hojas: BLOCK_IDS.LEAVES,
  follaje: BLOCK_IDS.LEAVES,
  foliage: BLOCK_IDS.LEAVES,
  arbol_hojas: BLOCK_IDS.LEAVES,
  ramas: BLOCK_IDS.LEAVES,

  // Sand / Arena
  sand: BLOCK_IDS.SAND,
  arena: BLOCK_IDS.SAND,
  arenisca: BLOCK_IDS.SAND,
  sandstone: BLOCK_IDS.SAND,

  // Water / Agua
  water: BLOCK_IDS.WATER,
  agua: BLOCK_IDS.WATER,
  water_block: BLOCK_IDS.WATER,
  liquido: BLOCK_IDS.WATER,
  fuente_agua: BLOCK_IDS.WATER,

  // Brick / Ladrillo
  brick: BLOCK_IDS.BRICK,
  bricks: BLOCK_IDS.BRICK,
  ladrillo: BLOCK_IDS.BRICK,
  ladrillos: BLOCK_IDS.BRICK,
  stone_brick: BLOCK_IDS.BRICK,
  pared_ladrillo: BLOCK_IDS.BRICK,

  // Glass / Cristal
  glass: BLOCK_IDS.GLASS,
  cristal: BLOCK_IDS.GLASS,
  vidrio: BLOCK_IDS.GLASS,
  ventana: BLOCK_IDS.GLASS,
  pane: BLOCK_IDS.GLASS,
  window: BLOCK_IDS.GLASS,

  // Glow / Luz Neón / Farol
  glow: BLOCK_IDS.GLOW,
  luz: BLOCK_IDS.GLOW,
  antorcha: BLOCK_IDS.GLOW,
  linterna: BLOCK_IDS.GLOW,
  neon: BLOCK_IDS.GLOW,
  neón: BLOCK_IDS.GLOW,
  farol: BLOCK_IDS.GLOW,
  lantern: BLOCK_IDS.GLOW,
  glowstone: BLOCK_IDS.GLOW,
  beacon: BLOCK_IDS.GLOW,
  baliza: BLOCK_IDS.GLOW,
  lampara: BLOCK_IDS.GLOW,
  lámpara: BLOCK_IDS.GLOW,
  torch: BLOCK_IDS.GLOW,

  // Diamond / Diamante
  diamond: BLOCK_IDS.DIAMOND,
  diamante: BLOCK_IDS.DIAMOND,
  diamantes: BLOCK_IDS.DIAMOND,
  gem: BLOCK_IDS.DIAMOND,
  gema: BLOCK_IDS.DIAMOND,

  // Gold / Oro
  gold: BLOCK_IDS.GOLD,
  oro: BLOCK_IDS.GOLD,
  golden: BLOCK_IDS.GOLD,
  lingote_oro: BLOCK_IDS.GOLD,
  lingote: BLOCK_IDS.GOLD,
  aureo: BLOCK_IDS.GOLD,
  áureo: BLOCK_IDS.GOLD,

  // Obsidian / Obsidiana
  obsidian: BLOCK_IDS.OBSIDIAN,
  obsidiana: BLOCK_IDS.OBSIDIAN,
  roca_negra: BLOCK_IDS.OBSIDIAN,

  // Portal
  portal: BLOCK_IDS.PORTAL,
  portal_block: BLOCK_IDS.PORTAL,
  teleporter: BLOCK_IDS.PORTAL,
  vortex: BLOCK_IDS.PORTAL,
  portal_dimensional: BLOCK_IDS.PORTAL,
}).forEach(([k, v]) => ALIAS_TO_ID.set(k.toLowerCase(), v));

export function resolveBlockId(val) {
  if (typeof val === "number" && Number.isInteger(val) && val >= 0 && val < BLOCKS.length) {
    return val;
  }
  const key = String(val ?? "").trim().toLowerCase();
  return ALIAS_TO_ID.get(key) ?? BLOCK_IDS.PLANKS;
}

export function extractJsonObject(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return null;
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function sanitizeBlueprint(parsed, anchor, maxBlocks = 240) {
  if (!parsed || typeof parsed !== "object") {
    return { reply: "", blocks: [] };
  }
  const reply = typeof parsed.reply === "string" ? parsed.reply.trim().slice(0, 260) : "";
  const list = Array.isArray(parsed.blocks) ? parsed.blocks : [];

  const ax = Math.max(4, Math.min(WORLD_SIZE_X - 5, Math.floor(Number(anchor?.x) || 32)));
  const ay = Math.max(1, Math.min(WORLD_HEIGHT - 14, Math.floor(Number(anchor?.y) || 18)));
  const az = Math.max(4, Math.min(WORLD_SIZE_Z - 5, Math.floor(Number(anchor?.z) || 32)));

  const dedup = new Map();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const dx = Math.max(-12, Math.min(12, Math.round(Number(item.dx ?? item.x ?? 0))));
    const dy = Math.max(-4, Math.min(18, Math.round(Number(item.dy ?? item.y ?? 0))));
    const dz = Math.max(-12, Math.min(12, Math.round(Number(item.dz ?? item.z ?? 0))));
    const t = resolveBlockId(item.t ?? item.type ?? item.block);

    const x = ax + dx;
    const y = ay + dy;
    const z = az + dz;

    if (x < 0 || x >= WORLD_SIZE_X || y < 1 || y >= WORLD_HEIGHT || z < 0 || z >= WORLD_SIZE_Z) {
      continue;
    }
    dedup.set(`${x},${y},${z}`, { x, y, z, t });
    if (dedup.size >= maxBlocks) break;
  }

  return {
    reply: reply || (dedup.size ? `Construí ${dedup.size} bloques.` : "Listo."),
    blocks: Array.from(dedup.values()),
  };
}

export function proceduralFallback(prompt, anchor) {
  const low = String(prompt || "").toLowerCase();
  const rel = [];

  // 1. Castillo / Fortaleza (castle, fortress, muralla, alcázar)
  if (
    low.includes("castillo") ||
    low.includes("fortaleza") ||
    low.includes("castle") ||
    low.includes("fortress") ||
    low.includes("alcazar") ||
    low.includes("alcázar") ||
    low.includes("muralla")
  ) {
    // Courtyard floor 7x7
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        rel.push({ dx, dy: 0, dz, t: BLOCK_IDS.STONE });
      }
    }
    // 4 Corner towers (at dx in {-3, 3}, dz in {-3, 3})
    for (const tx of [-3, 3]) {
      for (const tz of [-3, 3]) {
        for (let dy = 1; dy <= 4; dy++) {
          rel.push({ dx: tx, dy, dz: tz, t: BLOCK_IDS.STONE });
        }
        rel.push({ dx: tx, dy: 5, dz: tz, t: BLOCK_IDS.GLOW });
      }
    }
    // Curtain walls between towers
    for (let c = -2; c <= 2; c++) {
      // North wall (front gate at dx = 0)
      for (let dy = 1; dy <= 3; dy++) {
        if (c === 0 && (dy === 1 || dy === 2)) continue; // Gate entrance
        const t = c === 0 && dy === 3 ? BLOCK_IDS.PLANKS : BLOCK_IDS.BRICK;
        rel.push({ dx: c, dy, dz: -3, t });
      }
      // South wall
      for (let dy = 1; dy <= 3; dy++) {
        rel.push({ dx: c, dy, dz: 3, t: BLOCK_IDS.BRICK });
      }
      // West wall
      for (let dy = 1; dy <= 3; dy++) {
        rel.push({ dx: -3, dy, dz: c, t: BLOCK_IDS.BRICK });
      }
      // East wall
      for (let dy = 1; dy <= 3; dy++) {
        rel.push({ dx: 3, dy, dz: c, t: BLOCK_IDS.BRICK });
      }
    }
    // Courtyard throne / crest
    rel.push({ dx: 0, dy: 1, dz: 0, t: BLOCK_IDS.GOLD });
    rel.push({ dx: 0, dy: 2, dz: 0, t: BLOCK_IDS.DIAMOND });
    return sanitizeBlueprint(
      { reply: "Fortaleza medieval levantada con 4 torres, almenas y patio defensivo.", blocks: rel },
      anchor
    );
  }

  // 2. Faro / Torre (lighthouse, tower, atalaya, minarete)
  if (
    low.includes("faro") ||
    low.includes("torre") ||
    low.includes("lighthouse") ||
    low.includes("tower") ||
    low.includes("atalaya") ||
    low.includes("minarete")
  ) {
    // Stone foundation (3x3)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        rel.push({ dx, dy: 0, dz, t: BLOCK_IDS.STONE });
      }
    }
    // Shaft dy=1..8 with alternating red/white bands (BRICK / STONE)
    for (let dy = 1; dy <= 8; dy++) {
      const mat = dy % 2 === 1 ? BLOCK_IDS.BRICK : BLOCK_IDS.STONE;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dz === 0) continue; // Hollow shaft
          if ((dy === 1 || dy === 2) && dx === 0 && dz === -1) continue; // Entrance door
          if ((dy === 4 || dy === 7) && dx === 0 && dz === 1) {
            rel.push({ dx, dy, dz, t: BLOCK_IDS.GLASS }); // Window
          } else {
            rel.push({ dx, dy, dz, t: mat });
          }
        }
      }
    }
    // Balcony / catwalk at dy=9 (3x3 platform)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        rel.push({ dx, dy: 9, dz, t: BLOCK_IDS.STONE });
      }
    }
    // Lantern room at dy=10..11 (central glow beacon surrounded by glass)
    for (let dy = 10; dy <= 11; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dz === 0) {
            rel.push({ dx, dy, dz, t: BLOCK_IDS.GLOW });
          } else {
            rel.push({ dx, dy, dz, t: BLOCK_IDS.GLASS });
          }
        }
      }
    }
    // Cupola / finial
    rel.push({ dx: 0, dy: 12, dz: 0, t: BLOCK_IDS.GOLD });
    rel.push({ dx: 0, dy: 13, dz: 0, t: BLOCK_IDS.DIAMOND });
    return sanitizeBlueprint(
      { reply: "Faro marítimo erigido con baliza luminosa y mirador 360°.", blocks: rel },
      anchor
    );
  }

  // 3. Puente (bridge, pasarela, viaducto)
  if (
    low.includes("puente") ||
    low.includes("bridge") ||
    low.includes("pasarela") ||
    low.includes("viaducto")
  ) {
    // Spanning dz from -5 to +5 (11 blocks long), width dx from -1 to 1 (3 blocks wide)
    for (let dz = -5; dz <= 5; dz++) {
      const dist = Math.abs(dz);
      const dy = dist === 5 ? 0 : dist === 4 ? 1 : dist === 3 ? 2 : 3;
      // Wooden walkway
      for (let dx = -1; dx <= 1; dx++) {
        rel.push({ dx, dy, dz, t: BLOCK_IDS.PLANKS });
        // Stone structural piers under abutment and center
        if (dist === 0 || dist === 3) {
          for (let sy = 0; sy < dy; sy++) {
            rel.push({ dx, dy: sy, dz, t: BLOCK_IDS.STONE });
          }
        }
      }
      // Wooden railings
      rel.push({ dx: -1, dy: dy + 1, dz, t: BLOCK_IDS.WOOD });
      rel.push({ dx: 1, dy: dy + 1, dz, t: BLOCK_IDS.WOOD });
      // Glowstone lanterns at entrance ends and highest arch crest
      if (dist === 0 || dist === 5) {
        rel.push({ dx: -1, dy: dy + 2, dz, t: BLOCK_IDS.GLOW });
        rel.push({ dx: 1, dy: dy + 2, dz, t: BLOCK_IDS.GLOW });
      }
    }
    return sanitizeBlueprint(
      { reply: "Puente arqueado de madera y piedra armado con barandas y farolas.", blocks: rel },
      anchor
    );
  }

  // 4. Pirámide (piramide, pirámide, pyramid, zigurat)
  if (
    low.includes("piramide") ||
    low.includes("pirámide") ||
    low.includes("pyramid") ||
    low.includes("zigurat")
  ) {
    // 5 concentric stepped layers
    for (let layer = 0; layer < 5; layer++) {
      const r = 4 - layer;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) === r || Math.abs(dz) === r || layer >= 3) {
            let t = BLOCK_IDS.SAND;
            if (layer >= 2) t = BLOCK_IDS.GOLD;
            if (layer === 4) t = BLOCK_IDS.DIAMOND;
            rel.push({ dx, dy: layer, dz, t });
          }
        }
      }
    }
    // Hidden glowing core inside chamber
    rel.push({ dx: 0, dy: 1, dz: 0, t: BLOCK_IDS.GLOW });
    return sanitizeBlueprint(
      { reply: "Pirámide sagrada escalonada terminada con cúspide de oro y diamante.", blocks: rel },
      anchor
    );
  }

  // 5. Portal Ariadna (portal, teleport, stargate)
  if (
    low.includes("portal") ||
    low.includes("teleport") ||
    low.includes("stargate") ||
    low.includes("obsidiana")
  ) {
    // Stone foundation dais (5x3)
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        rel.push({ dx, dy: 0, dz, t: BLOCK_IDS.STONE });
      }
    }
    // Obsidian outer frame: columns at dx = -2 and dx = 2, height 1..5
    for (let dy = 1; dy <= 5; dy++) {
      rel.push({ dx: -2, dy, dz: 0, t: BLOCK_IDS.OBSIDIAN });
      rel.push({ dx: 2, dy, dz: 0, t: BLOCK_IDS.OBSIDIAN });
    }
    // Threshold (dy=1) and lintel (dy=6)
    for (let dx = -2; dx <= 2; dx++) {
      rel.push({ dx, dy: 1, dz: 0, t: BLOCK_IDS.OBSIDIAN });
      rel.push({ dx, dy: 6, dz: 0, t: BLOCK_IDS.OBSIDIAN });
    }
    // Portal energy field inside frame
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = 2; dy <= 5; dy++) {
        rel.push({ dx, dy, dz: 0, t: BLOCK_IDS.PORTAL });
      }
    }
    // Flanking ceremonial brazier lanterns
    rel.push({ dx: -3, dy: 1, dz: 0, t: BLOCK_IDS.OBSIDIAN });
    rel.push({ dx: -3, dy: 2, dz: 0, t: BLOCK_IDS.GLOW });
    rel.push({ dx: 3, dy: 1, dz: 0, t: BLOCK_IDS.OBSIDIAN });
    rel.push({ dx: 3, dy: 2, dz: 0, t: BLOCK_IDS.GLOW });
    return sanitizeBlueprint(
      { reply: "Portal dimensional Ariadna activado con marco de obsidiana y vórtice cósmico.", blocks: rel },
      anchor
    );
  }

  // 6. Árbol (arbol, árbol, tree, bosque, forest, roble)
  if (
    low.includes("arbol") ||
    low.includes("árbol") ||
    low.includes("tree") ||
    low.includes("bosque") ||
    low.includes("forest") ||
    low.includes("roble")
  ) {
    // Trunk with root flare at base
    for (let dy = 0; dy <= 5; dy++) {
      rel.push({ dx: 0, dy, dz: 0, t: BLOCK_IDS.WOOD });
    }
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      rel.push({ dx, dy: 0, dz, t: BLOCK_IDS.WOOD }); // Root flare
      rel.push({ dx, dy: 4, dz, t: BLOCK_IDS.WOOD }); // Branch offshoot
    }
    // Spherical organic canopy
    for (let dy = 4; dy <= 6; dy++) {
      const r = dy <= 5 ? 3 : 2;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx === 0 && dz === 0 && dy <= 5) continue; // Trunk
          if (Math.abs(dx) === r && Math.abs(dz) === r && dy === 5) continue; // Soften corners
          rel.push({ dx, dy, dz, t: BLOCK_IDS.LEAVES });
        }
      }
    }
    // Crown top
    rel.push({ dx: 0, dy: 7, dz: 0, t: BLOCK_IDS.LEAVES });
    // Hidden golden fruit & warm glowing heart
    rel.push({ dx: 0, dy: 4, dz: -1, t: BLOCK_IDS.GLOW });
    rel.push({ dx: -1, dy: 4, dz: 0, t: BLOCK_IDS.GOLD });
    rel.push({ dx: 1, dy: 4, dz: 0, t: BLOCK_IDS.GOLD });
    return sanitizeBlueprint(
      { reply: "Gran roble ancestral plantado con copa frondosa, linternas y frutos dorados.", blocks: rel },
      anchor
    );
  }

  // 7. Observatorio / Cúpula (observatorio, observatory, cupula, cúpula, dome, telescopio)
  if (
    low.includes("observatorio") ||
    low.includes("observatory") ||
    low.includes("cupula") ||
    low.includes("cúpula") ||
    low.includes("dome") ||
    low.includes("telescopio")
  ) {
    // Circular stone foundation (radius 3)
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        if (dx * dx + dz * dz <= 9) {
          rel.push({ dx, dy: 0, dz, t: BLOCK_IDS.STONE });
        }
      }
    }
    // Cylindrical brick rotunda walls (dy=1..3)
    for (let dy = 1; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        for (let dz = -3; dz <= 3; dz++) {
          const d2 = dx * dx + dz * dz;
          if (d2 >= 5 && d2 <= 9) {
            if (dz === -3 && dx === 0 && (dy === 1 || dy === 2)) continue; // Doorway
            rel.push({ dx, dy, dz, t: BLOCK_IDS.BRICK });
          }
        }
      }
    }
    // Hemispherical glass dome (dy=4..6)
    for (let dy = 4; dy <= 6; dy++) {
      const maxD2 = dy === 4 ? 8 : dy === 5 ? 5 : 2;
      for (let dx = -3; dx <= 3; dx++) {
        for (let dz = -3; dz <= 3; dz++) {
          if (dx * dx + dz * dz <= maxD2) {
            rel.push({ dx, dy, dz, t: BLOCK_IDS.GLASS });
          }
        }
      }
    }
    // Diagonal telescope pointing to celestial zenith
    rel.push({ dx: 0, dy: 2, dz: -1, t: BLOCK_IDS.GLOW }); // Eyepiece / console
    rel.push({ dx: 0, dy: 2, dz: 0, t: BLOCK_IDS.OBSIDIAN }); // Base mount
    rel.push({ dx: 0, dy: 3, dz: 1, t: BLOCK_IDS.OBSIDIAN }); // Barrel
    rel.push({ dx: 0, dy: 4, dz: 2, t: BLOCK_IDS.OBSIDIAN }); // Barrel through dome
    rel.push({ dx: 0, dy: 5, dz: 3, t: BLOCK_IDS.DIAMOND }); // Objective lens
    return sanitizeBlueprint(
      { reply: "Observatorio astronómico erigido con cúpula de cristal y telescopio de diamante.", blocks: rel },
      anchor
    );
  }

  // 8. Fuente / Plaza (fuente, fountain, plaza, square, estanque, pileta)
  if (
    low.includes("fuente") ||
    low.includes("fountain") ||
    low.includes("plaza") ||
    low.includes("square") ||
    low.includes("estanque") ||
    low.includes("pileta") ||
    low.includes("piscina")
  ) {
    // Plaza 9x9 paved with stone border and planks floor
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        const border = Math.max(Math.abs(dx), Math.abs(dz)) === 4;
        rel.push({ dx, dy: 0, dz, t: border ? BLOCK_IDS.STONE : BLOCK_IDS.PLANKS });
      }
    }
    // 4 Corner lampposts
    for (const cx of [-4, 4]) {
      for (const cz of [-4, 4]) {
        rel.push({ dx: cx, dy: 1, dz: cz, t: BLOCK_IDS.WOOD });
        rel.push({ dx: cx, dy: 2, dz: cz, t: BLOCK_IDS.WOOD });
        rel.push({ dx: cx, dy: 3, dz: cz, t: BLOCK_IDS.GLOW });
      }
    }
    // Central fountain basin 5x5 at dy=1
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) === 2) {
          rel.push({ dx, dy: 1, dz, t: BLOCK_IDS.BRICK }); // Basin rim
        } else {
          rel.push({ dx, dy: 1, dz, t: BLOCK_IDS.WATER }); // Basin pool
        }
      }
    }
    // Central fountain spout & geyser
    rel.push({ dx: 0, dy: 2, dz: 0, t: BLOCK_IDS.STONE });
    rel.push({ dx: 0, dy: 3, dz: 0, t: BLOCK_IDS.GLOW });
    rel.push({ dx: 0, dy: 4, dz: 0, t: BLOCK_IDS.DIAMOND });
    for (const [sx, sz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      rel.push({ dx: sx, dy: 2, dz: sz, t: BLOCK_IDS.WATER });
    }
    return sanitizeBlueprint(
      { reply: "Plaza señorial construida con farolas esquineras y fuente de agua cristalina.", blocks: rel },
      anchor
    );
  }

  // 9. Casa / Cabaña / Default (casa, cabaña, cabana, house, home, refugio, hogar)
  // Foundation 7x7
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      rel.push({ dx, dy: 0, dz, t: BLOCK_IDS.STONE });
    }
  }
  // Walls dy=1..3
  for (let dy = 1; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        const isEdge = Math.max(Math.abs(dx), Math.abs(dz)) === 3;
        if (!isEdge) continue;
        const isCorner = Math.abs(dx) === 3 && Math.abs(dz) === 3;
        if (isCorner) {
          rel.push({ dx, dy, dz, t: BLOCK_IDS.WOOD }); // Corner pillar
        } else if (dz === -3 && dx === 0 && (dy === 1 || dy === 2)) {
          continue; // Door opening
        } else if (dy === 2 && ((Math.abs(dx) === 3 && dz === 0) || (Math.abs(dz) === 3 && dx === 0))) {
          rel.push({ dx, dy, dz, t: BLOCK_IDS.GLASS }); // Window
        } else {
          rel.push({ dx, dy, dz, t: BLOCK_IDS.PLANKS });
        }
      }
    }
  }
  // Roof overhang dy=4
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      rel.push({ dx, dy: 4, dz, t: BLOCK_IDS.BRICK });
    }
  }
  // Pitched roof ridge dy=5
  for (let dz = -3; dz <= 3; dz++) {
    rel.push({ dx: 0, dy: 5, dz, t: BLOCK_IDS.BRICK });
  }
  // Hanging warm lantern inside
  rel.push({ dx: 0, dy: 3, dz: 0, t: BLOCK_IDS.GLOW });
  return sanitizeBlueprint(
    { reply: "Refugio acogedor construido con cimientos de piedra, paredes de madera y ventanas luminosas.", blocks: rel },
    anchor
  );
}

// Backward-compatible alias
export const generateFallbackBlueprint = proceduralFallback;

export const ARCHITECT_SYSTEM_PROMPT = `Eres Ariadna, arquitecta voxel 3D suprema dentro de AriadnaCraft (un mundo multiplayer voxel estilo Minecraft de 64x48x64 bloques).
Tu misión es diseñar estructuras arquitectónicas creativas, estéticas y bien proporcionadas cuando el jugador te lo pida, o conversar de forma amigable e inteligente.

FORMATO DE RESPUESTA:
Debes responder SIEMPRE con un único objeto JSON válido (sin formato markdown, sin comillas invertidas, sin texto antes ni después), con este esquema exacto:
{"reply": "mensaje breve y expresivo en español rioplatense", "blocks": [{"dx": 0, "dy": 0, "dz": 0, "t": "stone"}]}

REGLAS DE CONSTRUCCIÓN:
1. SI EL USUARIO NO PIDE CONSTRUIR (solo saluda, conversa o pregunta):
   - Devuelve "blocks": [].
   - En "reply", responde con calidez e ingenio rioplatense invitándolo a construir algo épico (ej: un castillo, faro, puente, pirámide, portal, árbol, observatorio, plaza o cabaña).

2. SI EL USUARIO PIDE CONSTRUIR O NOMBRA UNA ESTRUCTURA:
   - Coordenadas relativas: dx en [-8, 8], dy en [0, 14], dz en [-8, 8].
   - dy = 0 es el nivel de superficie o suelo del punto de anclaje. Nunca uses dy < 0 excepto para excavar cimientos mínimos.
   - Cantidad de bloques: entre 12 y 180 bloques bien aprovechados (máximo absoluto 240).
   - Estilo: simetría, ventanas de vidrio (glass), faroles o linternas (glow), remates con oro o diamante, y puertas abiertas para poder entrar.
   - Tipos de bloques válidos en "t":
     "air", "grass", "dirt", "stone", "wood", "planks", "leaves", "sand", "water", "brick", "glass", "glow", "diamond", "gold", "obsidian", "portal".

3. PRESETS CLAVE RECONOCIDOS BILINGÜES:
   - Castillo / Fortaleza (stone, brick, crenellations, towers, gates)
   - Faro / Torre (stone, brick bands, observation deck, glow beacon, glass lantern room)
   - Puente (stone abutments, wooden arched walkway, railings with glow lanterns)
   - Pirámide / Pyramid (stepped concentric layers of stone/sand, apex of gold and diamond)
   - Portal Ariadna (obsidian monumental frame, radiant portal blocks inside, glowing braziers)
   - Árbol / Tree (wood trunk widening at roots, organic spherical leaves canopy, hidden golden fruit)
   - Observatorio / Cúpula (cylindrical brick rotunda, hemispherical glass dome, diamond telescope)
   - Fuente / Plaza (stone paved square, wooden lampposts with glow, central water basin and geyser)
   - Casa / Cabaña (stone foundation, wooden walls, glass windows, pitched brick roof, warm lantern)

Responde SIEMPRE únicamente con el objeto JSON parseable.`;

// Backward-compatible alias
export const AI_ARCHITECT_SYSTEM_PROMPT = ARCHITECT_SYSTEM_PROMPT;

export const BLUEPRINT_PRESETS = [
  { id: "castillo", name: "Castillo / Fortaleza", keywords: ["castillo", "fortaleza", "castle", "fortress"] },
  { id: "faro", name: "Faro / Torre", keywords: ["faro", "torre", "lighthouse", "tower"] },
  { id: "puente", name: "Puente Arqueado", keywords: ["puente", "bridge"] },
  { id: "piramide", name: "Pirámide", keywords: ["piramide", "pirámide", "pyramid"] },
  { id: "portal", name: "Portal Ariadna", keywords: ["portal", "teleport"] },
  { id: "arbol", name: "Árbol Ancestral", keywords: ["arbol", "árbol", "tree", "bosque"] },
  { id: "observatorio", name: "Observatorio / Cúpula", keywords: ["observatorio", "cupula", "cúpula", "dome"] },
  { id: "fuente", name: "Fuente / Plaza", keywords: ["fuente", "plaza", "fountain"] },
  { id: "casa", name: "Casa / Cabaña", keywords: ["casa", "cabaña", "cabana", "house"] },
];
