import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Keys loaded without VITE_ prefix so they are NOT bundled into client JS.
  const anthropicKey = env.ANTHROPIC_API_KEY;
  const openaiKey = env.OPENAI_API_KEY;
  const geminiKey = env.GEMINI_API_KEY;

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      allowedHosts: true,
      proxy: {
        // Gemini: key injected server-side via header — never sent to browser.
        "/gemini": {
          target: "https://generativelanguage.googleapis.com",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/gemini/, ""),
          headers: {
            ...(geminiKey ? { "x-goog-api-key": geminiKey } : {}),
          },
        },
        // OpenAI: key injected server-side via header — never sent to browser.
        "/api/openai": {
          target: "https://api.openai.com",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/openai/, ""),
          headers: {
            ...(openaiKey ? { Authorization: `Bearer ${openaiKey}` } : {}),
          },
        },
        // Anthropic does not allow browser-direct CORS; proxy is required.
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
      },
    },
  };
});
