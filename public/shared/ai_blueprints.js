import { BLOCK_IDS, BLOCKS, WORLD_HEIGHT, WORLD_SIZE_X, WORLD_SIZE_Z } from "./blocks.js";

const ALIAS_TO_ID = new Map();
for (const b of BLOCKS) {
  ALIAS_TO_ID.set(b.key, b.id);
  ALIAS_TO_ID.set(b.name.toLowerCase(), b.id);
  ALIAS_TO_ID.set(String(b.id), b.id);
}
// Common Spanish / English synonyms from LLMs
Object.entries({
  aire: BLOCK_IDS.AIR,
  vacío: BLOCK_IDS.AIR,
  vacio: BLOCK_IDS.AIR,
  grass: BLOCK_IDS.GRASS,
  cesped: BLOCK_IDS.GRASS,
  césped: BLOCK_IDS.GRASS,
  pasto: BLOCK_IDS.GRASS,
  tierra: BLOCK_IDS.DIRT,
  dirt: BLOCK_IDS.DIRT,
  piedra: BLOCK_IDS.STONE,
  roca: BLOCK_IDS.STONE,
  stone: BLOCK_IDS.STONE,
  cobble: BLOCK_IDS.STONE,
  tronco: BLOCK_IDS.WOOD,
  log: BLOCK_IDS.WOOD,
  wood: BLOCK_IDS.PLANKS,
  madera: BLOCK_IDS.PLANKS,
  tablas: BLOCK_IDS.PLANKS,
  planks: BLOCK_IDS.PLANKS,
  hojas: BLOCK_IDS.LEAVES,
  leaves: BLOCK_IDS.LEAVES,
  arena: BLOCK_IDS.SAND,
  sand: BLOCK_IDS.SAND,
  agua: BLOCK_IDS.WATER,
  water: BLOCK_IDS.WATER,
  ladrillo: BLOCK_IDS.BRICK,
  ladrillos: BLOCK_IDS.BRICK,
  brick: BLOCK_IDS.BRICK,
  bricks: BLOCK_IDS.BRICK,
  cristal: BLOCK_IDS.GLASS,
  vidrio: BLOCK_IDS.GLASS,
  glass: BLOCK_IDS.GLASS,
  luz: BLOCK_IDS.GLOW,
  antorcha: BLOCK_IDS.GLOW,
  linterna: BLOCK_IDS.GLOW,
  neon: BLOCK_IDS.GLOW,
  glow: BLOCK_IDS.GLOW,
  glowstone: BLOCK_IDS.GLOW,
  diamante: BLOCK_IDS.DIAMOND,
  diamond: BLOCK_IDS.DIAMOND,
  oro: BLOCK_IDS.GOLD,
  gold: BLOCK_IDS.GOLD,
  obsidiana: BLOCK_IDS.OBSIDIAN,
  obsidian: BLOCK_IDS.OBSIDIAN,
  portal: BLOCK_IDS.PORTAL,
}).forEach(([k, v]) => ALIAS_TO_ID.set(k, v));

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
  const ay = Math.max(1, Math.min(WORLD_HEIGHT - 12, Math.floor(Number(anchor?.y) || 18)));
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

export function generateFallbackBlueprint(prompt, anchor) {
  const low = String(prompt || "").toLowerCase();
  const rel = [];

  if (low.includes("torre") || low.includes("faro")) {
    for (let y = 0; y < 9; y++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const edge = Math.abs(dx) === 1 || Math.abs(dz) === 1;
          if (!edge) continue;
          let t = y % 3 === 2 ? BLOCK_IDS.GLOW : BLOCK_IDS.BRICK;
          if (y === 0 && dx === 0 && dz === -1) t = BLOCK_IDS.AIR;
          if (y === 1 && dx === 0 && dz === -1) t = BLOCK_IDS.AIR;
          rel.push({ dx, dy: y, dz, t });
        }
      }
    }
    rel.push({ dx: 0, dy: 9, dz: 0, t: BLOCK_IDS.DIAMOND });
    return sanitizeBlueprint({ reply: "Torre luminosa levantada frente a vos.", blocks: rel }, anchor);
  }

  if (low.includes("piramide") || low.includes("pirámide")) {
    for (let layer = 0; layer < 4; layer++) {
      const r = 3 - layer;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) === r || Math.abs(dz) === r || layer === 3) {
            rel.push({ dx, dy: layer, dz, t: layer === 3 ? BLOCK_IDS.DIAMOND : BLOCK_IDS.GOLD });
          }
        }
      }
    }
    return sanitizeBlueprint({ reply: "Pirámide de oro y diamante construida.", blocks: rel }, anchor);
  }

  if (low.includes("puente")) {
    for (let dz = 0; dz <= 9; dz++) {
      const arch = Math.round(Math.sin((dz / 9) * Math.PI) * 2);
      for (let dx = -1; dx <= 1; dx++) {
        rel.push({ dx, dy: arch, dz, t: BLOCK_IDS.PLANKS });
      }
      rel.push({ dx: -1, dy: arch + 1, dz, t: dz % 3 === 0 ? BLOCK_IDS.GLOW : BLOCK_IDS.WOOD });
      rel.push({ dx: 1, dy: arch + 1, dz, t: dz % 3 === 0 ? BLOCK_IDS.GLOW : BLOCK_IDS.WOOD });
    }
    return sanitizeBlueprint({ reply: "Puente con barandas iluminadas armado.", blocks: rel }, anchor);
  }

  if (low.includes("portal")) {
    for (let dy = 0; dy <= 4; dy++) {
      rel.push({ dx: -1, dy, dz: 0, t: BLOCK_IDS.OBSIDIAN });
      rel.push({ dx: 2, dy, dz: 0, t: BLOCK_IDS.OBSIDIAN });
    }
    for (let dx = -1; dx <= 2; dx++) {
      rel.push({ dx, dy: 0, dz: 0, t: BLOCK_IDS.OBSIDIAN });
      rel.push({ dx, dy: 4, dz: 0, t: BLOCK_IDS.OBSIDIAN });
    }
    for (let dx = 0; dx <= 1; dx++) {
      for (let dy = 1; dy <= 3; dy++) {
        rel.push({ dx, dy, dz: 0, t: BLOCK_IDS.PORTAL });
      }
    }
    return sanitizeBlueprint({ reply: "Portal Ariadna activado.", blocks: rel }, anchor);
  }

  if (low.includes("arbol") || low.includes("árbol") || low.includes("bosque")) {
    for (let dy = 0; dy < 4; dy++) rel.push({ dx: 0, dy, dz: 0, t: BLOCK_IDS.WOOD });
    for (let dy = 3; dy <= 5; dy++) {
      const r = dy === 5 ? 1 : 2;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx === 0 && dz === 0 && dy === 3) continue;
          rel.push({ dx, dy, dz, t: BLOCK_IDS.LEAVES });
        }
      }
    }
    return sanitizeBlueprint({ reply: "Árbol plantado.", blocks: rel }, anchor);
  }

  // Default: cozy cabin ("casa")
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      rel.push({ dx, dy: 0, dz, t: BLOCK_IDS.STONE });
      rel.push({ dx, dy: 4, dz, t: BLOCK_IDS.BRICK });
      const wall = Math.abs(dx) === 2 || Math.abs(dz) === 2;
      if (wall) {
        for (let dy = 1; dy <= 3; dy++) {
          if (dx === 0 && dz === -2 && (dy === 1 || dy === 2)) {
            rel.push({ dx, dy, dz, t: BLOCK_IDS.AIR });
          } else if (dy === 2 && (dx === 0 || dz === 0)) {
            rel.push({ dx, dy, dz, t: BLOCK_IDS.GLASS });
          } else {
            rel.push({ dx, dy, dz, t: BLOCK_IDS.PLANKS });
          }
        }
      }
    }
  }
  rel.push({ dx: 0, dy: 3, dz: 0, t: BLOCK_IDS.GLOW });
  return sanitizeBlueprint({ reply: "Refugio acogedor construido con luz y ventanas.", blocks: rel }, anchor);
}

export const AI_ARCHITECT_SYSTEM_PROMPT = `Eres Ariadna, arquitecta voxel 3D dentro de AriadnaCraft (estilo Minecraft).
El jugador te pide construir algo o conversar.
Responde UNICAMENTE con un objeto JSON válido (sin markdown, sin texto extra) con esta estructura:
{"reply":"frase corta en español rioplatense","blocks":[{"dx":0,"dy":0,"dz":0,"t":"planks"}]}
Reglas:
- Si el usuario solo saluda o pregunta algo sin pedir construcción, devuelve "blocks":[] y responde amable en "reply".
- Si pide construir, usa entre 12 y 180 bloques con coordenadas relativas dx (-8..8), dy (0..12), dz (-8..8). dy=0 es el nivel del suelo del punto de anclaje.
- Tipos válidos de "t": "grass", "dirt", "stone", "wood", "planks", "leaves", "sand", "water", "brick", "glass", "glow", "diamond", "gold", "obsidian", "portal", "air".`;
