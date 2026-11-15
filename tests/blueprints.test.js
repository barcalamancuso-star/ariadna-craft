import test from "node:test";
import assert from "node:assert/strict";
import { BLOCK_IDS, BLOCKS, WORLD_HEIGHT, WORLD_SIZE_X, WORLD_SIZE_Z } from "../public/shared/blocks.js";
import {
  ALIAS_TO_ID,
  AI_ARCHITECT_SYSTEM_PROMPT,
  ARCHITECT_SYSTEM_PROMPT,
  BLUEPRINT_PRESETS,
  extractJsonObject,
  generateFallbackBlueprint,
  proceduralFallback,
  resolveBlockId,
  sanitizeBlueprint,
} from "../public/shared/ai_blueprints.js";

test("resolveBlockId resolves direct IDs, block names, and bilingual Spanish/English aliases", () => {
  // Direct numeric IDs
  assert.equal(resolveBlockId(BLOCK_IDS.STONE), BLOCK_IDS.STONE);
  assert.equal(resolveBlockId(BLOCK_IDS.DIAMOND), BLOCK_IDS.DIAMOND);
  assert.equal(resolveBlockId(BLOCK_IDS.OBSIDIAN), BLOCK_IDS.OBSIDIAN);
  assert.equal(resolveBlockId(BLOCK_IDS.PORTAL), BLOCK_IDS.PORTAL);

  // String numbers
  assert.equal(resolveBlockId("0"), BLOCK_IDS.AIR);
  assert.equal(resolveBlockId("1"), BLOCK_IDS.GRASS);
  assert.equal(resolveBlockId("15"), BLOCK_IDS.PORTAL);

  // Default fallback for unknown block
  assert.equal(resolveBlockId("bloque_inexistente_xyz"), BLOCK_IDS.PLANKS);
  assert.equal(resolveBlockId(null), BLOCK_IDS.PLANKS);
  assert.equal(resolveBlockId(undefined), BLOCK_IDS.PLANKS);

  // Bilingual Spanish / English synonyms
  const expectedMappings = [
    ["aire", BLOCK_IDS.AIR],
    ["vacío", BLOCK_IDS.AIR],
    ["void", BLOCK_IDS.AIR],
    ["grass", BLOCK_IDS.GRASS],
    ["pasto", BLOCK_IDS.GRASS],
    ["césped", BLOCK_IDS.GRASS],
    ["dirt", BLOCK_IDS.DIRT],
    ["tierra", BLOCK_IDS.DIRT],
    ["stone", BLOCK_IDS.STONE],
    ["piedra", BLOCK_IDS.STONE],
    ["cobble", BLOCK_IDS.STONE],
    ["cobblestone", BLOCK_IDS.STONE],
    ["adoquín", BLOCK_IDS.STONE],
    ["basalto", BLOCK_IDS.STONE],
    ["wood", BLOCK_IDS.WOOD],
    ["tronco", BLOCK_IDS.WOOD],
    ["log", BLOCK_IDS.WOOD],
    ["planks", BLOCK_IDS.PLANKS],
    ["madera", BLOCK_IDS.PLANKS],
    ["tablas", BLOCK_IDS.PLANKS],
    ["leaves", BLOCK_IDS.LEAVES],
    ["hojas", BLOCK_IDS.LEAVES],
    ["follaje", BLOCK_IDS.LEAVES],
    ["sand", BLOCK_IDS.SAND],
    ["arena", BLOCK_IDS.SAND],
    ["water", BLOCK_IDS.WATER],
    ["agua", BLOCK_IDS.WATER],
    ["brick", BLOCK_IDS.BRICK],
    ["ladrillo", BLOCK_IDS.BRICK],
    ["glass", BLOCK_IDS.GLASS],
    ["vidrio", BLOCK_IDS.GLASS],
    ["cristal", BLOCK_IDS.GLASS],
    ["glow", BLOCK_IDS.GLOW],
    ["luz", BLOCK_IDS.GLOW],
    ["linterna", BLOCK_IDS.GLOW],
    ["farol", BLOCK_IDS.GLOW],
    ["lantern", BLOCK_IDS.GLOW],
    ["diamond", BLOCK_IDS.DIAMOND],
    ["diamante", BLOCK_IDS.DIAMOND],
    ["gold", BLOCK_IDS.GOLD],
    ["oro", BLOCK_IDS.GOLD],
    ["obsidian", BLOCK_IDS.OBSIDIAN],
    ["obsidiana", BLOCK_IDS.OBSIDIAN],
    ["portal", BLOCK_IDS.PORTAL],
    ["portal_block", BLOCK_IDS.PORTAL],
  ];

  for (const [alias, id] of expectedMappings) {
    assert.equal(
      resolveBlockId(alias),
      id,
      `Expected alias '${alias}' to resolve to ID ${id}`
    );
  }
});

test("extractJsonObject extracts pure JSON, fenced markdown, and conversational embedded JSON", () => {
  // Pure JSON
  const pure = extractJsonObject('{"reply":"Listo","blocks":[]}');
  assert.deepEqual(pure, { reply: "Listo", blocks: [] });

  // Markdown codeblock with ```json
  const fenced = extractJsonObject('```json\n{"reply":"Torre levantada","blocks":[{"dx":0,"dy":1,"dz":0,"t":"stone"}]}\n```');
  assert.equal(fenced.reply, "Torre levantada");
  assert.equal(fenced.blocks.length, 1);

  // Markdown codeblock without json tag
  const bareFenced = extractJsonObject('```\n{"reply":"Ok","blocks":[]}\n```');
  assert.equal(bareFenced.reply, "Ok");

  // Conversational text before and after JSON
  const embedded = extractJsonObject(
    '¡Hola Cris! Aquí tienes el plano para la fortaleza:\n{"reply":"Fortaleza lista","blocks":[{"dx":1,"dy":0,"dz":1,"t":"brick"}]}\n¡Espero que te guste!'
  );
  assert.equal(embedded.reply, "Fortaleza lista");
  assert.equal(embedded.blocks[0].t, "brick");

  // Invalid JSON returns null
  assert.equal(extractJsonObject("no soy json en absoluto"), null);
  assert.equal(extractJsonObject(""), null);
  assert.equal(extractJsonObject(null), null);
  assert.equal(extractJsonObject(undefined), null);
});

test("sanitizeBlueprint clamps bounds, protects bedrock (y >= 1), deduplicates, and limits block counts", () => {
  const anchor = { x: 32, y: 18, z: 32 };

  // Bedrock protection (y < 1 is discarded)
  const underBedrock = sanitizeBlueprint(
    {
      reply: "Test",
      blocks: [
        { dx: 0, dy: -4, dz: 0, t: "stone" }, // with anchor y=2, y = 2 - 4 = -2 < 1 -> MUST BE DROPPED
        { dx: 0, dy: 1, dz: 0, t: "diamond" },  // y = 2 + 1 = 3 -> VALID
      ],
    },
    { x: 32, y: 2, z: 32 }
  );
  assert.equal(underBedrock.blocks.length, 1);
  assert.equal(underBedrock.blocks[0].t, BLOCK_IDS.DIAMOND);
  assert.equal(underBedrock.blocks[0].y, 3);

  // Out-of-bounds ceiling (y >= WORLD_HEIGHT)
  const aboveCeiling = sanitizeBlueprint(
    {
      reply: "Ceiling test",
      blocks: [
        { dx: 0, dy: 35, dz: 0, t: "glass" }, // y = 18 + 18 = 36 (dy clamped to 18) -> y=36 is valid (<48)
        { dx: 0, dy: 10, dz: 0, t: "gold" },
      ],
    },
    { x: 32, y: 45, z: 32 } // ay clamped to WORLD_HEIGHT - 14 = 34
  );
  for (const b of aboveCeiling.blocks) {
    assert.ok(b.y < WORLD_HEIGHT, `Block y=${b.y} must be strictly < ${WORLD_HEIGHT}`);
    assert.ok(b.y >= 1, `Block y=${b.y} must be >= 1`);
  }

  // Deduplication: multiple blocks at same voxel keep the last defined
  const dedupTest = sanitizeBlueprint(
    {
      reply: "Dedup",
      blocks: [
        { dx: 1, dy: 1, dz: 1, t: "stone" },
        { dx: 1, dy: 1, dz: 1, t: "gold" },
      ],
    },
    anchor
  );
  assert.equal(dedupTest.blocks.length, 1);
  assert.equal(dedupTest.blocks[0].t, BLOCK_IDS.GOLD);

  // Maximum blocks cap enforcement
  const manyBlocks = Array.from({ length: 300 }, (_, i) => ({
    dx: (i % 5) - 2,
    dy: Math.floor(i / 25),
    dz: (Math.floor(i / 5) % 5) - 2,
    t: "planks",
  }));
  const capped = sanitizeBlueprint({ reply: "Many", blocks: manyBlocks }, anchor, 50);
  assert.equal(capped.blocks.length, 50);

  // Default maxBlocks cap is 240
  const defaultCapped = sanitizeBlueprint({ reply: "Max", blocks: manyBlocks }, anchor);
  assert.ok(defaultCapped.blocks.length <= 240);
});

test("proceduralFallback generates rich, strictly bounded blueprints for all 9 architectural presets", () => {
  const presetsToTest = [
    { name: "castillo", prompt: "construí un castillo medieval con muralla" },
    { name: "fortaleza", prompt: "hacé una fortaleza inexpugnable con almenas" },
    { name: "faro", prompt: "levantá un faro marítimo con baliza luminosa" },
    { name: "torre", prompt: "construí una torre alta con mirador" },
    { name: "puente", prompt: "hacé un puente arqueado con farolas sobre el río" },
    { name: "piramide", prompt: "armá una gran piramide de oro y diamantes" },
    { name: "pirámide", prompt: "construí una pirámide con escalones" },
    { name: "portal", prompt: "activá un portal dimensional de obsidiana" },
    { name: "arbol", prompt: "plantá un gran arbol de roble con copa frondosa" },
    { name: "árbol", prompt: "hacé un árbol mágico ancestral con frutos dorados" },
    { name: "observatorio", prompt: "construí un observatorio astronomico con cúpula" },
    { name: "cupula", prompt: "haceme una cupula de cristal con telescopio" },
    { name: "fuente", prompt: "armá una fuente de agua en la plaza" },
    { name: "plaza", prompt: "diseñá una plaza pública adoquinada con farolas" },
    { name: "casa", prompt: "construí una casa acogedora con ventanas" },
    { name: "cabaña", prompt: "armá una cabaña de madera en el bosque" },
    { name: "default_fallback", prompt: "hacé algo bonito para vivir" },
  ];

  const testAnchors = [
    { x: 32, y: 18, z: 32 },  // Center spawn
    { x: 0, y: 0, z: 0 },    // Corner bottom
    { x: 63, y: 47, z: 63 }, // Corner top
    { x: -50, y: -20, z: 120 }, // Outside world bounds
  ];

  for (const preset of presetsToTest) {
    for (const anchor of testAnchors) {
      const blueprint = proceduralFallback(preset.prompt, anchor);

      assert.ok(blueprint, `Preset ${preset.name} returned a blueprint`);
      assert.ok(typeof blueprint.reply === "string" && blueprint.reply.length > 0, "Blueprint has reply");
      assert.ok(Array.isArray(blueprint.blocks), "Blueprint blocks is an array");
      assert.ok(
        blueprint.blocks.length >= 10,
        `Preset ${preset.name} at anchor (${anchor.x},${anchor.y},${anchor.z}) has ${blueprint.blocks.length} blocks (expected >= 10)`
      );
      assert.ok(
        blueprint.blocks.length <= 240,
        `Preset ${preset.name} has ${blueprint.blocks.length} blocks (must be <= 240)`
      );

      // Verify every single block is strictly within world boundaries and protects bedrock (y >= 1)
      for (const block of blueprint.blocks) {
        assert.ok(
          block.x >= 0 && block.x < WORLD_SIZE_X,
          `Block x=${block.x} outside bounds 0..${WORLD_SIZE_X - 1}`
        );
        assert.ok(
          block.y >= 1 && block.y < WORLD_HEIGHT,
          `Block y=${block.y} outside bounds 1..${WORLD_HEIGHT - 1} (bedrock protection)`
        );
        assert.ok(
          block.z >= 0 && block.z < WORLD_SIZE_Z,
          `Block z=${block.z} outside bounds 0..${WORLD_SIZE_Z - 1}`
        );
        assert.ok(
          Number.isInteger(block.t) && block.t >= 0 && block.t < BLOCKS.length,
          `Block t=${block.t} is not a valid block ID`
        );
      }
    }
  }
});

test("ARCHITECT_SYSTEM_PROMPT and exports compatibility are fully preserved", () => {
  assert.equal(typeof ARCHITECT_SYSTEM_PROMPT, "string");
  assert.ok(ARCHITECT_SYSTEM_PROMPT.includes("Ariadna"));
  assert.ok(ARCHITECT_SYSTEM_PROMPT.includes("JSON"));
  assert.ok(ARCHITECT_SYSTEM_PROMPT.includes("blocks"));

  // Check aliases
  assert.equal(AI_ARCHITECT_SYSTEM_PROMPT, ARCHITECT_SYSTEM_PROMPT);
  assert.equal(generateFallbackBlueprint, proceduralFallback);

  // Check BLUEPRINT_PRESETS catalog
  assert.ok(Array.isArray(BLUEPRINT_PRESETS));
  assert.equal(BLUEPRINT_PRESETS.length, 9);
  const ids = BLUEPRINT_PRESETS.map((p) => p.id);
  assert.ok(ids.includes("castillo"));
  assert.ok(ids.includes("faro"));
  assert.ok(ids.includes("puente"));
  assert.ok(ids.includes("piramide"));
  assert.ok(ids.includes("portal"));
  assert.ok(ids.includes("arbol"));
  assert.ok(ids.includes("observatorio"));
  assert.ok(ids.includes("fuente"));
  assert.ok(ids.includes("casa"));
});
