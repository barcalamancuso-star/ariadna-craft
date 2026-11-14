import { VoxelWorldRoom } from "./world_do.js";
import { handleWorkerRequest } from "./app.js";

export { VoxelWorldRoom };

export default {
  async fetch(request, env) {
    return handleWorkerRequest(request, env);
  },
};
