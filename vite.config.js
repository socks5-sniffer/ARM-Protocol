import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Keys read from non-VITE-prefixed env vars — never bundled into browser code.
  const anthropicKey = env.ANTHROPIC_API_KEY || env.VITE_ANTHROPIC_API_KEY;
  const geminiKey    = env.GOOGLE_API_KEY    || env.GEMINI_API_KEY    || env.VITE_GEMINI_API_KEY;
  const openaiKey    = env.OPENAI_API_KEY    || env.VITE_OPENAI_API_KEY;

  return {
    plugins: [react()],
    server: {
      // Allow all hosts — required for dynamic OpenShift Dev Spaces hostnames
      allowedHosts: "all",
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
