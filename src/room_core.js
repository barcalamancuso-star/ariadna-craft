import { WORLD_HEIGHT, WORLD_SIZE_X, WORLD_SIZE_Z, blockKey } from "../public/shared/blocks.js";

const AVATAR_COLORS = [
  "#38bdf8",
  "#f472b6",
  "#4ade80",
  "#facc15",
  "#fb923c",
  "#a78bfa",
  "#2dd4bf",
  "#f87171",
];

function sanitizeName(raw) {
  const cleaned = String(raw || "")
    .replace(/[<>&"'`\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 20);
  return cleaned || `Viajero-${Math.floor(100 + Math.random() * 899)}`;
}

const MAX_MESSAGE_CHARS = 8192;
const MAX_PLAYERS = 24;
const MAX_CHAT_CHARS = 300;
const MAX_AI_BODY_BYTES = 262144;
const MAX_AI_BLOCKS = 240;
const INIT_EDITS_LIMIT = 12000;
const SYNC_BATCH_SIZE = 2000;
const RESET_COOLDOWN_MS = 10000;
const DROP_LIMIT_BEFORE_KICK = 400;

// Per-socket token buckets: { rate: tokens/second, burst: max tokens }.
const RATE_LIMITS = {
  move: { rate: 40, burst: 60 },
  block: { rate: 25, burst: 50 },
  chat: { rate: 1, burst: 4 },
  ping: { rate: 5, burst: 10 },
};

// Missing / non-numeric input falls back instead of teleporting to the minimum.
function clampCoord(val, min, max, fallback = min) {
  const n = typeof val === "number" || typeof val === "string" ? Number(val) : NaN;
  if (val === "" || !Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// Strict integer coordinate: only finite JSON numbers (null/undefined/NaN/strings -> null).
function strictInt(val) {
  if (typeof val !== "number" || !Number.isFinite(val)) return null;
  return Math.floor(val);
}

export function normalizeRoom(raw) {
  const cleaned = String(raw || "principal")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 32);
  return cleaned || "principal";
}

function cleanLabel(raw, max) {
  return String(raw ?? "")
    .replace(/[^\w.\- ]/g, "")
    .trim()
    .slice(0, max);
}

function validCloseCode(code) {
  const n = Number(code);
  if (!Number.isInteger(n)) return 1000;
  if (n === 1005 || n === 1006 || n === 1015) return 1000;
  return (n >= 1000 && n <= 1014) || (n >= 3000 && n <= 4999) ? n : 1000;
}

export class RoomCore {
  constructor(
    ctx,
    createWebSocketPair = () => {
      const pair = new WebSocketPair();
      return [pair[0], pair[1]];
    },
    makeUpgradeResponse = (client) => new Response(null, { status: 101, webSocket: client })
  ) {
    this.ctx = ctx;
    this.createWebSocketPair = createWebSocketPair;
    this.makeUpgradeResponse = makeUpgradeResponse;
    this.initialized = false;
    this.now = () => Date.now();
    this.buckets = new Map();
    this.lastReset = 0;
  }

  ensureSchema() {
    if (this.initialized) return;
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS room_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS block_edits (
        k TEXT PRIMARY KEY,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        z INTEGER NOT NULL,
        t INTEGER NOT NULL,
        by_name TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chat_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender TEXT NOT NULL,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        ts INTEGER NOT NULL
      );
    `);

    const rows = this.ctx.storage.sql
      .exec("SELECT value FROM room_meta WHERE key = 'seed'")
      .toArray();
    if (rows.length === 0) {
      const seed = String(2026);
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO room_meta (key, value) VALUES ('seed', ?)",
        seed
      );
    }
    this.initialized = true;
  }

  getSeed() {
    this.ensureSchema();
    const rows = this.ctx.storage.sql
      .exec("SELECT value FROM room_meta WHERE key = 'seed'")
      .toArray();
    return Number(rows[0]?.value || 2026);
  }

  getEdits() {
    this.ensureSchema();
    return this.ctx.storage.sql
      .exec("SELECT x, y, z, t FROM block_edits ORDER BY updated_at ASC")
      .toArray();
  }

  getChat() {
    this.ensureSchema();
    return this.ctx.storage.sql
      .exec("SELECT sender, kind, text, ts FROM chat_log ORDER BY id DESC LIMIT 25")
      .toArray()
      .reverse();
  }

  appendChat(sender, kind, text) {
    this.ensureSchema();
    const ts = this.now();
    const cleanText = String(text ?? "")
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .trim()
      .slice(0, MAX_CHAT_CHARS);
    if (!cleanText) return null;
    const cleanSender = String(sender || "Sistema").slice(0, 24);
    const cleanKind = String(kind || "chat").slice(0, 16);
    this.ctx.storage.sql.exec(
      "INSERT INTO chat_log (sender, kind, text, ts) VALUES (?, ?, ?, ?)",
      cleanSender,
      cleanKind,
      cleanText,
      ts
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM chat_log WHERE id NOT IN (SELECT id FROM chat_log ORDER BY id DESC LIMIT 40)"
    );
    return { sender: cleanSender, kind: cleanKind, text: cleanText, ts };
  }

  saveBlockEdit(x, y, z, t, byName) {
    this.ensureSchema();
    const ix = strictInt(x);
    const iy = strictInt(y);
    const iz = strictInt(z);
    const it = strictInt(t);
    if (ix === null || iy === null || iz === null || it === null) return false;
    if (
      ix < 0 ||
      ix >= WORLD_SIZE_X ||
      iy < 1 ||
      iy >= WORLD_HEIGHT ||
      iz < 0 ||
      iz >= WORLD_SIZE_Z ||
      it < 0 ||
      it > 15
    ) {
      return false;
    }
    const k = blockKey(ix, iy, iz);
    this.ctx.storage.sql.exec(
      `INSERT INTO block_edits (k, x, y, z, t, by_name, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(k) DO UPDATE SET t = excluded.t, by_name = excluded.by_name, updated_at = excluded.updated_at`,
      k,
      ix,
      iy,
      iz,
      it,
      String(byName || "Anon").slice(0, 24),
      this.now()
    );
    return true;
  }

  getPlayers(excludeWs = null) {
    const out = [];
    for (const sock of this.ctx.getWebSockets()) {
      if (excludeWs && sock === excludeWs) continue;
      try {
        const meta = sock.deserializeAttachment();
        if (meta && meta.id) out.push(meta);
      } catch {
        // Ignore stale attachment
      }
    }
    return out;
  }

  broadcast(payloadObj, excludeWs = null) {
    const msg = JSON.stringify(payloadObj);
    for (const sock of this.ctx.getWebSockets()) {
      if (excludeWs && sock === excludeWs) continue;
      try {
        sock.send(msg);
      } catch {
        // Closed/stale socket
      }
    }
  }

  pickColor() {
    const used = new Set(this.getPlayers().map((p) => p.color));
    const free = AVATAR_COLORS.filter((c) => !used.has(c));
    const pool = free.length ? free : AVATAR_COLORS;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Token bucket per player id. Returns true if the action is allowed.
  allow(playerId, kind) {
    const cfg = RATE_LIMITS[kind];
    if (!cfg) return true;
    let entry = this.buckets.get(playerId);
    if (!entry) {
      entry = { tokens: {}, stamps: {}, drops: 0 };
      this.buckets.set(playerId, entry);
    }
    const now = this.now();
    const last = entry.stamps[kind] ?? now;
    const prev = entry.tokens[kind] ?? cfg.burst;
    const tokens = Math.min(cfg.burst, prev + ((now - last) / 1000) * cfg.rate);
    entry.stamps[kind] = now;
    if (tokens < 1) {
      entry.tokens[kind] = tokens;
      entry.drops += 1;
      return false;
    }
    entry.tokens[kind] = tokens - 1;
    if (entry.drops > 0 && now - last > 5000) entry.drops = 0;
    return true;
  }

  sendTo(ws, obj) {
    try {
      ws.send(JSON.stringify(obj));
    } catch {
      // Closed/stale socket
    }
  }

  // Edits can exceed the 1 MiB WebSocket frame limit on a heavily built world,
  // so init carries a bounded prefix and the rest follows as ai_build batches
  // (a message type every client already applies).
  sendInit(server, base) {
    const allEdits = this.getEdits();
    const payload = { ...base, edits: allEdits.slice(0, INIT_EDITS_LIMIT) };
    server.send(JSON.stringify(payload));
    for (let i = INIT_EDITS_LIMIT; i < allEdits.length; i += SYNC_BATCH_SIZE) {
      this.sendTo(server, {
        type: "ai_build",
        blocks: allEdits.slice(i, i + SYNC_BATCH_SIZE),
        anchor: null,
        provider: "sync",
        model: "",
        chat: null,
      });
    }
  }

  async handleAiBuild(request) {
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    const declared = Number(request.headers.get("Content-Length") || 0);
    if (declared > MAX_AI_BODY_BYTES) return json({ ok: false, error: "Payload demasiado grande" }, 413);

    let body;
    try {
      const raw = await request.text();
      if (raw.length > MAX_AI_BODY_BYTES) return json({ ok: false, error: "Payload demasiado grande" }, 413);
      body = JSON.parse(raw);
    } catch {
      return json({ ok: false, error: "JSON inválido" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json({ ok: false, error: "JSON inválido" }, 400);
    }

    const blocks = Array.isArray(body.blocks) ? body.blocks : [];
    const applied = [];
    for (const b of blocks.slice(0, MAX_AI_BLOCKS)) {
      if (!b || typeof b !== "object") continue;
      if (this.saveBlockEdit(b.x, b.y, b.z, b.t, "Ariadna IA")) {
        applied.push({ x: Math.floor(b.x), y: Math.floor(b.y), z: Math.floor(b.z), t: Math.floor(b.t) });
      }
    }

    const provider = cleanLabel(body.provider, 11) || "ia";
    const model = cleanLabel(body.model, 64);
    const anchor =
      body.anchor &&
      typeof body.anchor === "object" &&
      Number.isFinite(body.anchor.x) &&
      Number.isFinite(body.anchor.y) &&
      Number.isFinite(body.anchor.z)
        ? { x: body.anchor.x, y: body.anchor.y, z: body.anchor.z }
        : null;

    const reply = typeof body.reply === "string" ? body.reply.trim() : "";
    const chatEntry = reply ? this.appendChat(`Ariadna IA (${provider})`, "ai", reply) : null;

    if (applied.length > 0 || chatEntry) {
      this.broadcast({ type: "ai_build", blocks: applied, anchor, provider, model, chat: chatEntry });
    }

    return json({ ok: true, applied: applied.length, chat: chatEntry });
  }

  async fetch(request) {
    this.ensureSchema();
    const url = new URL(request.url);

    if (url.pathname === "/internal/state" && request.method === "GET") {
      return new Response(
        JSON.stringify({
          ok: true,
          seed: this.getSeed(),
          editCount: this.getEdits().length,
          online: this.ctx.getWebSockets().length,
          players: this.getPlayers(),
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    if (url.pathname === "/internal/ai-build" && request.method === "POST") {
      return this.handleAiBuild(request);
    }

    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
      if (this.ctx.getWebSockets().length >= MAX_PLAYERS) {
        return new Response("Sala llena", { status: 503, headers: { "Retry-After": "5" } });
      }

      const [client, server] = this.createWebSocketPair();
      this.ctx.acceptWebSocket(server);

      const id =
        typeof crypto?.randomUUID === "function"
          ? crypto.randomUUID().slice(0, 8)
          : Math.random().toString(36).slice(2, 10);
      const name = sanitizeName(url.searchParams.get("name"));
      const room = normalizeRoom(url.searchParams.get("room"));
      const color = this.pickColor();

      const player = {
        id,
        name,
        color,
        x: 32.5,
        y: 18.2,
        z: 32.5,
        yaw: 0,
        pitch: 0,
        held: 1,
        vr: false,
      };
      server.serializeAttachment(player);

      try {
        this.sendInit(server, {
          type: "init",
          selfId: id,
          selfColor: color,
          room,
          seed: this.getSeed(),
          players: this.getPlayers(server),
          chat: this.getChat(),
        });
      } catch {
        try {
          server.close(1011, "init failed");
        } catch {
          // already closed
        }
        return new Response("Init failed", { status: 500 });
      }

      this.broadcast({ type: "player_join", player }, server);

      return this.makeUpgradeResponse(client);
    }

    return new Response("Expected WebSocket", { status: 426, headers: { Upgrade: "websocket" } });
  }

  async webSocketMessage(ws, message) {
    this.ensureSchema();
    if (typeof message !== "string" || message.length > MAX_MESSAGE_CHARS) return;

    let data;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return;

    const player = ws.deserializeAttachment();
    if (!player || !player.id) return;

    if (RATE_LIMITS[data.type] && !this.allow(player.id, data.type)) {
      const entry = this.buckets.get(player.id);
      if (data.type === "chat") {
        this.sendTo(ws, { type: "error", code: "rate_limited", for: "chat" });
      }
      if (entry && entry.drops > DROP_LIMIT_BEFORE_KICK) {
        try {
          ws.close(1008, "rate limit");
        } catch {
          // already closed
        }
      }
      return;
    }

    switch (data.type) {
      case "ping": {
        const t = typeof data.t === "number" && Number.isFinite(data.t) ? data.t : this.now();
        ws.send(JSON.stringify({ type: "pong", t }));
        break;
      }

      case "move": {
        const updated = {
          ...player,
          x: clampCoord(data.x, 0.2, WORLD_SIZE_X - 0.2, player.x),
          y: clampCoord(data.y, 0.2, WORLD_HEIGHT + 10, player.y),
          z: clampCoord(data.z, 0.2, WORLD_SIZE_Z - 0.2, player.z),
          yaw: clampCoord(data.yaw, -1000, 1000, player.yaw),
          pitch: clampCoord(data.pitch, -1.58, 1.58, player.pitch),
          held: Number.isInteger(data.held) ? Math.max(0, Math.min(15, data.held)) : player.held,
          vr: typeof data.vr === "boolean" ? data.vr : Boolean(player.vr),
        };
        ws.serializeAttachment(updated);
        this.broadcast({ type: "player_move", player: updated }, ws);
        break;
      }

      case "block": {
        if (this.saveBlockEdit(data.x, data.y, data.z, data.t, player.name)) {
          // Not excluded: the sender also gets the echo (clients ignore by === selfId).
          this.broadcast({
            type: "block",
            x: Math.floor(data.x),
            y: Math.floor(data.y),
            z: Math.floor(data.z),
            t: Math.floor(data.t),
            by: player.id,
          });
        }
        break;
      }

      case "chat": {
        const entry =
          typeof data.text === "string" ? this.appendChat(player.name, "chat", data.text) : null;
        if (entry) {
          this.broadcast({ type: "chat", ...entry });
        }
        break;
      }

      case "reset_world": {
        const now = this.now();
        if (this.lastReset && now - this.lastReset < RESET_COOLDOWN_MS) {
          this.sendTo(ws, { type: "error", code: "rate_limited", for: "reset_world" });
          break;
        }
        this.lastReset = now;
        const newSeed = Math.floor(1000 + Math.random() * 899999);
        this.ctx.storage.sql.exec(
          "INSERT INTO room_meta (key, value) VALUES ('seed', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          String(newSeed)
        );
        this.ctx.storage.sql.exec("DELETE FROM block_edits");
        const notice = this.appendChat("Sistema", "system", `${player.name} generó un mundo nuevo (#${newSeed}).`);
        this.broadcast({ type: "world_reset", seed: newSeed, chat: notice });
        break;
      }
    }
  }

  async webSocketClose(ws, code, reason) {
    try {
      const player = ws.deserializeAttachment();
      if (player?.id) {
        this.buckets.delete(player.id);
        this.broadcast({ type: "player_leave", id: player.id }, ws);
      }
    } catch {
      // Ignore stale attachment
    }
    try {
      ws.close(validCloseCode(code), String(reason || "Closed").slice(0, 100));
    } catch {
      // Ignore already closed sockets
    }
  }

  async webSocketError(ws) {
    try {
      const player = ws.deserializeAttachment();
      if (player?.id) {
        this.buckets.delete(player.id);
        this.broadcast({ type: "player_leave", id: player.id }, ws);
      }
    } catch {
      // Ignore
    }
  }
}
