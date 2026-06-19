// SPDX-License-Identifier: Apache-2.0
import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
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
// Shared secret that gates the keyed provider proxy (/api/*). Without it the proxy
// is an open, unauthenticated endpoint that spends the operator's API budget.
const ACCESS_TOKEN = process.env.ARM_ACCESS_TOKEN || "";
// Number of trusted reverse proxies in front of this server (e.g. the OpenShift
// router). X-Forwarded-For entries are appended left→right as a request traverses
// hops, so only the last N were inserted by infrastructure we trust; entries to the
// left are supplied by the client and are spoofable. Default 1 (single edge router).
const TRUSTED_PROXY_COUNT = Math.max(0, Number(process.env.TRUSTED_PROXY_COUNT ?? 1));
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
    // Never forward our own gate credentials upstream to the providers.
    "authorization",
    "x-arm-token",
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
  // Drop hop-by-hop / encoding headers. content-length is dropped because Node's
  // fetch transparently decompresses gzip/br bodies while leaving the original
  // (compressed) content-length on the headers; forwarding it would mismatch the
  // re-sent buffer and truncate/hang the client. Express sets it from the payload.
  const blocked = new Set([
    "content-encoding",
    "content-length",
    "transfer-encoding",
    "connection",
  ]);

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
  if (typeof forwarded === "string" && forwarded.trim() && TRUSTED_PROXY_COUNT > 0) {
    const parts = forwarded
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    // Index from the right: the trusted proxy closest to us appended the real
    // client address last. Taking parts[0] (the original code) trusts the
    // left-most value, which any client can forge to escape the rate limiter.
    if (parts.length >= TRUSTED_PROXY_COUNT) {
      return parts[parts.length - TRUSTED_PROXY_COUNT];
    }
  }
  return req.socket?.remoteAddress || "unknown";
}

function extractBearer(headerValue) {
  if (typeof headerValue !== "string") return "";
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function timingSafeEqualStr(a, b) {
  // Hash both sides to a fixed 32-byte digest before comparing. This keeps the
  // comparison constant-time AND avoids leaking the secret's length via the
  // early length check the naive Buffer comparison required.
  const ah = crypto.createHash("sha256").update(String(a)).digest();
  const bh = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ah, bh);
}

// Gate for /api/* — requires a shared access token supplied by the client as
// `x-arm-token` (or `Authorization: Bearer`). Fails closed: if no token is
// configured server-side, the proxy is disabled rather than left open.
function requireProxyAuth(req, res, next) {
  if (!ACCESS_TOKEN) {
    res.status(503).json({
      error:
        "Provider proxy is disabled: ARM_ACCESS_TOKEN is not configured on the server. " +
        "Set ARM_ACCESS_TOKEN in the runtime environment to enable /api access.",
    });
    return;
  }
  const provided =
    (typeof req.headers["x-arm-token"] === "string" && req.headers["x-arm-token"]) ||
    extractBearer(req.headers["authorization"]);
  if (!provided || !timingSafeEqualStr(provided, ACCESS_TOKEN)) {
    res.status(401).json({ error: "Unauthorized: missing or invalid access token." });
    return;
  }
  next();
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

// Real HTTP security headers on every response. The <meta> CSP in index.html only
// covers the document; it cannot send frame-ancestors/HSTS and does not apply to
// /api/* JSON responses. frame-ancestors 'none' prevents clickjacking of the SPA.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; script-src 'self'; " +
      "style-src 'self' 'unsafe-inline'; font-src 'self' data:; " +
      "frame-ancestors 'none'; base-uri 'self'; object-src 'none'"
  );
  next();
});

// Only buffer raw request bodies for the provider proxy. Buffering every request
// (incl. SPA-fallback GETs) at 10mb is needless memory pressure under load.
app.use("/api", express.raw({ type: "*/*", limit: "10mb" }));
app.use(enforceRateLimit);
// Authenticate every keyed provider call. Mounted before the provider routes so
// it covers /api/anthropic, /api/openai and /api/gemini uniformly.
app.use("/api", requireProxyAuth);

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

// Embeddings — pinned to /v1/embeddings (text-embedding-3-small for convergence scoring).
// Registered before the chat-completions catch-all so it matches first.
// Same minimal-headers approach: forwarding browser headers triggers HTTP 421 on OpenAI's CDN.
app.use("/api/openai/v1/embeddings", async (req, res) => {
  const key = requireEnv(res, "OPENAI_API_KEY");
  if (!key) return;
  try {
    const upstreamRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
      redirect: "manual",
    });
    copyResponseHeaders(upstreamRes.headers, res);
    const payload = Buffer.from(await upstreamRes.arrayBuffer());
    res.status(upstreamRes.status).send(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown proxy error";
    res.status(502).json({ error: `Proxy request failed: ${message}` });
  }
});

app.use("/api/openai", async (req, res) => {
  const key = requireEnv(res, "OPENAI_API_KEY");
  if (!key) return;

  // Pin to the chat-completions endpoint. Do NOT forward arbitrary client paths
  // to api.openai.com: with only the shared access token, a caller could otherwise
  // spend the operator's key on fine-tuning, file uploads, assistants or pricier
  // models — broken access control / denial-of-wallet. The Anthropic and Gemini
  // routes are likewise locked to a single upstream path.
  //
  // Use clean minimal headers — forwarding browser headers triggers HTTP 421
  // (Misdirected Request) on OpenAI's CDN due to HTTP/2 connection coalescing.
  try {
    const upstreamRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
      // Never follow redirects with the operator key attached.
      redirect: "manual",
    });
    copyResponseHeaders(upstreamRes.headers, res);
    const payload = Buffer.from(await upstreamRes.arrayBuffer());
    res.status(upstreamRes.status).send(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown proxy error";
    res.status(502).json({ error: `Proxy request failed: ${message}` });
  }
});

app.use("/api/gemini/v1beta/models/gemini-2.5-pro:generateContent", async (req, res) => {
  // Accept either name, matching .env.example and the Vite dev proxy
  // (GOOGLE_API_KEY is the primary; GEMINI_API_KEY is the legacy fallback).
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) {
    res.status(500).json({
      error: "GOOGLE_API_KEY (or GEMINI_API_KEY) is not configured in the runtime environment.",
    });
    return;
  }

  await proxyToProvider(
    req,
    res,
    "https://generativelanguage.googleapis.com",
    "/v1beta/models/gemini-2.5-pro:generateContent",
    {
      "x-goog-api-key": key,
    }
  );
});

// ─── Auto-save trace endpoint ──────────────────────────────────────────────────
const traceDir = path.join(__dirname, "trace");
if (!fs.existsSync(traceDir)) fs.mkdirSync(traceDir, { recursive: true });

app.post("/api/save-trace", enforceRateLimit, express.json({ limit: "2mb" }), (req, res) => {
  const key = req.headers["x-arm-token"];
  if (ACCESS_TOKEN && key !== ACCESS_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { filename, trace } = req.body || {};
  if (!filename || !trace || typeof trace !== "object") {
    return res.status(400).json({ error: "Missing filename or trace" });
  }

  // Sanitize filename — alphanumeric, hyphens, underscores, dots only
  const safe = path.basename(filename).replace(/[^a-zA-Z0-9\-_.]/g, "_");
  if (!safe.endsWith(".json")) {
    return res.status(400).json({ error: "filename must end in .json" });
  }

  const dest = path.join(traceDir, safe);
  try {
    fs.writeFileSync(dest, JSON.stringify(trace, null, 2), "utf8");
    console.log(`[ARM] trace saved → trace/${safe}`);
    res.json({ ok: true, saved: `trace/${safe}` });
  } catch (err) {
    console.error(`[ARM] trace save failed: ${err.message}`);
    res.status(500).json({ error: "Failed to write trace file" });
  }
});

app.use(express.static(distDir));
// SPA fallback. Express 5 (path-to-regexp v8) rejects a bare "*"; use a named
// wildcard so any unmatched GET returns index.html for client-side routing.
app.get("/*splat", enforceRateLimit, (_req, res) => {
  if (!indexHtml) {
    res.status(503).send("Build output unavailable.");
    return;
  }
  res.type("html").send(indexHtml);
});

app.listen(PORT, HOST, () => {
  console.log(`ARM app listening on http://${HOST}:${PORT}`);
  console.log(`[ARM] Trusting ${TRUSTED_PROXY_COUNT} reverse prox${TRUSTED_PROXY_COUNT === 1 ? "y" : "ies"} for client IP resolution.`);
  if (!ACCESS_TOKEN) {
    console.warn(
      "[ARM] WARNING: ARM_ACCESS_TOKEN is not set — the provider API proxy (/api/*) is DISABLED " +
        "and will return HTTP 503. Set ARM_ACCESS_TOKEN to enable it. This prevents the keyed proxy " +
        "from being abused as an open (denial-of-wallet) endpoint."
    );
  }
});
