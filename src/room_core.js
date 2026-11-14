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
    .replace(/[<>&"'`]/g, "")
    .trim()
    .slice(0, 20);
  return cleaned || `Viajero-${Math.floor(100 + Math.random() * 899)}`;
}

function clampCoord(val, min, max) {
  const n = Number(val);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
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
    const ts = Date.now();
    const cleanText = String(text || "").trim().slice(0, 300);
    if (!cleanText) return null;
    this.ctx.storage.sql.exec(
      "INSERT INTO chat_log (sender, kind, text, ts) VALUES (?, ?, ?, ?)",
      String(sender || "Sistema").slice(0, 24),
      String(kind || "chat").slice(0, 16),
      cleanText,
      ts
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM chat_log WHERE id NOT IN (SELECT id FROM chat_log ORDER BY id DESC LIMIT 40)"
    );
    return { sender, kind, text: cleanText, ts };
  }

  saveBlockEdit(x, y, z, t, byName) {
    this.ensureSchema();
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const it = Math.floor(t);
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
      Date.now()
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
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ ok: false, error: "JSON inválido" }), { status: 400 });
      }
      const blocks = Array.isArray(body?.blocks) ? body.blocks : [];
      const applied = [];
      for (const b of blocks.slice(0, 240)) {
        const x = Math.floor(Number(b?.x));
        const y = Math.floor(Number(b?.y));
        const z = Math.floor(Number(b?.z));
        const t = Math.floor(Number(b?.t));
        if (this.saveBlockEdit(x, y, z, t, "Ariadna IA")) {
          applied.push({ x, y, z, t });
        }
      }

      const reply = String(body?.reply || "").trim();
      const chatEntry = reply
        ? this.appendChat(
            `Ariadna IA (${body?.provider || "ia"})`,
            "ai",
            reply
          )
        : null;

      if (applied.length > 0 || chatEntry) {
        this.broadcast({
          type: "ai_build",
          blocks: applied,
          anchor: body?.anchor || null,
          provider: body?.provider || "ia",
          model: body?.model || "",
          chat: chatEntry,
        });
      }

      return new Response(
        JSON.stringify({ ok: true, applied: applied.length, chat: chatEntry }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
      const [client, server] = this.createWebSocketPair();
      this.ctx.acceptWebSocket(server);

      const id =
        typeof crypto?.randomUUID === "function"
          ? crypto.randomUUID().slice(0, 8)
          : Math.random().toString(36).slice(2, 10);
      const name = sanitizeName(url.searchParams.get("name"));
      const room = (url.searchParams.get("room") || "principal").slice(0, 32);
      const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

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

      const initPayload = {
        type: "init",
        selfId: id,
        selfColor: color,
        room,
        seed: this.getSeed(),
        edits: this.getEdits(),
        players: this.getPlayers(server),
        chat: this.getChat(),
      };
      server.send(JSON.stringify(initPayload));

      this.broadcast({ type: "player_join", player }, server);

      return this.makeUpgradeResponse(client);
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws, message) {
    this.ensureSchema();
    if (typeof message !== "string" || message.length > 16384) return;

    let data;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }
    if (!data || typeof data !== "object") return;

    const player = ws.deserializeAttachment() || { id: "anon", name: "Anon", color: "#38bdf8" };

    switch (data.type) {
      case "ping": {
        ws.send(JSON.stringify({ type: "pong", t: data.t || Date.now() }));
        break;
      }

      case "move": {
        const updated = {
          ...player,
          x: clampCoord(data.x, 0.2, WORLD_SIZE_X - 0.2),
          y: clampCoord(data.y, 0.2, WORLD_HEIGHT + 10),
          z: clampCoord(data.z, 0.2, WORLD_SIZE_Z - 0.2),
          yaw: Number.isFinite(Number(data.yaw)) ? Number(data.yaw) : player.yaw,
          pitch: clampCoord(data.pitch, -1.58, 1.58),
          held: Number.isInteger(data.held) ? Math.max(0, Math.min(15, data.held)) : player.held,
          vr: Boolean(data.vr),
        };
        ws.serializeAttachment(updated);
        this.broadcast({ type: "player_move", player: updated }, ws);
        break;
      }

      case "block": {
        const x = Math.floor(Number(data.x));
        const y = Math.floor(Number(data.y));
        const z = Math.floor(Number(data.z));
        const t = Math.floor(Number(data.t));
        if (this.saveBlockEdit(x, y, z, t, player.name)) {
          this.broadcast({ type: "block", x, y, z, t, by: player.id });
        }
        break;
      }

      case "chat": {
        const entry = this.appendChat(player.name, "chat", data.text);
        if (entry) {
          this.broadcast({ type: "chat", ...entry });
        }
        break;
      }

      case "reset_world": {
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
        this.broadcast({ type: "player_leave", id: player.id }, ws);
      }
      ws.close(code || 1000, reason || "Closed");
    } catch {
      // Ignore already closed sockets
    }
  }

  async webSocketError(ws) {
    try {
      const player = ws.deserializeAttachment();
      if (player?.id) {
        this.broadcast({ type: "player_leave", id: player.id }, ws);
      }
    } catch {
      // Ignore
    }
  }
}
