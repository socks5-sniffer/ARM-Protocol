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

    body: JSON.stringify({
      model: PROVIDER_MODEL.gpt,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.7,
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

async function callGemini(systemPrompt, userMessage, maxTokens) {
  const startMs = Date.now();
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
      console.error(`Error: ${res.status} ${res.statusText}`);
      throw new Error(`Failed to call Gemini API: ${res.statusText}`);
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
    console.error("Error calling Gemini API:", error);
    throw error;
  }
}

export function callProvider(provider, systemPrompt, userMessage, maxTokens) {
  if (provider === "claude") return callClaude(systemPrompt, userMessage, maxTokens);
  if (provider === "gpt")    return callGPT(systemPrompt, userMessage, maxTokens);
  return callGemini(systemPrompt, userMessage, maxTokens);
}
