import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = Number(process.env.PORT) || 8080;
const HOST = "0.0.0.0";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, "dist");

function filterRequestHeaders(headers) {
  const blocked = new Set([
    "host",
    "content-length",
    "connection",
    "accept-encoding",
    "x-forwarded-host",
    "x-forwarded-port",
    "x-forwarded-proto",
  ]);

  const next = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!blocked.has(key.toLowerCase()) && value !== undefined) {
      next[key] = value;
    }
  }
  return next;
}

function copyResponseHeaders(upstreamHeaders, res) {
  const blocked = new Set(["content-encoding", "transfer-encoding", "connection"]);

  for (const [key, value] of upstreamHeaders.entries()) {
    if (!blocked.has(key.toLowerCase())) {
      res.setHeader(key, value);
    }
  }
}

function requireEnv(res, keyName) {
  const value = process.env[keyName];
  if (!value) {
    res.status(500).json({
      error: `${keyName} is not configured in the runtime environment.`,
    });
    return null;
  }
  return value;
}

async function proxyToProvider(req, res, targetBase, rewritePrefix, extraHeaders = {}) {
  try {
    const upstreamUrl = new URL(req.originalUrl.replace(rewritePrefix, ""), targetBase);
    const headers = {
      ...filterRequestHeaders(req.headers),
      ...extraHeaders,
    };

    const body = req.method === "GET" || req.method === "HEAD" ? undefined : req.body;
    const upstreamRes = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body,
      redirect: "manual",
    });

    copyResponseHeaders(upstreamRes.headers, res);
    const payload = Buffer.from(await upstreamRes.arrayBuffer());
    res.status(upstreamRes.status).send(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown proxy error";
    res.status(502).json({ error: `Proxy request failed: ${message}` });
  }
}

app.disable("x-powered-by");
app.use(express.raw({ type: "*/*", limit: "10mb" }));

app.use("/api/anthropic", async (req, res) => {
  const key = requireEnv(res, "ANTHROPIC_API_KEY");
  if (!key) return;

  await proxyToProvider(req, res, "https://api.anthropic.com", "/api/anthropic", {
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  });
});

app.use("/api/openai", async (req, res) => {
  const key = requireEnv(res, "OPENAI_API_KEY");
  if (!key) return;

  await proxyToProvider(req, res, "https://api.openai.com", "/api/openai", {
    Authorization: `Bearer ${key}`,
  });
});

app.use("/gemini", async (req, res) => {
  const key = requireEnv(res, "GEMINI_API_KEY");
  if (!key) return;

  await proxyToProvider(req, res, "https://generativelanguage.googleapis.com", "/gemini", {
    "x-goog-api-key": key,
  });
});

app.use(express.static(distDir));
app.get("*", (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`ARM app listening on http://${HOST}:${PORT}`);
});
