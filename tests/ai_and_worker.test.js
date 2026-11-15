import test from "node:test";
import assert from "node:assert/strict";
import { BLOCK_IDS } from "../public/shared/blocks.js";
import {
  extractJsonObject,
  generateFallbackBlueprint,
  resolveBlockId,
  sanitizeBlueprint,
} from "../public/shared/ai_blueprints.js";
import {
  buildProviderPlan,
  GEMINI_MODELS,
  GROQ_MODELS,
  MISTRAL_MODELS,
  runAiArchitect,
} from "../src/ai_router.js";
import { RoomCore } from "../src/room_core.js";
import { handleWorkerRequest, normalizeRoomName } from "../src/app.js";

function createMockSqlStorage() {
  const meta = new Map();
  const edits = new Map();
  const chat = [];
  let chatAutoId = 1;

  return {
    exec(query, ...params) {
      const q = query.replace(/\s+/g, " ").trim();
      if (q.startsWith("CREATE TABLE")) {
        return { toArray: () => [] };
      }
      if (q.startsWith("SELECT value FROM room_meta")) {
        const val = meta.get("seed");
        return { toArray: () => (val !== undefined ? [{ value: val }] : []) };
      }
      if (q.startsWith("INSERT OR IGNORE INTO room_meta")) {
        if (!meta.has("seed")) meta.set("seed", params[0]);
        return { toArray: () => [] };
      }
      if (q.startsWith("INSERT INTO room_meta")) {
        meta.set("seed", params[0]);
        return { toArray: () => [] };
      }
      if (q.startsWith("SELECT x, y, z, t FROM block_edits")) {
        return { toArray: () => Array.from(edits.values()) };
      }
      if (q.startsWith("INSERT INTO block_edits")) {
        const [k, x, y, z, t, by_name, updated_at] = params;
        edits.set(k, { k, x, y, z, t, by_name, updated_at });
        return { toArray: () => [] };
      }
      if (q.startsWith("DELETE FROM block_edits")) {
        edits.clear();
        return { toArray: () => [] };
      }
      if (q.startsWith("SELECT sender, kind, text, ts FROM chat_log")) {
        return {
          toArray: () =>
            chat
              .slice(-25)
              .reverse()
              .map(({ sender, kind, text, ts }) => ({ sender, kind, text, ts })),
        };
      }
      if (q.startsWith("INSERT INTO chat_log")) {
        const [sender, kind, text, ts] = params;
        chat.push({ id: chatAutoId++, sender, kind, text, ts });
        return { toArray: () => [] };
      }
      if (q.startsWith("DELETE FROM chat_log")) {
        while (chat.length > 40) chat.shift();
        return { toArray: () => [] };
      }
      throw new Error(`Unexpected SQL in test: ${q}`);
    },
  };
}

function createMockDoContext(sharedSql = createMockSqlStorage()) {
  const sockets = new Set();
  return {
    storage: { sql: sharedSql },
    acceptWebSocket(ws) {
      sockets.add(ws);
    },
    getWebSockets() {
      return Array.from(sockets);
    },
    removeSocket(ws) {
      sockets.delete(ws);
    },
  };
}

function createFakeSocketPair() {
  const sentToClient = [];
  let attachment = null;
  const server = {
    sent: sentToClient,
    closed: false,
    send(msg) {
      sentToClient.push(JSON.parse(msg));
    },
    serializeAttachment(obj) {
      attachment = structuredClone(obj);
    },
    deserializeAttachment() {
      return attachment;
    },
    close() {
      this.closed = true;
    },
  };
  const client = { _server: server };
  return [client, server];
}

test("AI blueprints parse markdown JSON, clamp bounds, and provide procedural fallbacks", () => {
  const raw = '```json\n{"reply":"Hecho","blocks":[{"dx":0,"dy":-50,"dz":0,"t":"madera"},{"dx":2,"dy":1,"dz":2,"t":"diamante"}]}\n```';
  const parsed = extractJsonObject(raw);
  assert.equal(parsed.reply, "Hecho");

  assert.equal(resolveBlockId("vidrio"), BLOCK_IDS.GLASS);
  assert.equal(resolveBlockId("luz"), BLOCK_IDS.GLOW);

  const sanitized = sanitizeBlueprint(parsed, { x: 32, y: 2, z: 32 });
  assert.equal(sanitized.blocks.length, 1, "Out-of-bounds below bedrock (y<1) is skipped safely");
  assert.equal(sanitized.blocks[0].t, BLOCK_IDS.DIAMOND);

  const clamped = sanitizeBlueprint(
    { reply: "Ok", blocks: [{ dx: 0, dy: -50, dz: 0, t: "madera" }] },
    { x: 32, y: 18, z: 32 }
  );
  assert.equal(clamped.blocks.length, 1);
  assert.equal(clamped.blocks[0].y, 14, "dy clamps cleanly to -4 relative to anchor");
  assert.equal(clamped.blocks[0].t, BLOCK_IDS.PLANKS);

  for (const kw of ["casa", "torre", "puente", "piramide", "portal", "arbol"]) {
    const fb = generateFallbackBlueprint(`construí ${kw}`, { x: 32, y: 18, z: 32 });
    assert.ok(fb.blocks.length >= 10, `Fallback for ${kw} should have blocks`);
  }
});

test("runAiArchitect cascades across providers on 429 and falls back cleanly without leaking secrets", async () => {
  const calls = [];
  const mockFetch = async (url) => {
    calls.push(url);
    if (url.includes("groq.com")) {
      return new Response("rate limited", { status: 429 });
    }
    if (url.includes("mistral.ai")) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  reply: "Torre lista",
                  blocks: [{ dx: 0, dy: 0, dz: 0, t: "brick" }],
                }),
              },
            },
          ],
        }),
        { status: 200 }
      );
    }
    return new Response("err", { status: 500 });
  };

  const env = {
    GROQ_API_KEY_1: "gsk_secret_1",
    MISTRAL_API_KEY: "mis_secret_2",
  };
  const res = await runAiArchitect({
    env,
    prompt: "hace una torre",
    anchor: { x: 20, y: 18, z: 20 },
    playerName: "Cris",
    fetchImpl: mockFetch,
  });

  assert.equal(res.ok, true);
  assert.equal(res.provider, "mistral");
  assert.equal(res.blocks.length, 1);
  assert.equal(calls.some((u) => u.includes("groq.com")), true);
  assert.equal(calls.some((u) => u.includes("mistral.ai")), true);

  // All providers failing -> procedural fallback
  const failRes = await runAiArchitect({
    env,
    prompt: "hace un puente",
    anchor: { x: 20, y: 18, z: 20 },
    fetchImpl: async () => new Response("down", { status: 503 }),
  });
  assert.equal(failRes.ok, true);
  assert.equal(failRes.fallbackUsed, true);
  assert.ok(failRes.blocks.length > 10);
});

test("runAiArchitect sends reasoning_effort=low only for openai/gpt-oss models", async () => {
  const seenPayloads = [];
  const mockFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    seenPayloads.push({ url, body });
    if (body.model === "openai/gpt-oss-120b") {
      return new Response("busy", { status: 429 });
    }
    if (body.model === "qwen/qwen3.8-27b") {
      return new Response("busy", { status: 429 });
    }
    if (body.model === "codestral-latest") {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  reply: "Listo",
                  blocks: [{ dx: 0, dy: 0, dz: 0, t: "stone" }],
                }),
              },
            },
          ],
        }),
        { status: 200 }
      );
    }
    return new Response("err", { status: 500 });
  };

  const res = await runAiArchitect({
    env: { GROQ_API_KEY_1: "g1", MISTRAL_API_KEY: "m1" },
    prompt: "torre",
    anchor: { x: 20, y: 18, z: 20 },
    fetchImpl: mockFetch,
  });

  assert.equal(res.ok, true);
  assert.equal(res.provider, "mistral");

  const gptOssCall = seenPayloads.find((p) => p.body.model === "openai/gpt-oss-120b");
  const qwenCall = seenPayloads.find((p) => p.body.model === "qwen/qwen3.8-27b");
  const mistralCall = seenPayloads.find((p) => p.body.model === "codestral-latest");
  assert.ok(gptOssCall, "Expected gpt-oss-120b to be tried first");
  assert.equal(gptOssCall.body.reasoning_effort, "low");
  assert.equal(gptOssCall.body.max_tokens, 3200);
  assert.ok(qwenCall, "Expected qwen3.8-27b to be tried after gpt-oss-120b 429");
  assert.equal(qwenCall.body.reasoning_effort, undefined);
  assert.ok(mistralCall, "Expected codestral-latest fallback");
  assert.equal(mistralCall.body.reasoning_effort, undefined);
  assert.equal(mistralCall.body.max_tokens, 3200);
});

test("buildProviderPlan rotates 3 Gemini accounts across all healthy models and handles 503/429 + thought parts", async () => {
  const fullEnv = {
    GEMINI_API_KEY_1: "gem_key_1",
    GEMINI_API_KEY_2: "gem_key_2",
    GEMINI_API_KEY_3: "gem_key_3",
    GROQ_API_KEY_1: "groq_key_1",
    GROQ_API_KEY_2: "groq_key_2",
    MISTRAL_API_KEY: "mistral_key_1",
  };

  const geminiPlan = buildProviderPlan(fullEnv, "gemini");
  assert.equal(geminiPlan[0].provider, "gemini");
  assert.equal(geminiPlan[0].model, "gemini-3.5-flash-lite");
  assert.equal(geminiPlan[0].keySlot, 1);
  assert.equal(geminiPlan[1].keySlot, 2);
  assert.equal(geminiPlan[2].keySlot, 3);

  // All 8 models appear in the first 8 candidates with staggered key slots
  const first8Models = geminiPlan.slice(0, 8).map((c) => c.model);
  assert.deepEqual(first8Models, GEMINI_MODELS);
  assert.ok(first8Models.includes("gemini-3.8-flash"));
  assert.ok(first8Models.includes("gemini-2.5-flash"));
  assert.ok(first8Models.includes("gemma-4-26b-a4b-it"));

  const mistralPlan = buildProviderPlan(fullEnv, "mistral");
  assert.deepEqual(
    mistralPlan.slice(0, 2).map((c) => `${c.provider}:${c.model}`),
    MISTRAL_MODELS.map((m) => `mistral:${m}`)
  );

  const groqPlan = buildProviderPlan(fullEnv, "groq");
  assert.deepEqual(
    groqPlan.slice(0, 3).map((c) => c.model),
    GROQ_MODELS
  );
  assert.equal(groqPlan[0].keySlot, 1);
  assert.equal(groqPlan[1].keySlot, 2);

  // Simulate 503/429 on early Gemini models including gemini-3.8-flash, then succeed on gemma-4-26b-a4b-it with thought part
  const triedUrls = [];
  const mockGeminiFetch = async (url) => {
    triedUrls.push(url);
    if (url.includes("gemma-4-26b-a4b-it")) {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    thought: true,
                    text: 'Thinking about {"reply":"wrong","blocks":[]} before final output',
                  },
                  {
                    text: JSON.stringify({
                      reply: "Observatorio listo",
                      blocks: [{ dx: 0, dy: 0, dz: 0, t: "glass" }],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 }
      );
    }
    return new Response("overloaded", { status: 503 });
  };

  const res = await runAiArchitect({
    env: fullEnv,
    prompt: "armá un observatorio",
    anchor: { x: 32, y: 18, z: 32 },
    preferredProvider: "gemini",
    fetchImpl: mockGeminiFetch,
  });

  assert.equal(res.ok, true);
  assert.equal(res.provider, "gemini");
  assert.equal(res.model, "gemma-4-26b-a4b-it");
  assert.equal(res.reply, "Observatorio listo");
  assert.equal(res.blocks.length, 1);
  assert.equal(res.blocks[0].t, BLOCK_IDS.GLASS);
  assert.equal(triedUrls.length, 8);
});

const fakeUpgrade = (client) => ({ status: 101, webSocket: client });

test("RoomCore handles multiplayer join, SQLite persistence across hibernation, block edits, and AI build", async () => {
  const sharedSql = createMockSqlStorage();
  const ctx = createMockDoContext(sharedSql);
  const core1 = new RoomCore(ctx, createFakeSocketPair, fakeUpgrade);

  // Player 1 joins
  const res1 = await core1.fetch(
    new Request("https://example.com/ws?room=principal&name=Cris", {
      headers: { Upgrade: "websocket" },
    })
  );
  assert.equal(res1.status, 101);
  const sock1 = ctx.getWebSockets()[0];
  assert.equal(sock1.sent[0].type, "init");
  assert.equal(sock1.sent[0].edits.length, 0);

  // Player 2 joins
  await core1.fetch(
    new Request("https://example.com/ws?room=principal&name=Mati", {
      headers: { Upgrade: "websocket" },
    })
  );
  const sock2 = ctx.getWebSockets()[1];
  assert.equal(sock2.sent[0].players.length, 1);
  assert.equal(sock1.sent[1].type, "player_join");

  // Player 1 places a valid block and tries an invalid bedrock break (y=0)
  await core1.webSocketMessage(sock1, JSON.stringify({ type: "block", x: 15, y: 18, z: 15, t: BLOCK_IDS.GOLD }));
  await core1.webSocketMessage(sock1, JSON.stringify({ type: "block", x: 15, y: 0, z: 15, t: BLOCK_IDS.AIR }));

  assert.ok(sock2.sent.some((m) => m.type === "block" && m.x === 15 && m.y === 18 && m.t === BLOCK_IDS.GOLD));
  assert.equal(sock2.sent.some((m) => m.type === "block" && m.y === 0), false);

  // Simulate DO wake-up after hibernation with fresh RoomCore on same SQLite storage
  const coreAfterWake = new RoomCore(ctx, createFakeSocketPair, fakeUpgrade);
  await coreAfterWake.fetch(
    new Request("https://example.com/ws?room=principal&name=Belen", {
      headers: { Upgrade: "websocket" },
    })
  );
  const sock3 = ctx.getWebSockets()[2];
  assert.equal(sock3.sent[0].type, "init");
  assert.equal(sock3.sent[0].edits.length, 1);
  assert.equal(sock3.sent[0].edits[0].t, BLOCK_IDS.GOLD);

  // AI build commits to SQLite and broadcasts
  const aiRes = await coreAfterWake.fetch(
    new Request("https://do.internal/internal/ai-build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blocks: [{ x: 25, y: 20, z: 25, t: BLOCK_IDS.DIAMOND }],
        reply: "Listo el diamante",
        provider: "groq",
        model: "gpt-oss-120b",
      }),
    })
  );
  assert.equal(aiRes.status, 200);
  assert.ok(sock1.sent.some((m) => m.type === "ai_build" && m.blocks[0].t === BLOCK_IDS.DIAMOND));
});

test("handleWorkerRequest routes /api/health, /api/ai, and static assets safely", async () => {
  assert.equal(normalizeRoomName(" Sala Prueba! "), "salaprueba");

  const env = {
    GROQ_API_KEY_1: "secret_never_leak",
    GROQ_API_KEY_2: "secret_never_leak_2",
    GEMINI_API_KEY_1: "secret_gem_1",
    GEMINI_API_KEY_2: "secret_gem_2",
    GEMINI_API_KEY_3: "secret_gem_3",
    MISTRAL_API_KEY: "secret_mistral_1",
    WORLD_ROOM: {
      idFromName: (n) => n,
      get: () => ({
        fetch: async () => new Response(JSON.stringify({ ok: true, applied: 1 }), { status: 200 }),
      }),
    },
    ASSETS: {
      fetch: async () => new Response("asset-ok", { status: 200 }),
    },
  };

  const health = await handleWorkerRequest(new Request("https://app.test/api/health"), env);
  assert.equal(health.status, 200);
  const healthJson = await health.json();
  assert.equal(healthJson.ok, true);
  assert.equal(healthJson.geminiAccounts, 3);
  assert.equal(healthJson.groqKeys, 2);
  assert.equal(healthJson.mistral, true);
  assert.equal(healthJson.aiProviders.groq, true);
  assert.equal(healthJson.aiProviders.groqKeys, 2);
  assert.equal(healthJson.aiProviders.gemini, true);
  assert.equal(healthJson.aiProviders.geminiAccounts, 3);
  assert.equal(healthJson.aiProviders.mistral, true);
  assert.equal(JSON.stringify(healthJson).includes("secret_"), false);

  const badAi = await handleWorkerRequest(
    new Request("https://app.test/api/ai", {
      method: "POST",
      body: JSON.stringify({ prompt: "" }),
    }),
    env
  );
  assert.equal(badAi.status, 400);

  const assetRes = await handleWorkerRequest(new Request("https://app.test/index.html"), env);
  assert.equal(await assetRes.text(), "asset-ok");
});
