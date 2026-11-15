import { runAiArchitect } from "./ai_router.js";

export function normalizeRoomName(raw) {
  const cleaned = String(raw || "principal")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 32);
  return cleaned || "principal";
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function handleWorkerRequest(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);

  if (url.pathname === "/api/health" && request.method === "GET") {
    const geminiAccounts = [
      env?.GEMINI_API_KEY_1,
      env?.GEMINI_API_KEY_2,
      env?.GEMINI_API_KEY_3,
    ].filter(Boolean).length;
    const groqKeys = [env?.GROQ_API_KEY_1, env?.GROQ_API_KEY_2].filter(Boolean).length;
    const mistral = Boolean(env?.MISTRAL_API_KEY);

    return json({
      ok: true,
      service: "ariadna-craft",
      online: true,
      durableObjects: Boolean(env?.WORLD_ROOM),
      geminiAccounts,
      groqKeys,
      mistral,
      aiProviders: {
        groq: groqKeys > 0,
        groqKeys,
        mistral,
        gemini: geminiAccounts > 0,
        geminiAccounts,
      },
    });
  }

  if (url.pathname === "/ws") {
    if (!env.WORLD_ROOM) {
      return json({ ok: false, error: "Durable Object WORLD_ROOM no disponible." }, 500);
    }
    const room = normalizeRoomName(url.searchParams.get("room"));
    const id = env.WORLD_ROOM.idFromName(room);
    const stub = env.WORLD_ROOM.get(id);
    return stub.fetch(request);
  }

  if (url.pathname === "/api/world" && request.method === "GET") {
    const room = normalizeRoomName(url.searchParams.get("room"));
    const id = env.WORLD_ROOM.idFromName(room);
    const stub = env.WORLD_ROOM.get(id);
    const doRes = await stub.fetch(new Request("https://do.internal/internal/state"));
    const data = await doRes.json();
    return json({ ...data, room });
  }

  if (url.pathname === "/api/ai" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "JSON inválido." }, 400);
    }

    const room = normalizeRoomName(body?.room);
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    const anchor =
      body?.anchor && typeof body.anchor === "object"
        ? body.anchor
        : { x: 32, y: 18, z: 32 };
    const playerName =
      typeof body?.playerName === "string" ? body.playerName.slice(0, 20) : "Viajero";
    const preferredProvider =
      typeof body?.provider === "string" ? body.provider : "auto";

    if (!prompt) {
      return json({ ok: false, error: "Falta el prompt." }, 400);
    }

    const aiRes = await runAiArchitect({
      env,
      prompt,
      anchor,
      playerName,
      preferredProvider,
      fetchImpl,
    });

    if (!aiRes.ok) {
      return json(aiRes, 502);
    }

    if (env.WORLD_ROOM) {
      const id = env.WORLD_ROOM.idFromName(room);
      const stub = env.WORLD_ROOM.get(id);
      await stub.fetch(
        new Request("https://do.internal/internal/ai-build", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            blocks: aiRes.blocks,
            reply: aiRes.reply,
            provider: aiRes.provider,
            model: aiRes.model,
            anchor,
          }),
        })
      );
    }

    return json({
      ok: true,
      room,
      provider: aiRes.provider,
      model: aiRes.model,
      reply: aiRes.reply,
      blocksCount: aiRes.blocks.length,
      fallbackUsed: Boolean(aiRes.fallbackUsed),
    });
  }

  if (env.ASSETS) {
    return env.ASSETS.fetch(request);
  }

  return new Response("Not found", { status: 404 });
}
