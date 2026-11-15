import { VoxelWorldRoom } from "./world_do.js";
import { handleWorkerRequest } from "./app.js";

export { VoxelWorldRoom };

export default {
  async fetch(request, env) {
    try {
      return await handleWorkerRequest(request, env);
    } catch (err) {
      console.error("worker fetch failed", err?.message || err);
      return new Response(JSON.stringify({ ok: false, error: "internal_error" }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
  },
};
