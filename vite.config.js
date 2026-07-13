// SPDX-License-Identifier: Apache-2.0
/// <reference types="vitest" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Dev-proxy auth guard. The dev proxy below injects the operator's provider keys
// into every /api/* request. Left open, anyone who can reach the dev server — or a
// malicious page performing DNS rebinding against it (allowedHosts is permissive to
// support Dev Spaces) — can drain those keys (denial-of-wallet). When ARM_DEV_PROXY_TOKEN
// is set, this middleware requires it as `x-arm-token` (or `Authorization: Bearer`)
// before any /api/* request is proxied. It runs BEFORE the proxy, so rejected
// requests never reach the provider with a key attached. Unset ⇒ open, as before,
// so a plain local `npm run dev` on loopback keeps working with zero config.
function devProxyAuth(token) {
  return {
    name: "arm-dev-proxy-auth",
    configureServer(server) {
      if (!token) return;
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith("/api/")) return next();
        const header = req.headers["x-arm-token"];
        const bearer = /^Bearer\s+(.+)$/i.exec(req.headers["authorization"] || "");
        const provided = (typeof header === "string" && header) || (bearer && bearer[1].trim()) || "";
        if (provided !== token) {
          res.statusCode = 401;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Unauthorized: missing or invalid dev proxy token." }));
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Keys read from non-VITE-prefixed env vars — never bundled into browser code.
  const anthropicKey = env.ANTHROPIC_API_KEY || env.VITE_ANTHROPIC_API_KEY;
  const geminiKey    = env.GOOGLE_API_KEY    || env.GEMINI_API_KEY    || env.VITE_GEMINI_API_KEY;
  const openaiKey    = env.OPENAI_API_KEY    || env.VITE_OPENAI_API_KEY;
  const devProxyToken = env.ARM_DEV_PROXY_TOKEN || "";

  // Host allowlist for the dev server. "all" disables Vite's host check entirely,
  // which is what enables DNS-rebinding against the key-injecting proxy — so it is
  // no longer the default. Default: Vite's own safe behavior (loopback + a single
  // configured host). Dev Spaces (dynamic hostnames) sets VITE_ALLOWED_HOSTS to a
  // comma-separated list, or the literal "all" to opt back into the old wide-open
  // behavior. Pair "all" with ARM_DEV_PROXY_TOKEN so the proxy is still gated.
  const allowedHostsEnv = (env.VITE_ALLOWED_HOSTS || "").trim();
  const allowedHosts =
    allowedHostsEnv === "all"
      ? "all"
      : allowedHostsEnv
        ? allowedHostsEnv.split(",").map((h) => h.trim()).filter(Boolean)
        : undefined; // Vite default

  return {
    plugins: [react(), devProxyAuth(devProxyToken)],
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.js'],
      globals: true,
    },
    server: {
      ...(allowedHosts ? { allowedHosts } : {}),
      proxy: {
        // Google Gemini — key injected into query string server-side, never sent to browser
        "/api/gemini": {
          target: "https://generativelanguage.googleapis.com",
          changeOrigin: true,
          rewrite: (path) => {
            const stripped = path.replace(/^\/api\/gemini/, "");
            const sep = stripped.includes("?") ? "&" : "?";
            return geminiKey ? `${stripped}${sep}key=${geminiKey}` : stripped;
          },
        },
        // Anthropic — key injected as header, never sent to browser
        "/api/anthropic": {
          target: "https://api.anthropic.com",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/anthropic/, ""),
          headers: {
            ...(anthropicKey ? { "x-api-key": anthropicKey } : {}),
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
        },
        // OpenAI — key injected as header, never sent to browser
        "/api/openai": {
          target: "https://api.openai.com",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/openai/, ""),
          headers: {
            ...(openaiKey ? { Authorization: `Bearer ${openaiKey}` } : {}),
          },
        },
      },
    },
  };
});
