// SPDX-License-Identifier: Apache-2.0
import { PROVIDER_MODEL } from "./config.js";

// ─── Proxy auth ─────────────────────────────────────────────────────────────
// The production server (server.js) gates /api/* behind a shared access token.
// The token is supplied at runtime and kept in localStorage so it is never baked
// into the static bundle. It is sent as a custom header that the proxy strips
// before forwarding the request upstream to the providers.
function authHeaders() {
  let token = "";
  try {
    token = (typeof localStorage !== "undefined" && localStorage.getItem("arm_access_token")) || "";
  } catch {
    /* localStorage unavailable (e.g. private mode) — fall through */
  }
  if (!token) token = import.meta.env.VITE_ARM_ACCESS_TOKEN || "";
  return token ? { "x-arm-token": token } : {};
}

async function callClaude(systemPrompt, userMessage, maxTokens) {
  const startMs = Date.now();
  const res = await fetch("/api/anthropic/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      ...authHeaders(),
    },
    body: JSON.stringify({
      model: PROVIDER_MODEL.claude,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    const msg = data?.error?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(`Claude API error: ${msg}`);
  }

  return {
    raw: data.content?.map((b) => b.text || "").join("") || "",
    stopReason: data.stop_reason || "unknown",
    usage: data.usage || {},
    provider: "claude",
    model: PROVIDER_MODEL.claude,
    latencyMs: Date.now() - startMs,
  };
}

async function callGPT(systemPrompt, userMessage, maxTokens) {
  const startMs = Date.now();
  const res = await fetch("/api/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },

    // GPT-5 family requires max_completion_tokens (max_tokens is deprecated/rejected)
    // and does not accept temperature on the reasoning path. We omit temperature so
    // the same call works across Instant and any Thinking-tier model swapped in later;
    // sampling defaults apply. Re-add temperature only if the chosen model accepts it.
    body: JSON.stringify({
      model: PROVIDER_MODEL.gpt,
      max_completion_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    const msg = data?.error?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(`OpenAI API error: ${msg}`);
  }

  return {
    raw: data.choices?.[0]?.message?.content || "",
    stopReason: data.choices?.[0]?.finish_reason || "unknown",
    usage: data.usage || {},
    provider: "gpt",
    model: PROVIDER_MODEL.gpt,
    latencyMs: Date.now() - startMs,
  };
}

const GEMINI_RETRY_DELAYS_MS = [2000, 4000, 8000];

async function callGemini(systemPrompt, userMessage, maxTokens, onRetry) {
  const startMs = Date.now();
  let attempt = 0;

  while (true) {
    try {
      const res = await fetch(
        `/api/gemini/v1beta/models/${PROVIDER_MODEL.gemini}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: userMessage }] }],
            generationConfig: {
              responseMimeType: "application/json",
              maxOutputTokens: maxTokens,
            },
          }),
        }
      );

      if (!res.ok) {
        const isTransient = res.status === 503 || res.status === 429;
        if (isTransient && attempt < GEMINI_RETRY_DELAYS_MS.length) {
          const delayMs = GEMINI_RETRY_DELAYS_MS[attempt];
          const msg = `Gemini ${res.status} (${res.statusText}) — retrying in ${delayMs / 1000}s (attempt ${attempt + 1}/${GEMINI_RETRY_DELAYS_MS.length})`;
          console.warn(msg);
          if (onRetry) onRetry(msg);
          await new Promise((r) => setTimeout(r, delayMs));
          attempt++;
          continue;
        }
        console.error(`Gemini error: ${res.status} ${res.statusText}`);
        throw new Error(`Gemini API error: ${res.status} ${res.statusText}`);
      }

      const data = await res.json();
      return {
        raw: data.candidates?.[0]?.content?.parts?.[0]?.text || "",
        stopReason:
          data.candidates?.[0]?.finishReason === "MAX_TOKENS"
            ? "max_tokens"
            : (data.candidates?.[0]?.finishReason || "unknown").toLowerCase(),
        usage: {
          input_tokens: data.usageMetadata?.promptTokenCount ?? 0,
          output_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        },
        provider: "gemini",
        model: PROVIDER_MODEL.gemini,
        latencyMs: Date.now() - startMs,
      };
    } catch (error) {
      if (error.message?.startsWith("Gemini API error:")) throw error;
      // Network-level failure — retry if attempts remain
      if (attempt < GEMINI_RETRY_DELAYS_MS.length) {
        const delayMs = GEMINI_RETRY_DELAYS_MS[attempt];
        const msg = `Gemini network error — retrying in ${delayMs / 1000}s (attempt ${attempt + 1}/${GEMINI_RETRY_DELAYS_MS.length}): ${error.message}`;
        console.warn(msg);
        if (onRetry) onRetry(msg);
        await new Promise((r) => setTimeout(r, delayMs));
        attempt++;
        continue;
      }
      console.error("Gemini failed after all retries:", error);
      throw error;
    }
  }
}

export function callProvider(provider, systemPrompt, userMessage, maxTokens, onRetry) {
  if (provider === "claude") return callClaude(systemPrompt, userMessage, maxTokens);
  if (provider === "gpt")    return callGPT(systemPrompt, userMessage, maxTokens);
  return callGemini(systemPrompt, userMessage, maxTokens, onRetry);
}

// ─── Embedding cosine convergence (OpenAI text-embedding-3-small) ─────────────
// Semantic similarity via dense embeddings. Threshold > 0.85 — topically-related
// claims score naturally higher than lexical measures, so the bar is set higher.
// Batches all claims in a single API call (~$0.000002, ~80ms). Fire-and-forget in
// App.jsx: a missing key or network failure degrades gracefully without aborting the run.
export async function computeEmbeddingCosine(claims) {
  if (!Array.isArray(claims) || claims.length < 2) return null;
  const res = await fetch("/api/openai/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ model: "text-embedding-3-small", input: claims }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Embedding API error: ${data?.error?.message || `HTTP ${res.status}`}`);
  }
  const embeddings = data.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);

  function cosineSim(a, b) {
    let dot = 0, magA = 0, magB = 0;
    for (let k = 0; k < a.length; k++) { dot += a[k] * b[k]; magA += a[k] * a[k]; magB += b[k] * b[k]; }
    return magA && magB ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
  }

  let total = 0, pairs = 0;
  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      total += cosineSim(embeddings[i], embeddings[j]);
      pairs++;
    }
  }
  return pairs > 0 ? total / pairs : null;
}
