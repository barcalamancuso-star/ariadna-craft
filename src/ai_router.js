import {
  AI_ARCHITECT_SYSTEM_PROMPT,
  extractJsonObject,
  generateFallbackBlueprint,
  sanitizeBlueprint,
} from "../public/shared/ai_blueprints.js";

function wantsConstruction(prompt) {
  const low = String(prompt || "").toLowerCase();
  return /(constru|hac[eé]|cre[aá]|arm[aá]|edific|levant|diseñ|pon[eé]|casa|torre|puente|pir[aá]mide|castillo|portal|faro|cabañ|escalera|muro|pared|piso|tech|estatua|nave|[aá]rbol|bosque|fuente|piscina|pileta|templo|base|refugio|pixel|coraz[oó]n|arco)/.test(
    low
  );
}

async function callOpenAiCompatible(endpoint, apiKey, model, userPrompt, fetchImpl = fetch) {
  const payload = {
    model,
    messages: [
      { role: "system", content: AI_ARCHITECT_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.35,
    max_tokens: 2000,
  };
  if (model.startsWith("openai/gpt-oss")) {
    payload.reasoning_effort = "low";
  }

  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "AriadnaCraft/1.0",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errTxt = (await res.text()).slice(0, 200);
    const err = new Error(`HTTP ${res.status}: ${errTxt}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const msg = data?.choices?.[0]?.message || {};
  return String(msg.content || msg.reasoning_content || "").trim();
}

async function callGemini(apiKey, model, userPrompt, fetchImpl = fetch) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "AriadnaCraft/1.0",
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: AI_ARCHITECT_SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 1400,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const errTxt = (await res.text()).slice(0, 200);
    const err = new Error(`HTTP ${res.status}: ${errTxt}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || "").join("").trim();
}

export function buildProviderPlan(env, preferredProvider = "auto") {
  const candidates = [];
  const pref = String(preferredProvider || "auto").toLowerCase();

  const addGroq = () => {
    const keys = [env?.GROQ_API_KEY_1, env?.GROQ_API_KEY_2].filter(Boolean);
    const models = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"];
    for (const k of keys) {
      for (const m of models) {
        candidates.push({
          provider: "groq",
          model: m,
          run: (prompt, f) =>
            callOpenAiCompatible("https://api.groq.com/openai/v1/chat/completions", k, m, prompt, f),
        });
      }
    }
  };

  const addMistral = () => {
    if (env?.MISTRAL_API_KEY) {
      candidates.push({
        provider: "mistral",
        model: "codestral-latest",
        run: (prompt, f) =>
          callOpenAiCompatible(
            "https://api.mistral.ai/v1/chat/completions",
            env.MISTRAL_API_KEY,
            "codestral-latest",
            prompt,
            f
          ),
      });
    }
  };

  const addGemini = () => {
    const keys = [env?.GEMINI_API_KEY_1, env?.GEMINI_API_KEY_2].filter(Boolean);
    const models = ["gemini-flash-lite-latest", "gemini-3.1-flash-lite-preview", "gemini-3-flash-preview"];
    for (const k of keys) {
      for (const m of models) {
        candidates.push({
          provider: "gemini",
          model: m,
          run: (prompt, f) => callGemini(k, m, prompt, f),
        });
      }
    }
  };

  if (pref === "mistral") {
    addMistral();
    addGroq();
    addGemini();
  } else if (pref === "gemini") {
    addGemini();
    addGroq();
    addMistral();
  } else {
    // Auto prioritizes ultra-fast Groq 120B/Qwen, then Mistral Codestral, then Gemini Free (2 accounts)
    addGroq();
    addMistral();
    addGemini();
  }

  return candidates;
}

export async function runAiArchitect({ env, prompt, anchor, playerName, preferredProvider = "auto", fetchImpl = fetch }) {
  const cleanPrompt = String(prompt || "").trim().slice(0, 400);
  if (!cleanPrompt) {
    return {
      ok: false,
      error: "Escribí una instrucción para Ariadna IA.",
      reply: "",
      blocks: [],
    };
  }

  const userContext = `Jugador: ${playerName || "Viajero"}. Punto de anclaje: (${Math.round(
    anchor?.x ?? 32
  )}, ${Math.round(anchor?.y ?? 18)}, ${Math.round(anchor?.z ?? 32)}). Pedido: ${cleanPrompt}`;

  const plan = buildProviderPlan(env, preferredProvider);
  const errors = [];

  for (const candidate of plan.slice(0, 7)) {
    try {
      const raw = await candidate.run(userContext, fetchImpl);
      const parsed = extractJsonObject(raw);
      if (!parsed) {
        errors.push(`${candidate.provider}/${candidate.model}: JSON inválido`);
        continue;
      }

      const sanitized = sanitizeBlueprint(parsed, anchor);
      // If user clearly asked to build something and LLM returned 0 blocks, attach procedural fallback
      if (sanitized.blocks.length === 0 && wantsConstruction(cleanPrompt)) {
        const fb = generateFallbackBlueprint(cleanPrompt, anchor);
        return {
          ok: true,
          provider: candidate.provider,
          model: candidate.model,
          reply: sanitized.reply || fb.reply,
          blocks: fb.blocks,
          fallbackUsed: true,
        };
      }

      return {
        ok: true,
        provider: candidate.provider,
        model: candidate.model,
        reply: sanitized.reply,
        blocks: sanitized.blocks,
        fallbackUsed: false,
      };
    } catch (err) {
      errors.push(`${candidate.provider}/${candidate.model}: ${err?.status || "err"}`);
    }
  }

  // Guaranteed procedural offline/rate-limit resilient fallback
  if (wantsConstruction(cleanPrompt) || cleanPrompt.length > 0) {
    const fb = generateFallbackBlueprint(cleanPrompt, anchor);
    return {
      ok: true,
      provider: "procedural-fallback",
      model: "ariadna-blueprint-v1",
      reply: fb.reply,
      blocks: fb.blocks,
      fallbackUsed: true,
      note: errors.slice(0, 3).join("; "),
    };
  }

  return {
    ok: false,
    error: "Sin respuesta de los proveedores de IA en este momento.",
    reply: "",
    blocks: [],
  };
}
