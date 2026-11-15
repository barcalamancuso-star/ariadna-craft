import { DurableObject } from "cloudflare:workers";
import { RoomCore } from "./room_core.js";

export class VoxelWorldRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = new RoomCore(ctx);
  }

  async fetch(request) {
    try {
      return await this.core.fetch(request);
    } catch (err) {
      console.error("VoxelWorldRoom.fetch failed", err?.message || err);
      return new Response(JSON.stringify({ ok: false, error: "room_error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Handlers never throw: an uncaught exception in a hibernation handler can
  // leave the socket silent for the client (the "no next message" symptom).
  async webSocketMessage(ws, message) {
    try {
      await this.core.webSocketMessage(ws, message);
    } catch (err) {
      console.error("webSocketMessage failed", err?.message || err);
    }
  }

  async webSocketClose(ws, code, reason, wasClean) {
    try {
      await this.core.webSocketClose(ws, code, reason, wasClean);
    } catch (err) {
      console.error("webSocketClose failed", err?.message || err);
    }
  }

  async webSocketError(ws, error) {
    try {
      await this.core.webSocketError(ws, error);
    } catch (err) {
      console.error("webSocketError failed", err?.message || err);
    }
  }
}
