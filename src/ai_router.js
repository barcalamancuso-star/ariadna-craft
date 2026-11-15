import {
  AI_ARCHITECT_SYSTEM_PROMPT,
  extractJsonObject,
  generateFallbackBlueprint,
  sanitizeBlueprint,
} from "../public/shared/ai_blueprints.js";

export const GROQ_MODELS = [
  "openai/gpt-oss-120b",
  "qwen/qwen3.8-27b",
  "openai/gpt-oss-20b",
];

export const MISTRAL_MODELS = [
  "codestral-latest",
  "mistral-medium-latest",
];

export const GEMINI_MODELS = [
  "gemini-4-hydrogen",
  "gemini-3-flash-preview",
  "gemini-3.5-flash-lite",
  "gemma-4-26b-a4b-it",
  "gemini-3.8-flash",
  "gemini-2.5-flash",
  "gemini-3.1-flash-lite-preview",
  "gemini-flash-lite-latest",
];

function wantsConstruction(prompt) {
  const low = String(prompt || "").toLowerCase();
  return /(constru|hac[eé]|cre[aá]|arm[aá]|edific|levant|diseñ|pon[eé]|casa|torre|puente|pir[aá]mide|castillo|fortaleza|portal|faro|cabañ|escalera|muro|pared|piso|tech|estatua|nave|[aá]rbol|bosque|fuente|plaza|observatorio|c[uú]pula|domo|piscina|pileta|templo|base|refugio|pixel|coraz[oó]n|arco)/.test(
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
        maxOutputTokens: 2400,
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
  const nonThoughtParts = parts.filter((p) => !p?.thought && typeof p?.text === "string");
  const activeParts = nonThoughtParts.length > 0 ? nonThoughtParts : parts;
  return activeParts.map((p) => p?.text || "").join("").trim();
}

export function buildProviderPlan(env, preferredProvider = "auto") {
  const candidates = [];
  const pref = String(preferredProvider || "auto").trim().toLowerCase();

  const addGroq = () => {
    const keyEntries = [
      { slot: 1, key: env?.GROQ_API_KEY_1 },
      { slot: 2, key: env?.GROQ_API_KEY_2 },
    ].filter((entry) => Boolean(entry.key));
    if (keyEntries.length === 0) return;

    for (let offset = 0; offset < keyEntries.length; offset++) {
      for (let mIdx = 0; mIdx < GROQ_MODELS.length; mIdx++) {
        const entry = keyEntries[(mIdx + offset) % keyEntries.length];
        const model = GROQ_MODELS[mIdx];
        candidates.push({
          provider: "groq",
          model,
          keySlot: entry.slot,
          run: (prompt, f) =>
            callOpenAiCompatible(
              "https://api.groq.com/openai/v1/chat/completions",
              entry.key,
              model,
              prompt,
              f
            ),
        });
      }
    }
  };

  const addMistral = () => {
    if (!env?.MISTRAL_API_KEY) return;
    for (const model of MISTRAL_MODELS) {
      candidates.push({
        provider: "mistral",
        model,
        keySlot: 1,
        run: (prompt, f) =>
          callOpenAiCompatible(
            "https://api.mistral.ai/v1/chat/completions",
            env.MISTRAL_API_KEY,
            model,
            prompt,
            f
          ),
      });
    }
  };

  const addGemini = () => {
    const keyEntries = [
      { slot: 1, key: env?.GEMINI_API_KEY_1 },
      { slot: 2, key: env?.GEMINI_API_KEY_2 },
      { slot: 3, key: env?.GEMINI_API_KEY_3 },
    ].filter((entry) => Boolean(entry.key));
    if (keyEntries.length === 0) return;

    for (let offset = 0; offset < keyEntries.length; offset++) {
      for (let mIdx = 0; mIdx < GEMINI_MODELS.length; mIdx++) {
        const entry = keyEntries[(mIdx + offset) % keyEntries.length];
        const model = GEMINI_MODELS[mIdx];
        candidates.push({
          provider: "gemini",
          model,
          keySlot: entry.slot,
          run: (prompt, f) => callGemini(entry.key, model, prompt, f),
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
  } else if (pref === "groq") {
    addGroq();
    addMistral();
    addGemini();
  } else {
    // Auto prioritizes ultra-fast Groq 120B/Qwen, then Mistral Codestral/Medium, then 3-account Gemini cascade
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

  for (const candidate of plan.slice(0, 12)) {
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
