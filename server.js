import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = Number(process.env.PORT) || 8080;
const HOST = "0.0.0.0";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, "dist");
const indexHtmlPath = path.join(distDir, "index.html");
const indexHtml = fs.existsSync(indexHtmlPath) ? fs.readFileSync(indexHtmlPath, "utf8") : null;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 300;
const requestCounts = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [client, state] of requestCounts.entries()) {
    if (now - state.windowStart >= RATE_LIMIT_WINDOW_MS) {
      requestCounts.delete(client);
    }
  }
}, RATE_LIMIT_WINDOW_MS).unref();

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

function getClientAddress(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

function enforceRateLimit(req, res, next) {
  const now = Date.now();
  const client = getClientAddress(req);
  const current = requestCounts.get(client);

  if (!current || now - current.windowStart >= RATE_LIMIT_WINDOW_MS) {
    requestCounts.set(client, { windowStart: now, count: 1 });
    next();
    return;
  }

  current.count += 1;
  if (current.count > RATE_LIMIT_MAX_REQUESTS) {
    res.status(429).json({ error: "Too many requests. Please try again later." });
    return;
  }

  next();
}

async function proxyToProvider(
  req,
  res,
  targetBase,
  targetPath,
  extraHeaders = {}
) {
  try {
    const upstreamUrl = new URL(targetPath, targetBase);

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
app.use(enforceRateLimit);

app.use("/api/anthropic", async (req, res) => {
  const key = requireEnv(res, "ANTHROPIC_API_KEY");
  if (!key) return;

  await proxyToProvider(
    req,
    res,
    "https://api.anthropic.com",
    "/v1/messages",
    {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    }
  );
});

app.use("/api/openai", async (req, res) => {
  const key = requireEnv(res, "OPENAI_API_KEY");
  if (!key) return;

  await proxyToProvider(
    req,
    res,
    "https://api.openai.com",
    "/v1/chat/completions",
    {
      Authorization: `Bearer ${key}`,
    }
  );
});

app.use("/api/gemini/v1beta/models/gemini-2.5-flash:generateContent", async (req, res) => {
  const key = requireEnv(res, "GEMINI_API_KEY");
  if (!key) return;

  await proxyToProvider(
    req,
    res,
    "https://generativelanguage.googleapis.com",
    "/v1beta/models/gemini-2.5-flash:generateContent",
    {
      "x-goog-api-key": key,
    }
  );
});

app.use(express.static(distDir));
app.get("*", enforceRateLimit, (_req, res) => {
  if (!indexHtml) {
    res.status(503).send("Build output unavailable.");
    return;
  }
  res.type("html").send(indexHtml);
});

app.listen(PORT, HOST, () => {
  console.log(`ARM app listening on http://${HOST}:${PORT}`);
});
