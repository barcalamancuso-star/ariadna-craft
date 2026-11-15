import test from "node:test";
import assert from "node:assert/strict";
import { RoomCore, normalizeRoom } from "../src/room_core.js";

// ---------- fakes ----------
function createSql() {
  const meta = new Map();
  const edits = new Map();
  const chat = [];
  const profiles = new Map();
  let chatId = 1;
  const none = { toArray: () => [] };
  return {
    edits,
    chat,
    profiles,
    exec(query, ...params) {
      const q = query.replace(/\s+/g, " ").trim();
      if (q.startsWith("CREATE TABLE")) return none;
      if (q.startsWith("SELECT value FROM room_meta")) {
        const v = meta.get("seed");
        return { toArray: () => (v !== undefined ? [{ value: v }] : []) };
      }
      if (q.startsWith("INSERT OR IGNORE INTO room_meta")) {
        if (!meta.has("seed")) meta.set("seed", params[0]);
        return none;
      }
      if (q.startsWith("INSERT INTO room_meta")) {
        meta.set("seed", params[0]);
        return none;
      }
      if (q.startsWith("SELECT x, y, z, t FROM block_edits")) {
        return { toArray: () => Array.from(edits.values()).map(({ x, y, z, t }) => ({ x, y, z, t })) };
      }
      if (q.startsWith("INSERT INTO block_edits")) {
        const [k, x, y, z, t, by_name, updated_at] = params;
        for (const p of [x, y, z, t]) {
          if (!Number.isInteger(p)) throw new Error("NOT NULL constraint failed (non-integer bind)");
        }
        edits.set(k, { k, x, y, z, t, by_name, updated_at });
        return none;
      }
      if (q.startsWith("DELETE FROM block_edits")) {
        edits.clear();
        return none;
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
        chat.push({ id: chatId++, sender, kind, text, ts });
        return none;
      }
      if (q.startsWith("DELETE FROM chat_log")) {
        while (chat.length > 40) chat.shift();
        return none;
      }
      if (q.startsWith("SELECT uid, name, color, style")) {
        const row = profiles.get(params[0]);
        return { toArray: () => (row ? [{ ...row }] : []) };
      }
      if (q.startsWith("INSERT INTO player_profiles")) {
        const [uid, name, color, style, updated_at, inc] = params;
        const prev = profiles.get(uid);
        profiles.set(uid, {
          uid,
          name,
          color,
          style,
          x: prev ? prev.x : null,
          y: prev ? prev.y : null,
          z: prev ? prev.z : null,
          yaw: prev ? prev.yaw : 0,
          pitch: prev ? prev.pitch : -0.08,
          held: prev ? prev.held : 1,
          visits: prev ? prev.visits + Number(inc || 0) : 1,
          updated_at,
        });
        return none;
      }
      if (q.startsWith("UPDATE player_profiles SET x = NULL")) {
        for (const row of profiles.values()) {
          row.x = null;
          row.y = null;
          row.z = null;
          row.yaw = 0;
          row.pitch = -0.08;
        }
        return none;
      }
      if (q.startsWith("UPDATE player_profiles SET x = ?")) {
        const [x, y, z, yaw, pitch, held, updated_at, uid] = params;
        const row = profiles.get(uid);
        if (row) Object.assign(row, { x, y, z, yaw, pitch, held, updated_at });
        return none;
      }
      throw new Error(`Unexpected SQL: ${q}`);
    },
  };
}

function createCtx(sql = createSql()) {
  const sockets = new Set();
  return {
    sql,
    storage: { sql },
    acceptWebSocket: (ws) => sockets.add(ws),
    getWebSockets: () => Array.from(sockets),
    drop: (ws) => sockets.delete(ws),
  };
}

function socketPair() {
  const server = {
    sent: [],
    closedWith: null,
    attachment: null,
    send(m) {
      if (this.failSend) throw new Error("closed");
      this.sent.push(JSON.parse(m));
    },
    serializeAttachment(o) {
      // Real CF structured-clones and limits to 2048 bytes.
      const s = JSON.stringify(o);
      assert.ok(s.length <= 2048, "attachment must stay <= 2048 bytes");
      this.attachment = JSON.parse(s);
    },
    deserializeAttachment() {
      return this.attachment === null ? null : JSON.parse(JSON.stringify(this.attachment));
    },
    close(code, reason) {
      if (this.closedWith) throw new Error("already closed");
      this.closedWith = { code, reason };
    },
    types() {
      return this.sent.map((m) => m.type);
    },
  };
  return [{ _server: server }, server];
}
const upgrade = (client) => ({ status: 101, webSocket: client });

function makeCore(ctx = createCtx()) {
  const core = new RoomCore(ctx, socketPair, upgrade);
  let t = 1_000_000;
  core.now = () => t;
  core.advance = (ms) => {
    t += ms;
  };
  return core;
}

async function join(core, ctx, query = "room=t&name=Cris") {
  const res = await core.fetch(new Request(`https://x.test/ws?${query}`, { headers: { Upgrade: "websocket" } }));
  assert.equal(res.status, 101);
  const socks = ctx.getWebSockets();
  return socks[socks.length - 1];
}
const send = (core, ws, obj) => core.webSocketMessage(ws, typeof obj === "string" ? obj : JSON.stringify(obj));

// ---------- join / leave ----------
test("join: init to self, player_join to others only, unique colors, normalized room, sanitized name", async () => {
  const ctx = createCtx();
  const core = makeCore(ctx);
  const a = await join(core, ctx, "room=Sala%20X!&name=%3Cb%3EAna%3C/b%3E%0A");
  assert.equal(a.sent[0].type, "init");
  assert.equal(a.sent[0].room, "salax");
  assert.equal(a.sent[0].selfId, a.attachment.id);
  assert.equal(a.attachment.name, "bAna/b");
  assert.deepEqual(a.sent[0].players, []);
  assert.equal(a.types().includes("player_join"), false, "joiner must not get its own player_join");

  const b = await join(core, ctx, "room=salax&name=Beto");
  assert.equal(b.sent[0].players.length, 1);
  assert.equal(b.sent[0].players[0].id, a.attachment.id);
  assert.equal(a.sent[1].type, "player_join");
  assert.equal(a.sent[1].player.id, b.attachment.id);
  assert.notEqual(a.attachment.color, b.attachment.color, "second player gets a free color");
});

test("join: empty/overlong names fall back or truncate, missing room -> principal", async () => {
  const ctx = createCtx();
  const core = makeCore(ctx);
  const a = await join(core, ctx, `name=${"z".repeat(100)}`);
  assert.equal(a.attachment.name.length, 20);
  assert.equal(a.sent[0].room, "principal");
  const b = await join(core, ctx, "name=%3C%3E");
  assert.match(b.attachment.name, /^Viajero-\d{3}$/);
  assert.equal(normalizeRoom("  Mi_Sala-1 ñ"), "mi_sala-1");
});

test("join: room cap returns 503 and non-websocket /ws returns 426", async () => {
  const ctx = createCtx();
  const core = makeCore(ctx);
  for (let i = 0; i < 24; i++) await join(core, ctx, `name=p${i}`);
  const full = await core.fetch(new Request("https://x.test/ws", { headers: { Upgrade: "websocket" } }));
  assert.equal(full.status, 503);
  assert.equal(ctx.getWebSockets().length, 24);

  const plain = await makeCore().fetch(new Request("https://x.test/ws"));
  assert.equal(plain.status, 426);
});

test("join: init send failure closes the socket and returns 500 without announcing join", async () => {
  const ctx = createCtx();
  const other = makeCore(ctx);
  const a = await join(other, ctx, "name=A");
  const failing = new RoomCore(
    ctx,
    () => {
      const [c, s] = socketPair();
      s.failSend = true;
      return [c, s];
    },
    upgrade
  );
  const res = await failing.fetch(new Request("https://x.test/ws", { headers: { Upgrade: "websocket" } }));
  assert.equal(res.status, 500);
  assert.equal(a.types().includes("player_join"), false);
});

test("leave: webSocketClose notifies others (not self), sanitizes invalid close codes, tolerates double close", async () => {
  const ctx = createCtx();
  const core = makeCore(ctx);
  const a = await join(core, ctx, "name=A");
  const b = await join(core, ctx, "name=B");
  const bId = b.attachment.id;
  await core.webSocketClose(b, 1006, "abnormal");
  assert.deepEqual(a.sent.at(-1), { type: "player_leave", id: bId });
  assert.equal(b.types().includes("player_leave"), false);
  assert.equal(b.closedWith.code, 1000, "1006 is not a legal close() code");
  await core.webSocketClose(b, 1000, "again"); // must not throw
  await core.webSocketError(b); // must not throw

  const c = await join(core, ctx, "name=C");
  await core.webSocketClose(c, 4001, "x".repeat(500));
  assert.equal(c.closedWith.code, 4001);
  assert.ok(c.closedWith.reason.length <= 123);
});

test("webSocketError emits player_leave once per call and tolerates missing attachment", async () => {
  const ctx = createCtx();
  const core = makeCore(ctx);
  const a = await join(core, ctx, "name=A");
  const b = await join(core, ctx, "name=B");
  await core.webSocketError(b);
  assert.equal(a.sent.at(-1).type, "player_leave");
  const ghost = socketPair()[1];
  await core.webSocketError(ghost);
  await core.webSocketClose(ghost, 1000, "");
});

// ---------- ping ----------
test("ping: echoes numeric t, never reflects arbitrary objects", async () => {
  const ctx = createCtx();
  const core = makeCore(ctx);
  const a = await join(core, ctx);
  await send(core, a, { type: "ping", t: 123 });
  await send(core, a, { type: "ping", t: { big: "x".repeat(5000) } });
  await send(core, a, { type: "ping" });
  const pongs = a.sent.filter((m) => m.type === "pong");
  assert.equal(pongs[0].t, 123);
  assert.equal(typeof pongs[1].t, "number");
  assert.equal(typeof pongs[2].t, "number");
});

// ---------- move ----------
test("move: broadcast excludes sender, clamps, ignores junk, keeps previous values", async () => {
  const ctx = createCtx();
  const core = makeCore(ctx);
  const a = await join(core, ctx, "name=A");
  const b = await join(core, ctx, "name=B");
  const before = a.sent.length;

  await send(core, a, { type: "move", x: 10, y: 20, z: 12, yaw: 1.5, pitch: 5, held: 99, vr: true });
  assert.equal(a.sent.length, before, "no self echo for move");
  const mv = b.sent.at(-1);
  assert.equal(mv.type, "player_move");
  assert.equal(mv.player.id, a.attachment.id);
  assert.equal(mv.player.x, 10);
  assert.equal(mv.player.pitch, 1.58);
  assert.equal(mv.player.held, 15);
  assert.equal(mv.player.vr, true);

  await send(core, a, { type: "move", x: 9999, y: -50, z: -9, yaw: 7 });
  const m2 = b.sent.at(-1).player;
  assert.equal(m2.x, 63.8);
  assert.equal(m2.y, 0.2);
  assert.equal(m2.z, 0.2);
  assert.equal(m2.vr, true, "omitted vr keeps previous value");

  await send(core, a, { type: "move", x: null, y: "abc", z: {}, yaw: Infinity, pitch: NaN, held: 1.5 });
  const m3 = b.sent.at(-1).player;
  assert.equal(m3.x, 63.8, "null x must not teleport to 0.2");
  assert.equal(m3.y, 0.2);
  assert.equal(m3.held, 15, "non-integer held keeps previous");
  assert.equal(m3.yaw, 7);
});

test("move: attachment survives hibernation (fresh RoomCore on same ctx)", async () => {
  const ctx = createCtx();
  const core1 = makeCore(ctx);
  const a = await join(core1, ctx, "name=Ana");
  const b = await join(core1, ctx, "name=Beto");
  await send(core1, a, { type: "move", x: 5, y: 25, z: 6, yaw: 2, pitch: 0.1, held: 4 });

  const core2 = makeCore(ctx); // woken instance, empty memory
  await send(core2, a, { type: "chat", text: "hola" });
  assert.equal(b.sent.at(-1).sender, "Ana");

  const c = await join(core2, ctx, "name=Cata");
  const seen = c.sent[0].players.find((p) => p.id === a.attachment.id);
  assert.equal(seen.x, 5);
  assert.equal(seen.held, 4);
  await send(core2, a, { type: "move", z: 30 });
  const mv = b.sent.at(-1).player;
  assert.equal(mv.x, 5, "partial move after wake keeps stored x");
  assert.equal(mv.z, 30);
});

// ---------- block ----------
test("block: valid edits persist and echo to everyone including sender", async () => {
  const ctx = createCtx();
  const core = makeCore(ctx);
  const a = await join(core, ctx, "name=A");
  const b = await join(core, ctx, "name=B");
  await send(core, a, { type: "block", x: 10.9, y: 30, z: 10, t: 3 });
  for (const s of [a, b]) {
    const m = s.sent.at(-1);
    assert.deepEqual(m, { type: "block", x: 10, y: 30, z: 10, t: 3, by: a.attachment.id });
  }
  assert.equal(ctx.sql.edits.size, 1);
  await send(core, a, { type: "block", x: 10, y: 30, z: 10, t: 0 });
  assert.equal(ctx.sql.edits.size, 1, "upsert by key keeps a single row");
  assert.equal([...ctx.sql.edits.values()][0].t, 0);
});

test("block: malformed / out-of-range edits are dropped silently (no throw, no broadcast, no SQL)", async () => {
  const ctx = createCtx();
  const core = makeCore(ctx);
  const a = await join(core, ctx, "name=A");
  const b = await join(core, ctx, "name=B");
  const base = b.sent.length;
  const bad = [
    { type: "block" },
    { type: "block", x: null, y: null, z: null, t: null },
    { type: "block", x: null, y: 5, z: null, t: 3 },
    { type: "block", x: "10", y: 20, z: 10, t: 3 },
    { type: "block", x: NaN, y: 20, z: 10, t: 3 },
    { type: "block", x: 1e9, y: 20, z: 10, t: 3 },
    { type: "block", x: -1, y: 20, z: 10, t: 3 },
    { type: "block", x: 1, y: 0, z: 1, t: 0 }, // bedrock
    { type: "block", x: 1, y: 48, z: 1, t: 1 },
    { type: "block", x: 1, y: 20, z: 64, t: 1 },
    { type: "block", x: 1, y: 20, z: 1, t: 16 },
    { type: "block", x: 1, y: 20, z: 1, t: -1 },
    { type: "block", x: [1], y: 20, z: 1, t: 1 },
    { type: "block", x: true, y: 20, z: 1, t: 1 },
  ];
  for (const m of bad) await send(core, a, m);
  assert.equal(b.sent.length, base);
  assert.equal(ctx.sql.edits.size, 0);
});

// ---------- chat ----------
test("chat: echo to all, trims/truncates, strips control chars, ignores empty, attributes sender from attachment", async () => {
  const ctx = createCtx();
  const core = makeCore(ctx);
  const a = await join(core, ctx, "name=Ana");
  const b = await join(core, ctx, "name=Beto");
  await send(core, a, { type: "chat", text: "  hola\u0000\nmundo  ", sender: "Hacker" });
  for (const s of [a, b]) {
    const m = s.sent.at(-1);
    assert.equal(m.type, "chat");
    assert.equal(m.sender, "Ana");
    assert.equal(m.text, "hola mundo");
  }
  const n = b.sent.length;
  core.advance(2000);
  await send(core, a, { type: "chat", text: "   " });
  await send(core, a, { type: "chat", text: 42 });
  await send(core, a, { type: "chat" });
  assert.equal(b.sent.length, n);
  await send(core, a, { type: "chat", text: "y".repeat(5000) });
  assert.equal(b.sent.at(-1).text.length, 300);
  assert.equal(ctx.sql.chat.every((c) => c.sender.length <= 24), true);
});

test("chat: history is capped at 40 rows and init returns last 25 in order", async () => {
  const ctx = createCtx();
  const core = makeCore(ctx);
  const a = await join(core, ctx, "name=A");
  for (let i = 0; i < 50; i++) {
    core.advance(1500);
    await send(core, a, { type: "chat", text: `m${i}` });
  }
  assert.equal(ctx.sql.chat.length, 40);
  const b = await join(core, ctx, "name=B");
  const hist = b.sent[0].chat;
  assert.equal(hist.length, 25);
  assert.equal(hist[0].text, "m25");
  assert.equal(hist.at(-1).text, "m49");
});

// ---------- reset_world ----------
test("reset_world: clears edits, new seed, broadcast to all, 10s cooldown", async () => {
  const ctx = createCtx();
  const core = makeCore(ctx);
  const a = await join(core, ctx, "name=A");
  const b = await join(core, ctx, "name=B");
  await send(core, a, { type: "block", x: 3, y: 10, z: 3, t: 2 });
  await send(core, a, { type: "reset_world" });
  const reset = b.sent.at(-1);
  assert.equal(reset.type, "world_reset");
  assert.ok(Number.isInteger(reset.seed) && reset.seed >= 1000);
  assert.equal(reset.chat.kind, "system");
  assert.equal(ctx.sql.edits.size, 0);
  assert.ok(a.types().includes("world_reset"), "sender receives reset too");

  await send(core, b, { type: "block", x: 4, y: 10, z: 4, t: 2 });
  await send(core, b, { type: "reset_world" });
  assert.equal(ctx.sql.edits.size, 1, "second reset within cooldown is refused");
  assert.deepEqual(b.sent.at(-1), { type: "error", code: "rate_limited", for: "reset_world" });

  core.advance(10_001);
  await send(core, b, { type: "reset_world" });
  assert.equal(ctx.sql.edits.size, 0);

  const c = await join(core, ctx, "name=C");
  assert.notEqual(c.sent[0].seed, 2026);
  assert.equal(c.sent[0].edits.length, 0);
});

// ---------- malformed / size / abuse ----------
test("malformed frames never throw and never broadcast", async () => {
  const ctx = createCtx();
  const core = makeCore(ctx);
  const a = await join(core, ctx, "name=A");
  const b = await join(core, ctx, "name=B");
  const base = b.sent.length;
  const frames = [
    "not json",
    "",
    "null",
    "42",
    "[1,2]",
    '"str"',
    "{}",
    '{"type":null}',
    '{"type":"nope"}',
    '{"type":"__proto__"}',
    '{"type":{"x":1}}',
    new ArrayBuffer(8),
    "x".repeat(9000),
    JSON.stringify({ type: "chat", text: "z".repeat(20000) }),
  ];
  for (const f of frames) await core.webSocketMessage(a, f);
  assert.equal(b.sent.length, base);
  assert.equal(a.sent.at(-1).type === "error", false);
});

test("socket without attachment is ignored", async () => {
  const ctx = createCtx();
  const core = makeCore(ctx);
  const a = await join(core, ctx, "name=A");
  const ghost = socketPair()[1];
  await send(core, ghost, { type: "chat", text: "boo" });
  await send(core, ghost, { type: "move", x: 1 });
  assert.equal(a.types().includes("chat"), false);
  assert.equal(a.types().includes("player_move"), false);
});

test("rate limit: chat flood is throttled with error, refills over time", async () => {
  const ctx = createCtx();
  const core = makeCore(ctx);
  const a = await join(core, ctx, "name=A");
  const b = await join(core, ctx, "name=B");
  for (let i = 0; i < 20; i++) await send(core, a, { type: "chat", text: `s${i}` });
  assert.equal(b.sent.filter((m) => m.type === "chat").length, 4);
  assert.ok(a.sent.some((m) => m.type === "error" && m.for === "chat"));
  core.advance(3000);
  await send(core, a, { type: "chat", text: "later" });
  assert.equal(b.sent.at(-1).text, "later");
  // other players are unaffected
  await send(core, b, { type: "chat", text: "mine" });
  assert.equal(a.sent.at(-1).text, "mine");
});

test("rate limit: move and block floods are capped; persistent abuse closes with 1008", async () => {
  const ctx = createCtx();
  const core = makeCore(ctx);
  const a = await join(core, ctx, "name=A");
  const b = await join(core, ctx, "name=B");
  for (let i = 0; i < 200; i++) await send(core, a, { type: "move", x: 1 + (i % 50) });
  assert.equal(b.sent.filter((m) => m.type === "player_move").length, 60);
  for (let i = 0; i < 200; i++) await send(core, a, { type: "block", x: i % 64, y: 20, z: 5, t: 1 });
  assert.equal(b.sent.filter((m) => m.type === "block").length, 50);
  assert.equal(a.closedWith, null);
  for (let i = 0; i < 600; i++) await send(core, a, { type: "block", x: 1, y: 20, z: 5, t: 1 });
  assert.equal(a.closedWith?.code, 1008);
});

// ---------- internal ai-build ----------
const aiReq = (body, headers = {}) =>
  new Request("https://do.internal/internal/ai-build", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("ai-build: applies valid blocks, skips junk, sanitizes provider/anchor, broadcasts ai_build", async () => {
  const ctx = createCtx();
  const core = makeCore(ctx);
  const a = await join(core, ctx, "name=A");
  const res = await core.fetch(
    aiReq({
      blocks: [
        { x: 20, y: 20, z: 20, t: 4 },
        { x: null, y: 5, z: null, t: 3 },
        null,
        "x",
        { x: 5, y: 0, z: 5, t: 1 },
        { x: 21.7, y: 20, z: 20, t: 5 },
      ],
      reply: "Listo",
      provider: "<script>gro q</script>",
      model: "gpt/oss 120b!!",
      anchor: { x: 20, y: 19, z: "bad" },
    })
  );
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.applied, 2);
  const msg = a.sent.at(-1);
  assert.equal(msg.type, "ai_build");
  assert.deepEqual(msg.blocks, [
    { x: 20, y: 20, z: 20, t: 4 },
    { x: 21, y: 20, z: 20, t: 5 },
  ]);
  assert.equal(msg.anchor, null);
  assert.match(msg.provider, /^[\w.\- ]{1,11}$/);
  assert.equal(msg.chat.kind, "ai");
  assert.ok(msg.chat.sender.length <= 24);
  assert.equal(ctx.sql.edits.size, 2);
});

test("ai-build: caps at 240 blocks, rejects bad/huge bodies, no broadcast when nothing applied", async () => {
  const ctx = createCtx();
  const core = makeCore(ctx);
  const a = await join(core, ctx, "name=A");
  const blocks = Array.from({ length: 1000 }, (_, i) => ({ x: i % 64, y: 10 + Math.floor(i / 64), z: 3, t: 1 }));
  const res = await core.fetch(aiReq({ blocks }));
  assert.equal((await res.json()).applied, 240);
  assert.equal(a.sent.at(-1).blocks.length, 240);

  for (const body of ["{bad", "null", "[]", '"x"']) {
    const r = await core.fetch(aiReq(body));
    assert.equal(r.status, 400, `body ${body}`);
  }
  const big = await core.fetch(aiReq({ blocks: [], reply: "x".repeat(300000) }));
  assert.equal(big.status, 413);
  const claimed = await core.fetch(aiReq({}, { "Content-Length": "999999" }));
  assert.equal(claimed.status, 413);

  const n = a.sent.length;
  const empty = await core.fetch(aiReq({ blocks: [{ x: -5, y: 1, z: 1, t: 1 }] }));
  assert.equal((await empty.json()).applied, 0);
  assert.equal(a.sent.length, n);
});

test("internal/state reports seed, edits, online and players", async () => {
  const ctx = createCtx();
  const core = makeCore(ctx);
  await join(core, ctx, "name=A");
  const res = await core.fetch(new Request("https://do.internal/internal/state"));
  const s = await res.json();
  assert.equal(s.ok, true);
  assert.equal(s.seed, 2026);
  assert.equal(s.online, 1);
  assert.equal(s.players[0].name, "A");
});

// ---------- init size safety ----------
test("init: very large edit sets are split so no single frame carries everything", async () => {
  const ctx = createCtx();
  const core = makeCore(ctx);
  for (let i = 0; i < 30000; i++) {
    const x = i % 64;
    const z = Math.floor(i / 64) % 64;
    const y = 1 + Math.floor(i / 4096);
    ctx.sql.edits.set(`${x},${y},${z}`, { x, y, z, t: 1 });
  }
  const a = await join(core, ctx, "name=A");
  assert.equal(a.sent[0].type, "init");
  assert.equal(a.sent[0].edits.length, 12000);
  const synced = a.sent.slice(1).filter((m) => m.type === "ai_build" && m.provider === "sync");
  assert.equal(synced.reduce((n, m) => n + m.blocks.length, 0), 18000);
  assert.ok(synced.every((m) => JSON.stringify(m).length < 200000));
});

// ---------- persistent user / character profiles ----------
test("profile: uid persists character identity, appearance and last pose across reconnect & hibernation", async () => {
  const ctx = createCtx();
  const core1 = makeCore(ctx);

  const milo1 = await join(core1, ctx, "room=principal&uid=milo_uid_01&name=Milo&color=%234ade80&style=crown");
  assert.equal(milo1.sent[0].selfName, "Milo");
  assert.equal(milo1.sent[0].selfColor, "#4ade80");
  assert.equal(milo1.sent[0].selfStyle, "crown");
  assert.equal(milo1.sent[0].returning, false);
  assert.equal(milo1.sent[0].selfState, null, "brand new user lets client compute terrain spawn");

  const sofi = await join(core1, ctx, "room=principal&uid=sofi_uid_02&name=Sofi&color=%23f472b6&style=cap");
  // Secret uid must NEVER be leaked to other players or /internal/state
  assert.equal(sofi.sent[0].players[0].uid, undefined);
  assert.equal(sofi.sent[0].players[0].name, "Milo");
  assert.equal(sofi.sent[0].players[0].style, "crown");

  const stateRes = await core1.fetch(new Request("https://do.internal/internal/state"));
  const stateJson = await stateRes.json();
  assert.equal(stateJson.players[0].uid, undefined);

  // Milo moves and closes cleanly (should flush exact pose even without 3s interval)
  await send(core1, milo1, { type: "move", x: 18.5, y: 24.25, z: 41.75, yaw: 1.25, pitch: -0.3, held: 7 });
  await core1.webSocketClose(milo1, 1000, "bye");
  ctx.drop(milo1);

  // Fresh RoomCore (simulates Durable Object hibernation wake-up)
  const core2 = makeCore(ctx);
  // Returning user omits name/color/style -> restored automatically from DB!
  const milo2 = await join(core2, ctx, "room=principal&uid=milo_uid_01");
  assert.equal(milo2.sent[0].returning, true);
  assert.equal(milo2.sent[0].visits, 2);
  assert.equal(milo2.sent[0].selfName, "Milo");
  assert.equal(milo2.sent[0].selfColor, "#4ade80");
  assert.equal(milo2.sent[0].selfStyle, "crown");
  assert.deepEqual(milo2.sent[0].selfState, {
    x: 18.5,
    y: 24.25,
    z: 41.75,
    yaw: 1.25,
    pitch: -0.3,
    held: 7,
  });
});

test("profile: live profile message updates identity cleanly and reset_world clears saved coords only", async () => {
  const ctx = createCtx();
  const core = makeCore(ctx);
  const a = await join(core, ctx, "room=p&uid=user_alpha_9&name=Lucas&color=%2338bdf8&style=classic");
  const b = await join(core, ctx, "room=p&uid=user_beta_9&name=Elena&color=%23fb923c&style=visor");

  await send(core, a, { type: "move", x: 12.2, y: 21.5, z: 14.8, yaw: 0.4, pitch: 0.1, held: 4 });
  core.advance(3500);
  await send(core, a, { type: "move", x: 15.6, y: 22.0, z: 19.1, yaw: 0.9, pitch: -0.2, held: 5 });

  await send(core, a, { type: "profile", name: "<b>Lucho</b>", color: "#a78bfa", style: "robot" });
  const profBroadcastA = a.sent.at(-1);
  const profBroadcastB = b.sent.at(-1);
  assert.equal(profBroadcastA.type, "player_profile");
  assert.equal(profBroadcastA.player.name, "bLucho/b");
  assert.equal(profBroadcastA.player.color, "#a78bfa");
  assert.equal(profBroadcastA.player.style, "robot");
  assert.equal(profBroadcastA.player.uid, undefined);
  assert.deepEqual(profBroadcastA, profBroadcastB);

  // reset_world resets coordinates while keeping character look/name intact
  await send(core, a, { type: "reset_world" });
  await core.webSocketClose(a, 1000, "rejoin");
  ctx.drop(a);

  const a2 = await join(core, ctx, "room=p&uid=user_alpha_9");
  assert.equal(a2.sent[0].returning, true);
  assert.equal(a2.sent[0].selfName, "bLucho/b");
  assert.equal(a2.sent[0].selfColor, "#a78bfa");
  assert.equal(a2.sent[0].selfStyle, "robot");
  assert.equal(a2.sent[0].selfState, null, "world_reset must clear saved coordinates safely");
});
