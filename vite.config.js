import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const anthropicKey = env.VITE_ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY;

  return {
    plugins: [react()],
    server: {
      proxy: {
        // Routes /gemini/* to Google Generative AI API — avoids CORS on browser API calls
        "/gemini": {
          target: "https://generativelanguage.googleapis.com",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/gemini/, ""),
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
