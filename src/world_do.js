import { DurableObject } from "cloudflare:workers";
import { RoomCore } from "./room_core.js";

export class VoxelWorldRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = new RoomCore(ctx);
  }

  async fetch(request) {
    return this.core.fetch(request);
  }

  async webSocketMessage(ws, message) {
    return this.core.webSocketMessage(ws, message);
  }

  async webSocketClose(ws, code, reason, wasClean) {
    return this.core.webSocketClose(ws, code, reason, wasClean);
  }

  async webSocketError(ws, error) {
    return this.core.webSocketError(ws, error);
  }
}
